import { BUILDING_TYPES, DIFFICULTY_PRESETS, FACTIONS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, UNIT_TYPES } from './content.js';
import { idx, manhattan, neighbors4 } from './map.js';
import { buildingAt, canBuildOn, canEnter, findPath, getStrategicMapLens, getTileSummary, getUnitDef, isEnemy, isRevealed, isTileSupplied, isVisible, moveCostFor, tileAt, unitAt } from './rules.js';

const TERRAIN_COLORS = {
  plains: '#cfe66d',
  forest: '#278f52',
  hills: '#d9ac55',
  mountains: '#bdc9c2',
  river: '#1caee0',
  marsh: '#78bf6b',
  ruins: '#cfbe93',
  blight: '#675b86'
};

const TERRAIN_HIGHLIGHTS = {
  plains: '#fff7aa',
  forest: '#b2ff82',
  hills: '#ffe09a',
  mountains: '#fbfff9',
  river: '#dcfcff',
  marsh: '#dcffad',
  ruins: '#fff0c2',
  blight: '#c6ff93'
};

const TERRAIN_PALETTES = {
  plains: { shadow: '#6f9b3f', base: '#cfe66d', light: '#fff7aa', accent: '#98c64d', crown: '#f2dc62' },
  forest: { shadow: '#0f5934', base: '#278f52', light: '#b2ff82', accent: '#1f7645', crown: '#185c35' },
  hills: { shadow: '#9b6b2b', base: '#d9ac55', light: '#ffe09a', accent: '#ba7f3a', crown: '#f1bf61' },
  mountains: { shadow: '#74817b', base: '#bdc9c2', light: '#fbfff9', accent: '#879993', crown: '#e8f2ea' },
  river: { shadow: '#04739f', base: '#1caee0', light: '#dcfcff', accent: '#72e8fa', crown: '#f2ffff' },
  marsh: { shadow: '#427d4a', base: '#78bf6b', light: '#dcffad', accent: '#8ccd72', crown: '#e8f8b4' },
  ruins: { shadow: '#7f7155', base: '#cfbe93', light: '#fff0c2', accent: '#aa9065', crown: '#e7d19d' },
  blight: { shadow: '#2d2440', base: '#675b86', light: '#c6ff93', accent: '#76e969', crown: '#e0ffbf' }
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
const SORTED_TILE_CACHE = new WeakMap();

function compactViewportWidth() {
  return typeof window !== 'undefined' ? window.innerWidth : 1280;
}

function isPhoneBattlefieldViewport() {
  return compactViewportWidth() <= 620;
}

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
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
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
  const focusTile = state.cameraFocusTile && isRevealed(state, state.cameraFocusTile.x, state.cameraFocusTile.y)
    ? state.cameraFocusTile
    : null;
  const selected = focusTile
    || state.units.find((unit) => unit.id === state.selectedUnitId)
    || state.buildings.find((building) => building.id === state.selectedBuildingId)
    || state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city')
    || state.units.find((unit) => unit.faction === 'olundar');
  const minX = revealed.length ? Math.min(...revealed.map((tile) => tile.x)) : selected?.x || 0;
  const maxX = revealed.length ? Math.max(...revealed.map((tile) => tile.x)) : selected?.x || MAP_WIDTH - 1;
  const minY = revealed.length ? Math.min(...revealed.map((tile) => tile.y)) : selected?.y || 0;
  const maxY = revealed.length ? Math.max(...revealed.map((tile) => tile.y)) : selected?.y || MAP_HEIGHT - 1;
  const revealedWidth = maxX - minX + 1;
  const revealedHeight = maxY - minY + 1;
  const phoneViewport = isPhoneBattlefieldViewport();
  const minCameraWidth = phoneViewport ? 8 : 9;
  const maxCameraWidth = phoneViewport ? 12 : 14;
  const minCameraHeight = phoneViewport ? 6 : 7;
  const maxCameraHeight = phoneViewport ? 8 : 10;
  const width = Math.min(MAP_WIDTH, Math.max(minCameraWidth, Math.min(maxCameraWidth, revealedWidth + 2)));
  const height = Math.min(MAP_HEIGHT, Math.max(minCameraHeight, Math.min(maxCameraHeight, revealedHeight + 2)));
  const centerX = selected ? selected.x : (minX + maxX) / 2;
  const centerY = selected ? selected.y : (minY + maxY) / 2;
  return {
    x: clamp(Math.round(centerX - width / 2), 0, Math.max(0, MAP_WIDTH - width)),
    y: clamp(Math.round(centerY - height / 2), 0, Math.max(0, MAP_HEIGHT - height)),
    width,
    height
  };
}

function sortedTilesForMap(map) {
  const cached = SORTED_TILE_CACHE.get(map);
  if (cached?.source === map.tiles && cached.sorted.length === map.tiles.length) return cached.sorted;
  const sorted = map.tiles.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
  SORTED_TILE_CACHE.set(map, { source: map.tiles, sorted });
  return sorted;
}

function cameraTileWindow(layout, margin = 2) {
  return {
    minX: Math.max(0, layout.camera.x - margin),
    maxX: Math.min(MAP_WIDTH - 1, layout.camera.x + layout.camera.width + margin - 1),
    minY: Math.max(0, layout.camera.y - margin),
    maxY: Math.min(MAP_HEIGHT - 1, layout.camera.y + layout.camera.height + margin - 1)
  };
}

function isInTileWindow(tile, window) {
  return tile.x >= window.minX && tile.x <= window.maxX && tile.y >= window.minY && tile.y <= window.maxY;
}

function cameraSortedTiles(map, layout, margin = 2) {
  const window = cameraTileWindow(layout, margin);
  return sortedTilesForMap(map).filter((tile) => isInTileWindow(tile, window));
}

