import { BUILDING_TYPES, FACTIONS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from './content.js';
import { idx, manhattan } from './map.js';
import { buildingAt, canBuildOn, findPath, getStrategicMapLens, getTileSummary, getUnitDef, isEnemy, isRevealed, isVisible, tileAt, unitAt } from './rules.js';

const TERRAIN_COLORS = {
  plains: '#b7c86f',
  forest: '#3f7e43',
  hills: '#bd9654',
  mountains: '#8f928b',
  river: '#3e98c7',
  marsh: '#5a8a63',
  ruins: '#b5a17a',
  blight: '#64546c'
};

const TERRAIN_HIGHLIGHTS = {
  plains: '#f1dc8c',
  forest: '#77ba64',
  hills: '#f0c36e',
  mountains: '#dde1df',
  river: '#bfe9ff',
  marsh: '#9ed49c',
  ruins: '#ead38f',
  blight: '#a9f28c'
};

const UNIT_ACCENTS = {
  scout: '#7ab87a',
  legionary: '#d6dde5',
  spearGuard: '#e6d38c',
  archer: '#d79858',
  cavalry: '#d0a071',
  engineer: '#b8c0c5',
  onager: '#c99552',
  boneThrall: '#d8d8c8',
  corpseArcher: '#9cf38a',
  graveKnight: '#aeb8ba',
  lichBoss: '#9cf38a'
};

const FACTION_COLORS = Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction.id, faction.color]));
const LENS_COLORS = {
  dead: '#9cf38a',
  roads: '#ffd76b',
  supply: '#baf58c',
  mission: '#f0c866',
  alliance: '#88d8ff'
};

export function getLayout(canvas) {
  const camera = canvas.__olundarState ? getCameraBounds(canvas.__olundarState) : {
    x: 0,
    y: 0,
    width: MAP_WIDTH,
    height: MAP_HEIGHT
  };
  const tileSize = Math.max(8, Math.floor(Math.min(canvas.width / camera.width, canvas.height / camera.height)));
  const mapWidth = tileSize * camera.width;
  const mapHeight = tileSize * camera.height;
  const frameX = Math.floor((canvas.width - mapWidth) / 2);
  const frameY = Math.floor((canvas.height - mapHeight) / 2);
  return {
    tileSize,
    offsetX: frameX - camera.x * tileSize,
    offsetY: frameY - camera.y * tileSize,
    frameX,
    frameY,
    mapWidth,
    mapHeight,
    camera
  };
}

function getCameraBounds(state) {
  const revealed = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (isRevealed(state, x, y)) revealed.push({ x, y });
    }
  }
  const selected = state.units.find((unit) => unit.id === state.selectedUnitId)
    || state.buildings.find((building) => building.id === state.selectedBuildingId)
    || state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city')
    || state.units.find((unit) => unit.faction === 'olundar');
  const minX = revealed.length ? Math.min(...revealed.map((tile) => tile.x)) : selected?.x || 0;
  const maxX = revealed.length ? Math.max(...revealed.map((tile) => tile.x)) : selected?.x || MAP_WIDTH - 1;
  const minY = revealed.length ? Math.min(...revealed.map((tile) => tile.y)) : selected?.y || 0;
  const maxY = revealed.length ? Math.max(...revealed.map((tile) => tile.y)) : selected?.y || MAP_HEIGHT - 1;
  const revealedWidth = maxX - minX + 1;
  const revealedHeight = maxY - minY + 1;
  const width = Math.min(MAP_WIDTH, Math.max(20, revealedWidth + 10));
  const height = Math.min(MAP_HEIGHT, Math.max(15, revealedHeight + 8));
  const centerX = selected ? selected.x : (minX + maxX) / 2;
  const centerY = selected ? selected.y : (minY + maxY) / 2;
  return {
    x: clamp(Math.round(centerX - width / 2), 0, Math.max(0, MAP_WIDTH - width)),
    y: clamp(Math.round(centerY - height / 2), 0, Math.max(0, MAP_HEIGHT - height)),
    width,
    height
  };
}

export function pointToTile(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const layout = getLayout(canvas);
  if (x < layout.frameX || y < layout.frameY || x > layout.frameX + layout.mapWidth || y > layout.frameY + layout.mapHeight) {
    return { x: -1, y: -1 };
  }
  return {
    x: Math.floor((x - layout.offsetX) / layout.tileSize),
    y: Math.floor((y - layout.offsetY) / layout.tileSize)
  };
}

