/**
 * Instantiates game entity definitions from JSON content bundles.
 * Used by the mod menu for hot-reloading stat and art overrides.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { applyModPatches } from '../content.js';
import { getAtlasTexture, getImperialPalette } from './pixi-renderer.js';

let contentBundle = null;
let modOverrides = {};

const FACTION_COLORS = {
  olundar: '#f0c866',
  dawn: '#88b7ff',
  veyr: '#c48cff',
  mire: '#72c66e',
  dead: '#91e88b'
};

export async function loadContentBundle(baseUrl = './data/') {
  const load = async (file) => {
    const response = await fetch(`${baseUrl}${file}`);
    if (!response.ok) throw new Error(`Failed to load ${file}`);
    return response.json();
  };

  const [meta, difficulty, scenarios, factions, terrain, units, buildings, resources, diplomacy, warAims, crisis, mapLenses, objectives] = await Promise.all([
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
    load('objectives.json')
  ]);

  contentBundle = {
    ...meta,
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
    OBJECTIVES: objectives
  };

  applyModOverrides();
  return contentBundle;
}

export function getContentBundle() {
  return contentBundle;
}

export function setModOverrides(overrides = {}) {
  modOverrides = overrides && typeof overrides === 'object' ? overrides : {};
  applyModOverrides();
  applyModPatches(modOverrides);
}

export function getModOverrides() {
  return { ...modOverrides };
}

function applyModOverrides() {
  if (!contentBundle) return;
  for (const [category, entries] of Object.entries(modOverrides)) {
    const table = contentBundle[category];
    if (!table || typeof table !== 'object') continue;
    for (const [id, patch] of Object.entries(entries)) {
      if (table[id] && patch && typeof patch === 'object') {
        table[id] = { ...table[id], ...patch };
      }
    }
  }
}

export function createUnitDisplay(unit, layout) {
  const def = contentBundle?.UNIT_TYPES?.[unit.type] || { name: unit.type };
  const container = new Container();
  const palette = getImperialPalette();
  const factionColor = FACTION_COLORS[unit.faction] || '#f0c866';

  const base = new Graphics();
  const s = layout?.tileSize ? layout.tileSize * 0.18 : 12;
  base.roundRect(-s, -s * 1.2, s * 2, s * 2.4, s * 0.3);
  base.fill({ color: factionColor, alpha: 0.85 });
  base.stroke({ width: 1.5, color: palette.bronze, alpha: 0.9 });
  container.addChild(base);

  const atlas = getAtlasTexture();
  if (atlas && def.artFrame) {
    const sprite = new Sprite(atlas);
    sprite.anchor.set(0.5);
    sprite.scale.set(s * 0.08);
    container.addChild(sprite);
  }

  return container;
}

export function createBuildingDisplay(building, layout) {
  const def = contentBundle?.BUILDING_TYPES?.[building.type] || { name: building.type };
  const container = new Container();
  const palette = getImperialPalette();
  const factionColor = FACTION_COLORS[building.faction] || '#f0c866';
  const s = layout?.tileSize ? layout.tileSize * 0.22 : 14;

  const plinth = new Graphics();
  plinth.roundRect(-s * 1.1, -s * 0.4, s * 2.2, s * 1.6, s * 0.2);
  plinth.fill({ color: 0x3b2817, alpha: 0.35 });
  container.addChild(plinth);

  const body = new Graphics();
  body.roundRect(-s * 0.8, -s, s * 1.6, s * 1.8, s * 0.15);
  body.fill({ color: factionColor, alpha: 0.9 });
  body.stroke({ width: 2, color: palette.bronze });
  container.addChild(body);

  if (building.turnsLeft > 0) {
    const scaffold = new Graphics();
    scaffold.rect(-s * 0.6, -s * 1.3, s * 1.2, s * 0.15);
    scaffold.fill({ color: palette.bronze, alpha: 0.7 });
    container.addChild(scaffold);
  }

  return container;
}

export function validateContentSchema(bundle) {
  const errors = [];
  if (!bundle.UNIT_TYPES || typeof bundle.UNIT_TYPES !== 'object') errors.push('Missing UNIT_TYPES');
  if (!bundle.BUILDING_TYPES || typeof bundle.BUILDING_TYPES !== 'object') errors.push('Missing BUILDING_TYPES');
  if (!bundle.FACTIONS || typeof bundle.FACTIONS !== 'object') errors.push('Missing FACTIONS');
  if (!bundle.TERRAIN || typeof bundle.TERRAIN !== 'object') errors.push('Missing TERRAIN');
  if (!bundle.CRISIS_EVENTS || typeof bundle.CRISIS_EVENTS !== 'object') errors.push('Missing CRISIS_EVENTS');

  for (const [id, unit] of Object.entries(bundle.UNIT_TYPES || {})) {
    if (unit.id !== id) errors.push(`Unit ${id} id mismatch`);
    if (!Number.isFinite(unit.hp) || unit.hp <= 0) errors.push(`Unit ${id} invalid hp`);
  }

  for (const [id, building] of Object.entries(bundle.BUILDING_TYPES || {})) {
    if (building.id !== id) errors.push(`Building ${id} id mismatch`);
    if (!Number.isFinite(building.hp) || building.hp <= 0) errors.push(`Building ${id} invalid hp`);
  }

  if (errors.length) throw new Error(errors.join('; '));
  return true;
}
