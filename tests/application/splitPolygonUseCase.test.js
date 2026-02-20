import { describe, expect, it } from "vitest";
import { SplitPolygonUseCase } from "../../src/application/usecases/feature/SplitPolygonUseCase.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

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

const createGeometryServiceStub = () => ({
  isPolygonSelfIntersecting: () => false
});

const createAnchor = ({ id, startYear, endYear = null, name, vertexIds }) => {
  const start = new TimePoint(startYear);
  const end = endYear === null ? null : new TimePoint(endYear);
  return new FeatureAnchor({
    id,
    timeRange: { start, end },
    property: { name, description: "", attributes: {} },
    shape: {
      type: "Polygon",
      rings: [
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
      childIds: []
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
});
