// Bot players for the Olundar evaluator. They play through the same rule calls the
// browser UI uses (moveUnit, attackUnit, startTraining, startConstruction, endTurn),
// so a bot can only do what a player can do. Each bot is deterministic given a seed.
import { BUILDING_TYPES, TERRAIN, UNIT_TYPES } from '../src/content.js';
import { makeRng, manhattan, neighbors4 } from '../src/map.js';
import {
  attackBuilding,
  attackOptionsFor,
  attackUnit,
  canAfford,
  canBuildOn,
  canEnter,
  canStillMove,
  effectiveMoveRange,
  forecastBuildingAttack,
  forecastUnitAttack,
  getWarCouncil,
  getUnitDef,
  isRevealed,
  isTileSupplied,
  isVisible,
  moveCostFor,
  moveUnit,
  startConstruction,
  startTraining,
  tileAt
} from '../src/rules.js';

const key = (x, y) => `${x},${y}`;
const COMBAT_TYPES = new Set(['legionary', 'spearGuard', 'archer', 'cavalry', 'onager', 'scout']);

// Same flood fill as the board's movementField (src/play/board.js): a unit can always
// take one step onto passable ground by spending its whole move.
export function reach(state, unit) {
  const out = new Map([[key(unit.x, unit.y), { x: unit.x, y: unit.y, cost: 0 }]]);
  if (!canStillMove(unit)) return out;
  const range = effectiveMoveRange(state, unit);
  const queue = [{ x: unit.x, y: unit.y, cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    for (const n of neighbors4(cur.x, cur.y)) {
      if (!canEnter(state, unit, n.x, n.y)) continue;
      const step = Math.min(moveCostFor(state, unit, n.x, n.y, cur), range);
      const cost = cur.cost + step;
      if (cost > range) continue;
      const id = key(n.x, n.y);
      if (out.has(id) && out.get(id).cost <= cost) continue;
      out.set(id, { x: n.x, y: n.y, cost });
      queue.push({ x: n.x, y: n.y, cost });
    }
  }
  return out;
}

// Ground distance ignoring units (for long-range steering).
function groundDistances(state, unit, tx, ty) {
  const dist = new Map([[key(tx, ty), 0]]);
  const queue = [{ x: tx, y: ty, d: 0 }];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const n of neighbors4(cur.x, cur.y)) {
      const tile = tileAt(state, n.x, n.y);
      if (!tile || !TERRAIN[tile.terrain].passable) continue;
      const id = key(n.x, n.y);
      if (dist.has(id)) continue;
      dist.set(id, cur.d + 1);
      queue.push({ x: n.x, y: n.y, d: cur.d + 1 });
    }
  }
  return dist;
}

function capitalOf(state) {
  return state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
}

function mine(state) {
  return state.units.filter((u) => u.faction === 'olundar');
}

function visibleFoes(state) {
  return state.units.filter((u) => u.faction === 'dead' && isVisible(state, u.x, u.y));
}

function res(state) {
  return state.factions.olundar.resources;
}

function moveTo(state, unit, x, y) {
  if (unit.x === x && unit.y === y) return { ok: true, stayed: true };
  return moveUnit(state, unit.id, x, y);
}

// Move one step of a unit toward a goal tile using ground distance.
function stepToward(state, unit, gx, gy, dmap = null) {
  if (!canStillMove(unit)) return false;
  const field = reach(state, unit);
  const dist = dmap || groundDistances(state, unit, gx, gy);
  let best = null;
  for (const spot of field.values()) {
    const d = dist.get(key(spot.x, spot.y));
    if (d === undefined) continue;
    if (!best || d < best.d || (d === best.d && spot.cost < best.cost)) best = { ...spot, d };
  }
  if (!best || (best.x === unit.x && best.y === unit.y)) return false;
  return moveTo(state, unit, best.x, best.y).ok;
}

