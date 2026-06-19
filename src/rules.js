import {
  BUILDING_TYPES,
  CRISIS_AFTERMATH_EVENTS,
  CRISIS_EVENTS,
  CURRENT_SAVE_VERSION,
  DIFFICULTY_PRESETS,
  DIPLOMACY_ACTIONS,
  DIPLOMATIC_PROMISES,
  FACTIONS,
  FIELD_ORDERS,
  MAP_HEIGHT,
  MAP_LENSES,
  MAP_WIDTH,
  OBJECTIVES,
  SCENARIOS,
  STARTING_RESOURCES,
  TERRAIN,
  UNIT_TYPES,
  WAR_AIMS
} from './content.js';
import { generateWorld, idx, inBounds, manhattan, neighbors4, xy } from './map.js';

const LIVING_DIPLOMACY_FACTIONS = ['dawn', 'veyr', 'mire'];
const DIPLOMACY_MEMORY_MAX = 12;

const CRISIS_OUTCOME_PREVIEWS = {
  refugeeCaravan: {
    shelter: 'Population, morale, and influence rise, but food and gold stores fall.',
    escort: 'Discovered living factions gain trust, and Olundar gains influence.',
    levy: 'A refugee spear guard joins near the capital, but morale is strained.'
  },
  famineStores: {
    ration: 'Food stores recover quickly, but morale falls.',
    buyGrain: 'Food and morale recover without population loss.',
    frontierForage: 'Food improves and a scout musters to watch the frontier.'
  },
  cityRaid: {
    nightWatch: 'Olundar holdings gain extra durability before the next assault.',
    evacuate: 'Food and morale improve, but population falls.',
    counterRaid: 'A spear guard musters near the capital and influence rises.'
  },
  emergencyCouncil: {
    coalitionEnvoys: 'Discovered living factions gain trust, and morale rises.',
    warLevy: 'A legionary musters near the capital, but home pressure costs morale.',
    fortifyGates: 'Cities, outposts, towers, and walls gain extra durability.'
  }
};

export function createGame(seed = `Olundar-${new Date().getFullYear()}`, options = {}) {
  const campaign = normalizeCampaignConfig(seed, options);
  const state = {
    version: CURRENT_SAVE_VERSION,
    seed: campaign.seed,
    campaign: {
      seed: campaign.seed,
      scenarioId: campaign.scenario.id,
      scenarioName: campaign.scenario.name,
      difficultyId: campaign.difficulty.id,
      difficultyName: campaign.difficulty.name,
      difficultyText: campaign.difficulty.text
    },
    turn: 1,
    status: 'playing',
    winner: null,
    map: generateWorld(campaign.seed),
    nextNumericId: 1,
    factions: createFactions(),
    units: [],
    buildings: [],
    visible: Array(MAP_WIDTH * MAP_HEIGHT).fill(false),
    revealed: Array(MAP_WIDTH * MAP_HEIGHT).fill(false),
    selectedUnitId: null,
    selectedBuildingId: null,
    mode: { type: 'select' },
    flags: {
      bossSlain: false,
      portalDestroyed: false,
      firstDeadwalkerSeen: false,
      firstAllySeen: false,
      deadStrongholdsDestroyed: 0,
      warAimNotices: {},
      factionPromises: {},
      promiseDemands: {}
    },
    diplomacyLog: [],
    diplomacyMemory: createDiplomacyMemoryState(),
    crises: {
      resolved: {},
      history: [],
      aftermath: { queue: [], resolved: {} },
      missions: []
    },
    objectives: OBJECTIVES.slice(),
    messages: []
  };

  placeInitialWorld(state);
  applyCampaignSetup(state, campaign);
  updateVisibility(state);
  addMessage(state, `${campaign.scenario.name} begins on ${campaign.difficulty.name}. Explore, arm the legions, and find the Deadwalker portal.`);
  return state;
}

function normalizeCampaignConfig(seedOrConfig, options = {}) {
  const raw = typeof seedOrConfig === 'object' && seedOrConfig !== null ? { ...seedOrConfig } : { seed: seedOrConfig, ...options };
  const scenario = SCENARIOS[raw.scenarioId] || SCENARIOS.founding;
  const difficulty = DIFFICULTY_PRESETS[raw.difficultyId || scenario.difficultyId] || DIFFICULTY_PRESETS.standard;
  return {
    seed: raw.seed || scenario.seed || `Olundar-${new Date().getFullYear()}`,
    scenario,
    difficulty
  };
}

function normalizeCampaignState(state) {
  if (!Array.isArray(state.diplomacyLog)) state.diplomacyLog = [];
  normalizeDiplomacyMemory(state);
  if (!state.flags) state.flags = {};
  if (!state.flags.warAimNotices) state.flags.warAimNotices = {};
  if (!state.flags.factionPromises) state.flags.factionPromises = {};
  if (!state.flags.promiseDemands) state.flags.promiseDemands = {};
  if (!state.crises) state.crises = { resolved: {}, history: [] };
  if (!state.crises.resolved) state.crises.resolved = {};
  if (!Array.isArray(state.crises.history)) state.crises.history = [];
  if (!state.crises.aftermath) state.crises.aftermath = { queue: [], resolved: {} };
  if (!Array.isArray(state.crises.aftermath.queue)) state.crises.aftermath.queue = [];
  if (!state.crises.aftermath.resolved) state.crises.aftermath.resolved = {};
  if (!Array.isArray(state.crises.missions)) state.crises.missions = [];
  if (!state.factions?.olundar?.fieldOrders) {
    if (state.factions?.olundar) state.factions.olundar.fieldOrders = {};
  }
  if (state.campaign?.scenarioId && state.campaign?.difficultyId) return;
  const fallback = normalizeCampaignConfig(state.seed || 'Olundar-Legacy');
  state.campaign = {
    seed: state.seed || fallback.seed,
    scenarioId: fallback.scenario.id,
    scenarioName: fallback.scenario.name,
    difficultyId: fallback.difficulty.id,
    difficultyName: fallback.difficulty.name,
    difficultyText: fallback.difficulty.text
  };
}

function createDiplomacyMemoryState() {
  return Object.fromEntries(LIVING_DIPLOMACY_FACTIONS.map((id) => [id, { promises: 0, grievances: 0, records: [], fulfilledOrders: {} }]));
}

function normalizeDiplomacyMemory(state) {
  if (!state.diplomacyMemory || typeof state.diplomacyMemory !== 'object') state.diplomacyMemory = {};
  for (const id of LIVING_DIPLOMACY_FACTIONS) {
    const memory = state.diplomacyMemory[id] || {};
    state.diplomacyMemory[id] = {
      promises: Math.max(0, Math.min(DIPLOMACY_MEMORY_MAX, Number(memory.promises) || 0)),
      grievances: Math.max(0, Math.min(DIPLOMACY_MEMORY_MAX, Number(memory.grievances) || 0)),
      records: Array.isArray(memory.records) ? memory.records.slice(0, 8) : [],
      fulfilledOrders: memory.fulfilledOrders && typeof memory.fulfilledOrders === 'object' ? memory.fulfilledOrders : {}
    };
  }
}

function applyCampaignSetup(state, campaign) {
  gainResources(state.factions.olundar.resources, campaign.difficulty.resourceDelta || {});
  gainResources(state.factions.olundar.resources, campaign.scenario.resourceDelta || {});
  for (const key of Object.keys(state.factions.olundar.resources)) {
    state.factions.olundar.resources[key] = Math.max(0, state.factions.olundar.resources[key] || 0);
  }
  state.factions.olundar.resources.morale = Math.max(1, Math.min(12, state.factions.olundar.resources.morale || 1));
  for (const unit of campaign.scenario.units || []) addUnit(state, unit.type, unit.faction || 'olundar', unit.x, unit.y, { name: unit.name });
}

function createFactions() {
  return {
    olundar: {
      ...clone(FACTIONS.olundar),
      resources: { ...STARTING_RESOURCES },
      population: 48,
      housing: 60,
      relations: { dawn: 25, veyr: -5, mire: 5, dead: -100 },
      discovered: true,
      pacts: {},
      trades: {},
      atWar: { dead: true },
      fieldOrders: {}
    },
    dawn: {
      ...clone(FACTIONS.dawn),
      resources: { food: 60, wood: 45, stone: 60, iron: 35, gold: 35, influence: 2, morale: 8, dread: 0 },
      population: 34,
      relations: { olundar: 25, veyr: 0, mire: 8, dead: -100 },
      discovered: false,
      pacts: {}, trades: {}, atWar: { dead: true }
    },
    veyr: {
      ...clone(FACTIONS.veyr),
      resources: { food: 50, wood: 35, stone: 30, iron: 35, gold: 100, influence: 3, morale: 6, dread: 0 },
      population: 42,
      relations: { olundar: -5, dawn: 0, mire: -8, dead: -80 },
      discovered: false,
      pacts: {}, trades: {}, atWar: { dead: true }
    },
    mire: {
      ...clone(FACTIONS.mire),
      resources: { food: 55, wood: 65, stone: 15, iron: 15, gold: 28, influence: 1, morale: 7, dread: 0 },
      population: 30,
      relations: { olundar: 5, dawn: 8, veyr: -8, dead: -100 },
      discovered: false,
      pacts: {}, trades: {}, atWar: { dead: true }
    },
    dead: {
      ...clone(FACTIONS.dead),
      resources: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0, influence: 0, morale: 0, dread: 15 },
      population: 0,
      relations: { olundar: -100, dawn: -100, veyr: -80, mire: -100 },
      discovered: false,
      pacts: {}, trades: {}, atWar: { olundar: true, dawn: true, veyr: true, mire: true }
    }
  };
}

