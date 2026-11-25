import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

test('Google sign-in, shared club activity, roles and single awards', async () => {
  const port = process.env.MUN_BROWSER === '1' ? '39177' : '0';
  const origin = 'http://127.0.0.1:' + port;
  Object.assign(process.env, {
    APP_ORIGIN: origin, PORT: port, NODE_ENV: 'test', MUN_TEST_POSTGRES: 'memory',
    GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-secret', BOARD_OWNER_EMAIL: 'owner@example.test'
  });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clients = new Map();
  const request = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] });
    }
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const { code, code_verifier: verifier } = Object.fromEntries(options.body);
    const client = clients.get(code);
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), client.challenge);
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: 'fixture-client', nonce: client.nonce,
      exp: Date.now() / 1000 + 600, sub: code, email: code + '@example.test', email_verified: true, name: code
    })).toString('base64url');
    const token = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url') + '.' + payload;
    return Response.json({ id_token: token + '.' + sign('RSA-SHA256', Buffer.from(token), privateKey).toString('base64url') });
  };
  const { startServer } = await import('../server.mjs');
  const server = startServer();
  if (!server.listening) await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (path, cookie = '') => request(base + path, { redirect: 'manual', headers: { cookie } });
  const post = (path, fields, cookie, requestOrigin = origin) => request(base + '/api/' + path, {
    method: 'POST', headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
    body: JSON.stringify(fields)
  });
  async function login(user) {
    const started = await get('/auth/google');
    assert.equal(started.status, 303);
    const auth = new URL(started.headers.get('location')).searchParams;
    clients.set(user, { nonce: auth.get('nonce'), challenge: auth.get('code_challenge') });
    const cookie = started.headers.getSetCookie()[0].split(';')[0];
    const callback = '/auth/google/callback?code=' + user + '&state=' + auth.get('state');
    const response = await get(callback, cookie);
    assert.equal(response.status, 303);
    assert.equal((await get(callback, cookie)).status, 400);
    return response.headers.getSetCookie().find(value => value.startsWith('mun_session='))?.split(';')[0];
  }
  try {
    assert.match(await (await get('/')).text(), /id="logout"/);
    assert.match(await (await get('/app.js')).text(), /Continue with Google/);
    assert.equal((await (await get('/api/session')).json()).signedIn, false);
    const owner = await login('owner');
    assert.equal(await login('delegate'), undefined);
    assert.equal((await post('member', { id: 'delegate', role: 'Member', active: '1' }, owner)).status, 200);
    const member = await login('delegate');
    assert.equal((await post('profile', { name: 'Delegate', photo: '', role: 'President' }, member)).status, 400);
    const poll = { type: 'Poll', title: 'Workshop topic', body: 'Choose a subject', options: 'Debate\nResearch' };
    assert.equal((await post('publish', poll, member)).status, 403);
    assert.equal((await post('publish', poll, owner, 'https://other.example')).status, 403);
    assert.equal((await post('publish', poll, owner)).status, 200);
    const { data } = await (await get('/api/session', member)).json();
    assert.equal(data.posts[0].title, poll.title);
    assert.equal(data.profile.role, 'Member');
    assert.equal(data.unreadNotifications, 1);
    assert.equal(data.notifications[0].title, poll.title);
    assert.equal((await post('notification-read', { id: 'not-owned' }, member)).status, 404);
    assert.equal((await (await post('notification-read', { id: data.notifications[0].id }, member)).json()).data.unreadNotifications, 0);
    assert.equal((await (await get('/api/session', owner)).json()).data.unreadNotifications, 1);
    assert.equal(Object.hasOwn(data.quiz, 'answer'), false);
    const vote = { id: data.posts[0].id, choice: '0' };
    assert.equal((await post('vote', vote, member)).status, 200);
    assert.equal((await post('vote', vote, member)).status, 409);
    assert.equal(data.quiz.id, undefined);
    const schedule = { question: '1', date: data.quiz.date, reward: '3', source: 'https://www.un.org/en/about-us/main-bodies' };
    assert.equal((await post('schedule-quiz', schedule, member)).status, 403);
    assert.equal((await post('schedule-quiz', schedule, owner)).status, 200);
    assert.equal((await post('schedule-quiz', schedule, owner)).status, 409);
    const scheduled = (await (await get('/api/session', member)).json()).data.quiz;
    assert.equal(Object.hasOwn(scheduled, 'answer'), false);
    const quiz = { id: String(scheduled.id), date: scheduled.date, choice: '1' };
    const submissions = await Promise.all([post('quiz', quiz, member), post('quiz', quiz, member)]);
    assert.deepEqual(submissions.map(response => response.status).sort(), [200, 409]);
    const ranking = (await (await get('/api/session', owner)).json()).data;
    assert.equal(ranking.members.find(entry => entry.name === 'delegate').points, 3);
    assert.equal(ranking.posts[0].votes[0], 1);
    assert.equal((await post('committee', { name: 'GA' }, owner)).status, 200);
    assert.equal((await post('committee', { name: 'Security Council' }, owner)).status, 200);
    assert.equal((await post('member', { id: data.profile.id, role: 'Head', committee: 'GA', active: '1' }, owner)).status, 200);
    assert.equal((await post('pin', { id: data.posts[0].id }, member)).status, 404);
    const scopedPost = await (await post('publish', { ...poll, title: 'GA poll', committee: 'Security Council' }, member)).json();
    const ga = scopedPost.data.posts.find(item => item.title === 'GA poll');
    assert.equal(ga.committee, 'GA');
    assert.equal((await post('member', { id: data.profile.id, role: 'Member', committee: 'Security Council', active: '1' }, owner)).status, 200);
    const reassigned = (await (await get('/api/session', member)).json()).data;
    assert.ok(!reassigned.posts.some(item => item.id === ga.id));
    assert.ok(!reassigned.notifications.some(item => item.title === 'GA poll'));
    assert.equal((await post('vote', { id: ga.id, choice: '0' }, member)).status, 400);
    const activity = { title: 'Delegate practice', starts: new Date(Date.now() - 60000).toISOString(), kind: 'Training', committee: 'Security Council' };
    assert.equal((await post('activity', activity, member)).status, 403);
    const publishedActivity = (await (await post('activity', activity, owner)).json()).data.boardActivities[0];
    const attendance = { activity: publishedActivity.id, member: data.profile.id };
    assert.equal((await post('attendance', attendance, owner)).status, 200);
    assert.equal((await post('attendance', attendance, owner)).status, 409);
    assert.equal((await (await get('/api/session', member)).json()).data.attendance[0].title, activity.title);
    if (process.env.MUN_LOAD_BASELINE === '1') {
      const samples = await Promise.all(Array.from({ length: 140 }, async (_, index) => {
        const started = performance.now();
        const response = await get('/api/session', index % 2 ? owner : member);
        await response.arrayBuffer();
        return { ms: performance.now() - started, ok: response.ok };
      }));
      const timings = samples.map(item => item.ms).sort((a, b) => a - b);
      const percentile = value => Math.round(timings[Math.ceil(timings.length * value) - 1]);
      const errors = samples.filter(item => !item.ok).length;
      console.log(JSON.stringify({ requests: samples.length, fixtureAccounts: 2, errors, p50: percentile(.50), p95: percentile(.95), p99: percentile(.99) }));
      assert.equal(errors, 0);
    }
    if (process.env.MUN_BROWSER === '1') {
      const { verifyBrowser } = await import('./browser-checks.mjs');
      await verifyBrowser(base, await login('owner'));
    }
    assert.equal((await post('member', { id: data.profile.id, role: 'Member', active: '0' }, owner)).status, 200);
    assert.equal((await (await get('/api/session', member)).json()).signedIn, false);
    assert.equal((await post('logout', {}, owner)).status, 200);
    assert.equal((await (await get('/api/session', owner)).json()).signedIn, false);
  } finally {
    globalThis.fetch = request;
    await new Promise(resolve => server.close(resolve));
  }
});
