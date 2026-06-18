import { BUILDING_TYPES, FACTIONS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from './content.js';
import { idx, manhattan } from './map.js';
import { buildingAt, canBuildOn, findPath, getStrategicMapLens, getTileSummary, getUnitDef, isEnemy, isRevealed, isVisible, tileAt, unitAt } from './rules.js';

const TERRAIN_COLORS = {
  plains: '#8caf62',
  forest: '#386c45',
  hills: '#9a875a',
  mountains: '#7f8284',
  river: '#407fb4',
  marsh: '#4d765c',
  ruins: '#9a9079',
  blight: '#54515e'
};

const FACTION_COLORS = Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction.id, faction.color]));
const LENS_COLORS = {
  dead: '#9cf38a',
  roads: '#ffd76b',
  supply: '#baf58c',
  alliance: '#88d8ff'
};

export function getLayout(canvas) {
  const tileSize = Math.floor(Math.min(canvas.width / MAP_WIDTH, canvas.height / MAP_HEIGHT));
  const mapWidth = tileSize * MAP_WIDTH;
  const mapHeight = tileSize * MAP_HEIGHT;
  return {
    tileSize,
    offsetX: Math.floor((canvas.width - mapWidth) / 2),
    offsetY: Math.floor((canvas.height - mapHeight) / 2),
    mapWidth,
    mapHeight
  };
}

export function pointToTile(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const layout = getLayout(canvas);
  return {
    x: Math.floor((x - layout.offsetX) / layout.tileSize),
    y: Math.floor((y - layout.offsetY) / layout.tileSize)
  };
}

export function drawGame(canvas, state, hoverTile = null, lensId = 'normal') {
  const ctx = canvas.getContext('2d');
  const layout = getLayout(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackdrop(ctx, canvas);
  drawTiles(ctx, state, layout);
  drawStrategicLens(ctx, state, layout, lensId);
  drawReachable(ctx, state, layout);
  drawBuildSites(ctx, state, layout);
  drawBuildings(ctx, state, layout);
  drawUnits(ctx, state, layout);
  drawSelection(ctx, state, layout, hoverTile);
  drawFog(ctx, state, layout);
  drawMiniMap(ctx, state, layout, lensId);
  drawStatusRibbon(ctx, state, layout);
}

function drawBackdrop(ctx, canvas) {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#101723');
  gradient.addColorStop(1, '#080a0f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawTiles(ctx, state, layout) {
  for (const tile of state.map.tiles) {
    const x = layout.offsetX + tile.x * layout.tileSize;
    const y = layout.offsetY + tile.y * layout.tileSize;
    const revealed = isRevealed(state, tile.x, tile.y);
    if (!revealed) {
      ctx.fillStyle = '#050608';
      ctx.fillRect(x, y, layout.tileSize, layout.tileSize);
      continue;
    }
    const visible = isVisible(state, tile.x, tile.y);
    const base = TERRAIN_COLORS[tile.terrain] || '#777';
    ctx.fillStyle = shade(base, (tile.elevation - 0.5) * 36 + (visible ? 0 : -22));
    ctx.fillRect(x, y, layout.tileSize, layout.tileSize);
    drawTerrainTexture(ctx, tile, x, y, layout.tileSize, visible);
    if (tile.road) drawRoad(ctx, x, y, layout.tileSize, visible);
    if (tile.blight > 0 && tile.terrain !== 'blight') drawBlightVeins(ctx, x, y, layout.tileSize, tile.blight, visible);
    ctx.strokeStyle = visible ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, layout.tileSize - 1, layout.tileSize - 1);
  }
}

function drawTerrainTexture(ctx, tile, x, y, s, visible) {
  const alpha = visible ? 0.55 : 0.26;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (tile.terrain === 'forest') {
    ctx.fillStyle = '#173d27';
    for (let i = 0; i < 3; i += 1) {
      const px = x + s * (0.25 + i * 0.25);
      const py = y + s * (0.25 + ((tile.x + tile.y + i) % 3) * 0.15);
      triangle(ctx, px, py, s * 0.18, '#1f5b36');
      ctx.fillRect(px - s * 0.025, py + s * 0.12, s * 0.05, s * 0.14);
    }
  } else if (tile.terrain === 'hills') {
    ctx.strokeStyle = '#5e4d33';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.arc(x + s * 0.35, y + s * 0.62, s * 0.24, Math.PI, 0);
    ctx.arc(x + s * 0.65, y + s * 0.65, s * 0.22, Math.PI, 0);
    ctx.stroke();
  } else if (tile.terrain === 'mountains') {
    ctx.fillStyle = '#dad5c5';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * 0.82);
    ctx.lineTo(x + s * 0.45, y + s * 0.2);
    ctx.lineTo(x + s * 0.72, y + s * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#777a7e';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.42, y + s * 0.28);
    ctx.lineTo(x + s * 0.52, y + s * 0.82);
    ctx.lineTo(x + s * 0.72, y + s * 0.82);
    ctx.closePath();
    ctx.fill();
  } else if (tile.terrain === 'river') {
    ctx.strokeStyle = '#b6e0ff';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y + s * 0.55);
    ctx.bezierCurveTo(x + s * 0.35, y + s * 0.3, x + s * 0.65, y + s * 0.8, x + s * 0.9, y + s * 0.45);
    ctx.stroke();
  } else if (tile.terrain === 'marsh') {
    ctx.strokeStyle = '#233b2d';
    ctx.lineWidth = Math.max(1, s * 0.04);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + s * (0.2 + i * 0.22), y + s * 0.65);
      ctx.quadraticCurveTo(x + s * (0.28 + i * 0.22), y + s * 0.45, x + s * (0.36 + i * 0.22), y + s * 0.65);
      ctx.stroke();
    }
  } else if (tile.terrain === 'ruins') {
    ctx.fillStyle = '#5e574a';
    ctx.fillRect(x + s * 0.25, y + s * 0.25, s * 0.14, s * 0.42);
    ctx.fillRect(x + s * 0.52, y + s * 0.18, s * 0.14, s * 0.50);
    ctx.fillRect(x + s * 0.2, y + s * 0.68, s * 0.55, s * 0.08);
  } else if (tile.terrain === 'blight') {
    drawBlightVeins(ctx, x, y, s, Math.max(5, tile.blight), true);
    ctx.fillStyle = 'rgba(170, 238, 140, 0.15)';
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRoad(ctx, x, y, s, visible) {
  ctx.save();
  ctx.globalAlpha = visible ? 0.7 : 0.35;
  ctx.strokeStyle = '#c9b47a';
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.52);
  ctx.lineTo(x + s, y + s * 0.52);
  ctx.stroke();
  ctx.restore();
}

