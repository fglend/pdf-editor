import { CUSTOM_PROPS } from './tools.js';

const LIMIT = 200;

export function serialize(canvas) {
  return JSON.stringify(canvas.toObject(CUSTOM_PROPS));
}

/**
 * Document-wide undo/redo. Each step remembers which page changed and that
 * page's snapshot before and after, so undo works across pages in order.
 */
export class History {
  constructor(registry, onChange) {
    this.registry = registry;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
    this.snapshots = new Map();
  }

  init(pageId, canvas) {
    this.snapshots.set(pageId, serialize(canvas));
  }

  forget(pageId) {
    this.snapshots.delete(pageId);
    this.undoStack = this.undoStack.filter((s) => s.pageId !== pageId);
    this.redoStack = this.redoStack.filter((s) => s.pageId !== pageId);
    this.onChange();
  }

  commit(pageId) {
    const entry = this.registry.get(pageId);
    if (!entry || entry.isLoading()) return;
    const after = serialize(entry.canvas);
    const before = this.snapshots.get(pageId);
    if (after === before) return;
    this.undoStack.push({ pageId, before, after });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.snapshots.set(pageId, after);
    this.onChange();
  }

  /** Re-take the snapshot without creating a step (e.g. after rotating a page). */
  rebase(pageId) {
    const entry = this.registry.get(pageId);
    if (entry) this.snapshots.set(pageId, serialize(entry.canvas));
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  async undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    await this.#apply(step.pageId, step.before);
    this.redoStack.push(step);
    this.onChange();
    return step.pageId;
  }

  async redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    await this.#apply(step.pageId, step.after);
    this.undoStack.push(step);
    this.onChange();
    return step.pageId;
  }

  async #apply(pageId, json) {
    const entry = this.registry.get(pageId);
    if (!entry) return;
    await entry.load(json);
    this.snapshots.set(pageId, json);
  }
}
