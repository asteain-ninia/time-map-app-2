// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService } from "../../../src/application/services/HistoryService.js";
import { HistoryStackManager } from "../../../src/application/services/history/HistoryStackManager.js";
import { HistorySerializer } from "../../../src/application/services/history/HistorySerializer.js";
import { EditFeatureUseCase } from "../../../src/application/usecases/EditFeatureUseCase.js";
import { IdGenerationService } from "../../../src/application/services/IdGenerationService.js";
import { Property } from "../../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../../src/domain/value-objects/TimePoint.js";
import { Vertex } from "../../../src/domain/entities/Vertex.js";
import { Point } from "../../../src/domain/entities/Point.js";

const createProperty = (name = "Name") => new Property(new TimePoint(0), name, "", {});

class DeterministicIdGenerationService extends IdGenerationService {
  constructor() {
    super();
    this._counters = new Map();
  }

  generateId(type) {
    const next = (this._counters.get(type) ?? 0) + 1;
    this._counters.set(type, next);
    return `${type}-${String(next).padStart(3, "0")}`;
  }
}

class InMemoryWorldRepository {
  constructor(initialWorld) {
    this._world = initialWorld;
  }

  async getWorld() {
    return this._world;
  }

  async saveWorld(world) {
    this._world = world;
  }
}

const createEventBus = () => {
  const handlers = new Map();
  const events = [];
  return {
    publish: vi.fn((type, payload) => {
      events.push({ type, payload });
      const callbacks = handlers.get(type) || [];
      callbacks.forEach((cb) => {
        try {
          cb(payload);
        } catch (error) {
          console.error("Event handler error", error);
        }
      });
    }),
    subscribe: vi.fn((type, handler) => {
      if (!handlers.has(type)) {
        handlers.set(type, []);
      }
      handlers.get(type).push(handler);
    }),
    events,
    handlers
  };
};

const noopAsync = async () => {};

const createPolygonEditStub = () => ({
  validatePolygonRings: vi.fn(noopAsync),
  addRingToPolygon: vi.fn(() => Promise.reject(new Error("addRingToPolygon should not be called"))),
  addRingWithId: vi.fn(() => Promise.reject(new Error("addRingWithId should not be called"))),
  removeRingFromPolygon: vi.fn(() => Promise.reject(new Error("removeRingFromPolygon should not be called"))),
  updateRingVertices: vi.fn(() => Promise.reject(new Error("updateRingVertices should not be called"))),
  updatePolygonGeometry: vi.fn(() => Promise.reject(new Error("updatePolygonGeometry should not be called"))),
  splitPolygon: vi.fn(() => Promise.reject(new Error("splitPolygon should not be called")))
});

const createGeometryServiceStub = () => ({
  isPolygonSelfIntersecting: vi.fn(() => false)
});

const createLayerServiceStub = () => ({
  validateLayerHierarchy: vi.fn(() => true)
});

const createWorld = () => ({
  features: [],
  vertices: [],
  layers: [
    { id: "layer-0", name: "Base", order: 0, visible: true, opacity: 1 }
  ],
  metadata: {
    settings: {
      sliderMin: 0,
      sliderMax: 100,
      gridInterval: 10,
      gridColor: "#cccccc",
      gridOpacity: 0.5,
      equatorLength: 40000,
      worldName: "Test World",
      worldDescription: ""
    }
  }
});

const serializeVertex = (serializer, vertexData) =>
  serializer.serialize(new Vertex(vertexData.id, vertexData.x, vertexData.y));

const createTestContext = () => {
  const world = createWorld();
  const worldRepository = new InMemoryWorldRepository(world);
  const idService = new DeterministicIdGenerationService();
  const geometryService = createGeometryServiceStub();
  const layerService = createLayerServiceStub();
  const polygonEditService = createPolygonEditStub();
  const stackManager = new HistoryStackManager(50);
  const serializer = new HistorySerializer();
  const eventBus = createEventBus();
  const editFeatureUseCase = new EditFeatureUseCase(
    worldRepository,
    geometryService,
    layerService,
    polygonEditService,
    idService
  );
  const historyService = new HistoryService(
    stackManager,
    serializer,
    null,
    eventBus,
    worldRepository,
    editFeatureUseCase
  );

  return {
    worldRepository,
    idService,
    geometryService,
    layerService,
    polygonEditService,
    stackManager,
    serializer,
    eventBus,
    editFeatureUseCase,
    historyService
  };
};

