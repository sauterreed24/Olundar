import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture
} from 'pixi.js';
import { createCamera } from './camera.js';
import { createParticleField } from './particles.js';

const IMPERIAL_PALETTE = {
  parchment: 0xfffffb,
  marble: 0xf5f8df,
  bronze: 0xc99552,
  crimson: 0x8b2f2a,
  lapis: 0x2d93aa,
  deadGlow: 0x9cf38a,
  shrineGlow: 0xf0c866
};

const SPRITE_SHEET = './assets/sprites/olundar-sprite-sheet.svg';

let sharedRenderer = null;

export function getPixiRenderer() {
  return sharedRenderer;
}

export async function createPixiRenderer(displayCanvas) {
  const renderer = new PixiRenderer(displayCanvas);
  await renderer.init();
  sharedRenderer = renderer;
  displayCanvas.__pixiRenderer = renderer;
  return renderer;
}

export class PixiRenderer {
  constructor(displayCanvas) {
    this.displayCanvas = displayCanvas;
    this.app = null;
    this.camera = createCamera();
    this.particles = createParticleField();
    this.offscreen = document.createElement('canvas');
    this.offscreenCtx = this.offscreen.getContext('2d');
    this.worldRoot = null;
    this.worldContainer = null;
    this.legacySprite = null;
    this.lightingLayer = null;
    this.particleLayer = null;
    this.vignetteLayer = null;
    this.effectsLayer = null;
    this.atlasTexture = null;
    this.fogReveal = new Map();
    this.floatingTexts = [];
    this.blightPulse = 0;
    this.hitStopUntil = 0;
    this._lastFrame = performance.now();
    this._tickerBound = (ticker) => this.onTick(ticker.deltaMS);
  }

  async init() {
    this.app = new Application();
    await this.app.init({
      canvas: this.displayCanvas,
      background: IMPERIAL_PALETTE.parchment,
      antialias: true,
      resolution: 1,
      autoDensity: true,
      preference: 'webgl'
    });

    try {
      this.atlasTexture = await Assets.load(SPRITE_SHEET);
    } catch {
      this.atlasTexture = null;
    }

    this.worldRoot = new Container();
    this.worldContainer = new Container();
    this.legacyTexture = Texture.from(this.offscreen);
    this.legacySprite = new Sprite(this.legacyTexture);
    this.lightingLayer = new Graphics();
    this.particleLayer = new Graphics();
    this.vignetteLayer = new Graphics();
    this.effectsLayer = new Graphics();

    this.worldContainer.addChild(this.legacySprite);
    this.worldContainer.addChild(this.lightingLayer);
    this.worldContainer.addChild(this.effectsLayer);
    this.worldRoot.addChild(this.worldContainer);
    this.worldRoot.addChild(this.particleLayer);
    this.app.stage.addChild(this.worldRoot);
    this.app.stage.addChild(this.vignetteLayer);

    this.camera.bindHost(this.displayCanvas);
    this.app.ticker.add(this._tickerBound);
  }

  get canvas() {
    return this.displayCanvas;
  }

  getDrawContext() {
    return this.offscreenCtx;
  }

  resize(width, height, dpr = 1) {
    const pixelWidth = Math.floor(width * dpr);
    const pixelHeight = Math.floor(height * dpr);
    this.app.renderer.resize(width, height);
    this.offscreen.width = pixelWidth;
    this.offscreen.height = pixelHeight;
    this.legacySprite.texture.source.resize(pixelWidth, pixelHeight);
    this.legacySprite.width = pixelWidth;
    this.legacySprite.height = pixelHeight;
    this.camera.setViewport(pixelWidth, pixelHeight);
    this.drawVignette(pixelWidth, pixelHeight);
  }

  setMapFrame(frameX, frameY, mapWidth, mapHeight) {
    this.camera.setMapFrame(frameX, frameY, mapWidth, mapHeight);
  }

  beginFrame(state) {
    if (performance.now() < this.hitStopUntil) return false;
    return true;
  }

  present(state, layout) {
    if (layout) {
      this.setMapFrame(layout.frameX, layout.frameY, layout.mapWidth, layout.mapHeight);
      this.camera.focusOn(layout.frameX + layout.mapWidth * 0.5, layout.frameY + layout.mapHeight * 0.5);
    }
    this.legacyTexture.source.update();
    this.drawLighting(state, layout);
    this.drawFloatingTexts();
    this.particles.draw(this.particleLayer);
    const shake = this.camera.shakeOffset();
    this.camera.applyToContainer(this.worldContainer);
    this.worldContainer.position.x += shake.x;
    this.worldContainer.position.y += shake.y;
    this.blightPulse += 0.04;
  }

