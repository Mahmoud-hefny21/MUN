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
      exp: Date.now() / 1000 + 600, sub: code, email: code + (['invited', 'rostered', 'member2'].includes(code) ? '@gmail.com' : '@example.test'), email_verified: true, name: code
    })).toString('base64url');
    const token = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url') + '.' + payload;
    return Response.json({ id_token: token + '.' + sign('RSA-SHA256', Buffer.from(token), privateKey).toString('base64url') });
  };
  const { startServer, provisionPresident, provisionAdmin, importRoster } = await import('../server.mjs');
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
    // Scripts and CSS are versioned in the page and cached long-term; unversioned requests still revalidate.
    const page = await (await get('/')).text();
    const appVersion = page.match(/src="\/app\.js\?v=([^"]+)"/)[1];
    assert.match(page, /href="\/style\.css\?v=/);
    assert.equal((await get('/app.js?v=' + appVersion)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await get('/app.js')).headers.get('cache-control'), 'no-cache');
    assert.equal((await get('/app.js?v=stale')).headers.get('cache-control'), 'no-cache');
    const robots = await get('/robots.txt');
    assert.equal(robots.status, 200);
    const robotsText = await robots.text();
    assert.ok(robotsText.includes('Disallow: /api/') && robotsText.includes('Sitemap: ' + origin + '/sitemap.xml'));
    assert.ok((await (await get('/sitemap.xml')).text()).includes('<loc>' + origin + '/</loc>'));
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
    await assert.rejects(importRoster([{ email: 'x@gmail.com', name: 'X', role: 'President' }]), /Unknown roster role/);
    assert.deepEqual(await importRoster([
      { email: 'Rostered@gmail.com ', name: 'Rostered  Board Lead', role: 'Co-President', committee: 'Operations', position: 'Head of Operations' },
      { email: 'member2@gmail.com', name: 'Roster Member', role: '', committee: 'Press and Media' },
      { email: 'not-an-email', name: 'Ignored' }
    ]), { roster: 2, updatedMembers: 0 });
    const rosteredSession = await login('rostered');
    const rostered = await (await get('/api/session', rosteredSession)).json();
    assert.equal(rostered.signedIn, true);
    assert.equal(rostered.data.profile.name, 'Rostered Board Lead');
    assert.equal(rostered.data.profile.role, 'Co-President');
    assert.equal(rostered.data.profile.committee, 'Operations');
    assert.equal(rostered.data.profile.position, 'Head of Operations');
    assert.ok(rostered.data.permissions.includes('members'));
    const plain = await (await get('/api/session', await login('member2'))).json();
    assert.equal(plain.signedIn, true);
    assert.equal(plain.data.profile.role, 'Member');
    assert.deepEqual(plain.data.permissions, []);
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
    assert.equal(data.notifications[0].title, 'Poll: ' + poll.title);
    assert.equal(data.notifications[0].body, poll.body);
    assert.equal((await post('notification-read', { id: 'not-owned' }, member)).status, 404);
    assert.equal((await (await post('notification-read', { id: data.notifications[0].id }, member)).json()).data.unreadNotifications, 0);
    assert.equal((await (await get('/api/session', owner)).json()).data.unreadNotifications, 1);
    assert.equal(Object.hasOwn(data.quiz, 'answer'), false);
    assert.deepEqual(data.posts[0].votes, [0, 0]);
    const vote = { id: data.posts[0].id, choice: '0' };
    assert.equal((await post('vote', vote, member)).status, 200);
    assert.deepEqual((await (await get('/api/session', owner)).json()).data.posts[0].votes, [1, 0]);
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
    assert.equal((await post('custom-role', { name: 'Bad role', permissions: ['admin'] }, owner)).status, 400);
    // A custom role can manage members, limited to the holder's committee.
    assert.equal((await post('custom-role', { name: 'Committee lead', permissions: ['members', 'points'], committeeOnly: true }, owner)).status, 200);
    assert.equal((await post('directory-save', { email: 'member2@gmail.com', name: 'Lead', role: 'Committee lead' }, owner)).status, 400);
    assert.equal((await post('directory-save', { email: 'member2@gmail.com', name: 'Lead', role: 'Committee lead', committee: 'Press and Media' }, owner)).status, 200);
    const leadSession = await login('member2');
    const leadView = (await (await get('/api/session', leadSession)).json()).data;
    assert.deepEqual(leadView.permissions, ['members', 'points']);
    assert.deepEqual(leadView.boardRoles, ['Member']);
    assert.equal(leadView.scope, 'Press and Media');
    assert.ok(leadView.boardDirectory.every(person => person.committee === 'Press and Media'));
    assert.equal((await post('directory-save', { email: 'lead1@miuegypt.edu.eg', name: 'Lead One', committee: 'Operations' }, leadSession)).status, 200);
    assert.ok((await (await get('/api/session', leadSession)).json()).data.boardDirectory.some(person => person.email === 'lead1@miuegypt.edu.eg' && person.committee === 'Press and Media'));
    assert.equal((await post('directory-remove', { email: 'lead1@miuegypt.edu.eg' }, leadSession)).status, 200);
    assert.equal((await post('directory-save', { email: 'member2@gmail.com', name: 'Roster Member', role: 'Member', committee: 'Press and Media' }, owner)).status, 200);
    // Admin sits above the President: open access, can manage and grant President; nobody grants Admin from the app.
    await login('chief');
    await provisionAdmin('chief');
    const chiefSession = await login('chief');
    const adminView = (await (await get('/api/session', chiefSession)).json()).data;
    assert.equal(adminView.profile.role, 'Admin');
    assert.deepEqual(adminView.permissions, ['members', 'posts', 'points', 'learning', 'activities']);
    assert.ok(adminView.boardRoles.includes('President') && !adminView.boardRoles.includes('Admin'));
    assert.equal((await post('directory-save', { email: 'chief@example.test', name: 'Demote the Admin', role: 'Member' }, owner)).status, 403);
    assert.equal((await post('directory-save', { email: 'pres2@miuegypt.edu.eg', name: 'Second President', role: 'President' }, owner)).status, 400);
    assert.equal((await post('directory-save', { email: 'owner@example.test', name: 'owner', role: 'Co-President' }, chiefSession)).status, 200);
    assert.equal((await post('directory-save', { email: 'owner@example.test', name: 'owner', role: 'President' }, chiefSession)).status, 200);
    assert.equal((await (await get('/api/session', owner)).json()).data.profile.role, 'President');
    assert.equal((await post('directory-save', { email: 'x2@miuegypt.edu.eg', name: 'X', role: 'Admin' }, chiefSession)).status, 400);
    assert.equal((await post('role-access', { role: 'Assigned Admin', permissions: ['learning'] }, owner)).status, 403);
    assert.equal((await post('role-access', { role: 'Assigned Admin', permissions: ['learning', 'posts'] }, chiefSession)).status, 200);
    assert.deepEqual((await (await get('/api/session', chiefSession)).json()).data.boardRoleAccess['Assigned Admin'], ['learning', 'posts']);
    assert.equal((await post('role-access', { role: 'Assigned Admin', permissions: ['learning'] }, chiefSession)).status, 200);
    assert.equal((await post('custom-role', { name: 'Learning editor', permissions: ['learning'] }, owner)).status, 200);
    assert.equal((await post('member-email', { email: 'delegate@example.test', role: 'Learning editor', committee: 'Security Council' }, owner)).status, 200);
    assert.equal((await (await get('/api/session', member)).json()).data.profile.role, 'Learning editor');
    assert.equal((await post('publish', poll, member)).status, 403);
    assert.equal((await post('member-email', { email: 'invited@gmail.com', role: 'Learning editor' }, owner)).status, 200);
    assert.equal((await post('member-email', { email: 'copresident@gmail.com', role: 'Co-President' }, owner)).status, 200);
    assert.equal((await post('member-invite-revoke', { email: 'copresident@gmail.com' }, owner)).status, 200);
    assert.equal((await post('member-email', { email: 'president@gmail.com', role: 'President' }, owner)).status, 400);
    assert.equal((await post('directory-save', { email: 'Newbie@miuegypt.edu.eg', name: 'New Delegate', committee: '', role: 'Member', position: 'Delegate' }, owner)).status, 200);
    const directory = (await (await get('/api/session', owner)).json()).data.boardDirectory;
    assert.ok(directory.some(person => person.email === 'newbie@miuegypt.edu.eg' && person.position === 'Delegate' && !person.signed_in && person.active));
    assert.ok(directory.some(person => person.email === 'rostered@gmail.com' && person.signed_in));
    // The President manages Co-Presidents; a Co-President cannot touch the President or grant full access.
    assert.equal((await post('directory-save', { email: 'rostered@gmail.com', name: 'Rostered Board Lead', role: 'Co-President', committee: 'Operations', position: 'Head of Operations' }, owner)).status, 200);
    assert.equal((await post('directory-save', { email: 'owner@example.test', name: 'Owner', role: 'Member' }, rosteredSession)).status, 403);
    assert.equal((await post('directory-save', { email: 'y@miuegypt.edu.eg', name: 'Y', role: 'Co-President' }, rosteredSession)).status, 400);
    assert.equal((await post('directory-remove', { email: 'owner@example.test' }, rosteredSession)).status, 403);
    const roleAccess = (await (await get('/api/session', owner)).json()).data.boardRoleAccess;
    assert.deepEqual(roleAccess['Vice President'], ['posts', 'points', 'learning', 'activities']);
    assert.equal((await post('directory-save', { email: 'not-an-email', name: 'X' }, owner)).status, 400);
    assert.equal((await post('directory-save', { email: 'x@miuegypt.edu.eg', name: 'X', role: 'Co-President' }, owner)).status, 200);
    assert.equal((await post('directory-remove', { email: 'x@miuegypt.edu.eg' }, owner)).status, 200);
    assert.equal((await post('directory-save', { email: 'x@miuegypt.edu.eg', name: 'X' }, member)).status, 403);
    // Points: only the recipient is notified, with details; board can read anyone's history.
    const memberId = (await (await get('/api/session', member)).json()).data.profile.id;
    assert.equal((await post('points', { member: memberId, amount: '5', reason: 'Best position paper', operation: crypto.randomUUID() }, owner)).status, 200);
    const memberInbox = (await (await get('/api/session', member)).json()).data.notifications;
    assert.equal(memberInbox[0].title, 'You earned +5 points');
    assert.match(memberInbox[0].body, /^Best position paper · by /);
    assert.equal((await (await get('/api/session', owner)).json()).data.notifications.some(item => item.kind === 'Points'), false);
    const history = await (await post('points-history', { member: memberId }, owner)).json();
    assert.ok(history.transactions.some(entry => entry.amount === 5 && entry.reason === 'Best position paper'));
    assert.equal((await post('points-history', { member: memberId }, member)).status, 403);
    assert.equal((await post('points-history', { member: 'nobody' }, owner)).status, 404);
    // Role hierarchy: Heads stay inside their committee; nobody grants a role at or above their own.
    assert.equal((await post('directory-save', { email: 'member2@gmail.com', name: 'Press Head', role: 'Head', committee: 'Press and Media' }, owner)).status, 200);
    const headSession = await login('member2');
    const headView = (await (await get('/api/session', headSession)).json()).data;
    assert.deepEqual(headView.boardRoles, ['Member']);
    assert.ok(headView.permissions.includes('members') && headView.permissions.includes('points'));
    assert.ok(headView.boardDirectory.every(person => person.committee === 'Press and Media'));
    assert.equal((await post('directory-save', { email: 'pm1@miuegypt.edu.eg', name: 'PM One', committee: 'Operations' }, headSession)).status, 200);
    assert.ok((await (await get('/api/session', headSession)).json()).data.boardDirectory.some(person => person.email === 'pm1@miuegypt.edu.eg' && person.committee === 'Press and Media'));
    assert.equal((await post('directory-save', { email: 'pm2@miuegypt.edu.eg', name: 'PM Two', role: 'High Board' }, headSession)).status, 400);
    assert.equal((await post('directory-save', { email: 'ops1@miuegypt.edu.eg', name: 'Ops One', committee: 'Operations' }, owner)).status, 200);
    assert.equal((await post('directory-remove', { email: 'ops1@miuegypt.edu.eg' }, headSession)).status, 403);
    assert.equal((await post('directory-save', { email: 'ops1@miuegypt.edu.eg', name: 'Stolen' }, headSession)).status, 403);
    assert.equal((await post('directory-remove', { email: 'rostered@gmail.com' }, headSession)).status, 403);
    assert.equal((await post('directory-remove', { email: 'pm1@miuegypt.edu.eg' }, headSession)).status, 200);
    assert.equal((await post('points', { member: (await (await get('/api/session', owner)).json()).data.profile.id, amount: '3', reason: 'Out of scope', operation: crypto.randomUUID() }, headSession)).status, 404);
    assert.equal((await post('custom-role', { name: 'Head made role', permissions: ['posts'] }, headSession)).status, 403);
    assert.equal((await post('committee', { name: 'Head committee' }, headSession)).status, 403);
    // High Board: members, points and activities; cannot grant Upper Board or create roles.
    assert.equal((await post('directory-save', { email: 'rostered@gmail.com', name: 'Rostered Board Lead', role: 'High Board', committee: 'Operations' }, owner)).status, 200);
    const highView = (await (await get('/api/session', rosteredSession)).json()).data;
    assert.deepEqual(highView.permissions, ['members', 'points', 'activities']);
    assert.ok(!highView.boardRoles.includes('Upper Board') && !highView.boardRoles.includes('High Board') && !highView.boardRoles.includes('Head'));
    assert.equal((await post('directory-save', { email: 'ub@miuegypt.edu.eg', name: 'UB', role: 'Upper Board' }, rosteredSession)).status, 400);
    assert.equal((await post('custom-role', { name: 'High made role', permissions: ['points'] }, rosteredSession)).status, 403);
    assert.equal((await post('directory-remove', { email: 'ops1@miuegypt.edu.eg' }, rosteredSession)).status, 200);
    // Upper Board can do everything below it.
    assert.equal((await post('directory-save', { email: 'rostered@gmail.com', name: 'Rostered Board Lead', role: 'Upper Board', committee: 'Operations' }, owner)).status, 200);
    assert.deepEqual((await (await get('/api/session', rosteredSession)).json()).data.permissions, ['members', 'posts', 'points', 'learning', 'activities']);
    assert.equal((await post('directory-save', { email: 'hb@miuegypt.edu.eg', name: 'HB', role: 'High Board' }, rosteredSession)).status, 200);
    assert.equal((await post('directory-save', { email: 'ub2@miuegypt.edu.eg', name: 'UB2', role: 'Upper Board' }, rosteredSession)).status, 400);
    assert.equal((await post('directory-remove', { email: 'hb@miuegypt.edu.eg' }, rosteredSession)).status, 200);
    assert.equal((await post('directory-save', { email: 'rostered@gmail.com', name: 'Rostered Board Lead', role: 'Co-President', committee: 'Operations' }, owner)).status, 200);
    assert.equal((await post('directory-save', { email: 'member2@gmail.com', name: 'Roster Member', role: 'Member', committee: 'Press and Media' }, owner)).status, 200);
    const plainMemberForFantasy = await login('member2');
    // Fantasy over HTTP: page data, rules permissions, saving a squad.
    const fantasyView = await (await post('fantasy', {}, owner)).json();
    assert.equal(fantasyView.round.number, 1);
    assert.ok(fantasyView.players.length >= 2 && fantasyView.players.every(player => player.price === fantasyView.settings.startPrice));
    assert.equal((await post('fantasy-settings', { squadSize: '2' }, plainMemberForFantasy)).status, 403);
    assert.equal((await post('fantasy-settings', { squadSize: '0' }, owner)).status, 400);
    assert.equal((await post('fantasy-settings', { squadSize: '2' }, owner)).status, 200);
    assert.equal((await (await get('/api/session', owner)).json()).data.fantasySettings.squadSize, 2);
    const ownerId = (await (await get('/api/session', owner)).json()).data.profile.id;
    const picks = fantasyView.players.filter(player => player.id !== ownerId).slice(0, 2).map(player => player.id);
    // Managers may include themselves.
    assert.equal((await post('fantasy-squad', { players: [ownerId, picks[0]], captain: ownerId }, owner)).status, 200);
    const savedSquad = await (await post('fantasy-squad', { players: picks, captain: picks[1] }, owner)).json();
    assert.equal(savedSquad.message, 'Squad saved for next round.');
    assert.deepEqual([...savedSquad.data.upcoming.players].sort(), [...picks].sort());
    assert.equal(savedSquad.data.upcoming.captain, picks[1]);
    assert.equal((await post('fantasy-settings', { squadSize: '5' }, owner)).status, 200);
    // Resources: add, edit, delete, and a signed upload ticket for PDFs.
    const plainMember = await login('member2');
    assert.equal((await post('resource', { title: 'Delegate handbook', category: 'Guide', body: 'Club handbook', url: 'https://res.cloudinary.com/fixture-cloud/raw/upload/v1/mun/resources/handbook.pdf' }, plainMember)).status, 403);
    assert.equal((await post('resource', { title: 'Delegate handbook', category: 'Guide', body: 'Club handbook', url: 'https://res.cloudinary.com/fixture-cloud/raw/upload/v1/mun/resources/handbook.pdf' }, owner)).status, 200);
    const handbook = (await (await get('/api/session', owner)).json()).data.resources.find(item => item.title === 'Delegate handbook');
    assert.ok(handbook);
    assert.equal((await post('resource-update', { id: String(handbook.id), title: 'Delegate handbook 2026', category: 'Guide', body: 'Updated handbook', url: handbook.url }, owner)).status, 200);
    const updatedResource = (await (await get('/api/session', owner)).json()).data.resources.find(item => item.id === handbook.id);
    assert.equal(updatedResource.title, 'Delegate handbook 2026');
    assert.equal(updatedResource.body, 'Updated handbook');
    assert.equal((await post('resource-update', { id: '999999', title: 'Ghost', category: 'X', body: 'X' }, owner)).status, 404);
    const opened = await get('/api/resource-file?id=' + handbook.id, owner);
    assert.equal(opened.status, 303);
    const download = new URL(opened.headers.get('location'));
    assert.equal(download.origin + download.pathname, 'https://api.cloudinary.com/v1_1/fixture-cloud/raw/download');
    assert.equal(download.searchParams.get('public_id'), 'mun/resources/handbook.pdf');
    const signedParams = ['expires_at', 'public_id', 'timestamp', 'type'].map(key => key + '=' + download.searchParams.get(key)).join('&');
    assert.equal(download.searchParams.get('signature'), createHash('sha1').update(signedParams + 'fixture-secret').digest('hex'));
    assert.equal((await get('/api/resource-file?id=' + handbook.id, '')).status, 401);
    assert.equal((await get('/api/resource-file?id=999999', owner)).status, 404);
    const ticket = await (await post('resource-upload', {}, owner)).json();
    assert.equal(ticket.url, 'https://api.cloudinary.com/v1_1/fixture-cloud/raw/upload');
    assert.equal(ticket.fields.folder, 'mun/resources');
    assert.equal(ticket.fields.signature, createHash('sha1').update('folder=mun/resources&timestamp=' + ticket.fields.timestamp + 'fixture-secret').digest('hex'));
    assert.equal(JSON.stringify(ticket).includes('fixture-secret'), false);
    assert.equal((await post('resource-upload', {}, plainMember)).status, 403);
    assert.equal((await post('resource-delete', { id: String(handbook.id) }, plainMember)).status, 403);
    assert.equal((await post('resource-delete', { id: String(handbook.id) }, owner)).status, 200);
    assert.equal((await post('resource-delete', { id: String(handbook.id) }, owner)).status, 404);
    assert.equal((await post('directory-remove', { email: 'newbie@miuegypt.edu.eg' }, owner)).status, 200);
    assert.equal((await post('directory-remove', { email: 'newbie@miuegypt.edu.eg' }, owner)).status, 404);
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