function placeInitialWorld(state) {
  const b = (type, faction, x, y, extra = {}) => addBuilding(state, type, faction, x, y, { complete: true, ...extra });
  const u = (type, faction, x, y, extra = {}) => addUnit(state, type, faction, x, y, extra);

  b('city', 'olundar', 7, 16, { name: 'Olundar Prime' });
  b('farm', 'olundar', 6, 17);
  b('lumberCamp', 'olundar', 10, 17);
  b('barracks', 'olundar', 8, 15);
  b('watchtower', 'olundar', 5, 15);
  u('scout', 'olundar', 7, 14);
  u('legionary', 'olundar', 8, 16);
  u('archer', 'olundar', 6, 15);
  u('engineer', 'olundar', 8, 18);

  b('city', 'dawn', 14, 5, { name: 'Aureate Hill' });
  b('watchtower', 'dawn', 13, 6);
  b('barracks', 'dawn', 15, 5);
  u('spearGuard', 'dawn', 14, 6);
  u('archer', 'dawn', 15, 6);

  b('city', 'veyr', 28, 20, { name: 'Veyr Market-Crown' });
  b('stable', 'veyr', 29, 20);
  b('mine', 'veyr', 27, 19);
  u('cavalry', 'veyr', 28, 19);
  u('legionary', 'veyr', 29, 21);

  b('city', 'mire', 35, 24, { name: 'Greenmire Hold' });
  b('outpost', 'mire', 34, 23);
  u('scout', 'mire', 35, 23);
  u('archer', 'mire', 36, 24);

  b('portal', 'dead', 38, 7, { name: 'The Hollow Crown Gate' });
  b('bonePit', 'dead', 36, 7);
  b('graveForge', 'dead', 39, 9);
  u('lichBoss', 'dead', 38, 6, { name: 'Vorgath the Hollow Crown' });
  u('boneThrall', 'dead', 36, 8);
  u('boneThrall', 'dead', 37, 7);
  u('corpseArcher', 'dead', 39, 8);
  u('graveKnight', 'dead', 37, 9);
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function addUnit(state, type, faction, x, y, extra = {}) {
  const def = UNIT_TYPES[type];
  if (!def) throw new Error(`Unknown unit type: ${type}`);
  const unit = {
    id: nextId(state, 'u'),
    type,
    faction,
    name: extra.name || def.name,
    x,
    y,
    hp: extra.hp ?? def.hp,
    maxHp: def.hp,
    xp: extra.xp ?? 0,
    hasActed: false,
    fortified: 0,
    stance: extra.stance || 'ready'
  };
  state.units.push(unit);
  return unit;
}

export function addBuilding(state, type, faction, x, y, extra = {}) {
  const def = BUILDING_TYPES[type];
  if (!def) throw new Error(`Unknown building type: ${type}`);
  const building = {
    id: nextId(state, 'b'),
    type,
    faction,
    name: extra.name || def.name,
    x,
    y,
    hp: extra.hp ?? def.hp,
    maxHp: def.hp,
    turnsLeft: extra.complete === true ? 0 : (extra.turnsLeft ?? def.buildTurns),
    queue: extra.queue || [],
    upgraded: extra.upgraded || 0
  };
  state.buildings.push(building);
  if (type === 'road') state.map.tiles[idx(x, y)].road = true;
  return building;
}

function nextId(state, prefix) {
  const id = `${prefix}${state.nextNumericId}`;
  state.nextNumericId += 1;
  return id;
}

export function addMessage(state, text, tone = 'info') {
  state.messages.unshift({ turn: state.turn, text, tone });
  state.messages = state.messages.slice(0, 80);
}

export function getReadyOlundarUnits(state) {
  return state.units
    .filter((unit) => unit.faction === 'olundar' && !unit.hasActed)
    .sort((a, b) => unitCommandPriority(a) - unitCommandPriority(b) || a.y - b.y || a.x - b.x);
}

function unitCommandPriority(unit) {
  const def = getUnitDef(unit);
  if (def.tags.includes('recon')) return 1;
  if (def.tags.includes('builder')) return 2;
  if (def.tags.includes('siege')) return 3;
  if (def.tags.includes('ranged')) return 4;
  return 5;
}

export function getObjectiveProgress(state) {
  const discoveredLiving = Object.values(state.factions).filter((faction) => !faction.player && faction.id !== 'dead' && faction.discovered).length;
  const revealedPortal = state.buildings.some((building) => building.type === 'portal' && state.revealed[building.y * MAP_WIDTH + building.x]);
  const economyPieces = [
    hasOperationalBuilding(state, 'farm'),
    hasOperationalBuilding(state, 'lumberCamp'),
    hasOperationalBuilding(state, 'mine'),
    hasOperationalBuilding(state, 'barracks'),
    hasOperationalBuilding(state, 'archeryYard') || state.units.filter((unit) => unit.faction === 'olundar' && unit.type === 'archer').length >= 2
  ];
  return [
    {
      done: revealedPortal,
      detail: revealedPortal ? 'Portal revealed' : `${Math.round(revealedPercent(state))}% of the world mapped`
    },
    {
      done: economyPieces.every(Boolean),
      detail: `${economyPieces.filter(Boolean).length}/${economyPieces.length} war-economy pillars ready`
    },
    {
      done: discoveredLiving >= 2,
      detail: `${discoveredLiving}/3 living civilizations contacted`
    },
    {
      done: state.flags.bossSlain,
      detail: state.flags.bossSlain ? 'Vorgath is dead' : 'Boss still commands the portal'
    },
    {
      done: state.flags.portalDestroyed,
      detail: state.flags.portalDestroyed ? 'Portal destroyed' : 'Portal still active'
    }
  ];
}

export function getAftermathMissions(state) {
  normalizeCampaignState(state);
  const active = state.crises.missions
    .filter((mission) => !mission.completedTurn)
    .map((mission) => missionView(state, mission));
  const completed = state.crises.missions
    .filter((mission) => mission.completedTurn)
    .slice()
    .sort((a, b) => b.completedTurn - a.completedTurn || String(b.id).localeCompare(String(a.id)));
  const recentCompleted = completed.filter((mission) => state.turn - mission.completedTurn <= 4);
  const archivedCompleted = completed.filter((mission) => state.turn - mission.completedTurn > 4);
  const recent = recentCompleted.slice(0, 3).map((mission) => missionView(state, mission));
  const archive = archivedCompleted.map((mission) => missionView(state, mission));
  return {
    title: 'Aftermath Missions',
    summary: aftermathMissionSummary(active, recent, archivedCompleted.length),
    visible: state.status === 'playing' && (active.length > 0 || recent.length > 0 || archivedCompleted.length > 0),
    active,
    recent,
    archive,
    recentCount: recentCompleted.length,
    archiveCount: archivedCompleted.length,
    archiveOverflow: Math.max(0, archivedCompleted.length - archive.length),
    completedCount: completed.length
  };
}

function missionView(state, mission) {
  const tile = tileAt(state, mission.x, mission.y);
  const terrain = TERRAIN[mission.terrain || tile?.terrain];
  const site = mission.site || missionSiteName(mission.type);
  const routeStep = mission.chainLimit ? `Route ${mission.chainStep || 1}/${mission.chainLimit}` : '';
  return {
    id: mission.id,
    type: mission.type,
    name: mission.name,
    text: mission.text,
    tone: mission.tone || 'info',
    x: mission.x,
    y: mission.y,
    target: `${mission.x},${mission.y}`,
    required: missionRequirementText(mission.required),
    site,
    terrain: terrain?.name || 'Unknown terrain',
    context: [site, terrain?.name, routeStep].filter(Boolean).join(' / '),
    route: missionRoutePreview(state, mission),
    completed: Boolean(mission.completedTurn),
    completedTurn: mission.completedTurn || null,
    completedBy: mission.completedBy || '',
    reward: mission.completedTurn && mission.resultText ? mission.resultText : mission.rewardText || 'A small campaign reward follows completion.'
  };
}

function missionRoutePreview(state, mission) {
  const candidates = state.units
    .filter((unit) => unit.faction === 'olundar' && unitCanCompleteMission(unit, mission))
    .map((unit) => missionRouteCandidate(state, mission, unit));
  const routed = candidates
    .filter((candidate) => candidate.path)
    .sort((a, b) => a.cost - b.cost || a.distance - b.distance || a.unit.y - b.unit.y || a.unit.x - b.unit.x);
  const ready = routed
    .filter((candidate) => candidate.reachableThisTurn)
    .sort((a, b) => a.cost - b.cost || a.distance - b.distance || a.unit.y - b.unit.y || a.unit.x - b.unit.x)[0];
  const pick = ready || routed[0] || candidates[0];

  if (!pick) {
    const required = missionRequirementPhrase(mission.required);
    return {
      tone: 'danger',
      label: 'No eligible unit',
      text: `Train or keep ${required} available for this field task.`,
      unitId: null,
      unitName: '',
      reachableThisTurn: false,
      cost: null
    };
  }

  const location = `${pick.unit.x},${pick.unit.y}`;
  const costText = Number.isFinite(pick.cost) ? `${pick.cost} move${pick.cost === 1 ? '' : 's'}` : 'unknown route';
  const base = {
    unitId: pick.unit.id,
    unitName: pick.unit.name,
    unitType: pick.unit.type,
    unitLocation: location,
    reachableThisTurn: pick.reachableThisTurn,
    cost: Number.isFinite(pick.cost) ? pick.cost : null,
    path: pick.path ? missionVisibleRoutePath(state, pick.unit, pick.path) : []
  };

  if (!pick.path) {
    return {
      ...base,
      tone: 'danger',
      label: 'No open route',
      text: `${pick.unit.name} is eligible at ${location}, but no passable route to ${mission.x},${mission.y} is open.`
    };
  }

  if (pick.reachableThisTurn) {
    return {
      ...base,
      tone: 'good',
      label: 'Reachable now',
      text: `${pick.unit.name} can complete this turn from ${location} (${costText}).`
    };
  }

  if (pick.unit.hasActed) {
    return {
      ...base,
      tone: 'info',
      label: 'Already acted',
      text: `${pick.unit.name} is closest at ${location}; the route costs ${costText}, but the unit has acted.`
    };
  }

  const turns = Math.max(2, Math.ceil(pick.cost / Math.max(1, pick.move)));
  return {
    ...base,
    tone: 'info',
    label: 'Stage route',
    text: `${pick.unit.name} is closest at ${location}; ${costText} means about ${turns} turns of movement.`
  };
}

function missionRouteCandidate(state, mission, unit) {
  const def = getUnitDef(unit);
  const path = findPath(state, unit, mission.x, mission.y, Infinity);
  const turnPath = !unit.hasActed ? findPath(state, unit, mission.x, mission.y, def.move) : null;
  return {
    unit,
    move: def.move,
    path,
    cost: path?.cost ?? Infinity,
    distance: manhattan(unit.x, unit.y, mission.x, mission.y),
    reachableThisTurn: Boolean(turnPath)
  };
}

function missionVisibleRoutePath(state, unit, route) {
  return [{ x: unit.x, y: unit.y }, ...route.path.map((key) => xy(key))]
    .filter((point) => isRevealed(state, point.x, point.y));
}

function missionRequirementPhrase(required = 'any') {
  const text = missionRequirementText(required).toLowerCase();
  return text.startsWith('any') ? text : `a ${text}`;
}

function missionSiteName(type = '') {
  if (type === 'repair') return 'Raid scar';
  if (type === 'raid') return 'Raider camp';
  if (type === 'escort') return 'Road camp';
  if (type === 'accord') return 'Envoy waystation';
  return 'Field site';
}

function missionRequirementText(required = 'any') {
  if (required === 'engineer') return 'Engineer';
  if (required === 'recon') return 'Scout or cavalry';
  if (required === 'combat') return 'Combat unit';
  return 'Any Olundaran unit';
}

function aftermathMissionSummary(active, recent, archiveCount = 0) {
  if (active.length > 1) return `${active.length} aftermath field tasks are shaping the map. Use the Missions lens to find their targets.`;
  if (active.length === 1) return `${active[0].name} is marked on the map. Send the right unit to finish the consequence.`;
  if (recent.length) return 'Recent aftermath missions are complete; their rewards are now part of the campaign.';
  if (archiveCount) return `${archiveCount} older mission outcome${archiveCount === 1 ? '' : 's'} remain in the archive.`;
  return 'No aftermath missions are active.';
}

export function getEndTurnWarnings(state) {
  if (state.status !== 'playing') return [];
  const warnings = [];
  const ready = getReadyOlundarUnits(state);
  if (ready.length) {
    warnings.push(`${ready.length} Olundaran unit${ready.length === 1 ? ' is' : 's are'} still ready: ${ready.slice(0, 4).map((unit) => unit.name).join(', ')}${ready.length > 4 ? '...' : ''}.`);
  }
  if (state.mode.type === 'build') warnings.push('A build order is selected but not placed.');
  return warnings;
}

export function getWarCouncil(state) {
  normalizeCampaignState(state);
  const faction = state.factions.olundar;
  const ready = getReadyOlundarUnits(state);
  const discoveredLiving = Object.values(state.factions).filter((other) => !other.player && other.id !== 'dead' && other.discovered).length;
  const knownDead = knownDeadwalkerThreat(state);
  const priorities = [];

  if (state.status === 'won') {
    priorities.push({ tone: 'good', text: 'The Bone Portal is destroyed. Start a new campaign for a fresh strategic problem.' });
  } else if (state.status === 'lost') {
    priorities.push({ tone: 'danger', text: 'Olundar has fallen. Restart and scout earlier for allies, iron, and tower positions.' });
  } else {
    if (ready.length) priorities.push({ tone: 'good', text: `Issue orders to ${ready.length} ready unit${ready.length === 1 ? '' : 's'} before ending the turn.` });
    if (!state.flags.firstAllySeen) priorities.push({ tone: 'info', text: 'Send the scout along the roads to locate living civilizations before diplomacy becomes urgent.' });
    if (!hasOperationalBuilding(state, 'mine')) priorities.push({ tone: 'info', text: 'Secure iron with a Hill Mine. Legionaries, spears, and siege all depend on it.' });
    if (!hasOperationalBuilding(state, 'archeryYard')) priorities.push({ tone: 'info', text: 'Build an Archery Yard before the first major Deadwalker push reaches your roads.' });
    if (discoveredLiving > 0 && !Object.values(faction.pacts).some(Boolean)) priorities.push({ tone: 'info', text: 'Turn first contact into a Survival Pact for shared vision and emergency aid.' });
    if (knownDead && !hasOperationalBuilding(state, 'workshop')) priorities.push({ tone: 'danger', text: 'Deadwalker infrastructure is known. Prepare a Siege Workshop and onagers before entering blight.' });
    if ((faction.resources.morale || 0) <= 3) priorities.push({ tone: 'danger', text: 'Morale is close to collapse. Build a Sun Shrine or stabilize food and upkeep.' });
    if (!priorities.length) priorities.push({ tone: 'good', text: 'Olundar is stable. Expand roads and towers toward the portal while training a balanced army.' });
  }

  return {
    headline: councilHeadline(state, knownDead),
    campaign: {
      scenarioName: state.campaign.scenarioName,
      difficultyName: state.campaign.difficultyName,
      difficultyText: state.campaign.difficultyText
    },
    priorities: priorities.slice(0, 4),
    stats: [
      { label: 'Mapped', value: `${Math.round(revealedPercent(state))}%` },
      { label: 'Ready units', value: ready.length },
      { label: 'Army', value: state.units.filter((unit) => unit.faction === 'olundar').length },
      { label: 'Allies found', value: `${discoveredLiving}/3` },
      { label: 'Dead pressure', value: knownDead ? knownDead.label : 'Unknown' }
    ]
  };
}

export function getDiplomacyLedger(state) {
  normalizeCampaignState(state);
  const actor = state.factions.olundar;
  const entries = LIVING_DIPLOMACY_FACTIONS.map((id) => diplomacyLedgerEntry(state, actor, id));
  const contacted = entries.filter((entry) => entry.discovered).length;
  const pacts = entries.filter((entry) => entry.pact).length;
  const trades = entries.filter((entry) => entry.trade).length;
  const rivals = entries.filter((entry) => entry.atWar).length;
  const promises = entries.reduce((total, entry) => total + entry.memory.promises, 0);
  const grievances = entries.reduce((total, entry) => total + entry.memory.grievances, 0);
  return {
    title: 'Diplomacy Ledger',
    summary: diplomacyLedgerSummary(state, entries),
    stats: [
      { label: 'Contacts', value: `${contacted}/3` },
      { label: 'Pacts', value: `${pacts}/3` },
      { label: 'Trade', value: trades },
      { label: 'Rivals', value: rivals },
      { label: 'Promises', value: promises },
      { label: 'Grievances', value: grievances }
    ],
    entries,
    recent: (state.diplomacyLog || []).slice(0, 5)
  };
}

function diplomacyLedgerEntry(state, actor, id) {
  const faction = state.factions[id];
  const relation = actor.relations[id] ?? 0;
  const discovered = Boolean(faction.discovered);
  const atWar = Boolean(actor.atWar?.[id] || faction.atWar?.olundar);
  const pact = Boolean(actor.pacts?.[id]);
  const trade = Boolean(actor.trades?.[id]);
  const fieldOrderId = pact ? actor.fieldOrders?.[id] || 'defendRoads' : null;
  const fieldOrder = fieldOrderId ? FIELD_ORDERS[fieldOrderId] : null;
  const warAim = discovered ? factionWarAim(state, id) : null;
  const memory = diplomacyMemoryView(state, id);
  const posture = discovered ? diplomacyPosture(relation, atWar, pact) : { label: 'Uncontacted', tone: 'info' };
  const recent = (state.diplomacyLog || []).filter((record) => record.factionId === id).slice(0, 2);
  const demandViews = Object.values(DIPLOMATIC_PROMISES)
    .filter((promise) => promise.factionId === id)
    .map((promise) => diplomaticDemandView(state, promise, discovered, atWar))
    .filter(Boolean);
  return {
    id,
    name: faction.name,
    banner: faction.banner,
    temperament: faction.temperament,
    text: faction.text,
    discovered,
    relation,
    posture,
    pact,
    trade,
    atWar,
    fieldOrder,
    warAim,
    memory,
    tags: diplomacyTags(discovered, relation, pact, trade, atWar, fieldOrder, warAim, memory),
    advice: diplomacyAdvice(state, id, relation, discovered, pact, trade, atWar, warAim, memory),
    recent,
    actions: Object.keys(DIPLOMACY_ACTIONS).map((actionId) => diplomacyActionView(state, id, actionId, relation, discovered, pact, trade, atWar)),
    commitments: Object.values(DIPLOMATIC_PROMISES)
      .filter((promise) => promise.factionId === id)
      .map((promise) => diplomaticPromiseView(state, id, promise, discovered, atWar)),
    demands: demandViews.filter((demand) => demand.active),
    demandHistory: demandViews.filter((demand) => demand.completed),
    fieldOrders: Object.values(FIELD_ORDERS).map((order) => ({
      ...order,
      active: fieldOrder?.id === order.id,
      disabled: !discovered || !pact || atWar,
      disabledReason: !discovered ? 'Uncontacted.' : !pact ? 'Requires a Survival Pact.' : atWar ? 'At war.' : ''
    }))
  };
}

function diplomacyLedgerSummary(state, entries) {
  const contacted = entries.filter((entry) => entry.discovered).length;
  const pacts = entries.filter((entry) => entry.pact).length;
  const rivals = entries.filter((entry) => entry.atWar).length;
  if (!contacted) return 'No living civilizations have been contacted. Scout roads, hills, and ruins before the Deadwalker front closes in.';
  if (rivals) return `${rivals} living civilization${rivals === 1 ? ' is' : 's are'} hostile. Keep the survival war focused before political damage spreads.`;
  if (!pacts) return `${contacted}/3 civilizations contacted. Convert trust into at least one Survival Pact for shared sight and emergency aid.`;
  const knownDead = knownDeadwalkerThreat(state);
  if (knownDead) return `${pacts} pact${pacts === 1 ? '' : 's'} active while Deadwalker pressure is ${knownDead.label.toLowerCase()}. Use aid and trade before the siege push.`;
  return `${contacted}/3 civilizations contacted and ${pacts} pact${pacts === 1 ? '' : 's'} active. Build a coalition before the portal war peaks.`;
}

function diplomacyPosture(relation, atWar, pact) {
  if (atWar) return { label: 'Rival', tone: 'danger' };
  if (pact) return { label: 'Bound ally', tone: 'good' };
  if (relation >= 50) return { label: 'Trusted', tone: 'good' };
  if (relation >= 35) return { label: 'Pact-ready', tone: 'good' };
  if (relation >= 20) return { label: 'Friendly', tone: 'info' };
  if (relation >= 0) return { label: 'Wary', tone: 'info' };
  if (relation <= -35) return { label: 'Hostile', tone: 'danger' };
  return { label: 'Strained', tone: 'danger' };
}

function factionWarAim(state, factionId) {
  const faction = state.factions[factionId];
  if (!faction || factionId === 'olundar' || factionId === 'dead') return null;
  if (state.factions.olundar.atWar?.[factionId] || faction.atWar?.olundar) return WAR_AIMS.rivalClaim;
  if (factionId === 'dawn') return WAR_AIMS.dawnBulwark;
  if (factionId === 'veyr') return WAR_AIMS.veyrRaid;
  if (factionId === 'mire') return WAR_AIMS.mireScout;
  return null;
}

function diplomacyTags(discovered, relation, pact, trade, atWar, fieldOrder = null, warAim = null, memory = null) {
  if (!discovered) return ['Uncontacted'];
  const tags = [`Relation ${relation}`];
  if (pact) tags.push('Survival Pact');
  if (trade) tags.push('Trade');
  if (fieldOrder) tags.push(fieldOrder.name);
  if (Object.values(DIPLOMATIC_PROMISES).some((promise) => promise.factionId && memory?.records.some((record) => record.label === promise.name))) tags.push('Faction promise');
  if (memory?.promises) tags.push(`Promises ${memory.promises}`);
  if (memory?.grievances) tags.push(`Grievances ${memory.grievances}`);
  if (warAim && !pact) tags.push(`Aim: ${warAim.name}`);
  if (atWar) tags.push('At war');
  if (!pact && !trade && !atWar) tags.push('No accord');
  return tags;
}

function diplomacyMemoryView(state, factionId) {
  const memory = ensureDiplomacyMemory(state, factionId);
  const balance = memory.promises - memory.grievances;
  return {
    promises: memory.promises,
    grievances: memory.grievances,
    balance,
    tone: memory.grievances > memory.promises ? 'danger' : memory.promises ? 'good' : 'info',
    summary: diplomacyMemorySummary(memory),
    records: memory.records.slice(0, 3)
  };
}

function diplomacyMemorySummary(memory) {
  if (memory.promises > memory.grievances + 2) return 'Oaths and fulfilled commitments are outweighing old grievances.';
  if (memory.grievances > memory.promises + 1) return 'Unsettled grievances are now shaping every negotiation.';
  if (memory.promises && !memory.grievances) return 'Early promises are on the record, but this front still needs proof under pressure.';
  if (memory.grievances && !memory.promises) return 'Grievances are on the record, and no kept promise is balancing them yet.';
  if (memory.promises || memory.grievances) return 'Trust and resentment are both present; future rulings can tip this front.';
  return 'No major promises or grievances have been recorded yet.';
}

function diplomacyAdvice(state, id, relation, discovered, pact, trade, atWar, warAim = null, memory = null) {
  if (!discovered) return `${state.factions[id].name} is still beyond current sight. Scout roads, towers, and frontier ruins to open talks.`;
  if (atWar) return 'This front is politically hostile. Defend first; aid, trade, and pacts are unavailable while rivalry is open.';
  if ((memory?.grievances || 0) >= 5) return 'Grievances are stacking. Avoid pressure and spend influence on repair before another crisis turns them hostile.';
  if ((memory?.promises || 0) >= (memory?.grievances || 0) + 3 && pact) return 'Kept commitments are giving this pact depth. Field orders and aid are more politically credible here.';
  if (!pact && relation >= 17) return 'Offer a Survival Pact now; the relation threshold is within reach and shared vision matters.';
  if (!trade && canAfford(state.factions.olundar.resources, DIPLOMACY_ACTIONS.trade.cost)) return 'Open trade to fund the war economy and keep relations warming.';
  if (!pact && warAim?.id === 'veyrRaid') return 'Veyr is already raiding for leverage. Trade can turn that ambition into useful supply lines.';
  if (!pact && warAim?.id === 'mireScout') return 'Mireclan scouts are watching the blight. A pact would turn their field knowledge into shared vision.';
  if (!pact && warAim?.id === 'dawnBulwark') return 'Dawnward forces are defensive by instinct. Respect their walls and turn trust into a pact.';
  if (relation < 20) return 'Build trust before requesting war aid; aid is likely refused below 20 relation.';
  if (pact && knownDeadwalkerThreat(state)) return 'Use this pact for shared sight, then request aid when the siege front becomes urgent.';
  return 'Keep pressure low and preserve influence for aid, pacts, or emergency diplomacy.';
}

function diplomacyActionView(state, factionId, actionId, relation, discovered, pact, trade, atWar) {
  const action = DIPLOMACY_ACTIONS[actionId];
  let disabledReason = '';
  if (!discovered) disabledReason = 'Uncontacted.';
  else if (atWar) disabledReason = 'At war.';
  else if (actionId === 'pact' && pact) disabledReason = 'Pact active.';
  else if (actionId === 'trade' && trade) disabledReason = 'Trade active.';
  else if (!canAfford(state.factions.olundar.resources, action.cost)) disabledReason = `Need ${formatCost(missingCost(state.factions.olundar.resources, action.cost))}.`;
  const note = actionId === 'aid' && relation < 20 && !disabledReason ? 'Likely refused below 20 relation.' : action.text;
  return {
    id: actionId,
    name: action.name,
    cost: formatCost(action.cost),
    text: action.text,
    note,
    disabled: Boolean(disabledReason),
    disabledReason
  };
}

function diplomaticPromiseView(state, factionId, promise, discovered, atWar) {
  const fulfilled = Boolean(state.flags.factionPromises?.[promise.id]);
  let disabledReason = '';
  if (!discovered) disabledReason = 'Uncontacted.';
  else if (atWar) disabledReason = 'At war.';
  else if (fulfilled) disabledReason = 'Promise already kept.';
  else if (!canAfford(state.factions.olundar.resources, promise.cost)) disabledReason = `Need ${formatCost(missingCost(state.factions.olundar.resources, promise.cost))}.`;
  return {
    id: promise.id,
    name: promise.name,
    text: promise.text,
    preview: promise.preview,
    cost: formatCost(promise.cost),
    fulfilled,
    disabled: Boolean(disabledReason),
    disabledReason
  };
}

function diplomaticDemandView(state, promise, discovered, atWar) {
  const demand = promise.demand;
  const keptTurn = Number(state.flags.factionPromises?.[promise.id]) || 0;
  if (!demand || !keptTurn) return null;
  const response = state.flags.promiseDemands?.[demand.id];
  if (response) {
    if (state.turn - response.turn > 4) return null;
    return {
      id: demand.id,
      promiseId: promise.id,
      name: demand.name,
      text: response.detail || demand.text,
      cost: formatCost(demand.cost),
      active: false,
      completed: true,
      status: response.status,
      turn: response.turn,
      tone: response.status === 'answered' ? 'good' : 'danger'
    };
  }
  const dueTurn = keptTurn + demand.delay;
  if (!discovered || atWar || state.turn < dueTurn) return null;
  const resources = state.factions.olundar.resources;
  const affordable = canAfford(resources, demand.cost);
  return {
    id: demand.id,
    promiseId: promise.id,
    name: demand.name,
    text: demand.text,
    preview: demand.preview,
    cost: formatCost(demand.cost),
    dueTurn,
    active: true,
    completed: false,
    disabled: !affordable,
    disabledReason: affordable ? '' : `Need ${formatCost(missingCost(resources, demand.cost))}.`,
    tone: 'danger'
  };
}

export function getCampaignRecap(state, context = 'current') {
  normalizeCampaignState(state);
  const objectiveProgress = getObjectiveProgress(state);
  const knownDead = knownDeadwalkerThreat(state);
  const discoveredLiving = Object.values(state.factions).filter((faction) => !faction.player && faction.id !== 'dead' && faction.discovered).length;
  const pacts = Object.values(state.factions.olundar.pacts || {}).filter(Boolean).length;
  const trades = Object.values(state.factions.olundar.trades || {}).filter(Boolean).length;
  const olundarUnits = state.units.filter((unit) => unit.faction === 'olundar');
  const olundarBuildings = state.buildings.filter((building) => building.faction === 'olundar');
  const deadBuildings = state.buildings.filter((building) => building.faction === 'dead');
  const mapped = Math.round(revealedPercent(state));
  const tone = state.status === 'won' ? 'good' : state.status === 'lost' ? 'danger' : 'info';
  const statusLabel = state.status === 'won' ? 'Victory' : state.status === 'lost' ? 'Defeat' : 'In Progress';
  const milestones = state.objectives.map((objective, index) => ({
    label: objective,
    done: Boolean(objectiveProgress[index]?.done),
    detail: objectiveProgress[index]?.detail || 'No progress recorded'
  }));

  return {
    title: recapTitle(state, context),
    subtitle: `${state.campaign.scenarioName} - ${state.campaign.difficultyName} - Turn ${state.turn}`,
    tone,
    statusLabel,
    summary: recapSummary(state, mapped, discoveredLiving, knownDead),
    stats: [
      { label: 'Status', value: statusLabel },
      { label: 'Mapped', value: `${mapped}%` },
      { label: 'Army', value: olundarUnits.length },
      { label: 'Holdings', value: olundarBuildings.length },
      { label: 'Pacts', value: `${pacts}/3` },
      { label: 'Deadworks', value: deadBuildings.length }
    ],
    details: [
      `Morale ${Math.floor(state.factions.olundar.resources.morale || 0)} with ${state.factions.olundar.population}/${state.factions.olundar.housing} population housed.`,
      `${discoveredLiving}/3 living civilizations contacted, ${pacts} survival pact${pacts === 1 ? '' : 's'}, ${trades} trade route${trades === 1 ? '' : 's'}.`,
      `${state.flags.deadStrongholdsDestroyed || 0} Deadwalker stronghold${state.flags.deadStrongholdsDestroyed === 1 ? '' : 's'} destroyed; threat pressure is ${knownDead ? knownDead.label.toLowerCase() : 'unknown'}.`
    ],
    milestones,
    nextSteps: recapNextSteps(state, objectiveProgress, knownDead)
  };
}

function recapTitle(state, context) {
  if (context === 'import') return 'Imported Campaign Recap';
  if (state.status === 'won') return 'Victory Recap';
  if (state.status === 'lost') return 'Defeat Recap';
  return 'Campaign Recap';
}

function recapSummary(state, mapped, discoveredLiving, knownDead) {
  if (state.status === 'won') {
    return `Olundar survived in ${state.turn} turns. The living front mapped ${mapped}% of the world, contacted ${discoveredLiving}/3 civilizations, and shattered the Bone Portal.`;
  }
  if (state.status === 'lost') {
    return `Olundar fell on turn ${state.turn}. The campaign reached ${mapped}% map knowledge before the Deadwalker war overwhelmed the capital or morale.`;
  }
  if (knownDead) {
    return `This campaign is active on turn ${state.turn}. Deadwalker pressure is ${knownDead.label.toLowerCase()}, with ${mapped}% of the world mapped.`;
  }
  return `This campaign is active on turn ${state.turn}. The frontier is still forming, with ${mapped}% of the world mapped and ${discoveredLiving}/3 living civilizations contacted.`;
}

function recapNextSteps(state, objectiveProgress, knownDead) {
  if (state.status === 'won') {
    return [
      'Start a new campaign with a harder difficulty, different scenario, or custom seed.',
      'Review which allies, siege operations, and stronghold kills made the win reliable.'
    ];
  }
  if (state.status === 'lost') {
    const advice = ['Scout earlier for allies, iron, and tower lines before the Deadwalker front arrives.'];
    if (!hasOperationalBuilding(state, 'mine')) advice.push('Secure a Hill Mine sooner so legionaries, spear guards, and siege do not stall.');
    if (!Object.values(state.factions.olundar.pacts || {}).some(Boolean)) advice.push('Convert first contact into a Survival Pact for shared sight and emergency aid.');
    if (!hasOperationalBuilding(state, 'workshop')) advice.push('Build a Siege Workshop before trying to enter heavy blight.');
    return advice.slice(0, 4);
  }

  const council = getWarCouncil(state);
  const nextSteps = council.priorities.map((priority) => priority.text);
  const siege = getSiegeOperations(state);
  const nextOperation = siege.visible ? siege.operations.find((operation) => !operation.done && operation.tone !== 'locked') || siege.operations.find((operation) => !operation.done) : null;
  if (nextOperation) nextSteps.push(`Siege operation: ${nextOperation.label}. ${nextOperation.detail}`);
  if (!objectiveProgress[4]?.done && state.flags.bossSlain) nextSteps.push('Vorgath is dead; commit siege units and veterans to destroy the Bone Portal.');
  if (!knownDead && !state.flags.firstDeadwalkerSeen) nextSteps.push('Push scouts and towers east until the Deadwalker front is visible.');
  return nextSteps.slice(0, 4);
}

export function getFirstTurnsGuide(state) {
  normalizeCampaignState(state);
  const mapped = Math.round(revealedPercent(state));
  const discoveredLiving = Object.values(state.factions).filter((faction) => !faction.player && faction.id !== 'dead' && faction.discovered).length;
  const trainingStarted = state.buildings.some((building) => building.faction === 'olundar' && building.queue?.length)
    || state.messages.some((message) => message.text.includes('training begun') || message.text.includes('musters at'));
  const constructionStarted = state.messages.some((message) => message.text.includes('construction started') || message.text.includes('completed'));
  const mineStarted = state.buildings.some((building) => building.faction === 'olundar' && building.type === 'mine');
  const knownDead = knownDeadwalkerThreat(state);
  const steps = [
    {
      id: 'scout',
      label: 'Move a scout beyond the capital',
      done: mapped >= 10 || state.flags.firstAllySeen,
      detail: `${mapped}% mapped. Roads, forests, and hills reveal the safest expansion lanes.`
    },
    {
      id: 'engineer',
      label: 'Spend the engineer action',
      done: constructionStarted,
      detail: 'Start a road, mine, tower, or economy site so the first turn creates momentum.'
    },
    {
      id: 'training',
      label: 'Queue one fresh unit',
      done: trainingStarted,
      detail: 'Use the City Center or Barracks before Deadwalker pressure starts to compound.'
    },
    {
      id: 'iron',
      label: 'Claim iron for the legions',
      done: mineStarted,
      detail: 'A Hill Mine or ruin mine unlocks reliable legionaries, spear guards, and siege.'
    },
    {
      id: 'contact',
      label: 'Find a living civilization',
      done: discoveredLiving > 0,
      detail: `${discoveredLiving}/3 contacted. First contact opens trade, aid, and survival pacts.`
    },
    {
      id: 'front',
      label: 'Mark the Deadwalker front',
      done: Boolean(knownDead),
      detail: knownDead ? `${knownDead.label} pressure is now visible.` : 'Push east with towers or scouts before the portal war reaches Olundar.'
    }
  ];
  const completed = steps.filter((step) => step.done).length;
  const current = steps.find((step) => !step.done) || steps[steps.length - 1];
  const early = state.turn <= 6;
  return {
    title: early ? 'First Six Turns' : 'War Rhythm',
    phase: guidePhase(state, completed, steps.length),
    summary: guideSummary(state, current),
    currentId: current.id,
    completed,
    total: steps.length,
    visible: state.status === 'playing' && (early || completed < steps.length),
    steps
  };
}

function guidePhase(state, completed, total) {
  if (completed === total) return 'Opening plan complete';
  if (state.turn <= 2) return 'Scout, build, queue';
  if (state.turn <= 4) return 'Economy into defense';
  if (state.turn <= 6) return 'Contact and warning line';
  return 'Unfinished opening priorities';
}

function guideSummary(state, current) {
  if (state.campaign?.difficultyId === 'hollowCrown') {
    return `Hollow Crown pressure starts immediately. Next best order: ${current.label}.`;
  }
  if (state.campaign?.difficultyId === 'chronicle') {
    return `Chronicle gives room to learn the map. Next best order: ${current.label}.`;
  }
  return `Keep every early action tied to survival. Next best order: ${current.label}.`;
}

export function getSiegeOperations(state) {
  normalizeCampaignState(state);
  const faction = state.factions.olundar;
  const knownDead = knownDeadwalkerThreat(state);
  const discoveredLiving = ['dawn', 'veyr', 'mire'].filter((id) => state.factions[id].discovered).length;
  const pacts = Object.values(faction.pacts || {}).filter(Boolean).length;
  const livingCapitals = ['dawn', 'veyr', 'mire'].filter((id) => state.buildings.some((building) => building.faction === id && building.type === 'city'));
  const alliedCapitalText = `${livingCapitals.length}/3 living capitals still stand`;
  const onagerQueued = state.buildings.some((building) => building.faction === 'olundar' && building.queue?.some((entry) => entry.unitType === 'onager'));
  const onagerReady = state.units.some((unit) => unit.faction === 'olundar' && unit.type === 'onager');
  const workshopReady = hasOperationalBuilding(state, 'workshop');
  const knownStrongholds = state.buildings.filter((building) => building.faction === 'dead' && ['bonePit', 'graveForge', 'necropolis'].includes(building.type) && isRevealed(state, building.x, building.y));
  const deadStrongholdsDestroyed = state.flags.deadStrongholdsDestroyed || 0;
  const boss = state.units.find((unit) => unit.type === 'lichBoss');
  const portal = state.buildings.find((building) => building.type === 'portal');
  const operations = [
    {
      id: 'siege',
      label: 'Muster onager crews',
      done: onagerReady,
      tone: onagerReady ? 'good' : workshopReady || onagerQueued ? 'info' : 'locked',
      detail: onagerReady ? 'Siege weapons are ready to crack grave-forges, necropolises, and the portal.' : onagerQueued ? 'An onager crew is in training.' : workshopReady ? 'Workshop ready. Queue an onager before entering heavy blight.' : 'Build a Siege Workshop once iron and wood income can support it.'
    },
    {
      id: 'ally',
      label: 'Bind one ally to the living front',
      done: pacts > 0,
      tone: pacts > 0 ? 'good' : livingCapitals.length < 3 ? 'danger' : 'info',
      detail: pacts > 0 ? `${pacts} survival pact${pacts === 1 ? '' : 's'} active. Allied sight can keep the front from going dark.` : `${discoveredLiving}/3 civilizations contacted. ${alliedCapitalText}.`
    },
    {
      id: 'cleanse',
      label: 'Destroy a Deadwalker stronghold',
      done: deadStrongholdsDestroyed > 0,
      tone: deadStrongholdsDestroyed > 0 ? 'good' : knownStrongholds.length ? 'danger' : 'locked',
      detail: deadStrongholdsDestroyed > 0 ? `${deadStrongholdsDestroyed} stronghold${deadStrongholdsDestroyed === 1 ? '' : 's'} broken; nearby blight weakens when they fall.` : knownStrongholds.length ? `${knownStrongholds.length} revealed stronghold${knownStrongholds.length === 1 ? '' : 's'}: target bone pits before they multiply.` : 'Reveal bone pits, grave-forges, or necropolises to open a safe siege target.'
    },
    {
      id: 'vorgath',
      label: 'Kill Vorgath the Hollow Crown',
      done: state.flags.bossSlain,
      tone: state.flags.bossSlain ? 'good' : boss && isRevealed(state, boss.x, boss.y) ? 'danger' : 'locked',
      detail: state.flags.bossSlain ? 'The Hollow Crown is dead. The portal can no longer reform under his command.' : boss && isRevealed(state, boss.x, boss.y) ? 'Vorgath is located. Bring ranged support, line infantry, and siege cover.' : 'Scout the eastern blight until Vorgath is visible.'
    },
    {
      id: 'portal',
      label: 'Shatter the Bone Portal',
      done: state.flags.portalDestroyed,
      tone: state.flags.portalDestroyed ? 'good' : state.flags.bossSlain ? 'danger' : 'locked',
      detail: state.flags.portalDestroyed ? 'The invasion is broken.' : state.flags.bossSlain ? 'Vorgath is dead. Commit onagers and veterans to finish the portal.' : portal && isRevealed(state, portal.x, portal.y) ? 'Portal found, but it will reform until Vorgath is killed.' : 'Find the portal and kill Vorgath before the final assault.'
    }
  ];
  const completed = operations.filter((operation) => operation.done).length;
  return {
    title: 'Siege Operations',
    summary: siegeOperationSummary(state, operations),
    visible: state.status === 'playing' && (state.turn > 6 || state.flags.firstDeadwalkerSeen || state.flags.firstAllySeen || workshopReady || onagerQueued || onagerReady),
    completed,
    total: operations.length,
    operations
  };
}

function siegeOperationSummary(state, operations) {
  const next = operations.find((operation) => !operation.done && operation.tone !== 'locked') || operations.find((operation) => !operation.done);
  if (!next) return 'All siege operations are complete. Finish the campaign state and prepare a fresh war.';
  if (state.flags.firstDeadwalkerSeen) return `Deadwalker pressure is confirmed. Next operation: ${next.label}.`;
  if (state.flags.firstAllySeen) return `The living world is in reach. Next operation: ${next.label}.`;
  return `Once the opening is stable, shift from survival to victory. Next operation: ${next.label}.`;
}

export function getCrisisCouncil(state) {
  normalizeCampaignState(state);
  const events = [
    ...Object.values(CRISIS_EVENTS)
      .filter((event) => crisisIsAvailable(state, event.id))
      .map((event) => crisisEventView(state, event)),
    ...activeCrisisAftermath(state).map((item) => crisisAftermathEventView(state, item))
  ];
  const history = state.crises.history
    .filter((record) => state.turn - record.turn <= 4)
    .slice(0, 3);
  return {
    title: 'Crisis Council',
    summary: crisisCouncilSummary(events, history),
    visible: state.status === 'playing' && (events.length > 0 || history.length > 0),
    events,
    history
  };
}

export function resolveCrisis(state, crisisId, choiceId) {
  normalizeCampaignState(state);
  const event = CRISIS_EVENTS[crisisId];
  if (!event) {
    const aftermathItem = activeCrisisAftermath(state).find((item) => item.eventId === crisisId);
    return aftermathItem ? resolveCrisisAftermath(state, aftermathItem, choiceId) : { ok: false, reason: 'Unknown crisis.' };
  }
  if (state.crises.resolved[crisisId]) return { ok: false, reason: 'That crisis has already been settled.' };
  if (!crisisIsAvailable(state, crisisId)) return { ok: false, reason: 'That crisis is not active.' };
  const choice = event.choices.find((entry) => entry.id === choiceId);
  if (!choice) return { ok: false, reason: 'Unknown crisis ruling.' };
  const resources = state.factions.olundar.resources;
  if (!canAfford(resources, choice.cost)) return { ok: false, reason: `Need ${formatCost(missingCost(resources, choice.cost))}.` };

  payCost(resources, choice.cost);
  const outcome = applyCrisisOutcome(state, crisisId, choiceId);
  state.crises.resolved[crisisId] = choiceId;
  scheduleCrisisAftermath(state, crisisId, choiceId);
  state.crises.history.unshift({
    turn: state.turn,
    crisisId,
    crisisName: event.name,
    choiceId,
    choiceName: choice.name,
    outcome: outcome.text,
    tone: outcome.tone
  });
  state.crises.history = state.crises.history.slice(0, 8);
  addMessage(state, `${event.name}: ${outcome.text}`, outcome.tone);
  updateVisibility(state);
  return { ok: true, reason: outcome.text, outcome };
}

function crisisCouncilSummary(events, history) {
  if (events.length > 1) return `${events.length} rulings wait for Olundar's council. Spend scarce stores where the long war needs it most.`;
  if (events.length === 1) return `${events[0].name} needs a ruling before the campaign front moves again.`;
  if (history.length) return 'Recent rulings are still shaping the living front.';
  return 'No emergency rulings require attention.';
}

function crisisEventView(state, event, options = {}) {
  const resources = state.factions.olundar.resources;
  return {
    id: event.id,
    name: event.name,
    tone: event.tone,
    label: options.label || event.label || crisisLabel(event.tone),
    text: event.text,
    choices: event.choices.map((choice) => {
      const affordable = canAfford(resources, choice.cost);
      return {
        id: choice.id,
        name: choice.name,
        text: choice.text,
        cost: choice.cost,
        costText: formatCost(choice.cost),
        preview: choice.preview || CRISIS_OUTCOME_PREVIEWS[event.id]?.[choice.id] || 'This ruling has immediate campaign consequences.',
        disabled: !affordable,
        disabledReason: affordable ? '' : `Need ${formatCost(missingCost(resources, choice.cost))}.`
      };
    })
  };
}

function crisisLabel(tone) {
  if (tone === 'danger') return 'Urgent';
  if (tone === 'good') return 'Council';
  return 'Open';
}

function activeCrisisAftermath(state) {
  return state.crises.aftermath.queue.filter((item) => {
    const event = CRISIS_AFTERMATH_EVENTS[item.eventId];
    return event && item.dueTurn <= state.turn && !state.crises.aftermath.resolved[item.eventId];
  });
}

function crisisAftermathEventView(state, item) {
  const event = CRISIS_AFTERMATH_EVENTS[item.eventId];
  const source = CRISIS_EVENTS[item.crisisId];
  const sourceChoice = source?.choices.find((choice) => choice.id === item.choiceId);
  return crisisEventView(state, {
    ...event,
    text: `${event.text} Earlier ruling: ${sourceChoice?.name || item.choiceId}.`
  }, { label: event.label || 'Aftermath' });
}

function scheduleCrisisAftermath(state, crisisId, choiceId) {
  const event = Object.values(CRISIS_AFTERMATH_EVENTS).find((entry) => entry.crisisId === crisisId);
  if (!event || state.crises.aftermath.resolved[event.id]) return;
  const existing = state.crises.aftermath.queue.find((item) => item.eventId === event.id);
  const item = {
    eventId: event.id,
    crisisId,
    choiceId,
    dueTurn: state.turn + event.delay
  };
  if (existing) Object.assign(existing, item);
  else state.crises.aftermath.queue.push(item);
}

function resolveCrisisAftermath(state, item, choiceId) {
  const event = CRISIS_AFTERMATH_EVENTS[item.eventId];
  if (!event || state.crises.aftermath.resolved[item.eventId]) return { ok: false, reason: 'That aftermath has already been settled.' };
  if (!activeCrisisAftermath(state).some((active) => active.eventId === item.eventId)) return { ok: false, reason: 'That aftermath is not active.' };
  const choice = event.choices.find((entry) => entry.id === choiceId);
  if (!choice) return { ok: false, reason: 'Unknown aftermath ruling.' };
  const resources = state.factions.olundar.resources;
  if (!canAfford(resources, choice.cost)) return { ok: false, reason: `Need ${formatCost(missingCost(resources, choice.cost))}.` };

  payCost(resources, choice.cost);
  const outcome = applyCrisisAftermathOutcome(state, item, choiceId);
  state.crises.aftermath.resolved[item.eventId] = choiceId;
  state.crises.aftermath.queue = state.crises.aftermath.queue.filter((queued) => queued.eventId !== item.eventId);
  state.crises.history.unshift({
    turn: state.turn,
    crisisId: item.eventId,
    crisisName: event.name,
    choiceId,
    choiceName: choice.name,
    outcome: outcome.text,
    tone: outcome.tone
  });
  state.crises.history = state.crises.history.slice(0, 8);
  addMessage(state, `${event.name}: ${outcome.text}`, outcome.tone);
  updateVisibility(state);
  return { ok: true, reason: outcome.text, outcome };
}

function crisisIsAvailable(state, crisisId) {
  if (state.status !== 'playing' || state.crises.resolved[crisisId]) return false;
  const resources = state.factions.olundar.resources;
  const discoveredLiving = discoveredLivingFactions(state).length;
  if (crisisId === 'refugeeCaravan') return state.turn >= 5 && (state.flags.firstAllySeen || discoveredLiving > 0);
  if (crisisId === 'famineStores') return state.turn >= 4 && (resources.food || 0) <= 35;
  if (crisisId === 'cityRaid') return state.turn >= 6 && Boolean(state.flags.firstDeadwalkerSeen || knownDeadwalkerThreat(state));
  if (crisisId === 'emergencyCouncil') return state.turn >= 8 && discoveredLiving >= 2;
  return false;
}

function applyCrisisOutcome(state, crisisId, choiceId) {
  if (crisisId === 'refugeeCaravan' && choiceId === 'shelter') {
    adjustOlundarPopulation(state, 6);
    adjustOlundarMorale(state, 1);
    gainResources(state.factions.olundar.resources, { influence: 1 });
    return { tone: 'good', text: 'Olundar shelters the caravan; new hands join the city and morale rises.' };
  }
  if (crisisId === 'refugeeCaravan' && choiceId === 'escort') {
    const contacts = adjustKnownLivingRelations(state, 6);
    gainResources(state.factions.olundar.resources, { influence: 1 });
    return { tone: 'good', text: contacts ? 'Escorted refugees improve trust across the living front.' : 'The escort impresses border envoys and raises Olundar influence.' };
  }
  if (crisisId === 'refugeeCaravan' && choiceId === 'levy') {
    adjustOlundarPopulation(state, 2);
    const unit = spawnOlundarUnitAtCapital(state, 'spearGuard', 'Refugee Oath-Spear');
    return { tone: unit ? 'good' : 'info', text: unit ? 'A refugee spear guard joins the line near Olundar Prime.' : 'The levy forms local reserves, but no open muster ground was found.' };
  }
  if (crisisId === 'famineStores' && choiceId === 'ration') {
    gainResources(state.factions.olundar.resources, { food: 24 });
    adjustOlundarMorale(state, -1);
    return { tone: 'danger', text: 'Strict rationing preserves grain, but the city feels the strain.' };
  }
  if (crisisId === 'famineStores' && choiceId === 'buyGrain') {
    gainResources(state.factions.olundar.resources, { food: 36 });
    adjustOlundarMorale(state, 1);
    return { tone: 'good', text: 'Purchased grain refills the stores and calms the streets.' };
  }
  if (crisisId === 'famineStores' && choiceId === 'frontierForage') {
    gainResources(state.factions.olundar.resources, { food: 18 });
    const unit = spawnOlundarUnitAtCapital(state, 'scout', 'Forage Runner');
    return { tone: 'info', text: unit ? 'Foragers return with food and a runner who can scout the frontier.' : 'Foragers return with food, though no open muster ground was found.' };
  }
  if (crisisId === 'cityRaid' && choiceId === 'nightWatch') {
    const fortified = reinforceOlundarHoldings(state, 10, 4);
    return { tone: 'good', text: fortified ? 'Night watches harden Olundar holdings before the raid lands.' : 'Night watches organize reserves, but no holdings were available to reinforce.' };
  }
  if (crisisId === 'cityRaid' && choiceId === 'evacuate') {
    adjustOlundarPopulation(state, -4);
    gainResources(state.factions.olundar.resources, { food: 12 });
    adjustOlundarMorale(state, 1);
    return { tone: 'info', text: 'The outskirts empty into the walls; stores and morale recover at a population cost.' };
  }
  if (crisisId === 'cityRaid' && choiceId === 'counterRaid') {
    const unit = spawnOlundarUnitAtCapital(state, 'spearGuard', 'Gate Counter-Raid');
    gainResources(state.factions.olundar.resources, { influence: 1 });
    return { tone: unit ? 'good' : 'info', text: unit ? 'A spear guard seizes the initiative and the city rallies behind them.' : 'The counter-raid becomes a reserve patrol, but no open muster ground was found.' };
  }
  if (crisisId === 'emergencyCouncil' && choiceId === 'coalitionEnvoys') {
    const contacts = adjustKnownLivingRelations(state, 8);
    adjustOlundarMorale(state, 1);
    return { tone: 'good', text: contacts ? 'Envoys steady the living front and restore confidence at home.' : 'The envoys steady Olundar, though no contacted faction could answer yet.' };
  }
  if (crisisId === 'emergencyCouncil' && choiceId === 'warLevy') {
    adjustOlundarPopulation(state, -2);
    gainResources(state.factions.olundar.resources, { influence: 1 });
    const unit = spawnOlundarUnitAtCapital(state, 'legionary', 'Emergency Legionary');
    return { tone: unit ? 'good' : 'info', text: unit ? 'An emergency legionary musters near the capital for the coming war.' : 'The levy raises influence and reserves, but no open muster ground was found.' };
  }
  if (crisisId === 'emergencyCouncil' && choiceId === 'fortifyGates') {
    const fortified = reinforceOlundarHoldings(state, 12, 6);
    return { tone: 'good', text: fortified ? 'The council hardens gates, towers, and frontier walls for the siege season.' : 'The council prepares fortification plans, but no holdings were available to reinforce.' };
  }
  return { tone: 'info', text: 'The ruling is recorded.' };
}

function applyCrisisAftermathOutcome(state, item, choiceId) {
  if (item.eventId === 'refugeeAftermath' && choiceId === 'settleOaths') {
    adjustOlundarPopulation(state, 3);
    adjustOlundarMorale(state, 1);
    const contacts = recordKnownFactionMemory(state, 'promise', 'Refugees Settled', 'Olundar settled displaced families into homes and road crews instead of using them as leverage.', 1);
    return { tone: 'good', text: contacts ? 'Settled refugee oaths raise morale and reassure known living courts.' : 'Settled refugee oaths raise morale inside Olundar.' };
  }
  if (item.eventId === 'refugeeAftermath' && choiceId === 'frontierFamilies') {
    const unit = spawnOlundarUnitAtCapital(state, 'scout', 'Frontier Family Guide');
    const contacts = adjustKnownLivingRelations(state, 3);
    recordKnownFactionMemory(state, 'promise', 'Frontier Families Sponsored', 'Olundar sponsored displaced families as guides instead of abandoning them.', 1);
    addAftermathMission(state, {
      type: 'escort',
      name: 'Escort Frontier Families',
      text: 'Move a scout or cavalry unit to the marked road camp so the sponsored families can travel safely.',
      required: 'recon',
      tone: 'info',
      site: 'Road camp',
      chainTag: 'frontierFamilies',
      chainStep: 1,
      chainLimit: 2,
      routeName: 'Frontier Family Route',
      rewardText: 'Completing it grants influence, steadies morale, and may reveal the next safe-mile camp.'
    });
    return { tone: unit ? 'good' : 'info', text: unit ? 'Frontier families send a guide to Olundar and improve trust on the living front.' : contacts ? 'Frontier families improve trust, though no open muster ground was found.' : 'Frontier families become border contacts, though no open muster ground was found.' };
  }
  if (item.eventId === 'refugeeAftermath' && choiceId === 'ignorePetitions') {
    adjustOlundarMorale(state, -1);
    const contacts = recordKnownFactionMemory(state, 'grievance', 'Refugee Petitions Ignored', 'Olundar left refugee petitions unanswered after the first emergency ruling.', 1);
    return { tone: 'danger', text: contacts ? 'Ignored refugee petitions hurt morale and spread grievances among known factions.' : 'Ignored refugee petitions hurt morale inside Olundar.' };
  }
  if (item.eventId === 'granaryAftermath' && choiceId === 'openStores') {
    adjustOlundarMorale(state, 2);
    return { tone: 'good', text: 'Open festival stores calm the hunger panic and restore public confidence.' };
  }
  if (item.eventId === 'granaryAftermath' && choiceId === 'grainContract') {
    const contacts = adjustKnownLivingRelations(state, 3);
    recordKnownFactionMemory(state, 'promise', 'Grain Contract Signed', 'Olundar bound merchants and allies to a public grain contract after famine pressure.', 1);
    return { tone: 'good', text: contacts ? 'The grain contract steadies markets and improves known-faction trust.' : 'The grain contract steadies Olundar markets.' };
  }
  if (item.eventId === 'granaryAftermath' && choiceId === 'hardLabor') {
    gainResources(state.factions.olundar.resources, { wood: 18 });
    adjustOlundarMorale(state, -1);
    const contacts = recordKnownFactionMemory(state, 'grievance', 'Famine Labor Ordered', 'Olundar used hunger as leverage for emergency labor after famine pressure.', 1);
    return { tone: 'danger', text: contacts ? 'Hard labor fills timber yards, but morale falls and grievances spread.' : 'Hard labor fills timber yards, but morale falls.' };
  }
  if (item.eventId === 'raidAftermath' && choiceId === 'repairStreets') {
    const fortified = reinforceOlundarHoldings(state, 8, 3);
    adjustOlundarMorale(state, 1);
    addAftermathMission(state, {
      type: 'repair',
      name: 'Repair the Raid Roads',
      text: 'Move an engineer to the marked street scar to finish repairs before raiders exploit it again.',
      required: 'engineer',
      tone: 'info',
      site: 'Raid scar',
      rewardText: 'Completing it reinforces Olundar holdings and raises morale.'
    });
    return { tone: 'good', text: fortified ? 'Street repairs harden Olundar holdings and steady frightened households.' : 'Street repairs steady frightened households, though no holdings were available to reinforce.' };
  }
  if (item.eventId === 'raidAftermath' && choiceId === 'huntRaiders') {
    const unit = spawnOlundarUnitAtCapital(state, 'cavalry', 'Road Vengeance Patrol');
    gainResources(state.factions.olundar.resources, { influence: 1 });
    addAftermathMission(state, {
      type: 'raid',
      name: 'Break the Raider Trail',
      text: 'Move a combat unit to the marked trailhead to scatter raiders before they return.',
      required: 'combat',
      tone: 'danger',
      site: 'Raider trailhead',
      chainTag: 'raiderTrail',
      chainStep: 1,
      chainLimit: 2,
      routeName: 'Raider Trail',
      rewardText: 'Completing it grants gold, influence, field experience, and may reveal the raider camp.'
    });
    return { tone: unit ? 'good' : 'info', text: unit ? 'A cavalry patrol hunts the road raiders and gives Olundar new influence.' : 'The hunt raises influence, but no open muster ground was found.' };
  }
  if (item.eventId === 'raidAftermath' && choiceId === 'blameOutskirts') {
    adjustOlundarPopulation(state, -2);
    adjustOlundarMorale(state, -1);
    const contacts = recordKnownFactionMemory(state, 'grievance', 'Outskirts Blamed', 'Olundar blamed outer households for raid losses instead of repairing the damage.', 1);
    return { tone: 'danger', text: contacts ? 'Blaming the outskirts preserves stores, but population, morale, and living-faction trust fall.' : 'Blaming the outskirts preserves stores, but population and morale fall.' };
  }
  if (item.eventId === 'councilAftermath' && choiceId === 'publishAccords') {
    const contacts = adjustKnownLivingRelations(state, 5);
    recordKnownFactionMemory(state, 'promise', 'Emergency Accords Published', 'Olundar publicly honored emergency-council commitments to the living front.', 2);
    adjustOlundarMorale(state, 1);
    addAftermathMission(state, {
      type: 'accord',
      name: 'Carry the Accord Tablets',
      text: 'Move a scout or cavalry unit to the marked envoy road to prove the accords are more than speeches.',
      required: 'recon',
      tone: 'good',
      site: 'Envoy road camp',
      chainTag: 'accordRoad',
      chainStep: 1,
      chainLimit: 2,
      routeName: 'Accord Road',
      rewardText: 'Completing it improves known-faction trust, grants influence, and may reveal a waystation.'
    });
    return { tone: 'good', text: contacts ? 'Published accords raise morale and bind known factions closer to Olundar.' : 'Published accords raise morale, though no known faction can answer yet.' };
  }
  if (item.eventId === 'councilAftermath' && choiceId === 'drillVeterans') {
    const unit = spawnOlundarUnitAtCapital(state, 'legionary', 'Council Veteran');
    adjustOlundarMorale(state, 1);
    return { tone: unit ? 'good' : 'info', text: unit ? 'Council urgency becomes a veteran legionary and steadier morale.' : 'Council urgency steadies morale, but no open muster ground was found.' };
  }
  if (item.eventId === 'councilAftermath' && choiceId === 'delayCommitments') {
    const contacts = recordKnownFactionMemory(state, 'grievance', 'Emergency Commitments Delayed', 'Olundar delayed public commitments after the emergency council demanded proof.', 2);
    adjustKnownLivingRelations(state, -3);
    return { tone: 'danger', text: contacts ? 'Delayed commitments preserve options but sour known factions.' : 'Delayed commitments preserve options, but the council records the hesitation.' };
  }
  return { tone: 'info', text: 'The aftermath ruling is recorded.' };
}

function recordKnownFactionMemory(state, type, label, detail, amount = 1) {
  let count = 0;
  for (const factionId of discoveredLivingFactions(state)) {
    recordDiplomaticMemory(state, factionId, type, label, detail, amount);
    count += 1;
  }
  return count;
}

function addAftermathMission(state, config) {
  normalizeCampaignState(state);
  const target = chooseAftermathMissionTarget(state, config.required);
  if (!target) return null;
  return appendAftermathMission(state, config, target);
}

function appendAftermathMission(state, config, target) {
  const tile = tileAt(state, target.x, target.y);
  const mission = {
    id: nextId(state, 'm'),
    type: config.type,
    name: config.name,
    text: config.text,
    required: config.required || 'any',
    tone: config.tone || 'info',
    site: config.site || missionSiteName(config.type),
    terrain: tile?.terrain || config.terrain || null,
    x: target.x,
    y: target.y,
    originX: target.originX ?? null,
    originY: target.originY ?? null,
    radius: 0,
    chainTag: config.chainTag || null,
    chainStep: config.chainStep || (config.chainTag ? 1 : 0),
    chainLimit: config.chainLimit || 0,
    routeName: config.routeName || '',
    createdTurn: state.turn,
    completedTurn: null,
    rewardText: config.rewardText || ''
  };
  state.crises.missions.push(mission);
  state.crises.missions = state.crises.missions.slice(-12);
  return mission;
}

function chooseAftermathMissionTarget(state, required = 'any') {
  const unit = missionPreferredUnit(state, required);
  if (!unit) return null;
  const preferred = required === 'combat' ? { x: unit.x + 2, y: unit.y } : { x: unit.x, y: unit.y - 1 };
  const options = neighbors4(unit.x, unit.y)
    .filter((tile) => missionTileIsUsable(state, unit, tile.x, tile.y))
    .filter((tile) => !activeMissionAt(state, tile.x, tile.y))
    .sort((a, b) => manhattan(a.x, a.y, preferred.x, preferred.y) - manhattan(b.x, b.y, preferred.x, preferred.y));
  const target = options[0] || null;
  return target ? { x: target.x, y: target.y, originX: unit.x, originY: unit.y } : null;
}

function missionPreferredUnit(state, required) {
  const units = state.units.filter((unit) => unit.faction === 'olundar');
  const eligible = units.filter((unit) => unitCanCompleteMission(unit, { required }));
  return eligible.find((unit) => !unit.hasActed) || eligible[0] || units.find((unit) => !unit.hasActed) || units[0] || null;
}

function missionTileIsUsable(state, unit, x, y) {
  const tile = tileAt(state, x, y);
  if (!tile || !TERRAIN[tile.terrain].passable || tile.terrain === 'blight') return false;
  if (!isRevealed(state, x, y)) return false;
  const occupant = unitAt(state, x, y);
  if (occupant && occupant.id !== unit.id) return false;
  const building = buildingAt(state, x, y);
  return !building || !isEnemy(state, unit.faction, building.faction);
}

function activeMissionAt(state, x, y, excludeId = null) {
  return state.crises.missions.some((mission) => !mission.completedTurn && mission.id !== excludeId && mission.x === x && mission.y === y);
}

function chooseMissionChainTarget(state, mission, unit) {
  const def = getUnitDef(unit);
  if (!def) return null;
  const originX = Number.isFinite(mission.originX) ? mission.originX : unit.x;
  const originY = Number.isFinite(mission.originY) ? mission.originY : unit.y;
  let dx = Math.sign(mission.x - originX);
  let dy = Math.sign(mission.y - originY);
  if (dx && dy) {
    if (Math.abs(mission.x - originX) >= Math.abs(mission.y - originY)) dy = 0;
    else dx = 0;
  }
  if (!dx && !dy) dx = mission.type === 'raid' ? 1 : 0;
  if (!dx && !dy) dy = -1;

  const candidates = [];
  const pushCandidate = (x, y) => {
    const tile = tileAt(state, x, y);
    if (!tile || candidates.includes(tile)) return;
    candidates.push(tile);
  };
  const perpendicular = dx ? [{ x: 0, y: 1 }, { x: 0, y: -1 }] : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
  for (const distance of [2, 3, 1, 4]) {
    pushCandidate(mission.x + dx * distance, mission.y + dy * distance);
    for (const offset of perpendicular) {
      pushCandidate(mission.x + dx * distance + offset.x, mission.y + dy * distance + offset.y);
    }
  }
  for (const tile of state.map.tiles) {
    const distance = manhattan(mission.x, mission.y, tile.x, tile.y);
    if (distance >= 1 && distance <= def.move) pushCandidate(tile.x, tile.y);
  }

  return candidates
    .filter((tile) => manhattan(unit.x, unit.y, tile.x, tile.y) > 0)
    .filter((tile) => missionTileIsUsable(state, unit, tile.x, tile.y))
    .filter((tile) => !activeMissionAt(state, tile.x, tile.y, mission.id))
    .filter((tile) => findPath(state, unit, tile.x, tile.y, def.move))
    .sort((a, b) => missionRouteTargetScore(a, mission, unit) - missionRouteTargetScore(b, mission, unit))[0] || null;
}

function missionRouteTargetScore(tile, mission, unit) {
  let score = manhattan(unit.x, unit.y, tile.x, tile.y);
  if (tile.road && mission.type !== 'raid') score -= 3;
  if (tile.terrain !== mission.terrain) score -= 1;
  if (mission.type === 'raid' && ['forest', 'hills', 'ruins'].includes(tile.terrain)) score -= 2;
  if (mission.type !== 'raid' && ['river', 'plains', 'ruins'].includes(tile.terrain)) score -= 1;
  return score;
}

function addMissionFollowUp(state, mission, unit) {
  if (!mission.chainTag || !mission.chainLimit || (mission.chainStep || 1) >= mission.chainLimit) return null;
  const target = chooseMissionChainTarget(state, mission, unit);
  if (!target) return null;
  const nextStep = (mission.chainStep || 1) + 1;
  const followUp = missionFollowUpConfig(mission, nextStep);
  return appendAftermathMission(state, followUp, { x: target.x, y: target.y, originX: mission.x, originY: mission.y });
}

function missionFollowUpConfig(mission, nextStep) {
  const base = {
    chainTag: mission.chainTag,
    chainStep: nextStep,
    chainLimit: mission.chainLimit,
    routeName: mission.routeName
  };
  if (mission.type === 'raid') {
    return {
      ...base,
      type: 'raid',
      name: 'Burn the Raider Camp',
      text: 'Move a combat unit to the spawned raider camp before the trail reforms.',
      required: 'combat',
      tone: 'danger',
      site: 'Raider camp',
      rewardText: 'Completing it grants extra gold, influence, field experience, and terrain supplies.'
    };
  }
  if (mission.type === 'accord') {
    return {
      ...base,
      type: 'accord',
      name: 'Mark the Accord Waystation',
      text: 'Move a scout or cavalry unit to the next waystation so envoys can keep the route open.',
      required: 'recon',
      tone: 'good',
      site: 'Accord waystation',
      rewardText: 'Completing it improves known-faction trust, grants influence, and claims terrain supplies.'
    };
  }
  return {
    ...base,
    type: 'escort',
    name: 'Secure the Safe Mile',
    text: 'Move a scout or cavalry unit to the next family camp to turn the route into a reliable corridor.',
    required: 'recon',
    tone: 'info',
    site: 'Safe-mile camp',
    rewardText: 'Completing it grants influence, steadies morale, and claims terrain supplies.'
  };
}

function updateAftermathMissions(state) {
  normalizeCampaignState(state);
  let completed = 0;
  for (const mission of state.crises.missions) {
    if (mission.completedTurn) continue;
    const unit = state.units.find((candidate) => (
      candidate.faction === 'olundar'
      && unitCanCompleteMission(candidate, mission)
      && manhattan(candidate.x, candidate.y, mission.x, mission.y) <= (mission.radius || 0)
    ));
    if (!unit) continue;
    completeAftermathMission(state, mission, unit);
    completed += 1;
  }
  return completed;
}

function unitCanCompleteMission(unit, mission) {
  const def = getUnitDef(unit);
  if (!def) return false;
  if (mission.required === 'engineer') return def.tags.includes('builder');
  if (mission.required === 'recon') return def.tags.includes('recon') || def.tags.includes('mounted');
  if (mission.required === 'combat') return !def.tags.includes('builder') && !def.tags.includes('siege');
  return true;
}

function completeAftermathMission(state, mission, unit) {
  mission.completedTurn = state.turn;
  mission.completedBy = unit.name;
  const outcome = applyAftermathMissionReward(state, mission, unit);
  const terrainOutcome = applyAftermathMissionTerrainReward(state, mission);
  const followUp = addMissionFollowUp(state, mission, unit);
  const followUpText = followUp ? `A follow-up marker opens at ${followUp.x},${followUp.y}: ${followUp.name}.` : '';
  mission.resultText = [outcome, terrainOutcome, followUpText].filter(Boolean).join(' ');
  addMessage(state, `${mission.name} completed by ${unit.name}: ${mission.resultText}`, 'good');
}

function applyAftermathMissionReward(state, mission, unit) {
  if (mission.type === 'repair') {
    reinforceOlundarHoldings(state, 6, 2);
    adjustOlundarMorale(state, 1);
    return 'Roads and holdings are repaired, and morale rises.';
  }
  if (mission.type === 'raid') {
    gainResources(state.factions.olundar.resources, { gold: 10, influence: 1 });
    unit.xp += 1;
    return 'The raider trail is broken for gold, influence, and field experience.';
  }
  if (mission.type === 'escort') {
    gainResources(state.factions.olundar.resources, { influence: 1 });
    adjustOlundarMorale(state, 1);
    return 'Families reach the safe road, raising morale and influence.';
  }
  if (mission.type === 'accord') {
    gainResources(state.factions.olundar.resources, { influence: 1 });
    adjustKnownLivingRelations(state, 2);
    recordKnownFactionMemory(state, 'fulfilled', 'Accord Route Carried', 'Olundar carried published accords onto the roads instead of leaving them in council chambers.', 1);
    return 'Envoys carry the accords forward, improving trust and influence.';
  }
  return 'The field task is resolved.';
}

function applyAftermathMissionTerrainReward(state, mission) {
  const tile = tileAt(state, mission.x, mission.y);
  if (!tile || !TERRAIN[tile.terrain]) return '';
  const resources = missionTerrainReward(tile);
  if (!Object.keys(resources).length) return '';
  gainResources(state.factions.olundar.resources, resources);
  const terrain = TERRAIN[tile.terrain];
  mission.terrain = tile.terrain;
  mission.terrainRewardText = `${terrain.name} site yields ${formatCost(resources)}${tile.road ? ' from roadside caches' : ''}.`;
  return mission.terrainRewardText;
}

function missionTerrainReward(tile) {
  const reward = {};
  if (tile.terrain === 'plains') reward.food = 8;
  else if (tile.terrain === 'forest') reward.wood = 10;
  else if (tile.terrain === 'hills') {
    reward.stone = 6;
    reward.iron = 3;
  } else if (tile.terrain === 'river') {
    reward.food = 10;
    reward.gold = 2;
  } else if (tile.terrain === 'marsh') {
    reward.food = 6;
    reward.wood = 4;
  } else if (tile.terrain === 'ruins') {
    reward.gold = 10;
    reward.influence = 1;
  }
  if (tile.road) reward.gold = (reward.gold || 0) + 4;
  return reward;
}

function discoveredLivingFactions(state) {
  return LIVING_DIPLOMACY_FACTIONS.filter((id) => state.factions[id]?.discovered);
}

function adjustKnownLivingRelations(state, amount) {
  let count = 0;
  for (const factionId of discoveredLivingFactions(state)) {
    const actor = state.factions.olundar;
    const target = state.factions[factionId];
    actor.relations[factionId] = clampRelation((actor.relations[factionId] ?? 0) + amount);
    target.relations.olundar = actor.relations[factionId];
    count += 1;
  }
  return count;
}

function adjustOlundarMorale(state, amount) {
  const resources = state.factions.olundar.resources;
  resources.morale = Math.max(0, Math.min(12, (resources.morale || 0) + amount));
  return resources.morale;
}

function adjustOlundarPopulation(state, amount) {
  const faction = state.factions.olundar;
  const housing = faction.housing || 1;
  faction.population = Math.max(1, Math.min(housing, (faction.population || 1) + amount));
  return faction.population;
}

function reinforceOlundarHoldings(state, hpGain, maxHpGain) {
  return reinforceFactionHoldings(state, 'olundar', hpGain, maxHpGain);
}

function reinforceFactionHoldings(state, factionId, hpGain, maxHpGain) {
  let count = 0;
  for (const building of state.buildings) {
    if (building.faction !== factionId || building.turnsLeft > 0) continue;
    if (!['city', 'outpost', 'watchtower', 'wall', 'barracks'].includes(building.type)) continue;
    building.maxHp += maxHpGain;
    building.hp = Math.min(building.maxHp, (building.hp || 0) + hpGain);
    count += 1;
  }
  return count;
}

function spawnOlundarUnitAtCapital(state, unitType, name) {
  const capital = state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city')
    || state.buildings.find((building) => building.faction === 'olundar');
  const origin = capital || { x: 7, y: 16 };
  const spawn = findSpawnNear(state, origin.x, origin.y, 'olundar');
  return spawn ? addUnit(state, unitType, 'olundar', spawn.x, spawn.y, { name }) : null;
}

function councilHeadline(state, knownDead) {
  if (state.status === 'won') return 'Victory Council';
  if (state.status === 'lost') return 'After-Action Council';
  if ((state.factions.olundar.resources.morale || 0) <= 3) return 'Morale Crisis';
  if (knownDead?.score >= 18) return 'Deadwalker Surge';
  if (!state.flags.firstAllySeen) return 'First Orders';
  if (!state.flags.firstDeadwalkerSeen) return 'Expansion Council';
  return 'War Council';
}

function knownDeadwalkerThreat(state) {
  const knownUnits = state.units.filter((unit) => unit.faction === 'dead' && isRevealed(state, unit.x, unit.y)).length;
  const knownBuildings = state.buildings.filter((building) => building.faction === 'dead' && isRevealed(state, building.x, building.y)).length;
  if (!knownUnits && !knownBuildings && !state.flags.firstDeadwalkerSeen) return null;
  const score = knownUnits + knownBuildings * 3 + state.map.tiles.filter((tile) => tile.terrain === 'blight' && isRevealed(state, tile.x, tile.y)).length * 0.2;
  const label = score >= 18 ? 'Severe' : score >= 8 ? 'Rising' : 'Sighted';
  return { knownUnits, knownBuildings, score, label };
}

function revealedPercent(state) {
  return (state.revealed.filter(Boolean).length / state.revealed.length) * 100;
}

function hasOperationalBuilding(state, type) {
  return state.buildings.some((building) => building.faction === 'olundar' && building.type === type && building.turnsLeft <= 0);
}

export function tileAt(state, x, y) {
  if (!inBounds(x, y)) return null;
  return state.map.tiles[idx(x, y)];
}

export function unitAt(state, x, y, options = {}) {
  return state.units.find((unit) => unit.x === x && unit.y === y && (!options.faction || unit.faction === options.faction));
}

export function unitsAt(state, x, y) {
  return state.units.filter((unit) => unit.x === x && unit.y === y);
}

export function buildingAt(state, x, y, options = {}) {
  return state.buildings.find((building) => building.x === x && building.y === y && (!options.faction || building.faction === options.faction));
}

export function getUnitDef(unitOrType) {
  const type = typeof unitOrType === 'string' ? unitOrType : unitOrType.type;
  return UNIT_TYPES[type];
}

export function getBuildingDef(buildingOrType) {
  const type = typeof buildingOrType === 'string' ? buildingOrType : buildingOrType.type;
  return BUILDING_TYPES[type];
}

export function isEnemy(state, factionA, factionB) {
  if (factionA === factionB) return false;
  if (factionA === 'dead' || factionB === 'dead') return true;
  return Boolean(state.factions[factionA]?.atWar?.[factionB] || state.factions[factionB]?.atWar?.[factionA]);
}

export function isAllyForVision(state, faction) {
  if (faction === 'olundar') return true;
  return Boolean(state.factions.olundar.pacts?.[faction]);
}

export function isVisible(state, x, y) {
  return inBounds(x, y) && state.visible[idx(x, y)];
}

export function isRevealed(state, x, y) {
  return inBounds(x, y) && state.revealed[idx(x, y)];
}

export function getStrategicMapLens(state, lensId = 'normal') {
  normalizeCampaignState(state);
  const id = MAP_LENSES[lensId] ? lensId : 'normal';
  const lens = MAP_LENSES[id];
  const tiles = [];
  const markers = [];
  if (id === 'normal') return { ...lens, tiles, markers };

  const seenTiles = new Set();
  const pushTile = (tile, kind, tone, strength = 1) => {
    if (!isRevealed(state, tile.x, tile.y)) return;
    const key = `${tile.x},${tile.y},${kind},${tone}`;
    if (seenTiles.has(key)) return;
    seenTiles.add(key);
    tiles.push({
      x: tile.x,
      y: tile.y,
      kind,
      tone,
      strength,
      visible: isVisible(state, tile.x, tile.y)
    });
  };
  const pushMarker = (item, kind, tone) => {
    if (!isRevealed(state, item.x, item.y)) return;
    markers.push({
      x: item.x,
      y: item.y,
      kind,
      tone,
      visible: isVisible(state, item.x, item.y),
      name: item.name || BUILDING_TYPES[item.type]?.name || UNIT_TYPES[item.type]?.name || kind,
      site: item.site || '',
      type: item.type || '',
      completed: Boolean(item.completed),
      chainStep: item.chainStep || 0,
      chainLimit: item.chainLimit || 0
    });
  };

  if (id === 'blight') {
    for (const tile of state.map.tiles) {
      if (tile.terrain === 'blight' || tile.blight > 0) pushTile(tile, 'blight', 'dead', Math.max(0.35, Math.min(1, (tile.blight || 4) / 9)));
    }
    for (const building of state.buildings.filter((item) => item.faction === 'dead')) pushMarker(building, 'deadwork', 'dead');
    for (const unit of state.units.filter((item) => item.faction === 'dead')) pushMarker(unit, 'deadwalker', 'dead');
  } else if (id === 'roads') {
    for (const tile of state.map.tiles) {
      if (tile.road) pushTile(tile, 'road', 'roads', 1);
    }
    for (const building of state.buildings.filter((item) => item.faction === 'olundar' && ['city', 'outpost', 'road'].includes(item.type))) pushMarker(building, 'logistics', 'roads');
  } else if (id === 'supply') {
    for (const tile of state.map.tiles) {
      if (TERRAIN[tile.terrain].passable && tile.terrain !== 'blight' && isTileSupplied(state, tile.x, tile.y)) pushTile(tile, 'supply', 'supply', 1);
    }
    for (const building of state.buildings.filter((item) => item.faction === 'olundar' && ['city', 'outpost', 'road'].includes(item.type))) pushMarker(building, 'supplyNode', 'supply');
  } else if (id === 'alliance') {
    const sources = visionSourcesFor(state).filter((source) => source.faction !== 'olundar');
    for (const tile of state.map.tiles) {
      const source = sources.find((item) => manhattan(item.x, item.y, tile.x, tile.y) <= item.sight);
      if (source) pushTile(tile, 'allianceVision', source.faction, 1);
    }
    for (const unit of state.units.filter((item) => item.faction !== 'olundar' && isAllyForVision(state, item.faction))) pushMarker(unit, 'allyUnit', itemTone(unit));
    for (const building of state.buildings.filter((item) => item.faction !== 'olundar' && isAllyForVision(state, item.faction))) pushMarker(building, 'allyHolding', itemTone(building));
  } else if (id === 'missions') {
    const recentWindow = Math.max(0, state.turn - 4);
    for (const mission of state.crises.missions.filter((item) => !item.completedTurn || item.completedTurn >= recentWindow)) {
      const tile = tileAt(state, mission.x, mission.y);
      if (!tile) continue;
      const tone = mission.completedTurn ? 'supply' : mission.tone === 'danger' ? 'dead' : 'mission';
      pushTile(tile, mission.completedTurn ? 'missionComplete' : 'missionTarget', tone, mission.completedTurn ? 0.6 : 1);
      pushMarker({
        x: mission.x,
        y: mission.y,
        name: mission.completedTurn ? `${mission.name} complete` : `${mission.site || missionSiteName(mission.type)}: ${mission.name}`,
        site: mission.site || missionSiteName(mission.type),
        type: mission.type,
        completed: Boolean(mission.completedTurn),
        chainStep: mission.chainStep || 0,
        chainLimit: mission.chainLimit || 0
      }, mission.completedTurn ? 'missionComplete' : 'missionTarget', tone);
    }
  }

  return { ...lens, tiles, markers };
}

function itemTone(item) {
  return item.faction || 'alliance';
}

function visionSourcesFor(state) {
  const visionSources = [];
  for (const unit of state.units) {
    if (isAllyForVision(state, unit.faction)) {
      const def = getUnitDef(unit);
      const tile = tileAt(state, unit.x, unit.y);
      const bonus = tile ? Math.max(-1, TERRAIN[tile.terrain].sight || 0) : 0;
      visionSources.push({ x: unit.x, y: unit.y, sight: Math.max(1, def.sight + bonus), faction: unit.faction, kind: 'unit', name: unit.name });
    }
  }
  for (const building of state.buildings) {
    if (isAllyForVision(state, building.faction) && building.turnsLeft <= 0) {
      const def = getBuildingDef(building);
      const tile = tileAt(state, building.x, building.y);
      const bonus = tile?.terrain === 'hills' ? 1 : 0;
      visionSources.push({ x: building.x, y: building.y, sight: def.vision + bonus + (building.upgraded || 0), faction: building.faction, kind: 'building', name: building.name });
    }
  }
  return visionSources;
}

export function updateVisibility(state) {
  state.visible = Array(MAP_WIDTH * MAP_HEIGHT).fill(false);
  const visionSources = visionSourcesFor(state);
  for (const source of visionSources) {
    revealRadius(state, source.x, source.y, source.sight);
  }
  discoverVisibleFactions(state);
}

export function revealRadius(state, cx, cy, radius) {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (!inBounds(x, y)) continue;
      if (manhattan(cx, cy, x, y) <= radius) {
        const index = idx(x, y);
        state.visible[index] = true;
        state.revealed[index] = true;
      }
    }
  }
}

