import { getAudioMixer } from './engine/audio.js';

export const AUDIO_STORAGE_KEY = 'olundar.audio.enabled';
export const DEFAULT_AUDIO_VOLUME = 58;
export const AUDIO_BUS_DEFAULTS = Object.freeze({
  master: 58,
  sfx: 100,
  ambient: 70,
  music: 65,
  ui: 85
});

export const AUDIO_CUES = {
  ui: { notes: [392, 494], duration: 0.06, spacing: 0.035, type: 'triangle', gain: 0.028 },
  select: { notes: [330, 440], duration: 0.07, spacing: 0.04, type: 'sine', gain: 0.03 },
  move: { notes: [196, 247], duration: 0.1, spacing: 0.055, type: 'triangle', gain: 0.032 },
  attack: { notes: [131, 98], duration: 0.12, spacing: 0.035, type: 'sawtooth', gain: 0.04, slide: -18, noise: true },
  build: { notes: [196, 247, 330], duration: 0.09, spacing: 0.045, type: 'square', gain: 0.026 },
  train: { notes: [262, 330, 392], duration: 0.08, spacing: 0.045, type: 'triangle', gain: 0.028 },
  diplomacy: { notes: [294, 392, 523], duration: 0.1, spacing: 0.05, type: 'sine', gain: 0.026 },
  turn: { notes: [165, 220, 330], duration: 0.12, spacing: 0.06, type: 'triangle', gain: 0.03 },
  warning: { notes: [220, 185], duration: 0.1, spacing: 0.06, type: 'square', gain: 0.03 },
  error: { notes: [147, 110], duration: 0.12, spacing: 0.05, type: 'sawtooth', gain: 0.035 },
  save: { notes: [330, 392, 523], duration: 0.08, spacing: 0.05, type: 'sine', gain: 0.025 },
  load: { notes: [523, 392, 330], duration: 0.08, spacing: 0.05, type: 'sine', gain: 0.025 },
  fanfare: { notes: [262, 330, 392, 523], duration: 0.1, spacing: 0.065, type: 'triangle', gain: 0.032 }
};

let enabled = false;
let volume = DEFAULT_AUDIO_VOLUME;
let busVolumes = { ...AUDIO_BUS_DEFAULTS };

export function validateAudioCueRegistry(registry = AUDIO_CUES) {
  const ids = Object.keys(registry);
  let totalDuration = 0;

  if (ids.length < 10) throw new Error('Audio registry needs enough distinct game cues.');

  for (const [id, cue] of Object.entries(registry)) {
    if (!Array.isArray(cue.notes) || cue.notes.length < 1 || cue.notes.length > 5) {
      throw new Error(`${id} must define one to five notes.`);
    }
    if (!['sine', 'square', 'sawtooth', 'triangle'].includes(cue.type)) {
      throw new Error(`${id} uses unsupported oscillator type.`);
    }
    if (!Number.isFinite(cue.duration) || cue.duration <= 0 || cue.duration > 0.16) {
      throw new Error(`${id} duration is outside the lightweight cue budget.`);
    }
    const spacing = cue.spacing ?? 0.045;
    if (!Number.isFinite(spacing) || spacing < 0 || spacing > 0.08) {
      throw new Error(`${id} spacing is outside the lightweight cue budget.`);
    }
    if (!Number.isFinite(cue.gain) || cue.gain <= 0 || cue.gain > 0.05) {
      throw new Error(`${id} gain should stay subtle.`);
    }
    for (const note of cue.notes) {
      if (!Number.isFinite(note) || note < 70 || note > 1200) {
        throw new Error(`${id} has an out-of-range note.`);
      }
    }
    totalDuration += cue.duration + spacing * Math.max(0, cue.notes.length - 1);
  }

  return { count: ids.length, ids, totalDuration: Number(totalDuration.toFixed(3)) };
}

export function initAudioPreference(storage = null) {
  const store = storage || safeStorage();
  enabled = store?.getItem(AUDIO_STORAGE_KEY) === 'true';
  return enabled;
}

export function audioIsEnabled() {
  return enabled;
}

export function getAudioVolume() {
  return volume;
}

export function getAudioBusVolumes() {
  return { ...busVolumes };
}

export function setAudioBusVolume(busId, nextVolume) {
  busVolumes[busId] = normalizeVolume(nextVolume);
  const mixer = getMixer();
  mixer?.setBusVolume(busId, busVolumes[busId]);
  return busVolumes[busId];
}

export function setAudioVolume(nextVolume) {
  volume = normalizeVolume(nextVolume);
  busVolumes.master = volume;
  const mixer = getMixer();
  mixer?.setBusVolume('master', volume);
  return volume;
}

export function setAudioEnabled(nextEnabled, storage = null) {
  enabled = Boolean(nextEnabled);
  const store = storage || safeStorage();
  try {
    store?.setItem(AUDIO_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Storage can be blocked in private or embedded browser contexts.
  }

  const mixer = getMixer();
  if (mixer) {
    mixer.setEnabled(enabled);
    for (const [busId, busVolume] of Object.entries(busVolumes)) mixer.setBusVolume(busId, busVolume);
  }

  return enabled;
}

export function toggleAudio(storage = null) {
  return setAudioEnabled(!enabled, storage);
}

export function playAudioCue(id) {
  if (!enabled) return false;
  const mixer = getMixer();
  if (mixer) {
    mixer.playCue(id, AUDIO_CUES);
    return true;
  }
  return false;
}

export function updateDynamicMusicLayers(options = {}) {
  const mixer = getMixer();
  mixer?.updateMusicLayers(options);
}

function getMixer() {
  if (typeof window === 'undefined') return null;
  return getAudioMixer();
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function normalizeVolume(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUDIO_VOLUME;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}
