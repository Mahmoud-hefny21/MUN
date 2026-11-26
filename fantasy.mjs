// MUN Fantasy: an FPL-style game on top of the club's real points.
// Players are active members; their points in a round are the points they earned that week (mun_transactions).
// Managers pick a squad within a budget and a captain; squad changes apply from the next round (the deadline),
// extra transfers cost points, and prices move each round with the player's last-round performance.
// Prices are integers in tenths of a credit (60 = 6.0 cr). Rounds are Cairo weeks starting Monday (YYYY-MM-DD).

export const defaultSettings = {
  enabled: true,
  seasonStart: '',        // Monday of round 1; set on first use
  budget: 320,            // 32.0 cr
  squadSize: 5,
  captainMultiplier: 2,
  freeTransfers: 1,
  transferPenalty: 4,
  startPrice: 60,         // 6.0 cr
  priceStep: 2,           // 0.2 cr
  riseThreshold: 5,       // round points at or above this raise the price
  fallThreshold: 0,       // round points at or below this lower the price
  minPrice: 40,
  maxPrice: 120
};
const limits = {
  budget: [50, 2000], squadSize: [1, 11], captainMultiplier: [1, 5], freeTransfers: [0, 5], transferPenalty: [0, 20],
  startPrice: [10, 300], priceStep: [0, 50], riseThreshold: [1, 100], fallThreshold: [-50, 50], minPrice: [10, 300], maxPrice: [10, 300]
};

