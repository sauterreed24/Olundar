import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDING_TYPES, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from '../src/content.js';
import {
  attackBuilding,
  attackUnit,
  canAfford,
  createGame,
  endTurn,
  findPath,
  getEndTurnWarnings,
  getObjectiveProgress,
  getReadyOlundarUnits,
  getWarCouncil,
  moveUnit,
  startConstruction,
  startTraining,
  trainingQueueLimit,
  tileAt,
  upgradeBuilding,
  unitAt
} from '../src/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const failures = [];
const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listFiles(dir, suffixes = ['.js', '.mjs']) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    const stat = statSync(file);
    if (stat.isDirectory()) out.push(...listFiles(file, suffixes));
    else if (suffixes.includes(path.extname(file))) out.push(file);
  }
  return out;
}

check('source files parse under Node', () => {
  for (const file of listFiles(root)) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
});

check('content tables are internally consistent', () => {
  for (const [id, unit] of Object.entries(UNIT_TYPES)) {
    assert(unit.id === id, `Unit ${id} has mismatched id.`);
    assert(unit.hp > 0 && unit.move > 0 && unit.sight > 0, `Unit ${id} has invalid stats.`);
    assert(unit.range >= 1 && unit.attack >= 0, `Unit ${id} has invalid combat.`);
    assert(Number.isInteger(unit.trainTurns) && unit.trainTurns > 0, `Unit ${id} train turns invalid.`);
  }
  for (const [id, building] of Object.entries(BUILDING_TYPES)) {
    assert(building.id === id, `Building ${id} has mismatched id.`);
    assert(building.hp > 0, `Building ${id} needs hp.`);
    for (const unitType of building.trains) assert(UNIT_TYPES[unitType], `Building ${id} trains missing unit ${unitType}.`);
  }
  for (const [id, terrain] of Object.entries(TERRAIN)) {
    assert(terrain.id === id, `Terrain ${id} has mismatched id.`);
    assert(typeof terrain.move === 'number', `Terrain ${id} missing movement.`);
    assert(typeof terrain.passable === 'boolean', `Terrain ${id} passable must be boolean.`);
  }
});

check('campaign generation creates playable essentials', () => {
  const state = createGame('quality-campaign');
  assert(state.map.tiles.length === MAP_WIDTH * MAP_HEIGHT, 'Map dimensions are wrong.');
  assert(state.units.some((u) => u.faction === 'olundar' && u.type === 'scout'), 'Olundar needs a starting scout.');
  assert(state.units.some((u) => u.faction === 'olundar' && u.type === 'engineer'), 'Olundar needs a starting engineer.');
  assert(state.buildings.some((b) => b.faction === 'dead' && b.type === 'portal'), 'Deadwalker portal missing.');
  assert(state.revealed.filter(Boolean).length < MAP_WIDTH * MAP_HEIGHT * 0.35, 'Fog reveals too much at start.');
  assert(state.visible.filter(Boolean).length > 20, 'Player has too little initial visibility.');
});

check('war council and objectives reflect early strategic pressure', () => {
  const state = createGame('quality-council');
  const council = getWarCouncil(state);
  const progress = getObjectiveProgress(state);
  const ready = getReadyOlundarUnits(state);
  const warnings = getEndTurnWarnings(state);
  assert(council.headline === 'First Orders', 'Initial council should guide first-turn play.');
  assert(council.priorities.length > 0, 'Council needs actionable priorities.');
  assert(progress.length === state.objectives.length, 'Objective progress must align with objectives.');
  assert(progress[1].done === false, 'War economy objective should not be complete at campaign start.');
  assert(ready.length >= 4, 'Starting army should expose ready units.');
  assert(warnings.some((warning) => warning.includes('still ready')), 'End-turn warnings should catch idle units.');
});

check('strategic path exists from Olundar toward the portal front', () => {
  const state = createGame('quality-path');
  const scout = state.units.find((u) => u.faction === 'olundar' && u.type === 'scout');
  const path = findPath(state, scout, 34, 7, Infinity);
  assert(path && path.path.length > 0, 'No land path from Olundar toward the eastern portal front.');
});

check('training pays resources and musters a unit', () => {
  const state = createGame('quality-training');
  const city = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
  const beforeFood = state.factions.olundar.resources.food;
  const beforeScouts = state.units.filter((u) => u.faction === 'olundar' && u.type === 'scout').length;
  const result = startTraining(state, city.id, 'scout');
  assert(result.ok, result.reason || 'Training failed unexpectedly.');
  assert(state.factions.olundar.resources.food < beforeFood, 'Training did not deduct resources.');
  endTurn(state);
  endTurn(state);
  const afterScouts = state.units.filter((u) => u.faction === 'olundar' && u.type === 'scout').length;
  assert(afterScouts === beforeScouts + 1, 'Trained scout did not muster after its queue completed.');
});

