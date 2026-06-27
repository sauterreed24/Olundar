/**
 * Web Audio API mixer with SFX, Ambient, Music, and UI buses.
 * Dynamic music layers respond to exploration, tension, and combat.
 */

export const AUDIO_STORAGE_KEY = 'olundar.audio.enabled';
export const DEFAULT_AUDIO_VOLUME = 58;

export const AUDIO_CUES = {
  ui: { notes: [392, 494], duration: 0.06, spacing: 0.035, type: 'triangle', gain: 0.028, bus: 'ui' },
  select: { notes: [330, 440], duration: 0.07, spacing: 0.04, type: 'sine', gain: 0.03, bus: 'sfx' },
  move: { notes: [196, 247], duration: 0.1, spacing: 0.055, type: 'triangle', gain: 0.032, bus: 'sfx' },
  attack: { notes: [131, 98], duration: 0.12, spacing: 0.035, type: 'sawtooth', gain: 0.04, slide: -18, noise: true, bus: 'sfx' },
  build: { notes: [196, 247, 330], duration: 0.09, spacing: 0.045, type: 'square', gain: 0.026, bus: 'sfx' },
  train: { notes: [262, 330, 392], duration: 0.08, spacing: 0.045, type: 'triangle', gain: 0.028, bus: 'sfx' },
  diplomacy: { notes: [294, 392, 523], duration: 0.1, spacing: 0.05, type: 'sine', gain: 0.026, bus: 'ui' },
  turn: { notes: [165, 220, 330], duration: 0.12, spacing: 0.06, type: 'triangle', gain: 0.03, bus: 'ui' },
  warning: { notes: [220, 185], duration: 0.1, spacing: 0.06, type: 'square', gain: 0.03, bus: 'ui' },
  error: { notes: [147, 110], duration: 0.12, spacing: 0.05, type: 'sawtooth', gain: 0.035, bus: 'ui' },
  save: { notes: [330, 392, 523], duration: 0.08, spacing: 0.05, type: 'sine', gain: 0.025, bus: 'ui' },
  load: { notes: [523, 392, 330], duration: 0.08, spacing: 0.05, type: 'sine', gain: 0.025, bus: 'ui' },
  fanfare: { notes: [262, 330, 392, 523], duration: 0.1, spacing: 0.065, type: 'triangle', gain: 0.032, bus: 'music' },
  decree: { notes: [392, 523, 659], duration: 0.08, spacing: 0.045, type: 'sine', gain: 0.028, bus: 'music' },
  discovery: { notes: [330, 440, 554], duration: 0.07, spacing: 0.04, type: 'triangle', gain: 0.028, bus: 'sfx' },
  glory: { notes: [262, 330, 392, 523], duration: 0.08, spacing: 0.05, type: 'triangle', gain: 0.032, bus: 'music' }
};

const BUS_IDS = ['master', 'sfx', 'ambient', 'music', 'ui'];
const DEFAULT_BUS_VOLUMES = { master: 58, sfx: 72, ambient: 45, music: 55, ui: 68 };
const MUSIC_LAYER_FLOOR = 0.0001;
export const MUSIC_CROSSFADE_SECONDS = 1.35;
const MUSIC_LAYER_LEVELS = { exploration: 0.014, tension: 0.008, combat: 0.01 };
const MUSIC_MODE_MIXES = {
  exploration: { exploration: 1, tension: 0, combat: 0 },
  tension: { exploration: 0.42, tension: 1, combat: 0 },
  combat: { exploration: 0.18, tension: 0.55, combat: 1 }
};
const AMBIENT_LAYER_FLOOR = 0.0001;
export const AMBIENT_TILE_FADE_SECONDS = 0.9;
const AMBIENT_TILE_LEVELS = { wind: 0.0045, water: 0.0038, crows: 0.0026, hammering: 0.0034 };

let audioContext = null;
let buses = {};
let enabled = false;
let busVolumes = { ...DEFAULT_BUS_VOLUMES };
let musicLayers = { exploration: null, tension: null, combat: null };
let ambientLayers = { wind: null, water: null, crows: null, hammering: null };
let activeAmbientTargets = ambientTileTargetsForContext({ terrain: 'plains' });
let activeAmbientSignature = '';
let activeMusicMode = 'exploration';
let combatEngaged = false;

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

