/**
 * Square tactical board.
 * Terrain is painted once into a cache. Hover and selection repaint only the piece layer.
 * Ground, features, then y-sorted buildings and units, so the map reads back-to-front.
 */

import { FACTIONS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from '../content.js';
import { inBounds, neighbors4 } from '../map.js';
import {
  canBuildOn,
  canEnter,
  effectiveMoveRange,
  getMarchAssaultVectors,
  isEnemy,
  isRevealed,
  isVisible,
  moveCostFor,
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
  fog: { base: '#3a322a', dark: '#241c16', light: '#5a4c40', deep: '#1a1410', grain: 'mist' }
};

const FACTION_INK = Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction.id, faction.color || '#f0c866']));
export const UNIT_SPRITE_ORDER = ['scout', 'legionary', 'spearGuard', 'archer', 'cavalry', 'engineer', 'onager', 'boneThrall', 'corpseArcher', 'graveKnight', 'lichBoss'];
const SPRITE_CELL = { width: 384, height: 512 };
const SPRITE_FOOT = 502 / 512;
const SPRITE_URL = new URL('../../assets/sprites/unit-atlas.png', import.meta.url);
const MATERIAL_SIZE = 192;

let unitAtlas = null;
let unitAtlasReady = false;
let materialSet = null;

export function loadUnitSprites() {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  if (unitAtlasReady) return Promise.resolve(true);
  unitAtlas = new Image();
  return new Promise((resolve) => {
    unitAtlas.onload = () => {
      unitAtlasReady = true;
      resolve(true);
    };
    unitAtlas.onerror = () => resolve(false);
    unitAtlas.src = SPRITE_URL.href;
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

  function tileAtPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = view.camX + (clientX - rect.left) / view.tile;
    const y = view.camY + (clientY - rect.top) / view.tile;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
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

  function ensureBuildSites(state, buildingType) {
    const id = buildingType ? `${buildingType}:${state.turn}:${state.units.length}:${state.buildings.length}` : '';
    if (id !== view.buildKey) {
      view.buildKey = id;
      view.buildSites = new Set();
      if (buildingType) {
        for (let y = 0; y < MAP_HEIGHT; y += 1) {
          for (let x = 0; x < MAP_WIDTH; x += 1) {
            if (canBuildOn(state, buildingType, x, y)) view.buildSites.add(key(x, y));
          }
        }
      }
    }
    return view.buildSites;
  }

  function paint(state, { hover = null, selectedUnitId = null, selectedBuildingId = null, buildType = null } = {}) {
    const frame = layout();
    const selectedUnit = state.units.find((unit) => unit.id === selectedUnitId) || null;
    const field = buildType ? new Map() : ensureField(state, selectedUnit);
    const sites = ensureBuildSites(state, buildType);
    const seen = state.visible.filter(Boolean).length;
    const terrainKey = `${frame.tile}|${view.camX.toFixed(2)}|${view.camY.toFixed(2)}|${state.turn}|${state.revealed.filter(Boolean).length}|${seen}|${state.buildings.length}`;
    if (terrainKey !== view.cacheKey) {
      view.cacheKey = terrainKey;
      paintTerrain(terrain, state, frame);
    }
    paintPieces(pieces, state, frame, { hover, selectedUnit, selectedBuildingId, field, sites, buildType });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);
    ctx.drawImage(pieces, 0, 0);
    paintVignette(ctx);
    paintMinimap(ctx, state, frame);
  }

  return { resize, focus, pan, panByPixels, tileAtPoint, paint, movementField: () => view.field };
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
    drawMoveMark(ctx, tileRect(frame, x, y), cost);
  }
  if (buildType) {
    for (const id of sites) {
      const [x, y] = id.split(',').map(Number);
      if (x < x0 || y < y0 || x >= x1 || y >= y1 || !isRevealed(state, x, y)) continue;
      drawBrackets(ctx, tileRect(frame, x, y), 'rgba(88, 158, 78, 0.95)', 0.12);
    }
  }
  paintMarches(ctx, state, frame);

  const props = [];
  for (const building of state.buildings) {
    if (building.type === 'road') continue;
    if (building.x < x0 || building.y < y0 || building.x >= x1 || building.y >= y1) continue;
    if (!isRevealed(state, building.x, building.y)) continue;
    props.push({ rank: 0, x: building.x, y: building.y, building });
  }
  for (const unit of state.units) {
    if (unit.x < x0 || unit.y < y0 || unit.x >= x1 || unit.y >= y1) continue;
    if (!isVisible(state, unit.x, unit.y)) continue;
    props.push({ rank: 1, x: unit.x, y: unit.y, unit });
  }
  props.sort((a, b) => a.y - b.y || a.x - b.x || a.rank - b.rank);
  for (const prop of props) {
    if (prop.building) drawBuilding(ctx, frame, prop.building, prop.building.id === selectedBuildingId, isVisible(state, prop.building.x, prop.building.y));
    else {
      const attack = selectedUnit && !selectedUnit.hasActed && isAttackTarget(state, selectedUnit, prop.unit);
      drawUnit(ctx, frame, prop.unit, prop.unit.id === selectedUnit?.id, attack);
    }
  }
  if (hover) drawBrackets(ctx, tileRect(frame, hover.x, hover.y), 'rgba(255, 248, 220, 0.95)', 0.08);
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

function paintMinimap(ctx, state, frame) {
  const scale = Math.max(2, Math.min(4, frame.tile * 0.08));
  const pad = 12 * frame.dpr;
  const width = MAP_WIDTH * scale;
  const height = MAP_HEIGHT * scale;
  const x0 = ctx.canvas.width - width - pad;
  const y0 = pad;
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
  for (const building of state.buildings) {
    if (building.type !== 'city' && building.type !== 'portal') continue;
    if (!isRevealed(state, building.x, building.y)) continue;
    ctx.fillStyle = building.faction === 'dead' ? '#d8ff9a' : '#fff6e0';
    ctx.fillRect(x0 + building.x * scale - 0.5, y0 + building.y * scale - 0.5, scale + 1.2, scale + 1.2);
  }
  for (const unit of state.units) {
    if (!isVisible(state, unit.x, unit.y)) continue;
    ctx.fillStyle = unit.faction === 'dead' ? '#9cf38a' : '#f0c866';
    ctx.fillRect(x0 + unit.x * scale, y0 + unit.y * scale, Math.max(2, scale), Math.max(2, scale));
  }
  ctx.strokeStyle = '#f4d48a';
  ctx.lineWidth = Math.max(1, frame.dpr);
  const viewCols = ctx.canvas.clientWidth / Math.max(1, frame.tile / frame.dpr);
  const viewRows = ctx.canvas.clientHeight / Math.max(1, frame.tile / frame.dpr);
  ctx.strokeRect(x0 + frame.camX * scale, y0 + frame.camY * scale, viewCols * scale, viewRows * scale);
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
  ctx.strokeStyle = 'rgba(48, 32, 14, 0.07)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.s - 1, rect.s - 1);
}

function drawTerrainFeature(ctx, state, tile, rect, seen, x, y) {
  if (tile.terrain === 'forest') drawForest(ctx, rect, x, y, seen);
  else if (tile.terrain === 'hills') drawHill(ctx, rect, seen, x, y);
  else if (tile.terrain === 'mountains') drawMountain(ctx, rect, seen, x, y);
  else if (tile.terrain === 'river') drawRiver(ctx, state, rect, seen, x, y);
  else if (tile.terrain === 'marsh') drawMarsh(ctx, rect, seen, x, y);
  else if (tile.terrain === 'ruins') drawRuins(ctx, rect, seen, x, y);
  else if (tile.terrain === 'blight') drawBlightGround(ctx, rect, seen, x, y);
  else drawMeadow(ctx, rect, x, y, seen);
}

function stampMaterial(ctx, kind, rect, x, y, seen, frame) {
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
  const region = (hash(Math.floor(x / 4), Math.floor(y / 4)) % 9) / 100;
  ctx.fillStyle = region > 0.04 ? `rgba(255, 246, 220, ${region * 0.45})` : `rgba(36, 24, 12, ${0.05 - region})`;
  ctx.fillRect(rect.x, rect.y, rect.s + 1.2, rect.s + 1.2);
  if (!seen) {
    ctx.fillStyle = 'rgba(28, 20, 14, 0.38)';
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

function drawKnownEdge(ctx, state, rect, x, y) {
  const depth = rect.s * 0.28;
  const edges = [
    [0, -1, rect.x, rect.y, rect.s, depth],
    [0, 1, rect.x, rect.y + rect.s - depth, rect.s, depth],
    [-1, 0, rect.x, rect.y, depth, rect.s],
    [1, 0, rect.x + rect.s - depth, rect.y, depth, rect.s]
  ];
  for (const [dx, dy, ex, ey, ew, eh] of edges) {
    if (inBounds(x + dx, y + dy) && isRevealed(state, x + dx, y + dy)) continue;
    const vertical = dy !== 0;
    const g = vertical
      ? ctx.createLinearGradient(0, dy < 0 ? ey : ey + eh, 0, dy < 0 ? ey + eh : ey)
      : ctx.createLinearGradient(dx < 0 ? ex : ex + ew, 0, dx < 0 ? ex + ew : ex, 0);
    g.addColorStop(0, 'rgba(12, 8, 6, 0.72)');
    g.addColorStop(1, 'rgba(12, 8, 6, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(ex, ey, ew, eh);
  }
}

function drawForest(ctx, rect, x, y, seen) {
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
  const bank = seen ? '#e6d3a6' : '#8d7b5c';
  const lip = Math.max(3, s * 0.14);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (terrainName(state, x + dx, y + dy) === 'river') continue;
    ctx.fillStyle = bank;
    if (dx === 1) ctx.fillRect(rect.x + s - lip, rect.y, lip + 1, s);
    if (dx === -1) ctx.fillRect(rect.x, rect.y, lip, s);
    if (dy === 1) ctx.fillRect(rect.x, rect.y + s - lip, s, lip + 1);
    if (dy === -1) ctx.fillRect(rect.x, rect.y, s, lip);
  }
  ctx.strokeStyle = seen ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1.6, s * 0.045);
  ctx.lineCap = 'round';
  const j = (hash(x, y) % 10) / 50;
  ctx.beginPath();
  ctx.moveTo(rect.x + s * (0.22 + j), rect.y + s * 0.06);
  ctx.quadraticCurveTo(rect.x + s * (0.72 - j), rect.y + s * 0.46, rect.x + s * (0.3 + j), rect.y + s * 0.94);
  ctx.stroke();
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
    ctx.lineCap = 'butt';
    ctx.beginPath();
    if (!arms.length) {
      ctx.moveTo(cx - s * 0.22, cy);
      ctx.lineTo(cx + s * 0.22, cy);
    } else {
      for (const [dx, dy] of arms) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * s * 0.52, cy + dy * s * 0.52);
      }
    }
    ctx.stroke();
  };
  trace(Math.max(7, s * 0.36), seen ? '#6a4828' : '#4a3824');
  trace(Math.max(4, s * 0.2), seen ? '#ecd7a8' : '#9a8460');
  trace(Math.max(1, s * 0.03), seen ? 'rgba(90, 56, 24, 0.4)' : 'rgba(40, 28, 16, 0.3)');
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

