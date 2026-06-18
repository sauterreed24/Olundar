import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDING_TYPES, DIFFICULTY_PRESETS, MAP_HEIGHT, MAP_WIDTH, SCENARIOS, TERRAIN, UNIT_TYPES } from '../src/content.js';
import {
  addBuilding,
  addUnit,
  attackBuilding,
  attackUnit,
  canAfford,
  createGame,
  endTurn,
  findPath,
  getEndTurnWarnings,
  getFirstTurnsGuide,
  getObjectiveProgress,
  getReadyOlundarUnits,
  getSiegeOperations,
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
  for (const [id, difficulty] of Object.entries(DIFFICULTY_PRESETS)) {
    assert(difficulty.id === id, `Difficulty ${id} has mismatched id.`);
    assert(difficulty.name && difficulty.text, `Difficulty ${id} needs player-facing text.`);
    for (const key of ['startTurn', 'thrallEvery', 'archerEvery', 'knightEvery', 'outpostEvery']) {
      assert(Number.isInteger(difficulty.deadwalker[key]) && difficulty.deadwalker[key] > 0, `Difficulty ${id} has invalid ${key}.`);
    }
  }
  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    assert(scenario.id === id, `Scenario ${id} has mismatched id.`);
    assert(scenario.name && scenario.seed && scenario.text, `Scenario ${id} needs name, seed, and text.`);
    assert(DIFFICULTY_PRESETS[scenario.difficultyId], `Scenario ${id} references missing difficulty.`);
    for (const unit of scenario.units || []) assert(UNIT_TYPES[unit.type], `Scenario ${id} starts with missing unit ${unit.type}.`);
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

check('first-turn guide gives actionable live onboarding', () => {
  const state = createGame('quality-guide');
  const firstGuide = getFirstTurnsGuide(state);
  assert(firstGuide.visible, 'First-turn guide should be visible at campaign start.');
  assert(firstGuide.total === 6, 'Guide should teach the six opening priorities.');
  assert(firstGuide.steps.some((step) => step.id === firstGuide.currentId && !step.done), 'Guide should identify a current unfinished priority.');
  assert(firstGuide.steps.some((step) => step.id === 'engineer' && !step.done), 'Engineer step should not start complete.');

  const engineer = state.units.find((u) => u.faction === 'olundar' && u.type === 'engineer');
  const road = startConstruction(state, engineer.id, 'road', engineer.x, engineer.y);
  assert(road.ok, road.reason || 'Guide setup road construction failed.');
  const city = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
  const training = startTraining(state, city.id, 'scout');
  assert(training.ok, training.reason || 'Guide setup training failed.');
  addBuilding(state, 'mine', 'olundar', 9, 18, { complete: true });
  state.flags.firstAllySeen = true;
  state.flags.firstDeadwalkerSeen = true;
  state.factions.dawn.discovered = true;

  const laterGuide = getFirstTurnsGuide(state);
  assert(laterGuide.steps.find((step) => step.id === 'engineer').done, 'Guide should recognize construction progress.');
  assert(laterGuide.steps.find((step) => step.id === 'training').done, 'Guide should recognize queued training.');
  assert(laterGuide.steps.find((step) => step.id === 'iron').done, 'Guide should recognize iron progress.');
  assert(laterGuide.steps.find((step) => step.id === 'contact').done, 'Guide should recognize first contact.');
  assert(laterGuide.steps.find((step) => step.id === 'front').done, 'Guide should recognize Deadwalker sighting.');
});

check('siege operations track midgame victory work', () => {
  const state = createGame('quality-siege-operations');
  const opening = getSiegeOperations(state);
  assert(!opening.visible, 'Siege operations should not crowd the first-turn opening.');

  state.turn = 7;
  state.flags.firstDeadwalkerSeen = true;
  state.factions.dawn.discovered = true;
  state.factions.olundar.pacts.dawn = true;
  addBuilding(state, 'workshop', 'olundar', 9, 17, { complete: true });
  addUnit(state, 'onager', 'olundar', 9, 16);
  const bonePit = state.buildings.find((building) => building.faction === 'dead' && building.type === 'bonePit');
  state.revealed[bonePit.y * MAP_WIDTH + bonePit.x] = true;

  const before = getSiegeOperations(state);
  assert(before.visible, 'Siege operations should appear once war pressure is active.');
  assert(before.operations.find((operation) => operation.id === 'siege').done, 'Onager operation should recognize ready siege.');
  assert(before.operations.find((operation) => operation.id === 'ally').done, 'Ally operation should recognize survival pacts.');
  assert(before.operations.find((operation) => operation.id === 'cleanse').tone === 'danger', 'Revealed Deadwalker stronghold should become urgent.');

  const legion = state.units.find((unit) => unit.faction === 'olundar' && unit.type === 'legionary');
  legion.x = bonePit.x - 1;
  legion.y = bonePit.y;
  legion.hasActed = false;
  bonePit.hp = 1;
  const beforeInfluence = state.factions.olundar.resources.influence;
  const attack = attackBuilding(state, legion.id, bonePit.id);
  assert(attack.ok, attack.reason || 'Stronghold attack failed.');

  const after = getSiegeOperations(state);
  assert(state.flags.deadStrongholdsDestroyed === 1, 'Destroyed strongholds should be counted.');
  assert(after.operations.find((operation) => operation.id === 'cleanse').done, 'Cleanse operation should complete after a stronghold falls.');
  assert(state.factions.olundar.resources.influence > beforeInfluence, 'Stronghold destruction should reward influence.');
});

check('scenario and difficulty presets change campaign shape', () => {
  const founding = createGame({ scenarioId: 'founding', difficultyId: 'standard', seed: 'quality-scenario' });
  const dawnroad = createGame({ scenarioId: 'dawnroad', difficultyId: 'standard', seed: 'quality-scenario' });
  const chronicle = createGame({ scenarioId: 'founding', difficultyId: 'chronicle', seed: 'quality-scenario' });
  const hollow = createGame({ scenarioId: 'founding', difficultyId: 'hollowCrown', seed: 'quality-scenario' });

  assert(dawnroad.campaign.scenarioName === SCENARIOS.dawnroad.name, 'Scenario name is not preserved in campaign metadata.');
  assert(dawnroad.units.some((u) => u.name === 'Road Oath-Spear'), 'Dawnward Road scenario should add its sworn spear.');
  assert(dawnroad.factions.olundar.resources.influence > founding.factions.olundar.resources.influence, 'Scenario resource changes did not apply.');
  assert(chronicle.factions.olundar.resources.food > founding.factions.olundar.resources.food, 'Chronicle should give more opening resources.');
  assert(hollow.factions.olundar.resources.morale < founding.factions.olundar.resources.morale, 'Hollow Crown should start with lower morale.');

  const chronicleDeadBefore = chronicle.units.filter((u) => u.faction === 'dead').length;
  const hollowDeadBefore = hollow.units.filter((u) => u.faction === 'dead').length;
  endTurn(chronicle);
  endTurn(hollow);
  const chronicleNewDead = chronicle.units.filter((u) => u.faction === 'dead').length - chronicleDeadBefore;
  const hollowNewDead = hollow.units.filter((u) => u.faction === 'dead').length - hollowDeadBefore;
  assert(chronicleNewDead === 0, 'Chronicle should delay the first Deadwalker spawn.');
  assert(hollowNewDead > 0, 'Hollow Crown should spawn Deadwalkers immediately.');
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