export function musicLayerTargetsForMode(mode = 'exploration', levels = MUSIC_LAYER_LEVELS) {
  const mix = MUSIC_MODE_MIXES[mode] || MUSIC_MODE_MIXES.exploration;
  const targets = {};

  for (const key of Object.keys(MUSIC_LAYER_LEVELS)) {
    const level = Number.isFinite(levels[key]) ? levels[key] : MUSIC_LAYER_LEVELS[key];
    targets[key] = Math.max(MUSIC_LAYER_FLOOR, level * (mix[key] || 0));
  }

  return targets;
}

export function ambientTileTargetsForContext(context = {}, levels = AMBIENT_TILE_LEVELS) {
  const terrain = context.terrain || 'plains';
  const blight = Number(context.blight || 0);
  const weights = { wind: 0, water: 0, crows: 0, hammering: 0 };
  const wet = terrain === 'river' || terrain === 'marsh' || context.nearWater || context.nearMarsh;
  const blighted = terrain === 'blight' || blight >= 4 || context.blighted;
  const openAir = ['plains', 'hills', 'mountains', 'forest', 'ruins'].includes(terrain);

  if (terrain === 'plains') weights.wind = 1;
  else if (openAir) weights.wind = 0.42;
  if (wet) {
    weights.water = terrain === 'river' ? 1 : 0.74;
    weights.wind = Math.max(weights.wind, 0.18);
  }
  if (blighted) {
    weights.crows = 1;
    weights.wind = Math.max(weights.wind, 0.16);
    weights.water *= 0.25;
  }
  if (context.construction || context.nearConstruction) {
    weights.hammering = 1;
    weights.wind = Math.max(Math.min(weights.wind, 0.42), 0.24);
  }
  if (!weights.wind && !weights.water && !weights.crows && !weights.hammering) weights.wind = 0.35;

  return Object.fromEntries(Object.keys(AMBIENT_TILE_LEVELS).map((key) => {
    const level = Number.isFinite(levels[key]) ? levels[key] : AMBIENT_TILE_LEVELS[key];
    return [key, Math.max(AMBIENT_LAYER_FLOOR, level * (weights[key] || 0))];
  }));
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
  return busVolumes.master;
}

export function getBusVolumes() {
  return { ...busVolumes };
}

export function setAudioVolume(nextVolume) {
  busVolumes.master = normalizeVolume(nextVolume);
  applyBusGain('master');
  return busVolumes.master;
}

export function setBusVolume(busId, nextVolume) {
  if (!BUS_IDS.includes(busId)) return busVolumes;
  busVolumes[busId] = normalizeVolume(nextVolume);
  applyBusGain(busId);
  return busVolumes;
}

export function setAudioEnabled(nextEnabled, storage = null) {
  enabled = Boolean(nextEnabled);
  const store = storage || safeStorage();
  try {
    store?.setItem(AUDIO_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Storage can be blocked in private or embedded browser contexts.
  }

  if (enabled) startMusicLayers();
  if (enabled) {
    startAmbientLayers();
    crossfadeAmbientLayers(activeAmbientTargets);
  } else {
    stopMusicLayers();
    stopAmbientLayers();
  }

  return enabled;
}

export function toggleAudio(storage = null) {
  return setAudioEnabled(!enabled, storage);
}

export function playAudioCue(id) {
  if (!enabled) return false;
  const cue = AUDIO_CUES[id] || AUDIO_CUES.ui;
  const context = ensureMixer();
  if (!context || !buses.master) return false;

  startMusicLayers();
  const bus = buses[cue.bus || 'sfx'] || buses.sfx;
  const now = context.currentTime + 0.012;
  const spacing = cue.spacing ?? 0.045;

  cue.notes.forEach((frequency, index) => {
    const startAt = now + spacing * index;
    const stopAt = startAt + cue.duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = cue.type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (cue.slide) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(70, frequency + cue.slide), stopAt);
    }

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(cue.gain, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    oscillator.connect(gain);
    gain.connect(bus);
    oscillator.start(startAt);
    oscillator.stop(stopAt + 0.02);
  });

  if (cue.noise) playNoise(context, bus, now, cue.gain * 0.55);
  return true;
}

