import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddFeatureUseCase } from "../../src/application/usecases/feature/AddFeatureUseCase.js";
import { UpdateFeatureUseCase } from "../../src/application/usecases/feature/UpdateFeatureUseCase.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { LayerService } from "../../src/domain/services/LayerService.js";
import { Layer } from "../../src/domain/entities/Layer.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = (name = "Polygon") => new FeatureAnchor({
  id: `anchor-${name}-0-null`,
  timeRange: { start: new TimePoint(0), end: null },
  property: { name, description: "", attributes: {} },
  shape: {},
  placement: {}
});
const createPropertyWithRange = (startYear, endYear, name = "Polygon") => new FeatureAnchor({
  id: `anchor-${name}-${startYear}-${endYear ?? "null"}`,
  timeRange: {
    start: new TimePoint(startYear),
    end: endYear === null ? null : new TimePoint(endYear)
  },
  property: { name, description: "", attributes: {} },
  shape: {},
  placement: {}
});
const toCreationAnchor = (property) => new FeatureAnchor({
  id: "anchor-draft",
  timeRange: {
    start: property.startTime,
    end: property.endTime || null
  },
  property: {
    name: property.name,
    description: property.description,
    attributes: property.getAttributes()
  },
  shape: {},
  placement: {}
});

const makeWorldRepository = (world) => ({
  getWorld: vi.fn(async () => world),
  saveWorld: vi.fn(async (updated) => {
    world = updated;
  })
});

const makeProcessGeometry = () => {
  let vertexCounter = 0;
  return (geometry, world) => {
    const processed = { ...geometry };
    if (Array.isArray(geometry.vertices)) {
      processed.vertexIds = geometry.vertices.map(({ x, y }) => {
        const id = `vertex-${++vertexCounter}`;
        world.vertices.push(new Vertex(id, x, y));
        return id;
      });
      delete processed.vertices;
    }
    return processed;
  };
};

const getVerticesFromIds = (ids, world) => ids.map((id) => world.vertices.find((vertex) => vertex.id === id));

