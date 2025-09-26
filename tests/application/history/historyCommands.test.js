// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { AddFeatureCommand } from "../../../src/application/services/history/commands/AddFeatureCommand.js";
import { DeleteFeatureCommand } from "../../../src/application/services/history/commands/DeleteFeatureCommand.js";
import { MoveVerticesCommand } from "../../../src/application/services/history/commands/MoveVerticesCommand.js";
import { HistorySerializer } from "../../../src/application/services/history/HistorySerializer.js";
import { Vertex } from "../../../src/domain/entities/Vertex.js";
import { Point } from "../../../src/domain/entities/Point.js";
import { Property } from "../../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../../src/domain/value-objects/TimePoint.js";

const createProperty = (year = 1900, name = "Name") =>
  new Property(new TimePoint(year), name, "", {});

const createPoint = (id, vertexId) =>
  new Point(id, [vertexId], [createProperty()], "layer-1");

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
});
