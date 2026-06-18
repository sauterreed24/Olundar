import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_CUES, validateAudioCueRegistry } from '../src/audio.js';
import { BUILDING_TYPES, DIFFICULTY_PRESETS, MAP_HEIGHT, MAP_WIDTH, SCENARIOS, TERRAIN, UNIT_TYPES } from '../src/content.js';
import { DEFAULT_SETTINGS, MAP_SCALE_PRESETS, MOTION_MODES, normalizeSettings, validateSettingsConfig } from '../src/settings.js';
import {
  addBuilding,
  addUnit,
  attackBuilding,
  attackUnit,
  canAfford,
  createGame,
  endTurn,
  findPath,
  forecastBuildingAttack,
  forecastUnitAttack,
  getCampaignRecap,
  getEndTurnWarnings,
  getFirstTurnsGuide,
  getObjectiveProgress,
  getReadyOlundarUnits,
  getSiegeOperations,
  getWarCouncil,
  moveUnit,
  serializeState,
  startConstruction,
  startTraining,
  trainingQueueLimit,
  tileAt,
  upgradeBuilding,
  unitAt
} from '../src/rules.js';
import { createSaveSlot, defaultSaveSlotName, parseSaveSlots, removeSaveSlot, serializeSaveSlots, upsertSaveSlot } from '../src/saveSlots.js';
import { importSaveSnapshot, importedSlotName } from '../src/saveTransfer.js';

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