function discoverVisibleFactions(state) {
  const visibleFactions = new Set();
  for (const unit of state.units) {
    if (unit.faction !== 'olundar' && isVisible(state, unit.x, unit.y)) visibleFactions.add(unit.faction);
  }
  for (const building of state.buildings) {
    if (building.faction !== 'olundar' && isVisible(state, building.x, building.y)) visibleFactions.add(building.faction);
  }
  for (const faction of visibleFactions) {
    if (!state.factions[faction].discovered) {
      state.factions[faction].discovered = true;
      if (faction === 'dead') {
        state.flags.firstDeadwalkerSeen = true;
        addMessage(state, 'Deadwalker banners sighted. Their blight spreads from the east.', 'danger');
      } else {
        state.flags.firstAllySeen = true;
        addMessage(state, `${state.factions[faction].name} discovered. Diplomacy is now possible.`, 'good');
      }
    }
  }
}

export function moveCostFor(state, unit, x, y, from = null) {
  const tile = tileAt(state, x, y);
  if (!tile) return Infinity;
  const terrain = TERRAIN[tile.terrain];
  if (!terrain.passable) return Infinity;
  const def = getUnitDef(unit);
  let cost = terrain.move;
  if (tile.road && from) {
    const fromTile = tileAt(state, from.x, from.y);
    if (fromTile?.road) cost = 1;
  }
  if (def.tags.includes('recon') && (tile.terrain === 'forest' || tile.terrain === 'marsh')) cost = Math.max(1, cost - 1);
  if (def.tags.includes('mounted') && tile.terrain === 'marsh') cost += 1;
  if (tile.terrain === 'blight' && def.faction !== 'dead') cost += 1;
  return cost;
}

