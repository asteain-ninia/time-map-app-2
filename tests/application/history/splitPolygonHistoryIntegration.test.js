// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService } from "../../../src/application/services/HistoryService.js";
import { HistoryStackManager } from "../../../src/application/services/history/HistoryStackManager.js";
import { HistorySerializer } from "../../../src/application/services/history/HistorySerializer.js";
import { EditFeatureUseCase } from "../../../src/application/usecases/EditFeatureUseCase.js";
import { IdGenerationService } from "../../../src/application/services/IdGenerationService.js";
import { Polygon } from "../../../src/domain/entities/Polygon.js";
import { Property } from "../../../src/domain/value-objects/Property.js";
import { FeatureAnchor } from "../../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../../src/domain/value-objects/TimePoint.js";
import { Vertex } from "../../../src/domain/entities/Vertex.js";

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
      callbacks.forEach((cb) => cb(payload));
    }),
    subscribe: vi.fn((type, handler) => {
      if (!handlers.has(type)) {
        handlers.set(type, []);
      }
      handlers.get(type).push(handler);
    }),
    events
  };
};

const createPolygonEditStub = () => ({
  validatePolygonRings: vi.fn(async () => {}),
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
  validateLayerHierarchy: vi.fn(() => true),
  validatePolygonHierarchy: vi.fn(() => true),
  isContainedInHigherLayerPolygon: vi.fn(() => true),
  checkExclusivity: vi.fn(() => true)
});

const createPolygonAnchor = ({ id, start, end, name, vertexIds }) =>
  new FeatureAnchor({
    id,
    timeRange: { start, end },
    property: { name, description: "", attributes: {} },
    shape: {
      type: "Polygon",
      rings: [
        {
          id: `ring-${id}`,
          vertexIds,
          ringType: "territory",
          parentId: null
        }
      ]
    },
    placement: {
      layerId: "layer-0",
      parentId: "0",
      childIds: []
    }
  });

const createWorld = (t1000, t2000) => ({
  features: [
    new Polygon(
      "poly-1",
      [
        new Property(t1000, "Past", "", {}, t1000, t2000),
        new Property(t2000, "Future", "", {}, t2000, null)
      ],
      "layer-0",
      "0",
      [],
      [
        {
          id: "ring-latest",
          vertexIds: ["v5", "v6", "v7", "v8"],
          ringType: "territory",
          parentId: null
        }
      ],
      [
        createPolygonAnchor({
          id: "anchor-1000",
          start: t1000,
          end: t2000,
          name: "Past",
          vertexIds: ["v1", "v2", "v3", "v4"]
        }),
        createPolygonAnchor({
          id: "anchor-2000",
          start: t2000,
          end: null,
          name: "Future",
          vertexIds: ["v5", "v6", "v7", "v8"]
        })
      ]
    )
  ],
  vertices: [
    { id: "v1", x: 0, y: 0 },
    { id: "v2", x: 10, y: 0 },
    { id: "v3", x: 10, y: 10 },
    { id: "v4", x: 0, y: 10 },
    { id: "v5", x: -2, y: -2 },
    { id: "v6", x: 12, y: -2 },
    { id: "v7", x: 12, y: 12 },
    { id: "v8", x: -2, y: 12 }
  ],
  layers: [{ id: "layer-0", name: "Base", order: 0, visible: true, opacity: 1 }],
  metadata: {
    settings: {
      sliderMin: 0,
      sliderMax: 4000
    }
  }
});

const createSplitPlan = () => ({
  polygons: [
    {
      rings: [
        {
          ringType: "territory",
          parentIndex: null,
          points: [
            { x: 0, y: 0, sourceVertexId: "v1" },
            { x: 5, y: 0, key: "split-a" },
            { x: 5, y: 10, key: "split-b" },
            { x: 0, y: 10, sourceVertexId: "v4" }
          ]
        }
      ]
    },
    {
      rings: [
        {
          ringType: "territory",
          parentIndex: null,
          points: [
            { x: 5, y: 0, key: "split-a" },
            { x: 10, y: 0, sourceVertexId: "v2" },
            { x: 10, y: 10, sourceVertexId: "v3" },
            { x: 5, y: 10, key: "split-b" }
          ]
        }
      ]
    }
  ]
});

