// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { LayerService } from "../../src/domain/services/LayerService.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";

const makeLayer = (id, order) => ({ id, order });

const makeProperty = (name = "Test") => new Property(new TimePoint(0), name, "", {});

const makeRing = (id, vertexIds, ringType = "territory", parentId = null) => ({
  id,
  vertexIds,
  ringType,
  parentId
});

const makePolygon = ({ id, layerId, parentId = "0", childIds = [], rings }) =>
  new Polygon(id, [makeProperty(id)], layerId, parentId, childIds, rings);

const makeVertex = (id, x, y) => ({ id, x, y });

describe("LayerService", () => {
  const service = new LayerService();

  it("validates strict sequential layer orders", () => {
    const layers = [makeLayer("base", 0), makeLayer("mid", 1), makeLayer("top", 2)];
    expect(service.validateLayerHierarchy(layers)).toBe(true);

    const duplicated = [makeLayer("base", 0), makeLayer("dup", 0)];
    expect(service.validateLayerHierarchy(duplicated)).toBe(false);

    const gap = [makeLayer("base", 0), makeLayer("skip", 2)];
    expect(service.validateLayerHierarchy(gap)).toBe(false);
  });

  it("checks polygon hierarchy based on parent layers", () => {
    const layers = [makeLayer("base", 0), makeLayer("upper", 1)];
    const rootPolygon = makePolygon({
      id: "p-root",
      layerId: "base",
      rings: [makeRing("r-root", ["v1", "v2", "v3"])]
    });
    expect(service.validatePolygonHierarchy(rootPolygon, [rootPolygon], layers)).toBe(true);

    const child = makePolygon({
      id: "p-child",
      layerId: "upper",
      parentId: "p-root",
      rings: [makeRing("r-child", ["v4", "v5", "v6"])]
    });
    expect(service.validatePolygonHierarchy(child, [rootPolygon, child], layers)).toBe(true);

    const misplaced = makePolygon({
      id: "p-mis",
      layerId: "upper",
      rings: [makeRing("r-mis", ["v7", "v8", "v9"])]
    });
    expect(service.validatePolygonHierarchy(misplaced, [rootPolygon, misplaced], layers)).toBe(false);
  });

  it("calculates parent shape from multiple child polygons", () => {
    const parentId = "parent";
    const childA = makePolygon({
      id: "A",
      layerId: "layer-1",
      parentId,
      rings: [makeRing("ring-A-outer", ["va1", "va2", "va3"])]
    });
    const childB = makePolygon({
      id: "B",
      layerId: "layer-1",
      parentId,
      rings: [makeRing("ring-B-outer", ["vb1", "vb2", "vb3"])]
    });
    const allPolygons = [childA, childB];

    const shape = service.calculateParentShape(parentId, allPolygons, []);
    expect(shape.isMultiPolygon).toBe(true);
    expect(shape.childPolygonIds).toEqual(["A", "B"]);
    expect(shape.rings).toEqual([
      { id: "ring-A-outer", vertexIds: ["va1", "va2", "va3"], ringType: "territory", parentId: null },
      { id: "ring-B-outer", vertexIds: ["vb1", "vb2", "vb3"], ringType: "territory", parentId: null }
    ]);
  });

  it("detects containment within higher layer polygons", () => {
    const layers = [makeLayer("low", 0), makeLayer("high", 1)];
    const higherPolygon = makePolygon({
      id: "hp",
      layerId: "low",
      rings: [makeRing("ring-hp", ["a", "b", "c", "d"])]
    });
    const polygon = makePolygon({
      id: "cp",
      layerId: "high",
      parentId: "hp",
      rings: [makeRing("ring-cp", ["x", "y", "z"])]
    });
    const vertices = [
      makeVertex("a", 0, 0),
      makeVertex("b", 6, 0),
      makeVertex("c", 6, 6),
      makeVertex("d", 0, 6),
      makeVertex("x", 1, 1),
      makeVertex("y", 2, 1),
      makeVertex("z", 1, 2)
    ];
    const geometryService = new GeometryService();

    const result = service.isContainedInHigherLayerPolygon(
      polygon,
      [higherPolygon, polygon],
      vertices,
      layers,
      geometryService
    );

    expect(result).toBe(true);
  });

  it("checks exclusivity against overlapping polygons", () => {
    const polygon = makePolygon({
      id: "p1",
      layerId: "layer",
      rings: [makeRing("ring-p1", ["v1", "v2", "v3", "v4"])]
    });
    const other = makePolygon({
      id: "p2",
      layerId: "layer",
      rings: [makeRing("ring-p2", ["v5", "v6", "v7", "v8"])]
    });
    const vertices = [
      makeVertex("v1", 0, 0),
      makeVertex("v2", 4, 0),
      makeVertex("v3", 4, 4),
      makeVertex("v4", 0, 4),
      makeVertex("v5", 2, 2),
      makeVertex("v6", 6, 2),
      makeVertex("v7", 6, 6),
      makeVertex("v8", 2, 6)
    ];
    const geometryService = new GeometryService();

    const exclusive = service.checkExclusivity(polygon, [polygon, other], vertices, geometryService);
    expect(exclusive).toBe(false);
  });
});
