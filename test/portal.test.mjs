import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

test('Google sign-in, shared club activity, roles and single awards', async () => {
  const origin = 'http://localhost:3000';
  Object.assign(process.env, {
    APP_ORIGIN: origin, PORT: '0', NODE_ENV: 'test', MUN_TEST_POSTGRES: 'memory',
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
  const { server } = await import('../server.mjs');
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
    return response.headers.getSetCookie().find(value => value.startsWith('mun_session=')).split(';')[0];
  }
  try {
    assert.match(await (await get('/')).text(), /id="logout"/);
    assert.match(await (await get('/app.js')).text(), /Continue with Google/);
    assert.equal((await (await get('/api/session')).json()).signedIn, false);
    const owner = await login('owner');
    const member = await login('delegate');
    const poll = { type: 'Poll', title: 'Workshop topic', body: 'Choose a subject', options: 'Debate\nResearch' };
    assert.equal((await post('publish', poll, member)).status, 403);
    assert.equal((await post('publish', poll, owner, 'https://other.example')).status, 403);
    assert.equal((await post('publish', poll, owner)).status, 200);
    const { data } = await (await get('/api/session', member)).json();
    assert.equal(data.posts[0].title, poll.title);
    assert.equal(data.profile.role, 'Member');
    assert.equal(Object.hasOwn(data.quiz, 'answer'), false);
    const vote = { id: data.posts[0].id, choice: '0' };
    assert.equal((await post('vote', vote, member)).status, 200);
    assert.equal((await post('vote', vote, member)).status, 409);
    const quiz = { id: String(data.quiz.id), date: data.quiz.date, choice: String(({ 1: 1, 2: 1, 3: 2 })[data.quiz.id]) };
    const submissions = await Promise.all([post('quiz', quiz, member), post('quiz', quiz, member)]);
    assert.deepEqual(submissions.map(response => response.status).sort(), [200, 409]);
    const ranking = (await (await get('/api/session', owner)).json()).data;
    assert.equal(ranking.members.find(entry => entry.name === 'delegate').points, 3);
    assert.equal(ranking.posts[0].votes[0], 1);
    assert.equal((await post('member', { id: data.profile.id, role: 'Member', active: '0' }, owner)).status, 200);
    assert.equal((await (await get('/api/session', member)).json()).signedIn, false);
    assert.equal((await post('logout', {}, owner)).status, 200);
    assert.equal((await (await get('/api/session', owner)).json()).signedIn, false);
  } finally {
    globalThis.fetch = request;
    await new Promise(resolve => server.close(resolve));
  }
});
