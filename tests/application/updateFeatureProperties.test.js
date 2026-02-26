// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateFeatureUseCase } from "../../src/application/usecases/feature/UpdateFeatureUseCase.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";

const createPointAnchorWithEnd = (startYear, endYear, name) =>
  new FeatureAnchor({
    id: `anchor-${startYear}-${name}`,
    timeRange: {
      start: new TimePoint(startYear),
      end: endYear === null ? null : new TimePoint(endYear)
    },
    property: {
      name,
      description: "",
      attributes: {}
    },
    shape: {
      type: "Point",
      vertexId: "v1"
    },
    placement: {
      layerId: "layer-1"
    }
  });

const createPointAnchor = (year, name) =>
  createPointAnchorWithEnd(year, null, name);

const createProperty = (year, name) =>
  createPointAnchor(year, name);

const createPropertyWithEnd = (startYear, endYear, name) =>
  createPointAnchorWithEnd(startYear, endYear, name);

describe("UpdateFeatureUseCase anchor updates", () => {
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
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initialProperty], "layer-1"));

    const earlier = createPointAnchor(0, "Earlier");
    const later = createPointAnchor(10, "Later");

    const result = await useCase.execute("point-1", { anchors: [later, earlier] });

    expect(result.feature.anchors).toHaveLength(2);
    expect(result.feature.anchors[0].startTime.equals(earlier.startTime)).toBe(true);
    expect(result.feature.anchors[0].name).toBe(earlier.name);
    expect(result.feature.anchors[1].startTime.equals(later.startTime)).toBe(true);
    expect(result.feature.anchors[1].name).toBe(later.name);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    expect(world.features[0].anchors).toHaveLength(2);
  });

  it("rejects empty anchors updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initialProperty], "layer-1"));

    await expect(useCase.execute("point-1", { anchors: [] })).rejects.toThrow(/anchors が必要/);
  });

  it("rejects deprecated properties payloads", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initialProperty], "layer-1"));

    await expect(
      useCase.execute("point-1", {
        properties: [createProperty(2, "Legacy")]
      })
    ).rejects.toThrow(/廃止されました/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features[0].anchors).toHaveLength(1);
    expect(world.features[0].anchors[0].name).toBe("Initial");
  });

  it("rejects duplicate anchors in anchors updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initialProperty], "layer-1"));

    const duplicateA = createPointAnchor(1000, "A");
    const duplicateB = createPointAnchor(1000, "B");

    await expect(
      useCase.execute("point-1", { anchors: [duplicateA, duplicateB] })
    ).rejects.toThrow(/同一時刻の歴史の錨が重複/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features[0].anchors).toHaveLength(1);
    expect(world.features[0].anchors[0].name).toBe("Initial");
  });

  it("rejects overlapping ranges in anchors updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initialProperty], "layer-1"));

    const past = createPointAnchorWithEnd(1000, 1500, "Past");
    const future = createPointAnchor(1300, "Future");

    await expect(
      useCase.execute("point-1", { anchors: [future, past] })
    ).rejects.toThrow(/次の歴史の錨/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features[0].anchors[0].name).toBe("Initial");
  });

  it("rejects non-FeatureAnchor entries in anchors updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initialProperty], "layer-1"));

    await expect(
      useCase.execute("point-1", {
        anchors: [{
          id: "legacy-anchor",
          timeRange: { start: new TimePoint(1200), end: new TimePoint(1300) }
        }]
      })
    ).rejects.toThrow(/FeatureAnchor/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
    expect(world.features[0].anchors[0].name).toBe("Initial");
  });

  it("allows explicit gaps in anchors updates", async () => {
    const initialProperty = createProperty(1, "Initial");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initialProperty], "layer-1"));

    const past = createPointAnchorWithEnd(1000, 1100, "Past");
    const future = createPointAnchor(1300, "Future");

    const result = await useCase.execute("point-1", { anchors: [future, past] });

    expect(result.feature.anchors).toHaveLength(2);
    expect(result.feature.anchors[0].startTime.equals(new TimePoint(1000))).toBe(true);
    expect(result.feature.anchors[0].endTime.equals(new TimePoint(1100))).toBe(true);
    expect(result.feature.anchors[1].startTime.equals(new TimePoint(1300))).toBe(true);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("splits an anchor at edit time and preserves the future anchor", async () => {
    const past = createProperty(1000, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [past, future], "layer-1"));

    const result = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(1100),
        endTime: null,
        name: "Edited",
        description: "edited-description"
      }
    });

    expect(result.feature.anchors).toHaveLength(3);
    const starts = result.feature.anchors.map(prop => prop.startTime.year);
    expect(starts).toEqual([1000, 1100, 1300]);

    const edited = result.feature.anchors[1];
    expect(edited.name).toBe("Edited");
    expect(edited.description).toBe("edited-description");
    expect(edited.endTime.equals(new TimePoint(1300))).toBe(true);

    const preservedFuture = result.feature.anchors[2];
    expect(preservedFuture.name).toBe("Future");
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("rejects end times that exceed the next future anchor", async () => {
    const past = createProperty(1000, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [past, future], "layer-1"));

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

  it("applies boundary edits when start time differs from the timeline time", async () => {
    const past = createProperty(1000, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [past, future], "layer-1"));

    const result = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(900),
        endTime: new TimePoint(1300),
        name: "Edited",
        description: "boundary-edited"
      }
    });

    expect(result.feature.anchors).toHaveLength(2);
    expect(result.feature.anchors[0].startTime.equals(new TimePoint(900))).toBe(true);
    expect(result.feature.anchors[0].endTime.equals(new TimePoint(1300))).toBe(true);
    expect(result.feature.anchors[0].name).toBe("Edited");
    expect(result.feature.anchors[0].description).toBe("boundary-edited");
    expect(result.feature.anchors[1].startTime.equals(new TimePoint(1300))).toBe(true);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("reorganizes neighboring anchors when boundary edit overlaps previous anchor", async () => {
    const older = createPropertyWithEnd(800, 1000, "Older");
    const target = createPropertyWithEnd(1000, 1300, "Target");
    const future = createProperty(1300, "Future");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [older, target, future], "layer-1"));

    const result = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(900),
        endTime: new TimePoint(1300),
        name: "Target shifted",
        description: "",
        boundaryEdit: {
          targetAnchorId: target.id,
          newStart: new TimePoint(900),
          newEnd: new TimePoint(1300)
        }
      }
    });

    expect(result.feature.anchors.map(anchor => anchor.startTime.year)).toEqual([800, 900, 1300]);
    expect(result.feature.anchors[0].endTime.equals(new TimePoint(900))).toBe(true);
    expect(result.feature.anchors[1].name).toBe("Target shifted");
    expect(result.feature.anchors[1].endTime.equals(new TimePoint(1300))).toBe(true);
    expect(result.feature.anchors[2].name).toBe("Future");
  });

  it("updates an existing anchor without creating duplicates", async () => {
    const past = createPropertyWithEnd(1000, 1300, "Past");
    const future = createProperty(1300, "Future");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [past, future], "layer-1"));

    const result = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1300),
        startTime: new TimePoint(1300),
        endTime: null,
        name: "Future Updated",
        description: "future-description"
      }
    });

    expect(result.feature.anchors).toHaveLength(2);
    expect(result.feature.anchors[1].name).toBe("Future Updated");
    expect(result.feature.anchors[1].startTime.equals(new TimePoint(1300))).toBe(true);
    const anchorsAt1300 = result.feature.anchors.filter(prop => prop.startTime.equals(new TimePoint(1300)));
    expect(anchorsAt1300).toHaveLength(1);
  });

  it("allows editing past after creating a future anchor first", async () => {
    const initial = createPropertyWithEnd(1000, 2001, "Initial");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initial], "layer-1"));

    const afterFutureEdit = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1300),
        startTime: new TimePoint(1300),
        endTime: new TimePoint(2001),
        name: "Future",
        description: ""
      }
    });

    expect(afterFutureEdit.feature.anchors).toHaveLength(2);
    expect(afterFutureEdit.feature.anchors[0].endTime.equals(new TimePoint(1300))).toBe(true);
    expect(afterFutureEdit.feature.anchors[1].startTime.equals(new TimePoint(1300))).toBe(true);

    const afterPastEdit = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1100),
        startTime: new TimePoint(1100),
        endTime: new TimePoint(1300),
        name: "Past Mid",
        description: ""
      }
    });

    expect(afterPastEdit.feature.anchors).toHaveLength(3);
    expect(afterPastEdit.feature.anchors[0].startTime.equals(new TimePoint(1000))).toBe(true);
    expect(afterPastEdit.feature.anchors[0].endTime.equals(new TimePoint(1100))).toBe(true);
    expect(afterPastEdit.feature.anchors[1].startTime.equals(new TimePoint(1100))).toBe(true);
    expect(afterPastEdit.feature.anchors[1].endTime.equals(new TimePoint(1300))).toBe(true);
    expect(afterPastEdit.feature.anchors[2].startTime.equals(new TimePoint(1300))).toBe(true);
    expect(afterPastEdit.feature.anchors[2].name).toBe("Future");
  });

  it("reproduces manual timeline checks for 1000->1300->1100 edits", async () => {
    const initial = createProperty(1000, "A");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [initial], "layer-1"));

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

    expect(afterPastEdit.feature.anchors).toHaveLength(3);
    expectNameAt(afterPastEdit.feature, 1050, "A");
    expectNameAt(afterPastEdit.feature, 1150, "C");
    expectNameAt(afterPastEdit.feature, 1299, "C");
    expectNameAt(afterPastEdit.feature, 1300, "B");
    expectNameAt(afterPastEdit.feature, 1350, "B");
  });

  it("applies resolvedAnchorsByFeature without recalculating timeline edits", async () => {
    const point1Initial = createProperty(1000, "Point1");
    const point2Initial = createProperty(1000, "Point2");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [point1Initial], "layer-1"));
    world.features.push(globalThis.createAnchoredPoint("point-2", ["v1"], [point2Initial], "layer-1"));

    const point1Resolved = createPointAnchor(1000, "Point1-Resolved");
    const point2Resolved = createPointAnchor(1000, "Point2-Resolved");

    const result = await useCase.execute("point-1", {
      propertyEdit: {
        editTime: new TimePoint(1000),
        startTime: new TimePoint(1000),
        endTime: null,
        name: "Ignored",
        description: "",
        resolvedAnchorsByFeature: {
          "point-1": [point1Resolved],
          "point-2": [point2Resolved]
        }
      }
    });

    expect(result.feature.anchors).toHaveLength(1);
    expect(result.feature.anchors[0].name).toBe("Point1-Resolved");
    expect(result.updatedFeatures.map(feature => feature.id).sort()).toEqual(["point-1", "point-2"]);
    expect(world.features.find(feature => feature.id === "point-2").anchors[0].name).toBe("Point2-Resolved");
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("rejects resolvedAnchorsByFeature that does not include edited feature", async () => {
    const point1Initial = createProperty(1000, "Point1");
    const point2Initial = createProperty(1000, "Point2");
    world.features.push(globalThis.createAnchoredPoint("point-1", ["v1"], [point1Initial], "layer-1"));
    world.features.push(globalThis.createAnchoredPoint("point-2", ["v1"], [point2Initial], "layer-1"));

    const point2Resolved = createPointAnchor(1000, "Point2-Resolved");
    await expect(
      useCase.execute("point-1", {
        propertyEdit: {
          editTime: new TimePoint(1000),
          startTime: new TimePoint(1000),
          endTime: null,
          name: "Ignored",
          description: "",
          resolvedAnchorsByFeature: {
            "point-2": [point2Resolved]
          }
        }
      })
    ).rejects.toThrow(/編集対象地物 point-1/);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("routes polygon anchors updates with conflictResolutions through conflict resolver", async () => {
    const rings = [{ id: "ring-1", vertexIds: ["v1", "v2", "v3"], ringType: "territory", parentId: null }];
    const baseAnchor = new FeatureAnchor({
      id: "anchor-poly-1000",
      timeRange: { start: new TimePoint(1000), end: null },
      property: { name: "Poly", description: "", attributes: {} },
      shape: { type: "Polygon", rings },
      placement: { layerId: "layer-1", parentId: "0", childIds: [] }
    });
    world.features.push(
      globalThis.createAnchoredPolygon("poly-1", [baseAnchor], "layer-1", "0", [], rings)
    );

    const nextAnchor = new FeatureAnchor({
      id: "anchor-poly-1000-updated",
      timeRange: { start: new TimePoint(1000), end: null },
      property: { name: "Poly Updated", description: "", attributes: {} },
      shape: { type: "Polygon", rings },
      placement: { layerId: "layer-1", parentId: "0", childIds: [] }
    });
    const conflictResolutions = {
      "polygon-overlap:poly-1::poly-2:1200:null:null": { preferFeatureId: "poly-1" }
    };
    const resolveSpy = vi.fn(() => new Set());
    const placementSpy = vi.fn();
    useCase._resolvePropertyEditConflictsOrThrow = resolveSpy;
    useCase._ensurePolygonPlacementOrRollback = placementSpy;

    const result = await useCase.execute("poly-1", {
      anchors: [nextAnchor],
      conflictResolutions
    });

    expect(result.feature.anchors).toHaveLength(1);
    expect(result.feature.anchors[0].name).toBe("Poly Updated");
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy.mock.calls[0][2]).toEqual(conflictResolutions);
    expect(placementSpy).toHaveBeenCalledTimes(1);
  });
});