const addDays = (date, days) => {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
export const roundOf = date => {
  const value = new Date(date + 'T00:00:00Z');
  return addDays(date, -((value.getUTCDay() + 6) % 7));
};

export function createFantasy({ run, get, all, transact, today }) {
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };

  async function settings() {
    const row = await get("SELECT value FROM mun_settings WHERE key='fantasy'");
    const saved = row ? JSON.parse(row.value) : {};
    const merged = { ...defaultSettings, ...saved };
    if (!merged.seasonStart) {
      merged.seasonStart = roundOf(today());
      await run("INSERT INTO mun_settings(key, value) VALUES ('fantasy', ?) ON CONFLICT(key) DO NOTHING", JSON.stringify(merged));
    }
    return merged;
  }

  async function saveSettings(input) {
    const current = await settings();
    const next = { ...current };
    for (const [key, [min, max]] of Object.entries(limits)) {
      if (input[key] === undefined || input[key] === '') continue;
      const value = Number(input[key]);
      if (!Number.isInteger(value) || value < min || value > max) fail('Choose a whole number between ' + min + ' and ' + max + ' for ' + key + '.');
      next[key] = value;
    }
    if (input.enabled !== undefined) next.enabled = input.enabled === true || input.enabled === 'true' || input.enabled === '1';
    if (input.seasonStart) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.seasonStart)) fail('Choose a valid season start date.');
      next.seasonStart = roundOf(input.seasonStart);
    }
    if (next.minPrice > next.maxPrice) fail('The minimum price must not be above the maximum price.');
    if (next.startPrice < next.minPrice || next.startPrice > next.maxPrice) fail('The start price must be between the minimum and maximum prices.');
    if (next.fallThreshold >= next.riseThreshold) fail('The fall threshold must be below the rise threshold.');
    await run("INSERT INTO mun_settings(key, value) VALUES ('fantasy', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(next));
    return next;
  }

  // Player points per round, bucketed from daily transactions since the season start.
  async function roundPoints(seasonStart) {
    const rows = await all('SELECT member, date, SUM(amount)::integer AS points FROM mun_transactions WHERE date >= ? GROUP BY member, date', seasonStart);
    const byPlayer = new Map();
    for (const row of rows) {
      const round = roundOf(row.date);
      const map = byPlayer.get(row.member) || new Map();
      map.set(round, (map.get(round) || 0) + row.points);
      byPlayer.set(row.member, map);
    }
    return byPlayer;
  }

  // Prices for a round are fixed once, at the start of the round, from each player's previous-round performance.
  async function ensurePrices(round, config, pointsByPlayer) {
    if (await get('SELECT 1 AS found FROM mun_fantasy_prices WHERE round=? LIMIT 1', round)) return;
    await transact(async () => {
      await get('SELECT pg_advisory_xact_lock(1282370243)');
      if (await get('SELECT 1 AS found FROM mun_fantasy_prices WHERE round=? LIMIT 1', round)) return;
      const previous = await all(`SELECT DISTINCT ON (player) player, price, round FROM mun_fantasy_prices
        WHERE round < ? ORDER BY player, round DESC`, round);
      const last = new Map(previous.map(row => [row.player, row]));
      const players = await all('SELECT id FROM mun_members WHERE active=1');
      const lastRound = addDays(round, -7);
      for (const { id } of players) {
        const before = last.get(id);
        let price = before ? before.price : config.startPrice;
        if (before) {
          const scored = pointsByPlayer.get(id)?.get(lastRound) || 0;
          if (scored >= config.riseThreshold) price += config.priceStep;
          else if (scored <= config.fallThreshold) price -= config.priceStep;
        }
        price = Math.min(config.maxPrice, Math.max(config.minPrice, price));
        await run('INSERT INTO mun_fantasy_prices(player, round, price) VALUES (?,?,?) ON CONFLICT DO NOTHING', id, round, price);
      }
    });
  }

  // Everything the Fantasy page needs, computed in one pass (a handful of queries, no per-player queries).
  async function overview(member) {
    const config = await settings();
    const current = roundOf(today());
    const next = addDays(current, 7);
    const pointsByPlayer = await roundPoints(config.seasonStart);
    await ensurePrices(current, config, pointsByPlayer);
    const [players, prices, picks, entries] = await Promise.all([
      all('SELECT id, name, committee, photo FROM mun_members WHERE active=1 ORDER BY name'),
      all('SELECT player, round, price FROM mun_fantasy_prices WHERE round IN (?, ?)', current, addDays(current, -7)),
      all('SELECT manager, round, player, captain FROM mun_fantasy_picks WHERE round >= ? ORDER BY manager, round', config.seasonStart),
      all('SELECT manager, round, transfers, hit FROM mun_fantasy_entries WHERE round >= ?', config.seasonStart)
    ]);
    const priceNow = new Map(), priceBefore = new Map();
    for (const row of prices) (row.round === current ? priceNow : priceBefore).set(row.player, row.price);

    // Squads per manager: round -> { players, captain }; a squad carries over until the manager changes it.
    const squadsByManager = new Map();
    for (const pick of picks) {
      const rounds = squadsByManager.get(pick.manager) || new Map();
      const squad = rounds.get(pick.round) || { players: [], captain: null };
      squad.players.push(pick.player);
      if (pick.captain) squad.captain = pick.player;
      rounds.set(pick.round, squad);
      squadsByManager.set(pick.manager, rounds);
    }
    const hits = new Map(entries.map(row => [row.manager + ':' + row.round, row]));
    const squadFor = (manager, round) => {
      const rounds = squadsByManager.get(manager);
      if (!rounds) return null;
      let found = null;
      for (const [start, squad] of rounds) if (start <= round && (!found || start > found.start)) found = { start, ...squad };
      return found;
    };
    const playerRound = (player, round) => pointsByPlayer.get(player)?.get(round) || 0;

    // Rounds from the season start to the current one.
    const rounds = [];
    for (let round = config.seasonStart; round <= current; round = addDays(round, 7)) rounds.push(round);
    const scoreFor = (manager, round) => {
      const squad = squadFor(manager, round);
      if (!squad) return null;
      const raw = squad.players.reduce((sum, player) => sum + playerRound(player, round) * (player === squad.captain ? config.captainMultiplier : 1), 0);
      return raw - (hits.get(manager + ':' + round)?.hit || 0);
    };
    const names = new Map(players.map(player => [player.id, player]));
    const table = [...squadsByManager.keys()].filter(id => names.has(id)).map(id => {
      const history = rounds.map(round => ({ round, points: scoreFor(id, round) })).filter(item => item.points !== null);
      return { id, name: names.get(id).name, committee: names.get(id).committee, total: history.reduce((sum, item) => sum + item.points, 0),
        round: scoreFor(id, current) ?? 0, history };
    }).sort((a, b) => b.total - a.total || b.round - a.round || a.name.localeCompare(b.name));
    table.forEach((row, index) => { row.rank = index + 1; });
    const roundTable = [...table].sort((a, b) => b.round - a.round || a.name.localeCompare(b.name));

    // Selection share of the current round's squads.
    const owners = new Map();
    let squads = 0;
    for (const manager of squadsByManager.keys()) {
      const squad = squadFor(manager, current);
      if (!squad) continue;
      squads++;
      for (const player of squad.players) owners.set(player, (owners.get(player) || 0) + 1);
    }
    const lastThree = [0, 1, 2].map(offset => addDays(current, -7 * (offset + 1)));
    const pool = players.map(player => ({
      id: player.id, name: player.name, committee: player.committee, photo: player.photo,
      price: priceNow.get(player.id) ?? config.startPrice,
      change: priceBefore.has(player.id) && priceNow.has(player.id) ? priceNow.get(player.id) - priceBefore.get(player.id) : 0,
      roundPoints: playerRound(player.id, current),
      lastRound: playerRound(player.id, addDays(current, -7)),
      total: rounds.reduce((sum, round) => sum + playerRound(player.id, round), 0),
      form: Math.round(10 * lastThree.reduce((sum, round) => sum + playerRound(player.id, round), 0) / 3) / 10,
      selectedBy: squads ? Math.round(100 * (owners.get(player.id) || 0) / squads) : 0
    }));

    const mine = squadFor(member.id, current);
    const upcoming = squadsByManager.get(member.id)?.get(next) || null;
    const me = table.find(row => row.id === member.id);
    const bestRound = Math.max(0, ...table.flatMap(row => row.history.filter(item => item.round < current).map(item => item.points)));
    const completedWins = rounds.filter(round => round < current).map(round => {
      const scores = table.map(row => ({ id: row.id, points: row.history.find(item => item.round === round)?.points })).filter(item => item.points !== undefined)
        .sort((a, b) => b.points - a.points);
      return scores.findIndex(item => item.id === member.id);
    }).filter(position => position >= 0);
    const captainHaul = rounds.some(round => { const squad = squadFor(member.id, round); return squad?.captain && playerRound(squad.captain, round) >= config.riseThreshold; });
    const achievements = [
      ['squad', 'Squad builder', 'Pick your first squad', Boolean(mine || upcoming)],
      ['captain', 'Captain’s armband', 'Your captain scores ' + config.riseThreshold + '+ in a round', captainHaul],
      ['podium', 'Podium finish', 'Finish a round in the top 3', completedWins.some(position => position < 3)],
      ['winner', 'Round winner', 'Win a round', completedWins.includes(0)],
      ['century', 'Century', 'Reach 100 fantasy points', (me?.total || 0) >= 100]
    ].map(([id, title, detail, earned]) => ({ id, title, detail, earned }));

    return {
      settings: config,
      round: { number: rounds.length, start: current, end: addDays(current, 6), next },
      players: pool,
      squad: mine ? { players: mine.players, captain: mine.captain } : null,
      upcoming: upcoming ? { players: upcoming.players, captain: upcoming.captain, ...(hits.get(member.id + ':' + next) || { transfers: 0, hit: 0 }) } : null,
      me: me ? { total: me.total, round: me.round, rank: me.rank, roundRank: roundTable.findIndex(row => row.id === member.id) + 1, history: me.history } : null,
      managers: table.length,
      league: table.slice(0, 50).map(({ history, ...row }) => row),
      roundLeague: roundTable.slice(0, 10).map(({ history, ...row }) => row),
      dreamTeam: [...pool].filter(player => player.roundPoints > 0).sort((a, b) => b.roundPoints - a.roundPoints || a.name.localeCompare(b.name)).slice(0, config.squadSize),
      bestRound,
      achievements
    };
  }

  // Save the squad for the next round. Transfers are counted against the squad playing this round.
  async function saveSquad(member, input) {
    const config = await settings();
    if (!config.enabled) fail('Fantasy is paused by the board.', 403);
    const chosen = Array.isArray(input.players) ? [...new Set(input.players.map(String))] : [];
    if (chosen.length !== config.squadSize) fail('Pick exactly ' + config.squadSize + ' delegates.');
    if (chosen.includes(member.id)) fail('You cannot pick yourself.');
    const captain = String(input.captain || '');
    if (!chosen.includes(captain)) fail('Choose a captain from your squad.');
    const current = roundOf(today());
    const next = addDays(current, 7);
    await ensurePrices(current, config, await roundPoints(config.seasonStart));
    const rows = await all('SELECT m.id, COALESCE(p.price, ?) AS price FROM mun_members m LEFT JOIN mun_fantasy_prices p ON p.player=m.id AND p.round=? WHERE m.active=1 AND m.id = ANY(?::text[])',
      config.startPrice, current, chosen);
    if (rows.length !== chosen.length) fail('Pick active club members only.');
    const cost = rows.reduce((sum, row) => sum + row.price, 0);
    if (cost > config.budget) fail('This squad costs ' + (cost / 10).toFixed(1) + ' cr; your budget is ' + (config.budget / 10).toFixed(1) + ' cr.');
    return transact(async () => {
      await get('SELECT pg_advisory_xact_lock(hashtext(?))', 'fantasy:' + member.id);
      const playing = await all(`SELECT player FROM mun_fantasy_picks WHERE manager=? AND round = (
        SELECT MAX(round) FROM mun_fantasy_picks WHERE manager=? AND round <= ?)`, member.id, member.id, current);
      const transfers = playing.length ? chosen.filter(id => !playing.some(row => row.player === id)).length : 0;
      const hit = Math.max(0, transfers - config.freeTransfers) * config.transferPenalty;
      await run('DELETE FROM mun_fantasy_picks WHERE manager=? AND round=?', member.id, next);
      for (const id of chosen) await run('INSERT INTO mun_fantasy_picks(manager, round, player, captain) VALUES (?,?,?,?)', member.id, next, id, id === captain);
      await run(`INSERT INTO mun_fantasy_entries(manager, round, transfers, hit) VALUES (?,?,?,?)
        ON CONFLICT(manager, round) DO UPDATE SET transfers=excluded.transfers, hit=excluded.hit`, member.id, next, transfers, hit);
      return { transfers, hit, cost };
    });
  }

  return { settings, saveSettings, overview, saveSquad };
}
