export const AUDIO_STORAGE_KEY = 'olundar.audio.enabled';
export const AUDIO_BUS_STORAGE_KEY = 'olundar.audio.buses';
export const DEFAULT_AUDIO_VOLUME = 58;

export const AUDIO_BUSES = ['sfx', 'ambient', 'music', 'ui'];

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
  tension: { notes: [110, 98, 87], duration: 0.12, spacing: 0.07, type: 'sawtooth', gain: 0.022, bus: 'music' }
};

const DEFAULT_BUS_VOLUMES = { sfx: 88, ambient: 72, music: 64, ui: 80 };

let audioContext = null;
let masterGain = null;
let busGains = {};
let ambientNodes = [];
let musicNodes = [];
let enabled = false;
let volume = DEFAULT_AUDIO_VOLUME;
let busVolumes = { ...DEFAULT_BUS_VOLUMES };
let musicLayer = 'explore';
let combatActive = false;

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
    if (cue.bus && !AUDIO_BUSES.includes(cue.bus)) {
      throw new Error(`${id} references unknown bus ${cue.bus}.`);
    }
    for (const note of cue.notes) {
      if (!Number.isFinite(note) || note < 70 || note > 1200) {
        throw new Error(`${id} has an out-of-range note.`);
      }
    }
    totalDuration += cue.duration + spacing * Math.max(0, cue.notes.length - 1);
  }

  return { count: ids.length, ids, totalDuration: Number(totalDuration.toFixed(3)), buses: AUDIO_BUSES };
}

export function initAudioPreference(storage = null) {
  const store = storage || safeStorage();
  enabled = store?.getItem(AUDIO_STORAGE_KEY) === 'true';
  try {
    const savedBuses = JSON.parse(store?.getItem(AUDIO_BUS_STORAGE_KEY) || '{}');
    busVolumes = { ...DEFAULT_BUS_VOLUMES, ...normalizeBusVolumes(savedBuses) };
  } catch {
    busVolumes = { ...DEFAULT_BUS_VOLUMES };
  }
  return enabled;
}

export function audioIsEnabled() {
  return enabled;
}

export function getAudioVolume() {
  return volume;
}

export function getBusVolumes() {
  return { ...busVolumes };
}

export function setAudioVolume(nextVolume) {
  volume = normalizeVolume(nextVolume);
  applyMasterGain();
  return volume;
}

export function setBusVolume(bus, value) {
  if (!AUDIO_BUSES.includes(bus)) return busVolumes;
  busVolumes[bus] = normalizeVolume(value);
  applyBusGain(bus);
  persistBusVolumes();
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

  if (enabled) {
    startAmbient();
    updateMusicLayers();
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
  const context = ensureAudioContext();
  if (!context || !masterGain) return false;

  startAmbient();
  updateMusicLayers();
  const bus = cue.bus || 'sfx';
  const busGain = busGains[bus] || masterGain;
  const now = context.currentTime + 0.012;
  const spacing = cue.spacing ?? 0.045;
  const busLevel = (busVolumes[bus] ?? 80) / 100;

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
    gain.gain.exponentialRampToValueAtTime(cue.gain * busLevel, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    oscillator.connect(gain);
    gain.connect(busGain);
    oscillator.start(startAt);
    oscillator.stop(stopAt + 0.02);
  });

  if (cue.noise) playNoise(context, now, cue.gain * busLevel * 0.55, busGain);
  return true;
}

export function setMusicLayer(layer) {
  musicLayer = layer;
  updateMusicLayers();
}

export function setCombatMusicActive(active) {
  combatActive = Boolean(active);
  updateMusicLayers();
}