  onTick(deltaMs) {
    this.camera.tick(deltaMs);
    this.particles.update(deltaMs);
    this.floatingTexts = this.floatingTexts.filter((entry) => {
      entry.life -= deltaMs;
      entry.y -= deltaMs * 0.03;
      return entry.life > 0;
    });
    if (this._pendingPresent) {
      this.present(this._pendingPresent.state, this._pendingPresent.layout);
      this._pendingPresent = null;
    }
  }

  queuePresent(state, layout) {
    this._pendingPresent = { state, layout };
  }

  drawLighting(state, layout) {
    if (!layout || !state) return;
    const g = this.lightingLayer;
    g.clear();

    for (const unit of state.units) {
      if (!unit || unit.hp <= 0) continue;
      const center = this.tileCenter(layout, unit.x, unit.y);
      if (!center) continue;
      g.ellipse(center.x, center.y + layout.tileSize * 0.12, layout.tileSize * 0.22, layout.tileSize * 0.08);
      g.fill({ color: 0x000000, alpha: 0.18 });
    }

    for (const building of state.buildings) {
      const center = this.tileCenter(layout, building.x, building.y);
      if (!center) continue;
      if (building.type === 'portal' || building.type === 'bonePit' || building.type === 'graveForge' || building.type === 'necropolis') {
        const pulse = 0.22 + Math.sin(this.blightPulse) * 0.08;
        g.circle(center.x, center.y, layout.tileSize * (0.34 + pulse * 0.1));
        g.fill({ color: IMPERIAL_PALETTE.deadGlow, alpha: pulse });
      }
      if (building.type === 'shrine') {
        const pulse = 0.16 + Math.sin(this.blightPulse * 1.4) * 0.05;
        g.circle(center.x, center.y, layout.tileSize * 0.28);
        g.fill({ color: IMPERIAL_PALETTE.shrineGlow, alpha: pulse });
      }
    }

    if (layout.mapWidth && layout.mapHeight) {
      const rim = layout.tileSize * 0.5;
      g.rect(layout.frameX - rim, layout.frameY - rim, layout.mapWidth + rim * 2, layout.mapHeight + rim * 2);
      g.stroke({ color: IMPERIAL_PALETTE.bronze, width: 2, alpha: 0.12 });
    }
  }

  drawVignette(width, height) {
    const g = this.vignetteLayer;
    g.clear();
    const cx = width * 0.5;
    const cy = height * 0.5;
    const radius = Math.max(width, height) * 0.62;
    g.circle(cx, cy, radius);
    g.fill({ color: 0x17331f, alpha: 0.08 });
    g.rect(0, 0, width, height);
    g.stroke({ color: IMPERIAL_PALETTE.lapis, width: 3, alpha: 0.05 });
  }

  tileCenter(layout, x, y) {
    if (!layout?.originX) return null;
    const halfW = layout.halfTileWidth || layout.tileSize * 0.5;
    const halfH = layout.halfTileHeight || layout.tileSize * 0.33;
    return {
      x: layout.originX + (x - y) * halfW,
      y: layout.originY + (x + y) * halfH
    };
  }

  revealFogTile(key) {
    const current = this.fogReveal.get(key) ?? 0;
    if (current >= 1) return;
    this.fogReveal.set(key, Math.min(1, current + 0.08));
  }

  fogAlpha(key) {
    return this.fogReveal.get(key) ?? 0;
  }

  spawnFloatingDamage(x, y, text, color = '#ff8a8a') {
    this.floatingTexts.push({ x, y, text, color, life: 900, maxLife: 900 });
  }

  drawFloatingTexts() {
    const g = this.effectsLayer;
    g.clear();
    for (const entry of this.floatingTexts) {
      const alpha = entry.life / entry.maxLife;
      g.roundRect(entry.x - 18, entry.y - 10, 36, 18, 6);
      g.fill({ color: 0x05070a, alpha: alpha * 0.72 });
      g.stroke({ color: 0xf0c866, width: 1, alpha: alpha * 0.8 });
    }
  }

  screenShake(intensity = 6, durationMs = 180) {
    this.camera.screenShake(intensity, durationMs);
  }

  hitStop(ms = 50) {
    this.hitStopUntil = performance.now() + ms;
  }

  combatBurst(layout, x, y, lethal = false) {
    const center = this.tileCenter(layout, x, y);
    if (!center) return;
    this.particles.combatImpact(center.x, center.y, lethal);
    if (lethal) this.hitStop(50);
  }

  movementTrail(layout, x, y) {
    const center = this.tileCenter(layout, x, y);
    if (!center) return;
    this.particles.dustTrail(center.x, center.y);
  }

  buildCompleteBurst(layout, x, y) {
    const center = this.tileCenter(layout, x, y);
    if (!center) return;
    this.particles.buildSparks(center.x, center.y);
  }

  getAtlasTexture() {
    return this.atlasTexture;
  }

  destroy() {
    this.app?.ticker.remove(this._tickerBound);
    this.app?.destroy(true);
    sharedRenderer = null;
  }
}

export { IMPERIAL_PALETTE };
