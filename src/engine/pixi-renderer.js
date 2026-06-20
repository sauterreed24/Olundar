/**
 * PixiJS v8 rendering backbone: imperial war-table scene, camera, lighting, particles.
 */

import { Application, Assets, Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import {
  applyWheelInertia,
  createCamera,
  getCameraTransform,
  handleCameraPointerLeave,
  handleCameraPointerMove,
  handleCameraWheel,
  resetCamera,
  setCameraViewport,
  tickCamera,
  updateCameraBounds
} from './camera.js';
import {
  createParticleSystem,
  drawParticles,
  getFloatingTexts,
  tickParticles
} from './particles.js';

const IMPERIAL_PALETTE = {
  parchment: 0xfff8e8,
  bronze: 0xc9893a,
  crimson: 0x8b1e14,
  lapis: 0x2d5f8f,
  vignette: 0x2a1f12
};

const rendererState = {
  app: null,
  hostCanvas: null,
  sceneCanvas: null,
  sceneTexture: null,
  sceneSprite: null,
  worldRoot: null,
  lightingLayer: null,
  particleLayer: null,
  particleGraphics: null,
  fxRoot: null,
  camera: createCamera(),
  particles: createParticleSystem(),
  fogAlpha: new Map(),
  blightPulse: 0,
  screenShake: 0,
  screenShakeIntensity: 0,
  hitStopUntil: 0,
  movementTweens: [],
  buildingBounces: new Map(),
  initialized: false,
  tickerBound: false,
  spriteSheet: null,
  lastFrameArgs: null
};

export function initPixiRenderer(hostCanvas) {
  if (rendererState.initialized && rendererState.hostCanvas === hostCanvas) return rendererState.app;
  rendererState.hostCanvas = hostCanvas;
  return ensureApplication(hostCanvas);
}

export async function ensureApplication(hostCanvas) {
  if (rendererState.app && rendererState.initialized) return rendererState.app;

  const app = new Application();
  await app.init({
    canvas: hostCanvas,
    width: hostCanvas.width || 1280,
    height: hostCanvas.height || 860,
    backgroundAlpha: 0,
    antialias: true,
    resolution: 1,
    autoDensity: false
  });

  rendererState.app = app;
  rendererState.worldRoot = new Container();
  rendererState.fxRoot = new Container();
  rendererState.lightingLayer = new Graphics();
  rendererState.particleGraphics = new Graphics();
  rendererState.particleLayer = new Container();
  rendererState.particleLayer.addChild(rendererState.particleGraphics);

  rendererState.sceneCanvas = document.createElement('canvas');
  rendererState.sceneTexture = Texture.from(rendererState.sceneCanvas);
  rendererState.sceneSprite = new Sprite(rendererState.sceneTexture);
  rendererState.sceneSprite.anchor.set(0, 0);

  rendererState.worldRoot.addChild(rendererState.sceneSprite);
  rendererState.worldRoot.addChild(rendererState.particleLayer);
  app.stage.addChild(rendererState.worldRoot);
  app.stage.addChild(rendererState.fxRoot);
  app.stage.addChild(rendererState.lightingLayer);

  try {
    rendererState.spriteSheet = await Assets.load('./assets/sprites/olundar-sprite-sheet.svg');
  } catch {
    rendererState.spriteSheet = null;
  }

  bindCameraEvents(hostCanvas);
  bindTicker(app);
  rendererState.initialized = true;
  return app;
}

export function resizePixiRenderer(width, height, mapWidth = 0, mapHeight = 0) {
  const app = rendererState.app;
  if (!app) return;
  app.renderer.resize(width, height);
  rendererState.sceneCanvas.width = width;
  rendererState.sceneCanvas.height = height;
  rendererState.sceneTexture.source.resize(width, height);
  rendererState.sceneSprite.width = width;
  rendererState.sceneSprite.height = height;
  setCameraViewport(rendererState.camera, width, height);
  updateCameraBounds(rendererState.camera, mapWidth, mapHeight);
}

export function drawGameWithPixi(hostCanvas, state, drawScene, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay) {
  const appPromise = ensureApplication(hostCanvas);
  rendererState.lastFrameArgs = { state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay, drawScene };

  if (rendererState.initialized) {
    paintFrame(hostCanvas, drawScene, state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay);
  } else {
    appPromise.then(() => {
      if (rendererState.lastFrameArgs?.state === state) {
        const args = rendererState.lastFrameArgs;
        paintFrame(hostCanvas, drawScene, args.state, args.hoverTile, args.lensId, args.routeOverlay, args.missionFocusOverlay, args.battleImpact, args.openingOrderOverlay, args.diplomacyOverlay);
      }
    });
  }
}

function paintFrame(hostCanvas, drawScene, state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay) {
  const width = hostCanvas.width;
  const height = hostCanvas.height;
  resizePixiRenderer(width, height, width, height);

  const sceneCanvas = rendererState.sceneCanvas;
  sceneCanvas.width = width;
  sceneCanvas.height = height;
  hostCanvas.__olundarState = state;
  sceneCanvas.__olundarState = state;

  const ctx = sceneCanvas.getContext('2d');
  drawScene(ctx, sceneCanvas, state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay);
  applyFogRevealAnimation(state);
  applyBlightPulse(state);

  rendererState.sceneTexture.source.update();
  applyCameraToWorld();
  drawLightingPass(state, width, height);
  drawFloatingDamageTexts();
  applyScreenShake();
}

function applyCameraToWorld() {
  const transform = getCameraTransform(rendererState.camera);
  const shakeX = rendererState.screenShake > 0 ? (Math.random() - 0.5) * rendererState.screenShakeIntensity : 0;
  const shakeY = rendererState.screenShake > 0 ? (Math.random() - 0.5) * rendererState.screenShakeIntensity : 0;
  rendererState.worldRoot.position.set(transform.x + shakeX, transform.y + shakeY);
  rendererState.worldRoot.scale.set(transform.scale);
  rendererState.worldRoot.pivot.set(rendererState.camera.viewportW * 0.5, rendererState.camera.viewportH * 0.5);
}

function drawLightingPass(state, width, height) {
  const g = rendererState.lightingLayer;
  g.clear();

  const edge = Math.max(48, Math.min(width, height) * 0.08);
  g.rect(0, 0, width, height);
  g.fill({ color: IMPERIAL_PALETTE.vignette, alpha: 0.08 });

  for (const building of state.buildings) {
    if (building.type === 'shrine' && isTileLit(state, building.x, building.y)) {
      const center = tileScreenCenter(building.x, building.y, width, height);
      drawRadialGlow(g, center.x, center.y, 72, 0xf0c866, 0.16);
    }
    if (['portal', 'bonePit', 'graveForge', 'necropolis'].includes(building.type) && isTileLit(state, building.x, building.y)) {
      const center = tileScreenCenter(building.x, building.y, width, height);
      drawRadialGlow(g, center.x, center.y, 88, 0x9cf38a, 0.2);
    }
  }

  for (const unit of state.units) {
    if (!isTileLit(state, unit.x, unit.y)) continue;
    const center = tileScreenCenter(unit.x, unit.y, width, height);
    g.ellipse(center.x, center.y + 8, 12, 5);
    g.fill({ color: 0x000000, alpha: 0.18 });
  }

  g.rect(0, 0, width, edge);
  g.fill({ color: IMPERIAL_PALETTE.vignette, alpha: 0.12 });
  g.rect(0, height - edge, width, edge);
  g.fill({ color: IMPERIAL_PALETTE.vignette, alpha: 0.12 });
  g.rect(0, 0, edge, height);
  g.fill({ color: IMPERIAL_PALETTE.vignette, alpha: 0.1 });
  g.rect(width - edge, 0, edge, height);
  g.fill({ color: IMPERIAL_PALETTE.vignette, alpha: 0.1 });
}

function drawRadialGlow(g, x, y, radius, color, alpha) {
  const steps = 5;
  for (let i = steps; i >= 1; i -= 1) {
    const r = radius * (i / steps);
    const a = alpha * (1 - i / (steps + 1));
    g.circle(x, y, r);
    g.fill({ color, alpha: a });
  }
}

function drawFloatingDamageTexts() {
  const texts = getFloatingTexts(rendererState.particles);
  const g = rendererState.particleGraphics;
  drawParticles(g, rendererState.particles, {
    x: rendererState.worldRoot.position.x,
    y: rendererState.worldRoot.position.y,
    scale: rendererState.worldRoot.scale.x,
    originX: rendererState.camera.viewportW * 0.5,
    originY: rendererState.camera.viewportH * 0.5
  });
  for (const textParticle of texts) {
    // Pixi text labels rendered via canvas overlay on host for crisp typography.
    const host = rendererState.hostCanvas;
    if (!host.__damageOverlay) {
      host.__damageOverlay = document.createElement('canvas');
      host.__damageOverlay.className = 'damage-overlay';
      host.__damageOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;width:100%;height:100%;';
      host.parentElement?.appendChild(host.__damageOverlay);
    }
    const overlay = host.__damageOverlay;
    overlay.width = host.width;
    overlay.height = host.height;
    overlay.style.width = `${host.clientWidth}px`;
    overlay.style.height = `${host.clientHeight}px`;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    for (const particle of texts) {
      const rise = (particle.maxLife - particle.life) * 24;
      ctx.globalAlpha = particle.alpha;
      ctx.fillStyle = particle.color;
      ctx.font = '900 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(particle.text, particle.x, particle.y - rise);
    }
  }
}

function applyFogRevealAnimation(state) {
  for (let i = 0; i < state.revealed.length; i += 1) {
    if (!state.revealed[i]) continue;
    const key = String(i);
    const current = rendererState.fogAlpha.get(key) ?? 0;
    if (current < 1) rendererState.fogAlpha.set(key, Math.min(1, current + 0.08));
  }
}

function applyBlightPulse(state) {
  rendererState.blightPulse += 0.04;
  const pulse = 0.5 + Math.sin(rendererState.blightPulse) * 0.22;
  for (const tile of state.map.tiles) {
    if (tile.terrain !== 'blight') continue;
    tile.__blightGlow = pulse;
  }
}

function applyScreenShake() {
  if (rendererState.screenShake > 0) {
    rendererState.screenShake -= 1;
  }
  if (rendererState.hitStopUntil > performance.now()) {
    rendererState.worldRoot.alpha = 0.92;
  } else {
    rendererState.worldRoot.alpha = 1;
  }
}

function bindTicker(app) {
  if (rendererState.tickerBound) return;
  rendererState.tickerBound = true;
  app.ticker.add(() => {
    const delta = Ticker.shared.deltaMS;
    tickCamera(rendererState.camera, delta);
    tickParticles(rendererState.particles, delta);
    tickMovementTweens(delta);
    tickBuildingBounces(delta);
    applyCameraToWorld();
    if (rendererState.lastFrameArgs?.state) {
      drawLightingPass(rendererState.lastFrameArgs.state, rendererState.camera.viewportW, rendererState.camera.viewportH);
    }
    drawFloatingDamageTexts();
    applyScreenShake();
  });
}

function bindCameraEvents(hostCanvas) {
  hostCanvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = hostCanvas.getBoundingClientRect();
    handleCameraWheel(rendererState.camera, event.deltaY, event.clientX, event.clientY, rect);
    applyWheelInertia(rendererState.camera, event.deltaY);
  }, { passive: false });

  hostCanvas.addEventListener('mousemove', (event) => {
    const rect = hostCanvas.getBoundingClientRect();
    handleCameraPointerMove(rendererState.camera, event.clientX, event.clientY, rect);
  });

  hostCanvas.addEventListener('mouseleave', () => handleCameraPointerLeave(rendererState.camera));
}

