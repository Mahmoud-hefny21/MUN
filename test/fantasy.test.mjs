import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase } from '../database.mjs';
import { createFantasy, roundOf } from '../fantasy.mjs';

test('Fantasy squads, captain, transfers, automatic prices, leagues and rules', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MUN_TEST_POSTGRES = 'memory';
  const db = await createDatabase();
  let now = '2026-11-25'; // Wednesday of round 2026-11-23
  const fantasy = createFantasy({ ...db, today: () => now });
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  for (const id of ids) {
    await db.run('INSERT INTO mun_members(id,email,name,photo,active,role,committee) VALUES (?,?,?,?,1,?,?)', id, id + '@example.test', 'Delegate ' + id.toUpperCase(), '', 'Member', id < 'e' ? 'GA' : 'SC');
  }
  let sequence = 0;
  const award = (member, amount, date) => db.run('INSERT INTO mun_transactions(id,member,amount,reason,date,by) VALUES (?,?,?,?,?,?)', 'tx' + ++sequence, member, amount, 'Test', date, 'Board');
  const me = { id: 'a' };

  assert.equal(roundOf('2026-11-25'), '2026-11-23');
  assert.equal(roundOf('2026-11-23'), '2026-11-23');
  assert.equal(roundOf('2026-11-29'), '2026-11-23');

  // Round 1: everyone starts at the start price; no squad yet.
  let view = await fantasy.overview(me);
  assert.equal(view.round.number, 1);
  assert.equal(view.round.next, '2026-11-30');
  assert.ok(view.players.every(player => player.price === 60 && player.change === 0));
  assert.equal(view.squad, null);

  // Squad rules.
  const squad = ['b', 'c', 'd', 'e', 'f'];
  assert.equal(view.settings.squadSize, 11);
  assert.equal(view.settings.budget, 700);
  await fantasy.saveSettings({ squadSize: '5', budget: '320' });
  await assert.rejects(fantasy.saveSquad(me, { players: ['b', 'c'], captain: 'b' }), /exactly 5/);
  await assert.rejects(fantasy.saveSquad(me, { players: squad, captain: 'g' }), /captain/);
  await assert.rejects(fantasy.saveSquad(me, { players: ['b', 'c', 'd', 'e', 'zz'], captain: 'b' }), /active club members/);
  await fantasy.saveSettings({ budget: '250' });
  await assert.rejects(fantasy.saveSquad(me, { players: squad, captain: 'b' }), /costs 30\.0m; your budget is 25\.0m/);
  await fantasy.saveSettings({ budget: '320' });
  assert.deepEqual(await fantasy.saveSquad(me, { players: squad, captain: 'b' }), { transfers: 0, hit: 0, cost: 300 });
  assert.deepEqual(await fantasy.saveSquad({ id: 'h' }, { players: ['b', 'c', 'd', 'e', 'g'], captain: 'c' }), { transfers: 0, hit: 0, cost: 300 });
  view = await fantasy.overview(me);
  assert.equal(view.squad, null, 'a new squad plays from the next round');
  assert.deepEqual(view.upcoming.players.sort(), squad);
  assert.ok(view.achievements.find(item => item.id === 'squad').earned);

  // Round 2: points earned this week score for the squad, captain doubled. Nobody scored in round 1, so prices fall.
  now = '2026-12-02';
  await award('b', 6, '2026-12-01');
  await award('c', 2, '2026-12-01');
  await award('g', 3, '2026-12-02');
  await award('b', 9, '2026-11-24'); // round 1 points never count for round 2 squads
  await award('i', 15, '2026-12-01'); // a big round: three price steps next round
  view = await fantasy.overview(me);
  assert.equal(view.round.number, 2);
  assert.equal(view.me.round, 6 * 2 + 2);
  assert.equal(view.players.find(player => player.id === 'b').price, 62, 'b scored 9 in round 1: price rises');
  assert.equal(view.players.find(player => player.id === 'c').price, 58, 'c scored nothing in round 1: price falls');
  assert.equal(view.players.find(player => player.id === 'c').change, -2);
  assert.deepEqual(view.league.map(row => [row.id, row.total]), [['a', 14], ['h', 2 * 2 + 6 + 3]].sort((x, y) => y[1] - x[1]));
  assert.equal(view.dreamTeam[0].id, 'i', 'top scorer of the round leads the dream team');
  assert.equal(view.players.find(player => player.id === 'b').selectedBy, 100);

  // Round 3: prices follow round 2; two transfers with one free cost 4 points, applied next round.
  now = '2026-12-09';
  view = await fantasy.overview(me);
  assert.equal(view.players.find(player => player.id === 'b').price, 64);
  assert.equal(view.players.find(player => player.id === 'c').price, 58, 'c scored 2 in round 2: price holds');
  assert.equal(view.players.find(player => player.id === 'd').price, 56);
  assert.equal(view.players.find(player => player.id === 'i').price, 58 + 6, '15 points: +3 steps (0.6m), the per-round maximum');
  assert.equal(view.players.find(player => player.id === 'i').change, 6);
  assert.ok(view.achievements.find(item => item.id === 'captain').earned);
  assert.ok(view.achievements.find(item => item.id === 'winner').earned);
  const transfer = await fantasy.saveSquad(me, { players: ['b', 'c', 'd', 'g', 'h'], captain: 'c' });
  assert.equal(transfer.transfers, 2);
  assert.equal(transfer.hit, 4);
  assert.equal((await fantasy.saveSquad(me, { players: ['b', 'c', 'd', 'e', 'g'], captain: 'c' })).hit, 0, 're-saving counts against the playing squad');

  // Round 4: the hit is applied to the round the new squad plays.
  await fantasy.saveSquad(me, { players: ['b', 'c', 'd', 'g', 'h'], captain: 'c' });
  now = '2026-12-16';
  view = await fantasy.overview(me);
  assert.equal(view.me.round, -4);
  assert.equal(view.me.hit, 4);
  assert.equal(view.round.today, '2026-12-16');
  assert.deepEqual(view.squad.players.sort(), ['b', 'c', 'd', 'g', 'h']);

  // Team make-up: per-committee limit and Board / Head minimums and maximums.
  await db.run("UPDATE mun_members SET role='Vice President' WHERE id='b'");
  await db.run("UPDATE mun_members SET role='Head' WHERE id='c'");
  view = await fantasy.overview(me);
  assert.equal(view.players.find(player => player.id === 'b').category, 'board');
  assert.equal(view.players.find(player => player.id === 'c').category, 'head');
  assert.equal(view.players.find(player => player.id === 'd').category, 'member');
  await fantasy.saveSettings({ maxPerCommittee: '2' });
  await assert.rejects(fantasy.saveSquad(me, { players: ['b', 'c', 'd', 'g', 'h'], captain: 'c' }), /at most 2 from GA/);
  await fantasy.saveSettings({ maxPerCommittee: '0', boardMax: '0' });
  await assert.rejects(fantasy.saveSquad(me, { players: ['b', 'e', 'f', 'g', 'h'], captain: 'e' }), /at most 0 board members/);
  await fantasy.saveSettings({ boardMax: '11', headMin: '1' });
  await assert.rejects(fantasy.saveSquad(me, { players: ['b', 'e', 'f', 'g', 'h'], captain: 'e' }), /at least 1 Heads/);
  assert.equal((await fantasy.saveSquad(me, { players: ['c', 'e', 'f', 'g', 'h'], captain: 'c' })).transfers >= 0, true);
  await assert.rejects(fantasy.saveSettings({ boardMin: '3', boardMax: '2' }), /minimum must not be above/);
  await assert.rejects(fantasy.saveSettings({ boardMin: '4', headMin: '2' }), /fit in the team/);
  await fantasy.saveSettings({ headMin: '0' });

  // Rules: validated and configurable.
  await assert.rejects(fantasy.saveSettings({ minPrice: '100', maxPrice: '50' }), /minimum price/);
  await assert.rejects(fantasy.saveSettings({ squadSize: '0' }), /between 1 and 11/);
  await assert.rejects(fantasy.saveSettings({ fallThreshold: '9', riseThreshold: '5' }), /fall threshold/);
  const saved = await fantasy.saveSettings({ captainMultiplier: '3', enabled: 'false' });
  assert.equal(saved.captainMultiplier, 3);
  await assert.rejects(fantasy.saveSquad(me, { players: ['b', 'c', 'd', 'g', 'h'], captain: 'c' }), /paused/);
  await db.close();
});