function drawBlightVeins(ctx, x, y, s, blight, visible) {
  ctx.save();
  ctx.globalAlpha = visible ? 0.22 + blight * 0.035 : 0.18;
  ctx.strokeStyle = '#9cf38a';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y + s * 0.25);
  ctx.lineTo(x + s * 0.48, y + s * 0.54);
  ctx.lineTo(x + s * 0.32, y + s * 0.86);
  ctx.moveTo(x + s * 0.48, y + s * 0.54);
  ctx.lineTo(x + s * 0.83, y + s * 0.44);
  ctx.stroke();
  ctx.restore();
}

function drawStrategicLens(ctx, state, layout, lensId) {
  const lens = getStrategicMapLens(state, lensId);
  if (lens.id === 'normal') return;
  ctx.save();
  for (const tile of lens.tiles) {
    const x = layout.offsetX + tile.x * layout.tileSize;
    const y = layout.offsetY + tile.y * layout.tileSize;
    const color = lensColor(tile.tone);
    const alpha = tile.visible ? 0.24 : 0.14;
    ctx.globalAlpha = alpha * (tile.strength || 1);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, layout.tileSize - 2, layout.tileSize - 2);
    if (tile.kind === 'road') {
      ctx.globalAlpha = tile.visible ? 0.9 : 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.16);
      ctx.beginPath();
      ctx.moveTo(x + layout.tileSize * 0.12, y + layout.tileSize * 0.5);
      ctx.lineTo(x + layout.tileSize * 0.88, y + layout.tileSize * 0.5);
      ctx.stroke();
    } else if (tile.kind === 'allianceVision') {
      ctx.globalAlpha = tile.visible ? 0.6 : 0.34;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, layout.tileSize * 0.04);
      ctx.strokeRect(x + 3, y + 3, layout.tileSize - 6, layout.tileSize - 6);
    }
  }
  ctx.globalAlpha = 1;
  for (const marker of lens.markers) {
    const x = layout.offsetX + marker.x * layout.tileSize;
    const y = layout.offsetY + marker.y * layout.tileSize;
    const color = lensColor(marker.tone);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, layout.tileSize * 0.07);
    ctx.globalAlpha = marker.visible ? 0.95 : 0.5;
    ctx.strokeRect(x + 3, y + 3, layout.tileSize - 6, layout.tileSize - 6);
    ctx.beginPath();
    ctx.arc(x + layout.tileSize * 0.5, y + layout.tileSize * 0.18, Math.max(2, layout.tileSize * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawReachable(ctx, state, layout) {
  const unit = state.units.find((u) => u.id === state.selectedUnitId && u.faction === 'olundar');
  if (!unit || unit.hasActed) return;
  const def = getUnitDef(unit);
  ctx.save();
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const p = findPath(state, unit, x, y, def.move);
      if (!p || (x === unit.x && y === unit.y)) continue;
      const sx = layout.offsetX + x * layout.tileSize;
      const sy = layout.offsetY + y * layout.tileSize;
      ctx.fillStyle = 'rgba(255, 244, 176, 0.14)';
      ctx.fillRect(sx + 2, sy + 2, layout.tileSize - 4, layout.tileSize - 4);
    }
  }
  ctx.restore();
}

