/**
 * Lightweight battlefield particle bursts: dust trails, combat impacts, construction sparks.
 */

export function createParticleSystem() {
  return {
    particles: [],
    maxParticles: 420
  };
}

export function spawnDustTrail(system, x, y, color = '#c9a86c') {
  for (let i = 0; i < 3; i += 1) {
    pushParticle(system, {
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -0.4 - Math.random() * 0.5,
      life: 0.35 + Math.random() * 0.2,
      maxLife: 0.55,
      size: 2 + Math.random() * 3,
      color,
      alpha: 0.55,
      kind: 'dust'
    });
  }
}

export function spawnCombatBurst(system, x, y, tone = 'blood') {
  const palette = tone === 'dust'
    ? ['#d9ac55', '#cfbe93', '#8a6d42']
    : ['#8b1e14', '#c43b2d', '#5c1410'];
  const count = tone === 'dust' ? 10 : 14;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 1.2 + Math.random() * 2.4;
    pushParticle(system, {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.8,
      life: 0.25 + Math.random() * 0.35,
      maxLife: 0.6,
      size: 1.5 + Math.random() * 3,
      color: palette[i % palette.length],
      alpha: 0.9,
      kind: 'combat'
    });
  }
}

export function spawnHammerSparks(system, x, y) {
  for (let i = 0; i < 16; i += 1) {
    const angle = -Math.PI * 0.15 + Math.random() * Math.PI * 0.55;
    const speed = 1.5 + Math.random() * 3;
    pushParticle(system, {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.18 + Math.random() * 0.22,
      maxLife: 0.4,
      size: 1 + Math.random() * 2.5,
      color: i % 2 ? '#f0c866' : '#fff2b8',
      alpha: 1,
      kind: 'spark'
    });
  }
}

export function spawnFloatingDamage(system, x, y, text, color = '#ff8a8a') {
  pushParticle(system, {
    x,
    y,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -1.2,
    life: 0.9,
    maxLife: 0.9,
    size: 14,
    color,
    alpha: 1,
    kind: 'text',
    text: String(text)
  });
}

export function tickParticles(system, deltaMs = 16) {
  const dt = deltaMs / 1000;
  const next = [];
  for (const particle of system.particles) {
    particle.life -= dt;
    if (particle.life <= 0) continue;
    particle.x += particle.vx * dt * 60;
    particle.y += particle.vy * dt * 60;
    if (particle.kind === 'dust') particle.vy -= dt * 0.15;
    if (particle.kind === 'combat' || particle.kind === 'spark') particle.vy += dt * 2.4;
    particle.alpha = Math.max(0, particle.life / particle.maxLife) * (particle.kind === 'text' ? 1 : 0.85);
    next.push(particle);
  }
  system.particles = next;
}

export function drawParticles(graphics, system, transform = null) {
  if (!graphics || !system.particles.length) return;
  graphics.clear();
  for (const particle of system.particles) {
    let x = particle.x;
    let y = particle.y;
    if (transform) {
      x = transform.x + (x - transform.originX) * transform.scale;
      y = transform.y + (y - transform.originY) * transform.scale;
    }
    const alpha = particle.alpha;
    if (particle.kind === 'text') {
      graphics.circle(x, y - (particle.maxLife - particle.life) * 18, 0.01);
      continue;
    }
    const radius = particle.size * (0.6 + particle.life / particle.maxLife);
    graphics.circle(x, y, radius);
    graphics.fill({ color: hexToNumber(particle.color), alpha });
  }
}

export function getFloatingTexts(system) {
  return system.particles.filter((p) => p.kind === 'text');
}

function pushParticle(system, particle) {
  if (system.particles.length >= system.maxParticles) system.particles.shift();
  system.particles.push(particle);
}

function hexToNumber(hex) {
  const clean = String(hex).replace('#', '');
  return Number.parseInt(clean, 16);
}
