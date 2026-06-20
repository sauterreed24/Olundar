/**
 * Smooth battlefield camera: wheel zoom with inertia, edge-panning, bounded scroll.
 */

const MIN_ZOOM = 0.72;
const MAX_ZOOM = 1.85;
const ZOOM_STEP = 0.08;
const EDGE_PAN_MARGIN = 28;
const EDGE_PAN_SPEED = 4.2;
const ZOOM_INERTIA = 0.82;
const PAN_INERTIA = 0.88;
const WHEEL_ZOOM_SENSITIVITY = 0.0012;

export function createCamera() {
  return {
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
    targetZoom: 1,
    velocityX: 0,
    velocityY: 0,
    zoomVelocity: 0,
    bounds: { minX: -320, maxX: 320, minY: -240, maxY: 240 },
    pointerInside: false,
    pointerX: 0,
    pointerY: 0,
    viewportW: 1280,
    viewportH: 860
  };
}

export function setCameraViewport(camera, width, height) {
  camera.viewportW = width;
  camera.viewportH = height;
  updateCameraBounds(camera);
}

export function updateCameraBounds(camera, mapWidth = 0, mapHeight = 0) {
  const padX = Math.max(120, mapWidth * 0.18);
  const padY = Math.max(90, mapHeight * 0.18);
  camera.bounds = {
    minX: -padX,
    maxX: padX,
    minY: -padY,
    maxY: padY
  };
}

export function clampCamera(camera) {
  camera.offsetX = clamp(camera.offsetX, camera.bounds.minX, camera.bounds.maxX);
  camera.offsetY = clamp(camera.offsetY, camera.bounds.minY, camera.bounds.maxY);
  camera.zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  camera.targetZoom = clamp(camera.targetZoom, MIN_ZOOM, MAX_ZOOM);
}

export function resetCamera(camera) {
  camera.offsetX = 0;
  camera.offsetY = 0;
  camera.zoom = 1;
  camera.targetZoom = 1;
  camera.velocityX = 0;
  camera.velocityY = 0;
  camera.zoomVelocity = 0;
}

export function focusCameraOn(camera, screenX, screenY, strength = 0.22) {
  const cx = camera.viewportW * 0.5;
  const cy = camera.viewportH * 0.5;
  camera.velocityX += (cx - screenX) * strength * 0.02;
  camera.velocityY += (cy - screenY) * strength * 0.02;
}

export function handleCameraWheel(camera, deltaY, clientX, clientY, rect) {
  const before = screenToWorld(camera, clientX - rect.left, clientY - rect.top, rect);
  const direction = deltaY < 0 ? 1 : -1;
  camera.targetZoom = clamp(camera.targetZoom + direction * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
  camera.zoomVelocity += direction * 0.04;
  const after = screenToWorld(camera, clientX - rect.left, clientY - rect.top, rect);
  camera.offsetX += (after.x - before.x) * camera.zoom;
  camera.offsetY += (after.y - before.y) * camera.zoom;
  clampCamera(camera);
}

export function handleCameraPointerMove(camera, clientX, clientY, rect) {
  camera.pointerInside = true;
  camera.pointerX = clientX - rect.left;
  camera.pointerY = clientY - rect.top;
}

export function handleCameraPointerLeave(camera) {
  camera.pointerInside = false;
}

export function tickCamera(camera, deltaMs = 16) {
  const dt = deltaMs / 16;

  if (camera.pointerInside) {
    const w = camera.viewportW;
    const h = camera.viewportH;
    if (camera.pointerX < EDGE_PAN_MARGIN) camera.velocityX += EDGE_PAN_SPEED * dt * (1 - camera.pointerX / EDGE_PAN_MARGIN);
    if (camera.pointerX > w - EDGE_PAN_MARGIN) camera.velocityX -= EDGE_PAN_SPEED * dt * (1 - (w - camera.pointerX) / EDGE_PAN_MARGIN);
    if (camera.pointerY < EDGE_PAN_MARGIN) camera.velocityY += EDGE_PAN_SPEED * dt * (1 - camera.pointerY / EDGE_PAN_MARGIN);
    if (camera.pointerY > h - EDGE_PAN_MARGIN) camera.velocityY -= EDGE_PAN_SPEED * dt * (1 - (h - camera.pointerY) / EDGE_PAN_MARGIN);
  }

  const zoomDelta = camera.targetZoom - camera.zoom;
  camera.zoom += zoomDelta * (1 - ZOOM_INERTIA) * dt + camera.zoomVelocity;
  camera.zoomVelocity *= ZOOM_INERTIA;

  camera.offsetX += camera.velocityX * dt;
  camera.offsetY += camera.velocityY * dt;
  camera.velocityX *= PAN_INERTIA;
  camera.velocityY *= PAN_INERTIA;

  clampCamera(camera);
}

export function screenToWorld(camera, x, y, rect = null) {
  const scaleX = rect ? (camera.viewportW / rect.width) : 1;
  const scaleY = rect ? (camera.viewportH / rect.height) : 1;
  const sx = x * scaleX;
  const sy = y * scaleY;
  return {
    x: (sx - camera.viewportW * 0.5 - camera.offsetX) / camera.zoom + camera.viewportW * 0.5,
    y: (sy - camera.viewportH * 0.5 - camera.offsetY) / camera.zoom + camera.viewportH * 0.5
  };
}

export function getCameraTransform(camera) {
  return {
    x: camera.viewportW * 0.5 + camera.offsetX,
    y: camera.viewportH * 0.5 + camera.offsetY,
    scale: camera.zoom
  };
}

export function applyWheelInertia(camera, deltaY) {
  camera.zoomVelocity += -deltaY * WHEEL_ZOOM_SENSITIVITY;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
