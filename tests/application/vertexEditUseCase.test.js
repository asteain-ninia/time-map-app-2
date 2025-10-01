// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VertexEditUseCase } from "../../src/application/usecases/feature/VertexEditUseCase.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { Vertex } from "../../src/domain/entities/Vertex.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { LayerService } from "../../src/domain/services/LayerService.js";

const createProperty = (name = "feature") => new Property(new TimePoint(0), name, "", {});
const makePoint = (id, vertexId, layerId = "layer-1") =>
  new Point(id, [vertexId], [createProperty(id)], layerId);
const makeLine = (id, vertexIds, layerId = "layer-1") =>
  new Line(id, vertexIds, [createProperty(id)], layerId);
const makeRing = (id, vertexIds, ringType = "territory", parentId = null) => ({
  id,
  vertexIds,
  ringType,
  parentId
});
const makePolygon = ({ id, rings, parentId = "0", childIds = [], layerId = "layer-1" }) =>
  new Polygon(id, [createProperty(id)], layerId, parentId, childIds, rings);

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
    expect(cleanupUnusedVertices).toHaveBeenCalledWith(world, ["v-point", "v-l2"]);
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

  it("rejects vertex movement that introduces polygon overlap", async () => {
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
        { vertexId: "b1", newPosition: { x: 1, y: 1 } },
        { vertexId: "b2", newPosition: { x: 3, y: 1 } },
        { vertexId: "b3", newPosition: { x: 3, y: 3 } },
        { vertexId: "b4", newPosition: { x: 1, y: 3 } }
      ])
    ).rejects.toThrow(/重なっています/);

    expect(world.vertices.find((v) => v.id === "b1")).toEqual({ id: "b1", x: 6, y: 0 });
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

  it("duplicates a shared vertex for the specified feature", async () => {
    world.vertices = [
      { id: "v-other", x: 0, y: 0 },
      { id: "v-shared", x: 1, y: 1 }
    ];
    world.features = [
      makeLine("line-1", ["v-other", "v-shared"])
    ];
    generateId.mockReturnValueOnce("v-new");

    const result = await useCase.unlinkSharedVertex("v-shared", "line-1");

    expect(result.newVertex).toEqual({ id: "v-new", x: 1, y: 1 });
    const updatedLine = world.features.find((f) => f.id === "line-1");
    expect(updatedLine.vertexIds).toEqual(["v-other", "v-new"]);
    expect(world.vertices.map((v) => v.id)).toEqual(["v-other", "v-shared", "v-new"]);
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
