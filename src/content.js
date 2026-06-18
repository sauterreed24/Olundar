export const MAP_WIDTH = 44;
export const MAP_HEIGHT = 30;
export const CURRENT_SAVE_VERSION = 1;

export const FACTIONS = {
  olundar: {
    id: 'olundar',
    name: 'Olundar',
    adjective: 'Olundaran',
    temperament: 'resolute',
    banner: '☀',
    player: true,
    color: '#f0c866',
    text: 'A disciplined river-valley civilization with citizen legions, practical engineers, and a stubborn belief that the living world can still unite.',
    strengths: ['Balanced infantry', 'Fast construction', 'High morale near cities'],
    weaknesses: ['Limited early cavalry', 'Must manage diplomacy carefully']
  },
  dawn: {
    id: 'dawn',
    name: 'Dawnward League',
    adjective: 'Dawnward',
    temperament: 'honorable',
    banner: '⚜',
    color: '#88b7ff',
    text: 'Hill-fort republics that prize oaths, walls, and anti-undead warfare.',
    strengths: ['Defensive aid', 'Strong spear guards', 'Reliable alliance once trusted'],
    weaknesses: ['Slow expansion', 'Reluctant to join reckless offensives']
  },
  veyr: {
    id: 'veyr',
    name: 'Veyr Dominion',
    adjective: 'Veyrin',
    temperament: 'opportunistic',
    banner: '◇',
    color: '#c48cff',
    text: 'Merchant-princes and ambitious generals who see disaster as a market.',
    strengths: ['Gold income', 'Cavalry', 'Can broker supplies'],
    weaknesses: ['Selfish diplomacy', 'May defect if neglected']
  },
  mire: {
    id: 'mire',
    name: 'Mireclan Holds',
    adjective: 'Mireclan',
    temperament: 'suspicious',
    banner: '⬟',
    color: '#72c66e',
    text: 'Bog-fort clans skilled at ambushes, scouts, and poison marsh survival.',
    strengths: ['Scouts', 'Marsh movement', 'Cheap archers'],
    weaknesses: ['Poor open-field battles', 'Distrustful until helped']
  },
  dead: {
    id: 'dead',
    name: 'Deadwalkers',
    adjective: 'Deadwalker',
    temperament: 'annihilating',
    banner: '☠',
    color: '#91e88b',
    text: 'A skeleton empire pouring from a bone portal under a lich-warlord. They spread grave-blight and replace living settlements with necropolises.',
    strengths: ['Free reinforcements', 'Blight expansion', 'Fearless attrition'],
    weaknesses: ['Predictable hatred of life', 'Portal defeat ends the invasion']
  }
};

export const TERRAIN = {
  plains: {
    id: 'plains', name: 'Plains', glyph: '·', move: 1, defense: 0, sight: 0,
    passable: true, buildable: true, food: 2, wood: 0, stone: 0, iron: 0,
    tactical: 'Fast movement and strong food. Good for farms and roads.'
  },
  forest: {
    id: 'forest', name: 'Forest', glyph: '♣', move: 2, defense: 1, sight: -1,
    passable: true, buildable: true, food: 1, wood: 2, stone: 0, iron: 0,
    tactical: 'Slows armies, hides scouts, improves defense, and fuels construction.'
  },
  hills: {
    id: 'hills', name: 'Hills', glyph: '∩', move: 2, defense: 1, sight: 1,
    passable: true, buildable: true, food: 1, wood: 0, stone: 1, iron: 1,
    tactical: 'Harder to cross but excellent for watchtowers, mines, archers, and vision.'
  },
  mountains: {
    id: 'mountains', name: 'Mountains', glyph: '▲', move: 99, defense: 2, sight: 2,
    passable: false, buildable: false, food: 0, wood: 0, stone: 3, iron: 2,
    tactical: 'Blocks movement and line planning. Controls chokepoints.'
  },
  river: {
    id: 'river', name: 'River', glyph: '≈', move: 2, defense: -1, sight: 0,
    passable: true, buildable: false, food: 2, wood: 0, stone: 0, iron: 0,
    tactical: 'Crossing costs movement and weakens defenders, but river valleys are fertile.'
  },
  marsh: {
    id: 'marsh', name: 'Marsh', glyph: '≋', move: 3, defense: 0, sight: -1,
    passable: true, buildable: true, food: 1, wood: 1, stone: 0, iron: 0,
    tactical: 'Punishes heavy armies. Mireclan units ignore part of the movement cost.'
  },
  ruins: {
    id: 'ruins', name: 'Ancient Ruins', glyph: '¤', move: 1, defense: 1, sight: 0,
    passable: true, buildable: true, food: 0, wood: 0, stone: 1, iron: 0,
    tactical: 'Can be surveyed for relics, influence, and rumors.'
  },
  blight: {
    id: 'blight', name: 'Grave-blight', glyph: '✶', move: 2, defense: 0, sight: -1,
    passable: true, buildable: false, food: -1, wood: 0, stone: 0, iron: 0,
    tactical: 'Deadwalkers regenerate here. Living units suffer attrition if stranded.'
  }
};

