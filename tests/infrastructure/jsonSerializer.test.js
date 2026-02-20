// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { JSONSerializer } from "../../src/infrastructure/persistence/JSONSerializer.js";
import { Layer } from "../../src/domain/entities/Layer.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";

describe("JSONSerializer", () => {
  const serializer = new JSONSerializer();

  const createProperty = (name, startYear = 1900, endYear = null) =>
    new FeatureAnchor({
      id: `anchor-${name}-${startYear}-${endYear ?? "null"}`,
      timeRange: {
        start: new TimePoint(startYear, 1, 1),
        end: endYear === null ? null : new TimePoint(endYear, 1, 1)
      },
      property: {
        name,
        description: "desc",
        attributes: { tag: name }
      },
      shape: {},
      placement: {}
    });

  it("serializes and deserializes a world with anchors, layers, vertices, and mixed features", () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1.0)];
    const vertices = [
      new Vertex("v1", 0, 0),
      new Vertex("v2", 10, 0),
      new Vertex("v3", 0, 10),
      new Vertex("v4", 5, 5)
    ];
    const point = globalThis.createAnchoredPoint("pt-1", ["v1"], [createProperty("P")], "layer-base");
    const line = globalThis.createAnchoredLine("ln-1", ["v1", "v2"], [createProperty("L")], "layer-base");
    const polygon = globalThis.createAnchoredPolygon(
      "poly-1",
      [createProperty("G", 1900, 1950), createProperty("G2", 1950, null)],
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
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("3.0-feature-anchor");
    expect(Array.isArray(parsed.features)).toBe(true);
    expect(parsed.features).toHaveLength(3);

    const restored = serializer.deserialize(json);

    expect(restored.layers).toHaveLength(1);
    expect(restored.layers[0].id).toBe("layer-base");

    expect(restored.vertices).toHaveLength(vertices.length);
    expect(restored.vertices[0].id).toBe("v1");

    expect(restored.features).toHaveLength(3);
    const [restoredPoint, restoredLine, restoredPolygon] = restored.features;
    expect(restoredPoint).toBeInstanceOf(Point);
    expect(restoredPoint.vertexIds).toEqual(point.vertexIds);
    expect(restoredPoint.anchors).toHaveLength(1);
    expect(restoredPoint.anchors[0].shape.type).toBe("Point");

    expect(restoredLine).toBeInstanceOf(Line);
    expect(restoredLine.vertexIds).toEqual(line.vertexIds);
    expect(restoredLine.anchors).toHaveLength(1);
    expect(restoredLine.anchors[0].shape.type).toBe("LineString");

    expect(restoredPolygon).toBeInstanceOf(Polygon);
    expect(restoredPolygon.rings).toHaveLength(1);
    expect(restoredPolygon.anchors).toHaveLength(2);
    expect(restoredPolygon.anchors[0].shape.type).toBe("Polygon");
    expect(restoredPolygon.anchors[0].shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3"]);
  });

  it("deserializes vertices as mutable plain objects to allow editing", () => {
    const raw = JSON.stringify({
      version: "3.0-feature-anchor",
      layers: [],
      vertices: [{ id: "vx-1", x: 3, y: 4 }],
      features: [],
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
      version: "3.0-feature-anchor",
      layers: [],
      vertices: [],
      features: [],
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

  it("rejects unsupported legacy versions", () => {
    const raw = JSON.stringify({
      version: "1.2-ringtype",
      layers: [],
      vertices: [],
      points: [],
      lines: [],
      polygons: [],
      metadata: {}
    });

    expect(() => serializer.deserialize(raw)).toThrow(/Unsupported world format version/);
  });

  it("ignores legacy layer style fields and never serializes layer style", () => {
    const raw = JSON.stringify({
      version: "3.0-feature-anchor",
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
      features: [],
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

  it("preserves anchor-specific shape and placement across save/load", () => {
    const layers = [
      new Layer("layer-a", "Layer A", 0, true, 1.0),
      new Layer("layer-b", "Layer B", 1, true, 1.0)
    ];
    const vertices = [
      new Vertex("vp-1", 0, 0),
      new Vertex("vp-2", 1, 1),
      new Vertex("vl-1", 0, 1),
      new Vertex("vl-2", 2, 1),
      new Vertex("vl-3", 4, 1),
      new Vertex("pg-1", 0, 0),
      new Vertex("pg-2", 3, 0),
      new Vertex("pg-3", 0, 3),
      new Vertex("pg-4", 3, 3)
    ];

    const pointAnchors = [
      new FeatureAnchor({
        id: "point-anchor-1000",
        timeRange: { start: new TimePoint(1000), end: new TimePoint(1200) },
        property: { name: "Point-1000", description: "", attributes: {} },
        shape: { type: "Point", vertexId: "vp-1" },
        placement: { layerId: "layer-a" }
      }),
      new FeatureAnchor({
        id: "point-anchor-1200",
        timeRange: { start: new TimePoint(1200), end: null },
        property: { name: "Point-1200", description: "", attributes: {} },
        shape: { type: "Point", vertexId: "vp-2" },
        placement: { layerId: "layer-b" }
      })
    ];
    const lineAnchors = [
      new FeatureAnchor({
        id: "line-anchor-1000",
        timeRange: { start: new TimePoint(1000), end: new TimePoint(1200) },
        property: { name: "Line-1000", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["vl-1", "vl-2"] },
        placement: { layerId: "layer-a" }
      }),
      new FeatureAnchor({
        id: "line-anchor-1200",
        timeRange: { start: new TimePoint(1200), end: null },
        property: { name: "Line-1200", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["vl-1", "vl-2", "vl-3"] },
        placement: { layerId: "layer-b" }
      })
    ];
    const polygonAnchors = [
      new FeatureAnchor({
        id: "polygon-anchor-1000",
        timeRange: { start: new TimePoint(1000), end: new TimePoint(1200) },
        property: { name: "Polygon-1000", description: "", attributes: {} },
        shape: {
          type: "Polygon",
          rings: [
            { id: "ring-1000", vertexIds: ["pg-1", "pg-2", "pg-3"], ringType: "territory", parentId: null }
          ]
        },
        placement: { layerId: "layer-a", parentId: "0", childIds: [] }
      }),
      new FeatureAnchor({
        id: "polygon-anchor-1200",
        timeRange: { start: new TimePoint(1200), end: null },
        property: { name: "Polygon-1200", description: "", attributes: {} },
        shape: {
          type: "Polygon",
          rings: [
            { id: "ring-1200", vertexIds: ["pg-1", "pg-2", "pg-4", "pg-3"], ringType: "territory", parentId: null }
          ]
        },
        placement: { layerId: "layer-b", parentId: "parent-1", childIds: ["child-1"] }
      })
    ];

    const point = globalThis.createAnchoredPoint(
      "point-time",
      ["vp-2"],
      [createProperty("Point-1000", 1000, 1200), createProperty("Point-1200", 1200, null)],
      "layer-b",
      pointAnchors
    );
    const line = globalThis.createAnchoredLine(
      "line-time",
      ["vl-1", "vl-2", "vl-3"],
      [createProperty("Line-1000", 1000, 1200), createProperty("Line-1200", 1200, null)],
      "layer-b",
      lineAnchors
    );
    const polygon = globalThis.createAnchoredPolygon(
      "polygon-time",
      [createProperty("Polygon-1000", 1000, 1200), createProperty("Polygon-1200", 1200, null)],
      "layer-b",
      "parent-1",
      ["child-1"],
      [
        { id: "ring-1200", vertexIds: ["pg-1", "pg-2", "pg-4", "pg-3"], ringType: "territory", parentId: null }
      ],
      polygonAnchors
    );

    const world = { layers, vertices, features: [point, line, polygon], metadata: {} };
    const json = serializer.serialize(world);
    const restored = serializer.deserialize(json);

    const restoredPoint = restored.features.find((feature) => feature.id === "point-time");
    const restoredLine = restored.features.find((feature) => feature.id === "line-time");
    const restoredPolygon = restored.features.find((feature) => feature.id === "polygon-time");

    expect(restoredPoint.getVertexIdAt(new TimePoint(1100))).toBe("vp-1");
    expect(restoredPoint.getVertexIdAt(new TimePoint(1300))).toBe("vp-2");
    expect(restoredPoint.getLayerIdAt(new TimePoint(1100))).toBe("layer-a");
    expect(restoredPoint.getLayerIdAt(new TimePoint(1300))).toBe("layer-b");

    expect(restoredLine.getVertexIdsAt(new TimePoint(1100))).toEqual(["vl-1", "vl-2"]);
    expect(restoredLine.getVertexIdsAt(new TimePoint(1300))).toEqual(["vl-1", "vl-2", "vl-3"]);
    expect(restoredLine.getLayerIdAt(new TimePoint(1100))).toBe("layer-a");
    expect(restoredLine.getLayerIdAt(new TimePoint(1300))).toBe("layer-b");

    expect(restoredPolygon.getRingsAt(new TimePoint(1100))[0].id).toBe("ring-1000");
    expect(restoredPolygon.getRingsAt(new TimePoint(1300))[0].id).toBe("ring-1200");
    expect(restoredPolygon.getLayerIdAt(new TimePoint(1100))).toBe("layer-a");
    expect(restoredPolygon.getLayerIdAt(new TimePoint(1300))).toBe("layer-b");
    expect(restoredPolygon.getPlacementAt(new TimePoint(1300))).toEqual({
      layerId: "layer-b",
      parentId: "parent-1",
      childIds: ["child-1"]
    });
  });
});
