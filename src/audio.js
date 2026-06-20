export const AUDIO_STORAGE_KEY = 'olundar.audio.enabled';
export const DEFAULT_AUDIO_VOLUME = 58;

export {
  AUDIO_CUES,
  validateAudioCueRegistry,
  initAudioPreference,
  audioIsEnabled,
  getAudioVolume,
  getBusVolumes,
  setAudioVolume,
  setBusVolume,
  setAudioEnabled,
  toggleAudio,
  playAudioCue,
  updateDynamicMusic
} from './engine/audio.js';
