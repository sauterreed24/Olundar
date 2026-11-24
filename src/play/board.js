/**
 * Square tactical board.
 * Terrain is painted once into a cache. Hover and selection repaint only the piece layer.
 * Ground, features, then y-sorted buildings and units, so the map reads back-to-front.
 */

import { BUILDING_TYPES, FACTIONS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from '../content.js';
import { inBounds, neighbors4 } from '../map.js';
import {
  canBuildOn,
  canEnter,
  effectiveMoveRange,
  forecastBuildingAttack,
  forecastUnitAttack,
  getMarchAssaultVectors,
  getDeadwalkerCampaign,
  getWarCouncil,
  isEnemy,
  isRevealed,
  isVisible,
  incomeForBuilding,
  moveCostFor,
  olundarCompany,
  tileAt
} from '../rules.js';

const TERRAIN_INK = {
  plains: ['#b7c85a', '#e4f0a4', '#6f8a2e'],
  forest: ['#2f6b34', '#5a9a48', '#1a4020'],
  hills: ['#c9924a', '#efd09a', '#8a5a28'],
  mountains: ['#8e9ba2', '#e7eef0', '#5c6a72'],
  river: ['#2a86b4', '#b7e6f8', '#165e86'],
  marsh: ['#6e8a40', '#c5d67a', '#3e5424'],
  ruins: ['#cbb892', '#f3e6cc', '#8d7350'],
  blight: ['#4a3c5e', '#8d7aa8', '#2a2038']
};

const MATERIAL_SPEC = {
  plains: { base: '#b7c85a', dark: '#6f8a2e', light: '#e7f2ae', deep: '#4f6a22', grain: 'grass' },
  forest: { base: '#2c6434', dark: '#17381e', light: '#4e8a42', deep: '#102616', grain: 'grass' },
  hills: { base: '#c9924a', dark: '#8a5a28', light: '#f0d2a0', deep: '#6a4018', grain: 'grass' },
  mountains: { base: '#8e9ba2', dark: '#5c6a72', light: '#e7eef0', deep: '#3e4a50', grain: 'rock' },
  river: { base: '#2a86b4', dark: '#165e86', light: '#c5ecfa', deep: '#0e4668', grain: 'water' },
  marsh: { base: '#6e8a40', dark: '#3e5424', light: '#c5d67a', deep: '#2c3e1c', grain: 'mud' },
  ruins: { base: '#cbb892', dark: '#8d7350', light: '#f3e6cc', deep: '#6e5a3c', grain: 'dust' },
  blight: { base: '#4a3c5e', dark: '#2a2038', light: '#8d7aa8', deep: '#1a1424', grain: 'crack' },
  fog: { base: '#8d7356', dark: '#6d5842', light: '#e7d3b0', deep: '#5c4634', grain: 'vellum' }
};

const FACTION_INK = Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction.id, faction.color || '#f0c866']));
export const UNIT_SPRITE_ORDER = ['scout', 'legionary', 'spearGuard', 'archer', 'cavalry', 'engineer', 'onager', 'boneThrall', 'corpseArcher', 'graveKnight', 'lichBoss'];
const SPRITE_CELL = { width: 384, height: 512 };
const SPRITE_FOOT = 502 / 512;
const SPRITE_URL = new URL('../../assets/sprites/unit-atlas.png', import.meta.url);
const BUILDING_URL = new URL('../../assets/sprites/building-atlas.png', import.meta.url);
const TREE_URL = new URL('../../assets/sprites/prop-tree.png', import.meta.url);
const PEAK_URL = new URL('../../assets/sprites/prop-peak.png', import.meta.url);
export const BUILDING_SPRITE_ORDER = ['city', 'farm', 'lumberCamp', 'mine', 'barracks', 'archeryYard', 'stable', 'workshop', 'watchtower', 'wall', 'shrine', 'rallyBanner', 'outpost', 'portal', 'bonePit', 'graveForge', 'necropolis'];
const BUILDING_CELL = { width: 400, height: 400 };
const BUILDING_FOOT = 392 / 400;
const MATERIAL_SIZE = 192;
const TERRAIN_PHOTO_KINDS = ['plains', 'forest', 'hills', 'mountains', 'river', 'marsh', 'ruins', 'blight'];

let unitAtlas = null;
let unitAtlasReady = false;
let buildingAtlas = null;
let buildingAtlasReady = false;
let propTree = null;
let propPeak = null;
const terrainPhotos = {};
let artEpoch = 0;
let materialSet = null;
const motions = [];
const facing = new Map();
let frameNow = 0;
let rafId = 0;
let repaint = null;
let idleOn = false;

function trimFringe(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const width = canvas.width;
  const height = canvas.height;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = px[i * 4 + 3];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] < 20) continue;
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1
        || alpha[index - 1] < 16
        || alpha[index + 1] < 16
        || (y > 0 && alpha[index - width] < 16)
        || (y < height - 1 && alpha[index + width] < 16);
      if (!edge) continue;
      const offset = index * 4;
      const r = px[offset];
      const g = px[offset + 1];
      const b = px[offset + 2];
      const min = Math.min(r, g, b);
      const max = Math.max(r, g, b);
      if (min > 188 && max - min < 32) px[offset + 3] = 0;
      else {
        px[offset] = Math.round(r * 0.78);
        px[offset + 1] = Math.round(g * 0.76);
        px[offset + 2] = Math.round(b * 0.7);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url.href;
  });
}

export function loadUnitSprites() {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  if (unitAtlasReady && buildingAtlasReady) return Promise.resolve(true);
  const terrainJobs = TERRAIN_PHOTO_KINDS.map((kind) => loadImage(new URL(`../../assets/sprites/terrain/${kind}.png`, import.meta.url)).then((image) => {
    if (image) terrainPhotos[kind] = image;
  }));
  return Promise.all([
    loadImage(SPRITE_URL).then((image) => {
      if (image) {
        unitAtlas = trimFringe(image);
        unitAtlasReady = true;
      }
    }),
    loadImage(BUILDING_URL).then((image) => {
      if (image) {
        buildingAtlas = trimFringe(image);
        buildingAtlasReady = true;
      }
    }),
    loadImage(TREE_URL).then((image) => {
      if (image) propTree = trimFringe(image);
    }),
    loadImage(PEAK_URL).then((image) => {
      if (image) propPeak = trimFringe(image);
    }),
    ...terrainJobs
  ]).then(() => {
    materialSet = null;
    artEpoch += 1;
    return unitAtlasReady;
  });
}

export function movementField(state, unit) {
  if (!unit || unit.hasActed) return new Map();
  const range = effectiveMoveRange(state, unit);
  const costs = new Map([[key(unit.x, unit.y), 0]]);
  const queue = [{ x: unit.x, y: unit.y, cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    for (const next of neighbors4(current.x, current.y)) {
      if (!canEnter(state, unit, next.x, next.y)) continue;
      const step = moveCostFor(state, unit, next.x, next.y, current);
      const cost = current.cost + step;
      if (cost > range) continue;
      const id = key(next.x, next.y);
      if (costs.has(id) && costs.get(id) <= cost) continue;
      costs.set(id, cost);
      queue.push({ x: next.x, y: next.y, cost });
    }
  }
  costs.delete(key(unit.x, unit.y));
  return costs;
}

export function createBoard(canvas) {
  const terrain = document.createElement('canvas');
  const pieces = document.createElement('canvas');
  const view = {
    canvas,
    terrain,
    pieces,
    camX: 0,
    camY: 0,
    tile: 48,
    cacheKey: '',
    fieldKey: '',
    field: new Map(),
    buildKey: '',
    buildSites: new Set()
  };

  function resize() {
    const width = Math.max(320, canvas.clientWidth || 960);
    const height = Math.max(240, canvas.clientHeight || 640);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const surface of [canvas, terrain, pieces]) {
      surface.width = Math.floor(width * dpr);
      surface.height = Math.floor(height * dpr);
    }
    view.tile = Math.max(42, Math.min(78, Math.floor(Math.min(width / 16, height / 11))));
    view.cacheKey = '';
  }

  function layout() {
    const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
    return {
      dpr,
      tile: view.tile * dpr,
      camX: view.camX,
      camY: view.camY,
      cols: Math.ceil(canvas.width / Math.max(1, view.tile * dpr)) + 1,
      rows: Math.ceil(canvas.height / Math.max(1, view.tile * dpr)) + 1
    };
  }

  function focus(x, y) {
    const cols = canvas.clientWidth / view.tile;
    const rows = canvas.clientHeight / view.tile;
    view.camX = clamp(x - cols / 2 + 0.5, 0, Math.max(0, MAP_WIDTH - cols));
    view.camY = clamp(y - rows / 2 + 0.5, 0, Math.max(0, MAP_HEIGHT - rows));
    view.cacheKey = '';
    return layout();
  }

  function pan(dxTiles, dyTiles) {
    const cols = canvas.clientWidth / view.tile;
    const rows = canvas.clientHeight / view.tile;
    view.camX = clamp(view.camX + dxTiles, 0, Math.max(0, MAP_WIDTH - cols));
    view.camY = clamp(view.camY + dyTiles, 0, Math.max(0, MAP_HEIGHT - rows));
    view.cacheKey = '';
  }

  function panByPixels(dx, dy) {
    pan(-dx / view.tile, -dy / view.tile);
  }

  function ensureVisible(x, y) {
    const cols = canvas.clientWidth / view.tile;
    const rows = canvas.clientHeight / view.tile;
    const margin = 1.35;
    let camX = view.camX;
    let camY = view.camY;
    if (x < camX + margin) camX = x - margin;
    else if (x > camX + cols - margin) camX = x - (cols - margin);
    if (y < camY + margin) camY = y - margin;
    else if (y > camY + rows - margin) camY = y - (rows - margin);
    camX = clamp(camX, 0, Math.max(0, MAP_WIDTH - cols));
    camY = clamp(camY, 0, Math.max(0, MAP_HEIGHT - rows));
    if (camX === view.camX && camY === view.camY) return;
    view.camX = camX;
    view.camY = camY;
    view.cacheKey = '';
  }

  function tileAtPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = view.camX + (clientX - rect.left) / view.tile;
    const y = view.camY + (clientY - rect.top) / view.tile;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return inBounds(tx, ty) ? { x: tx, y: ty } : null;
  }

  function minimapAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = layout();
    const box = minimapBox(canvas.width, frame);
    const px = (clientX - rect.left) * frame.dpr;
    const py = (clientY - rect.top) * frame.dpr;
    if (px < box.x0 || py < box.y0 || px >= box.x0 + box.width || py >= box.y0 + box.height) return null;
    const tx = Math.floor((px - box.x0) / box.scale);
    const ty = Math.floor((py - box.y0) / box.scale);
    return inBounds(tx, ty) ? { x: tx, y: ty } : null;
  }

  function ensureField(state, unit) {
    const id = unit ? `${unit.id}:${unit.x},${unit.y}:${unit.hasActed}:${state.turn}` : '';
    if (id !== view.fieldKey) {
      view.fieldKey = id;
      view.field = unit && unit.faction === 'olundar' && !unit.hasActed ? movementField(state, unit) : new Map();
    }
    return view.field;
  }

  function ensureBuildSites(state, buildingType, builder) {
    const id = buildingType && builder
      ? `${buildingType}:${builder.id}:${builder.x},${builder.y}:${builder.hasActed}:${state.turn}:${state.buildings.length}`
      : '';
    if (id !== view.buildKey) {
      view.buildKey = id;
      view.buildSites = new Set(legalBuildTiles(state, buildingType, builder));
    }
    return view.buildSites;
  }

  function paint(state, { hover = null, selectedUnitId = null, selectedBuildingId = null, buildType = null } = {}) {
    const frame = layout();
    const selectedUnit = state.units.find((unit) => unit.id === selectedUnitId) || null;
    const field = buildType ? new Map() : ensureField(state, selectedUnit);
    const sites = ensureBuildSites(state, buildType, selectedUnit);
    const seen = state.visible.filter(Boolean).length;
    const terrainKey = `${artEpoch}|${frame.tile}|${view.camX.toFixed(2)}|${view.camY.toFixed(2)}|${state.turn}|${state.revealed.filter(Boolean).length}|${seen}|${state.buildings.length}`;
    if (terrainKey !== view.cacheKey) {
      view.cacheKey = terrainKey;
      paintTerrain(terrain, state, frame);
    }
    noteIdle(Boolean(selectedUnit && !selectedUnit.hasActed));
    paintPieces(pieces, state, frame, { hover, selectedUnit, selectedBuildingId, field, sites, buildType });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);
    ctx.drawImage(pieces, 0, 0);
    paintVignette(ctx);
    const route = hover && selectedUnit && field.has(`${hover.x},${hover.y}`)
      ? traceMovePath(field, selectedUnit, hover.x, hover.y)
      : [];
    paintMinimap(ctx, state, frame, selectedUnit, field, route, buildType ? sites : null, buildType);
    paintWarClock(ctx, state, frame);
  }

  return {
    resize,
    focus,
    ensureVisible,
    pan,
    panByPixels,
    tileAtPoint,
    minimapAt,
    paint,
    play,
    clearMotion,
    watch,
    movementField: () => view.field,
    buildSites: () => view.buildSites
  };
}

function watch(callback) {
  repaint = callback;
}

