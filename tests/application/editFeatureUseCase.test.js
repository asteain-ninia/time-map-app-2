// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditFeatureUseCase } from "../../src/application/usecases/EditFeatureUseCase.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const makeWorld = () => ({
  features: [],
  vertices: [],
  layers: [{ id: "layer-0", order: 0 }]
});

const createAnchor = (name = "Name") =>
  new FeatureAnchor({
    id: "anchor-draft",
    timeRange: { start: new TimePoint(0), end: null },
    property: { name, description: "", attributes: {} },
    shape: {},
    placement: {}
  });

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
    const addFeatureUseCase = { execute: vi.fn().mockResolvedValue({ id: "added" }) };
    const updateFeatureUseCase = { execute: vi.fn().mockResolvedValue({ id: "feature-1", name: "Updated" }) };
    const deleteFeatureUseCase = { execute: vi.fn().mockResolvedValue(undefined) };
    const vertexEditUseCase = { moveVertices: vi.fn().mockResolvedValue({ updated: true }) };

    const useCase = new EditFeatureUseCase(
      worldRepository,
      geometryService,
      layerService,
      polygonEditService,
      idService,
      {
        addFeatureUseCase,
        updateFeatureUseCase,
        deleteFeatureUseCase,
        vertexEditUseCase
      }
    );

    return {
      useCase,
      addFeatureUseCase,
      updateFeatureUseCase,
      deleteFeatureUseCase,
      vertexEditUseCase
    };
  };

  it("dispatches to AddFeatureUseCase for creation", async () => {
    const { useCase, addFeatureUseCase } = createUseCaseWithStubs();
    const anchor = createAnchor("Point");

    const result = await useCase.addFeature("point", [anchor], { vertexIds: ["v1"] }, "layer-0");

    expect(addFeatureUseCase.execute).toHaveBeenCalledWith(
      "point",
      [anchor],
      { vertexIds: ["v1"] },
      "layer-0"
    );
    expect(result).toEqual({ id: "added" });
  });

  it("forwards updates to UpdateFeatureUseCase", async () => {
    const { useCase, updateFeatureUseCase } = createUseCaseWithStubs();

    const result = await useCase.updateFeature("feature-1", { name: "Updated" });

    expect(updateFeatureUseCase.execute).toHaveBeenCalledWith("feature-1", { name: "Updated" });
    expect(result).toEqual({ id: "feature-1", name: "Updated" });
  });

  it("forwards deletions to DeleteFeatureUseCase", async () => {
    const { useCase, deleteFeatureUseCase } = createUseCaseWithStubs();

    await useCase.deleteFeature("feature-1");

    expect(deleteFeatureUseCase.execute).toHaveBeenCalledWith("feature-1");
  });

  it("routes vertex movement through VertexEditUseCase", async () => {
    const { useCase, vertexEditUseCase } = createUseCaseWithStubs();
    const payload = [{ id: "v1", x: 1, y: 2 }];

    const result = await useCase.moveVertices(payload);

    expect(vertexEditUseCase.moveVertices).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ updated: true });
  });
});