export function updateDynamicMusic({ marchCountdown = 99, inCombat = false } = {}) {
  combatEngaged = inCombat;
  let mode = 'exploration';
  if (inCombat) mode = 'combat';
  else if (marchCountdown <= 3) mode = 'tension';
  if (mode !== activeMusicMode) {
    activeMusicMode = mode;
    crossfadeMusicLayers(mode);
  }
}

export function notifyCombatEngaged(active = true) {
  updateDynamicMusic({ inCombat: active });
}

export function updateAmbientTileSound(context = {}) {
  const targets = ambientTileTargetsForContext(context);
  const signature = ambientTargetSignature(targets);
  activeAmbientTargets = targets;
  if (signature === activeAmbientSignature) return targets;

  activeAmbientSignature = signature;
  if (!enabled) return targets;
  startAmbientLayers();
  crossfadeAmbientLayers(targets);
  return targets;
}

function ensureMixer() {
  const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass();
    buses = {};
    for (const busId of BUS_IDS) {
      const gain = audioContext.createGain();
      gain.gain.value = busVolumes[busId] / 100;
      buses[busId] = gain;
    }
    buses.sfx.connect(buses.master);
    buses.ambient.connect(buses.master);
    buses.music.connect(buses.master);
    buses.ui.connect(buses.master);
    buses.master.connect(audioContext.destination);
  }

  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function applyBusGain(busId) {
  const context = audioContext;
  const bus = buses[busId];
  if (!context || !bus) return;
  bus.gain.setTargetAtTime(busVolumes[busId] / 100, context.currentTime, 0.025);
}

function startMusicLayers() {
  const context = ensureMixer();
  if (!context || musicLayers.exploration) return;

  musicLayers.exploration = createMusicBed(context, 65.41, 98, MUSIC_LAYER_LEVELS.exploration);
  musicLayers.tension = createMusicBed(context, 73.42, 110, MUSIC_LAYER_LEVELS.tension, true);
  musicLayers.combat = createPercussionBed(context, MUSIC_LAYER_LEVELS.combat);
  crossfadeMusicLayers(activeMusicMode);
}

function stopMusicLayers() {
  for (const layer of Object.values(musicLayers)) {
    if (!layer) continue;
    for (const node of layer.nodes) {
      try {
        if (typeof node.stop === 'function') node.stop();
        node.disconnect();
      } catch {
        // Already stopped.
      }
    }
  }
  musicLayers = { exploration: null, tension: null, combat: null };
}

function startAmbientLayers() {
  const context = ensureMixer();
  if (!context || ambientLayers.wind) return;

  ambientLayers.wind = createAmbientBed(context, [
    { frequency: 92, type: 'sine' },
    { frequency: 137, type: 'triangle' }
  ], AMBIENT_TILE_LEVELS.wind);
  ambientLayers.water = createAmbientBed(context, [
    { frequency: 174, type: 'sine' },
    { frequency: 261.63, type: 'triangle' }
  ], AMBIENT_TILE_LEVELS.water);
  ambientLayers.crows = createAmbientBed(context, [
    { frequency: 587.33, type: 'sawtooth' },
    { frequency: 739.99, type: 'square' }
  ], AMBIENT_TILE_LEVELS.crows);
  ambientLayers.hammering = createAmbientBed(context, [
    { frequency: 82.41, type: 'square' },
    { frequency: 164.81, type: 'square' }
  ], AMBIENT_TILE_LEVELS.hammering);
  crossfadeAmbientLayers(activeAmbientTargets);
}

function stopAmbientLayers() {
  for (const layer of Object.values(ambientLayers)) {
    if (!layer) continue;
    for (const node of layer.nodes) {
      try {
        if (typeof node.stop === 'function') node.stop();
        node.disconnect();
      } catch {
        // Already stopped.
      }
    }
  }
  ambientLayers = { wind: null, water: null, crows: null, hammering: null };
}

