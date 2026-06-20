import { getContentTables, reloadContentTables, validateAllContentTables, exportContentTables } from './engine/content-loader.js';

export { reloadContentTables, validateAllContentTables, exportContentTables };

const contentTables = getContentTables();

export const MAP_WIDTH = 44;
export const MAP_HEIGHT = 30;
export const CURRENT_SAVE_VERSION = 1;

export const DIFFICULTY_PRESETS = {
  chronicle: {
    id: 'chronicle',
    name: 'Chronicle',
    text: 'A gentler campaign for learning the map, diplomacy, and siege arc.',
    resourceDelta: { food: 30, wood: 24, stone: 12, iron: 8, gold: 24, influence: 2, morale: 2 },
    deadwalker: { startTurn: 4, thrallEvery: 3, archerEvery: 5, knightEvery: 8, outpostEvery: 8 },
    march: { firstTurn: 18, interval: 12, size: 2, growth: 1, cap: 6, menacePerTurn: 1 }
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    text: 'Moderate pressure: poor scouting hurts, but recovery remains possible.',
    resourceDelta: {},
    deadwalker: { startTurn: 2, thrallEvery: 2, archerEvery: 4, knightEvery: 6, outpostEvery: 5 },
    march: { firstTurn: 12, interval: 9, size: 3, growth: 1, cap: 8, menacePerTurn: 1 }
  },
  legion: {
    id: 'legion',
    name: 'Legion',
    text: 'Sharper pressure for players who already understand scouting and economy timing.',
    resourceDelta: { food: -10, wood: -8, gold: -8, morale: -1 },
    deadwalker: { startTurn: 2, thrallEvery: 2, archerEvery: 3, knightEvery: 5, outpostEvery: 4 },
    march: { firstTurn: 9, interval: 7, size: 3, growth: 1, cap: 10, menacePerTurn: 2 }
  },
  hollowCrown: {
    id: 'hollowCrown',
    name: 'Hollow Crown',
    text: 'The Deadwalkers surge early. Every road, tower, and pact must matter.',
    resourceDelta: { food: -16, wood: -12, stone: -4, iron: -4, gold: -12, morale: -2 },
    deadwalker: { startTurn: 1, thrallEvery: 1, archerEvery: 3, knightEvery: 4, outpostEvery: 3 },
    march: { firstTurn: 6, interval: 6, size: 4, growth: 1, cap: 12, menacePerTurn: 2 }
  }
};

export const SCENARIOS = {
  founding: {
    id: 'founding',
    name: 'Founding of Olundar',
    seed: 'Olundar-Founding',
    difficultyId: 'standard',
    text: 'Balanced start with the capital, a scout, an engineer, and enough time to choose your first frontier.'
  },
  dawnroad: {
    id: 'dawnroad',
    name: 'Dawnward Road Compact',
    seed: 'Dawnward-Road-Compact',
    difficultyId: 'standard',
    text: 'A northern road campaign with extra influence and a sworn spear for early alliance play.',
    resourceDelta: { influence: 2, stone: 8, gold: -6 },
    units: [{ type: 'spearGuard', faction: 'olundar', x: 9, y: 16, name: 'Road Oath-Spear' }]
  },
  marketCrown: {
    id: 'marketCrown',
    name: 'Veyr Market Crown',
    seed: 'Veyr-Market-Crown',
    difficultyId: 'standard',
    text: 'A coin-rich start that can rush trade, cavalry, or mercantile pressure at a morale cost.',
    resourceDelta: { gold: 36, food: -8, influence: -1, morale: -1 }
  },
  ashgate: {
    id: 'ashgate',
    name: 'Ash Gate Frontier',
    seed: 'Ash-Gate-Frontier',
    difficultyId: 'legion',
    text: 'A harder siege-forward start with more iron and stone, less morale, and faster eastern pressure.',
    resourceDelta: { iron: 12, stone: 12, morale: -1 }
  }
};

export const FACTIONS = contentTables.factions;
export const TERRAIN = contentTables.terrain;
export const UNIT_TYPES = contentTables.units;
export const BUILDING_TYPES = contentTables.buildings;

export const STARTING_RESOURCES = {
  food: 80,
  wood: 70,
  stone: 20,
  iron: 25,
  gold: 55,
  influence: 3,
  morale: 8,
  dread: 0
};

export const RESOURCE_NAMES = {
  food: 'Food', wood: 'Wood', stone: 'Stone', iron: 'Iron', gold: 'Gold', influence: 'Influence', morale: 'Morale', dread: 'Dread'
};

