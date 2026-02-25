import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddFeatureUseCase } from "../../src/application/usecases/feature/AddFeatureUseCase.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { LayerService } from "../../src/domain/services/LayerService.js";

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

    geometryService = new GeometryService();
    vi.spyOn(geometryService, "isPolygonSelfIntersecting").mockImplementation(() => false);

    layerService = new LayerService();
    vi.spyOn(layerService, "validatePolygonHierarchy").mockImplementation(() => true);
    vi.spyOn(layerService, "isContainedInHigherLayerPolygon").mockImplementation(() => true);

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

    const anchor = new FeatureAnchor({
      id: "anchor-draft",
      timeRange: { start: new TimePoint(0), end: null },
      property: { name: "Polygon", description: "", attributes: {} },
      shape: {},
      placement: {}
    });
    const result = await useCase.execute("polygon", [anchor], { vertices: [] }, "layer-0");

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

  it("throws FEATURE_ANCHOR_CONFLICTS and rolls back vertices when polygon add has unresolved overlap", async () => {
    const existingAnchor = new FeatureAnchor({
      id: "anchor-existing-900",
      timeRange: { start: new TimePoint(900), end: null },
      property: { name: "Existing", description: "", attributes: {} },
      shape: {
        type: "Polygon",
        rings: [
          {
            id: "ring-existing",
            vertexIds: ["ex-1", "ex-2", "ex-3"],
            ringType: "territory",
            parentId: null
          }
        ]
      },
      placement: { layerId: "layer-0", parentId: "0", childIds: [] }
    });
    world.vertices = [
      { id: "ex-1", x: 0, y: 0 },
      { id: "ex-2", x: 10, y: 0 },
      { id: "ex-3", x: 0, y: 10 }
    ];
    world.features = [
      globalThis.createAnchoredPolygon(
        "polygon-existing",
        [existingAnchor],
        "layer-0",
        "0",
        [],
        [
          {
            id: "ring-existing",
            vertexIds: ["ex-1", "ex-2", "ex-3"],
            ringType: "territory",
            parentId: null
          }
        ]
      )
    ];

    const processGeometryWithNewVertices = vi.fn((_, targetWorld) => {
      const additions = [
        { id: "new-1", x: 1, y: 1 },
        { id: "new-2", x: 9, y: 1 },
        { id: "new-3", x: 1, y: 9 }
      ];
      additions.forEach(vertex => {
        if (!targetWorld.vertices.some(entry => entry.id === vertex.id)) {
          targetWorld.vertices.push(vertex);
        }
      });
      return {
        vertexIds: additions.map(vertex => vertex.id),
        holesVertexIds: [],
        parentId: "0"
      };
    });
    const useCase = new AddFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      generateId,
      processGeometryWithNewVertices,
      getVerticesFromIds
    );
    const addAnchor = new FeatureAnchor({
      id: "anchor-draft",
      timeRange: { start: new TimePoint(1000), end: null },
      property: { name: "New", description: "", attributes: {} },
      shape: {},
      placement: {}
    });

    await expect(
      useCase.execute("polygon", [addAnchor], { vertices: [] }, "layer-0")
    ).rejects.toMatchObject({
      code: "FEATURE_ANCHOR_CONFLICTS"
    });

    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features).toHaveLength(1);
    expect(world.features[0].id).toBe("polygon-existing");
    expect(world.vertices.map(vertex => vertex.id)).toEqual(["ex-1", "ex-2", "ex-3"]);
  });

  it("accepts conflict resolutions on polygon add and returns updated side effects when requested", async () => {
    const existingAnchor = new FeatureAnchor({
      id: "anchor-existing-900",
      timeRange: { start: new TimePoint(900), end: null },
      property: { name: "Existing", description: "", attributes: {} },
      shape: {
        type: "Polygon",
        rings: [
          {
            id: "ring-existing",
            vertexIds: ["ex-1", "ex-2", "ex-3"],
            ringType: "territory",
            parentId: null
          }
        ]
      },
      placement: { layerId: "layer-0", parentId: "0", childIds: [] }
    });
    world.vertices = [
      { id: "ex-1", x: 0, y: 0 },
      { id: "ex-2", x: 10, y: 0 },
      { id: "ex-3", x: 0, y: 10 }
    ];
    world.features = [
      globalThis.createAnchoredPolygon(
        "polygon-existing",
        [existingAnchor],
        "layer-0",
        "0",
        [],
        [
          {
            id: "ring-existing",
            vertexIds: ["ex-1", "ex-2", "ex-3"],
            ringType: "territory",
            parentId: null
          }
        ]
      )
    ];

    const processGeometryWithNewVertices = vi.fn((_, targetWorld) => {
      const additions = [
        { id: "new-1", x: 1, y: 1 },
        { id: "new-2", x: 9, y: 1 },
        { id: "new-3", x: 1, y: 9 }
      ];
      additions.forEach(vertex => {
        if (!targetWorld.vertices.some(entry => entry.id === vertex.id)) {
          targetWorld.vertices.push(vertex);
        }
      });
      return {
        vertexIds: additions.map(vertex => vertex.id),
        holesVertexIds: [],
        parentId: "0"
      };
    });
    const useCase = new AddFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      generateId,
      processGeometryWithNewVertices,
      getVerticesFromIds
    );
    const addAnchor = new FeatureAnchor({
      id: "anchor-draft",
      timeRange: { start: new TimePoint(1000), end: null },
      property: { name: "New", description: "", attributes: {} },
      shape: {},
      placement: {}
    });
    const conflictId = "polygon-overlap:polygon-1::polygon-existing:1000:null:null";

    const result = await useCase.execute(
      "polygon",
      [addAnchor],
      { vertices: [] },
      "layer-0",
      {
        returnDetails: true,
        conflictResolutions: {
          [conflictId]: { preferFeatureId: "polygon-1" }
        }
      }
    );

    expect(result.feature.id).toBe("polygon-1");
    expect(result.updatedFeatures.map(feature => feature.id)).toEqual(
      expect.arrayContaining(["polygon-1", "polygon-existing"])
    );
    const existingAfter = world.features.find(feature => feature.id === "polygon-existing");
    expect(existingAfter).toBeTruthy();
    expect(existingAfter.anchors.map(anchor => anchor.startTime.year)).toEqual([900, 1000]);
    expect(existingAfter.anchors[0].endTime?.year).toBe(1000);
    expect(existingAfter.anchors[1].endTime).toBeNull();
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });
});