export function drawGame(canvas, state, hoverTile = null, lensId = 'normal', routeOverlay = null, missionFocusOverlay = null, battleImpact = null) {
  canvas.__olundarState = state;
  const ctx = canvas.getContext('2d');
  const layout = getLayout(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackdrop(ctx, canvas);
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  ctx.clip();
  drawTiles(ctx, state, layout);
  drawStrategicLens(ctx, state, layout, lensId);
  drawReachable(ctx, state, layout);
  drawMissionRoute(ctx, state, layout, routeOverlay);
  drawMissionFocus(ctx, state, layout, missionFocusOverlay);
  drawBuildSites(ctx, state, layout);
  drawBuildings(ctx, state, layout);
  drawUnits(ctx, state, layout);
  drawSelection(ctx, state, layout, hoverTile);
  drawFog(ctx, state, layout);
  drawBattleImpact(ctx, state, layout, battleImpact);
  ctx.restore();
  drawImperialMapFrame(ctx, layout);
  drawMiniMap(ctx, state, layout, lensId);
  drawStatusRibbon(ctx, state, layout);
}

function drawBattleImpact(ctx, state, layout, impact) {
  if (!impact || !isVisible(state, impact.x, impact.y)) return;
  const x = layout.offsetX + impact.x * layout.tileSize;
  const y = layout.offsetY + impact.y * layout.tileSize;
  const s = layout.tileSize;
  const color = impact.tone === 'bad' ? '#ff8a8a' : impact.tone === 'good' ? '#baf58c' : '#f0c866';
  const fill = impact.tone === 'bad'
    ? 'rgba(255, 138, 138, 0.20)'
    : impact.tone === 'good'
      ? 'rgba(186, 245, 140, 0.18)'
      : 'rgba(240, 200, 102, 0.18)';
  const label = impact.portalReforms ? 'REFORM' : impact.targetDestroyed ? 'BREAK' : `-${impact.damage || 0}`;
  ctx.save();
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.strokeStyle = 'rgba(5, 7, 10, 0.84)';
  ctx.strokeRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84);
  ctx.strokeStyle = color;
  ctx.strokeRect(x + s * 0.13, y + s * 0.13, s * 0.74, s * 0.74);
  ctx.fillStyle = fill;
  ctx.fillRect(x + s * 0.18, y + s * 0.18, s * 0.64, s * 0.64);
  ctx.fillStyle = 'rgba(5, 7, 10, 0.86)';
  ctx.fillRect(x + s * 0.18, y + s * 0.04, s * 0.64, s * 0.24);
  ctx.fillStyle = color;
  ctx.font = `900 ${Math.max(8, s * 0.20)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + s * 0.5, y + s * 0.16);
  ctx.restore();
}

function drawMissionFocus(ctx, state, layout, overlay) {
  if (!overlay || !isRevealed(state, overlay.x, overlay.y)) return;
  const x = layout.offsetX + overlay.x * layout.tileSize;
  const y = layout.offsetY + overlay.y * layout.tileSize;
  const s = layout.tileSize;
  ctx.save();
  ctx.strokeStyle = '#baf58c';
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84);
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#baf58c';
  ctx.fillRect(x + s * 0.14, y + s * 0.14, s * 0.72, s * 0.72);
  ctx.globalAlpha = 1;
  drawMissionSiteMarker(ctx, x, y, s, {
    ...overlay,
    kind: 'missionComplete',
    completed: true,
    visible: true
  }, '#baf58c');
  ctx.restore();
}

function drawBackdrop(ctx, canvas) {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#fff4cf');
  gradient.addColorStop(0.48, '#e9d4a6');
  gradient.addColorStop(1, '#c8d8c9');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#b77d32';
  ctx.lineWidth = 1;
  const gap = Math.max(32, Math.floor(canvas.width / 34));
  for (let x = -gap; x < canvas.width + gap; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + canvas.height * 0.24, canvas.height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTiles(ctx, state, layout) {
  for (const tile of state.map.tiles) {
    const x = layout.offsetX + tile.x * layout.tileSize;
    const y = layout.offsetY + tile.y * layout.tileSize;
    const revealed = isRevealed(state, tile.x, tile.y);
    if (!revealed) {
      drawUnchartedTile(ctx, tile, x, y, layout.tileSize);
      continue;
    }
    const visible = isVisible(state, tile.x, tile.y);
    const base = TERRAIN_COLORS[tile.terrain] || '#777';
    ctx.fillStyle = shade(base, (tile.elevation - 0.5) * 36 + (visible ? 0 : -22));
    ctx.fillRect(x - 0.5, y - 0.5, layout.tileSize + 1, layout.tileSize + 1);
    drawTileRelief(ctx, tile, x, y, layout.tileSize, visible);
    drawTerrainTexture(ctx, tile, x, y, layout.tileSize, visible);
    if (tile.road) drawRoad(ctx, x, y, layout.tileSize, visible);
    if (tile.blight > 0 && tile.terrain !== 'blight') drawBlightVeins(ctx, x, y, layout.tileSize, tile.blight, visible);
    if (!visible) {
      ctx.strokeStyle = 'rgba(44, 33, 25, 0.10)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, layout.tileSize - 1, layout.tileSize - 1);
    }
  }
}

function drawUnchartedTile(ctx, tile, x, y, s) {
  ctx.fillStyle = '#e7d2a2';
  ctx.fillRect(x, y, s, s);
  if ((tile.x * 5 + tile.y * 7) % 19 === 0) {
    ctx.strokeStyle = 'rgba(139, 94, 42, 0.10)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * 0.72);
    ctx.quadraticCurveTo(x + s * 0.46, y + s * 0.42, x + s * 0.84, y + s * 0.60);
    ctx.stroke();
  }
}

function drawTileRelief(ctx, tile, x, y, s, visible) {
  const highlight = TERRAIN_HIGHLIGHTS[tile.terrain] || '#ffffff';
  ctx.save();
  const gradient = ctx.createLinearGradient(x, y, x + s, y + s);
  gradient.addColorStop(0, visible ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, visible ? 'rgba(0,0,0,0.24)' : 'rgba(0,0,0,0.32)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, s, s);

  if (visible && tile.elevation > 0.58 && tile.terrain !== 'river') {
    ctx.globalAlpha = Math.min(0.34, 0.08 + tile.elevation * 0.22);
    ctx.strokeStyle = highlight;
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.16, y + s * (0.72 - tile.elevation * 0.16));
    ctx.quadraticCurveTo(x + s * 0.46, y + s * (0.52 - tile.elevation * 0.10), x + s * 0.84, y + s * (0.64 - tile.elevation * 0.13));
    ctx.stroke();
  }

  if (visible && tile.moisture > 0.68 && tile.terrain !== 'mountains') {
    ctx.globalAlpha = Math.min(0.18, (tile.moisture - 0.58) * 0.22);
    ctx.fillStyle = '#d9f6ff';
    ctx.beginPath();
    ctx.ellipse(x + s * 0.72, y + s * 0.28, s * 0.15, s * 0.05, -0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTerrainTexture(ctx, tile, x, y, s, visible) {
  const alpha = visible ? 0.55 : 0.26;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (tile.terrain === 'plains') {
    ctx.strokeStyle = 'rgba(63, 117, 52, 0.45)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    for (let i = 0; i < 4; i += 1) {
      const px = x + s * (0.18 + i * 0.19);
      const py = y + s * (0.42 + ((tile.x * 3 + tile.y + i) % 4) * 0.08);
      ctx.beginPath();
      ctx.moveTo(px, py + s * 0.16);
      ctx.quadraticCurveTo(px + s * 0.04, py + s * 0.05, px + s * 0.12, py);
      ctx.stroke();
    }
    if ((tile.x + tile.y) % 5 === 0) {
      ctx.fillStyle = 'rgba(255, 229, 150, 0.46)';
      ctx.beginPath();
      ctx.arc(x + s * 0.72, y + s * 0.32, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tile.terrain === 'forest') {
    ctx.fillStyle = '#173d27';
    for (let i = 0; i < 3; i += 1) {
      const px = x + s * (0.25 + i * 0.25);
      const py = y + s * (0.25 + ((tile.x + tile.y + i) % 3) * 0.15);
      triangle(ctx, px, py, s * 0.18, '#1f5b36');
      ctx.fillRect(px - s * 0.025, py + s * 0.12, s * 0.05, s * 0.14);
    }
    ctx.globalAlpha = alpha * 0.56;
    ctx.strokeStyle = '#8fcf7a';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * 0.82);
    ctx.lineTo(x + s * 0.82, y + s * 0.20);
    ctx.stroke();
  } else if (tile.terrain === 'hills') {
    ctx.strokeStyle = '#5e4d33';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.arc(x + s * 0.35, y + s * 0.62, s * 0.24, Math.PI, 0);
    ctx.arc(x + s * 0.65, y + s * 0.65, s * 0.22, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(245, 226, 159, 0.68)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.22, y + s * 0.76);
    ctx.quadraticCurveTo(x + s * 0.48, y + s * 0.55, x + s * 0.82, y + s * 0.76);
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
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.45, y + s * 0.2);
    ctx.lineTo(x + s * 0.36, y + s * 0.82);
    ctx.stroke();
  } else if (tile.terrain === 'river') {
    ctx.strokeStyle = '#b6e0ff';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y + s * 0.55);
    ctx.bezierCurveTo(x + s * 0.35, y + s * 0.3, x + s * 0.65, y + s * 0.8, x + s * 0.9, y + s * 0.45);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.16, y + s * 0.49);
    ctx.bezierCurveTo(x + s * 0.38, y + s * 0.34, x + s * 0.62, y + s * 0.70, x + s * 0.84, y + s * 0.43);
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
    ctx.fillStyle = '#d6c8a0';
    ctx.fillRect(x + s * 0.28, y + s * 0.21, s * 0.08, s * 0.06);
    ctx.fillRect(x + s * 0.55, y + s * 0.14, s * 0.08, s * 0.06);
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
  ctx.strokeStyle = 'rgba(54, 39, 23, 0.74)';
  ctx.lineWidth = Math.max(3, s * 0.18);
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.52);
  ctx.lineTo(x + s, y + s * 0.52);
  ctx.stroke();
  ctx.strokeStyle = '#c9b47a';
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.50);
  ctx.lineTo(x + s, y + s * 0.50);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 238, 170, 0.45)';
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.08, y + s * 0.45);
  ctx.lineTo(x + s * 0.92, y + s * 0.45);
  ctx.moveTo(x + s * 0.08, y + s * 0.57);
  ctx.lineTo(x + s * 0.92, y + s * 0.57);
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
    if (marker.kind === 'missionTarget' || marker.kind === 'missionComplete') {
      drawMissionSiteMarker(ctx, x, y, layout.tileSize, marker, color);
    } else {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.07);
      ctx.globalAlpha = marker.visible ? 0.95 : 0.5;
      ctx.strokeRect(x + 3, y + 3, layout.tileSize - 6, layout.tileSize - 6);
      ctx.beginPath();
      ctx.arc(x + layout.tileSize * 0.5, y + layout.tileSize * 0.18, Math.max(2, layout.tileSize * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawMissionSiteMarker(ctx, x, y, s, marker, color) {
  const visibleAlpha = marker.visible ? 1 : 0.58;
  const completed = marker.kind === 'missionComplete' || marker.completed;
  ctx.save();
  ctx.globalAlpha = completed ? visibleAlpha * 0.72 : visibleAlpha;
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  ctx.strokeStyle = completed ? '#baf58c' : color;
  ctx.fillStyle = 'rgba(11, 13, 15, 0.76)';
  ctx.strokeRect(x + s * 0.14, y + s * 0.14, s * 0.72, s * 0.72);
  ctx.fillRect(x + s * 0.18, y + s * 0.18, s * 0.64, s * 0.64);

  if (marker.type === 'repair') drawRepairSite(ctx, x, y, s, completed);
  else if (marker.type === 'raid') drawRaiderSite(ctx, x, y, s, completed);
  else if (marker.type === 'accord') drawAccordSite(ctx, x, y, s, completed);
  else drawCampSite(ctx, x, y, s, completed);

  if (marker.chainLimit && !completed) drawMissionStepBadge(ctx, x, y, s, marker);
  if (completed) drawMissionCheck(ctx, x, y, s);
  ctx.restore();
}

function drawCampSite(ctx, x, y, s, completed) {
  ctx.fillStyle = completed ? '#9fbf7c' : '#f0c866';
  ctx.strokeStyle = '#3e2e1d';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.25, y + s * 0.70);
  ctx.lineTo(x + s * 0.50, y + s * 0.28);
  ctx.lineTo(x + s * 0.75, y + s * 0.70);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = completed ? '#405032' : '#6b4d38';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.50, y + s * 0.34);
  ctx.lineTo(x + s * 0.50, y + s * 0.70);
  ctx.lineTo(x + s * 0.62, y + s * 0.70);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f7e7a8';
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.24, y + s * 0.73);
  ctx.lineTo(x + s * 0.76, y + s * 0.73);
  ctx.stroke();
}

function drawRaiderSite(ctx, x, y, s, completed) {
  ctx.fillStyle = completed ? '#73806b' : '#202226';
  ctx.strokeStyle = completed ? '#baf58c' : '#ff8a8a';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.25, y + s * 0.70);
  ctx.lineTo(x + s * 0.50, y + s * 0.30);
  ctx.lineTo(x + s * 0.75, y + s * 0.70);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = completed ? '#d6f5bd' : '#ffcf6b';
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.30, y + s * 0.34);
  ctx.lineTo(x + s * 0.70, y + s * 0.74);
  ctx.moveTo(x + s * 0.70, y + s * 0.34);
  ctx.lineTo(x + s * 0.30, y + s * 0.74);
  ctx.stroke();
}

function drawAccordSite(ctx, x, y, s, completed) {
  ctx.fillStyle = completed ? '#9fbf7c' : '#f0c866';
  ctx.strokeStyle = completed ? '#d6f5bd' : '#fff0af';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.fillRect(x + s * 0.28, y + s * 0.30, s * 0.18, s * 0.42);
  ctx.fillRect(x + s * 0.54, y + s * 0.30, s * 0.18, s * 0.42);
  ctx.strokeRect(x + s * 0.28, y + s * 0.30, s * 0.18, s * 0.42);
  ctx.strokeRect(x + s * 0.54, y + s * 0.30, s * 0.18, s * 0.42);
  ctx.strokeStyle = '#5b4628';
  ctx.lineWidth = Math.max(1, s * 0.025);
  for (const px of [0.32, 0.58]) {
    ctx.beginPath();
    ctx.moveTo(x + s * px, y + s * 0.42);
    ctx.lineTo(x + s * (px + 0.10), y + s * 0.42);
    ctx.moveTo(x + s * px, y + s * 0.53);
    ctx.lineTo(x + s * (px + 0.10), y + s * 0.53);
    ctx.stroke();
  }
}

function drawRepairSite(ctx, x, y, s, completed) {
  ctx.strokeStyle = completed ? '#baf58c' : '#f0c866';
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.23, y + s * 0.67);
  ctx.lineTo(x + s * 0.78, y + s * 0.38);
  ctx.stroke();
  ctx.fillStyle = completed ? '#98aa82' : '#8a8e91';
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(x + s * (0.28 + i * 0.16), y + s * (0.58 - i * 0.08), s * 0.09, s * 0.08);
  }
}

function drawMissionStepBadge(ctx, x, y, s, marker) {
  const label = `${marker.chainStep || 1}`;
  ctx.fillStyle = 'rgba(8, 10, 12, 0.9)';
  ctx.strokeStyle = '#f9e6a8';
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.beginPath();
  ctx.arc(x + s * 0.75, y + s * 0.25, Math.max(4, s * 0.14), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f9e6a8';
  ctx.font = `900 ${Math.max(8, s * 0.20)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + s * 0.75, y + s * 0.25);
}

