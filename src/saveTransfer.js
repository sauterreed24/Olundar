import { deserializeState, serializeState } from './rules.js';
import { createSaveSlot, defaultSaveSlotName, sanitizeSlotName } from './saveSlots.js';

export function importedSlotName(state, fileName = '') {
  const cleanFileName = formatFileLabel(fileName);
  const fallback = defaultSaveSlotName(state);
  return sanitizeSlotName(`Imported ${cleanFileName || fallback}`);
}

export function importSaveSnapshot(raw, options = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Save file is empty.');

  const state = deserializeState(raw);
  const serialized = serializeState(state);
  const slot = createSaveSlot(state, serialized, {
    id: options.id,
    name: options.name || importedSlotName(state, options.fileName),
    now: options.now
  });

  return { state, serialized, slot };
}

function formatFileLabel(fileName) {
  return sanitizeSlotName(String(fileName).replace(/\.json$/i, '').replace(/[-_]+/g, ' '))
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
