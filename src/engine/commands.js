import { serializeState, deserializeState } from '../rules.js';

export class Command {
  constructor(name, executeFn, undoFn) {
    this.name = name;
    this.executeFn = executeFn;
    this.undoFn = undoFn;
    this.snapshotBefore = null;
    this.snapshotAfter = null;
    this.result = null;
  }

  execute(state) {
    this.snapshotBefore = serializeState(state);
    this.result = this.executeFn(state);
    this.snapshotAfter = serializeState(state);
    return this.result;
  }

  undo(state) {
    if (!this.snapshotBefore) return false;
    const restored = deserializeState(this.snapshotBefore);
    Object.keys(state).forEach((key) => { delete state[key]; });
    Object.assign(state, restored);
    if (this.undoFn) this.undoFn(state);
    return true;
  }
}

export class CommandManager {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.maxDepth = 48;
  }

  execute(state, command) {
    const result = command.execute(state);
    if (!result || result.ok === false) {
      if (command.snapshotBefore) {
        const restored = deserializeState(command.snapshotBefore);
        Object.keys(state).forEach((key) => { delete state[key]; });
        Object.assign(state, restored);
      }
      return result;
    }
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack.length = 0;
    return result;
  }

  undo(state) {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo(state);
    this.redoStack.push(command);
    return true;
  }

  redo(state) {
    const command = this.redoStack.pop();
    if (!command) return false;
    const result = command.execute(state);
    if (!result || result.ok === false) {
      command.undo(state);
      this.redoStack.push(command);
      return false;
    }
    this.undoStack.push(command);
    return true;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

export function createCommand(name, executeFn, undoFn = null) {
  return new Command(name, executeFn, undoFn);
}

export function wrapMutation(name, mutator) {
  return createCommand(name, (state) => {
    const result = mutator(state);
    return result && typeof result === 'object' ? result : { ok: true, result };
  });
}

export function validateUndoRoundTrip(state, commandFactory) {
  const before = serializeState(state);
  const command = commandFactory();
  const manager = new CommandManager();
  const result = manager.execute(state, command);
  if (!result?.ok) return { ok: false, reason: 'execute failed' };
  const afterExecute = serializeState(state);
  manager.undo(state);
  const afterUndo = serializeState(state);
  return {
    ok: afterUndo === before,
    changed: afterExecute !== before,
    result
  };
}

export function createCommandManager() {
  return new CommandManager();
}