export function triggerScreenShake(intensity = 6, duration = 8) {
  rendererState.screenShake = duration;
  rendererState.screenShakeIntensity = intensity;
}

export function triggerHitStop(ms = 50) {
  rendererState.hitStopUntil = performance.now() + ms;
}

export function spawnMovementTrail(x, y) {
  import('./particles.js').then(({ spawnDustTrail }) => spawnDustTrail(rendererState.particles, x, y));
}

export function spawnCombatImpact(x, y, killed = false, damage = 0) {
  import('./particles.js').then(({ spawnCombatBurst, spawnFloatingDamage }) => {
    spawnCombatBurst(rendererState.particles, x, y, killed ? 'blood' : 'dust');
    if (damage > 0) spawnFloatingDamage(rendererState.particles, x, y - 12, `-${damage}`);
    if (killed) triggerHitStop(50);
  });
}

export function spawnConstructionComplete(x, y) {
  import('./particles.js').then(({ spawnHammerSparks }) => {
    spawnHammerSparks(rendererState.particles, x, y);
    rendererState.buildingBounces.set(`${x},${y}`, { scale: 1.18, life: 220 });
  });
}

export function tweenUnitMove(unitId, path, layout, onComplete) {
  if (!path?.length) return;
  rendererState.movementTweens.push({
    unitId,
    path,
    progress: 0,
    duration: 300,
    layout,
    onComplete
  });
}

