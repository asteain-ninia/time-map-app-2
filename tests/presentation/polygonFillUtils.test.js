import { describe, expect, it } from "vitest";
import { buildPolygonFillLoopSets } from "../../src/presentation/views/map/polygonFillUtils.js";

const createVerticesMap = () => new Map([
  ["v1", { id: "v1", x: 0, y: 0 }],
  ["v2", { id: "v2", x: 5, y: 0 }],
  ["v3", { id: "v3", x: 2.5, y: 4 }],
  ["v4", { id: "v4", x: 1, y: 1 }],
  ["v5", { id: "v5", x: 2.5, y: 2 }],
  ["v6", { id: "v6", x: 1.5, y: 3 }],
  ["v7", { id: "v7", x: 3, y: 1.5 }],
  ["v8", { id: "v8", x: 3.5, y: 2.5 }],
  ["v9", { id: "v9", x: 2.8, y: 2.8 }],
]);

describe("buildPolygonFillLoopSets", () => {
  it("returns loop sets that include holes for each territory", () => {
    const polygon = {
      rings: [
        { id: "outer", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null },
        { id: "hole", vertexIds: ["v4", "v5", "v6"], ringType: "hole", parentId: "outer" },
        { id: "enclave", vertexIds: ["v7", "v8", "v9"], ringType: "territory", parentId: "hole" },
      ],
    };
    const verticesMap = createVerticesMap();

    const loopSets = buildPolygonFillLoopSets(polygon, verticesMap, 10);

    expect(loopSets).toHaveLength(2);
    expect(loopSets[0]).toHaveLength(2); // outer + hole
    expect(loopSets[1]).toHaveLength(1); // enclave only
    expect(loopSets[0][0][0]).toEqual({ x: 10, y: 0 });
    expect(loopSets[0][1][1]).toEqual({ x: verticesMap.get("v5").x + 10, y: 2 });
    expect(loopSets[1][0][0]).toEqual({ x: verticesMap.get("v7").x + 10, y: 1.5 });
  });

  it("skips rings without enough vertices", () => {
    const polygon = {
      rings: [
        { id: "outer", vertexIds: ["v1", "v2"], ringType: "territory", parentId: null },
        { id: "hole", vertexIds: ["v4", "v5"], ringType: "hole", parentId: "outer" },
      ],
    };
    const verticesMap = createVerticesMap();

    const loopSets = buildPolygonFillLoopSets(polygon, verticesMap, 0);

    expect(loopSets).toEqual([]);
  });
});