function drawBuilding(ctx, frame, building, selected, seen) {
  const rect = tileRect(frame, building.x, building.y);
  const color = FACTION_INK[building.faction] || '#f0c866';
  const s = rect.s;
  ctx.save();
  ctx.globalAlpha = seen ? 1 : 0.52;
  ctx.translate(rect.x, rect.y);
  if (building.turnsLeft > 0) ctx.globalAlpha *= 0.8;
  groundShadow(ctx, s);
  if (building.faction === 'dead') drawDeadWork(ctx, building, s);
  else drawLivingWork(ctx, building, s, color);
  if (building.upgraded) drawFinial(ctx, s * 0.5, s * 0.18, s);
  drawHealthPip(ctx, s * 0.24, s * 0.88, s * 0.52, Math.max(3, s * 0.045), building.hp / building.maxHp);
  if (building.turnsLeft > 0) drawScaffold(ctx, s);
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

function drawScaffold(ctx, s) {
  ctx.strokeStyle = '#6b4428';
  ctx.lineWidth = Math.max(2, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(s * 0.16, s * 0.8);
  ctx.lineTo(s * 0.16, s * 0.24);
  ctx.moveTo(s * 0.84, s * 0.8);
  ctx.lineTo(s * 0.84, s * 0.3);
  ctx.moveTo(s * 0.16, s * 0.38);
  ctx.lineTo(s * 0.84, s * 0.38);
  ctx.stroke();
}

function drawFinial(ctx, x, y, s) {
  ctx.fillStyle = '#f0c866';
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, s * 0.04), 0, Math.PI * 2);
  ctx.fill();
}