export const UNIT_TYPES = {
  scout: {
    id: 'scout', name: 'Pathfinder Scout', role: 'Recon', faction: 'living', glyph: 'S',
    hp: 8, attack: 2, range: 1, move: 4, sight: 5, armor: 0, upkeep: { food: 1 },
    cost: { food: 8, wood: 4, gold: 4 }, trainTurns: 2,
    requires: ['city'], tags: ['recon', 'light'],
    text: 'Fast explorer. Reveals fog, surveys ruins, and can slip through forests.'
  },
  legionary: {
    id: 'legionary', name: 'Shield Legionary', role: 'Infantry', faction: 'living', glyph: 'L',
    hp: 16, attack: 5, range: 1, move: 2, sight: 3, armor: 2, upkeep: { food: 1, gold: 1 },
    cost: { food: 18, wood: 6, iron: 8, gold: 6 }, trainTurns: 3,
    requires: ['barracks'], tags: ['line', 'shield'],
    text: 'Reliable sword-and-shield core that holds formation around cities and roads.'
  },
  spearGuard: {
    id: 'spearGuard', name: 'Spear Guard', role: 'Anti-cavalry', faction: 'living', glyph: 'P',
    hp: 15, attack: 4, range: 1, move: 2, sight: 3, armor: 2, upkeep: { food: 1 },
    cost: { food: 16, wood: 10, iron: 4, gold: 4 }, trainTurns: 2,
    requires: ['barracks'], tags: ['line', 'spear'],
    text: 'Cheap disciplined defensive unit. Strong when guarding chokepoints.'
  },
  archer: {
    id: 'archer', name: 'Olundaran Archer', role: 'Ranged', faction: 'living', glyph: 'A',
    hp: 10, attack: 4, range: 3, move: 2, sight: 4, armor: 0, upkeep: { food: 1, wood: 1 },
    cost: { food: 12, wood: 14, gold: 5 }, trainTurns: 3,
    requires: ['archeryYard'], tags: ['ranged', 'wood'],
    text: 'Ranged pressure. Hills and walls make them dangerous.'
  },
  cavalry: {
    id: 'cavalry', name: 'Equite Cavalry', role: 'Flanker', faction: 'living', glyph: 'C',
    hp: 14, attack: 5, range: 1, move: 4, sight: 4, armor: 1, upkeep: { food: 2, gold: 1 },
    cost: { food: 22, wood: 8, iron: 8, gold: 16 }, trainTurns: 4,
    requires: ['stable'], tags: ['mounted', 'fast'],
    text: 'Fast strike unit for saving allies, raiding bone pits, and closing on archers.'
  },
  engineer: {
    id: 'engineer', name: 'Field Engineer', role: 'Builder', faction: 'living', glyph: 'E',
    hp: 9, attack: 1, range: 1, move: 2, sight: 3, armor: 0, upkeep: { food: 1 },
    cost: { food: 10, wood: 8, gold: 6 }, trainTurns: 2,
    requires: ['city'], tags: ['builder'],
    text: 'Builds roads, outposts, camps, walls, and siege infrastructure.'
  },
  onager: {
    id: 'onager', name: 'Onager Crew', role: 'Siege', faction: 'living', glyph: 'O',
    hp: 12, attack: 8, range: 2, move: 1, sight: 3, armor: 0, upkeep: { food: 1, wood: 1, gold: 1 },
    cost: { food: 18, wood: 28, iron: 14, gold: 18 }, trainTurns: 5,
    requires: ['workshop'], tags: ['siege', 'slow'],
    text: 'Slow artillery that cracks necropolises, gates, and the Deadwalker portal.'
  },
  boneThrall: {
    id: 'boneThrall', name: 'Bone Thrall', role: 'Undead mob', faction: 'dead', glyph: 'b',
    hp: 8, attack: 3, range: 1, move: 2, sight: 3, armor: 0, upkeep: {},
    cost: {}, trainTurns: 1, requires: ['bonePit'], tags: ['undead', 'swarm'],
    text: 'Cheap skeletons that appear in numbers and regenerate on blight.'
  },
  corpseArcher: {
    id: 'corpseArcher', name: 'Corpse Archer', role: 'Undead ranged', faction: 'dead', glyph: 'r',
    hp: 9, attack: 3, range: 3, move: 2, sight: 4, armor: 0, upkeep: {},
    cost: {}, trainTurns: 2, requires: ['graveForge'], tags: ['undead', 'ranged'],
    text: 'Bleached archers that punish unsupported infantry.'
  },
  graveKnight: {
    id: 'graveKnight', name: 'Grave Knight', role: 'Undead elite', faction: 'dead', glyph: 'k',
    hp: 18, attack: 6, range: 1, move: 2, sight: 3, armor: 2, upkeep: {},
    cost: {}, trainTurns: 3, requires: ['necropolis'], tags: ['undead', 'elite'],
    text: 'Armored dead champions that anchor Deadwalker assaults.'
  },
  lichBoss: {
    id: 'lichBoss', name: 'Vorgath the Hollow Crown', role: 'Boss', faction: 'dead', glyph: 'V',
    hp: 42, attack: 8, range: 2, move: 1, sight: 5, armor: 2, upkeep: {},
    cost: {}, trainTurns: 99, requires: ['portal'], tags: ['undead', 'boss'],
    text: 'The central Deadwalker commander. Slay Vorgath and destroy the portal to end the war.'
  }
};

