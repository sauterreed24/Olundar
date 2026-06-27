/**
 * PixiJS v8 rendering backbone: lighting, particles, and juice overlays.
 * Base terrain/units render via Canvas 2D (render.js); Pixi composites premium effects on top.
 */

import { Application, Assets, Graphics, Text } from 'pixi.js';
import { getCamera } from './camera.js';
import { getParticleSystem } from './particles.js';
import { getAmbientLifeSystem } from './ambient-life.js';

const SPRITE_SHEET = './assets/sprites/olundar-sprite-sheet.svg';
const TILE_CULL_MARGIN = 3;
const PIXEL_CULL_MARGIN = 96;
const FLOATING_TEXT_STYLE = {
  fontFamily: 'system-ui',
  fontSize: 14,
  fontWeight: '900',
  fill: '#ff8a8a'
};

const IMPERIAL_PALETTE = {
  parchment: 0xf6ead0,
  marble: 0xfff8ec,
  bronze: 0xb87333,
  crimson: 0x8b1e1e,
  lapis: 0x2d5f8f,
  jade: 0x3d8b6e,
  deadGlow: 0x9cf38a,
  shrineGlow: 0xf0c866
};

let app = null;
let viewportEl = null;
let baseCanvas = null;
let lightingLayer = null;
let particleLayer = null;
let effectsLayer = null;
let atlasTexture = null;
let lastFrame = performance.now();
let screenShake = { intensity: 0, duration: 0 };
let hitStopMs = 0;
let floatingTexts = [];
let fogRevealTiles = new Map();
let buildingBounces = new Map();
let initialized = false;
let initPromise = null;
let getLayoutFn = null;
let overlayGraphics = null;
const floatingTextPool = [];

export function isPixiReady() {
  return initialized && app !== null;
}