const createContext = () => {
  const t1000 = new TimePoint(1000);
  const t2000 = new TimePoint(2000);
  const worldRepository = new InMemoryWorldRepository(createWorld(t1000, t2000));
  const geometryService = createGeometryServiceStub();
  const layerService = createLayerServiceStub();
  const polygonEditService = createPolygonEditStub();
  const idService = new DeterministicIdGenerationService();
  const serializer = new HistorySerializer();
  const stackManager = new HistoryStackManager(20);
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
    geometryService,
    layerService,
    serializer,
    eventBus,
    editFeatureUseCase,
    historyService
  };
};

describe("SplitPolygon history integration", () => {
  let ctx;

  beforeEach(() => {
    ctx = createContext();
  });

  it("records splitPolygon with editTime and restores timeline by undo/redo", async () => {
    const editTime = new TimePoint(1500);
    const payload = {};
    const splitProperty = new Property(new TimePoint(0), "Split Child", "", {}, new TimePoint(0), null);
    let splitResult;

    ctx.eventBus.events.length = 0;
    await ctx.historyService.executeAndRecord(async () => {
      const worldBefore = await ctx.worldRepository.getWorld();
      const originalPolygon = worldBefore.features.find((feature) => feature.id === "poly-1");
      splitResult = await ctx.editFeatureUseCase.splitPolygon(
        "poly-1",
        createSplitPlan(),
        0,
        splitProperty,
        editTime
      );
      Object.assign(payload, {
        polygonId: "poly-1",
        originalPolygonData: ctx.serializer.serialize(originalPolygon),
        updatedPolygonData: ctx.serializer.serialize(splitResult.updatedPolygon),
        newPolygonData: ctx.serializer.serialize(splitResult.newPolygon),
        addedVerticesData: (splitResult.addedVerticesData || []).map((vertexData) =>
          ctx.serializer.serialize(new Vertex(vertexData.id, vertexData.x, vertexData.y))
        )
      });
      return {
        updatedFeature: splitResult.updatedPolygon,
        addedFeature: splitResult.newPolygon
      };
    }, "splitPolygon", payload);

    const addedVertexIds = splitResult.addedVerticesData.map((vertex) => vertex.id);
    const worldAfterSplit = await ctx.worldRepository.getWorld();
    const updatedPolygon = worldAfterSplit.features.find((feature) => feature.id === "poly-1");
    const newPolygon = worldAfterSplit.features.find((feature) => feature.id === splitResult.newPolygon.id);
    const splitVertexIdsOnUpdated = updatedPolygon.getRingsAt(editTime)[0].vertexIds;

    expect(worldAfterSplit.features).toHaveLength(2);
    expect(updatedPolygon).toBeInstanceOf(Polygon);
    expect(newPolygon).toBeInstanceOf(Polygon);
    expect(updatedPolygon.anchors.map((anchor) => anchor.startTime.year)).toEqual([1000, 1500, 2000]);
    expect(updatedPolygon.getRingsAt(new TimePoint(2100))[0].vertexIds).toEqual(["v5", "v6", "v7", "v8"]);
    expect(splitVertexIdsOnUpdated[0]).toBe("v1");
    expect(splitVertexIdsOnUpdated[3]).toBe("v4");
    expect(splitVertexIdsOnUpdated[1]).not.toBe("v2");
    expect(splitVertexIdsOnUpdated[2]).not.toBe("v3");
    expect(newPolygon.anchors.map((anchor) => anchor.startTime.year)).toEqual([1500]);
    expect(newPolygon.anchors[0].endTime.year).toBe(2000);
    expect(newPolygon.getRingsAt(editTime)[0].vertexIds).toContain("v2");
    expect(newPolygon.getRingsAt(editTime)[0].vertexIds).toContain("v3");
    expect(newPolygon.getRingsAt(editTime)[0].vertexIds).toContain(splitVertexIdsOnUpdated[1]);
    expect(newPolygon.getRingsAt(editTime)[0].vertexIds).toContain(splitVertexIdsOnUpdated[2]);
    expect(worldAfterSplit.vertices.filter((vertex) => addedVertexIds.includes(vertex.id))).toHaveLength(2);
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(false);
    expect(ctx.eventBus.events.map((event) => event.type)).toEqual(["HistoryChanged"]);

    ctx.eventBus.events.length = 0;
    await ctx.historyService.undo();

    const worldAfterUndo = await ctx.worldRepository.getWorld();
    const restoredPolygon = worldAfterUndo.features.find((feature) => feature.id === "poly-1");
    expect(worldAfterUndo.features).toHaveLength(1);
    expect(restoredPolygon.anchors.map((anchor) => anchor.startTime.year)).toEqual([1000, 2000]);
    expect(restoredPolygon.getRingsAt(editTime)[0].vertexIds).toEqual(["v1", "v2", "v3", "v4"]);
    expect(worldAfterUndo.vertices.some((vertex) => addedVertexIds.includes(vertex.id))).toBe(false);
    expect(ctx.historyService.canUndo()).toBe(false);
    expect(ctx.historyService.canRedo()).toBe(true);
    expect(ctx.eventBus.events.map((event) => event.type)).toEqual([
      "FeatureUpdated",
      "FeatureDeleted",
      "WorldUpdated",
      "HistoryChanged"
    ]);

    ctx.eventBus.events.length = 0;
    await ctx.historyService.redo();

    const worldAfterRedo = await ctx.worldRepository.getWorld();
    const redoneUpdatedPolygon = worldAfterRedo.features.find((feature) => feature.id === "poly-1");
    const redoneNewPolygon = worldAfterRedo.features.find((feature) => feature.id === splitResult.newPolygon.id);
    expect(worldAfterRedo.features).toHaveLength(2);
    expect(redoneUpdatedPolygon.anchors.map((anchor) => anchor.startTime.year)).toEqual([1000, 1500, 2000]);
    expect(redoneUpdatedPolygon.getRingsAt(editTime)[0].vertexIds).toEqual(splitVertexIdsOnUpdated);
    expect(redoneNewPolygon.anchors.map((anchor) => anchor.startTime.year)).toEqual([1500]);
    expect(worldAfterRedo.vertices.filter((vertex) => addedVertexIds.includes(vertex.id))).toHaveLength(2);
    expect(ctx.historyService.canUndo()).toBe(true);
    expect(ctx.historyService.canRedo()).toBe(false);
    expect(ctx.eventBus.events.map((event) => event.type)).toEqual([
      "FeatureUpdated",
      "FeatureAdded",
      "WorldUpdated",
      "HistoryChanged"
    ]);
  });

  it("does not record splitPolygon when split fails", async () => {
    ctx.layerService.checkExclusivity.mockReturnValue(false);
    const editTime = new TimePoint(1500);
    const payload = {};
    const splitProperty = new Property(new TimePoint(0), "Split Child", "", {}, new TimePoint(0), null);

    await expect(
      ctx.historyService.executeAndRecord(async () => {
        const worldBefore = await ctx.worldRepository.getWorld();
        const originalPolygon = worldBefore.features.find((feature) => feature.id === "poly-1");
        const result = await ctx.editFeatureUseCase.splitPolygon(
          "poly-1",
          createSplitPlan(),
          0,
          splitProperty,
          editTime
        );
        Object.assign(payload, {
          polygonId: "poly-1",
          originalPolygonData: ctx.serializer.serialize(originalPolygon),
          updatedPolygonData: ctx.serializer.serialize(result.updatedPolygon),
          newPolygonData: ctx.serializer.serialize(result.newPolygon),
          addedVerticesData: (result.addedVerticesData || []).map((vertexData) =>
            ctx.serializer.serialize(new Vertex(vertexData.id, vertexData.x, vertexData.y))
          )
        });
        return {
          updatedFeature: result.updatedPolygon,
          addedFeature: result.newPolygon
        };
      }, "splitPolygon", payload)
    ).rejects.toThrow(/重なっています/);

    const worldAfterFailure = await ctx.worldRepository.getWorld();
    const polygonAfterFailure = worldAfterFailure.features.find((feature) => feature.id === "poly-1");
    expect(worldAfterFailure.features).toHaveLength(1);
    expect(polygonAfterFailure.anchors.map((anchor) => anchor.startTime.year)).toEqual([1000, 2000]);
    expect(worldAfterFailure.vertices.some((vertex) => vertex.id.startsWith("vertex-"))).toBe(false);
    expect(ctx.historyService.canUndo()).toBe(false);
    expect(ctx.historyService.canRedo()).toBe(false);
    expect(ctx.eventBus.events).toEqual([]);
  });
});
