// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateFeatureUseCase } from "../../src/application/usecases/feature/UpdateFeatureUseCase.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = (year, name) =>
  new Property(new TimePoint(year), name, "", {}, new TimePoint(year), null);

const createPropertyWithEnd = (startYear, endYear, name) =>
  new Property(
    new TimePoint(startYear),
    name,
    "",
    {},
    new TimePoint(startYear),
    endYear === null ? null : new TimePoint(endYear)
  );

describe("UpdateFeatureUseCase property updates", () => {
  let world;
  let worldRepository;
  let useCase;

  const expectNameAt = (feature, year, expectedName) => {
    const property = feature.getPropertyAt(new TimePoint(year));
    expect(property).not.toBeNull();
    expect(property.name).toBe(expectedName);
  };

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
    expect(result.feature.properties[0].startTime.equals(earlier.startTime)).toBe(true);
    expect(result.feature.properties[0].name).toBe(earlier.name);
    expect(result.feature.properties[1].startTime.equals(later.startTime)).toBe(true);
    expect(result.feature.properties[1].name).toBe(later.name);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(world.features[0].properties).toHaveLength(2);
  });

  it("rejects empty property updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initialProperty], "layer-1"));

    await expect(useCase.execute("point-1", { properties: [] })).rejects.toThrow(/non-empty/);
  });

  it("rejects duplicate anchors in properties array updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initialProperty], "layer-1"));

    const duplicateA = createProperty(1000, "A");
    const duplicateB = createProperty(1000, "B");

    await expect(
      useCase.execute("point-1", { properties: [duplicateA, duplicateB] })
    ).rejects.toThrow(/同一時刻の歴史の錨が重複/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features[0].properties).toHaveLength(1);
    expect(world.features[0].properties[0].name).toBe("Initial");
  });

  it("rejects overlapping ranges in properties array updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initialProperty], "layer-1"));

    const past = createPropertyWithEnd(1000, 1500, "Past");
    const future = createProperty(1300, "Future");

    await expect(
      useCase.execute("point-1", { properties: [future, past] })
    ).rejects.toThrow(/次の歴史の錨/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features[0].properties[0].name).toBe("Initial");
  });

  it("rejects end times that are not after anchor start in properties array updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initialProperty], "layer-1"));

    const invalidRange = createPropertyWithEnd(1200, 1200, "Invalid");

    await expect(
      useCase.execute("point-1", { properties: [invalidRange] })
    ).rejects.toThrow(/開始時刻より後/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features[0].properties[0].name).toBe("Initial");
  });

  it("allows explicit gaps in properties array updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initialProperty], "layer-1"));

    const past = createPropertyWithEnd(1000, 1100, "Past");
    const future = createProperty(1300, "Future");

    const result = await useCase.execute("point-1", { properties: [future, past] });

    expect(result.feature.properties).toHaveLength(2);
    expect(result.feature.properties[0].startTime.equals(new TimePoint(1000))).toBe(true);
    expect(result.feature.properties[0].endTime.equals(new TimePoint(1100))).toBe(true);
    expect(result.feature.properties[1].startTime.equals(new TimePoint(1300))).toBe(true);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("splits an anchor at edit time and preserves the future anchor", async () => {
    const past = createProperty(1000, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(new Point("point-1", ["v1"], [past, future], "layer-1"));

    const result = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(1100),
        endTime: null,
        name: "Edited",
        description: "edited-description"
      }
    });

    expect(result.feature.properties).toHaveLength(3);
    const starts = result.feature.properties.map(prop => prop.startTime.year);
    expect(starts).toEqual([1000, 1100, 1300]);

    const edited = result.feature.properties[1];
    expect(edited.name).toBe("Edited");
    expect(edited.description).toBe("edited-description");
    expect(edited.endTime.equals(new TimePoint(1300))).toBe(true);

    const preservedFuture = result.feature.properties[2];
    expect(preservedFuture.name).toBe("Future");
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("rejects end times that exceed the next future anchor", async () => {
    const past = createProperty(1000, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(new Point("point-1", ["v1"], [past, future], "layer-1"));

    await expect(
      useCase.execute("point-1", {
        propertyEdit: {
          editTime: new TimePoint(1100),
          startTime: new TimePoint(1100),
          endTime: new TimePoint(1400),
          name: "Edited",
          description: ""
        }
      })
    ).rejects.toThrow(/次の歴史の錨/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("rejects edits when start time does not match the timeline time", async () => {
    const past = createProperty(1000, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(new Point("point-1", ["v1"], [past, future], "layer-1"));

    await expect(
      useCase.execute("point-1", {
        propertyEdit: {
          editTime: new TimePoint(1100),
          startTime: new TimePoint(1000),
          endTime: null,
          name: "Edited",
          description: ""
        }
      })
    ).rejects.toThrow(/現在時刻と一致/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("updates an existing anchor without creating duplicates", async () => {
    const past = createPropertyWithEnd(1000, 1300, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(new Point("point-1", ["v1"], [past, future], "layer-1"));

    const result = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1300),
        startTime: new TimePoint(1300),
        endTime: null,
        name: "Future Updated",
        description: "future-description"
      }
    });

    expect(result.feature.properties).toHaveLength(2);
    expect(result.feature.properties[1].name).toBe("Future Updated");
    expect(result.feature.properties[1].startTime.equals(new TimePoint(1300))).toBe(true);
    const anchorsAt1300 = result.feature.properties.filter(prop => prop.startTime.equals(new TimePoint(1300)));
    expect(anchorsAt1300).toHaveLength(1);
  });

  it("allows editing past after creating a future anchor first", async () => {
    const initial = createPropertyWithEnd(1000, 2001, "Initial");
    world.features.push(new Point("point-1", ["v1"], [initial], "layer-1"));

    const afterFutureEdit = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1300),
        startTime: new TimePoint(1300),
        endTime: new TimePoint(2001),
        name: "Future",
        description: ""
      }
    });

    expect(afterFutureEdit.feature.properties).toHaveLength(2);
    expect(afterFutureEdit.feature.properties[0].endTime.equals(new TimePoint(1300))).toBe(true);
    expect(afterFutureEdit.feature.properties[1].startTime.equals(new TimePoint(1300))).toBe(true);

    const afterPastEdit = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(1100),
        endTime: new TimePoint(1300),
        name: "Past Mid",
        description: ""
      }
    });

    expect(afterPastEdit.feature.properties).toHaveLength(3);
    expect(afterPastEdit.feature.properties[0].startTime.equals(new TimePoint(1000))).toBe(true);
    expect(afterPastEdit.feature.properties[0].endTime.equals(new TimePoint(1100))).toBe(true);
    expect(afterPastEdit.feature.properties[1].startTime.equals(new TimePoint(1100))).toBe(true);
    expect(afterPastEdit.feature.properties[1].endTime.equals(new TimePoint(1300))).toBe(true);
    expect(afterPastEdit.feature.properties[2].startTime.equals(new TimePoint(1300))).toBe(true);
    expect(afterPastEdit.feature.properties[2].name).toBe("Future");
  });

  it("reproduces manual timeline checks for 1000->1300->1100 edits", async () => {
    const initial = createProperty(1000, "A");
    world.features.push(new Point("point-1", ["v1"], [initial], "layer-1"));

    await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1300),
        startTime: new TimePoint(1300),
        endTime: null,
        name: "B",
        description: ""
      }
    });

    const afterPastEdit = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(1100),
        endTime: null,
        name: "C",
        description: ""
      }
    });

    expect(afterPastEdit.feature.properties).toHaveLength(3);
    expectNameAt(afterPastEdit.feature, 1050, "A");
    expectNameAt(afterPastEdit.feature, 1150, "C");
    expectNameAt(afterPastEdit.feature, 1299, "C");
    expectNameAt(afterPastEdit.feature, 1300, "B");
    expectNameAt(afterPastEdit.feature, 1350, "B");
  });
});