function drawBuildSites(ctx, state, layout) {
  if (state.mode.type !== 'build') return;
  const builder = state.units.find((u) => u.id === state.mode.builderId);
  if (!builder) return;
  ctx.save();
  for (let y = builder.y - 1; y <= builder.y + 1; y += 1) {
    for (let x = builder.x - 1; x <= builder.x + 1; x += 1) {
      if (Math.abs(builder.x - x) + Math.abs(builder.y - y) > 1 || !inMap(x, y)) continue;
      const result = canBuildOn(state, state.mode.buildingType, x, y);
      const sx = layout.offsetX + x * layout.tileSize;
      const sy = layout.offsetY + y * layout.tileSize;
      ctx.fillStyle = result.ok ? 'rgba(186, 245, 140, 0.2)' : 'rgba(255, 138, 138, 0.16)';
      ctx.fillRect(sx + 2, sy + 2, layout.tileSize - 4, layout.tileSize - 4);
      ctx.strokeStyle = result.ok ? '#baf58c' : '#ff8a8a';
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.06);
      ctx.strokeRect(sx + 3, sy + 3, layout.tileSize - 6, layout.tileSize - 6);
    }
  }
  ctx.restore();
}

function drawBuildings(ctx, state, layout) {
  for (const building of state.buildings) {
    if (!isVisible(state, building.x, building.y)) continue;
    const x = layout.offsetX + building.x * layout.tileSize;
    const y = layout.offsetY + building.y * layout.tileSize;
    drawBuildingSprite(ctx, building, x, y, layout.tileSize);
  }
}

function drawUnits(ctx, state, layout) {
  const sorted = state.units.slice().sort((a, b) => a.y - b.y);
  for (const unit of sorted) {
    if (!isVisible(state, unit.x, unit.y)) continue;
    const x = layout.offsetX + unit.x * layout.tileSize;
    const y = layout.offsetY + unit.y * layout.tileSize;
    drawUnitSprite(ctx, unit, x, y, layout.tileSize, state);
  }
}

