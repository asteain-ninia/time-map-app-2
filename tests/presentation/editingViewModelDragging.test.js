import { describe, expect, it, vi } from "vitest";
import { draggingMethods } from "../../src/presentation/view-models/EditingViewModelDragging.js";
import { HistorySerializer } from "../../src/application/services/history/HistorySerializer.js";
import { CompositeHistoryCommand } from "../../src/application/services/history/commands/CompositeHistoryCommand.js";
import { MoveVerticesCommand } from "../../src/application/services/history/commands/MoveVerticesCommand.js";
import { ShareVerticesCommand } from "../../src/application/services/history/commands/ShareVerticesCommand.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

function createAnchor() {
  return new FeatureAnchor({
    id: "anchor-1",
    timeRange: { start: new TimePoint(0), end: null },
    property: { name: "Point", description: "", attributes: {} },
    shape: {},
    placement: {}
  });
}

function createWorld() {
  const anchor = createAnchor();
  return {
    vertices: [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 4, y: 0 }
    ],
    features: [
      globalThis.createAnchoredPoint("point-1", ["v1"], [anchor], "layer-1"),
      globalThis.createAnchoredPoint("point-2", ["v2"], [anchor], "layer-1")
    ]
  };
}

function createContext() {
  return {
    _mode: "edit",
    _tool: "move",
    _editFeatureUseCase: null,
    _draggingVerticesInfo: new Map(),
    _shareReactivatedPairKeys: new Set(),
    _vertexSlideContext: null,
    _notifyObservers: vi.fn(),
    _findShareCandidates: draggingMethods._findShareCandidates,
    _buildShareValidationWorld: draggingMethods._buildShareValidationWorld,
    _resolveFeaturesForSharing: draggingMethods._resolveFeaturesForSharing,
    _buildVertexOwnerMap: draggingMethods._buildVertexOwnerMap,
    _collectFeatureVertexIds: draggingMethods._collectFeatureVertexIds,
    _hasOwnerIntersection: draggingMethods._hasOwnerIntersection,
    _calculateDistanceSqWithWrap: draggingMethods._calculateDistanceSqWithWrap
  };
}

function createHistoryService(worldRepository) {
  const serializer = new HistorySerializer();
  let historyService = null;
  historyService = {
    _serializer: serializer,
    _stackManager: { pushUndo: vi.fn() },
    _notifyHistoryChanged: vi.fn(),
    _worldRepository: worldRepository,
    getSerializer: vi.fn(() => serializer),
    getWorldRepository: vi.fn(() => worldRepository),
    serializeForHistory: vi.fn((value) => serializer.serialize(value)),
    recordCommand: vi.fn((command) => {
      historyService._stackManager.pushUndo(command);
      historyService._notifyHistoryChanged();
    })
  };
  return historyService;
}

function createDragEndContext(editFeatureUseCase, historyService, eventBus, dragInfo) {
  return {
    _draggingVerticesInfo: dragInfo,
    _pendingVertexAdditionInfo: null,
    _shareReactivatedPairKeys: new Set(),
    _resetDraggingState: vi.fn(function resetState() {
      this._draggingVerticesInfo.clear();
    }),
    _editFeatureUseCase: editFeatureUseCase,
    _historyService: historyService,
    _eventBus: eventBus,
    _findShareCandidates: draggingMethods._findShareCandidates,
    _buildShareValidationWorld: draggingMethods._buildShareValidationWorld,
    _resolveFeaturesForSharing: draggingMethods._resolveFeaturesForSharing,
    _buildVertexOwnerMap: draggingMethods._buildVertexOwnerMap,
    _collectFeatureVertexIds: draggingMethods._collectFeatureVertexIds,
    _hasOwnerIntersection: draggingMethods._hasOwnerIntersection,
    _calculateDistanceSqWithWrap: draggingMethods._calculateDistanceSqWithWrap,
    _applyVertexSharingAfterDrag: draggingMethods._applyVertexSharingAfterDrag,
    _shareVerticesWithHistory: draggingMethods._shareVerticesWithHistory
  };
}

function createDragOptions(world) {
  return {
    world,
    visibleFeatures: world.features,
    snapWorldDistance: 5,
    worldWidth: 360
  };
}

