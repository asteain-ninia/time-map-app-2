import { describe, expect, it } from "vitest";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = () => new Property(new TimePoint(0), "Test", "", {}, null, null);

describe("Polygon", () => {
  it("keeps enclave rings when removing their parent hole", () => {
    const rings = [
      { id: "outer", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null },
      { id: "hole", vertexIds: ["v4", "v5", "v6"], ringType: "hole", parentId: "outer" },
      { id: "enclave", vertexIds: ["v7", "v8", "v9"], ringType: "territory", parentId: "hole" }
    ];
    const polygon = new Polygon("poly-1", [createProperty()], "layer-1", "0", [], rings);

    const updated = polygon.withRemovedRing("hole");

    expect(updated.rings.map(r => r.id)).toEqual(["outer", "enclave"]);
    const enclave = updated.rings.find(r => r.id === "enclave");
    expect(enclave).toBeTruthy();
    expect(enclave.parentId).toBe("outer");
    expect(enclave.ringType).toBe("territory");
  });

  it("removes direct hole children while preserving enclaves when deleting a parent territory ring", () => {
    const rings = [
      { id: "outer", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null },
      { id: "hole", vertexIds: ["v4", "v5", "v6"], ringType: "hole", parentId: "outer" },
      { id: "enclave", vertexIds: ["v7", "v8", "v9"], ringType: "territory", parentId: "hole" },
      { id: "inner-hole", vertexIds: ["v10", "v11", "v12"], ringType: "hole", parentId: "enclave" }
    ];
    const polygon = new Polygon("poly-2", [createProperty()], "layer-1", "0", [], rings);

    const updated = polygon.withRemovedRing("outer");

    expect(updated.rings.find(r => r.id === "outer")).toBeUndefined();
    expect(updated.rings.find(r => r.id === "hole")).toBeUndefined();
    expect(updated.rings).toHaveLength(2);

    const enclave = updated.rings.find(r => r.id === "enclave");
    expect(enclave).toBeTruthy();
    expect(enclave.parentId).toBeNull();
    expect(enclave.ringType).toBe("territory");

    const innerHole = updated.rings.find(r => r.id === "inner-hole");
    expect(innerHole).toBeTruthy();
    expect(innerHole.parentId).toBe("enclave");
    expect(innerHole.ringType).toBe("hole");
  });

});
