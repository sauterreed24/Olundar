import { MAP_HEIGHT, MAP_WIDTH, TERRAIN } from './content.js';

export function makeRng(seedString = 'Olundar') {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedString.length; i += 1) {
    h ^= seedString.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function rng() {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashNoise(x, y, seed = 1) {
  let n = Math.imul(x + seed * 1013, 374761393) + Math.imul(y + seed * 9176, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x, y, seed = 1, scale = 8) {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);
  const a = hashNoise(x0, y0, seed);
  const b = hashNoise(x0 + 1, y0, seed);
  const c = hashNoise(x0, y0 + 1, seed);
  const d = hashNoise(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

export function octaveNoise(x, y, seed = 1) {
  const n1 = valueNoise(x, y, seed, 11);
  const n2 = valueNoise(x, y, seed + 3, 6);
  const n3 = valueNoise(x, y, seed + 7, 3);
  return (n1 * 0.55) + (n2 * 0.3) + (n3 * 0.15);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
}

export function idx(x, y) {
  return y * MAP_WIDTH + x;
}

export function xy(index) {
  return { x: index % MAP_WIDTH, y: Math.floor(index / MAP_WIDTH) };
}

export function neighbors4(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ].filter((p) => inBounds(p.x, p.y));
}

export function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function generateWorld(seed = 'Olundar-01') {
  const grid = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const nx = Math.abs((x / (MAP_WIDTH - 1)) - 0.5) * 2;
      const ny = Math.abs((y / (MAP_HEIGHT - 1)) - 0.5) * 2;
      const continental = 1 - Math.max(nx * 0.75, ny * 0.65);
      const elevation = clamp((octaveNoise(x, y, 5) * 0.72) + (continental * 0.38), 0, 1);
      const moisture = octaveNoise(x + 50, y - 20, 13);
      let terrain = 'plains';
      if (elevation < 0.24) terrain = 'river';
      else if (elevation > 0.79) terrain = 'mountains';
      else if (elevation > 0.64) terrain = 'hills';
      else if (moisture > 0.67) terrain = 'forest';
      else if (moisture > 0.56 && elevation < 0.42) terrain = 'marsh';
      grid.push({
        x, y,
        terrain,
        baseTerrain: terrain,
        elevation: Number(elevation.toFixed(3)),
        moisture: Number(moisture.toFixed(3)),
        blight: 0,
        road: false,
        rumor: null
      });
    }
  }

  carveRiver(grid, seed);
  stampKnownRegions(grid);
  scatterRuins(grid, seed);
  carveStrategicCorridors(grid);
  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles: grid };
}

function carveRiver(grid, seed) {
  const rng = makeRng(`${seed}-river`);
  let x = 9 + Math.floor(rng() * 10);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    x += Math.floor(rng() * 3) - 1;
    x = clamp(x, 3, MAP_WIDTH - 4);
    for (const dx of [-1, 0, 1]) {
      const tx = x + dx;
      if (!inBounds(tx, y)) continue;
      const tile = grid[idx(tx, y)];
      if (tile.terrain !== 'mountains') {
        tile.terrain = 'river';
        tile.baseTerrain = 'river';
        tile.elevation = Math.min(tile.elevation, 0.28);
      }
    }
  }
}

function stampKnownRegions(grid) {
  const stamps = [
    { x: 7, y: 16, radius: 4, terrain: 'plains' },
    { x: 12, y: 18, radius: 2, terrain: 'forest' },
    { x: 14, y: 5, radius: 3, terrain: 'hills' },
    { x: 28, y: 20, radius: 3, terrain: 'plains' },
    { x: 35, y: 24, radius: 3, terrain: 'marsh' },
    { x: 38, y: 7, radius: 4, terrain: 'blight' }
  ];
  for (const stamp of stamps) {
    for (let y = stamp.y - stamp.radius; y <= stamp.y + stamp.radius; y += 1) {
      for (let x = stamp.x - stamp.radius; x <= stamp.x + stamp.radius; x += 1) {
        if (!inBounds(x, y)) continue;
        const d = manhattan(x, y, stamp.x, stamp.y);
        if (d <= stamp.radius) {
          const tile = grid[idx(x, y)];
          tile.terrain = stamp.terrain;
          tile.baseTerrain = stamp.terrain === 'blight' ? 'plains' : stamp.terrain;
          tile.blight = stamp.terrain === 'blight' ? 5 - Math.min(d, 4) : tile.blight;
          tile.elevation = stamp.terrain === 'hills' ? Math.max(tile.elevation, 0.62) : Math.min(tile.elevation, 0.55);
        }
      }
    }
  }
  // Keep important settlement tiles passable and legible.
  const safe = [
    [7, 16], [8, 16], [7, 17], [6, 16],
    [14, 5], [28, 20], [35, 24], [38, 7]
  ];
  for (const [x, y] of safe) {
    const tile = grid[idx(x, y)];
    if (tile.terrain === 'mountains' || tile.terrain === 'river') tile.terrain = 'plains';
    tile.baseTerrain = tile.terrain === 'blight' ? 'plains' : tile.terrain;
  }
}

function scatterRuins(grid, seed) {
  const rng = makeRng(`${seed}-ruins`);
  const ruins = [
    { x: 20, y: 9, rumor: 'A cracked road marker says the eastern dead learned to build.' },
    { x: 22, y: 25, rumor: 'Old bronze coins mention a Veyrin debt ledger.' },
    { x: 5, y: 6, rumor: 'A burial stele warns: do not crown the hollow.' },
    { x: 33, y: 12, rumor: 'Sun-priests once sealed a gate with fire and iron.' }
  ];
  while (ruins.length < 8) {
    const x = 4 + Math.floor(rng() * (MAP_WIDTH - 8));
    const y = 3 + Math.floor(rng() * (MAP_HEIGHT - 6));
    if (TERRAIN[grid[idx(x, y)].terrain].passable && manhattan(x, y, 7, 16) > 7) {
      ruins.push({ x, y, rumor: 'Weathered stones whisper of wars before the Deadwalkers.' });
    }
  }
  for (const ruin of ruins) {
    const tile = grid[idx(ruin.x, ruin.y)];
    tile.terrain = 'ruins';
    tile.baseTerrain = 'ruins';
    tile.rumor = ruin.rumor;
  }
}

function carveStrategicCorridors(grid) {
  // Ensures the generated terrain never walls off the player from diplomacy or the final portal.
  const routes = [
    [[7, 16], [14, 5], [20, 9], [28, 20], [38, 7]],
    [[7, 16], [12, 18], [22, 25], [35, 24], [38, 7]]
  ];
  for (const route of routes) {
    for (let i = 1; i < route.length; i += 1) {
      carveLine(grid, route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]);
    }
  }
}

function carveLine(grid, x0, y0, x1, y1) {
  let x = x0;
  let y = y0;
  while (x !== x1 || y !== y1) {
    const tile = grid[idx(x, y)];
    if (tile.terrain === 'mountains' || tile.terrain === 'river') tile.terrain = tile.blight > 0 ? 'blight' : 'plains';
    tile.road = true;
    if (x !== x1) x += Math.sign(x1 - x);
    if (y !== y1 && (Math.abs(y1 - y) > Math.abs(x1 - x) || x === x1)) y += Math.sign(y1 - y);
  }
  const end = grid[idx(x1, y1)];
  if (end.terrain === 'mountains' || end.terrain === 'river') end.terrain = end.blight > 0 ? 'blight' : 'plains';
  end.road = true;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