check('construction validates placement and completes', () => {
  const state = createGame('quality-construction');
  const engineer = state.units.find((u) => u.faction === 'olundar' && u.type === 'engineer');
  const result = startConstruction(state, engineer.id, 'road', engineer.x, engineer.y);
  assert(result.ok, result.reason || 'Road construction failed.');
  assert(tileAt(state, engineer.x, engineer.y).road, 'Road flag not set on construction tile.');
  endTurn(state);
  const road = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'road' && b.x === engineer.x && b.y === engineer.y);
  assert(road && road.turnsLeft === 0, 'Road did not complete after one turn.');
});

check('building upgrades improve long-term planning', () => {
  const state = createGame('quality-upgrade');
  const city = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
  const beforeGold = state.factions.olundar.resources.gold;
  const beforeHousing = state.factions.olundar.housing;
  const beforeHp = city.maxHp;
  const beforeQueueLimit = trainingQueueLimit(city);
  const result = upgradeBuilding(state, city.id);
  assert(result.ok, result.reason || 'City upgrade failed.');
  assert(city.upgraded === 1, 'Upgrade tier did not advance.');
  assert(city.maxHp > beforeHp, 'Upgrade did not improve building durability.');
  assert(trainingQueueLimit(city) > beforeQueueLimit, 'Upgrade did not increase training queue capacity.');
  assert(state.factions.olundar.housing > beforeHousing, 'City upgrade did not increase housing.');
  assert(state.factions.olundar.resources.gold < beforeGold, 'Upgrade did not spend resources.');
});

check('combat can damage enemies and protects portal before boss death', () => {
  const state = createGame('quality-combat');
  const legion = state.units.find((u) => u.faction === 'olundar' && u.type === 'legionary');
  const thrall = state.units.find((u) => u.faction === 'dead' && u.type === 'boneThrall');
  legion.x = thrall.x - 1;
  legion.y = thrall.y;
  const beforeHp = thrall.hp;
  const hit = attackUnit(state, legion.id, thrall.id);
  assert(hit.ok, hit.reason || 'Attack failed.');
  const maybeThrall = state.units.find((u) => u.id === thrall.id);
  assert(!maybeThrall || maybeThrall.hp < beforeHp, 'Attack did not damage target.');

  const onager = state.units.find((u) => u.faction === 'olundar' && u.type === 'archer');
  const portal = state.buildings.find((b) => b.faction === 'dead' && b.type === 'portal');
  onager.x = portal.x;
  onager.y = portal.y - 3;
  onager.hasActed = false;
  portal.hp = 1;
  const result = attackBuilding(state, onager.id, portal.id);
  assert(result.ok, result.reason || 'Portal attack failed.');
  assert(state.status === 'playing' && portal.hp === 10, 'Portal should reform while boss lives.');
});

check('24-turn simulation remains stable', () => {
  const state = createGame('quality-sim');
  for (let i = 0; i < 24; i += 1) {
    const ready = state.units.find((u) => u.faction === 'olundar' && !u.hasActed);
    if (ready) {
      const candidates = [
        { x: ready.x + 1, y: ready.y },
        { x: ready.x - 1, y: ready.y },
        { x: ready.x, y: ready.y + 1 },
        { x: ready.x, y: ready.y - 1 }
      ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < MAP_WIDTH && p.y < MAP_HEIGHT);
      for (const p of candidates) {
        const moved = moveUnit(state, ready.id, p.x, p.y);
        if (moved.ok) break;
      }
    }
    endTurn(state);
    assert(['playing', 'won', 'lost'].includes(state.status), 'Invalid game status.');
    for (const unit of state.units) {
      assert(unit.x >= 0 && unit.y >= 0 && unit.x < MAP_WIDTH && unit.y < MAP_HEIGHT, `Unit ${unit.id} out of bounds.`);
      assert(unit.hp > 0 && unit.hp <= unit.maxHp, `Unit ${unit.id} hp invariant broken.`);
    }
    for (const faction of Object.values(state.factions)) {
      for (const [resource, value] of Object.entries(faction.resources)) {
        assert(Number.isFinite(value), `${faction.id} ${resource} is not finite.`);
        assert(value > -1, `${faction.id} ${resource} went negative.`);
      }
    }
  }
  assert(state.units.some((u) => u.faction === 'dead') || state.buildings.some((b) => b.faction === 'dead'), 'Deadwalker pressure disappeared unexpectedly.');
});

check('source has no TODO/FIXME leftovers', () => {
  for (const file of listFiles(path.join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    assert(!/TODO|FIXME/.test(text), `${path.relative(root, file)} contains TODO/FIXME.`);
  }
});

for (const { name, fn } of checks) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} quality check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} quality checks passed.`);
