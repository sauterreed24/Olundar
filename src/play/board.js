/**
 * Square tactical board.
 * Terrain is cached. Hover and selection repaint only the piece layer.
 */

import { BUILDING_TYPES, FACTIONS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from '../content.js';
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
  plains: ['#d7e392', '#f4f8c8', '#b7cf68'],
  forest: ['#2c8a4e', '#63c47a', '#145c32'],
  hills: ['#d7a45a', '#f0d092', '#a56b32'],
  mountains: ['#b7c4c8', '#f4f7f4', '#7d9098'],
  river: ['#3aa6d4', '#dff6ff', '#1d7eab'],
  marsh: ['#7eae62', '#d7ec9a', '#4d7a42'],
  ruins: ['#d2bc96', '#f6ead0', '#8d7350'],
  blight: ['#6a587f', '#b7a4cf', '#3e324f']
};

const FACTION_INK = Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction.id, faction.color || '#f0c866']));
const UNIT_SPRITE_ORDER = ['scout', 'legionary', 'spearGuard', 'archer', 'cavalry', 'engineer', 'onager', 'boneThrall', 'corpseArcher', 'graveKnight', 'lichBoss'];
const SPRITE_CELL = { width: 160, height: 200 };
const SPRITE_URL = new URL('../../assets/sprites/unit-atlas.svg', import.meta.url);

let unitAtlas = null;
let unitAtlasReady = false;

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
    const frame = layout();
    const cols = canvas.clientWidth / view.tile;
    const rows = canvas.clientHeight / view.tile;
    view.camX = clamp(x - cols / 2 + 0.5, 0, Math.max(0, MAP_WIDTH - cols));
    view.camY = clamp(y - rows / 2 + 0.5, 0, Math.max(0, MAP_HEIGHT - rows));
    view.cacheKey = '';
    return frame;
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0);
    ctx.drawImage(pieces, 0, 0);
    paintMinimap(ctx, state, frame);
  }

  return { resize, focus, pan, panByPixels, tileAtPoint, paint, movementField: () => view.field };
}

function paintTerrain(surface, state, frame) {
  const ctx = surface.getContext('2d');
  ctx.clearRect(0, 0, surface.width, surface.height);
  const wash = ctx.createLinearGradient(0, 0, 0, surface.height);
  wash.addColorStop(0, '#efe2c4');
  wash.addColorStop(1, '#cbb892');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, surface.width, surface.height);
  const x0 = Math.floor(frame.camX);
  const y0 = Math.floor(frame.camY);
  for (let y = y0; y < y0 + frame.rows; y += 1) {
    for (let x = x0; x < x0 + frame.cols; x += 1) {
      if (!inBounds(x, y)) continue;
      const rect = tileRect(frame, x, y);
      if (!isRevealed(state, x, y)) {
        drawFogTile(ctx, rect, x, y);
        continue;
      }
      const tile = tileAt(state, x, y);
      const seen = isVisible(state, x, y);
      drawTerrainFace(ctx, rect, tile, seen, x, y);
      if (tile.road) drawRoad(ctx, state, tile, rect, seen);
      if ((tile.blight || 0) > 0 && tile.terrain !== 'blight') drawBlightSpeck(ctx, rect, tile.blight);
    }
  }
}

function drawFogTile(ctx, rect, x, y) {
  const ink = hash(x, y) % 2 === 0 ? '#3a3126' : '#32291f';
  ctx.fillStyle = ink;
  ctx.fillRect(rect.x, rect.y, rect.s + 0.6, rect.s + 0.6);
  ctx.strokeStyle = 'rgba(232, 214, 176, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.s * 0.15, rect.y + rect.s * 0.72);
  ctx.lineTo(rect.x + rect.s * 0.82, rect.y + rect.s * 0.28);
  ctx.stroke();
}

