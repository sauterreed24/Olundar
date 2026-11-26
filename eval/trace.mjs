#!/usr/bin/env node
// Trace one seeded game turn by turn: node eval/trace.mjs skilled standard tune-0 [every]
import { createGame, endTurn } from '../src/rules.js';
import { BOTS, makeRng } from './bots.mjs';
const [bot = 'skilled', difficultyId = 'standard', seed = 'tune-0', every = '5', scenarioId = 'founding'] = process.argv.slice(2);
const state = createGame({ scenarioId, difficultyId, seed });
const rng = makeRng(`${seed}-${bot}-bot`);
const memo = {};
while (state.status === 'playing' && state.turn < 150) {
  BOTS[bot](state, rng, memo);
  endTurn(state);
  const cap = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
  const ours = state.units.filter((u) => u.faction === 'olundar');
  const dead = state.units.filter((u) => u.faction === 'dead');
  const marching = dead.filter((u) => u.march).length;
  const near = cap ? dead.filter((u) => Math.abs(u.x - cap.x) + Math.abs(u.y - cap.y) <= 6).length : 0;
  const r = state.factions.olundar.resources;
  if (state.turn % Number(every) === 0 || state.status !== 'playing') {
    const types = {};
    for (const u of ours) types[u.type] = (types[u.type] || 0) + 1;
    const blds = {};
    for (const b of state.buildings.filter((b) => b.faction === 'olundar' && b.type !== 'road')) blds[b.type] = (blds[b.type] || 0) + 1;
    console.log(`t${state.turn} cap ${cap?.hp ?? 0} ours ${ours.length} ${JSON.stringify(types)} dead ${dead.length} march ${marching} near ${near} off ${!!memo.offensive} boss ${state.flags.bossSlain} res f${r.food} w${r.wood} s${r.stone} i${r.iron} g${r.gold} m${r.morale} | ${JSON.stringify(blds)}`);
  }
}
console.log(state.status, state.turn);
console.log(state.messages.slice(-8).map((m) => m.text).join('\n'));
