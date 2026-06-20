/**
 * Smooth viewport camera: wheel zoom with inertia, edge-panning, bounded scrolling.
 * Tactical framing from render.js is preserved; this layer adds player-controlled view motion.
 */

const DEFAULT_BOUNDS = {
  minZoom: 0.72,
  maxZoom: 2.35,
  minPanX: -420,
  maxPanX: 420,
  minPanY: -320,
  maxPanY: 320
};

export class Camera {
  constructor(bounds = DEFAULT_BOUNDS) {
    this.bounds = { ...DEFAULT_BOUNDS, ...bounds };
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.velocityX = 0;
    this.velocityY = 0;
    this.zoomVelocity = 0;
    this.edgePanMargin = 36;
    this.edgePanSpeed = 5.5;
    this.inertia = 0.88;
    this.zoomInertia = 0.82;
    this.pointerInside = false;
    this.lastPointer = { x: 0, y: 0 };
  }

  reset() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.velocityX = 0;
    this.velocityY = 0;
    this.zoomVelocity = 0;
  }

  focusTile(tileX, tileY, layout) {
    if (!layout) return;
    const center = tileCenterScreen(layout, tileX, tileY);
    const cx = layout.canvasWidth * 0.5;
    const cy = layout.canvasHeight * 0.5;
    this.panX = clamp(this.panX + (cx - center.x) * 0.35, this.bounds.minPanX, this.bounds.maxPanX);
    this.panY = clamp(this.panY + (cy - center.y) * 0.35, this.bounds.minPanY, this.bounds.maxPanY);
  }

  handleWheel(deltaY, clientX, clientY, canvasRect) {
    const factor = deltaY > 0 ? 0.92 : 1.08;
    const next = clamp(this.targetZoom * factor, this.bounds.minZoom, this.bounds.maxZoom);
    const ratio = next / this.targetZoom;
    const px = clientX - canvasRect.left;
    const py = clientY - canvasRect.top;
    const cx = canvasRect.width * 0.5;
    const cy = canvasRect.height * 0.5;
    this.panX += (px - cx) * (1 - ratio);
    this.panY += (py - cy) * (1 - ratio);
    this.targetZoom = next;
    this.zoomVelocity += (next - this.zoom) * 0.15;
  }

  setPointer(clientX, clientY, inside, canvasRect) {
    this.pointerInside = inside;
    if (!inside || !canvasRect) return;
    this.lastPointer = {
      x: clientX - canvasRect.left,
      y: clientY - canvasRect.top
    };
  }

  panBy(dx, dy) {
    this.panX = clamp(this.panX + dx, this.bounds.minPanX, this.bounds.maxPanX);
    this.panY = clamp(this.panY + dy, this.bounds.minPanY, this.bounds.maxPanY);
  }

  update(dtMs, canvasWidth, canvasHeight) {
    const dt = Math.min(32, dtMs) / 16.67;

    if (this.pointerInside) {
      const { x, y } = this.lastPointer;
      const m = this.edgePanMargin;
      if (x < m) this.velocityX -= this.edgePanSpeed * dt * (1 - x / m);
      else if (x > canvasWidth - m) this.velocityX += this.edgePanSpeed * dt * (1 - (canvasWidth - x) / m);
      if (y < m) this.velocityY -= this.edgePanSpeed * dt * (1 - y / m);
      else if (y > canvasHeight - m) this.velocityY += this.edgePanSpeed * dt * (1 - (canvasHeight - y) / m);
    }

    this.panX = clamp(this.panX + this.velocityX * dt, this.bounds.minPanX, this.bounds.maxPanX);
    this.panY = clamp(this.panY + this.velocityY * dt, this.bounds.minPanY, this.bounds.maxPanY);
    this.velocityX *= this.inertia;
    this.velocityY *= this.inertia;

    this.zoomVelocity += (this.targetZoom - this.zoom) * 0.18;
    this.zoom += this.zoomVelocity;
    this.zoomVelocity *= this.zoomInertia;
    this.zoom = clamp(this.zoom, this.bounds.minZoom, this.bounds.maxZoom);
  }

  getTransform() {
    return {
      panX: this.panX,
      panY: this.panY,
      zoom: this.zoom,
      centerX: 0,
      centerY: 0
    };
  }

  applyToPoint(screenX, screenY, canvasWidth, canvasHeight) {
    const cx = canvasWidth * 0.5;
    const cy = canvasHeight * 0.5;
    return {
      x: (screenX - cx - this.panX) / this.zoom + cx,
      y: (screenY - cy - this.panY) / this.zoom + cy
    };
  }

  screenToWorld(screenX, screenY, canvasWidth, canvasHeight) {
    return this.applyToPoint(screenX, screenY, canvasWidth, canvasHeight);
  }
}

let sharedCamera = null;

export function getCamera() {
  if (!sharedCamera) sharedCamera = new Camera();
  return sharedCamera;
}

function tileCenterScreen(layout, x, y) {
  const halfW = layout.halfTileWidth;
  const halfH = layout.halfTileHeight;
  return {
    x: layout.originX + (x - y) * halfW,
    y: layout.originY + (x + y) * halfH
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
