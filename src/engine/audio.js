export const AUDIO_STORAGE_KEY = 'olundar.audio.enabled';
export const AUDIO_BUS_STORAGE_KEY = 'olundar.audio.buses';
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
const DEFAULT_BUS_VOLUMES = { master: 58, sfx: 72, ambient: 48, music: 62, ui: 68 };

let audioContext = null;
let buses = {};
let enabled = false;
let musicLayers = { exploration: null, tension: null, combat: null };
let activeMusicMode = 'exploration';
let combatPulse = null;

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
  loadBusVolumes(store);
  return enabled;
}

export function audioIsEnabled() {
  return enabled;
}

export function getAudioVolume() {
  return buses.master?.volume ?? DEFAULT_BUS_VOLUMES.master;
}

export function getBusVolumes() {
  return BUS_IDS.reduce((acc, id) => {
    acc[id] = buses[id]?.volume ?? DEFAULT_BUS_VOLUMES[id] ?? 58;
    return acc;
  }, {});
}

export function setAudioVolume(nextVolume) {
  return setBusVolume('master', nextVolume);
}

export function setBusVolume(busId, nextVolume) {
  if (!BUS_IDS.includes(busId)) return getBusVolumes();
  const volume = normalizeVolume(nextVolume);
  ensureMixer();
  buses[busId].volume = volume;
  if (buses[busId].gain && audioContext) {
    buses[busId].gain.gain.setTargetAtTime(volume / 100, audioContext.currentTime, 0.025);
  }
  persistBusVolumes();
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

  if (enabled) {
    startAmbient();
    setMusicMode(activeMusicMode);
  } else {
    stopAmbient();
    stopMusicLayers();
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
  if (!context) return false;

  startAmbient();
  const bus = buses[cue.bus || 'sfx']?.gain || buses.master.gain;
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
  if (id === 'attack') setMusicMode('combat');
  return true;
}

export function updateDynamicMusic(state) {
  if (!enabled) return;
  const turnsToMarch = Math.max(0, (state?.deadwalker?.nextMarchTurn ?? 99) - (state?.turn ?? 1));
  if (turnsToMarch <= 3) setMusicMode('tension');
  else if (activeMusicMode === 'combat' && performance.now() - (combatPulse || 0) > 4000) setMusicMode('exploration');
  else if (activeMusicMode !== 'combat') setMusicMode('exploration');
}

export function setMusicMode(mode = 'exploration') {
  activeMusicMode = mode;
  if (!enabled) return;
  ensureMixer();
  stopMusicLayers();
  const now = audioContext.currentTime;
  if (mode === 'exploration') musicLayers.exploration = startMusicBed([65.41, 98], [0.014, 0.008], now);
  if (mode === 'tension') musicLayers.tension = startMusicBed([73.42, 110], [0.02, 0.012], now, 0.06);
  if (mode === 'combat') {
    musicLayers.combat = startMusicBed([82.41, 123.47], [0.024, 0.016], now, 0.08);
    combatPulse = performance.now();
  }
}

function ensureMixer() {
  const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass();
    buses = {};
    for (const id of BUS_IDS) {
      const gain = audioContext.createGain();
      gain.gain.value = (buses[id]?.volume ?? DEFAULT_BUS_VOLUMES[id] ?? 58) / 100;
      buses[id] = { gain, volume: buses[id]?.volume ?? DEFAULT_BUS_VOLUMES[id] ?? 58 };
    }
    buses.sfx.gain.connect(buses.master.gain);
    buses.ambient.gain.connect(buses.master.gain);
    buses.music.gain.connect(buses.master.gain);
    buses.ui.gain.connect(buses.master.gain);
    buses.master.gain.connect(audioContext.destination);
    loadBusVolumes();
  }

  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function startMusicBed(lowPair, gainPair, now, lfoDepth = 0.004) {
  const bedGain = audioContext.createGain();
  const lowDrone = audioContext.createOscillator();
  const highDrone = audioContext.createOscillator();
  const lfo = audioContext.createOscillator();
  const lfoGain = audioContext.createGain();

  bedGain.gain.setValueAtTime(0.0001, now);
  bedGain.gain.linearRampToValueAtTime(gainPair[0], now + 0.8);
  lowDrone.type = 'sine';
  lowDrone.frequency.value = lowPair[0];
  highDrone.type = 'triangle';
  highDrone.frequency.value = lowPair[1];
  lfo.type = 'sine';
  lfo.frequency.value = modeLfo(activeMusicMode);
  lfoGain.gain.value = lfoDepth;

  lfo.connect(lfoGain);
  lfoGain.connect(bedGain.gain);
  lowDrone.connect(bedGain);
  highDrone.connect(bedGain);
  bedGain.connect(buses.music.gain);

  lowDrone.start(now);
  highDrone.start(now);
  lfo.start(now);
  return [lowDrone, highDrone, lfo, lfoGain, bedGain];
}

function modeLfo(mode) {
  if (mode === 'tension') return 0.12;
  if (mode === 'combat') return 0.22;
  return 0.045;
}

function stopMusicLayers() {
  for (const nodes of Object.values(musicLayers)) {
    if (!nodes) continue;
    for (const node of nodes) {
      try {
        if (typeof node.stop === 'function') node.stop(audioContext ? audioContext.currentTime + 0.03 : 0);
      } catch {
        // Already stopped.
      }
      try { node.disconnect(); } catch { /* noop */ }
    }
  }
  musicLayers = { exploration: null, tension: null, combat: null };
}

function startAmbient() {
  if (buses.ambient?.nodes?.length) return true;
  const context = ensureMixer();
  if (!context) return false;
  const now = context.currentTime;
  const nodes = startMusicBed([65.41, 98], [0.012, 0.006], now, 0.003);
  for (const node of nodes) {
    if (node.connect) {
      try { node.disconnect(); } catch { /* noop */ }
    }
  }
  const bedGain = nodes[4];
  bedGain.disconnect();
  bedGain.connect(buses.ambient.gain);
  buses.ambient.nodes = nodes;
  return true;
}

function stopAmbient() {
  const nodes = buses.ambient?.nodes || [];
  for (const node of nodes) {
    try {
      if (typeof node.stop === 'function') node.stop(audioContext ? audioContext.currentTime + 0.03 : 0);
    } catch { /* noop */ }
    try { node.disconnect(); } catch { /* noop */ }
  }
  if (buses.ambient) buses.ambient.nodes = [];
}

function loadBusVolumes(storage = null) {
  const store = storage || safeStorage();
  let parsed = {};
  try {
    parsed = JSON.parse(store?.getItem(AUDIO_BUS_STORAGE_KEY) || '{}');
  } catch {
    parsed = {};
  }
  for (const id of BUS_IDS) {
    const volume = normalizeVolume(parsed[id] ?? DEFAULT_BUS_VOLUMES[id] ?? 58);
    if (!buses[id]) buses[id] = { volume };
    else buses[id].volume = volume;
    if (buses[id].gain && audioContext) buses[id].gain.gain.value = volume / 100;
  }
}

function persistBusVolumes(storage = null) {
  const store = storage || safeStorage();
  try {
    store?.setItem(AUDIO_BUS_STORAGE_KEY, JSON.stringify(getBusVolumes()));
  } catch {
    // Storage unavailable.
  }
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