function createMusicBed(context, lowFreq, highFreq, gainLevel, muted = true) {
  const gain = context.createGain();
  const startingGain = muted ? MUSIC_LAYER_FLOOR : gainLevel;
  gain.gain.value = startingGain;
  gain.connect(buses.ambient);

  const low = context.createOscillator();
  const high = context.createOscillator();
  low.type = 'sine';
  high.type = 'triangle';
  low.frequency.value = lowFreq;
  high.frequency.value = highFreq;
  low.connect(gain);
  high.connect(gain);
  low.start();
  high.start();

  return { gain, nodes: [low, high, gain], level: gainLevel, target: startingGain };
}

function createPercussionBed(context, gainLevel) {
  const gain = context.createGain();
  gain.gain.value = MUSIC_LAYER_FLOOR;
  gain.connect(buses.music);

  const pulse = context.createOscillator();
  pulse.type = 'square';
  pulse.frequency.value = 2.4;
  const pulseGain = context.createGain();
  pulseGain.gain.value = gainLevel;
  pulse.connect(pulseGain);
  pulseGain.connect(gain);
  pulse.start();

  return { gain, nodes: [pulse, pulseGain, gain], level: gainLevel, target: MUSIC_LAYER_FLOOR };
}

function createAmbientBed(context, voices, gainLevel) {
  const gain = context.createGain();
  gain.gain.value = AMBIENT_LAYER_FLOOR;
  gain.connect(buses.ambient);
  const oscillators = voices.map((voice) => {
    const oscillator = context.createOscillator();
    oscillator.type = voice.type;
    oscillator.frequency.value = voice.frequency;
    oscillator.detune.value = voice.detune || 0;
    oscillator.connect(gain);
    oscillator.start();
    return oscillator;
  });
  return { gain, nodes: [...oscillators, gain], level: gainLevel, target: AMBIENT_LAYER_FLOOR };
}

function crossfadeMusicLayers(mode) {
  const context = audioContext;
  if (!context) return;
  const now = context.currentTime;
  const targets = musicLayerTargetsForMode(mode, currentMusicLayerLevels());

  for (const [key, layer] of Object.entries(musicLayers)) {
    if (!layer?.gain) continue;
    scheduleLayerCrossfade(layer, targets[key], now, MUSIC_CROSSFADE_SECONDS);
  }
}

function crossfadeAmbientLayers(targets) {
  const context = audioContext;
  if (!context) return;
  const now = context.currentTime;
  for (const [key, layer] of Object.entries(ambientLayers)) {
    if (!layer?.gain) continue;
    scheduleLayerCrossfade(layer, targets[key], now, AMBIENT_TILE_FADE_SECONDS);
  }
}

function currentMusicLayerLevels() {
  const levels = { ...MUSIC_LAYER_LEVELS };
  for (const [key, layer] of Object.entries(musicLayers)) {
    if (Number.isFinite(layer?.level)) levels[key] = layer.level;
  }
  return levels;
}

function scheduleLayerCrossfade(layer, target, now, fadeSeconds = MUSIC_CROSSFADE_SECONDS) {
  const gainParam = layer.gain.gain;
  const safeTarget = Math.max(MUSIC_LAYER_FLOOR, target);

  try {
    if (typeof gainParam.cancelAndHoldAtTime === 'function') {
      gainParam.cancelAndHoldAtTime(now);
    } else {
      const current = Number.isFinite(gainParam.value) ? gainParam.value : layer.target;
      gainParam.cancelScheduledValues(now);
      gainParam.setValueAtTime(Math.max(MUSIC_LAYER_FLOOR, current || MUSIC_LAYER_FLOOR), now);
    }
    gainParam.linearRampToValueAtTime(safeTarget, now + fadeSeconds);
    layer.target = safeTarget;
  } catch {
    gainParam.setTargetAtTime(safeTarget, now, fadeSeconds / 3);
    layer.target = safeTarget;
  }
}

function ambientTargetSignature(targets) {
  return Object.entries(targets)
    .map(([key, value]) => `${key}:${Number(value || 0).toFixed(5)}`)
    .join('|');
}

function playNoise(context, bus, startAt, gainLevel) {
  const length = Math.floor(context.sampleRate * 0.05);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i += 1) {
    const falloff = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * falloff;
  }

  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.setValueAtTime(gainLevel, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.05);
  source.connect(gain);
  gain.connect(bus);
  source.start(startAt);
  source.stop(startAt + 0.055);
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
