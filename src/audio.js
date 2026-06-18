export const AUDIO_STORAGE_KEY = 'olundar.audio.enabled';
export const DEFAULT_AUDIO_VOLUME = 58;

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

let audioContext = null;
let masterGain = null;
let ambientNodes = [];
let enabled = false;
let volume = DEFAULT_AUDIO_VOLUME;

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

export function setAudioVolume(nextVolume) {
  volume = normalizeVolume(nextVolume);
  if (masterGain && audioContext) {
    const target = volume / 100;
    masterGain.gain.setTargetAtTime(target, audioContext.currentTime, 0.025);
  }
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

  if (enabled) startAmbient();
  else stopAmbient();

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
    gain.connect(masterGain);
    oscillator.start(startAt);
    oscillator.stop(stopAt + 0.02);
  });

  if (cue.noise) playNoise(context, now, cue.gain * 0.55);
  return true;
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
  }

  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function normalizeVolume(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUDIO_VOLUME;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function startAmbient() {
  if (ambientNodes.length) return true;
  const context = ensureAudioContext();
  if (!context || !masterGain) return false;

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
  bedGain.connect(masterGain);

  lowDrone.start(now);
  highDrone.start(now);
  lfo.start(now);
  ambientNodes = [lowDrone, highDrone, lfo, lfoGain, bedGain];
  return true;
}

function stopAmbient() {
  const context = audioContext;
  for (const node of ambientNodes) {
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
  ambientNodes = [];
}

function playNoise(context, startAt, gainLevel) {
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
  gain.connect(masterGain);
  source.start(startAt);
  source.stop(startAt + 0.055);
}
