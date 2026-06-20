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
  fanfare: { notes: [262, 330, 392, 523], duration: 0.1, spacing: 0.065, type: 'triangle', gain: 0.032, bus: 'music' }
};

const BUS_IDS = ['master', 'sfx', 'ambient', 'music', 'ui'];
const DEFAULT_BUS_VOLUMES = { master: 58, sfx: 72, ambient: 45, music: 55, ui: 68 };

let audioContext = null;
let buses = {};
let enabled = false;
let busVolumes = { ...DEFAULT_BUS_VOLUMES };
let musicLayers = { exploration: null, tension: null, combat: null };
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
  else stopMusicLayers();

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

  musicLayers.exploration = createMusicBed(context, 65.41, 98, 0.014);
  musicLayers.tension = createMusicBed(context, 73.42, 110, 0.008, true);
  musicLayers.combat = createPercussionBed(context, 0.01);
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

function createMusicBed(context, lowFreq, highFreq, gainLevel, muted = true) {
  const gain = context.createGain();
  gain.gain.value = muted ? 0.0001 : gainLevel;
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

  return { gain, nodes: [low, high, gain], level: gainLevel };
}

function createPercussionBed(context, gainLevel) {
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  gain.connect(buses.music);

  const pulse = context.createOscillator();
  pulse.type = 'square';
  pulse.frequency.value = 2.4;
  const pulseGain = context.createGain();
  pulseGain.gain.value = gainLevel;
  pulse.connect(pulseGain);
  pulseGain.connect(gain);
  pulse.start();

  return { gain, nodes: [pulse, pulseGain, gain], level: gainLevel };
}

function crossfadeMusicLayers(mode) {
  const context = audioContext;
  if (!context) return;
  const now = context.currentTime;
  const targets = { exploration: 0.0001, tension: 0.0001, combat: 0.0001 };
  if (mode === 'exploration') targets.exploration = musicLayers.exploration?.level || 0.014;
  if (mode === 'tension') targets.tension = musicLayers.tension?.level || 0.008;
  if (mode === 'combat') targets.combat = musicLayers.combat?.level || 0.01;

  for (const [key, layer] of Object.entries(musicLayers)) {
    if (!layer?.gain) continue;
    layer.gain.gain.setTargetAtTime(targets[key], now, 0.4);
  }
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