describe("Polygon layer validation integration", () => {
  let geometryService;
  let layerService;

  beforeEach(() => {
    geometryService = new GeometryService();
    layerService = new LayerService();
  });

  it("rejects polygon addition that overlaps an existing polygon on the same layer", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("v1", 0, 0),
        new Vertex("v2", 10, 0),
        new Vertex("v3", 10, 10),
        new Vertex("v4", 0, 10)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-existing", [createProperty("Existing")], "layer-base", "0", [], [
          { id: "ring-existing", vertexIds: ["v1", "v2", "v3", "v4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const generateId = (() => {
      let counter = 0;
      return (prefix = "feature") => `${prefix}-${++counter}`;
    })();

    const useCase = new AddFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      generateId,
      processGeometry,
      getVerticesFromIds
    );

    await expect(
      useCase.execute(
        "polygon",
        [toCreationAnchor(createProperty("New"))],
        { vertices: [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
          { x: 5, y: 15 }
        ] },
        "layer-base"
      )
    ).rejects.toThrow(/重なっています/);

    expect(world.features).toHaveLength(1);
    expect(world.vertices).toHaveLength(4);
  });

  it("allows polygon addition when overlap exists only outside active time range", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("v1", 0, 0),
        new Vertex("v2", 10, 0),
        new Vertex("v3", 10, 10),
        new Vertex("v4", 0, 10)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-existing", [createPropertyWithRange(1000, 1200, "Existing")], "layer-base", "0", [], [
          { id: "ring-existing", vertexIds: ["v1", "v2", "v3", "v4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const generateId = (() => {
      let counter = 0;
      return (prefix = "feature") => `${prefix}-${++counter}`;
    })();

    const useCase = new AddFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      generateId,
      processGeometry,
      getVerticesFromIds
    );

    const added = await useCase.execute(
      "polygon",
      [toCreationAnchor(createPropertyWithRange(1200, null, "Later"))],
      { vertices: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 }
      ] },
      "layer-base"
    );

    expect(added.id).toMatch(/^polygon-/);
    expect(world.features).toHaveLength(2);
  });

  it("rejects moving an upper-layer polygon into a base layer when it overlaps", async () => {
    const layers = [
      new Layer("layer-base", "Base", 0, true, 1, ""),
      new Layer("layer-upper", "Upper", 1, true, 1, "")
    ];
    const world = {
      layers,
      vertices: [
        new Vertex("b1", 0, 0),
        new Vertex("b2", 10, 0),
        new Vertex("b3", 10, 10),
        new Vertex("b4", 0, 10),
        new Vertex("u1", 2, 2),
        new Vertex("u2", 8, 2),
        new Vertex("u3", 8, 8),
        new Vertex("u4", 2, 8)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-base", [createProperty("Base")], "layer-base", "0", [], [
          { id: "ring-base", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }
        ]),
        globalThis.createAnchoredPolygon("poly-upper", [createProperty("Upper")], "layer-upper", "0", [], [
          { id: "ring-upper", vertexIds: ["u1", "u2", "u3", "u4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const polygonEditService = {
      removeRingFromPolygon: vi.fn(),
      updateRingVertices: vi.fn(),
      addRingToPolygon: vi.fn(),
      addRingWithId: vi.fn()
    };

    const useCase = new UpdateFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      processGeometry,
      getVerticesFromIds,
      polygonEditService
    );

    await expect(
      useCase.execute("poly-upper", { layerId: "layer-base" })
    ).rejects.toThrow(/重なっています/);

    const upperPolygon = world.features.find(feature => feature.id === "poly-upper");
    expect(upperPolygon.layerId).toBe("layer-upper");
    expect(world.vertices).toHaveLength(8);
  });

  it("rejects property edits that introduce overlap at future anchor times", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("a1", 0, 0),
        new Vertex("a2", 10, 0),
        new Vertex("a3", 10, 10),
        new Vertex("a4", 0, 10),
        new Vertex("b1", 5, 5),
        new Vertex("b2", 15, 5),
        new Vertex("b3", 15, 15),
        new Vertex("b4", 5, 15)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-a", [createPropertyWithRange(1000, 1200, "A")], "layer-base", "0", [], [
          { id: "ring-a", vertexIds: ["a1", "a2", "a3", "a4"], ringType: "territory", parentId: null }
        ]),
        globalThis.createAnchoredPolygon("poly-b", [createPropertyWithRange(1200, null, "B")], "layer-base", "0", [], [
          { id: "ring-b", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const polygonEditService = {
      removeRingFromPolygon: vi.fn(),
      updateRingVertices: vi.fn(),
      addRingToPolygon: vi.fn(),
      addRingWithId: vi.fn()
    };

    const useCase = new UpdateFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      processGeometry,
      getVerticesFromIds,
      polygonEditService
    );

    await expect(
      useCase.execute("poly-a", {
        propertyEdit: {
          editTime: new TimePoint(1100),
          startTime: new TimePoint(1100),
          endTime: new TimePoint(1300),
          name: "A-edited",
          description: ""
        }
      })
    ).rejects.toThrow(/重なっています/);

    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    const polyAAfter = world.features.find((feature) => feature.id === "poly-a");
    expect(polyAAfter.anchors).toHaveLength(1);
    expect(polyAAfter.anchors[0].startTime.equals(new TimePoint(1000))).toBe(true);
    expect(polyAAfter.anchors[0].endTime.equals(new TimePoint(1200))).toBe(true);
    expect(polyAAfter.existsAt(new TimePoint(1250))).toBe(false);
  });

  it("allows property edits that avoid future overlap by ending before the next anchor", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("a1", 0, 0),
        new Vertex("a2", 10, 0),
        new Vertex("a3", 10, 10),
        new Vertex("a4", 0, 10),
        new Vertex("b1", 5, 5),
        new Vertex("b2", 15, 5),
        new Vertex("b3", 15, 15),
        new Vertex("b4", 5, 15)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-a", [createPropertyWithRange(1000, 1200, "A")], "layer-base", "0", [], [
          { id: "ring-a", vertexIds: ["a1", "a2", "a3", "a4"], ringType: "territory", parentId: null }
        ]),
        globalThis.createAnchoredPolygon("poly-b", [createPropertyWithRange(1200, null, "B")], "layer-base", "0", [], [
          { id: "ring-b", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const polygonEditService = {
      removeRingFromPolygon: vi.fn(),
      updateRingVertices: vi.fn(),
      addRingToPolygon: vi.fn(),
      addRingWithId: vi.fn()
    };

    const useCase = new UpdateFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      processGeometry,
      getVerticesFromIds,
      polygonEditService
    );

    const result = await useCase.execute("poly-a", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(1100),
        endTime: new TimePoint(1190),
        name: "A-edited",
        description: ""
      }
    });

    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(result.feature.existsAt(new TimePoint(1189))).toBe(true);
    expect(result.feature.existsAt(new TimePoint(1195))).toBe(false);
    expect(result.feature.existsAt(new TimePoint(1200))).toBe(false);
  });

  it("limits overlap validation to affectedTimeRange when provided in property edits", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("a1", 0, 0),
        new Vertex("a2", 10, 0),
        new Vertex("a3", 10, 10),
        new Vertex("a4", 0, 10),
        new Vertex("f1", 20, 20),
        new Vertex("f2", 30, 20),
        new Vertex("f3", 30, 30),
        new Vertex("f4", 20, 30),
        new Vertex("b1", 5, 5),
        new Vertex("b2", 15, 5),
        new Vertex("b3", 15, 15),
        new Vertex("b4", 5, 15)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-a", [
          new FeatureAnchor({
            id: "anchor-a-1000",
            timeRange: { start: new TimePoint(1000), end: new TimePoint(1300) },
            property: { name: "A-1000", description: "", attributes: {} },
            shape: {
              type: "Polygon",
              rings: [{ id: "ring-a-past", vertexIds: ["a1", "a2", "a3", "a4"], ringType: "territory", parentId: null }]
            },
            placement: { layerId: "layer-base", parentId: "0", childIds: [] }
          }),
          new FeatureAnchor({
            id: "anchor-a-1300",
            timeRange: { start: new TimePoint(1300), end: null },
            property: { name: "A-1300", description: "", attributes: {} },
            shape: {
              type: "Polygon",
              rings: [{ id: "ring-a-future", vertexIds: ["f1", "f2", "f3", "f4"], ringType: "territory", parentId: null }]
            },
            placement: { layerId: "layer-base", parentId: "0", childIds: [] }
          })
        ], "layer-base", "0", [], []),
        globalThis.createAnchoredPolygon("poly-b", [createPropertyWithRange(900, null, "B")], "layer-base", "0", [], [
          { id: "ring-b", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const polygonEditService = {
      removeRingFromPolygon: vi.fn(),
      updateRingVertices: vi.fn(),
      addRingToPolygon: vi.fn(),
      addRingWithId: vi.fn()
    };

    const useCase = new UpdateFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      processGeometry,
      getVerticesFromIds,
      polygonEditService
    );

    await expect(
      useCase.execute("poly-a", {
        propertyEdit: {
          editTime: new TimePoint(1300),
          startTime: new TimePoint(1300),
          endTime: null,
          name: "A-1300-edited",
          description: ""
        }
      })
    ).rejects.toThrow(/重なっています/);

    const result = await useCase.execute("poly-a", {
      propertyEdit: {
        editTime: new TimePoint(1300),
        startTime: new TimePoint(1300),
        endTime: null,
        name: "A-1300-edited",
        description: "",
        affectedTimeRange: {
          start: new TimePoint(1300),
          end: null
        }
      }
    });

    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(result.feature.getAnchorAt(new TimePoint(1300)).name).toBe("A-1300-edited");
  });

  it("returns conflict details when property edit introduces overlap without resolutions", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("a1", 0, 0),
        new Vertex("a2", 10, 0),
        new Vertex("a3", 10, 10),
        new Vertex("a4", 0, 10),
        new Vertex("b1", 5, 5),
        new Vertex("b2", 15, 5),
        new Vertex("b3", 15, 15),
        new Vertex("b4", 5, 15)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-a", [createPropertyWithRange(1000, 1200, "A")], "layer-base", "0", [], [
          { id: "ring-a", vertexIds: ["a1", "a2", "a3", "a4"], ringType: "territory", parentId: null }
        ]),
        globalThis.createAnchoredPolygon("poly-b", [createPropertyWithRange(900, null, "B")], "layer-base", "0", [], [
          { id: "ring-b", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const polygonEditService = {
      removeRingFromPolygon: vi.fn(),
      updateRingVertices: vi.fn(),
      addRingToPolygon: vi.fn(),
      addRingWithId: vi.fn()
    };

    const useCase = new UpdateFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      processGeometry,
      getVerticesFromIds,
      polygonEditService
    );

    try {
      await useCase.execute("poly-a", {
        propertyEdit: {
          editTime: new TimePoint(1100),
          startTime: new TimePoint(1100),
          endTime: new TimePoint(1300),
          name: "A-edited",
          description: ""
        }
      });
      throw new Error("Expected conflict error");
    } catch (error) {
      expect(error.code).toBe("FEATURE_ANCHOR_CONFLICTS");
      expect(Array.isArray(error.conflicts)).toBe(true);
      expect(error.conflicts.length).toBeGreaterThan(0);
      expect(error.conflicts[0].featureIdA).toBe("poly-a");
      expect(error.conflicts[0].featureIdB).toBe("poly-b");
    }
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("applies provided conflict resolutions and updates the losing polygon timeline", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("a1", 0, 0),
        new Vertex("a2", 10, 0),
        new Vertex("a3", 10, 10),
        new Vertex("a4", 0, 10),
        new Vertex("b1", 5, 5),
        new Vertex("b2", 15, 5),
        new Vertex("b3", 15, 15),
        new Vertex("b4", 5, 15)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-a", [createPropertyWithRange(1000, 1200, "A")], "layer-base", "0", [], [
          { id: "ring-a", vertexIds: ["a1", "a2", "a3", "a4"], ringType: "territory", parentId: null }
        ]),
        globalThis.createAnchoredPolygon("poly-b", [createPropertyWithRange(900, null, "B")], "layer-base", "0", [], [
          { id: "ring-b", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const polygonEditService = {
      removeRingFromPolygon: vi.fn(),
      updateRingVertices: vi.fn(),
      addRingToPolygon: vi.fn(),
      addRingWithId: vi.fn()
    };

    const useCase = new UpdateFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      processGeometry,
      getVerticesFromIds,
      polygonEditService
    );

    let conflictId = "";
    try {
      await useCase.execute("poly-a", {
        propertyEdit: {
          editTime: new TimePoint(1100),
          startTime: new TimePoint(1100),
          endTime: new TimePoint(1300),
          name: "A-edited",
          description: ""
        }
      });
      throw new Error("Expected conflict error");
    } catch (error) {
      conflictId = error.conflicts[0].id;
    }

    const result = await useCase.execute("poly-a", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(1100),
        endTime: new TimePoint(1300),
        name: "A-edited",
        description: "",
        conflictResolutions: {
          [conflictId]: { preferFeatureId: "poly-a" }
        }
      }
    });

    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(result.feature.existsAt(new TimePoint(1250))).toBe(true);
    const polyBAfter = world.features.find(feature => feature.id === "poly-b");
    expect(polyBAfter.existsAt(new TimePoint(1200))).toBe(false);
    expect(polyBAfter.anchors[0].endTime.equals(new TimePoint(1000))).toBe(true);
    const updatedIds = (result.updatedFeatures || []).map(feature => feature.id).sort();
    expect(updatedIds).toEqual(["poly-a", "poly-b"]);
  });

  it("rejects upper-layer polygons that outlive their containing parent in future anchors", async () => {
    const layers = [
      new Layer("layer-base", "Base", 0, true, 1, ""),
      new Layer("layer-upper", "Upper", 1, true, 1, "")
    ];
    const world = {
      layers,
      vertices: [
        new Vertex("p1", 0, 0),
        new Vertex("p2", 20, 0),
        new Vertex("p3", 20, 20),
        new Vertex("p4", 0, 20),
        new Vertex("c1", 5, 5),
        new Vertex("c2", 10, 5),
        new Vertex("c3", 10, 10),
        new Vertex("c4", 5, 10)
      ],
      features: [
        globalThis.createAnchoredPolygon("parent", [createPropertyWithRange(1000, 1200, "Parent")], "layer-base", "0", [], [
          { id: "ring-parent", vertexIds: ["p1", "p2", "p3", "p4"], ringType: "territory", parentId: null }
        ]),
        globalThis.createAnchoredPolygon("child", [createPropertyWithRange(1000, 1200, "Child")], "layer-upper", "parent", [], [
          { id: "ring-child", vertexIds: ["c1", "c2", "c3", "c4"], ringType: "territory", parentId: null }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const polygonEditService = {
      removeRingFromPolygon: vi.fn(),
      updateRingVertices: vi.fn(),
      addRingToPolygon: vi.fn(),
      addRingWithId: vi.fn()
    };

    const useCase = new UpdateFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      processGeometry,
      getVerticesFromIds,
      polygonEditService
    );

    await expect(
      useCase.execute("child", {
        propertyEdit: {
          editTime: new TimePoint(1100),
          startTime: new TimePoint(1100),
          endTime: new TimePoint(1300),
          name: "Child-edited",
          description: ""
        }
      })
    ).rejects.toThrow(/レイヤー階層|上位レイヤー/);

    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    const childAfter = world.features.find((feature) => feature.id === "child");
    expect(childAfter.anchors).toHaveLength(1);
    expect(childAfter.anchors[0].endTime.equals(new TimePoint(1200))).toBe(true);
  });

  it("allows polygon addition inside another polygon's hole", async () => {
    const layers = [new Layer("layer-base", "Base", 0, true, 1, "")];
    const world = {
      layers,
      vertices: [
        new Vertex("t1", 0, 0),
        new Vertex("t2", 10, 0),
        new Vertex("t3", 10, 10),
        new Vertex("t4", 0, 10),
        new Vertex("h1", 2, 2),
        new Vertex("h2", 4, 2),
        new Vertex("h3", 4, 4),
        new Vertex("h4", 2, 4)
      ],
      features: [
        globalThis.createAnchoredPolygon("poly-with-hole", [createProperty("Outer")], "layer-base", "0", [], [
          { id: "outer", vertexIds: ["t1", "t2", "t3", "t4"], ringType: "territory", parentId: null },
          { id: "hole", vertexIds: ["h1", "h2", "h3", "h4"], ringType: "hole", parentId: "outer" }
        ])
      ],
      metadata: {}
    };

    const worldRepository = makeWorldRepository(world);
    const processGeometry = makeProcessGeometry();
    const generateId = (() => {
      let counter = 0;
      return (prefix = "feature") => `${prefix}-${++counter}`;
    })();

    const useCase = new AddFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      generateId,
      processGeometry,
      getVerticesFromIds
    );

    const result = await useCase.execute(
      "polygon",
      [toCreationAnchor(createProperty("Enclave"))],
      { vertices: [
        { x: 2.5, y: 2.5 },
        { x: 3.5, y: 2.5 },
        { x: 3.5, y: 3.5 },
        { x: 2.5, y: 3.5 }
      ] },
      "layer-base"
    );

    expect(result.layerId).toBe("layer-base");
    expect(world.features).toHaveLength(2);
  });
});