function play(motion) {
  if (!motion || reducedMotion()) return;
  motions.push({ ...motion, started: clock() });
  startClock();
}

function clearMotion() {
  motions.length = 0;
}

function noteIdle(active) {
  idleOn = Boolean(active) && !reducedMotion();
  if (idleOn) startClock();
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clock() {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

function startClock() {
  if (rafId || typeof requestAnimationFrame !== 'function') return;
  const step = (time) => {
    frameNow = time;
    for (let index = motions.length - 1; index >= 0; index -= 1) {
      if (time - motions[index].started >= motions[index].duration) motions.splice(index, 1);
    }
    repaint?.();
    if (motions.length || idleOn) rafId = requestAnimationFrame(step);
    else rafId = 0;
  };
  rafId = requestAnimationFrame(step);
}

function activeMotion(unitId, kind) {
  return motions.find((motion) => motion.kind === kind && motion.unitId === unitId) || null;
}

function motionAmount(motion) {
  if (!motion) return 1;
  return Math.max(0, Math.min(1, (frameNow - motion.started) / motion.duration));
}

export function pointOnPath(path, amount) {
  if (!path?.length) return null;
  if (path.length === 1 || amount <= 0) return { x: path[0].x, y: path[0].y };
  const eased = amount < 0.5 ? 2 * amount * amount : 1 - ((-2 * amount + 2) ** 2) / 2;
  if (eased >= 1) return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  const span = path.length - 1;
  const distance = eased * span;
  const index = Math.min(span - 1, Math.floor(distance));
  const local = distance - index;
  return {
    x: path[index].x + (path[index + 1].x - path[index].x) * local,
    y: path[index].y + (path[index + 1].y - path[index].y) * local
  };
}

function spritePlace(unit) {
  const walk = activeMotion(unit.id, 'walk');
  const place = walk ? pointOnPath(walk.path, motionAmount(walk)) : { x: unit.x, y: unit.y };
  const strike = activeMotion(unit.id, 'strike');
  if (strike) {
    const lean = Math.sin(motionAmount(strike) * Math.PI) * 0.22;
    return {
      x: place.x + (strike.tx - unit.x) * lean,
      y: place.y + (strike.ty - unit.y) * lean
    };
  }
  return place || { x: unit.x, y: unit.y };
}

function paintImpacts(ctx, frame) {
  for (const motion of motions) {
    if (motion.kind === 'fall') drawFall(ctx, frame, motion);
    if (motion.kind === 'impact') drawImpact(ctx, frame, motion);
    if (motion.kind === 'damage') drawDamage(ctx, frame, motion);
  }
}

function drawFall(ctx, frame, motion) {
  const amount = motionAmount(motion);
  const rect = tileRectAt(frame, motion.x, motion.y + amount * 0.12);
  ctx.save();
  ctx.globalAlpha = 1 - amount;
  ctx.translate(rect.x, rect.y);
  drawUnitSprite(ctx, { type: motion.type, faction: motion.faction }, rect.s);
  ctx.restore();
}

function drawDamage(ctx, frame, motion) {
  const amount = motionAmount(motion);
  const rect = tileRect(frame, motion.x, motion.y);
  const text = motion.text;
  ctx.save();
  ctx.font = `700 ${Math.max(13, frame.tile * 0.28)}px Palatino, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(3, frame.tile * 0.06);
  ctx.strokeStyle = `rgba(42, 16, 10, ${1 - amount})`;
  ctx.fillStyle = `rgba(255, 236, 196, ${1 - amount})`;
  const x = rect.x + rect.s / 2;
  const y = rect.y + rect.s * (0.42 - amount * 0.36);
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawImpact(ctx, frame, motion) {
  const amount = motionAmount(motion);
  const rect = tileRect(frame, motion.x, motion.y);
  const cx = rect.x + rect.s / 2;
  const cy = rect.y + rect.s * 0.48;
  ctx.save();
  ctx.strokeStyle = `rgba(176, 36, 24, ${1 - amount})`;
  ctx.lineWidth = Math.max(2, rect.s * 0.06);
  ctx.beginPath();
  ctx.arc(cx, cy, rect.s * (0.12 + amount * 0.42), 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 236, 190, ${1 - amount})`;
  ctx.lineWidth = Math.max(2, rect.s * 0.045);
  ctx.beginPath();
  ctx.moveTo(cx - rect.s * 0.28, cy - rect.s * 0.08);
  ctx.lineTo(cx + rect.s * 0.22, cy + rect.s * 0.16);
  ctx.moveTo(cx - rect.s * 0.08, cy + rect.s * 0.24);
  ctx.lineTo(cx + rect.s * 0.26, cy - rect.s * 0.2);
  ctx.stroke();
  ctx.restore();
}

function paintTerrain(surface, state, frame) {
  const ctx = surface.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, surface.width, surface.height);
  const x0 = Math.floor(frame.camX);
  const y0 = Math.floor(frame.camY);
  const x1 = x0 + frame.cols;
  const y1 = y0 + frame.rows;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!inBounds(x, y)) continue;
      const rect = tileRect(frame, x, y);
      if (!isRevealed(state, x, y)) {
        drawFogTile(ctx, rect, x, y, frame);
        continue;
      }
      const tile = tileAt(state, x, y);
      drawTerrainFace(ctx, rect, tile, isVisible(state, x, y), x, y, frame);
      if ((tile.blight || 0) > 0 && tile.terrain !== 'blight') drawBlightSpeck(ctx, rect, tile.blight);
    }
  }
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!inBounds(x, y) || !isRevealed(state, x, y)) continue;
      const tile = tileAt(state, x, y);
      const rect = tileRect(frame, x, y);
      const seen = isVisible(state, x, y);
      drawTerrainFeature(ctx, state, tile, rect, seen, x, y);
      if (tile.road) drawRoad(ctx, state, tile, rect, seen);
      drawKnownEdge(ctx, state, rect, x, y);
      drawSightEdge(ctx, state, rect, x, y);
    }
  }
  paintDaylight(ctx, surface.width, surface.height);
}

function paintPieces(surface, state, frame, { hover, selectedUnit, selectedBuildingId, field, sites, buildType }) {
  const ctx = surface.getContext('2d');
  ctx.clearRect(0, 0, surface.width, surface.height);
  const x0 = Math.floor(frame.camX);
  const y0 = Math.floor(frame.camY);
  const x1 = x0 + frame.cols;
  const y1 = y0 + frame.rows;

  for (const [id, cost] of field) {
    const [x, y] = id.split(',').map(Number);
    if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
    const tile = tileAt(state, x, y);
    const slow = (TERRAIN[tile?.terrain]?.move || 1) > 1;
    const exposed = selectedUnit ? hostsReaching(state, selectedUnit.faction, x, y, selectedUnit.id).length > 0 : false;
    drawMoveMark(ctx, tileRect(frame, x, y), cost, hover?.x === x && hover?.y === y, exposed, slow);
  }
  if (!buildType && field.size) drawRoadGleam(ctx, state, frame, field, x0, y0, x1, y1);
  if (hover && selectedUnit && field.has(`${hover.x},${hover.y}`)) {
    drawMovePath(ctx, frame, traceMovePath(field, selectedUnit, hover.x, hover.y), field);
  }
  if (!buildType) drawReach(ctx, state, frame, selectedUnit, x0, y0, x1, y1);
  if (selectedUnit) drawThreatLines(ctx, frame, visibleThreats(state, selectedUnit), selectedUnit);
  if (buildType) {
    const plans = sitePlans(state, buildType, sites);
    for (const plan of plans.values()) {
      if (plan.x < x0 || plan.y < y0 || plan.x >= x1 || plan.y >= y1 || !isRevealed(state, plan.x, plan.y)) continue;
      const rect = tileRect(frame, plan.x, plan.y);
      drawBrackets(ctx, rect, plan.rich ? 'rgba(226, 177, 90, 0.98)' : 'rgba(88, 158, 78, 0.95)', 0.12);
      if (!(hover && hover.x === plan.x && hover.y === plan.y)) drawSiteChip(ctx, rect, plan.label);
    }
  }
  if (buildType && hover) drawBuildWash(ctx, frame, hover, sites, state);
  paintMarches(ctx, state, frame);
  paintDawn(ctx, frame);
  paintSight(ctx, frame);

  const strike = !buildType && selectedUnit && hover ? hoverStrike(state, selectedUnit, hover.x, hover.y) : null;
  const props = [];
  for (const building of state.buildings) {
    if (building.type === 'road') continue;
    if (building.x < x0 || building.y < y0 || building.x >= x1 || building.y >= y1) continue;
    if (!isRevealed(state, building.x, building.y)) continue;
    props.push({ rank: 0, x: building.x, y: building.y, building });
  }
  for (const unit of state.units) {
    const place = spritePlace(unit);
    if (place.x < x0 - 1 || place.y < y0 - 1 || place.x >= x1 + 1 || place.y >= y1 + 1) continue;
    if (!isVisible(state, unit.x, unit.y) && !activeMotion(unit.id, 'walk')) continue;
    props.push({ rank: 1, x: place.x, y: place.y, unit, place });
  }
  props.sort((a, b) => a.y - b.y || a.x - b.x || a.rank - b.rank);
  const seats = new Map(olundarCompany(state).map((unit, index) => [unit.id, index + 1]));
  for (const prop of props) {
    if (prop.building) {
      const loss = strike && prop.building.x === strike.x && prop.building.y === strike.y ? strike.damage : 0;
      drawBuilding(ctx, frame, prop.building, prop.building.id === selectedBuildingId, isVisible(state, prop.building.x, prop.building.y), loss, musterLabel(prop.building) || yieldLabel(state, prop.building));
    } else {
      const attack = selectedUnit && !selectedUnit.hasActed && isAttackTarget(state, selectedUnit, prop.unit);
      const aim = prop.unit.id === selectedUnit?.id ? hover : null;
      const loss = strike && prop.unit.x === strike.x && prop.unit.y === strike.y ? strike.damage : 0;
      drawUnit(ctx, frame, prop.unit, prop.unit.id === selectedUnit?.id, attack, prop.place, aim, loss, seats.get(prop.unit.id) || 0);
    }
  }
  paintImpacts(ctx, frame);
  if (buildType && hover) drawBuildGhost(ctx, frame, buildType, hover, sites, state);
  if (strike) drawStrikePreview(ctx, frame, selectedUnit, strike);
  if (hover) {
    drawCoverMark(ctx, frame, state, hover);
    drawBrackets(ctx, tileRect(frame, hover.x, hover.y), 'rgba(255, 248, 220, 0.95)', 0.08);
  }
}

function paintDawn(ctx, frame) {
  for (const motion of motions) {
    if (motion.kind !== 'dawn' || !motion.tiles?.length) continue;
    const alpha = 0.5 * (1 - motionAmount(motion));
    if (alpha <= 0.02) continue;
    ctx.fillStyle = `rgba(255, 236, 186, ${alpha})`;
    for (const tile of motion.tiles) {
      const rect = tileRect(frame, tile.x, tile.y);
      ctx.fillRect(rect.x, rect.y, rect.s, rect.s);
    }
  }
}

