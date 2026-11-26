#!/usr/bin/env node
// Olundar evaluator: plays seeded campaigns with bot players and prints the scorecard.
//
//   node eval/run.mjs                 # tuning seeds, full scorecard
//   node eval/run.mjs --set hold      # held-out seeds (never tune against these)
//   node eval/run.mjs --n 12 --json out.json
//
// Every run is deterministic: the same seeds give the same numbers.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createGame, endTurn, isVisible } from '../src/rules.js';
import { BOTS, makeRng } from './bots.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const SET = opt('set', 'tune');
const N = Number(opt('n', 10));
const MAX_TURNS = Number(opt('turns', 150));
const BOT_NAMES = opt('bots', 'idle,novice,guided,skilled').split(',');
const DIFFS = opt('diffs', 'chronicle,standard,hollowCrown').split(',');
const SCENARIO = opt('scenario', 'founding');
const JSON_OUT = opt('json', null);
const QUIET = args.includes('--quiet');

export function playGame({ bot, difficultyId, seed, scenarioId = SCENARIO, maxTurns = MAX_TURNS }) {
  const state = createGame({ scenarioId, difficultyId, seed });
  const rng = makeRng(`${seed}-${bot}-bot`);
  const memo = {};
  const turnFn = BOTS[bot];
  const capital0 = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
  const m = {
    bot, difficultyId, seed, scenarioId,
    outcome: 'timeout', turns: 0,
    firstPlayerStrike: null, firstEnemyStrike: null,
    playerStrikes: 0, playerKills: 0,
    enemyStrikesOnUs: 0, unseenStrikesOnUs: 0, damageTaken: 0,
    unitsLost: 0, capitalMinFrac: 1, minArmy: Infinity,
    bossSlainTurn: null, endTurnMs: [], closeCall: false,
    bossKiller: null, portalBreaker: null, firstMineTurn: null, bossDistFromPortal: null, bossMaxWander: 0
  };
  const portal0 = state.buildings.find((b) => b.type === 'portal');
  const bossId = state.units.find((u) => u.type === 'lichBoss')?.id;
  const decisive = (events) => {
    for (const e of events || []) {
      if (e.kind !== 'strike') continue;
      if (e.targetType === 'lichBoss' && e.lethal) m.bossKiller = e.attackerFaction;
      if (e.counterLethal && e.attackerId === bossId) m.bossKiller = e.targetFaction;
      if (e.targetType === 'portal' && e.lethal) m.portalBreaker = e.attackerFaction;
    }
  };
  let prevIds = new Set(state.units.filter((u) => u.faction === 'olundar').map((u) => u.id));
  while (state.status === 'playing' && state.turn < maxTurns) {
    state.turnEvents = [];
    turnFn(state, rng, memo);
    decisive(state.turnEvents);
    for (const e of state.turnEvents || []) {
      if (e.kind !== 'strike' || e.attackerFaction !== 'olundar') continue;
      m.playerStrikes += 1;
      if (e.lethal) m.playerKills += 1;
      if (m.firstPlayerStrike === null) m.firstPlayerStrike = state.turn;
    }
    // What the player could see when they ended the turn.
    const seen = new Set(state.units.filter((u) => u.faction === 'dead' && isVisible(state, u.x, u.y)).map((u) => u.id));
    const t0 = performance.now();
    const bossBefore = state.units.find((u) => u.type === 'lichBoss');
    endTurn(state);
    m.endTurnMs.push(performance.now() - t0);
    decisive(state.turnEvents);
    if (bossBefore && !state.units.includes(bossBefore) && !m.bossKiller) m.bossKiller = 'other';
    const boss = state.units.find((u) => u.type === 'lichBoss');
    if (boss && portal0) m.bossMaxWander = Math.max(m.bossMaxWander, Math.abs(boss.x - portal0.x) + Math.abs(boss.y - portal0.y));
    for (const e of state.turnEvents || []) {
      if (e.kind !== 'strike' || e.attackerFaction !== 'dead' || e.targetFaction !== 'olundar') continue;
      m.enemyStrikesOnUs += 1;
      m.damageTaken += e.damage || 0;
      if (!seen.has(e.attackerId) && e.attackerId && !String(e.attackerId).startsWith('b')) {
        // Structures do not move; only count unseen units.
        if (state.units.some((u) => u.id === e.attackerId) || !state.buildings.some((b) => b.id === e.attackerId)) m.unseenStrikesOnUs += 1;
      }
      if (m.firstEnemyStrike === null) m.firstEnemyStrike = state.turn;
    }
    if (state.flags.bossSlain && m.bossSlainTurn === null) m.bossSlainTurn = state.turn;
    if (m.firstMineTurn === null && state.buildings.some((b) => b.faction === 'olundar' && b.type === 'mine' && b.turnsLeft <= 0)) m.firstMineTurn = state.turn;
    const ids = new Set(state.units.filter((u) => u.faction === 'olundar').map((u) => u.id));
    for (const id of prevIds) if (!ids.has(id)) m.unitsLost += 1;
    prevIds = ids;
    const capital = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
    if (capital) m.capitalMinFrac = Math.min(m.capitalMinFrac, capital.hp / (capital.maxHp || capital0.maxHp));
    const army = state.units.filter((u) => u.faction === 'olundar' && u.type !== 'engineer').length;
    if (state.turn > 10) m.minArmy = Math.min(m.minArmy, army);
  }
  m.outcome = state.status === 'won' ? 'won' : state.status === 'lost' ? 'lost' : 'timeout';
  if (m.outcome !== 'won') m.capitalMinFrac = state.status === 'lost' ? 0 : m.capitalMinFrac;
  m.turns = state.turn;
  m.closeCall = m.capitalMinFrac < 0.5;
  m.endTurnMaxMs = Math.max(0, ...m.endTurnMs);
  m.endTurnMeanMs = m.endTurnMs.reduce((a, b) => a + b, 0) / Math.max(1, m.endTurnMs.length);
  delete m.endTurnMs;
  return m;
}

