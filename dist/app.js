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
// ---------- Fantasy (FPL-style) ----------
// Data comes from /api/fantasy when the page opens; squad edits are a local draft until saved.
let fantasyData = null;
let fantasyLoading = false;
let fantasyTab = 'squad';
let draft = null;            // { players: [ids], captain: id } while editing
let playerSort = 'total';
let playerQuery = '';
let leagueFilter = 'overall';
let fxAnimate = true;
let playerCategory = 'all';
const categoryLabel = { board: 'Board', head: 'Head', member: 'Member' };
const credits = value => (value / 10).toFixed(1) + 'm';
const firstName = name => shortName(name).split(' ')[0];
let fantasySyncedAt = 0;
// Quiet refresh: keeps standings and prices in sync without interrupting edits, typing or popups.
async function syncFantasy() {
  if (!fantasyData || fantasyLoading || draft || busy || document.hidden || location.hash.slice(1).split('/')[0] !== 'fantasy') return;
  try {
    const fresh = await api('fantasy', {});
    if (draft) return;
    fantasyData = fresh;
    fantasySyncedAt = Date.now();
    const typing = document.activeElement?.matches('#content input, #content select, #content textarea');
    if (!typing && !document.querySelector('#modal') && location.hash.slice(1).split('/')[0] === 'fantasy') render();
  } catch {}
}
setInterval(syncFantasy, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFantasy(); });
// After a failed load, wait before retrying so a render never loops on errors.
let fantasyFailedAt = 0;
async function loadFantasy(force = false) {
  if (fantasyLoading || (fantasyData && !force) || (!force && Date.now() - fantasyFailedAt < 30000)) return;
  fantasyLoading = true;
  try {
    fantasyData = await api('fantasy', {});
    fantasySyncedAt = Date.now();
    fxAnimate = true;
  } catch (error) {
    fantasyFailedAt = Date.now();
    notice = error.message;
  } finally {
    fantasyLoading = false;
    if (['fantasy', 'admin'].includes(location.hash.slice(1).split('/')[0])) render();
  }
}
const playerById = id => fantasyData.players.find(player => player.id === id);
// The squad shown: the draft while editing, otherwise next round's squad if saved, otherwise the playing squad.
const shownSquad = () => draft || fantasyData.upcoming || fantasyData.squad;
const squadCost = ids => ids.reduce((sum, id) => sum + (playerById(id)?.price || 0), 0);
// Team make-up rules (max per committee, Board and Head min/max), mirrored from the server.
function makeup(ids) {
  const s = fantasyData.settings;
  const players = ids.map(playerById).filter(Boolean);
  const count = category => players.filter(player => player.category === category).length;
  const perCommittee = new Map();
  for (const player of players) if (player.committee) perCommittee.set(player.committee, (perCommittee.get(player.committee) || 0) + 1);
  return { board: count('board'), head: count('head'), perCommittee, s };
}
function blocksAdd(ids, player) {
  const { board, head, perCommittee, s } = makeup(ids);
  if (s.maxPerCommittee && player.committee && (perCommittee.get(player.committee) || 0) >= s.maxPerCommittee) return 'Max ' + s.maxPerCommittee + ' from ' + player.committee;
  if (player.category === 'board' && board >= s.boardMax) return 'Board is full';
  if (player.category === 'head' && head >= s.headMax) return 'Heads are full';
  // keep room for the minimums still needed
  const left = s.squadSize - ids.length - 1;
  const needBoard = Math.max(0, s.boardMin - board - (player.category === 'board' ? 1 : 0));
  const needHead = Math.max(0, s.headMin - head - (player.category === 'head' ? 1 : 0));
  if (needBoard + needHead > left) return 'Keep a seat for ' + (needBoard ? 'Board' : 'a Head');
  return '';
}
function makeupLine(ids) {
  const { board, head, s } = makeup(ids);
  const range = (min, max) => min && max < s.squadSize ? min + '–' + max : min ? 'min ' + min : max < s.squadSize ? 'max ' + max : '';
  const parts = [['Board', board, range(s.boardMin, s.boardMax)], ['Heads', head, range(s.headMin, s.headMax)]]
    .map(([label, value, rule]) => `<span class="fx-rule${rule ? '' : ' free'}">${label} <b>${value}</b>${rule ? ' <small>(' + rule + ')</small>' : ''}</span>`);
  if (s.maxPerCommittee) parts.push(`<span class="fx-rule">Per committee <small>(max ${s.maxPerCommittee})</small></span>`);
  return `<div class="fx-rules-line">${parts.join('')}</div>`;
}
const makeupMissing = ids => {
  const { board, head, s } = makeup(ids);
  return board < s.boardMin ? 'Add ' + (s.boardMin - board) + ' more board member' + (s.boardMin - board === 1 ? '' : 's') + '.'
    : head < s.headMin ? 'Add ' + (s.headMin - head) + ' more Head' + (s.headMin - head === 1 ? '' : 's') + '.' : '';
};
const transfersFor = ids => fantasyData.squad ? ids.filter(id => !fantasyData.squad.players.includes(id)).length : 0;
// Days between two YYYY-MM-DD dates (the server's date, so device clocks do not matter).
const daysUntil = (date, from) => Math.max(0, Math.round((Date.parse(date) - Date.parse(from)) / 86400000));
const dayLabel = date => new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
const priceTag = player => `<span class="fx-price">${credits(player.price)}${player.change ? `<b class="${player.change > 0 ? 'up' : 'down'}">${player.change > 0 ? '▲' : '▼'}${(Math.abs(player.change) / 10).toFixed(1)}</b>` : ''}</span>`;

