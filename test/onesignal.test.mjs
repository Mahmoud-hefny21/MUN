import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';
import { createDatabase } from '../database.mjs';
import { createPush } from '../onesignal.mjs';

test('OneSignal test allowlist, identity, preferences and durable dispatch', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MUN_TEST_POSTGRES = 'memory';
  const db = await createDatabase();
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const appId = 'e50a0c69-ded5-45f6-967a-7902957a6eec';
  const env = {
    PUSH_ENABLED: 'true', PUSH_AUDIENCE_APPROVED: 'true', ONESIGNAL_IDENTITY_VERIFIED: 'true',
    ONESIGNAL_APP_ID: appId, ONESIGNAL_REST_API_KEY: 'fixture-only',
    ONESIGNAL_IDENTITY_PRIVATE_KEY_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
    PUSH_TEST_MEMBER_IDS: 'tester', CRON_SECRET: 'fixture-cron'
  };
  const origin = 'https://mun.example.test';
  const push = createPush({ ...db, env, origin });
  assert.equal(createPush({ ...db, env: { ...env, PUSH_AUDIENCE_APPROVED: 'false' }, origin }).identity('tester'), null);
  assert.equal(push.identity('other'), null);
  assert.equal(push.authorizeCron('Bearer wrong'), false);
  assert.equal(push.authorizeCron('Bearer fixture-cron'), true);
  const id = push.identity('tester');
  const [header, payload, signature] = id.jwt.split('.');
  assert.equal(verify('sha256', Buffer.from(header + '.' + payload), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, appId);
  assert.equal(claims.identity.external_id, id.externalId);
  assert.ok(!JSON.stringify(id).includes('fixture-only'));
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.onesignal.com/notifications?c=push');
    assert.equal(options.headers.Authorization, 'Key fixture-only');
    sent.push(JSON.parse(options.body));
    return sent.length === 1 ? new Response(null, { status: 503 }) : Response.json({ id: appId });
  };
  try {
    for (const member of ['tester', 'other']) {
      await db.run('INSERT INTO mun_members (id,email,name) VALUES (?,?,?)', member, member + '@example.test', member);
      await push.setPreference(member, true);
    }
    await db.run("INSERT INTO mun_notification_events(id,kind,title,route,body) VALUES ('post:1','Poll','Poll: Workshop topic','#feed','Choose a subject')");
    await db.run("INSERT INTO mun_notifications(event_id,member) SELECT 'post:1',id FROM mun_members");
    await push.enqueue('post:1');
    await push.enqueue('post:1');
    assert.equal((await db.all('SELECT * FROM mun_push_outbox')).length, 1);
    assert.equal(await push.flush(), 1);
    assert.equal((await db.get('SELECT state FROM mun_push_outbox')).state, 'pending');
    await db.run('UPDATE mun_push_outbox SET next_attempt=now()');
    assert.equal(await push.flush(), 1);
    assert.equal(await push.flush(), 0);
    assert.equal((await db.get('SELECT state FROM mun_push_outbox')).state, 'accepted');
    assert.equal(sent[0].idempotency_key, sent[1].idempotency_key);
    assert.deepEqual(sent[0].include_aliases.external_id, [id.externalId]);
    assert.equal(sent[0].url, origin + '/#feed');
    // Push messages carry the notification's own title and details.
    assert.deepEqual(sent[0].headings, { en: 'Poll: Workshop topic' });
    assert.deepEqual(sent[0].contents, { en: 'Choose a subject' });
    await push.setPreference('tester', false);
    assert.deepEqual(await push.preference('tester'), { enabled: false });
  } finally {
    globalThis.fetch = original;
    await db.close();
  }
});
