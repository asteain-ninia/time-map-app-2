import { describe, expect, it, vi } from "vitest";
import { draggingMethods } from "../../src/presentation/view-models/EditingViewModelDragging.js";
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
