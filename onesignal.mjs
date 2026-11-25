import { createHash, createPrivateKey, randomUUID, sign, timingSafeEqual } from 'node:crypto';

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const destinations = new Set(['#home', '#feed', '#quiz', '#fantasy', '#resources']);

export function createPush({ env, origin, run, get, all }) {
  const { ONESIGNAL_APP_ID: appId, ONESIGNAL_REST_API_KEY: apiKey, CRON_SECRET: cronSecret } = env;
  const testMembers = new Set((env.PUSH_TEST_MEMBER_IDS || '').split(',').map(id => id.trim()).filter(Boolean));
  const production = env.PUSH_MODE === 'members';
  const audienceApproved = env.PUSH_AUDIENCE_APPROVED === 'true';
  let key;
  try {
    key = createPrivateKey(Buffer.from(env.ONESIGNAL_IDENTITY_PRIVATE_KEY_BASE64 || '', 'base64'));
  } catch {}
  const configured = env.PUSH_ENABLED === 'true' && env.ONESIGNAL_IDENTITY_VERIFIED === 'true' &&
    uuid.test(appId || '') && Boolean(apiKey) && key?.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
    origin.startsWith('https:') && audienceApproved && (production || testMembers.size > 0);
  const allowed = id => configured && (production || testMembers.has(id));
  const alias = id => createHash('sha256').update(appId + ':' + id).digest('hex');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  function identity(member) {
    if (!allowed(member)) return null;
    const externalId = alias(member);
    const payload = encode({ alg: 'ES256', typ: 'JWT' }) + '.' + encode({
      iss: appId, exp: Math.floor(Date.now() / 1000) + 600, identity: { external_id: externalId }
    });
    const signature = sign('sha256', Buffer.from(payload), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return { appId, safariId: env.ONESIGNAL_SAFARI_WEB_ID || '', externalId, jwt: payload + '.' + signature };
  }
  async function preference(member) {
    if (!allowed(member)) return null;
    return { enabled: Boolean(await get('SELECT 1 FROM mun_push_preferences WHERE member=?', member)) };
  }
  async function setPreference(member, enabled) {
    if (enabled) await run('INSERT INTO mun_push_preferences(member) VALUES (?) ON CONFLICT DO NOTHING', member);
    else await run('DELETE FROM mun_push_preferences WHERE member=?', member);
  }
  async function enqueue(event) {
    if (!configured) return;
    const rows = await all(`SELECT n.member FROM mun_notifications n
      JOIN mun_push_preferences p ON p.member=n.member WHERE n.event_id=?`, event);
    for (const row of rows) {
      if (allowed(row.member)) await run(`INSERT INTO mun_push_outbox(event_id, member, message_key)
        VALUES (?,?,?) ON CONFLICT DO NOTHING`, event, row.member, randomUUID());
    }
  }
  async function flush(limit = 3) {
    if (!configured) return 0;
    const rows = await all(`WITH claim AS (
      SELECT o.event_id,o.member FROM mun_push_outbox o
      WHERE o.state IN ('pending','sending') AND o.next_attempt<=now() AND o.attempts<4
        AND o.created_at>now()-interval '24 hours'
      ORDER BY o.next_attempt LIMIT ? FOR UPDATE SKIP LOCKED
    )
    UPDATE mun_push_outbox o SET state='sending', next_attempt=now()+interval '1 minute', attempts=attempts+1
    FROM claim WHERE o.event_id=claim.event_id AND o.member=claim.member
    RETURNING o.event_id,o.member,o.message_key,o.attempts`, limit);
    await Promise.all(rows.map(async job => {
      const event = await get(`SELECT e.route, e.title, e.body FROM mun_notification_events e
        JOIN mun_members m ON m.id=? JOIN mun_push_preferences p ON p.member=m.id
        WHERE e.id=? AND m.active=1 AND (e.committee IS NULL OR e.committee=m.committee)`, job.member, job.event_id);
      let state = 'skipped';
      let providerId = null;
      if (allowed(job.member) && destinations.has(event?.route)) {
        try {
          const response = await fetch('https://api.onesignal.com/notifications?c=push', {
            method: 'POST', signal: AbortSignal.timeout(2200),
            headers: { Authorization: 'Key ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              app_id: appId, target_channel: 'push', include_aliases: { external_id: [alias(job.member)] },
              isAnyWeb: true, headings: { en: event.title || 'MIU MUN' }, contents: { en: event.body || 'Open the MIU MUN portal for details.' },
              url: origin + '/' + event.route, idempotency_key: job.message_key
            })
          });
          if (response.ok) {
            const result = await response.json();
            providerId = uuid.test(result.id || '') ? result.id : null;
            state = providerId ? 'accepted' : 'skipped';
          } else state = response.status === 429 || response.status >= 500 ? 'pending' : 'failed';
        } catch {
          state = 'pending';
        }
      }
      if (state === 'pending' && job.attempts >= 4) state = 'unconfirmed';
      await run(`UPDATE mun_push_outbox SET state=?, provider_id=?, next_attempt=now()+interval '15 minutes'
        WHERE event_id=? AND member=? AND attempts=?`, state, providerId, job.event_id, job.member, job.attempts);
    }));
    return rows.length;
  }
  async function deliverySummary() {
    if (!configured) return null;
    return all(`SELECT state, COUNT(*)::integer AS count FROM mun_push_outbox
      WHERE created_at>now()-interval '24 hours' GROUP BY state ORDER BY state`);
  }
  function authorizeCron(header) {
    if (!configured || !cronSecret || typeof header !== 'string') return false;
    const a = Buffer.from(header);
    const b = Buffer.from('Bearer ' + cronSecret);
    return a.length === b.length && timingSafeEqual(a,b);
  }
  return { allowed, identity, preference, setPreference, enqueue, flush, authorizeCron, deliverySummary };
}
