import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddFeatureUseCase } from "../../src/application/usecases/feature/AddFeatureUseCase.js";
import { UpdateFeatureUseCase } from "../../src/application/usecases/feature/UpdateFeatureUseCase.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { LayerService } from "../../src/domain/services/LayerService.js";
import { Layer } from "../../src/domain/entities/Layer.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = (name = "Polygon") => new Property(new TimePoint(0), name, "", {});

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
        new Polygon("poly-existing", [createProperty("Existing")], "layer-base", "0", [], [
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
        [createProperty("New")],
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
        new Polygon("poly-base", [createProperty("Base")], "layer-base", "0", [], [
          { id: "ring-base", vertexIds: ["b1", "b2", "b3", "b4"], ringType: "territory", parentId: null }
        ]),
        new Polygon("poly-upper", [createProperty("Upper")], "layer-upper", "0", [], [
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
        new Polygon("poly-with-hole", [createProperty("Outer")], "layer-base", "0", [], [
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
      [createProperty("Enclave")],
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
