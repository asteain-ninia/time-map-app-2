// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { applyVertexSliding, createVertexSlidingContext } from "../../src/application/services/VertexSlideService.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

describe("VertexSlideService", () => {
  const createWorld = () => {
    const property = new FeatureAnchor({
      id: "anchor-vertex-slide",
      timeRange: { start: new TimePoint(0), end: null },
      property: { name: "Name", description: "", attributes: {} },
      shape: {},
      placement: {}
    });
    const vertices = [
      { id: "a1", x: 12, y: 5 },
      { id: "a2", x: 14, y: 6 },
      { id: "a3", x: 14, y: 4 },
      { id: "b1", x: 0, y: 0 },
      { id: "b2", x: 10, y: 0 },
      { id: "b3", x: 10, y: 10 },
      { id: "b4", x: 0, y: 10 }
    ];

    const polygonA = globalThis.createAnchoredPolygon("poly-a", [property], "layer-1", "0", [], [
      { id: "ring-a", ringType: "territory", parentId: null, vertexIds: ["a1", "a2", "a3"] }
    ]);
    const polygonB = globalThis.createAnchoredPolygon("poly-b", [property], "layer-1", "0", [], [
      { id: "ring-b", ringType: "territory", parentId: null, vertexIds: ["b1", "b2", "b3", "b4"] }
    ]);

    return {
      features: [polygonA, polygonB],
      vertices,
      layers: []
    };
  };

  const mapToObject = (map) => Object.fromEntries(
    [...map.entries()].map(([id, pos]) => [id, { x: pos.x, y: pos.y }])
  );

  it("slides a dragged vertex along a blocking polygon edge", () => {
    const geometryService = new GeometryService();
    const world = createWorld();
    const desiredPositions = new Map([["a1", { x: 9, y: 5 }]]);
    const originalPositions = new Map([["a1", { x: 12, y: 5 }]]);

    const adjusted = applyVertexSliding({
      world,
      geometryService,
      movedVertexIds: new Set(["a1"]),
      desiredPositions,
      originalPositions
    });

    const result = adjusted.get("a1");
    expect(result.x).toBeCloseTo(10, 5);
    expect(result.y).toBeCloseTo(5, 5);
  });

  it("keeps results stable with a precomputed context", () => {
    const geometryService = new GeometryService();
    const world = createWorld();
    const desiredPositions = new Map([["a1", { x: 9, y: 5 }]]);
    const originalPositions = new Map([["a1", { x: 12, y: 5 }]]);
    const baseline = applyVertexSliding({
      world,
      geometryService,
      movedVertexIds: new Set(["a1"]),
      desiredPositions,
      originalPositions
    });
    const context = createVertexSlidingContext(world);
    const adjusted = applyVertexSliding({
      world,
      geometryService,
      movedVertexIds: new Set(["a1"]),
      desiredPositions,
      originalPositions,
      context
    });
    expect(mapToObject(adjusted)).toEqual(mapToObject(baseline));
  });

  it("reuses context across calls without changing results", () => {
    const geometryService = new GeometryService();
    const world = createWorld();
    const context = createVertexSlidingContext(world);

    const desiredPositionsA1 = new Map([["a1", { x: 9, y: 5 }]]);
    const originalPositionsA1 = new Map([["a1", { x: 12, y: 5 }]]);
    const baselineA1 = applyVertexSliding({
      world,
      geometryService,
      movedVertexIds: new Set(["a1"]),
      desiredPositions: desiredPositionsA1,
      originalPositions: originalPositionsA1
    });
    const adjustedA1 = applyVertexSliding({
      world,
      geometryService,
      movedVertexIds: new Set(["a1"]),
      desiredPositions: desiredPositionsA1,
      originalPositions: originalPositionsA1,
      context
    });
    expect(mapToObject(adjustedA1)).toEqual(mapToObject(baselineA1));

    const desiredPositionsA2 = new Map([["a2", { x: 6, y: 12 }]]);
    const originalPositionsA2 = new Map([["a2", { x: 14, y: 6 }]]);
    const baselineA2 = applyVertexSliding({
      world,
      geometryService,
      movedVertexIds: new Set(["a2"]),
      desiredPositions: desiredPositionsA2,
      originalPositions: originalPositionsA2
    });
    const adjustedA2 = applyVertexSliding({
      world,
      geometryService,
      movedVertexIds: new Set(["a2"]),
      desiredPositions: desiredPositionsA2,
      originalPositions: originalPositionsA2,
      context
    });
    expect(mapToObject(adjustedA2)).toEqual(mapToObject(baselineA2));
  });
});