export async function initPixiRenderer(canvasElement, { getLayout } = {}) {
  if (getLayout) getLayoutFn = getLayout;
  if (initialized) return app;
  if (initPromise) return initPromise;
  baseCanvas = canvasElement;

  initPromise = bootPixiRenderer(canvasElement);
  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

async function bootPixiRenderer(canvasElement) {
  const parent = canvasElement.parentElement;
  if (!parent) throw new Error('Canvas parent missing for Pixi overlay.');

  viewportEl = document.createElement('div');
  viewportEl.className = 'battlefield-viewport';
  parent.insertBefore(viewportEl, canvasElement);
  viewportEl.appendChild(canvasElement);

  const overlayHost = document.createElement('div');
  overlayHost.className = 'pixi-overlay-host';
  viewportEl.appendChild(overlayHost);

  const width = canvasElement.clientWidth || canvasElement.width || 1280;
  const height = canvasElement.clientHeight || canvasElement.height || 860;

  app = new Application();
  await app.init({
    width,
    height,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true
  });

  overlayHost.appendChild(app.canvas);
  app.canvas.style.pointerEvents = 'none';

  lightingLayer = app.stage;
  particleLayer = app.stage;
  effectsLayer = app.stage;
  overlayGraphics = new Graphics();
  app.stage.addChild(overlayGraphics);

  try {
    atlasTexture = await Assets.load(SPRITE_SHEET);
  } catch {
    atlasTexture = null;
  }

  initialized = true;
  return app;
}

export function getPixiCanvas() {
  return baseCanvas;
}

export function resizePixiRenderer(width, height, dpr = 1) {
  if (!app || !baseCanvas) return;
  const w = Math.floor(width * dpr);
  const h = Math.floor(height * dpr);
  baseCanvas.width = w;
  baseCanvas.height = h;
  baseCanvas.style.height = `${height}px`;
  app.renderer.resize(w, h);
  if (viewportEl) viewportEl.style.height = `${height}px`;
}

export function renderPixiFrame(canvas, state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay, drawCore) {
  if (!initialized) return false;

  const now = performance.now();
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  if (hitStopMs > 0) {
    hitStopMs -= dt * 1000;
    if (hitStopMs > 0) return true;
  }

  const camera = getCamera();
  camera.update(dt * 1000, canvas.width, canvas.height);

  if (drawCore) {
    drawCore(canvas, state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay);
  }

  applyViewportTransform(camera);

  const g = overlayGraphics || new Graphics();
  if (!g.parent) app.stage.addChild(g);
  g.clear();
  const layout = getLayoutFn?.(canvas);
  const viewport = layout ? pixiViewport(layout, TILE_CULL_MARGIN, PIXEL_CULL_MARGIN) : null;
  if (layout && state) {
    drawVignette(g, canvas.width, canvas.height);
    drawUnitShadows(g, state, layout, viewport);
    drawStructureGlow(g, state, layout, viewport);
    drawBlightGlow(g, state, layout, viewport);
  }
  const particles = getParticleSystem();
  particles.update(dt);
  particles.draw(g, viewport?.pixel);
  const ambient = getAmbientLifeSystem();
  ambient.update(dt, state, layout, (layoutArg, x, y) => tileToScreen(layoutArg, x, y), isTileVisible, viewport?.tile);
  ambient.draw(g, viewport?.pixel);
  drawFloatingTexts(dt);
  updateFogReveal(state, dt, viewport?.tile);
  updateBlightPulse(dt);

  return true;
}

function applyViewportTransform(camera) {
  if (!viewportEl) return;
  const shake = screenShake.duration > 0 ? screenShake.intensity * (screenShake.duration / 0.25) : 0;
  if (screenShake.duration > 0) screenShake.duration -= 0.016;
  const ox = (Math.random() - 0.5) * shake;
  const oy = (Math.random() - 0.5) * shake;
  const transform = `translate(${camera.panX + ox}px, ${camera.panY + oy}px) scale(${camera.zoom})`;
  viewportEl.style.transform = transform;
  viewportEl.style.transformOrigin = 'center center';
}

export function triggerScreenShake(intensity = 4, duration = 0.25) {
  screenShake = { intensity, duration };
}

export function triggerHitStop(ms = 50) {
  hitStopMs = ms;
}

export function spawnFloatingDamage(x, y, text, color = '#ff8a8a') {
  floatingTexts.push({ x, y, text, color, life: 0.9, vy: -1.2 });
}

export function spawnCombatJuice(x, y, damage, killed = false, heavy = false) {
  const layout = getLayoutFn?.(baseCanvas);
  if (layout) {
    const screen = tileToScreen(layout, x, y);
    getParticleSystem().combatBurst(screen.x, screen.y, killed ? 'blood' : heavy ? 'spark' : 'dust', heavy ? 22 : 14);
    if (heavy || killed) getAmbientLifeSystem().burst(screen.x, screen.y, killed ? 'shrine' : 'blight', killed ? 18 : 10);
    const label = killed ? 'SLAIN' : heavy ? `-${damage}!` : `-${damage}`;
    const color = killed ? '#ff6b6b' : heavy ? '#ffd76b' : '#f0c866';
    spawnFloatingDamage(screen.x, screen.y - 12, label, color);
  }
  triggerScreenShake(killed ? 8 : heavy ? 5 : 3, killed ? 0.35 : heavy ? 0.24 : 0.18);
  if (killed || heavy) triggerHitStop(killed ? 60 : 35);
}

export function spawnDiscoveryPulse(x, y, tone = 'ally') {
  const layout = getLayoutFn?.(baseCanvas);
  if (!layout) return;
  const screen = tileToScreen(layout, x, y);
  getAmbientLifeSystem().burst(screen.x, screen.y, tone === 'dead' ? 'blight' : 'shrine', 24);
  getParticleSystem().buildingComplete(screen.x, screen.y);
  triggerScreenShake(4, 0.22);
}

export function spawnGloryMoment(x, y, title = 'Glory') {
  const layout = getLayoutFn?.(baseCanvas);
  if (!layout) return;
  const screen = tileToScreen(layout, x, y);
  getAmbientLifeSystem().burst(screen.x, screen.y, 'shrine', 32);
  getParticleSystem().combatBurst(screen.x, screen.y, 'blood', 28);
  spawnFloatingDamage(screen.x, screen.y - 24, title, '#ffe29a');
  triggerScreenShake(10, 0.45);
  triggerHitStop(80);
}

export function spawnTriumphMoment(x, y, title = 'Hold the Line') {
  spawnGloryMoment(x, y, title);
}

export function spawnMoveTrail(x, y) {
  const layout = getLayoutFn?.(baseCanvas);
  if (!layout) return;
  const screen = tileToScreen(layout, x, y);
  getParticleSystem().dustTrail(screen.x, screen.y);
}

export function spawnBuildComplete(x, y, buildingId) {
  const layout = getLayoutFn?.(baseCanvas);
  if (!layout) return;
  const screen = tileToScreen(layout, x, y);
  getParticleSystem().buildingComplete(screen.x, screen.y);
  buildingBounces.set(buildingId, { scale: 1.15, life: 0.35 });
}

function updateParticles(dt) {
  const particles = getParticleSystem();
  particles.update(dt);
  const g = overlayGraphics || new Graphics();
  if (!g.parent) app.stage.addChild(g);
  g.clear();
  particles.draw(g);
  drawFloatingTexts(dt);
}

function drawLighting(state, layout) {
  // Lighting drawn in updateParticles pass for single stage child batching.
}

function drawLightingGraphics(g, state, layout, particlesOnly = false) {
  if (!state || !layout || particlesOnly) return;
  const w = app.renderer.width;
  const h = app.renderer.height;
  const viewport = pixiViewport(layout, TILE_CULL_MARGIN, PIXEL_CULL_MARGIN);
  drawVignette(g, w, h);
  drawUnitShadows(g, state, layout, viewport);
  drawStructureGlow(g, state, layout, viewport);
  drawBlightGlow(g, state, layout, viewport);
}

function drawVignette(g, w, h) {
  for (let i = 0; i < 6; i += 1) {
    const t = i / 6;
    g.rect(0, 0, w, h);
    g.stroke({ width: 10 + t * 36, color: 0x2a1f14, alpha: t * t * 0.18 });
  }
}

function drawUnitShadows(g, state, layout, viewport) {
  for (const unit of state.units) {
    if (!isTileVisible(state, unit.x, unit.y) || !isInTileWindow(unit, viewport?.tile)) continue;
    const { x, y } = tileToScreen(layout, unit.x, unit.y);
    if (!isScreenPointInViewport({ x, y }, viewport?.pixel)) continue;
    const s = layout.tileSize * 0.22;
    g.ellipse(x, y + s * 0.6, s * 0.9, s * 0.35);
    g.fill({ color: 0x1a1208, alpha: 0.18 });
  }
}

function drawStructureGlow(g, state, layout, viewport) {
  for (const building of state.buildings) {
    if (!isTileVisible(state, building.x, building.y) || !isInTileWindow(building, viewport?.tile)) continue;
    const { x, y } = tileToScreen(layout, building.x, building.y);
    if (!isScreenPointInViewport({ x, y }, viewport?.pixel)) continue;
    const s = layout.tileSize * 0.35;
    if (building.type === 'shrine') {
      g.circle(x, y, s * 1.4);
      g.fill({ color: IMPERIAL_PALETTE.shrineGlow, alpha: 0.12 + Math.sin(performance.now() * 0.003) * 0.04 });
    }
    if (['portal', 'bonePit', 'graveForge', 'necropolis'].includes(building.type)) {
      g.circle(x, y, s * 1.6);
      g.fill({ color: IMPERIAL_PALETTE.deadGlow, alpha: 0.1 + Math.sin(performance.now() * 0.004 + building.x) * 0.05 });
    }
  }
}

let blightPulse = 0;

function drawBlightGlow(g, state, layout, viewport) {
  const pulse = 0.08 + Math.sin(blightPulse) * 0.04;
  forEachPixiWindowTile(state, viewport?.tile, (tile) => {
    if (tile.terrain !== 'blight' || !isTileVisible(state, tile.x, tile.y)) return;
    const pos = tileToScreen(layout, tile.x, tile.y);
    if (!isScreenPointInViewport(pos, viewport?.pixel)) return;
    const s = layout.tileSize * 0.4;
    g.circle(pos.x, pos.y, s * (1 + pulse));
    g.fill({ color: 0x76e969, alpha: pulse });
  });
}

function updateBlightPulse(dt) {
  blightPulse += dt * 2.5;
}

function updateFogReveal(state, dt, tileWindow) {
  forEachPixiWindowTile(state, tileWindow, (tile) => {
    const key = `${tile.x},${tile.y}`;
    const visible = isTileVisible(state, tile.x, tile.y);
    const current = fogRevealTiles.get(key) ?? (visible ? 1 : 0);
    if (visible && current < 1) fogRevealTiles.set(key, Math.min(1, current + dt / 0.4));
    else if (!visible) fogRevealTiles.delete(key);
  });

  for (const key of fogRevealTiles.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (!isInTileWindow({ x, y }, tileWindow) || !isTileVisible(state, x, y)) {
      fogRevealTiles.delete(key);
    }
  }
}

function drawFloatingTexts(dt) {
  for (let i = floatingTexts.length - 1; i >= 0; i -= 1) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    ft.y += ft.vy;
    if (ft.life <= 0) {
      recycleFloatingText(ft.label);
      floatingTexts.splice(i, 1);
      continue;
    }
    const label = ft.label || borrowFloatingText(ft.text, ft.color);
    ft.label = label;
    label.text = ft.text;
    label.style = { ...FLOATING_TEXT_STYLE, fill: ft.color };
    label.alpha = ft.life / 0.9;
    label.position.set(ft.x, ft.y);
    if (!label.parent) app.stage.addChild(label);
  }
}

