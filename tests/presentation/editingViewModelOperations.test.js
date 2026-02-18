import { describe, expect, it, vi } from "vitest";
import { operationMethods } from "../../src/presentation/view-models/EditingViewModelOperations.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { BatchUpdatePropertiesCommand } from "../../src/application/services/history/commands/BatchUpdatePropertiesCommand.js";

const createProperty = (year, name) =>
  new Property(new TimePoint(year), name, "", {}, new TimePoint(year), null);

const buildContext = ({ world, updatedFeature, updatedFeatures = null, updateError = null }) => {
  const worldRepository = {
    getWorld: vi.fn(async () => world)
  };

  const editFeatureUseCase = {
    getWorldRepository: vi.fn(() => worldRepository),
    updateFeature: updateError
      ? vi.fn(async () => {
          throw updateError;
        })
      : vi.fn(async () => ({
          feature: updatedFeature,
          updatedFeatures: updatedFeatures || undefined
        }))
  };

  const serializer = {
    serialize: vi.fn((value) => value),
    deserialize: vi.fn((value) => value)
  };

  const historyService = {
    _serializer: serializer,
    _stackManager: {
      pushUndo: vi.fn()
    },
    _notifyHistoryChanged: vi.fn(),
    _worldRepository: worldRepository
  };

  const eventBus = {
    publish: vi.fn()
  };

  return {
    context: {
      _editFeatureUseCase: editFeatureUseCase,
      _historyService: historyService,
      _eventBus: eventBus
    },
    editFeatureUseCase,
    historyService,
    eventBus
  };
};

describe("EditingViewModelOperations.updateFeatureProperties", () => {
  it("records history only when property update succeeds", async () => {
    const beforeFeature = new Point("point-1", ["v1"], [createProperty(1000, "Before")], "layer-1");
    const afterFeature = new Point("point-1", ["v1"], [createProperty(1200, "After")], "layer-1");
    const world = {
      features: [beforeFeature],
      vertices: [{ id: "v1", x: 0, y: 0 }],
      layers: [{ id: "layer-1", order: 0 }],
      metadata: {}
    };
    const { context, editFeatureUseCase, historyService, eventBus } = buildContext({
      world,
      updatedFeature: afterFeature
    });

    const result = await operationMethods.updateFeatureProperties.call(context, "point-1", {
      editTime: new TimePoint(1200),
      startTime: new TimePoint(1200),
      endTime: null,
      name: "After",
      description: ""
    });

    expect(result).toBe(afterFeature);
    expect(editFeatureUseCase.updateFeature).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    expect(historyService._notifyHistoryChanged).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureUpdated", { feature: afterFeature });
  });

  it("does not record history when property update fails validation", async () => {
    const beforeFeature = new Point("point-1", ["v1"], [createProperty(1000, "Before")], "layer-1");
    const world = {
      features: [beforeFeature],
      vertices: [{ id: "v1", x: 0, y: 0 }],
      layers: [{ id: "layer-1", order: 0 }],
      metadata: {}
    };
    const validationError = new Error("同一時刻の歴史の錨が重複しています。");
    const { context, editFeatureUseCase, historyService, eventBus } = buildContext({
      world,
      updatedFeature: null,
      updateError: validationError
    });

    await expect(
      operationMethods.updateFeatureProperties.call(context, "point-1", {
        editTime: new TimePoint(1200),
        startTime: new TimePoint(1200),
        endTime: null,
        name: "After",
        description: ""
      })
    ).rejects.toThrow("同一時刻の歴史の錨が重複しています。");

    expect(editFeatureUseCase.updateFeature).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo).not.toHaveBeenCalled();
    expect(historyService._notifyHistoryChanged).not.toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith("WorldUpdated");
    expect(eventBus.publish).not.toHaveBeenCalledWith("FeatureUpdated", expect.anything());
  });

  it("records one batch history command when multiple features are updated", async () => {
    const beforeFeatureA = new Point("point-a", ["v1"], [createProperty(1000, "A-before")], "layer-1");
    const beforeFeatureB = new Point("point-b", ["v2"], [createProperty(1000, "B-before")], "layer-1");
    const afterFeatureA = new Point("point-a", ["v1"], [createProperty(1200, "A-after")], "layer-1");
    const afterFeatureB = new Point("point-b", ["v2"], [createProperty(1200, "B-after")], "layer-1");
    const world = {
      features: [beforeFeatureA, beforeFeatureB],
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 1, y: 1 }
      ],
      layers: [{ id: "layer-1", order: 0 }],
      metadata: {}
    };
    const { context, editFeatureUseCase, historyService, eventBus } = buildContext({
      world,
      updatedFeature: afterFeatureA,
      updatedFeatures: [afterFeatureA, afterFeatureB]
    });

    const result = await operationMethods.updateFeatureProperties.call(context, "point-a", {
      editTime: new TimePoint(1200),
      startTime: new TimePoint(1200),
      endTime: null,
      name: "A-after",
      description: "",
      conflictResolutions: {
        "polygon-overlap:point-a::point-b:1200:null:null": { preferFeatureId: "point-a" }
      }
    });

    expect(result).toBe(afterFeatureA);
    expect(editFeatureUseCase.updateFeature).toHaveBeenCalledTimes(1);
    expect(editFeatureUseCase.updateFeature).toHaveBeenCalledWith("point-a", {
      propertyEdit: expect.objectContaining({
        conflictResolutions: {
          "polygon-overlap:point-a::point-b:1200:null:null": { preferFeatureId: "point-a" }
        }
      })
    });
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    const pushedCommand = historyService._stackManager.pushUndo.mock.calls[0][0];
    expect(pushedCommand).toBeInstanceOf(BatchUpdatePropertiesCommand);
    await pushedCommand.reverse();
    expect(editFeatureUseCase.updateFeature).toHaveBeenCalledTimes(3);
    expect(editFeatureUseCase.updateFeature).toHaveBeenNthCalledWith(2, "point-b", {
      anchors: [expect.objectContaining({ name: "B-before" })]
    });
    expect(editFeatureUseCase.updateFeature).toHaveBeenNthCalledWith(3, "point-a", {
      anchors: [expect.objectContaining({ name: "A-before" })]
    });
    expect(historyService._notifyHistoryChanged).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureUpdated", { feature: afterFeatureA });
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureUpdated", { feature: afterFeatureB });
  });
});