function tickMovementTweens(deltaMs) {
  const next = [];
  for (const tween of rendererState.movementTweens) {
    tween.progress += deltaMs;
    const t = Math.min(1, tween.progress / tween.duration);
    const eased = 1 - (1 - t) ** 3;
    if (t < 1) {
      next.push(tween);
      const index = Math.floor(eased * (tween.path.length - 1));
      const point = tween.path[Math.min(index, tween.path.length - 1)];
      if (point) spawnMovementTrail(point.x * 24 + 40, point.y * 16 + 40);
    } else if (tween.onComplete) {
      tween.onComplete();
    }
  }
  rendererState.movementTweens = next;
}

function tickBuildingBounces(deltaMs) {
  for (const [key, bounce] of rendererState.buildingBounces.entries()) {
    bounce.life -= deltaMs;
    bounce.scale = 1 + (bounce.life / 220) * 0.12;
    if (bounce.life <= 0) rendererState.buildingBounces.delete(key);
  }
}

export function getFogRevealAlpha(tileIndex) {
  return rendererState.fogAlpha.get(String(tileIndex)) ?? 1;
}

export function resetRendererFx() {
  resetCamera(rendererState.camera);
  rendererState.particles.particles = [];
  rendererState.fogAlpha.clear();
  rendererState.movementTweens = [];
  rendererState.buildingBounces.clear();
  rendererState.screenShake = 0;
}

export function getPixiRendererState() {
  return rendererState;
}

function isTileLit(state, x, y) {
  const index = x + y * state.map.width;
  return state.visible[index] || state.revealed[index];
}

function tileScreenCenter(x, y, width, height) {
  return {
    x: width * 0.5 + (x - y) * 12,
    y: height * 0.35 + (x + y) * 8
  };
}

export function isCanvas2dAllowedPath(filePath) {
  return filePath.includes('src/engine/pixi-renderer.js');
}