export function canEnter(state, unit, x, y) {
  const tile = tileAt(state, x, y);
  if (!tile || !TERRAIN[tile.terrain].passable) return false;
  const occupant = unitAt(state, x, y);
  if (occupant && occupant.id !== unit.id) return false;
  const building = buildingAt(state, x, y);
  if (building && isEnemy(state, unit.faction, building.faction)) return false;
  return true;
}

export function findPath(state, unit, tx, ty, maxCost = Infinity) {
  if (!inBounds(tx, ty)) return null;
  if (!canEnter(state, unit, tx, ty) && !(unit.x === tx && unit.y === ty)) return null;
  const startKey = idx(unit.x, unit.y);
  const targetKey = idx(tx, ty);
  const costs = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const frontier = [{ x: unit.x, y: unit.y, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    const currentKey = idx(current.x, current.y);
    if (currentKey === targetKey) break;
    for (const n of neighbors4(current.x, current.y)) {
      if (!canEnter(state, unit, n.x, n.y) && !(n.x === tx && n.y === ty)) continue;
      const step = moveCostFor(state, unit, n.x, n.y, current);
      const nextCost = current.cost + step;
      if (nextCost > maxCost) continue;
      const key = idx(n.x, n.y);
      if (!costs.has(key) || nextCost < costs.get(key)) {
        costs.set(key, nextCost);
        cameFrom.set(key, currentKey);
        frontier.push({ x: n.x, y: n.y, cost: nextCost });
      }
    }
  }
  if (!costs.has(targetKey)) return null;
  const path = [];
  let key = targetKey;
  while (key !== startKey) {
    path.unshift(key);
    key = cameFrom.get(key);
  }
  return { cost: costs.get(targetKey), path };
}

export function moveUnit(state, unitId, x, y) {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'Unit not found.' };
  if (unit.faction !== 'olundar') return { ok: false, reason: 'You only command Olundar directly.' };
  if (unit.hasActed) return { ok: false, reason: `${unit.name} has already acted this turn.` };
  const def = getUnitDef(unit);
  const path = findPath(state, unit, x, y, def.move);
  if (!path) return { ok: false, reason: 'No valid path within this unit’s movement.' };
  unit.x = x;
  unit.y = y;
  unit.hasActed = true;
  unit.fortified = 0;
  maybeSurveyRuin(state, unit);
  updateVisibility(state);
  updateAftermathMissions(state);
  return { ok: true, reason: `${unit.name} moved.` };
}