function drawUnit(ctx, frame, unit, selected, attack) {
  const rect = tileRect(frame, unit.x, unit.y);
  const s = rect.s;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.globalAlpha = unit.hasActed && unit.faction === 'olundar' ? 0.72 : 1;
  drawUnitSprite(ctx, unit, s);
  if (unit.faction !== 'dead' && unit.faction !== 'olundar') {
    ctx.fillStyle = FACTION_INK[unit.faction] || '#f0c866';
    ctx.beginPath();
    ctx.arc(s * 0.8, s * 0.74, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a120c';
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.stroke();
  }
  drawHealthPip(ctx, s * 0.26, s * 0.9, s * 0.48, Math.max(3, s * 0.04), unit.hp / unit.maxHp);
  if (attack) drawBrackets(ctx, { x: s * 0.02, y: s * 0.02, s: s * 0.96 }, '#d23b2e', 0);
  if (selected) drawBrackets(ctx, { x: s * 0.06, y: s * 0.06, s: s * 0.88 }, '#f4d48a', 0);
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
  ctx.shadowBlur = Math.max(2, s * 0.08);
  ctx.shadowOffsetY = Math.max(1, s * 0.05);
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

function drawHealthPip(ctx, x, y, w, h, pct) {
  const amount = Math.max(0, Math.min(1, pct));
  ctx.fillStyle = 'rgba(16, 10, 6, 0.75)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = amount > 0.55 ? '#8fce62' : amount > 0.28 ? '#e2b15a' : '#d4543c';
  roundRect(ctx, x, y, Math.max(h, w * amount), h, h / 2);
  ctx.fill();
}

function drawMoveMark(ctx, rect, cost) {
  const r = rect.s * (cost <= 1 ? 0.15 : 0.1);
  ctx.save();
  ctx.translate(rect.x + rect.s / 2, rect.y + rect.s * 0.62);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = cost <= 1 ? 'rgba(255, 214, 120, 0.78)' : 'rgba(255, 214, 120, 0.42)';
  ctx.strokeStyle = 'rgba(92, 54, 12, 0.82)';
  ctx.lineWidth = Math.max(1.25, rect.s * 0.028);
  ctx.beginPath();
  ctx.rect(-r, -r, r * 2, r * 2);
  ctx.fill();
  ctx.stroke();
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

export function hoverSummary(state, tile, field) {
  if (!tile) return 'Select a unit, then choose a highlighted tile.';
  if (!isRevealed(state, tile.x, tile.y)) return `Unexplored ${tile.x},${tile.y}`;
  const terrain = TERRAIN[tileAt(state, tile.x, tile.y).terrain];
  const move = field?.get(key(tile.x, tile.y));
  const unit = isVisible(state, tile.x, tile.y) ? state.units.find((item) => item.x === tile.x && item.y === tile.y) : null;
  const building = isVisible(state, tile.x, tile.y) ? state.buildings.find((item) => item.x === tile.x && item.y === tile.y && item.type !== 'road') : null;
  const parts = [`${terrain.name} ${tile.x},${tile.y}`];
  if (Number.isFinite(move)) parts.push(`move ${move}`);
  if (unit) parts.push(unit.name);
  if (building) parts.push(building.name);
  return parts.join(' · ');
}
