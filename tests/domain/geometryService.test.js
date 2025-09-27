// Tests authored by Codex.
import { describe, it, expect, vi } from "vitest";
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

  it("provides squared distances without square root", () => {
    expect(service.calculateDistanceSq(0, 0, 2, 3)).toBe(13);
  });

  it("interpolates great circle paths including endpoints", () => {
    const pathPoints = service.calculateGreatCirclePath(0, 0, 0, 90, 8);

    expect(pathPoints.length).toBe(9);
    expect(pathPoints[0]).toEqual({ x: 0, y: 0 });
    expect(pathPoints[pathPoints.length - 1]).toEqual({ x: 0, y: 90 });
  });

  it("determines point inclusion with optional boundary handling", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 }
    ];

    expect(service.isPointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
    expect(service.isPointInPolygon({ x: 5, y: 5 }, square)).toBe(false);
    expect(service.isPointInPolygon({ x: 4, y: 2 }, square)).toBe(false);
    expect(service.isPointInPolygon({ x: 4, y: 2 }, square, true)).toBe(true);
  });

  it("warns when deprecated polygon overlap helper is invoked", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = service.doPolygonsOverlap(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 }
      ],
      [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 2, y: 3 }
      ]
    );

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith("doPolygonsOverlap is deprecated. Use doRingsIntersect for ring validation.");
    warnSpy.mockRestore();
  });
});