function maybeSurveyRuin(state, unit) {
  const tile = tileAt(state, unit.x, unit.y);
  if (!tile || tile.terrain !== 'ruins' || tile.surveyedByOlundar) return;
  tile.surveyedByOlundar = true;
  const rewards = [
    { gold: 12, influence: 1 },
    { iron: 8, stone: 8 },
    { wood: 16, food: 10 },
    { influence: 2 }
  ];
  const reward = rewards[(unit.x + unit.y + state.turn) % rewards.length];
  gainResources(state.factions.olundar.resources, reward);
  addMessage(state, `Ruins surveyed: ${tile.rumor || 'useful records recovered'} Reward: ${formatCost(reward)}.`, 'good');
}

export function fortifyUnit(state, unitId) {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || unit.faction !== 'olundar') return { ok: false, reason: 'No controllable unit selected.' };
  if (unit.hasActed) return { ok: false, reason: 'This unit has already acted.' };
  unit.fortified = Math.min(2, unit.fortified + 1);
  unit.hasActed = true;
  addMessage(state, `${unit.name} fortifies and gains defensive armor until it moves.`, 'info');
  return { ok: true };
}

export function forecastUnitAttack(state, attackerId, defenderId) {
  const attacker = state.units.find((u) => u.id === attackerId);
  const defender = state.units.find((u) => u.id === defenderId);
  if (!attacker || !defender) return { ok: false, reason: 'Target not found.' };
  if (attacker.faction === 'olundar' && attacker.hasActed) return { ok: false, reason: `${attacker.name} has already acted.` };
  if (!isEnemy(state, attacker.faction, defender.faction)) return { ok: false, reason: 'That target is not hostile.' };
  const def = getUnitDef(attacker);
  const distance = manhattan(attacker.x, attacker.y, defender.x, defender.y);
  if (distance > def.range) return { ok: false, reason: 'Target is out of range.', distance, range: def.range };
  const defenderDef = getUnitDef(defender);
  const defenderTile = tileAt(state, defender.x, defender.y);
  const terrainDefense = defenderTile ? TERRAIN[defenderTile.terrain].defense || 0 : 0;
  const damage = calculateUnitDamage(state, attacker, defender);
  const targetHpBefore = defender.hp;
  const targetHpAfter = Math.max(0, targetHpBefore - damage);
  return {
    ok: true,
    type: 'unit',
    attackerName: attacker.name,
    targetName: defender.name,
    targetFaction: defender.faction,
    targetType: defender.type,
    damage,
    targetHpBefore,
    targetHpAfter,
    lethal: targetHpAfter <= 0,
    distance,
    range: def.range,
    armor: defenderDef.armor,
    terrain: defenderTile?.terrain || 'unknown',
    terrainDefense,
    fortified: defender.fortified || 0,
    note: targetHpAfter <= 0 ? `${defender.name} is likely to fall.` : `${defender.name} survives on ${targetHpAfter} HP.`
  };
}