function drawMissionCheck(ctx, x, y, s) {
  ctx.strokeStyle = '#d6f5bd';
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.28, y + s * 0.26);
  ctx.lineTo(x + s * 0.42, y + s * 0.42);
  ctx.lineTo(x + s * 0.72, y + s * 0.22);
  ctx.stroke();
}

function drawMissionRoute(ctx, state, layout, routeOverlay) {
  const points = Array.isArray(routeOverlay?.path)
    ? routeOverlay.path.filter((point) => point && isRevealed(state, point.x, point.y))
    : [];
  if (points.length < 2) return;
  const color = routeOverlay.reachableThisTurn ? '#baf58c' : '#f0c866';
  const center = (point) => ({
    x: layout.offsetX + point.x * layout.tileSize + layout.tileSize * 0.5,
    y: layout.offsetY + point.y * layout.tileSize + layout.tileSize * 0.5
  });
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([Math.max(5, layout.tileSize * 0.36), Math.max(3, layout.tileSize * 0.18)]);
  ctx.lineWidth = Math.max(5, layout.tileSize * 0.22);
  ctx.strokeStyle = 'rgba(5, 7, 10, 0.84)';
  drawRouteStroke(ctx, points, center);
  ctx.lineWidth = Math.max(2, layout.tileSize * 0.095);
  ctx.strokeStyle = color;
  drawRouteStroke(ctx, points, center);
  ctx.setLineDash([]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = center(points[i]);
    ctx.fillStyle = 'rgba(5, 7, 10, 0.82)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, layout.tileSize * 0.14), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, layout.tileSize * 0.075), 0, Math.PI * 2);
    ctx.fill();
  }
  drawRouteEndpoint(ctx, center(points[0]), layout.tileSize, color, false);
  drawRouteEndpoint(ctx, center(points[points.length - 1]), layout.tileSize, color, true);
  ctx.restore();
}