function drawBuildingSprite(ctx, building, x, y, s) {
  const def = BUILDING_TYPES[building.type];
  const color = FACTION_COLORS[building.faction] || '#eee';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = s * 0.08;
  ctx.shadowOffsetY = s * 0.05;
  if (building.type === 'portal') {
    ctx.fillStyle = 'rgba(20,10,28,0.85)';
    ellipse(ctx, x + s * 0.5, y + s * 0.53, s * 0.34, s * 0.42);
    ctx.strokeStyle = '#9cf38a';
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.28, 0.2, Math.PI * 1.75);
    ctx.stroke();
    ctx.strokeStyle = '#f4f0ff';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.18, Math.PI, Math.PI * 2.3);
    ctx.stroke();
  } else if (building.type === 'city') {
    ctx.fillStyle = color;
    ctx.fillRect(x + s * 0.2, y + s * 0.44, s * 0.6, s * 0.35);
    ctx.fillStyle = '#6b4d38';
    roof(ctx, x + s * 0.16, y + s * 0.45, s * 0.68, s * 0.24);
    ctx.fillStyle = '#222a33';
    ctx.fillRect(x + s * 0.45, y + s * 0.62, s * 0.12, s * 0.17);
  } else if (building.type === 'watchtower') {
    ctx.fillStyle = '#5e452e';
    ctx.fillRect(x + s * 0.42, y + s * 0.28, s * 0.16, s * 0.48);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.3, y + s * 0.3);
    ctx.lineTo(x + s * 0.5, y + s * 0.12);
    ctx.lineTo(x + s * 0.7, y + s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + s * 0.29, y + s * 0.28, s * 0.42, s * 0.14);
  } else if (building.type === 'wall') {
    ctx.fillStyle = '#8a8e91';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(x + s * (0.08 + i * 0.22), y + s * 0.35, s * 0.16, s * 0.42);
  } else if (building.type === 'road') {
    // Road drawn as terrain overlay.
  } else if (['bonePit', 'graveForge', 'necropolis'].includes(building.type)) {
    ctx.fillStyle = '#192119';
    ctx.fillRect(x + s * 0.22, y + s * 0.40, s * 0.56, s * 0.35);
    ctx.fillStyle = '#9cf38a';
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y + s * 0.38, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(x + s * 0.42, y + s * 0.45, s * 0.16, s * 0.3);
  } else {
    ctx.fillStyle = '#493728';
    ctx.fillRect(x + s * 0.22, y + s * 0.48, s * 0.56, s * 0.3);
    ctx.fillStyle = color;
    roof(ctx, x + s * 0.18, y + s * 0.48, s * 0.64, s * 0.20);
  }
  if (building.turnsLeft > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.18);
    ctx.fillStyle = '#f2e8bd';
    ctx.font = `${Math.max(9, s * 0.22)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(`${building.turnsLeft}t`, x + s * 0.5, y + s * 0.24);
  }
  drawHealthBar(ctx, x + s * 0.16, y + s * 0.86, s * 0.68, s * 0.06, building.hp / building.maxHp);
  if (def.glyph && building.type !== 'road') drawSmallGlyph(ctx, def.glyph, x + s * 0.5, y + s * 0.58, s, building.type === 'portal' ? '#f4f0ff' : '#1d1d1d');
  ctx.restore();
}

function drawUnitSprite(ctx, unit, x, y, s, state) {
  const def = UNIT_TYPES[unit.type];
  const color = FACTION_COLORS[unit.faction] || '#eee';
  const enemy = unit.faction !== 'olundar' && isEnemy(state, 'olundar', unit.faction);
  const cx = x + s * 0.5;
  const cy = y + s * 0.54;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = s * 0.08;
  ctx.shadowOffsetY = s * 0.04;
  ctx.fillStyle = enemy ? '#171717' : '#202632';
  ellipse(ctx, cx, y + s * 0.78, s * 0.28, s * 0.09);
  if (def.tags.includes('undead')) {
    drawUndead(ctx, unit, x, y, s);
  } else if (unit.type === 'cavalry') {
    drawCavalry(ctx, color, x, y, s);
  } else if (unit.type === 'onager') {
    drawOnager(ctx, color, x, y, s);
  } else {
    drawLivingSoldier(ctx, unit, color, x, y, s);
  }
  if (unit.hasActed && unit.faction === 'olundar') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  if (unit.fortified) {
    ctx.strokeStyle = '#f6e7a2';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.strokeRect(x + s * 0.2, y + s * 0.18, s * 0.6, s * 0.6);
  }
  drawHealthBar(ctx, x + s * 0.2, y + s * 0.88, s * 0.6, s * 0.06, unit.hp / unit.maxHp);
  ctx.restore();
}

function drawLivingSoldier(ctx, unit, color, x, y, s) {
  const cx = x + s * 0.5;
  ctx.fillStyle = '#d2c2a0';
  ctx.beginPath();
  ctx.arc(cx, y + s * 0.33, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x + s * 0.38, y + s * 0.45, s * 0.24, s * 0.25);
  if (unit.type === 'legionary' || unit.type === 'spearGuard') {
    ctx.fillStyle = '#b6bec8';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.33, y + s * 0.42);
    ctx.lineTo(x + s * 0.25, y + s * 0.62);
    ctx.lineTo(x + s * 0.34, y + s * 0.78);
    ctx.lineTo(x + s * 0.44, y + s * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2b2218';
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.68, y + s * 0.23);
    ctx.lineTo(x + s * 0.68, y + s * 0.8);
    ctx.stroke();
  } else if (unit.type === 'archer') {
    ctx.strokeStyle = '#4b2f1d';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.beginPath();
    ctx.arc(x + s * 0.67, y + s * 0.5, s * 0.22, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = '#f5ebcb';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.67, y + s * 0.28);
    ctx.lineTo(x + s * 0.67, y + s * 0.72);
    ctx.stroke();
  } else if (unit.type === 'engineer') {
    ctx.strokeStyle = '#322318';
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.65, y + s * 0.42);
    ctx.lineTo(x + s * 0.78, y + s * 0.28);
    ctx.stroke();
    ctx.fillStyle = '#a9a9a9';
    ctx.fillRect(x + s * 0.73, y + s * 0.22, s * 0.16, s * 0.08);
  } else if (unit.type === 'scout') {
    ctx.fillStyle = '#2b3a2f';
    ctx.beginPath();
    ctx.moveTo(cx, y + s * 0.17);
    ctx.lineTo(x + s * 0.32, y + s * 0.5);
    ctx.lineTo(x + s * 0.68, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  drawSmallGlyph(ctx, UNIT_TYPES[unit.type].glyph, cx, y + s * 0.62, s, '#111');
}

function drawCavalry(ctx, color, x, y, s) {
  ctx.fillStyle = '#5b3a24';
  ctx.fillRect(x + s * 0.22, y + s * 0.48, s * 0.48, s * 0.2);
  ctx.beginPath();
  ctx.arc(x + s * 0.72, y + s * 0.44, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x + s * 0.42, y + s * 0.30, s * 0.18, s * 0.22);
  ctx.strokeStyle = '#322318';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.55, y + s * 0.25);
  ctx.lineTo(x + s * 0.70, y + s * 0.75);
  ctx.stroke();
  drawSmallGlyph(ctx, 'C', x + s * 0.5, y + s * 0.61, s, '#111');
}

function drawOnager(ctx, color, x, y, s) {
  ctx.fillStyle = '#5b3a24';
  ctx.fillRect(x + s * 0.25, y + s * 0.48, s * 0.5, s * 0.18);
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.38, y + s * 0.5);
  ctx.lineTo(x + s * 0.68, y + s * 0.25);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + s * 0.35, y + s * 0.72, s * 0.09, 0, Math.PI * 2);
  ctx.arc(x + s * 0.68, y + s * 0.72, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  drawSmallGlyph(ctx, 'O', x + s * 0.5, y + s * 0.57, s, '#111');
}

function drawUndead(ctx, unit, x, y, s) {
  const cx = x + s * 0.5;
  const elite = unit.type === 'graveKnight' || unit.type === 'lichBoss';
  ctx.fillStyle = elite ? '#2c3335' : '#d8d8c8';
  ctx.fillRect(x + s * 0.38, y + s * 0.45, s * 0.24, s * 0.27);
  ctx.fillStyle = '#e6e5d5';
  ctx.beginPath();
  ctx.arc(cx, y + s * 0.32, s * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(x + s * 0.46, y + s * 0.31, s * 0.025, 0, Math.PI * 2);
  ctx.arc(x + s * 0.54, y + s * 0.31, s * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9cf38a';
  ctx.lineWidth = Math.max(1, s * 0.025);
  if (unit.type === 'corpseArcher') {
    ctx.beginPath();
    ctx.arc(x + s * 0.67, y + s * 0.5, s * 0.20, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.66, y + s * 0.28);
    ctx.lineTo(x + s * 0.72, y + s * 0.76);
    ctx.stroke();
  }
  if (unit.type === 'lichBoss') {
    ctx.fillStyle = '#9cf38a';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.35, y + s * 0.2);
    ctx.lineTo(x + s * 0.43, y + s * 0.08);
    ctx.lineTo(x + s * 0.5, y + s * 0.2);
    ctx.lineTo(x + s * 0.58, y + s * 0.08);
    ctx.lineTo(x + s * 0.66, y + s * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  drawSmallGlyph(ctx, UNIT_TYPES[unit.type].glyph, cx, y + s * 0.62, s, unit.type === 'lichBoss' ? '#9cf38a' : '#111');
}

function drawFog(ctx, state, layout) {
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const sx = layout.offsetX + x * layout.tileSize;
      const sy = layout.offsetY + y * layout.tileSize;
      if (!isRevealed(state, x, y)) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(sx, sy, layout.tileSize, layout.tileSize);
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(sx + layout.tileSize * 0.2, sy + layout.tileSize * 0.2, layout.tileSize * 0.6, layout.tileSize * 0.6);
        }
      } else if (!isVisible(state, x, y)) {
        ctx.fillStyle = 'rgba(2,6,12,0.46)';
        ctx.fillRect(sx, sy, layout.tileSize, layout.tileSize);
      }
    }
  }
}

function drawSelection(ctx, state, layout, hoverTile) {
  const drawBox = (x, y, stroke, width = 3) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.strokeRect(layout.offsetX + x * layout.tileSize + 2, layout.offsetY + y * layout.tileSize + 2, layout.tileSize - 4, layout.tileSize - 4);
  };
  if (state.selectedUnitId) {
    const unit = state.units.find((u) => u.id === state.selectedUnitId);
    if (unit) drawBox(unit.x, unit.y, '#ffe08a');
    if (unit && !unit.hasActed) {
      for (const target of state.units) {
        if (target.id !== unit.id && isEnemy(state, unit.faction, target.faction) && isVisible(state, target.x, target.y) && manhattan(unit.x, unit.y, target.x, target.y) <= UNIT_TYPES[unit.type].range) {
          drawBox(target.x, target.y, '#ff6b6b', 2);
        }
      }
      for (const target of state.buildings) {
        if (isEnemy(state, unit.faction, target.faction) && isVisible(state, target.x, target.y) && manhattan(unit.x, unit.y, target.x, target.y) <= UNIT_TYPES[unit.type].range) {
          drawBox(target.x, target.y, '#ff6b6b', 2);
        }
      }
    }
  }
  if (state.selectedBuildingId) {
    const building = state.buildings.find((b) => b.id === state.selectedBuildingId);
    if (building) drawBox(building.x, building.y, '#88d8ff');
  }
  if (hoverTile && inMap(hoverTile.x, hoverTile.y)) {
    drawBox(hoverTile.x, hoverTile.y, state.mode.type === 'build' ? '#baf58c' : '#ffffff', 2);
  }
}

function drawMiniMap(ctx, state, layout, lensId = 'normal') {
  const scale = Math.max(2, Math.floor(layout.tileSize * 0.22));
  const w = MAP_WIDTH * scale;
  const h = MAP_HEIGHT * scale;
  const x0 = layout.offsetX + layout.mapWidth - w - 8;
  const y0 = layout.offsetY + 8;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
  for (const tile of state.map.tiles) {
    let color = '#030304';
    if (isRevealed(state, tile.x, tile.y)) color = isVisible(state, tile.x, tile.y) ? (TERRAIN_COLORS[tile.terrain] || '#777') : '#333943';
    ctx.fillStyle = color;
    ctx.fillRect(x0 + tile.x * scale, y0 + tile.y * scale, scale, scale);
  }
  const lens = getStrategicMapLens(state, lensId);
  if (lens.id !== 'normal') {
    for (const tile of lens.tiles) {
      ctx.fillStyle = lensColor(tile.tone);
      ctx.fillRect(x0 + tile.x * scale, y0 + tile.y * scale, scale, scale);
    }
  }
  for (const building of state.buildings) {
    if (!isRevealed(state, building.x, building.y)) continue;
    ctx.fillStyle = FACTION_COLORS[building.faction] || '#fff';
    ctx.fillRect(x0 + building.x * scale - 1, y0 + building.y * scale - 1, scale + 2, scale + 2);
  }
  ctx.strokeStyle = '#f5e8b7';
  ctx.strokeRect(x0 - 4, y0 - 4, w + 8, h + 8);
  ctx.restore();
}

function drawStatusRibbon(ctx, state, layout) {
  if (state.status === 'playing') return;
  const text = state.status === 'won' ? 'OLUNDAR SURVIVES' : 'OLUNDAR FALLS';
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.76)';
  ctx.fillRect(layout.offsetX, layout.offsetY + layout.mapHeight * 0.42, layout.mapWidth, layout.mapHeight * 0.16);
  ctx.fillStyle = state.status === 'won' ? '#baf58c' : '#ff8a8a';
  ctx.font = `700 ${Math.floor(layout.tileSize * 1.2)}px Cinzel, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText(text, layout.offsetX + layout.mapWidth / 2, layout.offsetY + layout.mapHeight * 0.52);
  ctx.restore();
}