export function seedsFor(set, n) {
  return Array.from({ length: n }, (_, i) => `${set}-${i}`);
}

function quantiles(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

const fmt = (x, d = 1) => (x === undefined || x === null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
const fq = (q, d = 0) => (q.n ? `${fmt(q.p50, d)} [${fmt(q.p10, d)}–${fmt(q.p90, d)}]` : '-');

export function summarize(games) {
  const by = {};
  for (const g of games) (by[`${g.bot}/${g.difficultyId}`] ||= []).push(g);
  const rows = {};
  for (const [k, gs] of Object.entries(by)) {
    const wins = gs.filter((g) => g.outcome === 'won');
    const losses = gs.filter((g) => g.outcome === 'lost');
    const strikesOn = gs.reduce((a, g) => a + g.enemyStrikesOnUs, 0);
    const unseen = gs.reduce((a, g) => a + g.unseenStrikesOnUs, 0);
    rows[k] = {
      n: gs.length,
      winRate: wins.length / gs.length,
      lossRate: losses.length / gs.length,
      timeoutRate: gs.filter((g) => g.outcome === 'timeout').length / gs.length,
      lossTurn: quantiles(losses.map((g) => g.turns)),
      winTurn: quantiles(wins.map((g) => g.turns)),
      survivalTurns: quantiles(gs.map((g) => g.turns)),
      firstStrike: quantiles(gs.map((g) => Math.min(g.firstPlayerStrike ?? 999, g.firstEnemyStrike ?? 999)).filter((x) => x < 999)),
      closeCallRateInWins: wins.length ? wins.filter((g) => g.closeCall).length / wins.length : null,
      unseenStrikeShare: strikesOn ? unseen / strikesOn : 0,
      unitsLost: quantiles(gs.map((g) => g.unitsLost)),
      kills: quantiles(gs.map((g) => g.playerKills)),
      bossTurn: quantiles(gs.filter((g) => g.bossSlainTurn).map((g) => g.bossSlainTurn)),
      endTurnMaxMs: Math.max(...gs.map((g) => g.endTurnMaxMs)),
      endTurnMeanMs: gs.reduce((a, g) => a + g.endTurnMeanMs, 0) / gs.length,
      // Wins where Olundar did not land the killing blow on Vorgath or the portal.
      unearnedWinShare: wins.length ? wins.filter((g) => g.bossKiller !== 'olundar' || g.portalBreaker !== 'olundar').length / wins.length : null,
      bossKilledByOthers: gs.filter((g) => g.bossKiller && g.bossKiller !== 'olundar').length / gs.length,
      bossWander: quantiles(gs.map((g) => g.bossMaxWander)),
      mineBy30: gs.filter((g) => g.firstMineTurn !== null && g.firstMineTurn <= 30).length / gs.length
    };
  }
  return rows;
}

// The scorecard: player-experience checks first, kept separate.
export function scorecard(rows, diffs = DIFFS) {
  const get = (bot, d) => rows[`${bot}/${d}`];
  const out = [];
  const std = 'standard';
  // 1. Skill matters: skilled win rate minus novice win rate on Standard.
  if (get('skilled', std) && get('novice', std)) {
    out.push({ check: 'Skill gap (Standard win% skilled − novice)', value: get('skilled', std).winRate - get('novice', std).winRate, target: '≥ 0.50', pass: get('skilled', std).winRate - get('novice', std).winRate >= 0.5, pct: true });
  }
  // 2. Fairness: a skilled player should rarely lose on Standard/Chronicle.
  for (const d of diffs.filter((x) => x !== 'hollowCrown')) {
    if (get('skilled', d)) out.push({ check: `Fairness: skilled loss rate (${d})`, value: get('skilled', d).lossRate, target: '≤ 0.10', pass: get('skilled', d).lossRate <= 0.1, pct: true });
  }
  // 3. Challenge exists: skilled should not breeze Hollow Crown, and neglect must lose.
  if (get('skilled', 'hollowCrown')) out.push({ check: 'Challenge: skilled win% (Hollow Crown)', value: get('skilled', 'hollowCrown').winRate, target: '0.30–0.85', pass: get('skilled', 'hollowCrown').winRate >= 0.3 && get('skilled', 'hollowCrown').winRate <= 0.85, pct: true });
  // 4. Pacing: first real fight early; skilled Standard win length reasonable.
  if (get('novice', std)) out.push({ check: 'Pacing: first strike turn (novice, Standard) p50', value: get('novice', std).firstStrike.p50, target: '≤ 8', pass: (get('novice', std).firstStrike.p50 ?? 99) <= 8 });
  if (get('skilled', std)) out.push({ check: 'Pacing: skilled win turn (Standard) p50', value: get('skilled', std).winTurn.p50, target: '50–110', pass: get('skilled', std).winTurn.p50 >= 50 && get('skilled', std).winTurn.p50 <= 110 });
  // 5. Tension: skilled wins that had a close call (capital under 50%).
  if (get('skilled', std)) {
    const v = get('skilled', std).closeCallRateInWins;
    out.push({ check: 'Tension: close-call share of skilled wins (Standard)', value: v, target: '0.15–0.60', pass: v !== null && v >= 0.15 && v <= 0.6, pct: true });
  }
  // 6. Readability: share of enemy strikes on us from units we could not see.
  if (get('skilled', std)) out.push({ check: 'Readability: strikes from unseen attackers (skilled, Standard)', value: get('skilled', std).unseenStrikeShare, target: '≤ 0.35', pass: get('skilled', std).unseenStrikeShare <= 0.35, pct: true });
  // 7. Readability of advice: a player who does what the War Council says gets iron.
  if (get('guided', std)) out.push({ check: 'Advice works: guided novice has a mine by turn 30 (Standard)', value: get('guided', std).mineBy30, target: '≥ 0.80', pass: get('guided', std).mineBy30 >= 0.8, pct: true });
  // 8. Responsiveness: End Turn compute in Node (proxy for phone hitch).
  const maxMs = Math.max(...Object.values(rows).map((r) => r.endTurnMaxMs));
  out.push({ check: 'Responsiveness: worst End Turn compute (ms, Node)', value: maxMs, target: '≤ 60', pass: maxMs <= 60 });
  return out;
}

function printRows(rows) {
  console.log('\nbot/difficulty        n  win%  loss%  t/o%  lossTurn            winTurn             firstStrike   close%  unseen%  lost   kills  bossTurn   endTurn mean/max ms');
  for (const [k, r] of Object.entries(rows)) {
    console.log(`${k.padEnd(20)} ${String(r.n).padStart(2)}  ${fmt(r.winRate * 100, 0).padStart(4)}  ${fmt(r.lossRate * 100, 0).padStart(5)}  ${fmt(r.timeoutRate * 100, 0).padStart(4)}  ${fq(r.lossTurn).padEnd(18)}  ${fq(r.winTurn).padEnd(18)}  ${fq(r.firstStrike).padEnd(12)}  ${r.closeCallRateInWins === null ? '   -' : fmt(r.closeCallRateInWins * 100, 0).padStart(4)}  ${fmt(r.unseenStrikeShare * 100, 0).padStart(6)}  ${fq(r.unitsLost).padEnd(5)}  ${fq(r.kills).padEnd(5)}  ${fq(r.bossTurn).padEnd(9)}  ${fmt(r.endTurnMeanMs, 1)}/${fmt(r.endTurnMaxMs, 0)}`);
  }
}

function printScorecard(card) {
  console.log('\nScorecard');
  for (const c of card) {
    const v = c.value === null || c.value === undefined ? '-' : c.pct ? `${fmt(c.value * 100, 0)}%` : fmt(c.value, 1);
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.check.padEnd(62)} ${String(v).padStart(7)}   target ${c.target}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const games = [];
  const t0 = performance.now();
  for (const difficultyId of DIFFS) {
    for (const bot of BOT_NAMES) {
      for (const seed of seedsFor(SET, N)) {
        const g = playGame({ bot, difficultyId, seed });
        games.push(g);
        if (!QUIET) process.stderr.write(`${bot}/${difficultyId}/${seed}: ${g.outcome} t${g.turns}  `);
      }
    }
  }
  if (!QUIET) process.stderr.write('\n');
  const rows = summarize(games);
  printRows(rows);
  const card = scorecard(rows);
  printScorecard(card);
  console.log(`\n${games.length} games on seed set "${SET}" (${SCENARIO}) in ${fmt((performance.now() - t0) / 1000, 1)}s`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ set: SET, n: N, rows, card, games }, null, 2));
}
