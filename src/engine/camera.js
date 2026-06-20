const MIN_ZOOM = 0.72;
const MAX_ZOOM = 1.85;
const ZOOM_STEP = 0.08;
const EDGE_PAN = 28;
const EDGE_THRESHOLD = 42;
const FRICTION = 0.88;
const ZOOM_INERTIA = 0.82;

export class GameCamera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.vx = 0;
    this.vy = 0;
    this.bounds = { minX: -420, maxX: 420, minY: -320, maxY: 320 };
    this.viewport = { width: 1280, height: 860 };
    this.edgePanEnabled = true;
    this.pointer = { x: 0, y: 0, down: false, lastX: 0, lastY: 0 };
  }

  setViewport(width, height) {
    this.viewport.width = width;
    this.viewport.height = height;
    this.updateBounds();
  }

  updateBounds(mapWidth = 0, mapHeight = 0) {
    const padX = this.viewport.width * 0.18;
    const padY = this.viewport.height * 0.18;
    this.bounds.minX = -padX;
    this.bounds.maxY = padY;
    this.bounds.maxX = Math.max(padX, mapWidth - this.viewport.width + padX);
    this.bounds.minY = Math.min(-padY, mapHeight - this.viewport.height + padY);
  }

  setMapFrame(frameX, frameY, mapWidth, mapHeight) {
    this.frame = { x: frameX, y: frameY, width: mapWidth, height: mapHeight };
    this.updateBounds(mapWidth, mapHeight);
  }

  focusOn(cx, cy, immediate = false) {
    const targetX = cx - this.viewport.width / 2;
    const targetY = cy - this.viewport.height / 2;
    if (immediate) {
      this.x = this.clampX(targetX);
      this.y = this.clampY(targetY);
      this.vx = 0;
      this.vy = 0;
      return;
    }
    this.vx += (this.clampX(targetX) - this.x) * 0.12;
    this.vy += (this.clampY(targetY) - this.y) * 0.12;
  }

  handleWheel(deltaY, clientX, clientY, rect) {
    const factor = deltaY > 0 ? 1 - ZOOM_STEP : 1 + ZOOM_STEP;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetZoom * factor));
    if (next === this.targetZoom) return;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const worldX = (localX - this.x) / this.zoom;
    const worldY = (localY - this.y) / this.zoom;
    this.targetZoom = next;
    this.x = localX - worldX * next;
    this.y = localY - worldY * next;
    this.clampPosition();
  }

  handlePointerDown(clientX, clientY) {
    this.pointer.down = true;
    this.pointer.lastX = clientX;
    this.pointer.lastY = clientY;
    this.vx = 0;
    this.vy = 0;
  }

  handlePointerMove(clientX, clientY) {
    this.pointer.x = clientX;
    this.pointer.y = clientY;
    if (!this.pointer.down) return;
    const dx = clientX - this.pointer.lastX;
    const dy = clientY - this.pointer.lastY;
    this.pointer.lastX = clientX;
    this.pointer.lastY = clientY;
    this.x += dx;
    this.y += dy;
    this.vx = dx * 0.35;
    this.vy = dy * 0.35;
    this.clampPosition();
  }

  handlePointerUp() {
    this.pointer.down = false;
  }

  tick(deltaMs = 16) {
    const dt = deltaMs / 16;
    if (this.edgePanEnabled && !this.pointer.down) {
      const rect = this._hostRect;
      if (rect) {
        const left = this.pointer.x - rect.left;
        const top = this.pointer.y - rect.top;
        if (left < EDGE_THRESHOLD) this.vx -= EDGE_PAN * 0.02 * dt;
        if (rect.width - left < EDGE_THRESHOLD) this.vx += EDGE_PAN * 0.02 * dt;
        if (top < EDGE_THRESHOLD) this.vy -= EDGE_PAN * 0.02 * dt;
        if (rect.height - top < EDGE_THRESHOLD) this.vy += EDGE_PAN * 0.02 * dt;
      }
    }

    if (!this.pointer.down) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= FRICTION;
      this.vy *= FRICTION;
      if (Math.abs(this.vx) < 0.05) this.vx = 0;
      if (Math.abs(this.vy) < 0.05) this.vy = 0;
    }

    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.pow(ZOOM_INERTIA, dt));
    this.clampPosition();
  }

  bindHost(element) {
    this._host = element;
    this._hostRect = element.getBoundingClientRect();
    element.addEventListener('wheel', (event) => {
      event.preventDefault();
      this._hostRect = element.getBoundingClientRect();
      this.handleWheel(event.deltaY, event.clientX, event.clientY, this._hostRect);
    }, { passive: false });
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      this._hostRect = element.getBoundingClientRect();
      this.handlePointerDown(event.clientX, event.clientY);
      element.setPointerCapture?.(event.pointerId);
    });
    element.addEventListener('pointermove', (event) => {
      this._hostRect = element.getBoundingClientRect();
      this.handlePointerMove(event.clientX, event.clientY);
    });
    element.addEventListener('pointerup', () => this.handlePointerUp());
    element.addEventListener('pointerleave', () => this.handlePointerUp());
  }

  applyToContainer(container) {
    container.position.set(this.x, this.y);
    container.scale.set(this.zoom);
  }

  screenShake(intensity = 6, durationMs = 180) {
    this._shake = { intensity, until: performance.now() + durationMs, phase: 0 };
  }

  shakeOffset() {
    if (!this._shake || performance.now() > this._shake.until) {
      this._shake = null;
      return { x: 0, y: 0 };
    }
    this._shake.phase += 0.9;
    const falloff = (this._shake.until - performance.now()) / 180;
    const amp = this._shake.intensity * falloff;
    return {
      x: Math.sin(this._shake.phase * 1.7) * amp,
      y: Math.cos(this._shake.phase * 2.1) * amp * 0.6
    };
  }

  clampX(value) {
    return Math.max(this.bounds.minX, Math.min(this.bounds.maxX, value));
  }

  clampY(value) {
    return Math.max(this.bounds.minY, Math.min(this.bounds.maxY, value));
  }

  clampPosition() {
    this.x = this.clampX(this.x);
    this.y = this.clampY(this.y);
  }
}

export function createCamera() {
  return new GameCamera();
}
