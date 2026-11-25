import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

test('Google sign-in, shared club activity, roles and single awards', async () => {
  const port = process.env.MUN_BROWSER === '1' ? '39177' : '0';
  const origin = 'http://127.0.0.1:' + port;
  const testAI = process.env.MUN_AI_FIXTURE === '1';
  let aiMode = 'primary';
  const providerCalls = [];
  Object.assign(process.env, {
    APP_ORIGIN: origin, PORT: port, NODE_ENV: 'test', MUN_TEST_POSTGRES: 'memory',
    AI_ENABLED: String(testAI), AI_PRIMARY_PROVIDER: 'gemini', AI_MEMBER_DAILY_LIMIT: '5',
    GEMINI_API_KEY: 'fixture-gemini', GEMINI_MODEL: 'fixture',
    GROQ_API_KEY: 'fixture-groq', GROQ_MODEL: 'fixture',
    CLOUDINARY_CLOUD_NAME: 'fixture-cloud', CLOUDINARY_API_KEY: 'fixture-key', CLOUDINARY_API_SECRET: 'fixture-secret',
    GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-secret', GOOGLE_CALLBACK_URL: origin + '/api/auth/google/callback'
  });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clients = new Map();
  const request = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
      assert.equal(options.headers['x-goog-api-key'], 'fixture-gemini');
      providerCalls.push('gemini');
      return aiMode === 'primary'
        ? Response.json({ candidates: [{ content: { parts: [{ text: 'Primary answer [1]' }] } }] })
        : new Response(null, { status: 429 });
    }
    if (url === 'https://api.groq.com/openai/v1/chat/completions') {
      assert.equal(options.headers.Authorization, 'Bearer fixture-groq');
      providerCalls.push('groq');
      return aiMode === 'fallback'
        ? Response.json({ choices: [{ message: { content: 'Fallback answer [1]' } }] })
        : new Response(null, { status: 503 });
    }
    if (url === 'https://api.cloudinary.com/v1_1/fixture-cloud/image/upload') {
      const form = options.body;
      const signed = ['folder', 'invalidate', 'overwrite', 'public_id', 'timestamp'].map(key => key + '=' + form.get(key)).join('&');
      assert.equal(form.get('api_key'), 'fixture-key');
      assert.equal(form.get('signature'), createHash('sha1').update(signed + 'fixture-secret').digest('hex'));
      assert.match(form.get('file'), /^data:image\/jpeg;base64,/);
      return Response.json({ secure_url: 'https://res.cloudinary.com/fixture-cloud/image/upload/v1/mun/members/' + form.get('public_id') + '.jpg' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] });
    }
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const { code, code_verifier: verifier } = Object.fromEntries(options.body);
    const client = clients.get(code);
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), client.challenge);
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: 'fixture-client', nonce: client.nonce,
      exp: Date.now() / 1000 + 600, sub: code, email: code + (code === 'invited' ? '@gmail.com' : '@example.test'), email_verified: true, name: code
    })).toString('base64url');
    const token = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url') + '.' + payload;
    return Response.json({ id_token: token + '.' + sign('RSA-SHA256', Buffer.from(token), privateKey).toString('base64url') });
  };
  const { startServer, provisionPresident } = await import('../server.mjs');
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
    assert.equal(auth.get('redirect_uri'), origin + '/api/auth/google/callback');
    clients.set(user, { nonce: auth.get('nonce'), challenge: auth.get('code_challenge') });
    const cookie = started.headers.getSetCookie()[0].split(';')[0];
    const callback = '/api/auth/google/callback?code=' + user + '&state=' + auth.get('state');
    const response = await get(callback, cookie);
    assert.equal(response.status, 303);
    assert.equal((await get(callback, cookie)).status, 400);
    return response.headers.getSetCookie().find(value => value.startsWith('mun_session='))?.split(';')[0];
  }
  try {
    assert.match(await (await get('/')).text(), /id="logout"/);
    assert.match(await (await get('/app.js')).text(), /Continue with Google/);
    const pushWorker = await get('/push/onesignal/OneSignalSDKWorker.js');
    assert.match(pushWorker.headers.get('content-type'), /application\/javascript/);
    assert.match(await pushWorker.text(), /\/sdks\/web\/v16\/OneSignalSDK\.sw\.js/);
    assert.equal((await get('/api/cron/push')).status, 404);
    assert.equal((await post('push/identity', {}, '')).status, 401);
    assert.equal((await (await get('/api/session')).json()).signedIn, false);
    assert.equal(await login('owner'), undefined);
    await provisionPresident('owner');
    await assert.rejects(provisionPresident('owner'), /already exists/);
    const owner = await login('owner');
    assert.equal(await login('delegate'), undefined);
    assert.equal((await post('member', { id: 'delegate', role: 'Member', active: '1' }, owner)).status, 200);
    const member = await login('delegate');
    const library = await (await post('assistant/library', { question: 'rules of procedure' }, member)).json();
    assert.match(library.sources[0].title, /Rules of Procedure/);
    assert.equal((await post('assistant/library', { question: 'rules of procedure' }, '')).status, 401);
    if (testAI) {
      const ask = () => post('assistant', { question: 'rules of procedure' }, member);
      const primary = await (await ask()).json();
      assert.equal(primary.text, 'Primary answer [1]');
      assert.equal(primary.sources.length, 1);
      aiMode = 'fallback';
      assert.equal((await (await ask()).json()).text, 'Fallback answer [1]');
      aiMode = 'outage';
      assert.equal((await ask()).status, 503);
      assert.equal((await ask()).status, 429);
      assert.deepEqual(providerCalls, ['gemini', 'gemini', 'groq', 'gemini', 'groq']);
      assert.equal((await post('assistant/library', { question: 'rules of procedure' }, member)).status, 200);
    }
    assert.equal((await post('profile', { name: 'Delegate', photo: '', role: 'President' }, member)).status, 400);
    assert.equal((await post('profile-photo', { image: 'data:text/html;base64,PHNjcmlwdD4=' }, member)).status, 400);
    assert.equal((await post('profile-photo', { image: 'data:image/jpeg;base64,' + 'A'.repeat(500000) }, member)).status, 413);
    const uploaded = await (await post('profile-photo', { image: 'data:image/jpeg;base64,/9j/4AAQ' }, member)).json();
    assert.match(uploaded.data.profile.photo, /^https:\/\/res\.cloudinary\.com\/fixture-cloud\//);
    assert.equal((await post('profile-photo', { remove: true }, member)).status, 200);
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
    assert.equal((await post('custom-role', { name: 'Learning editor', permissions: ['learning'] }, member)).status, 403);
    assert.equal((await post('custom-role', { name: 'Learning editor', permissions: ['members'] }, owner)).status, 400);
    assert.equal((await post('custom-role', { name: 'Learning editor', permissions: ['learning'] }, owner)).status, 200);
    assert.equal((await post('member-email', { email: 'delegate@example.test', role: 'Learning editor', committee: 'Security Council' }, owner)).status, 200);
    assert.equal((await (await get('/api/session', member)).json()).data.profile.role, 'Learning editor');
    assert.equal((await post('publish', poll, member)).status, 403);
    assert.equal((await post('member-email', { email: 'invited@gmail.com', role: 'Learning editor' }, owner)).status, 200);
    const invited = await login('invited');
    assert.deepEqual((await (await get('/api/session', invited)).json()).data.permissions, ['learning']);
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
      assert.equal((await post('member-email', { email: 'delegate@example.test', role: 'Member' }, owner)).status, 200);
      const { verifyBrowser } = await import('./browser-checks.mjs');
      await verifyBrowser(base, await login('owner'), member);
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
