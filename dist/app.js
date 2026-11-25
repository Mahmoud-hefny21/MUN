const content = document.querySelector('#content');

const pages = { home: 'Overview', feed: 'Club Feed', fantasy: 'Fantasy', assistant: 'MUN Assistant', resources: 'Resources', quiz: 'Daily Quiz', profile: 'My Profile', admin: 'Board Workspace', notifications: 'Inbox', menu: 'Menu' };
// Mobile dock tabs; pages without their own tab highlight Menu.
const dockTab = { home: 'home', feed: 'feed', fantasy: 'fantasy', quiz: 'quiz' };
let camera = null;
let photoDraft = '';
let state;
let session = {};
let editingPost = '';
let editingResource = '';
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
// First and last name only, so long four-part names fit on one line.
// Keeps compound family names together: "Abdel Aziz", "El Naggar", "Abd El Rahman".
const nameParticles = new Set(['abd', 'abdel', 'abdul', 'abdal', 'el', 'al', 'abu', 'abou', 'bin', 'ibn', 'ben']);
const shortName = name => {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length <= 2) return parts.join(' ');
  let start = parts.length - 1;
  while (start > 1 && nameParticles.has(parts[start - 1].toLowerCase())) start--;
  return [parts[0], ...parts.slice(start)].join(' ');
};
const isPdf = url => /\.pdf($|\?)/i.test(url || '') || /res\.cloudinary\.com\/[^/]+\/raw\/upload\//.test(url || '');
// Uploaded PDFs open through the server (signed, members only); other links open directly.
const resourceHref = item => /^https:\/\/res\.cloudinary\.com\/[^/]+\/raw\/upload\//.test(item.url || '') ? '/api/resource-file?id=' + encodeURIComponent(item.id) : safeUrl(item.url);
const icon = id => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const initials = name => esc(name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase());
const avatar = (p, size = '') => safeUrl(p.photo)
  ? `<img class="avatar ${size}" src="${safeUrl(p.photo)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="avatar ${size}" aria-hidden="true">${initials(p.name)}</span>`;