export function attackUnit(state, attackerId, defenderId) {
  const forecast = forecastUnitAttack(state, attackerId, defenderId);
  if (!forecast.ok) return forecast;
  const attacker = state.units.find((u) => u.id === attackerId);
  const defender = state.units.find((u) => u.id === defenderId);
  const damage = forecast.damage;
  defender.hp -= damage;
  attacker.hasActed = true;
  attacker.fortified = 0;
  const attackerName = attacker.name;
  const defenderName = defender.name;
  if (defender.hp <= 0) {
    removeUnit(state, defender.id);
    attacker.xp += 1;
    if (defender.type === 'lichBoss') {
      state.flags.bossSlain = true;
      addMessage(state, 'Vorgath the Hollow Crown collapses into ash. The Bone Portal can now be destroyed.', 'good');
    } else if (attacker.faction === 'olundar' || defender.faction === 'olundar') {
      addMessage(state, `${attackerName} destroyed ${defenderName}.`, attacker.faction === 'olundar' ? 'good' : 'danger');
    }
  } else if (attacker.faction === 'olundar' || defender.faction === 'olundar') {
    addMessage(state, `${attackerName} hits ${defenderName} for ${damage}.`, attacker.faction === 'olundar' ? 'info' : 'danger');
  }
  updateVisibility(state);
  return { ok: true, damage };
}

export function forecastBuildingAttack(state, attackerId, buildingId) {
  const attacker = state.units.find((u) => u.id === attackerId);
  const building = state.buildings.find((b) => b.id === buildingId);
  if (!attacker || !building) return { ok: false, reason: 'Target not found.' };
  if (attacker.faction === 'olundar' && attacker.hasActed) return { ok: false, reason: `${attacker.name} has already acted.` };
  if (!isEnemy(state, attacker.faction, building.faction)) return { ok: false, reason: 'That structure is not hostile.' };
  const def = getUnitDef(attacker);
  const distance = manhattan(attacker.x, attacker.y, building.x, building.y);
  if (distance > def.range) return { ok: false, reason: 'Structure is out of range.', distance, range: def.range };
  const damage = calculateBuildingDamage(state, attacker, building);
  const targetHpBefore = building.hp;
  const rawTargetHpAfter = targetHpBefore - damage;
  const portalReforms = building.type === 'portal' && !state.flags.bossSlain && rawTargetHpAfter <= 0;
  const targetHpAfter = portalReforms ? 10 : Math.max(0, rawTargetHpAfter);
  return {
    ok: true,
    type: 'building',
    attackerName: attacker.name,
    targetName: building.name,
    targetFaction: building.faction,
    targetType: building.type,
    damage,
    targetHpBefore,
    targetHpAfter,
    rawTargetHpAfter,
    lethal: rawTargetHpAfter <= 0 && !portalReforms,
    portalReforms,
    distance,
    range: def.range,
    siege: def.tags.includes('siege'),
    note: portalReforms ? 'The portal reforms until Vorgath is slain.' : rawTargetHpAfter <= 0 ? `${building.name} will fall.` : `${building.name} remains at ${targetHpAfter} HP.`
  };
}

export function attackBuilding(state, attackerId, buildingId) {
  const forecast = forecastBuildingAttack(state, attackerId, buildingId);
  if (!forecast.ok) return forecast;
  const attacker = state.units.find((u) => u.id === attackerId);
  const building = state.buildings.find((b) => b.id === buildingId);
  const damage = forecast.damage;
  building.hp -= damage;
  attacker.hasActed = true;
  if (building.faction === 'dead' || attacker.faction === 'olundar' || building.faction === 'olundar') {
    addMessage(state, `${attacker.name} damages ${building.name} for ${damage}.`, attacker.faction === 'olundar' ? 'info' : 'danger');
  }
  if (building.hp <= 0) {
    if (building.type === 'portal' && !state.flags.bossSlain) {
      building.hp = 10;
      addMessage(state, 'The portal reforms around Vorgath’s command. Kill the Hollow Crown first.', 'danger');
    } else {
      destroyBuilding(state, building.id, attacker.faction);
    }
  }
  updateVisibility(state);
  return { ok: true, damage };
}

function calculateBuildingDamage(state, attacker, building) {
  const def = getUnitDef(attacker);
  let damage = def.attack + Math.floor((attacker.xp || 0) / 2);
  if (def.tags.includes('siege')) damage += 6;
  if (building.type === 'portal' && !state.flags.bossSlain) {
    damage = Math.max(1, Math.floor(damage / 3));
  }
  return damage;
}

function calculateUnitDamage(state, attacker, defender) {
  const aDef = getUnitDef(attacker);
  const dDef = getUnitDef(defender);
  const defenderTile = tileAt(state, defender.x, defender.y);
  const attackerTile = tileAt(state, attacker.x, attacker.y);
  let damage = aDef.attack + Math.floor((attacker.xp || 0) / 2);
  damage -= dDef.armor;
  damage -= TERRAIN[defenderTile.terrain].defense || 0;
  damage -= defender.fortified || 0;
  if (aDef.range > 1 && attackerTile.terrain === 'hills') damage += 1;
  if (aDef.tags.includes('spear') && dDef.tags.includes('mounted')) damage += 3;
  if (aDef.tags.includes('undead') && defenderTile.terrain === 'blight') damage += 1;
  if (!aDef.tags.includes('undead') && dDef.tags.includes('undead') && nearBuilding(state, attacker.x, attacker.y, 'shrine', attacker.faction, 3)) damage += 1;
  return Math.max(1, damage);
}

function removeUnit(state, unitId) {
  state.units = state.units.filter((u) => u.id !== unitId);
  if (state.selectedUnitId === unitId) state.selectedUnitId = null;
}

function destroyBuilding(state, buildingId, attackerFaction = null) {
  const building = state.buildings.find((b) => b.id === buildingId);
  if (!building) return;
  if (building.type === 'city' && building.faction === 'olundar') {
    state.status = 'lost';
    state.winner = 'dead';
    addMessage(state, 'Olundar Prime has fallen. The living age ends.', 'danger');
  } else if (building.type === 'city' && attackerFaction === 'dead') {
    const oldFaction = building.faction;
    state.buildings = state.buildings.filter((b) => b.id !== buildingId);
    addBuilding(state, 'necropolis', 'dead', building.x, building.y, { complete: true, name: `Necropolis of ${building.name}` });
    addMessage(state, `${state.factions[oldFaction].name} loses ${building.name}; a necropolis rises.`, 'danger');
  } else {
    state.buildings = state.buildings.filter((b) => b.id !== buildingId);
    if (building.type === 'portal') {
      state.flags.portalDestroyed = true;
      state.status = 'won';
      state.winner = 'olundar';
      addMessage(state, 'The Bone Portal shatters. The Deadwalker invasion is broken. Olundar survives.', 'good');
    } else if (building.faction === 'dead' && attackerFaction === 'olundar') {
      if (building.type !== 'portal') {
        state.flags.deadStrongholdsDestroyed = (state.flags.deadStrongholdsDestroyed || 0) + 1;
        gainResources(state.factions.olundar.resources, { influence: 1, morale: 1 });
        state.factions.olundar.resources.morale = Math.min(12, state.factions.olundar.resources.morale || 0);
      }
      addMessage(state, `${building.name} destroyed. Blight nearby begins to weaken.`, 'good');
      cleanseAround(state, building.x, building.y, 2);
    }
  }
  if (state.selectedBuildingId === buildingId) state.selectedBuildingId = null;
}

export function startTraining(state, buildingId, unitType) {
  const building = state.buildings.find((b) => b.id === buildingId);
  const unitDef = UNIT_TYPES[unitType];
  if (!building || !unitDef) return { ok: false, reason: 'Training option not found.' };
  if (building.faction !== 'olundar') return { ok: false, reason: 'You only train from Olundar buildings.' };
  if (building.turnsLeft > 0) return { ok: false, reason: 'This building is still under construction.' };
  const bDef = getBuildingDef(building);
  if (!bDef.trains.includes(unitType)) return { ok: false, reason: `${bDef.name} cannot train ${unitDef.name}.` };
  if (building.queue.length >= trainingQueueLimit(building)) return { ok: false, reason: 'Training queue is full.' };
  const resources = state.factions.olundar.resources;
  if (!canAfford(resources, unitDef.cost)) return { ok: false, reason: `Need ${formatCost(missingCost(resources, unitDef.cost))}.` };
  payCost(resources, unitDef.cost);
  building.queue.push({ unitType, turnsLeft: trainingTurnsFor(building, unitType) });
  addMessage(state, `${unitDef.name} training begun at ${building.name}.`, 'info');
  return { ok: true };
}

export function upgradeBuilding(state, buildingId) {
  const building = state.buildings.find((b) => b.id === buildingId);
  if (!building) return { ok: false, reason: 'Building not found.' };
  if (building.faction !== 'olundar') return { ok: false, reason: 'Only Olundaran buildings can be upgraded.' };
  if (building.turnsLeft > 0) return { ok: false, reason: 'Finish construction before upgrading.' };
  if ((building.upgraded || 0) >= 2) return { ok: false, reason: `${building.name} is already fully upgraded.` };
  const cost = upgradeCostFor(building);
  const resources = state.factions.olundar.resources;
  if (!canAfford(resources, cost)) return { ok: false, reason: `Need ${formatCost(missingCost(resources, cost))}.` };
  payCost(resources, cost);
  building.upgraded = (building.upgraded || 0) + 1;
  const hpBoost = Math.ceil(getBuildingDef(building).hp * 0.25);
  building.maxHp += hpBoost;
  building.hp = Math.min(building.maxHp, building.hp + hpBoost);
  if (building.type === 'city') {
    state.factions.olundar.housing += 10;
    state.factions.olundar.resources.morale = Math.min(12, (state.factions.olundar.resources.morale || 0) + 1);
  }
  addMessage(state, `${building.name} upgraded to tier ${building.upgraded + 1}.`, 'good');
  updateVisibility(state);
  return { ok: true, reason: `${building.name} upgraded to tier ${building.upgraded + 1}.` };
}

export function upgradeCostFor(buildingOrType) {
  const type = typeof buildingOrType === 'string' ? buildingOrType : buildingOrType.type;
  const level = typeof buildingOrType === 'string' ? 0 : (buildingOrType.upgraded || 0);
  const def = BUILDING_TYPES[type];
  const base = Object.keys(def.cost || {}).length ? def.cost : fallbackUpgradeCost(type);
  const multiplier = level + 1;
  const cost = {};
  for (const [resource, amount] of Object.entries(base)) {
    cost[resource] = Math.max(2, Math.ceil(amount * (0.65 + multiplier * 0.35)));
  }
  if (!cost.gold) cost.gold = 6 + multiplier * 4;
  return cost;
}

export function trainingQueueLimit(building) {
  return 3 + (building.upgraded || 0);
}

export function trainingTurnsFor(building, unitType) {
  const unitDef = UNIT_TYPES[unitType];
  return Math.max(1, unitDef.trainTurns - Math.floor((building.upgraded || 0) / 2));
}

function fallbackUpgradeCost(type) {
  if (type === 'city') return { wood: 24, stone: 16, gold: 18 };
  if (type === 'road') return { stone: 4, gold: 4 };
  if (type === 'wall' || type === 'watchtower') return { wood: 10, stone: 12, gold: 6 };
  return { wood: 12, stone: 8, gold: 8 };
}

export function startConstruction(state, builderId, buildingType, x, y) {
  const builder = state.units.find((u) => u.id === builderId);
  const def = BUILDING_TYPES[buildingType];
  if (!builder || builder.faction !== 'olundar') return { ok: false, reason: 'Select an Olundaran engineer.' };
  if (!def || !def.buildableBy.includes(builder.type)) return { ok: false, reason: 'That unit cannot build this.' };
  if (builder.hasActed) return { ok: false, reason: `${builder.name} has already acted.` };
  if (manhattan(builder.x, builder.y, x, y) > 1) return { ok: false, reason: 'Engineers build on their tile or an adjacent tile.' };
  const validation = canBuildOn(state, buildingType, x, y);
  if (!validation.ok) return validation;
  const resources = state.factions.olundar.resources;
  if (!canAfford(resources, def.cost)) return { ok: false, reason: `Need ${formatCost(missingCost(resources, def.cost))}.` };
  payCost(resources, def.cost);
  const building = addBuilding(state, buildingType, 'olundar', x, y, { complete: false });
  builder.hasActed = true;
  builder.fortified = 0;
  addMessage(state, `${def.name} construction started at ${x},${y}.`, 'info');
  updateVisibility(state);
  return { ok: true, building, reason: `${def.name} construction started.` };
}

export function canBuildOn(state, buildingType, x, y) {
  const def = BUILDING_TYPES[buildingType];
  const tile = tileAt(state, x, y);
  if (!def || !tile) return { ok: false, reason: 'Invalid build target.' };
  if (!isVisible(state, x, y)) return { ok: false, reason: 'You need eyes on the tile before building.' };
  if (!TERRAIN[tile.terrain].passable || tile.terrain === 'blight') return { ok: false, reason: 'Cannot build on that terrain.' };
  if (buildingAt(state, x, y)) return { ok: false, reason: 'A structure already occupies that tile.' };
  if (unitAt(state, x, y) && buildingType !== 'road') return { ok: false, reason: 'A unit blocks construction.' };
  if (buildingType === 'road' && tile.road) return { ok: false, reason: 'Road already exists here.' };
  if (buildingType === 'farm' && !(tile.terrain === 'plains' || tile.terrain === 'marsh' || adjacentTerrain(state, x, y, 'river'))) {
    return { ok: false, reason: 'Farms need plains, marsh reclamation, or a river-adjacent tile.' };
  }
  if (buildingType === 'lumberCamp' && tile.terrain !== 'forest') return { ok: false, reason: 'Lumber camps need forests.' };
  if (buildingType === 'mine' && !(tile.terrain === 'hills' || tile.terrain === 'ruins')) return { ok: false, reason: 'Mines need hills or ruins.' };
  if (!['road', 'wall', 'watchtower'].includes(buildingType) && !nearSupply(state, x, y)) {
    return { ok: false, reason: 'Major buildings must be within supply range of a city, outpost, or road network.' };
  }
  return { ok: true };
}

function adjacentTerrain(state, x, y, terrain) {
  return neighbors4(x, y).some((n) => tileAt(state, n.x, n.y).terrain === terrain);
}

export function isTileSupplied(state, x, y) {
  return inBounds(x, y) && nearSupply(state, x, y);
}

function nearSupply(state, x, y) {
  return state.buildings.some((b) => b.faction === 'olundar' && b.turnsLeft <= 0 && ['city', 'outpost', 'road'].includes(b.type) && manhattan(b.x, b.y, x, y) <= 6);
}

