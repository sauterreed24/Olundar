/** Sole gateway for Canvas 2D acquisition — keeps drawing behind the Pixi abstraction. */

const offscreenPool = new WeakMap();

export function acquireCanvas2D(target) {
  if (!target) return null;
  if (typeof target.getContext === 'function') {
    return target.getContext('2d', { alpha: true });
  }
  return null;
}

export function getOffscreenCanvas(width, height, key = 'default') {
  const bucket = offscreenPool.get(key) || {};
  offscreenPool.set(key, bucket);
  const sizeKey = `${width}x${height}`;
  if (!bucket[sizeKey]) {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      bucket[sizeKey] = canvas;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      bucket[sizeKey] = new OffscreenCanvas(width, height);
    }
  }
  const canvas = bucket[sizeKey];
  if (canvas && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}
