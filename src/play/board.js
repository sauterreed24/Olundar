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
  plains: ['#c9dc86', '#e7f3b4', '#b7cf72'],
  forest: ['#1f7a45', '#39a864', '#145c32'],
  hills: ['#c48d45', '#e2bc78', '#a87432'],
  mountains: ['#8ea0ab', '#d5e0e6', '#6d808b'],
  river: ['#2b93cf', '#8fd7f5', '#166f9e'],
  marsh: ['#5c9d55', '#b7d98a', '#3f7540'],
  ruins: ['#c3ad86', '#efe2c4', '#9a8460'],
  blight: ['#5a4d78', '#8d7eab', '#3c3254']
};

const FACTION_INK = Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction.id, faction.color || '#f0c866']));

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
  surface.width = frame ? surface.width : surface.width;
  const ctx = surface.getContext('2d');
  ctx.clearRect(0, 0, surface.width, surface.height);
  ctx.fillStyle = '#141b24';
  ctx.fillRect(0, 0, surface.width, surface.height);
  const x0 = Math.floor(frame.camX);
  const y0 = Math.floor(frame.camY);
  for (let y = y0; y < y0 + frame.rows; y += 1) {
    for (let x = x0; x < x0 + frame.cols; x += 1) {
      if (!inBounds(x, y)) continue;
      const rect = tileRect(frame, x, y);
      if (!isRevealed(state, x, y)) {
        ctx.fillStyle = '#1a2230';
        ctx.fillRect(rect.x, rect.y, rect.s + 0.5, rect.s + 0.5);
        continue;
      }
      const tile = tileAt(state, x, y);
      const palette = TERRAIN_INK[tile.terrain] || TERRAIN_INK.plains;
      const seen = isVisible(state, x, y);
      ctx.fillStyle = seen ? palette[0] : shade(palette[0], 0.55);
      ctx.fillRect(rect.x, rect.y, rect.s + 0.5, rect.s + 0.5);
      ctx.fillStyle = seen ? palette[1] : shade(palette[1], 0.45);
      ctx.fillRect(rect.x + rect.s * 0.08, rect.y + rect.s * 0.08, rect.s * 0.28, rect.s * 0.08);
      if (tile.terrain === 'forest') drawCanopy(ctx, rect, seen);
      if (tile.terrain === 'hills' || tile.terrain === 'mountains') drawRidge(ctx, rect, palette[2], seen);
      if (tile.terrain === 'river') drawRiver(ctx, rect, seen);
      if (tile.road) drawRoad(ctx, state, tile, rect, seen);
      if ((tile.blight || 0) > 0 && tile.terrain !== 'blight') drawBlightSpeck(ctx, rect, tile.blight);
    }
  }
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
    ctx.fillStyle = cost <= 1 ? 'rgba(240, 200, 102, 0.38)' : 'rgba(240, 200, 102, 0.22)';
    ctx.fillRect(rect.x + 2, rect.y + 2, rect.s - 4, rect.s - 4);
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
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, frame.tile * 0.05);
    ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.s - 3, rect.s - 3);
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
  ctx.fillStyle = 'rgba(20, 27, 36, 0.92)';
  ctx.fillRect(x0 - 4, y0 - 4, width + 8, height + 8);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const tile = tileAt(state, x, y);
      if (!isRevealed(state, x, y)) ctx.fillStyle = '#2c3644';
      else ctx.fillStyle = isVisible(state, x, y) ? (TERRAIN_INK[tile.terrain]?.[0] || '#ccc') : '#6d7884';
      ctx.fillRect(x0 + x * scale, y0 + y * scale, scale, scale);
    }
  }
  ctx.strokeStyle = '#f0c866';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + frame.camX * scale, y0 + frame.camY * scale, (ctx.canvas.clientWidth / Math.max(1, frame.tile / frame.dpr)) * scale, (ctx.canvas.clientHeight / Math.max(1, frame.tile / frame.dpr)) * scale);
  ctx.restore();
}

function drawBuilding(ctx, frame, building, selected, seen) {
  const rect = tileRect(frame, building.x, building.y);
  const color = FACTION_INK[building.faction] || '#ddd';
  const s = rect.s;
  ctx.save();
  ctx.globalAlpha = seen ? 1 : 0.55;
  ctx.translate(rect.x, rect.y);
  ctx.fillStyle = building.faction === 'dead' ? '#18211c' : '#f4efe2';
  roundRect(ctx, s * 0.22, s * 0.28, s * 0.56, s * 0.42, s * 0.08);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(s * 0.18, s * 0.34);
  ctx.lineTo(s * 0.5, s * 0.14);
  ctx.lineTo(s * 0.82, s * 0.34);
  ctx.closePath();
  ctx.fill();
  if (building.type === 'portal' || building.type === 'bonePit' || building.type === 'graveForge' || building.type === 'necropolis') {
    ctx.fillStyle = building.type === 'graveForge' ? '#ff8a62' : '#9cf38a';
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.48, s * (building.type === 'necropolis' ? 0.16 : 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
  if (building.turnsLeft > 0) {
    ctx.fillStyle = '#24170f';
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.4, s * 0.12);
    ctx.fillStyle = '#f0c866';
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.4 * (1 - building.turnsLeft / Math.max(1, BUILDING_TYPES[building.type]?.buildTurns || 1)), s * 0.12);
  }
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(s * 0.28, s * 0.78, s * 0.44, s * 0.07);
  ctx.fillStyle = building.hp / building.maxHp > 0.45 ? '#67b15a' : '#d4543c';
  ctx.fillRect(s * 0.28, s * 0.78, s * 0.44 * (building.hp / building.maxHp), s * 0.07);
  if (selected) {
    ctx.strokeStyle = '#f0c866';
    ctx.lineWidth = Math.max(3, s * 0.07);
    ctx.strokeRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);
  }
  ctx.restore();
}

