// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";

const createProperty = (startYear, endYear, name) =>
  new Property(
    new TimePoint(startYear),
    name,
    "",
    {},
    new TimePoint(startYear),
    endYear === null ? null : new TimePoint(endYear)
  );

const createAnchor = ({ id, start, end, name, shape, placement }) =>
  new FeatureAnchor({
    id,
    timeRange: {
      start: new TimePoint(start),
      end: end === null ? null : new TimePoint(end)
    },
    property: {
      name,
      description: "",
      attributes: {}
    },
    shape,
    placement
  });

describe("Feature entities with anchor-canonical shape/placement", () => {
  it("resolves point and line geometry by active anchor time", () => {
    const point = new Point(
      "point-1",
      ["vp-latest"],
      [createProperty(1000, 1200, "P-1000"), createProperty(1200, null, "P-1200")],
      "layer-fallback",
      [
        createAnchor({
          id: "point-a1",
          start: 1000,
          end: 1200,
          name: "P-1000",
          shape: { type: "Point", vertexId: "vp-1000" },
          placement: { layerId: "layer-a" }
        }),
        createAnchor({
          id: "point-a2",
          start: 1200,
          end: null,
          name: "P-1200",
          shape: { type: "Point", vertexId: "vp-1200" },
          placement: { layerId: "layer-b" }
        })
      ]
    );

    const line = new Line(
      "line-1",
      ["vl-latest-1", "vl-latest-2"],
      [createProperty(1000, 1200, "L-1000"), createProperty(1200, null, "L-1200")],
      "layer-fallback",
      [
        createAnchor({
          id: "line-a1",
          start: 1000,
          end: 1200,
          name: "L-1000",
          shape: { type: "LineString", vertexIds: ["vl-1000-1", "vl-1000-2"] },
          placement: { layerId: "layer-a" }
        }),
        createAnchor({
          id: "line-a2",
          start: 1200,
          end: null,
          name: "L-1200",
          shape: { type: "LineString", vertexIds: ["vl-1200-1", "vl-1200-2", "vl-1200-3"] },
          placement: { layerId: "layer-b" }
        })
      ]
    );

    expect(point.getVertexIdAt(new TimePoint(1100))).toBe("vp-1000");
    expect(point.getVertexIdAt(new TimePoint(1300))).toBe("vp-1200");
    expect(point.getLayerIdAt(new TimePoint(1100))).toBe("layer-a");
    expect(point.getLayerIdAt(new TimePoint(1300))).toBe("layer-b");

    expect(line.getVertexIdsAt(new TimePoint(1100))).toEqual(["vl-1000-1", "vl-1000-2"]);
    expect(line.getVertexIdsAt(new TimePoint(1300))).toEqual(["vl-1200-1", "vl-1200-2", "vl-1200-3"]);
    expect(line.getLayerIdAt(new TimePoint(1100))).toBe("layer-a");
    expect(line.getLayerIdAt(new TimePoint(1300))).toBe("layer-b");
  });

  it("resolves polygon rings and placement by active anchor time", () => {
    const polygon = new Polygon(
      "polygon-1",
      [createProperty(1000, 1200, "G-1000"), createProperty(1200, null, "G-1200")],
      "layer-fallback",
      "0",
      [],
      [
        {
          id: "ring-fallback",
          vertexIds: ["vf-1", "vf-2", "vf-3"],
          ringType: "territory",
          parentId: null
        }
      ],
      [
        createAnchor({
          id: "polygon-a1",
          start: 1000,
          end: 1200,
          name: "G-1000",
          shape: {
            type: "Polygon",
            rings: [
              {
                id: "ring-1000",
                vertexIds: ["v1000-1", "v1000-2", "v1000-3"],
                ringType: "territory",
                parentId: null
              }
            ]
          },
          placement: { layerId: "layer-a", parentId: "parent-a", childIds: ["child-a"] }
        }),
        createAnchor({
          id: "polygon-a2",
          start: 1200,
          end: null,
          name: "G-1200",
          shape: {
            type: "Polygon",
            rings: [
              {
                id: "ring-1200",
                vertexIds: ["v1200-1", "v1200-2", "v1200-3", "v1200-4"],
                ringType: "territory",
                parentId: null
              }
            ]
          },
          placement: { layerId: "layer-b", parentId: "parent-b", childIds: ["child-b-1", "child-b-2"] }
        })
      ]
    );

    expect(polygon.getRingsAt(new TimePoint(1100))[0].id).toBe("ring-1000");
    expect(polygon.getRingsAt(new TimePoint(1300))[0].id).toBe("ring-1200");
    expect(polygon.getRingsAt(new TimePoint(1300))[0].vertexIds).toEqual(["v1200-1", "v1200-2", "v1200-3", "v1200-4"]);

    expect(polygon.getLayerIdAt(new TimePoint(1100))).toBe("layer-a");
    expect(polygon.getLayerIdAt(new TimePoint(1300))).toBe("layer-b");

    const placementAt1100 = polygon.getPlacementAt(new TimePoint(1100));
    expect(placementAt1100.parentId).toBe("parent-a");
    expect(placementAt1100.childIds).toEqual(["child-a"]);

    const placementAt1300 = polygon.getPlacementAt(new TimePoint(1300));
    expect(placementAt1300.parentId).toBe("parent-b");
    expect(placementAt1300.childIds).toEqual(["child-b-1", "child-b-2"]);
  });
});

