import {
  BUILDING_TYPES,
  CURRENT_SAVE_VERSION,
  DIFFICULTY_PRESETS,
  DIPLOMACY_ACTIONS,
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
import { generateWorld, idx, inBounds, manhattan, neighbors4 } from './map.js';

const LIVING_DIPLOMACY_FACTIONS = ['dawn', 'veyr', 'mire'];

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
      warAimNotices: {}
    },
    diplomacyLog: [],
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
  if (!state.flags) state.flags = {};
  if (!state.flags.warAimNotices) state.flags.warAimNotices = {};
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
  return {
    title: 'Diplomacy Ledger',
    summary: diplomacyLedgerSummary(state, entries),
    stats: [
      { label: 'Contacts', value: `${contacted}/3` },
      { label: 'Pacts', value: `${pacts}/3` },
      { label: 'Trade', value: trades },
      { label: 'Rivals', value: rivals }
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
  const posture = discovered ? diplomacyPosture(relation, atWar, pact) : { label: 'Uncontacted', tone: 'info' };
  const recent = (state.diplomacyLog || []).filter((record) => record.factionId === id).slice(0, 2);
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
    tags: diplomacyTags(discovered, relation, pact, trade, atWar, fieldOrder, warAim),
    advice: diplomacyAdvice(state, id, relation, discovered, pact, trade, atWar, warAim),
    recent,
    actions: Object.keys(DIPLOMACY_ACTIONS).map((actionId) => diplomacyActionView(state, id, actionId, relation, discovered, pact, trade, atWar)),
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

function diplomacyTags(discovered, relation, pact, trade, atWar, fieldOrder = null, warAim = null) {
  if (!discovered) return ['Uncontacted'];
  const tags = [`Relation ${relation}`];
  if (pact) tags.push('Survival Pact');
  if (trade) tags.push('Trade');
  if (fieldOrder) tags.push(fieldOrder.name);
  if (warAim && !pact) tags.push(`Aim: ${warAim.name}`);
  if (atWar) tags.push('At war');
  if (!pact && !trade && !atWar) tags.push('No accord');
  return tags;
}

function diplomacyAdvice(state, id, relation, discovered, pact, trade, atWar, warAim = null) {
  if (!discovered) return `${state.factions[id].name} is still beyond current sight. Scout roads, towers, and frontier ruins to open talks.`;
  if (atWar) return 'This front is politically hostile. Defend first; aid, trade, and pacts are unavailable while rivalry is open.';
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
      name: item.name || BUILDING_TYPES[item.type]?.name || UNIT_TYPES[item.type]?.name || kind
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
    } else {
      addMessage(state, `${target.name} respects the offer but wants more trust before a pact.`, 'info');
      recordDiplomacy(state, targetFaction, actionId, 'Pact deferred', 'Trust improved, but the pact threshold was not reached.', 'info');
    }
  } else if (actionId === 'trade') {
    actor.trades[targetFaction] = true;
    target.trades.olundar = true;
    addMessage(state, `Trade opened with ${target.name}. Gold income improves.`, 'good');
    recordDiplomacy(state, targetFaction, actionId, 'Trade opened', 'Gold and food income improve while trust rises.', 'good');
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
    } else {
      addMessage(state, `${target.name} refuses aid; relations are too uncertain.`, 'danger');
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
    } else {
      recordDiplomacy(state, targetFaction, actionId, 'Pressure extracted supplies', 'Olundar gained food and gold at a serious trust cost.', 'danger');
    }
  }
  updateVisibility(state);
  return { ok: true };
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
  return { ok: true, reason: `${target.name}: ${order.name}.` };
}

function recordDiplomacy(state, factionId, actionId, outcome, detail, tone = 'info') {
  normalizeCampaignState(state);
  state.diplomacyLog.unshift({
    turn: state.turn,
    factionId,
    factionName: state.factions[factionId]?.name || factionId,
    actionId,
    actionName: DIPLOMACY_ACTIONS[actionId]?.name || FIELD_ORDERS[actionId]?.name || actionId,
    outcome,
    detail,
    relation: state.factions.olundar.relations[factionId] ?? 0,
    tone
  });
  state.diplomacyLog = state.diplomacyLog.slice(0, 40);
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
        if (reinforceCity) addMessage(state, `${faction.name} reinforces Olundar Prime under pact orders.`, 'good');
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