function drawUnit(ctx, frame, unit, selected, attack) {
  const rect = tileRect(frame, unit.x, unit.y);
  const def = UNIT_TYPES[unit.type];
  const color = FACTION_INK[unit.faction] || '#eee';
  const s = rect.s;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.globalAlpha = unit.hasActed && unit.faction === 'olundar' ? 0.62 : 1;
  ctx.fillStyle = unit.faction === 'dead' ? '#101612' : '#f7f1e2';
  roundRect(ctx, s * 0.2, s * 0.22, s * 0.6, s * 0.52, s * 0.16);
  ctx.fill();
  ctx.lineWidth = Math.max(3, s * 0.07);
  ctx.strokeStyle = attack ? '#b42318' : color;
  roundRect(ctx, s * 0.2, s * 0.22, s * 0.6, s * 0.52, s * 0.16);
  ctx.stroke();
  ctx.fillStyle = unit.faction === 'dead' ? '#d7ffe0' : '#2a2118';
  ctx.font = `700 ${Math.max(10, s * 0.22)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shortCode(def?.role || unit.type), s * 0.5, s * 0.48);
  ctx.fillStyle = '#24170f';
  ctx.fillRect(s * 0.24, s * 0.78, s * 0.52, s * 0.08);
  ctx.fillStyle = unit.hp / unit.maxHp > 0.5 ? '#67b15a' : '#d4543c';
  ctx.fillRect(s * 0.24, s * 0.78, s * 0.52 * (unit.hp / unit.maxHp), s * 0.08);
  if (selected) {
    ctx.strokeStyle = '#fff6d0';
    ctx.lineWidth = Math.max(3, s * 0.08);
    ctx.strokeRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);
  }
  ctx.restore();
}

function drawCanopy(ctx, rect, seen) {
  ctx.fillStyle = seen ? '#145c32' : '#3d5c45';
  for (const [px, py] of [[0.3, 0.42], [0.55, 0.36], [0.68, 0.58]]) {
    ctx.beginPath();
    ctx.arc(rect.x + rect.s * px, rect.y + rect.s * py, rect.s * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRidge(ctx, rect, color, seen) {
  ctx.fillStyle = seen ? color : shade(color, 0.6);
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.s * 0.18, rect.y + rect.s * 0.72);
  ctx.lineTo(rect.x + rect.s * 0.42, rect.y + rect.s * 0.28);
  ctx.lineTo(rect.x + rect.s * 0.7, rect.y + rect.s * 0.72);
  ctx.fill();
}

function drawRiver(ctx, rect, seen) {
  ctx.strokeStyle = seen ? '#e9fbff' : '#9eb8c4';
  ctx.lineWidth = Math.max(2, rect.s * 0.08);
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.s * 0.2, rect.y + rect.s * 0.15);
  ctx.quadraticCurveTo(rect.x + rect.s * 0.7, rect.y + rect.s * 0.45, rect.x + rect.s * 0.3, rect.y + rect.s * 0.85);
  ctx.stroke();
}

function drawRoad(ctx, state, tile, rect, seen) {
  ctx.strokeStyle = seen ? 'rgba(255, 236, 190, 0.92)' : 'rgba(180, 164, 130, 0.75)';
  ctx.lineWidth = Math.max(3, rect.s * 0.18);
  ctx.lineCap = 'square';
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
    ctx.moveTo(cx - rect.s * 0.16, cy);
    ctx.lineTo(cx + rect.s * 0.16, cy);
  }
  ctx.stroke();
}

function drawBlightSpeck(ctx, rect, blight) {
  ctx.fillStyle = `rgba(90, 60, 120, ${Math.min(0.45, blight / 12)})`;
  ctx.beginPath();
  ctx.arc(rect.x + rect.s * 0.72, rect.y + rect.s * 0.28, rect.s * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function tileRect(frame, x, y) {
  return {
    x: (x - frame.camX) * frame.tile,
    y: (y - frame.camY) * frame.tile,
    s: frame.tile
  };
}

function shortCode(role) {
  const text = String(role || '').toUpperCase();
  if (text.includes('RECON') || text.includes('SCOUT')) return 'SCT';
  if (text.includes('RANG')) return 'BOW';
  if (text.includes('CAV')) return 'CAV';
  if (text.includes('SIEGE') || text.includes('ONAGER')) return 'SEG';
  if (text.includes('BUILD') || text.includes('ENG')) return 'ENG';
  if (text.includes('SPEAR')) return 'SPR';
  if (text.includes('BOSS') || text.includes('CROWN')) return 'BOSS';
  if (text.includes('UNDEAD') || text.includes('THRALL') || text.includes('BONE')) return 'DED';
  return text.slice(0, 3) || 'UNT';
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
