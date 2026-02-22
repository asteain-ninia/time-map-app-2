import { describe, expect, it, vi } from "vitest";
import { operationMethods } from "../../src/presentation/view-models/EditingViewModelOperations.js";
import { Point } from "../../src/domain/entities/Point.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { BatchUpdatePropertiesCommand } from "../../src/application/services/history/commands/BatchUpdatePropertiesCommand.js";
import { DeleteVerticesCommand } from "../../src/application/services/history/commands/DeleteVerticesCommand.js";

const createProperty = (year, name) =>
  new FeatureAnchor({
    id: `anchor-${name}-${year}`,
    timeRange: { start: new TimePoint(year), end: null },
    property: { name, description: "", attributes: {} },
    shape: {},
    placement: {}
  });

const buildContext = ({
  world,
  updatedFeature = null,
  updatedFeatures = null,
  updateError = null,
  deleteVerticesResult = { deletedVertexIds: [], updatedFeatureIds: [], deletedFeatureIds: [] },
  deleteVerticesError = null
}) => {
  const worldRepository = {
    getWorld: vi.fn(async () => world)
  };

  const editFeatureUseCase = {
    getWorldRepository: vi.fn(() => worldRepository),
    deleteVertices: deleteVerticesError
      ? vi.fn(async () => {
          throw deleteVerticesError;
        })
      : vi.fn(async () => deleteVerticesResult),
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
    const beforeFeature = globalThis.createAnchoredPoint("point-1", ["v1"], [createProperty(1000, "Before")], "layer-1");
    const afterFeature = globalThis.createAnchoredPoint("point-1", ["v1"], [createProperty(1200, "After")], "layer-1");
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
    const beforeFeature = globalThis.createAnchoredPoint("point-1", ["v1"], [createProperty(1000, "Before")], "layer-1");
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

  it("forwards anchors update payload with conflictResolutions", async () => {
    const beforeFeature = globalThis.createAnchoredPoint("point-1", ["v1"], [createProperty(1000, "Before")], "layer-1");
    const afterFeature = globalThis.createAnchoredPoint("point-1", ["v1"], [createProperty(1200, "After")], "layer-1");
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

    const conflictResolutions = {
      "polygon-overlap:point-1::point-2:1200:null:null": { preferFeatureId: "point-1" }
    };
    const result = await operationMethods.updateFeatureProperties.call(context, "point-1", {
      anchors: afterFeature.anchors,
      conflictResolutions
    });

    expect(result).toBe(afterFeature);
    expect(editFeatureUseCase.updateFeature).toHaveBeenCalledTimes(1);
    expect(editFeatureUseCase.updateFeature).toHaveBeenCalledWith("point-1", {
      anchors: afterFeature.anchors,
      conflictResolutions
    });
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    expect(historyService._notifyHistoryChanged).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureUpdated", { feature: afterFeature });
  });

  it("records one batch history command when multiple features are updated", async () => {
    const beforeFeatureA = globalThis.createAnchoredPoint("point-a", ["v1"], [createProperty(1000, "A-before")], "layer-1");
    const beforeFeatureB = globalThis.createAnchoredPoint("point-b", ["v2"], [createProperty(1000, "B-before")], "layer-1");
    const afterFeatureA = globalThis.createAnchoredPoint("point-a", ["v1"], [createProperty(1200, "A-after")], "layer-1");
    const afterFeatureB = globalThis.createAnchoredPoint("point-b", ["v2"], [createProperty(1200, "B-after")], "layer-1");
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

describe("EditingViewModelOperations.deleteVertices", () => {
  it("passes editTime to usecase and keeps time-scoped affected features in history payload", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    const anchors = [
      new FeatureAnchor({
        id: "anchor-line-delete-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "line-delete", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["v1", "v2"] },
        placement: { layerId: "layer-1" }
      }),
      new FeatureAnchor({
        id: "anchor-line-delete-2",
        timeRange: { start: t1200, end: null },
        property: { name: "line-delete", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["v1", "v3"] },
        placement: { layerId: "layer-1" }
      })
    ];
    const lineFeature = globalThis.createAnchoredLine(
      "line-delete",
      ["v1", "v3"],
      [createProperty(1000, "Line"), createProperty(1200, "Line")],
      "layer-1",
      anchors
    );
    const world = {
      features: [lineFeature],
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 5, y: 0 },
        { id: "v3", x: 10, y: 0 }
      ],
      layers: [{ id: "layer-1", order: 0 }],
      metadata: {}
    };
    const { context, editFeatureUseCase, historyService, eventBus } = buildContext({
      world,
      deleteVerticesResult: {
        deletedVertexIds: ["v2"],
        updatedFeatureIds: ["line-delete"],
        deletedFeatureIds: []
      }
    });

    const editTime = new TimePoint(1100);
    await operationMethods.deleteVertices.call(context, ["v2"], { editTime });

    expect(editFeatureUseCase.deleteVertices).toHaveBeenCalledWith(["v2"], { editTime });
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    const pushedCommand = historyService._stackManager.pushUndo.mock.calls[0][0];
    expect(pushedCommand).toBeInstanceOf(DeleteVerticesCommand);
    expect(pushedCommand._payload.editTime).toEqual({ year: 1100, month: null, day: null });
    expect(pushedCommand._payload.affectedFeaturesBefore).toHaveLength(1);
    expect(pushedCommand._payload.affectedFeaturesBefore[0].id).toBe("line-delete");
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureUpdated", { feature: lineFeature });
    expect(eventBus.publish).toHaveBeenCalledWith("VerticesDeleted", {
      deletedVertexIds: ["v2"],
      editTime: { year: 1100, month: null, day: null }
    });
    expect(eventBus.publish).toHaveBeenCalledWith("ClearSelection");
  });

  it("retries with conflict resolutions and stores resolved side effects in delete history payload", async () => {
    const t900 = new TimePoint(900);
    const t1000 = new TimePoint(1000);
    const polyDelete = globalThis.createAnchoredPolygon(
      "poly-delete",
      [createProperty(1000, "Delete")],
      "layer-1",
      "0",
      [],
      [{ id: "ring-delete", vertexIds: ["a1", "a2", "a3", "a4", "a5"], ringType: "territory", parentId: null }],
      [
        new FeatureAnchor({
          id: "anchor-delete-1000",
          timeRange: { start: t1000, end: null },
          property: { name: "Delete", description: "", attributes: {} },
          shape: {
            type: "Polygon",
            rings: [{ id: "ring-delete", vertexIds: ["a1", "a2", "a3", "a4", "a5"], ringType: "territory", parentId: null }]
          },
          placement: { layerId: "layer-1", parentId: "0", childIds: [] }
        })
      ]
    );
    const polyRival = globalThis.createAnchoredPolygon(
      "poly-rival",
      [createProperty(900, "Rival")],
      "layer-1",
      "0",
      [],
      [{ id: "ring-rival", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }],
      [
        new FeatureAnchor({
          id: "anchor-rival-900",
          timeRange: { start: t900, end: null },
          property: { name: "Rival", description: "", attributes: {} },
          shape: {
            type: "Polygon",
            rings: [{ id: "ring-rival", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }]
          },
          placement: { layerId: "layer-1", parentId: "0", childIds: [] }
        })
      ]
    );
    const world = {
      features: [polyDelete, polyRival],
      vertices: [
        { id: "a1", x: 0, y: 0 },
        { id: "a2", x: 8, y: 0 },
        { id: "a3", x: 8, y: 8 },
        { id: "a4", x: 4, y: 4 },
        { id: "a5", x: 0, y: 8 },
        { id: "b1", x: 3, y: 6 },
        { id: "b2", x: 5, y: 6 },
        { id: "b3", x: 5, y: 7 },
        { id: "b4", x: 3, y: 7 }
      ],
      layers: [{ id: "layer-1", order: 0 }],
      metadata: {}
    };
    const { context, editFeatureUseCase, historyService } = buildContext({ world });
    const conflictError = new Error("conflicts");
    conflictError.code = "FEATURE_ANCHOR_CONFLICTS";
    conflictError.conflicts = [
      {
        id: "polygon-overlap:poly-delete::poly-rival:1000:null:null",
        featureIdA: "poly-delete",
        featureIdB: "poly-rival"
      }
    ];
    const conflictResolutions = {
      "polygon-overlap:poly-delete::poly-rival:1000:null:null": { preferFeatureId: "poly-delete" }
    };
    editFeatureUseCase.deleteVertices = vi.fn()
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({
        deletedVertexIds: ["a4"],
        updatedFeatureIds: ["poly-delete", "poly-rival"],
        deletedFeatureIds: []
      });
    context._anchorConflictResolutionDialog = {
      show: vi.fn(async () => conflictResolutions)
    };

    await operationMethods.deleteVertices.call(context, ["a4"], { editTime: t1000 });

    expect(editFeatureUseCase.deleteVertices).toHaveBeenCalledTimes(2);
    expect(editFeatureUseCase.deleteVertices).toHaveBeenNthCalledWith(1, ["a4"], { editTime: t1000 });
    expect(editFeatureUseCase.deleteVertices).toHaveBeenNthCalledWith(2, ["a4"], {
      editTime: t1000,
      conflictResolutions
    });
    expect(context._anchorConflictResolutionDialog.show).toHaveBeenCalledTimes(1);
    const pushedCommand = historyService._stackManager.pushUndo.mock.calls[0][0];
    expect(pushedCommand._payload.conflictResolutions).toEqual(conflictResolutions);
    expect(pushedCommand._payload.affectedFeaturesBefore).toHaveLength(2);
    expect(pushedCommand._payload.affectedFeaturesBefore.map(feature => feature.id).sort()).toEqual([
      "poly-delete",
      "poly-rival"
    ]);
  });

  it("stores null editTime in history payload when delete is executed without options", async () => {
    const pointFeature = globalThis.createAnchoredPoint("point-delete", ["vp"], [createProperty(1000, "Point")], "layer-1");
    const world = {
      features: [pointFeature],
      vertices: [{ id: "vp", x: 0, y: 0 }],
      layers: [{ id: "layer-1", order: 0 }],
      metadata: {}
    };
    const { context, editFeatureUseCase, historyService, eventBus } = buildContext({
      world,
      deleteVerticesResult: {
        deletedVertexIds: ["vp"],
        updatedFeatureIds: [],
        deletedFeatureIds: ["point-delete"]
      }
    });

    await operationMethods.deleteVertices.call(context, ["vp"]);

    expect(editFeatureUseCase.deleteVertices).toHaveBeenCalledWith(["vp"], undefined);
    const pushedCommand = historyService._stackManager.pushUndo.mock.calls[0][0];
    expect(pushedCommand).toBeInstanceOf(DeleteVerticesCommand);
    expect(pushedCommand._payload.editTime).toBeNull();
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureDeleted", { featureId: "point-delete" });
    expect(eventBus.publish).toHaveBeenCalledWith("VerticesDeleted", {
      deletedVertexIds: ["vp"],
      editTime: null
    });
  });
});
