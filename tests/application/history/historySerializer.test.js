// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { HistorySerializer } from "../../../src/application/services/history/HistorySerializer.js";
import { Vertex } from "../../../src/domain/entities/Vertex.js";
import { Point } from "../../../src/domain/entities/Point.js";
import { Line } from "../../../src/domain/entities/Line.js";
import { Polygon } from "../../../src/domain/entities/Polygon.js";
import { FeatureAnchor } from "../../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../../src/domain/value-objects/TimePoint.js";

describe("HistorySerializer", () => {
  const serializer = new HistorySerializer();

  const createProperty = () =>
    new FeatureAnchor({
      id: "anchor-history",
      timeRange: { start: new TimePoint(1900), end: null },
      property: { name: "N", description: "D", attributes: { info: 1 } },
      shape: {},
      placement: {}
    });

  it("serializes and deserializes vertices and basic features", () => {
    const vertex = new Vertex("v1", 1, 2);
    const property = createProperty();
    const point = globalThis.createAnchoredPoint("pt1", ["v1"], [property], "layer");
    const line = globalThis.createAnchoredLine("ln1", ["v1", "v2"], [property], "layer");

    const serializedVertex = serializer.serialize(vertex);
    expect(serializedVertex).toEqual({ _constructorName: "Vertex", id: "v1", x: 1, y: 2 });
    expect(serializer.deserialize(serializedVertex)).toEqual(new Vertex("v1", 1, 2));

    const serializedPoint = serializer.serialize(point);
    expect(serializedPoint._constructorName).toBe("Point");
    const restoredPoint = serializer.deserialize(serializedPoint);
    expect(restoredPoint.id).toBe("pt1");
    expect(restoredPoint.vertexIds).toEqual(point.vertexIds);
    expect(restoredPoint.anchors[0]).toBeInstanceOf(FeatureAnchor);
    expect(restoredPoint.anchors[0].name).toBe(property.name);
    expect(restoredPoint.anchors[0].startTime.equals(property.startTime)).toBe(true);
    expect(restoredPoint.anchors[0].getAttributes().info).toBe(1);

    const serializedLine = serializer.serialize(line);
    const restoredLine = serializer.deserialize(serializedLine);
    expect(restoredLine.vertexIds).toEqual(line.vertexIds);
  });

  it("serializes polygons with ring data", () => {
    const property = createProperty();
    const rings = [
      { id: "ring-main", vertexIds: ["a", "b", "c"], ringType: "territory", parentId: null },
      { id: "ring-hole", vertexIds: ["d", "e", "f"], ringType: "hole", parentId: "ring-main" }
    ];
    const polygon = globalThis.createAnchoredPolygon("poly", [property], "layer", "0", ["child"], rings);

    const serializedPolygon = serializer.serialize(polygon);
    expect(serializedPolygon._constructorName).toBe("Polygon");
    expect(serializedPolygon.rings).toHaveLength(2);

    const restoredPolygon = serializer.deserialize(serializedPolygon);
    expect(restoredPolygon.id).toBe("poly");
    expect(restoredPolygon.rings).toHaveLength(2);
    expect(restoredPolygon.childIds).toContain("child");
  });

  it("handles legacy ring-only records during deserialization", () => {
    const legacyRing = {
      id: "legacy-ring",
      vertexIds: ["v1", "v2", "v3"],
      ringType: "territory",
      parentId: null
    };

    const restored = serializer.deserialize(legacyRing);
    expect(restored).toEqual({
      id: "legacy-ring",
      vertexIds: legacyRing.vertexIds,
      ringType: "territory",
      parentId: null
    });
  });

  it("ignores invalid payloads", () => {
    const unsupported = serializer.serialize({ foo: "bar" });
    expect(unsupported).toBeNull();

    expect(serializer.deserialize({})).toBeNull();

    const badProperty = serializer.deserialize({ _constructorName: "Property", timePoint: null });
    expect(badProperty).toBeNull();
  });
});
