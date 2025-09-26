// Tests authored by Codex.
import { describe, it, expect } from "vitest";
import { HistoryStackManager } from "../../src/application/services/history/HistoryStackManager.js";

describe("HistoryStackManager", () => {
  it("adds undo operations and clears redo stack", () => {
    const manager = new HistoryStackManager();
    manager.pushRedo({ id: "redo" });

    manager.pushUndo({ id: "first" });

    expect(manager.canUndo()).toBe(true);
    expect(manager.popUndo()).toEqual({ id: "first" });
    expect(manager.canRedo()).toBe(false);
  });

  it("keeps only the latest operations within the max history size", () => {
    const manager = new HistoryStackManager(2);
    manager.pushUndo("first");
    manager.pushUndo("second");
    manager.pushUndo("third");

    expect(manager.getUndoStackLength()).toBe(2);
    expect(manager.popUndo()).toBe("third");
    expect(manager.popUndo()).toBe("second");
    expect(manager.popUndo()).toBeNull();
  });

  it("restores redo operations without clearing the remaining stack", () => {
    const manager = new HistoryStackManager(5);
    manager.pushRedo("redo-1");
    manager.pushRedo("redo-2");

    const redoCommand = manager.popRedo();
    manager.pushUndoFromRedo(redoCommand);

    expect(manager.canRedo()).toBe(true);
    expect(manager.popUndo()).toBe("redo-2");
    expect(manager.popRedo()).toBe("redo-1");
  });
});
