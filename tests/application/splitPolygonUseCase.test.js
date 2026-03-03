import { describe, expect, it } from "vitest";
import { SplitPolygonUseCase } from "../../src/application/usecases/feature/SplitPolygonUseCase.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";
import { buildPolygonSplitPlan } from "../../src/domain/services/PolygonSplitService.js";

class InMemoryWorldRepository {
  constructor(world) {
    this._world = world;
  }

  async getWorld() {
    return this._world;
  }

  async saveWorld(world) {
    this._world = world;
  }
}

const createIdGenerator = () => {
  const counters = new Map();
  return (type) => {
    const next = (counters.get(type) ?? 0) + 1;
    counters.set(type, next);
    return `${type}-${next}`;
  };
};

const createLayerServiceStub = () => ({
  validatePolygonHierarchy: () => true,
  isContainedInHigherLayerPolygon: () => true,
  checkExclusivity: () => true
});

const createConflictLayerServiceStub = () => {
  const toBounds = (polygon, verticesMap) => {
    const ring = (polygon?.rings || []).find(candidate => candidate.ringType === "territory");
    if (!ring || !Array.isArray(ring.vertexIds) || ring.vertexIds.length < 3) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const vertexId of ring.vertexIds) {
      const vertex = verticesMap.get(vertexId);
      if (!vertex) {
        return null;
      }
      minX = Math.min(minX, vertex.x);
      minY = Math.min(minY, vertex.y);
      maxX = Math.max(maxX, vertex.x);
      maxY = Math.max(maxY, vertex.y);
    }
    return { minX, minY, maxX, maxY };
  };

  const hasPositiveAreaOverlap = (polygonA, polygonB, vertices) => {
    const verticesMap = new Map((vertices || []).map(vertex => [vertex.id, vertex]));
    const boundsA = toBounds(polygonA, verticesMap);
    const boundsB = toBounds(polygonB, verticesMap);
    if (!boundsA || !boundsB) {
      return false;
    }
    const overlapWidth = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX);
    const overlapHeight = Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY);
    return overlapWidth > 0 && overlapHeight > 0;
  };

  return {
    validatePolygonHierarchy: () => true,
    isContainedInHigherLayerPolygon: () => true,
    checkExclusivity: (targetPolygon, layerPolygons, vertices) => {
      if (!Array.isArray(layerPolygons) || layerPolygons.length <= 1) {
        return true;
      }
      for (const candidate of layerPolygons) {
        if (!candidate || candidate.id === targetPolygon?.id) {
          continue;
        }
        if (hasPositiveAreaOverlap(targetPolygon, candidate, vertices)) {
          return false;
        }
      }
      return true;
    }
  };
};

const createGeometryServiceStub = () => {
  const geometryService = new GeometryService();
  geometryService.isPolygonSelfIntersecting = () => false;
  return geometryService;
};

const cloneRing = (ring) => ({
  id: ring.id,
  vertexIds: [...ring.vertexIds],
  ringType: ring.ringType,
  parentId: ring.parentId ?? null
});

const createAnchor = ({ id, startYear, endYear = null, name, vertexIds = [], childIds = [], rings = null }) => {
  const start = new TimePoint(startYear);
  const end = endYear === null ? null : new TimePoint(endYear);
  return new FeatureAnchor({
    id,
    timeRange: { start, end },
    property: { name, description: "", attributes: {} },
    shape: {
      type: "Polygon",
      rings: Array.isArray(rings) && rings.length > 0
        ? rings.map(ring => cloneRing(ring))
        : [
            {
              id: `ring-${id}`,
              vertexIds: [...vertexIds],
              ringType: "territory",
              parentId: null
            }
          ]
    },
    placement: {
      layerId: "layer-0",
      parentId: "0",
      childIds: [...childIds]
    }
  });
};

const createSplitPlan = () => ({
  polygons: [
    {
      rings: [
        {
          ringType: "territory",
          parentIndex: null,
          points: [
            { x: 0, y: 0, sourceVertexId: "v1" },
            { x: 5, y: 0, key: "split-a" },
            { x: 5, y: 10, key: "split-b" },
            { x: 0, y: 10, sourceVertexId: "v4" }
          ]
        }
      ]
    },
    {
      rings: [
        {
          ringType: "territory",
          parentIndex: null,
          points: [
            { x: 5, y: 0, key: "split-a" },
            { x: 10, y: 0, sourceVertexId: "v2" },
            { x: 10, y: 10, sourceVertexId: "v3" },
            { x: 5, y: 10, key: "split-b" }
          ]
        }
      ]
    }
  ]
});