function tileToScreen(layout, x, y) {
  const halfW = layout.halfTileWidth;
  const halfH = layout.halfTileHeight;
  return {
    x: layout.originX + (x - y) * halfW,
    y: layout.originY + (x + y) * halfH
  };
}

function isTileVisible(state, x, y) {
  const key = tileIndex(state, x, y);
  if (key < 0) return false;
  if (Array.isArray(state.visible)) return Boolean(state.visible[key]);
  return state.visibility?.[y]?.[x] >= 1;
}

function pixiViewport(layout, tileMargin = TILE_CULL_MARGIN, pixelMargin = PIXEL_CULL_MARGIN) {
  return {
    tile: pixiTileWindow(layout, tileMargin),
    pixel: pixiPixelWindow(layout, pixelMargin)
  };
}

function pixiTileWindow(layout, margin = TILE_CULL_MARGIN) {
  return {
    minX: Math.max(0, layout.camera.x - margin),
    maxX: layout.camera.x + layout.camera.width + margin - 1,
    minY: Math.max(0, layout.camera.y - margin),
    maxY: layout.camera.y + layout.camera.height + margin - 1
  };
}

function pixiPixelWindow(layout, margin = PIXEL_CULL_MARGIN) {
  return {
    minX: layout.frameX - margin,
    maxX: layout.frameX + layout.mapWidth + margin,
    minY: layout.frameY - margin,
    maxY: layout.frameY + layout.mapHeight + margin
  };
}

