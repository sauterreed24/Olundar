import { serializeState, deserializeState } from '../rules.js';

export class CommandHistory {
  constructor(limit = 80) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  push(command) {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(state) {
    const command = this.undoStack.pop();
    if (!command) return { ok: false, reason: 'Nothing to undo.' };
    command.undo(state);
    this.redoStack.push(command);
    return { ok: true, label: command.label };
  }

  redo(state) {
    const command = this.redoStack.pop();
    if (!command) return { ok: false, reason: 'Nothing to redo.' };
    const result = command.execute(state);
    if (!result?.ok) {
      this.redoStack.push(command);
      return result;
    }
    this.undoStack.push(command);
    return result;
  }
}

export class Command {
  constructor({ label, execute, undo, meta = {} }) {
    this.label = label;
    this.execute = execute;
    this.undo = undo;
    this.meta = meta;
  }
}

function snapshotState(state) {
  return serializeState(state);
}

function restoreState(state, snapshot) {
  Object.assign(state, deserializeState(snapshot));
}

export function createMoveCommand(state, unitId, x, y, moveFn) {
  const before = snapshotState(state);
  return new Command({
    label: 'Move',
    meta: { kind: 'move', unitId, x, y },
    execute: (game) => moveFn(game, unitId, x, y),
    undo: (game) => restoreState(game, before)
  });
}

export function createAttackCommand(state, attackerId, targetId, attackFn) {
  const before = snapshotState(state);
  return new Command({
    label: 'Attack',
    meta: { kind: 'attack', attackerId, targetId },
    execute: (game) => attackFn(game, attackerId, targetId),
    undo: (game) => restoreState(game, before)
  });
}

export function createBuildCommand(state, builderId, buildingType, x, y, buildFn) {
  const before = snapshotState(state);
  return new Command({
    label: 'Build',
    meta: { kind: 'build', builderId, buildingType, x, y },
    execute: (game) => buildFn(game, builderId, buildingType, x, y),
    undo: (game) => restoreState(game, before)
  });
}

export function createTrainCommand(state, buildingId, unitType, trainFn) {
  const before = snapshotState(state);
  return new Command({
    label: 'Train',
    meta: { kind: 'train', buildingId, unitType },
    execute: (game) => trainFn(game, buildingId, unitType),
    undo: (game) => restoreState(game, before)
  });
}

export function createUpgradeCommand(state, buildingId, upgradeFn) {
  const before = snapshotState(state);
  return new Command({
    label: 'Upgrade',
    meta: { kind: 'upgrade', buildingId },
    execute: (game) => upgradeFn(game, buildingId),
    undo: (game) => restoreState(game, before)
  });
}

export function createDiplomacyCommand(state, factionId, actionId, diplomacyFn) {
  const before = snapshotState(state);
  return new Command({
    label: 'Diplomacy',
    meta: { kind: 'diplomacy', factionId, actionId },
    execute: (game) => diplomacyFn(game, factionId, actionId),
    undo: (game) => restoreState(game, before)
  });
}

export function createCrisisCommand(state, eventId, choiceId, crisisFn) {
  const before = snapshotState(state);
  return new Command({
    label: 'Crisis Choice',
    meta: { kind: 'crisis', eventId, choiceId },
    execute: (game) => crisisFn(game, eventId, choiceId),
    undo: (game) => restoreState(game, before)
  });
}

export function runPlayerCommand(history, state, command) {
  const result = command.execute(state);
  if (result?.ok) history.push(command);
  return result;
}

export function validateUndoReversesAction(state, command) {
  const before = serializeState(state);
  const result = command.execute(state);
  if (!result?.ok) return { ok: false, reason: 'Command failed.' };
  command.undo(state);
  const afterUndo = serializeState(state);
  return { ok: before === afterUndo, before, afterUndo, result };
}