export function describeSelection(state) {
  const unit = state.units.find((u) => u.id === state.selectedUnitId);
  if (unit) {
    const def = UNIT_TYPES[unit.type];
    return {
      title: `${unit.name}`,
      subtitle: `${FACTIONS[unit.faction].name} · ${def.role}`,
      body: `${def.text} HP ${unit.hp}/${unit.maxHp}. Move ${def.move}, attack ${def.attack}, range ${def.range}, sight ${def.sight}.`,
      faction: unit.faction,
      unit,
      building: null
    };
  }
  const building = state.buildings.find((b) => b.id === state.selectedBuildingId);
  if (building) {
    const def = BUILDING_TYPES[building.type];
    const queue = building.queue?.length ? ` Queue: ${building.queue.map((item) => `${UNIT_TYPES[item.unitType].name} ${item.turnsLeft}t`).join(', ')}.` : '';
    return {
      title: `${building.name}`,
      subtitle: `${FACTIONS[building.faction].name} · ${def.name} · Tier ${(building.upgraded || 0) + 1}`,
      body: `${def.text} HP ${building.hp}/${building.maxHp}.${building.turnsLeft > 0 ? ` Completes in ${building.turnsLeft} turns.` : ' Upgrades improve durability, vision, and strategic output.'}${queue}`,
      faction: building.faction,
      unit: null,
      building
    };
  }
  return null;
}

