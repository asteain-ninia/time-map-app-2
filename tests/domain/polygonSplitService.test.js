// Tests authored by Codex.
import { describe, it, expect } from "vitest";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { buildPolygonSplitPlan } from "../../src/domain/services/PolygonSplitService.js";

const geometryService = new GeometryService();

const ringVertexIds = ["v1", "v2", "v3", "v4"];
const verticesMap = new Map([
  ["v1", { x: 0, y: 0 }],
  ["v2", { x: 10, y: 0 }],
  ["v3", { x: 10, y: 10 }],
  ["v4", { x: 0, y: 10 }]
]);

const cutLineForward = [
  { x: -5, y: 5 },
  { x: 2, y: 4 },
  { x: 6, y: 6 },
  { x: 15, y: 5 }
];
const cutLineBackward = [...cutLineForward].reverse();

const buildPlan = (cutLinePoints) =>
  buildPolygonSplitPlan({
    ringVertexIds,
    verticesMap,
    cutLinePoints,
    geometryService
  });

const toCoords = (points) => points.map(point => [Number(point.x.toFixed(6)), Number(point.y.toFixed(6))]);

const expectNonSelfIntersecting = (ringPoints) => {
  const coords = ringPoints.map(point => ({ x: point.x, y: point.y }));
  expect(geometryService.isPolygonSelfIntersecting(coords)).toBe(false);
};

describe("PolygonSplitService", () => {
  it("creates valid rings when the cut line direction opposes ring order", () => {
    const plan = buildPlan(cutLineForward);

    expectNonSelfIntersecting(plan.ringA);
    expectNonSelfIntersecting(plan.ringB);
  });

  it("normalizes cut line direction to match ring order", () => {
    const forwardPlan = buildPlan(cutLineForward);
    const backwardPlan = buildPlan(cutLineBackward);

    expect(toCoords(forwardPlan.cutLine)).toEqual(toCoords(backwardPlan.cutLine));
    expect(forwardPlan.cutLine[0].x).toBeGreaterThan(
      forwardPlan.cutLine[forwardPlan.cutLine.length - 1].x
    );

    expectNonSelfIntersecting(backwardPlan.ringA);
    expectNonSelfIntersecting(backwardPlan.ringB);
  });
});
