// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditFeatureUseCase } from "../../src/application/usecases/EditFeatureUseCase.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const makeWorld = () => ({
  features: [],
  vertices: [],
  layers: [{ id: "layer-0", order: 0 }]
});

const createProperty = (name = "Name") => new Property(new TimePoint(0), name, "", {});

describe("EditFeatureUseCase", () => {
  let world;
  let worldRepository;
  let geometryService;
  let layerService;
  let polygonEditService;
  let idService;

  beforeEach(() => {
    world = makeWorld();
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
      validateLayerHierarchy: vi.fn(() => true)
    };
    polygonEditService = {
      processGeometryForCreation: vi.fn((geometry) => ({ vertexIds: geometry.vertexIds || [] })),
      updateGeometry: vi.fn((feature, geometry) => feature),
      cleanupSharedVertices: vi.fn(async () => {})
    };
    idService = {
      generateId: vi.fn((prefix = "feat") => `${prefix}-${Date.now()}`)
    };
  });

  const createUseCaseWithStubs = () => {
    const useCase = new EditFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      polygonEditService,
      idService
    );

    useCase._addFeatureUseCase = { execute: vi.fn().mockResolvedValue({ id: "added" }) };
    useCase._updateFeatureUseCase = { execute: vi.fn().mockResolvedValue({ id: "feature-1", name: "Updated" }) };
    useCase._deleteFeatureUseCase = { execute: vi.fn().mockResolvedValue(undefined) };
    useCase._vertexEditUseCase = { moveVertices: vi.fn().mockResolvedValue({ updated: true }) };

    return useCase;
  };

  it("dispatches to AddFeatureUseCase for creation", async () => {
    const useCase = createUseCaseWithStubs();
    const property = createProperty("Point");

    const result = await useCase.addFeature("point", [property], { vertexIds: ["v1"] }, "layer-0");

    expect(useCase._addFeatureUseCase.execute).toHaveBeenCalledWith(
      "point",
      [property],
      { vertexIds: ["v1"] },
      "layer-0"
    );
    expect(result).toEqual({ id: "added" });
  });

  it("forwards updates to UpdateFeatureUseCase", async () => {
    const useCase = createUseCaseWithStubs();

    const result = await useCase.updateFeature("feature-1", { name: "Updated" });

    expect(useCase._updateFeatureUseCase.execute).toHaveBeenCalledWith("feature-1", { name: "Updated" });
    expect(result).toEqual({ id: "feature-1", name: "Updated" });
  });

  it("forwards deletions to DeleteFeatureUseCase", async () => {
    const useCase = createUseCaseWithStubs();

    await useCase.deleteFeature("feature-1");

    expect(useCase._deleteFeatureUseCase.execute).toHaveBeenCalledWith("feature-1");
  });

  it("routes vertex movement through VertexEditUseCase", async () => {
    const useCase = createUseCaseWithStubs();
    const payload = [{ id: "v1", x: 1, y: 2 }];

    const result = await useCase.moveVertices(payload);

    expect(useCase._vertexEditUseCase.moveVertices).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ updated: true });
  });
});
