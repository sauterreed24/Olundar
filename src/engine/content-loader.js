import unitsData from '../../data/units.json' with { type: 'json' };
import buildingsData from '../../data/buildings.json' with { type: 'json' };
import factionsData from '../../data/factions.json' with { type: 'json' };
import terrainData from '../../data/terrain.json' with { type: 'json' };
import crisisEventsData from '../../data/crisisEvents.json' with { type: 'json' };

const SCHEMAS = {
  units: {
    required: ['id', 'name', 'hp', 'attack', 'range', 'move', 'sight', 'trainTurns'],
    types: { hp: 'number', attack: 'number', range: 'number', move: 'number', sight: 'number', trainTurns: 'number' }
  },
  buildings: {
    required: ['id', 'name', 'hp', 'buildTurns'],
    types: { hp: 'number', buildTurns: 'number' }
  },
  factions: {
    required: ['id', 'name', 'color'],
    types: {}
  },
  terrain: {
    required: ['id', 'name', 'move', 'passable'],
    types: { move: 'number', passable: 'boolean' }
  },
  crisisEvents: {
    required: ['id', 'name', 'choices'],
    types: {}
  }
};

let activeTables = {
  units: structuredClone(unitsData),
  buildings: structuredClone(buildingsData),
  factions: structuredClone(factionsData),
  terrain: structuredClone(terrainData),
  crisisEvents: structuredClone(crisisEventsData)
};

export function getContentTables() {
  return activeTables;
}

export function validateContentTable(name, table) {
  const schema = SCHEMAS[name];
  if (!schema) throw new Error(`Unknown content schema: ${name}`);
  for (const [id, entry] of Object.entries(table)) {
    if (entry.id !== id) throw new Error(`${name}.${id} id mismatch.`);
    for (const key of schema.required) {
      if (entry[key] === undefined) throw new Error(`${name}.${id} missing ${key}.`);
    }
    for (const [key, type] of Object.entries(schema.types)) {
      if (entry[key] !== undefined && typeof entry[key] !== type) {
        throw new Error(`${name}.${id}.${key} should be ${type}.`);
      }
    }
  }
  return true;
}

export function validateAllContentTables(tables = activeTables) {
  for (const name of Object.keys(SCHEMAS)) {
    validateContentTable(name, tables[name]);
  }
  return true;
}

export function reloadContentTables(overrides = {}) {
  const next = {
    units: structuredClone(overrides.units || unitsData),
    buildings: structuredClone(overrides.buildings || buildingsData),
    factions: structuredClone(overrides.factions || factionsData),
    terrain: structuredClone(overrides.terrain || terrainData),
    crisisEvents: structuredClone(overrides.crisisEvents || crisisEventsData)
  };
  validateAllContentTables(next);
  activeTables = next;
  return activeTables;
}

export function exportContentTables() {
  return structuredClone(activeTables);
}
