import { loadContentTables, validateContentTables } from './engine/content-loader.js';

const tables = loadContentTables();
validateContentTables(tables);

export const MAP_WIDTH = tables.MAP_WIDTH;
export const MAP_HEIGHT = tables.MAP_HEIGHT;
export const CURRENT_SAVE_VERSION = tables.CURRENT_SAVE_VERSION;
export const DIFFICULTY_PRESETS = tables.DIFFICULTY_PRESETS;
export const SCENARIOS = tables.SCENARIOS;
export const FACTIONS = tables.FACTIONS;
export const TERRAIN = tables.TERRAIN;
export const UNIT_TYPES = tables.UNIT_TYPES;
export const BUILDING_TYPES = tables.BUILDING_TYPES;
export const STARTING_RESOURCES = tables.STARTING_RESOURCES;
export const RESOURCE_NAMES = tables.RESOURCE_NAMES;
export const DIPLOMACY_ACTIONS = tables.DIPLOMACY_ACTIONS;
export const DIPLOMATIC_PROMISES = tables.DIPLOMATIC_PROMISES;
export const FIELD_ORDERS = tables.FIELD_ORDERS;
export const WAR_AIMS = tables.WAR_AIMS;
export const CRISIS_EVENTS = tables.CRISIS_EVENTS;
export const CRISIS_AFTERMATH_EVENTS = tables.CRISIS_AFTERMATH_EVENTS;
export const MAP_LENSES = tables.MAP_LENSES;
export const OBJECTIVES = tables.OBJECTIVES;

let activeTables = tables;

export function reloadContent(overrides = {}) {
  activeTables = loadContentTables(overrides);
  validateContentTables(activeTables);
  return activeTables;
}

export function getActiveContentTables() {
  return activeTables;
}

export { validateContentTables } from './engine/content-loader.js';