export function describeTilePanel(state, x, y) {
  const summary = getTileSummary(state, x, y);
  if (!summary) return '';
  if (summary.hidden) return `<h3>${summary.title}</h3><p>${summary.text}</p>`;
  const unit = summary.unit ? `<p><strong>Unit:</strong> ${summary.unit.name} (${FACTIONS[summary.unit.faction].name})</p>` : '';
  const building = summary.building ? `<p><strong>Structure:</strong> ${summary.building.name} (${FACTIONS[summary.building.faction].name})</p>` : '';
  const blight = summary.blight ? `<p><strong>Blight:</strong> ${summary.blight}/9</p>` : '';
  const road = summary.road ? '<p><strong>Road:</strong> movement network present.</p>' : '';
  return `<h3>${summary.title}</h3><p>${summary.text}</p><p><strong>Elevation:</strong> ${summary.elevation} · <strong>Moisture:</strong> ${summary.moisture}</p>${blight}${road}${unit}${building}`;
}

function drawHealthBar(ctx, x, y, w, h, pct) {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = pct > 0.55 ? '#baf58c' : pct > 0.25 ? '#ffd76b' : '#ff6b6b';
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, pct)), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawSmallGlyph(ctx, glyph, x, y, s, color = '#111') {
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.max(9, s * 0.28)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y);
}

function triangle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.lineTo(x + r, y + r);
  ctx.closePath();
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

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function lensColor(tone) {
  return FACTION_COLORS[tone] || LENS_COLORS[tone] || LENS_COLORS.alliance;
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = clampColor((n >> 16) + amount);
  const g = clampColor(((n >> 8) & 255) + amount);
  const b = clampColor((n & 255) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function inMap(x, y) {
  return x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
}
