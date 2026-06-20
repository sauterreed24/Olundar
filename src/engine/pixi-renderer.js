/**
 * PixiJS v8 rendering backbone: lighting, particles, and juice overlays.
 * Base terrain/units render via Canvas 2D (render.js); Pixi composites premium effects on top.
 */

import { Application, Assets, Graphics, Text, TextStyle } from 'pixi.js';
import { getCamera } from './camera.js';
import { getParticleSystem } from './particles.js';

const SPRITE_SHEET = './assets/sprites/olundar-sprite-sheet.svg';

const IMPERIAL_PALETTE = {
  parchment: 0xf6ead0,
  marble: 0xfff8ec,
  bronze: 0xb87333,
  crimson: 0x8b1e1e,
  lapis: 0x2d5f8f,
  jade: 0x3d8b6e,
  deadGlow: 0x9cf38a,
  shrineGlow: 0xf0c866,
  rallyGlow: 0xc45c48
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
let getLayoutFn = null;

export function isPixiReady() {
  return initialized && app !== null;
}

export async function initPixiRenderer(canvasElement, { getLayout } = {}) {
  if (initialized) return app;
  getLayoutFn = getLayout;
  baseCanvas = canvasElement;

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

  app.stage.removeChildren();
  const g = new Graphics();
  const layout = getLayoutFn?.(canvas);
  if (layout && state) {
    drawVignette(g, canvas.width, canvas.height);
    drawUnitShadows(g, state, layout);
    drawStructureGlow(g, state, layout);
    drawBlightGlow(g, state, layout);
  }
  const particles = getParticleSystem();
  particles.update(dt);
  particles.draw(g);
  app.stage.addChild(g);
  drawFloatingTexts(dt);
  updateFogReveal(state, dt);
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

export function spawnCombatJuice(x, y, damage, killed = false) {
  const layout = getLayoutFn?.(baseCanvas);
  if (layout) {
    const screen = tileToScreen(layout, x, y);
    getParticleSystem().combatBurst(screen.x, screen.y, killed ? 'blood' : 'dust');
    spawnFloatingDamage(screen.x, screen.y - 12, `-${damage}`, killed ? '#ff6b6b' : '#f0c866');
  }
  triggerScreenShake(killed ? 6 : 3, killed ? 0.3 : 0.18);
  if (killed) triggerHitStop(50);
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
  app.stage.removeChildren();
  const g = new Graphics();
  particles.draw(g);
  drawLightingGraphics(g, null, null, true);
  app.stage.addChild(g);
  drawFloatingTexts(dt);
}

function drawLighting(state, layout) {
  // Lighting drawn in updateParticles pass for single stage child batching.
}

function drawLightingGraphics(g, state, layout, particlesOnly = false) {
  if (!state || !layout || particlesOnly) return;
  const w = app.renderer.width;
  const h = app.renderer.height;
  drawVignette(g, w, h);
  drawUnitShadows(g, state, layout);
  drawStructureGlow(g, state, layout);
  drawBlightGlow(g, state, layout);
}

function drawVignette(g, w, h) {
  for (let i = 0; i < 6; i += 1) {
    const t = i / 6;
    g.rect(0, 0, w, h);
    g.stroke({ width: 10 + t * 36, color: 0x2a1f14, alpha: t * t * 0.18 });
  }
}

function drawUnitShadows(g, state, layout) {
  for (const unit of state.units) {
    if (!isTileVisible(state, unit.x, unit.y)) continue;
    const { x, y } = tileToScreen(layout, unit.x, unit.y);
    const s = layout.tileSize * 0.22;
    g.ellipse(x, y + s * 0.6, s * 0.9, s * 0.35);
    g.fill({ color: 0x1a1208, alpha: 0.18 });
  }
}

function drawStructureGlow(g, state, layout) {
  for (const building of state.buildings) {
    if (!isTileVisible(state, building.x, building.y)) continue;
    const { x, y } = tileToScreen(layout, building.x, building.y);
    const s = layout.tileSize * 0.35;
    if (building.type === 'shrine') {
      g.circle(x, y, s * 1.4);
      g.fill({ color: IMPERIAL_PALETTE.shrineGlow, alpha: 0.12 + Math.sin(performance.now() * 0.003) * 0.04 });
    }
    if (building.type === 'rallyBanner') {
      g.circle(x, y, s * 1.2);
      g.fill({ color: IMPERIAL_PALETTE.rallyGlow, alpha: 0.1 + Math.sin(performance.now() * 0.0035 + building.y) * 0.03 });
    }
    if (['portal', 'bonePit', 'graveForge', 'necropolis'].includes(building.type)) {
      g.circle(x, y, s * 1.6);
      g.fill({ color: IMPERIAL_PALETTE.deadGlow, alpha: 0.1 + Math.sin(performance.now() * 0.004 + building.x) * 0.05 });
    }
  }
}

let blightPulse = 0;

function drawBlightGlow(g, state, layout) {
  const pulse = 0.08 + Math.sin(blightPulse) * 0.04;
  for (let y = 0; y < state.map.length; y += 1) {
    for (let x = 0; x < state.map[y].length; x += 1) {
      const tile = state.map[y][x];
      if (tile.terrain !== 'blight' || !isTileVisible(state, x, y)) continue;
      const pos = tileToScreen(layout, x, y);
      const s = layout.tileSize * 0.4;
      g.circle(pos.x, pos.y, s * (1 + pulse));
      g.fill({ color: 0x76e969, alpha: pulse });
    }
  }
}

function updateBlightPulse(dt) {
  blightPulse += dt * 2.5;
}

function updateFogReveal(state, dt) {
  for (let y = 0; y < state.map.length; y += 1) {
    for (let x = 0; x < state.map[y].length; x += 1) {
      const key = `${x},${y}`;
      const visible = state.visibility?.[y]?.[x] === 2;
      const current = fogRevealTiles.get(key) ?? (visible ? 1 : 0);
      if (visible && current < 1) fogRevealTiles.set(key, Math.min(1, current + dt / 0.4));
      else if (!visible) fogRevealTiles.delete(key);
    }
  }
}

function drawFloatingTexts(dt) {
  const style = new TextStyle({ fontFamily: 'system-ui', fontSize: 14, fontWeight: '900', fill: '#ff8a8a' });
  for (let i = floatingTexts.length - 1; i >= 0; i -= 1) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    ft.y += ft.vy;
    if (ft.life <= 0) {
      floatingTexts.splice(i, 1);
      continue;
    }
    const label = new Text({ text: ft.text, style: { ...style, fill: ft.color } });
    label.alpha = ft.life / 0.9;
    label.position.set(ft.x, ft.y);
    app.stage.addChild(label);
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
  return state.visibility?.[y]?.[x] >= 1;
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
  initialized = false;
}
