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

export class CommandHistory {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  execute(command, state) {
    const snapshot = serializeState(state);
    const result = command.run(state);
    if (result?.ok !== false) {
      this.undoStack.push({ command, snapshot });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    return result;
  }

  undo(state) {
    const entry = this.undoStack.pop();
    if (!entry) return { ok: false, reason: 'Nothing to undo.' };
    this.redoStack.push({ command: entry.command, snapshot: serializeState(state) });
    applyState(state, deserializeState(entry.snapshot));
    return { ok: true, reason: entry.command.undoLabel || 'Undid last action.' };
  }

  redo(state) {
    const entry = this.redoStack.pop();
    if (!entry) return { ok: false, reason: 'Nothing to redo.' };
    this.undoStack.push({ command: entry.command, snapshot: serializeState(state) });
    const result = entry.command.run(state);
    return result?.ok === false ? result : { ok: true, reason: entry.command.label || 'Redid action.' };
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
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

function applyState(target, source) {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  Object.assign(target, source);
}
