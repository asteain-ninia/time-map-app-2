// Created by Codex
import { describe, expect, it } from "vitest";
import { SpatialIndex } from "../../src/presentation/views/map/SpatialIndex.js";

describe("SpatialIndex", () => {
  it("returns nearby vertices based on cell range", () => {
    const index = new SpatialIndex(1);
    const near = { id: "v1", x: 0, y: 0 };
    const far = { id: "v2", x: 10, y: 10 };
    index.addVertex(near);
    index.addVertex(far);

    const results = index.queryVertices({ x: 0.2, y: -0.2 }, 0.9);

    expect(results).toContain(near);
    expect(results).not.toContain(far);
  });

  it("dedupes edges that span multiple cells", () => {
    const index = new SpatialIndex(5);
    const entry = { id: "edge-1" };
    index.addEdge(entry, { minX: 0, maxX: 12, minY: 0, maxY: 0 });

    const results = index.queryEdges({ x: 6, y: 0 }, 1);

    expect(results).toHaveLength(1);
    expect(results[0]).toBe(entry);
  });
});