export const BUILDING_TYPES = {
  city: {
    id: 'city', name: 'City Center', glyph: '⌂', hp: 60, vision: 4, buildTurns: 0,
    cost: {}, buildableBy: [], trains: ['scout', 'engineer'], income: { food: 6, wood: 2, gold: 5, influence: 1 },
    text: 'Seat of Olundar. Produces scouts and engineers, stores population, and projects vision.'
  },
  farm: {
    id: 'farm', name: 'Terraced Farm', glyph: '▦', hp: 18, vision: 1, buildTurns: 2,
    cost: { wood: 10, gold: 2 }, buildableBy: ['engineer'], trains: [], income: { food: 8 },
    text: 'Reliable food, best on plains and near rivers. Keeps armies supplied without tedium.'
  },
  lumberCamp: {
    id: 'lumberCamp', name: 'Lumber Camp', glyph: '♜', hp: 18, vision: 1, buildTurns: 2,
    cost: { wood: 4, gold: 2 }, buildableBy: ['engineer'], trains: [], income: { wood: 8 },
    text: 'Harvests forest resources for buildings, bows, roads, and siege machines.'
  },
  mine: {
    id: 'mine', name: 'Hill Mine', glyph: '◆', hp: 20, vision: 1, buildTurns: 3,
    cost: { wood: 12, gold: 6 }, buildableBy: ['engineer'], trains: [], income: { iron: 6, gold: 2 },
    text: 'Produces iron and coin from hills or ruins. Fuels legionaries and siege.'
  },
  barracks: {
    id: 'barracks', name: 'Legion Barracks', glyph: '▣', hp: 32, vision: 2, buildTurns: 3,
    cost: { wood: 24, iron: 6, gold: 10 }, buildableBy: ['engineer'], trains: ['legionary', 'spearGuard'], income: {},
    text: 'Trains line infantry. A must-have before Deadwalker pressure reaches the capital.'
  },
  archeryYard: {
    id: 'archeryYard', name: 'Archery Yard', glyph: '∴', hp: 26, vision: 2, buildTurns: 3,
    cost: { wood: 28, gold: 8 }, buildableBy: ['engineer'], trains: ['archer'], income: {},
    text: 'Trains archers. Place near hills or walls for killing zones.'
  },
  stable: {
    id: 'stable', name: 'Equite Stable', glyph: '♞', hp: 28, vision: 2, buildTurns: 4,
    cost: { wood: 30, food: 10, gold: 18 }, buildableBy: ['engineer'], trains: ['cavalry'], income: {},
    text: 'Trains cavalry for rapid response, raids, and saving distant allies.'
  },
  workshop: {
    id: 'workshop', name: 'Siege Workshop', glyph: '⚙', hp: 30, vision: 2, buildTurns: 4,
    cost: { wood: 36, iron: 14, gold: 18 }, buildableBy: ['engineer'], trains: ['onager'], income: {},
    text: 'Builds onagers for destroying necropolises and the portal.'
  },
  watchtower: {
    id: 'watchtower', name: 'Signal Watchtower', glyph: '◬', hp: 24, vision: 6, buildTurns: 2,
    cost: { wood: 18, stone: 4, gold: 6 }, buildableBy: ['engineer'], trains: [], income: {},
    text: 'Projects fog-breaking vision. Hills increase its strategic value.'
  },
  wall: {
    id: 'wall', name: 'Stone Wall', glyph: '▓', hp: 36, vision: 1, buildTurns: 2,
    cost: { stone: 12, wood: 4 }, buildableBy: ['engineer'], trains: [], income: {},
    text: 'Blocks enemy advances and turns chokepoints into kill boxes.'
  },
  road: {
    id: 'road', name: 'Military Road', glyph: '═', hp: 10, vision: 0, buildTurns: 1,
    cost: { wood: 4, stone: 2 }, buildableBy: ['engineer'], trains: [], income: { gold: 1 },
    text: 'Improves logistics. Units moving from road to road get cheaper movement.'
  },
  shrine: {
    id: 'shrine', name: 'Sun Shrine', glyph: '☉', hp: 26, vision: 2, buildTurns: 3,
    cost: { stone: 12, gold: 14, influence: 1 }, buildableBy: ['engineer'], trains: [], income: { influence: 2, morale: 1 },
    text: 'Boosts influence and morale. Living units nearby resist grave-blight attrition.'
  },
  outpost: {
    id: 'outpost', name: 'Frontier Outpost', glyph: '◇', hp: 34, vision: 4, buildTurns: 3,
    cost: { wood: 22, stone: 6, gold: 8 }, buildableBy: ['engineer'], trains: ['scout', 'spearGuard'], income: { gold: 2 },
    text: 'Forward base for exploration and emergency defense.'
  },
  portal: {
    id: 'portal', name: 'Bone Portal', glyph: '◎', hp: 90, vision: 6, buildTurns: 0,
    cost: {}, buildableBy: [], trains: ['boneThrall', 'corpseArcher', 'graveKnight'], income: { dread: 5 },
    text: 'The invasion source. Destroy it after killing the Hollow Crown to win.'
  },
  bonePit: {
    id: 'bonePit', name: 'Bone Pit', glyph: '☉', hp: 26, vision: 3, buildTurns: 0,
    cost: {}, buildableBy: [], trains: ['boneThrall'], income: { dread: 2 },
    text: 'Spawns Bone Thralls and spreads grave-blight.'
  },
  graveForge: {
    id: 'graveForge', name: 'Grave Forge', glyph: '♨', hp: 34, vision: 3, buildTurns: 0,
    cost: {}, buildableBy: [], trains: ['corpseArcher', 'graveKnight'], income: { dread: 3 },
    text: 'Deadwalker military workshop for ranged and armored undead.'
  },
  necropolis: {
    id: 'necropolis', name: 'Necropolis', glyph: '▥', hp: 48, vision: 4, buildTurns: 0,
    cost: {}, buildableBy: [], trains: ['boneThrall', 'corpseArcher', 'graveKnight'], income: { dread: 4 },
    text: 'A captured or grown undead city. It expands the Deadwalker civilization.'
  }
};

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

export const OBJECTIVES = [
  'Reveal the eastern wasteland where the Deadwalker portal is hidden.',
  'Build a war economy: farms, wood, iron, barracks, and archers.',
  'Decide which civilizations deserve trust before the undead reach them.',
  'Kill Vorgath the Hollow Crown.',
  'Destroy the Bone Portal to end the invasion.'
];
