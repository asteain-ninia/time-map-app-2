// Tests authored by Codex.
import { describe, it, expect } from "vitest";
import { GeometryService } from "../../src/domain/services/GeometryService.js";

const service = new GeometryService();

describe("GeometryService", () => {
  it("computes Euclidean and planar distances", () => {
    expect(service.calculateDistance(0, 0, 3, 4)).toBe(5);
    const linear = service.calculateLinearDistanceInKm(0, 0, 1, 0, 40075);
    expect(linear).toBeCloseTo(40075 / 360, 3);
  });

  it("computes great circle distances on a sphere", () => {
    const quarterCircumference = (2 * Math.PI * 6371) / 4;
    const distance = service.calculateGreatCircleDistance(0, 0, 0, 90);
    expect(distance).toBeCloseTo(quarterCircumference, -1);
  });

  it("detects self-intersecting polygons", () => {
    const bowTie = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 2, y: 0 }
    ];
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 }
    ];

    expect(service.isPolygonSelfIntersecting(bowTie)).toBe(true);
    expect(service.isPolygonSelfIntersecting(square)).toBe(false);
  });

  it("identifies whether rings intersect", () => {
    const ringA = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 }
    ];
    const ringB = [
      { x: 2, y: 2 },
      { x: 5, y: 2 },
      { x: 5, y: 5 },
      { x: 2, y: 5 }
    ];
    const ringC = [
      { x: 10, y: 10 },
      { x: 12, y: 10 },
      { x: 12, y: 12 },
      { x: 10, y: 12 }
    ];

    expect(service.doRingsIntersect(ringA, ringB)).toBe(true);
    expect(service.doRingsIntersect(ringA, ringC)).toBe(false);
  });
});