function strikeScore(state, unit, target, forecast) {
  if (!forecast.ok) return -Infinity;
  if (target.kind === 'building') {
    const b = target.ref;
    if (b.type === 'portal' && !state.flags.bossSlain) return -5; // it reforms; kill Vorgath first
    let s = forecast.damage * 0.6 + (forecast.lethal ? 12 : 0);
    if (b.type === 'portal') s += 4;
    return s;
  }
  const foe = target.ref;
  const foeDef = getUnitDef(foe);
  let s = forecast.damage + (forecast.lethal ? 10 + foeDef.attack : 0);
  if (foe.type === 'lichBoss') s += 8;
  if (foe.march) s += 1;
  const counter = forecast.counter || 0;
  s -= counter * 1.2;
  if (counter >= unit.hp) s -= 30;
  return s;
}

function forecastFor(state, unit, target) {
  return target.kind === 'unit' ? forecastUnitAttack(state, unit.id, target.ref.id) : forecastBuildingAttack(state, unit.id, target.ref.id);
}

function doStrike(state, unit, target) {
  return target.kind === 'unit' ? attackUnit(state, unit.id, target.ref.id) : attackBuilding(state, unit.id, target.ref.id);
}

// Pick the best strike available from the unit's current tile.
function bestStrikeHere(state, unit, scorer = strikeScore) {
  let best = null;
  for (const target of attackOptionsFor(state, unit)) {
    const f = forecastFor(state, unit, target);
    const s = scorer(state, unit, target, f);
    if (!best || s > best.s) best = { target, s, f };
  }
  return best;
}

// Evaluate moving to each reachable tile and striking from there (simulated by
// temporarily relocating the unit; forecasts do not mutate state).
function bestMoveStrike(state, unit, { avoidExposure = true } = {}) {
  if (unit.hasActed) return null;
  const field = canStillMove(unit) ? reach(state, unit) : new Map([[key(unit.x, unit.y), { x: unit.x, y: unit.y, cost: 0 }]]);
  const ox = unit.x;
  const oy = unit.y;
  const oc = unit.charge;
  const foes = visibleFoes(state);
  let best = null;
  for (const spot of field.values()) {
    unit.x = spot.x;
    unit.y = spot.y;
    unit.charge = manhattan(ox, oy, spot.x, spot.y);
    const pick = bestStrikeHere(state, unit);
    if (pick && pick.s > 0) {
      let s = pick.s;
      if (avoidExposure) {
        const def = getUnitDef(unit);
        // Ranged units prefer tiles out of melee reach of surviving foes.
        const threats = foes.filter((f) => f.id !== pick.target.ref.id || !pick.f.lethal).filter((f) => manhattan(f.x, f.y, spot.x, spot.y) <= getUnitDef(f).move + getUnitDef(f).range).length;
        s -= threats * (def.range > 1 ? 1.5 : 0.5);
        const tile = tileAt(state, spot.x, spot.y);
        s += (TERRAIN[tile.terrain].defense || 0) * 0.5;
      }
      if (!best || s > best.s) best = { x: spot.x, y: spot.y, s, target: pick.target };
    }
  }
  unit.x = ox;
  unit.y = oy;
  unit.charge = oc;
  return best;
}

function executeMoveStrike(state, unit, plan) {
  if (plan.x !== unit.x || plan.y !== unit.y) {
    const moved = moveTo(state, unit, plan.x, plan.y);
    if (!moved.ok) return false;
  }
  if (unit.hasActed) return true;
  // Re-pick after moving: visibility may have changed.
  const pick = bestStrikeHere(state, unit);
  if (pick && pick.s > -5) doStrike(state, unit, pick.target);
  return true;
}