function ranks(period) {
  return state.members.map(member => ({ name: member.name, score: member[period] || 0, you: member.id === state.profile.id }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
const ranking = (period, limit) => `<ol class="ranking">${ranks(period).slice(0, limit).map((member, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><span>${esc(shortName(member.name))}${member.you ? ' · You' : ''}</span><strong>${member.score} pts</strong></li>`).join('')}</ol>`;
const rank = () => ranks('points').findIndex(member => member.you) + 1;
const heading = (title, detail) => `<div class="page-heading"><h1>${title}</h1><p>${detail}</p></div>`;
const news = post => `<article class="news"><div class="label">${post.pinned ? 'Pinned · ' : ''}${esc(post.type)}</div><h3>${esc(post.title)}</h3><p class="content-line">${esc(post.body)}</p></article>`;
const stats = () => `<div class="stats">${[['star', points(), 'Total points'], ['chart', '#' + rank(), 'Global rank'], ['shield', level(), 'Delegate level']].map(([symbol, value, label]) => `<div class="card stat"><span class="icon">${icon(symbol)}</span><div><strong>${value}</strong><small>${label}</small></div></div>`).join('')}</div>`;
const clubTime = time => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(time));
const activitiesList = entries => entries.map(item => `<p class="news"><strong>${esc(item.title)}</strong> · ${esc(item.kind)} · ${esc(clubTime(item.starts_at))} Cairo</p>`).join('');
function home() {
  return `<section class="hero"><div class="hero-copy"><span class="eyebrow">MIU Model United Nations &amp; Arab League</span><h1>Welcome, ${esc(state.profile.name.split(/\s+/)[0])}.</h1><p>Follow club updates, prepare for committee, and see where you stand this week.</p><a class="button primary" href="#feed">Open club feed&nbsp; →</a></div><img class="hero-art" src="logo.jpg" alt="MIU Model United Nations and Arab League XIX emblem"></section>
  ${stats()}<div class="grid"><section class="card"><div class="section-head"><h2>Club updates</h2><a href="#feed">View feed →</a></div>${postOrder().slice(0, 2).map(news).join('') || '<p>No updates yet.</p>'}</section><section class="card"><div class="section-head"><h2>Weekly leaderboard</h2><a href="#fantasy">Full rankings →</a></div>${ranking('week', 3)}</section></div>
  <section class="card upcoming"><div class="section-head"><h2>Upcoming activities</h2></div>${activitiesList(state.activities) || "<p>No upcoming activities.</p>"}</section><div class="shortcuts">${[['fantasy','trophy','Fantasy','Explore the standings'], ['assistant','spark','MUN Assistant','Prepare for committee'], ['quiz','quiz','Daily Quiz','Test your MUN knowledge']].map(([route, symbol, title, subtitle]) => `<a class="card" href="#${route}"><span class="icon">${icon(symbol)}</span><span><strong>${title}</strong><small>${subtitle}</small></span></a>`).join('')}</div>`;
}
const types = ['Announcement', 'Poll', 'Winners', 'General Update', 'Challenge'];
// Poll results as bars; widths are applied after render (data-pct) because the CSP blocks inline styles.
function pollResults(post, voted) {
  const total = post.votes.reduce((sum, count) => sum + count, 0);
  return `<div class="poll-results">${post.options.map((choice, index) => {
    const pct = Math.round(100 * post.votes[index] / (total || 1));
    return `<div class="poll-bar${voted === index ? ' mine' : ''}"><span class="fill" data-pct="${pct}"></span><span class="poll-label">${esc(choice)}${voted === index ? ' ✓' : ''}</span><span class="poll-pct">${pct}%</span></div>`;
  }).join('')}<p class="poll-total">${total} ${total === 1 ? 'vote' : 'votes'}${voted !== undefined ? ' · Vote recorded' : ''}</p></div>`;
}
function poll(post) {
  const voted = state.votes[post.id];
  if (voted !== undefined) return pollResults(post, voted);
  const total = post.votes.reduce((sum, count) => sum + count, 0);
  return `<form data-action="vote" data-id="${esc(post.id)}">${post.options.map((choice, index) => {
    const pct = Math.round(100 * (post.votes[index] || 0) / (total || 1));
    return `<label class="choice poll-choice"><span class="fill" data-pct="${pct}"></span><input type="radio" name="choice" value="${index}" required><span class="poll-label">${esc(choice)}</span><span class="poll-pct">${pct}%</span></label>`;
  }).join('')}<p class="poll-total">${total} ${total === 1 ? 'vote' : 'votes'} so far</p><button class="primary">Cast vote</button></form>`;
}
const postIcons = { Announcement: 'bell', Poll: 'chart', Winners: 'trophy', 'General Update': 'feed', Challenge: 'star' };
const timeAgo = value => {
  const time = Number(value);
  if (!time) return '';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + 'm ago';
  if (minutes < 1440) return Math.round(minutes / 60) + 'h ago';
  if (minutes < 10080) return Math.round(minutes / 1440) + 'd ago';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' }).format(new Date(time));
};
const postCard = post => `<article class="card post${post.pinned ? ' pinned' : ''}"><header class="post-head"><span class="post-type">${icon(postIcons[post.type] || 'feed')}${esc(post.type)}</span>${post.pinned ? '<span class="post-pin">Pinned</span>' : ''}<time>${timeAgo(post.created)}</time></header>
  <h3>${esc(post.title)}</h3><p class="content-line">${esc(post.body)}</p>${post.type === 'Poll' ? poll(post) : ''}</article>`;
function feed() {
  const posts = postOrder().filter(post => feedFilter === 'All' || post.type === feedFilter);
  return heading('Club Feed', 'Official announcements, polls and challenges from the board.') +
    `<div class="filter-row" role="toolbar" aria-label="Filter posts">${['All', ...types].map(type => `<button data-filter="${type}" aria-pressed="${type === feedFilter}" class="${type === feedFilter ? 'selected' : ''}">${type}</button>`).join('')}</div>
    <div class="stack">${posts.map(postCard).join('') || `<div class="card empty">${icon('feed')}<p>No ${feedFilter === 'All' ? '' : esc(feedFilter.toLowerCase()) + ' '}posts yet.</p></div>`}</div>`;
}
function pointHistory() {
  if (!state.transactions.length) return '<p>No points yet. Answer the daily quiz and join club activities to earn points.</p>';
  return `<ul class="ranking">${[...state.transactions].reverse().map(entry => `<li><span>${entry.amount > 0 ? '+' : ''}${entry.amount}</span><span>${esc(entry.reason)}<br><small>${esc(entry.date)} · ${esc(entry.by)}</small></span></li>`).join('')}</ul>`;
}
function fantasy() {
  return heading('Fantasy', 'Earn points through club activities and track the standings.') + stats() +
    `<div class="grid"><section class="card"><h2>Leaderboard</h2><div class="actions">${[['points','Global'],['week','Weekly'],['month','Monthly']].map(([id, label]) => `<button data-scope="${id}" aria-pressed="${scope === id}" class="${scope === id ? 'selected' : ''}">${label}</button>`).join('')}</div>${ranking(scope)}</section><section class="card"><div class="section-head"><h2>Points history</h2></div>${pointHistory()}</section></div>`;
}

function quiz() {
  const question = state.quiz;
  const result = question.result;
  const intro = heading('Daily Quiz', 'Answer the question scheduled for today.');
  if (!question.id && !result) return intro + '<div class="card"><p>No quiz is scheduled for today.</p></div>';
  return intro +
    `<section class="card"><span class="eyebrow">${esc(question.date)}</span><h2>${esc(question.question || 'Completed quiz')}</h2>${result
      ? `<div class="result" role="status">${result.correct ? question.reward ? 'Correct. You earned ' + question.reward + ' points.' : 'Correct.' : 'Correct answer: ' + esc(result.answer)} <p>${esc(result.explanation)}</p>${safeUrl(result.sourceUrl) ? `<a class="text-link" href="${safeUrl(result.sourceUrl)}">Read the source →</a>` : ''}</div>`
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
// Minimal, escape-first Markdown for assistant replies: paragraphs, bullet/numbered lists, **bold**, ### headings.
function formatReply(text) {
  const inline = line => esc(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  let html = '', list = '';
  const close = () => { if (list) { html += `</${list}>`; list = ''; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) { close(); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)/), numbered = line.match(/^\d+[.)]\s+(.*)/), title = line.match(/^#{1,4}\s+(.*)/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { close(); html += `<${kind}>`; list = kind; }
      html += `<li>${inline((bullet || numbered)[1])}</li>`;
    } else {
      close();
      if (title) html += `<p><strong>${inline(title[1])}</strong></p>`;
      else if (line) html += `<p>${inline(line)}</p>`;
    }
  }
  close();
  return html;
}
const suggestions = ['Explain the rules of procedure', 'Write an opening speech for Egypt', 'How do I write a position paper?', 'What is a moderated caucus?'];
function assistant() {
  const ai = state.aiEnabled;
  const intro = conversation.length ? '' : `<div class="chat-empty"><span class="chat-avatar">${icon('spark')}</span><h2>How can I help you prepare?</h2><p>${ai ? 'Ask about debate, MUN procedure, any country’s foreign policy, speeches or resolutions — in Arabic or English.' : 'Search the club library and read prepared guidance with sources.'}</p>
    <div class="chips">${(ai ? suggestions : knowledge.slice(0, 5).map(item => item.title)).map(text => `<button data-prompt="${esc(text)}">${esc(text)}</button>`).join('')}</div></div>`;
  const log = conversation.map(({ question, reply }, index) => `<div class="msg user"><p>${esc(question)}</p></div>
    <div class="msg bot">${reply ? `${formatReply(reply.text)}
      ${safeUrl(reply.source) ? `<a class="text-link" href="${safeUrl(reply.source)}">Official UN source ↗</a>` : ''}
      ${(reply.sources || []).map(source => `<div class="source">${source.number ? `<span>[${source.number}]</span> ` : ''}<strong>${esc(source.title)}</strong>${source.excerpt ? `<p>${esc(source.excerpt)}</p>` : ''}${safeUrl(source.url) ? ` <a class="text-link" href="${safeUrl(source.url)}">Open ↗</a>` : ''}</div>`).join('')}
      <button class="copy" data-copy="${index}">Copy</button>` : '<p class="typing" role="status">Thinking<span>.</span><span>.</span><span>.</span></p>'}</div>`).join('');
  return `<div class="chat"><div class="chat-head"><div><h1>MUN Assistant</h1><p>${ai ? 'Powered by AI · check important facts' : 'Club library'}</p></div>${conversation.length ? '<button data-new-chat>New chat</button>' : ''}</div>
    ${intro}<div class="chat-log" aria-live="polite">${log}</div>
    <form class="chat-form" data-action="assistant"><label class="sr-only" for="chat-input">Your question</label><textarea id="chat-input" name="question" required maxlength="1000" rows="1" placeholder="Ask the MUN Assistant…"></textarea><button class="primary send" aria-label="Ask assistant">${icon('send')}</button></form></div>`;
}
async function ask(question) {
  const entry = { question, reply: null };
  conversation.push(entry);
  render();
  scrollChat();
  try {
    if (state.aiEnabled) {
      const history = conversation.slice(0, -1).filter(turn => turn.reply).map(turn => ({ question: turn.question, answer: turn.reply.text }));
      entry.reply = await api('assistant', { question, history });
    } else {
      const prepared = knowledge.find(item => item.title === question) || knowledge.find(item => item.match.test(question));
      const matches = await api('assistant/library', { question });
      entry.reply = prepared ? { ...matches, ...prepared } : matches;
    }
  } catch (error) {
    conversation.pop();
    render();
    const input = content.querySelector('#chat-input');
    if (input) input.value = question;
    throw error;
  }
}
function scrollChat() {
  requestAnimationFrame(() => content.querySelector('.chat-log')?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
}
function resources() {
  return heading('Resources', 'Guides, templates and primary sources for committee preparation.') +
    `<div class="stack"><label>Search resources<input id="resource-search" type="search" placeholder="Try “position paper”"></label><p id="no-resources" hidden>No resources match your search.</p>${state.resources.map(item => `<article class="card resource"><div class="label">${esc(item.category)}</div><h2>${esc(item.title)}</h2><p class="content-line">${esc(item.body)}</p>${safeUrl(item.url) ? `<a class="${isPdf(item.url) ? 'button pdf-link' : 'text-link'}" href="${resourceHref(item)}" target="_blank" rel="noopener">${isPdf(item.url) ? icon('book') + ' Open PDF' : 'Open resource ↗'}</a>` : ''}</article>`).join('')}</div>`;
}
function profile() {
  const p = state.profile;
  return heading('My Profile', 'Manage your delegate details and review your club activity.') + stats() +
    `<div class="grid"><section class="card stack">${photoEditor(p)}<div><h2>${esc(shortName(p.name))}</h2><p>${[p.role, p.committee, p.position].filter(Boolean).map(esc).join(' · ')}</p></div>
    <form data-action="profile"><label>Display name<input name="name" required maxlength="60" value="${esc(p.name)}"></label><input type="hidden" name="photo" value="${esc(p.photo)}"><button class="primary">Save name</button></form></section>
    <section class="card stack"><h2>Achievements</h2>${state.permissions.length ? '<a class="button" href="#admin">Board workspace</a>' : ''}<p>${points() >= 100 ? '✦ Rising Star · Reached 100 points' : 'Reach 100 points to unlock Rising Star.'}</p><h2>Attendance</h2>${activitiesList(state.attendance) || "<p>No attendance has been recorded.</p>"}<h2>Points history</h2>${pointHistory()}</section></div>`;
}
function photoEditor(p) {
  const preview = camera
    ? '<video id="camera" class="avatar xl" autoplay playsinline muted aria-label="Camera preview"></video>'
    : photoDraft ? `<img class="avatar xl" src="${photoDraft}" alt="New profile photo preview">` : avatar(p, 'xl');
  let controls;
  if (!state.photoUpload) controls = '<p>Photo uploads will be available once the board connects image storage.</p>';
  else if (camera) controls = `<button class="primary" data-photo="capture">${icon('camera')} Capture</button><button data-photo="cancel">Cancel</button>`;
  else if (photoDraft) controls = `<button class="primary" data-photo="save">Save photo</button><button data-photo="cancel">Discard</button>`;
  else controls = `<button data-photo="camera">${icon('camera')} Take photo</button><button data-photo="upload">${icon('upload')} Upload photo</button>${p.photo ? '<button data-photo="remove">Remove</button>' : ''}`;
  return `<div class="photo-editor">${preview}<div class="actions">${controls}</div><input id="photo-file" type="file" accept="image/*" hidden></div>`;
}
function menu() {
  const p = state.profile;
  const row = (href, symbol, title, detail) => `<a class="menu-row" href="${href}"><span class="icon">${icon(symbol)}</span><span><strong>${title}</strong><small>${detail}</small></span>${icon('chevron')}</a>`;
  return heading('Menu', 'Your account and more club tools.') +
    `<a class="card menu-profile" href="#profile">${avatar(p, 'lg')}<span><strong>${esc(shortName(p.name))}</strong><small>${[p.role, p.committee].filter(Boolean).map(esc).join(' · ')}</small></span>${icon('chevron')}</a>
    <div class="card menu-list">${row('#profile', 'user', 'My Profile', 'Photo, name and achievements')}${row('#assistant', 'spark', 'MUN Assistant', 'Prepare for committee')}${row('#resources', 'book', 'Resources', 'Guides, templates and sources')}${row('#notifications', 'bell', 'Inbox', state.unreadNotifications ? state.unreadNotifications + ' unread' : 'Notifications and push')}${state.permissions.length ? row('#admin', 'shield', 'Board workspace', 'Manage the club') : ''}</div>
    ${munInstall.standalone() ? '' : `<button class="menu-install" data-install>${icon('download')} Install app &amp; notifications</button>`}
    <button class="signout" data-signout>${icon('logout')} Sign out</button>`;
}
// Center-crop any image source to a 512px square JPEG so uploads stay small.
function squarePhoto(source, width, height) {
  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  canvas.getContext('2d').drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 512, 512);
  return canvas.toDataURL('image/jpeg', 0.85);
}
function stopCamera() {
  camera?.getTracks().forEach(track => track.stop());
  camera = null;
}

// Notifications: one shared enable flow, used by the buttons and by autoPush.
let enabling = null;
function enablePush() {
  enabling ||= (async () => {
    if (!munPush.isReady()) await munPush.prepare();
    await munPush.optIn();
    state.pushPreference = await api('push/preference', { enabled: true });
    if (document.querySelector('#welcome')) showWelcome(true);
  })().finally(() => { enabling = null; });
  return enabling;
}
// Ask for notification permission as soon as a member is signed in. Browsers that require a tap
// (Safari, and Chrome in some cases) get the prompt on the member's first tap instead.
let pushAutoTried = false;
async function autoPush() {
  // Subscriptions belong to one origin: after a domain move, an account with push on still needs this browser subscribed.
  if (pushAutoTried || !state?.pushPreference || (state.pushPreference.enabled && localStorage.getItem('mun-push-browser'))) return;
  if (!('Notification' in window) || Notification.permission === 'denied') return;
  if (munInstall.ios && !munInstall.standalone()) return;
  pushAutoTried = true;
  try { await munPush.prepare(); } catch { return; }
  try { await enablePush(); }
  catch { document.addEventListener('pointerup', () => { if (state) enablePush().catch(() => {}); }, { once: true, capture: true }); }
}

// First-visit welcome sheet: one tap to install the app and one to turn on notifications.
const welcomeKey = 'mun-welcome-v1';
const pushAvailable = () => Boolean(state?.pushPreference);
function installStep() {
  if (munInstall.standalone()) return `<p class="step-done">${icon('quiz')} App installed</p>`;
  if (munInstall.canPrompt()) return `<button class="primary" data-welcome="install">${icon('download')} Install app</button>`;
  if (munInstall.ios) return `<p class="hint">In Safari, tap <strong>Share</strong> ${icon('share')} then <strong>Add to Home Screen</strong>.</p>`;
  return '<p class="hint">Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>';
}
function pushStep() {
  if (!pushAvailable()) return '<p class="hint">Notifications will be available soon.</p>';
  if (state.pushPreference.enabled) return `<p class="step-done">${icon('quiz')} Notifications on</p>`;
  if (munInstall.ios && !munInstall.standalone()) return '<p class="hint">On iPhone, install the app first, then open it from your Home Screen to turn on notifications.</p>';
  return `<button class="primary" data-welcome="push">${icon('bell')} Turn on notifications</button>`;
}
function showWelcome(force = false) {
  if (!state || (!force && localStorage.getItem(welcomeKey))) return;
  if (!force && munInstall.standalone() && (!pushAvailable() || state.pushPreference.enabled)) return localStorage.setItem(welcomeKey, '1');
  if (pushAvailable() && !state.pushPreference.enabled) munPush.prepare().catch(() => {});
  let sheet = document.querySelector('#welcome');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'welcome';
    sheet.className = 'sheet-backdrop';
    document.body.append(sheet);
  }
  sheet.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <img src="/logo.jpg" width="64" height="64" alt=""><h2 id="welcome-title">Welcome to MIU MUN</h2><p>Get the full app experience in two taps.</p>
    <div class="step"><span class="icon">${icon('download')}</span><div><strong>Add to your Home Screen</strong><small>Open the portal like an app, full screen.</small>${installStep()}</div></div>
    <div class="step"><span class="icon">${icon('bell')}</span><div><strong>Get notified</strong><small>New posts, quizzes, points and events.</small>${pushStep()}</div></div>
    <p class="notice" id="welcome-status" role="status" hidden></p>
    <button class="sheet-close" data-welcome="close">Done</button></section>`;
  sheet.querySelector('[data-welcome]')?.focus();
}
function closeWelcome() {
  localStorage.setItem(welcomeKey, '1');
  document.querySelector('#welcome')?.remove();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-welcome]');
  if (!button) {
    if (event.target.id === 'welcome') closeWelcome();
    return;
  }
  const step = button.dataset.welcome;
  if (step === 'close') return closeWelcome();
  const status = document.querySelector('#welcome-status');
  button.disabled = true;
  try {
    if (step === 'install') await munInstall.prompt();
    if (step === 'push') await enablePush();
    showWelcome(true);
  } catch (error) {
    status.hidden = false;
    status.textContent = error.message;
    button.disabled = false;
  }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('#welcome')) closeWelcome(); });

const can = permission => state.permissions.includes(permission);
// Points history: members matching a name search, and one member's full history rendered into a box.
const scopedMembers = () => state.scope ? state.members.filter(item => item.committee === state.scope) : state.members;
const historyMatches = query => {
  const q = query.trim().toLowerCase();
  const list = [...scopedMembers()].filter(item => !q || item.name.toLowerCase().includes(q))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, q ? 12 : 6);
  return list.map(item => `<button class="pick" data-history="${esc(item.id)}"><span>${esc(item.name)}</span><span class="count">${item.points} pts</span></button>`).join('')
    || '<p class="hint">No member matches that name.</p>';
};
async function showHistory(button) {
  const box = button.closest('.member-row') ? openModal('Points history').querySelector('.modal-body') : content.querySelector('#points-history');
  if (!box) return;
  content.querySelectorAll('.pick.selected').forEach(item => item.classList.remove('selected'));
  if (button.classList.contains('pick')) button.classList.add('selected');
  box.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const { member, transactions } = await api('points-history', { member: button.dataset.history });
    const total = transactions.reduce((sum, entry) => sum + entry.amount, 0);
    box.innerHTML = `<div class="history-head"><strong>${esc(member.name)}</strong><span class="count">${total} pts total</span></div><small class="hint">${[member.committee, member.position].filter(Boolean).map(esc).join(' · ')}</small>` +
      (transactions.length ? `<ul class="ranking">${transactions.map(entry => `<li><span class="${entry.amount > 0 ? 'plus' : 'minus'}">${entry.amount > 0 ? '+' : ''}${entry.amount}</span><span>${esc(entry.reason)}<br><small>${esc(entry.date)} · ${esc(entry.by)}</small></span></li>`).join('')}</ul>` : '<p>No points recorded for this member yet.</p>');
  } catch (error) { box.innerHTML = `<p class="notice">${esc(error.message)}</p>`; }
}
// Small popup used for details that would otherwise make the page long.
function openModal(title) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.id = 'modal';
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<section class="sheet modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="modal-close" data-close-modal aria-label="Close">✕</button></div><div class="modal-body history-box" aria-live="polite"></div></section>`;
  document.body.append(backdrop);
  backdrop.querySelector('[data-close-modal]').focus();
  return backdrop;
}
function closeModal() { document.querySelector('#modal')?.remove(); }
document.addEventListener('click', event => {
  if (event.target.id === 'modal' || event.target.closest('[data-close-modal]')) closeModal();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
function admin() {
  const intro = `<a class="back-link" href="#menu">${icon('chevron')} Back</a>` + heading('Board Workspace', 'Manage club members, the feed, points and learning materials.');
  if (!state.permissions.length) return intro + '<div class="card"><p>This workspace is available to authorized board members.</p></div>';
  const editing = state.posts.find(post => post.id === editingPost);
  const postPanel = can('posts') ? `<section class="card stack"><h2>${editing ? 'Edit post' : 'Publish to Feed'}</h2><form id="post-editor" data-action="publish" data-id="${esc(editing?.id)}">
      <label>Type<select name="type">${types.map(type => `<option ${type === editing?.type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
      ${state.profile.role === 'Head' ? '<p>Audience: ' + esc(state.profile.committee) + '</p>' : `<label>Audience<select name="committee"><option value="">Entire club</option>${state.committees.map(item => `<option ${item.name === editing?.committee ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>`}
      <label>Title<input name="title" maxlength="100" required value="${esc(editing?.title)}"></label><label>Message<textarea name="body" maxlength="1500" required>${esc(editing?.body)}</textarea></label>
      <label>Poll choices (one per line)<textarea name="options" maxlength="400">${esc(editing?.options.join('\n'))}</textarea></label><button class="primary">${editing ? 'Save changes' : 'Publish'}</button></form>${editing ? '<button data-cancel-edit>Cancel editing</button>' : ''}</section>
      <section class="card stack"><h2>Manage posts</h2>${postOrder().filter(post => post.manageable).map(post => `<div class="list-row"><span class="list-main"><strong>${esc(post.title)}</strong><small>${esc(post.type)}${post.pinned ? ' · Pinned' : ''} · ${timeAgo(post.created)}</small></span><span class="row-actions"><button data-edit="${esc(post.id)}">Edit</button><button data-pin="${esc(post.id)}">${post.pinned ? 'Unpin' : 'Pin'}</button><button class="danger" data-delete="${esc(post.id)}">Delete</button></span></div>`).join('') || '<p>No posts yet.</p>'}</section>` : '';
  const pointsPanel = can('points') ? `<section class="card stack"><h2>Adjust points</h2><form data-action="points" data-operation="${crypto.randomUUID()}"><label>Member<select name="member" required>${scopedMembers().map(member => `<option value="${esc(member.id)}">${esc(member.name)}</option>`).join('')}</select></label><label>Adjustment<input type="number" name="amount" min="-100" max="100" required></label><label>Reason<input name="reason" maxlength="120" required></label><button class="primary">Record adjustment</button></form></section>
    <section class="card stack"><h2>Member points history</h2><p class="hint">Search any member to see every point they earned or lost, and who recorded it.</p><input id="history-search" type="search" placeholder="Search a member by name" aria-label="Search a member by name" autocomplete="off"><div id="history-results" class="pick-list">${historyMatches('')}</div><div id="points-history" class="history-box" aria-live="polite"></div></section>` : '';
  const learningPanel = can('learning') ? `<section class="card stack"><h2>Add quiz question</h2><form data-action="add-quiz"><label>Question<input name="question" required maxlength="150"></label><label>Correct answer<input name="answer" required maxlength="100"></label><label>Other choices (one per line)<textarea name="options" required maxlength="300"></textarea></label><label>Explanation<input name="explanation" required maxlength="240"></label><button class="primary">Add to quiz bank</button></form></section>
    <section class="card stack"><h2>Schedule a quiz</h2>${state.quizBank.length ? `<form data-action="schedule-quiz"><label>Question<select name="question" required>${state.quizBank.map(item => `<option value="${item.id}">${esc(item.question)}</option>`).join('')}</select></label><label>Cairo date<input type="date" name="date" min="${esc(state.quiz.date)}" required></label><label>Reward<select name="reward"><option>0</option><option>2</option><option selected>3</option><option>4</option><option>5</option></select></label><label>Source URL<input type="url" name="source" required maxlength="500"></label><button class="primary">Schedule quiz</button></form>` : '<p>Add a question to the quiz bank before scheduling.</p>'}</section>
` : '';
  // Resources tab: add, edit and delete; attach your own PDF (uploaded to Cloudinary) or link to a page.
  const editingRes = state.resources.find(item => String(item.id) === String(editingResource));
  const resourcePanel = can('learning') ? `<section class="card stack"><h2>${editingRes ? 'Edit resource' : 'Add resource'}</h2>
      <form id="resource-editor" data-action="${editingRes ? 'resource-update' : 'resource'}" data-id="${esc(editingRes?.id)}">
      <label>Title<input name="title" required maxlength="100" value="${esc(editingRes?.title)}"></label>
      <label>Category<input name="category" required maxlength="60" value="${esc(editingRes?.category)}" placeholder="e.g. Study guide, Rules, Template"></label>
      <label>Description<textarea name="body" required maxlength="3500" placeholder="What is it and when should members use it?">${esc(editingRes?.body)}</textarea></label>
      <label>PDF file<input id="resource-file" type="file" accept="application/pdf,.pdf"></label>
      <p class="hint">Upload your own PDF (up to 10 MB)${editingRes?.url ? ' to replace the current file or link' : ''}, or paste a link instead.</p>
      <label>Link<input type="url" name="url" maxlength="500" value="${esc(editingRes?.url)}" placeholder="https://…"></label>
      <button class="primary">${editingRes ? 'Save changes' : 'Add resource'}</button></form>${editingRes ? '<button data-cancel-resource>Cancel editing</button>' : ''}</section>
    <section class="card stack"><div class="section-head"><h2>All resources</h2><span class="count">${state.resources.length}</span></div>
      ${state.resources.map(item => `<div class="list-row"><span class="list-main"><strong>${esc(item.title)}</strong><small>${esc(item.category)}${isPdf(item.url) ? ' · PDF' : item.url ? ' · Link' : ''}</small></span><span class="row-actions"><button data-edit-resource="${esc(item.id)}">Edit</button><button class="danger" data-delete-resource="${esc(item.id)}">Delete</button></span></div>`).join('') || '<p>No resources yet.</p>'}</section>` : '';
  // Members directory: everyone from the club roster plus anyone who signed in.
  const fullAccess = role => ['President', 'Co-President'].includes(role);
  const committeeOptions = selected => '<option value="">Unassigned</option>' + state.committees.map(item => `<option ${item.name === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const roleOptions = selected => state.boardRoles.map(role => `<option ${role === selected ? 'selected' : ''}>${esc(role)}</option>`).join('');
  const directory = state.boardDirectory || [];
  const accessLabels = { members: 'Members & roles', posts: 'Feed & polls', points: 'Points', learning: 'Quiz & resources', activities: 'Activities' };
  const accessChips = role => (state.boardRoleAccess?.[role] || []).map(key => `<span class="chip">${accessLabels[key] || esc(key)}</span>`).join('') || '<span class="chip off">No admin access</span>';
  const personStatus = person => !person.active ? ['Removed', 'off'] : person.signed_in ? ['Signed in', 'on'] : ['Not signed in yet', 'wait'];
  const memberRow = person => {
    const [status, tone] = personStatus(person);
    // The President can edit Co-Presidents; nobody edits the President from the app.
    const locked = person.role === 'President' || (person.role === 'Co-President' && state.profile.role !== 'President');
    const detail = (label, value) => `<div><dt>${label}</dt><dd>${esc(value) || '—'}</dd></div>`;
    return `<details class="member-row" data-search="${esc((person.name + ' ' + person.email + ' ' + person.position).toLowerCase())}" data-committee="${esc(person.committee)}"><summary>${avatar(person)}<span class="list-main"><strong>${esc(shortName(person.name))}</strong><small>${esc(person.committee || 'No committee')}${person.position ? ' · ' + esc(person.position) : ''}</small></span><span class="dot ${tone}" title="${status}"></span><span class="badge${fullAccess(person.role) ? ' board' : ''}">${esc(fullAccess(person.role) ? 'Full access' : person.role)}</span>${icon('chevron')}</summary>
      <dl class="member-details">${detail('Full name', person.name)}${detail('Email', person.email)}${detail('Committee', person.committee)}${detail('Position', person.position)}${detail('Role', person.role)}${detail('Status', status)}</dl>
      ${locked ? '<p class="hint">Full-access account. Only the President can change it.</p>' : `<form class="member-form" data-action="directory-save"><input type="hidden" name="email" value="${esc(person.email)}"><div class="form-grid"><label>Full name<input name="name" required maxlength="60" value="${esc(person.name)}"></label><label>Role<select name="role">${roleOptions(person.role)}</select></label><label>Committee<select name="committee">${committeeOptions(person.committee)}</select></label><label>Position<input name="position" maxlength="60" value="${esc(person.position)}" placeholder="Optional"></label></div><div class="access"><span class="access-title">Access with this role</span><div class="access-chips">${accessChips(person.role)}</div></div><button class="primary">${person.active ? 'Save member' : 'Restore member'}</button></form>
      ${person.id && can('points') ? `<button class="history-btn" data-history="${esc(person.id)}">${icon('chart')} Points history</button>` : ''}
      ${person.active ? `<button class="danger remove-member" data-remove-member="${esc(person.email)}">Remove member</button>` : ''}`}</details>`;
  };
  const counts = directory.reduce((all, person) => { if (person.active) all[person.committee || ''] = (all[person.committee || ''] || 0) + 1; return all; }, {});
  const active = directory.filter(person => person.active);
  const memberPanel = can('members') ? `<section class="card stack directory"><div class="section-head"><h2>All members</h2><span class="count">${active.length} members · ${active.filter(person => person.signed_in).length} signed in</span></div>
    <div class="directory-tools"><input id="member-search" type="search" placeholder="Search name, email or position" aria-label="Search members"><select id="member-committee" aria-label="Filter by committee"><option value="*">All committees (${active.length})</option>${Object.keys(counts).sort().map(name => `<option value="${esc(name)}">${esc(name || 'No committee')} (${counts[name]})</option>`).join('')}</select></div>
    <div class="member-list">${directory.map(memberRow).join('') || '<p>No members yet. Add the first one.</p>'}</div><p id="no-members" hidden>No members match your search.</p></section>` : '';
  const addMemberPanel = can('members') ? `<section class="card stack"><h2>Add member</h2><p class="hint">They can sign in with Google using this email and get access right away.</p><form data-action="directory-save"><label>University email<input type="email" name="email" required maxlength="254" placeholder="name1234567@miuegypt.edu.eg"></label><label>Full name<input name="name" required maxlength="60"></label><div class="form-grid"><label>Committee<select name="committee">${committeeOptions('')}</select></label><label>Role<select name="role">${roleOptions('Member')}</select></label></div><div class="access"><span class="access-title">Access with this role</span><div class="access-chips">${accessChips('Member')}</div></div><label>Position<input name="position" maxlength="60" placeholder="Optional, e.g. Secretariat"></label><button class="primary">Add member</button></form></section>` : '';
  const rolePanel = can('members') ? `<section class="card stack"><h2>Assign a role by Google email</h2>
    <form data-action="member-email"><label>Google email<input type="email" name="email" maxlength="254" required></label>
    <label>Role<select name="role">${state.boardRoles.map(role => `<option>${esc(role)}</option>`).join('')}</select></label>
    <label>Committee<select name="committee"><option value="">Unassigned</option>${state.committees.map(item => `<option>${esc(item.name)}</option>`).join('')}</select></label><button class="primary">Save role by email</button></form>
    ${state.boardInvites.length ? '<h3 class="sub-head">Pending invitations</h3>' : ''}${state.boardInvites.map(invite => `<form class="list-row" data-action="member-invite-revoke"><span class="list-main"><strong>${esc(invite.email)}</strong><small>${esc(invite.role)}</small></span><input type="hidden" name="email" value="${esc(invite.email)}"><button class="danger">Revoke invitation</button></form>`).join('')}
    </section>${['President', 'Co-President', 'Upper Board'].includes(state.profile.role) ? `<section class="card stack"><h2>Create a role</h2><form data-action="custom-role"><label>Role name<input name="name" maxlength="40" required></label>
    <fieldset><legend>Club-wide permissions</legend>${[['posts','Manage feed and polls'],['points','Adjust points'],['learning','Manage quizzes and resources'],['activities','Manage activities and attendance']].map(([key, label]) => `<label class="choice"><input type="checkbox" name="permissions" value="${key}">${label}</label>`).join('')}</fieldset><button class="primary">Create role</button></form></section>` : ''}` : '';
  const attendanceActivities = state.boardActivities.filter(item => Date.parse(item.starts_at) <= Date.now());
  const activityPanel = can('activities') ? `<section class="card stack"><h2>Publish activity</h2>
      <form data-action="activity"><label>Title<input name="title" required maxlength="100"></label><label>Type<select name="kind"><option>Event</option><option>Training</option><option>Competition</option><option>Challenge</option><option>Organizing</option></select></label><label>Start time in your device timezone<input name="starts" type="datetime-local" required></label><label>Audience<select name="committee">${state.scope ? '' : '<option value="">Entire club</option>'}${state.committees.map(item => `<option>${esc(item.name)}</option>`).join('')}</select></label><button class="primary">Publish activity</button></form>
      </section><section class="card stack"><h2>Record attendance</h2>${attendanceActivities.length ? `<form data-action="attendance"><label>Activity<select name="activity" required>${attendanceActivities.map(item => `<option value="${esc(item.id)}">${esc(item.title)} · ${esc(clubTime(item.starts_at))} Cairo</option>`).join('')}</select></label><label>Member<select name="member" required>${scopedMembers().map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><button class="primary">Record attendance</button></form>` : '<p>No activities have started yet. Attendance becomes available when an activity starts.</p>'}</section>` : '';
  const delivery = state.pushDelivery ? `<section class="card stack"><h2>Push delivery</h2><p>Last 24 hours. Accepted messages are tracked by OneSignal.</p>${state.pushDelivery.map(item => `<p>${esc(item.state)} · ${item.count}</p>`).join('') || '<p>No messages queued.</p>'}</section>` : '';
  const committeePanel = can('members') && !state.scope ? '<section class="card stack"><h2>Add committee</h2><form data-action="committee"><label>Name<input name="name" maxlength="60" required></label><button class="primary">Add committee</button></form></section>' : '';
  const sections = [
    { id: 'members', label: 'Members', content: memberPanel + `<div class="stack">${addMemberPanel}${committeePanel}</div>` },
    { id: 'roles', label: 'Roles & access', content: rolePanel },
    { id: 'feed', label: 'Feed & polls', content: postPanel },
    { id: 'activities', label: 'Activities', content: activityPanel },
    { id: 'points', label: 'Points', content: pointsPanel },
    { id: 'learning', label: 'Quiz', content: learningPanel },
    { id: 'resources', label: 'Resources', content: resourcePanel },
    { id: 'delivery', label: 'Push delivery', content: delivery }
  ].filter(section => section.content);
  const selected = sections.find(section => location.hash === '#admin/' + section.id) || sections[0];
  const tabs = sections.map(section => `<a href="#admin/${section.id}" ${section === selected ? 'aria-current="page"' : ''}>${section.label}</a>`).join('');
  return intro + `<nav class="admin-nav" aria-label="Board sections">${tabs}</nav>
    ${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}
    <div class="admin-grid${['points','delivery'].includes(selected.id) ? ' admin-grid-single' : ''}">${selected.content}</div>`;
}
function notifications() {
  const entries = state.notifications.map(item => `<article class="news"><div class="label">${esc(item.kind)}${item.read_at ? '' : ' · Unread'}</div><h3><a href="${esc(item.route)}">${esc(item.title)}</a></h3>${item.body ? `<p class="note-body">${esc(item.body)}</p>` : ''}${item.read_at ? '' : `<button data-read="${esc(item.id)}">Mark as read</button>`}</article>`).join('');
  const preferences = state.pushPreference
    ? `<section class="card stack"><h2>Push notifications</h2><p>${state.pushPreference.enabled ? 'Push is enabled for your account.' : 'Get updates from the club on this device.'}</p>
      <div class="actions"><button data-push="${munPush.isReady() ? 'enable' : 'prepare'}">${munPush.isReady() ? 'Allow on this device' : 'Set up this device'}</button>
      ${state.pushPreference.enabled ? '<button data-push="disable">Turn off push</button>' : ''}</div></section>`
    : '';
  return heading('Inbox', 'Recent club and account notifications.') + preferences + `<section class="card stack">${state.unreadNotifications ? '<button data-read-all>Mark all as read</button>' : ''}${entries || '<p>No notifications yet.</p>'}</section>`;
}
const views = { home, feed, fantasy, assistant, resources, quiz, profile, admin, notifications, menu };

function render() {
  document.body.classList.toggle('signed-out', !state);
  let requested = location.hash.slice(1).split('/')[0];
  const boardAccess = Boolean(state?.permissions.length);
  document.querySelector('#board-link').hidden = !boardAccess;
  if (state && requested === 'admin' && !boardAccess) {
    history.replaceState(history.state, '', '#home');
    requested = 'home';
  }
  document.body.classList.toggle('admin-page', boardAccess && requested === 'admin');
  if (!state) {
    const pending = new URLSearchParams(location.search).get('membership') === 'pending';
    const google = '<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';
    const perks = [['feed', 'Club feed, polls and events'], ['trophy', 'Fantasy points and the daily quiz'], ['spark', 'AI assistant for debate and research']];
    content.innerHTML = `<section class="login-page"><div class="login-card">
      <img class="login-logo" src="logo.jpg" width="120" height="120" alt="MIU Model United Nations and Arab League XIX emblem">
      <span class="eyebrow">MIU-MUNAL</span><h1>Member portal</h1>
      <p class="login-lead">Model United Nations &amp; Model Arab League at Misr International University. Train, debate and compete with the club.</p>
      ${pending ? '<div class="login-status" role="status"><strong>You’re signed in — almost there.</strong><span>The board needs to approve your membership. Once they do, sign in again to enter.</span></div>' : ''}
      ${session.googleReady ? `<a class="google-button" href="/api/auth/google">${google}<span>Continue with Google</span></a>` : `<p class="login-status" role="status">${esc(session.message || 'Google sign-in is awaiting setup.')}</p>`}
      <ul class="login-perks">${perks.map(([symbol, text]) => `<li>${icon(symbol)}<span>${text}</span></li>`).join('')}</ul>
      <p class="login-foot">Only members approved by the club board can sign in.</p>
    </div></section>`;
    return;
  }
  const route = Object.hasOwn(views, requested) ? requested : 'home';
  if (route !== 'profile') { stopCamera(); photoDraft = ''; }
  document.body.dataset.route = route;
  const count = document.querySelector('#inbox-count');
  count.hidden = !state.unreadNotifications;
  count.textContent = state.unreadNotifications > 99 ? '99+' : state.unreadNotifications;
  document.querySelector('#inbox-link').setAttribute('aria-label', 'Inbox' + (state.unreadNotifications ? ', ' + state.unreadNotifications + ' unread' : ''));
  document.querySelector('#crumb').innerHTML = '<span class="crumb-root">Club portal / </span>' + pages[route];
  document.querySelector('#account-name').textContent = shortName(state.profile.name);
  document.querySelector('#initials').outerHTML = avatar(state.profile).replace('class="avatar', 'id="initials" class="avatar');
  document.querySelectorAll('.sidebar a, .mobile-tabs a').forEach(link => {
    const activeRoute = link.closest('.mobile-tabs') ? (dockTab[route] || 'menu') : route;
    if (link.hash === '#' + activeRoute && !link.classList.contains('brand')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  content.innerHTML = views[route]() + (notice && route !== 'admin' ? `<div class="notice" role="status">${esc(notice)}</div>` : '');
  notice = '';
  content.querySelectorAll('[data-pct]').forEach(bar => { bar.style.width = bar.dataset.pct + '%'; });
  content.querySelector('.admin-nav [aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const video = document.querySelector('#camera');
  if (video) video.srcObject = camera;
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
content.addEventListener('input', event => {
  if (event.target.id === 'member-search' || event.target.id === 'member-committee') {
    const query = content.querySelector('#member-search').value.trim().toLowerCase();
    const committee = content.querySelector('#member-committee').value;
    const rows = [...content.querySelectorAll('.member-row')];
    rows.forEach(row => { row.hidden = !row.dataset.search.includes(query) || (committee !== '*' && row.dataset.committee !== committee); });
    document.querySelector('#no-members').hidden = rows.some(row => !row.hidden);
    return;
  }
  if (event.target.id === 'history-search') {
    content.querySelector('#history-results').innerHTML = historyMatches(event.target.value);
    return;
  }
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
  // pwa.js loads after this file, so wire install updates once the session is in.
  munInstall.onChange(() => { if (document.querySelector('#welcome')) showWelcome(true); });
  showWelcome();
  autoPush();
}
async function perform(control, operation) {
  if (busy) return;
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
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
    document.body.removeAttribute('aria-busy');
  }
}
// Upload a PDF straight to Cloudinary with a short-lived signed ticket from the server.
async function uploadResourcePdf(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw Error('Choose a PDF file.');
  if (file.size > 10e6) throw Error('PDF files must be 10 MB or smaller.');
  const ticket = await api('resource-upload', {});
  const form = new FormData();
  Object.entries(ticket.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', file);
  let result;
  try {
    const response = await fetch(ticket.url, { method: 'POST', body: form });
    result = response.ok ? await response.json() : null;
  } catch { result = null; }
  if (!result?.secure_url?.startsWith('https://res.cloudinary.com/')) throw Error('The PDF could not be uploaded. Try again.');
  return result.secure_url;
}
async function update(action, fields) {
  const result = await api(action, fields);
  state = result.data;
  notice = result.message;
}
const signOut = control => perform(control, async () => {
  stopCamera();
  try { await munPush.logout(); } catch {}
  await api('logout', {});
  state = undefined;
  session = { googleReady: true };
  conversation = [];
  editingPost = '';
  history.replaceState(null, '', '/');
});
document.querySelector('#logout').addEventListener('click', event => signOut(event.currentTarget));
async function photoAction(button) {
  const step = button.dataset.photo;
  if (step === 'upload') return content.querySelector('#photo-file').click();
  if (step === 'cancel') { stopCamera(); photoDraft = ''; return render(); }
  if (step === 'camera') return perform(button, async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('This browser cannot open the camera. Use Upload photo instead.');
    try {
      camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1080 } }, audio: false });
    } catch {
      throw Error('Camera access was blocked or is unavailable. Allow camera access or use Upload photo.');
    }
  });
  if (step === 'capture') {
    const video = content.querySelector('#camera');
    if (!video?.videoWidth) return;
    photoDraft = squarePhoto(video, video.videoWidth, video.videoHeight);
    stopCamera();
    return render();
  }
  if (step === 'save') return perform(button, async () => {
    await update('profile-photo', { image: photoDraft });
    photoDraft = '';
  });
  if (step === 'remove' && confirm('Remove your profile photo?')) return perform(button, () => update('profile-photo', { remove: true }));
}
content.addEventListener('change', async event => {
  if (event.target.matches('form[data-action="directory-save"] select[name="role"]')) {
    const chips = event.target.form.querySelector('.access-chips');
    const labels = { members: 'Members & roles', posts: 'Feed & polls', points: 'Points', learning: 'Quiz & resources', activities: 'Activities' };
    if (chips) chips.innerHTML = (state.boardRoleAccess?.[event.target.value] || []).map(key => `<span class="chip">${labels[key] || esc(key)}</span>`).join('') || '<span class="chip off">No admin access</span>';
    return;
  }
  if (event.target.id !== 'photo-file') return;
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (!file.type.startsWith('image/') || file.size > 20e6) throw Error('Choose an image smaller than 20 MB.');
    const bitmap = await createImageBitmap(file);
    photoDraft = squarePhoto(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
  } catch (error) {
    notice = error.message.startsWith('Choose') ? error.message : 'That image could not be read. Try a JPG or PNG photo.';
  }
  render();
});
content.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!state || !button || button.form || busy) return;
  if (button.dataset.signout !== undefined) return signOut(button);
  if (button.dataset.install !== undefined) return showWelcome(true);
  if (button.dataset.history) return showHistory(button);
  if (button.dataset.editResource) {
    editingResource = button.dataset.editResource;
    render();
    content.querySelector('#resource-editor [name="title"]')?.focus();
    return;
  }
  if (button.dataset.cancelResource !== undefined) { editingResource = ''; return render(); }
  if (button.dataset.deleteResource) {
    if (confirm('Delete this resource? Members will no longer see it.')) perform(button, () => update('resource-delete', { id: button.dataset.deleteResource }));
    return;
  }
  if (button.dataset.removeMember) {
    if (confirm('Remove ' + button.dataset.removeMember + ' from the club? They lose access right away; their points and history are kept.')) perform(button, () => update('directory-remove', { email: button.dataset.removeMember }));
    return;
  }
  if (button.dataset.photo) return photoAction(button);
  if (button.dataset.push) return perform(button, async () => {
    if (button.dataset.push === 'prepare') {
      await munPush.prepare();
      notice = 'Select Allow on this device to finish setup.';
      return;
    }
    const enabled = button.dataset.push === 'enable';
    if (enabled) await munPush.optIn();
    state.pushPreference = await api('push/preference', { enabled });
    if (!enabled) await munPush.optOut();
    notice = enabled ? 'Push preference saved.' : 'Push notifications turned off.';
  });
  if (button.dataset.newChat !== undefined) {
    conversation = [];
    render();
    return;
  }
  if (button.dataset.copy !== undefined) return perform(button, async () => {
    const { reply } = conversation[Number(button.dataset.copy)];
    await navigator.clipboard.writeText(reply.text);
    notice = 'Response copied.';
  });
  const { filter, scope: period, prompt, edit, cancelEdit, pin, delete: remove } = button.dataset;
  if (button.dataset.read) return perform(button, () => update('notification-read', { id: button.dataset.read }));
  if (button.dataset.readAll !== undefined) return perform(button, () => update('notifications-read-all', {}));
  if (filter) feedFilter = filter;
  if (period) scope = period;
  if (prompt) return perform(button, async () => { await ask(prompt); scrollChat(); });
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
  if (action === 'custom-role') fields.permissions = new FormData(form).getAll('permissions');
  if (form.dataset.id) fields.id = form.dataset.id;
  if (form.dataset.operation) fields.operation = form.dataset.operation;
  if (action === 'quiz') fields.date = state.quiz.date;
  perform(form.querySelector('button'), async () => {
    if (action === 'assistant') { await ask(fields.question); scrollChat(); return; }
    if (action === 'activity') fields.starts = new Date(fields.starts).toISOString();
    const pdf = form.querySelector('#resource-file')?.files[0];
    if (pdf) fields.url = await uploadResourcePdf(pdf);
    await update(action, fields);
    if (action === 'publish') editingPost = '';
    if (action === 'resource-update') editingResource = '';
  });
});
content.addEventListener('keydown', event => {
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
});
const visualViewport = window.visualViewport;
function updateKeyboardLayout() {
  const editing = document.activeElement?.matches('textarea, input:not([type=radio]):not([type=checkbox])');
  document.body.classList.toggle('keyboard-open', Boolean(
    editing && visualViewport && visualViewport.scale === 1 && window.innerHeight - visualViewport.height > 120
  ));
}
visualViewport?.addEventListener('resize', updateKeyboardLayout);
document.addEventListener('focusin', updateKeyboardLayout);
document.addEventListener('focusout', () => requestAnimationFrame(updateKeyboardLayout));
// Pull to refresh: drag down from the top of the page to reload club data (works in the installed app too).
(() => {
  const indicator = document.createElement('div');
  indicator.className = 'ptr';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = icon('refresh');
  document.body.append(indicator);
  const threshold = 70;
  let startY = null, pull = 0, refreshing = false;
  const reset = () => { pull = 0; indicator.style.transform = ''; indicator.classList.remove('ready', 'dragging'); };
  document.addEventListener('touchstart', event => {
    startY = !refreshing && !busy && window.scrollY <= 0 && event.touches.length === 1 && !document.querySelector('#welcome') ? event.touches[0].clientY : null;
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (startY === null) return;
    pull = Math.max(0, (event.touches[0].clientY - startY) * 0.5);
    if (window.scrollY > 0) pull = 0;
    indicator.classList.add('dragging');
    indicator.classList.toggle('ready', pull >= threshold);
    indicator.style.transform = `translate(-50%, ${Math.min(pull, threshold + 20)}px) rotate(${pull * 3}deg)`;
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    if (pull < threshold) return reset();
    refreshing = true;
    indicator.classList.remove('dragging');
    indicator.classList.add('spinning');
    indicator.style.transform = `translate(-50%, ${threshold}px)`;
    try {
      navigator.serviceWorker?.getRegistration().then(registration => registration?.update()).catch(() => {});
      if (!state) return location.reload();
      const fresh = await api('session');
      session = fresh;
      state = fresh.data;
      render();
    } catch {
      location.reload();
    } finally {
      refreshing = false;
      indicator.classList.remove('spinning');
      reset();
    }
  });
})();
loadSession();