function seat(id, squad, playing) {
  const player = playerById(id);
  if (!player) return '';
  const captain = squad.captain === id;
  const score = playing ? player.roundPoints * (captain ? fantasyData.settings.captainMultiplier : 1) : player.form;
  return `<div class="fx-seat${captain ? ' captain' : ''}">
    ${captain ? '<span class="fx-armband" title="Captain">C</span>' : ''}
    <button class="fx-seat-face" data-fx="player" data-id="${esc(id)}" aria-label="${esc(player.name)} details">${avatar(player, 'lg')}</button>
    <strong>${esc(firstName(player.name))}</strong>
    ${player.category !== 'member' ? `<span class="fx-cat ${player.category}">${categoryLabel[player.category]}</span>` : ''}
    <span class="fx-seat-score">${playing ? score + ' pts' : 'Form ' + score}</span>
    <small>${credits(player.price)}</small>
    ${draft ? `<span class="fx-seat-actions"><button data-fx="captain" data-id="${esc(id)}" aria-pressed="${captain}" title="Make captain">C</button><button data-fx="remove" data-id="${esc(id)}" title="Remove">✕</button></span>` : ''}
  </div>`;
}
function squadTab() {
  const f = fantasyData;
  const squad = shownSquad();
  const size = f.settings.squadSize;
  // Players are members who have signed in; until enough have joined, a full squad is not possible.
  const available = f.players.length;
  if (!squad && !draft) {
    return `<section class="card fx-empty">${icon('trophy')}<h2>Play MUN Fantasy in 3 steps</h2>
      <ol class="fx-steps">
        <li><b>1</b><span><strong>Pick ${size} members</strong><small>Any club members, you included, within ${credits(f.settings.budget)}.</small></span></li>
        <li><b>2</b><span><strong>Choose a captain</strong><small>Their points count ×${f.settings.captainMultiplier}.</small></span></li>
        <li><b>3</b><span><strong>Score every week</strong><small>Your team earns the real points your members get: quizzes, activities and awards.</small></span></li>
      </ol>
      ${!f.settings.enabled ? '<p class="notice">Fantasy is paused by the board.</p>'
        : available < size ? `<p class="notice">Fantasy opens when ${size} members have joined the portal (${available} so far). Invite your committee to sign in!</p>`
        : '<button class="primary" data-fx="edit">Pick your squad</button>'}</section>`;
  }
  const playing = !draft && !f.upcoming && Boolean(f.squad);
  const ids = squad.players;
  const cost = squadCost(ids);
  const transfers = draft ? transfersFor(ids) : (f.upcoming?.transfers || 0);
  const hit = Math.max(0, transfers - f.settings.freeTransfers) * f.settings.transferPenalty;
  const seats = ids.map(id => seat(id, squad, playing));
  const open = draft ? Array.from({ length: Math.max(0, size - ids.length) }, () => '<div class="fx-seat empty"><span class="avatar lg">+</span><strong>Open seat</strong><small>Add from the list</small></div>') : [];
  const captainIndex = ids.indexOf(squad.captain);
  const captainSeat = captainIndex >= 0 && !draft ? seats.splice(captainIndex, 1) : [];
  const all = [...captainSeat, ...(captainSeat.length ? ['<span class="fx-row-break" aria-hidden="true"></span>'] : []), ...seats, ...open];
  return `<section class="card fx-pitch-card">
      <div class="section-head"><h2>${draft ? 'Edit squad' : playing ? 'Playing this round' : 'Your squad for Round ' + (f.round.number + 1)}</h2>
        ${draft ? '' : f.settings.enabled ? '<button data-fx="edit">Transfers</button>' : ''}</div>
      ${!f.settings.enabled ? `<div class="fx-statusbar paused">${icon('shield')}<span><b>Fantasy is paused by the board.</b> Transfers are closed; your team keeps scoring.</span></div>` : ''}
      ${draft
        ? `<div class="fx-statusbar">${icon('quiz')}<span>Picked <b>${ids.length} of ${size}</b> · Captain <b>${squad.captain ? esc(firstName(playerById(squad.captain)?.name || '')) : 'not chosen'}</b> · <b>${credits(f.settings.budget - cost)}</b> left</span></div>`
        : playing
          ? `<div class="fx-statusbar">${icon('chart')}<span>Playing <b>Round ${f.round.number}</b> until ${dayLabel(f.round.end)}. Make transfers before <b>${dayLabel(f.round.next)}</b> to change Round ${f.round.number + 1}.</span></div>`
          : `<div class="fx-statusbar saved">${icon('quiz')}<span>Saved for <b>Round ${f.round.number + 1}</b>, starting ${dayLabel(f.round.next)}.${f.squad ? ` Your current team still plays Round ${f.round.number} (<b>${f.me?.round ?? 0} pts</b> so far).` : ' You can still change it until then.'}</span></div>`}
      <div class="fx-chamber">${all.join('')}</div>
      <div class="fx-meter"><span>Squad cost <b>${credits(cost)}</b> of ${credits(f.settings.budget)}</span><span class="${cost > f.settings.budget ? 'over' : ''}">Bank <b>${credits(f.settings.budget - cost)}</b></span></div>
      ${draft ? makeupLine(ids) : ''}
      <div class="fx-bar"><span data-pct="${Math.min(100, Math.round(100 * cost / f.settings.budget))}" class="${cost > f.settings.budget ? 'over' : ''}"></span></div>
      ${playing && f.me?.hit ? `<p class="hint">This round includes a <b class="fx-hit">−${f.me.hit} pts</b> transfer hit.</p>` : ''}
      ${f.squad || draft ? `<p class="hint">Transfers for next round: ${transfers} (${f.settings.freeTransfers} free)${hit ? ` · <b class="fx-hit">−${hit} pts</b>` : ''}. Changes apply from ${dayLabel(f.round.next)}.</p>` : ''}
      ${draft ? `<div class="actions"><button class="primary" data-fx="save" ${ids.length !== size || !squad.captain || cost > f.settings.budget || makeupMissing(ids) ? 'disabled' : ''}>Save squad</button><button data-fx="cancel">Cancel</button></div>
        ${ids.length === size && !squad.captain ? '<p class="hint">Tap C on a member to choose your captain.</p>' : ''}${makeupMissing(ids) && ids.length === size ? '<p class="hint">' + makeupMissing(ids) + '</p>' : ''}` : ''}
    </section>
    ${draft ? playersTab(true) : ''}`;
}
function priceMovers() {
  const f = fantasyData;
  const movers = f.players.filter(player => player.change).sort((a, b) => b.change - a.change || a.name.localeCompare(b.name));
  if (!movers.length) return `<section class="card fx-movers"><h2>Price changes</h2><p class="hint">Everyone is at the same price this round. Prices move automatically when the next round starts, from this round's points.</p></section>`;
  const row = player => `<button class="fx-mover" data-fx="player" data-id="${esc(player.id)}"><span>${esc(shortName(player.name))}</span>${priceTag(player)}</button>`;
  const up = movers.filter(player => player.change > 0), down = movers.filter(player => player.change < 0);
  return `<section class="card fx-movers"><h2>Price changes this round</h2><div class="fx-movers-grid">
    <div><h3>${up.length} rose</h3>${up.slice(0, 5).map(row).join('') || '<p class="hint">No rises.</p>'}</div>
    <div><h3>${down.length} fell</h3>${down.slice(0, 5).map(row).join('') || '<p class="hint">No falls.</p>'}</div></div></section>`;
}
function playersTab(picking = false) {
  const f = fantasyData;
  const q = playerQuery.trim().toLowerCase();
  const chosen = draft?.players || [];
  const list = f.players.filter(player => (playerCategory === 'all' || player.category === playerCategory) && (!q || player.name.toLowerCase().includes(q) || (player.committee || '').toLowerCase().includes(q)))
    .sort((a, b) => (b[playerSort] - a[playerSort]) || a.name.localeCompare(b.name));
  const sorts = [['total', 'Total'], ['form', 'Form'], ['roundPoints', 'Round'], ['price', 'Price'], ['selectedBy', 'Picked %']];
  return `<section class="card stack">
    <div class="section-head"><h2>${picking ? 'Add members' : 'Members'}</h2><span class="count">${list.length}</span></div>
    <div class="directory-tools"><input id="fx-search" type="search" placeholder="Search name or committee" aria-label="Search members" value="${esc(playerQuery)}"><select id="fx-sort" aria-label="Sort members">${sorts.map(([key, label]) => `<option value="${key}" ${key === playerSort ? 'selected' : ''}>Sort: ${label}</option>`).join('')}</select></div>
    <div class="filter-row fx-categories">${[['all', 'All'], ['board', 'Board'], ['head', 'Heads'], ['member', 'Members']].map(([id, label]) => `<button data-fx="category" data-id="${id}" class="${playerCategory === id ? 'selected' : ''}">${label}</button>`).join('')}</div>
    <div class="fx-list-head" aria-hidden="true"><span>Member</span><span class="fx-list-cols"><span>Pts</span><span>Form</span><span>Picked</span></span><span>Price</span>${picking ? '<span class="fx-list-add"></span>' : ''}</div>
    <div class="fx-list">${list.slice(0, 60).map(player => {
      const inSquad = chosen.includes(player.id);
      const full = chosen.length >= f.settings.squadSize;
      const affordable = squadCost(chosen) + player.price <= f.settings.budget;
      const blocked = picking && !inSquad ? blocksAdd(chosen, player) : '';
      return `<div class="fx-row${inSquad ? ' picked' : ''}">
        <button class="fx-row-main" data-fx="player" data-id="${esc(player.id)}">${avatar(player)}<span class="list-main"><strong>${esc(shortName(player.name))}</strong><small>${player.category !== 'member' ? `<span class="fx-cat ${player.category}">${categoryLabel[player.category]}</span> ` : ''}${esc(player.committee || 'No committee')}</small></span></button>
        <span class="fx-stats"><span><b>${player.total}</b><small>pts</small></span><span><b>${player.form}</b><small>form</small></span><span><b>${player.selectedBy}%</b><small>picked</small></span></span>
        ${priceTag(player)}
        ${picking ? (inSquad ? `<button class="fx-add on" data-fx="remove" data-id="${esc(player.id)}" aria-label="Remove ${esc(player.name)}">✓</button>`
          : `<button class="fx-add" data-fx="add" data-id="${esc(player.id)}" ${full || !affordable || blocked ? 'disabled' : ''} title="${esc(blocked || (affordable ? '' : 'Over budget'))}" aria-label="Add ${esc(player.name)}">+</button>`) : ''}
      </div>`;
    }).join('') || '<p>No member matches your search.</p>'}</div></section>`;
}
function leaguesTab() {
  const f = fantasyData;
  const committee = state.profile.committee;
  const rows = leagueFilter === 'committee' ? f.league.filter(row => row.committee && row.committee === committee) : f.league;
  const table = list => `<ol class="fx-table">${list.map((row, index) => `<li class="${row.id === state.profile.id ? 'me' : ''}"><span class="fx-rank">${leagueFilter === 'committee' ? index + 1 : row.rank}</span><span class="list-main"><strong>${esc(shortName(row.name))}${row.id === state.profile.id ? ' · You' : ''}</strong><small>${esc(row.committee || '')}</small></span><span class="fx-col">${row.round}<small>round</small></span><span class="fx-col total">${row.total}<small>total</small></span></li>`).join('') || '<li class="hint">No managers yet. Pick a squad to enter.</li>'}</ol>`;
  if (!f.managers) {
    return `<section class="card fx-empty">${icon('chart')}<h2>No managers yet</h2><p>Standings, round leaders and the dream team appear once members pick their squads.</p></section>
      <section class="card stack fx-achievements"><h2>Achievements</h2><div class="fx-badges">${f.achievements.map(item => `<div class="fx-badge${item.earned ? ' earned' : ''}"><span>${icon(item.earned ? 'star' : 'shield')}</span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div>`).join('')}</div></section>`;
  }
  return `<div class="grid fx-leagues">
    <section class="card stack"><div class="section-head"><h2>Standings</h2><span class="count">${f.managers} managers</span></div>
      <div class="filter-row">${[['overall', 'Overall'], ...(committee ? [['committee', committee]] : [])].map(([id, label]) => `<button data-fx="league" data-id="${esc(id)}" class="${leagueFilter === id ? 'selected' : ''}">${esc(label)}</button>`).join('')}</div>
      ${table(rows)}</section>
    <div class="stack">
      <section class="card stack"><h2>Dream team</h2><p class="hint">Top scorers of Round ${f.round.number} so far.</p>
        <div class="fx-dream">${f.dreamTeam.map((player, index) => `<button class="fx-dream-seat" data-fx="player" data-id="${esc(player.id)}">${index === 0 ? '<span class="fx-armband">★</span>' : ''}${avatar(player)}<strong>${esc(firstName(player.name))}</strong><small>${player.roundPoints} pts</small></button>`).join('') || '<p class="hint">No points scored yet this round.</p>'}</div></section>
      <section class="card stack"><h2>Round leaders</h2>${f.roundLeague.length ? `<ol class="fx-table compact">${f.roundLeague.slice(0, 5).map((row, index) => `<li class="${row.id === state.profile.id ? 'me' : ''}"><span class="fx-rank">${index + 1}</span><span class="list-main"><strong>${esc(shortName(row.name))}</strong></span><span class="fx-col total">${row.round}<small>pts</small></span></li>`).join('')}</ol>` : '<p class="hint">No squads are playing yet.</p>'}</section>
      <section class="card stack"><h2>Achievements</h2><div class="fx-badges">${f.achievements.map(item => `<div class="fx-badge${item.earned ? ' earned' : ''}"><span>${icon(item.earned ? 'star' : 'shield')}</span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div>`).join('')}</div></section>
    </div></div>`;
}
function rulesCard() {
  const s = fantasyData.settings;
  return `<details class="card fx-rules"><summary>${icon('book')} How MUN Fantasy works</summary><ul>
    <li>Pick ${s.squadSize} members (you can include yourself) within ${credits(s.budget)}. Choose a captain: their points count ×${s.captainMultiplier}.</li>
    ${s.maxPerCommittee || s.boardMin || s.headMin || s.boardMax < s.squadSize || s.headMax < s.squadSize ? `<li>Team make-up:${s.maxPerCommittee ? ' at most ' + s.maxPerCommittee + ' per committee;' : ''} Board ${s.boardMin}–${s.boardMax}; Heads ${s.headMin}–${s.headMax}.</li>` : ''}
    <li>Your members score the real club points they earn each week (quizzes, activities, awards). A round runs Monday to Sunday, Cairo time.</li>
    <li>Squad changes apply from the next round. ${s.freeTransfers} free transfer${s.freeTransfers === 1 ? '' : 's'} per round; each extra costs ${s.transferPenalty} points.</li>
    <li>Everyone starts at ${credits(s.startPrice)}. Prices change automatically at the start of each round from last round's points: +${credits(s.priceStep)} for every ${s.riseThreshold} points (up to +${credits(s.priceStep * s.maxRiseSteps)}); ${s.fallThreshold} or fewer points lowers the price by ${credits(s.priceStep)}. Prices stay between ${credits(s.minPrice)} and ${credits(s.maxPrice)}.</li>
  </ul></details>`;
}
function fantasy() {
  if (fantasyData && !draft && Date.now() - fantasySyncedAt > 30000) setTimeout(syncFantasy);
  if (!fantasyData) {
    loadFantasy();
    return heading('Fantasy', 'Build a squad of club members and compete every round.') + '<div class="card fx-loading"><span></span><span></span><span></span></div>';
  }
  const f = fantasyData;
  const value = squadCost((f.upcoming || f.squad)?.players || []);
  const tabs = [['squad', 'My squad'], ['players', 'Members'], ['leagues', 'Leagues'], ['points', 'My points']];
  const body = fantasyTab === 'players' ? (draft ? '' : priceMovers()) + playersTab(Boolean(draft)) : fantasyTab === 'leagues' ? leaguesTab()
    : fantasyTab === 'points' ? stats() + `<div class="grid"><section class="card"><h2>Member standings</h2><div class="actions">${[['points', 'Global'], ['week', 'Weekly'], ['month', 'Monthly']].map(([id, label]) => `<button data-scope="${id}" aria-pressed="${scope === id}" class="${scope === id ? 'selected' : ''}">${label}</button>`).join('')}</div>${ranking(scope)}</section><section class="card"><div class="section-head"><h2>Points history</h2></div>${pointHistory()}</section></div>`
    : squadTab();
  return `<div class="fx-page${fxAnimate ? ' fx-enter' : ''}"><div class="fx-hero">
      <div><span class="eyebrow">MUN Fantasy · Round ${f.round.number}</span><h1>Fantasy</h1><p>${dayLabel(f.round.start)} – ${dayLabel(f.round.end)} · Next round in ${daysUntil(f.round.next, f.round.today)} day${daysUntil(f.round.next, f.round.today) === 1 ? '' : 's'}</p><small class="fx-synced">${icon('refresh')} Updated ${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(fantasySyncedAt || Date.now())}</small></div>
      ${f.me ? `<div class="fx-scores">
        <div><b data-count="${f.me.round}">${f.me.round}</b><small>Round</small></div>
        <div><b data-count="${f.me.total}">${f.me.total}</b><small>Total</small></div>
        <div><b>#${f.me.rank}</b><small>of ${f.managers}</small></div>
        <div><b>${(value / 10).toFixed(1)}</b><small>Value (m)</small></div>
      </div>` : `<span class="fx-status">${icon('trophy')} ${f.managers ? f.managers + ' manager' + (f.managers === 1 ? '' : 's') + ' in the league' : 'Season starting'}</span>`}</div>
    <nav class="fx-tabs" aria-label="Fantasy sections">${tabs.map(([id, label]) => `<button data-fx="tab" data-id="${id}" aria-current="${fantasyTab === id ? 'page' : 'false'}">${label}</button>`).join('')}</nav>
    ${body}${fantasyTab === 'squad' ? rulesCard() : ''}</div>`;
}
function playerCard(id) {
  const player = playerById(id);
  if (!player) return;
  const body = openModal(player.name).querySelector('.modal-body');
  body.classList.remove('history-box');
  body.innerHTML = `<div class="fx-card">${avatar(player, 'xl')}<p>${esc(player.committee || 'No committee')}</p>${priceTag(player)}</div>
    <div class="fx-card-stats">${[['Total', player.total], ['This round', player.roundPoints], ['Last round', player.lastRound], ['Form', player.form], ['Picked by', player.selectedBy + '%']].map(([label, value]) => `<div><b>${value}</b><small>${label}</small></div>`).join('')}</div>
    ${draft ? (draft.players.includes(player.id) ? `<button class="danger" data-fx="remove" data-id="${esc(player.id)}" data-close-modal>Remove from squad</button>` : `<button class="primary" data-fx="add" data-id="${esc(player.id)}" data-close-modal>Add to squad</button>`) : ''}`;
}
// Count-up for headline numbers (skipped when the user prefers reduced motion).
function animateCounts() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  content.querySelectorAll('[data-count]').forEach(element => {
    const target = Number(element.dataset.count);
    if (!target) return;
    const started = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - started) / 700);
      element.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
