/**
 * Ambient life particles — fireflies, river sparkles, shrine motes, blight wisps.
 * Spawns gentle environmental motion on visible map tiles for sensory appeal.
 */

const MAX_AMBIENT = 48;
const SPAWN_INTERVAL = 0.18;

export class AmbientLifeSystem {
  constructor() {
    this.motes = [];
    this.spawnTimer = 0;
    this.time = 0;
  }

  update(dt, state, layout, tileToScreen, isTileVisibleFn, tileWindow) {
    if (!state || !layout) return;
    this.time += dt;
    this.spawnTimer -= dt;

    let writeIndex = 0;
    for (let i = 0; i < this.motes.length; i += 1) {
      const m = this.motes[i];
      m.life -= dt;
      m.phase += dt * m.speed;
      m.x += Math.sin(m.phase) * m.drift;
      m.y += Math.cos(m.phase * 0.7) * m.drift * 0.6;
      if (m.life <= 0) continue;
      this.motes[writeIndex] = m;
      writeIndex += 1;
    }
    this.motes.length = writeIndex;

    if (this.spawnTimer > 0 || this.motes.length >= MAX_AMBIENT) return;
    this.spawnTimer = SPAWN_INTERVAL;

    const candidates = collectAmbientTiles(state, tileWindow, isTileVisibleFn);
    if (!candidates.length) return;
    const tile = candidates[Math.floor(Math.random() * candidates.length)];
    const screen = tileToScreen(layout, tile.x, tile.y);
    const kind = tile.ambientKind;
    const spec = AMBIENT_KINDS[kind] || AMBIENT_KINDS.plains;
    this.motes.push({
      x: screen.x + (Math.random() - 0.5) * layout.tileSize * 0.5,
      y: screen.y + (Math.random() - 0.5) * layout.tileSize * 0.25,
      life: spec.life + Math.random() * 0.4,
      maxLife: spec.life,
      size: spec.size + Math.random() * spec.sizeJitter,
      color: spec.color,
      alpha: spec.alpha,
      phase: Math.random() * Math.PI * 2,
      speed: spec.speed,
      drift: spec.drift,
      kind
    });
  }

  draw(graphics, viewport) {
    if (!graphics || !this.motes.length) return;
    for (const m of this.motes) {
      if (viewport && !inViewport(m, viewport)) continue;
      const t = m.life / m.maxLife;
      const pulse = 0.55 + Math.sin(this.time * 4 + m.phase) * 0.45;
      const alpha = m.alpha * t * pulse;
      if (m.kind === 'firefly') {
        graphics.circle(m.x, m.y, m.size * (0.6 + pulse * 0.5));
        graphics.fill({ color: m.color, alpha: alpha * 0.35 });
        graphics.circle(m.x, m.y, m.size * 0.35);
        graphics.fill({ color: '#ffffcc', alpha });
      } else if (m.kind === 'river') {
        graphics.circle(m.x, m.y, m.size);
        graphics.fill({ color: m.color, alpha });
      } else if (m.kind === 'shrine') {
        graphics.circle(m.x, m.y - 4, m.size * pulse);
        graphics.fill({ color: m.color, alpha });
      } else if (m.kind === 'blight') {
        graphics.circle(m.x, m.y - 6 * (1 - t), m.size);
        graphics.fill({ color: m.color, alpha: alpha * 0.7 });
      } else {
        graphics.circle(m.x, m.y, m.size);
        graphics.fill({ color: m.color, alpha });
      }
    }
  }

  burst(x, y, kind = 'shrine', count = 12) {
    const spec = AMBIENT_KINDS[kind] || AMBIENT_KINDS.shrine;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      this.motes.push({
        x: x + Math.cos(angle) * 4,
        y: y + Math.sin(angle) * 4,
        life: spec.life * 1.4,
        maxLife: spec.life * 1.4,
        size: spec.size * 1.2,
        color: spec.color,
        alpha: 0.95,
        phase: angle,
        speed: spec.speed * 2,
        drift: spec.drift * 2.5,
        kind
      });
    }
  }
}

const AMBIENT_KINDS = {
  forest: { color: '#c8ff7a', size: 2.2, sizeJitter: 1, alpha: 0.85, life: 2.8, speed: 1.6, drift: 0.35 },
  firefly: { color: '#d4ff6a', size: 2.4, sizeJitter: 0.8, alpha: 0.9, life: 3.2, speed: 1.4, drift: 0.28 },
  river: { color: '#dcfcff', size: 1.6, sizeJitter: 0.6, alpha: 0.55, life: 1.4, speed: 2.2, drift: 0.55 },
  shrine: { color: '#f0c866', size: 2.8, sizeJitter: 1.2, alpha: 0.75, life: 2.2, speed: 1.8, drift: 0.22 },
  blight: { color: '#9cf38a', size: 2, sizeJitter: 0.8, alpha: 0.65, life: 2.6, speed: 1.2, drift: 0.18 },
  plains: { color: '#fff4c0', size: 1.4, sizeJitter: 0.5, alpha: 0.35, life: 2, speed: 0.9, drift: 0.15 }
};

function collectAmbientTiles(state, tileWindow, isTileVisibleFn) {
  const map = state.map;
  if (!map?.tiles) return [];
  const out = [];
  const window = tileWindow || { minX: 0, maxX: 999, minY: 0, maxY: 999 };
  for (const tile of map.tiles) {
    if (tile.x < window.minX || tile.x > window.maxX || tile.y < window.minY || tile.y > window.maxY) continue;
    if (!isTileVisibleFn(state, tile.x, tile.y)) continue;
    const kind = ambientKindForTile(state, tile);
    if (kind) out.push({ x: tile.x, y: tile.y, ambientKind: kind });
  }
  return out;
}

function ambientKindForTile(state, tile) {
  if (tile.terrain === 'forest') return Math.random() < 0.65 ? 'firefly' : 'forest';
  if (tile.terrain === 'river') return 'river';
  if (tile.terrain === 'blight' || (tile.blight || 0) >= 4) return 'blight';
  if (state.buildings?.some((b) => b.type === 'shrine' && b.turnsLeft <= 0 && b.x === tile.x && b.y === tile.y)) return 'shrine';
  if (tile.terrain === 'plains' && Math.random() < 0.25) return 'plains';
  return null;
}

function inViewport(point, viewport) {
  return point.x >= viewport.minX
    && point.x <= viewport.maxX
    && point.y >= viewport.minY
    && point.y <= viewport.maxY;
}

let sharedAmbient = null;

export function getAmbientLifeSystem() {
  if (!sharedAmbient) sharedAmbient = new AmbientLifeSystem();
  return sharedAmbient;
}
