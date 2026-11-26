// Reference copy of the original findPath (sorted-array frontier, full unit scans).
// The quality gate compares the optimized findPath in src/rules.js against it on
// many generated boards; any difference in cost or route is a bug.
import { TERRAIN } from '../../src/content.js';
import { idx, inBounds, neighbors4 } from '../../src/map.js';
import { buildingAt, canEnter, isEnemy, moveCostFor, tileAt, unitAt } from '../../src/rules.js';

function canPassThrough(state, unit, x, y) {
  if (canEnter(state, unit, x, y)) return true;
  const tile = tileAt(state, x, y);
  if (!tile || !TERRAIN[tile.terrain].passable) return false;
  const occupant = unitAt(state, x, y);
  if (!occupant || occupant.faction !== unit.faction) return false;
  const building = buildingAt(state, x, y);
  return !(building && isEnemy(state, unit.faction, building.faction));
}

function canCrossGround(state, unit, x, y) {
  const tile = tileAt(state, x, y);
  if (!tile || !TERRAIN[tile.terrain].passable) return false;
  const building = buildingAt(state, x, y);
  return !(building && isEnemy(state, unit.faction, building.faction));
}

export function referenceFindPath(state, unit, tx, ty, maxCost = Infinity, options = {}) {
  if (!inBounds(tx, ty)) return null;
  if (!options.ignoreUnits && !canEnter(state, unit, tx, ty) && !(unit.x === tx && unit.y === ty)) return null;
  const passable = options.ignoreUnits ? canCrossGround : options.passFriendly ? canPassThrough : canEnter;
  const startKey = idx(unit.x, unit.y);
  const targetKey = idx(tx, ty);
  const costs = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const frontier = [{ x: unit.x, y: unit.y, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    const currentKey = idx(current.x, current.y);
    if (currentKey === targetKey) break;
    for (const n of neighbors4(current.x, current.y)) {
      if (!passable(state, unit, n.x, n.y) && !(n.x === tx && n.y === ty)) continue;
      const step = Math.min(moveCostFor(state, unit, n.x, n.y, current), maxCost);
      const nextCost = current.cost + step;
      if (nextCost > maxCost) continue;
      const key = idx(n.x, n.y);
      if (!costs.has(key) || nextCost < costs.get(key)) {
        costs.set(key, nextCost);
        cameFrom.set(key, currentKey);
        frontier.push({ x: n.x, y: n.y, cost: nextCost });
      }
    }
  }
  if (!costs.has(targetKey)) return null;
  const path = [];
  let key = targetKey;
  while (key !== startKey) {
    path.unshift(key);
    key = cameFrom.get(key);
  }
  return { cost: costs.get(targetKey), path };
}
