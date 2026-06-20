/**
 * Synchronous content bundle loader for Node (quality gate) and browser.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');

function readJson(name) {
  return JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'));
}

function loadNodeBundle() {
  const meta = readJson('meta.json');
  const resources = readJson('resources.json');
  const diplomacy = readJson('diplomacy.json');
  const crisis = readJson('crisis.json');

  return {
    MAP_WIDTH: meta.MAP_WIDTH,
    MAP_HEIGHT: meta.MAP_HEIGHT,
    CURRENT_SAVE_VERSION: meta.CURRENT_SAVE_VERSION,
    DIFFICULTY_PRESETS: readJson('difficulty.json'),
    SCENARIOS: readJson('scenarios.json'),
    FACTIONS: readJson('factions.json'),
    TERRAIN: readJson('terrain.json'),
    UNIT_TYPES: readJson('units.json'),
    BUILDING_TYPES: readJson('buildings.json'),
    STARTING_RESOURCES: resources.STARTING_RESOURCES,
    RESOURCE_NAMES: resources.RESOURCE_NAMES,
    DIPLOMACY_ACTIONS: diplomacy.DIPLOMACY_ACTIONS,
    DIPLOMATIC_PROMISES: diplomacy.DIPLOMATIC_PROMISES,
    FIELD_ORDERS: diplomacy.FIELD_ORDERS,
    WAR_AIMS: readJson('war-aims.json'),
    CRISIS_EVENTS: crisis.CRISIS_EVENTS,
    CRISIS_AFTERMATH_EVENTS: crisis.CRISIS_AFTERMATH_EVENTS,
    MAP_LENSES: readJson('map-lenses.json'),
    OBJECTIVES: readJson('objectives.json'),
    COSMETICS: readJson('cosmetics.json')
  };
}

let browserBundlePromise = null;

export function loadContentSync() {
  if (typeof window === 'undefined') return loadNodeBundle();
  throw new Error('Use loadContentAsync in browser');
}

export async function loadContentAsync() {
  if (browserBundlePromise) return browserBundlePromise;
  browserBundlePromise = (async () => {
    const base = new URL('../../data/', import.meta.url);
    const load = async (file) => {
      const response = await fetch(new URL(file, base));
      if (!response.ok) throw new Error(`Failed to load ${file}`);
      return response.json();
    };

    const [meta, difficulty, scenarios, factions, terrain, units, buildings, resources, diplomacy, warAims, crisis, mapLenses, objectives, cosmetics] = await Promise.all([
      load('meta.json'),
      load('difficulty.json'),
      load('scenarios.json'),
      load('factions.json'),
      load('terrain.json'),
      load('units.json'),
      load('buildings.json'),
      load('resources.json'),
      load('diplomacy.json'),
      load('war-aims.json'),
      load('crisis.json'),
      load('map-lenses.json'),
      load('objectives.json'),
      load('cosmetics.json')
    ]);

    return {
      MAP_WIDTH: meta.MAP_WIDTH,
      MAP_HEIGHT: meta.MAP_HEIGHT,
      CURRENT_SAVE_VERSION: meta.CURRENT_SAVE_VERSION,
      DIFFICULTY_PRESETS: difficulty,
      SCENARIOS: scenarios,
      FACTIONS: factions,
      TERRAIN: terrain,
      UNIT_TYPES: units,
      BUILDING_TYPES: buildings,
      STARTING_RESOURCES: resources.STARTING_RESOURCES,
      RESOURCE_NAMES: resources.RESOURCE_NAMES,
      DIPLOMACY_ACTIONS: diplomacy.DIPLOMACY_ACTIONS,
      DIPLOMATIC_PROMISES: diplomacy.DIPLOMATIC_PROMISES,
      FIELD_ORDERS: diplomacy.FIELD_ORDERS,
      WAR_AIMS: warAims,
      CRISIS_EVENTS: crisis.CRISIS_EVENTS,
      CRISIS_AFTERMATH_EVENTS: crisis.CRISIS_AFTERMATH_EVENTS,
      MAP_LENSES: mapLenses,
      OBJECTIVES: objectives,
      COSMETICS: cosmetics
    };
  })();
  return browserBundlePromise;
}

export function dataFilesExist() {
  const required = ['meta.json', 'units.json', 'buildings.json', 'factions.json', 'terrain.json', 'crisis.json', 'cosmetics.json'];
  return required.every((file) => existsSync(path.join(dataDir, file)));
}
