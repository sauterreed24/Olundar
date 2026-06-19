import { BUILDING_TYPES, FACTIONS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from './content.js';
import { idx, manhattan } from './map.js';
import { buildingAt, canBuildOn, findPath, getStrategicMapLens, getTileSummary, getUnitDef, isEnemy, isRevealed, isVisible, tileAt, unitAt } from './rules.js';

const TERRAIN_COLORS = {
  plains: '#b7c979',
  forest: '#2f6f3b',
  hills: '#bc8f4d',
  mountains: '#858d8a',
  river: '#2586b6',
  marsh: '#527e5e',
  ruins: '#aa9670',
  blight: '#5d4b66'
};

const TERRAIN_HIGHLIGHTS = {
  plains: '#f4df9a',
  forest: '#7fca65',
  hills: '#f0c57c',
  mountains: '#f0f1e7',
  river: '#cff4ff',
  marsh: '#a9d89b',
  ruins: '#eed79a',
  blight: '#acf78b'
};

const TERRAIN_PALETTES = {
  plains: { shadow: '#5b7f38', base: '#aeca67', light: '#efd886', accent: '#7da64a', crown: '#dccc73' },
  forest: { shadow: '#173820', base: '#2f6f3b', light: '#79bd5c', accent: '#224f2d', crown: '#124128' },
  hills: { shadow: '#75512c', base: '#bc8f4d', light: '#efc57d', accent: '#986a36', crown: '#d9a75c' },
  mountains: { shadow: '#555b5d', base: '#858d8a', light: '#f0f1e7', accent: '#6f7675', crown: '#cfd6d2' },
  river: { shadow: '#0c557b', base: '#2586b6', light: '#cff4ff', accent: '#6fc7e6', crown: '#e8fdff' },
  marsh: { shadow: '#2e563c', base: '#527e5e', light: '#a9d89b', accent: '#6b9b67', crown: '#d4e7ae' },
  ruins: { shadow: '#6e604b', base: '#aa9670', light: '#eed79a', accent: '#81725c', crown: '#d7c99f' },
  blight: { shadow: '#2b2332', base: '#5d4b66', light: '#acf78b', accent: '#7de774', crown: '#d9ffb6' }
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
const ISO_TILE_Y_RATIO = 0.66;

export function getLayout(canvas) {
  const camera = canvas.__olundarState ? getCameraBounds(canvas.__olundarState) : {
    x: 0,
    y: 0,
    width: MAP_WIDTH,
    height: MAP_HEIGHT
  };
  const projectionSpan = camera.width + camera.height;
  const tileSize = Math.max(24, Math.floor(Math.min(
    canvas.width * 1.90 / projectionSpan,
    canvas.height * 1.76 / (projectionSpan * ISO_TILE_Y_RATIO)
  )));
  const halfTileWidth = tileSize * 0.5;
  const tileHeight = tileSize * ISO_TILE_Y_RATIO;
  const halfTileHeight = tileHeight * 0.5;
  const terrainWidth = projectionSpan * halfTileWidth;
  const terrainHeight = projectionSpan * halfTileHeight;
  const padX = tileSize * 0.72;
  const padTop = tileSize * 0.58;
  const padBottom = tileSize * 0.48;
  const mapWidth = terrainWidth + padX * 2;
  const mapHeight = terrainHeight + padTop + padBottom;
  const frameX = Math.floor((canvas.width - mapWidth) / 2);
  const frameY = Math.floor((canvas.height - mapHeight) / 2);
  const terrainX = frameX + padX;
  const terrainY = frameY + padTop;
  const originX = terrainX + camera.height * halfTileWidth;
  const originY = terrainY + halfTileHeight;
  return {
    tileSize,
    tileHeight,
    halfTileWidth,
    halfTileHeight,
    offsetX: frameX - camera.x * tileSize,
    offsetY: frameY - camera.y * tileSize,
    originX,
    originY,
    terrainX,
    terrainY,
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
  const width = Math.min(MAP_WIDTH, Math.max(9, Math.min(14, revealedWidth + 2)));
  const height = Math.min(MAP_HEIGHT, Math.max(7, Math.min(10, revealedHeight + 2)));
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
  const localX = x - layout.originX;
  const localY = y - layout.originY;
  const projectedX = (localY / layout.halfTileHeight + localX / layout.halfTileWidth) / 2 + layout.camera.x;
  const projectedY = (localY / layout.halfTileHeight - localX / layout.halfTileWidth) / 2 + layout.camera.y;
  const baseX = Math.floor(projectedX);
  const baseY = Math.floor(projectedY);
  const candidates = [];
  for (let ty = baseY - 1; ty <= baseY + 1; ty += 1) {
    for (let tx = baseX - 1; tx <= baseX + 1; tx += 1) {
      if (!inMap(tx, ty)) continue;
      const bounds = tileBounds(layout, tx, ty);
      const distance = Math.abs(x - bounds.cx) / layout.halfTileWidth + Math.abs(y - bounds.cy) / layout.halfTileHeight;
      if (distance <= 1.02) candidates.push({ x: tx, y: ty, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : { x: -1, y: -1 };
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
  drawWorldLight(ctx, state, layout);
  drawStrategicLens(ctx, state, layout, lensId);
  drawTacticalActionOverlay(ctx, state, layout, hoverTile);
  drawMissionRoute(ctx, state, layout, routeOverlay);
  drawMissionFocus(ctx, state, layout, missionFocusOverlay);
  drawBuildSites(ctx, state, layout);
  drawPieceCastShadows(ctx, state, layout);
  drawBuildings(ctx, state, layout);
  drawUnits(ctx, state, layout);
  drawSelection(ctx, state, layout, hoverTile);
  drawFog(ctx, state, layout);
  drawFogAtmosphere(ctx, state, layout);
  drawBattleImpact(ctx, state, layout, battleImpact);
  ctx.restore();
  drawImperialMapFrame(ctx, layout);
  drawMiniMap(ctx, state, layout, lensId);
  drawStatusRibbon(ctx, state, layout);
}

function drawBattleImpact(ctx, state, layout, impact) {
  if (!impact || !isVisible(state, impact.x, impact.y)) return;
  const bounds = tileBounds(layout, impact.x, impact.y);
  const { x, y, s } = bounds;
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
  strokeTileDiamond(ctx, bounds, 'rgba(5, 7, 10, 0.84)', Math.max(2, s * 0.08), s * 0.05);
  strokeTileDiamond(ctx, bounds, color, Math.max(2, s * 0.045), s * 0.12);
  fillTileDiamond(ctx, bounds, fill, s * 0.18);
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
  const bounds = tileBounds(layout, overlay.x, overlay.y);
  const { x, y, s } = bounds;
  ctx.save();
  ctx.strokeStyle = '#baf58c';
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.globalAlpha = 0.9;
  strokeTileDiamond(ctx, bounds, '#baf58c', Math.max(2, s * 0.09), s * 0.08);
  ctx.globalAlpha = 0.32;
  fillTileDiamond(ctx, bounds, '#baf58c', s * 0.14);
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
  const sortedTiles = state.map.tiles.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
  drawContinentUnderpaint(ctx, state, layout, sortedTiles);
  drawBiomeWash(ctx, state, layout, sortedTiles);
  drawElevationCastShadows(ctx, state, layout, sortedTiles);
  for (const tile of sortedTiles) {
    const bounds = tileBounds(layout, tile.x, tile.y);
    const { x, y, s } = bounds;
    const revealed = isRevealed(state, tile.x, tile.y);
    if (!revealed) {
      drawUnchartedTile(ctx, tile, bounds);
      continue;
    }
    const visible = isVisible(state, tile.x, tile.y);
    const base = TERRAIN_COLORS[tile.terrain] || '#777';
    drawTileSkirt(ctx, tile, bounds, visible, base);
    ctx.save();
    tileDiamondPath(ctx, bounds, -1);
    ctx.clip();
    drawTerrainGround(ctx, tile, x, y, s, visible, base);
    drawTileRelief(ctx, tile, x, y, s, visible);
    drawTerrainTexture(ctx, tile, x, y, s, visible);
    if (tile.road) drawRoad(ctx, x, y, s, visible);
    if (tile.blight > 0 && tile.terrain !== 'blight') drawBlightVeins(ctx, x, y, s, tile.blight, visible);
    ctx.restore();
    drawTileTopline(ctx, tile, bounds, visible, base);
    if (!visible) {
      strokeTileDiamond(ctx, bounds, 'rgba(44, 33, 25, 0.12)', 1, 0.5);
    }
  }
  drawTerrainContinuity(ctx, state, layout, sortedTiles);
  drawTopographicContourInk(ctx, state, layout, sortedTiles);
  drawRiverbankHighlights(ctx, state, layout, sortedTiles);
  drawRiverNetwork(ctx, state, layout, sortedTiles);
  drawRoadNetwork(ctx, state, layout, sortedTiles);
  drawGeographyOverlays(ctx, state, layout);
  drawTerrainCanopyHighlights(ctx, state, layout, sortedTiles);
  drawRevealedFrontierRim(ctx, state, layout);
}

function drawContinentUnderpaint(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.filter = `blur(${Math.max(4, layout.tileSize * 0.08)}px)`;
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y)) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const visible = isVisible(state, tile.x, tile.y);
    ctx.globalAlpha = visible ? 0.18 : 0.07;
    fillTileDiamond(ctx, {
      ...bounds,
      halfW: bounds.halfW * 1.08,
      halfH: bounds.halfH * 1.16
    }, TERRAIN_COLORS[tile.terrain] || '#c6b27c');
  }
  ctx.restore();
}

function drawBiomeWash(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = `blur(${Math.max(2, layout.tileSize * 0.035)}px)`;
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y)) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const visible = isVisible(state, tile.x, tile.y);
    const palette = terrainPalette(tile.terrain);
    const strength = tile.terrain === 'river'
      ? 0.15
      : tile.terrain === 'forest'
        ? 0.27
        : tile.terrain === 'hills' || tile.terrain === 'mountains'
          ? 0.24
          : 0.16;
    ctx.globalAlpha = visible ? strength : strength * 0.42;
    fillTileDiamond(ctx, {
      ...bounds,
      cx: bounds.cx + layout.halfTileWidth * 0.08,
      cy: bounds.cy + layout.halfTileHeight * 0.12,
      halfW: bounds.halfW * 1.18,
      halfH: bounds.halfH * 1.22
    }, palette.shadow, layout.tileSize * -0.03);
  }
  ctx.restore();
}

function drawWorldLight(ctx, state, layout) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const glow = ctx.createRadialGradient(
    layout.frameX + layout.mapWidth * 0.16,
    layout.frameY + layout.mapHeight * 0.10,
    layout.tileSize * 0.8,
    layout.frameX + layout.mapWidth * 0.16,
    layout.frameY + layout.mapHeight * 0.10,
    Math.max(layout.mapWidth, layout.mapHeight) * 0.74
  );
  glow.addColorStop(0, 'rgba(255, 244, 190, 0.18)');
  glow.addColorStop(0.44, 'rgba(255, 230, 152, 0.05)');
  glow.addColorStop(1, 'rgba(255, 230, 152, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const shadeGradient = ctx.createLinearGradient(layout.frameX, layout.frameY, layout.frameX + layout.mapWidth, layout.frameY + layout.mapHeight);
  shadeGradient.addColorStop(0, 'rgba(63, 42, 18, 0)');
  shadeGradient.addColorStop(0.58, 'rgba(63, 42, 18, 0.03)');
  shadeGradient.addColorStop(1, 'rgba(38, 31, 27, 0.18)');
  ctx.fillStyle = shadeGradient;
  ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  if (state.turn > 1) {
    ctx.globalAlpha = Math.min(0.14, state.turn * 0.006);
    ctx.fillStyle = 'rgba(113, 63, 32, 0.45)';
    ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  }
  ctx.restore();
}

function drawElevationCastShadows(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y) || tile.terrain === 'river') continue;
    const terrainLift = tile.terrain === 'mountains'
      ? 0.46
      : tile.terrain === 'hills'
        ? 0.30
        : tile.terrain === 'forest'
          ? 0.19
          : Math.max(0, tile.elevation - 0.58) * 0.26;
    if (terrainLift <= 0.06) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const offset = layout.tileSize * (0.06 + terrainLift * 0.20);
    const visible = isVisible(state, tile.x, tile.y);
    ctx.globalAlpha = visible ? 0.16 + terrainLift * 0.10 : 0.06 + terrainLift * 0.05;
    fillTileDiamond(ctx, {
      ...bounds,
      cx: bounds.cx + offset,
      cy: bounds.cy + offset * 0.62,
      halfW: bounds.halfW * (0.98 + terrainLift * 0.18),
      halfH: bounds.halfH * (0.88 + terrainLift * 0.10)
    }, 'rgba(84, 54, 28, 0.52)', layout.tileSize * 0.03);
  }
  ctx.restore();
}