const createNewAnchorDraft = (name = "Split-Child", end = null) =>
  new FeatureAnchor({
    id: "anchor-draft",
    timeRange: { start: new TimePoint(0), end },
    property: { name, description: "", attributes: {} },
    shape: {},
    placement: {}
  });

const createWorldWithAnchoredPolygon = (anchors) => ({
  features: [
    globalThis.createAnchoredPolygon(
      "poly-1",
      [],
      "layer-0",
      "0",
      [],
      [
        {
          id: "ring-latest",
          vertexIds: ["v5", "v6", "v7", "v8"],
          ringType: "territory",
          parentId: null
        }
      ],
      anchors
    )
  ],
  vertices: [
    { id: "v1", x: 0, y: 0 },
    { id: "v2", x: 10, y: 0 },
    { id: "v3", x: 10, y: 10 },
    { id: "v4", x: 0, y: 10 },
    { id: "v5", x: -2, y: -2 },
    { id: "v6", x: 12, y: -2 },
    { id: "v7", x: 12, y: 12 },
    { id: "v8", x: -2, y: 12 }
  ],
  layers: [{ id: "layer-0", name: "Base", order: 0, visible: true, opacity: 1 }],
  metadata: { settings: { sliderMin: 0, sliderMax: 4000 } }
});

const createWorldWithCustomAnchoredPolygon = (anchors, vertices, latestRings) => ({
  features: [
    globalThis.createAnchoredPolygon(
      "poly-1",
      [],
      "layer-0",
      "0",
      [],
      latestRings,
      anchors
    )
  ],
  vertices: vertices.map(vertex => ({ ...vertex })),
  layers: [{ id: "layer-0", name: "Base", order: 0, visible: true, opacity: 1 }],
  metadata: { settings: { sliderMin: 0, sliderMax: 4000 } }
});

const calculatePolygonAreaAt = (polygon, timePoint, world, geometryService = new GeometryService()) => {
  const verticesMap = new Map((world.vertices || []).map(vertex => [vertex.id, vertex]));
  return polygon.getRingsAt(timePoint).reduce((total, ring) => {
    const points = ring.vertexIds.map((vertexId) => {
      const vertex = verticesMap.get(vertexId);
      if (!vertex) {
        throw new Error(`Vertex not found: ${vertexId}`);
      }
      return { x: vertex.x, y: vertex.y };
    });
    const area = geometryService.calculatePolygonArea(points);
    return total + (ring.ringType === "territory" ? area : -area);
  }, 0);
};

const createWorldWithConflictRival = (anchors) => ({
  features: [
    globalThis.createAnchoredPolygon(
      "poly-1",
      [],
      "layer-0",
      "0",
      [],
      [
        {
          id: "ring-latest",
          vertexIds: ["v5", "v6", "v7", "v8"],
          ringType: "territory",
          parentId: null
        }
      ],
      anchors
    ),
    globalThis.createAnchoredPolygon(
      "poly-rival",
      [],
      "layer-0",
      "0",
      [],
      [
        {
          id: "ring-rival",
          vertexIds: ["rv1", "rv2", "rv3", "rv4"],
          ringType: "territory",
          parentId: null
        }
      ],
        [
          createAnchor({
            id: "anchor-rival-1500",
            startYear: 1500,
            endYear: null,
            name: "Rival",
            vertexIds: ["rv1", "rv2", "rv3", "rv4"]
          })
      ]
    )
  ],
  vertices: [
    { id: "v1", x: 0, y: 0 },
    { id: "v2", x: 10, y: 0 },
    { id: "v3", x: 10, y: 10 },
    { id: "v4", x: 0, y: 10 },
    { id: "v5", x: -2, y: -2 },
    { id: "v6", x: 12, y: -2 },
    { id: "v7", x: 12, y: 12 },
    { id: "v8", x: -2, y: 12 },
    { id: "rv1", x: 6, y: 0 },
    { id: "rv2", x: 12, y: 0 },
    { id: "rv3", x: 12, y: 10 },
    { id: "rv4", x: 6, y: 10 }
  ],
  layers: [{ id: "layer-0", name: "Base", order: 0, visible: true, opacity: 1 }],
  metadata: { settings: { sliderMin: 0, sliderMax: 4000 } }
});

