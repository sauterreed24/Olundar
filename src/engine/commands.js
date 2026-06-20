/**
 * Command pattern for undoable player actions.
 * All mutating player actions route through Command.execute().
 */

import {
  attackBuilding,
  attackUnit,
  moveUnit,
  performDiplomacy,
  fortifyUnit,
  resolveCrisis,
  resolvePromiseDemand,
  setFieldOrder,
  startConstruction,
  startTraining,
  upgradeBuilding,
  makeDiplomaticPromise
} from '../rules.js';
import { serializeState, deserializeState } from '../rules.js';

const MAX_HISTORY = 64;
const MAX_STACK_BYTES = 8 * 1024 * 1024;

export class CommandHistory {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.redoBytes = 0;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.redoBytes = 0;
  }

  execute(command, state) {
    const snapshot = serializeState(state);
    const result = command.run(state);
    if (result?.ok !== false) {
      this.pushUndo(historyEntry(command, snapshot));
      this.clearRedo();
    }
    return result;
  }

  undo(state) {
    const entry = this.popUndo();
    if (!entry) return { ok: false, reason: 'Nothing to undo.' };
    this.pushRedo(historyEntry(entry.command, serializeState(state)));
    applyState(state, deserializeState(entry.snapshot));
    return { ok: true, reason: entry.command.undoLabel || 'Undid last action.' };
  }

  redo(state) {
    const entry = this.popRedo();
    if (!entry) return { ok: false, reason: 'Nothing to redo.' };
    const snapshot = serializeState(state);
    const result = entry.command.run(state);
    if (result?.ok === false) {
      this.pushRedo(entry);
      return result;
    }
    this.pushUndo(historyEntry(entry.command, snapshot));
    return { ok: true, reason: entry.command.label || 'Redid action.' };
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  stats() {
    return {
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      undoBytes: this.undoBytes,
      redoBytes: this.redoBytes,
      maxHistory: MAX_HISTORY,
      maxStackBytes: MAX_STACK_BYTES
    };
  }

  pushUndo(entry) {
    this.undoStack.push(entry);
    this.undoBytes += entry.snapshotBytes;
    this.undoBytes = pruneHistoryStack(this.undoStack, this.undoBytes);
  }

  pushRedo(entry) {
    this.redoStack.push(entry);
    this.redoBytes += entry.snapshotBytes;
    this.redoBytes = pruneHistoryStack(this.redoStack, this.redoBytes);
  }

  popUndo() {
    const entry = this.undoStack.pop();
    if (entry) this.undoBytes -= entry.snapshotBytes;
    return entry;
  }

  popRedo() {
    const entry = this.redoStack.pop();
    if (entry) this.redoBytes -= entry.snapshotBytes;
    return entry;
  }

  clearRedo() {
    this.redoStack = [];
    this.redoBytes = 0;
  }
}

export class Command {
  constructor(type, payload, label = '') {
    this.type = type;
    this.payload = payload;
    this.label = label;
    this.undoLabel = `Undid ${label || type}`;
  }

  run(state) {
    return Command.execute(this.type, state, this.payload);
  }

  static execute(type, state, payload) {
    switch (type) {
      case 'move':
        return moveUnit(state, payload.unitId, payload.x, payload.y);
      case 'attack':
        if (payload.targetType === 'building') {
          return attackBuilding(state, payload.unitId, payload.targetId);
        }
        return attackUnit(state, payload.unitId, payload.targetId);
      case 'build':
        return startConstruction(state, payload.unitId, payload.buildingType, payload.x, payload.y);
      case 'train':
        return startTraining(state, payload.buildingId, payload.unitType);
      case 'upgrade':
        return upgradeBuilding(state, payload.buildingId);
      case 'diplomacy':
        return performDiplomacy(state, payload.factionId, payload.actionId);
      case 'diplomacyPromise':
        return makeDiplomaticPromise(state, payload.factionId, payload.promiseId);
      case 'promiseDemand':
        return resolvePromiseDemand(state, payload.factionId, payload.demandId, payload.choiceId);
      case 'fieldOrder':
        return setFieldOrder(state, payload.factionId, payload.orderId);
      case 'fortify':
        return fortifyUnit(state, payload.unitId);
      case 'crisis':
        return resolveCrisis(state, payload.eventId, payload.choiceId);
      default:
        return { ok: false, reason: `Unknown command type: ${type}` };
    }
  }
}

export function moveCommand(unitId, x, y) {
  return new Command('move', { unitId, x, y }, 'Move unit');
}

export function attackCommand(unitId, targetId, targetType = 'unit') {
  return new Command('attack', { unitId, targetId, targetType }, 'Attack');
}

export function buildCommand(unitId, buildingType, x, y) {
  return new Command('build', { unitId, buildingType, x, y }, 'Build structure');
}

export function trainCommand(buildingId, unitType) {
  return new Command('train', { buildingId, unitType }, 'Train unit');
}

export function upgradeCommand(buildingId) {
  return new Command('upgrade', { buildingId }, 'Upgrade building');
}

export function diplomacyCommand(factionId, actionId) {
  return new Command('diplomacy', { factionId, actionId }, 'Diplomatic action');
}

export function diplomacyPromiseCommand(factionId, promiseId) {
  return new Command('diplomacyPromise', { factionId, promiseId }, 'Diplomatic promise');
}

export function promiseDemandCommand(factionId, demandId, choiceId) {
  return new Command('promiseDemand', { factionId, demandId, choiceId }, 'Promise demand');
}

export function fieldOrderCommand(factionId, orderId) {
  return new Command('fieldOrder', { factionId, orderId }, 'Field order');
}

export function fortifyCommand(unitId) {
  return new Command('fortify', { unitId }, 'Fortify unit');
}

export function crisisCommand(eventId, choiceId) {
  return new Command('crisis', { eventId, choiceId }, 'Crisis ruling');
}

let sharedHistory = null;

export function getCommandHistory() {
  if (!sharedHistory) sharedHistory = new CommandHistory();
  return sharedHistory;
}

export function executePlayerCommand(state, command) {
  return getCommandHistory().execute(command, state);
}

function historyEntry(command, snapshot) {
  return { command, snapshot, snapshotBytes: snapshot.length };
}

function pruneHistoryStack(stack, bytes) {
  let retainedBytes = bytes;
  while (stack.length > 1 && (stack.length > MAX_HISTORY || retainedBytes > MAX_STACK_BYTES)) {
    const removed = stack.shift();
    retainedBytes -= removed.snapshotBytes;
  }
  return retainedBytes;
}

function applyState(target, source) {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  Object.assign(target, source);
}
