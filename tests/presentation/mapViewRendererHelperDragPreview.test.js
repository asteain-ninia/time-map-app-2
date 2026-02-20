// Created by Codex
import { describe, expect, it, vi } from "vitest";
import { MapViewRendererHelper } from "../../src/presentation/views/map/MapViewRendererHelper.js";
import { Line } from "../../src/domain/entities/Line.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { editingStyles } from "../../src/infrastructure/rendering/RenderStyleProvider.js";

const createProperty = () =>
  new FeatureAnchor({
    id: "anchor-line",
    timeRange: { start: new TimePoint(0), end: null },
    property: { name: "Line", description: "", attributes: {} },
    shape: {},
    placement: {}
  });

const createLine = (vertexIds = ["v1", "v2"]) =>
  globalThis.createAnchoredLine("line-1", vertexIds, [createProperty()], "layer-1");

const createRenderer = ({ worldWidth = 360, offsets = [0], provideOffsets = true } = {}) => {
  const drawPointCalls = [];
  const drawLineCalls = [];
  const removedElements = [];

  const makeElement = () => ({ classList: { add: vi.fn() } });

  const renderer = {
    drawLine: (points, style, viewport) => {
      drawLineCalls.push({ points, style, viewport });
      return makeElement();
    },
    drawPoint: (x, y, style, viewport) => {
      drawPointCalls.push({ x, y, style, viewport });
      return makeElement();
    },
    drawText: () => null,
    removeElement: (element) => {
      removedElements.push(element);
    },
    getWorldWidth: () => worldWidth
  };

  if (provideOffsets) {
    renderer.getRenderOffsets = () => offsets;
  }

  return { renderer, drawPointCalls, drawLineCalls, removedElements };
};

const createViewModel = (world) => ({
  getWorld: () => world,
  getFeatures: () => world.features || [],
  getCurrentTime: () => new TimePoint(0)
});

const createEditingViewModel = ({
  draggingVerticesInfo,
  pendingVertexAdditionInfo = null,
  getSharePreviewVertexIds
}) => {
  const resolveDraggingVerticesInfo = () =>
    typeof draggingVerticesInfo === "function" ? draggingVerticesInfo() : draggingVerticesInfo;
  const viewModel = {
    getDraggingVerticesInfo: () => resolveDraggingVerticesInfo(),
    getPendingVertexAdditionInfo: () => pendingVertexAdditionInfo
  };

  if (typeof getSharePreviewVertexIds === "function") {
    viewModel.getSharePreviewVertexIds = getSharePreviewVertexIds;
  }

  return viewModel;
};

const createViewportManager = (zoom = 1) => ({
  getViewport: () => ({ x: 0, y: 0, width: 120, height: 100, zoom })
});

const createConfigManager = () => ({
  get: (_path, fallback) => fallback
});

describe("MapViewRendererHelper.renderDragPreview", () => {
  it("passes worldWidth to share-preview lookup and draws fallback offsets without throwing", () => {
    const sharePreviewSpy = vi.fn(() => new Set());
    const draggingVerticesInfo = new Map([
      ["v1", { originalPosition: { x: 10, y: 20 }, currentPosition: { x: 11, y: 21 } }]
    ]);
    const world = {
      vertices: [{ id: "v1", x: 10, y: 20 }],
      features: []
    };
    const { renderer, drawPointCalls } = createRenderer({
      worldWidth: 720,
      provideOffsets: false
    });
    const helper = new MapViewRendererHelper(
      renderer,
      createViewModel(world),
      createEditingViewModel({
        draggingVerticesInfo,
        getSharePreviewVertexIds: sharePreviewSpy
      }),
      createViewportManager(),
      createConfigManager()
    );

    expect(() => helper.renderDragPreview()).not.toThrow();
    expect(sharePreviewSpy).toHaveBeenCalledTimes(1);
    expect(sharePreviewSpy.mock.calls[0][0].worldWidth).toBe(720);
    expect(drawPointCalls.map(call => call.x)).toEqual([11, -709, 731]);
  });

  it("uses drag-share style when share-preview returns dragged vertex ids", () => {
    const draggingVerticesInfo = new Map([
      ["v1", { originalPosition: { x: 0, y: 0 }, currentPosition: { x: 1, y: 2 } }]
    ]);
    const world = {
      vertices: [{ id: "v1", x: 0, y: 0 }],
      features: []
    };
    const sharePreviewSpy = vi.fn(() => new Set(["v1"]));
    const { renderer, drawPointCalls } = createRenderer({ offsets: [0] });
    const helper = new MapViewRendererHelper(
      renderer,
      createViewModel(world),
      createEditingViewModel({
        draggingVerticesInfo,
        getSharePreviewVertexIds: sharePreviewSpy
      }),
      createViewportManager(),
      createConfigManager()
    );

    helper.renderDragPreview();

    const expectedStyle = editingStyles.dragShareVertex || editingStyles.dragVertex;
    expect(drawPointCalls).toHaveLength(1);
    expect(drawPointCalls[0].style).toBe(expectedStyle);
  });

  it("draws pending edge-insert preview line with inserted vertex during drag", () => {
    const world = {
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 10, y: 0 },
        { id: "v3", x: 5, y: 0 }
      ],
      features: [createLine(["v1", "v2"])]
    };
    const draggingVerticesInfo = new Map([
      ["v3", { originalPosition: { x: 5, y: 0 }, currentPosition: { x: 5, y: 0 } }]
    ]);
    const pendingVertexAdditionInfo = {
      featureId: "line-1",
      ringId: null,
      segmentStartVertexId: "v1",
      segmentEndVertexId: "v2",
      newVertexId: "v3"
    };
    const { renderer, drawLineCalls } = createRenderer({ offsets: [0] });
    const helper = new MapViewRendererHelper(
      renderer,
      createViewModel(world),
      createEditingViewModel({
        draggingVerticesInfo,
        pendingVertexAdditionInfo,
        getSharePreviewVertexIds: () => new Set()
      }),
      createViewportManager(),
      createConfigManager()
    );

    helper.renderDragPreview();

    expect(drawLineCalls).toHaveLength(1);
    expect(drawLineCalls[0].style).toBe(editingStyles.dragOutline);
    expect(drawLineCalls[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 }
    ]);
  });

  it("clears drag preview cache immediately when dragging becomes empty", () => {
    let draggingVerticesInfo = new Map([
      ["v1", { originalPosition: { x: 1, y: 1 }, currentPosition: { x: 2, y: 2 } }]
    ]);
    const world = {
      vertices: [{ id: "v1", x: 1, y: 1 }],
      features: []
    };
    const sharePreviewSpy = vi.fn(() => new Set());
    const { renderer } = createRenderer({ offsets: [0] });
    const helper = new MapViewRendererHelper(
      renderer,
      createViewModel(world),
      createEditingViewModel({
        draggingVerticesInfo: () => draggingVerticesInfo,
        getSharePreviewVertexIds: sharePreviewSpy
      }),
      createViewportManager(),
      createConfigManager()
    );

    helper.renderDragPreview();
    expect(helper._dragPreviewCache).not.toBeNull();

    draggingVerticesInfo = new Map();
    helper.renderDragPreview();

    expect(helper._dragPreviewCache).toBeNull();
    expect(sharePreviewSpy).toHaveBeenCalledTimes(1);
  });
});
