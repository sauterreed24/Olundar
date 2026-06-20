const CACHE_NAME = 'olundar-pwa-v137';
const APP_SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icons/olundar-icon.svg",
  "./assets/sprites/olundar-sprite-sheet.svg",
  "./data/buildings.json",
  "./data/crisisAftermath.json",
  "./data/crisisEvents.json",
  "./data/difficulties.json",
  "./data/diplomacyActions.json",
  "./data/diplomaticPromises.json",
  "./data/factions.json",
  "./data/fieldOrders.json",
  "./data/mapLenses.json",
  "./data/meta.json",
  "./data/scenarios.json",
  "./data/terrain.json",
  "./data/units.json",
  "./data/warAims.json",
  "./src/audio.js",
  "./src/content.js",
  "./src/engine/audio.js",
  "./src/engine/camera.js",
  "./src/engine/canvas-bridge.js",
  "./src/engine/commands.js",
  "./src/engine/entity-factory.js",
  "./src/engine/particles.js",
  "./src/engine/pixi-renderer.js",
  "./src/main.js",
  "./src/map.js",
  "./src/pwa.js",
  "./src/render.js",
  "./src/rules.js",
  "./src/saveSlots.js",
  "./src/saveTransfer.js",
  "./src/settings.js",
  "./src/style.css"
];

const appShellUrls = APP_SHELL_ASSETS.map((asset) => new URL(asset, self.location).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(appShellUrls))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('./index.html', self.location).toString()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && appShellUrls.includes(request.url)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
