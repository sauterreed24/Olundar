import buildingsData from '../data/buildings.json' with { type: 'json' };
import crisisAftermathData from '../data/crisisAftermath.json' with { type: 'json' };
import crisisEventsData from '../data/crisisEvents.json' with { type: 'json' };
import difficultiesData from '../data/difficulties.json' with { type: 'json' };
import diplomacyActionsData from '../data/diplomacyActions.json' with { type: 'json' };
import diplomaticPromisesData from '../data/diplomaticPromises.json' with { type: 'json' };
import factionsData from '../data/factions.json' with { type: 'json' };
import fieldOrdersData from '../data/fieldOrders.json' with { type: 'json' };
import mapLensesData from '../data/mapLenses.json' with { type: 'json' };
import metaData from '../data/meta.json' with { type: 'json' };
import scenariosData from '../data/scenarios.json' with { type: 'json' };
import terrainData from '../data/terrain.json' with { type: 'json' };
import unitsData from '../data/units.json' with { type: 'json' };
import warAimsData from '../data/warAims.json' with { type: 'json' };

export const MAP_WIDTH = 44;
export const MAP_HEIGHT = 30;
export const CURRENT_SAVE_VERSION = 1;

function cloneTable(data) {
  return structuredClone(data);
}

export const DIFFICULTY_PRESETS = cloneTable(difficultiesData);
export const SCENARIOS = cloneTable(scenariosData);
export const FACTIONS = cloneTable(factionsData);
export const TERRAIN = cloneTable(terrainData);
export const UNIT_TYPES = cloneTable(unitsData);
export const BUILDING_TYPES = cloneTable(buildingsData);
export const STARTING_RESOURCES = cloneTable(metaData.startingResources);
export const RESOURCE_NAMES = cloneTable(metaData.resourceNames);
export const DIPLOMACY_ACTIONS = cloneTable(diplomacyActionsData);
export const DIPLOMATIC_PROMISES = cloneTable(diplomaticPromisesData);
export const FIELD_ORDERS = cloneTable(fieldOrdersData);
export const WAR_AIMS = cloneTable(warAimsData);
export const CRISIS_EVENTS = cloneTable(crisisEventsData);
export const CRISIS_AFTERMATH_EVENTS = cloneTable(crisisAftermathData);
export const MAP_LENSES = cloneTable(mapLensesData);
export const OBJECTIVES = [...metaData.objectives];

const MOD_TABLES = {
  units: UNIT_TYPES,
  buildings: BUILDING_TYPES,
  factions: FACTIONS,
  terrain: TERRAIN,
  crisisEvents: CRISIS_EVENTS
};

const BASE_TABLES = {
  units: unitsData,
  buildings: buildingsData,
  factions: factionsData,
  terrain: terrainData,
  crisisEvents: crisisEventsData
};

function applyPatches(table, base, patches = {}) {
  for (const [id, patch] of Object.entries(patches)) {
    if (!base[id] && !table[id]) continue;
    table[id] = { ...(base[id] || table[id]), ...patch, id };
  }
}

export function applyContentMods(mods = {}) {
  for (const [key, table] of Object.entries(MOD_TABLES)) {
    applyPatches(table, BASE_TABLES[key], mods[key]);
  }
}

export function resetContentMods() {
  for (const [key, table] of Object.entries(MOD_TABLES)) {
    for (const id of Object.keys(table)) delete table[id];
    Object.assign(table, cloneTable(BASE_TABLES[key]));
  }
}

export function getContentTables() {
  return {
    units: UNIT_TYPES,
    buildings: BUILDING_TYPES,
    factions: FACTIONS,
    terrain: TERRAIN,
    crisisEvents: CRISIS_EVENTS
  };
}

export async function hotReloadContentFromUrls(urls = {}) {
  const loaded = {};
  for (const [key, url] of Object.entries(urls)) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to reload ${key} from ${url}`);
    loaded[key] = await response.json();
  }
  for (const [key, table] of Object.entries(loaded)) {
    if (!MOD_TABLES[key]) continue;
    for (const id of Object.keys(MOD_TABLES[key])) delete MOD_TABLES[key][id];
    Object.assign(MOD_TABLES[key], cloneTable(table));
    BASE_TABLES[key] = cloneTable(table);
  }
  return getContentTables();
}

export function validateContentSchemas() {
  const tables = [
    ['units', UNIT_TYPES, (entry) => entry.id && entry.hp > 0 && entry.move > 0],
    ['buildings', BUILDING_TYPES, (entry) => entry.id && entry.hp > 0],
    ['factions', FACTIONS, (entry) => entry.id && entry.name && entry.color],
    ['terrain', TERRAIN, (entry) => entry.id && typeof entry.move === 'number' && typeof entry.passable === 'boolean'],
    ['crisisEvents', CRISIS_EVENTS, (entry) => entry.id && Array.isArray(entry.choices) && entry.choices.length >= 3]
  ];
  for (const [name, table, validate] of tables) {
    for (const [id, entry] of Object.entries(table)) {
      if (entry.id !== id) throw new Error(`${name} entry ${id} has mismatched id.`);
      if (!validate(entry)) throw new Error(`${name} entry ${id} failed schema validation.`);
    }
  }
  return { tables: tables.length, ids: Object.keys(UNIT_TYPES).length + Object.keys(BUILDING_TYPES).length };
}
