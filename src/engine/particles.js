/**
 * Lightweight particle system for dust trails, combat bursts, hammer sparks, and blight pulses.
 */

const POOL_SIZE = 512;

export class ParticleSystem {
  constructor() {
    this.particles = [];
    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.pool.push(createParticle());
    }
  }

  emit(config) {
    const count = config.count || 8;
    for (let i = 0; i < count; i += 1) {
      const p = this.borrowParticle();
      p.x = config.x + (config.spreadX || 0) * (Math.random() - 0.5);
      p.y = config.y + (config.spreadY || 0) * (Math.random() - 0.5);
      p.vx = (config.vx || 0) + (Math.random() - 0.5) * (config.jitter || 1.2);
      p.vy = (config.vy || 0) + (Math.random() - 0.5) * (config.jitter || 1.2);
      p.life = config.life || 0.5;
      p.maxLife = p.life;
      p.size = config.size || 3;
      p.color = config.color || '#d4b896';
      p.alpha = config.alpha ?? 0.85;
      p.gravity = config.gravity ?? 0.04;
      p.kind = config.kind || 'dust';
      p.shrink = config.shrink ?? 0.96;
      this.particles.push(p);
    }
  }

  borrowParticle() {
    const particle = this.pool.pop() || createParticle();
    particle.active = true;
    return particle;
  }

  recycleParticle(particle) {
    particle.active = false;
    if (this.pool.length < POOL_SIZE) this.pool.push(particle);
  }

  dustTrail(x, y, direction = 0) {
    this.emit({
      x,
      y,
      count: 3,
      vx: Math.cos(direction) * -0.8,
      vy: Math.sin(direction) * -0.8 - 0.3,
      life: 0.35,
      size: 2.5,
      color: '#c9a66b',
      alpha: 0.55,
      spreadX: 8,
      spreadY: 4,
      kind: 'dust'
    });
  }

  combatBurst(x, y, tone = 'blood') {
    const color = tone === 'blood' ? '#8b1e1e' : '#b8956a';
    this.emit({
      x,
      y,
      count: 14,
      vx: 0,
      vy: -1.2,
      life: 0.45,
      size: 4,
      color,
      alpha: 0.9,
      spreadX: 18,
      spreadY: 12,
      jitter: 2.4,
      gravity: 0.12,
      kind: 'combat'
    });
  }

  hammerSparks(x, y) {
    this.emit({
      x,
      y,
      count: 10,
      vx: 0,
      vy: -2,
      life: 0.3,
      size: 2,
      color: '#f0c866',
      alpha: 1,
      spreadX: 14,
      spreadY: 8,
      jitter: 3,
      gravity: 0.18,
      kind: 'spark'
    });
  }

  buildingComplete(x, y) {
    this.hammerSparks(x, y);
    this.emit({
      x,
      y,
      count: 6,
      life: 0.55,
      size: 5,
      color: '#e8d4a8',
      alpha: 0.7,
      spreadX: 20,
      spreadY: 16,
      kind: 'spark'
    });
  }

  update(dt) {
    const step = Math.min(0.05, dt);
    let writeIndex = 0;
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      p.life -= step;
      if (p.life <= 0) {
        this.recycleParticle(p);
        continue;
      }
      p.vy += p.gravity;
      p.x += p.vx * step * 60;
      p.y += p.vy * step * 60;
      p.size *= p.shrink;
      this.particles[writeIndex] = p;
      writeIndex += 1;
    }
    this.particles.length = writeIndex;
  }

  draw(graphics, viewport = null) {
    if (!graphics || !this.particles.length) return;
    for (const p of this.particles) {
      if (viewport && !isParticleInViewport(p, viewport)) continue;
      const t = p.life / p.maxLife;
      graphics.circle(p.x, p.y, Math.max(0.5, p.size * t));
      graphics.fill({ color: p.color, alpha: p.alpha * t });
    }
  }
}

function createParticle() {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    size: 2,
    color: '#fff',
    alpha: 1,
    gravity: 0,
    kind: 'dust',
    shrink: 0.96
  };
}

function isParticleInViewport(particle, viewport) {
  return particle.x >= viewport.minX
    && particle.x <= viewport.maxX
    && particle.y >= viewport.minY
    && particle.y <= viewport.maxY;
}

let sharedParticles = null;

export function getParticleSystem() {
  if (!sharedParticles) sharedParticles = new ParticleSystem();
  return sharedParticles;
}