export function performDiplomacy(state, targetFaction, actionId) {
  normalizeCampaignState(state);
  const actor = state.factions.olundar;
  const target = state.factions[targetFaction];
  const action = DIPLOMACY_ACTIONS[actionId];
  if (!target || !target.discovered || targetFaction === 'dead') return { ok: false, reason: 'That civilization is not available for diplomacy.' };
  if (!action) return { ok: false, reason: 'Unknown diplomatic action.' };
  if (actor.atWar?.[targetFaction] || target.atWar?.olundar) return { ok: false, reason: `${target.name} is openly hostile. Diplomacy is closed.` };
  if (actionId === 'pact' && actor.pacts[targetFaction]) return { ok: false, reason: 'A Survival Pact is already active.' };
  if (actionId === 'trade' && actor.trades[targetFaction]) return { ok: false, reason: 'Trade is already open.' };
  if (!canAfford(actor.resources, action.cost)) return { ok: false, reason: `Need ${formatCost(missingCost(actor.resources, action.cost))}.` };
  payCost(actor.resources, action.cost);
  actor.relations[targetFaction] = clampRelation((actor.relations[targetFaction] ?? 0) + action.relation);
  target.relations.olundar = actor.relations[targetFaction];
  if (actionId === 'pact') {
    if (actor.relations[targetFaction] >= 35) {
      actor.pacts[targetFaction] = true;
      target.pacts.olundar = true;
      addMessage(state, `${target.name} accepts a Survival Pact. Their scouts now share vision and may send aid.`, 'good');
      recordDiplomacy(state, targetFaction, actionId, 'Survival Pact signed', 'Shared vision and emergency aid are now available.', 'good');
      recordDiplomaticMemory(state, targetFaction, 'promise', 'Survival Pact Oath', 'Olundar and this civilization publicly promised shared sight and emergency aid.', 2);
    } else {
      addMessage(state, `${target.name} respects the offer but wants more trust before a pact.`, 'info');
      recordDiplomacy(state, targetFaction, actionId, 'Pact deferred', 'Trust improved, but the pact threshold was not reached.', 'info');
      recordDiplomaticMemory(state, targetFaction, 'promise', 'Pact Overture', 'Olundar offered a survival oath, even though trust was not high enough yet.', 1);
    }
  } else if (actionId === 'trade') {
    actor.trades[targetFaction] = true;
    target.trades.olundar = true;
    addMessage(state, `Trade opened with ${target.name}. Gold income improves.`, 'good');
    recordDiplomacy(state, targetFaction, actionId, 'Trade opened', 'Gold and food income improve while trust rises.', 'good');
    recordDiplomaticMemory(state, targetFaction, 'promise', 'Trade Compact', 'Merchants now have a standing compact that makes future cooperation easier to defend.', 1);
  } else if (actionId === 'aid') {
    let aidOutcome = 'Aid refused';
    let aidDetail = 'The request cost influence and trust because relations were too uncertain.';
    let aidTone = 'danger';
    if ((actor.relations[targetFaction] ?? 0) >= 20) {
      if (targetFaction === 'dawn') {
        const spawn = findSpawnNear(state, 7, 16, 'olundar');
        if (spawn) addUnit(state, 'spearGuard', 'olundar', spawn.x, spawn.y, { name: 'Dawnward Oath-Spear' });
      } else if (targetFaction === 'veyr') {
        gainResources(actor.resources, { gold: 30, iron: 8 });
      } else if (targetFaction === 'mire') {
        const spawn = findSpawnNear(state, 7, 16, 'olundar');
        if (spawn) addUnit(state, 'scout', 'olundar', spawn.x, spawn.y, { name: 'Mireclan Guide' });
      }
      addMessage(state, `${target.name} answers with emergency aid.`, 'good');
      aidOutcome = 'Aid answered';
      aidDetail = 'The request succeeded, but relations cooled after the favor.';
      aidTone = 'good';
      recordDiplomaticMemory(state, targetFaction, 'fulfilled', 'Aid Answered', `${target.name} spent real stores or troops when Olundar asked for help.`, 2);
    } else {
      addMessage(state, `${target.name} refuses aid; relations are too uncertain.`, 'danger');
      recordDiplomaticMemory(state, targetFaction, 'grievance', 'Aid Request Strained Talks', 'Olundar asked for war aid before there was enough trust to make the demand bearable.', 1);
    }
    actor.relations[targetFaction] = clampRelation((actor.relations[targetFaction] ?? 0) - 4);
    target.relations.olundar = actor.relations[targetFaction];
    recordDiplomacy(state, targetFaction, actionId, aidOutcome, aidDetail, aidTone);
  } else if (actionId === 'pressure') {
    gainResources(actor.resources, { gold: 18, food: 12 });
    addMessage(state, `Olundar pressures ${target.name} for supplies. It works, but trust suffers.`, 'danger');
    if (actor.relations[targetFaction] <= -45) {
      actor.atWar[targetFaction] = true;
      target.atWar.olundar = true;
      addMessage(state, `${target.name} declares Olundar a rival even as the dead advance.`, 'danger');
      recordDiplomacy(state, targetFaction, actionId, 'Pressure caused rivalry', 'Supplies were taken, but open rivalry now blocks diplomacy.', 'danger');
      recordDiplomaticMemory(state, targetFaction, 'grievance', 'Pressure Broke Trust', 'Olundar extracted supplies so harshly that this front became a rivalry.', 5);
    } else {
      recordDiplomacy(state, targetFaction, actionId, 'Pressure extracted supplies', 'Olundar gained food and gold at a serious trust cost.', 'danger');
      recordDiplomaticMemory(state, targetFaction, 'grievance', 'Supplies Pressured', 'Olundar took food and gold under duress; future requests will carry this resentment.', 3);
    }
  }
  updateVisibility(state);
  return { ok: true };
}

export function makeDiplomaticPromise(state, targetFaction, promiseId) {
  normalizeCampaignState(state);
  const actor = state.factions.olundar;
  const target = state.factions[targetFaction];
  const promise = DIPLOMATIC_PROMISES[promiseId];
  if (!target || !target.discovered || targetFaction === 'dead') return { ok: false, reason: 'That civilization is not available for promises.' };
  if (!promise || promise.factionId !== targetFaction) return { ok: false, reason: 'Unknown faction promise.' };
  if (actor.atWar?.[targetFaction] || target.atWar?.olundar) return { ok: false, reason: `${target.name} is openly hostile. Promises are unavailable.` };
  if (state.flags.factionPromises[promiseId]) return { ok: false, reason: 'That promise has already been kept.' };
  if (!canAfford(actor.resources, promise.cost)) return { ok: false, reason: `Need ${formatCost(missingCost(actor.resources, promise.cost))}.` };

  payCost(actor.resources, promise.cost);
  actor.relations[targetFaction] = clampRelation((actor.relations[targetFaction] ?? 0) + promise.relation);
  target.relations.olundar = actor.relations[targetFaction];
  const outcome = applyDiplomaticPromiseOutcome(state, promise);
  state.flags.factionPromises[promiseId] = state.turn;
  addMessage(state, `${target.name}: ${outcome.text}`, outcome.tone);
  recordDiplomacy(state, targetFaction, promiseId, promise.name, outcome.detail, outcome.tone);
  recordDiplomaticMemory(state, targetFaction, 'fulfilled', promise.name, outcome.memoryDetail, promise.memory);
  updateVisibility(state);
  return { ok: true, reason: outcome.text, outcome };
}

export function resolvePromiseDemand(state, targetFaction, demandId, choiceId) {
  normalizeCampaignState(state);
  const actor = state.factions.olundar;
  const target = state.factions[targetFaction];
  const promise = Object.values(DIPLOMATIC_PROMISES).find((entry) => entry.factionId === targetFaction && entry.demand?.id === demandId);
  const demand = promise?.demand;
  if (!target || !target.discovered || targetFaction === 'dead') return { ok: false, reason: 'That civilization is not available for promise demands.' };
  if (!promise || !demand) return { ok: false, reason: 'Unknown promise demand.' };
  if (actor.atWar?.[targetFaction] || target.atWar?.olundar) return { ok: false, reason: `${target.name} is openly hostile. Promise demands are unavailable.` };
  const keptTurn = Number(state.flags.factionPromises?.[promise.id]) || 0;
  if (!keptTurn) return { ok: false, reason: 'That promise has not been kept yet.' };
  if (state.turn < keptTurn + demand.delay) return { ok: false, reason: 'That promise demand is not active yet.' };
  if (state.flags.promiseDemands[demand.id]) return { ok: false, reason: 'That promise demand has already been resolved.' };

  if (choiceId === 'answer') {
    if (!canAfford(actor.resources, demand.cost)) return { ok: false, reason: `Need ${formatCost(missingCost(actor.resources, demand.cost))}.` };
    payCost(actor.resources, demand.cost);
    actor.relations[targetFaction] = clampRelation((actor.relations[targetFaction] ?? 0) + demand.relation);
    target.relations.olundar = actor.relations[targetFaction];
    const outcome = applyPromiseDemandAnswer(state, demand);
    const detail = outcome.detail;
    state.flags.promiseDemands[demand.id] = { status: 'answered', turn: state.turn, detail };
    addMessage(state, `${target.name}: ${outcome.text}`, 'good');
    recordDiplomacy(state, targetFaction, demand.id, `Answered: ${demand.name}`, detail, 'good');
    recordDiplomaticMemory(state, targetFaction, 'fulfilled', demand.name, outcome.memoryDetail, demand.memory);
    updateVisibility(state);
    return { ok: true, reason: outcome.text, outcome };
  }

  if (choiceId === 'ignore') {
    actor.relations[targetFaction] = clampRelation((actor.relations[targetFaction] ?? 0) - 8);
    target.relations.olundar = actor.relations[targetFaction];
    const detail = `${target.name} records that Olundar ignored the follow-through demand behind ${promise.name}.`;
    state.flags.promiseDemands[demand.id] = { status: 'ignored', turn: state.turn, detail };
    addMessage(state, `${target.name} resents the ignored demand: ${demand.name}.`, 'danger');
    recordDiplomacy(state, targetFaction, demand.id, `Ignored: ${demand.name}`, detail, 'danger');
    recordDiplomaticMemory(state, targetFaction, 'grievance', `Ignored: ${demand.name}`, detail, demand.memory + 1);
    updateVisibility(state);
    return { ok: true, reason: detail, outcome: { tone: 'danger', text: detail } };
  }

  return { ok: false, reason: 'Unknown demand response.' };
}

function applyPromiseDemandAnswer(state, demand) {
  if (demand.id === 'dawnWallWatch') {
    const fortified = reinforceFactionHoldings(state, 'dawn', 8, 3);
    return {
      text: fortified ? 'Dawnward wall watches stay supplied and the hillforts harden again.' : 'Dawnward accepts the renewed wall watch, though no holdings remain to reinforce.',
      detail: fortified ? `${fortified} Dawnward holding${fortified === 1 ? '' : 's'} gained fresh wall-watch support.` : 'The wall-watch demand was answered, but no Dawnward holding could be reinforced.',
      memoryDetail: 'Olundar kept supplying the Dawnward wall guard after the first oath, proving the promise could survive pressure.'
    };
  }
  if (demand.id === 'veyrRouteTolls') {
    gainResources(state.factions.olundar.resources, { food: 18, iron: 5 });
    return {
      text: 'Veyr route tolls are paid and another war caravan reaches the living front.',
      detail: 'The toll payment returned 18 food and 5 iron from Veyr caravan stores.',
      memoryDetail: 'Olundar paid Veyr route tolls after funding the caravans, keeping the war road profitable enough to trust.'
    };
  }
  if (demand.id === 'mireGuideStores') {
    const unit = spawnOlundarUnitAtCapital(state, 'scout', 'Mire Oath-Path Scout');
    gainResources(state.factions.olundar.resources, { influence: 1 });
    return {
      text: unit ? 'Mire guides are fed, and an oath-path scout joins Olundar with fresh route knowledge.' : 'Mire guides are fed and share fresh route knowledge, though no open muster ground was found.',
      detail: unit ? 'A Mire Oath-Path Scout joined near Olundar Prime, and influence rose.' : 'The marsh guide demand was answered, and influence rose.',
      memoryDetail: 'Olundar fed Mireclan guides after promising to respect marsh routes, proving the route oath was practical.'
    };
  }
  return {
    text: 'The promise demand is answered.',
    detail: 'A promise demand was answered.',
    memoryDetail: 'Olundar answered a promise demand.'
  };
}

function applyDiplomaticPromiseOutcome(state, promise) {
  if (promise.id === 'dawnWallGuard') {
    const fortified = reinforceFactionHoldings(state, 'dawn', 10, 4);
    return {
      tone: 'good',
      text: fortified ? 'Dawnward walls and hillfort posts are reinforced under Olundar oath.' : 'Dawnward engineers accept the oath, though no holdings remain to reinforce.',
      detail: fortified ? `${fortified} Dawnward holding${fortified === 1 ? '' : 's'} gained durability from Olundar timber and engineers.` : 'Olundar promised wall guards, but no Dawnward holding could be reinforced.',
      memoryDetail: 'Olundar spent timber, influence, and engineers to protect Dawnward walls before asking for deeper trust.'
    };
  }
  if (promise.id === 'veyrCaravanFund') {
    gainResources(state.factions.olundar.resources, { food: 16, iron: 6 });
    return {
      tone: 'good',
      text: 'Veyr war caravans roll under Olundar funding and return with food and iron.',
      detail: 'The funded caravan route delivered 16 food and 6 iron while improving Veyr trust.',
      memoryDetail: 'Olundar funded Veyr caravans instead of treating the Dominion only as a purse.'
    };
  }
  if (promise.id === 'mireMarshRoutes') {
    const unit = spawnOlundarUnitAtCapital(state, 'scout', 'Mire Marsh-Route Guide');
    return {
      tone: unit ? 'good' : 'info',
      text: unit ? 'A Mire route guide joins Olundar to scout marsh paths and blight-shadow roads.' : 'Mireclan marks the marsh routes, though no open muster ground was found.',
      detail: unit ? 'A named scout mustered near Olundar Prime with Mireclan route knowledge.' : 'Mireclan accepted the route oath, but no scout could be placed.',
      memoryDetail: 'Olundar fed Mireclan guides and promised to respect marsh routes in future operations.'
    };
  }
  return {
    tone: 'info',
    text: 'The faction promise is recorded.',
    detail: 'A faction-specific promise was recorded.',
    memoryDetail: 'Olundar recorded a faction-specific promise.'
  };
}

export function setFieldOrder(state, targetFaction, orderId) {
  normalizeCampaignState(state);
  const actor = state.factions.olundar;
  const target = state.factions[targetFaction];
  const order = FIELD_ORDERS[orderId];
  if (!target || !target.discovered || targetFaction === 'dead') return { ok: false, reason: 'That civilization is not available for field orders.' };
  if (!order) return { ok: false, reason: 'Unknown field order.' };
  if (!actor.pacts?.[targetFaction]) return { ok: false, reason: 'Field orders require a Survival Pact.' };
  if (actor.atWar?.[targetFaction] || target.atWar?.olundar) return { ok: false, reason: `${target.name} is openly hostile. Field orders are unavailable.` };
  actor.fieldOrders[targetFaction] = orderId;
  addMessage(state, `${target.name} will ${order.name.toLowerCase()} under the Survival Pact.`, 'good');
  recordDiplomacy(state, targetFaction, orderId, `Field order: ${order.name}`, order.text, 'good');
  recordDiplomaticMemory(state, targetFaction, 'promise', `Pledged: ${order.name}`, `The pact now has a battlefield commitment: ${order.text}`, 1);
  return { ok: true, reason: `${target.name}: ${order.name}.` };
}

function recordDiplomacy(state, factionId, actionId, outcome, detail, tone = 'info') {
  normalizeCampaignState(state);
  state.diplomacyLog.unshift({
    turn: state.turn,
    factionId,
    factionName: state.factions[factionId]?.name || factionId,
    actionId,
    actionName: DIPLOMACY_ACTIONS[actionId]?.name || DIPLOMATIC_PROMISES[actionId]?.name || FIELD_ORDERS[actionId]?.name || actionId,
    outcome,
    detail,
    relation: state.factions.olundar.relations[factionId] ?? 0,
    tone
  });
  state.diplomacyLog = state.diplomacyLog.slice(0, 40);
}

function ensureDiplomacyMemory(state, factionId) {
  normalizeDiplomacyMemory(state);
  return state.diplomacyMemory[factionId];
}

function recordDiplomaticMemory(state, factionId, type, label, detail, amount = 1) {
  if (!LIVING_DIPLOMACY_FACTIONS.includes(factionId)) return null;
  const memory = ensureDiplomacyMemory(state, factionId);
  const delta = Math.max(0, amount);
  if (type === 'grievance') {
    memory.grievances = Math.min(DIPLOMACY_MEMORY_MAX, memory.grievances + delta);
  } else if (type === 'promise' || type === 'fulfilled') {
    memory.promises = Math.min(DIPLOMACY_MEMORY_MAX, memory.promises + delta);
  }
  memory.records.unshift({
    turn: state.turn,
    type,
    label,
    detail,
    amount: delta
  });
  memory.records = memory.records.slice(0, 8);
  return memory;
}

function recordFieldOrderFulfillment(state, factionId, orderId, label, detail, amount = 1) {
  const memory = ensureDiplomacyMemory(state, factionId);
  if (memory.fulfilledOrders[orderId]) return;
  memory.fulfilledOrders[orderId] = state.turn;
  recordDiplomaticMemory(state, factionId, 'fulfilled', label, detail, amount);
}

export function endTurn(state) {
  if (state.status !== 'playing') return state;
  state.turn += 1;
  processConstructionAndTraining(state);
  processEconomy(state);
  processBlight(state);
  runNonPlayerTurns(state);
  resetActions(state);
  updateVisibility(state);
  updateAftermathMissions(state);
  checkLossConditions(state);
  return state;
}

function processConstructionAndTraining(state) {
  for (const building of state.buildings) {
    if (building.turnsLeft > 0) {
      building.turnsLeft -= 1;
      if (building.turnsLeft === 0 && building.faction === 'olundar') {
        addMessage(state, `${building.name} completed.`, 'good');
      }
    }
    if (building.turnsLeft <= 0 && building.queue?.length) {
      const current = building.queue[0];
      current.turnsLeft -= 1;
      if (current.turnsLeft <= 0) {
        const spawn = findSpawnNear(state, building.x, building.y, building.faction);
        if (spawn) {
          const unit = addUnit(state, current.unitType, building.faction, spawn.x, spawn.y);
          if (building.faction === 'olundar') addMessage(state, `${unit.name} musters at ${building.name}.`, 'good');
        } else if (building.faction === 'olundar') {
          addMessage(state, `${building.name} cannot muster: all nearby tiles are blocked.`, 'danger');
          current.turnsLeft = 1;
          continue;
        }
        building.queue.shift();
      }
    }
  }
}

function processEconomy(state) {
  for (const factionId of Object.keys(state.factions)) {
    if (factionId === 'dead') continue;
    const faction = state.factions[factionId];
    const income = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0, influence: 0, morale: 0 };
    for (const building of state.buildings) {
      if (building.faction !== factionId || building.turnsLeft > 0) continue;
      gainResources(income, incomeForBuilding(state, building));
    }
    if (factionId === 'olundar') {
      for (const partner of Object.keys(faction.trades)) {
        if (faction.trades[partner]) gainResources(income, { gold: 6, food: 2 });
      }
      const upkeep = totalUpkeep(state, factionId);
      gainResources(faction.resources, income);
      payUpkeepWithMoralePenalty(state, factionId, upkeep);
      if (faction.resources.food > 120 && faction.population < faction.housing) {
        faction.population += 1;
        faction.resources.food -= 12;
      }
      if ((income.morale || 0) > 0) faction.resources.morale = Math.min(12, faction.resources.morale + income.morale);
    } else {
      gainResources(faction.resources, income);
    }
  }
}

function incomeForBuilding(state, building) {
  const def = getBuildingDef(building);
  const income = { ...def.income };
  const tile = tileAt(state, building.x, building.y);
  if (building.type === 'farm') {
    if (tile.terrain === 'plains') income.food = (income.food || 0) + 2;
    if (tile.terrain === 'marsh') income.food = Math.max(2, (income.food || 0) - 2);
    if (adjacentTerrain(state, building.x, building.y, 'river')) income.food = (income.food || 0) + 2;
  }
  if (building.type === 'lumberCamp' && tile.terrain === 'forest') income.wood = (income.wood || 0) + 4;
  if (building.type === 'mine') {
    if (tile.terrain === 'hills') income.iron = (income.iron || 0) + 3;
    if (tile.terrain === 'ruins') income.gold = (income.gold || 0) + 3;
  }
  if (building.type === 'watchtower' && tile.terrain === 'hills') income.influence = (income.influence || 0) + 1;
  for (const [resource, amount] of Object.entries(income)) {
    income[resource] = amount + Math.ceil(amount * 0.35 * (building.upgraded || 0));
  }
  return income;
}

function totalUpkeep(state, factionId) {
  const total = {};
  for (const unit of state.units) {
    if (unit.faction !== factionId) continue;
    gainResources(total, getUnitDef(unit).upkeep || {});
  }
  return total;
}

function payUpkeepWithMoralePenalty(state, factionId, upkeep) {
  const faction = state.factions[factionId];
  for (const [resource, amount] of Object.entries(upkeep)) {
    if (!amount) continue;
    if ((faction.resources[resource] || 0) >= amount) {
      faction.resources[resource] -= amount;
    } else {
      faction.resources[resource] = 0;
      faction.resources.morale = Math.max(0, (faction.resources.morale || 0) - 1);
      for (const unit of state.units.filter((u) => u.faction === factionId)) {
        if (Math.random() < 0.12) unit.hp = Math.max(1, unit.hp - 1);
      }
      addMessage(state, `${faction.name} lacks ${resource} for upkeep. Morale suffers.`, 'danger');
    }
  }
}

