/** Lightweight particle bursts for movement dust, combat impacts, and construction sparks. */

export class ParticleSystem {
  constructor() {
    this.particles = [];
    this.max = 420;
  }

  clear() {
    this.particles.length = 0;
  }

  burst(x, y, options = {}) {
    const {
      count = 12,
      color = '#c9a66b',
      speed = 2.4,
      life = 0.55,
      size = 3,
      gravity = 0.08,
      spread = Math.PI * 2
    } = options;
    for (let i = 0; i < count; i += 1) {
      if (this.particles.length >= this.max) this.particles.shift();
      const angle = (spread / count) * i + (Math.random() - 0.5) * 0.4;
      const velocity = speed * (0.45 + Math.random() * 0.75);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color,
        gravity
      });
    }
  }

  dustTrail(x, y) {
    if (this.particles.length >= this.max) return;
    this.particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -0.25 - Math.random() * 0.35,
      life: 0.35,
      maxLife: 0.35,
      size: 1.4 + Math.random() * 1.6,
      color: '#b89558',
      gravity: -0.02
    });
  }

  hammerSpark(x, y) {
    this.burst(x, y, {
      count: 16,
      color: '#f0c866',
      speed: 3.2,
      life: 0.42,
      size: 2.2,
      gravity: 0.12,
      spread: Math.PI * 0.9
    });
  }

  combatBurst(x, y, lethal = false) {
    this.burst(x, y, {
      count: lethal ? 22 : 14,
      color: lethal ? '#8b1f1f' : '#9a7a4a',
      speed: lethal ? 4.2 : 2.8,
      life: lethal ? 0.65 : 0.48,
      size: lethal ? 3.4 : 2.4,
      gravity: 0.1
    });
  }

  tick(dt = 1 / 60) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.98;
      p.vy *= 0.98;
    }
  }

  draw(graphics) {
    if (!graphics || !this.particles.length) return;
    graphics.clear();
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      graphics.circle(p.x, p.y, p.size * alpha);
      graphics.fill({ color: p.color, alpha: alpha * 0.85 });
    }
  }
}