function renderBudget(layout) {
  const viewportWidth = compactViewportWidth();
  const phoneViewport = viewportWidth <= 620;
  const tabletViewport = viewportWidth <= 980;
  const compact = phoneViewport
    ? layout.tileSize < 38 || layout.mapWidth < 520
    : tabletViewport || layout.tileSize < 42 || layout.mapWidth < 640 || layout.camera.width <= 10;
  return {
    compact,
    cinematicRelief: layout.tileSize >= 30,
    terrainVignettes: (!compact && layout.mapWidth > 760) || (phoneViewport && layout.tileSize >= 44),
    atmosphericGradients: (!compact && layout.mapWidth > 820) || (phoneViewport && layout.tileSize >= 46)
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

export function drawGame(canvas, state, hoverTile = null, lensId = 'normal', routeOverlay = null, missionFocusOverlay = null, battleImpact = null, openingOrderOverlay = null, diplomacyOverlay = null) {
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
  drawImperialColorGrade(ctx, state, layout);
  drawWorldLight(ctx, state, layout);
  drawStrategicLens(ctx, state, layout, lensId);
  drawDeadwalkerPressureTelegraph(ctx, state, layout);
  drawTacticalActionOverlay(ctx, state, layout, hoverTile);
  const placementFocusMode = state.mode.type === 'build';
  if (!placementFocusMode) {
    drawDiplomacyOpportunityRoute(ctx, state, layout, diplomacyOverlay);
    drawOpeningOrderRoute(ctx, state, layout, openingOrderOverlay);
    drawMissionRoute(ctx, state, layout, routeOverlay);
    drawMissionFocus(ctx, state, layout, missionFocusOverlay);
  }
  drawBuildSites(ctx, state, layout, hoverTile);
  drawPieceCastShadows(ctx, state, layout);
  drawBuildings(ctx, state, layout);
  drawUnits(ctx, state, layout);
  drawUnitIdentityStandards(ctx, state, layout);
  drawFieldCommandBanners(ctx, state, layout);
  drawSelectedUnitCommandPresence(ctx, state, layout);
  drawSelection(ctx, state, layout, hoverTile);
  drawOpeningOrderForeground(ctx, state, layout, openingOrderOverlay);
  drawDiplomacyOpportunityForeground(ctx, state, layout, diplomacyOverlay);
  drawFog(ctx, state, layout);
  drawFogAtmosphere(ctx, state, layout);
  drawBattleImpact(ctx, state, layout, battleImpact);
  ctx.restore();
  drawImperialMapFrame(ctx, layout);
  drawMiniMap(ctx, state, layout, lensId);
  drawHollowCrownCompass(ctx, state, layout);
  drawStatusRibbon(ctx, state, layout);
}

function drawBattleImpact(ctx, state, layout, impact) {
  if (!impact || !isVisible(state, impact.x, impact.y)) return;
  if (impact.type === 'strategic') {
    drawStrategicImpact(ctx, layout, impact);
    return;
  }
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

function drawStrategicImpact(ctx, layout, impact) {
  const bounds = tileBounds(layout, impact.x, impact.y);
  const { x, y, s } = bounds;
  const accent = impact.color || '#2d93aa';
  const label = impact.label || 'PACT';
  const title = impact.title || 'Survival Pact';
  const isOrder = impact.strategicType === 'fieldOrder';

  ctx.save();
  ctx.shadowColor = isOrder ? 'rgba(39, 139, 118, 0.34)' : 'rgba(37, 132, 166, 0.34)';
  ctx.shadowBlur = Math.max(5, s * 0.15);
  fillTileDiamond(ctx, bounds, isOrder ? 'rgba(191, 246, 210, 0.30)' : 'rgba(185, 237, 255, 0.32)', s * 0.08);
  ctx.shadowBlur = 0;
  strokeTileDiamond(ctx, bounds, 'rgba(255, 255, 248, 0.88)', Math.max(2, s * 0.070), s * 0.02);
  strokeTileDiamond(ctx, bounds, accent, Math.max(2, s * 0.048), s * 0.11);
  drawStrategicImpactRings(ctx, bounds, s, accent, isOrder);
  drawStrategicImpactStandard(ctx, x, y, s, accent, label, title, isOrder);
  ctx.restore();
}

function drawStrategicImpactRings(ctx, bounds, s, accent, isOrder) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i += 1) {
    const scale = 1 + i * 0.17;
    const alpha = isOrder ? 0.30 - i * 0.06 : 0.34 - i * 0.07;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = i === 0 ? accent : 'rgba(255, 255, 245, 0.86)';
    ctx.lineWidth = Math.max(1.2, s * (0.026 - i * 0.003));
    ctx.beginPath();
    ctx.moveTo(bounds.cx, bounds.cy - bounds.halfH * scale);
    ctx.lineTo(bounds.cx + bounds.halfW * scale, bounds.cy);
    ctx.lineTo(bounds.cx, bounds.cy + bounds.halfH * scale);
    ctx.lineTo(bounds.cx - bounds.halfW * scale, bounds.cy);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 0.78;
  ctx.strokeStyle = isOrder ? 'rgba(58, 126, 67, 0.56)' : 'rgba(35, 119, 129, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.beginPath();
  ctx.ellipse(bounds.cx, bounds.cy + bounds.halfH * 0.32, s * 0.58, s * 0.18, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawStrategicImpactStandard(ctx, x, y, s, accent, label, title, isOrder) {
  const w = Math.max(76, Math.min(s * 2.1, title.length * s * 0.092));
  const h = Math.max(24, s * 0.34);
  const px = x + s * 0.22;
  const py = y - s * 0.42;
  ctx.save();
  ctx.shadowColor = 'rgba(42, 76, 62, 0.24)';
  ctx.shadowBlur = Math.max(4, s * 0.09);
  ctx.shadowOffsetY = Math.max(1, s * 0.025);
  roundRectPath(ctx, px, py, w, h, h * 0.30);
  const fill = ctx.createLinearGradient(px, py, px + w, py + h);
  fill.addColorStop(0, 'rgba(255, 255, 250, 0.97)');
  fill.addColorStop(0.52, isOrder ? 'rgba(233, 251, 220, 0.94)' : 'rgba(229, 249, 255, 0.94)');
  fill.addColorStop(1, colorMix(accent, '#ffffff', 0.78));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorMix(accent, '#ffffff', 0.22);
  ctx.lineWidth = Math.max(1, s * 0.014);
  ctx.stroke();
  ctx.fillStyle = accent;
  roundRectPath(ctx, px + 2, py + 2, Math.max(8, h * 0.38), h - 4, h * 0.18);
  ctx.fill();
  ctx.fillStyle = '#17331f';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.max(6.5, h * 0.24)}px system-ui, sans-serif`;
  ctx.fillText(label, px + h * 0.55, py + h * 0.33, w - h * 0.70);
  ctx.fillStyle = isOrder ? '#225f3f' : '#155b72';
  ctx.font = `900 ${Math.max(8, h * 0.31)}px system-ui, sans-serif`;
  ctx.fillText(fitStrategicImpactTitle(title), px + h * 0.55, py + h * 0.68, w - h * 0.66);
  ctx.restore();
}

function fitStrategicImpactTitle(title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  return clean.length > 22 ? `${clean.slice(0, 21).trim()}...` : clean;
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
  gradient.addColorStop(0, '#fffffb');
  gradient.addColorStop(0.46, '#f5f8df');
  gradient.addColorStop(1, '#d9f3ee');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = '#2f96a5';
  ctx.lineWidth = 1;
  const gap = Math.max(42, Math.floor(canvas.width / 30));
  for (let x = -gap; x < canvas.width + gap; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + canvas.height * 0.24, canvas.height);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const sun = ctx.createRadialGradient(canvas.width * 0.20, canvas.height * 0.08, canvas.width * 0.02, canvas.width * 0.20, canvas.height * 0.08, canvas.width * 0.44);
  sun.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  sun.addColorStop(0.38, 'rgba(255, 244, 188, 0.20)');
  sun.addColorStop(1, 'rgba(255, 244, 188, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawTiles(ctx, state, layout) {
  const sortedTiles = cameraSortedTiles(state.map, layout, 3);
  const budget = renderBudget(layout);
  drawContinentUnderpaint(ctx, state, layout, sortedTiles);
  drawBiomeWash(ctx, state, layout, sortedTiles);
  if (budget.atmosphericGradients) drawRegionalAtmosphere(ctx, state, layout, sortedTiles);
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
  drawElevationSeams(ctx, state, layout, sortedTiles);
  drawTerrainContinuity(ctx, state, layout, sortedTiles);
  drawTopographicContourInk(ctx, state, layout, sortedTiles);
  drawRiverbankHighlights(ctx, state, layout, sortedTiles);
  drawRiverNetwork(ctx, state, layout, sortedTiles);
  drawRoadNetwork(ctx, state, layout, sortedTiles);
  drawImperialTerritoryVeneer(ctx, state, layout, sortedTiles);
  drawGeographyOverlays(ctx, state, layout, sortedTiles);
  drawTerrainCanopyHighlights(ctx, state, layout, sortedTiles);
  if (budget.cinematicRelief) drawCinematicTerrainRelief(ctx, state, layout, sortedTiles);
  drawRevealedTerrainPresenceGrade(ctx, state, layout, sortedTiles);
  if (budget.terrainVignettes) drawTerrainLandmarkVignettes(ctx, state, layout, sortedTiles);
  drawRevealedFrontierRim(ctx, state, layout, sortedTiles);
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

function drawRegionalAtmosphere(ctx, state, layout, sortedTiles) {
  ctx.save();
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y)) continue;
    const visible = isVisible(state, tile.x, tile.y);
    const bounds = tileBounds(layout, tile.x, tile.y);
    const seed = tileNoise(tile, 801);
    const cx = bounds.cx + layout.halfTileWidth * (seed - 0.5) * 0.42;
    const cy = bounds.cy + layout.halfTileHeight * (tileNoise(tile, 802) - 0.5) * 0.55;
    const radius = layout.tileSize * regionalAtmosphereRadius(tile.terrain, seed);
    const atmosphere = regionalAtmosphereColor(tile.terrain, visible);
    ctx.globalCompositeOperation = atmosphere.mode;
    ctx.globalAlpha = atmosphere.alpha;
    const wash = ctx.createRadialGradient(cx, cy, layout.tileSize * 0.16, cx, cy, radius);
    wash.addColorStop(0, atmosphere.core);
    wash.addColorStop(0.58, atmosphere.mid);
    wash.addColorStop(1, atmosphere.edge);
    ctx.fillStyle = wash;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

function regionalAtmosphereRadius(terrain, seed) {
  if (terrain === 'river') return 1.35 + seed * 0.30;
  if (terrain === 'forest' || terrain === 'marsh') return 1.20 + seed * 0.24;
  if (terrain === 'hills' || terrain === 'mountains') return 1.28 + seed * 0.26;
  if (terrain === 'blight') return 1.50 + seed * 0.36;
  return 1.04 + seed * 0.20;
}

function regionalAtmosphereColor(terrain, visible) {
  const alphaScale = visible ? 1 : 0.42;
  if (terrain === 'river') {
    return {
      mode: 'screen',
      alpha: 0.18 * alphaScale,
      core: 'rgba(214, 248, 255, 0.42)',
      mid: 'rgba(74, 164, 202, 0.16)',
      edge: 'rgba(74, 164, 202, 0)'
    };
  }
  if (terrain === 'forest') {
    return {
      mode: 'multiply',
      alpha: 0.22 * alphaScale,
      core: 'rgba(22, 72, 38, 0.34)',
      mid: 'rgba(31, 91, 49, 0.16)',
      edge: 'rgba(31, 91, 49, 0)'
    };
  }
  if (terrain === 'hills' || terrain === 'mountains') {
    return {
      mode: 'multiply',
      alpha: 0.18 * alphaScale,
      core: 'rgba(126, 83, 37, 0.30)',
      mid: 'rgba(159, 111, 55, 0.14)',
      edge: 'rgba(159, 111, 55, 0)'
    };
  }
  if (terrain === 'marsh') {
    return {
      mode: 'multiply',
      alpha: 0.20 * alphaScale,
      core: 'rgba(44, 94, 60, 0.28)',
      mid: 'rgba(99, 139, 77, 0.14)',
      edge: 'rgba(99, 139, 77, 0)'
    };
  }
  if (terrain === 'blight') {
    return {
      mode: 'screen',
      alpha: 0.23 * alphaScale,
      core: 'rgba(156, 243, 138, 0.24)',
      mid: 'rgba(74, 188, 107, 0.10)',
      edge: 'rgba(74, 188, 107, 0)'
    };
  }
  return {
    mode: 'screen',
    alpha: 0.12 * alphaScale,
    core: 'rgba(255, 230, 148, 0.26)',
    mid: 'rgba(247, 204, 113, 0.08)',
    edge: 'rgba(247, 204, 113, 0)'
  };
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
  glow.addColorStop(0, 'rgba(255, 244, 190, 0.12)');
  glow.addColorStop(0.44, 'rgba(255, 230, 152, 0.028)');
  glow.addColorStop(1, 'rgba(255, 230, 152, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const shadeGradient = ctx.createLinearGradient(layout.frameX, layout.frameY, layout.frameX + layout.mapWidth, layout.frameY + layout.mapHeight);
  shadeGradient.addColorStop(0, 'rgba(42, 75, 64, 0)');
  shadeGradient.addColorStop(0.58, 'rgba(42, 75, 64, 0.025)');
  shadeGradient.addColorStop(1, 'rgba(34, 47, 54, 0.13)');
  ctx.fillStyle = shadeGradient;
  ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  if (state.turn > 1) {
    ctx.globalAlpha = Math.min(0.10, state.turn * 0.004);
    ctx.fillStyle = 'rgba(84, 106, 82, 0.38)';
    ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  }
  ctx.restore();
}

function drawImperialColorGrade(ctx, state, layout) {
  const selected = state.units.find((unit) => unit.id === state.selectedUnitId)
    || state.buildings.find((building) => building.id === state.selectedBuildingId)
    || state.units.find((unit) => unit.faction === 'olundar' && !unit.hasActed);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const depth = ctx.createLinearGradient(layout.frameX, layout.frameY, layout.frameX + layout.mapWidth, layout.frameY + layout.mapHeight);
  depth.addColorStop(0, 'rgba(255, 255, 255, 0)');
  depth.addColorStop(0.48, 'rgba(77, 123, 91, 0.025)');
  depth.addColorStop(1, 'rgba(43, 82, 72, 0.115)');
  ctx.fillStyle = depth;
  ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const sun = ctx.createLinearGradient(layout.frameX, layout.frameY, layout.frameX + layout.mapWidth * 0.66, layout.frameY + layout.mapHeight * 0.72);
  sun.addColorStop(0, 'rgba(255, 255, 236, 0.11)');
  sun.addColorStop(0.34, 'rgba(255, 237, 167, 0.028)');
  sun.addColorStop(1, 'rgba(255, 237, 167, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
  ctx.restore();

  if (selected && isRevealed(state, selected.x, selected.y)) {
    const bounds = tileBounds(layout, selected.x, selected.y);
    const radius = layout.tileSize * (isPhoneBattlefieldViewport() ? 3.2 : 2.7);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const focus = ctx.createRadialGradient(bounds.cx, bounds.cy, layout.tileSize * 0.26, bounds.cx, bounds.cy, radius);
    focus.addColorStop(0, 'rgba(255, 249, 207, 0.18)');
    focus.addColorStop(0.38, 'rgba(227, 255, 197, 0.045)');
    focus.addColorStop(1, 'rgba(227, 255, 197, 0)');
    ctx.fillStyle = focus;
    ctx.fillRect(bounds.cx - radius, bounds.cy - radius, radius * 2, radius * 2);
    ctx.restore();
  }
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

function drawElevationSeams(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y) || tile.terrain === 'river') continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbor = tileAt(state, tile.x + dx, tile.y + dy);
      if (!neighbor || !isRevealed(state, neighbor.x, neighbor.y) || neighbor.terrain === 'river') continue;
      const elevationDelta = Math.abs((tile.elevation || 0) - (neighbor.elevation || 0));
      const reliefDelta = Math.abs(terrainReliefRank(tile.terrain) - terrainReliefRank(neighbor.terrain)) * 0.055;
      const strength = elevationDelta + reliefDelta;
      if (strength < 0.16) continue;
      const upper = (tile.elevation || 0) + terrainReliefRank(tile.terrain) * 0.025 >= (neighbor.elevation || 0) + terrainReliefRank(neighbor.terrain) * 0.025
        ? { tile, dx, dy }
        : { tile: neighbor, dx: -dx, dy: -dy };
      const bounds = tileBounds(layout, upper.tile.x, upper.tile.y);
      const [start, end] = frontierEdgePoints(bounds, upper.dx, upper.dy);
      const visible = isVisible(state, tile.x, tile.y) && isVisible(state, neighbor.x, neighbor.y);
      const width = Math.max(1.2, layout.tileSize * (0.018 + Math.min(0.26, strength) * 0.12));
      const drop = layout.tileSize * (0.012 + Math.min(0.22, strength) * 0.055);

      ctx.globalAlpha = visible ? Math.min(0.42, 0.14 + strength * 0.48) : Math.min(0.22, 0.07 + strength * 0.24);
      ctx.strokeStyle = 'rgba(70, 43, 22, 0.68)';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y + drop);
      ctx.lineTo(end.x, end.y + drop);
      ctx.stroke();

      ctx.globalAlpha = visible ? Math.min(0.36, 0.12 + strength * 0.36) : Math.min(0.18, 0.05 + strength * 0.16);
      ctx.strokeStyle = 'rgba(255, 241, 184, 0.74)';
      ctx.lineWidth = Math.max(1, width * 0.42);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y - drop * 0.32);
      ctx.lineTo(end.x, end.y - drop * 0.32);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function terrainReliefRank(terrain) {
  if (terrain === 'mountains') return 4;
  if (terrain === 'hills') return 3;
  if (terrain === 'forest' || terrain === 'ruins') return 2;
  if (terrain === 'marsh' || terrain === 'blight') return 1;
  return 0;
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
      ctx.strokeStyle = 'rgba(83, 93, 77, 0.66)';
      ctx.lineWidth = Math.max(4, layout.tileSize * 0.14);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(243, 225, 157, 0.92)';
      ctx.lineWidth = Math.max(2, layout.tileSize * 0.07);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - layout.halfTileHeight * 0.03);
      ctx.lineTo(b.x, b.y - layout.halfTileHeight * 0.03);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawImperialTerritoryVeneer(ctx, state, layout, sortedTiles) {
  const imperialHoldings = state.buildings.filter((building) => building.faction === 'olundar' && building.type !== 'road');
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y)) continue;
    const visible = isVisible(state, tile.x, tile.y);
    const holding = buildingAt(state, tile.x, tile.y);
    const road = Boolean(tile.road || state.buildings.some((building) => building.type === 'road' && building.x === tile.x && building.y === tile.y));
    const supplied = isTileSupplied(state, tile.x, tile.y);
    const holdingDistance = nearestHoldingDistance(imperialHoldings, tile.x, tile.y);
    const imperialGround = supplied || holding?.faction === 'olundar' || (road && holdingDistance <= 6) || holdingDistance <= 2;
    const deadPressure = tile.blight > 0 || holding?.faction === 'dead';

    if (!imperialGround && !deadPressure) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const { x, y, s } = bounds;
    ctx.save();
    tileDiamondPath(ctx, bounds, s * 0.035);
    ctx.clip();
    if (imperialGround) {
      drawImperialInfluenceTile(ctx, tile, bounds, visible, supplied, road, holding?.faction === 'olundar', holdingDistance);
    }
    if (deadPressure) {
      drawDeadwalkerPressureTile(ctx, tile, bounds, visible, holding?.faction === 'dead');
    }
    if (imperialGround && visible && !unitAt(state, tile.x, tile.y) && tileNoise(tile, 1005) > 0.78) {
      drawSupplyPennant(ctx, x, y, s, road || holding?.faction === 'olundar');
    }
    ctx.restore();
  }
  ctx.restore();
}

function nearestHoldingDistance(holdings, x, y) {
  let best = Infinity;
  for (const holding of holdings) {
    best = Math.min(best, manhattan(holding.x, holding.y, x, y));
  }
  return best;
}

function drawImperialInfluenceTile(ctx, tile, bounds, visible, supplied, road, holding, holdingDistance) {
  const { x, y, s } = bounds;
  const distanceFade = Number.isFinite(holdingDistance) ? Math.max(0, 1 - holdingDistance / 5) : 0;
  const strength = Math.max(holding ? 0.82 : 0, road ? 0.58 : 0, supplied ? 0.42 : 0, distanceFade * 0.46);
  if (strength <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = (visible ? 0.36 : 0.16) * strength;
  const glow = ctx.createRadialGradient(bounds.cx, bounds.cy, s * 0.10, bounds.cx, bounds.cy, s * 0.74);
  glow.addColorStop(0, 'rgba(255, 238, 162, 0.74)');
  glow.addColorStop(0.48, 'rgba(108, 190, 212, 0.18)');
  glow.addColorStop(1, 'rgba(108, 190, 212, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, s, s);
  ctx.restore();

  if (holding || road || (supplied && tileNoise(tile, 994) > 0.46)) {
    drawImperialCobbles(ctx, tile, bounds, visible, Math.max(strength, supplied ? 0.38 : 0));
  }

  if (supplied && tileNoise(tile, 1017) > 0.52) {
    drawSupplyLaurelMosaic(ctx, tile, bounds, visible, road);
  }
}

function drawImperialCobbles(ctx, tile, bounds, visible, strength) {
  const { x, y, s } = bounds;
  ctx.save();
  ctx.globalAlpha = (visible ? 0.34 : 0.13) * strength;
  ctx.strokeStyle = 'rgba(95, 61, 29, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  for (let i = 0; i < 4; i += 1) {
    const offset = 0.22 + i * 0.13 + tileNoise(tile, 1025 + i) * 0.025;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.18, y + s * offset);
    ctx.lineTo(x + s * 0.48, y + s * (offset - 0.14));
    ctx.lineTo(x + s * 0.82, y + s * (offset + 0.03));
    ctx.stroke();
  }
  ctx.globalAlpha = (visible ? 0.24 : 0.10) * strength;
  ctx.strokeStyle = 'rgba(255, 246, 197, 0.74)';
  for (let i = 0; i < 3; i += 1) {
    const offset = 0.34 + i * 0.14 + tileNoise(tile, 1045 + i) * 0.02;
    ctx.beginPath();
    ctx.moveTo(x + s * offset, y + s * 0.27);
    ctx.lineTo(x + s * (offset - 0.18), y + s * 0.52);
    ctx.lineTo(x + s * (offset + 0.05), y + s * 0.78);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSupplyLaurelMosaic(ctx, tile, bounds, visible, road) {
  const { x, y, s } = bounds;
  ctx.save();
  ctx.globalAlpha = visible ? 0.52 : 0.22;
  ctx.strokeStyle = road ? 'rgba(198, 235, 247, 0.78)' : 'rgba(236, 220, 128, 0.72)';
  ctx.lineWidth = Math.max(1, s * 0.018);
  const cx = x + s * (0.35 + tileNoise(tile, 1061) * 0.28);
  const cy = y + s * (0.55 + tileNoise(tile, 1062) * 0.18);
  ctx.beginPath();
  ctx.arc(cx - s * 0.06, cy, s * 0.13, Math.PI * 0.78, Math.PI * 1.55);
  ctx.arc(cx + s * 0.08, cy, s * 0.13, Math.PI * 1.42, Math.PI * 0.22, true);
  ctx.stroke();
  ctx.fillStyle = road ? 'rgba(198, 235, 247, 0.82)' : 'rgba(236, 220, 128, 0.76)';
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.ellipse(cx + s * (-0.12 + i * 0.10), cy + s * (0.02 - i * 0.02), s * 0.026, s * 0.011, -0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSupplyPennant(ctx, x, y, s, imperialAnchor) {
  ctx.save();
  const px = x + s * 0.68;
  const py = y + s * 0.50;
  ctx.globalAlpha = imperialAnchor ? 0.82 : 0.62;
  ctx.strokeStyle = 'rgba(68, 45, 25, 0.66)';
  ctx.lineWidth = Math.max(1, s * 0.014);
  ctx.beginPath();
  ctx.moveTo(px, py + s * 0.12);
  ctx.lineTo(px, py - s * 0.14);
  ctx.stroke();
  ctx.fillStyle = imperialAnchor ? 'rgba(143, 36, 24, 0.88)' : 'rgba(61, 126, 145, 0.78)';
  ctx.beginPath();
  ctx.moveTo(px, py - s * 0.13);
  ctx.lineTo(px + s * 0.13, py - s * 0.08);
  ctx.lineTo(px, py - s * 0.03);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDeadwalkerPressureTile(ctx, tile, bounds, visible, holding) {
  const { x, y, s } = bounds;
  const pressure = Math.max(holding ? 0.78 : 0, Math.min(1, tile.blight || 0));
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = (visible ? 0.24 : 0.11) * Math.max(0.35, pressure);
  const rot = ctx.createLinearGradient(x + s * 0.08, y + s * 0.16, x + s * 0.92, y + s * 0.84);
  rot.addColorStop(0, 'rgba(42, 28, 47, 0.10)');
  rot.addColorStop(0.52, 'rgba(47, 76, 45, 0.28)');
  rot.addColorStop(1, 'rgba(13, 20, 16, 0.36)');
  ctx.fillStyle = rot;
  ctx.fillRect(x, y, s, s);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = visible ? 0.22 : 0.09;
  ctx.strokeStyle = 'rgba(156, 243, 138, 0.72)';
  ctx.lineWidth = Math.max(1, s * 0.016);
  for (let i = 0; i < 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * (0.22 + tileNoise(tile, 1085 + i) * 0.12), y + s * (0.30 + i * 0.18));
    ctx.quadraticCurveTo(
      x + s * (0.48 + tileNoise(tile, 1095 + i) * 0.10),
      y + s * (0.54 - i * 0.04),
      x + s * (0.76 - tileNoise(tile, 1105 + i) * 0.12),
      y + s * (0.66 + i * 0.06)
    );
    ctx.stroke();
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

function drawGeographyOverlays(ctx, state, layout, sortedTiles) {
  ctx.save();
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

function drawCinematicTerrainRelief(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isRevealed(state, tile.x, tile.y)) continue;
    const visible = isVisible(state, tile.x, tile.y);
    const bounds = tileBounds(layout, tile.x, tile.y);
    const palette = terrainPalette(tile.terrain);
    drawCinematicTileGrade(ctx, tile, bounds, layout, visible, palette);
    if (visible) drawCinematicTerrainSignature(ctx, tile, bounds, layout, palette);
  }
  ctx.restore();
}

function drawCinematicTileGrade(ctx, tile, bounds, layout, visible, palette) {
  const { x, y, s } = bounds;
  const relief = 0.70 + clamp(tile.elevation, 0, 1) * 0.45;
  ctx.save();
  tileDiamondPath(ctx, bounds, -0.25);
  ctx.clip();

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = visible ? 0.18 : 0.07;
  const sun = ctx.createLinearGradient(x + s * 0.06, y + s * 0.04, x + s * 0.68, y + s * 0.58);
  sun.addColorStop(0, 'rgba(255, 255, 238, 0.72)');
  sun.addColorStop(0.42, colorMix(palette.light, '#ffffff', 0.48).replace('rgb', 'rgba').replace(')', ', 0.20)'));
  sun.addColorStop(1, 'rgba(255, 255, 238, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(x, y, s, s);

  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = visible ? 0.22 * relief : 0.10 * relief;
  const shadeWash = ctx.createLinearGradient(x + s * 0.26, y + s * 0.28, x + s * 0.98, y + s * 0.98);
  shadeWash.addColorStop(0, 'rgba(255, 255, 255, 0)');
  shadeWash.addColorStop(0.62, colorMix(palette.shadow, '#1e2f24', 0.18).replace('rgb', 'rgba').replace(')', ', 0.22)'));
  shadeWash.addColorStop(1, 'rgba(26, 37, 29, 0.40)');
  ctx.fillStyle = shadeWash;
  ctx.fillRect(x, y, s, s);
  ctx.restore();

  const edgeAlpha = visible ? 1 : 0.45;
  strokeTileDiamond(ctx, bounds, `rgba(15, 47, 40, ${0.10 * edgeAlpha})`, Math.max(1, layout.tileSize * 0.020), 0.5);
  ctx.save();
  ctx.globalAlpha = edgeAlpha;
  ctx.strokeStyle = 'rgba(255, 255, 239, 0.34)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.016);
  ctx.beginPath();
  ctx.moveTo(bounds.cx, bounds.cy - bounds.halfH + 1);
  ctx.lineTo(bounds.cx - bounds.halfW + 1, bounds.cy);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(32, 49, 33, 0.18)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.020);
  ctx.beginPath();
  ctx.moveTo(bounds.cx + bounds.halfW - 1, bounds.cy);
  ctx.lineTo(bounds.cx, bounds.cy + bounds.halfH - 1);
  ctx.lineTo(bounds.cx - bounds.halfW + 1, bounds.cy);
  ctx.stroke();
  ctx.restore();
}

function drawCinematicTerrainSignature(ctx, tile, bounds, layout, palette) {
  const { x, y, s } = bounds;
  const seed = tileNoise(tile, 1401);
  ctx.save();
  tileDiamondPath(ctx, bounds, 1);
  ctx.clip();
  ctx.globalAlpha = 0.30;
  if (tile.terrain === 'plains') {
    ctx.strokeStyle = colorMix(palette.accent, '#6c8f32', 0.18);
    ctx.lineWidth = Math.max(1, s * 0.016);
    for (let i = 0; i < 3; i += 1) {
      const py = y + s * (0.34 + i * 0.14 + seed * 0.025);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.18, py);
      ctx.quadraticCurveTo(x + s * 0.45, py - s * 0.08, x + s * 0.82, py + s * 0.04);
      ctx.stroke();
    }
  } else if (tile.terrain === 'forest') {
    ctx.globalAlpha = 0.36;
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = i % 2 ? palette.crown : palette.accent;
      ctx.beginPath();
      ctx.ellipse(
        x + s * (0.23 + tileNoise(tile, 1421 + i) * 0.54),
        y + s * (0.28 + tileNoise(tile, 1431 + i) * 0.34),
        s * (0.075 + tileNoise(tile, 1441 + i) * 0.035),
        s * 0.044,
        -0.40,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  } else if (tile.terrain === 'hills' || tile.terrain === 'mountains') {
    ctx.globalAlpha = tile.terrain === 'mountains' ? 0.42 : 0.34;
    ctx.strokeStyle = colorMix(palette.light, '#ffffff', 0.36);
    ctx.lineWidth = Math.max(1, s * (tile.terrain === 'mountains' ? 0.024 : 0.018));
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + s * (0.17 + i * 0.12), y + s * (0.66 + i * 0.04));
      ctx.quadraticCurveTo(x + s * (0.44 + seed * 0.12), y + s * (0.38 + i * 0.04), x + s * (0.83 - i * 0.06), y + s * (0.60 + i * 0.04));
      ctx.stroke();
    }
  } else if (tile.terrain === 'river') {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.58;
    ctx.strokeStyle = 'rgba(244, 255, 255, 0.78)';
    ctx.lineWidth = Math.max(1, s * 0.024);
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.10, y + s * (0.43 + i * 0.16));
      ctx.bezierCurveTo(x + s * 0.34, y + s * (0.24 + i * 0.07), x + s * 0.58, y + s * (0.75 - i * 0.05), x + s * 0.91, y + s * (0.44 + i * 0.10));
      ctx.stroke();
    }
  } else if (tile.terrain === 'marsh') {
    ctx.strokeStyle = colorMix(palette.shadow, '#eef8b8', 0.18);
    ctx.lineWidth = Math.max(1, s * 0.018);
    for (let i = 0; i < 5; i += 1) {
      const px = x + s * (0.20 + i * 0.14);
      ctx.beginPath();
      ctx.moveTo(px, y + s * 0.76);
      ctx.quadraticCurveTo(px + s * 0.05, y + s * (0.47 + tileNoise(tile, 1451 + i) * 0.10), px + s * 0.12, y + s * 0.68);
      ctx.stroke();
    }
  } else if (tile.terrain === 'ruins') {
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = colorMix(palette.shadow, '#fff2c1', 0.24);
    ctx.lineWidth = Math.max(1, s * 0.018);
    for (let i = 0; i < 3; i += 1) {
      const px = x + s * (0.24 + i * 0.16);
      ctx.strokeRect(px, y + s * (0.52 - i * 0.06), s * 0.13, s * 0.10);
    }
  } else if (tile.terrain === 'blight') {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = 'rgba(183, 255, 141, 0.68)';
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.24, y + s * 0.32);
    ctx.bezierCurveTo(x + s * 0.42, y + s * 0.54, x + s * 0.50, y + s * 0.42, x + s * 0.76, y + s * 0.70);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrainLandmarkVignettes(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
    if (!isVisible(state, tile.x, tile.y)) continue;
    if (buildingAt(state, tile.x, tile.y) || unitAt(state, tile.x, tile.y)) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const { x, y, s } = bounds;
    const seed = tileNoise(tile, 930);
    ctx.save();
    tileDiamondPath(ctx, bounds, s * 0.04);
    ctx.clip();
    if (tile.road && seed > 0.34) {
      drawRoadMilestone(ctx, tile, x, y, s);
    } else if (tile.terrain === 'plains' && seed > 0.66) {
      drawPlainsEstateVignette(ctx, tile, x, y, s);
    } else if (tile.terrain === 'forest' && seed > 0.28) {
      drawForestDepthVignette(ctx, tile, x, y, s);
    } else if ((tile.terrain === 'hills' || tile.terrain === 'mountains') && seed > 0.38) {
      drawHillOutcropVignette(ctx, tile, x, y, s);
    } else if (tile.terrain === 'river' && seed > 0.22) {
      drawRiverLifeVignette(ctx, tile, x, y, s);
    } else if (tile.terrain === 'marsh' && seed > 0.28) {
      drawMarshPoolVignette(ctx, tile, x, y, s);
    } else if (tile.terrain === 'ruins' && seed > 0.18) {
      drawRuinObeliskVignette(ctx, tile, x, y, s);
    } else if (tile.terrain === 'blight' && seed > 0.20) {
      drawBlightRelicVignette(ctx, tile, x, y, s);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawPlainsEstateVignette(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = 'rgba(121, 145, 57, 0.54)';
  ctx.lineWidth = Math.max(1, s * 0.018);
  for (let i = 0; i < 4; i += 1) {
    const rowY = y + s * (0.56 + i * 0.055);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.16, rowY);
    ctx.quadraticCurveTo(x + s * 0.40, rowY - s * 0.07, x + s * 0.68, rowY);
    ctx.stroke();
  }
  if (tileNoise(tile, 951) > 0.54) {
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = 'rgba(244, 218, 144, 0.88)';
    ctx.fillRect(x + s * 0.62, y + s * 0.45, s * 0.16, s * 0.12);
    ctx.fillStyle = 'rgba(134, 49, 35, 0.86)';
    roof(ctx, x + s * 0.59, y + s * 0.45, s * 0.22, s * 0.08);
    ctx.strokeStyle = 'rgba(74, 48, 27, 0.42)';
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.strokeRect(x + s * 0.62, y + s * 0.45, s * 0.16, s * 0.12);
  }
  ctx.restore();
}

function drawForestDepthVignette(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.68;
  const grove = [
    [0.34, 0.57, 0.70, '#16452a'],
    [0.50, 0.48, 0.82, '#235d35'],
    [0.66, 0.60, 0.62, '#1d4f31']
  ];
  if (tileNoise(tile, 963) > 0.58) grove.push([0.76, 0.50, 0.52, '#2b7340']);
  for (const [px, py, scale, color] of grove) {
    triangle(ctx, x + s * px, y + s * py, s * 0.16 * scale, color);
    ctx.fillStyle = 'rgba(74, 45, 26, 0.78)';
    ctx.fillRect(x + s * (px - 0.016), y + s * (py + 0.10 * scale), s * 0.032, s * 0.10);
  }
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = 'rgba(9, 34, 22, 0.68)';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.56, y + s * 0.75, s * 0.34, s * 0.08, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHillOutcropVignette(ctx, tile, x, y, s) {
  ctx.save();
  const mountain = tile.terrain === 'mountains';
  ctx.globalAlpha = mountain ? 0.72 : 0.55;
  const rock = mountain ? '#d9d6c8' : '#a9824a';
  const shadeRock = mountain ? '#777d7a' : '#6f4a2c';
  ctx.fillStyle = shadeRock;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.22, y + s * 0.74);
  ctx.lineTo(x + s * 0.42, y + s * (mountain ? 0.34 : 0.48));
  ctx.lineTo(x + s * 0.66, y + s * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rock;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.30, y + s * 0.72);
  ctx.lineTo(x + s * 0.43, y + s * (mountain ? 0.36 : 0.50));
  ctx.lineTo(x + s * 0.50, y + s * 0.73);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 241, 190, 0.48)';
  ctx.lineWidth = Math.max(1, s * 0.016);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.43, y + s * (mountain ? 0.38 : 0.51));
  ctx.lineTo(x + s * 0.35, y + s * 0.71);
  ctx.stroke();
  ctx.restore();
}

function drawRiverLifeVignette(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.54;
  ctx.strokeStyle = 'rgba(245, 255, 250, 0.84)';
  ctx.lineWidth = Math.max(1, s * 0.022);
  for (let i = 0; i < 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * (0.20 + i * 0.30), y + s * (0.55 + i * 0.05));
    ctx.bezierCurveTo(
      x + s * (0.34 + i * 0.20),
      y + s * 0.38,
      x + s * (0.52 + i * 0.14),
      y + s * 0.75,
      x + s * (0.78 + i * 0.08),
      y + s * 0.50
    );
    ctx.stroke();
  }
  if (tileNoise(tile, 972) > 0.56) {
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = 'rgba(102, 72, 38, 0.78)';
    ctx.beginPath();
    ctx.ellipse(x + s * 0.58, y + s * 0.56, s * 0.15, s * 0.035, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 242, 185, 0.64)';
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarshPoolVignette(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.40;
  ctx.fillStyle = 'rgba(184, 225, 174, 0.46)';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.54, y + s * 0.65, s * 0.24, s * 0.07, -0.20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(37, 80, 50, 0.62)';
  ctx.lineWidth = Math.max(1, s * 0.018);
  for (let i = 0; i < 4; i += 1) {
    const px = x + s * (0.28 + i * 0.12);
    ctx.beginPath();
    ctx.moveTo(px, y + s * 0.76);
    ctx.quadraticCurveTo(px + s * 0.02, y + s * 0.54, px + s * 0.10, y + s * 0.66);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRuinObeliskVignette(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.66;
  ctx.fillStyle = 'rgba(94, 78, 58, 0.78)';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.36, y + s * 0.70);
  ctx.lineTo(x + s * 0.42, y + s * 0.30);
  ctx.lineTo(x + s * 0.50, y + s * 0.70);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(230, 211, 160, 0.80)';
  ctx.fillRect(x + s * 0.28, y + s * 0.72, s * 0.34, s * 0.045);
  ctx.strokeStyle = 'rgba(255, 244, 201, 0.46)';
  ctx.lineWidth = Math.max(1, s * 0.014);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.42, y + s * 0.34);
  ctx.lineTo(x + s * 0.39, y + s * 0.69);
  ctx.stroke();
  ctx.restore();
}

function drawBlightRelicVignette(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.70;
  ctx.strokeStyle = 'rgba(156, 243, 138, 0.54)';
  ctx.lineWidth = Math.max(1, s * 0.024);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.34, y + s * 0.72);
  ctx.quadraticCurveTo(x + s * 0.50, y + s * 0.38, x + s * 0.66, y + s * 0.72);
  ctx.moveTo(x + s * 0.42, y + s * 0.60);
  ctx.lineTo(x + s * 0.58, y + s * 0.60);
  ctx.stroke();
  ctx.fillStyle = 'rgba(16, 26, 18, 0.72)';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.50, y + s * 0.74, s * 0.22, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRoadMilestone(ctx, tile, x, y, s) {
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = 'rgba(245, 226, 170, 0.90)';
  ctx.strokeStyle = 'rgba(85, 56, 30, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.014);
  const mx = x + s * (0.28 + tileNoise(tile, 981) * 0.42);
  const my = y + s * (0.42 + tileNoise(tile, 982) * 0.22);
  roundRectPath(ctx, mx - s * 0.035, my - s * 0.075, s * 0.07, s * 0.15, s * 0.018);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(143, 36, 24, 0.76)';
  ctx.fillRect(mx - s * 0.018, my - s * 0.030, s * 0.036, s * 0.018);
  ctx.restore();
}

function drawRevealedFrontierRim(ctx, state, layout, sortedTiles) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tile of sortedTiles) {
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
  veil.addColorStop(0, '#fffdf1');
  veil.addColorStop(0.54, '#edf2d7');
  veil.addColorStop(1, '#d5ece3');
  ctx.globalAlpha = 0.64;
  ctx.fillStyle = veil;
  ctx.fillRect(x, y, s, s);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(bounds.cx - bounds.halfW * 0.10, bounds.cy - bounds.halfH * 0.18, bounds.halfW * 0.54, bounds.halfH * 0.34, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  strokeTileDiamond(ctx, bounds, 'rgba(70, 137, 132, 0.10)', 1, 0.5);
  if ((tile.x * 5 + tile.y * 7) % 19 === 0) {
    ctx.save();
    tileDiamondPath(ctx, bounds);
    ctx.clip();
    ctx.strokeStyle = 'rgba(57, 126, 137, 0.10)';
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

function drawRevealedTerrainPresenceGrade(ctx, state, layout, sortedTiles) {
  ctx.save();
  for (const tile of sortedTiles) {
    if (!isVisible(state, tile.x, tile.y)) continue;
    const bounds = tileBounds(layout, tile.x, tile.y);
    const palette = terrainPalette(tile.terrain);
    const pressure = Math.min(1, Math.max(0, (tile.elevation || 0) * 0.72 + terrainReliefRank(tile.terrain) * 0.08));
    const alpha = terrainPresenceAlpha(tile.terrain, pressure);

    ctx.globalCompositeOperation = tile.terrain === 'river' ? 'screen' : 'multiply';
    ctx.globalAlpha = alpha;
    fillTileDiamond(ctx, bounds, terrainPresenceColor(tile.terrain, palette), layout.tileSize * 0.035);

    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = tile.terrain === 'river' ? 0.28 : 0.16 + pressure * 0.08;
    strokeTileDiamond(ctx, bounds, colorMix(palette.light, '#ffffff', 0.38), Math.max(1, layout.tileSize * 0.018), layout.tileSize * 0.055);

    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.10 + pressure * 0.08;
    ctx.strokeStyle = colorMix(palette.shadow, '#24311f', tile.terrain === 'river' ? 0.08 : 0.18);
    ctx.lineWidth = Math.max(1, layout.tileSize * (tile.terrain === 'mountains' ? 0.032 : 0.020));
    ctx.beginPath();
    ctx.moveTo(bounds.cx + bounds.halfW * 0.88, bounds.cy - bounds.halfH * 0.02);
    ctx.lineTo(bounds.cx, bounds.cy + bounds.halfH * 0.86);
    ctx.lineTo(bounds.cx - bounds.halfW * 0.88, bounds.cy + bounds.halfH * 0.02);
    ctx.stroke();
  }
  ctx.restore();
}

function terrainPresenceAlpha(terrain, pressure) {
  if (terrain === 'river') return 0.25;
  if (terrain === 'forest') return 0.24 + pressure * 0.06;
  if (terrain === 'hills' || terrain === 'mountains') return 0.22 + pressure * 0.08;
  if (terrain === 'marsh') return 0.19 + pressure * 0.05;
  if (terrain === 'blight') return 0.27 + pressure * 0.06;
  return 0.17 + pressure * 0.05;
}

function terrainPresenceColor(terrain, palette) {
  if (terrain === 'river') return colorMix(palette.light, '#ffffff', 0.30);
  if (terrain === 'forest') return colorMix(palette.base, palette.shadow, 0.24);
  if (terrain === 'hills' || terrain === 'mountains') return colorMix(palette.base, palette.shadow, 0.16);
  if (terrain === 'marsh') return colorMix(palette.base, '#9fd46f', 0.18);
  if (terrain === 'blight') return colorMix(palette.base, '#9cf38a', 0.18);
  return colorMix(palette.base, '#f8df6f', 0.18);
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
  const window = cameraTileWindow(layout, 3);
  ctx.save();
  for (const tile of lens.tiles) {
    if (!isInTileWindow(tile, window)) continue;
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
    if (!isInTileWindow(marker, window)) continue;
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

function drawDiplomacyOpportunityRoute(ctx, state, layout, overlay) {
  if (!overlay || state.status !== 'playing') return;
  const target = overlay.target && isRevealed(state, overlay.target.x, overlay.target.y)
    ? overlay.target
    : null;
  if (!target) return;
  const points = Array.isArray(overlay.path)
    ? overlay.path.filter((point) => point && isRevealed(state, point.x, point.y))
    : [];
  const color = '#8ad8ff';
  const center = (point) => tileCenter(layout, point.x, point.y);
  ctx.save();
  if (points.length >= 2) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(104, 197, 232, 0.28)';
    ctx.shadowBlur = layout.tileSize * 0.20;
    ctx.setLineDash([Math.max(8, layout.tileSize * 0.34), Math.max(4, layout.tileSize * 0.15)]);
    ctx.lineWidth = Math.max(5, layout.tileSize * 0.19);
    ctx.strokeStyle = 'rgba(26, 52, 60, 0.68)';
    drawRouteStroke(ctx, points, center);
    ctx.lineWidth = Math.max(2, layout.tileSize * 0.078);
    ctx.strokeStyle = color;
    drawRouteStroke(ctx, points, center);
    ctx.setLineDash([]);
    drawDiplomacyRouteSeals(ctx, points, center, layout, color);
  }
  drawDiplomacyOathField(ctx, tileBounds(layout, target.x, target.y), layout, overlay, color);
  ctx.restore();
}

function drawDiplomacyRouteSeals(ctx, points, center, layout, color) {
  ctx.save();
  for (let i = 1; i < points.length - 1; i += 2) {
    const p = center(points[i]);
    ctx.fillStyle = 'rgba(255, 252, 230, 0.82)';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, layout.tileSize * 0.085), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawDiplomacyOathField(ctx, bounds, layout, overlay, color) {
  const s = layout.tileSize;
  ctx.save();
  ctx.shadowColor = 'rgba(104, 197, 232, 0.38)';
  ctx.shadowBlur = s * 0.22;
  fillTileDiamond(ctx, bounds, 'rgba(138, 216, 255, 0.18)', 1);
  strokeTileDiamond(ctx, bounds, 'rgba(22, 62, 74, 0.60)', Math.max(2, s * 0.070), 2);
  strokeTileDiamond(ctx, bounds, color, Math.max(2, s * 0.036), 7);
  ctx.shadowBlur = 0;

  const ringY = bounds.cy + layout.halfTileHeight * 0.10;
  ctx.globalAlpha = 0.62;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, s * 0.026);
  ctx.setLineDash([Math.max(5, s * 0.13), Math.max(4, s * 0.09)]);
  ctx.beginPath();
  ctx.ellipse(bounds.cx, ringY, layout.halfTileWidth * 0.82, layout.halfTileHeight * 0.78, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  drawDiplomacyOathSeal(ctx, bounds.cx, ringY, layout, color);
  ctx.restore();
}

function drawDiplomacyOpportunityForeground(ctx, state, layout, overlay) {
  if (!overlay || state.status !== 'playing') return;
  const target = overlay.target && isRevealed(state, overlay.target.x, overlay.target.y)
    ? overlay.target
    : null;
  if (!target) return;
  const bounds = tileBounds(layout, target.x, target.y);
  const color = '#8ad8ff';
  drawDiplomacyOathStandard(ctx, bounds, layout, overlay, color);
}

function drawDiplomacyOathStandard(ctx, bounds, layout, overlay, color) {
  const s = layout.tileSize;
  const compact = layout.tileSize < 31;
  const poleX = bounds.cx - s * 0.16;
  const baseY = bounds.cy + layout.halfTileHeight * 0.42;
  const topY = bounds.cy - layout.halfTileHeight * (compact ? 1.10 : 1.34);
  ctx.save();
  ctx.shadowColor = 'rgba(104, 197, 232, 0.46)';
  ctx.shadowBlur = s * 0.16;
  ctx.strokeStyle = 'rgba(22, 45, 54, 0.82)';
  ctx.lineWidth = Math.max(1.2, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(poleX, topY);
  ctx.lineTo(poleX, baseY);
  ctx.stroke();

  const bannerW = Math.max(14, s * (compact ? 0.30 : 0.40));
  const bannerH = Math.max(9, s * (compact ? 0.16 : 0.22));
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(22, 45, 54, 0.82)';
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.beginPath();
  ctx.moveTo(poleX, topY + s * 0.06);
  ctx.lineTo(poleX + bannerW, topY + s * 0.10);
  ctx.lineTo(poleX + bannerW * 0.74, topY + s * 0.10 + bannerH * 0.48);
  ctx.lineTo(poleX + bannerW, topY + s * 0.10 + bannerH);
  ctx.lineTo(poleX, topY + s * 0.08 + bannerH * 0.82);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (!compact) {
    const label = 'PACT';
    const w = Math.max(42, s * 0.64);
    const h = Math.max(15, s * 0.21);
    const x = bounds.cx - w * 0.5;
    const y = topY - h * 1.05;
    roundRectPath(ctx, x, y, w, h, h * 0.46);
    ctx.fillStyle = 'rgba(239, 250, 251, 0.96)';
    ctx.strokeStyle = 'rgba(34, 115, 127, 0.48)';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#174a60';
    ctx.font = `900 ${Math.max(8, s * 0.105)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bounds.cx, y + h * 0.54);
  }

  drawDiplomacyOathSeal(ctx, poleX + s * 0.08, topY + s * 0.07, layout, color);
  ctx.restore();
}

function drawDiplomacyOathSeal(ctx, cx, cy, layout, color) {
  const r = Math.max(4, layout.tileSize * 0.09);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 252, 230, 0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(22, 74, 96, 0.82)';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.48, cy + r * 0.05);
  ctx.quadraticCurveTo(cx - r * 0.12, cy - r * 0.46, cx, cy - r * 0.04);
  ctx.quadraticCurveTo(cx + r * 0.12, cy - r * 0.46, cx + r * 0.48, cy + r * 0.05);
  ctx.moveTo(cx - r * 0.36, cy + r * 0.36);
  ctx.lineTo(cx + r * 0.36, cy + r * 0.36);
  ctx.stroke();
  ctx.restore();
}

function drawOpeningOrderRoute(ctx, state, layout, overlay) {
  if (!overlay || state.status !== 'playing') return;
  const target = overlay.target && isRevealed(state, overlay.target.x, overlay.target.y)
    ? overlay.target
    : null;
  const points = Array.isArray(overlay.path)
    ? overlay.path.filter((point) => point && isRevealed(state, point.x, point.y))
    : [];
  if (!target && points.length < 2) return;

  const color = openingOrderColor(overlay.kind, overlay.canExecute);
  const center = (point) => tileCenter(layout, point.x, point.y);
  ctx.save();
  if (overlay.kind === 'fortify' && target) drawOpeningHoldGroundField(ctx, state, layout, overlay, color);
  if (points.length >= 2) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(240, 200, 102, 0.26)';
    ctx.shadowBlur = layout.tileSize * 0.18;
    ctx.setLineDash([Math.max(7, layout.tileSize * 0.28), Math.max(4, layout.tileSize * 0.14)]);
    ctx.lineWidth = Math.max(5, layout.tileSize * 0.20);
    ctx.strokeStyle = 'rgba(55, 31, 15, 0.78)';
    drawRouteStroke(ctx, points, center);
    ctx.lineWidth = Math.max(2, layout.tileSize * 0.075);
    ctx.strokeStyle = color;
    drawRouteStroke(ctx, points, center);
    ctx.setLineDash([]);
    drawOpeningRouteSparks(ctx, points, center, layout, color);
  }
  if (target) drawOpeningTargetStandard(ctx, tileBounds(layout, target.x, target.y), layout, overlay, color);
  ctx.restore();
}

function drawOpeningHoldGroundField(ctx, state, layout, overlay, color) {
  const target = overlay.target;
  if (!target || !isRevealed(state, target.x, target.y)) return;
  const bounds = tileBounds(layout, target.x, target.y);
  const s = layout.tileSize;
  const center = tileCenter(layout, target.x, target.y);
  const ready = overlay.canExecute !== false;

  ctx.save();
  ctx.shadowColor = ready ? 'rgba(255, 224, 138, 0.34)' : 'rgba(132, 104, 70, 0.24)';
  ctx.shadowBlur = s * 0.22;
  fillTileDiamond(ctx, bounds, ready ? 'rgba(255, 224, 138, 0.18)' : 'rgba(122, 100, 66, 0.14)', 1);
  strokeTileDiamond(ctx, bounds, 'rgba(59, 33, 14, 0.68)', Math.max(2, s * 0.075), 2);
  strokeTileDiamond(ctx, bounds, color, Math.max(2, s * 0.042), 7);
  ctx.shadowBlur = 0;

  drawOpeningHoldShieldStuds(ctx, bounds, layout, color, ready);
  drawOpeningHoldGroundStandard(ctx, bounds, layout, color, ready);

  ctx.globalAlpha = ready ? 0.58 : 0.34;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, s * 0.026);
  ctx.setLineDash([Math.max(5, s * 0.13), Math.max(4, s * 0.09)]);
  ctx.beginPath();
  ctx.ellipse(center.x, center.y + layout.halfTileHeight * 0.08, layout.halfTileWidth * 0.78, layout.halfTileHeight * 0.82, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawOpeningOrderForeground(ctx, state, layout, overlay) {
  if (!overlay || state.status !== 'playing' || overlay.kind !== 'fortify') return;
  const target = overlay.target && isRevealed(state, overlay.target.x, overlay.target.y)
    ? overlay.target
    : null;
  if (!target) return;
  const color = openingOrderColor(overlay.kind, overlay.canExecute);
  const bounds = tileBounds(layout, target.x, target.y);
  drawOpeningHoldGroundStandard(ctx, bounds, layout, color, overlay.canExecute !== false, true);
  drawOpeningHoldShieldGlyph(ctx, bounds, layout, color, overlay.canExecute !== false);
}

function drawOpeningHoldShieldStuds(ctx, bounds, layout, color, ready) {
  const s = layout.tileSize;
  const studs = [
    { x: bounds.cx, y: bounds.cy - layout.halfTileHeight * 0.78 },
    { x: bounds.cx + bounds.halfW * 0.66, y: bounds.cy },
    { x: bounds.cx, y: bounds.cy + layout.halfTileHeight * 0.78 },
    { x: bounds.cx - bounds.halfW * 0.66, y: bounds.cy }
  ];
  ctx.save();
  for (const stud of studs) {
    ctx.fillStyle = 'rgba(49, 29, 13, 0.78)';
    ctx.beginPath();
    ctx.arc(stud.x, stud.y, Math.max(3, s * 0.085), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ready ? color : 'rgba(157, 126, 73, 0.86)';
    ctx.beginPath();
    ctx.arc(stud.x, stud.y, Math.max(2, s * 0.047), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOpeningHoldGroundStandard(ctx, bounds, layout, color, ready, foreground = false) {
  const s = layout.tileSize;
  const compact = !foreground && (layout.tileSize < 38 || layout.mapWidth < 560);
  if (compact) return;
  const w = Math.max(s * (foreground ? 0.64 : 0.72), foreground ? 40 : 46);
  const h = Math.max(s * (foreground ? 0.20 : 0.22), foreground ? 14 : 16);
  const x = bounds.cx - w * 0.5;
  const y = bounds.cy - layout.halfTileHeight * (foreground ? 1.74 : 1.36);
  ctx.save();
  if (foreground) {
    ctx.shadowColor = ready ? 'rgba(255, 224, 138, 0.55)' : 'rgba(132, 104, 70, 0.32)';
    ctx.shadowBlur = s * 0.18;
  }
  roundRectPath(ctx, x, y, w, h, h * 0.46);
  ctx.fillStyle = ready ? 'rgba(255, 250, 226, 0.96)' : 'rgba(234, 221, 192, 0.90)';
  ctx.strokeStyle = ready ? 'rgba(143, 36, 24, 0.58)' : 'rgba(117, 92, 63, 0.48)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ready ? '#8f2418' : '#745a36';
  ctx.font = `900 ${Math.max(8, s * 0.105)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HOLD', bounds.cx, y + h * 0.54);
  ctx.restore();
}

function drawOpeningHoldShieldGlyph(ctx, bounds, layout, color, ready) {
  const s = layout.tileSize;
  if (layout.tileSize < 30) return;
  const cx = bounds.cx + bounds.halfW * 0.62;
  const cy = bounds.cy - layout.halfTileHeight * 0.54;
  const r = Math.max(5, s * 0.13);
  ctx.save();
  ctx.shadowColor = ready ? 'rgba(255, 224, 138, 0.42)' : 'rgba(132, 104, 70, 0.24)';
  ctx.shadowBlur = s * 0.14;
  ctx.fillStyle = 'rgba(58, 32, 14, 0.82)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = ready ? color : 'rgba(157, 126, 73, 0.88)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.72);
  ctx.quadraticCurveTo(cx + r * 0.62, cy - r * 0.40, cx + r * 0.52, cy + r * 0.18);
  ctx.quadraticCurveTo(cx + r * 0.24, cy + r * 0.78, cx, cy + r * 0.94);
  ctx.quadraticCurveTo(cx - r * 0.24, cy + r * 0.78, cx - r * 0.52, cy + r * 0.18);
  ctx.quadraticCurveTo(cx - r * 0.62, cy - r * 0.40, cx, cy - r * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(58, 32, 14, 0.78)';
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.stroke();
  ctx.restore();
}

function drawOpeningRouteSparks(ctx, points, center, layout, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = layout.tileSize * 0.14;
  for (let i = 1; i < points.length; i += 1) {
    const p = center(points[i]);
    ctx.fillStyle = 'rgba(52, 30, 13, 0.72)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, layout.tileSize * 0.085), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, layout.tileSize * 0.045), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOpeningTargetStandard(ctx, bounds, layout, overlay, color) {
  const s = layout.tileSize;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = s * 0.20;
  fillTileDiamond(ctx, bounds, overlay.canExecute ? 'rgba(255, 215, 107, 0.20)' : 'rgba(157, 126, 73, 0.16)', 2);
  strokeTileDiamond(ctx, bounds, 'rgba(58, 32, 14, 0.72)', Math.max(2, s * 0.065), 2);
  strokeTileDiamond(ctx, bounds, color, Math.max(2, s * 0.034), 6);
  ctx.shadowBlur = 0;

  const poleX = bounds.cx - s * 0.12;
  const poleBaseY = bounds.cy + layout.halfTileHeight * 0.38;
  const poleTopY = bounds.cy - layout.halfTileHeight * 1.08;
  ctx.strokeStyle = 'rgba(49, 29, 13, 0.86)';
  ctx.lineWidth = Math.max(1.4, s * 0.025);
  ctx.beginPath();
  ctx.moveTo(poleX, poleTopY);
  ctx.lineTo(poleX, poleBaseY);
  ctx.stroke();

  ctx.fillStyle = overlay.canExecute ? '#8f2418' : '#8f6b3e';
  ctx.strokeStyle = '#3b1f10';
  ctx.lineWidth = Math.max(1, s * 0.017);
  ctx.beginPath();
  ctx.moveTo(poleX, poleTopY + s * 0.03);
  ctx.lineTo(poleX + s * 0.38, poleTopY + s * 0.09);
  ctx.lineTo(poleX + s * 0.25, poleTopY + s * 0.23);
  ctx.lineTo(poleX, poleTopY + s * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(poleX + s * 0.08, poleTopY + s * 0.11, Math.max(2, s * 0.035), 0, Math.PI * 2);
  ctx.fill();

  const compact = layout.tileSize < 40 || layout.mapWidth < 560;
  if (!compact) {
    const label = overlay.kind === 'build' || overlay.kind === 'build-preview' ? 'BUILD' : 'NEXT';
    const labelW = Math.max(s * 0.62, 42);
    const labelH = Math.max(s * 0.20, 15);
    const labelX = bounds.cx - labelW * 0.5;
    const labelY = bounds.cy - layout.halfTileHeight * 1.44;
    roundRectPath(ctx, labelX, labelY, labelW, labelH, labelH * 0.45);
    ctx.fillStyle = 'rgba(255, 250, 226, 0.94)';
    ctx.strokeStyle = 'rgba(143, 36, 24, 0.58)';
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8f2418';
    ctx.font = `900 ${Math.max(8, s * 0.105)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bounds.cx, labelY + labelH * 0.54);
  }
  ctx.restore();
}

function openingOrderColor(kind, canExecute = true) {
  if (!canExecute) return 'rgba(158, 125, 78, 0.78)';
  if (kind === 'build' || kind === 'build-preview') return '#88d8ff';
  if (kind === 'train') return '#baf58c';
  if (kind === 'fortify') return '#ffe08a';
  return '#f0c866';
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
  const streamlinedOverlay = shouldStreamlineMovementOverlay(layout, reachable, hoverMove);
  ctx.save();
  drawMovementRadiusField(ctx, layout, reachable, def.move, hoverMove, streamlinedOverlay);
  drawSelectedMovementCommandAegis(ctx, layout, unit, reachable, def.move, hoverMove);
  drawCommandRangeFrontier(ctx, layout, reachable, def.move);
  if (!streamlinedOverlay) {
    drawMovementBlockedApproaches(ctx, state, layout, reachable);
    drawCommandSupplyMesh(ctx, layout, reachable, hoverMove);
    drawCommandSurveyVectors(ctx, state, layout, unit, reachable, def.move, hoverMove);
  }
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

function shouldStreamlineMovementOverlay(layout, reachable, hoverMove) {
  if (hoverMove || reachable.length <= 4) return false;
  return layout.canvasWidth * layout.canvasHeight >= 1100000;
}

function drawSelectedMovementCommandAegis(ctx, layout, unit, reachable, maxMove, hoverMove = null) {
  if (!reachable.length) return;
  const origin = tileBounds(layout, unit.x, unit.y);
  const color = FACTION_COLORS[unit.faction] || '#f0c866';
  const overlayScale = movementOverlayScale(layout);
  const compact = layout.mapWidth < 620 || layout.tileSize < 42;
  const routeLimit = compact ? 4 : 7;
  const routes = selectedCommandAegisRoutes(reachable, maxMove, routeLimit, hoverMove);
  ctx.save();
  drawCommandAegisSourceField(ctx, origin, layout, color, overlayScale);
  for (const item of routes) drawCommandAegisRoute(ctx, layout, origin, item, maxMove, sameTile(item, hoverMove), overlayScale);
  drawCommandAegisLaurel(ctx, origin, layout, color, overlayScale, compact);
  ctx.restore();
}

function selectedCommandAegisRoutes(reachable, maxMove, limit, hoverMove = null) {
  const scored = reachable
    .map((item) => ({
      item,
      score: selectedCommandAegisScore(item, maxMove, sameTile(item, hoverMove))
    }))
    .sort((a, b) => b.score - a.score || a.item.cost - b.item.cost);
  return scored.slice(0, limit).map((entry) => entry.item);
}

function selectedCommandAegisScore(item, maxMove, hovered = false) {
  let score = hovered ? 100 : 0;
  if (item.frontier || item.cost >= maxMove) score += 22;
  if (item.road) score += 16;
  if (item.supplied) score += 11;
  if (item.terrainCost > 1 || item.relief > 0.35) score += 9;
  score += Math.min(14, item.cost * 2.8);
  score += Math.max(0, item.elevation - 0.5) * 8;
  return score;
}

function drawCommandAegisSourceField(ctx, origin, layout, color, overlayScale) {
  const radius = layout.tileSize * 1.24 * overlayScale;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const glow = ctx.createRadialGradient(origin.cx, origin.cy, layout.tileSize * 0.10, origin.cx, origin.cy, radius);
  glow.addColorStop(0, colorMix(color, '#fff6b5', 0.54).replace('rgb', 'rgba').replace(')', ', 0.40)'));
  glow.addColorStop(0.42, 'rgba(255, 225, 113, 0.17)');
  glow.addColorStop(1, 'rgba(255, 225, 113, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(origin.cx - radius, origin.cy - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawCommandAegisRoute(ctx, layout, origin, item, maxMove, hovered, overlayScale) {
  const route = item.route?.length ? item.route.map(tileFromKey) : [{ x: item.x, y: item.y }];
  if (!route.length) return;
  const points = [
    { x: origin.cx, y: origin.cy + layout.halfTileHeight * 0.12 },
    ...route.map((step) => {
      const center = tileCenter(layout, step.x, step.y);
      return { x: center.x, y: center.y + layout.halfTileHeight * 0.14 };
    })
  ];
  const accent = item.road
    ? 'rgba(114, 219, 247, ALPHA)'
    : item.supplied
      ? 'rgba(204, 248, 121, ALPHA)'
      : item.terrainCost > 1 || item.frontier
        ? 'rgba(255, 200, 82, ALPHA)'
        : 'rgba(255, 232, 142, ALPHA)';
  const alpha = hovered ? 0.72 : item.frontier || item.road ? 0.46 : 0.32;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = accent.replace('ALPHA', String(Math.min(0.28, alpha * 0.52)));
  ctx.shadowBlur = layout.tileSize * (hovered ? 0.11 : 0.065) * overlayScale;
  ctx.strokeStyle = 'rgba(50, 32, 16, 0.30)';
  ctx.lineWidth = Math.max(2, layout.tileSize * (hovered ? 0.070 : 0.050) * overlayScale);
  drawAegisRoutePath(ctx, points, layout);
  ctx.stroke();
  ctx.strokeStyle = accent.replace('ALPHA', String(alpha));
  ctx.lineWidth = Math.max(1.2, layout.tileSize * (hovered ? 0.034 : 0.024) * overlayScale);
  ctx.setLineDash([layout.tileSize * 0.18 * overlayScale, layout.tileSize * 0.12 * overlayScale]);
  drawAegisRoutePath(ctx, points, layout);
  ctx.stroke();
  ctx.setLineDash([]);
  const target = tileBounds(layout, item.x, item.y);
  drawCommandAegisDestinationSeal(ctx, target, layout, item, maxMove, hovered, overlayScale);
  ctx.restore();
}

function drawAegisRoutePath(ctx, points, layout) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const point = points[i];
    const midX = (prev.x + point.x) * 0.5;
    const midY = (prev.y + point.y) * 0.5 - layout.tileSize * 0.035;
    ctx.quadraticCurveTo(midX, midY, point.x, point.y);
  }
}

function drawCommandAegisDestinationSeal(ctx, bounds, layout, item, maxMove, hovered, overlayScale) {
  const frontier = item.frontier || item.cost >= maxMove;
  const r = Math.max(3.4, layout.tileSize * (hovered ? 0.074 : frontier ? 0.058 : 0.046) * overlayScale);
  const cx = bounds.cx;
  const cy = bounds.cy + layout.halfTileHeight * 0.22;
  ctx.save();
  ctx.fillStyle = item.road
    ? 'rgba(232, 252, 255, 0.94)'
    : item.supplied
      ? 'rgba(241, 255, 196, 0.92)'
      : 'rgba(255, 244, 177, 0.92)';
  ctx.strokeStyle = item.road ? 'rgba(28, 110, 148, 0.72)' : 'rgba(117, 70, 20, 0.66)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.014 * overlayScale);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = frontier ? '#8f2418' : item.road ? '#156c8f' : '#79501d';
  ctx.font = `900 ${Math.max(6, r * 1.05)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.max(0, Math.round(maxMove - item.cost))), cx, cy + r * 0.04, r * 1.45);
  ctx.restore();
}

function drawCommandAegisLaurel(ctx, origin, layout, color, overlayScale, compact) {
  const rx = layout.tileSize * (compact ? 0.43 : 0.52) * overlayScale;
  const ry = layout.tileSize * (compact ? 0.17 : 0.20) * overlayScale;
  const cy = origin.cy + layout.halfTileHeight * 0.26;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255, 224, 128, 0.38)';
  ctx.shadowBlur = layout.tileSize * 0.08 * overlayScale;
  ctx.strokeStyle = colorMix(color, '#fff2a8', 0.42);
  ctx.lineWidth = Math.max(1.4, layout.tileSize * 0.026 * overlayScale);
  ctx.beginPath();
  ctx.ellipse(origin.cx, cy, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(origin.cx, cy, rx, ry, 0, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(95, 59, 20, 0.56)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012 * overlayScale);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const a = side < 0 ? Math.PI * (0.23 + i * 0.13) : Math.PI * (1.23 + i * 0.13);
      const px = origin.cx + Math.cos(a) * rx;
      const py = cy + Math.sin(a) * ry;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + side * layout.tileSize * 0.075 * overlayScale, py - layout.tileSize * 0.055 * overlayScale);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function collectReachableTiles(state, unit, move) {
  const startKey = idx(unit.x, unit.y);
  const costs = new Map([[startKey, 0]]);
  const previous = new Map();
  const frontier = [{ x: unit.x, y: unit.y, cost: 0 }];

  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    const currentKey = idx(current.x, current.y);
    if (current.cost !== costs.get(currentKey)) continue;

    for (const next of neighbors4(current.x, current.y)) {
      if (!canEnter(state, unit, next.x, next.y)) continue;
      const step = moveCostFor(state, unit, next.x, next.y, current);
      const nextCost = current.cost + step;
      if (nextCost > move) continue;
      const nextKey = idx(next.x, next.y);
      if (!costs.has(nextKey) || nextCost < costs.get(nextKey)) {
        costs.set(nextKey, nextCost);
        previous.set(nextKey, currentKey);
        frontier.push({ x: next.x, y: next.y, cost: nextCost });
      }
    }
  }

  const tiles = [];
  for (const [key, cost] of costs.entries()) {
    if (key === startKey) continue;
    const x = key % MAP_WIDTH;
    const y = Math.floor(key / MAP_WIDTH);
    const tile = tileAt(state, x, y);
    const road = Boolean(tile?.road || state.buildings.find((building) => building.type === 'road' && building.x === x && building.y === y));
    const terrain = tile?.terrain || 'plains';
    const terrainCost = TERRAIN[terrain]?.move || 1;
    const relief = terrainReliefRank(terrain);
    const elevation = tile?.elevation || 0;
    tiles.push({
      x,
      y,
      cost,
      remaining: Math.max(0, move - cost),
      terrain,
      terrainCost,
      relief,
      elevation,
      terrainPressure: road ? 0 : terrainCost + relief * 0.45 + Math.max(0, elevation - 0.45) * 1.6 + (terrain === 'blight' ? 1.1 : 0),
      route: reconstructReachablePath(previous, startKey, key),
      road,
      supplied: isTileSupplied(state, x, y),
      frontier: cost >= move
    });
  }

  tiles.sort((a, b) => a.cost - b.cost);
  return tiles;
}

function reconstructReachablePath(previous, startKey, targetKey) {
  const path = [];
  let key = targetKey;
  while (key !== startKey) {
    path.unshift(key);
    key = previous.get(key);
    if (key == null) return [];
  }
  return path;
}

function drawMovementRadiusField(ctx, layout, reachable, maxMove, hoverMove = null, streamlined = false) {
  if (!reachable.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (!streamlined) {
    drawMovementRadiusStrategicPlate(ctx, layout, reachable, maxMove, hoverMove);
    drawMovementRadiusCommandSurface(ctx, layout, reachable, maxMove, hoverMove);
    drawMovementCommandCanopy(ctx, layout, reachable, maxMove, hoverMove);
  }
  for (const item of reachable) {
    drawMovementReachWash(ctx, tileBounds(layout, item.x, item.y), layout, item, maxMove, sameTile(item, hoverMove));
  }
  if (!streamlined) drawMovementInteriorPips(ctx, layout, reachable, maxMove, hoverMove);
  drawMovementRadiusBoundary(ctx, layout, reachable, maxMove);
  if (!streamlined) drawMovementCostContours(ctx, layout, reachable, maxMove);
  drawMovementCommandGrid(ctx, layout, reachable, maxMove, hoverMove);
  ctx.restore();
}

function drawMovementRadiusStrategicPlate(ctx, layout, reachable, maxMove, hoverMove = null) {
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const item of reachable) {
    const hovered = sameTile(item, hoverMove);
    const bounds = tileBounds(layout, item.x, item.y);
    const progress = Math.max(0, Math.min(1, item.cost / Math.max(1, maxMove)));
    const coreAlpha = Math.min(0.46, (hovered ? 0.38 : item.frontier ? 0.23 : 0.16 - progress * 0.03) * (overlayScale > 1 ? 1.18 : 1));
    const radius = layout.tileSize * (hovered ? 0.86 : 0.62) * overlayScale;
    const glow = ctx.createRadialGradient(bounds.cx, bounds.cy, layout.tileSize * 0.06, bounds.cx, bounds.cy, radius);
    glow.addColorStop(0, `rgba(255, 252, 218, ${coreAlpha})`);
    glow.addColorStop(0.56, item.road ? `rgba(137, 224, 255, ${coreAlpha * 0.54})` : `rgba(255, 213, 104, ${coreAlpha * 0.42})`);
    glow.addColorStop(1, 'rgba(255, 213, 104, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(bounds.cx - radius, bounds.cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

function drawMovementRadiusCommandSurface(ctx, layout, reachable, maxMove, hoverMove = null) {
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const item of reachable) {
    const bounds = tileBounds(layout, item.x, item.y);
    const hovered = sameTile(item, hoverMove);
    const progress = Math.max(0, Math.min(1, item.cost / Math.max(1, maxMove)));
    const frontier = item.cost >= maxMove;
    const rugged = item.terrainCost > 1 || item.relief > 0 || item.elevation > 0.62;
    const alpha = Math.min(0.54, (hovered ? 0.46 : frontier ? 0.34 : rugged ? 0.30 : 0.24) * (overlayScale > 1 ? 1.14 : 1));
    const ground = item.road
      ? `rgba(116, 213, 238, ${alpha})`
      : item.supplied
        ? `rgba(196, 235, 124, ${alpha})`
        : rugged
          ? `rgba(228, 161, 70, ${alpha * 0.92})`
          : `rgba(255, 214, 103, ${Math.max(0.18, alpha - progress * 0.04)})`;
    const light = item.road
      ? `rgba(235, 253, 255, ${alpha * 0.84})`
      : item.supplied
        ? `rgba(247, 255, 216, ${alpha * 0.80})`
        : `rgba(255, 250, 199, ${alpha * 0.70})`;
    const shade = item.road
      ? `rgba(26, 115, 145, ${alpha * 0.46})`
      : item.supplied
        ? `rgba(72, 130, 50, ${alpha * 0.42})`
        : `rgba(118, 72, 23, ${alpha * 0.44})`;
    const gradient = ctx.createLinearGradient(bounds.cx, bounds.cy - bounds.halfH, bounds.cx, bounds.cy + bounds.halfH);
    gradient.addColorStop(0, light);
    gradient.addColorStop(0.42, ground);
    gradient.addColorStop(1, shade);
    fillTileDiamond(ctx, bounds, gradient, hovered ? 0.4 : 2.8);
    strokeTileDiamond(ctx, bounds, item.road ? 'rgba(217, 250, 255, 0.46)' : 'rgba(255, 245, 188, 0.42)', Math.max(1, layout.tileSize * (hovered ? 0.028 : 0.014) * overlayScale), hovered ? 2.2 : 5.2);
  }
  ctx.restore();
}

function drawMovementInteriorPips(ctx, layout, reachable, maxMove, hoverMove = null) {
  if (layout.tileSize < 30) return;
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  for (const item of reachable) {
    const bounds = tileBounds(layout, item.x, item.y);
    const hovered = sameTile(item, hoverMove);
    const frontier = item.cost >= maxMove;
    const rough = item.terrainCost > 1 || item.relief > 0 || item.elevation > 0.62;
    const radius = Math.max(2.6, layout.tileSize * (hovered ? 0.070 : frontier ? 0.054 : 0.040) * overlayScale);
    ctx.globalAlpha = Math.min(0.96, (hovered ? 0.92 : frontier || rough ? 0.74 : 0.56) * (overlayScale > 1 ? 1.10 : 1));
    ctx.fillStyle = item.road
      ? 'rgba(225, 250, 255, 0.92)'
      : item.supplied
        ? 'rgba(239, 255, 196, 0.88)'
        : rough
          ? 'rgba(255, 232, 160, 0.88)'
          : 'rgba(255, 246, 200, 0.82)';
    ctx.strokeStyle = item.road
      ? 'rgba(24, 104, 140, 0.62)'
      : item.supplied
        ? 'rgba(59, 128, 62, 0.56)'
        : rough
          ? 'rgba(157, 91, 31, 0.54)'
          : 'rgba(126, 93, 38, 0.42)';
    ctx.lineWidth = Math.max(1, layout.tileSize * 0.014 * overlayScale);
    ctx.beginPath();
    ctx.arc(bounds.cx, bounds.cy + layout.halfTileHeight * 0.18, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawMovementCommandCanopy(ctx, layout, reachable, maxMove, hoverMove = null) {
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const item of reachable) {
    const bounds = tileBounds(layout, item.x, item.y);
    const hovered = sameTile(item, hoverMove);
    const frontier = item.cost >= maxMove;
    const accent = movementTerrainAccent(item);
    const radius = layout.tileSize * (hovered ? 0.92 : frontier ? 0.70 : 0.58) * overlayScale;
    const alpha = Math.min(0.48, (hovered ? 0.42 : frontier ? 0.27 : 0.18) * (overlayScale > 1 ? 1.16 : 1));
    const glow = ctx.createRadialGradient(bounds.cx, bounds.cy, layout.tileSize * 0.08, bounds.cx, bounds.cy, radius);
    glow.addColorStop(0, accent.canopyCore.replace('ALPHA', String(alpha)));
    glow.addColorStop(0.52, accent.canopyMid.replace('ALPHA', String(alpha * 0.48)));
    glow.addColorStop(1, accent.canopyMid.replace('ALPHA', '0'));
    ctx.fillStyle = glow;
    ctx.fillRect(bounds.cx - radius, bounds.cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

function drawMovementReachWash(ctx, bounds, layout, item, maxMove, hovered = false) {
  const overlayScale = movementOverlayScale(layout);
  const progress = Math.max(0, Math.min(1, item.cost / Math.max(1, maxMove)));
  const pressure = Math.max(0, Math.min(1, item.terrainPressure / 4.2));
  const palette = movementRadiusPalette(item, progress, pressure, hovered);
  const gradient = ctx.createLinearGradient(bounds.cx, bounds.cy - bounds.halfH, bounds.cx, bounds.cy + bounds.halfH);
  gradient.addColorStop(0, palette.light);
  gradient.addColorStop(0.56, palette.fill);
  gradient.addColorStop(1, palette.shadow);

  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = layout.tileSize * (hovered ? 0.22 : 0.12) * overlayScale;
  fillTileDiamond(ctx, bounds, gradient, hovered ? 0.5 : 2.0);
  strokeTileDiamond(ctx, bounds, palette.outerStroke || 'rgba(71, 42, 16, 0.30)', Math.max(1, layout.tileSize * (hovered ? 0.050 : 0.026) * overlayScale), hovered ? 0.5 : 2.2);
  strokeTileDiamond(ctx, bounds, palette.innerStroke, Math.max(1, layout.tileSize * (hovered ? 0.030 : 0.016) * overlayScale), hovered ? 3 : 5);
  drawMovementTopographyCues(ctx, bounds, layout, item, progress, pressure, hovered);
  ctx.restore();
}

function movementRadiusPalette(item, progress, pressure, hovered) {
  if (item.road) {
    return {
      light: hovered ? 'rgba(216, 249, 255, 0.50)' : 'rgba(202, 245, 255, 0.30)',
      fill: hovered ? 'rgba(88, 190, 225, 0.44)' : 'rgba(88, 174, 205, 0.24)',
      shadow: 'rgba(24, 103, 133, 0.18)',
      outerStroke: 'rgba(24, 103, 133, 0.40)',
      innerStroke: 'rgba(128, 226, 255, 0.42)',
      glow: 'rgba(104, 214, 255, 0.30)'
    };
  }
  if (item.supplied) {
    return {
      light: hovered ? 'rgba(241, 255, 203, 0.44)' : 'rgba(232, 255, 190, 0.27)',
      fill: hovered ? 'rgba(166, 220, 105, 0.40)' : 'rgba(154, 204, 92, 0.22)',
      shadow: 'rgba(64, 120, 45, 0.16)',
      outerStroke: 'rgba(64, 120, 45, 0.34)',
      innerStroke: 'rgba(205, 244, 137, 0.36)',
      glow: 'rgba(185, 245, 140, 0.24)'
    };
  }
  const accent = movementTerrainAccent(item);
  if (item.terrain !== 'plains' && (item.terrainCost > 1 || item.terrain === 'blight')) {
    const heavyAlpha = hovered ? 0.44 : pressure > 0.62 || item.frontier ? 0.30 : 0.22;
    return {
      light: accent.light.replace('ALPHA', String(heavyAlpha + 0.06)),
      fill: accent.fill.replace('ALPHA', String(heavyAlpha)),
      shadow: accent.shadow.replace('ALPHA', String(Math.max(0.13, heavyAlpha - 0.08))),
      outerStroke: accent.outerStroke,
      innerStroke: accent.stroke,
      glow: accent.glow
    };
  }
  const heavy = pressure > 0.62 || item.frontier;
  const alpha = hovered ? 0.46 : heavy ? 0.28 : 0.22 - progress * 0.035;
  return {
    light: `rgba(255, 239, 168, ${alpha + 0.06})`,
    fill: heavy ? `rgba(222, 151, 58, ${alpha})` : `rgba(241, 198, 86, ${alpha})`,
    shadow: heavy ? `rgba(125, 70, 24, ${Math.max(0.15, alpha - 0.08)})` : `rgba(134, 92, 28, ${Math.max(0.11, alpha - 0.09)})`,
    outerStroke: heavy ? 'rgba(94, 54, 19, 0.38)' : 'rgba(128, 83, 24, 0.30)',
    innerStroke: heavy ? 'rgba(255, 211, 110, 0.38)' : 'rgba(255, 232, 154, 0.30)',
    glow: heavy ? 'rgba(255, 184, 83, 0.24)' : 'rgba(255, 220, 124, 0.20)'
  };
}

function movementTerrainAccent(item) {
  const palettes = {
    forest: {
      light: 'rgba(225, 255, 178, ALPHA)',
      fill: 'rgba(122, 173, 75, ALPHA)',
      shadow: 'rgba(41, 88, 38, ALPHA)',
      stroke: 'rgba(223, 249, 150, 0.44)',
      outerStroke: 'rgba(43, 91, 40, 0.38)',
      glow: 'rgba(162, 220, 95, 0.22)',
      canopyCore: 'rgba(210, 255, 150, ALPHA)',
      canopyMid: 'rgba(89, 155, 71, ALPHA)'
    },
    hills: {
      light: 'rgba(255, 226, 150, ALPHA)',
      fill: 'rgba(216, 143, 58, ALPHA)',
      shadow: 'rgba(112, 72, 31, ALPHA)',
      stroke: 'rgba(255, 218, 132, 0.48)',
      outerStroke: 'rgba(120, 74, 25, 0.42)',
      glow: 'rgba(255, 190, 84, 0.25)',
      canopyCore: 'rgba(255, 226, 152, ALPHA)',
      canopyMid: 'rgba(201, 118, 51, ALPHA)'
    },
    mountains: {
      light: 'rgba(255, 249, 218, ALPHA)',
      fill: 'rgba(178, 172, 149, ALPHA)',
      shadow: 'rgba(89, 86, 78, ALPHA)',
      stroke: 'rgba(255, 246, 208, 0.48)',
      outerStroke: 'rgba(80, 78, 70, 0.42)',
      glow: 'rgba(255, 238, 190, 0.24)',
      canopyCore: 'rgba(255, 248, 218, ALPHA)',
      canopyMid: 'rgba(140, 136, 125, ALPHA)'
    },
    river: {
      light: 'rgba(219, 252, 255, ALPHA)',
      fill: 'rgba(77, 174, 210, ALPHA)',
      shadow: 'rgba(28, 97, 133, ALPHA)',
      stroke: 'rgba(167, 235, 255, 0.52)',
      outerStroke: 'rgba(28, 97, 133, 0.44)',
      glow: 'rgba(95, 210, 255, 0.28)',
      canopyCore: 'rgba(218, 252, 255, ALPHA)',
      canopyMid: 'rgba(76, 177, 216, ALPHA)'
    },
    marsh: {
      light: 'rgba(226, 255, 190, ALPHA)',
      fill: 'rgba(116, 158, 94, ALPHA)',
      shadow: 'rgba(45, 91, 56, ALPHA)',
      stroke: 'rgba(212, 246, 158, 0.42)',
      outerStroke: 'rgba(45, 91, 56, 0.40)',
      glow: 'rgba(158, 214, 118, 0.22)',
      canopyCore: 'rgba(224, 255, 184, ALPHA)',
      canopyMid: 'rgba(95, 154, 93, ALPHA)'
    },
    ruins: {
      light: 'rgba(255, 235, 170, ALPHA)',
      fill: 'rgba(182, 147, 85, ALPHA)',
      shadow: 'rgba(96, 75, 45, ALPHA)',
      stroke: 'rgba(255, 226, 148, 0.44)',
      outerStroke: 'rgba(92, 70, 39, 0.40)',
      glow: 'rgba(235, 178, 94, 0.23)',
      canopyCore: 'rgba(255, 235, 170, ALPHA)',
      canopyMid: 'rgba(166, 125, 72, ALPHA)'
    },
    blight: {
      light: 'rgba(201, 255, 167, ALPHA)',
      fill: 'rgba(110, 104, 91, ALPHA)',
      shadow: 'rgba(45, 38, 46, ALPHA)',
      stroke: 'rgba(176, 250, 128, 0.48)',
      outerStroke: 'rgba(49, 44, 48, 0.48)',
      glow: 'rgba(137, 244, 119, 0.24)',
      canopyCore: 'rgba(187, 255, 146, ALPHA)',
      canopyMid: 'rgba(96, 168, 82, ALPHA)'
    },
    plains: {
      light: 'rgba(255, 239, 168, ALPHA)',
      fill: 'rgba(241, 198, 86, ALPHA)',
      shadow: 'rgba(134, 92, 28, ALPHA)',
      stroke: 'rgba(255, 232, 154, 0.30)',
      outerStroke: 'rgba(128, 83, 24, 0.30)',
      glow: 'rgba(255, 220, 124, 0.20)',
      canopyCore: 'rgba(255, 239, 168, ALPHA)',
      canopyMid: 'rgba(226, 177, 75, ALPHA)'
    }
  };
  return palettes[item.terrain] || palettes.plains;
}

function drawMovementTopographyCues(ctx, bounds, layout, item, progress, pressure, hovered = false) {
  const shouldDraw = hovered || item.frontier || item.road || item.supplied || item.terrainCost > 1 || item.relief > 0 || item.elevation > 0.62;
  if (!shouldDraw) return;
  const cueCount = Math.min(4, Math.max(1, Math.ceil(item.terrainPressure - 1)));
  const terrainColor = item.road
    ? 'rgba(226, 250, 255, 0.70)'
    : item.supplied
      ? 'rgba(238, 255, 188, 0.62)'
      : pressure > 0.62
        ? 'rgba(92, 49, 20, 0.42)'
        : 'rgba(126, 81, 28, 0.30)';
  ctx.save();
  tileDiamondPath(ctx, bounds, layout.tileSize * 0.09);
  ctx.clip();
  ctx.globalAlpha = hovered ? 0.95 : 0.68;
  ctx.strokeStyle = terrainColor;
  ctx.lineWidth = Math.max(1, layout.tileSize * (pressure > 0.62 ? 0.022 : 0.016));
  for (let i = 0; i < cueCount; i += 1) {
    const y = bounds.cy - bounds.halfH * 0.35 + bounds.halfH * (0.28 + i * 0.26);
    const sway = tileNoise(item, 1220 + i) * layout.tileSize * 0.11;
    ctx.beginPath();
    ctx.moveTo(bounds.cx - bounds.halfW * (0.50 - i * 0.035), y + sway * 0.10);
    ctx.bezierCurveTo(
      bounds.cx - bounds.halfW * 0.18,
      y - layout.tileSize * (0.05 + pressure * 0.035),
      bounds.cx + bounds.halfW * 0.18,
      y + layout.tileSize * (0.05 + progress * 0.025),
      bounds.cx + bounds.halfW * (0.50 - i * 0.035),
      y - sway * 0.08
    );
    ctx.stroke();
  }
  if (item.frontier) {
    ctx.globalAlpha = hovered ? 0.88 : 0.58;
    ctx.strokeStyle = 'rgba(255, 249, 212, 0.62)';
    ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
    ctx.beginPath();
    ctx.moveTo(bounds.cx - bounds.halfW * 0.34, bounds.cy + bounds.halfH * 0.18);
    ctx.lineTo(bounds.cx, bounds.cy + bounds.halfH * 0.36);
    ctx.lineTo(bounds.cx + bounds.halfW * 0.34, bounds.cy + bounds.halfH * 0.18);
    ctx.stroke();
  }
  drawMovementTerrainInsignia(ctx, bounds, layout, item, hovered);
  ctx.restore();
}

function drawMovementTerrainInsignia(ctx, bounds, layout, item, hovered = false) {
  const s = layout.tileSize;
  const cx = bounds.cx + bounds.halfW * 0.21;
  const cy = bounds.cy - bounds.halfH * 0.26;
  const r = Math.max(3.5, s * (hovered ? 0.095 : 0.074));
  ctx.save();
  ctx.globalAlpha = hovered ? 0.92 : 0.68;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = item.road ? 'rgba(231, 251, 255, 0.86)' : item.supplied ? 'rgba(244, 255, 222, 0.82)' : 'rgba(255, 247, 214, 0.76)';
  ctx.strokeStyle = item.road ? 'rgba(45, 118, 145, 0.56)' : item.supplied ? 'rgba(73, 120, 47, 0.52)' : 'rgba(122, 78, 27, 0.48)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = item.road ? 'rgba(30, 112, 143, 0.82)' : item.terrain === 'blight' ? 'rgba(66, 99, 50, 0.82)' : 'rgba(108, 71, 29, 0.74)';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1, s * 0.018);
  if (item.road) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.62, cy + r * 0.12);
    ctx.lineTo(cx - r * 0.10, cy - r * 0.28);
    ctx.lineTo(cx + r * 0.58, cy + r * 0.16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.34, cy + r * 0.34);
    ctx.lineTo(cx + r * 0.12, cy - r * 0.06);
    ctx.stroke();
  } else if (item.terrain === 'river') {
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy + i * r * 0.22);
      ctx.bezierCurveTo(cx - r * 0.26, cy - r * 0.30 + i * r * 0.18, cx + r * 0.25, cy + r * 0.34 + i * r * 0.10, cx + r * 0.62, cy + i * r * 0.18);
      ctx.stroke();
    }
  } else if (item.terrain === 'forest') {
    for (const [dx, scale] of [[-0.32, 0.70], [0.05, 0.92], [0.38, 0.62]]) {
      ctx.beginPath();
      ctx.moveTo(cx + r * dx, cy - r * scale * 0.62);
      ctx.lineTo(cx + r * (dx + scale * 0.34), cy + r * scale * 0.18);
      ctx.lineTo(cx + r * (dx - scale * 0.34), cy + r * scale * 0.18);
      ctx.closePath();
      ctx.fill();
    }
  } else if (item.terrain === 'hills' || item.terrain === 'mountains') {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.72, cy + r * 0.42);
    ctx.lineTo(cx - r * 0.18, cy - r * 0.40);
    ctx.lineTo(cx + r * 0.24, cy + r * 0.28);
    ctx.lineTo(cx + r * 0.52, cy - r * 0.16);
    ctx.lineTo(cx + r * 0.78, cy + r * 0.42);
    ctx.stroke();
  } else if (item.terrain === 'marsh') {
    for (let i = -1; i <= 1; i += 1) {
      const x = cx + i * r * 0.32;
      ctx.beginPath();
      ctx.moveTo(x, cy + r * 0.48);
      ctx.quadraticCurveTo(x + r * 0.10, cy - r * 0.22, x + r * 0.34, cy + r * 0.14);
      ctx.stroke();
    }
  } else if (item.terrain === 'ruins') {
    ctx.strokeRect(cx - r * 0.40, cy - r * 0.20, r * 0.34, r * 0.58);
    ctx.strokeRect(cx + r * 0.08, cy - r * 0.44, r * 0.34, r * 0.82);
  } else if (item.terrain === 'blight') {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.52, cy - r * 0.22);
    ctx.lineTo(cx - r * 0.06, cy + r * 0.08);
    ctx.lineTo(cx - r * 0.24, cy + r * 0.52);
    ctx.moveTo(cx + r * 0.08, cy - r * 0.44);
    ctx.lineTo(cx + r * 0.38, cy - r * 0.02);
    ctx.lineTo(cx + r * 0.18, cy + r * 0.46);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.56, cy + r * 0.26);
    ctx.quadraticCurveTo(cx, cy - r * 0.32, cx + r * 0.56, cy + r * 0.26);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMovementRadiusBoundary(ctx, layout, reachable, maxMove) {
  const reachableSet = new Set(reachable.map((item) => tileKey(item.x, item.y)));
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 237, 151, 0.42)';
  ctx.shadowBlur = layout.tileSize * 0.16 * overlayScale;
  for (const item of reachable) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (reachableSet.has(tileKey(item.x + dx, item.y + dy))) continue;
      drawMovementBoundaryEdge(ctx, tileBounds(layout, item.x, item.y), layout, item, dx, dy, maxMove);
    }
  }
  ctx.restore();
}

function drawMovementCostContours(ctx, layout, reachable, maxMove) {
  if (reachable.length < 2) return;
  const byKey = new Map(reachable.map((item) => [tileKey(item.x, item.y), item]));
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255, 255, 238, 0.22)';
  ctx.shadowBlur = layout.tileSize * 0.045 * overlayScale;
  for (const item of reachable) {
    const itemBand = movementCostBand(item, maxMove);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const next = byKey.get(tileKey(item.x + dx, item.y + dy));
      if (!next) continue;
      const nextBand = movementCostBand(next, maxMove);
      if (itemBand === nextBand && item.road === next.road && item.supplied === next.supplied) continue;
      const [start, end] = frontierEdgePoints(tileBounds(layout, item.x, item.y), dx, dy);
      const premiumRoute = item.road || next.road;
      const suppliedRoute = item.supplied || next.supplied;
      const frontier = itemBand >= maxMove || nextBand >= maxMove;
      const baseWidth = layout.tileSize * (frontier ? 0.030 : premiumRoute ? 0.024 : 0.018) * overlayScale;
      ctx.strokeStyle = 'rgba(54, 40, 20, 0.22)';
      ctx.lineWidth = Math.max(1.2, baseWidth * 1.9);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.strokeStyle = premiumRoute
        ? 'rgba(210, 250, 255, 0.62)'
        : suppliedRoute
          ? 'rgba(239, 255, 187, 0.55)'
          : frontier
            ? 'rgba(255, 244, 154, 0.68)'
            : 'rgba(255, 252, 224, 0.42)';
      ctx.lineWidth = Math.max(1, baseWidth);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y - layout.tileSize * 0.010);
      ctx.lineTo(end.x, end.y - layout.tileSize * 0.010);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function movementCostBand(item, maxMove) {
  if (item.cost >= maxMove) return maxMove;
  return Math.max(1, Math.ceil(item.cost));
}

function drawMovementCommandGrid(ctx, layout, reachable, maxMove, hoverMove = null) {
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255, 252, 203, 0.30)';
  ctx.shadowBlur = layout.tileSize * 0.08 * overlayScale;
  for (const item of reachable) {
    const bounds = tileBounds(layout, item.x, item.y);
    const hovered = sameTile(item, hoverMove);
    const frontier = item.frontier || item.cost >= maxMove;
    const rough = item.terrainCost > 1 || item.relief > 0 || item.elevation > 0.62;
    const road = item.road;
    const outer = road
      ? 'rgba(20, 113, 153, 0.70)'
      : item.supplied
        ? 'rgba(63, 137, 66, 0.58)'
        : frontier
          ? 'rgba(158, 96, 25, 0.72)'
          : rough
            ? 'rgba(138, 85, 27, 0.54)'
            : 'rgba(124, 91, 33, 0.38)';
    const inner = road
      ? 'rgba(223, 252, 255, 0.94)'
      : item.supplied
        ? 'rgba(241, 255, 184, 0.86)'
        : frontier
          ? 'rgba(255, 249, 178, 0.95)'
          : 'rgba(255, 247, 204, 0.72)';
    const width = layout.tileSize * (hovered ? 0.054 : frontier ? 0.038 : rough || road ? 0.030 : 0.022) * overlayScale;
    strokeTileDiamond(ctx, bounds, outer, Math.max(1.2, width * 1.42), hovered ? 0.4 : 2.6);
    strokeTileDiamond(ctx, bounds, inner, Math.max(1, width), hovered ? 2.6 : 5.4);
    if (frontier || hovered) drawMovementCommandCornerPins(ctx, bounds, layout, item, hovered);
  }
  ctx.restore();
}

function drawMovementCommandCornerPins(ctx, bounds, layout, item, hovered = false) {
  const overlayScale = movementOverlayScale(layout);
  const pinColor = item.road
    ? 'rgba(218, 250, 255, 0.98)'
    : item.supplied
      ? 'rgba(236, 255, 176, 0.96)'
      : 'rgba(255, 244, 155, 0.98)';
  const edgeColor = item.road ? 'rgba(29, 104, 137, 0.76)' : 'rgba(115, 71, 23, 0.68)';
  const r = Math.max(2.2, layout.tileSize * (hovered ? 0.060 : 0.044) * overlayScale);
  const points = [
    [bounds.cx, bounds.cy - bounds.halfH + layout.tileSize * 0.065],
    [bounds.cx + bounds.halfW - layout.tileSize * 0.060, bounds.cy],
    [bounds.cx, bounds.cy + bounds.halfH - layout.tileSize * 0.065],
    [bounds.cx - bounds.halfW + layout.tileSize * 0.060, bounds.cy]
  ];
  ctx.save();
  ctx.fillStyle = pinColor;
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.010 * overlayScale);
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawMovementBoundaryEdge(ctx, bounds, layout, item, dx, dy, maxMove) {
  const overlayScale = movementOverlayScale(layout);
  const [start, end] = frontierEdgePoints(bounds, dx, dy);
  const typeColor = item.road
    ? 'rgba(156, 236, 255, 0.98)'
    : item.supplied
      ? 'rgba(219, 255, 136, 0.96)'
      : item.cost >= maxMove || item.terrainPressure > 2.7
        ? 'rgba(255, 201, 82, 1)'
        : 'rgba(255, 242, 150, 0.98)';
  const commandGold = item.cost >= maxMove
    ? 'rgba(255, 251, 172, 1)'
    : 'rgba(255, 253, 214, 0.98)';
  ctx.strokeStyle = 'rgba(24, 94, 118, 0.76)';
  ctx.lineWidth = Math.max(6, layout.tileSize * 0.150 * overlayScale);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 250, 0.86)';
  ctx.lineWidth = Math.max(3.4, layout.tileSize * 0.098 * overlayScale);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y - layout.tileSize * 0.012);
  ctx.lineTo(end.x, end.y - layout.tileSize * 0.012);
  ctx.stroke();
  ctx.strokeStyle = commandGold;
  ctx.lineWidth = Math.max(2.8, layout.tileSize * 0.068 * overlayScale);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y - layout.tileSize * 0.018);
  ctx.lineTo(end.x, end.y - layout.tileSize * 0.018);
  ctx.stroke();
  ctx.strokeStyle = typeColor;
  ctx.lineWidth = Math.max(1.4, layout.tileSize * 0.032 * overlayScale);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y - layout.tileSize * 0.036);
  ctx.lineTo(end.x, end.y - layout.tileSize * 0.036);
  ctx.stroke();
  drawMovementBoundaryStud(ctx, start, end, layout, typeColor, item.cost >= maxMove);
}

function drawMovementBoundaryStud(ctx, start, end, layout, color, frontier = false) {
  const overlayScale = movementOverlayScale(layout);
  const mx = (start.x + end.x) * 0.5;
  const my = (start.y + end.y) * 0.5 - layout.tileSize * 0.032;
  const r = Math.max(2.3, layout.tileSize * (frontier ? 0.045 : 0.034) * overlayScale);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 224, 128, 0.28)';
  ctx.shadowBlur = layout.tileSize * 0.08;
  ctx.fillStyle = 'rgba(74, 45, 18, 0.74)';
  ctx.beginPath();
  ctx.arc(mx, my, r * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 224, 0.82)';
  ctx.beginPath();
  ctx.arc(mx - r * 0.28, my - r * 0.28, r * 0.30, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMovementBlockedApproaches(ctx, state, layout, reachable) {
  if (!reachable.length) return;
  const reachableSet = new Set(reachable.map((item) => tileKey(item.x, item.y)));
  const drawn = new Set();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of reachable) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = item.x + dx;
      const ny = item.y + dy;
      const key = `${item.x},${item.y}:${dx},${dy}`;
      if (drawn.has(key) || reachableSet.has(tileKey(nx, ny)) || !inMap(nx, ny) || !isRevealed(state, nx, ny)) continue;
      const tile = tileAt(state, nx, ny);
      const terrain = TERRAIN[tile?.terrain || 'plains'];
      const hardBlocked = !terrain?.passable;
      const roughBlocked = (terrain?.move || 1) > Math.max(1, item.remaining + 0.5) || tile?.terrain === 'blight';
      if (!hardBlocked && !roughBlocked) continue;
      drawn.add(key);
      drawMovementBlockedHatch(ctx, tileBounds(layout, item.x, item.y), layout, dx, dy, tile?.terrain || 'plains', hardBlocked);
    }
  }
  ctx.restore();
}

function drawMovementBlockedHatch(ctx, bounds, layout, dx, dy, terrain, hardBlocked) {
  const overlayScale = movementOverlayScale(layout);
  const [start, end] = frontierEdgePoints(bounds, dx, dy);
  const adjacent = {
    x: bounds.cx + (dx - dy) * layout.halfTileWidth,
    y: bounds.cy + (dx + dy) * layout.halfTileHeight
  };
  const mid = { x: (start.x + end.x) * 0.5, y: (start.y + end.y) * 0.5 };
  const vx = adjacent.x - mid.x;
  const vy = adjacent.y - mid.y;
  const len = Math.max(0.001, Math.hypot(vx, vy));
  const nx = vx / len;
  const ny = vy / len;
  const terrainColor = terrain === 'river'
    ? 'rgba(65, 138, 171, 0.68)'
    : terrain === 'forest' || terrain === 'marsh'
      ? 'rgba(76, 117, 58, 0.62)'
      : terrain === 'blight'
        ? 'rgba(78, 128, 58, 0.70)'
        : hardBlocked
          ? 'rgba(76, 69, 58, 0.74)'
          : 'rgba(126, 78, 32, 0.66)';
  ctx.save();
  ctx.shadowColor = terrain === 'blight' ? 'rgba(130, 238, 104, 0.20)' : 'rgba(255, 218, 126, 0.14)';
  ctx.shadowBlur = layout.tileSize * 0.04 * overlayScale;
  ctx.strokeStyle = 'rgba(56, 34, 16, 0.58)';
  ctx.lineWidth = Math.max(2, layout.tileSize * 0.040 * overlayScale);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = terrainColor;
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018 * overlayScale);
  for (let i = 1; i <= 3; i += 1) {
    const t = i / 4;
    const px = start.x + (end.x - start.x) * t;
    const py = start.y + (end.y - start.y) * t;
    const length = layout.tileSize * (hardBlocked ? 0.18 : 0.13) * overlayScale;
    ctx.beginPath();
    ctx.moveTo(px - nx * length * 0.12, py - ny * length * 0.12);
    ctx.lineTo(px + nx * length, py + ny * length);
    ctx.stroke();
  }
  ctx.restore();
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
  const overlayScale = movementOverlayScale(layout);
  const fill = item.road
    ? (hovered ? 'rgba(118, 205, 235, 0.40)' : `rgba(118, 186, 210, ${overlayScale > 1 ? 0.24 : 0.18})`)
    : item.supplied
      ? (hovered ? 'rgba(186, 245, 140, 0.32)' : `rgba(186, 245, 140, ${overlayScale > 1 ? 0.18 : 0.13})`)
    : close
      ? (hovered ? 'rgba(255, 220, 122, 0.38)' : `rgba(244, 205, 105, ${overlayScale > 1 ? 0.23 : 0.17})`)
      : (hovered ? 'rgba(255, 230, 130, 0.34)' : `rgba(255, 244, 176, ${overlayScale > 1 ? 0.16 : 0.115})`);
  const stroke = item.road
    ? 'rgba(47, 116, 141, 0.42)'
    : item.supplied
      ? 'rgba(66, 125, 62, 0.30)'
    : close
      ? 'rgba(151, 96, 29, 0.34)'
      : 'rgba(113, 85, 34, 0.16)';
  fillTileDiamond(ctx, bounds, fill, hovered ? 1.5 : 4);
  drawMovementTileCommandRim(ctx, bounds, layout, item, { hovered, maxMove });
  if (shouldAnnotateMove(item, maxMove, hoverMove, compact)) {
    strokeTileDiamond(ctx, bounds, hovered ? 'rgba(255, 238, 170, 0.92)' : stroke, Math.max(1, layout.tileSize * (hovered ? 0.038 : 0.016)), hovered ? 2 : 5);
    drawTacticalMoveMarker(ctx, bounds, layout, item, { hovered, maxMove, hoverMove, compact });
  } else {
    drawMoveReachGlimmer(ctx, bounds, layout, item, maxMove);
  }
}

function drawMovementTileCommandRim(ctx, bounds, layout, item, options = {}) {
  const hovered = Boolean(options.hovered);
  const frontier = item.cost >= options.maxMove;
  const rim = item.road
    ? 'rgba(176, 238, 255, 0.74)'
    : item.supplied
      ? 'rgba(224, 250, 155, 0.70)'
      : frontier || item.terrainCost > 1
        ? 'rgba(255, 211, 116, 0.78)'
        : 'rgba(255, 236, 165, 0.58)';
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.shadowColor = item.road ? 'rgba(72, 177, 218, 0.20)' : 'rgba(255, 204, 104, 0.18)';
  ctx.shadowBlur = layout.tileSize * (hovered ? 0.12 : 0.055);
  strokeTileDiamond(ctx, bounds, 'rgba(59, 36, 17, 0.38)', Math.max(1, layout.tileSize * (hovered ? 0.046 : 0.026)), hovered ? 1.2 : 3.4);
  strokeTileDiamond(ctx, bounds, rim, Math.max(1, layout.tileSize * (hovered ? 0.026 : 0.014)), hovered ? 3.7 : 5.8);
  if (frontier || hovered) {
    const r = Math.max(2.5, layout.tileSize * 0.050);
    for (const [px, py] of [
      [bounds.cx, bounds.cy - bounds.halfH + layout.tileSize * 0.09],
      [bounds.cx + bounds.halfW - layout.tileSize * 0.08, bounds.cy],
      [bounds.cx, bounds.cy + bounds.halfH - layout.tileSize * 0.09],
      [bounds.cx - bounds.halfW + layout.tileSize * 0.08, bounds.cy]
    ]) {
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(75, 46, 19, 0.42)';
      ctx.lineWidth = Math.max(1, layout.tileSize * 0.010);
      ctx.stroke();
    }
  }
  ctx.restore();
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
      road ? 'rgba(63, 148, 174, 0.28)' : item.supplied ? 'rgba(83, 150, 71, 0.26)' : 'rgba(163, 111, 38, 0.22)',
      Math.max(1, layout.tileSize * (road || item.supplied ? 0.032 : 0.026)),
      2.2
    );
  }
  ctx.restore();
}

function drawCommandSupplyMesh(ctx, layout, reachable, hoverMove = null) {
  const suppliedTiles = reachable.filter((item) => item.supplied || item.road);
  if (!suppliedTiles.length) return;
  const suppliedSet = new Set(suppliedTiles.map((item) => tileKey(item.x, item.y)));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of suppliedTiles) {
    const bounds = tileBounds(layout, item.x, item.y);
    const hovered = sameTile(item, hoverMove);
    ctx.globalAlpha = item.road ? (hovered ? 0.92 : 0.62) : (hovered ? 0.72 : 0.42);
    ctx.strokeStyle = item.road ? 'rgba(161, 231, 255, 0.74)' : 'rgba(214, 238, 157, 0.58)';
    ctx.lineWidth = Math.max(1, layout.tileSize * (item.road ? 0.030 : 0.020));
    for (const [nx, ny] of [[item.x + 1, item.y], [item.x, item.y + 1]]) {
      if (!suppliedSet.has(tileKey(nx, ny))) continue;
      const next = tileCenter(layout, nx, ny);
      ctx.beginPath();
      ctx.moveTo(bounds.cx, bounds.cy);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }
    if (item.supplied && shouldDrawSupplySeal(item)) {
      drawSupplySeal(ctx, bounds, layout, hovered);
    }
  }
  ctx.restore();
}

function drawCommandSurveyVectors(ctx, state, layout, unit, reachable, maxMove, hoverMove) {
  if (hoverMove || !reachable.length || layout.tileSize < 26) return;
  const targets = chooseCommandSurveyTargets(reachable, maxMove);
  if (!targets.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const target = targets[i];
    const path = target.route?.length ? target.route : findPath(state, unit, target.x, target.y, maxMove)?.path;
    if (!path?.length) continue;
    const points = [{ x: unit.x, y: unit.y }, ...path.map((key) => tileFromKey(key))];
    const roadBias = target.road || target.supplied;
    const alpha = i === 0 ? 0.78 : 0.46;
    const color = roadBias ? 'rgba(157, 231, 255, 0.76)' : target.terrain === 'blight' ? 'rgba(176, 250, 128, 0.68)' : 'rgba(255, 221, 128, 0.72)';
    ctx.globalAlpha = alpha;
    ctx.shadowColor = roadBias ? 'rgba(75, 180, 220, 0.24)' : 'rgba(255, 191, 90, 0.22)';
    ctx.shadowBlur = layout.tileSize * 0.07;
    ctx.strokeStyle = 'rgba(57, 34, 15, 0.50)';
    ctx.lineWidth = Math.max(2, layout.tileSize * 0.045);
    drawRouteStroke(ctx, points, (tile) => tileCenter(layout, tile.x, tile.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, layout.tileSize * 0.020);
    drawRouteStroke(ctx, points, (tile) => tileCenter(layout, tile.x, tile.y));
    drawRouteArrowheads(ctx, points, (tile) => tileCenter(layout, tile.x, tile.y), layout.tileSize, color, alpha);
  }
  ctx.restore();
}

function chooseCommandSurveyTargets(reachable, maxMove) {
  const scored = reachable
    .filter((item) => item.cost > 0 && (item.frontier || item.road || item.supplied || item.terrainCost > 1))
    .map((item) => ({
      ...item,
      surveyScore: item.cost * 2.0
        + (item.frontier ? 4.0 : 0)
        + (item.road ? 2.4 : 0)
        + (item.supplied ? 1.4 : 0)
        + Math.min(3.0, item.terrainPressure)
        + (item.cost >= maxMove ? 1.8 : 0)
    }))
    .sort((a, b) => b.surveyScore - a.surveyScore || b.cost - a.cost || a.y - b.y || a.x - b.x);
  const picked = [];
  for (const item of scored) {
    if (picked.some((target) => manhattan(target.x, target.y, item.x, item.y) <= 1)) continue;
    picked.push(item);
    if (picked.length >= 3) break;
  }
  return picked;
}

function drawCommandPathPreview(ctx, state, layout, unit, maxMove, hoverMove) {
  if (!hoverMove || sameTile(unit, hoverMove)) return;
  const path = hoverMove.route?.length ? hoverMove.route : findPath(state, unit, hoverMove.x, hoverMove.y, maxMove)?.path;
  if (!path?.length) return;
  const points = [{ x: unit.x, y: unit.y }, ...path.map((key) => tileFromKey(key))];
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
  drawRouteArrowheads(ctx, points, (tile) => tileCenter(layout, tile.x, tile.y), layout.tileSize, hoverMove.road ? 'rgba(218, 249, 255, 0.92)' : 'rgba(255, 232, 158, 0.92)', 1);
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

function drawRouteArrowheads(ctx, points, center, tileSize, color, alpha = 1) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0.18, Math.min(1, alpha));
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(62, 36, 16, 0.46)';
  ctx.lineWidth = Math.max(1, tileSize * 0.010);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = center(points[i]);
    const b = center(points[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2) continue;
    const angle = Math.atan2(dy, dx);
    const size = Math.max(4, tileSize * (i === points.length - 2 ? 0.105 : 0.075));
    const px = a.x + dx * 0.62;
    const py = a.y + dy * 0.62;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size * 0.72, 0);
    ctx.lineTo(-size * 0.36, -size * 0.38);
    ctx.lineTo(-size * 0.18, 0);
    ctx.lineTo(-size * 0.36, size * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function shouldAnnotateMove(item, maxMove, hoverMove = null, compact = false) {
  if (sameTile(item, hoverMove)) return true;
  const frontier = item.frontier || item.cost >= maxMove;
  const rugged = item.terrainCost > 1 || item.terrainPressure > 2.8 || item.relief > 0.45;
  const closeAnchor = item.cost <= 1 && (compact || tileNoise(item, 1405) > 0.62);
  const roadAnchor = item.road && (compact || item.cost <= 2 || frontier);
  const suppliedAnchor = item.supplied && (compact || item.cost <= 2 || frontier);
  const frontierSurvey = frontier && (compact || rugged || tileNoise(item, 940) > 0.68);
  return rugged || closeAnchor || roadAnchor || suppliedAnchor || frontierSurvey;
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
  const overlayScale = movementOverlayScale(layout);
  const compactField = overlayScale > 1.05;
  const showCost = shouldShowMoveCostCartouche(item, options.maxMove, options.hoverMove, options.compact || compactField);
  const prominent = hovered || showCost || item.road || item.terrainCost > 1;
  const markerY = bounds.cy + layout.halfTileHeight * 0.35;
  const poleHeight = layout.tileSize * (hovered ? 0.34 : item.road ? 0.30 : 0.24) * overlayScale;
  const poleX = bounds.cx - layout.tileSize * 0.09;
  const bannerColor = item.road ? '#9be5ff' : close || hovered ? '#ffe08a' : '#f4c866';
  const rimColor = item.road ? 'rgba(27, 93, 122, 0.78)' : item.supplied ? 'rgba(69, 118, 47, 0.68)' : 'rgba(117, 77, 25, 0.68)';
  ctx.save();
  ctx.shadowColor = item.road ? 'rgba(53, 145, 176, 0.30)' : 'rgba(214, 151, 48, 0.24)';
  ctx.shadowBlur = layout.tileSize * (hovered ? 0.14 : 0.08) * overlayScale;
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.016 * overlayScale);
  drawMovementDestinationPedestal(ctx, bounds, layout, item, hovered || prominent);
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
    ctx.lineTo(poleX + layout.tileSize * 0.21 * overlayScale, markerY - poleHeight * 0.92);
    ctx.lineTo(poleX + layout.tileSize * 0.15 * overlayScale, markerY - poleHeight * 0.66);
    ctx.lineTo(poleX, markerY - poleHeight * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  const markerX = prominent ? bounds.cx + layout.tileSize * 0.10 * overlayScale : bounds.cx;
  const markerTopY = prominent ? markerY - poleHeight * 0.22 : markerY - layout.tileSize * 0.08;
  if (showCost) drawMoveCostCartouche(ctx, markerX, markerTopY, layout, item, hovered || compactField);
  else drawMoveIntentSigil(ctx, markerX, markerTopY, layout, item, hovered || prominent);
  if (item.road) drawRoadChevron(ctx, bounds.cx, markerY + layout.tileSize * 0.02, layout);
  else if (item.supplied) drawSupplyLaurel(ctx, bounds.cx, markerY + layout.tileSize * 0.02, layout, close);
  else drawFootstepPair(ctx, bounds.cx, markerY + layout.tileSize * 0.02, layout, close);
  ctx.restore();
}

function shouldShowMoveCostCartouche(item, maxMove, hoverMove = null, compact = false) {
  if (sameTile(item, hoverMove)) return true;
  const frontier = item.frontier || item.cost >= maxMove;
  const punishingTerrain = item.terrainCost > 1 || item.terrainPressure > 2.45 || item.relief > 0.45;
  const logisticMove = item.road || item.supplied;
  const closeMove = item.cost <= 2;
  const compactAnchor = compact && (frontier || punishingTerrain || item.road || item.cost <= 1);
  return frontier || punishingTerrain || (logisticMove && closeMove) || compactAnchor;
}

function drawMoveIntentSigil(ctx, x, y, layout, item, prominent = false) {
  const overlayScale = movementOverlayScale(layout);
  const r = Math.max(4, layout.tileSize * (prominent ? 0.085 : 0.066) * overlayScale);
  const fill = item.road
    ? 'rgba(227, 251, 255, 0.88)'
    : item.supplied
      ? 'rgba(247, 255, 219, 0.84)'
      : item.terrainCost > 1
        ? 'rgba(255, 230, 164, 0.82)'
        : 'rgba(255, 247, 209, 0.76)';
  const stroke = item.road
    ? 'rgba(42, 118, 147, 0.62)'
    : item.supplied
      ? 'rgba(77, 132, 56, 0.58)'
      : 'rgba(139, 91, 31, 0.54)';
  ctx.save();
  ctx.globalAlpha = prominent ? 0.92 : 0.72;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012 * overlayScale);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = item.road ? '#1b6681' : item.supplied ? '#417a35' : '#87501f';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018 * overlayScale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (item.road) {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.48, y + r * 0.10);
    ctx.lineTo(x - r * 0.10, y - r * 0.34);
    ctx.lineTo(x + r * 0.50, y + r * 0.16);
    ctx.stroke();
  } else if (item.supplied) {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.46, y + r * 0.22);
    ctx.quadraticCurveTo(x, y - r * 0.56, x + r * 0.46, y + r * 0.22);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.42, y + r * 0.10);
    ctx.lineTo(x, y - r * 0.30);
    ctx.lineTo(x + r * 0.42, y + r * 0.10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMovementDestinationPedestal(ctx, bounds, layout, item, active = false) {
  const overlayScale = movementOverlayScale(layout);
  const width = layout.tileSize * (active ? 0.34 : 0.26) * overlayScale;
  const height = layout.tileSize * (active ? 0.095 : 0.070) * overlayScale;
  const cy = bounds.cy + layout.halfTileHeight * 0.38;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = active ? 0.64 : 0.42;
  ctx.fillStyle = item.road
    ? 'rgba(167, 234, 255, 0.70)'
    : item.supplied
      ? 'rgba(218, 250, 160, 0.66)'
      : item.terrainCost > 1
        ? 'rgba(255, 212, 116, 0.66)'
        : 'rgba(255, 234, 152, 0.58)';
  ctx.beginPath();
  ctx.ellipse(bounds.cx, cy, width, height, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMoveCostCartouche(ctx, x, y, layout, item, large = false) {
  const overlayScale = movementOverlayScale(layout);
  const w = Math.max(16, layout.tileSize * (large ? 0.34 : 0.24) * overlayScale);
  const h = Math.max(10, layout.tileSize * (large ? 0.20 : 0.16) * overlayScale);
  ctx.save();
  roundRectPath(ctx, x - w * 0.5, y - h * 0.5, w, h, h * 0.48);
  ctx.fillStyle = item.road ? 'rgba(230, 250, 255, 0.92)' : item.supplied ? 'rgba(246, 255, 223, 0.92)' : 'rgba(255, 247, 211, 0.92)';
  ctx.strokeStyle = item.road ? 'rgba(47, 116, 141, 0.64)' : item.supplied ? 'rgba(81, 138, 60, 0.56)' : 'rgba(151, 96, 29, 0.56)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012 * overlayScale);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = item.road ? '#174a60' : item.supplied ? '#315f25' : '#733f16';
  ctx.font = `900 ${Math.max(8, layout.tileSize * (large ? 0.15 : 0.13) * overlayScale)}px system-ui, sans-serif`;
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
  ctx.strokeStyle = item.road ? 'rgba(44, 119, 145, 0.34)' : item.supplied ? 'rgba(85, 138, 62, 0.30)' : 'rgba(138, 92, 30, 0.28)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.014);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bounds.cx - size, y);
  ctx.quadraticCurveTo(bounds.cx, y - size * 0.45, bounds.cx + size, y);
  ctx.stroke();
  ctx.restore();
}

function drawRoadChevron(ctx, cx, cy, layout) {
  const size = layout.tileSize * 0.10 * movementOverlayScale(layout);
  ctx.save();
  ctx.strokeStyle = 'rgba(28, 98, 126, 0.62)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018 * movementOverlayScale(layout));
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

function drawSupplyLaurel(ctx, cx, cy, layout, close) {
  const overlayScale = movementOverlayScale(layout);
  const size = layout.tileSize * (close ? 0.075 : 0.064) * overlayScale;
  ctx.save();
  ctx.strokeStyle = close ? 'rgba(63, 111, 43, 0.58)' : 'rgba(70, 120, 52, 0.46)';
  ctx.fillStyle = close ? 'rgba(210, 232, 142, 0.70)' : 'rgba(198, 224, 130, 0.52)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.016 * overlayScale);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * size * 0.32, cy + size * 0.68);
    ctx.quadraticCurveTo(cx + side * size * 1.12, cy - size * 0.02, cx + side * size * 0.38, cy - size * 0.62);
    ctx.stroke();
    for (let i = 0; i < 3; i += 1) {
      const lx = cx + side * size * (0.40 + i * 0.15);
      const ly = cy + size * (0.42 - i * 0.34);
      ctx.beginPath();
      ctx.ellipse(lx, ly, size * 0.20, size * 0.09, side * -0.58, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawSupplySeal(ctx, bounds, layout, prominent = false) {
  const overlayScale = movementOverlayScale(layout);
  const r = Math.max(3, layout.tileSize * (prominent ? 0.070 : 0.052) * overlayScale);
  const cx = bounds.cx + layout.tileSize * 0.24;
  const cy = bounds.cy - layout.halfTileHeight * 0.28;
  ctx.save();
  ctx.globalAlpha = prominent ? 0.90 : 0.64;
  ctx.fillStyle = 'rgba(248, 255, 226, 0.84)';
  ctx.strokeStyle = 'rgba(70, 118, 45, 0.58)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012 * overlayScale);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(62, 112, 42, 0.76)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.014 * overlayScale);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.58, cy + r * 0.18);
  ctx.quadraticCurveTo(cx, cy - r * 0.62, cx + r * 0.58, cy + r * 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawFootstepPair(ctx, cx, cy, layout, close) {
  const size = layout.tileSize * (close ? 0.060 : 0.052) * movementOverlayScale(layout);
  ctx.save();
  ctx.fillStyle = close ? 'rgba(133, 83, 24, 0.48)' : 'rgba(119, 86, 35, 0.38)';
  for (const [dx, dy, rotation] of [[-0.06, 0, -0.34], [0.07, -0.05, 0.32]]) {
    ctx.beginPath();
    ctx.ellipse(cx + layout.tileSize * dx, cy + layout.tileSize * dy, size * 0.60, size, rotation, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function shouldDrawSupplySeal(item) {
  return item.road || item.cost <= 2 || item.frontier || tileNoise(item, 955) > 0.72;
}

function movementOverlayScale(layout) {
  if (layout.mapWidth < 560 || layout.tileSize < 44) return 1.30;
  if (layout.mapWidth < 700 || layout.tileSize < 52) return 1.14;
  return 1;
}

function drawCommandHalo(ctx, layout, unit, active) {
  const bounds = tileBounds(layout, unit.x, unit.y);
  const overlayScale = movementOverlayScale(layout);
  ctx.save();
  ctx.shadowColor = active ? 'rgba(255, 224, 138, 0.70)' : 'rgba(120, 95, 70, 0.30)';
  ctx.shadowBlur = layout.tileSize * (active ? 0.22 : 0.12) * overlayScale;
  fillTileDiamond(ctx, bounds, active ? 'rgba(255, 224, 138, 0.20)' : 'rgba(120, 95, 70, 0.12)', 5);
  strokeTileDiamond(ctx, bounds, active ? 'rgba(255, 231, 151, 0.88)' : 'rgba(138, 114, 85, 0.44)', Math.max(2, layout.tileSize * 0.05 * overlayScale), 5);
  strokeTileDiamond(ctx, bounds, active ? 'rgba(77, 43, 17, 0.56)' : 'rgba(77, 43, 17, 0.26)', Math.max(1, layout.tileSize * 0.018 * overlayScale), 12);
  ctx.restore();
}

function drawBuildSites(ctx, state, layout, hoverTile = null) {
  if (state.mode.type !== 'build') return;
  const builder = state.units.find((u) => u.id === state.mode.builderId);
  if (!builder) return;
  const survey = buildSiteSurvey(state, builder, state.mode.buildingType);
  if (!survey.length) return;
  const validSites = survey.filter((candidate) => candidate.ok);
  const invalidSites = survey.filter((candidate) => !candidate.ok);
  ctx.save();
  drawBuildSurveyConnectors(ctx, layout, builder, validSites);
  for (const candidate of invalidSites) drawBuildSitePlate(ctx, layout, candidate, sameTile(candidate, hoverTile));
  for (const candidate of validSites) drawBuildSitePlate(ctx, layout, candidate, sameTile(candidate, hoverTile));
  ctx.restore();
}

function buildSiteSurvey(state, builder, buildingType) {
  return [
    { dx: 0, dy: 0, label: 'Builder tile' },
    { dx: 1, dy: 0, label: 'East site' },
    { dx: -1, dy: 0, label: 'West site' },
    { dx: 0, dy: 1, label: 'South site' },
    { dx: 0, dy: -1, label: 'North site' }
  ]
    .map((candidate, index) => {
      const x = builder.x + candidate.dx;
      const y = builder.y + candidate.dy;
      if (!inMap(x, y)) return null;
      const result = canBuildOn(state, buildingType, x, y);
      const tile = tileAt(state, x, y);
      const supplied = isTileSupplied(state, x, y);
      const road = Boolean(tile?.road || state.buildings.some((building) => building.type === 'road' && building.x === x && building.y === y));
      return {
        ...candidate,
        x,
        y,
        index,
        ok: result.ok,
        reason: result.reason || '',
        tile,
        terrain: tile?.terrain || 'plains',
        supplied,
        road,
        buildingType
      };
    })
    .filter(Boolean);
}

function drawBuildSurveyConnectors(ctx, layout, builder, candidates) {
  if (!candidates.length) return;
  const origin = tileCenter(layout, builder.x, builder.y);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const candidate of candidates) {
    if (candidate.x === builder.x && candidate.y === builder.y) continue;
    const target = tileCenter(layout, candidate.x, candidate.y);
    ctx.globalAlpha = 0.70;
    ctx.strokeStyle = 'rgba(31, 72, 45, 0.55)';
    ctx.lineWidth = Math.max(3, layout.tileSize * 0.075);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y + layout.halfTileHeight * 0.35);
    ctx.lineTo(target.x, target.y + layout.halfTileHeight * 0.35);
    ctx.stroke();
    ctx.globalAlpha = 0.86;
    ctx.strokeStyle = 'rgba(217, 255, 178, 0.78)';
    ctx.lineWidth = Math.max(1.5, layout.tileSize * 0.030);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y + layout.halfTileHeight * 0.33);
    ctx.lineTo(target.x, target.y + layout.halfTileHeight * 0.33);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBuildSitePlate(ctx, layout, candidate, hovered = false) {
  const bounds = tileBounds(layout, candidate.x, candidate.y);
  const { x, y, s } = bounds;
  const ok = candidate.ok;
  const supplied = candidate.supplied || candidate.road;
  const accent = ok
    ? supplied ? '#baf58c' : '#f0c866'
    : '#ff8a8a';
  const shadow = ok
    ? supplied ? 'rgba(57, 118, 56, 0.34)' : 'rgba(150, 101, 35, 0.30)'
    : 'rgba(139, 40, 34, 0.26)';
  const fillTop = ok
    ? supplied ? 'rgba(237, 255, 199, 0.48)' : 'rgba(255, 240, 164, 0.42)'
    : 'rgba(255, 218, 210, 0.30)';
  const fillBottom = ok
    ? supplied ? 'rgba(111, 208, 95, 0.30)' : 'rgba(222, 158, 62, 0.26)'
    : 'rgba(197, 54, 45, 0.18)';
  const label = ok ? buildSiteShortLabel(candidate.buildingType) : 'Blocked';

  ctx.save();
  ctx.shadowColor = shadow;
  ctx.shadowBlur = s * (hovered ? 0.26 : 0.16);
  const plate = ctx.createLinearGradient(bounds.cx, bounds.cy - bounds.halfH, bounds.cx, bounds.cy + bounds.halfH);
  plate.addColorStop(0, fillTop);
  plate.addColorStop(1, fillBottom);
  fillTileDiamond(ctx, bounds, plate, hovered ? 0.5 : 2.2);
  ctx.shadowBlur = 0;
  strokeTileDiamond(ctx, bounds, 'rgba(20, 34, 24, 0.54)', Math.max(2, s * (hovered ? 0.080 : 0.060)), 2.4);
  strokeTileDiamond(ctx, bounds, accent, Math.max(2, s * (hovered ? 0.050 : 0.036)), 7.0);
  strokeTileDiamond(ctx, bounds, 'rgba(255, 255, 244, 0.70)', Math.max(1, s * 0.014), 11.0);
  drawBuildSiteBlueprint(ctx, candidate, bounds, accent, ok, hovered);
  if (!ok) drawBuildBlockedHatch(ctx, bounds, layout);
  drawBuildSiteBadge(ctx, candidate, bounds, label, accent, ok, hovered);
  ctx.restore();
}

function drawBuildSiteBlueprint(ctx, candidate, bounds, accent, ok, hovered) {
  const { x, y, s } = bounds;
  const alpha = ok ? (hovered ? 0.98 : 0.86) : 0.48;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ok ? colorMix(accent, '#1d3f27', 0.20) : 'rgba(126, 44, 36, 0.70)';
  ctx.fillStyle = ok ? 'rgba(255, 255, 239, 0.72)' : 'rgba(255, 230, 220, 0.46)';
  ctx.lineWidth = Math.max(1.4, s * 0.035);
  const type = candidate.buildingType;
  if (type === 'road') {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.15, y + s * 0.54);
    ctx.lineTo(x + s * 0.85, y + s * 0.54);
    ctx.stroke();
    ctx.strokeStyle = ok ? 'rgba(255, 255, 231, 0.82)' : 'rgba(255, 236, 228, 0.56)';
    ctx.lineWidth = Math.max(1, s * 0.014);
    for (let i = 0; i < 4; i += 1) {
      const px = x + s * (0.24 + i * 0.16);
      ctx.beginPath();
      ctx.moveTo(px, y + s * 0.47);
      ctx.lineTo(px + s * 0.06, y + s * 0.61);
      ctx.stroke();
    }
  } else if (type === 'farm') {
    for (let i = 0; i < 4; i += 1) {
      const py = y + s * (0.38 + i * 0.07);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.22, py);
      ctx.quadraticCurveTo(x + s * 0.50, py - s * 0.07, x + s * 0.78, py);
      ctx.stroke();
    }
  } else if (type === 'mine') {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.26, y + s * 0.68);
    ctx.lineTo(x + s * 0.46, y + s * 0.34);
    ctx.lineTo(x + s * 0.66, y + s * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.62, y + s * 0.28);
    ctx.lineTo(x + s * 0.38, y + s * 0.62);
    ctx.moveTo(x + s * 0.53, y + s * 0.25);
    ctx.lineTo(x + s * 0.68, y + s * 0.34);
    ctx.stroke();
  } else if (type === 'watchtower' || type === 'outpost') {
    ctx.strokeRect(x + s * 0.38, y + s * 0.36, s * 0.24, s * 0.26);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.34, y + s * 0.36);
    ctx.lineTo(x + s * 0.50, y + s * 0.22);
    ctx.lineTo(x + s * 0.66, y + s * 0.36);
    ctx.moveTo(x + s * 0.40, y + s * 0.62);
    ctx.lineTo(x + s * 0.32, y + s * 0.74);
    ctx.moveTo(x + s * 0.60, y + s * 0.62);
    ctx.lineTo(x + s * 0.68, y + s * 0.74);
    ctx.stroke();
  } else if (type === 'wall') {
    for (let i = 0; i < 4; i += 1) {
      ctx.strokeRect(x + s * (0.23 + i * 0.13), y + s * 0.44, s * 0.12, s * 0.12);
    }
    ctx.beginPath();
    ctx.moveTo(x + s * 0.22, y + s * 0.58);
    ctx.lineTo(x + s * 0.78, y + s * 0.58);
    ctx.stroke();
  } else {
    ctx.strokeRect(x + s * 0.32, y + s * 0.36, s * 0.36, s * 0.26);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.28, y + s * 0.36);
    ctx.lineTo(x + s * 0.50, y + s * 0.22);
    ctx.lineTo(x + s * 0.72, y + s * 0.36);
    ctx.moveTo(x + s * 0.24, y + s * 0.68);
    ctx.lineTo(x + s * 0.76, y + s * 0.68);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBuildBlockedHatch(ctx, bounds, layout) {
  const { x, y, s } = bounds;
  ctx.save();
  tileDiamondPath(ctx, bounds, 6);
  ctx.clip();
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = 'rgba(142, 35, 29, 0.58)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
  for (let i = -2; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + s * (i * 0.20), y + s * 0.18);
    ctx.lineTo(x + s * (0.44 + i * 0.20), y + s * 0.84);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBuildSiteBadge(ctx, candidate, bounds, label, accent, ok, hovered) {
  const { s } = bounds;
  const compactBadge = s < 62;
  const badgeW = Math.max(s * (compactBadge ? 0.82 : 0.72), ok ? label.length * s * (compactBadge ? 0.108 : 0.095) : s * 0.74);
  const badgeH = Math.max(compactBadge ? 16 : 14, s * (hovered ? 0.30 : 0.25));
  const badge = buildSiteBadgeAnchor(candidate, bounds, badgeW, badgeH);
  const x = badge.x;
  const y = badge.y;
  ctx.save();
  ctx.globalAlpha = hovered ? 0.96 : 0.82;
  ctx.strokeStyle = ok ? colorMix(accent, '#2e4d2f', 0.34) : 'rgba(154, 45, 36, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.beginPath();
  ctx.moveTo(bounds.cx, bounds.cy + bounds.halfH * 0.08);
  ctx.lineTo(x + badgeW * 0.5, y + badgeH * 0.52);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.shadowColor = ok ? 'rgba(46, 80, 45, 0.22)' : 'rgba(128, 35, 31, 0.20)';
  ctx.shadowBlur = s * 0.08;
  roundRectPath(ctx, x, y, badgeW, badgeH, badgeH * 0.40);
  const fill = ctx.createLinearGradient(x, y, x, y + badgeH);
  fill.addColorStop(0, ok ? 'rgba(255, 255, 246, 0.96)' : 'rgba(255, 240, 235, 0.94)');
  fill.addColorStop(1, ok ? colorMix(accent, '#ffffff', 0.72) : 'rgba(255, 203, 194, 0.84)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = ok ? colorMix(accent, '#24522c', 0.22) : '#b9362e';
  ctx.lineWidth = Math.max(1, s * 0.014);
  ctx.stroke();
  ctx.fillStyle = ok ? '#244322' : '#8f2418';
  ctx.font = `900 ${Math.max(compactBadge ? 8 : 7, s * (hovered ? 0.150 : 0.126))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + badgeW * 0.5, y + badgeH * 0.52, badgeW - s * 0.12);
  if (ok && (candidate.supplied || candidate.road)) {
    const r = Math.max(2.4, s * 0.045);
    ctx.fillStyle = '#4d8c59';
    ctx.beginPath();
    ctx.arc(x + badgeW - r * 2.0, y + badgeH * 0.50, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function buildSiteBadgeAnchor(candidate, bounds, badgeW, badgeH) {
  const { s } = bounds;
  if (candidate.dx > 0) {
    return { x: bounds.cx + s * 0.16, y: bounds.cy + bounds.halfH * 0.10 };
  }
  if (candidate.dx < 0) {
    return { x: bounds.cx - badgeW - s * 0.16, y: bounds.cy + bounds.halfH * 0.10 };
  }
  if (candidate.dy > 0) {
    return { x: bounds.cx - badgeW * 0.5, y: bounds.cy + bounds.halfH * 0.96 };
  }
  if (candidate.dy < 0) {
    return { x: bounds.cx - badgeW * 0.5, y: bounds.cy - bounds.halfH * 1.08 - badgeH * 0.18 };
  }
  return { x: bounds.cx - badgeW * 0.5, y: bounds.cy - bounds.halfH * 0.96 - badgeH * 0.18 };
}

function buildSiteShortLabel(buildingType) {
  const def = BUILDING_TYPES[buildingType];
  if (!def) return 'Build';
  if (buildingType === 'road') return 'Road';
  if (buildingType === 'lumberCamp') return 'Lumber';
  if (buildingType === 'watchtower') return 'Tower';
  if (buildingType === 'archeryYard') return 'Archery';
  return def.name.replace(/^Military\s+/, '').replace(/\s+Yard$/, '');
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

function drawUnitIdentityStandards(ctx, state, layout) {
  const budget = renderBudget(layout);
  const compact = budget.compact || layout.mapWidth < 620 || layout.tileSize < 44;
  const window = cameraTileWindow(layout, 1);
  const entries = state.units
    .filter((unit) => unit.id !== state.selectedUnitId && isVisible(state, unit.x, unit.y) && isInTileWindow(unit, window))
    .map((unit) => unitIdentityStandardEntry(state, unit, compact))
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || (a.unit.x + a.unit.y) - (b.unit.x + b.unit.y));
  const limit = compact ? 5 : 9;
  const placed = [];
  ctx.save();
  for (const entry of entries) {
    if (placed.length >= limit) break;
    const rect = drawUnitIdentityStandard(ctx, entry, layout, compact, placed);
    if (rect) placed.push(rect);
  }
  ctx.restore();
}

function unitIdentityStandardEntry(state, unit, compact) {
  const def = UNIT_TYPES[unit.type];
  if (!def) return null;
  const hostile = unit.faction !== 'olundar' && isEnemy(state, 'olundar', unit.faction);
  const ally = unit.faction !== 'olundar' && Boolean(state.factions.olundar.pacts?.[unit.faction]);
  const ready = unit.faction === 'olundar' && !unit.hasActed;
  const label = unitIdentityCode(unit, compact);
  const faction = FACTIONS[unit.faction];
  const color = FACTION_COLORS[unit.faction] || '#f0c866';
  return {
    unit,
    def,
    label,
    color,
    tone: hostile ? 'threat' : ally ? 'ally' : ready ? 'ready' : unit.faction === 'olundar' ? 'spent' : 'neutral',
    kicker: hostile ? 'HOSTILE' : ally ? 'ALLY' : ready ? 'READY' : faction?.adjective?.toUpperCase() || 'UNIT',
    priority: hostile ? 96 : ready ? 82 : ally ? 76 : unit.faction === 'olundar' ? 66 : 58
  };
}

function unitIdentityCode(unit, compact) {
  const labels = {
    scout: compact ? 'SCOUT' : 'SCOUT',
    engineer: compact ? 'ENG' : 'ENGINEER',
    archer: compact ? 'BOW' : 'ARCHER',
    legionary: compact ? 'LEG' : 'LEGION',
    spearGuard: compact ? 'SPEAR' : 'SPEAR',
    cavalry: compact ? 'CAV' : 'CAVALRY',
    onager: compact ? 'SIEGE' : 'ONAGER',
    boneThrall: compact ? 'BONE' : 'THRALL',
    corpseArcher: compact ? 'BONE BOW' : 'CORPSE BOW',
    graveKnight: compact ? 'GRAVE' : 'GRAVE KNIGHT',
    lichBoss: compact ? 'VORGATH' : 'VORGATH'
  };
  return labels[unit.type] || unitMapLabel(unit);
}

function drawUnitIdentityStandard(ctx, entry, layout, compact, placed) {
  const bounds = tileBounds(layout, entry.unit.x, entry.unit.y);
  const s = layout.tileSize;
  const h = Math.max(compact ? 14 : 17, s * (compact ? 0.22 : 0.25));
  const emblemW = h * 1.05;
  const textW = Math.min(compact ? s * 0.96 : s * 1.28, Math.max(compact ? 31 : 42, entry.label.length * h * 0.44));
  const w = emblemW + textW + h * 0.30;
  const y = bounds.cy - s * (compact ? 0.72 : 0.82);
  const x = clamp(bounds.cx - w * 0.5, layout.frameX + 4, layout.frameX + layout.mapWidth - w - 4);
  const rect = { x: x - 2, y: y - h * 0.5 - 2, w: w + 4, h: h + 4, priority: entry.priority };
  if (placed.some((other) => fieldBannerOverlaps(rect, other))) return null;

  const threat = entry.tone === 'threat';
  const ready = entry.tone === 'ready';
  const spent = entry.tone === 'spent';
  const fillA = threat ? 'rgba(42, 45, 34, 0.94)' : ready ? 'rgba(255, 252, 226, 0.96)' : 'rgba(245, 249, 235, 0.90)';
  const fillB = threat ? 'rgba(23, 34, 25, 0.90)' : ready ? 'rgba(232, 253, 214, 0.92)' : 'rgba(231, 239, 222, 0.84)';
  const stroke = threat ? 'rgba(156, 243, 138, 0.72)' : ready ? colorMix(entry.color, '#fff4a8', 0.34) : colorMix(entry.color, '#ffffff', 0.50);
  ctx.save();
  ctx.shadowColor = threat ? 'rgba(44, 82, 35, 0.30)' : ready ? 'rgba(255, 218, 108, 0.25)' : 'rgba(47, 73, 50, 0.18)';
  ctx.shadowBlur = Math.max(4, s * 0.055);
  ctx.shadowOffsetY = Math.max(1, s * 0.018);
  roundRectPath(ctx, x, y - h * 0.5, w, h, h * 0.32);
  const fill = ctx.createLinearGradient(x, y - h * 0.5, x + w, y + h * 0.5);
  fill.addColorStop(0, fillA);
  fill.addColorStop(1, fillB);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, s * 0.010);
  ctx.stroke();

  drawUnitIdentityEmblem(ctx, entry, x + h * 0.52, y, h * 0.34, threat, spent);
  ctx.fillStyle = threat ? '#caffad' : ready ? '#244f38' : '#4b5d42';
  ctx.font = `900 ${Math.max(7.5, h * 0.48)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(entry.label, x + emblemW + h * 0.08, y + h * 0.04, w - emblemW - h * 0.16);
  drawUnitIdentityNeedle(ctx, bounds, x + w * 0.5, y + h * 0.5, entry, layout);
  ctx.restore();
  return rect;
}

function drawUnitIdentityEmblem(ctx, entry, cx, cy, r, threat, spent) {
  ctx.save();
  ctx.globalAlpha = spent ? 0.62 : 1;
  ctx.fillStyle = threat ? 'rgba(12, 22, 15, 0.95)' : entry.color;
  ctx.strokeStyle = threat ? 'rgba(156, 243, 138, 0.86)' : 'rgba(72, 45, 20, 0.64)';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = threat ? '#9cf38a' : '#fff4bd';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1, r * 0.22);
  if (entry.def.tags.includes('ranged')) {
    ctx.beginPath();
    ctx.arc(cx - r * 0.08, cy, r * 0.50, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.28, cy - r * 0.52);
    ctx.lineTo(cx + r * 0.28, cy + r * 0.52);
    ctx.stroke();
  } else if (entry.def.tags.includes('builder') || entry.def.tags.includes('siege')) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.48, cy + r * 0.38);
    ctx.lineTo(cx + r * 0.42, cy - r * 0.42);
    ctx.moveTo(cx - r * 0.08, cy - r * 0.48);
    ctx.lineTo(cx + r * 0.48, cy + r * 0.08);
    ctx.stroke();
  } else if (entry.def.tags.includes('mounted')) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.12, r * 0.60, r * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.50, cy - r * 0.18, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (entry.def.tags.includes('undead')) {
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.12, r * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.38, cy + r * 0.36);
    ctx.lineTo(cx + r * 0.38, cy + r * 0.36);
    ctx.stroke();
  } else {
    drawLegionShield(ctx, cx, cy + r * 0.06, r * 1.55, '#fff3c9', entry.color);
  }
  ctx.restore();
}

function drawUnitIdentityNeedle(ctx, bounds, x, y, entry, layout) {
  ctx.save();
  ctx.globalAlpha = entry.tone === 'spent' ? 0.42 : 0.70;
  ctx.strokeStyle = entry.tone === 'threat' ? 'rgba(156, 243, 138, 0.58)' : 'rgba(96, 74, 34, 0.38)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(bounds.cx, bounds.cy - bounds.halfH * 0.18);
  ctx.stroke();
  ctx.fillStyle = entry.tone === 'threat' ? '#9cf38a' : colorMix(entry.color, '#fff6b5', 0.42);
  ctx.beginPath();
  ctx.arc(bounds.cx, bounds.cy - bounds.halfH * 0.18, Math.max(2, layout.tileSize * 0.028), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFieldCommandBanners(ctx, state, layout) {
  const budget = renderBudget(layout);
  const entries = fieldCommandBannerEntries(state, layout, budget);
  const placed = [];
  ctx.save();
  for (const entry of entries) {
    const rect = drawFieldCommandBanner(ctx, entry, layout, budget, placed);
    if (rect) placed.push(rect);
  }
  ctx.restore();
}

function fieldCommandBannerEntries(state, layout, budget) {
  const window = cameraTileWindow(layout, 1);
  const entries = [];
  for (const building of state.buildings) {
    if (!isVisible(state, building.x, building.y) || !isInTileWindow(building, window)) continue;
    const meta = fieldCommandBannerMeta(state, building, 'building');
    if (meta) entries.push({ kind: 'building', item: building, ...meta });
  }
  for (const unit of state.units) {
    if (!isVisible(state, unit.x, unit.y) || !isInTileWindow(unit, window)) continue;
    const meta = fieldCommandBannerMeta(state, unit, 'unit');
    if (meta) entries.push({ kind: 'unit', item: unit, ...meta });
  }
  const limit = budget.compact ? 7 : 11;
  return entries
    .sort((a, b) => b.priority - a.priority || (a.item.x + a.item.y) - (b.item.x + b.item.y))
    .slice(0, limit);
}

function fieldCommandBannerMeta(state, item, kind) {
  const selected = kind === 'unit'
    ? state.selectedUnitId === item.id
    : state.selectedBuildingId === item.id;
  const ally = item.faction !== 'olundar' && Boolean(state.factions.olundar.pacts?.[item.faction]);
  const hostile = item.faction !== 'olundar' && isEnemy(state, 'olundar', item.faction);
  const color = FACTION_COLORS[item.faction] || '#f0c866';
  if (selected) return null;
  if (kind === 'unit') {
    if (hostile) return { tone: 'threat', kicker: 'THREAT', title: fieldCommandBannerTitle(item), color, priority: 94 };
    if (ally) return { tone: 'ally', kicker: 'PACT ALLY', title: fieldCommandBannerTitle(item), color, priority: 86 };
    return null;
  }
  if (item.type === 'portal') return { tone: 'threat', kicker: 'PORTAL', title: item.name || 'Hollow Gate', color, priority: 98 };
  if (hostile && ['bonePit', 'graveForge', 'necropolis'].includes(item.type)) return { tone: 'threat', kicker: 'DEADWORK', title: fieldCommandBannerTitle(item), color, priority: 90 };
  if (item.type === 'city') {
    const kicker = item.faction === 'olundar' ? 'CAPITAL' : ally ? 'PACT CITY' : hostile ? 'ENEMY CITY' : 'CITY';
    return { tone: item.faction === 'olundar' ? 'ready' : ally ? 'ally' : hostile ? 'threat' : 'neutral', kicker, title: fieldCommandBannerTitle(item), color, priority: item.faction === 'olundar' ? 92 : 84 };
  }
  if (ally && ['watchtower', 'barracks', 'outpost'].includes(item.type)) return { tone: 'ally', kicker: 'ALLY HOLD', title: fieldCommandBannerTitle(item), color, priority: 70 };
  return null;
}

function fieldCommandBannerTitle(item) {
  const base = item.name || BUILDING_TYPES[item.type]?.name || UNIT_TYPES[item.type]?.name || item.type || 'Contact';
  return base.replace(/^Olundaran /, '').replace(/^The /, '');
}

function drawFieldCommandBanner(ctx, entry, layout, budget, placed) {
  const item = entry.item;
  const bounds = tileBounds(layout, item.x, item.y);
  const s = layout.tileSize;
  const compact = budget.compact || s < 38;
  const centerX = bounds.cx;
  const y = bounds.cy - s * (entry.kind === 'building' ? (compact ? 1.12 : 1.30) : (compact ? 1.02 : 1.18));
  const w = Math.max(compact ? 48 : 62, Math.min(compact ? s * 1.34 : s * 1.72, s * (entry.title.length > 12 ? 1.82 : 1.50)));
  const h = Math.max(compact ? 18 : 22, s * (compact ? 0.34 : 0.38));
  const x = centerX - w * 0.5;
  const rect = { x: x - 3, y: y - h * 0.5 - 3, w: w + 6, h: h + 6, priority: entry.priority };
  if (placed.some((other) => fieldBannerOverlaps(rect, other)) && entry.priority < 92) return null;

  const color = entry.color || '#f0c866';
  const parchment = entry.tone === 'threat' ? '#fff0e5' : entry.tone === 'ally' ? '#f0fbff' : '#fffbe8';
  const rim = entry.tone === 'threat' ? '#9f2d20' : entry.tone === 'ally' ? '#1d7d97' : '#806334';
  ctx.save();
  ctx.shadowColor = entry.tone === 'threat' ? 'rgba(128, 28, 22, 0.30)' : 'rgba(31, 54, 42, 0.24)';
  ctx.shadowBlur = Math.max(4, s * 0.09);
  ctx.shadowOffsetY = Math.max(2, s * 0.04);
  roundRectPath(ctx, x, y - h * 0.5, w, h, h * 0.34);
  const fill = ctx.createLinearGradient(x, y - h * 0.5, x, y + h * 0.5);
  fill.addColorStop(0, '#ffffff');
  fill.addColorStop(0.42, parchment);
  fill.addColorStop(1, colorMix(color, '#ffffff', 0.84));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorMix(rim, '#ffffff', 0.28);
  ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.stroke();

  ctx.fillStyle = color;
  roundRectPath(ctx, x + 2, y - h * 0.5 + 2, Math.max(6, w * 0.10), h - 4, h * 0.26);
  ctx.fill();
  drawFieldBannerPennon(ctx, x + Math.max(7, w * 0.10), y, h, color, entry.tone);
  drawFieldBannerText(ctx, entry, x, y, w, h, compact);
  drawFieldBannerVitalPips(ctx, entry, x, y, w, h, color);
  ctx.restore();
  return rect;
}

function drawFieldBannerPennon(ctx, x, y, h, color, tone) {
  const pole = Math.max(9, h * 0.58);
  ctx.save();
  ctx.strokeStyle = 'rgba(50, 31, 16, 0.62)';
  ctx.lineWidth = Math.max(1, h * 0.07);
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.25);
  ctx.lineTo(x, y - h * 0.34);
  ctx.stroke();
  ctx.fillStyle = tone === 'threat' ? colorMix(color, '#1c1116', 0.26) : colorMix(color, '#f6d46f', 0.20);
  ctx.beginPath();
  ctx.moveTo(x, y - h * 0.34);
  ctx.lineTo(x + pole * 0.66, y - h * 0.25);
  ctx.lineTo(x + pole * 0.42, y - h * 0.06);
  ctx.lineTo(x + pole * 0.66, y + h * 0.12);
  ctx.lineTo(x, y + h * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFieldBannerText(ctx, entry, x, y, w, h, compact) {
  const title = fieldBannerFitText(ctx, entry.title, compact ? 14 : 18);
  const left = x + Math.max(17, w * 0.20);
  const right = x + w - Math.max(8, w * 0.08);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = entry.tone === 'threat' ? '#8f2418' : entry.tone === 'ally' ? '#155b72' : '#5c3a1b';
  ctx.font = `900 ${Math.max(6.5, h * (compact ? 0.25 : 0.24))}px system-ui, sans-serif`;
  ctx.fillText(entry.kicker, left, y - h * (compact ? 0.17 : 0.19), right - left);
  ctx.fillStyle = '#243322';
  ctx.font = `800 ${Math.max(7.5, h * (compact ? 0.32 : 0.34))}px system-ui, sans-serif`;
  ctx.fillText(title, left, y + h * (compact ? 0.16 : 0.17), right - left);
  ctx.restore();
}

function drawFieldBannerVitalPips(ctx, entry, x, y, w, h, color) {
  const item = entry.item;
  const pct = Number.isFinite(item.hp) && Number.isFinite(item.maxHp) && item.maxHp > 0
    ? Math.max(0, Math.min(1, item.hp / item.maxHp))
    : 1;
  const px = x + w - Math.max(11, h * 0.42);
  const py = y - h * 0.32;
  const r = Math.max(2.2, h * 0.09);
  ctx.save();
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = pct >= (i + 1) / 3 ? colorMix(color, '#ffffff', i * 0.12) : 'rgba(99, 77, 49, 0.22)';
    ctx.beginPath();
    ctx.arc(px + i * r * 2.35, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function fieldBannerFitText(ctx, text, maxChars) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1)).trim()}...`;
}

function fieldBannerOverlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawSelectedUnitCommandPresence(ctx, state, layout) {
  const unit = state.units.find((candidate) => candidate.id === state.selectedUnitId && isVisible(state, candidate.x, candidate.y));
  if (!unit || state.mode.type !== 'select') return;
  const bounds = tileBounds(layout, unit.x, unit.y);
  const color = FACTION_COLORS[unit.faction] || '#f0c866';
  const active = unit.faction === 'olundar' && !unit.hasActed;
  ctx.save();
  drawSelectedCommandSpotlight(ctx, bounds, layout, color, active);
  drawSelectedCommandAquila(ctx, bounds, layout, color, active);
  drawSelectedCommandPlaque(ctx, bounds, layout, unit, color, active);
  ctx.restore();
}

function drawSelectedCommandSpotlight(ctx, bounds, layout, color, active) {
  const glow = ctx.createRadialGradient(
    bounds.cx,
    bounds.cy - layout.halfTileHeight * 0.18,
    layout.tileSize * 0.04,
    bounds.cx,
    bounds.cy - layout.halfTileHeight * 0.10,
    layout.tileSize * 0.84
  );
  glow.addColorStop(0, active ? 'rgba(255, 246, 190, 0.34)' : 'rgba(224, 202, 160, 0.20)');
  glow.addColorStop(0.46, colorMix(color, active ? '#fff0a8' : '#d0b982', active ? 0.62 : 0.36).replace('rgb', 'rgba').replace(')', active ? ', 0.20)' : ', 0.12)'));
  glow.addColorStop(1, 'rgba(255, 230, 142, 0)');
  ctx.save();
  ctx.fillStyle = glow;
  ctx.fillRect(bounds.cx - layout.tileSize * 0.90, bounds.cy - layout.tileSize * 1.02, layout.tileSize * 1.80, layout.tileSize * 1.48);
  ctx.strokeStyle = active ? 'rgba(255, 242, 176, 0.58)' : 'rgba(178, 146, 98, 0.34)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
  ctx.setLineDash([layout.tileSize * 0.10, layout.tileSize * 0.07]);
  ctx.beginPath();
  ctx.ellipse(bounds.cx, bounds.cy + layout.halfTileHeight * 0.20, layout.tileSize * 0.45, layout.tileSize * 0.15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSelectedCommandAquila(ctx, bounds, layout, color, active) {
  const compact = layout.tileSize < 42 || layout.mapWidth < 560;
  const poleX = bounds.cx + layout.tileSize * (compact ? 0.34 : 0.42);
  const baseY = bounds.cy + layout.halfTileHeight * 0.42;
  const topY = bounds.cy - layout.tileSize * (compact ? 0.72 : 0.96);
  const s = layout.tileSize;
  ctx.save();
  ctx.shadowColor = active ? 'rgba(255, 216, 104, 0.40)' : 'rgba(70, 43, 20, 0.24)';
  ctx.shadowBlur = s * (active ? 0.10 : 0.06);
  ctx.strokeStyle = 'rgba(49, 29, 13, 0.82)';
  ctx.lineWidth = Math.max(1.2, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(poleX, baseY);
  ctx.lineTo(poleX, topY);
  ctx.stroke();

  const bannerW = s * (compact ? 0.34 : 0.42);
  const bannerH = s * (compact ? 0.18 : 0.22);
  ctx.fillStyle = active ? colorMix(color, '#f0c866', 0.38) : colorMix(color, '#84633b', 0.25);
  ctx.strokeStyle = 'rgba(58, 33, 15, 0.82)';
  ctx.lineWidth = Math.max(1, s * 0.016);
  ctx.beginPath();
  ctx.moveTo(poleX, topY + s * 0.18);
  ctx.lineTo(poleX + bannerW, topY + s * 0.23);
  ctx.lineTo(poleX + bannerW * 0.74, topY + s * 0.23 + bannerH * 0.46);
  ctx.lineTo(poleX + bannerW, topY + s * 0.23 + bannerH);
  ctx.lineTo(poleX, topY + s * 0.19 + bannerH * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const eagleY = topY + s * 0.075;
  ctx.fillStyle = active ? '#ffe8a2' : '#d8bd7a';
  ctx.strokeStyle = 'rgba(54, 32, 16, 0.78)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.beginPath();
  ctx.arc(poleX, eagleY, Math.max(2.5, s * 0.045), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(poleX - s * 0.15, eagleY + s * 0.02);
  ctx.quadraticCurveTo(poleX - s * 0.04, eagleY - s * 0.08, poleX, eagleY);
  ctx.quadraticCurveTo(poleX + s * 0.04, eagleY - s * 0.08, poleX + s * 0.15, eagleY + s * 0.02);
  ctx.stroke();
  ctx.restore();
}

function drawSelectedCommandPlaque(ctx, bounds, layout, unit, color, active) {
  const compact = layout.tileSize < 46 || layout.mapWidth < 560 || layout.canvasWidth < 640;
  if (compact) {
    drawSelectedCommandCompactTag(ctx, bounds, layout, unit, color, active);
    return;
  }
  const def = UNIT_TYPES[unit.type];
  const label = active ? 'READY' : unit.hasActed ? 'SPENT' : def.role.toUpperCase();
  const w = Math.max(48, layout.tileSize * 0.82);
  const h = Math.max(17, layout.tileSize * 0.22);
  const x = bounds.cx - w * 0.50;
  const y = bounds.cy - layout.tileSize * 1.03;
  ctx.save();
  ctx.shadowColor = 'rgba(67, 40, 18, 0.24)';
  ctx.shadowBlur = layout.tileSize * 0.08;
  roundRectPath(ctx, x, y, w, h, h * 0.44);
  ctx.fillStyle = active ? 'rgba(255, 248, 216, 0.94)' : 'rgba(239, 225, 190, 0.86)';
  ctx.strokeStyle = active ? colorMix(color, '#ffd86b', 0.48) : 'rgba(128, 94, 52, 0.52)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.014);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? '#8f2418' : '#6d5740';
  ctx.font = `900 ${Math.max(8, layout.tileSize * 0.105)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bounds.cx, y + h * 0.54);
  ctx.restore();
}

function drawSelectedCommandCompactTag(ctx, bounds, layout, unit, color, active) {
  const label = unitMapLabel(unit);
  const w = Math.max(42, Math.min(layout.tileSize * 1.12, 22 + label.length * layout.tileSize * 0.105));
  const h = Math.max(15, layout.tileSize * 0.24);
  const x = bounds.cx - w * 0.50;
  const y = bounds.cy - layout.tileSize * 0.90;
  ctx.save();
  ctx.shadowColor = active ? 'rgba(255, 216, 104, 0.34)' : 'rgba(63, 40, 20, 0.18)';
  ctx.shadowBlur = layout.tileSize * 0.055;
  roundRectPath(ctx, x, y, w, h, h * 0.42);
  const fill = ctx.createLinearGradient(x, y, x, y + h);
  fill.addColorStop(0, '#fffdf2');
  fill.addColorStop(0.52, active ? '#fff1c5' : '#efe4ca');
  fill.addColorStop(1, colorMix(color, '#ffffff', active ? 0.74 : 0.84));
  ctx.fillStyle = fill;
  ctx.strokeStyle = active ? colorMix(color, '#f0c866', 0.38) : 'rgba(111, 80, 45, 0.44)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.014);
  ctx.fill();
  ctx.stroke();

  const sealR = h * 0.27;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + h * 0.52, y + h * 0.50, sealR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = active ? '#fff4ba' : 'rgba(255, 247, 214, 0.76)';
  ctx.beginPath();
  ctx.arc(x + h * 0.52, y + h * 0.50, sealR * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = active ? '#7e241d' : '#5f4b35';
  ctx.font = `900 ${Math.max(7, h * 0.43)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w * 0.58, y + h * 0.54, w - h * 1.12);
  ctx.restore();
}

function unitMapLabel(unit) {
  if (unit.type === 'scout') return 'SCOUT';
  if (unit.type === 'spearGuard') return 'SPEAR';
  if (unit.type === 'corpseArcher') return 'BONE BOW';
  const def = UNIT_TYPES[unit.type] || {};
  const source = def.role || def.name || unit.type || 'UNIT';
  return source.replace(/[^a-z0-9 ]/gi, '').trim().slice(0, 8).toUpperCase() || 'UNIT';
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
  drawUnitFormationSilhouette(ctx, unit, x, y, s, enemy ? '#9cf38a' : color, enemy);
  if (def.tags.includes('undead')) {
    drawUndead(ctx, unit, x, y, s);
  } else if (unit.type === 'cavalry') {
    drawCavalry(ctx, color, x, y, s);
  } else if (unit.type === 'onager') {
    drawOnager(ctx, color, x, y, s);
  } else {
    drawLivingSoldier(ctx, unit, color, x, y, s);
  }
  drawUnitLightingRim(ctx, unit, x, y, s, enemy ? '#9cf38a' : color);
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

function drawUnitFormationSilhouette(ctx, unit, x, y, s, color, enemy) {
  const def = UNIT_TYPES[unit.type];
  const undead = def.tags.includes('undead');
  const spent = unit.hasActed && unit.faction === 'olundar';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = undead ? 'rgba(156, 243, 138, 0.20)' : 'rgba(55, 35, 18, 0.22)';
  ctx.shadowBlur = s * 0.045;
  ctx.globalAlpha = spent ? 0.42 : 0.70;

  if (undead) {
    ctx.strokeStyle = 'rgba(8, 15, 11, 0.68)';
    ctx.lineWidth = Math.max(1, s * 0.038);
    for (const px of [0.38, 0.50, 0.62]) {
      ctx.beginPath();
      ctx.moveTo(x + s * px, y + s * 0.34);
      ctx.lineTo(x + s * (px - 0.04), y + s * 0.67);
      ctx.moveTo(x + s * (px - 0.08), y + s * 0.47);
      ctx.lineTo(x + s * (px + 0.07), y + s * 0.52);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(156, 243, 138, 0.58)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.28, y + s * 0.69);
    ctx.quadraticCurveTo(x + s * 0.50, y + s * 0.76, x + s * 0.73, y + s * 0.67);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const backplate = ctx.createLinearGradient(x + s * 0.24, y + s * 0.28, x + s * 0.76, y + s * 0.78);
  backplate.addColorStop(0, colorMix(color, '#fff1b0', 0.34));
  backplate.addColorStop(0.62, colorMix(color, '#7b4b24', 0.16));
  backplate.addColorStop(1, 'rgba(41, 30, 21, 0.34)');
  ctx.fillStyle = backplate;

  if (unit.type === 'archer') {
    ctx.strokeStyle = 'rgba(73, 43, 22, 0.70)';
    ctx.lineWidth = Math.max(1, s * 0.038);
    for (const px of [0.40, 0.52, 0.64]) {
      ctx.beginPath();
      ctx.arc(x + s * px, y + s * 0.57, s * 0.15, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * (px + 0.10), y + s * 0.36);
      ctx.lineTo(x + s * (px + 0.10), y + s * 0.72);
      ctx.stroke();
    }
  } else if (unit.type === 'scout') {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.50, y + s * 0.22);
    ctx.lineTo(x + s * 0.25, y + s * 0.69);
    ctx.quadraticCurveTo(x + s * 0.50, y + s * 0.78, x + s * 0.75, y + s * 0.69);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(243, 232, 167, 0.62)';
    ctx.lineWidth = Math.max(1, s * 0.026);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.32, y + s * 0.64);
    ctx.quadraticCurveTo(x + s * 0.50, y + s * 0.45, x + s * 0.70, y + s * 0.36);
    ctx.stroke();
  } else if (unit.type === 'engineer') {
    ctx.strokeStyle = colorMix(color, '#51321d', 0.18);
    ctx.lineWidth = Math.max(1, s * 0.044);
    for (const [x1, y1, x2, y2] of [[0.30, 0.69, 0.68, 0.35], [0.36, 0.39, 0.74, 0.72], [0.28, 0.58, 0.78, 0.58]]) {
      ctx.beginPath();
      ctx.moveTo(x + s * x1, y + s * y1);
      ctx.lineTo(x + s * x2, y + s * y2);
      ctx.stroke();
    }
  } else if (unit.type === 'cavalry') {
    ctx.beginPath();
    ctx.ellipse(x + s * 0.52, y + s * 0.62, s * 0.38, s * 0.15, -0.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(43, 29, 18, 0.58)';
    ctx.lineWidth = Math.max(1, s * 0.032);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.32, y + s * 0.72);
    ctx.lineTo(x + s * 0.22, y + s * 0.80);
    ctx.moveTo(x + s * 0.62, y + s * 0.72);
    ctx.lineTo(x + s * 0.74, y + s * 0.80);
    ctx.stroke();
  } else if (unit.type === 'onager') {
    ctx.strokeStyle = 'rgba(74, 49, 28, 0.70)';
    ctx.lineWidth = Math.max(1, s * 0.044);
    ctx.strokeRect(x + s * 0.25, y + s * 0.52, s * 0.50, s * 0.18);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.36, y + s * 0.53);
    ctx.lineTo(x + s * 0.71, y + s * 0.26);
    ctx.stroke();
  } else {
    ctx.strokeStyle = colorMix(color, '#4f2e1c', 0.20);
    ctx.lineWidth = Math.max(1, s * 0.026);
    for (const [px, py] of [[0.33, 0.60], [0.49, 0.56], [0.65, 0.60]]) {
      drawLegionShield(ctx, x + s * px, y + s * py, s * 0.56, unit.type === 'spearGuard' ? '#e3d276' : '#dce2e7', color);
      ctx.beginPath();
      ctx.moveTo(x + s * (px + 0.06), y + s * 0.28);
      ctx.lineTo(x + s * (px + 0.06), y + s * 0.74);
      ctx.stroke();
    }
  }

  if (!enemy) {
    ctx.globalAlpha = spent ? 0.18 : 0.34;
    ctx.strokeStyle = 'rgba(255, 244, 184, 0.72)';
    ctx.lineWidth = Math.max(1, s * 0.014);
    ctx.beginPath();
    ctx.ellipse(x + s * 0.50, y + s * 0.77, s * 0.34, s * 0.06, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUnitLightingRim(ctx, unit, x, y, s, color) {
  const undead = UNIT_TYPES[unit.type].tags.includes('undead');
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = undead ? 'rgba(190, 255, 157, 0.55)' : 'rgba(255, 250, 214, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.026);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.35, y + s * 0.33);
  ctx.quadraticCurveTo(x + s * 0.47, y + s * 0.21, x + s * 0.64, y + s * 0.32);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = undead ? 'rgba(35, 80, 45, 0.64)' : 'rgba(43, 36, 24, 0.46)';
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.31, y + s * 0.72);
  ctx.quadraticCurveTo(x + s * 0.50, y + s * 0.84, x + s * 0.70, y + s * 0.72);
  ctx.stroke();
  ctx.fillStyle = colorMix(color, undead ? '#d7ffb5' : '#fff0ad', undead ? 0.38 : 0.28);
  ctx.globalAlpha = undead ? 0.60 : 0.42;
  ctx.beginPath();
  ctx.ellipse(x + s * 0.64, y + s * 0.28, s * 0.045, s * 0.018, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawUnitPlinth(ctx, unit, x, y, s, color, ready) {
  const cx = x + s * 0.5;
  const cy = y + s * 0.79;
  ctx.save();
  const base = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.03, s * 0.04, cx, cy, s * 0.34);
  base.addColorStop(0, ready ? 'rgba(255, 250, 201, 0.74)' : 'rgba(232, 218, 176, 0.46)');
  base.addColorStop(0.58, unit.faction === 'dead' ? 'rgba(21, 36, 25, 0.88)' : 'rgba(45, 62, 58, 0.82)');
  base.addColorStop(1, unit.faction === 'dead' ? 'rgba(7, 12, 10, 0.76)' : 'rgba(20, 36, 36, 0.70)');
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
  const window = cameraTileWindow(layout, 3);
  for (let y = window.minY; y <= window.maxY; y += 1) {
    for (let x = window.minX; x <= window.maxX; x += 1) {
      const bounds = tileBounds(layout, x, y);
      const { s } = bounds;
      if (!isRevealed(state, x, y)) {
        fillTileDiamond(ctx, bounds, 'rgba(245, 255, 250, 0.27)');
        if ((x * 7 + y * 11) % 41 === 0) {
          const veil = ctx.createRadialGradient(bounds.cx, bounds.cy, s * 0.16, bounds.cx, bounds.cy, s * 2.0);
          veil.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
          veil.addColorStop(0.52, 'rgba(229, 251, 247, 0.14)');
          veil.addColorStop(1, 'rgba(229, 251, 247, 0)');
          ctx.fillStyle = veil;
          ctx.fillRect(bounds.cx - s * 2, bounds.cy - s * 2, s * 4, s * 4);
        }
        if ((x * 11 + y * 13) % 47 === 0) {
          ctx.strokeStyle = 'rgba(59, 126, 136, 0.11)';
          ctx.lineWidth = Math.max(1, s * 0.035);
          ctx.beginPath();
          ctx.arc(bounds.cx, bounds.cy, s * 0.20, 0.2, Math.PI * 1.35);
          ctx.stroke();
        }
      } else if (!isVisible(state, x, y)) {
        fillTileDiamond(ctx, bounds, 'rgba(95, 139, 116, 0.13)');
        fillTileDiamond(ctx, bounds, 'rgba(255, 255, 250, 0.10)', s * 0.08);
      }
    }
  }
}

function drawFogAtmosphere(ctx, state, layout) {
  ctx.save();
  for (const tile of cameraSortedTiles(state.map, layout, 4)) {
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
  ctx.shadowColor = 'rgba(42, 99, 93, 0.12)';
  ctx.shadowBlur = Math.max(5, s * 0.12);
  ctx.strokeStyle = 'rgba(64, 137, 135, 0.24)';
  ctx.lineWidth = Math.max(1, s * 0.020);
  ctx.strokeRect(x - s * 0.035, y - s * 0.035, w + s * 0.07, h + s * 0.07);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255, 255, 248, 0.82)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.strokeRect(x + s * 0.035, y + s * 0.035, w - s * 0.07, h - s * 0.07);
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
  const compactInset = layout.mapWidth < 720 || (typeof window !== 'undefined' && window.innerWidth <= 620);
  if (compactInset && layout.mapWidth < 560) {
    drawMiniMapSurveyChip(ctx, state, layout, lensId);
    return;
  }
  const scale = compactInset
    ? Math.max(1.1, Math.min(1.45, layout.tileSize * 0.052))
    : Math.max(2, Math.min(5, Math.floor(layout.tileSize * 0.15)));
  const pad = compactInset ? 5 : 8;
  const w = MAP_WIDTH * scale;
  const h = MAP_HEIGHT * scale;
  const x0 = layout.frameX + layout.mapWidth - w - pad;
  const preferredY = layout.frameY + Math.max(8, layout.tileSize * 0.96);
  const y0 = Math.min(layout.frameY + layout.mapHeight - h - pad, preferredY);
  const panelPad = compactInset ? 5 : 8;
  const panelX = x0 - panelPad;
  const panelY = y0 - panelPad;
  const panelW = w + panelPad * 2;
  const panelH = h + panelPad * 2;
  ctx.save();
  ctx.shadowColor = compactInset ? 'rgba(49, 84, 72, 0.08)' : 'rgba(49, 84, 72, 0.16)';
  ctx.shadowBlur = layout.tileSize * (compactInset ? 0.035 : 0.08);
  ctx.shadowOffsetY = layout.tileSize * (compactInset ? 0.012 : 0.025);
  roundRectPath(ctx, panelX, panelY, panelW, panelH, Math.max(5, scale * 1.2));
  const frame = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
  frame.addColorStop(0, 'rgba(255, 255, 245, 0.94)');
  frame.addColorStop(0.58, 'rgba(224, 240, 216, 0.90)');
  frame.addColorStop(1, 'rgba(151, 197, 193, 0.58)');
  ctx.fillStyle = frame;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = compactInset ? 'rgba(35, 106, 131, 0.28)' : 'rgba(35, 106, 131, 0.38)';
  ctx.lineWidth = Math.max(0.75, scale * (compactInset ? 0.24 : 0.35));
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x0, y0, w, h, Math.max(3, scale * 0.75));
  ctx.clip();
  ctx.fillStyle = '#dce9dc';
  ctx.fillRect(x0, y0, w, h);
  for (const tile of state.map.tiles) {
    let color = '#dce9dc';
    if (isRevealed(state, tile.x, tile.y)) {
      color = isVisible(state, tile.x, tile.y)
        ? colorMix(TERRAIN_COLORS[tile.terrain] || '#777777', '#fff4cf', 0.16)
        : colorMix(TERRAIN_COLORS[tile.terrain] || '#b9cab9', '#d9e4d5', 0.54);
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
  ctx.strokeStyle = 'rgba(48, 105, 109, 0.46)';
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

function drawMiniMapSurveyChip(ctx, state, layout, lensId = 'normal') {
  const revealed = state.revealed.filter(Boolean).length;
  const mapped = Math.round((revealed / (MAP_WIDTH * MAP_HEIGHT)) * 100);
  const lens = getStrategicMapLens(state, lensId);
  const pad = Math.max(5, layout.tileSize * 0.10);
  const w = Math.max(76, layout.tileSize * 1.70);
  const h = Math.max(28, layout.tileSize * 0.62);
  const x = layout.frameX + layout.mapWidth - w - pad;
  const y = layout.frameY + Math.max(6, layout.tileSize * 0.22);
  ctx.save();
  ctx.shadowColor = 'rgba(39, 92, 81, 0.10)';
  ctx.shadowBlur = Math.max(3, layout.tileSize * 0.045);
  roundRectPath(ctx, x, y, w, h, Math.max(7, h * 0.26));
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, 'rgba(255, 255, 249, 0.88)');
  fill.addColorStop(1, 'rgba(218, 246, 240, 0.68)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(33, 119, 129, 0.18)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012);
  ctx.stroke();

  const cx = x + h * 0.48;
  const cy = y + h * 0.50;
  const r = h * 0.26;
  ctx.fillStyle = lens.id === 'normal' ? 'rgba(215, 235, 174, 0.90)' : lensColor(lens.id);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(143, 36, 24, 0.42)';
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.stroke();
  ctx.fillStyle = '#2e5c48';
  ctx.font = `900 ${Math.max(8, h * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${mapped}%`, x + h * 0.90, y + h * 0.42, w - h * 1.05);
  ctx.fillStyle = '#60745c';
  ctx.font = `800 ${Math.max(6, h * 0.20)}px system-ui, sans-serif`;
  ctx.fillText('MAPPED', x + h * 0.90, y + h * 0.70, w - h * 1.05);
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

function drawHollowCrownCompass(ctx, state, layout) {
  if (state.status !== 'playing' || state.flags?.portalDestroyed) return;
  const portal = state.buildings.find((building) => building.faction === 'dead' && building.type === 'portal');
  const boss = state.units.find((unit) => unit.faction === 'dead' && unit.type === 'lichBoss');
  const target = portal || boss;
  if (!target) return;

  const compact = layout.mapWidth < 720 || (typeof window !== 'undefined' && window.innerWidth <= 620);
  const pad = compact ? 6 : 9;
  const w = Math.max(compact ? 112 : 156, layout.tileSize * (compact ? 2.72 : 3.18));
  const h = Math.max(compact ? 38 : 48, layout.tileSize * (compact ? 0.82 : 0.92));
  const x = clamp(layout.frameX + layout.mapWidth - w - pad, pad, Math.max(pad, layout.canvasWidth - w - pad));
  const miniScale = compact
    ? Math.max(1.1, Math.min(1.45, layout.tileSize * 0.052))
    : Math.max(2, Math.min(5, Math.floor(layout.tileSize * 0.15)));
  const miniPanelH = MAP_HEIGHT * miniScale + (compact ? 10 : 16);
  const preferredY = layout.frameY + Math.max(8, layout.tileSize * 0.96) + miniPanelH + pad;
  const y = Math.min(layout.frameY + layout.mapHeight - h - Math.max(48, layout.tileSize * 1.06), preferredY);
  const located = isRevealed(state, target.x, target.y);
  const center = {
    x: layout.camera.x + layout.camera.width * 0.5,
    y: layout.camera.y + layout.camera.height * 0.5
  };
  const direction = hollowCrownDirection(layout, center, target);
  const pressure = state.units.filter((unit) => unit.faction === 'dead').length
    + state.buildings.filter((building) => building.faction === 'dead').length;
  const source = state.units.find((unit) => unit.id === state.selectedUnitId)
    || state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city')
    || state.units.find((unit) => unit.faction === 'olundar');
  const distance = source ? manhattan(source.x, source.y, target.x, target.y) : manhattan(Math.round(center.x), Math.round(center.y), target.x, target.y);
  const status = boss && isRevealed(state, boss.x, boss.y)
    ? 'VORGATH SIGHTED'
    : located
      ? 'PORTAL LOCATED'
      : 'EASTERN OMEN';

  if (compact && layout.mapWidth < 560) {
    drawHollowCrownMicroCompass(ctx, layout, direction, status, pressure, distance, located);
    return;
  }

  ctx.save();
  ctx.shadowColor = 'rgba(31, 44, 26, 0.22)';
  ctx.shadowBlur = Math.max(5, layout.tileSize * 0.08);
  ctx.shadowOffsetY = Math.max(2, layout.tileSize * 0.03);
  roundRectPath(ctx, x, y, w, h, Math.max(8, h * 0.20));
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, 'rgba(255, 250, 234, 0.96)');
  fill.addColorStop(0.58, 'rgba(235, 248, 226, 0.92)');
  fill.addColorStop(1, located ? 'rgba(203, 255, 176, 0.74)' : 'rgba(231, 236, 205, 0.74)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = located ? 'rgba(66, 118, 50, 0.54)' : 'rgba(100, 105, 83, 0.42)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.018);
  ctx.stroke();

  const cx = x + h * 0.50;
  const cy = y + h * 0.50;
  drawHollowCrownDial(ctx, cx, cy, h * 0.36, direction, located);
  drawHollowCrownCompassText(ctx, x + h * 0.92, y, w - h * 1.02, h, status, pressure, distance, located, compact);
  ctx.restore();
}

function drawDeadwalkerPressureTelegraph(ctx, state, layout) {
  if (state.status !== 'playing' || state.flags?.portalDestroyed) return;
  const data = deadwalkerPressureTelegraphData(state, layout);
  if (!data) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (data.kind === 'known') {
    drawKnownDeadwalkerThreatLane(ctx, layout, data);
  } else {
    drawHiddenDeadwalkerOmenFront(ctx, layout, data);
  }
  ctx.restore();
}

function deadwalkerPressureTelegraphData(state, layout) {
  const livingTarget = primaryLivingThreatTarget(state);
  if (!livingTarget) return null;
  const known = knownDeadwalkerMapThreats(state, livingTarget)
    .sort((a, b) => Number(!a.visible) - Number(!b.visible) || a.distance - b.distance || b.priority - a.priority)[0] || null;
  if (known) {
    return {
      kind: 'known',
      threat: known,
      target: livingTarget,
      label: known.canAttack ? 'ATTACK' : 'MARCH',
      detail: known.name
    };
  }
  const portal = state.buildings.find((building) => building.faction === 'dead' && building.type === 'portal')
    || state.units.find((unit) => unit.faction === 'dead' && unit.type === 'lichBoss');
  if (!portal) return null;
  return {
    kind: 'omen',
    source: portal,
    target: livingTarget,
    next: nextDeadwalkerTelegraphSurge(state),
    direction: hollowCrownDirection(layout, {
      x: layout.camera.x + layout.camera.width * 0.5,
      y: layout.camera.y + layout.camera.height * 0.5
    }, portal)
  };
}

function primaryLivingThreatTarget(state) {
  return state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city')
    || state.buildings.find((building) => building.faction === 'olundar')
    || state.units.find((unit) => unit.faction === 'olundar')
    || state.buildings.find((building) => building.faction !== 'dead' && isEnemy(state, 'dead', building.faction))
    || state.units.find((unit) => unit.faction !== 'dead' && isEnemy(state, 'dead', unit.faction));
}

function knownDeadwalkerMapThreats(state, fallbackTarget) {
  const entities = [
    ...state.units.filter((unit) => unit.faction === 'dead' && (isVisible(state, unit.x, unit.y) || isRevealed(state, unit.x, unit.y))).map((entity) => ({ entity, building: false })),
    ...state.buildings.filter((building) => building.faction === 'dead' && (isVisible(state, building.x, building.y) || isRevealed(state, building.x, building.y))).map((entity) => ({ entity, building: true }))
  ];
  return entities.map(({ entity, building }) => {
    const target = nearestLivingMapThreatTarget(state, entity.x, entity.y) || fallbackTarget;
    if (!target) return null;
    const def = building ? BUILDING_TYPES[entity.type] : UNIT_TYPES[entity.type];
    const distance = manhattan(entity.x, entity.y, target.x, target.y);
    const range = building ? 2 : def?.range || 1;
    return {
      entity,
      target,
      building,
      name: entity.name || def?.name || 'Deadwalker',
      visible: isVisible(state, entity.x, entity.y),
      distance,
      canAttack: distance <= range,
      priority: distance <= range ? 12 : building ? 8 : 6
    };
  }).filter(Boolean);
}

function nearestLivingMapThreatTarget(state, x, y) {
  return [
    ...state.units.filter((unit) => unit.faction !== 'dead' && isEnemy(state, 'dead', unit.faction)),
    ...state.buildings.filter((building) => building.faction !== 'dead' && isEnemy(state, 'dead', building.faction))
  ].sort((a, b) => manhattan(x, y, a.x, a.y) - manhattan(x, y, b.x, b.y))[0] || null;
}

function nextDeadwalkerTelegraphSurge(state) {
  const pressure = DIFFICULTY_PRESETS[state.campaign?.difficultyId]?.deadwalker || DIFFICULTY_PRESETS.standard.deadwalker;
  const checks = [
    { cadence: pressure.thrallEvery, label: 'Bone Thrall' },
    { cadence: pressure.archerEvery, label: 'Corpse Archer' },
    { cadence: pressure.knightEvery, label: 'Grave Knight' },
    { cadence: pressure.outpostEvery, label: 'Deadwork' }
  ].filter((item) => item.cadence > 0);
  for (let turn = state.turn + 1; turn <= state.turn + 12; turn += 1) {
    const labels = checks.filter((item) => turn >= pressure.startTurn && turn % item.cadence === 0).map((item) => item.label);
    if (labels.length) return { turn, label: labels[0], count: labels.length };
  }
  return null;
}

function drawKnownDeadwalkerThreatLane(ctx, layout, data) {
  const from = tileCenter(layout, data.threat.entity.x, data.threat.entity.y);
  const to = tileCenter(layout, data.threat.target.x, data.threat.target.y);
  const immediate = data.threat.canAttack;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  drawDeadwalkerPressurePath(ctx, from, to, layout, immediate, data.threat.visible);
  drawDeadwalkerThreatSeal(ctx, tileBounds(layout, data.threat.entity.x, data.threat.entity.y), layout, data.label, immediate);
  if (data.threat.target) drawDeadwalkerTargetReticle(ctx, tileBounds(layout, data.threat.target.x, data.threat.target.y), layout, immediate);
  ctx.restore();
}

function drawDeadwalkerPressurePath(ctx, from, to, layout, immediate, visible) {
  const s = layout.tileSize;
  const alpha = visible ? (immediate ? 0.72 : 0.48) : 0.32;
  const mid = {
    x: (from.x + to.x) * 0.5,
    y: (from.y + to.y) * 0.5 - s * 0.28
  };
  ctx.save();
  ctx.shadowColor = immediate ? 'rgba(152, 30, 22, 0.34)' : 'rgba(156, 243, 138, 0.22)';
  ctx.shadowBlur = s * (immediate ? 0.12 : 0.08);
  ctx.strokeStyle = immediate ? `rgba(138, 30, 24, ${alpha})` : `rgba(58, 109, 56, ${alpha})`;
  ctx.lineWidth = Math.max(3, s * 0.070);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y + layout.halfTileHeight * 0.12);
  ctx.quadraticCurveTo(mid.x, mid.y, to.x, to.y + layout.halfTileHeight * 0.12);
  ctx.stroke();
  ctx.strokeStyle = immediate ? `rgba(255, 167, 118, ${Math.min(0.90, alpha + 0.14)})` : `rgba(189, 255, 150, ${Math.min(0.82, alpha + 0.12)})`;
  ctx.lineWidth = Math.max(1.4, s * 0.028);
  ctx.setLineDash([s * 0.18, s * 0.13]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y + layout.halfTileHeight * 0.09);
  ctx.quadraticCurveTo(mid.x, mid.y - s * 0.05, to.x, to.y + layout.halfTileHeight * 0.09);
  ctx.stroke();
  ctx.setLineDash([]);
  drawDeadwalkerPressureArrowhead(ctx, from, to, layout, immediate);
  ctx.restore();
}

function drawDeadwalkerThreatSeal(ctx, bounds, layout, label, immediate) {
  const s = layout.tileSize;
  const w = Math.max(52, Math.min(s * 1.38, label.length * s * 0.14 + s * 0.52));
  const h = Math.max(18, s * 0.30);
  const x = bounds.cx - w * 0.5;
  const y = bounds.cy - s * 0.82;
  ctx.save();
  ctx.shadowColor = immediate ? 'rgba(125, 25, 18, 0.32)' : 'rgba(48, 91, 41, 0.24)';
  ctx.shadowBlur = s * 0.08;
  roundRectPath(ctx, x, y, w, h, h * 0.34);
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, immediate ? 'rgba(255, 240, 224, 0.96)' : 'rgba(244, 255, 225, 0.94)');
  fill.addColorStop(1, immediate ? 'rgba(255, 183, 136, 0.82)' : 'rgba(194, 255, 162, 0.72)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = immediate ? 'rgba(143, 36, 24, 0.72)' : 'rgba(66, 118, 50, 0.58)';
  ctx.lineWidth = Math.max(1, s * 0.014);
  ctx.stroke();
  ctx.fillStyle = immediate ? '#8f2418' : '#265329';
  ctx.font = `900 ${Math.max(8, h * 0.45)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bounds.cx, y + h * 0.54, w - 6);
  ctx.restore();
}

function drawDeadwalkerTargetReticle(ctx, bounds, layout, immediate) {
  const s = layout.tileSize;
  ctx.save();
  ctx.strokeStyle = immediate ? 'rgba(170, 34, 27, 0.70)' : 'rgba(80, 128, 57, 0.44)';
  ctx.lineWidth = Math.max(1.5, s * 0.026);
  ctx.setLineDash([s * 0.09, s * 0.06]);
  ctx.beginPath();
  ctx.ellipse(bounds.cx, bounds.cy + layout.halfTileHeight * 0.20, s * 0.38, s * 0.14, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHiddenDeadwalkerOmenFront(ctx, layout, data) {
  const edge = pressureEdgePoint(layout, data.direction);
  const inward = {
    x: edge.x - Math.cos(data.direction) * layout.tileSize * 1.42,
    y: edge.y - Math.sin(data.direction) * layout.tileSize * 1.42
  };
  const label = data.next ? `${data.next.turn === 2 ? 'NEXT' : `T${data.next.turn}`} ${deadwalkerCompactSurgeLabel(data.next.label)}` : 'OMEN';
  ctx.save();
  drawHiddenOmenWake(ctx, edge, inward, layout);
  drawDeadwalkerPressureArrowhead(ctx, edge, inward, layout, false);
  drawHiddenOmenBadge(ctx, layout, edge, inward, label);
  ctx.restore();
}

function deadwalkerCompactSurgeLabel(label) {
  if (/thrall/i.test(label)) return 'BONE';
  if (/archer/i.test(label)) return 'BOW';
  if (/knight/i.test(label)) return 'KNIGHT';
  if (/deadwork/i.test(label)) return 'DEADWORK';
  return String(label || 'SURGE').toUpperCase().slice(0, 8);
}

function pressureEdgePoint(layout, direction) {
  const cx = layout.frameX + layout.mapWidth * 0.5;
  const cy = layout.frameY + layout.mapHeight * 0.5;
  const dx = Math.cos(direction);
  const dy = Math.sin(direction);
  const candidates = [];
  if (Math.abs(dx) > 0.001) {
    candidates.push((layout.frameX - cx) / dx, (layout.frameX + layout.mapWidth - cx) / dx);
  }
  if (Math.abs(dy) > 0.001) {
    candidates.push((layout.frameY - cy) / dy, (layout.frameY + layout.mapHeight - cy) / dy);
  }
  const t = Math.min(...candidates.filter((value) => value > 0));
  return {
    x: clamp(cx + dx * t, layout.frameX + layout.tileSize * 0.42, layout.frameX + layout.mapWidth - layout.tileSize * 0.42),
    y: clamp(cy + dy * t, layout.frameY + layout.tileSize * 0.42, layout.frameY + layout.mapHeight - layout.tileSize * 0.42)
  };
}

function drawHiddenOmenWake(ctx, edge, inward, layout) {
  const s = layout.tileSize;
  const gradient = ctx.createLinearGradient(edge.x, edge.y, inward.x, inward.y);
  gradient.addColorStop(0, 'rgba(156, 243, 138, 0.26)');
  gradient.addColorStop(0.55, 'rgba(105, 155, 82, 0.13)');
  gradient.addColorStop(1, 'rgba(105, 155, 82, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(8, s * 0.22);
  ctx.beginPath();
  ctx.moveTo(edge.x, edge.y);
  ctx.lineTo(inward.x, inward.y);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(81, 97, 61, 0.30)';
  ctx.lineWidth = Math.max(2.2, s * 0.055);
  ctx.setLineDash([s * 0.16, s * 0.12]);
  ctx.beginPath();
  ctx.moveTo(edge.x, edge.y);
  ctx.lineTo(inward.x, inward.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawHiddenOmenBadge(ctx, layout, edge, inward, label) {
  const s = layout.tileSize;
  const compact = layout.mapWidth < 620 || layout.tileSize < 42;
  const w = Math.max(compact ? 62 : 82, Math.min(compact ? s * 1.70 : s * 2.15, label.length * s * 0.13 + s * 0.58));
  const h = Math.max(compact ? 18 : 22, s * (compact ? 0.34 : 0.38));
  const x = clamp(inward.x - w * 0.5, layout.frameX + 6, layout.frameX + layout.mapWidth - w - 6);
  const y = clamp(inward.y - h * 0.5, layout.frameY + 6, layout.frameY + layout.mapHeight - h - 6);
  ctx.save();
  ctx.shadowColor = 'rgba(45, 72, 37, 0.24)';
  ctx.shadowBlur = s * 0.07;
  roundRectPath(ctx, x, y, w, h, h * 0.36);
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, 'rgba(255, 252, 229, 0.95)');
  fill.addColorStop(1, 'rgba(216, 255, 184, 0.78)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(72, 111, 58, 0.48)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.stroke();
  ctx.fillStyle = '#7d2d22';
  ctx.font = `900 ${Math.max(8, h * 0.42)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w * 0.52, y + h * 0.54, w - 8);
  ctx.restore();
}

function drawDeadwalkerPressureArrowhead(ctx, from, to, layout, immediate) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const s = layout.tileSize;
  const x = to.x;
  const y = to.y;
  const size = Math.max(6, s * (immediate ? 0.18 : 0.14));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = immediate ? 'rgba(143, 36, 24, 0.82)' : 'rgba(83, 132, 63, 0.72)';
  ctx.strokeStyle = 'rgba(255, 252, 218, 0.70)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.46, -size * 0.50);
  ctx.lineTo(-size * 0.22, 0);
  ctx.lineTo(-size * 0.46, size * 0.50);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHollowCrownMicroCompass(ctx, layout, direction, status, pressure, distance, located) {
  const pad = Math.max(5, layout.tileSize * 0.10);
  const w = Math.max(92, layout.tileSize * 2.12);
  const h = Math.max(30, layout.tileSize * 0.68);
  const x = layout.frameX + layout.mapWidth - w - pad;
  const y = layout.frameY + Math.max(38, layout.tileSize * 0.94);
  ctx.save();
  ctx.shadowColor = 'rgba(48, 74, 45, 0.12)';
  ctx.shadowBlur = Math.max(3, layout.tileSize * 0.045);
  roundRectPath(ctx, x, y, w, h, Math.max(7, h * 0.25));
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, 'rgba(255, 254, 244, 0.88)');
  fill.addColorStop(1, located ? 'rgba(213, 255, 184, 0.68)' : 'rgba(231, 240, 215, 0.66)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = located ? 'rgba(66, 118, 50, 0.32)' : 'rgba(92, 105, 76, 0.24)';
  ctx.lineWidth = Math.max(1, layout.tileSize * 0.012);
  ctx.stroke();
  const cx = x + h * 0.48;
  const cy = y + h * 0.50;
  drawHollowCrownDial(ctx, cx, cy, h * 0.27, direction, located);
  ctx.fillStyle = located ? '#1f4f28' : '#7d2d22';
  ctx.font = `900 ${Math.max(7, h * 0.24)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(status.replace('EASTERN ', '').replace('PORTAL ', ''), x + h * 0.86, y + h * 0.38, w - h);
  ctx.fillStyle = '#52604a';
  ctx.font = `800 ${Math.max(6, h * 0.19)}px system-ui, sans-serif`;
  ctx.fillText(`${pressure} pressure | ${distance}`, x + h * 0.86, y + h * 0.68, w - h);
  ctx.restore();
}

function hollowCrownDirection(layout, center, target) {
  const screenCenter = {
    x: layout.originX + ((center.x - layout.camera.x) - (center.y - layout.camera.y)) * layout.halfTileWidth,
    y: layout.originY + ((center.x - layout.camera.x) + (center.y - layout.camera.y)) * layout.halfTileHeight
  };
  const tx = target.x - layout.camera.x;
  const ty = target.y - layout.camera.y;
  const screenTarget = {
    x: layout.originX + (tx - ty) * layout.halfTileWidth,
    y: layout.originY + (tx + ty) * layout.halfTileHeight
  };
  return Math.atan2(screenTarget.y - screenCenter.y, screenTarget.x - screenCenter.x);
}

function drawHollowCrownDial(ctx, cx, cy, r, direction, located) {
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, r * 0.10, cx, cy, r * 1.45);
  glow.addColorStop(0, located ? 'rgba(156, 243, 138, 0.38)' : 'rgba(156, 243, 138, 0.20)');
  glow.addColorStop(1, 'rgba(156, 243, 138, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);

  ctx.fillStyle = located ? 'rgba(32, 45, 35, 0.88)' : 'rgba(64, 58, 43, 0.82)';
  ctx.strokeStyle = located ? 'rgba(156, 243, 138, 0.78)' : 'rgba(116, 132, 93, 0.62)';
  ctx.lineWidth = Math.max(1, r * 0.10);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(direction);
  ctx.fillStyle = located ? '#9cf38a' : '#526a48';
  ctx.strokeStyle = 'rgba(255, 255, 236, 0.84)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(r * 0.86, 0);
  ctx.lineTo(-r * 0.24, -r * 0.34);
  ctx.lineTo(-r * 0.04, 0);
  ctx.lineTo(-r * 0.24, r * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 236, 0.34)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  for (let i = 0; i < 4; i += 1) {
    const a = i * Math.PI * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58);
    ctx.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHollowCrownCompassText(ctx, x, y, w, h, status, pressure, distance, located, compact) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = located ? '#1f4f28' : '#5d4b2f';
  ctx.font = `900 ${Math.max(7, h * (compact ? 0.16 : 0.15))}px system-ui, sans-serif`;
  ctx.fillText('HOLLOW CROWN', x, y + h * 0.25, w);
  ctx.fillStyle = located ? '#173b1f' : '#7d2d22';
  ctx.font = `900 ${Math.max(9, h * (compact ? 0.23 : 0.24))}px system-ui, sans-serif`;
  ctx.fillText(status, x, y + h * 0.52, w);
  ctx.fillStyle = '#365235';
  ctx.font = `800 ${Math.max(7, h * (compact ? 0.17 : 0.16))}px system-ui, sans-serif`;
  ctx.fillText(`${pressure} pressure | ${distance} sectors`, x, y + h * 0.76, w);
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
      body: `${def.text} HP ${building.hp}/${building.maxHp}.${building.turnsLeft > 0 ? ` Completes in ${formatTurnCount(building.turnsLeft)}.` : ' Upgrades improve durability, vision, and strategic output.'}${queue}`,
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

function formatTurnCount(turns) {
  return `${turns} turn${turns === 1 ? '' : 's'}`;
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
