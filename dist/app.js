const content = document.querySelector('#content');

const pages = { home: 'Overview', feed: 'Club Feed', fantasy: 'Fantasy', assistant: 'MUN Assistant', resources: 'Resources', quiz: 'Daily Quiz', profile: 'My Profile', admin: 'Board Workspace' };
let state;
let session = {};
let editingPost = '';
let busy = false;
let scope = 'points';
let feedFilter = 'All';
let conversation = [];
let notice = '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const points = () => state.transactions.reduce((total, entry) => total + entry.amount, 0);
const level = () => Math.max(1, Math.floor(points() / 50) + 1);
const postOrder = () => [...state.posts].sort((a, b) => Number(b.pinned) - Number(a.pinned));
const safeUrl = value => /^https:\/\//i.test(value || '') ? esc(value) : '';

function ranks(period) {
  return state.members.map(member => ({ name: member.name, score: member[period] || 0, you: member.id === state.profile.id }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
const ranking = (period, limit) => `<ol class="ranking">${ranks(period).slice(0, limit).map((member, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><span>${esc(member.name)}${member.you ? ' · You' : ''}</span><strong>${member.score} pts</strong></li>`).join('')}</ol>`;
const rank = () => ranks('points').findIndex(member => member.you) + 1;
const heading = (title, detail) => `<div class="page-heading"><h1>${title}</h1><p>${detail}</p></div>`;
const news = post => `<article class="news"><div class="label">${post.pinned ? 'Pinned · ' : ''}${esc(post.type)}</div><h3>${esc(post.title)}</h3><p class="content-line">${esc(post.body)}</p></article>`;
const stats = () => `<div class="stats">${[['✦', points(), 'Total points'], ['♜', '#' + rank(), 'Global rank'], ['◈', level(), 'Delegate level']].map(([icon, value, label]) => `<div class="card stat"><span class="icon" aria-hidden="true">${icon}</span><div><strong>${value}</strong><small>${label}</small></div></div>`).join('')}</div>`;
function home() {
  return `<section class="hero"><div class="hero-copy"><span class="eyebrow">MIU Model United Nations &amp; Arab League</span><h1>Welcome, ${esc(state.profile.name.split(/\s+/)[0])}.</h1><p>Follow club updates, prepare for committee, and see where you stand this week.</p><a class="button primary" href="#feed">Open club feed&nbsp; →</a></div><img class="hero-art" src="logo.jpg" alt="MIU Model United Nations and Arab League XIX emblem"></section>
  ${stats()}<div class="grid"><section class="card"><div class="section-head"><h2>Club updates</h2><a href="#feed">View feed →</a></div>${postOrder().slice(0, 2).map(news).join('') || '<p>No updates yet.</p>'}</section><section class="card"><div class="section-head"><h2>Weekly leaderboard</h2><a href="#fantasy">Full rankings →</a></div>${ranking('week', 3)}</section></div>
  <div class="shortcuts">${[['fantasy','♜','Fantasy','Explore the standings'], ['assistant','✧','MUN Assistant','Prepare for committee'], ['quiz','◈','Daily Quiz','Test your MUN knowledge']].map(([route, icon, title, subtitle]) => `<a class="card" href="#${route}"><span class="icon" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${subtitle}</small></span></a>`).join('')}</div>`;
}
const types = ['Announcement', 'Poll', 'Winners', 'General Update', 'Challenge'];
function poll(post) {
  const voted = state.votes[post.id];
  const total = post.votes.reduce((sum, count) => sum + count, 0);
  const results = voted !== undefined || can('posts')
    ? `<div class="result">${voted !== undefined ? 'Vote recorded ? ' : ''}${total} votes<ul>${post.options.map((choice, index) => `<li>${esc(choice)} ? ${Math.round(100 * post.votes[index] / (total || 1))}%${voted === index ? ' (your vote)' : ''}</li>`).join('')}</ul></div>` : '';
  if (voted !== undefined) return results;
  return results + `<form data-action="vote" data-id="${esc(post.id)}">${post.options.map((choice, index) => `<label class="choice"><input type="radio" name="choice" value="${index}" required>${esc(choice)}</label>`).join('')}<button class="primary">Cast vote</button></form>`;
}
function feed() {
  const posts = postOrder().filter(post => feedFilter === 'All' || post.type === feedFilter);
  return heading('Club Feed', 'Official announcements, polls and challenges from the board.') +
    `<div class="actions">${['All', ...types].map(type => `<button data-filter="${type}" aria-pressed="${type === feedFilter}" class="${type === feedFilter ? 'selected' : ''}">${type}</button>`).join('')}</div>
    <div class="stack">${posts.map(post => `<div class="card">${news(post)}${post.type === 'Poll' ? poll(post) : ''}</div>`).join('') || '<p>No posts in this category yet.</p>'}</div>`;
}
function pointHistory() {
  return `<ul class="ranking">${[...state.transactions].reverse().map(entry => `<li><span>${entry.amount > 0 ? '+' : ''}${entry.amount}</span><span>${esc(entry.reason)}<br><small>${esc(entry.date)} · ${esc(entry.by)}</small></span></li>`).join('')}</ul>`;
}
function fantasy() {
  return heading('Fantasy', 'Earn points through club activities and track the standings.') + stats() +
    `<div class="grid"><section class="card"><h2>Leaderboard</h2><div class="actions">${[['points','Global'],['week','Weekly'],['month','Monthly']].map(([id, label]) => `<button data-scope="${id}" aria-pressed="${scope === id}" class="${scope === id ? 'selected' : ''}">${label}</button>`).join('')}</div>${ranking(scope)}</section><section class="card"><div class="section-head"><h2>Points history</h2></div>${pointHistory()}</section></div>`;
}

function quiz() {
  const question = state.quiz;
  const result = question.result;
  return heading('Daily Quiz', 'Answer one MUN question each day and earn 3 points for a correct answer.') +
    `<section class="card"><span class="eyebrow">${esc(question.date)}</span><h2>${esc(question.question)}</h2>${result
      ? `<div class="result" role="status">${result.correct ? 'Correct. You earned 3 points.' : 'Correct answer: ' + esc(result.answer)} <p>${esc(result.explanation)}</p></div>`
      : `<form data-action="quiz" data-id="${question.id}">${question.options.map((option, index) => `<label class="choice"><input type="radio" name="choice" value="${index}" required>${esc(option)}</label>`).join('')}<button class="primary">Submit answer</button></form>`}</section>`;
}
const knowledge = [
  { title: 'Explain a political term', match: /sovereign|political term|charter/i, text: 'Sovereignty refers to a state’s authority to govern itself. The UN Charter recognizes the sovereign equality of all its members. In debate, connect the principle to the specific proposal your committee is considering.', source: 'https://www.un.org/en/about-us/un-charter/chapter-1' },
  { title: 'Research a country', match: /country|research|foreign policy/i, text: 'Start with your country’s permanent mission and statements at the UN. Find a resolution related to the issue, check the country’s vote and rationale, then note its priorities, partners and any relevant treaties.', source: 'https://www.un.org/en/about-us/member-states' },
  { title: 'Draft an opening speech', match: /speech|opening/i, text: 'Honourable Chair and fellow delegates, the delegation of [country] recognizes [specific issue]. Our delegation has supported [verified action]. We propose [concrete measure] and welcome cooperation on [shared goal].\nReplace the brackets with facts about your country and rehearse to fit the speaking time.', source: 'https://www.un.org/en/model-united-nations' },
  { title: 'Explain a MUN rule', match: /rule|motion|procedure|quorum|caucus|vot(e|ing)/i, text: 'A motion asks the committee to take a procedural action, such as suspending debate. The chair applies the conference rules to decide whether it is in order and how it is voted on. Check your conference handbook for its specific requirements.', source: 'https://www.un.org/en/ga/about/ropga/' },
  { title: 'Structure a resolution', match: /resolution|clause/i, text: 'List your committee, topic and sponsors. Use preambular clauses to establish context and numbered operative clauses to propose actions. Specify who implements each action and how it is supported.', source: 'https://www.un.org/en/model-united-nations' },
  { title: 'UN organs', match: /security council|general assembly|un (history|organs|bodies)|united nations/i, text: 'The UN has six principal organs. The General Assembly includes every Member State. The Security Council has primary responsibility for international peace and security.', source: 'https://www.un.org/en/about-us/main-bodies' },
  { title: 'Human rights', match: /human rights|udhr/i, text: 'The Universal Declaration of Human Rights was adopted by the UN General Assembly in 1948. Use its text to identify the articles relevant to your committee topic.', source: 'https://www.un.org/en/about-us/universal-declaration-of-human-rights' }
];
function assistant() {
  return heading('MUN Assistant', state.aiEnabled ? 'Ask about debate, research and procedure using the club library.' : 'Browse prepared answers and official sources while the AI service is being configured.') +
    `<section class="card"><div class="actions">${knowledge.slice(0, 5).map(item => `<button data-prompt="${item.title}">${item.title}</button>`).join('')}</div>
    <div aria-live="polite">${conversation.map(({ question, reply }) => `<div class="reply"><strong>${esc(question)}</strong><p>${esc(reply.text)}</p><a class="text-link" href="${safeUrl(reply.source)}">Official UN source ↗</a></div>`).join('')}</div>
    <form data-action="assistant"><label>Your question<input name="question" required maxlength="350" placeholder="How do I structure a draft resolution?"></label><button class="primary">Ask assistant</button></form></section>`;
}
async function ask(question) {
  if (state.aiEnabled) {
    conversation.push({ question, reply: await api("assistant", { question }) });
    return;
  }
  const reply = knowledge.find(item => item.title === question) || knowledge.find(item => item.match.test(question)) ||
    { text: 'I don’t have a prepared answer for that question. Try an official UN search or explore the club resource library.', source: 'https://www.un.org/en/' };
  conversation.push({ question, reply });
}
function resources() {
  return heading('Resources', 'Guides, templates and primary sources for committee preparation.') +
    `<div class="stack"><label>Search resources<input id="resource-search" type="search" placeholder="Try “position paper”"></label><p id="no-resources" hidden>No resources match your search.</p>${state.resources.map(item => `<article class="card resource"><div class="label">${esc(item.category)}</div><h2>${esc(item.title)}</h2><p class="content-line">${esc(item.body)}</p>${safeUrl(item.url) ? `<a class="text-link" href="${safeUrl(item.url)}">Open resource ↗</a>` : ''}</article>`).join('')}</div>`;
}
function profile() {
  const p = state.profile;
  return heading('My Profile', 'Manage your delegate details and review your club activity.') + stats() +
    `<div class="grid"><section class="card stack">${safeUrl(p.photo) ? `<img class="profile-photo" src="${safeUrl(p.photo)}" alt="Profile photo">` : ''}<div><h2>${esc(p.name)}</h2><p>Member · ${esc(p.committee)} · ${esc(p.position)}</p></div>
    <form data-action="profile"><label>Display name<input name="name" required maxlength="60" value="${esc(p.name)}"></label><label>Committee<input name="committee" maxlength="60" value="${esc(p.committee)}"></label><label>Position<input name="position" maxlength="60" value="${esc(p.position)}"></label><label>Profile photo URL<input name="photo" type="url" pattern="https://.+" value="${esc(p.photo)}"></label><button class="primary">Save profile</button></form></section>
    <section class="card stack"><h2>Achievements</h2><p>${points() >= 100 ? '✦ Rising Star · Reached 100 points' : 'Reach 100 points to unlock Rising Star.'}</p><h2>Participation history</h2>${pointHistory()}</section></div>`;
}

const can = permission => state.permissions.includes(permission);
function admin() {
  const intro = heading('Board Workspace', 'Manage club members, the feed, points and learning materials.');
  if (!state.permissions.length) return intro + '<div class="card"><p>This workspace is available to authorized board members.</p></div>';
  const editing = state.posts.find(post => post.id === editingPost);
  const postPanel = can('posts') ? `<section class="card stack"><h2>${editing ? 'Edit post' : 'Publish to Feed'}</h2><form id="post-editor" data-action="publish" data-id="${esc(editing?.id)}">
      <label>Type<select name="type">${types.map(type => `<option ${type === editing?.type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
      <label>Title<input name="title" maxlength="100" required value="${esc(editing?.title)}"></label><label>Message<textarea name="body" maxlength="1500" required>${esc(editing?.body)}</textarea></label>
      <label>Poll choices (one per line)<textarea name="options" maxlength="400">${esc(editing?.options.join('\n'))}</textarea></label><button class="primary">${editing ? 'Save changes' : 'Publish'}</button></form>${editing ? '<button data-cancel-edit>Cancel editing</button>' : ''}</section>
      <section class="card stack"><h2>Manage posts</h2>${postOrder().map(post => `<div><strong>${esc(post.title)}</strong><div class="actions"><button data-edit="${esc(post.id)}">Edit</button><button data-pin="${esc(post.id)}">${post.pinned ? 'Unpin' : 'Pin'}</button><button data-delete="${esc(post.id)}">Delete</button></div></div>`).join('') || '<p>No posts yet.</p>'}</section>` : '';
  const pointsPanel = can('points') ? `<section class="card stack"><h2>Adjust points</h2><form data-action="points" data-operation="${crypto.randomUUID()}"><label>Member<select name="member" required>${state.members.map(member => `<option value="${esc(member.id)}">${esc(member.name)}</option>`).join('')}</select></label><label>Adjustment<input type="number" name="amount" min="-100" max="100" required></label><label>Reason<input name="reason" maxlength="120" required></label><button class="primary">Record adjustment</button></form></section>` : '';
  const learningPanel = can('learning') ? `<section class="card stack"><h2>Add quiz question</h2><form data-action="add-quiz"><label>Question<input name="question" required maxlength="150"></label><label>Correct answer<input name="answer" required maxlength="100"></label><label>Other choices (one per line)<textarea name="options" required maxlength="300"></textarea></label><label>Explanation<input name="explanation" required maxlength="240"></label><button class="primary">Add to quiz bank</button></form></section>
    <section class="card stack"><h2>Add resource</h2><form data-action="resource"><label>Title<input name="title" required maxlength="100"></label><label>Category<input name="category" required maxlength="60"></label><label>Material<textarea name="body" required maxlength="3500"></textarea></label><label>Link<input type="url" name="url" maxlength="500"></label><button class="primary">Add resource</button></form></section>` : '';
  const memberPanel = can('members') ? `<section class="card stack"><h2>Members</h2><p>${state.members.length} active ? ${state.posts.length} posts</p>${state.boardMembers.filter(member => member.role !== 'President').map(member => `<form class="news" data-action="member" data-id="${esc(member.id)}"><h3>${esc(member.name)}</h3><p>${esc(member.email)}</p><label>Role<select name="role">${['Member', 'Head', 'Vice President', 'Assigned Admin'].map(role => `<option ${role === member.role ? 'selected' : ''}>${role}</option>`).join('')}</select></label><label>Status<select name="active"><option value="1" ${member.active ? 'selected' : ''}>Active</option><option value="0" ${member.active ? '' : 'selected'}>Inactive</option></select></label><button>Save member</button></form>`).join('') || '<p>No other members have signed in yet.</p>'}</section>` : '';
  return intro + `<div class="admin-grid">${postPanel}${pointsPanel}${learningPanel}${memberPanel}</div>`;
}
const views = { home, feed, fantasy, assistant, resources, quiz, profile, admin };
function render() {
  document.body.classList.toggle('signed-out', !state);
  if (!state) {
    content.innerHTML = `<section class="hero login"><div class="hero-copy"><span class="eyebrow">MIU Model United Nations &amp; Arab League</span><h1>Member portal</h1><p>Sign in to follow club updates, prepare for committee and take part in club activities.</p>${session.googleReady ? '<a class="button primary" href="/auth/google">Continue with Google</a>' : '<p role="status">' + esc(session.message || 'Google sign-in is awaiting setup.') + '</p>'}</div><img class="hero-art" src="logo.jpg" alt="MIU Model United Nations and Arab League XIX emblem"></section>`;
    return;
  }
  document.querySelector('[href="#admin"]').hidden = !state.permissions.length;
  const requested = location.hash.slice(1);
  const route = Object.hasOwn(views, requested) ? requested : 'home';
  document.querySelector('#crumb').textContent = 'Club portal / ' + pages[route];
  document.querySelector('#account-name').textContent = state.profile.name;
  document.querySelector('#initials').textContent = state.profile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  document.querySelectorAll('.sidebar a').forEach(link => {
    if (link.hash === '#' + route && !link.classList.contains('brand')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  content.innerHTML = views[route]() + (notice ? `<div class="notice" role="status">${esc(notice)}</div>` : '');
  notice = '';
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
content.addEventListener('input', event => {
  if (event.target.id !== 'resource-search') return;
  const query = event.target.value.trim().toLowerCase();
  const cards = [...content.querySelectorAll('.resource')];
  cards.forEach(card => { card.hidden = !card.textContent.toLowerCase().includes(query); });
  document.querySelector('#no-resources').hidden = cards.some(card => !card.hidden);
});

async function api(action, fields) {
  const response = await fetch('/api/' + action, fields === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
  });
  const payload = await response.json();
  if (response.status === 401 && action !== 'session') {
    state = undefined;
    session = { googleReady: true };
    render();
  }
  if (!response.ok) throw Error(payload.error || 'Unable to complete this request.');
  return payload;
}
async function loadSession() {
  try {
    session = await api('session');
    state = session.data;
  } catch {
    session = { message: 'Start the portal server to connect to Google sign-in.' };
  }
  render();
}
async function perform(control, operation) {
  if (busy) return;
  busy = true;
  control.disabled = true;
  try {
    await operation();
    render();
  } catch (error) {
    content.querySelector('.notice')?.remove();
    const message = document.createElement('p');
    message.className = 'notice';
    message.setAttribute('role', 'alert');
    message.textContent = error.message;
    control.closest('form')?.append(message);
    if (!message.isConnected) content.append(message);
  } finally {
    control.disabled = false;
    busy = false;
  }
}
async function update(action, fields) {
  const result = await api(action, fields);
  state = result.data;
  notice = result.message;
}
document.querySelector('#logout').addEventListener('click', event => perform(event.currentTarget, async () => {
  await api('logout', {});
  state = undefined;
  session = { googleReady: true };
  conversation = [];
  editingPost = '';
  history.replaceState(null, '', '/');
}));
content.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!state || !button || button.form || busy) return;
  const { filter, scope: period, prompt, edit, cancelEdit, pin, delete: remove } = button.dataset;
  if (filter) feedFilter = filter;
  if (period) scope = period;
  if (prompt) return perform(button, () => ask(prompt));
  if (edit) {
    editingPost = edit;
    render();
    document.querySelector('#post-editor [name="title"]').focus();
    return;
  }
  if (cancelEdit !== undefined) editingPost = '';
  if (pin) return perform(button, () => update('pin', { id: pin }));
  if (remove && confirm('Delete this post?')) return perform(button, () => update('delete', { id: remove }));
  render();
});
content.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  const fields = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
  const action = form.dataset.action;
  if (form.dataset.id) fields.id = form.dataset.id;
  if (form.dataset.operation) fields.operation = form.dataset.operation;
  if (action === 'quiz') fields.date = state.quiz.date;
  perform(form.querySelector('button'), async () => {
    if (action === 'assistant') return ask(fields.question);
    await update(action, fields);
    if (action === 'publish') editingPost = '';
  });
});
loadSession();
