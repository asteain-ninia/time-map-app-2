// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { determinePolygonLabelAnchors } from "../../src/infrastructure/rendering/PolygonLabeling.js";

describe("determinePolygonLabelAnchors", () => {
  it("returns a centroid anchor for a simple territory ring", () => {
    const ring = { id: "ring-1", ringType: "territory", parentId: null };
    const polygon = { rings: [ring] };
    const childrenByRingId = new Map([["ring-1", []]]);
    const ringVertices = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const ringVerticesCache = new Map([["ring-1", ringVertices]]);
    const viewport = { width: 1000, height: 1000, zoom: 1 };

    const anchors = determinePolygonLabelAnchors(
      polygon,
      childrenByRingId,
      viewport,
      ringVerticesCache,
      0
    );

    expect(anchors).toHaveLength(1);
    expect(anchors[0].ringId).toBe("ring-1");
    expect(anchors[0].anchor.x).toBeCloseTo(50, 6);
    expect(anchors[0].anchor.y).toBeCloseTo(50, 6);
  });
});
