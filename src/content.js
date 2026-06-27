/**
 * Game content loaded from data/*.json schemas.
 */

import meta from '../data/meta.json' with { type: 'json' };
import difficulty from '../data/difficulty.json' with { type: 'json' };
import scenarios from '../data/scenarios.json' with { type: 'json' };
import factions from '../data/factions.json' with { type: 'json' };
import terrain from '../data/terrain.json' with { type: 'json' };
import units from '../data/units.json' with { type: 'json' };
import buildings from '../data/buildings.json' with { type: 'json' };
import resources from '../data/resources.json' with { type: 'json' };
import diplomacy from '../data/diplomacy.json' with { type: 'json' };
import warAims from '../data/war-aims.json' with { type: 'json' };
import crisis from '../data/crisis.json' with { type: 'json' };
import mapLenses from '../data/map-lenses.json' with { type: 'json' };
import objectives from '../data/objectives.json' with { type: 'json' };
import cosmetics from '../data/cosmetics.json' with { type: 'json' };
import edicts from '../data/edicts.json' with { type: 'json' };

export const MAP_WIDTH = meta.MAP_WIDTH;
export const MAP_HEIGHT = meta.MAP_HEIGHT;
export const CURRENT_SAVE_VERSION = meta.CURRENT_SAVE_VERSION;
export const DIFFICULTY_PRESETS = difficulty;
export const SCENARIOS = scenarios;
export const FACTIONS = factions;
export const TERRAIN = terrain;
export const UNIT_TYPES = units;
export const BUILDING_TYPES = buildings;
export const STARTING_RESOURCES = resources.STARTING_RESOURCES;
export const RESOURCE_NAMES = resources.RESOURCE_NAMES;
export const DIPLOMACY_ACTIONS = diplomacy.DIPLOMACY_ACTIONS;
export const DIPLOMATIC_PROMISES = diplomacy.DIPLOMATIC_PROMISES;
export const FIELD_ORDERS = diplomacy.FIELD_ORDERS;
export const WAR_AIMS = warAims;
export const CRISIS_EVENTS = crisis.CRISIS_EVENTS;
export const CRISIS_AFTERMATH_EVENTS = crisis.CRISIS_AFTERMATH_EVENTS;
export const MAP_LENSES = mapLenses;
export const OBJECTIVES = objectives;
export const COSMETICS = cosmetics;
export const SUN_EDICTS = edicts.SUN_EDICTS;

const bundle = {
  MAP_WIDTH,
  MAP_HEIGHT,
  CURRENT_SAVE_VERSION,
  DIFFICULTY_PRESETS,
  SCENARIOS,
  FACTIONS,
  TERRAIN,
  UNIT_TYPES,
  BUILDING_TYPES,
  STARTING_RESOURCES,
  RESOURCE_NAMES,
  DIPLOMACY_ACTIONS,
  DIPLOMATIC_PROMISES,
  FIELD_ORDERS,
  WAR_AIMS,
  CRISIS_EVENTS,
  CRISIS_AFTERMATH_EVENTS,
  MAP_LENSES,
  OBJECTIVES,
  COSMETICS,
  SUN_EDICTS
};

export function getContentBundle() {
  return bundle;
}

export async function initContent() {
  return bundle;
}

export function applyContentBundle(nextBundle) {
  for (const [key, value] of Object.entries(nextBundle)) {
    if (!(key in bundle)) continue;
    const target = bundle[key];
    if (target === value) continue;
    if (Array.isArray(target) && Array.isArray(value)) {
      target.length = 0;
      target.push(...value);
    } else if (target && typeof target === 'object' && value && typeof value === 'object') {
      for (const subKey of Object.keys(target)) delete target[subKey];
      Object.assign(target, value);
    }
  }
}
