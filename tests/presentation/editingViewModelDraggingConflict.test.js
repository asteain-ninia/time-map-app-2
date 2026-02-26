import { describe, expect, it, vi } from "vitest";
import { draggingMethods } from "../../src/presentation/view-models/EditingViewModelDragging.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { MoveVerticesCommand } from "../../src/application/services/history/commands/MoveVerticesCommand.js";

describe("EditingViewModelDragging.endVerticesDrag conflict resolution", () => {
  it("retries editTime vertex move with conflict resolutions from dialog", async () => {
    const editTime = new TimePoint(1100);
    const conflictError = new Error("同一レイヤー上の面情報が重なっています。解決方針を指定してください。");
    conflictError.code = "FEATURE_ANCHOR_CONFLICTS";
    conflictError.conflicts = [{
      id: "polygon-overlap:poly-a::poly-b:1100:null:null",
      timeLabel: "1100",
      featureIdA: "poly-a",
      featureIdB: "poly-b"
    }];
    const moveResult = {
      updatedVertices: [{ id: "v1-1100", x: 1, y: 1 }],
      affectedFeatures: [{ id: "poly-a" }, { id: "poly-b" }],
      requiresWorldRefresh: true,
      historyPatch: {
        featureChanges: [
          { featureId: "poly-a", beforeFeature: { id: "poly-a", rev: "before" }, afterFeature: { id: "poly-a", rev: "after" } },
          { featureId: "poly-b", beforeFeature: { id: "poly-b", rev: "before" }, afterFeature: { id: "poly-b", rev: "after" } }
        ],
        addedVertices: [{ id: "v1-1100", x: 1, y: 1 }]
      }
    };
    const world = {
      features: [{ id: "poly-a" }, { id: "poly-b" }],
      vertices: [{ id: "v1", x: 0, y: 0 }],
      layers: []
    };
    const worldRepository = {
      getWorld: vi.fn(async () => world)
    };
    const editFeatureUseCase = {
      moveVertices: vi.fn()
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce(moveResult),
      getWorldRepository: vi.fn(() => worldRepository)
    };
    const serializer = { serialize: vi.fn(value => value) };
    let historyService = null;
    historyService = {
      _serializer: serializer,
      _stackManager: { pushUndo: vi.fn() },
      _notifyHistoryChanged: vi.fn(),
      _worldRepository: worldRepository,
      getSerializer: vi.fn(() => serializer),
      getWorldRepository: vi.fn(() => worldRepository),
      serializeForHistory: vi.fn((value) => serializer.serialize(value)),
      recordCommand: vi.fn((command) => {
        historyService._stackManager.pushUndo(command);
        historyService._notifyHistoryChanged();
      })
    };
    const eventBus = { publish: vi.fn() };
    const context = {
      _draggingVerticesInfo: new Map([
        ["v1", { originalPosition: { x: 0, y: 0 }, currentPosition: { x: 1, y: 1 } }]
      ]),
      _pendingVertexAdditionInfo: null,
      _resetDraggingState: vi.fn(function resetState() {
        this._draggingVerticesInfo.clear();
      }),
      _editFeatureUseCase: editFeatureUseCase,
      _historyService: historyService,
      _eventBus: eventBus,
      _applyVertexSharingAfterDrag: vi.fn(async () => ({ shared: false })),
      _anchorConflictResolutionDialog: {
        show: vi.fn(async () => ({
          "polygon-overlap:poly-a::poly-b:1100:null:null": { preferFeatureId: "poly-a" }
        }))
      }
    };

    await draggingMethods.endVerticesDrag.call(context, { editTime });

    expect(editFeatureUseCase.moveVertices).toHaveBeenCalledTimes(2);
    expect(editFeatureUseCase.moveVertices).toHaveBeenNthCalledWith(
      1,
      [{ vertexId: "v1", newPosition: { x: 1, y: 1 } }],
      { editTime }
    );
    expect(editFeatureUseCase.moveVertices).toHaveBeenNthCalledWith(
      2,
      [{ vertexId: "v1", newPosition: { x: 1, y: 1 } }],
      {
        editTime,
        conflictResolutions: {
          "polygon-overlap:poly-a::poly-b:1100:null:null": { preferFeatureId: "poly-a" }
        }
      }
    );
    expect(context._anchorConflictResolutionDialog.show).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo.mock.calls[0][0]).toBeInstanceOf(MoveVerticesCommand);
    expect(historyService._notifyHistoryChanged).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith("WorldUpdated");
  });
});