describe("SplitPolygonUseCase", () => {
  it("rejects split when editTime is not a TimePoint", async () => {
    const anchors = [
      createAnchor({ id: "anchor-1000", startYear: 1000, endYear: null, name: "Base", vertexIds: ["v1", "v2", "v3", "v4"] })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithAnchoredPolygon(anchors));
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );
    const newAnchor = createNewAnchorDraft();

    await expect(
      useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, 1500)
    ).rejects.toThrow(/TimePoint/);
  });

  it("rejects split when polygon does not exist at editTime", async () => {
    const anchors = [
      createAnchor({ id: "anchor-1000", startYear: 1000, endYear: 1200, name: "Past", vertexIds: ["v1", "v2", "v3", "v4"] })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithAnchoredPolygon(anchors));
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );
    const newAnchor = createNewAnchorDraft();

    await expect(
      useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, new TimePoint(1300))
    ).rejects.toThrow(/存在しない面情報/);
  });

  it("judges child polygons at editTime instead of the latest anchor", async () => {
    const anchors = [
      createAnchor({
        id: "anchor-1000",
        startYear: 1000,
        endYear: 2000,
        name: "Past",
        vertexIds: ["v1", "v2", "v3", "v4"],
        childIds: []
      }),
      createAnchor({
        id: "anchor-2000",
        startYear: 2000,
        endYear: null,
        name: "Future",
        vertexIds: ["v5", "v6", "v7", "v8"],
        childIds: ["child-1"]
      })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithAnchoredPolygon(anchors));
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );
    const newAnchor = createNewAnchorDraft();

    const result = await useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, new TimePoint(1500));

    expect(result.updatedPolygon.anchors.map(anchor => anchor.startTime.year)).toEqual([1000, 1500, 2000]);
    expect(result.newPolygon.anchors[0].startTime.year).toBe(1500);
  });

  it("splits only edit-time anchor and keeps future anchors unchanged", async () => {
    const anchors = [
      createAnchor({ id: "anchor-1000", startYear: 1000, endYear: 2000, name: "Past", vertexIds: ["v1", "v2", "v3", "v4"] }),
      createAnchor({ id: "anchor-2000", startYear: 2000, endYear: null, name: "Future", vertexIds: ["v5", "v6", "v7", "v8"] })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithAnchoredPolygon(anchors));
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );

    const editTime = new TimePoint(1500);
    const newAnchor = createNewAnchorDraft();
    const result = await useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, editTime);

    expect(result.updatedPolygon.anchors.map(anchor => anchor.startTime.year)).toEqual([1000, 1500, 2000]);
    expect(result.updatedPolygon.anchors[0].endTime.year).toBe(1500);
    expect(result.updatedPolygon.anchors[1].endTime.year).toBe(2000);
    expect(result.updatedPolygon.getRingsAt(new TimePoint(2100))[0].vertexIds).toEqual(["v5", "v6", "v7", "v8"]);
    expect(result.updatedPolygon.getRingsAt(editTime)[0].vertexIds).toEqual(["v1", "vertex-1", "vertex-2", "v4"]);

    expect(result.newPolygon.anchors).toHaveLength(1);
    expect(result.newPolygon.anchors[0].startTime.year).toBe(1500);
    expect(result.newPolygon.anchors[0].endTime.year).toBe(2000);

    expect(result.addedVerticesData).toHaveLength(2);
    expect(result.addedVerticesData.map(vertex => vertex.id)).toEqual(["vertex-1", "vertex-2"]);
  });

  it("rejects split when the polygon has child polygons at editTime", async () => {
    const anchors = [
      createAnchor({
        id: "anchor-1000",
        startYear: 1000,
        endYear: 2000,
        name: "Past",
        vertexIds: ["v1", "v2", "v3", "v4"],
        childIds: ["child-1"]
      }),
      createAnchor({
        id: "anchor-2000",
        startYear: 2000,
        endYear: null,
        name: "Future",
        vertexIds: ["v5", "v6", "v7", "v8"],
        childIds: []
      })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithAnchoredPolygon(anchors));
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );
    const newAnchor = createNewAnchorDraft();

    await expect(
      useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, new TimePoint(1500))
    ).rejects.toThrow(/下位領域を持つ面情報は分割できません/);
  });

  it("splits a polygon with a hole and preserves the filled area at editTime", async () => {
    const anchors = [
      createAnchor({
        id: "anchor-1000",
        startYear: 1000,
        endYear: 2000,
        name: "Past",
        rings: [
          {
            id: "ring-outer-1000",
            vertexIds: ["v1", "v2", "v3", "v4"],
            ringType: "territory",
            parentId: null
          },
          {
            id: "ring-hole-1000",
            vertexIds: ["h1", "h2", "h3", "h4"],
            ringType: "hole",
            parentId: "ring-outer-1000"
          }
        ]
      }),
      createAnchor({
        id: "anchor-2000",
        startYear: 2000,
        endYear: null,
        name: "Future",
        rings: [
          {
            id: "ring-future",
            vertexIds: ["f1", "f2", "f3", "f4"],
            ringType: "territory",
            parentId: null
          }
        ]
      })
    ];
    const world = createWorldWithCustomAnchoredPolygon(
      anchors,
      [
        { id: "v1", x: 0, y: 0 },
        { id: "v2", x: 10, y: 0 },
        { id: "v3", x: 10, y: 10 },
        { id: "v4", x: 0, y: 10 },
        { id: "h1", x: 3, y: 3 },
        { id: "h2", x: 7, y: 3 },
        { id: "h3", x: 7, y: 7 },
        { id: "h4", x: 3, y: 7 },
        { id: "f1", x: 20, y: 0 },
        { id: "f2", x: 30, y: 0 },
        { id: "f3", x: 30, y: 10 },
        { id: "f4", x: 20, y: 10 }
      ],
      [
        {
          id: "ring-future",
          vertexIds: ["f1", "f2", "f3", "f4"],
          ringType: "territory",
          parentId: null
        }
      ]
    );
    const worldRepository = new InMemoryWorldRepository(world);
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );
    const editTime = new TimePoint(1500);
    const polygon = world.features.find((feature) => feature.id === "poly-1");
    const splitPlan = buildPolygonSplitPlan({
      rings: polygon.getRingsAt(editTime),
      verticesMap: new Map(world.vertices.map((vertex) => [vertex.id, { x: vertex.x, y: vertex.y }])),
      cutLinePoints: [
        { x: -1, y: 5 },
        { x: 11, y: 5 }
      ],
      geometryService: new GeometryService()
    });

    const result = await useCase.execute("poly-1", splitPlan, 0, createNewAnchorDraft(), editTime);

    const worldAfter = await worldRepository.getWorld();
    const updatedPolygon = worldAfter.features.find((feature) => feature.id === "poly-1");
    const newPolygon = worldAfter.features.find((feature) => feature.id === result.newPolygon.id);

    expect(updatedPolygon.anchors.map((anchor) => anchor.startTime.year)).toEqual([1000, 1500, 2000]);
    expect(updatedPolygon.getRingsAt(new TimePoint(2100))[0].vertexIds).toEqual(["f1", "f2", "f3", "f4"]);
    expect(newPolygon.anchors[0].startTime.year).toBe(1500);
    expect(newPolygon.anchors[0].endTime.year).toBe(2000);
    expect(calculatePolygonAreaAt(updatedPolygon, editTime, worldAfter) + calculatePolygonAreaAt(newPolygon, editTime, worldAfter))
      .toBeCloseTo(84, 6);
    expect(updatedPolygon.getRingsAt(editTime).some((ring) => ring.ringType === "hole")).toBe(false);
    expect(newPolygon.getRingsAt(editTime).some((ring) => ring.ringType === "hole")).toBe(false);
  });

  it("updates existing exact-time anchor without rewriting other anchors", async () => {
    const anchors = [
      createAnchor({ id: "anchor-1000", startYear: 1000, endYear: 1500, name: "Past", vertexIds: ["v1", "v2", "v3", "v4"] }),
      createAnchor({ id: "anchor-1500", startYear: 1500, endYear: 2000, name: "Middle", vertexIds: ["v1", "v2", "v3", "v4"] }),
      createAnchor({ id: "anchor-2000", startYear: 2000, endYear: null, name: "Future", vertexIds: ["v5", "v6", "v7", "v8"] })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithAnchoredPolygon(anchors));
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );

    const editTime = new TimePoint(1500);
    const newAnchor = createNewAnchorDraft();
    const result = await useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, editTime);

    expect(result.updatedPolygon.anchors.map(anchor => anchor.startTime.year)).toEqual([1000, 1500, 2000]);
    expect(result.updatedPolygon.anchors[0].endTime.year).toBe(1500);
    expect(result.updatedPolygon.anchors[1].endTime.year).toBe(2000);
    expect(result.updatedPolygon.getRingsAt(editTime)[0].vertexIds).toEqual(["v1", "vertex-1", "vertex-2", "v4"]);
    expect(result.updatedPolygon.getRingsAt(new TimePoint(2100))[0].vertexIds).toEqual(["v5", "v6", "v7", "v8"]);
  });

  it("clamps new polygon endTime to the nearest future anchor start", async () => {
    const anchors = [
      createAnchor({ id: "anchor-1000", startYear: 1000, endYear: 1800, name: "Past", vertexIds: ["v1", "v2", "v3", "v4"] }),
      createAnchor({ id: "anchor-1800", startYear: 1800, endYear: 2000, name: "Middle", vertexIds: ["v1", "v2", "v3", "v4"] }),
      createAnchor({ id: "anchor-2000", startYear: 2000, endYear: null, name: "Future", vertexIds: ["v5", "v6", "v7", "v8"] })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithAnchoredPolygon(anchors));
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      createGeometryServiceStub(),
      createLayerServiceStub(),
      createIdGenerator()
    );

    const editTime = new TimePoint(1500);
    const newAnchor = createNewAnchorDraft("Split-Child", new TimePoint(2500));

    const result = await useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, editTime);
    expect(result.updatedPolygon.getAnchorAt(editTime).endTime.year).toBe(1800);
    expect(result.newPolygon.anchors[0].endTime.year).toBe(1800);
  });

  it("returns conflict error when split introduces overlap without resolutions", async () => {
    const anchors = [
      createAnchor({ id: "anchor-1000", startYear: 1000, endYear: null, name: "Base", vertexIds: ["v1", "v2", "v3", "v4"] })
    ];
    const worldRepository = new InMemoryWorldRepository(createWorldWithConflictRival(anchors));
    const geometryService = createGeometryServiceStub();
    const useCase = new SplitPolygonUseCase(
      worldRepository,
      geometryService,
      createConflictLayerServiceStub(),
      createIdGenerator()
    );
    const newAnchor = createNewAnchorDraft();

    await expect(
      useCase.execute("poly-1", createSplitPlan(), 0, newAnchor, new TimePoint(1500))
    ).rejects.toMatchObject({
      code: "FEATURE_ANCHOR_CONFLICTS"
    });
  });

  it("applies provided conflict resolutions and clips losing polygon shape at conflict time", async () => {
    const anchors = [
      createAnchor({ id: "anchor-1000", startYear: 1000, endYear: null, name: "Base", vertexIds: ["v1", "v2", "v3", "v4"] })
    ];

    const firstRepository = new InMemoryWorldRepository(createWorldWithConflictRival(anchors));
    const firstGeometryService = createGeometryServiceStub();
    const firstUseCase = new SplitPolygonUseCase(
      firstRepository,
      firstGeometryService,
      createConflictLayerServiceStub(),
      createIdGenerator()
    );
    const editTime = new TimePoint(1500);
    const newAnchor = createNewAnchorDraft();

    let conflictId = "";
    try {
      await firstUseCase.execute("poly-1", createSplitPlan(), 0, newAnchor, editTime);
      throw new Error("Expected conflict error");
    } catch (error) {
      expect(error.code).toBe("FEATURE_ANCHOR_CONFLICTS");
      conflictId = error.conflicts[0].id;
    }
    expect(conflictId).toBe("polygon-overlap:poly-rival::polygon-1:1500:null:null");

    const secondRepository = new InMemoryWorldRepository(createWorldWithConflictRival(anchors));
    const secondGeometryService = createGeometryServiceStub();
    const secondUseCase = new SplitPolygonUseCase(
      secondRepository,
      secondGeometryService,
      createConflictLayerServiceStub(),
      createIdGenerator()
    );

    const resolved = await secondUseCase.execute(
      "poly-1",
      createSplitPlan(),
      0,
      createNewAnchorDraft(),
      editTime,
      {
        conflictResolutions: {
          [conflictId]: { preferFeatureId: "polygon-1" }
        }
      }
    );

    expect(resolved.newPolygon.id).toBe("polygon-1");
    expect(resolved.updatedFeatures.map(feature => feature.id)).toEqual(
      expect.arrayContaining(["poly-1", "polygon-1", "poly-rival"])
    );

    const worldAfter = await secondRepository.getWorld();
    const rival = worldAfter.features.find(feature => feature.id === "poly-rival");
    expect(rival.anchors.map(anchor => anchor.startTime.year)).toEqual([1500]);
    expect(rival.anchors[0].endTime).toBeNull();
    expect(rival.existsAt(new TimePoint(1600))).toBe(true);
  });
});
