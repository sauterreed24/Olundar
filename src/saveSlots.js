export const MAX_SAVE_SLOTS = 8;

export function sanitizeSlotName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 48);
}

export function defaultSaveSlotName(state) {
  const campaign = state.campaign?.scenarioName || 'Olundar';
  const difficulty = state.campaign?.difficultyName || 'Campaign';
  return `${campaign} - ${difficulty}`;
}

export function createSaveSlot(state, serializedState, options = {}) {
  const now = options.now || new Date().toISOString();
  const name = sanitizeSlotName(options.name) || defaultSaveSlotName(state);
  return {
    id: options.id || `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    savedAt: now,
    turn: state.turn,
    status: state.status,
    scenarioName: state.campaign?.scenarioName || 'Unknown scenario',
    difficultyName: state.campaign?.difficultyName || 'Unknown difficulty',
    seed: state.seed || state.campaign?.seed || 'Unknown seed',
    data: String(serializedState || '')
  };
}

export function parseSaveSlots(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortSaveSlots(parsed.filter(isValidSaveSlot).map(normalizeSlot)).slice(0, MAX_SAVE_SLOTS);
  } catch {
    return [];
  }
}

export function serializeSaveSlots(slots) {
  return JSON.stringify(sortSaveSlots(slots.filter(isValidSaveSlot)).slice(0, MAX_SAVE_SLOTS));
}

export function upsertSaveSlot(slots, slot) {
  const existing = slots.filter((item) => item.id !== slot.id);
  return sortSaveSlots([normalizeSlot(slot), ...existing]).slice(0, MAX_SAVE_SLOTS);
}

export function removeSaveSlot(slots, slotId) {
  return slots.filter((slot) => slot.id !== slotId);
}

function normalizeSlot(slot) {
  return {
    ...slot,
    name: sanitizeSlotName(slot.name) || 'Unnamed campaign',
    savedAt: slot.savedAt || new Date(0).toISOString(),
    turn: Number.isFinite(Number(slot.turn)) ? Number(slot.turn) : 1,
    status: slot.status || 'playing',
    scenarioName: slot.scenarioName || 'Unknown scenario',
    difficultyName: slot.difficultyName || 'Unknown difficulty',
    seed: slot.seed || 'Unknown seed',
    data: String(slot.data || '')
  };
}

function sortSaveSlots(slots) {
  return [...slots].sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
}

function isValidSaveSlot(slot) {
  return Boolean(slot && typeof slot.id === 'string' && slot.id && typeof slot.data === 'string' && slot.data);
}