export function updateDynamicMusic(state) {
  if (!enabled || !state) return;
  const marchTurns = state.deadwalker?.nextMarchTurn ? state.deadwalker.nextMarchTurn - state.turn : 99;
  if (marchTurns <= 3) setMusicLayer('tension');
  else if (combatActive) setMusicLayer('combat');
  else setMusicLayer('explore');
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function ensureAudioContext() {
  const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = volume / 100;
    masterGain.connect(audioContext.destination);
    for (const bus of AUDIO_BUSES) {
      const gain = audioContext.createGain();
      gain.gain.value = (busVolumes[bus] ?? 80) / 100;
      gain.connect(masterGain);
      busGains[bus] = gain;
    }
  }

  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function applyMasterGain() {
  if (masterGain && audioContext) {
    masterGain.gain.setTargetAtTime(volume / 100, audioContext.currentTime, 0.025);
  }
}

function applyBusGain(bus) {
  const gain = busGains[bus];
  if (gain && audioContext) {
    gain.gain.setTargetAtTime((busVolumes[bus] ?? 80) / 100, audioContext.currentTime, 0.025);
  }
}

function persistBusVolumes() {
  try {
    safeStorage()?.setItem(AUDIO_BUS_STORAGE_KEY, JSON.stringify(busVolumes));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeVolume(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUDIO_VOLUME;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeBusVolumes(value = {}) {
  const out = { ...DEFAULT_BUS_VOLUMES };
  for (const bus of AUDIO_BUSES) {
    if (value[bus] !== undefined) out[bus] = normalizeVolume(value[bus]);
  }
  return out;
}

function startAmbient() {
  if (ambientNodes.length) return true;
  const context = ensureAudioContext();
  if (!context || !busGains.ambient) return false;

  const now = context.currentTime;
  const bedGain = context.createGain();
  const lowDrone = context.createOscillator();
  const highDrone = context.createOscillator();
  const lfo = context.createOscillator();
  const lfoGain = context.createGain();

  bedGain.gain.setValueAtTime(0.0001, now);
  bedGain.gain.linearRampToValueAtTime(0.018, now + 0.7);
  lowDrone.type = 'sine';
  lowDrone.frequency.value = 65.41;
  highDrone.type = 'triangle';
  highDrone.frequency.value = 98;
  lfo.type = 'sine';
  lfo.frequency.value = 0.045;
  lfoGain.gain.value = 0.004;

  lfo.connect(lfoGain);
  lfoGain.connect(bedGain.gain);
  lowDrone.connect(bedGain);
  highDrone.connect(bedGain);
  bedGain.connect(busGains.ambient);

  lowDrone.start(now);
  highDrone.start(now);
  lfo.start(now);
  ambientNodes = [lowDrone, highDrone, lfo, lfoGain, bedGain];
  return true;
}

function stopAmbient() {
  stopNodeList(ambientNodes);
  ambientNodes = [];
}

function updateMusicLayers() {
  if (!enabled) return;
  stopMusicLayers();
  const context = ensureAudioContext();
  if (!context || !busGains.music) return;
  const now = context.currentTime;
  const bedGain = context.createGain();
  bedGain.gain.setValueAtTime(0.0001, now);
  bedGain.gain.linearRampToValueAtTime(musicLayer === 'tension' ? 0.03 : 0.02, now + 0.5);
  const osc = context.createOscillator();
  osc.type = musicLayer === 'combat' ? 'triangle' : 'sine';
  osc.frequency.value = musicLayer === 'tension' ? 92 : musicLayer === 'combat' ? 110 : 73;
  osc.connect(bedGain);
  bedGain.connect(busGains.music);
  osc.start(now);
  musicNodes = [osc, bedGain];
}

function stopMusicLayers() {
  stopNodeList(musicNodes);
  musicNodes = [];
}

function stopNodeList(nodes) {
  const context = audioContext;
  for (const node of nodes) {
    try {
      if (typeof node.stop === 'function') node.stop(context ? context.currentTime + 0.03 : 0);
    } catch {
      // Already stopped nodes throw in some browsers.
    }
    try {
      node.disconnect();
    } catch {
      // Disconnected nodes are harmless.
    }
  }
}

function playNoise(context, startAt, gainLevel, destination) {
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
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + 0.055);
}
