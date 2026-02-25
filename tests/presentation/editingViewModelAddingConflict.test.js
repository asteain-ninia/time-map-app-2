import { describe, expect, it, vi } from "vitest";
import { addingMethods } from "../../src/presentation/view-models/EditingViewModelAdding.js";
import { AddFeatureCommand } from "../../src/application/services/history/commands/AddFeatureCommand.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

function createAnchor(year = 1000, name = "Added") {
  return new FeatureAnchor({
    id: `anchor-draft-${year}`,
    timeRange: { start: new TimePoint(year), end: null },
    property: { name, description: "", attributes: {} },
    shape: {},
    placement: {}
  });
}

describe("EditingViewModelAdding.confirmAddFeature conflict flow", () => {
  it("retries add with conflict resolutions and records additional feature changes", async () => {
    const conflictError = new Error("同一レイヤー上の面情報が重なっています。解決方針を指定してください。");
    conflictError.code = "FEATURE_ANCHOR_CONFLICTS";
    conflictError.conflicts = [
      {
        id: "polygon-overlap:polygon-1::polygon-existing:1000:null:null",
        timeLabel: "1000",
        featureIdA: "polygon-1",
        featureIdB: "polygon-existing"
      }
    ];

    const worldBefore = {
      features: [{ id: "polygon-existing" }],
      vertices: [],
      layers: []
    };
    const worldRepository = {
      getWorld: vi.fn(async () => worldBefore)
    };
    const resultFeature = { id: "polygon-1", vertexIds: ["v-new"] };
    const addResult = {
      feature: resultFeature,
      updatedFeatures: [
        resultFeature,
        { id: "polygon-existing" }
      ]
    };

    const editFeatureUseCase = {
      getWorldRepository: vi.fn(() => worldRepository),
      addFeature: vi.fn()
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce(addResult)
    };
    const serializer = {
      serialize: vi.fn((value) => value)
    };
    const historyService = {
      _serializer: serializer,
      _stackManager: { pushUndo: vi.fn() },
      _notifyHistoryChanged: vi.fn(),
      _worldRepository: worldRepository,
      _getVerticesDataForFeatureForHistory: vi.fn(async () => [{ id: "v-new", x: 1, y: 1 }])
    };
    const eventBus = {
      publish: vi.fn()
    };

    const context = {
      _mode: "add",
      _tool: "polygon",
      _addingPoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
      _editFeatureUseCase: editFeatureUseCase,
      _historyService: historyService,
      _eventBus: eventBus,
      _clearAddingState: vi.fn(),
      _anchorConflictResolutionDialog: {
        show: vi.fn(async () => ({
          "polygon-overlap:polygon-1::polygon-existing:1000:null:null": { preferFeatureId: "polygon-1" }
        }))
      }
    };

    const anchor = createAnchor(1000);
    const result = await addingMethods.confirmAddFeature.call(context, [anchor], "layer-0");

    expect(result).toBe(resultFeature);
    expect(editFeatureUseCase.addFeature).toHaveBeenCalledTimes(2);
    expect(editFeatureUseCase.addFeature).toHaveBeenNthCalledWith(
      1,
      "polygon",
      [anchor],
      { vertices: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] },
      "layer-0",
      { returnDetails: true }
    );
    expect(editFeatureUseCase.addFeature).toHaveBeenNthCalledWith(
      2,
      "polygon",
      [anchor],
      { vertices: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] },
      "layer-0",
      {
        returnDetails: true,
        conflictResolutions: {
          "polygon-overlap:polygon-1::polygon-existing:1000:null:null": { preferFeatureId: "polygon-1" }
        }
      }
    );
    expect(context._anchorConflictResolutionDialog.show).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    const pushedCommand = historyService._stackManager.pushUndo.mock.calls[0][0];
    expect(pushedCommand).toBeInstanceOf(AddFeatureCommand);
    expect(pushedCommand._payload.additionalFeatureChanges).toEqual([
      {
        featureId: "polygon-existing",
        beforeFeatureData: { id: "polygon-existing" },
        afterFeatureData: { id: "polygon-existing" }
      }
    ]);
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureUpdated", { feature: { id: "polygon-existing" } });
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureAdded", { feature: resultFeature });
    expect(context._clearAddingState).toHaveBeenCalledTimes(1);
  });

  it("does not record history when conflict dialog is cancelled", async () => {
    const conflictError = new Error("同一レイヤー上の面情報が重なっています。解決方針を指定してください。");
    conflictError.code = "FEATURE_ANCHOR_CONFLICTS";
    conflictError.conflicts = [
      {
        id: "polygon-overlap:polygon-1::polygon-existing:1000:null:null",
        timeLabel: "1000",
        featureIdA: "polygon-1",
        featureIdB: "polygon-existing"
      }
    ];

    const worldRepository = {
      getWorld: vi.fn(async () => ({
        features: [{ id: "polygon-existing" }],
        vertices: [],
        layers: []
      }))
    };
    const editFeatureUseCase = {
      getWorldRepository: vi.fn(() => worldRepository),
      addFeature: vi.fn(async () => {
        throw conflictError;
      })
    };
    const historyService = {
      _serializer: { serialize: vi.fn((value) => value) },
      _stackManager: { pushUndo: vi.fn() },
      _notifyHistoryChanged: vi.fn(),
      _worldRepository: worldRepository,
      _getVerticesDataForFeatureForHistory: vi.fn(async () => [])
    };
    const eventBus = { publish: vi.fn() };
    const context = {
      _mode: "add",
      _tool: "polygon",
      _addingPoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
      _editFeatureUseCase: editFeatureUseCase,
      _historyService: historyService,
      _eventBus: eventBus,
      _clearAddingState: vi.fn(),
      _anchorConflictResolutionDialog: {
        show: vi.fn(async () => null)
      }
    };
    const anchor = createAnchor(1000);

    await expect(
      addingMethods.confirmAddFeature.call(context, [anchor], "layer-0")
    ).rejects.toThrow("競合解決をキャンセルしました。");

    expect(editFeatureUseCase.addFeature).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo).not.toHaveBeenCalled();
    expect(historyService._notifyHistoryChanged).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalledWith("FeatureAdded", expect.anything());
    expect(context._clearAddingState).toHaveBeenCalledTimes(1);
  });
});
