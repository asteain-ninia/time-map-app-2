// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VertexEditUseCase } from "../../src/application/usecases/feature/VertexEditUseCase.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { LayerService } from "../../src/domain/services/LayerService.js";

const createPropertyWithRange = (startTime, endTime, name = "feature") =>
  new FeatureAnchor({
    id: `anchor-${name}-${startTime.year}-${endTime ? endTime.year : "null"}`,
    timeRange: { start: startTime, end: endTime },
    property: { name, description: "", attributes: {} },
    shape: {},
    placement: {}
  });
const createProperty = (name = "feature") => createPropertyWithRange(new TimePoint(0), null, name);
const makePoint = (id, vertexId, layerId = "layer-1") =>
  globalThis.createAnchoredPoint(id, [vertexId], [createProperty(id)], layerId);
const makeLine = (id, vertexIds, layerId = "layer-1") =>
  globalThis.createAnchoredLine(id, vertexIds, [createProperty(id)], layerId);
const makeRing = (id, vertexIds, ringType = "territory", parentId = null) => ({
  id,
  vertexIds,
  ringType,
  parentId
});
const makePolygon = ({ id, rings, parentId = "0", childIds = [], layerId = "layer-1" }) =>
  globalThis.createAnchoredPolygon(id, [createProperty(id)], layerId, parentId, childIds, rings);