export const DIPLOMACY_ACTIONS = {
  pact: { name: 'Offer Survival Pact', cost: { influence: 2 }, relation: 18, text: 'Spend influence to create shared vision and occasional military aid.' },
  trade: { name: 'Open Trade', cost: { influence: 1, gold: 12 }, relation: 10, text: 'Gain steady gold and improve relations.' },
  aid: { name: 'Request War Aid', cost: { influence: 1 }, relation: -4, text: 'Ask a discovered civilization for units or supplies.' },
  pressure: { name: 'Pressure Them', cost: { morale: 1 }, relation: -18, text: 'Try to extract resources quickly at a diplomatic cost.' }
};

export const DIPLOMATIC_PROMISES = {
  dawnWallGuard: {
    id: 'dawnWallGuard',
    factionId: 'dawn',
    name: 'Promise Wall Guard',
    cost: { wood: 14, influence: 1 },
    relation: 7,
    memory: 2,
    text: 'Send timber, engineers, and oath-guards to strengthen Dawnward walls before the dead reach them.',
    preview: 'Dawnward holdings gain durability, relations improve, and the ledger records a kept wall oath.',
    demand: {
      id: 'dawnWallWatch',
      delay: 3,
      name: 'Maintain the Wall Watch',
      cost: { stone: 10, gold: 8 },
      relation: 6,
      memory: 2,
      text: 'Dawnward captains ask Olundar to keep the promised wall guard supplied as raids gather below the hillforts.',
      preview: 'Answering reinforces Dawnward holdings again; ignoring creates a wall-oath grievance.'
    }
  },
  veyrCaravanFund: {
    id: 'veyrCaravanFund',
    factionId: 'veyr',
    name: 'Fund War Caravans',
    cost: { gold: 22, wood: 6 },
    relation: 7,
    memory: 2,
    text: 'Underwrite Veyr wagons, escorts, and road bribes so their merchants commit supply to the living front.',
    preview: 'Olundar receives food and iron from the first convoy while Veyr records the funded route.',
    demand: {
      id: 'veyrRouteTolls',
      delay: 3,
      name: 'Pay the Route Tolls',
      cost: { gold: 18, influence: 1 },
      relation: 6,
      memory: 2,
      text: 'Veyr factors demand route tolls and escort bribes before the next war caravan risks the roads.',
      preview: 'Answering brings another supply convoy; ignoring makes Veyr treat the promise as unpaid politics.'
    }
  },
  mireMarshRoutes: {
    id: 'mireMarshRoutes',
    factionId: 'mire',
    name: 'Scout Marsh Routes',
    cost: { food: 10, influence: 1 },
    relation: 7,
    memory: 2,
    text: 'Feed Mireclan guides and swear to respect their marsh routes in exchange for safer scouting paths.',
    preview: 'A Mire route guide joins near Olundar, relations improve, and the ledger records the route oath.',
    demand: {
      id: 'mireGuideStores',
      delay: 3,
      name: 'Feed the Marsh Guides',
      cost: { food: 14, wood: 6 },
      relation: 6,
      memory: 2,
      text: 'Mireclan guides ask for food and dry timber before they keep marking the blight-shadow routes.',
      preview: 'Answering reveals practical route knowledge; ignoring creates a marsh-oath grievance.'
    }
  }
};

export const FIELD_ORDERS = {
  defendRoads: { id: 'defendRoads', name: 'Defend Roads', text: 'Patrol Olundar roads, outposts, and city approaches before pursuing distant targets.' },
  reinforceCapital: { id: 'reinforceCapital', name: 'Reinforce Capital', text: 'Muster pact aid near Olundar Prime when possible.' },
  harassDeadworks: { id: 'harassDeadworks', name: 'Harass Deadworks', text: 'Push toward revealed Deadwalker structures and pressure their expansion.' }
};

export const WAR_AIMS = {
  dawnBulwark: { id: 'dawnBulwark', name: 'Shield the Hillforts', tone: 'good', text: 'Defend Dawnward towers, city approaches, and nearby living holdings before taking wider risks.' },
  veyrRaid: { id: 'veyrRaid', name: 'Raid for Leverage', tone: 'info', text: 'Probe toward Deadwalker works for spoils and bargaining power before committing to any coalition.' },
  mireScout: { id: 'mireScout', name: 'Shadow the Blight', tone: 'info', text: 'Send scouts and bowmen through rough ground to watch the undead front from a safer distance.' },
  rivalClaim: { id: 'rivalClaim', name: 'Press a Rival Claim', tone: 'danger', text: 'Treat Olundar as a rival front and look for exposed holdings despite the undead war.' }
};

export const CRISIS_EVENTS = contentTables.crisisEvents;

