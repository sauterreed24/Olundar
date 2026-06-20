import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(__dirname, '../../data');

const TABLE_FILES = {
  DIFFICULTY_PRESETS: 'difficulty-presets.json',
  SCENARIOS: 'scenarios.json',
  FACTIONS: 'factions.json',
  TERRAIN: 'terrain.json',
  UNIT_TYPES: 'units.json',
  BUILDING_TYPES: 'buildings.json',
  CRISIS_EVENTS: 'crisis-events.json',
  CRISIS_AFTERMATH_EVENTS: 'crisis-aftermath.json',
  DIPLOMACY_ACTIONS: 'diplomacy-actions.json',
  DIPLOMATIC_PROMISES: 'diplomatic-promises.json',
  FIELD_ORDERS: 'field-orders.json',
  WAR_AIMS: 'war-aims.json',
  MAP_LENSES: 'map-lenses.json'
};

let modOverrides = {};

function readJson(name) {
  const file = path.join(dataRoot, name);
  if (!existsSync(file)) throw new Error(`Missing data file: ${name}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadTable(exportName) {
  const base = readJson(TABLE_FILES[exportName]);
  const override = modOverrides[exportName];
  return override ? { ...base, ...override } : base;
}

export function loadContentTables(overrides = {}) {
  modOverrides = overrides || {};
  const meta = readJson('meta.json');
  return {
    MAP_WIDTH: meta.mapWidth,
    MAP_HEIGHT: meta.mapHeight,
    CURRENT_SAVE_VERSION: meta.saveVersion,
    STARTING_RESOURCES: meta.startingResources,
    RESOURCE_NAMES: meta.resourceNames,
    OBJECTIVES: meta.objectives,
    DIFFICULTY_PRESETS: loadTable('DIFFICULTY_PRESETS'),
    SCENARIOS: loadTable('SCENARIOS'),
    FACTIONS: loadTable('FACTIONS'),
    TERRAIN: loadTable('TERRAIN'),
    UNIT_TYPES: loadTable('UNIT_TYPES'),
    BUILDING_TYPES: loadTable('BUILDING_TYPES'),
    CRISIS_EVENTS: loadTable('CRISIS_EVENTS'),
    CRISIS_AFTERMATH_EVENTS: loadTable('CRISIS_AFTERMATH_EVENTS'),
    DIPLOMACY_ACTIONS: loadTable('DIPLOMACY_ACTIONS'),
    DIPLOMATIC_PROMISES: loadTable('DIPLOMATIC_PROMISES'),
    FIELD_ORDERS: loadTable('FIELD_ORDERS'),
    WAR_AIMS: loadTable('WAR_AIMS'),
    MAP_LENSES: loadTable('MAP_LENSES')
  };
}

const SCHEMA_RULES = {
  DIFFICULTY_PRESETS: (table) => Object.entries(table).every(([id, row]) => row.id === id && row.name),
  SCENARIOS: (table) => Object.entries(table).every(([id, row]) => row.id === id && row.seed),
  FACTIONS: (table) => Object.entries(table).every(([id, row]) => row.id === id && row.color),
  TERRAIN: (table) => Object.entries(table).every(([id, row]) => row.id === id && Number.isFinite(row.move)),
  UNIT_TYPES: (table) => Object.entries(table).every(([id, row]) => row.id === id && row.hp > 0),
  BUILDING_TYPES: (table) => Object.entries(table).every(([id, row]) => row.id === id && row.hp > 0),
  CRISIS_EVENTS: (table) => Object.entries(table).every(([id, row]) => row.id === id && Array.isArray(row.choices)),
  CRISIS_AFTERMATH_EVENTS: (table) => Object.entries(table).every(([id, row]) => row.id === id && row.crisisId),
  DIPLOMACY_ACTIONS: (table) => Object.values(table).every((row) => row.name && row.cost),
  DIPLOMATIC_PROMISES: (table) => Object.entries(table).every(([id, row]) => row.id === id && row.demand),
  FIELD_ORDERS: (table) => Object.entries(table).every(([id, row]) => row.id === id),
  WAR_AIMS: (table) => Object.entries(table).every(([id, row]) => row.id === id),
  MAP_LENSES: (table) => Object.entries(table).every(([id, row]) => row.id === id)
};

export function validateContentTables(tables = loadContentTables()) {
  for (const [name, validator] of Object.entries(SCHEMA_RULES)) {
    if (!tables[name] || typeof tables[name] !== 'object') throw new Error(`Missing table ${name}`);
    if (!validator(tables[name])) throw new Error(`Schema validation failed for ${name}`);
  }
  if (!Number.isInteger(tables.MAP_WIDTH) || !Number.isInteger(tables.MAP_HEIGHT)) {
    throw new Error('Map dimensions invalid in meta.json');
  }
  return { tables: Object.keys(SCHEMA_RULES).length + 1, ok: true };
}

export async function fetchContentTables(baseUrl = './data/') {
  const meta = await (await fetch(`${baseUrl}meta.json`)).json();
  const entries = await Promise.all(
    Object.entries(TABLE_FILES).map(async ([exportName, file]) => {
      const data = await (await fetch(`${baseUrl}${file}`)).json();
      return [exportName, data];
    })
  );
  const tables = Object.fromEntries(entries);
  return {
    MAP_WIDTH: meta.mapWidth,
    MAP_HEIGHT: meta.mapHeight,
    CURRENT_SAVE_VERSION: meta.saveVersion,
    STARTING_RESOURCES: meta.startingResources,
    RESOURCE_NAMES: meta.resourceNames,
    OBJECTIVES: meta.objectives,
    ...tables
  };
}

export function applyModOverrides(overrides) {
  modOverrides = { ...modOverrides, ...overrides };
  return loadContentTables(modOverrides);
}

export function getDataRoot() {
  return dataRoot;
}
