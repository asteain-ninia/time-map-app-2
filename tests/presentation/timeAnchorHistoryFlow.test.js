// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { MapViewModel } from "../../src/presentation/view-models/MapViewModel.js";
import { EventBus } from "../../src/presentation/EventBus.js";
import { EditFeatureUseCase } from "../../src/application/usecases/EditFeatureUseCase.js";
import { HistoryService } from "../../src/application/services/HistoryService.js";
import { HistoryStackManager } from "../../src/application/services/history/HistoryStackManager.js";
import { HistorySerializer } from "../../src/application/services/history/HistorySerializer.js";
import { IdGenerationService } from "../../src/application/services/IdGenerationService.js";
import { Point } from "../../src/domain/entities/Point.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";

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
  constructor(world) {
    this._world = world;
  }

  async getWorld() {
    return this._world;
  }

  async saveWorld(world) {
    this._world = world;
  }
}

const createNavigateTimeUseCase = (initialTime) => {
  let currentTime = initialTime;

  return {
    getCurrentTime: vi.fn(() => currentTime),
    moveToTime: vi.fn((year, month = null, day = null) => {
      currentTime = new TimePoint(year, month, day);
      return currentTime;
    }),
    createTimePoint: vi.fn((year, month = null, day = null) => new TimePoint(year, month, day)),
    setCurrentTime(timePoint) {
      currentTime = timePoint;
    },
    getCalendarConfig: vi.fn(() => ({ monthsPerYear: 12, daysPerMonth: Array(12).fill(30) })),
    getDaysInMonth: vi.fn(() => 30)
  };
};

const createLayerService = () => ({
  validateLayerHierarchy: vi.fn(() => true),
  validatePolygonHierarchy: vi.fn(() => true),
  isContainedInHigherLayerPolygon: vi.fn(() => true),
  checkExclusivity: vi.fn(() => true)
});

const createPolygonEditService = () => ({});

const createWorld = (t1000, t2000) => ({
  features: [
    globalThis.createAnchoredPoint(
      "point-time-flow",
      ["v-old"],
      [
        new FeatureAnchor({
          id: "anchor-point-1000",
          timeRange: { start: t1000, end: t2000 },
          property: { name: "Point", description: "", attributes: {} },
          shape: { type: "Point", vertexId: "v-old" },
          placement: { layerId: "layer-0" }
        }),
        new FeatureAnchor({
          id: "anchor-point-2000",
          timeRange: { start: t2000, end: null },
          property: { name: "Point", description: "", attributes: {} },
          shape: { type: "Point", vertexId: "v-old" },
          placement: { layerId: "layer-0" }
        })
      ],
      "layer-0"
    )
  ],
  vertices: [{ id: "v-old", x: 0, y: 0 }],
  layers: [{ id: "layer-0", name: "Base", order: 0, visible: true, opacity: 1 }],
  metadata: {
    settings: {
      sliderMin: 0,
      sliderMax: 3000,
      zoomMin: 1,
      zoomMax: 50,
      gridInterval: 10,
      gridColor: "#cccccc",
      gridOpacity: 0.5,
      equatorLength: 40000,
      worldName: "Flow",
      worldDescription: ""
    }
  }
});

const flushAsyncEvents = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const buildMoveVerticesPayload = (serializer, moveResult) => {
  const featureChanges = Array.isArray(moveResult?.historyPatch?.featureChanges)
    ? moveResult.historyPatch.featureChanges.map((change) => ({
      featureId: change.featureId,
      beforeFeatureData: serializer.serialize(change.beforeFeature),
      afterFeatureData: serializer.serialize(change.afterFeature)
    }))
    : [];
  const addedVertices = Array.isArray(moveResult?.historyPatch?.addedVertices)
    ? moveResult.historyPatch.addedVertices.map((vertexData) =>
      serializer.serialize(new Vertex(vertexData.id, vertexData.x, vertexData.y))
    )
    : [];

  return { featureChanges, addedVertices };
};

describe("time anchor edit flow automation", () => {
  it("keeps point vertex selection aligned across timeline move, edit, undo and redo", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t2000 = new TimePoint(2000);
    const worldRepository = new InMemoryWorldRepository(createWorld(t1000, t2000));
    const layerService = createLayerService();
    const editFeatureUseCase = new EditFeatureUseCase(
      worldRepository,
      {},
      layerService,
      createPolygonEditService(),
      new DeterministicIdGenerationService()
    );
    const serializer = new HistorySerializer();
    const eventBus = new EventBus();
    const historyService = new HistoryService(
      new HistoryStackManager(20),
      serializer,
      null,
      eventBus,
      worldRepository,
      editFeatureUseCase
    );
    const navigateTimeUseCase = createNavigateTimeUseCase(t1000);
    const mapViewModel = new MapViewModel(
      editFeatureUseCase,
      navigateTimeUseCase,
      {},
      {},
      eventBus,
      { execute: vi.fn(async (settings) => settings) }
    );

    await mapViewModel.loadWorld();
    mapViewModel.selectVertex("v-old");
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual(["v-old"]);

    navigateTimeUseCase.setCurrentTime(t1100);
    eventBus.publish("TimeChanged", { time: t1100 });
    await flushAsyncEvents();
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual(["v-old"]);

    const movePayload = {};
    await historyService.executeAndRecord(async () => {
      const result = await editFeatureUseCase.moveVertices(
        [{ vertexId: "v-old", newPosition: { x: 5, y: 5 } }],
        { editTime: t1100 }
      );
      Object.assign(movePayload, buildMoveVerticesPayload(serializer, result));
      return result;
    }, "moveVertices", movePayload);

    eventBus.publish("WorldUpdated");
    await flushAsyncEvents();

    const worldAfterMove = await worldRepository.getWorld();
    const movedFeature = worldAfterMove.features.find((feature) => feature.id === "point-time-flow");
    const movedVertexId = movedFeature.getVertexIdAt(t1100);
    expect(movedVertexId).not.toBe("v-old");
    expect(movedFeature.getVertexIdAt(t1000)).toBe("v-old");
    expect(movedFeature.getVertexIdAt(t2000)).toBe("v-old");
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual([]);

    mapViewModel.selectVertex(movedVertexId);
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual([movedVertexId]);
    mapViewModel.selectVertex("v-old");
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual([]);

    await historyService.undo();
    await flushAsyncEvents();

    const worldAfterUndo = await worldRepository.getWorld();
    const featureAfterUndo = worldAfterUndo.features.find((feature) => feature.id === "point-time-flow");
    expect(featureAfterUndo.getVertexIdAt(t1100)).toBe("v-old");
    mapViewModel.selectVertex(movedVertexId);
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual([]);
    mapViewModel.selectVertex("v-old");
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual(["v-old"]);

    await historyService.redo();
    await flushAsyncEvents();

    const worldAfterRedo = await worldRepository.getWorld();
    const featureAfterRedo = worldAfterRedo.features.find((feature) => feature.id === "point-time-flow");
    expect(featureAfterRedo.getVertexIdAt(t1100)).toBe(movedVertexId);
    mapViewModel.selectVertex("v-old");
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual([]);
    mapViewModel.selectVertex(movedVertexId);
    expect([...mapViewModel.getSelectedVertexIds()]).toEqual([movedVertexId]);
  });
});