function drawRouteStroke(ctx, points, center) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const p = center(points[i]);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawRouteEndpoint(ctx, p, tileSize, color, target) {
  ctx.fillStyle = 'rgba(5, 7, 10, 0.86)';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, tileSize * 0.08);
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(5, tileSize * (target ? 0.22 : 0.17)), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (target) {
    ctx.beginPath();
    ctx.moveTo(p.x - tileSize * 0.14, p.y);
    ctx.lineTo(p.x + tileSize * 0.14, p.y);
    ctx.moveTo(p.x, p.y - tileSize * 0.14);
    ctx.lineTo(p.x, p.y + tileSize * 0.14);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, tileSize * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }
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
  const grow = s * 0.04;
  x -= grow;
  y -= grow;
  s += grow * 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = s * 0.08;
  ctx.shadowOffsetY = s * 0.05;
  if (building.type === 'portal') {
    drawPortalSprite(ctx, x, y, s);
  } else if (building.type === 'city') {
    ctx.fillStyle = '#6f695b';
    ctx.fillRect(x + s * 0.12, y + s * 0.57, s * 0.76, s * 0.24);
    ctx.fillStyle = '#cbc0a0';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(x + s * (0.14 + i * 0.15), y + s * 0.49, s * 0.10, s * 0.09);
    ctx.fillStyle = color;
    ctx.fillRect(x + s * 0.24, y + s * 0.38, s * 0.52, s * 0.34);
    ctx.fillStyle = '#8d3327';
    roof(ctx, x + s * 0.18, y + s * 0.39, s * 0.64, s * 0.22);
    ctx.fillStyle = 'rgba(255, 226, 156, 0.88)';
    ctx.fillRect(x + s * 0.36, y + s * 0.50, s * 0.07, s * 0.08);
    ctx.fillRect(x + s * 0.57, y + s * 0.50, s * 0.07, s * 0.08);
    ctx.fillStyle = '#221714';
    ctx.fillRect(x + s * 0.45, y + s * 0.61, s * 0.12, s * 0.20);
    ctx.strokeStyle = 'rgba(255, 226, 156, 0.72)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.strokeRect(x + s * 0.22, y + s * 0.36, s * 0.56, s * 0.46);
    drawBannerPennon(ctx, x + s * 0.74, y + s * 0.20, s * 0.38, color);
  } else if (building.type === 'watchtower') {
    ctx.fillStyle = '#5e452e';
    ctx.fillRect(x + s * 0.42, y + s * 0.28, s * 0.16, s * 0.48);
    ctx.strokeStyle = '#2b1d12';
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.41, y + s * 0.42);
    ctx.lineTo(x + s * 0.59, y + s * 0.74);
    ctx.moveTo(x + s * 0.59, y + s * 0.42);
    ctx.lineTo(x + s * 0.41, y + s * 0.74);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.3, y + s * 0.3);
    ctx.lineTo(x + s * 0.5, y + s * 0.12);
    ctx.lineTo(x + s * 0.7, y + s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + s * 0.29, y + s * 0.28, s * 0.42, s * 0.14);
    drawBannerPennon(ctx, x + s * 0.63, y + s * 0.12, s * 0.22, color);
  } else if (building.type === 'wall') {
    ctx.fillStyle = '#8a8e91';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(x + s * (0.08 + i * 0.22), y + s * 0.35, s * 0.16, s * 0.42);
    ctx.fillStyle = '#c5c7c8';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(x + s * (0.06 + i * 0.19), y + s * 0.28, s * 0.10, s * 0.10);
    ctx.strokeStyle = 'rgba(20,20,20,0.35)';
    ctx.lineWidth = Math.max(1, s * 0.02);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + s * (0.20 + i * 0.24), y + s * 0.40);
      ctx.lineTo(x + s * (0.20 + i * 0.24), y + s * 0.76);
      ctx.stroke();
    }
  } else if (building.type === 'road') {
    // Road drawn as terrain overlay.
  } else if (['bonePit', 'graveForge', 'necropolis'].includes(building.type)) {
    drawNecroStructure(ctx, building, x, y, s);
  } else {
    ctx.fillStyle = '#493728';
    ctx.fillRect(x + s * 0.22, y + s * 0.48, s * 0.56, s * 0.3);
    ctx.fillStyle = color;
    roof(ctx, x + s * 0.18, y + s * 0.48, s * 0.64, s * 0.20);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + s * 0.32, y + s * 0.58, s * 0.08, s * 0.08);
    ctx.fillRect(x + s * 0.60, y + s * 0.58, s * 0.08, s * 0.08);
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
  ctx.restore();
}

