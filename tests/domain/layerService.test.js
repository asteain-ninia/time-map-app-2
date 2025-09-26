// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { LayerService } from "../../src/domain/services/LayerService.js";

const makeLayer = (id, order) => ({ id, order });
const makePolygon = (id, layerId, parentId, vertexIds = []) => ({
  id,
  layerId,
  parentId,
  vertexIds,
  subPolygons: [],
  isMultiPolygon: false,
  holesVertexIds: []
});

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
    const rootPolygon = makePolygon("p-root", "base", "0");
    expect(service.validatePolygonHierarchy(rootPolygon, [rootPolygon], layers)).toBe(true);

    const child = makePolygon("p-child", "upper", "p-root");
    expect(service.validatePolygonHierarchy(child, [rootPolygon, child], layers)).toBe(true);

    const misplaced = makePolygon("p-mis", "upper", "0");
    expect(service.validatePolygonHierarchy(misplaced, [rootPolygon, misplaced], layers)).toBe(false);
  });

  it("calculates parent shape from multiple child polygons", () => {
    const parentId = "parent";
    const childA = { ...makePolygon("A", "layer-1", parentId, ["v1", "v2", "v3"]), holesVertexIds: [] };
    const childB = { ...makePolygon("B", "layer-1", parentId, ["v4", "v5", "v6"]), holesVertexIds: [] };
    const allPolygons = [childA, childB];

    const shape = service.calculateParentShape(parentId, allPolygons, []);
    expect(shape.isMultiPolygon).toBe(true);
    expect(Array.isArray(shape.subPolygons)).toBe(true);
    expect(shape.subPolygons).toEqual([
      { vertexIds: childA.vertexIds, holesVertexIds: childA.holesVertexIds },
      { vertexIds: childB.vertexIds, holesVertexIds: childB.holesVertexIds }
    ]);
  });

  it("detects containment within higher layer polygons", () => {
    const layers = [makeLayer("low", 0), makeLayer("high", 1)];
    const higherPolygon = makePolygon("hp", "low", "0", ["a", "b", "c"]);
    const polygon = makePolygon("cp", "high", "hp", ["x", "y"]);
    const vertices = [
      makeVertex("a", 0, 0),
      makeVertex("b", 5, 0),
      makeVertex("c", 0, 5),
      makeVertex("x", 1, 1),
      makeVertex("y", 2, 1)
    ];
    const geometryService = {
      isPointInPolygon: vi.fn().mockReturnValue(true)
    };

    const result = service.isContainedInHigherLayerPolygon(
      polygon,
      [higherPolygon, polygon],
      vertices,
      layers,
      geometryService
    );

    expect(result).toBe(true);
    expect(geometryService.isPointInPolygon).toHaveBeenCalled();
  });

  it("checks exclusivity against overlapping polygons", () => {
    const polygon = makePolygon("p1", "layer", "0", ["v1", "v2", "v3"]);
    const other = makePolygon("p2", "layer", "0", ["v4", "v5", "v6"]);
    const vertices = [
      makeVertex("v1", 0, 0),
      makeVertex("v2", 5, 0),
      makeVertex("v3", 0, 5),
      makeVertex("v4", 1, 1),
      makeVertex("v5", 6, 1),
      makeVertex("v6", 1, 6)
    ];
    const geometryService = {
      doPolygonsOverlap: vi.fn(() => true)
    };

    const exclusive = service.checkExclusivity(polygon, [polygon, other], vertices, geometryService);
    expect(exclusive).toBe(false);
    expect(geometryService.doPolygonsOverlap).toHaveBeenCalled();
  });
});