export const CRISIS_AFTERMATH_EVENTS = {
  refugeeAftermath: {
    id: 'refugeeAftermath',
    crisisId: 'refugeeCaravan',
    delay: 2,
    name: 'Refugee Aftermath',
    tone: 'info',
    label: 'Aftermath',
    text: 'The earlier refugee ruling now has consequences across homes, roads, and ally courts.',
    choices: [
      { id: 'settleOaths', name: 'Settle Oaths', cost: { food: 10, wood: 8 }, text: 'Turn displaced families into housed workers and road crews.', preview: 'Population and morale rise, and known factions remember the humane settlement.' },
      { id: 'frontierFamilies', name: 'Frontier Families', cost: { influence: 1 }, text: 'Sponsor willing families as frontier scouts and guides.', preview: 'A scout joins near Olundar and living-faction relations improve.' },
      { id: 'ignorePetitions', name: 'Ignore Petitions', cost: {}, text: 'Save supplies now and leave petitions unanswered.', preview: 'Morale falls and known factions record a grievance.' }
    ]
  },
  granaryAftermath: {
    id: 'granaryAftermath',
    crisisId: 'famineStores',
    delay: 2,
    name: 'Granary Aftermath',
    tone: 'danger',
    label: 'Aftermath',
    text: 'The famine ruling echoes through markets, shrines, and hungry work camps.',
    choices: [
      { id: 'openStores', name: 'Open Festival Stores', cost: { food: 16, gold: 8 }, text: 'Stage a public ration festival before hunger turns political.', preview: 'Morale rebounds and old famine resentment softens.' },
      { id: 'grainContract', name: 'Sign Grain Contract', cost: { influence: 1, gold: 12 }, text: 'Bind merchants and allies to a stabilizing grain contract.', preview: 'Known factions gain promise memory and modest relation.' },
      { id: 'hardLabor', name: 'Order Hard Labor', cost: {}, text: 'Use hunger as leverage for emergency timber and repairs.', preview: 'Wood rises, but morale falls and grievances spread.' }
    ]
  },
  raidAftermath: {
    id: 'raidAftermath',
    crisisId: 'cityRaid',
    delay: 2,
    name: 'Raid Aftermath',
    tone: 'danger',
    label: 'Aftermath',
    text: 'The raid warning leaves burned roads, frightened households, and a chance to seize initiative.',
    choices: [
      { id: 'repairStreets', name: 'Repair Streets', cost: { wood: 14, stone: 8 }, text: 'Repair gates, roads, and watch posts before raiders return.', preview: 'Olundar holdings gain durability and morale steadies.' },
      { id: 'huntRaiders', name: 'Hunt Raiders', cost: { iron: 8, gold: 8 }, text: 'Fund a punitive patrol into the dark roads.', preview: 'A cavalry patrol musters if space allows, and influence rises.' },
      { id: 'blameOutskirts', name: 'Blame Outskirts', cost: {}, text: 'Shift blame to frightened outer households to preserve stores.', preview: 'Population and morale fall, and known factions record a grievance.' }
    ]
  },
  councilAftermath: {
    id: 'councilAftermath',
    crisisId: 'emergencyCouncil',
    delay: 2,
    name: 'Council Aftermath',
    tone: 'good',
    label: 'Aftermath',
    text: 'The emergency council expects proof that Olundar will honor what it demanded.',
    choices: [
      { id: 'publishAccords', name: 'Publish Accords', cost: { influence: 2, gold: 10 }, text: 'Publish clear promises to the living front and fund envoys to carry them.', preview: 'Known factions gain relations and promise memory.' },
      { id: 'drillVeterans', name: 'Drill Veterans', cost: { food: 10, iron: 8 }, text: 'Turn council urgency into disciplined battlefield practice.', preview: 'A legionary musters near the capital and morale rises.' },
      { id: 'delayCommitments', name: 'Delay Commitments', cost: {}, text: 'Keep every option open and refuse new promises.', preview: 'Influence is preserved, but known factions record grievances.' }
    ]
  }
};

export const MAP_LENSES = {
  normal: { id: 'normal', name: 'Normal', text: 'Standard terrain, fog, units, and buildings.' },
  blight: { id: 'blight', name: 'Blight', text: 'Highlight revealed grave-blight and known Deadwalker works.' },
  roads: { id: 'roads', name: 'Roads', text: 'Trace revealed military roads and logistics corridors.' },
  supply: { id: 'supply', name: 'Supply', text: 'Show revealed tiles inside Olundar city, outpost, and road supply reach.' },
  alliance: { id: 'alliance', name: 'Alliance', text: 'Show Survival Pact vision and allied positions.' },
  missions: { id: 'missions', name: 'Missions', text: 'Highlight active aftermath mission targets and recently completed field tasks.' }
};

export const OBJECTIVES = [
  'Reveal the eastern wasteland where the Deadwalker portal is hidden.',
  'Build a war economy: farms, wood, iron, barracks, and archers.',
  'Decide which civilizations deserve trust before the undead reach them.',
  'Kill Vorgath the Hollow Crown.',
  'Destroy the Bone Portal to end the invasion.'
];
