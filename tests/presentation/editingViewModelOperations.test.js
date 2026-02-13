import { describe, expect, it, vi } from "vitest";
import { operationMethods } from "../../src/presentation/view-models/EditingViewModelOperations.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = (year, name) =>
  new Property(new TimePoint(year), name, "", {}, new TimePoint(year), null);

const buildContext = ({ world, updatedFeature, updateError = null }) => {
  const worldRepository = {
    getWorld: vi.fn(async () => world)
  };

  const editFeatureUseCase = {
    getWorldRepository: vi.fn(() => worldRepository),
    updateFeature: updateError
      ? vi.fn(async () => {
          throw updateError;
        })
      : vi.fn(async () => ({ feature: updatedFeature }))
  };

  const serializer = {
    serialize: vi.fn((value) => ({
      name: value?.name ?? "",
      startYear: value?.startTime?.year ?? null,
      endYear: value?.endTime?.year ?? null
    }))
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
});