function drawTileSkirt(ctx, tile, bounds, visible, base) {
  const drop = bounds.s * (0.08 + tile.elevation * 0.08);
  const left = { x: bounds.cx - bounds.halfW, y: bounds.cy };
  const right = { x: bounds.cx + bounds.halfW, y: bounds.cy };
  const bottom = { x: bounds.cx, y: bounds.cy + bounds.halfH };
  ctx.save();
  ctx.globalAlpha = visible ? 0.38 : 0.18;
  ctx.fillStyle = shade(base, tile.terrain === 'river' ? -26 : -48);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y + drop);
  ctx.lineTo(left.x, left.y + drop * 0.54);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(base, tile.terrain === 'river' ? -48 : -68);
  ctx.beginPath();
  ctx.moveTo(bottom.x, bottom.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(right.x, right.y + drop * 0.54);
  ctx.lineTo(bottom.x, bottom.y + drop);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTileTopline(ctx, tile, bounds, visible, base) {
  ctx.save();
  ctx.globalAlpha = visible ? 0.30 : 0.12;
  ctx.strokeStyle = colorMix(TERRAIN_HIGHLIGHTS[tile.terrain] || '#ffffff', '#ffffff', 0.18);
  ctx.lineWidth = Math.max(1, bounds.s * 0.012);
  ctx.beginPath();
  ctx.moveTo(bounds.cx - bounds.halfW * 0.96, bounds.cy);
  ctx.lineTo(bounds.cx, bounds.cy - bounds.halfH * 0.96);
  ctx.lineTo(bounds.cx + bounds.halfW * 0.96, bounds.cy);
  ctx.stroke();
  ctx.globalAlpha = visible ? 0.12 : 0.06;
  strokeTileDiamond(ctx, bounds, shade(base, -40), Math.max(1, bounds.s * 0.01), 0.5);
  ctx.restore();
}

function drawTerrainContinuity(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y) || tile.terrain === 'river' || tile.terrain === 'blight') continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbor = tileAt(state, tile.x + dx, tile.y + dy);
      if (!neighbor || !isRevealed(state, neighbor.x, neighbor.y)) continue;
      if (!terrainBlendMatches(tile, neighbor)) continue;
      const a = tileCenter(layout, tile.x, tile.y);
      const b = tileCenter(layout, neighbor.x, neighbor.y);
      const visible = isVisible(state, tile.x, tile.y) && isVisible(state, neighbor.x, neighbor.y);
      const base = TERRAIN_COLORS[tile.terrain] || '#b9aa78';
      ctx.globalAlpha = visible ? 0.18 : 0.07;
      ctx.strokeStyle = colorMix(base, TERRAIN_HIGHLIGHTS[tile.terrain] || '#fff2bd', 0.38);
      ctx.lineWidth = layout.tileSize * (tile.terrain === 'forest' ? 0.72 : tile.terrain === 'marsh' ? 0.66 : 0.56);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.globalAlpha = visible ? 0.10 : 0.04;
      ctx.strokeStyle = '#fff2bd';
      ctx.lineWidth = layout.tileSize * 0.26;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - layout.halfTileHeight * 0.18);
      ctx.lineTo(b.x, b.y - layout.halfTileHeight * 0.18);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawTopographicContourInk(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y) || tile.terrain === 'river' || tile.terrain === 'blight') continue;
    const reliefTerrain = ['hills', 'mountains', 'forest', 'ruins'].includes(tile.terrain);
    if (!reliefTerrain && tile.elevation < 0.62) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const { x, y, s } = bounds;
    const visible = isVisible(state, tile.x, tile.y);
    const palette = terrainPalette(tile.terrain);
    const bands = tile.terrain === 'mountains' ? 4 : tile.terrain === 'hills' ? 3 : 2;
    ctx.save();
    tileDiamondPath(ctx, bounds, s * 0.08);
    ctx.clip();
    for (let i = 0; i < bands; i += 1) {
      const lift = 0.30 + i * 0.15 + tileNoise(tile, 120 + i) * 0.06;
      const startY = y + s * (0.84 - lift);
      const endY = y + s * (0.70 - lift * 0.68);
      ctx.globalAlpha = visible ? 0.24 + i * 0.045 : 0.08 + i * 0.024;
      ctx.strokeStyle = i % 2
        ? colorMix(palette.light, '#fff8d3', 0.40)
        : colorMix(palette.shadow, '#5a371f', 0.22);
      ctx.lineWidth = Math.max(1, s * (0.019 + i * 0.004));
      ctx.beginPath();
      ctx.moveTo(x + s * (0.12 + tileNoise(tile, 130 + i) * 0.10), startY);
      ctx.bezierCurveTo(
        x + s * (0.32 + tileNoise(tile, 140 + i) * 0.10),
        y + s * (0.40 - lift * 0.32),
        x + s * (0.62 + tileNoise(tile, 150 + i) * 0.11),
        y + s * (0.58 - lift * 0.36),
        x + s * (0.88 - tileNoise(tile, 160 + i) * 0.10),
        endY
      );
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawRiverbankHighlights(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y) || tile.terrain !== 'river') continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const visible = isVisible(state, tile.x, tile.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbor = tileAt(state, tile.x + dx, tile.y + dy);
      if (!neighbor || neighbor.terrain === 'river' || !isRevealed(state, neighbor.x, neighbor.y)) continue;
      const [start, end] = frontierEdgePoints(bounds, dx, dy);
      ctx.globalAlpha = visible && isVisible(state, neighbor.x, neighbor.y) ? 0.38 : 0.16;
      ctx.strokeStyle = 'rgba(17, 91, 128, 0.42)';
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.055);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.globalAlpha = visible ? 0.58 : 0.24;
      ctx.strokeStyle = 'rgba(245, 255, 250, 0.82)';
      ctx.lineWidth = Math.max(1, layout.tileSize * 0.020);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y - layout.tileSize * 0.012);
      ctx.lineTo(end.x, end.y - layout.tileSize * 0.012);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRiverNetwork(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y) || tile.terrain !== 'river') continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, -1]]) {
      const neighbor = tileAt(state, tile.x + dx, tile.y + dy);
      if (!neighbor || neighbor.terrain !== 'river' || !isRevealed(state, neighbor.x, neighbor.y)) continue;
      const a = tileCenter(layout, tile.x, tile.y);
      const b = tileCenter(layout, neighbor.x, neighbor.y);
      const visible = isVisible(state, tile.x, tile.y) && isVisible(state, neighbor.x, neighbor.y);
      ctx.globalAlpha = visible ? 0.54 : 0.24;
      ctx.strokeStyle = 'rgba(34, 122, 168, 0.92)';
      ctx.lineWidth = Math.max(7, layout.tileSize * 0.34);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) * 0.5, Math.min(a.y, b.y) - layout.halfTileHeight * 0.20, b.x, b.y);
      ctx.stroke();

      ctx.globalAlpha = visible ? 0.72 : 0.28;
      ctx.strokeStyle = 'rgba(225, 248, 255, 0.82)';
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.08);
      ctx.beginPath();
      ctx.moveTo(a.x - layout.halfTileWidth * 0.10, a.y - layout.halfTileHeight * 0.13);
      ctx.quadraticCurveTo((a.x + b.x) * 0.5, Math.min(a.y, b.y) - layout.halfTileHeight * 0.32, b.x + layout.halfTileWidth * 0.10, b.y - layout.halfTileHeight * 0.13);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRoadNetwork(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y) || !tile.road) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbor = tileAt(state, tile.x + dx, tile.y + dy);
      if (!neighbor || !neighbor.road || !isRevealed(state, neighbor.x, neighbor.y)) continue;
      const a = tileCenter(layout, tile.x, tile.y);
      const b = tileCenter(layout, neighbor.x, neighbor.y);
      const visible = isVisible(state, tile.x, tile.y) && isVisible(state, neighbor.x, neighbor.y);
      ctx.globalAlpha = visible ? 0.78 : 0.34;
      ctx.strokeStyle = 'rgba(72, 48, 26, 0.74)';
      ctx.lineWidth = Math.max(4, layout.tileSize * 0.14);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(219, 190, 121, 0.92)';
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.07);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - layout.halfTileHeight * 0.03);
      ctx.lineTo(b.x, b.y - layout.halfTileHeight * 0.03);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function terrainBlendMatches(tile, neighbor) {
  if (tile.terrain === neighbor.terrain) return true;
  const open = new Set(['plains', 'hills', 'ruins']);
  const wet = new Set(['forest', 'marsh']);
  return (open.has(tile.terrain) && open.has(neighbor.terrain)) || (wet.has(tile.terrain) && wet.has(neighbor.terrain));
}