function readProjectFile(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function webPathExists(webPath) {
  if (webPath === './' || webPath === '/') return true;
  const cleanPath = webPath.replace(/^\.\//, '').replace(/^\//, '');
  return existsSync(path.join(root, cleanPath));
}

function parseServiceWorkerAssets(text) {
  const match = text.match(/const APP_SHELL_ASSETS = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('Service worker asset list missing.');
  return JSON.parse(match[1]);
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

check('named save slots preserve campaign metadata', () => {
  const state = createGame({ scenarioId: 'ashgate', difficultyId: 'hollowCrown', seed: 'quality-slot' });
  state.turn = 9;
  const defaultName = defaultSaveSlotName(state);
  const first = createSaveSlot(state, '{"version":1}', { id: 'slot-a', name: '  Ash   Gate  ', now: '2026-06-18T20:00:00.000Z' });
  const second = createSaveSlot(state, '{"version":1,"turn":10}', { id: 'slot-b', name: '', now: '2026-06-18T20:01:00.000Z' });
  assert(defaultName.includes('Ash Gate Frontier') && defaultName.includes('Hollow Crown'), 'Default save slot name should use campaign metadata.');
  assert(first.name === 'Ash Gate', 'Slot names should be trimmed and collapsed.');
  assert(second.name === defaultName, 'Blank slot names should fall back to campaign metadata.');
  assert(first.scenarioName === 'Ash Gate Frontier' && first.difficultyName === 'Hollow Crown', 'Slot metadata should preserve scenario and difficulty.');
  assert(first.turn === 9 && first.seed === 'quality-slot', 'Slot metadata should preserve turn and seed.');

  const updatedFirst = createSaveSlot(state, '{"version":1,"turn":11}', { id: 'slot-a', name: 'Ash Gate Keep', now: '2026-06-18T20:02:00.000Z' });
  const slots = upsertSaveSlot(upsertSaveSlot([], first), second);
  const updated = upsertSaveSlot(slots, updatedFirst);
  assert(updated.length === 2, 'Updating an existing slot should not duplicate it.');
  assert(updated[0].id === 'slot-a' && updated[0].name === 'Ash Gate Keep', 'Updated slot should sort newest first.');
  const parsed = parseSaveSlots(serializeSaveSlots(updated));
  assert(parsed.length === 2 && parsed[0].id === 'slot-a', 'Serialized save slots should roundtrip in sorted order.');
  assert(removeSaveSlot(parsed, 'slot-a').length === 1, 'Slot removal should drop the requested slot.');
  assert(parseSaveSlots('{broken').length === 0, 'Corrupt save slot storage should fail closed.');
});

check('save file import creates transferable named slots', () => {
  const state = createGame({ scenarioId: 'dawnroad', difficultyId: 'chronicle', seed: 'quality-transfer' });
  state.turn = 12;
  const raw = serializeState(state);
  const imported = importSaveSnapshot(raw, { fileName: 'road-oath-turn-12.json', now: '2026-06-18T21:00:00.000Z' });
  const slots = upsertSaveSlot([], imported.slot);
  const parsed = parseSaveSlots(serializeSaveSlots(slots));

  assert(imported.state.turn === 12, 'Imported state should preserve turn.');
  assert(imported.state.campaign.scenarioName === 'Dawnward Road Compact', 'Imported state should preserve scenario metadata.');
  assert(imported.slot.name === 'Imported Road Oath Turn 12', 'Imported slot should use the source file name.');
  assert(imported.slot.data === imported.serialized, 'Imported slot data should use normalized serialized state.');
  assert(parsed.length === 1 && parsed[0].id === imported.slot.id, 'Imported slot should roundtrip through named slot storage.');
  assert(importedSlotName(state, '') === 'Imported Dawnward Road Compact - Chronicle', 'Imported slots should fall back to campaign metadata when file names are absent.');

  let failed = false;
  try {
    importSaveSnapshot('{"version":0}', { fileName: 'old.json' });
  } catch (error) {
    failed = error.message.includes('not compatible');
  }
  assert(failed, 'Incompatible save imports should fail closed.');
});

check('campaign recaps summarize imports and outcomes', () => {
  const active = createGame({ scenarioId: 'dawnroad', difficultyId: 'standard', seed: 'quality-recap-active' });
  active.factions.dawn.discovered = true;
  active.flags.firstAllySeen = true;
  const imported = getCampaignRecap(active, 'import');
  assert(imported.title === 'Imported Campaign Recap', 'Imported saves should get a dedicated recap title.');
  assert(imported.statusLabel === 'In Progress', 'Active imported campaign should remain in progress.');
  assert(imported.stats.some((stat) => stat.label === 'Mapped'), 'Recap should expose map progress.');
  assert(imported.milestones.length === active.objectives.length, 'Recap milestones should match campaign objectives.');
  assert(imported.nextSteps.length > 0, 'Active recap should give resume guidance.');

  const won = createGame({ scenarioId: 'founding', difficultyId: 'chronicle', seed: 'quality-recap-win' });
  won.status = 'won';
  won.winner = 'olundar';
  won.flags.bossSlain = true;
  won.flags.portalDestroyed = true;
  const victory = getCampaignRecap(won);
  assert(victory.title === 'Victory Recap' && victory.tone === 'good', 'Victory recap should be clearly positive.');
  assert(victory.summary.includes('Olundar survived'), 'Victory recap should summarize survival.');
  assert(victory.milestones.find((milestone) => milestone.detail === 'Portal destroyed')?.done, 'Victory recap should show portal completion.');

  const lost = createGame({ scenarioId: 'ashgate', difficultyId: 'hollowCrown', seed: 'quality-recap-loss' });
  lost.status = 'lost';
  lost.winner = 'dead';
  lost.factions.olundar.resources.morale = 0;
  const defeat = getCampaignRecap(lost);
  assert(defeat.title === 'Defeat Recap' && defeat.tone === 'danger', 'Defeat recap should be clearly marked.');
  assert(defeat.nextSteps.some((step) => step.includes('Scout earlier')), 'Defeat recap should provide practical after-action advice.');
});

check('audio cue registry stays lightweight and browser-safe', () => {
  const summary = validateAudioCueRegistry(AUDIO_CUES);
  assert(summary.count >= 10, 'Audio registry should cover core game feedback states.');
  assert(summary.ids.includes('attack') && summary.ids.includes('turn') && summary.ids.includes('fanfare'), 'Audio registry is missing important gameplay cues.');
  assert(summary.totalDuration < 3, 'Total procedural cue budget should stay lightweight.');
});

check('player settings are valid and persistable', () => {
  const summary = validateSettingsConfig();
  const corrupt = normalizeSettings({ audioVolume: 900, motion: 'spin', mapScale: 'cinema' });
  const reduced = normalizeSettings({ audioVolume: '33', motion: 'reduced', mapScale: 'expanded' });

  assert(summary.motionIds.length >= 2 && summary.motionIds.includes('reduced'), 'Settings should include reduced motion.');
  assert(summary.mapScaleIds.length >= 3 && summary.mapScaleIds.includes('compact') && summary.mapScaleIds.includes('expanded'), 'Settings should include compact and expanded map scale options.');
  assert(DEFAULT_SETTINGS.audioVolume === 58, 'Default audio volume should match the original mix level.');
  assert(corrupt.audioVolume === 100 && corrupt.motion === DEFAULT_SETTINGS.motion && corrupt.mapScale === DEFAULT_SETTINGS.mapScale, 'Settings normalization should clamp or recover bad values.');
  assert(reduced.audioVolume === 33 && reduced.motion === 'reduced' && reduced.mapScale === 'expanded', 'Settings normalization should preserve valid choices.');
  for (const preset of Object.values(MAP_SCALE_PRESETS)) {
    assert(preset.maxHeightFloor >= preset.minHeight, `Map scale ${preset.id} has invalid heights.`);
  }
  for (const mode of Object.values(MOTION_MODES)) {
    assert(mode.label.length <= 24, `Motion mode ${mode.id} label is too long for mobile cards.`);
  }
});

check('pwa install shell references real app assets', () => {
  const index = readProjectFile('index.html');
  const manifest = JSON.parse(readProjectFile('manifest.webmanifest'));
  const serviceWorker = readProjectFile('sw.js');
  const main = readProjectFile('src/main.js');
  const pwaRuntime = readProjectFile('src/pwa.js');
  const server = readProjectFile('tools/serve.mjs');
  const shellAssets = parseServiceWorkerAssets(serviceWorker);

  assert(index.includes('rel="manifest" href="./manifest.webmanifest"'), 'Index must link the web app manifest.');
  assert(index.includes('name="theme-color"'), 'Index should expose a theme color for installed surfaces.');
  assert(index.includes('id="installTop"'), 'Install affordance is missing from the top bar.');
  assert(manifest.name.includes('Olundar') && manifest.short_name === 'Olundar', 'Manifest should identify the game clearly.');
  assert(manifest.start_url === './' && manifest.scope === './', 'Manifest start URL and scope should stay repo-relative.');
  assert(manifest.display === 'standalone', 'Manifest should launch as a standalone app.');
  assert(manifest.icons.some((icon) => icon.src === './assets/icons/olundar-icon.svg' && icon.purpose.includes('maskable')), 'Manifest needs the maskable Olundar icon.');
  for (const icon of manifest.icons) assert(webPathExists(icon.src), `Manifest icon missing: ${icon.src}`);

  assert(main.includes("import { registerPwa } from './pwa.js';") && main.includes('registerPwa();'), 'Main runtime should initialize PWA registration.');
  assert(pwaRuntime.includes('serviceWorker.register'), 'Runtime should register the service worker.');
  assert(pwaRuntime.includes('beforeinstallprompt'), 'Runtime should expose install prompts when the browser supports them.');
  assert(server.includes("'.webmanifest': 'application/manifest+json; charset=utf-8'"), 'Local server should serve manifests with the correct MIME type.');
  assert(serviceWorker.includes("const CACHE_NAME = 'olundar-pwa-v"), 'Service worker cache name should be versioned.');
  assert(serviceWorker.includes("request.mode === 'navigate'"), 'Service worker should provide an offline navigation fallback.');

  const requiredAssets = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/icons/olundar-icon.svg',
    './src/main.js',
    './src/pwa.js',
    './src/rules.js',
    './src/saveTransfer.js',
    './src/settings.js',
    './src/style.css'
  ];
  for (const asset of requiredAssets) assert(shellAssets.includes(asset), `Service worker shell cache missing ${asset}.`);
  for (const asset of shellAssets) {
    assert(!asset.startsWith('http'), `Service worker asset should be relative: ${asset}`);
    assert(webPathExists(asset), `Service worker caches missing asset: ${asset}`);
  }
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

check('battle forecasts match combat without mutating state', () => {
  const state = createGame('quality-forecast');
  const legion = state.units.find((u) => u.faction === 'olundar' && u.type === 'legionary');
  const thrall = state.units.find((u) => u.faction === 'dead' && u.type === 'boneThrall');
  legion.x = thrall.x - 1;
  legion.y = thrall.y;
  legion.hasActed = false;
  const beforeHp = thrall.hp;
  const forecast = forecastUnitAttack(state, legion.id, thrall.id);
  assert(forecast.ok, forecast.reason || 'Unit forecast failed.');
  assert(thrall.hp === beforeHp && !legion.hasActed, 'Unit forecast should not mutate combat state.');
  const hit = attackUnit(state, legion.id, thrall.id);
  assert(hit.ok && hit.damage === forecast.damage, 'Unit forecast damage should match real attack.');
  const targetAfter = state.units.find((unit) => unit.id === thrall.id);
  assert((targetAfter?.hp || 0) === forecast.targetHpAfter, 'Unit forecast HP result should match real attack.');

  const buildingState = createGame('quality-building-forecast');
  const archer = buildingState.units.find((u) => u.faction === 'olundar' && u.type === 'archer');
  const portal = buildingState.buildings.find((b) => b.faction === 'dead' && b.type === 'portal');
  archer.x = portal.x;
  archer.y = portal.y - 3;
  archer.hasActed = false;
  portal.hp = 1;
  const buildingForecast = forecastBuildingAttack(buildingState, archer.id, portal.id);
  assert(buildingForecast.ok, buildingForecast.reason || 'Building forecast failed.');
  assert(buildingForecast.portalReforms, 'Portal forecast should warn about boss-locked reformation.');
  assert(portal.hp === 1 && !archer.hasActed, 'Building forecast should not mutate combat state.');
  const strike = attackBuilding(buildingState, archer.id, portal.id);
  assert(strike.ok && strike.damage === buildingForecast.damage, 'Building forecast damage should match real attack.');
  assert(portal.hp === buildingForecast.targetHpAfter, 'Building forecast HP result should match real attack.');
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