describe("EditingViewModelDragging shared-vertex reactivation", () => {
  it("keeps sharing suppressed while the dragged vertex stays within the snap range", () => {
    const world = createWorld();
    const context = createContext();
    const options = createDragOptions(world);

    draggingMethods.startVerticesDrag.call(
      context,
      new Map([["v1", { x: 0, y: 0 }]])
    );
    draggingMethods.updateVerticesDrag.call(context, 1, 0, options);

    const previewIds = draggingMethods.getSharePreviewVertexIds.call(context, options);

    expect(Array.from(previewIds)).toEqual([]);
    expect(Array.from(context._shareReactivatedPairKeys)).toEqual([]);
  });

  it("re-enables sharing during the same drag after leaving the snap range once", () => {
    const world = createWorld();
    const context = createContext();
    const options = createDragOptions(world);

    draggingMethods.startVerticesDrag.call(
      context,
      new Map([["v1", { x: 0, y: 0 }]])
    );
    draggingMethods.updateVerticesDrag.call(context, -10, 0, options);

    expect(Array.from(context._shareReactivatedPairKeys)).toEqual(["v1|v2"]);

    draggingMethods.updateVerticesDrag.call(context, 1, 0, options);

    const previewIds = draggingMethods.getSharePreviewVertexIds.call(context, options);

    expect(Array.from(previewIds)).toEqual(["v1"]);
  });

  it("hides share preview when validation fails at the dragged position", () => {
    const world = createWorld();
    const context = createContext();
    const options = createDragOptions(world);
    const canShareSpy = vi.fn((validationWorld) => {
      const draggedVertex = validationWorld.vertices.find((vertex) => vertex.id === "v1");
      return draggedVertex?.x !== 1;
    });
    context._editFeatureUseCase = {
      canShareVerticesInWorld: canShareSpy
    };

    draggingMethods.startVerticesDrag.call(
      context,
      new Map([["v1", { x: 0, y: 0 }]])
    );
    draggingMethods.updateVerticesDrag.call(context, -10, 0, options);
    draggingMethods.updateVerticesDrag.call(context, 1, 0, options);

    const previewIds = draggingMethods.getSharePreviewVertexIds.call(context, options);

    expect(Array.from(previewIds)).toEqual([]);
    expect(canShareSpy).toHaveBeenCalledTimes(1);
    expect(canShareSpy.mock.calls[0][0].vertices.find((vertex) => vertex.id === "v1")).toMatchObject({ x: 1, y: 0 });
  });
});

