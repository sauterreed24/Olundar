export const SETTINGS_STORAGE_KEY = 'olundar.player.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  audioVolume: 58,
  motion: 'full',
  mapScale: 'standard'
});

export const MOTION_MODES = Object.freeze({
  full: {
    id: 'full',
    label: 'Full motion',
    text: 'Use normal interface transitions and feedback.'
  },
  reduced: {
    id: 'reduced',
    label: 'Reduced motion',
    text: 'Minimize hover lift and toast movement for calmer play.'
  }
});

export const MAP_SCALE_PRESETS = Object.freeze({
  compact: {
    id: 'compact',
    label: 'Compact',
    text: 'Shorter map view with more council panels visible.',
    minHeight: 320,
    maxHeightFloor: 360,
    maxHeightOffset: 218
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    text: 'Balanced map height for regular laptop and tablet play.',
    minHeight: 360,
    maxHeightFloor: 420,
    maxHeightOffset: 146
  },
  expanded: {
    id: 'expanded',
    label: 'Expanded',
    text: 'Taller battlefield for scouting and siege planning.',
    minHeight: 420,
    maxHeightFloor: 520,
    maxHeightOffset: 88
  }
});

export function normalizeSettings(value = {}) {
  const settings = value && typeof value === 'object' ? value : {};
  const audioVolume = clampNumber(Number(settings.audioVolume), 0, 100, DEFAULT_SETTINGS.audioVolume);
  const motion = MOTION_MODES[settings.motion] ? settings.motion : DEFAULT_SETTINGS.motion;
  const mapScale = MAP_SCALE_PRESETS[settings.mapScale] ? settings.mapScale : DEFAULT_SETTINGS.mapScale;

  return { audioVolume, motion, mapScale };
}

export function readSettings(storage = null) {
  const store = storage || safeStorage();
  if (!store) return normalizeSettings(DEFAULT_SETTINGS);

  try {
    return normalizeSettings(JSON.parse(store.getItem(SETTINGS_STORAGE_KEY) || '{}'));
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings, storage = null) {
  const normalized = normalizeSettings(settings);
  const store = storage || safeStorage();

  try {
    store?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in embedded or private contexts.
  }

  return normalized;
}

export function getMapScalePreset(settings) {
  return MAP_SCALE_PRESETS[normalizeSettings(settings).mapScale];
}

export function validateSettingsConfig() {
  const motionIds = Object.keys(MOTION_MODES);
  const mapScaleIds = Object.keys(MAP_SCALE_PRESETS);

  if (!motionIds.includes(DEFAULT_SETTINGS.motion)) throw new Error('Default motion setting is invalid.');
  if (!mapScaleIds.includes(DEFAULT_SETTINGS.mapScale)) throw new Error('Default map scale setting is invalid.');
  if (!Number.isInteger(DEFAULT_SETTINGS.audioVolume) || DEFAULT_SETTINGS.audioVolume < 0 || DEFAULT_SETTINGS.audioVolume > 100) {
    throw new Error('Default audio volume must be a whole number from 0 to 100.');
  }

  for (const [id, mode] of Object.entries(MOTION_MODES)) {
    if (mode.id !== id || !mode.label || !mode.text) throw new Error(`Motion mode ${id} is incomplete.`);
  }

  for (const [id, preset] of Object.entries(MAP_SCALE_PRESETS)) {
    if (preset.id !== id || !preset.label || !preset.text) throw new Error(`Map scale ${id} is incomplete.`);
    if (!Number.isInteger(preset.minHeight) || preset.minHeight < 300) throw new Error(`Map scale ${id} minHeight is invalid.`);
    if (!Number.isInteger(preset.maxHeightFloor) || preset.maxHeightFloor < preset.minHeight) throw new Error(`Map scale ${id} maxHeightFloor is invalid.`);
    if (!Number.isInteger(preset.maxHeightOffset) || preset.maxHeightOffset < 60) throw new Error(`Map scale ${id} maxHeightOffset is invalid.`);
  }

  return { motionIds, mapScaleIds, defaultSettings: normalizeSettings(DEFAULT_SETTINGS) };
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