function drawTerrainFace(ctx, rect, tile, seen, x, y) {
  const palette = TERRAIN_INK[tile.terrain] || TERRAIN_INK.plains;
  const gap = Math.max(1, rect.s * 0.035);
  const face = { x: rect.x + gap, y: rect.y + gap, s: rect.s - gap * 2 };
  const gradient = ctx.createLinearGradient(face.x, face.y, face.x, face.y + face.s);
  gradient.addColorStop(0, seen ? palette[1] : shade(palette[1], 0.62));
  gradient.addColorStop(0.55, seen ? palette[0] : shade(palette[0], 0.58));
  gradient.addColorStop(1, seen ? palette[2] : shade(palette[2], 0.5));
  ctx.fillStyle = gradient;
  roundRect(ctx, face.x, face.y, face.s, face.s, face.s * 0.12);
  ctx.fill();
  const specks = hash(x, y);
  ctx.fillStyle = seen ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.arc(face.x + face.s * (0.22 + (specks % 5) * 0.03), face.y + face.s * 0.28, face.s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  if (tile.terrain === 'forest') drawCanopy(ctx, face, seen);
  if (tile.terrain === 'hills') drawRidge(ctx, face, palette[2], seen);
  if (tile.terrain === 'mountains') drawPeak(ctx, face, seen);
  if (tile.terrain === 'river') drawRiver(ctx, face, seen);
  if (tile.terrain === 'marsh') drawMarsh(ctx, face, seen);
  if (tile.terrain === 'ruins') drawRuinStones(ctx, face, seen);
  if (tile.terrain === 'blight') drawBlightGround(ctx, face, seen);
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
    const rect = tileRect(frame, x, y);
    ctx.fillStyle = cost <= 1 ? 'rgba(240, 200, 102, 0.42)' : 'rgba(240, 200, 102, 0.24)';
    roundRect(ctx, rect.x + rect.s * 0.12, rect.y + rect.s * 0.12, rect.s * 0.76, rect.s * 0.76, rect.s * 0.18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(143, 90, 20, 0.55)';
    ctx.lineWidth = Math.max(1.5, frame.tile * 0.035);
    ctx.stroke();
  }
  if (buildType) {
    for (const id of sites) {
      const [x, y] = id.split(',').map(Number);
      if (x < x0 || y < y0 || x >= x1 || y >= y1 || !isRevealed(state, x, y)) continue;
      const rect = tileRect(frame, x, y);
      ctx.strokeStyle = 'rgba(90, 160, 90, 0.9)';
      ctx.lineWidth = Math.max(2, frame.tile * 0.06);
      ctx.strokeRect(rect.x + 3, rect.y + 3, rect.s - 6, rect.s - 6);
    }
  }

  for (const building of state.buildings) {
    if (building.type === 'road') continue;
    if (building.x < x0 || building.y < y0 || building.x >= x1 || building.y >= y1) continue;
    if (!isRevealed(state, building.x, building.y)) continue;
    drawBuilding(ctx, frame, building, building.id === selectedBuildingId, isVisible(state, building.x, building.y));
  }
  for (const unit of state.units) {
    if (unit.x < x0 || unit.y < y0 || unit.x >= x1 || unit.y >= y1) continue;
    if (!isVisible(state, unit.x, unit.y)) continue;
    const attack = selectedUnit && !selectedUnit.hasActed && isAttackTarget(state, selectedUnit, unit);
    drawUnit(ctx, frame, unit, unit.id === selectedUnit?.id, attack);
  }
  paintMarches(ctx, state, frame);
  if (hover) {
    const rect = tileRect(frame, hover.x, hover.y);
    ctx.strokeStyle = 'rgba(255, 248, 220, 0.95)';
    ctx.lineWidth = Math.max(2, frame.tile * 0.045);
    roundRect(ctx, rect.x + rect.s * 0.08, rect.y + rect.s * 0.08, rect.s * 0.84, rect.s * 0.84, rect.s * 0.16);
    ctx.stroke();
  }
}

function paintMarches(ctx, state, frame) {
  const vectors = getMarchAssaultVectors(state).slice(0, 6);
  ctx.save();
  ctx.strokeStyle = 'rgba(143, 36, 24, 0.85)';
  ctx.lineWidth = Math.max(2, frame.tile * 0.05);
  ctx.setLineDash([frame.tile * 0.18, frame.tile * 0.12]);
  for (const vector of vectors) {
    const from = tileRect(frame, vector.fromX, vector.fromY);
    const to = tileRect(frame, vector.toX, vector.toY);
    ctx.beginPath();
    ctx.moveTo(from.x + from.s / 2, from.y + from.s / 2);
    ctx.lineTo(to.x + to.s / 2, to.y + to.s / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function paintMinimap(ctx, state, frame) {
  const scale = Math.max(2, Math.min(4, frame.tile * 0.08));
  const pad = 10 * frame.dpr;
  const width = MAP_WIDTH * scale;
  const height = MAP_HEIGHT * scale;
  const x0 = ctx.canvas.width - width - pad;
  const y0 = pad;
  ctx.save();
  ctx.fillStyle = 'rgba(244, 232, 204, 0.94)';
  roundRect(ctx, x0 - 6, y0 - 6, width + 12, height + 12, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 78, 36, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const tile = tileAt(state, x, y);
      if (!isRevealed(state, x, y)) ctx.fillStyle = '#d7c7a4';
      else ctx.fillStyle = isVisible(state, x, y) ? (TERRAIN_INK[tile.terrain]?.[0] || '#ccc') : '#b7a888';
      ctx.fillRect(x0 + x * scale, y0 + y * scale, scale, scale);
    }
  }
  ctx.strokeStyle = '#8f2418';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + frame.camX * scale, y0 + frame.camY * scale, (ctx.canvas.clientWidth / Math.max(1, frame.tile / frame.dpr)) * scale, (ctx.canvas.clientHeight / Math.max(1, frame.tile / frame.dpr)) * scale);
  ctx.restore();
}

function drawBuilding(ctx, frame, building, selected, seen) {
  const rect = tileRect(frame, building.x, building.y);
  const color = FACTION_INK[building.faction] || '#f0c866';
  const s = rect.s;
  ctx.save();
  ctx.globalAlpha = seen ? 1 : 0.5;
  ctx.translate(rect.x, rect.y);
  ctx.fillStyle = 'rgba(48, 28, 12, 0.22)';
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 0.78, s * 0.32, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  if (building.faction === 'dead') drawDeadWork(ctx, building, s);
  else drawLivingWork(ctx, building, s, color);
  drawHealthPip(ctx, s * 0.26, s * 0.84, s * 0.48, s * 0.055, building.hp / building.maxHp);
  if (selected) drawSelectRing(ctx, s);
  ctx.restore();
}

function drawLivingWork(ctx, building, s, color) {
  if (building.type === 'farm') {
    ctx.fillStyle = '#8faf45';
    for (let i = 0; i < 3; i += 1) ctx.fillRect(s * 0.18, s * (0.42 + i * 0.1), s * 0.4, s * 0.05);
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(s * 0.52, s * 0.4, s * 0.26, s * 0.28);
    ctx.fillStyle = '#8f2418';
    roof(ctx, s * 0.48, s * 0.4, s * 0.34, s * 0.16);
    return;
  }
  if (building.type === 'lumberCamp') {
    ctx.fillStyle = '#1f6b3a';
    ctx.beginPath();
    ctx.moveTo(s * 0.28, s * 0.62);
    ctx.lineTo(s * 0.4, s * 0.28);
    ctx.lineTo(s * 0.52, s * 0.62);
    ctx.fill();
    ctx.fillStyle = '#6b4428';
    ctx.fillRect(s * 0.54, s * 0.5, s * 0.26, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.58, s * 0.3, s * 0.08);
    return;
  }
  if (building.type === 'mine') {
    ctx.fillStyle = '#8d8072';
    ctx.beginPath();
    ctx.moveTo(s * 0.16, s * 0.72);
    ctx.lineTo(s * 0.38, s * 0.32);
    ctx.lineTo(s * 0.62, s * 0.5);
    ctx.lineTo(s * 0.84, s * 0.72);
    ctx.fill();
    ctx.fillStyle = '#241910';
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.66, s * 0.14, s * 0.1, 0, Math.PI, 0);
    ctx.fill();
    return;
  }
  if (building.type === 'watchtower' || building.type === 'outpost') {
    ctx.fillStyle = '#6e5438';
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.16, s * 0.46);
    ctx.fillStyle = color;
    roof(ctx, s * 0.32, s * 0.28, s * 0.36, s * 0.16);
    drawPennon(ctx, s * 0.58, s * 0.16, s * 0.22, color);
    return;
  }
  if (building.type === 'wall') {
    ctx.fillStyle = '#c5c8c4';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(s * (0.12 + i * 0.2), s * 0.4, s * 0.14, s * 0.32);
    ctx.fillStyle = '#f4f1ea';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(s * (0.12 + i * 0.2), s * 0.34, s * 0.14, s * 0.08);
    return;
  }
  if (building.type === 'shrine' || building.type === 'rallyBanner') {
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = Math.max(2, s * 0.045);
    ctx.beginPath();
    ctx.moveTo(s * 0.38, s * 0.18);
    ctx.lineTo(s * 0.38, s * 0.74);
    ctx.stroke();
    ctx.fillStyle = building.type === 'shrine' ? '#f0c866' : '#8f2418';
    ctx.beginPath();
    ctx.moveTo(s * 0.38, s * 0.18);
    ctx.lineTo(s * 0.72, s * 0.28);
    ctx.lineTo(s * 0.62, s * 0.4);
    ctx.lineTo(s * 0.38, s * 0.34);
    ctx.fill();
    if (building.type === 'shrine') {
      ctx.fillStyle = '#fff1b0';
      ctx.beginPath();
      ctx.arc(s * 0.55, s * 0.28, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.fillStyle = '#f6f0e4';
  ctx.fillRect(s * 0.24, s * 0.4, s * 0.52, s * 0.32);
  ctx.fillStyle = building.type === 'city' ? '#8f2418' : color;
  roof(ctx, s * 0.16, s * 0.4, s * 0.68, s * 0.2);
  if (building.type === 'city') {
    ctx.fillStyle = '#efe6d2';
    ctx.fillRect(s * 0.32, s * 0.46, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.46, s * 0.46, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.6, s * 0.46, s * 0.06, s * 0.16);
    drawPennon(ctx, s * 0.72, s * 0.16, s * 0.24, color);
  }
  if (building.turnsLeft > 0) {
    ctx.strokeStyle = 'rgba(70, 42, 22, 0.7)';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    ctx.moveTo(s * 0.22, s * 0.72);
    ctx.lineTo(s * 0.78, s * 0.28);
    ctx.moveTo(s * 0.22, s * 0.28);
    ctx.lineTo(s * 0.78, s * 0.72);
    ctx.stroke();
  }
}

function drawDeadWork(ctx, building, s) {
  if (building.type === 'graveForge') {
    ctx.fillStyle = '#1c2420';
    ctx.beginPath();
    ctx.moveTo(s * 0.24, s * 0.74);
    ctx.lineTo(s * 0.32, s * 0.36);
    ctx.lineTo(s * 0.68, s * 0.36);
    ctx.lineTo(s * 0.76, s * 0.74);
    ctx.fill();
    ctx.fillStyle = '#ffb066';
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.56, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (building.type === 'necropolis') {
    ctx.fillStyle = '#24302a';
    for (const [px, top] of [[0.28, 0.34], [0.5, 0.16], [0.72, 0.3]]) {
      ctx.beginPath();
      ctx.moveTo(s * (px - 0.1), s * 0.72);
      ctx.lineTo(s * px, s * top);
      ctx.lineTo(s * (px + 0.1), s * 0.72);
      ctx.fill();
    }
    ctx.strokeStyle = '#f3ead4';
    ctx.lineWidth = Math.max(1.4, s * 0.03);
    ctx.stroke();
    return;
  }
  if (building.type === 'portal') {
    ctx.strokeStyle = '#9cf38a';
    ctx.lineWidth = Math.max(3, s * 0.07);
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.48, s * 0.18, s * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(156, 243, 138, 0.35)';
    ctx.fill();
    return;
  }
  ctx.fillStyle = '#101612';
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 0.58, s * 0.24, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e7e0cc';
  ctx.lineWidth = Math.max(1.5, s * 0.035);
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.52, s * 0.22, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.fillStyle = '#9cf38a';
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.56, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

function drawUnit(ctx, frame, unit, selected, attack) {
  const rect = tileRect(frame, unit.x, unit.y);
  const color = FACTION_INK[unit.faction] || '#f0c866';
  const s = rect.s;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.globalAlpha = unit.hasActed && unit.faction === 'olundar' ? 0.58 : 1;
  drawUnitSprite(ctx, unit, s);
  if (unit.faction !== 'dead') drawPennon(ctx, s * 0.7, s * 0.08, s * 0.18, color);
  drawHealthPip(ctx, s * 0.28, s * 0.9, s * 0.44, s * 0.045, unit.hp / unit.maxHp);
  if (attack) {
    ctx.strokeStyle = '#b42318';
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.46, s * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (selected) drawSelectRing(ctx, s);
  ctx.restore();
}

function drawUnitSprite(ctx, unit, s) {
  const index = UNIT_SPRITE_ORDER.indexOf(unit.type);
  if (!unitAtlasReady || !unitAtlas || index < 0) return;
  const height = s * 1.28;
  const width = height * (SPRITE_CELL.width / SPRITE_CELL.height);
  ctx.drawImage(
    unitAtlas,
    index * SPRITE_CELL.width,
    0,
    SPRITE_CELL.width,
    SPRITE_CELL.height,
    (s - width) / 2,
    s - height + s * 0.12,
    width,
    height
  );
}

function drawCanopy(ctx, face, seen) {
  ctx.fillStyle = seen ? '#14663a' : '#3d5a44';
  for (const [px, py, r] of [[0.32, 0.58, 0.16], [0.55, 0.42, 0.18], [0.72, 0.62, 0.13]]) {
    ctx.beginPath();
    ctx.arc(face.x + face.s * px, face.y + face.s * py, face.s * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = seen ? '#5c3a22' : '#4a4034';
  ctx.fillRect(face.x + face.s * 0.5, face.y + face.s * 0.55, face.s * 0.06, face.s * 0.22);
}

function drawRidge(ctx, face, color, seen) {
  ctx.fillStyle = seen ? color : shade(color, 0.62);
  ctx.beginPath();
  ctx.moveTo(face.x + face.s * 0.12, face.y + face.s * 0.78);
  ctx.lineTo(face.x + face.s * 0.4, face.y + face.s * 0.28);
  ctx.lineTo(face.x + face.s * 0.62, face.y + face.s * 0.58);
  ctx.lineTo(face.x + face.s * 0.88, face.y + face.s * 0.78);
  ctx.fill();
  ctx.fillStyle = seen ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(face.x + face.s * 0.4, face.y + face.s * 0.28);
  ctx.lineTo(face.x + face.s * 0.48, face.y + face.s * 0.5);
  ctx.lineTo(face.x + face.s * 0.36, face.y + face.s * 0.48);
  ctx.fill();
}

function drawPeak(ctx, face, seen) {
  ctx.fillStyle = seen ? '#d5dee2' : '#8ea0a6';
  ctx.beginPath();
  ctx.moveTo(face.x + face.s * 0.16, face.y + face.s * 0.8);
  ctx.lineTo(face.x + face.s * 0.42, face.y + face.s * 0.22);
  ctx.lineTo(face.x + face.s * 0.58, face.y + face.s * 0.48);
  ctx.lineTo(face.x + face.s * 0.84, face.y + face.s * 0.8);
  ctx.fill();
  ctx.fillStyle = '#f7fbff';
  ctx.beginPath();
  ctx.moveTo(face.x + face.s * 0.42, face.y + face.s * 0.22);
  ctx.lineTo(face.x + face.s * 0.48, face.y + face.s * 0.4);
  ctx.lineTo(face.x + face.s * 0.36, face.y + face.s * 0.38);
  ctx.fill();
}

function drawRiver(ctx, face, seen) {
  ctx.fillStyle = seen ? '#7fd4f2' : '#6f93a4';
  ctx.beginPath();
  ctx.moveTo(face.x + face.s * 0.08, face.y);
  ctx.quadraticCurveTo(face.x + face.s * 0.7, face.y + face.s * 0.35, face.x + face.s * 0.2, face.y + face.s);
  ctx.lineTo(face.x + face.s * 0.48, face.y + face.s);
  ctx.quadraticCurveTo(face.x + face.s * 0.95, face.y + face.s * 0.4, face.x + face.s * 0.36, face.y);
  ctx.fill();
  ctx.strokeStyle = seen ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = Math.max(1.5, face.s * 0.04);
  ctx.beginPath();
  ctx.moveTo(face.x + face.s * 0.22, face.y + face.s * 0.12);
  ctx.quadraticCurveTo(face.x + face.s * 0.62, face.y + face.s * 0.4, face.x + face.s * 0.3, face.y + face.s * 0.88);
  ctx.stroke();
}

function drawMarsh(ctx, face, seen) {
  ctx.fillStyle = seen ? 'rgba(40, 90, 50, 0.35)' : 'rgba(40, 60, 40, 0.35)';
  for (const [px, py, rx] of [[0.32, 0.58, 0.16], [0.66, 0.42, 0.12]]) {
    ctx.beginPath();
    ctx.ellipse(face.x + face.s * px, face.y + face.s * py, face.s * rx, face.s * rx * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRuinStones(ctx, face, seen) {
  ctx.fillStyle = seen ? '#efe6d2' : '#b3a890';
  ctx.fillRect(face.x + face.s * 0.22, face.y + face.s * 0.38, face.s * 0.1, face.s * 0.36);
  ctx.fillRect(face.x + face.s * 0.46, face.y + face.s * 0.28, face.s * 0.12, face.s * 0.46);
  ctx.fillRect(face.x + face.s * 0.2, face.y + face.s * 0.32, face.s * 0.4, face.s * 0.08);
}

function drawBlightGround(ctx, face, seen) {
  ctx.strokeStyle = seen ? 'rgba(156, 243, 138, 0.7)' : 'rgba(120, 150, 110, 0.4)';
  ctx.lineWidth = Math.max(1, face.s * 0.03);
  ctx.beginPath();
  ctx.moveTo(face.x + face.s * 0.2, face.y + face.s * 0.7);
  ctx.quadraticCurveTo(face.x + face.s * 0.5, face.y + face.s * 0.3, face.x + face.s * 0.78, face.y + face.s * 0.62);
  ctx.stroke();
}

function drawRoad(ctx, state, tile, rect, seen) {
  ctx.strokeStyle = seen ? '#f4e2b0' : '#b7a888';
  ctx.lineWidth = Math.max(4, rect.s * 0.16);
  ctx.lineCap = 'butt';
  const cx = rect.x + rect.s * 0.5;
  const cy = rect.y + rect.s * 0.5;
  ctx.beginPath();
  let arms = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = tileAt(state, tile.x + dx, tile.y + dy);
    if (!next?.road) continue;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * rect.s * 0.5, cy + dy * rect.s * 0.5);
    arms += 1;
  }
  if (!arms) {
    ctx.moveTo(cx - rect.s * 0.18, cy);
    ctx.lineTo(cx + rect.s * 0.18, cy);
  }
  ctx.stroke();
  ctx.strokeStyle = seen ? 'rgba(120, 78, 36, 0.35)' : 'rgba(80, 60, 30, 0.25)';
  ctx.lineWidth = Math.max(1, rect.s * 0.03);
  ctx.stroke();
}

function drawBlightSpeck(ctx, rect, blight) {
  ctx.fillStyle = `rgba(70, 40, 110, ${Math.min(0.4, blight / 14)})`;
  ctx.beginPath();
  ctx.arc(rect.x + rect.s * 0.72, rect.y + rect.s * 0.28, rect.s * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function roof(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.5, y - h);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
}

function drawPennon(ctx, x, y, h, color) {
  ctx.strokeStyle = '#5a3a22';
  ctx.lineWidth = Math.max(1, h * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + h * 0.55, y + h * 0.18);
  ctx.lineTo(x, y + h * 0.36);
  ctx.closePath();
  ctx.fill();
}

function drawHealthPip(ctx, x, y, w, h, pct) {
  ctx.fillStyle = 'rgba(30, 18, 10, 0.55)';
  roundRect(ctx, x, y, w, h, h);
  ctx.fill();
  ctx.fillStyle = pct > 0.5 ? '#7dbe57' : '#d4543c';
  roundRect(ctx, x, y, Math.max(h, w * pct), h, h);
  ctx.fill();
}

function drawSelectRing(ctx, s) {
  ctx.strokeStyle = '#f0c866';
  ctx.lineWidth = Math.max(2.5, s * 0.055);
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.48, s * 0.38, 0, Math.PI * 2);
  ctx.stroke();
}

function hash(x, y) {
  let n = Math.imul(x + 19, 374761393) + Math.imul(y + 7, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  return n;
}

function tileRect(frame, x, y) {
  return {
    x: (x - frame.camX) * frame.tile,
    y: (y - frame.camY) * frame.tile,
    s: frame.tile
  };
}

function isAttackTarget(state, attacker, target) {
  if (!target || target.id === attacker.id || !isEnemy(state, attacker.faction, target.faction)) return false;
  const def = UNIT_TYPES[attacker.type];
  const distance = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
  return distance <= def.range && distance > 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