function isInTileWindow(point, tileWindow) {
  if (!tileWindow) return true;
  return point.x >= tileWindow.minX
    && point.x <= tileWindow.maxX
    && point.y >= tileWindow.minY
    && point.y <= tileWindow.maxY;
}

function isScreenPointInViewport(point, viewport) {
  if (!viewport) return true;
  return point.x >= viewport.minX
    && point.x <= viewport.maxX
    && point.y >= viewport.minY
    && point.y <= viewport.maxY;
}

function forEachPixiWindowTile(state, tileWindow, visitor) {
  const map = state?.map;
  if (!map) return;
  const width = map.width || map[0]?.length || 0;
  const height = map.height || map.length || 0;
  if (!width || !height) return;
  const window = tileWindow || { minX: 0, maxX: width - 1, minY: 0, maxY: height - 1 };
  for (let y = Math.max(0, window.minY); y <= Math.min(height - 1, window.maxY); y += 1) {
    for (let x = Math.max(0, window.minX); x <= Math.min(width - 1, window.maxX); x += 1) {
      const tile = map.tiles?.[y * width + x] || map[y]?.[x];
      if (tile) visitor(tile);
    }
  }
}

function tileIndex(state, x, y) {
  const width = state?.map?.width || state?.map?.[0]?.length || 0;
  const height = state?.map?.height || state?.map?.length || 0;
  if (x < 0 || y < 0 || x >= width || y >= height) return -1;
  return y * width + x;
}

function borrowFloatingText(text, color) {
  const label = floatingTextPool.pop() || new Text({ text, style: { ...FLOATING_TEXT_STYLE, fill: color } });
  label.text = text;
  label.style = { ...FLOATING_TEXT_STYLE, fill: color };
  return label;
}

function recycleFloatingText(label) {
  if (!label) return;
  label.removeFromParent();
  label.alpha = 1;
  floatingTextPool.push(label);
}

export function getAtlasTexture() {
  return atlasTexture;
}

export function getImperialPalette() {
  return { ...IMPERIAL_PALETTE };
}

export function getFogRevealAlpha(x, y) {
  return fogRevealTiles.get(`${x},${y}`) ?? 1;
}

export function destroyPixiRenderer() {
  if (app) {
    app.destroy(true);
    app = null;
  }
  overlayGraphics = null;
  floatingTexts = [];
  floatingTextPool.length = 0;
  fogRevealTiles = new Map();
  initPromise = null;
  initialized = false;
}
