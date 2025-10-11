import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddFeatureUseCase } from "../../src/application/usecases/feature/AddFeatureUseCase.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

describe("AddFeatureUseCase", () => {
  let world;
  let worldRepository;
  let geometryService;
  let layerService;
  let generateId;
  let processGeometry;
  let getVerticesFromIds;

  const outerVertexIds = ["outer-1", "outer-2", "outer-3"];
  const holeVertexIds = ["hole-1", "hole-2", "hole-3"];

  beforeEach(() => {
    world = {
      features: [],
      vertices: [],
      layers: [{ id: "layer-0", order: 0 }]
    };

    worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async (updated) => {
        world = updated;
      })
    };

    geometryService = {
      isPolygonSelfIntersecting: vi.fn(() => false)
    };

    layerService = {
      validatePolygonHierarchy: vi.fn(() => true),
      isContainedInHigherLayerPolygon: vi.fn(() => true),
      checkExclusivity: vi.fn(() => true)
    };

    const idCounters = {};
    generateId = vi.fn((type) => {
      idCounters[type] = (idCounters[type] || 0) + 1;
      return `${type}-${idCounters[type]}`;
    });

    processGeometry = vi.fn((geometry, targetWorld) => {
      const addVertexIfMissing = (id, index) => {
        if (!targetWorld.vertices.some(vertex => vertex.id === id)) {
          targetWorld.vertices.push({ id, x: index, y: index });
        }
      };

      outerVertexIds.forEach((id, index) => addVertexIfMissing(id, index));
      holeVertexIds.forEach((id, index) => addVertexIfMissing(id, index + 10));

      return {
        vertexIds: [...outerVertexIds],
        holesVertexIds: [[...holeVertexIds]],
        parentId: "0"
      };
    });

    getVerticesFromIds = (ids) => {
      return ids
        .map((id) => {
          const v = world.vertices.find(vertex => vertex.id === id);
          return v ? { id: v.id, x: v.x, y: v.y } : null;
        })
        .filter(Boolean);
    };
  });

  it("creates hole rings when geometry includes holesVertexIds", async () => {
    const useCase = new AddFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      generateId,
      processGeometry,
      getVerticesFromIds
    );

    const property = new Property(new TimePoint(0), "Polygon", "", {});
    const result = await useCase.execute("polygon", [property], { vertices: [] }, "layer-0");

    expect(result).toBeInstanceOf(Object);
    expect(world.features).toHaveLength(1);

    const polygon = world.features[0];
    expect(polygon.rings).toHaveLength(2);

    const [territoryRing, holeRing] = polygon.rings;
    expect(territoryRing.ringType).toBe("territory");
    expect(holeRing.ringType).toBe("hole");
    expect(holeRing.parentId).toBe(territoryRing.id);
    expect(holeRing.vertexIds).toEqual(holeVertexIds);

    expect(geometryService.isPolygonSelfIntersecting).toHaveBeenCalledTimes(2);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });
});
