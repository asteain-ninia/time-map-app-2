// Tests authored by Codex.
import { describe, it, expect } from "vitest";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { buildPolygonSplitPlan } from "../../src/domain/services/PolygonSplitService.js";

const geometryService = new GeometryService();

const buildVerticesMap = (entries) => new Map(entries.map(([id, x, y]) => [id, { x, y }]));

const calculatePolygonArea = (polygon) =>
  polygon.rings.reduce((total, ring) => {
    const area = geometryService.calculatePolygonArea(ring.points);
    return total + (ring.ringType === "territory" ? area : -area);
  }, 0);

const expectValidRings = (polygon) => {
  polygon.rings.forEach(ring => {
    const coords = ring.points.map(point => ({ x: point.x, y: point.y }));
    expect(coords.length).toBeGreaterThanOrEqual(3);
    expect(geometryService.isPolygonSelfIntersecting(coords)).toBe(false);
  });
};

describe("PolygonSplitService", () => {
  it("splits a polygon with a hole when the cut line crosses the hole", () => {
    const verticesMap = buildVerticesMap([
      ["v1", 0, 0],
      ["v2", 10, 0],
      ["v3", 10, 10],
      ["v4", 0, 10],
      ["h1", 3, 3],
      ["h2", 7, 3],
      ["h3", 7, 7],
      ["h4", 3, 7]
    ]);

    const rings = [
      { id: "r-outer", ringType: "territory", parentId: null, vertexIds: ["v1", "v2", "v3", "v4"] },
      { id: "r-hole", ringType: "hole", parentId: "r-outer", vertexIds: ["h1", "h2", "h3", "h4"] }
    ];

    const cutLinePoints = [
      { x: -1, y: 5 },
      { x: 11, y: 5 }
    ];

    const plan = buildPolygonSplitPlan({
      rings,
      verticesMap,
      cutLinePoints,
      geometryService
    });

    expect(plan.polygons).toHaveLength(2);
    plan.polygons.forEach(polygon => {
      expectValidRings(polygon);
      expect(polygon.rings.some(ring => ring.ringType === "hole")).toBe(false);
    });

    const totalArea = calculatePolygonArea(plan.polygons[0]) + calculatePolygonArea(plan.polygons[1]);
    expect(totalArea).toBeCloseTo(84, 6);
  });

  it("allows starting the cut line inside a hole", () => {
    const verticesMap = buildVerticesMap([
      ["v1", 0, 0],
      ["v2", 10, 0],
      ["v3", 10, 10],
      ["v4", 0, 10],
      ["h1", 3, 3],
      ["h2", 7, 3],
      ["h3", 7, 7],
      ["h4", 3, 7]
    ]);

    const rings = [
      { id: "r-outer", ringType: "territory", parentId: null, vertexIds: ["v1", "v2", "v3", "v4"] },
      { id: "r-hole", ringType: "hole", parentId: "r-outer", vertexIds: ["h1", "h2", "h3", "h4"] }
    ];

    const cutLinePoints = [
      { x: 5, y: 5 },
      { x: 11, y: 5 }
    ];

    const plan = buildPolygonSplitPlan({
      rings,
      verticesMap,
      cutLinePoints,
      geometryService
    });

    expect(plan.polygons).toHaveLength(2);
    plan.polygons.forEach(polygon => {
      expectValidRings(polygon);
      expect(polygon.rings.some(ring => ring.ringType === "hole")).toBe(false);
    });

    const totalArea = calculatePolygonArea(plan.polygons[0]) + calculatePolygonArea(plan.polygons[1]);
    expect(totalArea).toBeCloseTo(84, 6);
  });

  it("rejects self-intersecting split lines", () => {
    const verticesMap = buildVerticesMap([
      ["v1", 0, 0],
      ["v2", 10, 0],
      ["v3", 10, 10],
      ["v4", 0, 10]
    ]);

    const rings = [
      { id: "r-outer", ringType: "territory", parentId: null, vertexIds: ["v1", "v2", "v3", "v4"] }
    ];

    const cutLinePoints = [
      { x: -1, y: 2 },
      { x: 11, y: 8 },
      { x: -1, y: 8 },
      { x: 11, y: 2 }
    ];

    expect(() => buildPolygonSplitPlan({
      rings,
      verticesMap,
      cutLinePoints,
      geometryService
    })).toThrow(/自己交差/);
  });

  it("splits a polygon by a closed split line into inside/outside", () => {
    const verticesMap = buildVerticesMap([
      ["v1", 0, 0],
      ["v2", 10, 0],
      ["v3", 10, 10],
      ["v4", 0, 10]
    ]);

    const rings = [
      { id: "r-outer", ringType: "territory", parentId: null, vertexIds: ["v1", "v2", "v3", "v4"] }
    ];

    const circlePoints = [];
    const center = { x: 5, y: 5 };
    const radius = 1.5;
    const segments = 16;
    for (let i = 0; i < segments; i++) {
      const angle = (Math.PI * 2 * i) / segments;
      circlePoints.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }

    const plan = buildPolygonSplitPlan({
      rings,
      verticesMap,
      cutLinePoints: circlePoints,
      geometryService,
      isClosed: true
    });

    expect(plan.polygons).toHaveLength(2);
    plan.polygons.forEach(expectValidRings);

    const holeCounts = plan.polygons.map(polygon =>
      polygon.rings.filter(ring => ring.ringType === "hole").length
    );
    expect(holeCounts.sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
