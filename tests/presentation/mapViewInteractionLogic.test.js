// Created by Codex
import { describe, expect, it } from "vitest";
import { MapViewInteractionLogic } from "../../src/presentation/views/map/MapViewInteractionLogic.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const geometryService = {
  calculateDistanceSq(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  },
  distancePointSegmentSq(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
      const px = point.x - start.x;
      const py = point.y - start.y;
      return px * px + py * py;
    }
    const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    const projX = start.x + clamped * dx;
    const projY = start.y + clamped * dy;
    const px = point.x - projX;
    const py = point.y - projY;
    return px * px + py * py;
  },
  projectPointToEdge(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
      return { x: start.x, y: start.y };
    }
    const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    return {
      x: start.x + clamped * dx,
      y: start.y + clamped * dy
    };
  }
};

const createProperty = () => new Property(new TimePoint(0), "test", "");

const createViewModel = (world, features) => ({
  getWorld: () => world,
  getFeatures: () => features
});

describe("MapViewInteractionLogic", () => {
  it("finds closest vertex using the spatial index", () => {
    const world = {
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 10, y: 0 }
      ]
    };
    const features = [
      new Line("line-1", ["v1", "v2"], [createProperty()], "layer-1")
    ];
    const viewModel = createViewModel(world, features);
    const logic = new MapViewInteractionLogic(
      viewModel,
      {},
      geometryService,
      () => 4,
      () => 360
    );

    const closest = logic.findClosestVertex({ x: 0.5, y: 0.5 });

    expect(closest).not.toBeNull();
    expect(closest.id).toBe("v1");
    expect(closest.x).toBe(0);
    expect(closest.y).toBe(0);
  });

  it("finds closest edge and projection using the spatial index", () => {
    const world = {
      vertices: [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 10, y: 0 }
      ]
    };
    const features = [
      new Line("line-1", ["v1", "v2"], [createProperty()], "layer-1")
    ];
    const viewModel = createViewModel(world, features);
    const logic = new MapViewInteractionLogic(
      viewModel,
      {},
      geometryService,
      () => 4,
      () => 360
    );

    const edge = logic.findClosestEdge({ x: 5, y: 1 });

    expect(edge).not.toBeNull();
    expect(edge.featureId).toBe("line-1");
    expect(edge.segmentStartVertexId).toBe("v1");
    expect(edge.segmentEndVertexId).toBe("v2");
    expect(edge.projectionPoint.x).toBe(5);
    expect(edge.projectionPoint.y).toBe(0);
  });
});