function drawTerrainGround(ctx, tile, x, y, s, visible, base) {
  const palette = terrainPalette(tile.terrain);
  const elevationShade = (tile.elevation - 0.5) * 36 + (visible ? 0 : -22);
  const ground = shade(base, elevationShade);
  const highlight = TERRAIN_HIGHLIGHTS[tile.terrain] || '#ffffff';
  ctx.fillStyle = ground;
  ctx.fillRect(x - 0.75, y - 0.75, s + 1.5, s + 1.5);

  const light = ctx.createLinearGradient(x, y, x + s, y + s);
  light.addColorStop(0, colorMix(palette.light, '#ffffff', visible ? 0.12 : 0.04));
  light.addColorStop(0.38, colorMix(palette.base, highlight, visible ? 0.18 : 0.08));
  light.addColorStop(0.74, ground);
  light.addColorStop(1, shade(palette.shadow, visible ? 10 : -8));
  ctx.fillStyle = light;
  ctx.fillRect(x - 0.5, y - 0.5, s + 1, s + 1);

  ctx.save();
  drawPainterlyGroundPatches(ctx, tile, x, y, s, visible, palette);
  drawTerrainGrain(ctx, tile, x, y, s, visible, palette);
  ctx.restore();

  if (visible) {
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = 'rgba(82, 55, 27, 0.24)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.98, y + s * 0.16);
    ctx.lineTo(x + s * 0.98, y + s * 0.96);
    ctx.lineTo(x + s * 0.16, y + s * 0.96);
    ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = colorMix(palette.light, '#ffffff', 0.30);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.08, y + s * 0.21);
    ctx.quadraticCurveTo(x + s * 0.38, y + s * 0.05, x + s * 0.78, y + s * 0.20);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPainterlyGroundPatches(ctx, tile, x, y, s, visible, palette) {
  const patchCount = tile.terrain === 'river' ? 3 : tile.terrain === 'forest' ? 5 : 4;
  ctx.globalAlpha = visible ? 0.11 : 0.045;
  for (let i = 0; i < patchCount; i += 1) {
    const px = x + s * (0.18 + tileNoise(tile, 3 + i) * 0.62);
    const py = y + s * (0.22 + tileNoise(tile, 13 + i) * 0.56);
    const rx = s * (0.13 + tileNoise(tile, 23 + i) * 0.12);
    const ry = s * (0.035 + tileNoise(tile, 31 + i) * 0.055);
    const tone = i % 2 ? palette.light : palette.shadow;
    ctx.fillStyle = colorMix(tone, palette.base, i % 2 ? 0.35 : 0.22);
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, -0.46 + tileNoise(tile, 41 + i) * 0.60, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrainGrain(ctx, tile, x, y, s, visible, palette) {
  if (!visible) return;
  const strokes = tile.terrain === 'river' || tile.terrain === 'blight' ? 3 : 5;
  ctx.globalAlpha = tile.terrain === 'forest' ? 0.16 : 0.12;
  ctx.strokeStyle = colorMix(palette.accent, '#fff7d2', tile.terrain === 'river' ? 0.45 : 0.20);
  ctx.lineWidth = Math.max(1, s * 0.012);
  for (let i = 0; i < strokes; i += 1) {
    const px = x + s * (0.14 + tileNoise(tile, 53 + i) * 0.72);
    const py = y + s * (0.30 + tileNoise(tile, 61 + i) * 0.46);
    const length = s * (0.08 + tileNoise(tile, 67 + i) * 0.16);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + length * 0.45, py - s * 0.035, px + length, py + s * 0.02);
    ctx.stroke();
  }
}

function drawGeographyOverlays(ctx, state, layout) {
  ctx.save();
  const sortedTiles = state.map.tiles.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const tile of sortedTiles) {
    if (!isVisible(state, tile.x, tile.y)) continue;
    const { x, y, s } = tileBounds(layout, tile.x, tile.y);
    if (tile.terrain === 'forest') drawForestCrown(ctx, tile, x, y, s);
    else if (tile.terrain === 'hills') drawRidgeCrown(ctx, tile, x, y, s);
    else if (tile.terrain === 'mountains') drawMountainCrown(ctx, tile, x, y, s);
    else if (tile.terrain === 'river') drawRiverCrown(ctx, tile, x, y, s);
    else if (tile.terrain === 'plains') drawPlainsCrown(ctx, tile, x, y, s);
    else if (tile.terrain === 'marsh') drawMarshCrown(ctx, tile, x, y, s);
    else if (tile.terrain === 'ruins') drawRuinsCrown(ctx, tile, x, y, s);
  }
  ctx.restore();
}

function drawTerrainCanopyHighlights(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isVisible(state, tile.x, tile.y)) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const { x, y, s } = bounds;
    const palette = terrainPalette(tile.terrain);
    const seed = tileNoise(tile, 71);
    if (tile.terrain === 'forest') {
      ctx.globalAlpha = 0.28 + seed * 0.12;
      ctx.fillStyle = palette.crown;
      for (let i = 0; i < 3; i += 1) {
        const px = x + s * (0.25 + tileNoise(tile, i + 1) * 0.50);
        const py = y + s * (0.34 + tileNoise(tile, i + 9) * 0.30);
        ctx.beginPath();
        ctx.ellipse(px, py, s * (0.12 + tileNoise(tile, i + 17) * 0.04), s * 0.055, -0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (tile.terrain === 'hills' || tile.terrain === 'mountains') {
      ctx.globalAlpha = tile.terrain === 'mountains' ? 0.48 : 0.34;
      ctx.strokeStyle = palette.light;
      ctx.lineWidth = Math.max(1, s * 0.025);
      for (let i = 0; i < 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(x + s * (0.18 + i * 0.10), y + s * (0.56 + i * 0.08));
        ctx.quadraticCurveTo(x + s * (0.42 + seed * 0.12), y + s * (0.34 + i * 0.05), x + s * (0.82 - i * 0.08), y + s * (0.50 + i * 0.11));
        ctx.stroke();
      }
    } else if (tile.terrain === 'river') {
      ctx.globalAlpha = 0.52;
      ctx.strokeStyle = 'rgba(244, 255, 255, 0.78)';
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.12, y + s * (0.46 + seed * 0.10));
      ctx.bezierCurveTo(x + s * 0.35, y + s * 0.24, x + s * 0.62, y + s * 0.78, x + s * 0.90, y + s * 0.42);
      ctx.stroke();
    } else if (tile.terrain === 'marsh') {
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = palette.light;
      ctx.lineWidth = Math.max(1, s * 0.022);
      for (let i = 0; i < 4; i += 1) {
        const px = x + s * (0.20 + i * 0.16);
        ctx.beginPath();
        ctx.moveTo(px, y + s * 0.76);
        ctx.quadraticCurveTo(px + s * 0.035, y + s * (0.50 + tileNoise(tile, i + 21) * 0.08), px + s * 0.12, y + s * 0.68);
        ctx.stroke();
      }
    } else if (tile.terrain === 'ruins') {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = palette.light;
      ctx.fillRect(x + s * 0.22, y + s * 0.70, s * 0.48, Math.max(1, s * 0.018));
      ctx.fillRect(x + s * 0.54, y + s * 0.28, Math.max(1, s * 0.022), s * 0.40);
    }
  }
  ctx.restore();
}

function drawRevealedFrontierRim(ctx, state, layout) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of state.map.tiles) {
    if (!isRevealed(state, tile.x, tile.y)) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const visible = isVisible(state, tile.x, tile.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isRevealed(state, tile.x + dx, tile.y + dy)) continue;
      const [start, end] = frontierEdgePoints(bounds, dx, dy);
      ctx.globalAlpha = visible ? 0.46 : 0.24;
      ctx.strokeStyle = 'rgba(94, 58, 27, 0.64)';
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.06);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.globalAlpha = visible ? 0.56 : 0.26;
      ctx.strokeStyle = 'rgba(255, 244, 199, 0.78)';
      ctx.lineWidth = Math.max(1, layout.tileSize * 0.025);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y - layout.tileSize * 0.012);
      ctx.lineTo(end.x, end.y - layout.tileSize * 0.012);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function frontierEdgePoints(bounds, dx, dy) {
  const top = { x: bounds.cx, y: bounds.cy - bounds.halfH };
  const right = { x: bounds.cx + bounds.halfW, y: bounds.cy };
  const bottom = { x: bounds.cx, y: bounds.cy + bounds.halfH };
  const left = { x: bounds.cx - bounds.halfW, y: bounds.cy };
  if (dx > 0) return [right, bottom];
  if (dx < 0) return [left, top];
  if (dy > 0) return [bottom, left];
  return [top, right];
}

function drawForestCrown(ctx, tile, x, y, s) {
  const seed = (tile.x * 17 + tile.y * 31) % 7;
  if (seed > 5) return;
  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.fillStyle = 'rgba(22, 59, 35, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.54, y + s * 0.70, s * 0.34, s * 0.13, -0.15, 0, Math.PI * 2);
  ctx.fill();
  const trees = seed % 2 ? [[0.30, 0.50, 0.55], [0.54, 0.43, 0.72], [0.73, 0.58, 0.50]] : [[0.38, 0.56, 0.60], [0.62, 0.48, 0.70]];
  for (const [px, py, scale] of trees) {
    triangle(ctx, x + s * px, y + s * py, s * 0.20 * scale, '#1e5a34');
    triangle(ctx, x + s * px, y + s * (py - 0.10 * scale), s * 0.16 * scale, '#2f7b44');
    ctx.fillStyle = '#5b3a23';
    ctx.fillRect(x + s * (px - 0.022), y + s * (py + 0.13 * scale), s * 0.044, s * 0.13);
  }
  ctx.restore();
}

function drawRidgeCrown(ctx, tile, x, y, s) {
  if ((tile.x * 11 + tile.y * 5) % 4 === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.76;
  ctx.strokeStyle = 'rgba(96, 70, 34, 0.72)';
  ctx.lineWidth = Math.max(2, s * 0.055);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.12, y + s * 0.68);
  ctx.quadraticCurveTo(x + s * 0.38, y + s * 0.36, x + s * 0.88, y + s * 0.56);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(251, 227, 154, 0.70)';
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.18, y + s * 0.62);
  ctx.quadraticCurveTo(x + s * 0.42, y + s * 0.44, x + s * 0.78, y + s * 0.58);
  ctx.stroke();
  ctx.restore();
}

function drawMountainCrown(ctx, tile, x, y, s) {
  if ((tile.x + tile.y) % 2) return;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(56, 57, 55, 0.24)';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.56, y + s * 0.78, s * 0.32, s * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8d2bf';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.24, y + s * 0.84);
  ctx.lineTo(x + s * 0.48, y + s * 0.26);
  ctx.lineTo(x + s * 0.76, y + s * 0.84);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8a8d8d';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.48, y + s * 0.26);
  ctx.lineTo(x + s * 0.60, y + s * 0.84);
  ctx.lineTo(x + s * 0.76, y + s * 0.84);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.58)';
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.48, y + s * 0.28);
  ctx.lineTo(x + s * 0.39, y + s * 0.84);
  ctx.stroke();
  ctx.restore();
}

function drawRiverCrown(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = 'rgba(255, 250, 218, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.07, y + s * 0.48);
  ctx.bezierCurveTo(x + s * 0.30, y + s * 0.30, x + s * 0.62, y + s * 0.72, x + s * 0.92, y + s * 0.44);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(16, 73, 103, 0.24)';
  ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.04, y + s * 0.61);
  ctx.bezierCurveTo(x + s * 0.26, y + s * 0.48, x + s * 0.68, y + s * 0.88, x + s * 0.96, y + s * 0.56);
  ctx.stroke();
  ctx.restore();
}

function drawPlainsCrown(ctx, tile, x, y, s) {
  if ((tile.x * 13 + tile.y * 7) % 3 !== 0) return;
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = 'rgba(94, 132, 50, 0.65)';
  ctx.lineWidth = Math.max(1, s * 0.024);
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * (0.16 + i * 0.18), y + s * 0.72);
    ctx.quadraticCurveTo(x + s * (0.24 + i * 0.18), y + s * 0.48, x + s * (0.42 + i * 0.18), y + s * 0.60);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarshCrown(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = 'rgba(207, 231, 169, 0.58)';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.60, y + s * 0.68, s * 0.22, s * 0.07, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(31, 69, 47, 0.68)';
  ctx.lineWidth = Math.max(1, s * 0.026);
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * (0.24 + i * 0.18), y + s * 0.76);
    ctx.quadraticCurveTo(x + s * (0.28 + i * 0.18), y + s * 0.51, x + s * (0.36 + i * 0.18), y + s * 0.70);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRuinsCrown(ctx, tile, x, y, s) {
  if ((tile.x + tile.y) % 2) return;
  ctx.save();
  ctx.globalAlpha = 0.68;
  ctx.fillStyle = '#81725c';
  ctx.fillRect(x + s * 0.28, y + s * 0.30, s * 0.10, s * 0.38);
  ctx.fillRect(x + s * 0.54, y + s * 0.24, s * 0.10, s * 0.45);
  ctx.fillStyle = '#e2d2a4';
  ctx.fillRect(x + s * 0.25, y + s * 0.25, s * 0.16, s * 0.06);
  ctx.fillRect(x + s * 0.51, y + s * 0.20, s * 0.16, s * 0.06);
  ctx.restore();
}

