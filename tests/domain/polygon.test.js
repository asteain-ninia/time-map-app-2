import { describe, expect, it } from "vitest";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = () => new Property(new TimePoint(0), "Test", "", {}, null, null);

describe("Polygon", () => {
  it("removes territory enclaves when their enclosing hole is deleted", () => {
    const rings = [
      { id: "outer", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null },
      { id: "holeA", vertexIds: ["v4", "v5", "v6"], ringType: "hole", parentId: "outer" },
      { id: "enclave", vertexIds: ["v7", "v8", "v9"], ringType: "territory", parentId: "holeA" }
    ];
    const polygon = globalThis.createAnchoredPolygon("poly-1", [createProperty()], "layer-1", "0", [], rings);

    const updated = polygon.withRemovedRing("holeA");

    expect(updated.rings.map(r => r.id)).toEqual(["outer"]);
  });

  it("reparents grandchild holes to the parent territory when removing a hole", () => {
    const rings = [
      { id: "outer", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null },
      { id: "holeA", vertexIds: ["v4", "v5", "v6"], ringType: "hole", parentId: "outer" },
      { id: "enclave", vertexIds: ["v7", "v8", "v9"], ringType: "territory", parentId: "holeA" },
      { id: "holeB", vertexIds: ["v10", "v11", "v12"], ringType: "hole", parentId: "enclave" },
      { id: "inner", vertexIds: ["v13", "v14", "v15"], ringType: "territory", parentId: "holeB" }
    ];
    const polygon = globalThis.createAnchoredPolygon("poly-2", [createProperty()], "layer-1", "0", [], rings);

    const updated = polygon.withRemovedRing("holeA");

    expect(updated.rings.map(r => r.id).sort()).toEqual(["holeB", "inner", "outer"].sort());

    const reassignedHole = updated.rings.find(r => r.id === "holeB");
    expect(reassignedHole).toBeTruthy();
    expect(reassignedHole.parentId).toBe("outer");

    const innerTerritory = updated.rings.find(r => r.id === "inner");
    expect(innerTerritory).toBeTruthy();
    expect(innerTerritory.parentId).toBe("holeB");
    expect(innerTerritory.ringType).toBe("territory");
  });

  it("promotes territory descendants when deleting a parent territory ring", () => {
    const rings = [
      { id: "outer", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null },
      { id: "holeA", vertexIds: ["v4", "v5", "v6"], ringType: "hole", parentId: "outer" },
      { id: "enclave", vertexIds: ["v7", "v8", "v9"], ringType: "territory", parentId: "holeA" },
      { id: "holeB", vertexIds: ["v10", "v11", "v12"], ringType: "hole", parentId: "enclave" },
      { id: "inner", vertexIds: ["v13", "v14", "v15"], ringType: "territory", parentId: "holeB" }
    ];
    const polygon = globalThis.createAnchoredPolygon("poly-3", [createProperty()], "layer-1", "0", [], rings);

    const updated = polygon.withRemovedRing("outer");

    expect(updated.rings.find(r => r.id === "outer")).toBeUndefined();
    expect(updated.rings.find(r => r.id === "holeA")).toBeUndefined();
    expect(updated.rings.map(r => r.id).sort()).toEqual(["enclave", "holeB", "inner"].sort());

    const promotedTerritory = updated.rings.find(r => r.id === "enclave");
    expect(promotedTerritory).toBeTruthy();
    expect(promotedTerritory.parentId).toBeNull();

    const remainingHole = updated.rings.find(r => r.id === "holeB");
    expect(remainingHole).toBeTruthy();
    expect(remainingHole.parentId).toBe("enclave");

    const innerTerritory = updated.rings.find(r => r.id === "inner");
    expect(innerTerritory).toBeTruthy();
    expect(innerTerritory.parentId).toBe("holeB");
  });

});