function buildSitesNear(state, engineer, type, maxDist = 6) {
  const out = [];
  for (let dy = -maxDist; dy <= maxDist; dy += 1) {
    for (let dx = -maxDist; dx <= maxDist; dx += 1) {
      const x = engineer.x + dx;
      const y = engineer.y + dy;
      if (Math.abs(dx) + Math.abs(dy) > maxDist) continue;
      if (!tileAt(state, x, y) || !isRevealed(state, x, y)) continue;
      out.push({ x, y, d: Math.abs(dx) + Math.abs(dy) });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

// Static site check a player can make from the map: terrain, supply, empty, revealed.
function siteOk(state, type, x, y) {
  const tile = tileAt(state, x, y);
  if (!tile || !isRevealed(state, x, y)) return false;
  if (!TERRAIN[tile.terrain].passable || tile.terrain === 'blight') return false;
  if (state.buildings.some((b) => b.x === x && b.y === y)) return false;
  if (type === 'farm' && !(tile.terrain === 'plains' || tile.terrain === 'marsh' || neighbors4(x, y).some((n) => tileAt(state, n.x, n.y)?.terrain === 'river'))) return false;
  if (type === 'lumberCamp' && tile.terrain !== 'forest') return false;
  if (type === 'mine' && !(tile.terrain === 'hills' || tile.terrain === 'ruins')) return false;
  if (!['road', 'wall', 'watchtower'].includes(type) && !isTileSupplied(state, x, y)) return false;
  return true;
}

function mineableTiles(state) {
  const out = [];
  for (const tile of state.map.tiles || []) {
    if ((tile.terrain === 'hills' || tile.terrain === 'ruins') && isRevealed(state, tile.x, tile.y) && !state.buildings.some((b) => b.x === tile.x && b.y === tile.y)) out.push(tile);
  }
  return out;
}

// Choose where an engineer should put `type`. Outposts go toward the nearest ore.
function chooseSite(state, eng, type) {
  const ore = type === 'outpost' ? mineableTiles(state) : null;
  let best = null;
  for (const tile of state.map.tiles) {
    if (manhattan(tile.x, tile.y, eng.x, eng.y) > 14 || !siteOk(state, type, tile.x, tile.y)) continue;
    const score = chooseSiteScore(state, eng, type, tile.x, tile.y, ore);
    if (score !== null && (!best || score < best.score)) best = { x: tile.x, y: tile.y, score };
  }
  return best;
}

// Build `type` now if the engineer stands beside a good site, else walk toward one.
function engineerBuild(state, eng, type) {
  if (eng.hasActed) return false;
  if (!canAfford(res(state), BUILDING_TYPES[type].cost)) return false;
  const site = chooseSite(state, eng, type);
  if (!site) return false;
  if (manhattan(eng.x, eng.y, site.x, site.y) <= 1 && canBuildOn(state, type, site.x, site.y).ok) {
    return startConstruction(state, eng.id, type, site.x, site.y).ok;
  }
  // Any adjacent valid tile that is nearly as good will do.
  for (const n of neighbors4(eng.x, eng.y)) {
    if (!canBuildOn(state, type, n.x, n.y).ok) continue;
    const alt = chooseSiteScore(state, eng, type, n.x, n.y, type === 'outpost' ? mineableTiles(state) : null);
    if (alt !== null && alt <= site.score + 1.5) return startConstruction(state, eng.id, type, n.x, n.y).ok;
  }
  return stepToward(state, eng, site.x, site.y);
}

function chooseSiteScore(state, eng, type, x, y, ore = null) {
  const capital = capitalOf(state);
  let score = manhattan(x, y, eng.x, eng.y) * 0.5;
  if (capital) score += manhattan(x, y, capital.x, capital.y) * 0.3;
  if (type === 'outpost') {
    if (!ore || !ore.length) return null;
    const d = Math.min(...ore.map((o) => manhattan(o.x, o.y, x, y)));
    if (d > 6) score += 20 + d;
    score += d * 2 - manhattan(x, y, capital.x, capital.y) * 0.3;
  }
  if (capital && manhattan(x, y, capital.x, capital.y) <= 1 && type !== 'road') score += 6;
  return score;
}

function countBuildings(state, type, includeUnfinished = true) {
  return state.buildings.filter((b) => b.faction === 'olundar' && b.type === type && (includeUnfinished || b.turnsLeft <= 0)).length;
}

function trainAt(state, type, unitType) {
  for (const b of state.buildings) {
    if (b.faction !== 'olundar' || b.type !== type || b.turnsLeft > 0) continue;
    if (startTraining(state, b.id, unitType).ok) return true;
  }
  return false;
}

function queued(state, unitType) {
  let n = 0;
  for (const b of state.buildings) if (b.faction === 'olundar') for (const q of b.queue || []) if (q.unitType === unitType) n += 1;
  return n;
}

// ---------------------------------------------------------------- Novice bot
// Plays like a first-time player: trains whatever it can afford, sends its
// soldiers at the nearest visible foe, strikes the first target it sees, never
// retreats, and leaves about a third of its units idle.
export function noviceTurn(state, rng, memo = {}) {
  const capital = capitalOf(state);
  // Training: one random affordable option per turn.
  const options = [];
  for (const b of state.buildings) {
    if (b.faction !== 'olundar' || b.turnsLeft > 0) continue;
    for (const t of BUILDING_TYPES[b.type].trains || []) options.push({ b, t });
  }
  if (options.length && rng() < 0.7) {
    const pick = options[Math.floor(rng() * options.length)];
    startTraining(state, pick.b.id, pick.t);
  }
  for (const unit of mine(state)) {
    if (!state.units.includes(unit) || unit.hasActed || memo.skip?.has(unit.id)) continue;
    if (rng() < 0.33) continue; // forgot about it
    if (unit.type === 'engineer') {
      const choices = ['farm', 'lumberCamp', 'mine', 'watchtower'];
      if (!engineerBuild(state, unit, choices[Math.floor(rng() * choices.length)]) && canStillMove(unit) && capital) {
        stepToward(state, unit, capital.x + Math.floor(rng() * 5) - 2, capital.y + Math.floor(rng() * 5) - 2);
      }
      continue;
    }
    const here = attackOptionsFor(state, unit);
    if (here.length) {
      doStrike(state, unit, here[0]);
      continue;
    }
    const foes = visibleFoes(state);
    if (foes.length) {
      foes.sort((a, b) => manhattan(a.x, a.y, unit.x, unit.y) - manhattan(b.x, b.y, unit.x, unit.y));
      stepToward(state, unit, foes[0].x, foes[0].y);
      if (!unit.hasActed) {
        const opts = attackOptionsFor(state, unit);
        if (opts.length) doStrike(state, unit, opts[0]);
      }
    } else if (unit.type === 'scout' && canStillMove(unit)) {
      // Wander east.
      stepToward(state, unit, Math.min(43, unit.x + 4), unit.y + Math.floor(rng() * 5) - 2);
    }
  }
}

// ---------------------------------------------------------------- Skilled bot
// Builds an economy, holds near the capital until it has an army, focus-fires
// with forecasts (archers first, avoids lethal counterblows), pulls wounded units
// back to heal, then marches on Vorgath with onagers and breaks the portal.
export function skilledTurn(state, rng, memo) {
  const capital = capitalOf(state);
  if (!capital) return;
  const r = res(state);
  const army = mine(state).filter((u) => COMBAT_TYPES.has(u.type) && u.type !== 'scout');
  const portal = state.buildings.find((b) => b.type === 'portal');
  const boss = state.units.find((u) => u.type === 'lichBoss');

  // ---- Economy: engineers follow a build order.
  const order = [
    ['farm', 2], ['mine', 1], ['lumberCamp', 2], ['archeryYard', 1], ['mine', 2], ['farm', 3],
    ['shrine', 1], ['workshop', 1], ['farm', 4], ['mine', 3], ['lumberCamp', 3]
  ];
  const minable = mineableTiles(state).some((t) => isTileSupplied(state, t.x, t.y));
  for (const eng of mine(state).filter((u) => u.type === 'engineer')) {
    if (eng.hasActed) continue;
    let done = false;
    for (let [type, n] of order) {
      if (countBuildings(state, type) >= n) continue;
      if (type === 'mine' && !minable) {
        if (countBuildings(state, 'outpost') >= 1 + countBuildings(state, 'mine')) continue;
        type = 'outpost';
      }
      if (!canAfford(r, BUILDING_TYPES[type].cost)) break; // save for it
      done = engineerBuild(state, eng, type);
      break;
    }
    if (!done && canStillMove(eng) && manhattan(eng.x, eng.y, capital.x, capital.y) > 3) stepToward(state, eng, capital.x, capital.y);
  }
  // Second engineer early.
  if (mine(state).filter((u) => u.type === 'engineer').length + queued(state, 'engineer') < 2 && state.turn > 2) trainAt(state, 'city', 'engineer');

  // ---- Training: keep a balanced army, onagers once a workshop stands.
  const counts = {};
  for (const u of mine(state)) counts[u.type] = (counts[u.type] || 0) + 1;
  const total = (t) => (counts[t] || 0) + queued(state, t);
  const reserve = { wood: 0, gold: 0, iron: 0 };
  // Leave room for the next building in the order.
  for (const [type, n] of order) {
    if (countBuildings(state, type) < n) {
      for (const [k, v] of Object.entries(BUILDING_TYPES[type].cost)) reserve[k] = v;
      break;
    }
  }
  const affordWithReserve = (cost) => Object.entries(cost).every(([k, v]) => (r[k] || 0) - (reserve[k] || 0) >= v);
  const wants = [];
  if (countBuildings(state, 'workshop', false) && total('onager') < 2 && army.length >= 6) wants.push(['workshop', 'onager']);
  if (total('archer') < Math.max(2, Math.floor(army.length / 3))) wants.push(['archeryYard', 'archer']);
  wants.push(['barracks', total('legionary') <= total('spearGuard') + 1 ? 'legionary' : 'spearGuard']);
  wants.push(['archeryYard', 'archer']);
  for (const [b, t] of wants) {
    if (affordWithReserve(UNIT_TYPES[t].cost)) trainAt(state, b, t);
  }

  // ---- Army posture.
  const ready = army.filter((u) => u.hp >= 0.6 * (u.maxHp || 1));
  const offensive = memo.offensive || (ready.length >= 9 && state.turn >= 20) || state.flags.bossSlain;
  memo.offensive = offensive && army.length >= 5;
  const objective = state.flags.bossSlain ? portal : (boss || portal);

  // Order: ranged first (soften), then melee (finish), then onagers.
  const rank = (u) => (u.type === 'archer' ? 0 : u.type === 'onager' ? 2 : 1);
  const units = mine(state).filter((u) => u.type !== 'engineer').sort((a, b) => rank(a) - rank(b));
  const gather = memo.offensive && objective ? objective : capital;
  const gatherDist = gather ? groundDistances(state, units[0] || capital, gather.x, gather.y) : null;
  for (const unit of units) {
    if (!state.units.includes(unit) || unit.hasActed) continue;
    const maxHp = unit.maxHp || getUnitDef(unit).hp;
    const wounded = unit.hp < 0.4 * maxHp;
    if (unit.type === 'scout') {
      // Scout: reveal toward the portal, avoid fights, retreat when hurt.
      const plan = bestMoveStrike(state, unit);
      if (plan && plan.s > 8) {
        executeMoveStrike(state, unit, plan);
        continue;
      }
      if (wounded) stepToward(state, unit, capital.x, capital.y);
      else if (portal && !isRevealed(state, portal.x, portal.y)) stepToward(state, unit, portal.x - 3, portal.y);
      else stepToward(state, unit, capital.x + 4, capital.y);
      continue;
    }
    if (wounded && !memo.offensive) {
      const pick = bestStrikeHere(state, unit);
      if (pick && pick.f.lethal && !(pick.f.counter > 0)) {
        doStrike(state, unit, pick.target);
        continue;
      }
      if (manhattan(unit.x, unit.y, capital.x, capital.y) > 1) stepToward(state, unit, capital.x, capital.y);
      continue;
    }
    const plan = bestMoveStrike(state, unit);
    if (plan) {
      executeMoveStrike(state, unit, plan);
      continue;
    }
    if (!canStillMove(unit)) continue;
    if (memo.offensive && objective) {
      // Advance as a body: wait for stragglers when far ahead.
      const myD = gatherDist?.get(key(unit.x, unit.y)) ?? 99;
      const others = army.filter((u) => u.id !== unit.id).map((u) => gatherDist?.get(key(u.x, u.y)) ?? 99).sort((a, b) => a - b);
      const median = others.length ? others[Math.floor(others.length / 2)] : myD;
      // Wait for stragglers only when well ahead of the body.
      if (myD >= median - 4 || unit.type === 'onager') stepToward(state, unit, objective.x, objective.y, gatherDist);
    } else {
      // Hold a ring two to four tiles east of the capital, toward the threat.
      const foes = visibleFoes(state).filter((f) => manhattan(f.x, f.y, capital.x, capital.y) <= 9);
      if (foes.length) {
        foes.sort((a, b) => manhattan(a.x, a.y, capital.x, capital.y) - manhattan(b.x, b.y, capital.x, capital.y));
        const f = foes[0];
        // Move to a tile at the foe's distance+... approach but stay compact.
        stepToward(state, unit, f.x, f.y);
      } else if (manhattan(unit.x, unit.y, capital.x + 2, capital.y) > 3) {
        stepToward(state, unit, capital.x + 2, capital.y);
      }
    }
  }
}

// ---------------------------------------------------------------- Guided novice
// A first-time player who reads the War Council and does what it literally says
// with their engineers (and otherwise plays like the novice). It measures whether
// the in-game advice can actually be followed.
function councilBuildOrder(state) {
  for (const item of getWarCouncil(state).priorities) {
    const text = item.text || '';
    let m = text.match(/Frontier Outpost at (\d+),(\d+)/);
    if (m) return { type: 'outpost', x: Number(m[1]), y: Number(m[2]) };
    m = text.match(/Hill Mine on the \w+ at (\d+),(\d+)/);
    if (m) return { type: 'mine', x: Number(m[1]), y: Number(m[2]) };
    if (/Hill Mine/.test(text)) return { type: 'mine' };
  }
  return null;
}

export function guidedTurn(state, rng, memo) {
  memo.skip = new Set();
  for (const eng of mine(state).filter((u) => u.type === 'engineer')) {
    if (eng.hasActed) continue;
    const order = councilBuildOrder(state);
    if (!order) continue;
    if (order.x === undefined) {
      // No place named: try the build beside the engineer, as a player clicking Hill Mine would.
      for (const n of neighbors4(eng.x, eng.y)) {
        if (canBuildOn(state, order.type, n.x, n.y).ok && startConstruction(state, eng.id, order.type, n.x, n.y).ok) break;
      }
      continue;
    }
    if (manhattan(eng.x, eng.y, order.x, order.y) <= 1 && canBuildOn(state, order.type, order.x, order.y).ok) {
      startConstruction(state, eng.id, order.type, order.x, order.y);
    } else if (canStillMove(eng)) {
      // Walk to a tile beside the named site (standing on it would block the build).
      const field = reach(state, eng);
      let best = null;
      for (const spot of field.values()) {
        const d = manhattan(spot.x, spot.y, order.x, order.y);
        const score = d === 0 ? 99 : d;
        if (!best || score < best.score || (score === best.score && spot.cost < best.cost)) best = { ...spot, score };
      }
      if (best && best.score < 99 && (best.x !== eng.x || best.y !== eng.y)) moveTo(state, eng, best.x, best.y);
      if (manhattan(eng.x, eng.y, order.x, order.y) === 1 && !eng.hasActed && canBuildOn(state, order.type, order.x, order.y).ok) {
        startConstruction(state, eng.id, order.type, order.x, order.y);
      }
    }
    memo.skip.add(eng.id); // the engineer is committed to the advice this turn
  }
  // "Send the scout along the roads": the scout follows the road out of the valley.
  const capital = capitalOf(state);
  if (capital && getWarCouncil(state).priorities.some((p) => /scout along the roads/.test(p.text || ''))) {
    for (const scout of mine(state).filter((u) => u.type === 'scout' && canStillMove(u))) {
      let best = null;
      for (const spot of reach(state, scout).values()) {
        const tile = tileAt(state, spot.x, spot.y);
        if (!tile.road) continue;
        const d = manhattan(spot.x, spot.y, capital.x, capital.y) + (memo.roadVisits?.[key(spot.x, spot.y)] ? -6 : 0);
        if (!best || d > best.d) best = { ...spot, d };
      }
      if (best && (best.x !== scout.x || best.y !== scout.y)) {
        moveTo(state, scout, best.x, best.y);
        memo.roadVisits = memo.roadVisits || {};
        memo.roadVisits[key(best.x, best.y)] = true;
        memo.skip.add(scout.id);
      }
    }
  }
  noviceTurn(state, rng, memo);
}

// ---------------------------------------------------------------- Idle bot
// Ends every turn without acting: measures how long neglect survives.
export function idleTurn() {}

export const BOTS = {
  idle: idleTurn,
  novice: noviceTurn,
  guided: guidedTurn,
  skilled: skilledTurn
};

export { makeRng };
