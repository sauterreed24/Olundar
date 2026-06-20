export class ParticleField {
  constructor() {
    this.particles = [];
    this.maxParticles = 240;
  }

  burst(x, y, options = {}) {
    const {
      count = 12,
      color = 0xd9ac55,
      speed = 2.4,
      life = 520,
      size = 3,
      spread = Math.PI * 2,
      angle = -Math.PI / 2,
      gravity = 0.08,
      kind = 'dust'
    } = options;

    for (let i = 0; i < count; i += 1) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const theta = angle + (Math.random() - 0.5) * spread;
      const velocity = speed * (0.45 + Math.random() * 0.9);
      this.particles.push({
        x,
        y,
        vx: Math.cos(theta) * velocity,
        vy: Math.sin(theta) * velocity,
        life,
        maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color,
        gravity,
        kind
      });
    }
  }

  dustTrail(x, y) {
    this.burst(x, y, { count: 2, speed: 0.8, life: 360, size: 2.2, spread: 0.8, color: 0xc9b07a });
  }

  combatImpact(x, y, lethal = false) {
    this.burst(x, y, {
      count: lethal ? 18 : 10,
      speed: lethal ? 3.4 : 2.2,
      life: lethal ? 680 : 420,
      size: lethal ? 3.6 : 2.8,
      spread: Math.PI,
      angle: -Math.PI / 2,
      color: lethal ? 0x8b1f1f : 0xb58b62,
      gravity: 0.12
    });
  }

  buildSparks(x, y) {
    this.burst(x, y, {
      count: 14,
      speed: 2.8,
      life: 460,
      size: 2.4,
      spread: Math.PI * 1.2,
      angle: -Math.PI / 2,
      color: 0xf0c866,
      gravity: 0.16
    });
  }

  update(deltaMs) {
    const dt = deltaMs / 16;
    this.particles = this.particles.filter((particle) => {
      particle.life -= deltaMs;
      particle.vy += particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.98;
      return particle.life > 0;
    });
  }

  draw(graphics) {
    graphics.clear();
    for (const particle of this.particles) {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      graphics.circle(particle.x, particle.y, particle.size * alpha);
      graphics.fill({ color: particle.color, alpha: alpha * 0.85 });
    }
  }
}

export function createParticleField() {
  return new ParticleField();
}