describe("HistoryService integration", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  const prepareAddCommand = async (name = "Alpha", coordinates = { x: 1, y: 2 }) => {
    const payload = {};
    const addResult = await ctx.historyService.executeAndRecord(async () => {
      const feature = await ctx.editFeatureUseCase.addFeature(
        "point",
        [createProperty(name)],
        { vertices: [coordinates] },
        "layer-0"
      );
      const worldAfter = await ctx.worldRepository.getWorld();
      const vertexData = worldAfter.vertices.find((v) => v.id === feature.vertexIds[0]);
      Object.assign(payload, {
        featureId: feature.id,
        featureData: ctx.serializer.serialize(feature),
        addedVerticesData: [serializeVertex(ctx.serializer, vertexData)]
      });
      return { addedFeature: feature };
    }, "add", payload);

    return addResult;
  };

  it("adds a feature and restores it via undo/redo", async () => {
    await prepareAddCommand();

    const worldAfterAdd = await ctx.worldRepository.getWorld();
    expect(worldAfterAdd.features).toHaveLength(1);
    expect(worldAfterAdd.vertices).toHaveLength(1);
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(false);

    ctx.eventBus.events.length = 0;
    await ctx.historyService.undo();

    const worldAfterUndo = await ctx.worldRepository.getWorld();
    expect(worldAfterUndo.features).toHaveLength(0);
    expect(worldAfterUndo.vertices).toHaveLength(0);
    expect(ctx.historyService.canUndo()).toBe(false);
    expect(ctx.historyService.canRedo()).toBe(true);
    expect(ctx.eventBus.events.map((e) => e.type)).toEqual([
      "FeatureDeleted",
      "WorldUpdated",
      "HistoryChanged"
    ]);
    const historyPayloadUndo = ctx.eventBus.events.at(-1)?.payload;
    expect(historyPayloadUndo).toEqual({ canUndo: false, canRedo: true });

    ctx.eventBus.events.length = 0;
    await ctx.historyService.redo();

    const worldAfterRedo = await ctx.worldRepository.getWorld();
    expect(worldAfterRedo.features).toHaveLength(1);
    expect(worldAfterRedo.vertices).toHaveLength(1);
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(false);
    expect(ctx.eventBus.events.map((e) => e.type)).toEqual([
      "FeatureAdded",
      "WorldUpdated",
      "HistoryChanged"
    ]);
    const historyPayloadRedo = ctx.eventBus.events.at(-1)?.payload;
    expect(historyPayloadRedo).toEqual({ canUndo: true, canRedo: false });
  });

  it("records delete operations and restores world state on undo", async () => {
    const addResult = await prepareAddCommand("Beta", { x: 5, y: 6 });
    const addedFeature = addResult.addedFeature;

    const deletePayload = {};
    await ctx.historyService.executeAndRecord(async () => {
      const worldBefore = await ctx.worldRepository.getWorld();
      const feature = worldBefore.features.find((f) => f.id === addedFeature.id);
      const verticesData = feature.vertexIds.map((id) => {
        const data = worldBefore.vertices.find((v) => v.id === id);
        return serializeVertex(ctx.serializer, data);
      });
      Object.assign(deletePayload, {
        featureId: feature.id,
        featureData: ctx.serializer.serialize(feature),
        verticesToRestoreData: verticesData
      });
      await ctx.editFeatureUseCase.deleteFeature(feature.id);
      return { deletedFeatureId: feature.id };
    }, "delete", deletePayload);

    const worldAfterDelete = await ctx.worldRepository.getWorld();
    expect(worldAfterDelete.features).toHaveLength(0);
    expect(worldAfterDelete.vertices).toHaveLength(0);
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(false);

    ctx.eventBus.events.length = 0;
    await ctx.historyService.undo();

    const worldAfterUndo = await ctx.worldRepository.getWorld();
    expect(worldAfterUndo.features).toHaveLength(1);
    expect(worldAfterUndo.vertices).toHaveLength(1);
    expect(worldAfterUndo.features[0]).toBeInstanceOf(Point);
    expect(worldAfterUndo.features[0].id).toBe(addedFeature.id);
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(true);
    expect(ctx.eventBus.events.map((e) => e.type)).toEqual([
      "FeatureAdded",
      "WorldUpdated",
      "HistoryChanged"
    ]);
    const undoHistoryState = ctx.eventBus.events.at(-1)?.payload;
    expect(undoHistoryState).toEqual({ canUndo: true, canRedo: true });

    ctx.eventBus.events.length = 0;
    await ctx.historyService.redo();

    const worldAfterRedo = await ctx.worldRepository.getWorld();
    expect(worldAfterRedo.features).toHaveLength(0);
    expect(worldAfterRedo.vertices).toHaveLength(0);
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(false);
    expect(ctx.eventBus.events.map((e) => e.type)).toEqual([
      "FeatureDeleted",
      "WorldUpdated",
      "HistoryChanged"
    ]);
    const redoHistoryState = ctx.eventBus.events.at(-1)?.payload;
    expect(redoHistoryState).toEqual({ canUndo: true, canRedo: false });
  });

  it("moves vertices with undo/redo restoring coordinates", async () => {
    const addResult = await prepareAddCommand("Gamma", { x: 2, y: 3 });
    const feature = addResult.addedFeature;
    const vertexId = feature.vertexIds[0];

    const movePayload = { updates: [] };
    const originalWorld = await ctx.worldRepository.getWorld();
    const originalVertexData = originalWorld.vertices.find((v) => v.id === vertexId);
    const newPosition = { x: originalVertexData.x + 5, y: originalVertexData.y + 7 };

    movePayload.updates.push({
      vertexId,
      oldPosition: serializeVertex(ctx.serializer, originalVertexData),
      newPosition: ctx.serializer.serialize(new Vertex(vertexId, newPosition.x, newPosition.y))
    });

    await ctx.historyService.executeAndRecord(async () => {
      const result = await ctx.editFeatureUseCase.moveVertices([
        { vertexId, newPosition }
      ]);
      return {
        movedVerticesResult: result,
        eventType: "MultipleVerticesMoved",
        eventPayload: result
      };
    }, "moveVertices", movePayload);

    const worldAfterMove = await ctx.worldRepository.getWorld();
    const movedVertex = worldAfterMove.vertices.find((v) => v.id === vertexId);
    expect(movedVertex).toEqual({ id: vertexId, x: newPosition.x, y: newPosition.y });
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(false);

    ctx.eventBus.events.length = 0;
    await ctx.historyService.undo();
    const worldAfterUndo = await ctx.worldRepository.getWorld();
    const revertedVertex = worldAfterUndo.vertices.find((v) => v.id === vertexId);
    expect(revertedVertex).toEqual({ id: vertexId, x: originalVertexData.x, y: originalVertexData.y });
    expect(ctx.eventBus.events.map((e) => e.type)).toEqual([
      "MultipleVerticesMoved",
      "WorldUpdated",
      "HistoryChanged"
    ]);
    expect(ctx.eventBus.events.at(-1)?.payload).toEqual({ canUndo: true, canRedo: true });

    ctx.eventBus.events.length = 0;
    await ctx.historyService.redo();
    const worldAfterRedo = await ctx.worldRepository.getWorld();
    const vertexAfterRedo = worldAfterRedo.vertices.find((v) => v.id === vertexId);
    expect(vertexAfterRedo).toEqual({ id: vertexId, x: newPosition.x, y: newPosition.y });
    expect(ctx.eventBus.events.map((e) => e.type)).toEqual([
      "MultipleVerticesMoved",
      "WorldUpdated",
      "HistoryChanged"
    ]);
    expect(ctx.eventBus.events.at(-1)?.payload).toEqual({ canUndo: true, canRedo: false });
  });

  it("clears redo stack when a new command is executed after undo", async () => {
    const addResult = await prepareAddCommand("Delta", { x: 3, y: 4 });
    const feature = addResult.addedFeature;
    const vertexId = feature.vertexIds[0];

    const movePayload = { updates: [] };
    const worldBeforeMove = await ctx.worldRepository.getWorld();
    const vertexData = worldBeforeMove.vertices.find((v) => v.id === vertexId);
    const shifted = { x: vertexData.x + 10, y: vertexData.y + 1 };

    movePayload.updates.push({
      vertexId,
      oldPosition: serializeVertex(ctx.serializer, vertexData),
      newPosition: ctx.serializer.serialize(new Vertex(vertexId, shifted.x, shifted.y))
    });

    await ctx.historyService.executeAndRecord(async () => {
      const result = await ctx.editFeatureUseCase.moveVertices([
        { vertexId, newPosition: shifted }
      ]);
      return {
        movedVerticesResult: result,
        eventType: "MultipleVerticesMoved",
        eventPayload: result
      };
    }, "moveVertices", movePayload);

    await ctx.historyService.undo();
    expect(ctx.historyService.canRedo()).toBe(true);

    const deletePayload = {};
    await ctx.historyService.executeAndRecord(async () => {
      const worldCurrent = await ctx.worldRepository.getWorld();
      const featureToDelete = worldCurrent.features.find((f) => f.id === feature.id);
      const verticesData = featureToDelete.vertexIds.map((id) => {
        const data = worldCurrent.vertices.find((v) => v.id === id);
        return serializeVertex(ctx.serializer, data);
      });
      Object.assign(deletePayload, {
        featureId: featureToDelete.id,
        featureData: ctx.serializer.serialize(featureToDelete),
        verticesToRestoreData: verticesData
      });
      await ctx.editFeatureUseCase.deleteFeature(featureToDelete.id);
      return { deletedFeatureId: featureToDelete.id };
    }, "delete", deletePayload);

    expect(ctx.historyService.canRedo()).toBe(false);
    expect(ctx.historyService.canUndo()).toBe(true);
    const latestEvent = ctx.eventBus.events.at(-1);
    expect(latestEvent?.type).toBe("HistoryChanged");
    expect(latestEvent?.payload).toEqual({ canUndo: true, canRedo: false });

    const worldAfterDelete = await ctx.worldRepository.getWorld();
    expect(worldAfterDelete.features).toHaveLength(0);
  });
});