function processBlight(state) {
  for (const building of state.buildings.filter((b) => b.faction === 'dead')) {
    const radius = building.type === 'portal' ? 4 : building.type === 'necropolis' ? 3 : 2;
    for (let y = building.y - radius; y <= building.y + radius; y += 1) {
      for (let x = building.x - radius; x <= building.x + radius; x += 1) {
        if (!inBounds(x, y) || manhattan(building.x, building.y, x, y) > radius) continue;
        const tile = tileAt(state, x, y);
        if (tile.terrain === 'mountains' || tile.terrain === 'river') continue;
        const resistance = nearBuilding(state, x, y, 'shrine', null, 2) ? 1 : 0;
        tile.blight = Math.min(9, (tile.blight || 0) + 1 - resistance);
        if (tile.blight >= 4) tile.terrain = 'blight';
      }
    }
  }
  for (const unit of state.units.slice()) {
    const def = getUnitDef(unit);
    const tile = tileAt(state, unit.x, unit.y);
    if (tile?.terrain === 'blight') {
      if (def.faction === 'dead') unit.hp = Math.min(unit.maxHp, unit.hp + 1);
      else if (!nearBuilding(state, unit.x, unit.y, 'shrine', unit.faction, 3)) {
        unit.hp -= 1;
        if (unit.faction === 'olundar') addMessage(state, `${unit.name} suffers grave-blight attrition.`, 'danger');
        if (unit.hp <= 0) removeUnit(state, unit.id);
      }
    }
  }
}

function cleanseAround(state, cx, cy, radius) {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (!inBounds(x, y) || manhattan(cx, cy, x, y) > radius) continue;
      const tile = tileAt(state, x, y);
      tile.blight = Math.max(0, (tile.blight || 0) - 4);
      if (tile.terrain === 'blight' && tile.blight < 4) tile.terrain = tile.baseTerrain || 'plains';
    }
  }
}

function runNonPlayerTurns(state) {
  runDeadwalkerTurn(state);
  for (const factionId of ['dawn', 'veyr', 'mire']) runLivingAiTurn(state, factionId);
}

function runDeadwalkerTurn(state) {
  const deadBuildings = state.buildings.filter((b) => b.faction === 'dead' && b.turnsLeft <= 0);
  const pressure = deadwalkerPressureFor(state);
  if (state.turn >= pressure.startTurn && state.turn % pressure.thrallEvery === 0) spawnUndeadFrom(state, 'portal', 'boneThrall');
  if (state.turn >= pressure.startTurn && state.turn % pressure.archerEvery === 0) spawnUndeadFrom(state, 'portal', 'corpseArcher');
  if (state.turn >= pressure.startTurn && state.turn % pressure.knightEvery === 0) spawnUndeadFrom(state, 'graveForge', 'graveKnight');
  if (state.turn >= pressure.startTurn && state.turn % pressure.outpostEvery === 0) growDeadwalkerOutpost(state);

  const deadUnits = state.units.filter((u) => u.faction === 'dead');
  for (const unit of deadUnits) {
    if (!state.units.includes(unit)) continue;
    const acted = aiTryAttack(state, unit);
    if (acted) continue;
    const target = nearestLivingTarget(state, unit.x, unit.y);
    if (!target) continue;
    aiMoveToward(state, unit, target.x, target.y);
    aiTryAttack(state, unit);
  }

  for (const building of deadBuildings) {
    const target = nearestLivingTarget(state, building.x, building.y, 2);
    if (target && target.kind === 'building' && building.type !== 'bonePit') {
      target.ref.hp -= 2;
      if (target.ref.hp <= 0) destroyBuilding(state, target.ref.id, 'dead');
    }
  }
}

function deadwalkerPressureFor(state) {
  normalizeCampaignState(state);
  return DIFFICULTY_PRESETS[state.campaign.difficultyId]?.deadwalker || DIFFICULTY_PRESETS.standard.deadwalker;
}

function spawnUndeadFrom(state, buildingType, unitType) {
  const origins = state.buildings.filter((b) => b.faction === 'dead' && b.type === buildingType && b.turnsLeft <= 0);
  for (const origin of origins) {
    const spawn = findSpawnNear(state, origin.x, origin.y, 'dead');
    if (spawn) addUnit(state, unitType, 'dead', spawn.x, spawn.y);
  }
}

function growDeadwalkerOutpost(state) {
  const candidates = [];
  for (const building of state.buildings.filter((b) => b.faction === 'dead')) {
    for (let y = building.y - 4; y <= building.y + 4; y += 1) {
      for (let x = building.x - 4; x <= building.x + 4; x += 1) {
        if (!inBounds(x, y) || manhattan(building.x, building.y, x, y) > 4) continue;
        const tile = tileAt(state, x, y);
        if (tile.terrain !== 'blight' || buildingAt(state, x, y) || unitAt(state, x, y)) continue;
        candidates.push({ x, y, score: -x + manhattan(x, y, 7, 16) * -0.1 });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const pick = candidates[0];
  if (pick) {
    const type = state.turn % 10 === 0 ? 'graveForge' : 'bonePit';
    addBuilding(state, type, 'dead', pick.x, pick.y, { complete: true });
    if (isRevealed(state, pick.x, pick.y)) addMessage(state, `Deadwalkers raise a ${BUILDING_TYPES[type].name} in the blight.`, 'danger');
  }
}

function runLivingAiTurn(state, factionId) {
  const faction = state.factions[factionId];
  const relation = state.factions.olundar.relations[factionId] ?? 0;
  const fieldOrder = activeFieldOrder(state, factionId);
  const warAim = factionWarAim(state, factionId);
  announceWarAim(state, factionId, warAim);
  // Muster slowly, faster when allied or threatened.
  const musterCadence = (fieldOrder || relation > 30) ? 4 : 6;
  if (state.turn % musterCadence === 0) {
    const allyCity = state.buildings.find((b) => b.faction === factionId && b.type === 'city');
    const reinforceCity = fieldOrder === 'reinforceCapital' ? state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city') : null;
    const city = reinforceCity || allyCity;
    if (city) {
      const roster = factionId === 'dawn' ? ['spearGuard', 'archer'] : factionId === 'veyr' ? ['cavalry', 'legionary'] : ['scout', 'archer'];
      const spawn = findSpawnNear(state, city.x, city.y, factionId);
      if (spawn) {
        addUnit(state, roster[state.turn % roster.length], factionId, spawn.x, spawn.y);
        if (reinforceCity) {
          addMessage(state, `${faction.name} reinforces Olundar Prime under pact orders.`, 'good');
          recordFieldOrderFulfillment(state, factionId, 'reinforceCapital', 'Capital Reinforced', `${faction.name} sent troops to Olundar Prime under pact orders.`, 2);
        }
      }
    }
  }

  for (const unit of state.units.filter((u) => u.faction === factionId)) {
    if (!state.units.includes(unit)) continue;
    const acted = aiTryAttack(state, unit);
    if (acted) continue;
    const orderTarget = fieldOrderTarget(state, unit, fieldOrder);
    if (orderTarget) {
      aiMoveToward(state, unit, orderTarget.x, orderTarget.y);
      if (fieldOrder === 'harassDeadworks') {
        recordFieldOrderFulfillment(state, factionId, 'harassDeadworks', 'Deadworks Harassed', `${faction.name} pushed toward Deadwalker works under pact orders.`, 2);
      } else if (fieldOrder === 'defendRoads') {
        recordFieldOrderFulfillment(state, factionId, 'defendRoads', 'Roads Patrolled', `${faction.name} honored the pact by patrolling Olundar roads and approaches.`, 1);
      }
      aiTryAttack(state, unit);
      continue;
    }
    const aimTarget = !fieldOrder ? factionWarAimTarget(state, unit, factionId, warAim?.id) : null;
    if (aimTarget) {
      if (manhattan(unit.x, unit.y, aimTarget.x, aimTarget.y) > (aimTarget.holdRadius || 0)) {
        aiMoveToward(state, unit, aimTarget.x, aimTarget.y);
        aiTryAttack(state, unit);
      } else {
        unit.hasActed = true;
        unit.fortified = 1;
      }
      continue;
    }
    const deadTarget = nearestTargetFaction(state, unit.x, unit.y, 'dead', relation > 15 ? 14 : 8);
    if (deadTarget) {
      aiMoveToward(state, unit, deadTarget.x, deadTarget.y);
      aiTryAttack(state, unit);
      continue;
    }
    if (state.factions.olundar.atWar[factionId]) {
      const olundarTarget = nearestTargetFaction(state, unit.x, unit.y, 'olundar', 12);
      if (olundarTarget) aiMoveToward(state, unit, olundarTarget.x, olundarTarget.y);
    }
  }
}

function activeFieldOrder(state, factionId) {
  if (!state.factions.olundar.pacts?.[factionId]) return null;
  if (state.factions.olundar.atWar?.[factionId] || state.factions[factionId].atWar?.olundar) return null;
  return state.factions.olundar.fieldOrders?.[factionId] || 'defendRoads';
}

function announceWarAim(state, factionId, warAim) {
  if (!warAim || !state.factions[factionId]?.discovered || state.flags.warAimNotices[factionId]) return;
  const notice = warAimNoticeText(state, factionId, warAim.id);
  if (!notice) return;
  state.flags.warAimNotices[factionId] = true;
  addMessage(state, notice, warAim.tone === 'danger' ? 'danger' : 'info');
}

function warAimNoticeText(state, factionId, aimId) {
  const faction = state.factions[factionId];
  if (aimId === 'dawnBulwark') return `${faction.name} declares a shield-wall war aim around its hillforts.`;
  if (aimId === 'veyrRaid') return `${faction.name} rides for Deadwalker spoils before choosing a side.`;
  if (aimId === 'mireScout') return `${faction.name} scouts the blight-shadow for its own survival.`;
  if (aimId === 'rivalClaim') return `${faction.name} presses a rival claim against Olundar.`;
  return '';
}

function factionWarAimTarget(state, unit, factionId, aimId) {
  if (!aimId) return null;
  if (aimId === 'dawnBulwark') {
    const holding = nearestFactionBuilding(state, unit.x, unit.y, factionId, ['city', 'watchtower', 'barracks', 'outpost']);
    return nearestThreatToFactionAssets(state, unit.x, unit.y, factionId, 10)
      || (holding ? { ...holding, holdRadius: 1 } : null);
  }
  if (aimId === 'veyrRaid') {
    return nearestDeadwalkerStructure(state, unit.x, unit.y, 34) || nearestTargetFaction(state, unit.x, unit.y, 'dead', 34);
  }
  if (aimId === 'mireScout') {
    return nearestDeadwalkerStructure(state, unit.x, unit.y, 44) || easternScoutTarget(state, unit.x, unit.y);
  }
  if (aimId === 'rivalClaim') {
    return nearestTargetFaction(state, unit.x, unit.y, 'olundar', 14);
  }
  return null;
}

function fieldOrderTarget(state, unit, orderId) {
  if (!orderId) return null;
  if (orderId === 'harassDeadworks') {
    return nearestDeadwalkerStructure(state, unit.x, unit.y, 28) || nearestTargetFaction(state, unit.x, unit.y, 'dead', 18);
  }
  if (orderId === 'reinforceCapital') {
    return nearestThreatToFactionAssets(state, unit.x, unit.y, 'olundar', 9) || nearestFactionBuilding(state, unit.x, unit.y, 'olundar', ['city', 'outpost']);
  }
  if (orderId === 'defendRoads') {
    return nearestThreatToFactionAssets(state, unit.x, unit.y, 'olundar', 8) || nearestFactionBuilding(state, unit.x, unit.y, 'olundar', ['road', 'watchtower', 'outpost', 'city']);
  }
  return null;
}

function easternScoutTarget(state, x, y) {
  const candidates = state.map.tiles
    .filter((tile) => tile.x > x && TERRAIN[tile.terrain].passable)
    .map((tile) => ({ x: tile.x, y: tile.y, dist: manhattan(x, y, tile.x, tile.y) + Math.max(0, 24 - tile.x) * 0.35 }))
    .sort((a, b) => a.dist - b.dist);
  return candidates[0] || null;
}

function nearestDeadwalkerStructure(state, x, y, maxDistance = Infinity) {
  return state.buildings
    .filter((building) => building.faction === 'dead' && ['bonePit', 'graveForge', 'necropolis', 'portal'].includes(building.type))
    .map((building) => ({ kind: 'building', ref: building, x: building.x, y: building.y, dist: manhattan(x, y, building.x, building.y) }))
    .filter((target) => target.dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist)[0] || null;
}

function nearestThreatToFactionAssets(state, x, y, factionId, protectRadius) {
  const assets = [
    ...state.units.filter((unit) => unit.faction === factionId).map((unit) => ({ x: unit.x, y: unit.y })),
    ...state.buildings.filter((building) => building.faction === factionId).map((building) => ({ x: building.x, y: building.y }))
  ];
  if (!assets.length) return null;
  return [
    ...state.units.filter((unit) => unit.faction === 'dead'),
    ...state.buildings.filter((building) => building.faction === 'dead')
  ]
    .filter((threat) => assets.some((asset) => manhattan(threat.x, threat.y, asset.x, asset.y) <= protectRadius))
    .map((threat) => ({ ref: threat, x: threat.x, y: threat.y, dist: manhattan(x, y, threat.x, threat.y) }))
    .sort((a, b) => a.dist - b.dist)[0] || null;
}

function nearestFactionBuilding(state, x, y, factionId, types) {
  return state.buildings
    .filter((building) => building.faction === factionId && types.includes(building.type))
    .map((building) => ({ kind: 'building', ref: building, x: building.x, y: building.y, dist: manhattan(x, y, building.x, building.y) }))
    .sort((a, b) => a.dist - b.dist)[0] || null;
}

function aiTryAttack(state, unit) {
  const def = getUnitDef(unit);
  const enemyUnit = state.units
    .filter((target) => isEnemy(state, unit.faction, target.faction) && manhattan(unit.x, unit.y, target.x, target.y) <= def.range)
    .sort((a, b) => a.hp - b.hp)[0];
  if (enemyUnit) {
    attackUnit(state, unit.id, enemyUnit.id);
    return true;
  }
  const enemyBuilding = state.buildings
    .filter((target) => isEnemy(state, unit.faction, target.faction) && manhattan(unit.x, unit.y, target.x, target.y) <= def.range)
    .sort((a, b) => a.hp - b.hp)[0];
  if (enemyBuilding) {
    attackBuilding(state, unit.id, enemyBuilding.id);
    return true;
  }
  return false;
}

function aiMoveToward(state, unit, tx, ty) {
  const def = getUnitDef(unit);
  const options = neighbors4(unit.x, unit.y)
    .filter((p) => canEnter(state, unit, p.x, p.y))
    .map((p) => ({ ...p, cost: moveCostFor(state, unit, p.x, p.y, unit), dist: manhattan(p.x, p.y, tx, ty) }))
    .filter((p) => p.cost <= def.move)
    .sort((a, b) => (a.dist + a.cost * 0.2) - (b.dist + b.cost * 0.2));
  const pick = options[0];
  if (pick) {
    unit.x = pick.x;
    unit.y = pick.y;
    unit.hasActed = true;
  }
}

function nearestLivingTarget(state, x, y, maxDistance = Infinity) {
  const options = [];
  for (const unit of state.units) {
    if (unit.faction !== 'dead') options.push({ kind: 'unit', ref: unit, x: unit.x, y: unit.y, dist: manhattan(x, y, unit.x, unit.y) });
  }
  for (const building of state.buildings) {
    if (building.faction !== 'dead') options.push({ kind: 'building', ref: building, x: building.x, y: building.y, dist: manhattan(x, y, building.x, building.y) });
  }
  return options.filter((o) => o.dist <= maxDistance).sort((a, b) => a.dist - b.dist)[0] || null;
}

function nearestTargetFaction(state, x, y, factionId, maxDistance = Infinity) {
  const options = [];
  for (const unit of state.units) {
    if (unit.faction === factionId) options.push({ kind: 'unit', ref: unit, x: unit.x, y: unit.y, dist: manhattan(x, y, unit.x, unit.y) });
  }
  for (const building of state.buildings) {
    if (building.faction === factionId) options.push({ kind: 'building', ref: building, x: building.x, y: building.y, dist: manhattan(x, y, building.x, building.y) });
  }
  return options.filter((o) => o.dist <= maxDistance).sort((a, b) => a.dist - b.dist)[0] || null;
}

export function findSpawnNear(state, x, y, faction) {
  const frontier = [{ x, y }];
  const seen = new Set([idx(x, y)]);
  while (frontier.length) {
    const current = frontier.shift();
    for (const n of neighbors4(current.x, current.y)) {
      const key = idx(n.x, n.y);
      if (seen.has(key)) continue;
      seen.add(key);
      const phantom = { id: 'spawn', type: faction === 'dead' ? 'boneThrall' : 'scout', faction, x, y };
      if (canEnter(state, phantom, n.x, n.y) && !unitAt(state, n.x, n.y)) return n;
      if (manhattan(x, y, n.x, n.y) < 5) frontier.push(n);
    }
  }
  return null;
}

function resetActions(state) {
  for (const unit of state.units) unit.hasActed = false;
}

function checkLossConditions(state) {
  const city = state.buildings.find((b) => b.faction === 'olundar' && b.type === 'city');
  if (!city && state.status === 'playing') {
    state.status = 'lost';
    state.winner = 'dead';
    addMessage(state, 'Olundar has no surviving city. The campaign is lost.', 'danger');
  }
  if (state.factions.olundar.resources.morale <= 0 && state.status === 'playing') {
    addMessage(state, 'Olundar morale is collapsing. Build shrines, secure food, or win soon.', 'danger');
  }
}

export function canAfford(resources, cost = {}) {
  return Object.entries(cost).every(([key, value]) => (resources[key] || 0) >= value);
}

export function payCost(resources, cost = {}) {
  for (const [key, value] of Object.entries(cost)) resources[key] = (resources[key] || 0) - value;
}

export function gainResources(resources, income = {}) {
  for (const [key, value] of Object.entries(income)) resources[key] = (resources[key] || 0) + value;
}

export function missingCost(resources, cost = {}) {
  const missing = {};
  for (const [key, value] of Object.entries(cost)) {
    const deficit = value - (resources[key] || 0);
    if (deficit > 0) missing[key] = deficit;
  }
  return missing;
}

export function formatCost(cost = {}) {
  const entries = Object.entries(cost).filter(([, value]) => value);
  if (!entries.length) return 'no cost';
  return entries.map(([key, value]) => `${value} ${key}`).join(', ');
}

export function clampRelation(value) {
  return Math.max(-100, Math.min(100, value));
}

function nearBuilding(state, x, y, type, faction = null, radius = 1) {
  return state.buildings.some((b) => b.type === type && (!faction || b.faction === faction) && b.turnsLeft <= 0 && manhattan(b.x, b.y, x, y) <= radius);
}

export function getTileSummary(state, x, y) {
  const tile = tileAt(state, x, y);
  if (!tile) return null;
  if (!isRevealed(state, x, y)) return { title: 'Unexplored', text: 'Fog of war. Send scouts or build watchtowers.', hidden: true };
  const terrain = TERRAIN[tile.terrain];
  const unit = isVisible(state, x, y) ? unitAt(state, x, y) : null;
  const building = isVisible(state, x, y) ? buildingAt(state, x, y) : null;
  return {
    title: `${terrain.name} ${x},${y}`,
    text: terrain.tactical,
    terrain: tile.terrain,
    elevation: tile.elevation,
    moisture: tile.moisture,
    blight: tile.blight,
    road: tile.road,
    unit,
    building,
    hidden: false,
    dimmed: !isVisible(state, x, y)
  };
}

export function serializeState(state) {
  return JSON.stringify(state);
}

export function deserializeState(json) {
  const state = JSON.parse(json);
  if (state.version !== CURRENT_SAVE_VERSION) throw new Error('Save file version is not compatible with this prototype.');
  normalizeCampaignState(state);
  updateVisibility(state);
  return state;
}
