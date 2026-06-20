import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture
} from 'pixi.js';
import { acquireCanvas2D, getOffscreenCanvas } from './canvas-bridge.js';
import { ViewportCamera } from './camera.js';
import { ParticleSystem } from './particles.js';

const IMPERIAL_PALETTE = {
  parchment: 0xfff8e8,
  bronze: 0xb87333,
  crimson: 0x8b1f1f,
  lapis: 0x1f5f8b,
  deadGlow: 0x9cf38a,
  shrineGlow: 0xf0c866
};

const registry = new WeakMap();

export function getPixiRenderer(canvas) {
  let renderer = registry.get(canvas);
  if (!renderer) {
    renderer = new PixiRenderer(canvas);
    registry.set(canvas, renderer);
  }
  return renderer;
}

export class PixiRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.app = null;
    this.ready = false;
    this.initPromise = null;
    this.camera = new ViewportCamera();
    this.particles = new ParticleSystem();
    this.drawCanvasFn = null;
    this.spriteSheet = null;
    this.world = null;
    this.mapSprite = null;
    this.lighting = null;
    this.vignette = null;
    this.particleLayer = null;
    this.effects = null;
    this.fogReveal = new Map();
    this.blightPulse = 0;
    this.shake = { x: 0, y: 0, intensity: 0, until: 0 };
    this.flashUntil = 0;
    this.hitStopUntil = 0;
    this.floatingTexts = [];
    this.moveTweens = [];
    this.lastFrame = performance.now();
    this.reducedMotion = false;
    canvas.__pixiRenderer = this;
  }

  async ensureReady() {
    if (this.ready) return;
    if (!this.initPromise) this.initPromise = this.init();
    await this.initPromise;
  }

  async init() {
    this.app = new Application();
    await this.app.init({
      canvas: this.canvas,
      background: IMPERIAL_PALETTE.parchment,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: null
    });

    try {
      this.spriteSheet = await Assets.load('./assets/sprites/olundar-sprite-sheet.svg');
    } catch {
      this.spriteSheet = null;
    }

    this.world = new Container();
    this.mapSprite = new Sprite(Texture.EMPTY);
    this.mapSprite.anchor.set(0, 0);
    this.lighting = new Graphics();
    this.vignette = new Graphics();
    this.particleLayer = new Graphics();
    this.effects = new Container();

    this.app.stage.addChild(this.world);
    this.world.addChild(this.mapSprite);
    this.world.addChild(this.lighting);
    this.world.addChild(this.particleLayer);
    this.app.stage.addChild(this.vignette);
    this.app.stage.addChild(this.effects);

    this.camera.setBounds(this.canvas.width, this.canvas.height);
    this.bindInput();
    this.app.ticker.add(() => this.tick());
    this.ready = true;
  }

  bindInput() {
    const onWheel = (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.camera.onWheel(
        event.deltaY,
        event.clientX - rect.left,
        event.clientY - rect.top,
        this.canvas.clientWidth,
        this.canvas.clientHeight
      );
    };
    const onMove = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.camera.onPointerMove(event.clientX, event.clientY, rect);
    };
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('pointerenter', () => { this.camera.pointerInside = true; });
    this.canvas.addEventListener('pointerleave', () => { this.camera.pointerInside = false; });
    this.canvas.addEventListener('pointermove', onMove);
  }

  setDrawCanvasFn(fn) {
    this.drawCanvasFn = fn;
  }

  setReducedMotion(reduced) {
    this.reducedMotion = Boolean(reduced);
  }

  resize(width, height, dpr = 1) {
    if (!this.app) return;
    this.app.renderer.resize(width, height);
    this.camera.setBounds(width, height);
  }

  async render(state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay) {
    await this.ensureReady();
    const now = performance.now();
    if (this.hitStopUntil > now) return;

    const offscreen = getOffscreenCanvas(this.canvas.width, this.canvas.height, this.canvas);
    const ctx = acquireCanvas2D(offscreen);
    if (!ctx || !this.drawCanvasFn) return;

    this.canvas.__olundarState = state;
    this.drawCanvasFn(ctx, offscreen, state, hoverTile, lensId, routeOverlay, missionFocusOverlay, battleImpact, openingOrderOverlay, diplomacyOverlay);

    const source = offscreen;
    if (this.mapSprite.texture?.source?.resource !== source) {
      if (this.mapSprite.texture && this.mapSprite.texture !== Texture.EMPTY) {
        this.mapSprite.texture.destroy(true);
      }
      this.mapSprite.texture = Texture.from(source);
    } else {
      this.mapSprite.texture.source.update();
    }
    this.mapSprite.width = this.canvas.width;
    this.mapSprite.height = this.canvas.height;

    this.updateFogReveal(state);
    this.drawLighting(state);
    this.drawVignette();
    this.particles.draw(this.particleLayer);
    this.drawFloatingTexts(now);
    this.applyShake(now);
    this.camera.applyToContainer(this.world, this.canvas.width, this.canvas.height);

    if (this.flashUntil > now) {
      this.effects.removeChildren();
      const flash = new Graphics();
      flash.rect(0, 0, this.canvas.width, this.canvas.height);
      flash.fill({ color: 0xffffff, alpha: 0.22 });
      this.effects.addChild(flash);
    }
  }

  updateFogReveal(state) {
    if (!state?.map?.tiles) return;
    for (const tile of state.map.tiles) {
      const key = `${tile.x},${tile.y}`;
      const revealed = state.revealed?.[tile.y * state.map.width + tile.x];
      const target = revealed ? 1 : 0;
      const current = this.fogReveal.get(key) ?? target;
      const next = this.reducedMotion ? target : current + (target - current) * 0.12;
      this.fogReveal.set(key, Math.abs(target - next) < 0.01 ? target : next);
    }
  }

  drawLighting(state) {
    this.lighting.clear();
    this.blightPulse += 0.04;
    if (!state) return;

    for (const unit of state.units || []) {
      const layout = this.canvas.__olundarLayout;
      if (!layout) continue;
      const pos = tileCenter(layout, unit.x, unit.y);
      this.lighting.circle(pos.x, pos.y + layout.tileSize * 0.08, layout.tileSize * 0.22);
      this.lighting.fill({ color: 0x000000, alpha: 0.16 });
    }

    for (const building of state.buildings || []) {
      const layout = this.canvas.__olundarLayout;
      if (!layout) continue;
      const pos = tileCenter(layout, building.x, building.y);
      if (building.type === 'shrine') {
        const glow = 0.18 + Math.sin(this.blightPulse) * 0.04;
        this.lighting.circle(pos.x, pos.y, layout.tileSize * 0.42);
        this.lighting.fill({ color: IMPERIAL_PALETTE.shrineGlow, alpha: glow });
      }
      if (['portal', 'bonePit', 'graveForge', 'necropolis'].includes(building.type)) {
        const glow = 0.22 + Math.sin(this.blightPulse * 1.4) * 0.06;
        this.lighting.circle(pos.x, pos.y, layout.tileSize * 0.48);
        this.lighting.fill({ color: IMPERIAL_PALETTE.deadGlow, alpha: glow });
      }
    }

    for (const tile of state.map?.tiles || []) {
      if (tile.terrain !== 'blight') continue;
      const layout = this.canvas.__olundarLayout;
      if (!layout) continue;
      const pos = tileCenter(layout, tile.x, tile.y);
      const pulse = 0.12 + Math.sin(this.blightPulse + tile.x * 0.3 + tile.y * 0.2) * 0.06;
      this.lighting.circle(pos.x, pos.y, layout.tileSize * 0.36);
      this.lighting.fill({ color: 0x675b86, alpha: pulse });
    }
  }

  drawVignette() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.vignette.clear();
    const steps = 8;
    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      const alpha = t * 0.09;
      const inset = t * Math.min(w, h) * 0.12;
      this.vignette.rect(inset, inset, w - inset * 2, h - inset * 2);
      this.vignette.stroke({ color: 0x2a1a0e, alpha, width: 2 });
    }
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.camera.tick(dt * 60);
    this.particles.tick(dt);
    this.updateMoveTweens(now);
    this.shake.intensity *= 0.88;
    if (this.shake.until < now) {
      this.shake.x = 0;
      this.shake.y = 0;
    }
    this.world.position.x += this.shake.x;
    this.world.position.y += this.shake.y;
  }

  triggerShake(intensity = 6, durationMs = 180) {
    if (this.reducedMotion) return;
    this.shake.intensity = intensity;
    this.shake.until = performance.now() + durationMs;
  }

  triggerFlash(durationMs = 60) {
    if (this.reducedMotion) return;
    this.flashUntil = performance.now() + durationMs;
  }

  triggerHitStop(durationMs = 50) {
    if (this.reducedMotion) return;
    this.hitStopUntil = performance.now() + durationMs;
  }

  spawnDamageNumber(x, y, value, lethal = false) {
    if (this.reducedMotion) return;
    this.floatingTexts.push({
      x,
      y,
      text: lethal ? `-${value}!` : `-${value}`,
      life: 0.9,
      vy: -1.2,
      color: lethal ? '#8b1f1f' : '#3b2817'
    });
  }

  drawFloatingTexts(now) {
    this.effects.removeChildren();
    for (let i = this.floatingTexts.length - 1; i >= 0; i -= 1) {
      const item = this.floatingTexts[i];
      item.life -= 1 / 60;
      item.y += item.vy;
      if (item.life <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      const label = new Text({
        text: item.text,
        style: new TextStyle({
          fill: item.color,
          fontSize: 16,
          fontWeight: '900',
          dropShadow: { color: '#fff8e8', blur: 2, distance: 1 }
        })
      });
      label.alpha = Math.min(1, item.life * 1.4);
      label.position.set(item.x, item.y);
      this.effects.addChild(label);
    }
  }

  applyShake(now) {
    if (this.shake.until < now) return;
    this.shake.x = (Math.random() - 0.5) * this.shake.intensity;
    this.shake.y = (Math.random() - 0.5) * this.shake.intensity;
  }

  animateUnitMove(unitId, path, layout, onComplete) {
    if (!path?.length || this.reducedMotion) {
      onComplete?.();
      return;
    }
    const duration = 300;
    const start = performance.now();
    this.moveTweens.push({ unitId, path, layout, start, duration, onComplete });
  }

  updateMoveTweens(now) {
    for (let i = this.moveTweens.length - 1; i >= 0; i -= 1) {
      const tween = this.moveTweens[i];
      const t = Math.min(1, (now - tween.start) / tween.duration);
      const eased = 1 - (1 - t) ** 3;
      const index = Math.min(tween.path.length - 1, Math.floor(eased * tween.path.length));
      const pos = tileCenter(tween.layout, tween.path[index].x, tween.path[index].y);
      this.particles.dustTrail(pos.x, pos.y);
      if (t >= 1) {
        tween.onComplete?.();
        this.moveTweens.splice(i, 1);
      }
    }
  }

  onBuildComplete(x, y, layout) {
    const pos = tileCenter(layout, x, y);
    this.particles.hammerSpark(pos.x, pos.y);
  }

  onCombatImpact(x, y, layout, damage, lethal) {
    const pos = tileCenter(layout, x, y);
    this.particles.combatBurst(pos.x, pos.y, lethal);
    this.triggerShake(lethal ? 9 : 5, lethal ? 220 : 140);
    this.triggerFlash(lethal ? 80 : 50);
    if (lethal) this.triggerHitStop(50);
    this.spawnDamageNumber(pos.x, pos.y - 12, damage, lethal);
  }
}

function tileCenter(layout, x, y) {
  const halfW = layout.halfTileWidth || layout.tileSize * 0.5;
  const halfH = layout.halfTileHeight || (layout.tileSize * 0.66) * 0.5;
  const cx = layout.originX + (x - y) * halfW;
  const cy = layout.originY + (x + y) * halfH;
  return { x: cx, y: cy };
}

export { IMPERIAL_PALETTE };