function drawUnchartedTile(ctx, tile, bounds) {
  const { x, y, s } = bounds;
  ctx.save();
  tileDiamondPath(ctx, bounds);
  ctx.clip();
  const veil = ctx.createLinearGradient(x, y, x + s, y + s);
  veil.addColorStop(0, '#f6eac4');
  veil.addColorStop(0.54, '#e5c988');
  veil.addColorStop(1, '#c8ae70');
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = veil;
  ctx.fillRect(x, y, s, s);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#fffdf1';
  ctx.beginPath();
  ctx.ellipse(bounds.cx - bounds.halfW * 0.10, bounds.cy - bounds.halfH * 0.18, bounds.halfW * 0.54, bounds.halfH * 0.34, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  strokeTileDiamond(ctx, bounds, 'rgba(142, 93, 38, 0.10)', 1, 0.5);
  if ((tile.x * 5 + tile.y * 7) % 19 === 0) {
    ctx.save();
    tileDiamondPath(ctx, bounds);
    ctx.clip();
    ctx.strokeStyle = 'rgba(139, 94, 42, 0.10)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * 0.72);
    ctx.quadraticCurveTo(x + s * 0.46, y + s * 0.42, x + s * 0.84, y + s * 0.60);
    ctx.stroke();
    ctx.restore();
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
  const palette = terrainPalette(tile.terrain);
  const alpha = visible ? 0.55 : 0.26;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (tile.terrain === 'plains') {
    ctx.strokeStyle = colorMix(palette.accent, '#fff3bb', 0.20);
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
      ctx.fillStyle = 'rgba(255, 230, 147, 0.58)';
      ctx.beginPath();
      ctx.arc(x + s * 0.72, y + s * 0.32, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tile.terrain === 'forest') {
    for (let i = 0; i < 5; i += 1) {
      const px = x + s * (0.18 + tileNoise(tile, 81 + i) * 0.66);
      const py = y + s * (0.24 + tileNoise(tile, 91 + i) * 0.42);
      triangle(ctx, px, py, s * (0.12 + tileNoise(tile, 101 + i) * 0.08), i % 2 ? palette.accent : palette.crown);
      ctx.fillStyle = '#51331f';
      ctx.fillRect(px - s * 0.018, py + s * 0.10, s * 0.036, s * 0.12);
    }
    ctx.globalAlpha = alpha * 0.56;
    ctx.strokeStyle = colorMix(palette.light, '#fff3bd', 0.18);
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * 0.82);
    ctx.lineTo(x + s * 0.82, y + s * 0.20);
    ctx.stroke();
  } else if (tile.terrain === 'hills') {
    ctx.strokeStyle = palette.shadow;
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.arc(x + s * 0.35, y + s * 0.62, s * 0.24, Math.PI, 0);
    ctx.arc(x + s * 0.65, y + s * 0.65, s * 0.22, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = colorMix(palette.light, '#fff8ce', 0.25);
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.22, y + s * 0.76);
    ctx.quadraticCurveTo(x + s * 0.48, y + s * 0.55, x + s * 0.82, y + s * 0.76);
    ctx.stroke();
  } else if (tile.terrain === 'mountains') {
    ctx.fillStyle = palette.light;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * 0.82);
    ctx.lineTo(x + s * 0.45, y + s * 0.2);
    ctx.lineTo(x + s * 0.72, y + s * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.accent;
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
    ctx.strokeStyle = palette.light;
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y + s * 0.55);
    ctx.bezierCurveTo(x + s * 0.35, y + s * 0.3, x + s * 0.65, y + s * 0.8, x + s * 0.9, y + s * 0.45);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.16, y + s * 0.49);
    ctx.bezierCurveTo(x + s * 0.38, y + s * 0.34, x + s * 0.62, y + s * 0.70, x + s * 0.84, y + s * 0.43);
    ctx.stroke();
  } else if (tile.terrain === 'marsh') {
    ctx.strokeStyle = palette.shadow;
    ctx.lineWidth = Math.max(1, s * 0.04);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + s * (0.2 + i * 0.22), y + s * 0.65);
      ctx.quadraticCurveTo(x + s * (0.28 + i * 0.22), y + s * 0.45, x + s * (0.36 + i * 0.22), y + s * 0.65);
      ctx.stroke();
    }
  } else if (tile.terrain === 'ruins') {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(x + s * 0.25, y + s * 0.25, s * 0.14, s * 0.42);
    ctx.fillRect(x + s * 0.52, y + s * 0.18, s * 0.14, s * 0.50);
    ctx.fillRect(x + s * 0.2, y + s * 0.68, s * 0.55, s * 0.08);
    ctx.fillStyle = palette.light;
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
    const bounds = tileBounds(layout, tile.x, tile.y);
    const { x, y, s } = bounds;
    const color = lensColor(tile.tone);
    const alpha = tile.visible ? 0.24 : 0.14;
    ctx.globalAlpha = alpha * (tile.strength || 1);
    fillTileDiamond(ctx, bounds, color, 1);
    if (tile.kind === 'road') {
      ctx.globalAlpha = tile.visible ? 0.9 : 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, s * 0.16);
      ctx.beginPath();
      ctx.moveTo(bounds.cx - bounds.halfW * 0.62, bounds.cy);
      ctx.lineTo(bounds.cx + bounds.halfW * 0.62, bounds.cy);
      ctx.stroke();
    } else if (tile.kind === 'allianceVision') {
      ctx.globalAlpha = tile.visible ? 0.6 : 0.34;
      strokeTileDiamond(ctx, bounds, color, Math.max(1, s * 0.04), 3);
    }
  }
  ctx.globalAlpha = 1;
  for (const marker of lens.markers) {
    const bounds = tileBounds(layout, marker.x, marker.y);
    const { x, y, s } = bounds;
    const color = lensColor(marker.tone);
    if (marker.kind === 'missionTarget' || marker.kind === 'missionComplete') {
      drawMissionSiteMarker(ctx, x, y, s, marker, color);
    } else {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(2, s * 0.07);
      ctx.globalAlpha = marker.visible ? 0.95 : 0.5;
      strokeTileDiamond(ctx, bounds, color, Math.max(2, s * 0.07), 3);
      ctx.beginPath();
      ctx.arc(bounds.cx, bounds.cy - bounds.halfH * 0.68, Math.max(2, s * 0.09), 0, Math.PI * 2);
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
  const center = (point) => tileCenter(layout, point.x, point.y);
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

function drawTacticalActionOverlay(ctx, state, layout, hoverTile = null) {
  const unit = state.units.find((u) => u.id === state.selectedUnitId && u.faction === 'olundar');
  if (!unit || state.mode.type !== 'select') return;
  const def = getUnitDef(unit);
  drawCommandHalo(ctx, layout, unit, !unit.hasActed);
  if (unit.hasActed) return;
  const reachable = collectReachableTiles(state, unit, def.move);
  const attackTiles = collectAttackTiles(state, unit, def.range);
  const hoverMove = reachable.find((item) => sameTile(item, hoverTile)) || null;
  ctx.save();
  drawCommandRangeFrontier(ctx, layout, reachable, def.move);
  for (const item of reachable) {
    const bounds = tileBounds(layout, item.x, item.y);
    drawMoveReachTile(ctx, bounds, layout, item, def.move, hoverMove);
  }
  drawCommandPathPreview(ctx, state, layout, unit, def.move, hoverMove);
  for (const item of attackTiles) {
    drawAttackReachTile(ctx, tileBounds(layout, item.x, item.y), layout, item.target);
  }
  ctx.restore();
}

function collectReachableTiles(state, unit, move) {
  const tiles = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (x === unit.x && y === unit.y) continue;
      const path = findPath(state, unit, x, y, move);
      if (!path) continue;
      const tile = tileAt(state, x, y);
      const road = !!state.buildings.find((building) => building.type === 'road' && building.x === x && building.y === y);
      tiles.push({ x, y, cost: path.cost, terrain: tile?.terrain || 'plains', road });
    }
  }
  tiles.sort((a, b) => a.cost - b.cost);
  return tiles;
}

function collectAttackTiles(state, unit, range) {
  if (range <= 0) return [];
  const tiles = [];
  for (let y = unit.y - range; y <= unit.y + range; y += 1) {
    for (let x = unit.x - range; x <= unit.x + range; x += 1) {
      if (!inMap(x, y) || (x === unit.x && y === unit.y) || manhattan(unit.x, unit.y, x, y) > range || !isVisible(state, x, y)) continue;
      const targetUnit = unitAt(state, x, y);
      const targetBuilding = buildingAt(state, x, y);
      const target = (targetUnit && targetUnit.id !== unit.id && isEnemy(state, unit.faction, targetUnit.faction))
        || (targetBuilding && isEnemy(state, unit.faction, targetBuilding.faction));
      tiles.push({ x, y, target });
    }
  }
  return tiles;
}

function drawMoveReachTile(ctx, bounds, layout, item, maxMove, hoverMove = null) {
  const close = item.cost <= 1;
  const hovered = sameTile(item, hoverMove);
  const compact = layout.mapWidth < 560 || layout.tileSize < 44;
  const fill = item.road
    ? (hovered ? 'rgba(118, 205, 235, 0.36)' : 'rgba(118, 186, 210, 0.18)')
    : close
      ? (hovered ? 'rgba(255, 220, 122, 0.34)' : 'rgba(244, 205, 105, 0.17)')
      : (hovered ? 'rgba(255, 230, 130, 0.30)' : 'rgba(255, 244, 176, 0.115)');
  const stroke = item.road
    ? 'rgba(47, 116, 141, 0.42)'
    : close
      ? 'rgba(151, 96, 29, 0.34)'
      : 'rgba(113, 85, 34, 0.16)';
  fillTileDiamond(ctx, bounds, fill, hovered ? 1.5 : 4);
  if (shouldAnnotateMove(item, maxMove, hoverMove, compact)) {
    strokeTileDiamond(ctx, bounds, hovered ? 'rgba(255, 238, 170, 0.92)' : stroke, Math.max(1, layout.tileSize * (hovered ? 0.038 : 0.016)), hovered ? 2 : 5);
    drawTacticalMoveMarker(ctx, bounds, layout, item, { hovered, maxMove });
  } else {
    drawMoveReachGlimmer(ctx, bounds, layout, item, maxMove);
  }
}

function drawCommandRangeFrontier(ctx, layout, reachable, maxMove) {
  const reachableSet = new Set(reachable.map((item) => tileKey(item.x, item.y)));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const item of reachable) {
    if (!isCommandFrontierTile(item, reachableSet, maxMove)) continue;
    const bounds = tileBounds(layout, item.x, item.y);
    const road = item.road;
    strokeTileDiamond(
      ctx,
      bounds,
      road ? 'rgba(63, 148, 174, 0.24)' : 'rgba(163, 111, 38, 0.22)',
      Math.max(1, layout.tileSize * 0.026),
      2.5
    );
  }
  ctx.restore();
}

function drawCommandPathPreview(ctx, state, layout, unit, maxMove, hoverMove) {
  if (!hoverMove || sameTile(unit, hoverMove)) return;
  const path = findPath(state, unit, hoverMove.x, hoverMove.y, maxMove);
  if (!path?.path?.length) return;
  const points = [{ x: unit.x, y: unit.y }, ...path.path.map((key) => tileFromKey(key))];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = hoverMove.road ? 'rgba(66, 185, 219, 0.34)' : 'rgba(255, 202, 94, 0.34)';
  ctx.shadowBlur = layout.tileSize * 0.12;
  ctx.strokeStyle = 'rgba(62, 36, 18, 0.74)';
  ctx.lineWidth = Math.max(4, layout.tileSize * 0.085);
  drawRouteStroke(ctx, points, (tile) => tileCenter(layout, tile.x, tile.y));
  ctx.strokeStyle = hoverMove.road ? 'rgba(155, 229, 255, 0.90)' : 'rgba(255, 218, 126, 0.92)';
  ctx.lineWidth = Math.max(2, layout.tileSize * 0.044);
  drawRouteStroke(ctx, points, (tile) => tileCenter(layout, tile.x, tile.y));
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = tileCenter(layout, points[i].x, points[i].y);
    ctx.fillStyle = 'rgba(70, 38, 13, 0.82)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, layout.tileSize * 0.07), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hoverMove.road ? '#d9f6ff' : '#ffe4a0';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, layout.tileSize * 0.038), 0, Math.PI * 2);
    ctx.fill();
  }
  drawRouteEndpoint(ctx, tileCenter(layout, hoverMove.x, hoverMove.y), layout.tileSize, hoverMove.road ? '#9be5ff' : '#ffe08a', true);
  ctx.restore();
}

