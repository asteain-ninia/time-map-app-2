
// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { JSONSerializer } from "../../src/infrastructure/persistence/JSONSerializer.js";
import { Layer } from "../../src/domain/entities/Layer.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

describe("JSONSerializer", () => {
  const serializer = new JSONSerializer();

  const createProperty = (name) => new Property(new TimePoint(1900, 1, 1), name, "desc", { tag: name });

  it("serializes and deserializes a world with layers, vertices, and mixed features", () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1.0)];
    const vertices = [
      new Vertex("v1", 0, 0),
      new Vertex("v2", 10, 0),
      new Vertex("v3", 0, 10),
      new Vertex("v4", 5, 5)
    ];
    const point = new Point("pt-1", ["v1"], [createProperty("P")], "layer-base");
    const line = new Line("ln-1", ["v1", "v2"], [createProperty("L")], "layer-base");
    const polygon = new Polygon(
      "poly-1",
      [createProperty("G")],
      "layer-base",
      "0",
      [],
      [
        { id: "ring-main", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null }
      ]
    );

    const world = {
      layers,
      vertices,
      features: [point, line, polygon],
      metadata: { settings: { gridInterval: 20, equatorLength: 40000 } }
    };

    const json = serializer.serialize(world);
    const restored = serializer.deserialize(json);

    expect(restored.layers).toHaveLength(1);
    expect(restored.layers[0].id).toBe("layer-base");

    expect(restored.vertices).toHaveLength(vertices.length);
    expect(restored.vertices[0].id).toBe("v1");

    expect(restored.features).toHaveLength(3);
    const [restoredPoint, restoredLine, restoredPolygon] = restored.features;
    expect(restoredPoint).toBeInstanceOf(Point);
    expect(restoredPoint.vertexIds).toEqual(point.vertexIds);
    expect(restoredPoint.properties[0].name).toBe("P");

    expect(restoredLine).toBeInstanceOf(Line);
    expect(restoredLine.vertexIds).toEqual(line.vertexIds);

    expect(restoredPolygon).toBeInstanceOf(Polygon);
    expect(restoredPolygon.rings).toHaveLength(1);
    expect(restoredPolygon.rings[0].vertexIds).toEqual(["v1", "v2", "v3"]);
  });

  it("deserializes vertices as mutable plain objects to allow editing", () => {
    const raw = JSON.stringify({
      version: "1.2-ringtype",
      layers: [],
      vertices: [{ id: "vx-1", x: 3, y: 4 }],
      points: [],
      lines: [],
      polygons: [],
      metadata: {}
    });

    const world = serializer.deserialize(raw);
    expect(world.vertices).toHaveLength(1);

    const restoredVertex = world.vertices[0];
    expect(restoredVertex).not.toBeInstanceOf(Vertex);

    expect(() => {
      restoredVertex.x = 99;
      restoredVertex.y = -5;
    }).not.toThrow();

    expect(restoredVertex.x).toBe(99);
    expect(restoredVertex.y).toBe(-5);
  });

  it("fills metadata defaults and migrates slider bounds into settings", () => {
    const raw = JSON.stringify({
      version: "1.2-ringtype",
      layers: [],
      vertices: [],
      points: [],
      lines: [],
      polygons: [],
      metadata: {
        sliderMin: -100,
        sliderMax: 200,
        settings: { gridInterval: 50 }
      }
    });

    const world = serializer.deserialize(raw);
    expect(world.metadata.settings.sliderMin).toBe(-100);
    expect(world.metadata.settings.sliderMax).toBe(200);
    expect(world.metadata.settings.zoomMin).toBe(1);
    expect(world.metadata.settings.zoomMax).toBe(50);
    expect(world.metadata.settings.equatorLength).toBe(40000);
    expect(world.metadata.settings.gridInterval).toBe(50);
  });

  it("ignores legacy layer style fields and never serializes layer style", () => {
    const raw = JSON.stringify({
      version: "1.2-ringtype",
      layers: [
        {
          id: "layer-legacy",
          name: "Legacy",
          order: 0,
          visible: true,
          opacity: 0.8,
          description: "legacy layer",
          style: {
            point: { fill: "#ff0000" }
          }
        }
      ],
      vertices: [],
      points: [],
      lines: [],
      polygons: [],
      metadata: {}
    });

    const world = serializer.deserialize(raw);
    const layer = world.layers[0];
    expect(layer.id).toBe("layer-legacy");
    expect("style" in layer).toBe(false);
    expect(typeof layer.withStyle).toBe("undefined");

    const serialized = JSON.parse(serializer.serialize(world));
    expect(serialized.layers[0].style).toBeUndefined();
  });
});
