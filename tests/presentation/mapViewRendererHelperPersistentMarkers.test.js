// Created by Codex
import { describe, expect, it } from "vitest";
import { MapViewRendererHelper } from "../../src/presentation/views/map/MapViewRendererHelper.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createPolygonFeature = () => {
  const property = new Property(new TimePoint(0), "Test", "", {}, null, null);
  return new Polygon(
    "polygon-1",
    [property],
    "layer-1",
    "0",
    [],
    [
      {
        id: "ring-1",
        vertexIds: ["v1", "v2", "v3"],
        ringType: "territory",
        parentId: null
      }
    ]
  );
};

const createWorld = () => ({
  vertices: [
    { id: "v1", x: 0, y: 0 },
    { id: "v2", x: 10, y: 0 },
    { id: "v3", x: 5, y: 10 }
  ]
});

const createRenderer = () => {
  const drawPointCalls = [];
  const renderer = {
    drawLine: () => null,
    drawPoint: (x, y, style, viewport) => {
      drawPointCalls.push({ x, y, style, viewport });
      return null;
    },
    drawText: () => null,
    drawPolygonLoops: () => null,
    removeElement: () => {},
    getWorldWidth: () => 360,
    getRenderOffsets: () => [0]
  };

  return { renderer, drawPointCalls };
};

const createViewModel = (overrides = {}) => {
  const {
    features = [createPolygonFeature()],
    world = createWorld(),
    selectedFeatureIds = new Set(),
    selectedVertexIds = new Set(),
    vertexContextFeatureId = null,
    vertexOwnerIds = new Set()
  } = overrides;

  return {
    getSelectedFeatureIds: () => selectedFeatureIds,
    getSelectedVertexIds: () => selectedVertexIds,
    getVertexSelectionContextId: () => vertexContextFeatureId,
    getVertexSelectionOwnerIds: () => vertexOwnerIds,
    getFeatures: () => features,
    getWorld: () => world,
    getCurrentTime: () => new TimePoint(0)
  };
};

const createEditingViewModel = () => ({
  getDraggingVerticesInfo: () => new Map(),
  getMode: () => "view",
  getTool: () => null,
  getTargetPolygon: () => null
});

const createViewportManager = () => ({
  getViewport: () => ({ x: 0, y: 0, width: 100, height: 100, zoom: 1 })
});

describe("MapViewRendererHelper persistent vertex markers", () => {
  it("skips persistent markers when limit is exceeded and no selection exists", () => {
    const { renderer, drawPointCalls } = createRenderer();
    const configManager = {
      get: (path, fallback) => (path === "ui.persistentVertexMarkerLimit" ? 2 : fallback)
    };
    const helper = new MapViewRendererHelper(
      renderer,
      createViewModel(),
      createEditingViewModel(),
      createViewportManager(),
      configManager
    );

    helper.renderSelection();

    expect(drawPointCalls).toHaveLength(0);
  });

  it("draws persistent markers when limit allows them", () => {
    const { renderer, drawPointCalls } = createRenderer();
    const configManager = {
      get: (path, fallback) => (path === "ui.persistentVertexMarkerLimit" ? 10 : fallback)
    };
    const helper = new MapViewRendererHelper(
      renderer,
      createViewModel(),
      createEditingViewModel(),
      createViewportManager(),
      configManager
    );

    helper.renderSelection();

    expect(drawPointCalls).toHaveLength(3);
  });

  it("keeps selection markers even when persistent markers are disabled", () => {
    const { renderer, drawPointCalls } = createRenderer();
    const configManager = {
      get: (path, fallback) => (path === "ui.persistentVertexMarkerLimit" ? 2 : fallback)
    };
    const helper = new MapViewRendererHelper(
      renderer,
      createViewModel({ selectedVertexIds: new Set(["v1"]) }),
      createEditingViewModel(),
      createViewportManager(),
      configManager
    );

    helper.renderSelection();

    expect(drawPointCalls).toHaveLength(1);
  });
});