function shouldAnnotateMove(item, maxMove, hoverMove = null, compact = false) {
  if (sameTile(item, hoverMove)) return true;
  if (compact) return item.road || item.cost <= 1;
  if (item.road || item.cost <= 2) return true;
  return item.cost >= maxMove && tileNoise(item, 940) > 0.86;
}

function isCommandFrontierTile(item, reachableSet, maxMove) {
  if (item.cost >= maxMove) return true;
  return [
    [item.x + 1, item.y],
    [item.x - 1, item.y],
    [item.x, item.y + 1],
    [item.x, item.y - 1]
  ].some(([x, y]) => !reachableSet.has(tileKey(x, y)));
}

function drawAttackReachTile(ctx, bounds, layout, target) {
  fillTileDiamond(ctx, bounds, target ? 'rgba(193, 47, 39, 0.17)' : 'rgba(193, 47, 39, 0.075)', 5);
  strokeTileDiamond(ctx, bounds, target ? 'rgba(255, 107, 91, 0.78)' : 'rgba(148, 48, 39, 0.38)', target ? Math.max(2, layout.tileSize * 0.045) : Math.max(1.4, layout.tileSize * 0.024), target ? 5 : 7);
  if (target) {
    const r = Math.max(3, layout.tileSize * 0.08);
    ctx.save();
    ctx.fillStyle = 'rgba(255, 234, 182, 0.84)';
    ctx.strokeStyle = 'rgba(112, 22, 16, 0.78)';
    ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
    ctx.beginPath();
    ctx.arc(bounds.cx, bounds.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else {
    const mark = Math.max(3, layout.tileSize * 0.08);
    const y = bounds.cy - layout.halfTileHeight * 0.48;
    ctx.save();
    ctx.strokeStyle = 'rgba(139, 35, 28, 0.46)';
    ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
    ctx.beginPath();
    ctx.moveTo(bounds.cx - mark, y);
    ctx.lineTo(bounds.cx, y - mark * 0.45);
    ctx.lineTo(bounds.cx + mark, y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawTacticalMoveMarker(ctx, bounds, layout, item, options = {}) {
  const close = item.cost <= 1;
  const hovered = Boolean(options.hovered);
  const prominent = hovered || item.road || item.cost <= 2;
  const markerY = bounds.cy + layout.halfTileHeight * 0.35;
  const poleHeight = layout.tileSize * (hovered ? 0.34 : item.road ? 0.30 : 0.24);
  const poleX = bounds.cx - layout.tileSize * 0.09;
  const bannerColor = item.road ? '#9be5ff' : close || hovered ? '#ffe08a' : '#f4c866';
  const rimColor = item.road ? 'rgba(27, 93, 122, 0.78)' : 'rgba(117, 77, 25, 0.68)';
  ctx.save();
  ctx.shadowColor = item.road ? 'rgba(53, 145, 176, 0.30)' : 'rgba(214, 151, 48, 0.24)';
  ctx.shadowBlur = layout.tileSize * (hovered ? 0.14 : 0.08);
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.016);
  if (prominent) {
    ctx.strokeStyle = 'rgba(61, 39, 18, 0.62)';
    ctx.beginPath();
    ctx.moveTo(poleX, markerY);
    ctx.lineTo(poleX, markerY - poleHeight);
    ctx.stroke();
    ctx.fillStyle = bannerColor;
    ctx.strokeStyle = rimColor;
    ctx.beginPath();
    ctx.moveTo(poleX, markerY - poleHeight);
    ctx.lineTo(poleX + layout.tileSize * 0.21, markerY - poleHeight * 0.92);
    ctx.lineTo(poleX + layout.tileSize * 0.15, markerY - poleHeight * 0.66);
    ctx.lineTo(poleX, markerY - poleHeight * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  drawMoveCostCartouche(ctx, prominent ? bounds.cx + layout.tileSize * 0.10 : bounds.cx, prominent ? markerY - poleHeight * 0.22 : markerY - layout.tileSize * 0.08, layout, item, hovered);
  if (item.road) drawRoadChevron(ctx, bounds.cx, markerY + layout.tileSize * 0.02, layout);
  else drawFootstepPair(ctx, bounds.cx, markerY + layout.tileSize * 0.02, layout, close);
  ctx.restore();
}

function drawMoveCostCartouche(ctx, x, y, layout, item, large = false) {
  const w = Math.max(16, layout.tileSize * (large ? 0.34 : 0.24));
  const h = Math.max(10, layout.tileSize * (large ? 0.20 : 0.16));
  ctx.save();
  roundRectPath(ctx, x - w * 0.5, y - h * 0.5, w, h, h * 0.48);
  ctx.fillStyle = item.road ? 'rgba(230, 250, 255, 0.92)' : 'rgba(255, 247, 211, 0.92)';
  ctx.strokeStyle = item.road ? 'rgba(47, 116, 141, 0.64)' : 'rgba(151, 96, 29, 0.56)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = item.road ? '#174a60' : '#733f16';
  ctx.font = `900 ${Math.max(8, layout.tileSize * (large ? 0.15 : 0.13))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.round(item.cost)), x, y + h * 0.02);
  ctx.restore();
}

function drawMoveReachGlimmer(ctx, bounds, layout, item, maxMove) {
  const frontier = item.cost >= maxMove;
  const size = layout.tileSize * (frontier ? 0.070 : 0.048);
  const y = bounds.cy + layout.halfTileHeight * (frontier ? 0.18 : 0.25);
  ctx.save();
  ctx.globalAlpha = frontier ? 0.74 : 0.54;
  ctx.strokeStyle = item.road ? 'rgba(44, 119, 145, 0.34)' : 'rgba(138, 92, 30, 0.28)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.014);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bounds.cx - size, y);
  ctx.quadraticCurveTo(bounds.cx, y - size * 0.45, bounds.cx + size, y);
  ctx.stroke();
  ctx.restore();
}

function drawRoadChevron(ctx, cx, cy, layout) {
  const size = layout.tileSize * 0.10;
  ctx.save();
  ctx.strokeStyle = 'rgba(28, 98, 126, 0.62)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = -1; i <= 1; i += 1) {
    const x = cx + i * size * 1.2;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.55, cy - size * 0.15);
    ctx.lineTo(x, cy + size * 0.28);
    ctx.lineTo(x + size * 0.55, cy - size * 0.15);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFootstepPair(ctx, cx, cy, layout, close) {
  const size = layout.tileSize * (close ? 0.060 : 0.052);
  ctx.save();
  ctx.fillStyle = close ? 'rgba(133, 83, 24, 0.48)' : 'rgba(119, 86, 35, 0.38)';
  for (const [dx, dy, rotation] of [[-0.06, 0, -0.34], [0.07, -0.05, 0.32]]) {
    ctx.beginPath();
    ctx.ellipse(cx + layout.tileSize * dx, cy + layout.tileSize * dy, size * 0.60, size, rotation, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCommandHalo(ctx, layout, unit, active) {
  const bounds = tileBounds(layout, unit.x, unit.y);
  ctx.save();
  ctx.shadowColor = active ? 'rgba(255, 224, 138, 0.70)' : 'rgba(120, 95, 70, 0.30)';
  ctx.shadowBlur = layout.tileSize * (active ? 0.22 : 0.12);
  fillTileDiamond(ctx, bounds, active ? 'rgba(255, 224, 138, 0.20)' : 'rgba(120, 95, 70, 0.12)', 5);
  strokeTileDiamond(ctx, bounds, active ? 'rgba(255, 231, 151, 0.82)' : 'rgba(138, 114, 85, 0.44)', Math.max(2, layout.tileSize * 0.05), 5);
  strokeTileDiamond(ctx, bounds, active ? 'rgba(77, 43, 17, 0.48)' : 'rgba(77, 43, 17, 0.26)', Math.max(1, layout.tileSize * 0.018), 12);
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
      const bounds = tileBounds(layout, x, y);
      fillTileDiamond(ctx, bounds, result.ok ? 'rgba(186, 245, 140, 0.22)' : 'rgba(255, 138, 138, 0.18)', 2);
      strokeTileDiamond(ctx, bounds, result.ok ? '#baf58c' : '#ff8a8a', Math.max(2, layout.tileSize * 0.06), 3);
    }
  }
  ctx.restore();
}

function drawPieceCastShadows(ctx, state, layout) {
  const pieces = [
    ...state.buildings.map((piece) => ({ ...piece, pieceKind: 'building' })),
    ...state.units.map((piece) => ({ ...piece, pieceKind: 'unit' }))
  ].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (const piece of pieces) {
    if (!isVisible(state, piece.x, piece.y)) continue;
    if (piece.pieceKind === 'building' && piece.type === 'road') continue;
    const { x, y, s } = tileBounds(layout, piece.x, piece.y);
    const building = piece.pieceKind === 'building';
    const large = building && ['city', 'portal', 'necropolis'].includes(piece.type);
    const long = piece.type === 'cavalry' || piece.type === 'onager' || large;
    const cx = x + s * (0.55 + (building ? 0.02 : 0));
    const cy = y + s * (large ? 0.82 : building ? 0.78 : 0.80);
    const width = s * (large ? 0.54 : long ? 0.44 : 0.34);
    const height = s * (large ? 0.13 : 0.10);
    ctx.globalAlpha = building ? 0.27 : 0.23;
    ctx.fillStyle = 'rgba(77, 50, 25, 0.58)';
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.08, cy + s * 0.05, width, height, -0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBuildings(ctx, state, layout) {
  const sorted = state.buildings.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const building of sorted) {
    if (!isVisible(state, building.x, building.y)) continue;
    const { x, y, s } = tileBounds(layout, building.x, building.y);
    drawBuildingSprite(ctx, building, x, y, s);
  }
}

function drawUnits(ctx, state, layout) {
  const sorted = state.units.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const unit of sorted) {
    if (!isVisible(state, unit.x, unit.y)) continue;
    const { x, y, s } = tileBounds(layout, unit.x, unit.y);
    drawUnitSprite(ctx, unit, x, y, s, state);
  }
}

function drawBuildingSprite(ctx, building, x, y, s) {
  const color = FACTION_COLORS[building.faction] || '#eee';
  if (building.type === 'road') return;
  const grow = s * 0.04;
  x -= grow;
  y -= grow;
  s += grow * 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = s * 0.08;
  ctx.shadowOffsetY = s * 0.05;
  drawStructurePlinth(ctx, building, x, y, s, color);
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
  } else if (building.type === 'farm') {
    drawFarmstead(ctx, x, y, s, color);
  } else if (building.type === 'lumberCamp') {
    drawLumberCamp(ctx, x, y, s, color);
  } else if (building.type === 'mine') {
    drawMineCamp(ctx, x, y, s, color);
  } else if (building.type === 'barracks') {
    drawBarracksYard(ctx, x, y, s, color);
  } else if (building.type === 'archeryYard') {
    drawArcheryYard(ctx, x, y, s, color);
  } else if (building.type === 'stable') {
    drawStableYard(ctx, x, y, s, color);
  } else if (building.type === 'workshop') {
    drawWorkshopYard(ctx, x, y, s, color);
  } else if (building.type === 'shrine') {
    drawShrine(ctx, x, y, s, color);
  } else if (building.type === 'outpost') {
    drawOutpost(ctx, x, y, s, color);
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
    drawConstructionProgress(ctx, building, x, y, s, color);
  }
  drawHealthBar(ctx, x + s * 0.15, y + s * 0.87, s * 0.70, s * 0.065, building.hp / building.maxHp, { gold: building.faction === 'olundar' });
  ctx.restore();
}

function drawStructurePlinth(ctx, building, x, y, s, color) {
  const elite = ['city', 'portal', 'necropolis'].includes(building.type);
  const cx = x + s * 0.50;
  const cy = y + s * (elite ? 0.79 : 0.82);
  const baseW = s * (elite ? 0.43 : 0.34);
  const baseH = s * (elite ? 0.13 : 0.10);
  ctx.save();
  const foundation = ctx.createLinearGradient(x + s * 0.18, y + s * 0.68, x + s * 0.86, y + s * 0.92);
  foundation.addColorStop(0, 'rgba(255, 242, 190, 0.72)');
  foundation.addColorStop(0.52, 'rgba(151, 108, 56, 0.82)');
  foundation.addColorStop(1, 'rgba(82, 52, 29, 0.78)');
  ctx.fillStyle = foundation;
  ctx.beginPath();
  ctx.ellipse(cx, cy, baseW, baseH, -0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = building.faction === 'dead' ? 'rgba(156, 243, 138, 0.62)' : colorMix(color, '#fff2bd', 0.40);
  ctx.lineWidth = Math.max(1, s * 0.026);
  ctx.stroke();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = 'rgba(255, 248, 213, 0.82)';
  ctx.beginPath();
  ctx.ellipse(cx - baseW * 0.08, cy - baseH * 0.24, baseW * 0.74, baseH * 0.36, -0.04, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawFactionSeal(ctx, cx + baseW * 0.64, cy - baseH * 0.20, s * (elite ? 0.08 : 0.065), color, building.faction === 'dead');
  ctx.restore();
}

function drawConstructionProgress(ctx, building, x, y, s, color) {
  ctx.save();
  ctx.strokeStyle = 'rgba(64, 42, 22, 0.82)';
  ctx.lineWidth = Math.max(1, s * 0.032);
  for (const [x1, y1, x2, y2] of [[0.18, 0.82, 0.82, 0.28], [0.22, 0.28, 0.78, 0.82], [0.26, 0.70, 0.74, 0.70]]) {
    ctx.beginPath();
    ctx.moveTo(x + s * x1, y + s * y1);
    ctx.lineTo(x + s * x2, y + s * y2);
    ctx.stroke();
  }
  const badgeW = s * 0.42;
  const badgeH = s * 0.16;
  const bx = x + s * 0.29;
  const by = y + s * 0.12;
  roundRectPath(ctx, bx, by, badgeW, badgeH, s * 0.035);
  ctx.fillStyle = 'rgba(37, 25, 16, 0.78)';
  ctx.fill();
  ctx.strokeStyle = colorMix(color, '#fff2bd', 0.38);
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.stroke();
  ctx.fillStyle = '#fff1bf';
  ctx.font = `900 ${Math.max(8, s * 0.16)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${building.turnsLeft}t`, x + s * 0.50, by + badgeH * 0.53);
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

function drawFarmstead(ctx, x, y, s, color) {
  ctx.fillStyle = '#b78638';
  for (let i = 0; i < 4; i += 1) {
    const py = y + s * (0.34 + i * 0.095);
    ctx.fillRect(x + s * 0.12, py, s * 0.50, s * 0.052);
    ctx.fillStyle = i % 2 === 0 ? '#e3c269' : '#8aa857';
  }
  ctx.strokeStyle = 'rgba(63, 85, 37, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.026);
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.14, y + s * (0.40 + i * 0.09));
    ctx.quadraticCurveTo(x + s * 0.34, y + s * (0.36 + i * 0.09), x + s * 0.62, y + s * (0.42 + i * 0.09));
    ctx.stroke();
  }
  ctx.fillStyle = '#f4df9b';
  ctx.fillRect(x + s * 0.54, y + s * 0.45, s * 0.25, s * 0.27);
  ctx.fillStyle = '#7f352a';
  roof(ctx, x + s * 0.50, y + s * 0.45, s * 0.33, s * 0.16);
  ctx.fillStyle = '#4f3421';
  ctx.fillRect(x + s * 0.62, y + s * 0.57, s * 0.07, s * 0.15);
  ctx.fillStyle = color;
  ctx.fillRect(x + s * 0.72, y + s * 0.52, s * 0.06, s * 0.08);
  ctx.strokeStyle = 'rgba(255, 245, 190, 0.66)';
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.strokeRect(x + s * 0.12, y + s * 0.32, s * 0.70, s * 0.43);
}

function drawLumberCamp(ctx, x, y, s, color) {
  for (const [px, py, scale] of [[0.23, 0.50, 0.95], [0.40, 0.36, 0.8], [0.68, 0.46, 0.88]]) {
    triangle(ctx, x + s * px, y + s * py, s * 0.20 * scale, '#1f5b36');
    ctx.fillStyle = '#593923';
    ctx.fillRect(x + s * (px - 0.025), y + s * (py + 0.13 * scale), s * 0.05, s * 0.14);
  }
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(1, s * 0.03);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = i % 2 ? '#8d623c' : '#6e482c';
    const lx = x + s * (0.24 + i * 0.15);
    const ly = y + s * (0.66 - i * 0.035);
    ctx.fillRect(lx, ly, s * 0.28, s * 0.07);
    ctx.strokeRect(lx, ly, s * 0.28, s * 0.07);
    ctx.beginPath();
    ctx.arc(lx, ly + s * 0.035, s * 0.035, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#dbc07d';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.60, y + s * 0.70);
  ctx.lineTo(x + s * 0.76, y + s * 0.48);
  ctx.lineTo(x + s * 0.88, y + s * 0.70);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  drawBannerPennon(ctx, x + s * 0.81, y + s * 0.28, s * 0.22, color);
}

function drawMineCamp(ctx, x, y, s, color) {
  const mouth = ctx.createLinearGradient(x, y + s * 0.35, x, y + s * 0.78);
  mouth.addColorStop(0, '#7b7062');
  mouth.addColorStop(1, '#2a241f');
  ctx.fillStyle = '#887966';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.16, y + s * 0.74);
  ctx.lineTo(x + s * 0.32, y + s * 0.36);
  ctx.lineTo(x + s * 0.54, y + s * 0.52);
  ctx.lineTo(x + s * 0.70, y + s * 0.30);
  ctx.lineTo(x + s * 0.88, y + s * 0.74);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c6bea5';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.33, y + s * 0.39);
  ctx.lineTo(x + s * 0.40, y + s * 0.53);
  ctx.lineTo(x + s * 0.51, y + s * 0.51);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = mouth;
  ctx.beginPath();
  ctx.ellipse(x + s * 0.52, y + s * 0.70, s * 0.20, s * 0.22, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(x + s * 0.72, y + s * 0.78);
  ctx.lineTo(x + s * 0.32, y + s * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#33271e';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.76, y + s * 0.38);
  ctx.lineTo(x + s * 0.62, y + s * 0.58);
  ctx.moveTo(x + s * 0.67, y + s * 0.38);
  ctx.lineTo(x + s * 0.81, y + s * 0.58);
  ctx.stroke();
}

function drawBarracksYard(ctx, x, y, s, color) {
  ctx.fillStyle = '#7c4b2f';
  ctx.fillRect(x + s * 0.15, y + s * 0.46, s * 0.70, s * 0.28);
  ctx.fillStyle = '#cfc0a0';
  for (let i = 0; i < 4; i += 1) {
    ctx.fillRect(x + s * (0.18 + i * 0.17), y + s * 0.37, s * 0.09, s * 0.10);
  }
  ctx.fillStyle = color;
  roof(ctx, x + s * 0.11, y + s * 0.45, s * 0.78, s * 0.21);
  ctx.fillStyle = '#2f2017';
  ctx.fillRect(x + s * 0.44, y + s * 0.56, s * 0.13, s * 0.18);
  ctx.strokeStyle = '#f6e0a0';
  ctx.lineWidth = Math.max(1, s * 0.028);
  for (let i = 0; i < 3; i += 1) {
    const px = x + s * (0.23 + i * 0.20);
    ctx.beginPath();
    ctx.moveTo(px, y + s * 0.26);
    ctx.lineTo(px, y + s * 0.76);
    ctx.stroke();
    drawLegionShield(ctx, px + s * 0.05, y + s * 0.62, s * 0.58, '#d6dde5', color);
  }
}

function drawArcheryYard(ctx, x, y, s, color) {
  ctx.strokeStyle = '#6b4a2d';
  ctx.lineWidth = Math.max(2, s * 0.06);
  ctx.beginPath();
  ctx.arc(x + s * 0.31, y + s * 0.54, s * 0.17, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.strokeStyle = '#f4e2b4';
  ctx.lineWidth = Math.max(1, s * 0.026);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.31, y + s * 0.37);
  ctx.lineTo(x + s * 0.31, y + s * 0.71);
  ctx.stroke();
  ctx.fillStyle = '#d9c27b';
  ctx.beginPath();
  ctx.arc(x + s * 0.68, y + s * 0.55, s * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.045);
  for (const r of [0.15, 0.09, 0.035]) {
    ctx.beginPath();
    ctx.arc(x + s * 0.68, y + s * 0.55, s * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#4f3421';
  ctx.lineWidth = Math.max(1, s * 0.03);
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * (0.41 + i * 0.04), y + s * 0.73);
    ctx.lineTo(x + s * (0.55 + i * 0.04), y + s * 0.27);
    ctx.stroke();
  }
}

function drawStableYard(ctx, x, y, s, color) {
  ctx.fillStyle = '#8a5b36';
  ctx.fillRect(x + s * 0.18, y + s * 0.43, s * 0.64, s * 0.31);
  ctx.fillStyle = '#f0d090';
  for (let i = 0; i < 4; i += 1) {
    ctx.fillRect(x + s * (0.24 + i * 0.13), y + s * 0.48, s * 0.045, s * 0.25);
  }
  ctx.fillStyle = color;
  roof(ctx, x + s * 0.14, y + s * 0.42, s * 0.72, s * 0.20);
  ctx.fillStyle = '#3b2619';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.49, y + s * 0.68, s * 0.20, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + s * 0.66, y + s * 0.61, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  for (const px of [0.37, 0.47, 0.57, 0.64]) ctx.fillRect(x + s * px, y + s * 0.72, s * 0.026, s * 0.11);
  ctx.strokeStyle = '#f7e1a4';
  ctx.lineWidth = Math.max(1, s * 0.023);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.23, y + s * 0.40);
  ctx.lineTo(x + s * 0.77, y + s * 0.40);
  ctx.stroke();
}

function drawWorkshopYard(ctx, x, y, s, color) {
  ctx.fillStyle = '#6b4a2d';
  ctx.fillRect(x + s * 0.18, y + s * 0.50, s * 0.55, s * 0.22);
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.strokeRect(x + s * 0.18, y + s * 0.50, s * 0.55, s * 0.22);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.23, y + s * 0.72);
  ctx.lineTo(x + s * 0.72, y + s * 0.50);
  ctx.moveTo(x + s * 0.72, y + s * 0.72);
  ctx.lineTo(x + s * 0.23, y + s * 0.50);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.055);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.44, y + s * 0.50);
  ctx.lineTo(x + s * 0.74, y + s * 0.25);
  ctx.stroke();
  ctx.fillStyle = '#8a8e91';
  ctx.beginPath();
  ctx.arc(x + s * 0.77, y + s * 0.23, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b78a4b';
  for (const px of [0.28, 0.62]) {
    ctx.beginPath();
    ctx.arc(x + s * px, y + s * 0.74, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#ffcf6b';
  ctx.beginPath();
  ctx.arc(x + s * 0.24, y + s * 0.42, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

function drawShrine(ctx, x, y, s, color) {
  const glow = ctx.createRadialGradient(x + s * 0.5, y + s * 0.43, s * 0.04, x + s * 0.5, y + s * 0.43, s * 0.42);
  glow.addColorStop(0, 'rgba(255, 216, 102, 0.42)');
  glow.addColorStop(1, 'rgba(255, 216, 102, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88);
  ctx.fillStyle = '#efe1b4';
  ctx.fillRect(x + s * 0.23, y + s * 0.68, s * 0.54, s * 0.08);
  ctx.fillRect(x + s * 0.27, y + s * 0.34, s * 0.46, s * 0.08);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(x + s * (0.31 + i * 0.16), y + s * 0.41, s * 0.06, s * 0.27);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.22, y + s * 0.34);
  ctx.lineTo(x + s * 0.50, y + s * 0.17);
  ctx.lineTo(x + s * 0.78, y + s * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd866';
  ctx.beginPath();
  ctx.arc(x + s * 0.50, y + s * 0.27, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

function drawOutpost(ctx, x, y, s, color) {
  ctx.fillStyle = '#6e482c';
  ctx.fillRect(x + s * 0.41, y + s * 0.32, s * 0.18, s * 0.45);
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.40, y + s * 0.40);
  ctx.lineTo(x + s * 0.60, y + s * 0.76);
  ctx.moveTo(x + s * 0.60, y + s * 0.40);
  ctx.lineTo(x + s * 0.40, y + s * 0.76);
  ctx.stroke();
  ctx.fillStyle = color;
  roof(ctx, x + s * 0.30, y + s * 0.30, s * 0.40, s * 0.19);
  ctx.fillStyle = '#e8d099';
  ctx.fillRect(x + s * 0.33, y + s * 0.42, s * 0.34, s * 0.10);
  ctx.fillStyle = '#5b3a24';
  for (let i = 0; i < 5; i += 1) {
    ctx.fillRect(x + s * (0.13 + i * 0.16), y + s * 0.70, s * 0.06, s * 0.15);
  }
  drawBannerPennon(ctx, x + s * 0.64, y + s * 0.16, s * 0.24, color);
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
  drawUnitPlinth(ctx, unit, x, y, s, enemy ? '#9cf38a' : color, !unit.hasActed);
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
  if (!def.tags.includes('undead') && unit.type !== 'onager') {
    drawFormationStandard(ctx, unit, x, y, s, color);
  }
  drawUnitRoleDevice(ctx, unit, x, y, s, enemy ? '#9cf38a' : color);
  if (unit.hasActed && unit.faction === 'olundar') {
    drawActedUnitVeil(ctx, x, y, s);
  }
  if (unit.fortified) {
    drawFortifiedChevron(ctx, x, y, s);
  }
  drawHealthBar(ctx, x + s * 0.18, y + s * 0.89, s * 0.64, s * 0.065, unit.hp / unit.maxHp, { gold: unit.faction === 'olundar' && !unit.hasActed });
  ctx.restore();
}

function drawUnitPlinth(ctx, unit, x, y, s, color, ready) {
  const cx = x + s * 0.5;
  const cy = y + s * 0.79;
  ctx.save();
  const base = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.03, s * 0.04, cx, cy, s * 0.34);
  base.addColorStop(0, ready ? 'rgba(255, 241, 176, 0.58)' : 'rgba(219, 199, 151, 0.34)');
  base.addColorStop(0.58, unit.faction === 'dead' ? 'rgba(22, 31, 24, 0.90)' : 'rgba(31, 37, 43, 0.88)');
  base.addColorStop(1, 'rgba(6, 8, 10, 0.80)');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.31, s * 0.105, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ready ? colorMix(color, '#fff1aa', 0.42) : colorMix(color, '#473522', 0.20);
  ctx.lineWidth = Math.max(1, s * (ready ? 0.035 : 0.024));
  ctx.stroke();
  if (ready) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#fff2b5';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.035, cy - s * 0.018, s * 0.22, s * 0.045, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUnitRoleDevice(ctx, unit, x, y, s, color) {
  const def = UNIT_TYPES[unit.type];
  const cx = x + s * (def.tags.includes('undead') ? 0.28 : 0.24);
  const cy = y + s * 0.31;
  const r = s * 0.105;
  ctx.save();
  ctx.fillStyle = unit.faction === 'dead' ? 'rgba(11, 17, 13, 0.86)' : 'rgba(255, 244, 199, 0.88)';
  ctx.strokeStyle = unit.faction === 'dead' ? 'rgba(156, 243, 138, 0.76)' : colorMix(color, '#5b2e1f', 0.25);
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = unit.faction === 'dead' ? '#9cf38a' : '#5b3320';
  ctx.fillStyle = unit.faction === 'dead' ? '#9cf38a' : color;
  ctx.lineWidth = Math.max(1, s * 0.022);
  if (unit.type === 'archer' || unit.type === 'corpseArcher') {
    ctx.beginPath();
    ctx.arc(cx - r * 0.08, cy, r * 0.52, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.28, cy - r * 0.54);
    ctx.lineTo(cx + r * 0.28, cy + r * 0.54);
    ctx.stroke();
  } else if (unit.type === 'engineer' || unit.type === 'onager') {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy + r * 0.34);
    ctx.lineTo(cx + r * 0.36, cy - r * 0.42);
    ctx.moveTo(cx - r * 0.02, cy - r * 0.48);
    ctx.lineTo(cx + r * 0.46, cy);
    ctx.stroke();
  } else if (unit.type === 'cavalry') {
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.12, r * 0.56, r * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.48, cy - r * 0.18, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (def.tags.includes('undead')) {
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.10, r * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.34, cy + r * 0.35);
    ctx.lineTo(cx + r * 0.34, cy + r * 0.35);
    ctx.stroke();
  } else {
    drawLegionShield(ctx, cx, cy + r * 0.06, r * 1.58, '#f3ead1', color);
  }
  ctx.restore();
}

function drawActedUnitVeil(ctx, x, y, s) {
  ctx.save();
  const veil = ctx.createRadialGradient(x + s * 0.50, y + s * 0.54, s * 0.04, x + s * 0.50, y + s * 0.54, s * 0.36);
  veil.addColorStop(0, 'rgba(28, 22, 18, 0.28)');
  veil.addColorStop(1, 'rgba(28, 22, 18, 0.56)');
  ctx.fillStyle = veil;
  ctx.beginPath();
  ctx.ellipse(x + s * 0.50, y + s * 0.54, s * 0.31, s * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230, 205, 154, 0.28)';
  ctx.lineWidth = Math.max(1, s * 0.020);
  ctx.beginPath();
  ctx.arc(x + s * 0.62, y + s * 0.29, s * 0.055, -0.2, Math.PI * 1.25);
  ctx.stroke();
  ctx.restore();
}

function drawFortifiedChevron(ctx, x, y, s) {
  ctx.save();
  ctx.strokeStyle = '#f6e7a2';
  ctx.lineWidth = Math.max(1, s * 0.042);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.26, y + s * 0.76);
  ctx.lineTo(x + s * 0.50, y + s * 0.62);
  ctx.lineTo(x + s * 0.74, y + s * 0.76);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(45, 27, 14, 0.70)';
  ctx.lineWidth = Math.max(1, s * 0.016);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.29, y + s * 0.76);
  ctx.lineTo(x + s * 0.50, y + s * 0.66);
  ctx.lineTo(x + s * 0.71, y + s * 0.76);
  ctx.stroke();
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

function drawFormationStandard(ctx, unit, x, y, s, color) {
  const tall = unit.type === 'cavalry' || unit.type === 'spearGuard';
  const poleX = x + s * (unit.type === 'archer' ? 0.30 : 0.76);
  const topY = y + s * (tall ? 0.13 : 0.19);
  ctx.save();
  ctx.strokeStyle = '#2b1d12';
  ctx.lineWidth = Math.max(1, s * 0.027);
  ctx.beginPath();
  ctx.moveTo(poleX, topY);
  ctx.lineTo(poleX, y + s * 0.68);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(poleX, topY + s * 0.02);
  ctx.lineTo(poleX + s * 0.20, topY + s * 0.08);
  ctx.lineTo(poleX + s * 0.04, topY + s * 0.17);
  ctx.lineTo(poleX, topY + s * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f6e4a6';
  ctx.beginPath();
  ctx.arc(poleX + s * 0.035, topY + s * 0.085, s * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTroopDepth(ctx, unit, color, x, y, s) {
  const positions = unit.type === 'archer'
    ? [[0.34, 0.49], [0.62, 0.52]]
    : unit.type === 'scout'
      ? [[0.36, 0.56]]
      : [[0.34, 0.54], [0.63, 0.56]];
  ctx.save();
  ctx.globalAlpha = 0.58;
  ctx.strokeStyle = '#2b2218';
  ctx.lineWidth = Math.max(1, s * 0.02);
  for (const [px, py] of positions) {
    ctx.fillStyle = unit.type === 'archer' ? '#7c4d2d' : color;
    ctx.beginPath();
    ctx.ellipse(x + s * px, y + s * (py + 0.12), s * 0.065, s * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d2c2a0';
    ctx.beginPath();
    ctx.arc(x + s * px, y + s * py, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
    if (unit.type === 'archer') {
      ctx.strokeStyle = '#4b2f1d';
      ctx.lineWidth = Math.max(1, s * 0.022);
      ctx.beginPath();
      ctx.arc(x + s * (px + 0.05), y + s * (py + 0.11), s * 0.09, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    } else if (unit.type !== 'engineer') {
      drawLegionShield(ctx, x + s * (px - 0.055), y + s * (py + 0.15), s * 0.36, '#d6dde5', color);
    }
  }
  ctx.restore();
}

function drawLivingSoldier(ctx, unit, color, x, y, s) {
  const cx = x + s * 0.5;
  const accent = UNIT_ACCENTS[unit.type] || '#d6dde5';
  const armor = unit.type === 'legionary' || unit.type === 'spearGuard';
  ctx.strokeStyle = '#2b2218';
  ctx.lineWidth = Math.max(1, s * 0.025);
  drawTroopDepth(ctx, unit, color, x, y, s);

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
      const bounds = tileBounds(layout, x, y);
      const { s } = bounds;
      if (!isRevealed(state, x, y)) {
        fillTileDiamond(ctx, bounds, 'rgba(255, 246, 218, 0.24)');
        if ((x * 7 + y * 11) % 41 === 0) {
          const veil = ctx.createRadialGradient(bounds.cx, bounds.cy, s * 0.16, bounds.cx, bounds.cy, s * 2.0);
          veil.addColorStop(0, 'rgba(255, 255, 244, 0.28)');
          veil.addColorStop(0.52, 'rgba(255, 255, 244, 0.12)');
          veil.addColorStop(1, 'rgba(255, 255, 244, 0)');
          ctx.fillStyle = veil;
          ctx.fillRect(bounds.cx - s * 2, bounds.cy - s * 2, s * 4, s * 4);
        }
        if ((x * 11 + y * 13) % 47 === 0) {
          ctx.strokeStyle = 'rgba(139, 94, 42, 0.13)';
          ctx.lineWidth = Math.max(1, s * 0.035);
          ctx.beginPath();
          ctx.arc(bounds.cx, bounds.cy, s * 0.20, 0.2, Math.PI * 1.35);
          ctx.stroke();
        }
      } else if (!isVisible(state, x, y)) {
        fillTileDiamond(ctx, bounds, 'rgba(150, 118, 72, 0.18)');
        fillTileDiamond(ctx, bounds, 'rgba(255, 255, 244, 0.08)', s * 0.08);
      }
    }
  }
}

function drawFogAtmosphere(ctx, state, layout) {
  ctx.save();
  for (const tile of state.map.tiles) {
    if (isRevealed(state, tile.x, tile.y)) continue;
    const frontier = hasAdjacentRevealedTile(state, tile.x, tile.y);
    const seed = (tile.x * 37 + tile.y * 19) % 13;
    if (!frontier && seed > 1) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const radius = layout.tileSize * (frontier ? 1.05 + seed * 0.02 : 0.78);
    const cx = bounds.cx + layout.halfTileWidth * ((seed % 5) - 2) * 0.12;
    const cy = bounds.cy - layout.halfTileHeight * (0.28 + (seed % 3) * 0.08);
    const glow = ctx.createRadialGradient(cx, cy, layout.tileSize * 0.08, cx, cy, radius);
    glow.addColorStop(0, frontier ? 'rgba(255, 255, 241, 0.19)' : 'rgba(255, 250, 224, 0.10)');
    glow.addColorStop(0.55, frontier ? 'rgba(255, 244, 210, 0.08)' : 'rgba(255, 244, 210, 0.04)');
    glow.addColorStop(1, 'rgba(255, 244, 210, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    if (frontier && seed % 4 === 0) {
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = 'rgba(126, 87, 45, 0.34)';
      ctx.lineWidth = Math.max(1, layout.tileSize * 0.022);
      ctx.beginPath();
      ctx.arc(cx + layout.tileSize * 0.10, cy + layout.tileSize * 0.08, layout.tileSize * 0.24, 0.2, Math.PI * 1.45);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function hasAdjacentRevealedTile(state, x, y) {
  return isRevealed(state, x + 1, y)
    || isRevealed(state, x - 1, y)
    || isRevealed(state, x, y + 1)
    || isRevealed(state, x, y - 1);
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
    const bounds = tileBounds(layout, x, y);
    strokeTileDiamond(ctx, bounds, 'rgba(42, 22, 12, 0.76)', width + 2, 2);
    strokeTileDiamond(ctx, bounds, stroke, width, 5);
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
  const compactInset = layout.mapWidth < 560;
  const scale = Math.max(2, Math.min(compactInset ? 2 : 5, Math.floor(layout.tileSize * (compactInset ? 0.085 : 0.15))));
  const w = MAP_WIDTH * scale;
  const h = MAP_HEIGHT * scale;
  const x0 = layout.frameX + layout.mapWidth - w - 8;
  const preferredY = layout.frameY + Math.max(8, layout.tileSize * 0.96);
  const y0 = Math.min(layout.frameY + layout.mapHeight - h - 8, preferredY);
  const panelX = x0 - 8;
  const panelY = y0 - 8;
  const panelW = w + 16;
  const panelH = h + 16;
  ctx.save();
  ctx.shadowColor = 'rgba(70, 42, 18, 0.24)';
  ctx.shadowBlur = layout.tileSize * 0.14;
  ctx.shadowOffsetY = layout.tileSize * 0.04;
  roundRectPath(ctx, panelX, panelY, panelW, panelH, Math.max(5, scale * 1.2));
  const frame = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
  frame.addColorStop(0, 'rgba(255, 252, 229, 0.94)');
  frame.addColorStop(0.55, 'rgba(225, 196, 130, 0.90)');
  frame.addColorStop(1, 'rgba(139, 82, 35, 0.62)');
  ctx.fillStyle = frame;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(143, 36, 24, 0.70)';
  ctx.lineWidth = Math.max(1, scale * 0.35);
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x0, y0, w, h, Math.max(3, scale * 0.75));
  ctx.clip();
  ctx.fillStyle = '#d9bd82';
  ctx.fillRect(x0, y0, w, h);
  for (const tile of state.map.tiles) {
    let color = '#d9bd82';
    if (isRevealed(state, tile.x, tile.y)) {
      color = isVisible(state, tile.x, tile.y)
        ? colorMix(TERRAIN_COLORS[tile.terrain] || '#777777', '#fff4cf', 0.16)
        : colorMix(TERRAIN_COLORS[tile.terrain] || '#c7b081', '#cfb77d', 0.54);
    }
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
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = 'rgba(91, 55, 26, 0.65)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= MAP_WIDTH; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x0 + x * scale, y0);
    ctx.lineTo(x0 + x * scale, y0 + h);
    ctx.stroke();
  }
  for (let y = 0; y <= MAP_HEIGHT; y += 4) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + y * scale);
    ctx.lineTo(x0 + w, y0 + y * scale);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const building of state.buildings) {
    if (!isRevealed(state, building.x, building.y)) continue;
    ctx.fillStyle = FACTION_COLORS[building.faction] || '#fff';
    ctx.beginPath();
    ctx.arc(x0 + (building.x + 0.5) * scale, y0 + (building.y + 0.5) * scale, Math.max(2, scale * 0.72), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = building.faction === 'dead' ? 'rgba(34, 42, 31, 0.88)' : 'rgba(255, 249, 219, 0.84)';
    ctx.lineWidth = Math.max(1, scale * 0.22);
    ctx.stroke();
  }
  for (const unit of state.units) {
    if (!isRevealed(state, unit.x, unit.y)) continue;
    ctx.fillStyle = FACTION_COLORS[unit.faction] || '#fff';
    ctx.beginPath();
    ctx.arc(x0 + (unit.x + 0.5) * scale, y0 + (unit.y + 0.5) * scale, Math.max(1.5, scale * 0.42), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(143, 36, 24, 0.86)';
  ctx.lineWidth = Math.max(1, scale * 0.34);
  roundRectPath(ctx, x0 + layout.camera.x * scale, y0 + layout.camera.y * scale, layout.camera.width * scale, layout.camera.height * scale, Math.max(2, scale * 0.45));
  ctx.stroke();
  ctx.restore();

  drawMiniMapCompass(ctx, panelX + panelW - scale * 2.2, panelY + panelH - scale * 2.2, scale * 1.5);
  ctx.restore();
}

function drawMiniMapCompass(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 249, 224, 0.82)';
  ctx.strokeStyle = 'rgba(143, 36, 24, 0.52)';
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8f2418';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.76);
  ctx.lineTo(cx + r * 0.20, cy);
  ctx.lineTo(cx, cy + r * 0.52);
  ctx.lineTo(cx - r * 0.20, cy);
  ctx.closePath();
  ctx.fill();
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

function tileCenter(layout, x, y) {
  const tx = x - layout.camera.x;
  const ty = y - layout.camera.y;
  return {
    x: layout.originX + (tx - ty) * layout.halfTileWidth,
    y: layout.originY + (tx + ty) * layout.halfTileHeight
  };
}

function sameTile(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function tileKey(x, y) {
  return `${x},${y}`;
}

function tileFromKey(key) {
  return { x: key % MAP_WIDTH, y: Math.floor(key / MAP_WIDTH) };
}

function tileBounds(layout, x, y) {
  const center = tileCenter(layout, x, y);
  return {
    x: center.x - layout.halfTileWidth,
    y: center.y - layout.tileSize * 0.5,
    cx: center.x,
    cy: center.y,
    s: layout.tileSize,
    halfW: layout.halfTileWidth,
    halfH: layout.halfTileHeight
  };
}

function tileDiamondPath(ctx, bounds, inset = 0) {
  const halfW = Math.max(1, bounds.halfW - inset);
  const halfH = Math.max(1, bounds.halfH - inset * ISO_TILE_Y_RATIO);
  ctx.beginPath();
  ctx.moveTo(bounds.cx, bounds.cy - halfH);
  ctx.lineTo(bounds.cx + halfW, bounds.cy);
  ctx.lineTo(bounds.cx, bounds.cy + halfH);
  ctx.lineTo(bounds.cx - halfW, bounds.cy);
  ctx.closePath();
}

function fillTileDiamond(ctx, bounds, fillStyle, inset = 0) {
  ctx.fillStyle = fillStyle;
  tileDiamondPath(ctx, bounds, inset);
  ctx.fill();
}

function strokeTileDiamond(ctx, bounds, strokeStyle, lineWidth = 1, inset = 0) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  tileDiamondPath(ctx, bounds, inset);
  ctx.stroke();
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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

function drawHealthBar(ctx, x, y, w, h, pct, options = {}) {
  const value = Math.max(0, Math.min(1, pct));
  ctx.save();
  roundRectPath(ctx, x, y, w, h, h * 0.5);
  ctx.fillStyle = 'rgba(25, 18, 14, 0.72)';
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, x + 1, y + 1, Math.max(1, (w - 2) * value), Math.max(1, h - 2), h * 0.5);
  ctx.clip();
  const fill = ctx.createLinearGradient(x, y, x + w, y);
  const good = options.gold ? '#f6d46f' : '#baf58c';
  fill.addColorStop(0, value > 0.55 ? good : value > 0.25 ? '#ffd76b' : '#ff8a72');
  fill.addColorStop(1, value > 0.55 ? '#6fbf70' : value > 0.25 ? '#c99132' : '#b8382e');
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = options.gold ? 'rgba(255, 238, 170, 0.72)' : 'rgba(255,255,255,0.48)';
  ctx.lineWidth = Math.max(1, h * 0.18);
  roundRectPath(ctx, x, y, w, h, h * 0.5);
  ctx.stroke();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#fff7d0';
  ctx.lineWidth = Math.max(1, h * 0.12);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.08, y + h * 0.32);
  ctx.lineTo(x + w * 0.92, y + h * 0.32);
  ctx.stroke();
  ctx.restore();
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

function drawFactionSeal(ctx, cx, cy, r, color, dead = false) {
  ctx.save();
  ctx.fillStyle = dead ? 'rgba(16, 28, 18, 0.92)' : 'rgba(255, 241, 184, 0.92)';
  ctx.strokeStyle = dead ? 'rgba(156, 243, 138, 0.78)' : colorMix(color, '#7b3d22', 0.24);
  ctx.lineWidth = Math.max(1, r * 0.24);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (dead) {
    ctx.strokeStyle = '#9cf38a';
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy + r * 0.18);
    ctx.quadraticCurveTo(cx, cy - r * 0.46, cx + r * 0.42, cy + r * 0.18);
    ctx.moveTo(cx - r * 0.34, cy + r * 0.38);
    ctx.lineTo(cx + r * 0.34, cy + r * 0.38);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.52);
    ctx.lineTo(cx + r * 0.42, cy - r * 0.08);
    ctx.lineTo(cx + r * 0.26, cy + r * 0.46);
    ctx.lineTo(cx - r * 0.26, cy + r * 0.46);
    ctx.lineTo(cx - r * 0.42, cy - r * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff1b4';
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.05, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function lensColor(tone) {
  return FACTION_COLORS[tone] || LENS_COLORS[tone] || LENS_COLORS.alliance;
}

function terrainPalette(terrain) {
  return TERRAIN_PALETTES[terrain] || TERRAIN_PALETTES.plains;
}

function tileNoise(tile, salt = 0) {
  const n = Math.sin((tile.x + 1) * 127.1 + (tile.y + 1) * 311.7 + salt * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = clampColor((n >> 16) + amount);
  const g = clampColor(((n >> 8) & 255) + amount);
  const b = clampColor((n & 255) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function colorMix(hexA, hexB, amount) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const mix = Math.max(0, Math.min(1, amount));
  const ar = a >> 16;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = b >> 16;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return `rgb(${clampColor(ar + (br - ar) * mix)}, ${clampColor(ag + (bg - ag) * mix)}, ${clampColor(ab + (bb - ab) * mix)})`;
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