function paintSight(ctx, frame) {
  for (const motion of motions) {
    if (motion.kind !== 'sight' || !motion.tiles?.length) continue;
    const amount = motionAmount(motion);
    const alpha = 1 - amount;
    if (alpha <= 0.02) continue;
    ctx.strokeStyle = `rgba(176, 42, 32, ${alpha})`;
    ctx.lineWidth = Math.max(2, frame.tile * 0.055);
    for (const tile of motion.tiles) {
      const rect = tileRect(frame, tile.x, tile.y);
      ctx.beginPath();
      ctx.arc(rect.x + rect.s / 2, rect.y + rect.s * 0.46, rect.s * (0.18 + amount * 0.42), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawRoadGleam(ctx, state, frame, field, x0, y0, x1, y1) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 236, 170, 0.95)';
  ctx.lineWidth = Math.max(3, frame.tile * 0.09);
  ctx.shadowColor = 'rgba(255, 196, 70, 0.85)';
  ctx.shadowBlur = Math.max(3, frame.tile * 0.08);
  for (const id of field.keys()) {
    const [x, y] = id.split(',').map(Number);
    if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
    if (!tileAt(state, x, y)?.road) continue;
    const rect = tileRect(frame, x, y);
    const cx = rect.x + rect.s / 2;
    const cy = rect.y + rect.s / 2;
    let linked = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!tileAt(state, x + dx, y + dy)?.road) continue;
      linked = true;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * rect.s * 0.5, cy + dy * rect.s * 0.5);
      ctx.stroke();
    }
    if (!linked) {
      ctx.beginPath();
      ctx.moveTo(cx - rect.s * 0.18, cy);
      ctx.lineTo(cx + rect.s * 0.18, cy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintMarches(ctx, state, frame) {
  const vectors = getMarchAssaultVectors(state).slice(0, 6);
  for (const vector of vectors) {
    const from = tileRect(frame, vector.fromX, vector.fromY);
    const to = tileRect(frame, vector.toX, vector.toY);
    const x1 = from.x + from.s / 2;
    const y1 = from.y + from.s / 2;
    const x2 = to.x + to.s / 2;
    const y2 = to.y + to.s / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(122, 28, 22, 0.82)';
    ctx.lineWidth = Math.max(2, frame.tile * 0.045);
    ctx.setLineDash([frame.tile * 0.16, frame.tile * 0.1]);
    ctx.lineDashOffset = -frameNow / 48;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.save();
    ctx.translate(x2, y2);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(122, 28, 22, 0.92)';
    ctx.beginPath();
    ctx.moveTo(frame.tile * 0.18, 0);
    ctx.lineTo(-frame.tile * 0.08, frame.tile * 0.09);
    ctx.lineTo(-frame.tile * 0.08, -frame.tile * 0.09);
    ctx.fill();
    ctx.restore();
  }
}

function minimapBox(canvasWidth, frame) {
  const scale = Math.max(3, Math.min(5, frame.tile * 0.09));
  const pad = 12 * frame.dpr;
  const width = MAP_WIDTH * scale;
  const height = MAP_HEIGHT * scale;
  return { scale, width, height, x0: canvasWidth - width - pad, y0: pad };
}

function paintMinimap(ctx, state, frame, selectedUnit, field, route = [], sites = null, buildType = null) {
  const box = minimapBox(ctx.canvas.width, frame);
  const { scale, width, height, x0, y0 } = box;
  ctx.save();
  ctx.fillStyle = '#140e0a';
  roundRect(ctx, x0 - 7, y0 - 7, width + 14, height + 14, 3);
  ctx.fill();
  ctx.strokeStyle = '#d7b15a';
  ctx.lineWidth = Math.max(1, frame.dpr);
  ctx.stroke();
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (!isRevealed(state, x, y)) ctx.fillStyle = '#6a5844';
      else {
        const tile = tileAt(state, x, y);
        const ink = TERRAIN_INK[tile.terrain]?.[0] || '#ccc';
        ctx.fillStyle = isVisible(state, x, y) ? ink : shade(ink, 0.62);
      }
      ctx.fillRect(x0 + x * scale, y0 + y * scale, scale + 0.3, scale + 0.3);
    }
  }
  ctx.strokeStyle = '#e0a45a';
  ctx.lineWidth = Math.max(1, scale * 0.45);
  ctx.lineCap = 'round';
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (!isRevealed(state, x, y) || !tileAt(state, x, y)?.road) continue;
      const cx = x0 + (x + 0.5) * scale;
      const cy = y0 + (y + 0.5) * scale;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (!isRevealed(state, x + dx, y + dy) || !tileAt(state, x + dx, y + dy)?.road) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x0 + (x + dx + 0.5) * scale, y0 + (y + dy + 0.5) * scale);
        ctx.stroke();
      }
    }
  }
  if (!sites?.size && selectedUnit && !selectedUnit.hasActed && selectedUnit.faction === 'olundar') {
    const range = UNIT_TYPES[selectedUnit.type]?.range || 1;
    ctx.fillStyle = '#b42318';
    for (let y = selectedUnit.y - range; y <= selectedUnit.y + range; y += 1) {
      for (let x = selectedUnit.x - range; x <= selectedUnit.x + range; x += 1) {
        const distance = Math.abs(x - selectedUnit.x) + Math.abs(y - selectedUnit.y);
        if (distance === 0 || distance > range || !isVisible(state, x, y)) continue;
        ctx.fillRect(x0 + x * scale + scale * 0.28, y0 + y * scale + scale * 0.28, Math.max(1.1, scale * 0.44), Math.max(1.1, scale * 0.44));
      }
    }
  }
  if (buildType && sites?.size) {
    const plans = sitePlans(state, buildType, sites);
    for (const plan of plans.values()) {
      ctx.fillStyle = plan.rich ? '#e2b15a' : '#5c9a4e';
      ctx.fillRect(x0 + plan.x * scale + scale * 0.16, y0 + plan.y * scale + scale * 0.16, Math.max(1.4, scale * 0.68), Math.max(1.4, scale * 0.68));
    }
  }
  if (field?.size) {
    for (const id of field.keys()) {
      const [x, y] = id.split(',').map(Number);
      const slow = (TERRAIN[tileAt(state, x, y)?.terrain]?.move || 1) > 1;
      ctx.fillStyle = slow ? '#c45a2a' : 'rgba(240, 200, 102, 0.85)';
      ctx.fillRect(x0 + x * scale + scale * 0.2, y0 + y * scale + scale * 0.2, Math.max(1.2, scale * 0.6), Math.max(1.2, scale * 0.6));
    }
  }
  for (const building of state.buildings) {
    if (building.type !== 'city' && building.type !== 'portal') continue;
    if (!isRevealed(state, building.x, building.y)) continue;
    ctx.fillStyle = building.faction === 'dead' ? '#d8ff9a' : '#fff6e0';
    ctx.fillRect(x0 + building.x * scale - 0.5, y0 + building.y * scale - 0.5, scale + 1.2, scale + 1.2);
  }
  ctx.strokeStyle = '#e2b15a';
  ctx.lineWidth = Math.max(1, frame.dpr * 0.7);
  for (const building of state.buildings) {
    if (building.turnsLeft <= 0 || building.faction !== 'olundar' || !isRevealed(state, building.x, building.y)) continue;
    ctx.strokeRect(x0 + building.x * scale + scale * 0.16, y0 + building.y * scale + scale * 0.16, Math.max(1.3, scale * 0.68), Math.max(1.3, scale * 0.68));
  }
  for (const unit of state.units) {
    if (!isVisible(state, unit.x, unit.y)) continue;
    const marked = unit.id === selectedUnit?.id;
    const friendly = unit.faction !== 'dead';
    ctx.fillStyle = !friendly ? '#9cf38a' : unit.hasActed ? '#8a7040' : '#f0c866';
    const dot = Math.max(2, scale) + (marked ? 1.4 : 0);
    ctx.fillRect(x0 + unit.x * scale - (marked ? 0.7 : 0), y0 + unit.y * scale - (marked ? 0.7 : 0), dot, dot);
    if (marked) {
      ctx.strokeStyle = '#fff6d8';
      ctx.lineWidth = Math.max(1, frame.dpr);
      ctx.strokeRect(x0 + unit.x * scale - 1.2, y0 + unit.y * scale - 1.2, dot + 1.6, dot + 1.6);
    }
  }
  for (const motion of motions) {
    if (motion.kind !== 'walk' || motion.path?.length < 2) continue;
    ctx.strokeStyle = 'rgba(214, 132, 32, 0.9)';
    ctx.lineWidth = Math.max(1, frame.dpr);
    ctx.beginPath();
    motion.path.forEach((step, index) => {
      const px = x0 + (step.x + 0.5) * scale;
      const py = y0 + (step.y + 0.5) * scale;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  if (route.length > 1) {
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = Math.max(1.4, scale * 0.42);
    ctx.lineCap = 'round';
    ctx.beginPath();
    route.forEach((step, index) => {
      const px = x0 + (step.x + 0.5) * scale;
      const py = y0 + (step.y + 0.5) * scale;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  ctx.strokeStyle = '#f4d48a';
  ctx.lineWidth = Math.max(1, frame.dpr);
  const viewCols = ctx.canvas.clientWidth / Math.max(1, frame.tile / frame.dpr);
  const viewRows = ctx.canvas.clientHeight / Math.max(1, frame.tile / frame.dpr);
  ctx.strokeRect(x0 + frame.camX * scale, y0 + frame.camY * scale, viewCols * scale, viewRows * scale);
  ctx.restore();
}

export function warClock(state) {
  const camp = getDeadwalkerCampaign(state);
  const council = getWarCouncil(state);
  const detail = camp.marchesSent
    ? (camp.closest
      ? `${camp.stage}. ${camp.closest.name} is ${camp.closest.distance} from the capital.`
      : `${camp.stage}. ${camp.marchingCount} hunt the capital.`)
    : `${camp.stage}. First march in ${camp.turnsToMarch}.`;
  return { title: council.headline || 'War council', detail };
}

function paintWarClock(ctx, state, frame) {
  const clock = warClock(state);
  const pad = 14 * frame.dpr;
  const size = Math.max(13, 15 * frame.dpr);
  ctx.save();
  ctx.font = `700 ${size}px Palatino, Georgia, serif`;
  const titleW = ctx.measureText(clock.title).width;
  ctx.font = `600 ${Math.round(size * 0.82)}px Palatino, Georgia, serif`;
  const detailW = ctx.measureText(clock.detail).width;
  const width = Math.max(titleW, detailW) + pad * 1.8;
  const height = size * 2.6 + pad * 0.8;
  ctx.fillStyle = 'rgba(255, 246, 224, 0.94)';
  ctx.strokeStyle = '#8a6230';
  ctx.lineWidth = Math.max(1, frame.dpr);
  roundRect(ctx, pad, pad, width, height, 4 * frame.dpr);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#6a3418';
  ctx.font = `700 ${size}px Palatino, Georgia, serif`;
  ctx.fillText(clock.title, pad * 1.7, pad * 1.25);
  ctx.fillStyle = '#3a2416';
  ctx.font = `600 ${Math.round(size * 0.82)}px Palatino, Georgia, serif`;
  ctx.fillText(clock.detail, pad * 1.7, pad * 1.25 + size * 1.2);
  ctx.restore();
}

function paintVignette(ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.28, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(16, 9, 5, 0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function paintDaylight(ctx, width, height) {
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, 'rgba(255, 246, 224, 0.16)');
  g.addColorStop(0.5, 'rgba(255, 246, 224, 0)');
  g.addColorStop(1, 'rgba(42, 24, 12, 0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function drawFogTile(ctx, rect, x, y, frame) {
  stampMaterial(ctx, 'fog', rect, x, y, true, frame);
  if (hash(x, y) % 5 === 0) {
    ctx.strokeStyle = 'rgba(232, 214, 176, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rect.x + rect.s * 0.15, rect.y + rect.s, rect.s * 0.85, 1.15, 1.85);
    ctx.stroke();
  }
}

function drawTerrainFace(ctx, rect, tile, seen, x, y, frame) {
  stampMaterial(ctx, MATERIAL_SPEC[tile.terrain] ? tile.terrain : 'plains', rect, x, y, seen, frame);
  if (!terrainPhotos[tile.terrain]) {
    ctx.strokeStyle = 'rgba(48, 32, 14, 0.07)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.s - 1, rect.s - 1);
  }
}

function drawTerrainFeature(ctx, state, tile, rect, seen, x, y) {
  if (tile.terrain !== 'river') drawShore(ctx, state, rect, seen, x, y);
  if (tile.terrain === 'forest') drawForest(ctx, rect, x, y, seen);
  else if (tile.terrain === 'hills') {
    if (!terrainPhotos.hills) drawHill(ctx, rect, seen, x, y);
  } else if (tile.terrain === 'mountains') drawMountain(ctx, rect, seen, x, y);
  else if (tile.terrain === 'river') drawRiver(ctx, state, rect, seen, x, y);
  else if (tile.terrain === 'marsh') {
    if (!terrainPhotos.marsh) drawMarsh(ctx, rect, seen, x, y);
  } else if (tile.terrain === 'ruins') {
    if (!terrainPhotos.ruins) drawRuins(ctx, rect, seen, x, y);
  } else if (tile.terrain === 'blight') {
    if (!terrainPhotos.blight) drawBlightGround(ctx, rect, seen, x, y);
  } else if (!terrainPhotos.plains) drawMeadow(ctx, rect, x, y, seen);
}

function stampMaterial(ctx, kind, rect, x, y, seen, frame) {
  if (stampPhoto(ctx, kind, rect, frame)) {
    veilTile(ctx, rect, seen, kind, x, y);
    return;
  }
  const src = terrainMaterial(kind);
  const pattern = ctx.createPattern(src, 'repeat');
  if (pattern && typeof pattern.setTransform === 'function' && typeof DOMMatrix !== 'undefined' && frame) {
    const matrix = new DOMMatrix().translate(-frame.camX * frame.tile, -frame.camY * frame.tile);
    pattern.setTransform(matrix);
    ctx.fillStyle = pattern;
    ctx.fillRect(rect.x, rect.y, rect.s + 1.25, rect.s + 1.25);
  } else {
    const n = hash(x, y);
    ctx.drawImage(src, n % (MATERIAL_SIZE / 2), (n >>> 8) % (MATERIAL_SIZE / 2), MATERIAL_SIZE / 2, MATERIAL_SIZE / 2, rect.x, rect.y, rect.s + 1.25, rect.s + 1.25);
  }
  veilTile(ctx, rect, seen, kind, x, y);
}

function stampPhoto(ctx, kind, rect, frame) {
  const photo = terrainPhotos[kind];
  if (!photo || !frame || typeof DOMMatrix === 'undefined') return false;
  const pattern = ctx.createPattern(photo, 'repeat');
  if (!pattern || typeof pattern.setTransform !== 'function') return false;
  const matrix = new DOMMatrix();
  matrix.translateSelf(-frame.camX * frame.tile, -frame.camY * frame.tile);
  matrix.scaleSelf(0.85, 0.85);
  pattern.setTransform(matrix);
  ctx.fillStyle = pattern;
  ctx.fillRect(rect.x, rect.y, rect.s + 1.25, rect.s + 1.25);
  return true;
}

function veilTile(ctx, rect, seen, kind, x, y) {
  if (kind === 'fog') return;
  const region = (hash(Math.floor(x / 4), Math.floor(y / 4)) % 9) / 100;
  const wash = terrainPhotos[kind] ? 0.28 : 1;
  ctx.fillStyle = region > 0.04 ? `rgba(255, 246, 220, ${region * 0.45 * wash})` : `rgba(36, 24, 12, ${(0.05 - region) * wash})`;
  ctx.fillRect(rect.x, rect.y, rect.s + 1.2, rect.s + 1.2);
  if (!seen) {
    ctx.fillStyle = 'rgba(42, 30, 18, 0.28)';
    ctx.fillRect(rect.x, rect.y, rect.s + 1.2, rect.s + 1.2);
  }
}

function terrainMaterial(kind) {
  if (!materialSet) materialSet = buildMaterials();
  return materialSet[kind] || materialSet.plains;
}

function buildMaterials() {
  const set = {};
  for (const [kind, spec] of Object.entries(MATERIAL_SPEC)) {
    const canvas = document.createElement('canvas');
    canvas.width = MATERIAL_SIZE;
    canvas.height = MATERIAL_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = spec.base;
    ctx.fillRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);
    if (kind === 'fog') {
      paintGrain(ctx, spec);
      set[kind] = canvas;
      continue;
    }
    for (let i = 0; i < 48; i += 1) {
      const px = hash(i + kind.length * 13, 4) % MATERIAL_SIZE;
      const py = hash(9, i + kind.length) % MATERIAL_SIZE;
      const radius = 6 + (hash(i, kind.length + 2) % 14);
      ctx.fillStyle = i % 2 ? spec.light : spec.dark;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.ellipse(px, py, radius, radius * 0.72, (hash(i, 8) % 6) / 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    paintGrain(ctx, spec);
    set[kind] = canvas;
  }
  return set;
}

function paintGrain(ctx, spec) {
  ctx.save();
  if (spec.grain === 'grass') {
    ctx.fillStyle = spec.deep;
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 90; i += 1) {
      const x = hash(i, 21) % MATERIAL_SIZE;
      const y = hash(22, i) % MATERIAL_SIZE;
      ctx.beginPath();
      ctx.ellipse(x, y, 1.4 + (i % 3), 4 + (hash(i, 23) % 5), -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (spec.grain === 'rock') {
    ctx.strokeStyle = spec.deep;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 18; i += 1) {
      const x = hash(i, 30) % MATERIAL_SIZE;
      const y = hash(31, i) % MATERIAL_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18 + (i % 10), y + 8);
      ctx.stroke();
    }
  } else if (spec.grain === 'water') {
    ctx.strokeStyle = spec.light;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    for (let row = 0; row < 9; row += 1) {
      const y = 12 + row * 20;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(40, y - 6, 80, y + 6, 120, y);
      ctx.bezierCurveTo(150, y - 5, 170, y + 4, 192, y);
      ctx.stroke();
    }
  } else if (spec.grain === 'mud') {
    ctx.fillStyle = spec.deep;
    ctx.globalAlpha = 0.28;
    for (let i = 0; i < 10; i += 1) {
      ctx.beginPath();
      ctx.ellipse(hash(i, 40) % MATERIAL_SIZE, hash(41, i) % MATERIAL_SIZE, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (spec.grain === 'vellum') {
    ctx.fillStyle = spec.light;
    ctx.globalAlpha = 0.04;
    ctx.fillRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);
  } else if (spec.grain === 'crack') {
    ctx.strokeStyle = '#d8ff9a';
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i += 1) {
      const x = hash(i, 50) % MATERIAL_SIZE;
      const y = hash(51, i) % MATERIAL_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 20, y + 14);
      ctx.lineTo(x + 8, y + 32);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = spec.light;
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 80; i += 1) ctx.fillRect(hash(i, 60) % MATERIAL_SIZE, hash(61, i) % MATERIAL_SIZE, 2, 2);
  }
  ctx.restore();
}

function remembered(state, x, y) {
  return inBounds(x, y) && isRevealed(state, x, y) && !isVisible(state, x, y);
}

function drawSightEdge(ctx, state, rect, x, y) {
  if (!isVisible(state, x, y)) return;
  const depth = rect.s * 0.7;
  const ink = 'rgba(42, 30, 18, 0.42)';
  const clear = 'rgba(42, 30, 18, 0)';
  const edges = [
    [0, -1, rect.x, rect.y, rect.s, depth],
    [0, 1, rect.x, rect.y + rect.s - depth, rect.s, depth],
    [-1, 0, rect.x, rect.y, depth, rect.s],
    [1, 0, rect.x + rect.s - depth, rect.y, depth, rect.s]
  ];
  for (const [dx, dy, ex, ey, ew, eh] of edges) {
    if (!remembered(state, x + dx, y + dy)) continue;
    const vertical = dy !== 0;
    const g = vertical
      ? ctx.createLinearGradient(0, dy < 0 ? ey : ey + eh, 0, dy < 0 ? ey + eh : ey)
      : ctx.createLinearGradient(dx < 0 ? ex : ex + ew, 0, dx < 0 ? ex + ew : ex, 0);
    g.addColorStop(0, ink);
    g.addColorStop(1, clear);
    ctx.fillStyle = g;
    ctx.fillRect(ex, ey, ew, eh);
  }
}

function edgeHidden(state, x, y) {
  return !inBounds(x, y) || !isRevealed(state, x, y);
}

function drawKnownEdge(ctx, state, rect, x, y) {
  const depth = rect.s * 0.96;
  const ink = 'rgba(141, 115, 86, 0.94)';
  const clear = 'rgba(141, 115, 86, 0)';
  const edges = [
    [0, -1, rect.x, rect.y, rect.s, depth],
    [0, 1, rect.x, rect.y + rect.s - depth, rect.s, depth],
    [-1, 0, rect.x, rect.y, depth, rect.s],
    [1, 0, rect.x + rect.s - depth, rect.y, depth, rect.s]
  ];
  for (const [dx, dy, ex, ey, ew, eh] of edges) {
    if (!edgeHidden(state, x + dx, y + dy)) continue;
    const vertical = dy !== 0;
    const g = vertical
      ? ctx.createLinearGradient(0, dy < 0 ? ey : ey + eh, 0, dy < 0 ? ey + eh : ey)
      : ctx.createLinearGradient(dx < 0 ? ex : ex + ew, 0, dx < 0 ? ex + ew : ex, 0);
    g.addColorStop(0, ink);
    g.addColorStop(1, clear);
    ctx.fillStyle = g;
    ctx.fillRect(ex, ey, ew, eh);
  }
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (!edgeHidden(state, x + dx, y) || !edgeHidden(state, x, y + dy)) continue;
    const cx = dx < 0 ? rect.x : rect.x + rect.s;
    const cy = dy < 0 ? rect.y : rect.y + rect.s;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, depth);
    g.addColorStop(0, ink);
    g.addColorStop(1, clear);
    ctx.fillStyle = g;
    ctx.fillRect(dx < 0 ? rect.x : rect.x + rect.s - depth, dy < 0 ? rect.y : rect.y + rect.s - depth, depth, depth);
  }
}

function drawForest(ctx, rect, x, y, seen) {
  if (propTree) {
    const count = 1 + (hash(x, y) % 2);
    ctx.save();
    if (!seen) ctx.globalAlpha = 0.62;
    for (let i = 0; i < count; i += 1) {
      const h = hash(x + i * 3, y + 5);
      const px = rect.x + rect.s * (0.34 + ((h >>> 4) % 32) / 100);
      const py = rect.y + rect.s * (0.72 + i * 0.1);
      drawProp(ctx, propTree, px, py, rect.s * (0.92 + (h % 4) * 0.05));
    }
    ctx.restore();
    return;
  }
  const count = 2 + (hash(x, y) % 3);
  for (let i = 0; i < count; i += 1) {
    const h = hash(x + i * 5, y + 11);
    const px = rect.x + rect.s * (0.24 + ((h >>> 3) % 52) / 100);
    const py = rect.y + rect.s * (0.28 + ((h >>> 9) % 36) / 100);
    const radius = rect.s * (0.16 + (h % 4) * 0.03);
    drawTree(ctx, px, py, radius, seen, i);
  }
}

function drawTree(ctx, x, y, radius, seen, layer) {
  ctx.fillStyle = seen ? 'rgba(10, 24, 8, 0.3)' : 'rgba(8, 14, 8, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 1.05, radius * 0.9, radius * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = seen ? '#6a4428' : '#3c3024';
  ctx.fillRect(x - radius * 0.13, y + radius * 0.2, radius * 0.26, radius * 0.9);
  ctx.fillStyle = seen ? (layer % 2 ? '#1c6a34' : '#145228') : '#24382c';
  ctx.beginPath();
  ctx.arc(x + radius * 0.08, y + radius * 0.08, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = seen ? '#3d9a48' : '#2d5640';
  ctx.beginPath();
  ctx.arc(x - radius * 0.22, y - radius * 0.18, radius * 0.68, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = seen ? 'rgba(226, 255, 196, 0.38)' : 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(x - radius * 0.3, y - radius * 0.32, radius * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function drawHill(ctx, rect, seen, x, y) {
  const s = rect.s;
  const shift = ((hash(x, y) % 16) - 8) / 100;
  ctx.fillStyle = 'rgba(40, 24, 8, 0.22)';
  ctx.beginPath();
  ctx.ellipse(rect.x + s * 0.56, rect.y + s * 1.02, s * 0.34, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(rect.x, rect.y, rect.x + s, rect.y + s);
  g.addColorStop(0, seen ? '#f3d7a6' : '#9a8464');
  g.addColorStop(0.5, seen ? '#d29a52' : '#7a5a34');
  g.addColorStop(1, seen ? '#7a4a22' : '#4a3018');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(rect.x + s * 0.06, rect.y + s * 0.84);
  ctx.lineTo(rect.x + s * (0.38 + shift), rect.y + s * 0.24);
  ctx.lineTo(rect.x + s * (0.6 + shift), rect.y + s * 0.48);
  ctx.lineTo(rect.x + s * 0.96, rect.y + s * 0.86);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = seen ? '#6d8f30' : '#3d5230';
  ctx.lineWidth = Math.max(2.5, s * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(rect.x + s * 0.16, rect.y + s * 0.72);
  ctx.lineTo(rect.x + s * (0.4 + shift), rect.y + s * 0.32);
  ctx.lineTo(rect.x + s * (0.64 + shift), rect.y + s * 0.54);
  ctx.stroke();
}

function drawMountain(ctx, rect, seen, x, y) {
  if (propPeak) {
    ctx.save();
    if (!seen) ctx.globalAlpha = 0.62;
    const shift = ((hash(x, y) % 16) - 8) / 100;
    drawProp(ctx, propPeak, rect.x + rect.s * (0.5 + shift), rect.y + rect.s * 0.9, rect.s * 1.2);
    ctx.restore();
    return;
  }
  const s = rect.s;
  const shift = ((hash(x, y) % 12) - 6) / 100;
  ctx.fillStyle = 'rgba(20, 24, 28, 0.28)';
  ctx.beginPath();
  ctx.ellipse(rect.x + s * 0.58, rect.y + s * 1.04, s * 0.4, s * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = seen ? '#6d7c84' : '#465158';
  ctx.beginPath();
  ctx.moveTo(rect.x + s * 0.04, rect.y + s * 0.9);
  ctx.lineTo(rect.x + s * (0.34 + shift), rect.y - s * 0.08);
  ctx.lineTo(rect.x + s * 0.52, rect.y + s * 0.42);
  ctx.lineTo(rect.x + s * 0.78, rect.y + s * 0.08);
  ctx.lineTo(rect.x + s * 0.98, rect.y + s * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = seen ? '#d5dee3' : '#8ea0a8';
  ctx.beginPath();
  ctx.moveTo(rect.x + s * 0.14, rect.y + s * 0.62);
  ctx.lineTo(rect.x + s * (0.34 + shift), rect.y - s * 0.08);
  ctx.lineTo(rect.x + s * 0.4, rect.y + s * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f7fbff';
  ctx.beginPath();
  ctx.moveTo(rect.x + s * (0.28 + shift), rect.y + s * 0.08);
  ctx.lineTo(rect.x + s * (0.34 + shift), rect.y - s * 0.08);
  ctx.lineTo(rect.x + s * (0.4 + shift), rect.y + s * 0.1);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(rect.x + s * 0.7, rect.y + s * 0.2);
  ctx.lineTo(rect.x + s * 0.78, rect.y + s * 0.08);
  ctx.lineTo(rect.x + s * 0.86, rect.y + s * 0.24);
  ctx.fill();
}

function drawRiver(ctx, state, rect, seen, x, y) {
  const s = rect.s;
  const lip = Math.max(2, s * 0.045);
  ctx.fillStyle = seen ? 'rgba(12, 36, 28, 0.45)' : 'rgba(16, 24, 18, 0.35)';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (terrainName(state, x + dx, y + dy) === 'river') continue;
    if (dx === 1) ctx.fillRect(rect.x + s - lip, rect.y, lip, s);
    if (dx === -1) ctx.fillRect(rect.x, rect.y, lip, s);
    if (dy === 1) ctx.fillRect(rect.x, rect.y + s - lip, s, lip);
    if (dy === -1) ctx.fillRect(rect.x, rect.y, s, lip);
  }
  const east = terrainName(state, x + 1, y) === 'river';
  const west = terrainName(state, x - 1, y) === 'river';
  const south = terrainName(state, x, y + 1) === 'river';
  const north = terrainName(state, x, y - 1) === 'river';
  ctx.strokeStyle = seen ? 'rgba(214, 240, 255, 0.42)' : 'rgba(214, 240, 255, 0.18)';
  ctx.lineWidth = Math.max(1.2, s * 0.028);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if ((north || south) && !(east || west)) {
    ctx.moveTo(rect.x + s * 0.46, rect.y + s * 0.02);
    ctx.quadraticCurveTo(rect.x + s * 0.62, rect.y + s * 0.5, rect.x + s * 0.42, rect.y + s * 0.98);
  } else {
    ctx.moveTo(rect.x + s * 0.02, rect.y + s * 0.46);
    ctx.quadraticCurveTo(rect.x + s * 0.5, rect.y + s * 0.64, rect.x + s * 0.98, rect.y + s * 0.4);
  }
  ctx.stroke();
}

function drawShore(ctx, state, rect, seen, x, y) {
  const s = rect.s;
  const depth = Math.max(4, s * 0.16);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (terrainName(state, x + dx, y + dy) !== 'river') continue;
    const vertical = dy !== 0;
    const x0 = dx < 0 ? rect.x : dx > 0 ? rect.x + s - depth : rect.x;
    const y0 = dy < 0 ? rect.y : dy > 0 ? rect.y + s - depth : rect.y;
    const w = vertical ? s : depth;
    const h = vertical ? depth : s;
    const g = vertical
      ? ctx.createLinearGradient(0, dy < 0 ? y0 : y0 + h, 0, dy < 0 ? y0 + h : y0)
      : ctx.createLinearGradient(dx < 0 ? x0 : x0 + w, 0, dx < 0 ? x0 + w : x0, 0);
    g.addColorStop(0, seen ? 'rgba(18, 52, 38, 0.42)' : 'rgba(16, 28, 20, 0.28)');
    g.addColorStop(1, 'rgba(18, 52, 38, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, h);
  }
}

function drawMarsh(ctx, rect, seen, x, y) {
  const s = rect.s;
  ctx.fillStyle = seen ? 'rgba(28, 70, 40, 0.38)' : 'rgba(20, 36, 24, 0.4)';
  for (const [px, py, rx] of [[0.32, 0.62, 0.16], [0.68, 0.4, 0.12]]) {
    ctx.beginPath();
    ctx.ellipse(rect.x + s * px, rect.y + s * py, s * rx, s * rx * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = seen ? '#c9d67a' : '#66724a';
  ctx.lineWidth = Math.max(1.4, s * 0.035);
  ctx.lineCap = 'round';
  const reeds = 3 + (hash(x, y) % 3);
  for (let i = 0; i < reeds; i += 1) {
    const h = hash(x + i, y + 4);
    const px = rect.x + s * (0.2 + ((h >>> 2) % 60) / 100);
    const py = rect.y + s * (0.48 + ((h >>> 6) % 30) / 100);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + s * 0.02, py - s * 0.22);
    ctx.stroke();
  }
}

function drawRuins(ctx, rect, seen) {
  const s = rect.s;
  ctx.fillStyle = seen ? 'rgba(40, 28, 16, 0.2)' : 'rgba(20, 16, 10, 0.25)';
  ctx.beginPath();
  ctx.ellipse(rect.x + s * 0.5, rect.y + s * 0.78, s * 0.28, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  const stone = seen ? '#f4ead4' : '#b3a690';
  const shadeTone = seen ? '#b7a484' : '#7d7260';
  ctx.fillStyle = shadeTone;
  ctx.fillRect(rect.x + s * 0.22, rect.y + s * 0.4, s * 0.12, s * 0.36);
  ctx.fillRect(rect.x + s * 0.58, rect.y + s * 0.32, s * 0.12, s * 0.44);
  ctx.fillStyle = stone;
  ctx.fillRect(rect.x + s * 0.2, rect.y + s * 0.38, s * 0.1, s * 0.34);
  ctx.fillRect(rect.x + s * 0.56, rect.y + s * 0.3, s * 0.1, s * 0.28);
  ctx.fillRect(rect.x + s * 0.18, rect.y + s * 0.32, s * 0.5, s * 0.08);
  ctx.fillStyle = shadeTone;
  ctx.fillRect(rect.x + s * 0.34, rect.y + s * 0.62, s * 0.16, s * 0.08);
}

function drawBlightGround(ctx, rect, seen, x, y) {
  const s = rect.s;
  ctx.strokeStyle = seen ? 'rgba(186, 255, 150, 0.7)' : 'rgba(120, 150, 110, 0.35)';
  ctx.lineWidth = Math.max(1.2, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(rect.x + s * 0.18, rect.y + s * 0.72);
  ctx.quadraticCurveTo(rect.x + s * 0.48, rect.y + s * 0.28, rect.x + s * 0.8, rect.y + s * 0.58);
  ctx.moveTo(rect.x + s * 0.3, rect.y + s * 0.4);
  ctx.lineTo(rect.x + s * 0.46, rect.y + s * 0.62);
  ctx.stroke();
  if (hash(x, y) % 2 === 0) {
    ctx.fillStyle = seen ? '#f4efe4' : '#8a8174';
    ctx.beginPath();
    ctx.ellipse(rect.x + s * 0.7, rect.y + s * 0.7, s * 0.06, s * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMeadow(ctx, rect, x, y, seen) {
  const s = rect.s;
  const n = hash(x, y);
  ctx.strokeStyle = seen ? 'rgba(64, 96, 28, 0.55)' : 'rgba(40, 52, 24, 0.35)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.lineCap = 'round';
  const tufts = n % 3 === 0 ? 2 : 1;
  for (let i = 0; i < tufts; i += 1) {
    const h = hash(x + i * 2, y + 6);
    const px = rect.x + s * (0.18 + ((h >>> 2) % 64) / 100);
    const py = rect.y + s * (0.58 + ((h >>> 8) % 28) / 100);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - s * 0.035, py - s * 0.11);
    ctx.moveTo(px, py);
    ctx.lineTo(px + s * 0.02, py - s * 0.13);
    ctx.stroke();
  }
  if (n % 6 === 0) {
    ctx.fillStyle = seen ? '#f2d36b' : '#8a7a48';
    ctx.beginPath();
    ctx.arc(rect.x + s * 0.72, rect.y + s * 0.68, Math.max(1.4, s * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRoad(ctx, state, tile, rect, seen) {
  const s = rect.s;
  const cx = rect.x + s * 0.5;
  const cy = rect.y + s * 0.5;
  const arms = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = tileAt(state, tile.x + dx, tile.y + dy);
    if (next?.road) arms.push([dx, dy]);
  }
  const trace = (width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (!arms.length) {
      ctx.moveTo(cx - s * 0.22, cy);
      ctx.lineTo(cx + s * 0.22, cy);
    } else {
      for (const [dx, dy] of arms) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * s * 0.5, cy + dy * s * 0.5);
      }
    }
    ctx.stroke();
  };
  trace(Math.max(6, s * 0.3), seen ? '#3f2a16' : '#2c2116');
  trace(Math.max(3.5, s * 0.18), seen ? '#c9853a' : '#8a6840');
  trace(Math.max(1.5, s * 0.05), seen ? 'rgba(255, 236, 196, 0.55)' : 'rgba(90, 70, 40, 0.35)');
}

function drawBlightSpeck(ctx, rect, blight) {
  const s = rect.s;
  ctx.strokeStyle = `rgba(92, 48, 140, ${Math.min(0.7, 0.2 + blight / 18)})`;
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(rect.x + s * 0.62, rect.y + s * 0.22);
  ctx.lineTo(rect.x + s * 0.78, rect.y + s * 0.4);
  ctx.lineTo(rect.x + s * 0.66, rect.y + s * 0.48);
  ctx.stroke();
}

function drawProp(ctx, image, groundX, groundY, height) {
  const width = height * (image.width / image.height);
  ctx.drawImage(image, groundX - width / 2, groundY - height, width, height);
}

function drawBuildingSprite(ctx, type, s) {
  const index = BUILDING_SPRITE_ORDER.indexOf(type);
  if (!buildingAtlasReady || !buildingAtlas || index < 0) return false;
  const height = s * 1.34;
  const width = height * (BUILDING_CELL.width / BUILDING_CELL.height);
  const y = s * 0.86 - height * BUILDING_FOOT;
  ctx.drawImage(
    buildingAtlas,
    index * BUILDING_CELL.width,
    0,
    BUILDING_CELL.width,
    BUILDING_CELL.height,
    (s - width) / 2,
    y,
    width,
    height
  );
  return true;
}

function drawBuilding(ctx, frame, building, selected, seen, pending = 0, yieldText = '') {
  const rect = tileRect(frame, building.x, building.y);
  const color = FACTION_INK[building.faction] || '#f0c866';
  const s = rect.s;
  ctx.save();
  ctx.globalAlpha = seen ? 1 : 0.52;
  ctx.translate(rect.x, rect.y);
  const rise = motions.find((motion) => motion.kind === 'rise' && motion.x === building.x && motion.y === building.y);
  if (rise) {
    const amount = 1 - (1 - motionAmount(rise)) ** 2;
    ctx.translate(s * 0.5, s * 0.82);
    ctx.scale(0.7 + 0.3 * amount, 0.7 + 0.3 * amount);
    ctx.translate(-s * 0.5, -s * 0.82);
    ctx.globalAlpha *= 0.35 + 0.65 * amount;
  }
  if (building.turnsLeft > 0) ctx.globalAlpha *= 0.8;
  groundShadow(ctx, s);
  const painted = drawBuildingSprite(ctx, building.type, s);
  if (!painted) {
    if (building.faction === 'dead') drawDeadWork(ctx, building, s);
    else drawLivingWork(ctx, building, s, color);
    if (building.upgraded) drawFinial(ctx, s * 0.5, s * 0.18, s);
  }
  drawHealthPip(ctx, s * 0.22, s * 0.93, s * 0.56, Math.max(4, s * 0.055), building.hp / building.maxHp, pending / building.maxHp);
  if (building.turnsLeft > 0) {
    const stake = motions.find((motion) => motion.kind === 'stake' && motion.x === building.x && motion.y === building.y);
    drawScaffold(ctx, s, stake ? motionAmount(stake) : 1);
    drawWorkClock(ctx, s, workProgress(building));
    drawYieldChip(ctx, s, yieldText, s * 0.58);
    if (stake) {
      const amount = motionAmount(stake);
      ctx.strokeStyle = `rgba(226, 177, 90, ${1 - amount})`;
      ctx.lineWidth = Math.max(2, s * 0.045);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.62, s * (0.4 - amount * 0.16), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else drawYieldChip(ctx, s, yieldText);
  if (selected) drawBrackets(ctx, { x: s * 0.04, y: s * 0.04, s: s * 0.92 }, '#f4d48a', 0.02);
  ctx.restore();
}

function drawLivingWork(ctx, building, s, color) {
  const type = building.type;
  if (type === 'farm') return drawFarm(ctx, s);
  if (type === 'lumberCamp') return drawLumber(ctx, s);
  if (type === 'mine') return drawMine(ctx, s);
  if (type === 'watchtower' || type === 'outpost') return type === 'outpost' ? drawOutpost(ctx, s, color) : drawTower(ctx, s, color);
  if (type === 'wall') return drawWall(ctx, s);
  if (type === 'shrine') return drawShrine(ctx, s);
  if (type === 'rallyBanner') return drawRally(ctx, s, color);
  if (type === 'barracks') return drawHall(ctx, s, '#8f2418', true);
  if (type === 'archeryYard') return drawRange(ctx, s);
  if (type === 'stable') return drawStable(ctx, s);
  if (type === 'workshop') return drawWorkshop(ctx, s);
  if (type === 'city') return drawCity(ctx, s, color);
  drawHall(ctx, s, color, false);
}

function drawCity(ctx, s, color) {
  wall(ctx, s * 0.16, s * 0.3, s * 0.18, s * 0.48);
  wall(ctx, s * 0.66, s * 0.22, s * 0.18, s * 0.56);
  wall(ctx, s * 0.3, s * 0.44, s * 0.4, s * 0.34);
  crenel(ctx, s * 0.16, s * 0.26, s * 0.18);
  crenel(ctx, s * 0.66, s * 0.18, s * 0.18);
  tiledRoof(ctx, s * 0.26, s * 0.46, s * 0.48, s * 0.16);
  ctx.fillStyle = '#24180f';
  ctx.beginPath();
  ctx.moveTo(s * 0.44, s * 0.78);
  ctx.quadraticCurveTo(s * 0.5, s * 0.6, s * 0.56, s * 0.78);
  ctx.fill();
  windowLit(ctx, s * 0.22, s * 0.4, s * 0.055, s * 0.08);
  windowLit(ctx, s * 0.72, s * 0.34, s * 0.055, s * 0.08);
  drawPennon(ctx, s * 0.74, s * 0.05, s * 0.2, color);
}

function drawFarm(ctx, s) {
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = i % 2 ? '#6f8f2e' : '#c6d36a';
    ctx.fillRect(s * 0.12, s * (0.48 + i * 0.08), s * 0.4, s * 0.07);
  }
  wall(ctx, s * 0.56, s * 0.42, s * 0.28, s * 0.3);
  tiledRoof(ctx, s * 0.5, s * 0.44, s * 0.4, s * 0.16);
  windowLit(ctx, s * 0.66, s * 0.52, s * 0.06, s * 0.08);
}

function drawLumber(ctx, s) {
  drawTree(ctx, s * 0.3, s * 0.34, s * 0.16, true, 0);
  ctx.fillStyle = '#6b3e1c';
  for (let i = 0; i < 3; i += 1) ctx.fillRect(s * 0.48, s * (0.48 + i * 0.08), s * 0.34, s * 0.06);
  ctx.fillStyle = '#e6c48a';
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(s * 0.48, s * (0.51 + i * 0.08), s * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMine(ctx, s) {
  const g = ctx.createLinearGradient(0, s * 0.3, s, s * 0.8);
  g.addColorStop(0, '#d5d0c8');
  g.addColorStop(1, '#6e675f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s * 0.12, s * 0.76);
  ctx.lineTo(s * 0.34, s * 0.28);
  ctx.lineTo(s * 0.58, s * 0.46);
  ctx.lineTo(s * 0.9, s * 0.76);
  ctx.fill();
  ctx.fillStyle = '#1a120e';
  ctx.beginPath();
  ctx.moveTo(s * 0.38, s * 0.74);
  ctx.lineTo(s * 0.44, s * 0.52);
  ctx.lineTo(s * 0.62, s * 0.52);
  ctx.lineTo(s * 0.68, s * 0.74);
  ctx.fill();
  ctx.strokeStyle = '#c4965a';
  ctx.lineWidth = Math.max(2, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(s * 0.4, s * 0.74);
  ctx.lineTo(s * 0.46, s * 0.5);
  ctx.lineTo(s * 0.6, s * 0.5);
  ctx.lineTo(s * 0.66, s * 0.74);
  ctx.stroke();
}

function drawTower(ctx, s, color) {
  wall(ctx, s * 0.4, s * 0.28, s * 0.2, s * 0.5);
  ctx.fillStyle = '#6b4428';
  ctx.fillRect(s * 0.34, s * 0.26, s * 0.32, s * 0.06);
  tiledRoof(ctx, s * 0.32, s * 0.28, s * 0.36, s * 0.14);
  windowLit(ctx, s * 0.46, s * 0.4, s * 0.07, s * 0.09);
  drawPennon(ctx, s * 0.58, s * 0.02, s * 0.22, color);
}

function drawOutpost(ctx, s, color) {
  ctx.strokeStyle = '#8a6a42';
  ctx.lineWidth = Math.max(2, s * 0.045);
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i += 1) {
    const x = s * (0.22 + i * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, s * 0.74);
    ctx.lineTo(x, s * 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#f4efe2';
  ctx.beginPath();
  ctx.moveTo(s * 0.32, s * 0.62);
  ctx.lineTo(s * 0.5, s * 0.4);
  ctx.lineTo(s * 0.68, s * 0.62);
  ctx.fill();
  drawPennon(ctx, s * 0.5, s * 0.16, s * 0.2, color);
}

function drawWall(ctx, s) {
  wall(ctx, s * 0.1, s * 0.46, s * 0.8, s * 0.28);
  crenel(ctx, s * 0.1, s * 0.4, s * 0.8);
  ctx.fillStyle = '#24180f';
  ctx.fillRect(s * 0.46, s * 0.54, s * 0.08, s * 0.12);
}

function drawShrine(ctx, s) {
  wall(ctx, s * 0.28, s * 0.48, s * 0.44, s * 0.26);
  ctx.fillStyle = '#f7f1e4';
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.46, s * 0.2, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#f0c866';
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.28, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f0c866';
  ctx.lineWidth = Math.max(1.5, s * 0.025);
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.28, s * 0.11, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRally(ctx, s, color) {
  ctx.strokeStyle = '#5a341c';
  ctx.lineWidth = Math.max(2.5, s * 0.045);
  ctx.beginPath();
  ctx.moveTo(s * 0.4, s * 0.16);
  ctx.lineTo(s * 0.4, s * 0.78);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(s * 0.4, s * 0.16);
  ctx.lineTo(s * 0.78, s * 0.28);
  ctx.lineTo(s * 0.66, s * 0.4);
  ctx.lineTo(s * 0.4, s * 0.34);
  ctx.fill();
  ctx.fillStyle = '#fff1c2';
  ctx.beginPath();
  ctx.arc(s * 0.56, s * 0.28, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cbb892';
  ctx.beginPath();
  ctx.ellipse(s * 0.4, s * 0.78, s * 0.16, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHall(ctx, s, roofColor, rack) {
  wall(ctx, s * 0.16, s * 0.42, s * 0.68, s * 0.32);
  ctx.fillStyle = roofColor;
  tiledRoof(ctx, s * 0.1, s * 0.44, s * 0.8, s * 0.18);
  windowLit(ctx, s * 0.28, s * 0.52, s * 0.08, s * 0.1);
  windowLit(ctx, s * 0.62, s * 0.52, s * 0.08, s * 0.1);
  if (rack) {
    ctx.strokeStyle = '#e6d2a8';
    ctx.lineWidth = Math.max(1.5, s * 0.03);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(s * (0.22 + i * 0.06), s * 0.36);
      ctx.lineTo(s * (0.22 + i * 0.06), s * 0.5);
      ctx.stroke();
    }
  }
}

function drawRange(ctx, s) {
  wall(ctx, s * 0.58, s * 0.4, s * 0.26, s * 0.28);
  tiledRoof(ctx, s * 0.52, s * 0.42, s * 0.36, s * 0.14);
  ctx.fillStyle = '#f4efe2';
  ctx.beginPath();
  ctx.arc(s * 0.32, s * 0.58, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8f2418';
  ctx.beginPath();
  ctx.arc(s * 0.32, s * 0.58, s * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0c866';
  ctx.beginPath();
  ctx.arc(s * 0.32, s * 0.58, s * 0.03, 0, Math.PI * 2);
  ctx.fill();
}

function drawStable(ctx, s) {
  wall(ctx, s * 0.14, s * 0.4, s * 0.72, s * 0.34);
  ctx.fillStyle = '#c9843a';
  tiledRoof(ctx, s * 0.08, s * 0.42, s * 0.84, s * 0.16);
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(s * 0.22, s * 0.52, s * 0.16, s * 0.22);
  ctx.fillRect(s * 0.46, s * 0.52, s * 0.16, s * 0.22);
  ctx.strokeStyle = '#e6d2a8';
  ctx.lineWidth = Math.max(1.2, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(s * 0.22, s * 0.52);
  ctx.lineTo(s * 0.38, s * 0.74);
  ctx.moveTo(s * 0.38, s * 0.52);
  ctx.lineTo(s * 0.22, s * 0.74);
  ctx.stroke();
}

function drawWorkshop(ctx, s) {
  wall(ctx, s * 0.18, s * 0.44, s * 0.58, s * 0.3);
  tiledRoof(ctx, s * 0.12, s * 0.46, s * 0.64, s * 0.16);
  wall(ctx, s * 0.66, s * 0.28, s * 0.1, s * 0.24);
  ctx.fillStyle = 'rgba(90, 90, 90, 0.35)';
  ctx.beginPath();
  ctx.arc(s * 0.78, s * 0.22, s * 0.06, 0, Math.PI * 2);
  ctx.arc(s * 0.86, s * 0.16, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(s * 0.36, s * 0.56, s * 0.18, s * 0.18);
}

function drawDeadWork(ctx, building, s) {
  if (building.type === 'graveForge') {
    ctx.fillStyle = '#1c2420';
    ctx.beginPath();
    ctx.moveTo(s * 0.22, s * 0.76);
    ctx.lineTo(s * 0.3, s * 0.34);
    ctx.lineTo(s * 0.7, s * 0.34);
    ctx.lineTo(s * 0.78, s * 0.76);
    ctx.fill();
    ctx.fillStyle = '#2a1810';
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.12, s * 0.16);
    const glow = ctx.createRadialGradient(s * 0.5, s * 0.58, s * 0.02, s * 0.5, s * 0.58, s * 0.16);
    glow.addColorStop(0, '#fff1c2');
    glow.addColorStop(0.5, '#ff9a3c');
    glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.58, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (building.type === 'necropolis') {
    ctx.fillStyle = '#1a2420';
    for (const [px, top] of [[0.28, 0.34], [0.5, 0.12], [0.72, 0.3]]) {
      ctx.beginPath();
      ctx.moveTo(s * (px - 0.11), s * 0.76);
      ctx.lineTo(s * px, s * top);
      ctx.lineTo(s * (px + 0.11), s * 0.76);
      ctx.fill();
      windowLit(ctx, s * (px - 0.025), s * (top + 0.16), s * 0.05, s * 0.08);
    }
    return;
  }
  if (building.type === 'portal') {
    ctx.strokeStyle = '#cbb892';
    ctx.lineWidth = Math.max(4, s * 0.08);
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.5, s * 0.2, s * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    const glow = ctx.createRadialGradient(s * 0.5, s * 0.5, s * 0.02, s * 0.5, s * 0.5, s * 0.2);
    glow.addColorStop(0, 'rgba(230, 255, 190, 0.95)');
    glow.addColorStop(1, 'rgba(120, 220, 110, 0.15)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.5, s * 0.14, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = '#243028';
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 0.64, s * 0.28, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4efe4';
  for (const px of [0.36, 0.5, 0.64]) {
    ctx.beginPath();
    ctx.arc(s * px, s * 0.58, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a120c';
    ctx.beginPath();
    ctx.arc(s * (px - 0.015), s * 0.57, s * 0.012, 0, Math.PI * 2);
    ctx.arc(s * (px + 0.018), s * 0.57, s * 0.012, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4efe4';
  }
  ctx.fillStyle = 'rgba(180, 255, 140, 0.45)';
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.4, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
}

function wall(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#f6efe2');
  g.addColorStop(0.45, '#d9c7a6');
  g.addColorStop(1, '#a89070');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x, y, Math.max(1, w * 0.12), h);
  ctx.fillStyle = 'rgba(70, 48, 24, 0.16)';
  const rows = Math.max(2, Math.round(h / Math.max(6, w * 0.28)));
  for (let i = 1; i < rows; i += 1) ctx.fillRect(x, y + (h * i) / rows, w, Math.max(1, h * 0.03));
}

function crenel(ctx, x, y, w) {
  ctx.fillStyle = '#f4ead8';
  const merlon = w / 4;
  for (let i = 0; i < 4; i += 2) ctx.fillRect(x + i * merlon, y, merlon * 0.8, merlon * 0.7);
}

function tiledRoof(ctx, x, y, w, h) {
  ctx.fillStyle = '#6e241c';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.5, y - h);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c45a42';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.06, y);
  ctx.lineTo(x + w * 0.5, y - h * 0.86);
  ctx.lineTo(x + w * 0.5, y);
  ctx.closePath();
  ctx.fill();
}

function windowLit(ctx, x, y, w, h) {
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#ffd98a';
  ctx.fillRect(x, y, w, h);
}

function groundShadow(ctx, s) {
  ctx.fillStyle = 'rgba(28, 16, 8, 0.28)';
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 0.8, s * 0.3, s * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawScaffold(ctx, s, grown = 1) {
  const rise = Math.max(0, Math.min(1, grown));
  const foot = s * 0.7;
  const head = foot - s * 0.48 * rise;
  ctx.lineCap = 'square';
  ctx.strokeStyle = '#2a1a0e';
  ctx.lineWidth = Math.max(5, s * 0.09);
  ctx.beginPath();
  ctx.moveTo(s * 0.18, foot);
  ctx.lineTo(s * 0.18, head);
  ctx.moveTo(s * 0.82, foot);
  ctx.lineTo(s * 0.82, head + s * 0.04);
  ctx.moveTo(s * 0.18, foot);
  ctx.lineTo(s * 0.82, head + s * 0.04);
  ctx.stroke();
  ctx.strokeStyle = '#e2b15a';
  ctx.lineWidth = Math.max(2.5, s * 0.045);
  ctx.stroke();
  ctx.fillStyle = '#fff1c4';
  ctx.fillRect(s * 0.12, head - s * 0.03, s * 0.12, s * 0.045);
  ctx.fillRect(s * 0.76, head + s * 0.01, s * 0.12, s * 0.045);
}

function workProgress(building) {
  const total = BUILDING_TYPES[building.type]?.buildTurns || building.turnsLeft || 1;
  return Math.max(0, Math.min(1, 1 - building.turnsLeft / total));
}

function drawWorkClock(ctx, s, done) {
  const cx = s * 0.5;
  const cy = s * 0.16;
  const radius = Math.max(7, s * 0.13);
  ctx.beginPath();
  ctx.strokeStyle = '#2a1a0e';
  ctx.lineWidth = Math.max(3, s * 0.055);
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = '#f3e2c4';
  ctx.lineWidth = Math.max(2, s * 0.035);
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (done <= 0.02) return;
  ctx.beginPath();
  ctx.strokeStyle = '#e2b15a';
  ctx.lineWidth = Math.max(3, s * 0.06);
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * done);
  ctx.stroke();
}

function drawFinial(ctx, x, y, s) {
  ctx.fillStyle = '#f0c866';
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, s * 0.04), 0, Math.PI * 2);
  ctx.fill();
}

export function hostsReaching(state, faction, x, y, ignoreId = null) {
  return state.units.filter((enemy) => {
    if (enemy.id === ignoreId || !isEnemy(state, faction, enemy.faction)) return false;
    if (!isVisible(state, enemy.x, enemy.y)) return false;
    const range = UNIT_TYPES[enemy.type]?.range || 1;
    const distance = Math.abs(enemy.x - x) + Math.abs(enemy.y - y);
    return distance > 0 && distance <= range;
  });
}

export function visibleThreats(state, unit) {
  if (!unit) return [];
  return hostsReaching(state, unit.faction, unit.x, unit.y, unit.id);
}

function drawThreatLines(ctx, frame, threats, unit) {
  const target = tileRect(frame, unit.x, unit.y);
  const tx = target.x + target.s / 2;
  const ty = target.y + target.s * 0.55;
  ctx.save();
  ctx.strokeStyle = 'rgba(176, 36, 28, 0.8)';
  ctx.lineWidth = Math.max(1.5, frame.tile * 0.035);
  ctx.setLineDash([frame.tile * 0.12, frame.tile * 0.08]);
  for (const enemy of threats) {
    const from = tileRect(frame, enemy.x, enemy.y);
    ctx.beginPath();
    ctx.moveTo(from.x + from.s / 2, from.y + from.s * 0.55);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  ctx.restore();
}

function drawReach(ctx, state, frame, unit, x0, y0, x1, y1) {
  if (!unit || unit.hasActed || unit.faction !== 'olundar') return;
  const range = UNIT_TYPES[unit.type]?.range || 1;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!inBounds(x, y) || !isVisible(state, x, y)) continue;
      const distance = Math.abs(x - unit.x) + Math.abs(y - unit.y);
      if (distance === 0 || distance > range) continue;
      const rect = tileRect(frame, x, y);
      const mark = rect.s * 0.07;
      ctx.save();
      ctx.translate(rect.x + rect.s * 0.5, rect.y + rect.s * 0.22);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(176, 42, 32, 0.55)';
      ctx.fillRect(-mark, -mark, mark * 2, mark * 2);
      ctx.restore();
    }
  }
}

function faceOf(unit, aim) {
  const walk = activeMotion(unit.id, 'walk');
  if (walk?.path?.length > 1) {
    const dx = walk.path[walk.path.length - 1].x - walk.path[0].x;
    if (dx) facing.set(unit.id, dx > 0 ? 1 : -1);
  }
  const strike = activeMotion(unit.id, 'strike');
  if (strike && strike.tx !== unit.x) facing.set(unit.id, strike.tx > unit.x ? 1 : -1);
  if (aim && aim.x !== unit.x) facing.set(unit.id, aim.x > unit.x ? 1 : -1);
  return facing.get(unit.id) || -1;
}

function drawUnit(ctx, frame, unit, selected, attack, place = null, aim = null, pending = 0, seat = 0) {
  const spot = place || { x: unit.x, y: unit.y };
  const rect = tileRectAt(frame, spot.x, spot.y);
  const s = rect.s;
  const walking = activeMotion(unit.id, 'walk');
  const bob = selected && !walking && !activeMotion(unit.id, 'strike')
    ? Math.sin((frameNow + unit.x * 90) / 260) * s * 0.04
    : 0;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.fillStyle = 'rgba(16, 10, 6, 0.5)';
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 0.86, s * 0.28, s * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  if (walking) {
    const step = 0.5 + 0.5 * Math.sin(motionAmount(walking) * Math.PI * 6);
    ctx.fillStyle = `rgba(70, 48, 18, ${0.18 + step * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(s * 0.42, s * 0.86, s * 0.08, s * 0.03, 0, 0, Math.PI * 2);
    ctx.ellipse(s * 0.58, s * 0.86, s * 0.08, s * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(0, bob);
  const arrive = activeMotion(unit.id, 'arrive');
  if (arrive) {
    const amount = 1 - (1 - motionAmount(arrive)) ** 2;
    ctx.translate(s * 0.5, s * 0.86);
    ctx.scale(0.4 + 0.6 * amount, 0.4 + 0.6 * amount);
    ctx.globalAlpha *= 0.2 + 0.8 * amount;
    ctx.translate(-s * 0.5, -s * 0.86);
  }
  if (faceOf(unit, aim) > 0) {
    ctx.translate(s, 0);
    ctx.scale(-1, 1);
  }
  drawUnitSprite(ctx, unit, s);
  ctx.restore();
  if (seat) drawCompanyMark(ctx, s, seat, selected);
  if (arrive) {
    const amount = motionAmount(arrive);
    ctx.strokeStyle = unit.faction === 'olundar' ? `rgba(240, 200, 102, ${1 - amount})` : `rgba(156, 243, 138, ${1 - amount})`;
    ctx.lineWidth = Math.max(2, s * 0.04);
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.8, s * (0.1 + amount * 0.4), 0, Math.PI * 2);
    ctx.stroke();
  }
  const beckon = activeMotion(unit.id, 'beckon');
  if (beckon) {
    const amount = motionAmount(beckon);
    ctx.strokeStyle = `rgba(240, 200, 102, ${1 - amount})`;
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.52, s * (0.62 - amount * 0.34), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (unit.faction === 'olundar' && !unit.hasActed && !walking) {
    ctx.save();
    ctx.translate(s * 0.8, s * 0.05);
    ctx.rotate(Math.sin((frameNow + unit.y * 40) / 180) * 0.18);
    drawPennon(ctx, 0, 0, s * 0.34, '#e2b15a');
    ctx.restore();
  } else if (unit.faction === 'olundar' && unit.hasActed) {
    ctx.strokeStyle = 'rgba(36, 24, 16, 0.62)';
    ctx.lineWidth = Math.max(1.5, s * 0.03);
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.9, s * 0.18, s * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (unit.fortified > 0) {
    ctx.strokeStyle = 'rgba(240, 200, 102, 0.92)';
    ctx.lineWidth = Math.max(2, s * 0.045);
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.52, s * 0.36, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  }
  if (activeMotion(unit.id, 'brace')) {
    const amount = motionAmount(activeMotion(unit.id, 'brace'));
    ctx.strokeStyle = `rgba(240, 200, 102, ${1 - amount})`;
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.46, s * (0.2 + amount * 0.28), Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  if (unit.faction !== 'dead' && unit.faction !== 'olundar') {
    ctx.fillStyle = FACTION_INK[unit.faction] || '#f0c866';
    ctx.beginPath();
    ctx.arc(s * 0.8, s * 0.74, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a120c';
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.stroke();
  }
  drawHealthPip(ctx, s * 0.22, s * 0.9, s * 0.56, Math.max(4, s * 0.055), unit.hp / unit.maxHp, pending / unit.maxHp);
  if (attack) drawBrackets(ctx, { x: s * 0.02, y: s * 0.02, s: s * 0.96 }, '#d23b2e', 0);
  if (selected) {
    const glow = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(frameNow / 180));
    drawBrackets(ctx, { x: s * 0.06, y: s * 0.06, s: s * 0.88 }, `rgba(244, 212, 138, ${glow})`, 0);
  }
  ctx.restore();
}

function drawCompanyMark(ctx, s, seat, selected) {
  const size = Math.max(12, Math.round(s * 0.22));
  ctx.save();
  ctx.font = `700 ${size}px Palatino, Georgia, serif`;
  const label = String(seat);
  const width = ctx.measureText(label).width + size * 0.85;
  const height = size + 3;
  const left = s * 0.04;
  const top = s * 0.02;
  ctx.fillStyle = selected ? '#fff6d8' : 'rgba(255, 246, 224, 0.94)';
  ctx.strokeStyle = selected ? '#a56b28' : '#5c3a22';
  ctx.lineWidth = selected ? 2.5 : 1.25;
  roundRect(ctx, left, top, width, height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3a2416';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, left + width / 2, top + height / 2 + 0.5);
  ctx.restore();
}

function drawUnitSprite(ctx, unit, s) {
  const index = UNIT_SPRITE_ORDER.indexOf(unit.type);
  if (!unitAtlasReady || !unitAtlas || index < 0) {
    ctx.fillStyle = FACTION_INK[unit.faction] || '#f0c866';
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.26, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const height = s * 1.42;
  const width = height * (SPRITE_CELL.width / SPRITE_CELL.height);
  const y = s * 0.86 - height * SPRITE_FOOT;
  ctx.save();
  ctx.shadowColor = 'rgba(24, 14, 8, 0.42)';
  ctx.shadowBlur = Math.max(1, s * 0.035);
  ctx.shadowOffsetY = Math.max(1, s * 0.03);
  ctx.drawImage(
    unitAtlas,
    index * SPRITE_CELL.width,
    0,
    SPRITE_CELL.width,
    SPRITE_CELL.height,
    (s - width) / 2,
    y,
    width,
    height
  );
  ctx.restore();
}

function drawPennon(ctx, x, y, h, color) {
  ctx.strokeStyle = '#3a2416';
  ctx.lineWidth = Math.max(1.4, h * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.02);
  ctx.lineTo(x + h * 0.62, y + h * 0.22);
  ctx.lineTo(x + h * 0.16, y + h * 0.34);
  ctx.lineTo(x, y + h * 0.42);
  ctx.closePath();
  ctx.fill();
}

function drawHealthPip(ctx, x, y, w, h, pct, loss = 0) {
  const amount = Math.max(0, Math.min(1, pct));
  const doomed = Math.max(0, Math.min(amount, loss));
  if (!(amount < 0.999) && !(doomed > 0)) return;
  const kept = Math.max(0, amount - doomed);
  ctx.fillStyle = 'rgba(16, 10, 6, 0.82)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (kept > 0) {
    ctx.fillStyle = kept > 0.55 ? '#8fce62' : kept > 0.28 ? '#e2b15a' : '#d4543c';
    roundRect(ctx, x, y, Math.max(h, w * kept), h, h / 2);
    ctx.fill();
  }
  if (doomed > 0) {
    const width = Math.min(w - w * kept, Math.max(Math.min(h, w * doomed), w * doomed));
    ctx.fillStyle = 'rgba(210, 64, 48, 0.92)';
    roundRect(ctx, x + w * kept, y, Math.max(1, width), h, h / 2);
    ctx.fill();
  }
}

export function traceMovePath(field, origin, x, y) {
  if (!origin || !field.has(`${x},${y}`)) return [];
  const path = [{ x, y }];
  let cx = x;
  let cy = y;
  for (let guard = 0; guard < 64; guard += 1) {
    if (Math.abs(cx - origin.x) + Math.abs(cy - origin.y) === 1) {
      path.push({ x: origin.x, y: origin.y });
      break;
    }
    const cost = field.get(`${cx},${cy}`);
    let next = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const step = field.get(`${cx + dx},${cy + dy}`);
      if (step == null || step >= cost) continue;
      if (!next || step < next.cost) next = { x: cx + dx, y: cy + dy, cost: step };
    }
    if (!next) break;
    path.push({ x: next.x, y: next.y });
    cx = next.x;
    cy = next.y;
  }
  return path.reverse();
}

function drawMovePath(ctx, frame, path, field) {
  if (path.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const trace = (width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    path.forEach((step, index) => {
      const rect = tileRect(frame, step.x, step.y);
      const px = rect.x + rect.s / 2;
      const py = rect.y + rect.s * 0.62;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };
  trace(Math.max(5, frame.tile * 0.14), 'rgba(92, 48, 12, 0.85)');
  trace(Math.max(2.5, frame.tile * 0.065), 'rgba(214, 132, 32, 0.96)');
  path.forEach((step, index) => {
    if (index === 0) return;
    const cost = field?.get(`${step.x},${step.y}`);
    if (!Number.isFinite(cost)) return;
    const rect = tileRect(frame, step.x, step.y);
    const label = String(cost);
    const size = Math.max(11, Math.round(frame.tile * 0.22));
    ctx.font = `700 ${size}px Palatino, Georgia, serif`;
    const width = ctx.measureText(label).width + size * 0.7;
    const height = size + 2;
    const left = rect.x + (rect.s - width) / 2;
    const top = rect.y + rect.s * 0.28;
    ctx.fillStyle = 'rgba(255, 246, 224, 0.94)';
    ctx.strokeStyle = '#6a4a28';
    ctx.lineWidth = 1;
    roundRect(ctx, left, top, width, height, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a2416';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, left + width / 2, top + height / 2 + 0.5);
  });
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  const end = tileRect(frame, last.x, last.y);
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
  ctx.translate(end.x + end.s / 2, end.y + end.s * 0.62);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(214, 132, 32, 0.96)';
  ctx.beginPath();
  ctx.moveTo(frame.tile * 0.18, 0);
  ctx.lineTo(-frame.tile * 0.1, frame.tile * 0.1);
  ctx.lineTo(-frame.tile * 0.1, -frame.tile * 0.1);
  ctx.fill();
  ctx.restore();
}

function drawMoveMark(ctx, rect, cost, aimed, exposed, slow) {
  const r = rect.s * (aimed ? 0.2 : cost <= 1 ? 0.15 : 0.1);
  ctx.save();
  ctx.translate(rect.x + rect.s / 2, rect.y + rect.s * 0.62);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = exposed
    ? 'rgba(214, 92, 72, 0.72)'
    : aimed ? 'rgba(255, 236, 176, 0.95)' : cost <= 1 ? 'rgba(255, 214, 120, 0.78)' : 'rgba(255, 214, 120, 0.42)';
  ctx.strokeStyle = exposed ? 'rgba(120, 24, 18, 0.95)' : 'rgba(92, 54, 12, 0.82)';
  ctx.lineWidth = Math.max(1.25, rect.s * 0.028);
  ctx.beginPath();
  ctx.rect(-r, -r, r * 2, r * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (!slow || exposed) return;
  ctx.save();
  ctx.translate(rect.x + rect.s / 2, rect.y + rect.s * 0.78);
  ctx.fillStyle = '#6a3a18';
  ctx.fillRect(-rect.s * 0.08, -rect.s * 0.025, rect.s * 0.16, Math.max(2, rect.s * 0.045));
  ctx.restore();
}

function drawBrackets(ctx, rect, color, inset) {
  const m = rect.s * inset;
  const len = rect.s * 0.2;
  const x = rect.x + m;
  const y = rect.y + m;
  const s = rect.s - m * 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, rect.s * 0.045);
  ctx.lineCap = 'square';
  ctx.beginPath();
  const corners = [
    [x, y, 1, 1],
    [x + s, y, -1, 1],
    [x, y + s, 1, -1],
    [x + s, y + s, -1, -1]
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.moveTo(cx, cy + dy * len);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * len, cy);
  }
  ctx.stroke();
}

export function legalBuildTiles(state, buildingType, builder) {
  if (!buildingType || !builder || builder.hasActed) return [];
  const sites = [];
  for (let y = builder.y - 1; y <= builder.y + 1; y += 1) {
    for (let x = builder.x - 1; x <= builder.x + 1; x += 1) {
      if (Math.abs(x - builder.x) + Math.abs(y - builder.y) > 1) continue;
      if (canBuildOn(state, buildingType, x, y).ok) sites.push(key(x, y));
    }
  }
  return sites;
}

export function hoverStrike(state, unit, x, y) {
  if (!unit || unit.hasActed || unit.faction !== 'olundar' || !isVisible(state, x, y)) return null;
  const enemy = state.units.find((item) => item.x === x && item.y === y && item.id !== unit.id);
  if (enemy) {
    const forecast = forecastUnitAttack(state, unit.id, enemy.id);
    if (!forecast.ok) return null;
    return { x, y, damage: forecast.damage, lethal: Boolean(forecast.lethal), label: forecast.lethal ? 'falls' : `−${forecast.damage}` };
  }
  const structure = state.buildings.find((item) => item.x === x && item.y === y && item.type !== 'road');
  if (!structure) return null;
  const forecast = forecastBuildingAttack(state, unit.id, structure.id);
  if (!forecast.ok) return null;
  return {
    x,
    y,
    damage: forecast.damage,
    lethal: Boolean(forecast.lethal),
    label: forecast.portalReforms ? 'reforms' : forecast.lethal ? 'falls' : `−${forecast.damage}`
  };
}

export function visibleMarchAnchor(state, moves) {
  const city = state.buildings.find((building) => building.type === 'city' && building.faction === 'olundar');
  const originX = city?.x ?? 0;
  const originY = city?.y ?? 0;
  let best = null;
  let bestDist = Infinity;
  for (const move of moves) {
    if (!isVisible(state, move.x, move.y) && !isVisible(state, move.nx, move.ny)) continue;
    const dist = Math.abs(move.nx - originX) + Math.abs(move.ny - originY);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: move.nx, y: move.ny };
    }
  }
  return best;
}

function drawBuildWash(ctx, frame, hover, sites, state) {
  if (!inBounds(hover.x, hover.y) || !isRevealed(state, hover.x, hover.y)) return;
  if (sites.has(`${hover.x},${hover.y}`)) return;
  const rect = tileRect(frame, hover.x, hover.y);
  ctx.fillStyle = 'rgba(176, 42, 32, 0.28)';
  ctx.fillRect(rect.x, rect.y, rect.s, rect.s);
}

function drawBuildGhost(ctx, frame, buildType, hover, sites, state) {
  if (!inBounds(hover.x, hover.y) || !isRevealed(state, hover.x, hover.y)) return;
  if (!sites.has(`${hover.x},${hover.y}`)) return;
  const rect = tileRect(frame, hover.x, hover.y);
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.globalAlpha = 0.78;
  groundShadow(ctx, rect.s);
  const painted = drawBuildingSprite(ctx, buildType, rect.s);
  if (!painted) {
    ctx.fillStyle = '#c9853a';
    ctx.fillRect(rect.s * 0.12, rect.s * 0.4, rect.s * 0.76, rect.s * 0.22);
  }
  ctx.restore();
  drawSiteChip(ctx, rect, plannedYieldLabel(state, buildType, hover.x, hover.y));
}

function drawStrikePreview(ctx, frame, unit, strike) {
  const from = tileRect(frame, unit.x, unit.y);
  const to = tileRect(frame, strike.x, strike.y);
  const x1 = from.x + from.s / 2;
  const y1 = from.y + from.s * 0.4;
  const x2 = to.x + to.s / 2;
  const y2 = to.y + to.s * 0.4;
  ctx.save();
  ctx.strokeStyle = 'rgba(159, 45, 34, 0.95)';
  ctx.lineWidth = Math.max(2, frame.tile * 0.04);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.translate(x2, y2);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(159, 45, 34, 0.95)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-frame.tile * 0.16, frame.tile * 0.075);
  ctx.lineTo(-frame.tile * 0.16, -frame.tile * 0.075);
  ctx.fill();
  ctx.restore();
  ctx.save();
  const size = Math.max(13, Math.round(frame.tile * 0.26));
  ctx.font = `700 ${size}px Palatino, Georgia, serif`;
  const width = ctx.measureText(strike.label).width + size * 0.9;
  const height = size + 6;
  const left = to.x + (to.s - width) / 2;
  const top = Math.max(4, to.y - height - 3);
  ctx.fillStyle = 'rgba(255, 246, 232, 0.95)';
  ctx.strokeStyle = '#9f2d22';
  ctx.lineWidth = 1.5;
  roundRect(ctx, left, top, width, height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#9f2d22';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(strike.label, left + width / 2, top + height / 2 + 0.5);
  ctx.restore();
}

function isAttackTarget(state, attacker, target) {
  if (!target || target.id === attacker.id || !isEnemy(state, attacker.faction, target.faction)) return false;
  const def = UNIT_TYPES[attacker.type];
  const distance = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
  return distance <= def.range && distance > 0;
}

function terrainName(state, x, y) {
  if (!inBounds(x, y) || !isRevealed(state, x, y)) return null;
  return tileAt(state, x, y).terrain;
}

function tileRectAt(frame, x, y) {
  return {
    x: (x - frame.camX) * frame.tile,
    y: (y - frame.camY) * frame.tile,
    s: frame.tile
  };
}

function tileRect(frame, x, y) {
  return {
    x: (x - frame.camX) * frame.tile,
    y: (y - frame.camY) * frame.tile,
    s: frame.tile
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hash(x, y) {
  let n = Math.imul(x + 19, 374761393) + Math.imul(y + 7, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  return n;
}

function shade(hex, amount) {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value, 16);
  const r = Math.round(((num >> 16) & 255) * amount);
  const g = Math.round(((num >> 8) & 255) * amount);
  const b = Math.round((num & 255) * amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function key(x, y) {
  return `${x},${y}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function coverClause(forecast) {
  if (!forecast?.ok) return '';
  const bits = [];
  if (forecast.armor) bits.push(`armor ${forecast.armor}`);
  if (forecast.terrainDefense > 0) bits.push(`holds ${forecast.terrainDefense}`);
  else if (forecast.terrainDefense < 0) bits.push('bare ground');
  if (forecast.fortified) bits.push(`guard ${forecast.fortified}`);
  return bits.join(', ');
}

function coverWord(defense) {
  if (defense > 0) return `holds ${defense}`;
  if (defense < 0) return 'bare ground';
  return '';
}

export function hoverSummary(state, tile, field) {
  if (!tile) return 'Select a unit, then choose a highlighted tile.';
  if (!isRevealed(state, tile.x, tile.y)) return `Unexplored ${tile.x},${tile.y}`;
  const terrain = TERRAIN[tileAt(state, tile.x, tile.y).terrain];
  const move = field?.get(key(tile.x, tile.y));
  const unit = isVisible(state, tile.x, tile.y) ? state.units.find((item) => item.x === tile.x && item.y === tile.y) : null;
  const building = isVisible(state, tile.x, tile.y) ? state.buildings.find((item) => item.x === tile.x && item.y === tile.y && item.type !== 'road') : null;
  const parts = [`${terrain.name} ${tile.x},${tile.y}`];
  if (!isVisible(state, tile.x, tile.y)) parts.push('out of sight');
  const cover = coverWord(terrain.defense || 0);
  if (cover) parts.push(cover);
  if (Number.isFinite(move)) parts.push(`move ${move}`);
  if (Number.isFinite(move) && (terrain.move || 1) > 1) parts.push('slow');
  if (unit) parts.push(unit.name);
    if (building) {
      parts.push(building.name);
      const extra = holdingLine(state, building);
      if (extra) parts.push(extra);
    }
  return parts.join(' · ');
}

export function holdingLine(state, building) {
  if (!building) return '';
  if (building.turnsLeft > 0) return `rises in ${building.turnsLeft}`;
  if (building.type === 'road') return '';
  const parts = [];
  const yieldText = yieldLabel(state, building, 4);
  if (yieldText) parts.push(yieldText);
  const muster = musterLabel(building);
  if (muster) parts.push(muster);
  return parts.join(' · ');
}

function musterLabel(building) {
  if (!building?.queue?.length || building.turnsLeft > 0) return '';
  const current = building.queue[0];
  const name = UNIT_TYPES[current.unitType]?.name || 'Troop';
  return `${name.split(' ').slice(-1)[0]} in ${current.turnsLeft}`;
}

function yieldLabel(state, building, limit = 1) {
  if (!building) return '';
  if (building.turnsLeft > 0) return `in ${building.turnsLeft}`;
  if (building.type === 'road') return '';
  const income = incomeForBuilding(state, building);
  const entries = Object.entries(income).filter(([, amount]) => amount).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return entries.slice(0, limit).map(([id, amount]) => `${id} ${amount > 0 ? '+' : ''}${amount}`).join(', ');
}

export function plannedYieldLabel(state, type, x, y) {
  if (!type || !inBounds(x, y)) return '';
  return yieldLabel(state, { type, x, y, upgraded: 0, turnsLeft: 0 });
}

function sitePlans(state, type, sites) {
  const plans = new Map();
  const scores = [];
  for (const id of sites || []) {
    const [x, y] = id.split(',').map(Number);
    const income = incomeForBuilding(state, { type, x, y, upgraded: 0 });
    const score = Object.values(income).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    plans.set(id, { x, y, score, label: plannedYieldLabel(state, type, x, y), rich: false });
    scores.push(score);
  }
  const max = scores.reduce((best, score) => Math.max(best, score), 0);
  const varied = scores.some((score) => score !== scores[0]);
  if (varied && max > 0) {
    for (const plan of plans.values()) plan.rich = plan.score === max;
  }
  return plans;
}

function drawSiteChip(ctx, rect, label) {
  if (!label) return;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  drawYieldChip(ctx, rect.s, label);
  ctx.restore();
}

function drawYieldChip(ctx, s, label, lift = 0) {
  if (!label) return;
  const size = Math.max(10, Math.round(s * 0.15));
  ctx.save();
  ctx.font = `700 ${size}px Palatino, Georgia, serif`;
  const width = Math.min(s * 0.98, ctx.measureText(label).width + size * 0.85);
  const height = size + 3;
  const left = (s - width) / 2;
  const top = Math.max(2, s * 0.98 - height - lift);
  ctx.fillStyle = 'rgba(255, 246, 224, 0.94)';
  ctx.strokeStyle = '#6a4a28';
  ctx.lineWidth = 1;
  roundRect(ctx, left, top, width, height, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3a2416';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, left + width / 2, top + height / 2 + 0.5);
  ctx.restore();
}

function drawCoverMark(ctx, frame, state, hover) {
  if (!isRevealed(state, hover.x, hover.y)) return;
  const defense = TERRAIN[tileAt(state, hover.x, hover.y).terrain]?.defense || 0;
  if (!defense) return;
  const rect = tileRect(frame, hover.x, hover.y);
  const r = Math.max(7, rect.s * 0.13);
  const cx = rect.x + rect.s * 0.18;
  const cy = rect.y + rect.s * 0.18;
  ctx.save();
  ctx.fillStyle = defense > 0 ? 'rgba(255, 246, 224, 0.94)' : 'rgba(159, 45, 34, 0.92)';
  ctx.strokeStyle = defense > 0 ? '#6a4a28' : '#fff6e0';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = defense > 0 ? '#3a2416' : '#fff6e0';
  ctx.font = `700 ${Math.max(10, Math.round(r * 1.15))}px Palatino, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(defense > 0 ? String(defense) : '−', cx, cy + 0.5);
  ctx.restore();
}
