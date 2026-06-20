/**
 * Command pattern for undoable player actions.
 */

import {
  attackBuilding,
  attackUnit,
  moveUnit,
  performDiplomacy,
  resolveCrisis,
  setFieldOrder,
  startConstruction,
  startTraining,
  upgradeBuilding,
  serializeState,
  deserializeState
} from '../rules.js';

export function createCommandHistory(limit = 64) {
  return {
    undoStack: [],
    redoStack: [],
    limit
  };
}

export class Command {
  constructor(executeFn, undoFn, label = 'action') {
    this.executeFn = executeFn;
    this.undoFn = undoFn;
    this.label = label;
  }

  execute(state) {
    return this.executeFn(state);
  }

  undo(state) {
    return this.undoFn(state);
  }
}

function snapshotState(state) {
  return deserializeState(serializeState(state));
}

export function pushCommand(history, command, state) {
  const before = snapshotState(state);
  const result = command.execute(state);
  if (result?.ok === false) return result;
  const after = snapshotState(state);
  history.undoStack.push({
    label: command.label,
    before,
    after,
    command
  });
  if (history.undoStack.length > history.limit) history.undoStack.shift();
  history.redoStack = [];
  return result;
}

export function undoCommand(history, state) {
  const entry = history.undoStack.pop();
  if (!entry) return { ok: false, message: 'Nothing to undo.' };
  Object.assign(state, deserializeState(serializeState(entry.before)));
  history.redoStack.push(entry);
  return { ok: true, message: `Undid ${entry.label}.` };
}

export function redoCommand(history, state) {
  const entry = history.redoStack.pop();
  if (!entry) return { ok: false, message: 'Nothing to redo.' };
  Object.assign(state, deserializeState(serializeState(entry.after)));
  history.undoStack.push(entry);
  return { ok: true, message: `Redid ${entry.label}.` };
}

export function createMoveCommand(unitId, x, y) {
  return new Command(
    (state) => moveUnit(state, unitId, x, y),
    () => ({ ok: true }),
    'move'
  );
}

export function createAttackUnitCommand(attackerId, targetId) {
  return new Command(
    (state) => attackUnit(state, attackerId, targetId),
    () => ({ ok: true }),
    'attack'
  );
}

export function createAttackBuildingCommand(attackerId, buildingId) {
  return new Command(
    (state) => attackBuilding(state, attackerId, buildingId),
    () => ({ ok: true }),
    'attack building'
  );
}

export function createBuildCommand(unitId, buildingType, x, y) {
  return new Command(
    (state) => startConstruction(state, unitId, buildingType, x, y),
    () => ({ ok: true }),
    'build'
  );
}

export function createTrainCommand(buildingId, unitType) {
  return new Command(
    (state) => startTraining(state, buildingId, unitType),
    () => ({ ok: true }),
    'train'
  );
}

export function createUpgradeCommand(buildingId) {
  return new Command(
    (state) => upgradeBuilding(state, buildingId),
    () => ({ ok: true }),
    'upgrade'
  );
}

export function createDiplomacyCommand(factionId, actionId) {
  return new Command(
    (state) => performDiplomacy(state, factionId, actionId),
    () => ({ ok: true }),
    'diplomacy'
  );
}

export function createFieldOrderCommand(factionId, orderId) {
  return new Command(
    (state) => setFieldOrder(state, factionId, orderId),
    () => ({ ok: true }),
    'field order'
  );
}

export function createCrisisCommand(crisisId, choiceId) {
  return new Command(
    (state) => resolveCrisis(state, crisisId, choiceId),
    () => ({ ok: true }),
    'crisis choice'
  );
}

export function executePlayerCommand(history, state, command) {
  return pushCommand(history, command, state);
}

export function validateUndoStack(history, state, replayFn) {
  if (!history.undoStack.length) return true;
  const probe = snapshotState(state);
  const entry = history.undoStack[history.undoStack.length - 1];
  Object.assign(probe, deserializeState(serializeState(entry.before)));
  const replay = replayFn(probe);
  return replay !== false;
}