describe("VertexEditUseCase", () => {
  let world;
  let worldRepository;
  let geometryService;
  let layerService;
  let cleanupUnusedVertices;
  let generateId;
  let getOlderVertexId;
  let useCase;

  beforeEach(() => {
    world = {
      features: [],
      vertices: [],
      layers: [{ id: "layer-1", order: 0 }]
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
    cleanupUnusedVertices = vi.fn();
    generateId = vi.fn(() => "generated-vertex");
    getOlderVertexId = vi.fn((a, b) => a);

    useCase = new VertexEditUseCase(
      worldRepository,
      geometryService,
      cleanupUnusedVertices,
      generateId,
      getOlderVertexId,
      layerService
    );
  });

  it("deletes points and trims lines when removing vertices", async () => {
    world.vertices = [
      { id: "v-point", x: 0, y: 0 },
      { id: "v-l1", x: 1, y: 0 },
      { id: "v-l2", x: 2, y: 0 },
      { id: "v-l3", x: 3, y: 0 }
    ];
    world.features = [
      makePoint("point-1", "v-point"),
      makeLine("line-1", ["v-l1", "v-l2", "v-l3"])
    ];

    const result = await useCase.deleteVertices(["v-point", "v-l2"]);

    expect(result).toEqual({
      deletedVertexIds: ["v-point", "v-l2"],
      updatedFeatureIds: ["line-1"],
      deletedFeatureIds: ["point-1"]
    });
    expect(cleanupUnusedVertices).not.toHaveBeenCalled();
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
    const savedWorld = worldRepository.saveWorld.mock.calls[0][0];
    expect(savedWorld.features).toHaveLength(1);
    expect(savedWorld.features[0]).toBeInstanceOf(Line);
    expect(savedWorld.features[0].vertexIds).toEqual(["v-l1", "v-l3"]);
    expect(savedWorld.vertices.map((v) => v.id)).toEqual(["v-l1", "v-l3"]);
  });

  it("removes empty polygons and detaches them from their parents", async () => {
    world.vertices = [
      { id: "vp1", x: 0, y: 0 },
      { id: "vp2", x: 4, y: 0 },
      { id: "vp3", x: 4, y: 4 },
      { id: "vc1", x: 1, y: 1 },
      { id: "vc2", x: 2, y: 1 },
      { id: "vc3", x: 1, y: 2 }
    ];
    world.features = [
      makePolygon({
        id: "poly-parent",
        rings: [makeRing("parent-ring", ["vp1", "vp2", "vp3"])],
        childIds: ["poly-child"]
      }),
      makePolygon({
        id: "poly-child",
        parentId: "poly-parent",
        rings: [makeRing("child-ring", ["vc1", "vc2", "vc3"])]
      })
    ];

    const result = await useCase.deleteVertices(["vc1", "vc2", "vc3"]);

    expect(result.deletedVertexIds).toEqual(["vc1", "vc2", "vc3"]);
    expect(result.deletedFeatureIds).toEqual(["poly-child"]);
    expect(result.updatedFeatureIds).toEqual(["poly-parent"]);
    expect(world.features).toHaveLength(1);
    const [parentAfter] = world.features;
    expect(parentAfter.childIds).toEqual([]);
    expect(world.vertices.map((v) => v.id)).toEqual(["vp1", "vp2", "vp3"]);
  });

  it("deletes vertices only in the edited anchor while preserving past and future anchors", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 5, y: 0 },
      { id: "v3", x: 10, y: 0 }
    ];
    const placement = { layerId: "layer-1" };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-line-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "line-time-delete", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["v1", "v2", "v3"] },
        placement
      }),
      new FeatureAnchor({
        id: "anchor-line-2",
        timeRange: { start: t1200, end: null },
        property: { name: "line-time-delete", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["v1", "v2", "v3"] },
        placement
      })
    ];
    world.features = [
      globalThis.createAnchoredLine(
        "line-time-delete",
        ["v1", "v2", "v3"],
        [
          createPropertyWithRange(t1000, t1200, "line-time-delete"),
          createPropertyWithRange(t1200, null, "line-time-delete")
        ],
        "layer-1",
        anchors
      )
    ];
    generateId.mockReset();
    generateId.mockReturnValueOnce("anchor-line-1100");

    const result = await useCase.deleteVertices(["v2"], { editTime: t1100 });

    expect(result).toEqual({
      deletedVertexIds: ["v2"],
      updatedFeatureIds: ["line-time-delete"],
      deletedFeatureIds: []
    });
    const lineAfter = world.features.find((feature) => feature.id === "line-time-delete");
    expect(lineAfter).toBeInstanceOf(Line);
    expect(lineAfter.anchors).toHaveLength(3);
    expect(lineAfter.getVertexIdsAt(t1000)).toEqual(["v1", "v2", "v3"]);
    expect(lineAfter.getVertexIdsAt(t1100)).toEqual(["v1", "v3"]);
    expect(lineAfter.getVertexIdsAt(t1200)).toEqual(["v1", "v2", "v3"]);
    expect(world.vertices.find((vertex) => vertex.id === "v2")).toEqual({ id: "v2", x: 5, y: 0 });
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("keeps vertices referenced only by past anchors when deleting without editTime", async () => {
    const t1000 = new TimePoint(1000);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 2, y: 0 },
      { id: "v3", x: 4, y: 0 }
    ];
    const placement = { layerId: "layer-1" };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-line-past-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "line-past-only", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["v1", "v2"] },
        placement
      }),
      new FeatureAnchor({
        id: "anchor-line-past-2",
        timeRange: { start: t1200, end: null },
        property: { name: "line-past-only", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["v1", "v3"] },
        placement
      })
    ];
    world.features = [
      globalThis.createAnchoredLine(
        "line-past-only",
        ["v1", "v3"],
        [
          createPropertyWithRange(t1000, t1200, "line-past-only"),
          createPropertyWithRange(t1200, null, "line-past-only")
        ],
        "layer-1",
        anchors
      )
    ];

    const result = await useCase.deleteVertices(["v2"]);

    expect(result).toEqual({
      deletedVertexIds: ["v2"],
      updatedFeatureIds: [],
      deletedFeatureIds: []
    });
    expect(world.vertices.map((vertex) => vertex.id)).toEqual(["v1", "v2", "v3"]);
    const lineAfter = world.features.find((feature) => feature.id === "line-past-only");
    expect(lineAfter).toBeInstanceOf(Line);
    expect(lineAfter.getVertexIdsAt(t1000)).toEqual(["v1", "v2"]);
    expect(lineAfter.getVertexIdsAt(t1200)).toEqual(["v1", "v3"]);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("moves a vertex and reports affected polygons", async () => {
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 1, y: 0 },
      { id: "v3", x: 0, y: 1 }
    ];
    world.features = [
      makePolygon({
        id: "poly-1",
        rings: [makeRing("ring-1", ["v1", "v2", "v3"])]
      })
    ];

    const result = await useCase.moveVertex("v2", { x: 1, y: 1 });

    expect(result.vertex).toEqual({ id: "v2", x: 1, y: 1 });
    expect(result.affectedFeatures.map((f) => f.id)).toEqual(["poly-1"]);
    expect(world.vertices.find((v) => v.id === "v2")).toEqual({ id: "v2", x: 1, y: 1 });
    expect(geometryService.isPolygonSelfIntersecting).toHaveBeenCalled();
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("rolls back vertex movement when polygon self-intersects", async () => {
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 1, y: 0 },
      { id: "v3", x: 0, y: 1 }
    ];
    world.features = [
      makePolygon({
        id: "poly-1",
        rings: [makeRing("ring-1", ["v1", "v2", "v3"])]
      })
    ];
    geometryService.isPolygonSelfIntersecting.mockImplementationOnce(() => true);

    await expect(useCase.moveVertex("v2", { x: 2, y: 2 })).rejects.toThrow(/自己交差/);
    expect(world.vertices.find((v) => v.id === "v2")).toEqual({ id: "v2", x: 1, y: 0 });
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("slides vertex movement to avoid polygon overlap", async () => {
    world.vertices = [
      { id: "a1", x: 0, y: 0 },
      { id: "a2", x: 4, y: 0 },
      { id: "a3", x: 4, y: 4 },
      { id: "a4", x: 0, y: 4 },
      { id: "b1", x: 6, y: 0 },
      { id: "b2", x: 8, y: 0 },
      { id: "b3", x: 8, y: 2 },
      { id: "b4", x: 6, y: 2 }
    ];
    world.features = [
      makePolygon({
        id: "poly-a",
        rings: [makeRing("ring-a", ["a1", "a2", "a3", "a4"])]
      }),
      makePolygon({
        id: "poly-b",
        rings: [makeRing("ring-b", ["b1", "b2", "b3", "b4"])]
      })
    ];

    const result = await useCase.moveVertices([
      { vertexId: "b1", newPosition: { x: 1, y: 1 } },
      { vertexId: "b2", newPosition: { x: 3, y: 1 } },
      { vertexId: "b3", newPosition: { x: 3, y: 3 } },
      { vertexId: "b4", newPosition: { x: 1, y: 3 } }
    ]);

    const outerRing = ["a1", "a2", "a3", "a4"]
      .map((id) => world.vertices.find((v) => v.id === id))
      .map((v) => ({ x: v.x, y: v.y }));
    const boundaryToleranceSq = 1e-9;

    result.updatedVertices.forEach((vertex) => {
      const inside = geometryService.isPointInPolygon(vertex, outerRing, false);
      const onBoundary = geometryService.isPointOnPolygonBoundary(vertex, outerRing, boundaryToleranceSq);
      expect(inside && !onBoundary).toBe(false);
    });
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("rejects overlap when multiple polygons move at once", async () => {
    world.vertices = [
      { id: "a1", x: 0, y: 0 },
      { id: "a2", x: 4, y: 0 },
      { id: "a3", x: 4, y: 4 },
      { id: "a4", x: 0, y: 4 },
      { id: "b1", x: 6, y: 0 },
      { id: "b2", x: 8, y: 0 },
      { id: "b3", x: 8, y: 2 },
      { id: "b4", x: 6, y: 2 }
    ];
    world.features = [
      makePolygon({
        id: "poly-a",
        rings: [makeRing("ring-a", ["a1", "a2", "a3", "a4"])]
      }),
      makePolygon({
        id: "poly-b",
        rings: [makeRing("ring-b", ["b1", "b2", "b3", "b4"])]
      })
    ];

    await expect(
      useCase.moveVertices([
        { vertexId: "a1", newPosition: { x: 0, y: 0 } },
        { vertexId: "a2", newPosition: { x: 4, y: 0 } },
        { vertexId: "a3", newPosition: { x: 4, y: 4 } },
        { vertexId: "a4", newPosition: { x: 0, y: 4 } },
        { vertexId: "b1", newPosition: { x: 1, y: 1 } },
        { vertexId: "b2", newPosition: { x: 3, y: 1 } },
        { vertexId: "b3", newPosition: { x: 3, y: 3 } },
        { vertexId: "b4", newPosition: { x: 1, y: 3 } }
      ])
    ).rejects.toThrow(/重なっています/);

    expect(world.vertices.find((v) => v.id === "b1")).toEqual({ id: "b1", x: 6, y: 0 });
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("splits only the edited anchor when moving vertices with editTime", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 1, y: 0 },
      { id: "v3", x: 0, y: 1 }
    ];
    const shapeAtAnchor = {
      type: "Polygon",
      rings: [makeRing("ring-1", ["v1", "v2", "v3"])]
    };
    const placement = { layerId: "layer-1", parentId: "0", childIds: [] };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "poly-time", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      }),
      new FeatureAnchor({
        id: "anchor-2",
        timeRange: { start: t1200, end: null },
        property: { name: "poly-time", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      })
    ];
    world.features = [
      globalThis.createAnchoredPolygon(
        "poly-time",
        [
          createPropertyWithRange(t1000, t1200, "poly-time"),
          createPropertyWithRange(t1200, null, "poly-time")
        ],
        "layer-1",
        "0",
        [],
        [makeRing("ring-1", ["v1", "v2", "v3"])],
        anchors
      )
    ];
    generateId.mockReset();
    generateId.mockReturnValueOnce("v2-1100");
    generateId.mockReturnValueOnce("anchor-1100");

    const result = await useCase.moveVertices(
      [{ vertexId: "v2", newPosition: { x: 2, y: 2 } }],
      { editTime: t1100 }
    );

    expect(result.requiresWorldRefresh).toBe(true);
    expect(result.updatedVertices).toEqual([{ id: "v2-1100", x: 2, y: 2 }]);
    expect(result.historyPatch.featureChanges).toHaveLength(1);
    expect(result.historyPatch.addedVertices).toEqual([{ id: "v2-1100", x: 2, y: 2 }]);

    const polygonAfter = world.features.find((feature) => feature.id === "poly-time");
    expect(polygonAfter).toBeInstanceOf(Polygon);
    expect(polygonAfter.anchors).toHaveLength(3);

    const anchorAt1000 = polygonAfter.getAnchorAt(t1000);
    const anchorAt1100 = polygonAfter.getAnchorAt(t1100);
    const anchorAt1200 = polygonAfter.getAnchorAt(t1200);
    expect(anchorAt1000).toBeTruthy();
    expect(anchorAt1100).toBeTruthy();
    expect(anchorAt1200).toBeTruthy();

    expect(anchorAt1000.startTime.equals(t1000)).toBe(true);
    expect(anchorAt1000.endTime.equals(t1100)).toBe(true);
    expect(anchorAt1100.startTime.equals(t1100)).toBe(true);
    expect(anchorAt1100.endTime.equals(t1200)).toBe(true);
    expect(anchorAt1200.startTime.equals(t1200)).toBe(true);
    expect(anchorAt1200.endTime).toBeNull();

    expect(anchorAt1000.shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3"]);
    expect(anchorAt1100.shape.rings[0].vertexIds).toEqual(["v1", "v2-1100", "v3"]);
    expect(anchorAt1200.shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3"]);
    expect(world.vertices.find((vertex) => vertex.id === "v2")).toEqual({ id: "v2", x: 1, y: 0 });
    expect(world.vertices.find((vertex) => vertex.id === "v2-1100")).toEqual({ id: "v2-1100", x: 2, y: 2 });
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("updates an existing anchor in place when editTime matches anchor start", async () => {
    const t1000 = new TimePoint(1000);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 1, y: 0 },
      { id: "v3", x: 0, y: 1 }
    ];
    const shapeAtAnchor = {
      type: "Polygon",
      rings: [makeRing("ring-1", ["v1", "v2", "v3"])]
    };
    const placement = { layerId: "layer-1", parentId: "0", childIds: [] };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "poly-existing", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      }),
      new FeatureAnchor({
        id: "anchor-2",
        timeRange: { start: t1200, end: null },
        property: { name: "poly-existing", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      })
    ];
    world.features = [
      globalThis.createAnchoredPolygon(
        "poly-existing",
        [
          createPropertyWithRange(t1000, t1200, "poly-existing"),
          createPropertyWithRange(t1200, null, "poly-existing")
        ],
        "layer-1",
        "0",
        [],
        [makeRing("ring-1", ["v1", "v2", "v3"])],
        anchors
      )
    ];
    generateId.mockReset();
    generateId.mockReturnValueOnce("v2-1200");

    const result = await useCase.moveVertices(
      [{ vertexId: "v2", newPosition: { x: 3, y: 3 } }],
      { editTime: t1200 }
    );

    expect(result.requiresWorldRefresh).toBe(true);
    expect(result.updatedVertices).toEqual([{ id: "v2-1200", x: 3, y: 3 }]);
    const polygonAfter = world.features.find((feature) => feature.id === "poly-existing");
    expect(polygonAfter).toBeInstanceOf(Polygon);
    expect(polygonAfter.anchors).toHaveLength(2);
    expect(polygonAfter.getAnchorAt(t1000).shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3"]);
    expect(polygonAfter.getAnchorAt(t1200).shape.rings[0].vertexIds).toEqual(["v1", "v2-1200", "v3"]);
    expect(result.historyPatch.featureChanges).toHaveLength(1);
    expect(result.historyPatch.addedVertices).toEqual([{ id: "v2-1200", x: 3, y: 3 }]);
    expect(generateId).toHaveBeenCalledTimes(1);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("moves multiple vertices at editTime while keeping past and future anchors unchanged", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1300 = new TimePoint(1300);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 4, y: 0 },
      { id: "v3", x: 4, y: 4 },
      { id: "v4", x: 0, y: 4 }
    ];
    const shapeAtAnchor = {
      type: "Polygon",
      rings: [makeRing("ring-1", ["v1", "v2", "v3", "v4"])]
    };
    const placement = { layerId: "layer-1", parentId: "0", childIds: [] };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-1",
        timeRange: { start: t1000, end: t1300 },
        property: { name: "poly-multi", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      }),
      new FeatureAnchor({
        id: "anchor-2",
        timeRange: { start: t1300, end: null },
        property: { name: "poly-multi", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      })
    ];
    world.features = [
      globalThis.createAnchoredPolygon(
        "poly-multi",
        [
          createPropertyWithRange(t1000, t1300, "poly-multi"),
          createPropertyWithRange(t1300, null, "poly-multi")
        ],
        "layer-1",
        "0",
        [],
        [makeRing("ring-1", ["v1", "v2", "v3", "v4"])],
        anchors
      )
    ];
    generateId.mockReset();
    generateId.mockReturnValueOnce("v2-1100");
    generateId.mockReturnValueOnce("v3-1100");
    generateId.mockReturnValueOnce("anchor-1100");

    const result = await useCase.moveVertices(
      [
        { vertexId: "v2", newPosition: { x: 5, y: 1 } },
        { vertexId: "v3", newPosition: { x: 5, y: 5 } }
      ],
      { editTime: t1100 }
    );

    expect(result.requiresWorldRefresh).toBe(true);
    expect(result.updatedVertices).toHaveLength(2);
    expect(result.updatedVertices).toEqual(
      expect.arrayContaining([
        { id: "v2-1100", x: 5, y: 1 },
        { id: "v3-1100", x: 5, y: 5 }
      ])
    );

    const polygonAfter = world.features.find((feature) => feature.id === "poly-multi");
    expect(polygonAfter).toBeInstanceOf(Polygon);
    expect(polygonAfter.anchors).toHaveLength(3);
    expect(polygonAfter.getAnchorAt(t1000).shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3", "v4"]);
    expect(polygonAfter.getAnchorAt(t1100).shape.rings[0].vertexIds).toEqual(["v1", "v2-1100", "v3-1100", "v4"]);
    expect(polygonAfter.getAnchorAt(t1300).shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3", "v4"]);
    expect(world.vertices.find((vertex) => vertex.id === "v2")).toEqual({ id: "v2", x: 4, y: 0 });
    expect(world.vertices.find((vertex) => vertex.id === "v3")).toEqual({ id: "v3", x: 4, y: 4 });
    expect(world.vertices.find((vertex) => vertex.id === "v2-1100")).toEqual({ id: "v2-1100", x: 5, y: 1 });
    expect(world.vertices.find((vertex) => vertex.id === "v3-1100")).toEqual({ id: "v3-1100", x: 5, y: 5 });
  });

  it("returns anchor conflict error when editTime vertex move introduces overlap without resolutions", async () => {
    const t900 = new TimePoint(900);
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 2, y: 0 },
      { id: "v3", x: 0, y: 2 },
      { id: "rv1", x: 3, y: 0 },
      { id: "rv2", x: 5, y: 0 },
      { id: "rv3", x: 5, y: 2 },
      { id: "rv4", x: 3, y: 2 }
    ];
    const movePlacement = { layerId: "layer-1", parentId: "0", childIds: [] };
    const moveShape = {
      type: "Polygon",
      rings: [makeRing("ring-move", ["v1", "v2", "v3"])]
    };
    const rivalShape = {
      type: "Polygon",
      rings: [makeRing("ring-rival", ["rv1", "rv2", "rv3", "rv4"])]
    };
    const moveAnchors = [
      new FeatureAnchor({
        id: "anchor-move-1000",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "poly-move", description: "", attributes: {} },
        shape: moveShape,
        placement: movePlacement
      }),
      new FeatureAnchor({
        id: "anchor-move-1200",
        timeRange: { start: t1200, end: null },
        property: { name: "poly-move", description: "", attributes: {} },
        shape: moveShape,
        placement: movePlacement
      })
    ];
    const rivalAnchors = [
      new FeatureAnchor({
        id: "anchor-rival-900",
        timeRange: { start: t900, end: null },
        property: { name: "poly-rival", description: "", attributes: {} },
        shape: rivalShape,
        placement: movePlacement
      })
    ];
    world.features = [
      globalThis.createAnchoredPolygon(
        "poly-move",
        [
          createPropertyWithRange(t1000, t1200, "poly-move"),
          createPropertyWithRange(t1200, null, "poly-move")
        ],
        "layer-1",
        "0",
        [],
        [makeRing("ring-move", ["v1", "v2", "v3"])],
        moveAnchors
      ),
      globalThis.createAnchoredPolygon(
        "poly-rival",
        [createPropertyWithRange(t900, null, "poly-rival")],
        "layer-1",
        "0",
        [],
        [makeRing("ring-rival", ["rv1", "rv2", "rv3", "rv4"])],
        rivalAnchors
      )
    ];
    vi.spyOn(layerService, "validatePolygonHierarchy").mockImplementation(() => true);
    vi.spyOn(layerService, "isContainedInHigherLayerPolygon").mockImplementation(() => true);
    vi.spyOn(layerService, "checkExclusivity").mockImplementation((targetPolygon, polygons) => {
      if (!Array.isArray(polygons) || polygons.length <= 1) {
        return true;
      }
      const ids = polygons.map(polygon => polygon.id);
      if (!(ids.includes("poly-move") && ids.includes("poly-rival"))) {
        return true;
      }
      const activeAnchor = Array.isArray(targetPolygon?.anchors) ? targetPolygon.anchors[0] : null;
      return activeAnchor?.startTime?.year !== 1100;
    });

    await expect(
      useCase.moveVertices(
        [{ vertexId: "v2", newPosition: { x: 4, y: 1 } }],
        { editTime: t1100 }
      )
    ).rejects.toMatchObject({
      code: "FEATURE_ANCHOR_CONFLICTS"
    });
  });

  it("applies conflict resolutions for editTime vertex move and patches history for losing polygon", async () => {
    const t900 = new TimePoint(900);
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 2, y: 0 },
      { id: "v3", x: 0, y: 2 },
      { id: "rv1", x: 3, y: 0 },
      { id: "rv2", x: 5, y: 0 },
      { id: "rv3", x: 5, y: 2 },
      { id: "rv4", x: 3, y: 2 }
    ];
    const movePlacement = { layerId: "layer-1", parentId: "0", childIds: [] };
    const moveShape = {
      type: "Polygon",
      rings: [makeRing("ring-move", ["v1", "v2", "v3"])]
    };
    const rivalShape = {
      type: "Polygon",
      rings: [makeRing("ring-rival", ["rv1", "rv2", "rv3", "rv4"])]
    };
    const moveAnchors = [
      new FeatureAnchor({
        id: "anchor-move-1000",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "poly-move", description: "", attributes: {} },
        shape: moveShape,
        placement: movePlacement
      }),
      new FeatureAnchor({
        id: "anchor-move-1200",
        timeRange: { start: t1200, end: null },
        property: { name: "poly-move", description: "", attributes: {} },
        shape: moveShape,
        placement: movePlacement
      })
    ];
    const rivalAnchors = [
      new FeatureAnchor({
        id: "anchor-rival-900",
        timeRange: { start: t900, end: null },
        property: { name: "poly-rival", description: "", attributes: {} },
        shape: rivalShape,
        placement: movePlacement
      })
    ];
    world.features = [
      globalThis.createAnchoredPolygon(
        "poly-move",
        [
          createPropertyWithRange(t1000, t1200, "poly-move"),
          createPropertyWithRange(t1200, null, "poly-move")
        ],
        "layer-1",
        "0",
        [],
        [makeRing("ring-move", ["v1", "v2", "v3"])],
        moveAnchors
      ),
      globalThis.createAnchoredPolygon(
        "poly-rival",
        [createPropertyWithRange(t900, null, "poly-rival")],
        "layer-1",
        "0",
        [],
        [makeRing("ring-rival", ["rv1", "rv2", "rv3", "rv4"])],
        rivalAnchors
      )
    ];
    vi.spyOn(layerService, "validatePolygonHierarchy").mockImplementation(() => true);
    vi.spyOn(layerService, "isContainedInHigherLayerPolygon").mockImplementation(() => true);
    vi.spyOn(layerService, "checkExclusivity").mockImplementation((targetPolygon, polygons) => {
      if (!Array.isArray(polygons) || polygons.length <= 1) {
        return true;
      }
      const ids = polygons.map(polygon => polygon.id);
      if (!(ids.includes("poly-move") && ids.includes("poly-rival"))) {
        return true;
      }
      const activeAnchor = Array.isArray(targetPolygon?.anchors) ? targetPolygon.anchors[0] : null;
      return activeAnchor?.startTime?.year !== 1100;
    });
    generateId.mockReset();
    generateId.mockReturnValueOnce("v2-1100");
    generateId.mockReturnValueOnce("anchor-1100");

    const result = await useCase.moveVertices(
      [{ vertexId: "v2", newPosition: { x: 4, y: 1 } }],
      {
        editTime: t1100,
        conflictResolutions: {
          "polygon-overlap:poly-move::poly-rival:1100:null:null": { preferFeatureId: "poly-move" }
        }
      }
    );

    expect(result.requiresWorldRefresh).toBe(true);
    expect(result.historyPatch.featureChanges.map(change => change.featureId)).toEqual(
      expect.arrayContaining(["poly-move", "poly-rival"])
    );
    const rivalAfter = world.features.find(feature => feature.id === "poly-rival");
    expect(rivalAfter.anchors).toHaveLength(1);
    expect(rivalAfter.anchors[0].startTime.year).toBe(900);
    expect(rivalAfter.anchors[0].endTime.equals(t1100)).toBe(true);
  });

  it("moves a point at editTime without mutating other anchors", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    world.vertices = [{ id: "vp", x: 1, y: 1 }];
    const placement = { layerId: "layer-1" };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-point-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "point-time", description: "", attributes: {} },
        shape: { type: "Point", vertexId: "vp" },
        placement
      }),
      new FeatureAnchor({
        id: "anchor-point-2",
        timeRange: { start: t1200, end: null },
        property: { name: "point-time", description: "", attributes: {} },
        shape: { type: "Point", vertexId: "vp" },
        placement
      })
    ];
    world.features = [
      globalThis.createAnchoredPoint(
        "point-time",
        ["vp"],
        [
          createPropertyWithRange(t1000, t1200, "point-time"),
          createPropertyWithRange(t1200, null, "point-time")
        ],
        "layer-1",
        anchors
      )
    ];
    generateId.mockReset();
    generateId.mockReturnValueOnce("vp-1100");
    generateId.mockReturnValueOnce("anchor-point-1100");

    const result = await useCase.moveVertex("vp", { x: 9, y: 9 }, { editTime: t1100 });

    expect(result.requiresWorldRefresh).toBe(true);
    expect(result.vertex).toEqual({ id: "vp-1100", x: 9, y: 9 });
    const pointAfter = world.features.find((feature) => feature.id === "point-time");
    expect(pointAfter).toBeInstanceOf(Point);
    expect(pointAfter.anchors).toHaveLength(3);
    expect(pointAfter.getVertexIdAt(t1000)).toBe("vp");
    expect(pointAfter.getVertexIdAt(t1100)).toBe("vp-1100");
    expect(pointAfter.getVertexIdAt(t1200)).toBe("vp");
    expect(world.vertices.find((vertex) => vertex.id === "vp")).toEqual({ id: "vp", x: 1, y: 1 });
    expect(world.vertices.find((vertex) => vertex.id === "vp-1100")).toEqual({ id: "vp-1100", x: 9, y: 9 });
  });

  it("moves a line at editTime without mutating other anchors", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "vl1", x: 0, y: 0 },
      { id: "vl2", x: 5, y: 0 },
      { id: "vl3", x: 10, y: 0 }
    ];
    const placement = { layerId: "layer-1" };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-line-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "line-time", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["vl1", "vl2", "vl3"] },
        placement
      }),
      new FeatureAnchor({
        id: "anchor-line-2",
        timeRange: { start: t1200, end: null },
        property: { name: "line-time", description: "", attributes: {} },
        shape: { type: "LineString", vertexIds: ["vl1", "vl2", "vl3"] },
        placement
      })
    ];
    world.features = [
      globalThis.createAnchoredLine(
        "line-time",
        ["vl1", "vl2", "vl3"],
        [
          createPropertyWithRange(t1000, t1200, "line-time"),
          createPropertyWithRange(t1200, null, "line-time")
        ],
        "layer-1",
        anchors
      )
    ];
    generateId.mockReset();
    generateId.mockReturnValueOnce("vl2-1100");
    generateId.mockReturnValueOnce("anchor-line-1100");

    const result = await useCase.moveVertices(
      [{ vertexId: "vl2", newPosition: { x: 6, y: 2 } }],
      { editTime: t1100 }
    );

    expect(result.requiresWorldRefresh).toBe(true);
    expect(result.updatedVertices).toEqual([{ id: "vl2-1100", x: 6, y: 2 }]);
    const lineAfter = world.features.find((feature) => feature.id === "line-time");
    expect(lineAfter).toBeInstanceOf(Line);
    expect(lineAfter.anchors).toHaveLength(3);
    expect(lineAfter.getVertexIdsAt(t1000)).toEqual(["vl1", "vl2", "vl3"]);
    expect(lineAfter.getVertexIdsAt(t1100)).toEqual(["vl1", "vl2-1100", "vl3"]);
    expect(lineAfter.getVertexIdsAt(t1200)).toEqual(["vl1", "vl2", "vl3"]);
    expect(world.vertices.find((vertex) => vertex.id === "vl2")).toEqual({ id: "vl2", x: 5, y: 0 });
    expect(world.vertices.find((vertex) => vertex.id === "vl2-1100")).toEqual({ id: "vl2-1100", x: 6, y: 2 });
  });

  it("keeps world unchanged when editTime movement fails self-intersection validation", async () => {
    const t1000 = new TimePoint(1000);
    const t1100 = new TimePoint(1100);
    const t1200 = new TimePoint(1200);
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 1, y: 0 },
      { id: "v3", x: 0, y: 1 }
    ];
    const shapeAtAnchor = {
      type: "Polygon",
      rings: [makeRing("ring-1", ["v1", "v2", "v3"])]
    };
    const placement = { layerId: "layer-1", parentId: "0", childIds: [] };
    const anchors = [
      new FeatureAnchor({
        id: "anchor-1",
        timeRange: { start: t1000, end: t1200 },
        property: { name: "poly-fail", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      }),
      new FeatureAnchor({
        id: "anchor-2",
        timeRange: { start: t1200, end: null },
        property: { name: "poly-fail", description: "", attributes: {} },
        shape: shapeAtAnchor,
        placement
      })
    ];
    const originalFeature = globalThis.createAnchoredPolygon(
      "poly-fail",
      [
        createPropertyWithRange(t1000, t1200, "poly-fail"),
        createPropertyWithRange(t1200, null, "poly-fail")
      ],
      "layer-1",
      "0",
      [],
      [makeRing("ring-1", ["v1", "v2", "v3"])],
      anchors
    );
    world.features = [originalFeature];
    geometryService.isPolygonSelfIntersecting.mockImplementationOnce(() => true);
    generateId.mockReset();
    generateId.mockReturnValueOnce("v2-1100");
    generateId.mockReturnValueOnce("anchor-1100");

    await expect(
      useCase.moveVertices([{ vertexId: "v2", newPosition: { x: 2, y: 2 } }], { editTime: t1100 })
    ).rejects.toThrow(/自己交差/);

    const polygonAfter = world.features.find((feature) => feature.id === "poly-fail");
    expect(polygonAfter).toBe(originalFeature);
    expect(polygonAfter.anchors).toHaveLength(2);
    expect(polygonAfter.getAnchorAt(t1000).shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3"]);
    expect(polygonAfter.getAnchorAt(t1200).shape.rings[0].vertexIds).toEqual(["v1", "v2", "v3"]);
    expect(world.vertices).toEqual([
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 1, y: 0 },
      { id: "v3", x: 0, y: 1 }
    ]);
    expect(worldRepository.saveWorld).not.toHaveBeenCalled();
  });

  it("merges vertices and updates dependent features", async () => {
    world.vertices = [
      { id: "v-keep", x: 0, y: 0 },
      { id: "v-remove", x: 0.5, y: 0.5 },
      { id: "v-tail", x: 2, y: 0 },
      { id: "v-b", x: 0, y: 2 },
      { id: "v-c", x: -1, y: 1 }
    ];
    world.features = [
      makeLine("line-1", ["v-keep", "v-remove", "v-tail"]),
      makePolygon({
        id: "poly-1",
        rings: [makeRing("poly-ring", ["v-remove", "v-b", "v-c"])]
      })
    ];
    getOlderVertexId.mockImplementation((a, b) => a);

    const result = await useCase.shareVertices("v-keep", "v-remove");

    expect(result.keptVertex).toEqual({ id: "v-keep", x: 0, y: 0 });
    expect(result.removedVertex).toEqual({ id: "v-remove", x: 0.5, y: 0.5 });
    expect(result.affectedFeatures.map((f) => f.id).sort()).toEqual(["line-1", "poly-1"]);
    const lineAfter = world.features.find((f) => f.id === "line-1");
    expect(lineAfter.vertexIds).toEqual(["v-keep", "v-keep", "v-tail"]);
    const polygonAfter = world.features.find((f) => f.id === "poly-1");
    expect(polygonAfter.rings[0].vertexIds).toEqual(["v-keep", "v-b", "v-c"]);
    expect(world.vertices.map((v) => v.id)).not.toContain("v-remove");
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("keeps the preferred vertex when sharing", async () => {
    world.vertices = [
      { id: "v-old", x: 0, y: 0 },
      { id: "v-new", x: 5, y: 5 },
      { id: "v-tail", x: 2, y: 0 }
    ];
    world.features = [
      makeLine("line-1", ["v-old", "v-tail"]),
      makeLine("line-2", ["v-new", "v-tail"])
    ];
    getOlderVertexId.mockImplementation(() => "v-old");

    const result = await useCase.shareVertices("v-old", "v-new", {
      preferredKeptVertexId: "v-new"
    });

    expect(result.keptVertex).toEqual({ id: "v-new", x: 5, y: 5 });
    expect(result.removedVertex).toEqual({ id: "v-old", x: 0, y: 0 });
    const lineAfter = world.features.find((f) => f.id === "line-1");
    expect(lineAfter.vertexIds).toEqual(["v-new", "v-tail"]);
    const lineNew = world.features.find((f) => f.id === "line-2");
    expect(lineNew.vertexIds).toEqual(["v-new", "v-tail"]);
    expect(world.vertices.map((v) => v.id)).not.toContain("v-old");
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("duplicates a shared vertex for the specified feature", async () => {
    world.vertices = [
      { id: "v-other", x: 0, y: 0 },
      { id: "v-other-2", x: 2, y: 0 },
      { id: "v-shared", x: 1, y: 1 }
    ];
    world.features = [
      makeLine("line-1", ["v-other", "v-shared"]),
      makeLine("line-2", ["v-other-2", "v-shared"])
    ];
    generateId.mockReturnValueOnce("v-new");

    const result = await useCase.unlinkSharedVertex("v-shared", "line-1");

    expect(result.newVertex).toEqual({ id: "v-new", x: 1, y: 1 });
    const updatedLine = world.features.find((f) => f.id === "line-1");
    expect(updatedLine.vertexIds).toEqual(["v-other", "v-new"]);
    const otherLine = world.features.find((f) => f.id === "line-2");
    expect(otherLine.vertexIds).toEqual(["v-other-2", "v-shared"]);
    expect(world.vertices.map((v) => v.id)).toEqual(["v-other", "v-other-2", "v-shared", "v-new"]);
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });

  it("inserts a new vertex into a polygon edge", async () => {
    world.vertices = [
      { id: "v1", x: 0, y: 0 },
      { id: "v2", x: 2, y: 0 },
      { id: "v3", x: 0, y: 2 }
    ];
    world.features = [
      makePolygon({
        id: "poly-1",
        rings: [makeRing("ring-1", ["v1", "v2", "v3"])]
      })
    ];
    generateId.mockReturnValueOnce("v-new-edge");

    const result = await useCase.addVertexToFeatureEdge(
      "poly-1",
      "v1",
      "v2",
      { x: 1, y: 0 },
      "ring-1"
    );

    expect(result.newVertex).toBeInstanceOf(Vertex);
    expect(result.newVertex.id).toBe("v-new-edge");
    const polygonAfter = world.features.find((f) => f.id === "poly-1");
    expect(polygonAfter.rings[0].vertexIds).toEqual(["v1", "v-new-edge", "v2", "v3"]);
    expect(world.vertices.map((v) => v.id)).toContain("v-new-edge");
    expect(worldRepository.saveWorld).toHaveBeenCalledTimes(1);
  });
});
