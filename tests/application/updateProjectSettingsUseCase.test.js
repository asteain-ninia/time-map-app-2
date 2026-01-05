// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { UpdateProjectSettingsUseCase } from "../../src/application/usecases/UpdateProjectSettingsUseCase.js";

const createWorld = () => ({
  metadata: {
    settings: {
      sliderMin: 0,
      sliderMax: 1000,
      zoomMin: 1,
      zoomMax: 50,
      gridInterval: 10,
      gridColor: "#cccccc",
      gridOpacity: 0.5,
      equatorLength: 40000,
      worldName: "Original",
      worldDescription: "Original description"
    }
  }
});

describe("UpdateProjectSettingsUseCase", () => {
  it("rejects invalid equator length", async () => {
    const world = createWorld();
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn()
    };
    const useCase = new UpdateProjectSettingsUseCase(worldRepository);

    const invalidSettings = {
      equatorLength: 0,
      zoomMin: 1,
      zoomMax: 50,
      sliderMin: 0,
      sliderMax: 10,
      gridInterval: 1,
      gridColor: "#ffffff",
      gridOpacity: 0.5,
      worldName: "Name",
      worldDescription: "Desc"
    };

    await expect(useCase.execute(invalidSettings)).rejects.toThrow();
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("rejects invalid slider range", async () => {
    const world = createWorld();
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn()
    };
    const useCase = new UpdateProjectSettingsUseCase(worldRepository);

    const invalidSettings = {
      equatorLength: 40000,
      zoomMin: 1,
      zoomMax: 50,
      sliderMin: 50,
      sliderMax: 10,
      gridInterval: 1,
      gridColor: "#ffffff",
      gridOpacity: 0.5,
      worldName: "Name",
      worldDescription: "Desc"
    };

    await expect(useCase.execute(invalidSettings)).rejects.toThrow();
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("rejects invalid zoom range", async () => {
    const world = createWorld();
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn()
    };
    const useCase = new UpdateProjectSettingsUseCase(worldRepository);

    const invalidSettings = {
      equatorLength: 40000,
      zoomMin: 2,
      zoomMax: 1,
      sliderMin: 0,
      sliderMax: 10,
      gridInterval: 1,
      gridColor: "#ffffff",
      gridOpacity: 0.5,
      worldName: "Name",
      worldDescription: "Desc"
    };

    await expect(useCase.execute(invalidSettings)).rejects.toThrow();
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("rejects zoom values outside allowed bounds", async () => {
    const world = createWorld();
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn()
    };
    const useCase = new UpdateProjectSettingsUseCase(worldRepository);

    const invalidSettings = {
      equatorLength: 40000,
      zoomMin: 0.05,
      zoomMax: 100,
      sliderMin: 0,
      sliderMax: 10,
      gridInterval: 1,
      gridColor: "#ffffff",
      gridOpacity: 0.5,
      worldName: "Name",
      worldDescription: "Desc"
    };

    await expect(useCase.execute(invalidSettings)).rejects.toThrow();
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("persists sanitized settings and returns a deep copy", async () => {
    const world = createWorld();
    const worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async (updated) => {
        Object.assign(world, updated);
      })
    };
    const useCase = new UpdateProjectSettingsUseCase(worldRepository);

    const newSettings = {
      equatorLength: 50000,
      zoomMin: 2,
      zoomMax: 40,
      sliderMin: 100,
      sliderMax: 200,
      gridInterval: 20,
      gridColor: "#123456",
      gridOpacity: 0.75,
      worldName: 123,
      worldDescription: null
    };

    const result = await useCase.execute({ ...newSettings });

    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(world.metadata.settings).toEqual({
      equatorLength: 50000,
      zoomMin: 2,
      zoomMax: 40,
      sliderMin: 100,
      sliderMax: 200,
      gridInterval: 20,
      gridColor: "#123456",
      gridOpacity: 0.75,
      worldName: "",
      worldDescription: ""
    });
    expect(result).toStrictEqual(world.metadata.settings);
    expect(result).not.toBe(world.metadata.settings);
  });
});
