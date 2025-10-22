// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManageLayersUseCase } from "../../src/application/usecases/ManageLayersUseCase.js";
import { Layer } from "../../src/domain/entities/Layer.js";

const createWorld = () => ({
  layers: [new Layer("layer-0", "Base", 0, true, 1.0)],
  features: []
});

describe("ManageLayersUseCase", () => {
  let world;
  let worldRepository;
  let layerService;
  let idGenerationService;
  let useCase;

  beforeEach(() => {
    world = createWorld();
    worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async (updated) => {
        world = updated;
      })
    };
    layerService = {
      validateLayerHierarchy: vi.fn(() => true)
    };
    let counter = 0;
    idGenerationService = {
      generateId: vi.fn(() => {
        counter += 1;
        return `layer-generated-${counter}`;
      })
    };
    useCase = new ManageLayersUseCase(worldRepository, layerService, idGenerationService);
  });

  it("adds a layer with sequential order and persists the world", async () => {
    const newLayer = await useCase.addLayer("Overlay", "desc");

    expect(newLayer).toBeInstanceOf(Layer);
    expect(world.layers).toHaveLength(2);
    expect(world.layers[1].order).toBe(1);
    expect(layerService.validateLayerHierarchy).toHaveBeenCalledWith(world.layers);
    expect(worldRepository.saveWorld).toHaveBeenCalled();
  });

  it("updates layer attributes and saves", async () => {
    const updated = await useCase.updateLayer("layer-0", {
      name: "Updated Base",
      visible: false,
      opacity: 0.5,
      description: "new"
    });

    expect(updated.name).toBe("Updated Base");
    expect(updated.visible).toBe(false);
    expect(updated.opacity).toBe(0.5);
    expect(world.layers[0].description).toBe("new");
    expect(worldRepository.saveWorld).toHaveBeenCalled();
  });

  it("refuses to delete a layer when related features exist", async () => {
    world.features.push({ layerId: "layer-0" });

    await expect(useCase.deleteLayer("layer-0")).rejects.toThrow("related features");
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("deletes a layer and reorders remaining layers", async () => {
    world.layers.push(new Layer("layer-1", "Overlay", 1, true, 1.0));

    await useCase.deleteLayer("layer-1");

    expect(world.layers).toHaveLength(1);
    expect(world.layers[0].order).toBe(0);
    expect(worldRepository.saveWorld).toHaveBeenCalled();
  });

  it("reorders layers within bounds", async () => {
    world.layers.push(new Layer("layer-1", "Overlay", 1, true, 1.0));
    world.layers.push(new Layer("layer-2", "Top", 2, true, 1.0));

    const updated = await useCase.reorderLayer("layer-2", 0);

    expect(updated[0].id).toBe("layer-2");
    expect(updated[0].order).toBe(0);
    expect(layerService.validateLayerHierarchy).toHaveBeenCalled();
    expect(worldRepository.saveWorld).toHaveBeenCalled();
  });

  it("throws when layer hierarchy validation fails on add", async () => {
    const originalIds = world.layers.map((layer) => layer.id);
    const originalOrders = world.layers.map((layer) => layer.order);
    layerService.validateLayerHierarchy.mockReturnValueOnce(false);

    await expect(useCase.addLayer("Invalid")).rejects.toThrow("Layer hierarchy validation failed");
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.layers.map((layer) => layer.id)).toEqual(originalIds);
    expect(world.layers.map((layer) => layer.order)).toEqual(originalOrders);
    expect(world.layers).toHaveLength(1);
  });

  it("does not save when reordered layers break hierarchy", async () => {
    world.layers.push(new Layer("layer-1", "Overlay", 1, true, 1.0));
    world.layers.push(new Layer("layer-2", "Top", 2, true, 1.0));
    const originalIds = world.layers.map((layer) => layer.id);
    const originalOrders = world.layers.map((layer) => layer.order);
    layerService.validateLayerHierarchy.mockReturnValueOnce(false);

    await expect(useCase.reorderLayer("layer-2", 0)).rejects.toThrow("Layer hierarchy validation failed");
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.layers.map((layer) => layer.id)).toEqual(originalIds);
    expect(world.layers.map((layer) => layer.order)).toEqual(originalOrders);
  });

  it("retries layer ID generation when a duplicate candidate is produced", async () => {
    world.layers.push(new Layer("layer-generated-1", "Existing", 1, true, 1.0));
    idGenerationService.generateId
      .mockReturnValueOnce("layer-generated-1")
      .mockReturnValueOnce("layer-generated-2");

    const newLayer = await useCase.addLayer("Overlay");

    expect(newLayer.id).toBe("layer-generated-2");
    expect(idGenerationService.generateId).toHaveBeenCalledTimes(2);
  });
});