async function fantasyAction(button) {
  const { fx, id } = button.dataset;
  const size = fantasyData?.settings.squadSize;
  if (fx === 'tab') { fantasyTab = id; fxAnimate = true; return render(); }
  if (fx === 'league') { leagueFilter = id; return render(); }
  if (fx === 'category') { playerCategory = id; return render(); }
  if (fx === 'player') return playerCard(id);
  if (fx === 'edit') {
    const base = fantasyData.upcoming || fantasyData.squad;
    draft = { players: base ? [...base.players] : [], captain: base?.captain || null };
    fantasyTab = 'squad';
    return render();
  }
  if (fx === 'cancel') { draft = null; return render(); }
  if (fx === 'add' && draft && draft.players.length < size && !draft.players.includes(id)) draft.players.push(id);
  if (fx === 'remove' && draft) { draft.players = draft.players.filter(item => item !== id); if (draft.captain === id) draft.captain = null; }
  if (fx === 'captain' && draft) draft.captain = id;
  if (fx === 'save' && draft) return perform(button, async () => {
    const result = await api('fantasy-squad', { players: draft.players, captain: draft.captain });
    fantasyData = result.data;
    draft = null;
    notice = result.message;
  });
  render();
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
  // Shown again every 7 days until notifications are on (unless the browser has blocked them).
  const seen = Number(localStorage.getItem(welcomeKey) || 0);
  const needsPush = pushAvailable() && !state?.pushPreference.enabled && 'Notification' in window && Notification.permission !== 'denied';
  if (!state || (!force && seen && !(needsPush && Date.now() - seen > 7 * 86400000))) return;
  if (!force && munInstall.standalone() && (!pushAvailable() || state.pushPreference.enabled)) return localStorage.setItem(welcomeKey, String(Date.now()));
  if (pushAvailable() && !state.pushPreference.enabled) munPush.prepare().catch(() => {});
  let sheet = document.querySelector('#welcome');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'welcome';
    sheet.className = 'sheet-backdrop';
    document.body.append(sheet);
  }
  sheet.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <img src="/logo-256.jpg" width="64" height="64" alt=""><h2 id="welcome-title">Welcome to MIU MUN</h2><p>Get the full app experience in two taps.</p>
    <div class="step"><span class="icon">${icon('download')}</span><div><strong>Add to your Home Screen</strong><small>Open the portal like an app, full screen.</small>${installStep()}</div></div>
    <div class="step"><span class="icon">${icon('bell')}</span><div><strong>Get notified</strong><small>New posts, quizzes, points and events.</small>${pushStep()}</div></div>
    <p class="notice" id="welcome-status" role="status" hidden></p>
    <button class="sheet-close" data-welcome="close">Done</button></section>`;
  sheet.querySelector('[data-welcome]')?.focus();
}
function closeWelcome() {
  localStorage.setItem(welcomeKey, String(Date.now()));
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
const pointsLabel = member => member.committee ? `${member.name} · ${member.committee}` : member.name;
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
  const fx = event.target.closest('#modal [data-fx]');
  if (fx && fantasyData) fantasyAction(fx);
  if (event.target.id === 'modal' || event.target.closest('[data-close-modal]')) closeModal();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
// Feed post type: 'Other' reveals a field for the board's own type.
document.addEventListener('change', event => {
  if (!event.target.matches('[data-post-type]')) return;
  const field = event.target.form.querySelector('.custom-type');
  field.hidden = event.target.value !== 'Other';
  field.querySelector('input').required = !field.hidden;
});
// Display names: the President role is called Secretary General in the club.
const roleName = role => ({ President: 'Secretary General' })[role] || role;
function admin() {
  const intro = `<a class="back-link" href="#menu">${icon('chevron')} Back</a>` + heading('Board Workspace', 'Manage club members, the feed, points and learning materials.');
  if (!state.permissions.length) return intro + '<div class="card"><p>This workspace is available to authorized board members.</p></div>';
  const editing = state.posts.find(post => post.id === editingPost);
  const postPanel = can('posts') ? `<section class="card stack"><h2>${editing ? 'Edit post' : 'Publish to Feed'}</h2><form id="post-editor" data-action="publish" data-id="${esc(editing?.id)}">
      ${(() => { const custom = editing && !types.includes(editing.type) ? editing.type : ''; return `<label>Type<select name="type" data-post-type>${types.map(type => `<option ${type === editing?.type ? 'selected' : ''}>${type}</option>`).join('')}<option value="Other" ${custom ? 'selected' : ''}>Other</option></select></label><label class="custom-type" ${custom ? '' : 'hidden'}>Your own type<input name="customType" maxlength="30" placeholder="e.g. Reminder, Social Event" value="${esc(custom)}"></label>`; })()}
      ${state.scope ? '<p>Audience: ' + esc(state.scope) + '</p>' : `<label>Audience<select name="committee"><option value="">Entire club</option>${state.committees.map(item => `<option ${item.name === editing?.committee ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>`}
      <label>Title<input name="title" maxlength="100" required value="${esc(editing?.title)}"></label><label>Message<textarea name="body" maxlength="1500" required>${esc(editing?.body)}</textarea></label>
      <label>Poll choices (one per line)<textarea name="options" maxlength="400">${esc(editing?.options.join('\n'))}</textarea></label><button class="primary">${editing ? 'Save changes' : 'Publish'}</button></form>${editing ? '<button data-cancel-edit>Cancel editing</button>' : ''}</section>
      <section class="card stack"><h2>Manage posts</h2>${postOrder().filter(post => post.manageable).map(post => `<div class="list-row"><span class="list-main"><strong>${esc(post.title)}</strong><small>${esc(post.type)}${post.pinned ? ' · Pinned' : ''} · ${timeAgo(post.created)}</small></span><span class="row-actions"><button data-edit="${esc(post.id)}">Edit</button><button data-pin="${esc(post.id)}">${post.pinned ? 'Unpin' : 'Pin'}</button><button class="danger" data-delete="${esc(post.id)}">Delete</button></span></div>`).join('') || '<p>No posts yet.</p>'}</section>` : '';
  // Fantasy tab: game control, season overview and rules (club-wide points managers).
  const fs = state.fantasySettings;
  const cr = value => (value / 10).toFixed(1);
  const field = (label, name, value, hint, attributes = '') => `<label>${label}<input type="number" name="${name}" value="${value}" ${attributes}><small class="hint">${hint}</small></label>`;
  let fantasyPanel = '';
  if (fs) {
    if (!fantasyData) loadFantasy();
    const f = fantasyData;
    const control = f ? `<section class="card stack fx-admin-control">
        <div class="section-head"><h2>Game control</h2><span class="fx-state ${fs.enabled ? 'on' : 'off'}">${fs.enabled ? 'Open' : 'Paused'}</span></div>
        <p>Round <b>${f.round.number}</b> · ${dayLabel(f.round.start)} – ${dayLabel(f.round.end)} · next round starts ${dayLabel(f.round.next)} (in ${daysUntil(f.round.next, f.round.today)} days).</p>
        <p class="hint">${fs.enabled ? 'Members can pick teams and make transfers. Pausing closes transfers; scores keep counting.' : 'Transfers are closed for everyone. Scores keep counting. Open the game to let members change their teams.'}</p>
        <div class="actions"><button class="${fs.enabled ? '' : 'primary'}" data-fx-admin="${fs.enabled ? 'pause' : 'open'}">${fs.enabled ? 'Pause the game' : 'Open the game'}</button>
          <button class="danger" data-fx-admin="new-season">Start a new season</button></div>
        <p class="hint">A new season clears every team, transfer and price, and restarts from Round 1 this week. Club points are not touched.</p>
      </section>` : '<section class="card"><div class="fx-loading"><span></span><span></span><span></span></div></section>';
    const glance = f ? (() => {
      const mostPicked = [...f.players].sort((a, b) => b.selectedBy - a.selectedBy)[0];
      const leader = f.roundLeague[0];
      const average = f.league.length ? Math.round(f.league.reduce((sum, row) => sum + row.round, 0) / f.league.length) : 0;
      const rose = f.players.filter(player => player.change > 0).length, fell = f.players.filter(player => player.change < 0).length;
      const tile = (value, label) => `<div><b>${value}</b><small>${label}</small></div>`;
      return `<section class="card stack"><h2>Season at a glance</h2><div class="fx-card-stats">
        ${tile(f.managers, 'Managers')}${tile(f.players.length, 'Players')}${tile(average, 'Avg round pts')}
        ${tile(leader ? esc(firstName(leader.name)) : '–', 'Round leader')}${tile(mostPicked?.selectedBy ? esc(firstName(mostPicked.name)) : '–', 'Most picked')}${tile('▲' + rose + ' ▼' + fell, 'Price moves')}</div>
        ${f.players.length < fs.squadSize ? `<p class="notice">Only ${f.players.length} members have signed in, fewer than a ${fs.squadSize}-member team. Invite members, or lower the team size below.</p>` : ''}
        <a class="text-link" href="#fantasy">Open Fantasy as a member →</a></section>`;
    })() : '';
    const rules = `<section class="card stack fx-admin-rules"><h2>Rules</h2><p class="hint">Changes apply to every manager right away; members' pages update by themselves.</p>
      <form data-action="fantasy-settings">
        <fieldset><legend>Team</legend><div class="form-grid">
          ${field('Team size', 'squadSize', fs.squadSize, 'Members in each team (1–11).', 'min="1" max="11"')}
          ${field('Budget (m)', 'budget', cr(fs.budget), 'Money to spend on the team.', 'step="0.1" min="5" max="200"')}
          ${field('Captain multiplier', 'captainMultiplier', fs.captainMultiplier, 'The captain’s points are multiplied by this.', 'min="1" max="5"')}
          <label>Season start<input type="date" name="seasonStart" value="${esc(fs.seasonStart)}"><small class="hint">Round 1 starts the Monday of this week.</small></label>
        </div></fieldset>
        <fieldset><legend>Transfers</legend><div class="form-grid">
          ${field('Free transfers per round', 'freeTransfers', fs.freeTransfers, 'Changes allowed each round at no cost.', 'min="0" max="5"')}
          ${field('Cost per extra transfer (pts)', 'transferPenalty', fs.transferPenalty, 'Deducted from the next round’s score.', 'min="0" max="20"')}
        </div></fieldset>
        <fieldset><legend>Prices (change automatically every round)</legend><div class="form-grid">
          ${field('Start price (m)', 'startPrice', cr(fs.startPrice), 'Everyone starts here.', 'step="0.1" min="1" max="30"')}
          ${field('Price step (m)', 'priceStep', cr(fs.priceStep), 'Size of one rise or fall.', 'step="0.1" min="0" max="5"')}
          ${field('Points per rise', 'riseThreshold', fs.riseThreshold, 'One step up for every this many points.', 'min="1" max="100"')}
          ${field('Max rises per round', 'maxRiseSteps', fs.maxRiseSteps, 'Largest rise in one round, in steps.', 'min="1" max="10"')}
          ${field('Falls at or below (pts)', 'fallThreshold', fs.fallThreshold, 'A round this low drops the price one step.', 'min="-50" max="50"')}
          ${field('Lowest price (m)', 'minPrice', cr(fs.minPrice), 'Prices never go below this.', 'step="0.1" min="1" max="30"')}
          ${field('Highest price (m)', 'maxPrice', cr(fs.maxPrice), 'Prices never go above this.', 'step="0.1" min="1" max="30"')}
        </div></fieldset>
        <fieldset><legend>Team make-up</legend><div class="form-grid">
          ${field('Max per committee', 'maxPerCommittee', fs.maxPerCommittee, '0 means no limit.', 'min="0" max="11"')}
          ${field('Board members: minimum', 'boardMin', fs.boardMin, 'President, Co-President, Upper/High Board, Vice President.', 'min="0" max="11"')}
          ${field('Board members: maximum', 'boardMax', fs.boardMax, '', 'min="0" max="11"')}
          ${field('Heads: minimum', 'headMin', fs.headMin, 'Members with the Head role.', 'min="0" max="11"')}
          ${field('Heads: maximum', 'headMax', fs.headMax, '', 'min="0" max="11"')}
        </div></fieldset>
        <button class="primary">Save Fantasy rules</button></form></section>`;
    fantasyPanel = `<div class="stack">${control}${glance}</div>${rules}`;
  }
  const pointsPanel = can('points') ? `<section class="card stack"><h2>Adjust points</h2><form data-action="points" data-operation="${crypto.randomUUID()}"><label>Member<input name="memberName" list="points-members" required autocomplete="off" placeholder="Start typing a name"><datalist id="points-members">${scopedMembers().map(member => `<option value="${esc(pointsLabel(member))}"></option>`).join('')}</datalist></label><label>Adjustment<input type="number" name="amount" min="-100" max="100" required></label><label>Reason<input name="reason" maxlength="120" required></label><button class="primary">Record adjustment</button></form></section>
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
  const fullAccess = role => ['Admin', 'Assigned Admin', 'President', 'Co-President'].includes(role);
  const committeeOptions = selected => '<option value="">Unassigned</option>' + state.committees.map(item => `<option ${item.name === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const roleOptions = selected => state.boardRoles.map(role => `<option value="${esc(role)}" ${role === selected ? 'selected' : ''}>${esc(roleName(role))}</option>`).join('');
  const directory = state.boardDirectory || [];
  const accessLabels = { members: 'Members & roles', posts: 'Feed & polls', points: 'Points', learning: 'Quiz & resources', activities: 'Activities' };
  const accessChips = role => (state.boardRoleAccess?.[role] || []).map(key => `<span class="chip">${accessLabels[key] || esc(key)}</span>`).join('') || '<span class="chip off">No admin access</span>';
  const personStatus = person => !person.active ? ['Removed', 'off'] : person.signed_in ? ['Signed in', 'on'] : ['Not signed in yet', 'wait'];
  const memberRow = person => {
    const [status, tone] = personStatus(person);
    // The President can edit Co-Presidents; nobody edits the President from the app.
    // Admin edits everyone but other Admins; the President edits Co-Presidents; nobody else edits full-access accounts.
    const me = state.profile.role;
    const admins = ['Admin', 'Assigned Admin'];
    const locked = person.role === 'Admin' || (person.role === 'Assigned Admin' && me !== 'Admin') || (person.role === 'President' && !admins.includes(me)) || (person.role === 'Co-President' && ![...admins, 'President'].includes(me));
    const detail = (label, value) => `<div><dt>${label}</dt><dd>${esc(value) || '—'}</dd></div>`;
    return `<details class="member-row" data-search="${esc((person.name + ' ' + person.email + ' ' + person.position).toLowerCase())}" data-committee="${esc(person.committee)}"><summary>${avatar(person)}<span class="list-main"><strong>${esc(shortName(person.name))}</strong><small>${esc(person.committee || 'No committee')}${person.position ? ' · ' + esc(person.position) : ''}</small></span><span class="dot ${tone}" title="${status}"></span><span class="badge${fullAccess(person.role) ? ' board' : ''}">${esc(fullAccess(person.role) ? 'Full access' : person.role)}</span>${icon('chevron')}</summary>
      <dl class="member-details">${detail('Full name', person.name)}${detail('Email', person.email)}${detail('Committee', person.committee)}${detail('Position', person.position)}${detail('Role', roleName(person.role))}${detail('Status', status)}</dl>
      ${locked ? '<p class="hint">Full-access account. Only someone above this role can change it.</p>' : `<form class="member-form" data-action="directory-save"><input type="hidden" name="email" value="${esc(person.email)}"><div class="form-grid"><label>Full name<input name="name" required maxlength="60" value="${esc(person.name)}"></label><label>Role<select name="role">${roleOptions(person.role)}</select></label><label>Committee<select name="committee">${committeeOptions(person.committee)}</select></label><label>Position<input name="position" maxlength="60" value="${esc(person.position)}" placeholder="Optional"></label></div><div class="access"><span class="access-title">Access with this role</span><div class="access-chips">${accessChips(person.role)}</div></div><button class="primary">${person.active ? 'Save member' : 'Restore member'}</button></form>
      ${person.id && can('points') ? `<button class="history-btn" data-history="${esc(person.id)}">${icon('chart')} Points history</button>` : ''}
      ${person.active ? `<button class="danger remove-member" data-remove-member="${esc(person.email)}">Remove member</button>` : ''}`}</details>`;
  };
  const counts = directory.reduce((all, person) => { if (person.active) all[person.committee || ''] = (all[person.committee || ''] || 0) + 1; return all; }, {});
  const active = directory.filter(person => person.active);
  const memberPanel = can('members') ? `<section class="card stack directory"><div class="section-head"><h2>All members</h2><span class="count">${active.length} members · ${active.filter(person => person.signed_in).length} signed in</span></div>
    <div class="directory-tools"><input id="member-search" type="search" placeholder="Search name, email or position" aria-label="Search members"><select id="member-committee" aria-label="Filter by committee"><option value="*">All committees (${active.length})</option>${Object.keys(counts).sort().map(name => `<option value="${esc(name)}">${esc(name || 'No committee')} (${counts[name]})</option>`).join('')}</select></div>
    <div class="member-list">${directory.map(memberRow).join('') || '<p>No members yet. Add the first one.</p>'}</div><p id="no-members" hidden>No members match your search.</p></section>` : '';
  const addMemberPanel = can('members') ? `<section class="card stack"><h2>Add member</h2><p class="hint">They can sign in with Google using this email and get access right away.</p><form data-action="directory-save"><label>University email<input type="email" name="email" required maxlength="254" placeholder="name1234567@miuegypt.edu.eg"></label><label>Full name<input name="name" required maxlength="60"></label><div class="form-grid"><label>Committee<select name="committee">${committeeOptions('')}</select></label><label>Role<select name="role">${roleOptions('Member')}</select></label></div><div class="access"><span class="access-title">Access with this role</span><div class="access-chips">${accessChips('Member')}</div></div><label>Position<input name="position" maxlength="60" placeholder="Optional, e.g. Secretariat"></label><button class="primary">Add member</button></form></section>` : '';
  // Roles tab: the access matrix across the top, then assigning and creating roles side by side.
  const isCustom = role => (state.customRoles || []).some(item => item.name === role);
  const shortAccess = { members: 'Members', posts: 'Feed', points: 'Points', learning: 'Learning', activities: 'Activities' };
  const pill = (key, on) => `<label class="perm-pill" title="${accessLabels[key]}"><input type="checkbox" name="permissions" value="${key}" ${on ? 'checked' : ''}><span>${shortAccess[key]}</span></label>`;
  const accessRows = Object.entries(state.boardRoleAccess || {}).filter(([role]) => !['Admin', 'Assigned Admin'].includes(role) && (role !== 'President' || ['Admin', 'Assigned Admin'].includes(state.profile.role)));
  const accessCard = ['Admin', 'Assigned Admin', 'President'].includes(state.profile.role) ? `<section class="card stack roles-wide"><div class="card-title-row"><h2>Role access</h2><span class="hint">Tap to switch on or off, then Save. Applies right away to everyone with the role.</span></div>
    <div class="role-matrix">${accessRows.map(([role, granted]) => `<form class="role-line" data-action="role-access"><input type="hidden" name="role" value="${esc(role)}"><span class="role-name">${esc(roleName(role))}${isCustom(role) ? '<small>Custom</small>' : ''}</span><span class="perm-pills">${Object.keys(shortAccess).map(key => pill(key, granted.includes(key))).join('')}</span><span class="role-actions"><button class="primary">Save</button>${isCustom(role) || !['Member', ...(['Admin', 'Assigned Admin'].includes(state.profile.role) ? [] : ['President']), ...(state.profile.role === 'Admin' ? [] : ['Co-President'])].includes(role) ? `<button type="button" class="danger" data-delete-role="${esc(role)}" aria-label="Delete ${esc(roleName(role))}">Delete</button>` : ''}</span></form>`).join('')}</div>${(state.deletedRoles || []).length ? `<p class="hint">Deleted roles: ${state.deletedRoles.map(role => `<button type="button" data-restore-role="${esc(role)}">Restore ${esc(roleName(role))}</button>`).join(' ')}</p>` : ''}</section>` : '';
  const assignCard = `<section class="card stack"><h2>Assign a role by email</h2><p class="hint">Works before they sign in; the role applies on first Google sign-in.</p>
    <form data-action="member-email"><label>Google email<input type="email" name="email" maxlength="254" required placeholder="name1234567@miuegypt.edu.eg"></label>
    <div class="form-grid"><label>Role<select name="role">${state.boardRoles.map(role => `<option value="${esc(role)}">${esc(roleName(role))}</option>`).join('')}</select></label>
    <label>Committee<select name="committee"><option value="">Unassigned</option>${state.committees.map(item => `<option>${esc(item.name)}</option>`).join('')}</select></label></div><button class="primary">Save role</button></form>
    ${state.boardInvites.length ? '<h3 class="sub-head">Pending invitations</h3>' : ''}${state.boardInvites.map(invite => `<form class="list-row" data-action="member-invite-revoke"><span class="list-main"><strong>${esc(invite.email)}</strong><small>${esc(roleName(invite.role))}</small></span><input type="hidden" name="email" value="${esc(invite.email)}"><button class="danger">Revoke</button></form>`).join('')}</section>`;
  const createCard = ['Admin', 'Assigned Admin', 'President', 'Co-President', 'Upper Board'].includes(state.profile.role) ? `<section class="card stack"><h2>Create a role</h2><form data-action="custom-role"><label>Role name<input name="name" maxlength="40" required placeholder="e.g. Social Media Lead"></label>
    <div><span class="access-title">Permissions</span><span class="perm-pills">${Object.keys(shortAccess).map(key => pill(key, false)).join('')}</span></div><label class="choice"><input type="checkbox" name="committeeOnly">Only within their own committee (like a Head)</label><button class="primary">Create role</button></form></section>` : '';
  const rolePanel = can('members') ? accessCard + assignCard + createCard : '';
  const attendanceActivities = state.boardActivities.filter(item => Date.parse(item.starts_at) <= Date.now());
  const activityPanel = can('activities') ? `<section class="card stack"><h2>Publish activity</h2>
      <form data-action="activity"><label>Title<input name="title" required maxlength="100"></label><label>Type<select name="kind" data-post-type><option>Event</option><option>Training</option><option>Competition</option><option>Challenge</option><option>Organizing</option><option value="Other">Other</option></select></label><label class="custom-type" hidden>Your own type<input name="customKind" maxlength="30" placeholder="e.g. Workshop, Trip"></label><label>Start time in your device timezone<input name="starts" type="datetime-local" required></label><label>Audience<select name="committee">${state.scope ? '' : '<option value="">Entire club</option>'}${state.committees.map(item => `<option>${esc(item.name)}</option>`).join('')}</select></label><button class="primary">Publish activity</button></form>
      </section><section class="card stack"><h2>Record attendance</h2>${attendanceActivities.length ? `<form data-action="attendance"><label>Activity<select name="activity" required>${attendanceActivities.map(item => `<option value="${esc(item.id)}">${esc(item.title)} · ${esc(clubTime(item.starts_at))} Cairo</option>`).join('')}</select></label><label>Member<select name="member" required>${scopedMembers().map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><button class="primary">Record attendance</button></form>` : '<p>No activities have started yet. Attendance becomes available when an activity starts.</p>'}</section>` : '';
  const delivery = state.pushDelivery ? `<section class="card stack"><h2>Push delivery</h2><p>Last 24 hours. Accepted messages are tracked by OneSignal.</p>${state.pushDelivery.map(item => `<p>${esc(item.state)} · ${item.count}</p>`).join('') || '<p>No messages queued.</p>'}</section>` : '';
  const committeePanel = can('members') && !state.scope ? '<section class="card stack"><h2>Add committee</h2><form data-action="committee"><label>Name<input name="name" maxlength="60" required></label><button class="primary">Add committee</button></form></section>' : '';
  const sections = [
    { id: 'members', label: 'Members', content: memberPanel + `<div class="stack">${addMemberPanel}${committeePanel}</div>` },
    { id: 'roles', label: 'Roles & access', content: rolePanel },
    { id: 'feed', label: 'Feed & polls', content: postPanel },
    { id: 'activities', label: 'Activities', content: activityPanel },
    { id: 'points', label: 'Points', content: pointsPanel },
    { id: 'fantasy', label: 'Fantasy', content: fantasyPanel },
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

let lastRoute = '';
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
      <img class="login-logo" src="/logo-256.jpg" width="120" height="120" alt="MIU Model United Nations and Arab League XIX emblem">
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
  if (route !== lastRoute) { content.classList.remove('page-in'); void content.offsetWidth; content.classList.add('page-in'); lastRoute = route; }
  content.innerHTML = views[route]() + (notice && route !== 'admin' ? `<div class="notice" role="status">${esc(notice)}</div>` : '');
  notice = '';
  content.querySelectorAll('[data-pct]').forEach(bar => { bar.style.width = bar.dataset.pct + '%'; });
  content.querySelector('.admin-nav [aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (route === 'fantasy' && fantasyData && fxAnimate) { animateCounts(); fxAnimate = false; }
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
  if (event.target.id === 'fx-search') {
    playerQuery = event.target.value;
    const caret = event.target.selectionStart;
    render();
    const search = content.querySelector('#fx-search');
    search?.focus();
    search?.setSelectionRange(caret, caret);
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
    clearCache();
    state = undefined;
    session = { googleReady: true };
    render();
  }
  if (!response.ok) throw Error(payload.error || 'Unable to complete this request.');
  return payload;
}
// The last signed-in view is kept on this device so the app opens instantly; it is replaced by fresh data
// a moment later and removed on sign-out.
const cacheKey = 'mun-session-v1';
const saveCache = () => { try { if (state) localStorage.setItem(cacheKey, JSON.stringify(state)); } catch {} };
const clearCache = () => { try { localStorage.removeItem(cacheKey); } catch {} };
const quietToRender = () => !busy && !document.querySelector('#modal') && !document.activeElement?.matches('#content input, #content textarea, #content select');
async function loadSession() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch {}
  if (cached) { state = cached; session = { signedIn: true }; render(); }
  try {
    session = await api('session');
    state = session.data;
    if (state) saveCache(); else clearCache();
  } catch {
    if (!cached) session = { message: 'Start the portal server to connect to Google sign-in.' };
  }
  // Fresh data replaces the cached view, unless the member is already typing or busy.
  if (!cached || !state || quietToRender()) render();
  // pwa.js loads after this file, so wire install updates once the session is in.
  munInstall.onChange(() => { if (document.querySelector('#welcome')) showWelcome(true); });
  showWelcome();
  // Push setup and Fantasy data load after the page settles, so they never compete with the first paint.
  setTimeout(autoPush, 3000);
  if (state) (window.requestIdleCallback || (callback => setTimeout(callback, 2000)))(() => loadFantasy(), { timeout: 5000 });
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
  fantasySyncedAt = 0;
  const result = await api(action, fields);
  state = result.data;
  saveCache();
  notice = result.message;
}
const signOut = control => perform(control, async () => {
  stopCamera();
  try { await munPush.logout(); } catch {}
  await api('logout', {});
  clearCache();
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
  if (event.target.id === 'fx-sort') { playerSort = event.target.value; return render(); }
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
  if (!state || !button || (button.form && !button.dataset.deleteRole) || busy) return;
  if (button.dataset.signout !== undefined) return signOut(button);
  if (button.dataset.install !== undefined) return showWelcome(true);
  if (button.dataset.history) return showHistory(button);
  if (button.dataset.restoreRole) return perform(button, () => update('role-delete', { role: button.dataset.restoreRole, restore: 'true' }));
  if (button.dataset.deleteRole) {
    if (!confirm(`Delete the role "${roleName(button.dataset.deleteRole)}"? Everyone with it becomes a Member.`)) return;
    return perform(button, () => update('role-delete', { role: button.dataset.deleteRole }));
  }
  if (button.dataset.fxAdmin) {
    const step = button.dataset.fxAdmin;
    if (step === 'new-season' && !confirm('Start a new Fantasy season? Every team, transfer and price is cleared and Round 1 starts this week. Club points are kept.')) return;
    return perform(button, async () => {
      if (step === 'new-season') await update('fantasy-new-season', {});
      else await update('fantasy-settings', { enabled: step === 'open' ? 'true' : 'false' });
      fantasyData = await api('fantasy', {});
      fantasySyncedAt = Date.now();
    });
  }
  if (button.dataset.fx) return fantasyAction(button);
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
  if (action === 'fantasy-settings') ['budget', 'startPrice', 'priceStep', 'minPrice', 'maxPrice'].forEach(key => { fields[key] = String(Math.round(Number(fields[key]) * 10)); });
  if (action === 'points') {
    const input = form.querySelector('[name="memberName"]');
    const match = scopedMembers().find(member => pointsLabel(member) === fields.memberName) || scopedMembers().filter(member => member.name.toLowerCase() === fields.memberName.toLowerCase()).at(0);
    input.setCustomValidity(match ? '' : 'Choose a member from the list.');
    if (!input.reportValidity()) { input.addEventListener('input', () => input.setCustomValidity(''), { once: true }); return; }
    fields.member = match.id;
    delete fields.memberName;
  }
  if (action === 'role-access') fields.permissions = new FormData(form).getAll('permissions');
  if (action === 'custom-role') { fields.permissions = new FormData(form).getAll('permissions'); fields.committeeOnly = form.querySelector('[name="committeeOnly"]').checked; }
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
    // Reload Fantasy before the page redraws, so the confirmation stays on screen.
    if (action === 'fantasy-settings') { fantasyData = await api('fantasy', {}); fantasySyncedAt = Date.now(); }
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
      if (fantasyData) { fantasyData = null; draft = null; }
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
// The AI button steps aside while the footer credits are on screen.
const siteFooter = document.querySelector('.site-footer');
if (siteFooter && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => document.body.classList.toggle('footer-in-view', entry.isIntersecting)).observe(siteFooter);
}
loadSession();
