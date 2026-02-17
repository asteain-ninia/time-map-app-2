// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { AddFeatureCommand } from "../../../src/application/services/history/commands/AddFeatureCommand.js";
import { DeleteFeatureCommand } from "../../../src/application/services/history/commands/DeleteFeatureCommand.js";
import { MoveVerticesCommand } from "../../../src/application/services/history/commands/MoveVerticesCommand.js";
import { DeleteVerticesCommand } from "../../../src/application/services/history/commands/DeleteVerticesCommand.js";
import { UpdatePropertiesCommand } from "../../../src/application/services/history/commands/UpdatePropertiesCommand.js";
import { AddRingCommand } from "../../../src/application/services/history/commands/AddRingCommand.js";
import { AddVertexToEdgeCommand } from "../../../src/application/services/history/commands/AddVertexToEdgeCommand.js";
import { HistorySerializer } from "../../../src/application/services/history/HistorySerializer.js";
import { Vertex } from "../../../src/domain/entities/Vertex.js";
import { Point } from "../../../src/domain/entities/Point.js";
import { Line } from "../../../src/domain/entities/Line.js";
import { Polygon } from "../../../src/domain/entities/Polygon.js";
import { Property } from "../../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../../src/domain/value-objects/TimePoint.js";

const createProperty = (year = 1900, name = "Name") =>
  new Property(new TimePoint(year), name, "", {});

const createPoint = (id, vertexId) =>
  new Point(id, [vertexId], [createProperty()], "layer-1");

const createLine = (id, vertexIds) =>
  new Line(id, vertexIds, [createProperty()], "layer-1");

const createPolygon = (id, rings) => {
  const safeRings = rings.length > 0 ? rings : [
    {
      id: `${id}-outer`,
      vertexIds: ["vertex-default-1", "vertex-default-2", "vertex-default-3"],
      ringType: "territory",
      parentId: null
    }
  ];
  return new Polygon(id, [createProperty()], "layer-1", "0", [], safeRings);
};

