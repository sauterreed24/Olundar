/** Smooth viewport camera: wheel zoom with inertia, edge-pan, bounded scrolling. */

const MIN_ZOOM = 0.72;
const MAX_ZOOM = 2.35;
const EDGE_PAN = 28;
const EDGE_SPEED = 9.5;
const WHEEL_ZOOM = 0.00135;
const FRICTION = 0.86;

export class ViewportCamera {
  constructor(bounds = { width: 1, height: 1 }) {
    this.bounds = { ...bounds };
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.vx = 0;
    this.vy = 0;
    this.vZoom = 0;
    this.pointerInside = false;
    this.edgePanEnabled = true;
  }

  setBounds(width, height) {
    this.bounds.width = Math.max(1, width);
    this.bounds.height = Math.max(1, height);
    this.clamp();
  }

  setCenter(x, y) {
    this.x = x;
    this.y = y;
    this.clamp();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.vx = 0;
    this.vy = 0;
    this.vZoom = 0;
  }

  onWheel(deltaY, anchorX, anchorY, viewWidth, viewHeight) {
    const before = this.screenToWorld(anchorX, anchorY, viewWidth, viewHeight);
    this.targetZoom = clamp(this.targetZoom * (1 - deltaY * WHEEL_ZOOM), MIN_ZOOM, MAX_ZOOM);
    this.vZoom += (this.targetZoom - this.zoom) * 0.22;
    const after = this.screenToWorld(anchorX, anchorY, viewWidth, viewHeight);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  onPointerMove(clientX, clientY, rect) {
    if (!this.edgePanEnabled || !this.pointerInside) return;
    const left = clientX - rect.left;
    const top = clientY - rect.top;
    let ax = 0;
    let ay = 0;
    if (left < EDGE_PAN) ax = -1;
    else if (left > rect.width - EDGE_PAN) ax = 1;
    if (top < EDGE_PAN) ay = -1;
    else if (top > rect.height - EDGE_PAN) ay = 1;
    this.vx += ax * EDGE_SPEED / this.zoom;
    this.vy += ay * EDGE_SPEED / this.zoom;
  }

  tick(dt = 1) {
    this.zoom += this.vZoom * dt;
    this.zoom = clamp(this.zoom, MIN_ZOOM, MAX_ZOOM);
    this.vZoom *= FRICTION;
    this.targetZoom = clamp(this.targetZoom + (this.zoom - this.targetZoom) * 0.08, MIN_ZOOM, MAX_ZOOM);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= FRICTION;
    this.vy *= FRICTION;
    this.clamp();
  }

  screenToWorld(sx, sy, viewWidth, viewHeight) {
    const cx = viewWidth * 0.5;
    const cy = viewHeight * 0.5;
    return {
      x: (sx - cx) / this.zoom - this.x + cx,
      y: (sy - cy) / this.zoom - this.y + cy
    };
  }

  applyToContainer(container, viewWidth, viewHeight) {
    const cx = viewWidth * 0.5;
    const cy = viewHeight * 0.5;
    container.position.set(cx + this.x, cy + this.y);
    container.scale.set(this.zoom);
    container.pivot.set(cx, cy);
  }

  clamp() {
    const marginX = this.bounds.width * 0.18;
    const marginY = this.bounds.height * 0.18;
    const maxX = marginX;
    const maxY = marginY;
    this.x = clamp(this.x, -maxX, maxX);
    this.y = clamp(this.y, -maxY, maxY);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