describe("EditingViewModelDragging drag history batching", () => {
  it("records drag move and share as a single undo entry", async () => {
    let world = {
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 5, y: 0 }
      ],
      features: [
        globalThis.createAnchoredPoint("point-1", ["v1"], [createAnchor()], "layer-1"),
        globalThis.createAnchoredPoint("point-2", ["v2"], [createAnchor()], "layer-1")
      ]
    };
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async (nextWorld) => {
        world = nextWorld;
      })
    };
    const editFeatureUseCase = {
      moveVertices: vi.fn(async (updates) => {
        world = {
          ...world,
          vertices: world.vertices.map((vertex) => {
            const update = updates.find((candidate) => candidate.vertexId === vertex.id);
            return update
              ? { ...vertex, x: update.newPosition.x, y: update.newPosition.y }
              : vertex;
          })
        };
        return {
          updatedVertices: updates.map((update) => ({
            id: update.vertexId,
            x: update.newPosition.x,
            y: update.newPosition.y
          })),
          affectedFeatures: world.features,
          requiresWorldRefresh: false
        };
      }),
      shareVertices: vi.fn(async (vertexId1, vertexId2, options = {}) => ({
        affectedFeatures: world.features,
        removedVertex: world.vertices.find((vertex) => vertex.id === vertexId1),
        keptVertex: world.vertices.find((vertex) => vertex.id === vertexId2),
        options
      })),
      getWorldRepository: vi.fn(() => worldRepository)
    };
    const historyService = createHistoryService(worldRepository);
    const eventBus = { publish: vi.fn() };
    const context = createDragEndContext(
      editFeatureUseCase,
      historyService,
      eventBus,
      new Map([
        ["v1", { originalPosition: { x: 0, y: 0 }, currentPosition: { x: 4, y: 0 } }]
      ])
    );

    await draggingMethods.endVerticesDrag.call(context, {
      visibleFeatures: world.features,
      snapWorldDistance: 3,
      worldWidth: 360
    });

    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    const command = historyService._stackManager.pushUndo.mock.calls[0][0];
    expect(command).toBeInstanceOf(CompositeHistoryCommand);
    expect(command._commands).toHaveLength(2);
    expect(command._commands[0]).toBeInstanceOf(MoveVerticesCommand);
    expect(command._commands[1]).toBeInstanceOf(ShareVerticesCommand);
    expect(editFeatureUseCase.shareVertices).toHaveBeenCalledWith(
      "v1",
      "v2",
      expect.objectContaining({ preferredKeptVertexId: "v2" })
    );

    await command.reverse();

    expect(editFeatureUseCase.moveVertices).toHaveBeenCalledTimes(2);
    expect(editFeatureUseCase.moveVertices).toHaveBeenNthCalledWith(
      2,
      [{ vertexId: "v1", newPosition: { x: 0, y: 0 } }]
    );
    expect(eventBus.publish).toHaveBeenCalledWith("WorldUpdated");
  });

  it("keeps multiple share merges from one drag in a single undo entry", async () => {
    let world = {
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 10, y: 0 },
        { id: "v3", x: 5, y: 0 },
        { id: "v4", x: 15, y: 0 }
      ],
      features: [
        globalThis.createAnchoredPoint("point-1", ["v1"], [createAnchor()], "layer-1"),
        globalThis.createAnchoredPoint("point-2", ["v2"], [createAnchor()], "layer-1"),
        globalThis.createAnchoredPoint("point-3", ["v3"], [createAnchor()], "layer-1"),
        globalThis.createAnchoredPoint("point-4", ["v4"], [createAnchor()], "layer-1")
      ]
    };
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async (nextWorld) => {
        world = nextWorld;
      })
    };
    const editFeatureUseCase = {
      moveVertices: vi.fn(async (updates) => {
        world = {
          ...world,
          vertices: world.vertices.map((vertex) => {
            const update = updates.find((candidate) => candidate.vertexId === vertex.id);
            return update
              ? { ...vertex, x: update.newPosition.x, y: update.newPosition.y }
              : vertex;
          })
        };
        return {
          updatedVertices: updates.map((update) => ({
            id: update.vertexId,
            x: update.newPosition.x,
            y: update.newPosition.y
          })),
          affectedFeatures: world.features,
          requiresWorldRefresh: false
        };
      }),
      shareVertices: vi.fn(async (vertexId1, vertexId2) => ({
        affectedFeatures: world.features,
        removedVertex: world.vertices.find((vertex) => vertex.id === vertexId1),
        keptVertex: world.vertices.find((vertex) => vertex.id === vertexId2)
      })),
      getWorldRepository: vi.fn(() => worldRepository)
    };
    const historyService = createHistoryService(worldRepository);
    const eventBus = { publish: vi.fn() };
    const context = createDragEndContext(
      editFeatureUseCase,
      historyService,
      eventBus,
      new Map([
        ["v1", { originalPosition: { x: 0, y: 0 }, currentPosition: { x: 4, y: 0 } }],
        ["v2", { originalPosition: { x: 10, y: 0 }, currentPosition: { x: 14, y: 0 } }]
      ])
    );

    await draggingMethods.endVerticesDrag.call(context, {
      visibleFeatures: world.features,
      snapWorldDistance: 3,
      worldWidth: 360
    });

    expect(editFeatureUseCase.shareVertices).toHaveBeenCalledTimes(2);
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    const command = historyService._stackManager.pushUndo.mock.calls[0][0];
    expect(command).toBeInstanceOf(CompositeHistoryCommand);
    expect(command._commands).toHaveLength(3);
    expect(command._commands[0]).toBeInstanceOf(MoveVerticesCommand);
    expect(command._commands[1]).toBeInstanceOf(ShareVerticesCommand);
    expect(command._commands[2]).toBeInstanceOf(ShareVerticesCommand);
  });
});
