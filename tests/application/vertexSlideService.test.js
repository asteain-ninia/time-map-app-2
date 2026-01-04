// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { applyVertexSliding } from "../../src/application/services/VertexSlideService.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

describe("VertexSlideService", () => {
  it("slides a dragged vertex along a blocking polygon edge", () => {
    const geometryService = new GeometryService();
    const property = new Property(new TimePoint(0), "Name", "", {});

    const vertices = [
      { id: "a1", x: 12, y: 5 },
      { id: "a2", x: 14, y: 6 },
      { id: "a3", x: 14, y: 4 },
      { id: "b1", x: 0, y: 0 },
      { id: "b2", x: 10, y: 0 },
      { id: "b3", x: 10, y: 10 },
      { id: "b4", x: 0, y: 10 }
    ];

    const polygonA = new Polygon("poly-a", [property], "layer-1", "0", [], [
      { id: "ring-a", ringType: "territory", parentId: null, vertexIds: ["a1", "a2", "a3"] }
    ]);
    const polygonB = new Polygon("poly-b", [property], "layer-1", "0", [], [
      { id: "ring-b", ringType: "territory", parentId: null, vertexIds: ["b1", "b2", "b3", "b4"] }
    ]);

    const world = {
      features: [polygonA, polygonB],
      vertices,
      layers: []
    };

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
});
