// Tests authored by Codex.
import { describe, it, expect, vi } from "vitest";
import { HistoryService } from "../../src/application/services/HistoryService.js";

describe("HistoryService", () => {
  const createService = () => {
    const stackManager = {
      canUndo: vi.fn(),
      popUndo: vi.fn(),
      pushRedo: vi.fn(),
      pushUndo: vi.fn(),
      canRedo: vi.fn(),
      popRedo: vi.fn(),
      pushUndoFromRedo: vi.fn()
    };
    const serializer = {};
    const eventBus = { publish: vi.fn() };
    const worldRepository = {};
    const editFeatureUseCase = {};

    const service = new HistoryService(
      stackManager,
      serializer,
      null,
      eventBus,
      worldRepository,
      editFeatureUseCase
    );

    return { service, stackManager, eventBus };
  };

  it("performs undo and publishes standard events", async () => {
    const { service, stackManager, eventBus } = createService();
    const command = { reverse: vi.fn().mockResolvedValue({}) };
    stackManager.canUndo.mockReturnValue(true);
    stackManager.popUndo.mockReturnValue(command);
    stackManager.canRedo.mockReturnValue(false);

    await service.undo();

    expect(command.reverse).toHaveBeenCalledTimes(1);
    expect(stackManager.pushRedo).toHaveBeenCalledWith(command);
    expect(eventBus.publish).toHaveBeenNthCalledWith(1, "WorldUpdated");
    expect(eventBus.publish).toHaveBeenNthCalledWith(2, "HistoryChanged", {
      canUndo: true,
      canRedo: false
    });
  });

  it("restores undo stack when undo fails", async () => {
    const { service, stackManager } = createService();
    const error = new Error("reverse failed");
    const command = { reverse: vi.fn().mockRejectedValue(error) };
    stackManager.canUndo.mockReturnValue(true);
    stackManager.popUndo.mockReturnValue(command);

    await expect(service.undo()).rejects.toThrow("reverse failed");

    expect(stackManager.pushUndo).toHaveBeenCalledWith(command);
    expect(stackManager.pushRedo).not.toHaveBeenCalled();
  });

  it("performs redo and pushes the command back to undo", async () => {
    const { service, stackManager, eventBus } = createService();
    const command = { execute: vi.fn().mockResolvedValue({}) };
    stackManager.canRedo.mockReturnValueOnce(true).mockReturnValue(false);
    stackManager.popRedo.mockReturnValue(command);
    stackManager.canUndo.mockReturnValue(true);

    await service.redo();

    expect(command.execute).toHaveBeenCalledTimes(1);
    expect(stackManager.pushUndoFromRedo).toHaveBeenCalledWith(command);
    expect(eventBus.publish).toHaveBeenNthCalledWith(1, "WorldUpdated");
    expect(eventBus.publish).toHaveBeenNthCalledWith(2, "HistoryChanged", {
      canUndo: true,
      canRedo: false
    });
  });
});
