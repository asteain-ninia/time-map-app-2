// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService } from "../../../src/application/services/HistoryService.js";
import { HistoryStackManager } from "../../../src/application/services/history/HistoryStackManager.js";
import { HistorySerializer } from "../../../src/application/services/history/HistorySerializer.js";
import { EditFeatureUseCase } from "../../../src/application/usecases/EditFeatureUseCase.js";
import { IdGenerationService } from "../../../src/application/services/IdGenerationService.js";
import { Polygon } from "../../../src/domain/entities/Polygon.js";
import { FeatureAnchor } from "../../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../../src/domain/value-objects/TimePoint.js";
import { Vertex } from "../../../src/domain/entities/Vertex.js";
import { GeometryService } from "../../../src/domain/services/GeometryService.js";
import { buildPolygonSplitPlan } from "../../../src/domain/services/PolygonSplitService.js";

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

const cloneRing = (ring) => ({
  id: ring.id,
  vertexIds: [...ring.vertexIds],
  ringType: ring.ringType,
  parentId: ring.parentId ?? null
});

const createPolygonAnchor = ({ id, start, end, name, vertexIds = [], rings = null, childIds = [] }) =>
  new FeatureAnchor({
    id,
    timeRange: { start, end },
    property: { name, description: "", attributes: {} },
    shape: {
      type: "Polygon",
      rings: Array.isArray(rings) && rings.length > 0
        ? rings.map((ring) => cloneRing(ring))
        : [
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
      childIds: [...childIds]
    }
  });

const createSplitAnchorDraft = (endTime = null) =>
  new FeatureAnchor({
    id: "anchor-draft",
    timeRange: { start: new TimePoint(0), end: endTime },
    property: { name: "Split Child", description: "", attributes: {} },
    shape: {},
    placement: {}
  });

const createWorld = (t1000, t2000) => ({
  features: [
    globalThis.createAnchoredPolygon(
      "poly-1",
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

const createWorldWithCustomPolygon = ({ anchors, latestRings, vertices }) => ({
  features: [
    globalThis.createAnchoredPolygon(
      "poly-1",
      anchors,
      "layer-0",
      "0",
      [],
      latestRings
    )
  ],
  vertices: vertices.map((vertex) => ({ ...vertex })),
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

const createContextWithWorld = (world) => {
  const worldRepository = new InMemoryWorldRepository(world);
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

const createContext = () => {
  const t1000 = new TimePoint(1000);
  const t2000 = new TimePoint(2000);
  return createContextWithWorld(createWorld(t1000, t2000));
};

const calculatePolygonAreaAt = (polygon, timePoint, world, geometryService = new GeometryService()) => {
  const verticesMap = new Map((world.vertices || []).map((vertex) => [vertex.id, vertex]));
  return polygon.getRingsAt(timePoint).reduce((total, ring) => {
    const points = ring.vertexIds.map((vertexId) => {
      const vertex = verticesMap.get(vertexId);
      if (!vertex) {
        throw new Error(`Vertex not found: ${vertexId}`);
      }
      return { x: vertex.x, y: vertex.y };
    });
    const area = geometryService.calculatePolygonArea(points);
    return total + (ring.ringType === "territory" ? area : -area);
  }, 0);
};

const buildCirclePoints = (center, radius, segments = 16) => {
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  return points;
};

const buildSplitPlanForFeature = (world, polygonId, editTime, cutLinePoints, options = {}) => {
  const polygon = world.features.find((feature) => feature.id === polygonId);
  if (!polygon) {
    throw new Error(`Polygon not found: ${polygonId}`);
  }
  const geometryService = new GeometryService();
  return buildPolygonSplitPlan({
    rings: polygon.getRingsAt(editTime),
    verticesMap: new Map(world.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }])),
    cutLinePoints,
    geometryService,
    isClosed: options.isClosed === true
  });
};

describe("SplitPolygon history integration", () => {
  let ctx;

  beforeEach(() => {
    ctx = createContext();
  });

  it("records splitPolygon with editTime and restores timeline by undo/redo", async () => {
    const editTime = new TimePoint(1500);
    const payload = {};
    const splitAnchor = createSplitAnchorDraft();
    let splitResult;

    ctx.eventBus.events.length = 0;
    await ctx.historyService.executeAndRecord(async () => {
      const worldBefore = await ctx.worldRepository.getWorld();
      const originalPolygon = worldBefore.features.find((feature) => feature.id === "poly-1");
        splitResult = await ctx.editFeatureUseCase.splitPolygon(
          "poly-1",
          createSplitPlan(),
          0,
          splitAnchor,
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

  it("records splitPolygon for a hole polygon and restores the hole on undo", async () => {
    const t1000 = new TimePoint(1000);
    const t2000 = new TimePoint(2000);
    const customWorld = createWorldWithCustomPolygon({
      anchors: [
        createPolygonAnchor({
          id: "anchor-1000",
          start: t1000,
          end: t2000,
          name: "Past",
          rings: [
            {
              id: "ring-outer-1000",
              vertexIds: ["v1", "v2", "v3", "v4"],
              ringType: "territory",
              parentId: null
            },
            {
              id: "ring-hole-1000",
              vertexIds: ["h1", "h2", "h3", "h4"],
              ringType: "hole",
              parentId: "ring-outer-1000"
            }
          ]
        }),
        createPolygonAnchor({
          id: "anchor-2000",
          start: t2000,
          end: null,
          name: "Future",
          rings: [
            {
              id: "ring-future",
              vertexIds: ["f1", "f2", "f3", "f4"],
              ringType: "territory",
              parentId: null
            }
          ]
        })
      ],
      latestRings: [
        {
          id: "ring-future",
          vertexIds: ["f1", "f2", "f3", "f4"],
          ringType: "territory",
          parentId: null
        }
      ],
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 10, y: 0 },
        { id: "v3", x: 10, y: 10 },
        { id: "v4", x: 0, y: 10 },
        { id: "h1", x: 3, y: 3 },
        { id: "h2", x: 7, y: 3 },
        { id: "h3", x: 7, y: 7 },
        { id: "h4", x: 3, y: 7 },
        { id: "f1", x: 20, y: 0 },
        { id: "f2", x: 30, y: 0 },
        { id: "f3", x: 30, y: 10 },
        { id: "f4", x: 20, y: 10 }
      ]
    });
    const holeCtx = createContextWithWorld(customWorld);
    const editTime = new TimePoint(1500);
    const splitPlan = buildSplitPlanForFeature(customWorld, "poly-1", editTime, [
      { x: -1, y: 5 },
      { x: 11, y: 5 }
    ]);
    const payload = {};
    const splitAnchor = createSplitAnchorDraft();
    let splitResult;

    await holeCtx.historyService.executeAndRecord(async () => {
      const worldBefore = await holeCtx.worldRepository.getWorld();
      const originalPolygon = worldBefore.features.find((feature) => feature.id === "poly-1");
      splitResult = await holeCtx.editFeatureUseCase.splitPolygon(
        "poly-1",
        splitPlan,
        0,
        splitAnchor,
        editTime
      );
      Object.assign(payload, {
        polygonId: "poly-1",
        originalPolygonData: holeCtx.serializer.serialize(originalPolygon),
        updatedPolygonData: holeCtx.serializer.serialize(splitResult.updatedPolygon),
        newPolygonData: holeCtx.serializer.serialize(splitResult.newPolygon),
        addedVerticesData: (splitResult.addedVerticesData || []).map((vertexData) =>
          holeCtx.serializer.serialize(new Vertex(vertexData.id, vertexData.x, vertexData.y))
        )
      });
      return {
        updatedFeature: splitResult.updatedPolygon,
        addedFeature: splitResult.newPolygon
      };
    }, "splitPolygon", payload);

    const worldAfterSplit = await holeCtx.worldRepository.getWorld();
    const updatedPolygon = worldAfterSplit.features.find((feature) => feature.id === "poly-1");
    const newPolygon = worldAfterSplit.features.find((feature) => feature.id === splitResult.newPolygon.id);

    expect(calculatePolygonAreaAt(updatedPolygon, editTime, worldAfterSplit) + calculatePolygonAreaAt(newPolygon, editTime, worldAfterSplit))
      .toBeCloseTo(84, 6);
    expect(updatedPolygon.getRingsAt(editTime).some((ring) => ring.ringType === "hole")).toBe(false);
    expect(newPolygon.getRingsAt(editTime).some((ring) => ring.ringType === "hole")).toBe(false);

    await holeCtx.historyService.undo();

    const worldAfterUndo = await holeCtx.worldRepository.getWorld();
    const restoredPolygon = worldAfterUndo.features.find((feature) => feature.id === "poly-1");
    expect(restoredPolygon.getRingsAt(editTime).filter((ring) => ring.ringType === "hole")).toHaveLength(1);

    await holeCtx.historyService.redo();

    const worldAfterRedo = await holeCtx.worldRepository.getWorld();
    const redoneUpdatedPolygon = worldAfterRedo.features.find((feature) => feature.id === "poly-1");
    const redoneNewPolygon = worldAfterRedo.features.find((feature) => feature.id === splitResult.newPolygon.id);
    expect(calculatePolygonAreaAt(redoneUpdatedPolygon, editTime, worldAfterRedo) + calculatePolygonAreaAt(redoneNewPolygon, editTime, worldAfterRedo))
      .toBeCloseTo(84, 6);
    expect(redoneUpdatedPolygon.getRingsAt(editTime).some((ring) => ring.ringType === "hole")).toBe(false);
    expect(redoneNewPolygon.getRingsAt(editTime).some((ring) => ring.ringType === "hole")).toBe(false);
  });

  it("records splitPolygon for a polygon with enclaves and restores top-level territories on undo/redo", async () => {
    const t1000 = new TimePoint(1000);
    const t2000 = new TimePoint(2000);
    const ringsAtAllTimes = [
      {
        id: "ring-main",
        vertexIds: ["v1", "v2", "v3", "v4"],
        ringType: "territory",
        parentId: null
      },
      {
        id: "ring-enclave",
        vertexIds: ["e1", "e2", "e3", "e4"],
        ringType: "territory",
        parentId: null
      }
    ];
    const customWorld = createWorldWithCustomPolygon({
      anchors: [
        createPolygonAnchor({
          id: "anchor-1000",
          start: t1000,
          end: t2000,
          name: "Past",
          rings: ringsAtAllTimes
        }),
        createPolygonAnchor({
          id: "anchor-2000",
          start: t2000,
          end: null,
          name: "Future",
          rings: ringsAtAllTimes
        })
      ],
      latestRings: ringsAtAllTimes,
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 10, y: 0 },
        { id: "v3", x: 10, y: 10 },
        { id: "v4", x: 0, y: 10 },
        { id: "e1", x: 20, y: 0 },
        { id: "e2", x: 24, y: 0 },
        { id: "e3", x: 24, y: 4 },
        { id: "e4", x: 20, y: 4 }
      ]
    });
    const enclaveCtx = createContextWithWorld(customWorld);
    const editTime = new TimePoint(1500);
    const splitPlan = buildSplitPlanForFeature(customWorld, "poly-1", editTime, [
      { x: 5, y: -1 },
      { x: 5, y: 11 }
    ]);
    const payload = {};
    const splitAnchor = createSplitAnchorDraft();
    let splitResult;

    await enclaveCtx.historyService.executeAndRecord(async () => {
      const worldBefore = await enclaveCtx.worldRepository.getWorld();
      const originalPolygon = worldBefore.features.find((feature) => feature.id === "poly-1");
      splitResult = await enclaveCtx.editFeatureUseCase.splitPolygon(
        "poly-1",
        splitPlan,
        0,
        splitAnchor,
        editTime
      );
      Object.assign(payload, {
        polygonId: "poly-1",
        originalPolygonData: enclaveCtx.serializer.serialize(originalPolygon),
        updatedPolygonData: enclaveCtx.serializer.serialize(splitResult.updatedPolygon),
        newPolygonData: enclaveCtx.serializer.serialize(splitResult.newPolygon),
        addedVerticesData: (splitResult.addedVerticesData || []).map((vertexData) =>
          enclaveCtx.serializer.serialize(new Vertex(vertexData.id, vertexData.x, vertexData.y))
        )
      });
      return {
        updatedFeature: splitResult.updatedPolygon,
        addedFeature: splitResult.newPolygon
      };
    }, "splitPolygon", payload);

    const getTopLevelTerritoryCounts = (world) => {
      const updatedPolygon = world.features.find((feature) => feature.id === "poly-1");
      const newPolygon = world.features.find((feature) => feature.id === splitResult.newPolygon.id);
      return [updatedPolygon, newPolygon]
        .map((polygon) => polygon.getRingsAt(editTime).filter((ring) => ring.ringType === "territory" && ring.parentId === null).length)
        .sort((left, right) => left - right);
    };

    const worldAfterSplit = await enclaveCtx.worldRepository.getWorld();
    const [updatedPolygon, newPolygon] = [
      worldAfterSplit.features.find((feature) => feature.id === "poly-1"),
      worldAfterSplit.features.find((feature) => feature.id === splitResult.newPolygon.id)
    ];
    expect(calculatePolygonAreaAt(updatedPolygon, editTime, worldAfterSplit) + calculatePolygonAreaAt(newPolygon, editTime, worldAfterSplit))
      .toBeCloseTo(116, 6);
    expect(getTopLevelTerritoryCounts(worldAfterSplit)).toEqual([1, 2]);

    await enclaveCtx.historyService.undo();

    const worldAfterUndo = await enclaveCtx.worldRepository.getWorld();
    const restoredPolygon = worldAfterUndo.features.find((feature) => feature.id === "poly-1");
    expect(restoredPolygon.getRingsAt(editTime).filter((ring) => ring.ringType === "territory" && ring.parentId === null)).toHaveLength(2);

    await enclaveCtx.historyService.redo();

    const worldAfterRedo = await enclaveCtx.worldRepository.getWorld();
    expect(getTopLevelTerritoryCounts(worldAfterRedo)).toEqual([1, 2]);
  });

  it("records splitPolygon for a closed split and restores the hole structure on undo/redo", async () => {
    const closedCtx = createContext();
    const editTime = new TimePoint(1500);
    const splitPlan = buildSplitPlanForFeature(
      await closedCtx.worldRepository.getWorld(),
      "poly-1",
      editTime,
      buildCirclePoints({ x: 5, y: 5 }, 1.5),
      { isClosed: true }
    );
    const payload = {};
    const splitAnchor = createSplitAnchorDraft();
    let splitResult;

    await closedCtx.historyService.executeAndRecord(async () => {
      const worldBefore = await closedCtx.worldRepository.getWorld();
      const originalPolygon = worldBefore.features.find((feature) => feature.id === "poly-1");
      splitResult = await closedCtx.editFeatureUseCase.splitPolygon(
        "poly-1",
        splitPlan,
        0,
        splitAnchor,
        editTime
      );
      Object.assign(payload, {
        polygonId: "poly-1",
        originalPolygonData: closedCtx.serializer.serialize(originalPolygon),
        updatedPolygonData: closedCtx.serializer.serialize(splitResult.updatedPolygon),
        newPolygonData: closedCtx.serializer.serialize(splitResult.newPolygon),
        addedVerticesData: (splitResult.addedVerticesData || []).map((vertexData) =>
          closedCtx.serializer.serialize(new Vertex(vertexData.id, vertexData.x, vertexData.y))
        )
      });
      return {
        updatedFeature: splitResult.updatedPolygon,
        addedFeature: splitResult.newPolygon
      };
    }, "splitPolygon", payload);

    const getHoleCounts = async () => {
      const world = await closedCtx.worldRepository.getWorld();
      const updatedPolygon = world.features.find((feature) => feature.id === "poly-1");
      const newPolygon = world.features.find((feature) => feature.id === splitResult.newPolygon.id);
      return [updatedPolygon, newPolygon]
        .map((polygon) => polygon.getRingsAt(editTime).filter((ring) => ring.ringType === "hole").length)
        .sort((left, right) => left - right);
    };

    expect(await getHoleCounts()).toEqual([0, 1]);

    await closedCtx.historyService.undo();

    const worldAfterUndo = await closedCtx.worldRepository.getWorld();
    const restoredPolygon = worldAfterUndo.features.find((feature) => feature.id === "poly-1");
    expect(restoredPolygon.getRingsAt(editTime).filter((ring) => ring.ringType === "hole")).toHaveLength(0);

    await closedCtx.historyService.redo();

    expect(await getHoleCounts()).toEqual([0, 1]);
  });

  it("does not record splitPolygon when split fails", async () => {
    ctx.layerService.checkExclusivity.mockReturnValue(false);
    const editTime = new TimePoint(1500);
    const payload = {};
    const splitAnchor = createSplitAnchorDraft();

    await expect(
      ctx.historyService.executeAndRecord(async () => {
        const worldBefore = await ctx.worldRepository.getWorld();
        const originalPolygon = worldBefore.features.find((feature) => feature.id === "poly-1");
        const result = await ctx.editFeatureUseCase.splitPolygon(
          "poly-1",
          createSplitPlan(),
          0,
          splitAnchor,
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
    ).rejects.toThrow(/重なっています|形状が不正/);

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