describe("History commands", () => {
  it("replays AddFeatureCommand by restoring serialized entities", async () => {
    const serializer = new HistorySerializer();
    const vertex = new Vertex("vertex-1", 10, 20);
    const feature = createPoint("feature-1", vertex.id);

    const payload = {
      featureId: feature.id,
      featureData: serializer.serialize(feature),
      addedVerticesData: [serializer.serialize(vertex)]
    };

    const world = { vertices: [], features: [], layers: [] };
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async () => {})
    };
    const editFeatureUseCase = { deleteFeature: vi.fn() };

    const command = new AddFeatureCommand(payload, editFeatureUseCase, worldRepository, serializer);
    const result = await command.execute();

    expect(worldRepository.getWorld).toHaveBeenCalledTimes(1);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(2);
    expect(world.vertices).toEqual([{ id: "vertex-1", x: 10, y: 20 }]);
    expect(world.features).toHaveLength(1);
    expect(world.features[0].id).toBe("feature-1");
    expect(result.addedFeature).toBeInstanceOf(Point);
    expect(result.addedFeature.id).toBe("feature-1");
  });

  it("delegates AddFeatureCommand reverse to EditFeatureUseCase", async () => {
    const serializer = new HistorySerializer();
    const payload = {
      featureId: "feature-undo",
      featureData: serializer.serialize(createPoint("feature-undo", "v")),
      addedVerticesData: []
    };
    const worldRepository = {
      getWorld: vi.fn(),
      saveWorld: vi.fn()
    };
    const editFeatureUseCase = { deleteFeature: vi.fn().mockResolvedValue(undefined) };

    const command = new AddFeatureCommand(payload, editFeatureUseCase, worldRepository, serializer);
    const reverseResult = await command.reverse();

    expect(editFeatureUseCase.deleteFeature).toHaveBeenCalledWith("feature-undo");
    expect(reverseResult).toEqual({ deletedFeatureId: "feature-undo" });
  });

  it("restores deleted entities when undoing DeleteFeatureCommand", async () => {
    const serializer = new HistorySerializer();
    const vertex = new Vertex("vertex-2", 1, 2);
    const feature = createPoint("feature-2", vertex.id);

    const payload = {
      featureId: feature.id,
      featureData: serializer.serialize(feature),
      verticesToRestoreData: [serializer.serialize(vertex)]
    };

    const world = { vertices: [], features: [], layers: [] };
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async () => {})
    };
    const editFeatureUseCase = { deleteFeature: vi.fn().mockResolvedValue(undefined) };

    const command = new DeleteFeatureCommand(payload, editFeatureUseCase, worldRepository, serializer);
    const undoResult = await command.reverse();

    expect(worldRepository.getWorld).toHaveBeenCalledTimes(1);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(2);
    expect(world.vertices).toEqual([{ id: "vertex-2", x: 1, y: 2 }]);
    expect(world.features).toHaveLength(1);
    expect(world.features[0].id).toBe("feature-2");
    expect(undoResult.addedFeature).toBeInstanceOf(Point);
    expect(undoResult.addedFeature.id).toBe("feature-2");
  });

  it("delegates DeleteFeatureCommand execute to EditFeatureUseCase", async () => {
    const serializer = new HistorySerializer();
    const payload = {
      featureId: "feature-to-delete",
      featureData: serializer.serialize(createPoint("feature-to-delete", "vertex")),
      verticesToRestoreData: []
    };

    const worldRepository = {
      getWorld: vi.fn(),
      saveWorld: vi.fn()
    };
    const editFeatureUseCase = { deleteFeature: vi.fn().mockResolvedValue(undefined) };

    const command = new DeleteFeatureCommand(payload, editFeatureUseCase, worldRepository, serializer);
    const redoResult = await command.execute();

    expect(editFeatureUseCase.deleteFeature).toHaveBeenCalledWith("feature-to-delete");
    expect(redoResult).toEqual({ deletedFeatureId: "feature-to-delete" });
  });

  it("replays and rewinds MoveVerticesCommand using serialized vertex positions", async () => {
    const serializer = new HistorySerializer();
    const oldPositionVertex = new Vertex("vertex-3", 0, 0);
    const newPositionVertex = new Vertex("vertex-3", 5, 6);

    const redoResponse = { updatedVertices: [{ id: "vertex-3", x: 5, y: 6 }], affectedFeatures: [] };
    const undoResponse = { updatedVertices: [{ id: "vertex-3", x: 0, y: 0 }], affectedFeatures: [] };

    const editFeatureUseCase = {
      moveVertices: vi.fn()
        .mockResolvedValueOnce(redoResponse)
        .mockResolvedValueOnce(undoResponse)
    };

    const worldRepository = {
      getWorld: vi.fn(),
      saveWorld: vi.fn()
    };

    const payload = {
      updates: [
        {
          vertexId: "vertex-3",
          oldPosition: serializer.serialize(oldPositionVertex),
          newPosition: serializer.serialize(newPositionVertex)
        }
      ]
    };

    const command = new MoveVerticesCommand(payload, editFeatureUseCase, serializer, worldRepository);

    const redoResult = await command.execute();
    expect(editFeatureUseCase.moveVertices).toHaveBeenNthCalledWith(1, [
      { vertexId: "vertex-3", newPosition: { x: 5, y: 6 } }
    ]);
    expect(redoResult).toEqual({
      movedVerticesResult: redoResponse,
      eventType: "MultipleVerticesMoved",
      eventPayload: redoResponse
    });

    const undoResult = await command.reverse();
    expect(editFeatureUseCase.moveVertices).toHaveBeenNthCalledWith(2, [
      { vertexId: "vertex-3", newPosition: { x: 0, y: 0 } }
    ]);
    expect(undoResult).toEqual({
      movedVerticesResult: undoResponse,
      eventType: "MultipleVerticesMoved",
      eventPayload: undoResponse
    });
  });

  it("replays and rewinds MoveVerticesCommand using feature patch payloads", async () => {
    const serializer = new HistorySerializer();
    const beforeFeature = createLine("line-patch", ["vertex-1", "vertex-2"]);
    const afterFeature = createLine("line-patch", ["vertex-1", "vertex-added"]);
    const addedVertex = new Vertex("vertex-added", 7, 8);

    const world = {
      vertices: [
        { id: "vertex-1", x: 0, y: 0 },
        { id: "vertex-2", x: 5, y: 0 }
      ],
      features: [beforeFeature],
      layers: []
    };
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async () => {})
    };
    const editFeatureUseCase = {
      moveVertices: vi.fn()
    };
    const payload = {
      featureChanges: [
        {
          featureId: "line-patch",
          beforeFeatureData: serializer.serialize(beforeFeature),
          afterFeatureData: serializer.serialize(afterFeature)
        }
      ],
      addedVertices: [serializer.serialize(addedVertex)]
    };

    const command = new MoveVerticesCommand(payload, editFeatureUseCase, serializer, worldRepository);

    const executeResult = await command.execute();
    expect(executeResult).toEqual({ eventType: "WorldUpdated", eventPayload: null });
    expect(editFeatureUseCase.moveVertices).not.toHaveBeenCalled();
    const featureAfterExecute = world.features.find((feature) => feature.id === "line-patch");
    expect(featureAfterExecute).toBeInstanceOf(Line);
    expect(featureAfterExecute.vertexIds).toEqual(["vertex-1", "vertex-added"]);
    expect(world.vertices).toContainEqual({ id: "vertex-added", x: 7, y: 8 });

    const reverseResult = await command.reverse();
    expect(reverseResult).toEqual({ eventType: "WorldUpdated", eventPayload: null });
    const featureAfterReverse = world.features.find((feature) => feature.id === "line-patch");
    expect(featureAfterReverse).toBeInstanceOf(Line);
    expect(featureAfterReverse.vertexIds).toEqual(["vertex-1", "vertex-2"]);
    expect(world.vertices.some((vertex) => vertex.id === "vertex-added")).toBe(false);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(2);
  });

  it("executes DeleteVerticesCommand and rebuilds state on reverse", async () => {
    const serializer = new HistorySerializer();
    const deleteResult = {
      deletedVertexIds: ["vertex-remove"],
      updatedFeatureIds: ["line-1"],
      deletedFeatureIds: []
    };
    const editFeatureUseCase = {
      deleteVertices: vi.fn().mockResolvedValue(deleteResult)
    };

    const world = {
      vertices: [
        { id: "vertex-keep", x: 0, y: 0 },
        { id: "vertex-tail", x: 10, y: 10 }
      ],
      features: [createLine("line-1", ["vertex-keep", "vertex-tail"])],
      layers: []
    };

    const vertexToRestore = new Vertex("vertex-remove", 5, 5);
    const originalLine = createLine("line-1", ["vertex-keep", "vertex-remove", "vertex-tail"]);

    const payload = {
      deletedVertexIds: ["vertex-remove"],
      verticesToRestoreData: [serializer.serialize(vertexToRestore)],
      affectedFeaturesBefore: [serializer.serialize(originalLine)]
    };

    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async () => {})
    };

    const command = new DeleteVerticesCommand(payload, editFeatureUseCase, worldRepository, serializer);

    const executeResult = await command.execute();
    expect(editFeatureUseCase.deleteVertices).toHaveBeenCalledWith(["vertex-remove"]);
    expect(executeResult).toEqual({
      deletedVertexResult: deleteResult,
      eventType: "VerticesDeletedCustom",
      eventPayload: deleteResult
    });

    const reverseResult = await command.reverse();
    expect(worldRepository.saveWorld).toHaveBeenCalled();
    expect(world.vertices.map((v) => v.id)).toContain("vertex-remove");
    const restoredLine = world.features.find((f) => f.id === "line-1");
    expect(restoredLine).toBeInstanceOf(Line);
    expect(restoredLine.vertexIds).toEqual(originalLine.vertexIds);
    expect(reverseResult.updatedFeatures).toHaveLength(1);
    expect(reverseResult.updatedFeatures[0]).toBeInstanceOf(Line);
    expect(reverseResult.updatedFeatures[0].vertexIds).toEqual(originalLine.vertexIds);
  });

  it("updates properties through UpdatePropertiesCommand", async () => {
    const serializer = new HistorySerializer();
    const originalProperty = createProperty(1500, "Original");
    const updatedProperty = createProperty(1500, "Updated");

    const editFeatureUseCase = {
      updateFeature: vi.fn()
        .mockResolvedValueOnce({ feature: { id: "feature-prop", phase: "updated" } })
        .mockResolvedValueOnce({ feature: { id: "feature-prop", phase: "original" } })
    };

    const worldRepository = {
      getWorld: vi.fn(),
      saveWorld: vi.fn()
    };

    const payload = {
      featureId: "feature-prop",
      oldProperties: [serializer.serialize(originalProperty)],
      newProperties: [serializer.serialize(updatedProperty)]
    };

    const command = new UpdatePropertiesCommand(payload, editFeatureUseCase, serializer, worldRepository);

    const executeResult = await command.execute();
    expect(editFeatureUseCase.updateFeature).toHaveBeenNthCalledWith(1, "feature-prop", {
      properties: [expect.any(Property)]
    });
    const executeArgs = editFeatureUseCase.updateFeature.mock.calls[0][1];
    expect(executeArgs.properties[0].name).toBe("Updated");
    expect(executeResult).toEqual({ updatedFeature: { id: "feature-prop", phase: "updated" } });

    const reverseResult = await command.reverse();
    expect(editFeatureUseCase.updateFeature).toHaveBeenNthCalledWith(2, "feature-prop", {
      properties: [expect.any(Property)]
    });
    const reverseArgs = editFeatureUseCase.updateFeature.mock.calls[1][1];
    expect(reverseArgs.properties[0].name).toBe("Original");
    expect(reverseResult).toEqual({ updatedFeature: { id: "feature-prop", phase: "original" } });
  });

  it("adds and removes rings through AddRingCommand", async () => {
    const serializer = new HistorySerializer();
    const addedVertex = new Vertex("vertex-new", 3, 4);
    const ringData = {
      id: "ring-extra",
      vertexIds: ["vertex-new", "vertex-a", "vertex-b"],
      ringType: "hole",
      parentId: "ring-root"
    };

    const world = {
      vertices: [
        { id: "vertex-a", x: 0, y: 0 },
        { id: "vertex-b", x: 5, y: 0 }
      ],
      features: [],
      layers: []
    };

    const updatedPolygon = createPolygon("polygon-1", [ringData]);
    const polygonAfterRemoval = createPolygon("polygon-1", []);

    const editFeatureUseCase = {
      updateFeature: vi.fn()
        .mockResolvedValueOnce({ feature: updatedPolygon })
        .mockResolvedValueOnce({ feature: polygonAfterRemoval }),
      deleteVertices: vi.fn().mockResolvedValue({ deletedVertexIds: [addedVertex.id] })
    };

    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async () => {})
    };

    const payload = {
      polygonId: "polygon-1",
      addedRing: ringData,
      addedVerticesData: [serializer.serialize(addedVertex)]
    };

    const command = new AddRingCommand(payload, editFeatureUseCase, worldRepository, serializer);

    const executeResult = await command.execute();
    expect(world.vertices.map((v) => v.id)).toContain("vertex-new");
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(editFeatureUseCase.updateFeature).toHaveBeenNthCalledWith(1, "polygon-1", {
      geometry: { existingRingData: [ringData] }
    });
    expect(executeResult).toEqual({ updatedFeature: updatedPolygon });

    const reverseResult = await command.reverse();
    expect(editFeatureUseCase.updateFeature).toHaveBeenNthCalledWith(2, "polygon-1", {
      geometry: { removedRingIds: [ringData.id] }
    });
    expect(editFeatureUseCase.deleteVertices).toHaveBeenCalledWith([addedVertex.id]);
    expect(reverseResult).toEqual({ updatedFeature: polygonAfterRemoval });
  });

  it("adds and removes a vertex via AddVertexToEdgeCommand", async () => {
    const serializer = new HistorySerializer();
    const addedVertex = new Vertex("vertex-new", 2, 2);
    const featureBefore = createLine("line-1", ["vertex-a", "vertex-b", "vertex-c"]);
    const featureAfter = createLine("line-1", ["vertex-a", "vertex-new", "vertex-b", "vertex-c"]);

    const editFeatureUseCase = {
      addVertexToFeatureEdge: vi.fn().mockResolvedValue({
        newVertex: addedVertex,
        updatedFeature: featureAfter
      })
    };

    const world = {
      vertices: [
        { id: "vertex-a", x: 0, y: 0 },
        { id: "vertex-b", x: 5, y: 0 },
        { id: "vertex-c", x: 10, y: 0 },
        { id: "vertex-new", x: 2, y: 2 }
      ],
      features: [featureAfter],
      layers: []
    };

    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async () => {})
    };

    const payload = {
      featureId: "line-1",
      ringId: null,
      segmentStartVertexId: "vertex-a",
      segmentEndVertexId: "vertex-b",
      newVertexId: "vertex-new",
      addedVertexData: serializer.serialize(addedVertex),
      featureBeforeData: serializer.serialize(featureBefore)
    };

    const command = new AddVertexToEdgeCommand(payload, editFeatureUseCase, worldRepository, serializer);

    const executeResult = await command.execute();
    expect(editFeatureUseCase.addVertexToFeatureEdge).toHaveBeenCalledWith(
      "line-1",
      "vertex-a",
      "vertex-b",
      { x: addedVertex.x, y: addedVertex.y },
      null,
      "vertex-new"
    );
    expect(executeResult).toEqual({
      updatedFeature: featureAfter,
      eventType: "VertexAddedToEdge",
      eventPayload: {
        featureId: featureAfter.id,
        addedVertex,
        updatedFeature: featureAfter
      }
    });

    const reverseResult = await command.reverse();
    expect(worldRepository.saveWorld).toHaveBeenCalled();
    expect(world.vertices.some((v) => v.id === "vertex-new")).toBe(false);
    const restoredLine = world.features.find((f) => f.id === "line-1");
    expect(restoredLine).toBeInstanceOf(Line);
    expect(restoredLine.vertexIds).toEqual(featureBefore.vertexIds);
    expect(reverseResult).toEqual({
      updatedFeature: expect.any(Line),
      eventType: "VertexRemovedFromEdge",
      eventPayload: {
        featureId: "line-1",
        removedVertexId: "vertex-new",
        updatedFeature: expect.any(Line)
      }
    });
  });
});