function drawPortalSprite(ctx, x, y, s) {
  const cx = x + s * 0.5;
  const cy = y + s * 0.52;
  const glow = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s * 0.48);
  glow.addColorStop(0, 'rgba(156, 243, 138, 0.55)');
  glow.addColorStop(0.42, 'rgba(74, 188, 107, 0.22)');
  glow.addColorStop(1, 'rgba(11, 13, 15, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = 'rgba(20,10,28,0.92)';
  ellipse(ctx, cx, cy, s * 0.34, s * 0.43);
  ctx.strokeStyle = '#9cf38a';
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.29, s * 0.40, 0.12, 0.2, Math.PI * 1.82);
  ctx.stroke();
  ctx.strokeStyle = '#f4f0ff';
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.18, s * 0.27, -0.15, Math.PI, Math.PI * 2.3);
  ctx.stroke();
  ctx.fillStyle = 'rgba(156, 243, 138, 0.75)';
  for (const [px, py, r] of [[0.30, 0.30, 0.035], [0.72, 0.38, 0.028], [0.38, 0.78, 0.024]]) {
    ctx.beginPath();
    ctx.arc(x + s * px, y + s * py, s * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawNecroStructure(ctx, building, x, y, s) {
  const elite = building.type === 'necropolis';
  ctx.fillStyle = '#161d18';
  ctx.fillRect(x + s * 0.20, y + s * 0.42, s * 0.60, s * 0.34);
  ctx.fillStyle = elite ? '#2b3037' : '#20271f';
  roof(ctx, x + s * 0.17, y + s * 0.42, s * 0.66, s * 0.20);
  ctx.fillStyle = '#9cf38a';
  ctx.beginPath();
  ctx.arc(x + s * 0.5, y + s * 0.36, s * (elite ? 0.18 : 0.14), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#050608';
  ctx.fillRect(x + s * 0.42, y + s * 0.48, s * 0.16, s * 0.28);
  ctx.strokeStyle = 'rgba(156, 243, 138, 0.8)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.28, y + s * 0.35);
  ctx.lineTo(x + s * 0.20, y + s * 0.18);
  ctx.moveTo(x + s * 0.72, y + s * 0.35);
  ctx.lineTo(x + s * 0.82, y + s * 0.18);
  ctx.stroke();
  if (building.type === 'graveForge') {
    ctx.fillStyle = '#ff8a62';
    ctx.beginPath();
    ctx.arc(x + s * 0.66, y + s * 0.62, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBannerPennon(ctx, x, y, h, color) {
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(1, h * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.08);
  ctx.lineTo(x + h * 0.42, y + h * 0.18);
  ctx.lineTo(x, y + h * 0.34);
  ctx.closePath();
  ctx.fill();
}

function drawUnitSprite(ctx, unit, x, y, s, state) {
  const def = UNIT_TYPES[unit.type];
  const grow = s * 0.12;
  x -= grow;
  y -= grow;
  s += grow * 2;
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
  drawUnitRim(ctx, unit, cx, y + s * 0.78, s, enemy ? '#9cf38a' : color);
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

function drawUnitRim(ctx, unit, cx, cy, s, color) {
  ctx.save();
  ctx.strokeStyle = unit.faction === 'dead' ? 'rgba(156, 243, 138, 0.7)' : color;
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.globalAlpha = unit.faction === 'dead' ? 0.62 : 0.45;
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.31, s * 0.10, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawLivingSoldier(ctx, unit, color, x, y, s) {
  const cx = x + s * 0.5;
  const accent = UNIT_ACCENTS[unit.type] || '#d6dde5';
  const armor = unit.type === 'legionary' || unit.type === 'spearGuard';
  ctx.strokeStyle = '#2b2218';
  ctx.lineWidth = Math.max(1, s * 0.025);

  ctx.fillStyle = armor ? '#c7ccd1' : color;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.38, y + s * 0.43);
  ctx.lineTo(x + s * 0.62, y + s * 0.43);
  ctx.lineTo(x + s * 0.68, y + s * 0.72);
  ctx.lineTo(x + s * 0.32, y + s * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fillRect(x + s * 0.41, y + s * 0.51, s * 0.18, s * 0.18);
  ctx.fillStyle = '#6b4d38';
  ctx.fillRect(x + s * 0.38, y + s * 0.70, s * 0.08, s * 0.12);
  ctx.fillRect(x + s * 0.54, y + s * 0.70, s * 0.08, s * 0.12);

  ctx.fillStyle = '#d2c2a0';
  ctx.beginPath();
  ctx.arc(cx, y + s * 0.31, s * 0.115, 0, Math.PI * 2);
  ctx.fill();
  drawHelmet(ctx, cx, y + s * 0.27, s, armor ? '#aeb7bd' : '#2b3a2f', accent);

  if (unit.type === 'legionary' || unit.type === 'spearGuard') {
    drawLegionShield(ctx, x + s * 0.28, y + s * 0.56, s, unit.type === 'spearGuard' ? '#d9c56f' : '#b6bec8', color);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.70, y + s * 0.20);
    ctx.lineTo(x + s * 0.70, y + s * 0.82);
    ctx.stroke();
    if (unit.type === 'legionary') {
      ctx.strokeStyle = '#d6dde5';
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.66, y + s * 0.42);
      ctx.lineTo(x + s * 0.82, y + s * 0.30);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#d6dde5';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.70, y + s * 0.16);
      ctx.lineTo(x + s * 0.76, y + s * 0.26);
      ctx.lineTo(x + s * 0.64, y + s * 0.26);
      ctx.closePath();
      ctx.fill();
    }
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
    ctx.strokeStyle = '#f0c866';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.46, y + s * 0.51);
    ctx.lineTo(x + s * 0.76, y + s * 0.42);
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
    ctx.fillStyle = '#5e452e';
    ctx.fillRect(x + s * 0.28, y + s * 0.58, s * 0.16, s * 0.12);
  } else if (unit.type === 'scout') {
    ctx.fillStyle = '#2b3a2f';
    ctx.beginPath();
    ctx.moveTo(cx, y + s * 0.17);
    ctx.lineTo(x + s * 0.32, y + s * 0.5);
    ctx.lineTo(x + s * 0.68, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7ab87a';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.30, y + s * 0.69);
    ctx.lineTo(x + s * 0.70, y + s * 0.43);
    ctx.stroke();
  }
}

function drawHelmet(ctx, cx, y, s, metal, plume) {
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.arc(cx, y + s * 0.03, s * 0.12, Math.PI, 0);
  ctx.lineTo(cx + s * 0.12, y + s * 0.07);
  ctx.lineTo(cx - s * 0.12, y + s * 0.07);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = plume;
  ctx.fillRect(cx - s * 0.035, y - s * 0.08, s * 0.07, s * 0.08);
}

function drawLegionShield(ctx, cx, cy, s, face, trim) {
  ctx.fillStyle = trim;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.12, cy - s * 0.18);
  ctx.quadraticCurveTo(cx, cy - s * 0.26, cx + s * 0.12, cy - s * 0.18);
  ctx.lineTo(cx + s * 0.10, cy + s * 0.17);
  ctx.quadraticCurveTo(cx, cy + s * 0.25, cx - s * 0.10, cy + s * 0.17);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.08, cy - s * 0.14);
  ctx.quadraticCurveTo(cx, cy - s * 0.20, cx + s * 0.08, cy - s * 0.14);
  ctx.lineTo(cx + s * 0.07, cy + s * 0.13);
  ctx.quadraticCurveTo(cx, cy + s * 0.18, cx - s * 0.07, cy + s * 0.13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f9e6a8';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

function drawCavalry(ctx, color, x, y, s) {
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.fillStyle = '#5b3a24';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.48, y + s * 0.57, s * 0.29, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + s * 0.74, y + s * 0.45, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2b1d12';
  for (const px of [0.32, 0.46, 0.62, 0.70]) {
    ctx.fillRect(x + s * px, y + s * 0.66, s * 0.035, s * 0.14);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x + s * 0.42, y + s * 0.30, s * 0.18, s * 0.22);
  ctx.fillStyle = '#d2c2a0';
  ctx.beginPath();
  ctx.arc(x + s * 0.51, y + s * 0.25, s * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#322318';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.55, y + s * 0.25);
  ctx.lineTo(x + s * 0.70, y + s * 0.75);
  ctx.stroke();
  drawBannerPennon(ctx, x + s * 0.66, y + s * 0.24, s * 0.22, color);
}

function drawOnager(ctx, color, x, y, s) {
  ctx.fillStyle = '#5b3a24';
  ctx.fillRect(x + s * 0.25, y + s * 0.48, s * 0.5, s * 0.18);
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.strokeRect(x + s * 0.25, y + s * 0.48, s * 0.5, s * 0.18);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.28, y + s * 0.66);
  ctx.lineTo(x + s * 0.72, y + s * 0.48);
  ctx.moveTo(x + s * 0.72, y + s * 0.66);
  ctx.lineTo(x + s * 0.28, y + s * 0.48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.38, y + s * 0.5);
  ctx.lineTo(x + s * 0.68, y + s * 0.25);
  ctx.stroke();
  ctx.fillStyle = '#8a8e91';
  ctx.beginPath();
  ctx.arc(x + s * 0.72, y + s * 0.22, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + s * 0.35, y + s * 0.72, s * 0.09, 0, Math.PI * 2);
  ctx.arc(x + s * 0.68, y + s * 0.72, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

function drawUndead(ctx, unit, x, y, s) {
  const cx = x + s * 0.5;
  const elite = unit.type === 'graveKnight' || unit.type === 'lichBoss';
  const glow = ctx.createRadialGradient(cx, y + s * 0.50, s * 0.06, cx, y + s * 0.50, s * 0.36);
  glow.addColorStop(0, 'rgba(156, 243, 138, 0.28)');
  glow.addColorStop(1, 'rgba(156, 243, 138, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
  ctx.fillStyle = elite ? '#2c3335' : '#d8d8c8';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.38, y + s * 0.43);
  ctx.lineTo(x + s * 0.62, y + s * 0.43);
  ctx.lineTo(x + s * 0.66, y + s * 0.72);
  ctx.lineTo(x + s * 0.34, y + s * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = elite ? '#9cf38a' : '#b7b7a8';
  ctx.lineWidth = Math.max(1, s * 0.025);
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.42, y + s * (0.50 + i * 0.06));
    ctx.lineTo(x + s * 0.58, y + s * (0.50 + i * 0.06));
    ctx.stroke();
  }
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
    ctx.strokeStyle = '#d8d8c8';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.44, y + s * 0.52);
    ctx.lineTo(x + s * 0.76, y + s * 0.43);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.66, y + s * 0.28);
    ctx.lineTo(x + s * 0.72, y + s * 0.76);
    ctx.stroke();
    if (elite) {
      ctx.strokeStyle = '#d8d8c8';
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.34, y + s * 0.45);
      ctx.lineTo(x + s * 0.26, y + s * 0.70);
      ctx.stroke();
    }
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
}

function drawFog(ctx, state, layout) {
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const sx = layout.offsetX + x * layout.tileSize;
      const sy = layout.offsetY + y * layout.tileSize;
      if (!isRevealed(state, x, y)) {
        const s = layout.tileSize;
        ctx.fillStyle = 'rgba(255, 246, 218, 0.34)';
        ctx.fillRect(sx, sy, layout.tileSize, layout.tileSize);
        if ((x * 7 + y * 11) % 41 === 0) {
          const veil = ctx.createRadialGradient(sx + s * 0.58, sy + s * 0.52, s * 0.16, sx + s * 0.58, sy + s * 0.52, s * 2.0);
          veil.addColorStop(0, 'rgba(255, 255, 244, 0.28)');
          veil.addColorStop(0.52, 'rgba(255, 255, 244, 0.12)');
          veil.addColorStop(1, 'rgba(255, 255, 244, 0)');
          ctx.fillStyle = veil;
          ctx.fillRect(sx - s * 2, sy - s * 2, s * 4, s * 4);
        }
        if ((x * 11 + y * 13) % 47 === 0) {
          ctx.strokeStyle = 'rgba(139, 94, 42, 0.13)';
          ctx.lineWidth = Math.max(1, s * 0.035);
          ctx.beginPath();
          ctx.arc(sx + s * 0.5, sy + s * 0.5, s * 0.20, 0.2, Math.PI * 1.35);
          ctx.stroke();
        }
      } else if (!isVisible(state, x, y)) {
        ctx.fillStyle = 'rgba(224, 199, 143, 0.36)';
        ctx.fillRect(sx, sy, layout.tileSize, layout.tileSize);
        ctx.fillStyle = 'rgba(255, 255, 244, 0.18)';
        ctx.fillRect(sx + layout.tileSize * 0.08, sy + layout.tileSize * 0.08, layout.tileSize * 0.84, layout.tileSize * 0.84);
      }
    }
  }
}

function drawImperialMapFrame(ctx, layout) {
  const x = layout.frameX;
  const y = layout.frameY;
  const w = layout.mapWidth;
  const h = layout.mapHeight;
  const s = layout.tileSize;
  ctx.save();
  ctx.strokeStyle = 'rgba(147, 86, 28, 0.86)';
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.strokeRect(x - s * 0.08, y - s * 0.08, w + s * 0.16, h + s * 0.16);
  ctx.strokeStyle = 'rgba(255, 247, 220, 0.82)';
  ctx.lineWidth = Math.max(2, s * 0.04);
  ctx.strokeRect(x + s * 0.05, y + s * 0.05, w - s * 0.10, h - s * 0.10);
  ctx.fillStyle = 'rgba(143, 36, 24, 0.68)';
  for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, s * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  const x0 = layout.frameX + layout.mapWidth - w - 8;
  const y0 = layout.frameY + 8;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 248, 225, 0.90)';
  ctx.fillRect(x0 - 7, y0 - 7, w + 14, h + 14);
  ctx.strokeStyle = 'rgba(147, 86, 28, 0.72)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 7, y0 - 7, w + 14, h + 14);
  for (const tile of state.map.tiles) {
    let color = '#d9bd82';
    if (isRevealed(state, tile.x, tile.y)) color = isVisible(state, tile.x, tile.y) ? (TERRAIN_COLORS[tile.terrain] || '#777') : '#c7b081';
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
  ctx.strokeStyle = '#8f2418';
  ctx.strokeRect(x0 - 3, y0 - 3, w + 6, h + 6);
  ctx.restore();
}

function drawStatusRibbon(ctx, state, layout) {
  if (state.status === 'playing') return;
  const text = state.status === 'won' ? 'OLUNDAR SURVIVES' : 'OLUNDAR FALLS';
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.76)';
  ctx.fillRect(layout.frameX, layout.frameY + layout.mapHeight * 0.42, layout.mapWidth, layout.mapHeight * 0.16);
  ctx.fillStyle = state.status === 'won' ? '#baf58c' : '#ff8a8a';
  ctx.font = `700 ${Math.floor(layout.tileSize * 1.2)}px Cinzel, Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.fillText(text, layout.frameX + layout.mapWidth / 2, layout.frameY + layout.mapHeight * 0.52);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inMap(x, y) {
  return x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
}
