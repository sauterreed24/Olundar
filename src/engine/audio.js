import { AUDIO_CUES as LEGACY_CUES } from '../audio.js';

const BUS_IDS = ['master', 'sfx', 'ambient', 'music', 'ui'];

export class AudioMixer {
  constructor() {
    this.context = null;
    this.buses = {};
    this.enabled = false;
    this.volumes = { master: 58, sfx: 100, ambient: 70, music: 65, ui: 85 };
    this.layers = { exploration: null, tension: null, combat: null };
    this.layerState = { tension: false, combat: false };
  }

  ensureContext() {
    if (this.context) return this.context;
    if (typeof window === 'undefined') return null;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    this.context = new AudioContextCtor();
    for (const id of BUS_IDS) {
      const gain = this.context.createGain();
      gain.gain.value = this.busGain(id);
      gain.connect(this.context.destination);
      this.buses[id] = gain;
    }
    return this.context;
  }

  busGain(id) {
    const master = this.volumes.master / 100;
    if (id === 'master') return master;
    return master * (this.volumes[id] / 100);
  }

  setBusVolume(id, value) {
    if (!BUS_IDS.includes(id)) return;
    this.volumes[id] = clamp(value, 0, 100);
    const bus = this.buses[id];
    if (bus && this.context) {
      bus.gain.setTargetAtTime(this.busGain(id), this.context.currentTime, 0.02);
    }
    if (id === 'master') {
      for (const other of BUS_IDS) {
        if (other === 'master') continue;
        const node = this.buses[other];
        if (node) node.gain.setTargetAtTime(this.busGain(other), this.context.currentTime, 0.02);
      }
    }
  }

  setEnabled(next) {
    this.enabled = Boolean(next);
    if (this.enabled) {
      this.ensureContext();
      this.startAmbientLayers();
    } else {
      this.stopAmbientLayers();
    }
    return this.enabled;
  }

  routeBus(cueId) {
    if (cueId === 'turn' || cueId === 'warning' || cueId === 'fanfare') return 'music';
    if (cueId === 'ui' || cueId === 'select' || cueId === 'save' || cueId === 'load' || cueId === 'error') return 'ui';
    if (cueId === 'diplomacy') return 'ambient';
    return 'sfx';
  }

  playCue(cueId, registry = LEGACY_CUES) {
    if (!this.enabled) return;
    const cue = registry[cueId];
    if (!cue) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') ctx?.resume?.();
    const bus = this.buses[this.routeBus(cueId)] || this.buses.sfx;
    const start = ctx.currentTime;
    cue.notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cue.type;
      osc.frequency.setValueAtTime(freq, start + index * (cue.spacing || 0.045));
      if (cue.slide) osc.frequency.linearRampToValueAtTime(freq + cue.slide, start + index * (cue.spacing || 0.045) + cue.duration);
      gain.gain.setValueAtTime(0.0001, start + index * (cue.spacing || 0.045));
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, cue.gain), start + index * (cue.spacing || 0.045) + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * (cue.spacing || 0.045) + cue.duration);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(start + index * (cue.spacing || 0.045));
      osc.stop(start + index * (cue.spacing || 0.045) + cue.duration + 0.02);
    });
  }

  startAmbientLayers() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopAmbientLayers();
    this.layers.exploration = this.createDrone([110, 165], 0.012, this.buses.ambient);
    this.layers.tension = this.createDrone([98, 123], 0.008, this.buses.music);
    this.layers.combat = this.createPercussion(this.buses.sfx);
    this.setLayerActive('tension', false);
    this.setLayerActive('combat', false);
  }

  stopAmbientLayers() {
    for (const layer of Object.values(this.layers)) {
      if (!layer) continue;
      for (const node of layer.nodes || []) {
        try { node.stop?.(); node.disconnect?.(); } catch { /* noop */ }
      }
    }
    this.layers = { exploration: null, tension: null, combat: null };
  }

  createDrone(freqs, gainValue, bus) {
    const ctx = this.context;
    const nodes = freqs.map((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = gainValue;
      osc.connect(gain);
      gain.connect(bus);
      osc.start();
      return { osc, gain };
    });
    return { nodes, active: true };
  }

  createPercussion(bus) {
    const ctx = this.context;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    const timer = setInterval(() => {
      if (!this.layerState.combat || !this.enabled) return;
      const click = ctx.createOscillator();
      const clickGain = ctx.createGain();
      click.type = 'triangle';
      click.frequency.value = 180;
      clickGain.gain.value = 0.02;
      click.connect(clickGain);
      clickGain.connect(gain);
      click.start();
      click.stop(ctx.currentTime + 0.05);
    }, 520);
    return { nodes: [{ gain }], timer, active: false };
  }

  setLayerActive(name, active) {
    this.layerState[name] = active;
    const layer = this.layers[name];
    if (!layer) return;
    const ctx = this.context;
    const target = active ? (name === 'combat' ? 0.03 : 0.018) : 0.0001;
    for (const node of layer.nodes) {
      node.gain?.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    }
    layer.active = active;
  }

  updateMusicLayers({ marchCountdown = null, inCombat = false } = {}) {
    if (!this.enabled) return;
    const tension = Number.isFinite(marchCountdown) && marchCountdown <= 3;
    if (tension !== this.layerState.tension) this.setLayerActive('tension', tension);
    if (inCombat !== this.layerState.combat) this.setLayerActive('combat', inCombat);
  }
}

let mixer = null;

export function getAudioMixer() {
  if (!mixer) mixer = new AudioMixer();
  return mixer;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
