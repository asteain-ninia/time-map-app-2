// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateFeatureUseCase } from "../../src/application/usecases/feature/UpdateFeatureUseCase.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = (year, name) =>
  new Property(new TimePoint(year), name, "", {}, new TimePoint(year), null);

describe("UpdateFeatureUseCase property updates", () => {
  let world;
  let worldRepository;
  let useCase;

  beforeEach(() => {
    world = {
      layers: [{ id: "layer-1", order: 0 }],
      vertices: [new Vertex("v1", 0, 0)],
      features: [],
      metadata: {}
    };

    worldRepository = {
      getWorld: vi.fn(async () => world),
      saveWorld: vi.fn(async (updated) => {
        world = updated;
      })
    };

    useCase = new UpdateFeatureUseCase(
      worldRepository,
      {},
      {},
      (geometry) => geometry,
      () => [],
      {
        removeRingFromPolygon: vi.fn(),
        updateRingVertices: vi.fn(),
        addRingToPolygon: vi.fn(),
        addRingWithId: vi.fn()
      }
    );
  });

  it("updates properties with multiple anchors", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initialProperty], "layer-1"));

    const earlier = createProperty(0, "Earlier");
    const later = createProperty(10, "Later");

    const result = await useCase.execute("point-1", { properties: [later, earlier] });

    expect(result.feature.properties).toHaveLength(2);
    expect(result.feature.properties[0]).toBe(earlier);
    expect(result.feature.properties[1]).toBe(later);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(world.features[0].properties).toHaveLength(2);
  });

  it("rejects empty property updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initialProperty], "layer-1"));

    await expect(useCase.execute("point-1", { properties: [] })).rejects.toThrow(/non-empty/);
  });
});
