// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { MapView } from "../../src/presentation/views/MapView.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";

const cloneRing = (ring) => ({
  id: ring.id,
  vertexIds: [...ring.vertexIds],
  ringType: ring.ringType,
  parentId: ring.parentId ?? null
});

const createPolygonAnchor = ({ id, start, end = null, vertexIds = [], childIds = [], rings = null }) =>
  new FeatureAnchor({
    id,
    timeRange: { start, end },
    property: { name: id, description: "", attributes: {} },
    shape: {
      type: "Polygon",
      rings: Array.isArray(rings) && rings.length > 0
        ? rings.map(ring => cloneRing(ring))
        : [
            {
              id: `ring-${id}`,
              vertexIds,
              ringType: "territory",
              parentId: null
            }
          ]
    },
    placement: {
      layerId: "layer-0",
      parentId: "0",
      childIds
    }
  });

const calculatePlanArea = (splitPlan, geometryService) =>
  splitPlan.polygons.reduce((total, polygon) =>
    total + polygon.rings.reduce((polygonArea, ring) => {
      const ringArea = geometryService.calculatePolygonArea(ring.points);
      return polygonArea + (ring.ringType === "territory" ? ringArea : -ringArea);
    }, 0), 0);

const buildCirclePoints = (center, radius, segments = 16) => {
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  return points;
};

describe("MapView split confirmation", () => {
  it("passes current time to EditingViewModel.confirmSplit", async () => {
    const currentTime = new TimePoint(1500);
    const domainProperty = { kind: "property" };
    const context = {
      _createDomainProperty: vi.fn(() => domainProperty),
      _editingViewModel: {
        confirmSplit: vi.fn(async () => {})
      },
      _viewModel: {
        getCurrentTime: vi.fn(() => currentTime)
      }
    };

    await MapView.prototype._confirmSplitWithProperties.call(
      context,
      1,
      { name: "Split", description: "" }
    );

    expect(context._createDomainProperty).toHaveBeenCalledWith({
      name: "Split",
      description: ""
    });
    expect(context._viewModel.getCurrentTime).toHaveBeenCalledTimes(1);
    expect(context._editingViewModel.confirmSplit).toHaveBeenCalledWith(
      1,
      domainProperty,
      currentTime
    );
  });

  it("builds split plan from the current-time polygon rings", () => {
    const editTime = new TimePoint(1500);
    const targetPolygon = globalThis.createAnchoredPolygon(
      "poly-1",
      [
        createPolygonAnchor({
          id: "anchor-1000",
          start: new TimePoint(1000),
          end: new TimePoint(2000),
          vertexIds: ["v1", "v2", "v3", "v4"]
        }),
        createPolygonAnchor({
          id: "anchor-2000",
          start: new TimePoint(2000),
          vertexIds: ["v5", "v6", "v7", "v8"]
        })
      ],
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
      ]
    );

    const context = {
      _editingViewModel: {
        getTargetPolygon: vi.fn(() => targetPolygon),
        getAddingPoints: vi.fn(() => [
          { x: 5, y: -5 },
          { x: 5, y: 15 }
        ]),
        getSplitLineMode: vi.fn(() => "open")
      },
      _viewModel: {
        getWorld: vi.fn(() => ({
          vertices: [
            { id: "v1", x: 0, y: 0 },
            { id: "v2", x: 10, y: 0 },
            { id: "v3", x: 10, y: 10 },
            { id: "v4", x: 0, y: 10 },
            { id: "v5", x: 20, y: 0 },
            { id: "v6", x: 30, y: 0 },
            { id: "v7", x: 30, y: 10 },
            { id: "v8", x: 20, y: 10 }
          ]
        })),
        getCurrentTime: vi.fn(() => editTime),
        _geometryService: new GeometryService()
      },
      _clickToleranceSq: 1e-8
    };

    const splitPlan = MapView.prototype._buildSplitPlan.call(context);
    const sourceVertexIds = [
      ...new Set(
        splitPlan.polygons.flatMap((polygon) =>
          polygon.rings.flatMap((ring) =>
            ring.points
              .map((point) => point.sourceVertexId)
              .filter(Boolean)
          )
        )
      )
    ].sort();

    expect(sourceVertexIds).toEqual(["v1", "v2", "v3", "v4"]);
    expect(context._viewModel.getCurrentTime).toHaveBeenCalledTimes(1);
  });

  it("builds split plan from the current-time hole rings as well", () => {
    const editTime = new TimePoint(1500);
    const geometryService = new GeometryService();
    const targetPolygon = globalThis.createAnchoredPolygon(
      "poly-1",
      [
        createPolygonAnchor({
          id: "anchor-1000",
          start: new TimePoint(1000),
          end: new TimePoint(2000),
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
        createPolygonAnchor({
          id: "anchor-2000",
          start: new TimePoint(2000),
          rings: [
            {
              id: "ring-future",
              vertexIds: ["f1", "f2", "f3", "f4"],
              ringType: "territory",
              parentId: null
            }
          ]
        })
      ],
      "layer-0",
      "0",
      [],
      [
        {
          id: "ring-future",
          vertexIds: ["f1", "f2", "f3", "f4"],
          ringType: "territory",
          parentId: null
        }
      ]
    );

    const context = {
      _editingViewModel: {
        getTargetPolygon: vi.fn(() => targetPolygon),
        getAddingPoints: vi.fn(() => [
          { x: -1, y: 5 },
          { x: 11, y: 5 }
        ]),
        getSplitLineMode: vi.fn(() => "open")
      },
      _viewModel: {
        getWorld: vi.fn(() => ({
          vertices: [
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
          ]
        })),
        getCurrentTime: vi.fn(() => editTime),
        _geometryService: geometryService
      },
      _clickToleranceSq: 1e-8
    };

    const splitPlan = MapView.prototype._buildSplitPlan.call(context);

    expect(calculatePlanArea(splitPlan, geometryService)).toBeCloseTo(84, 6);
    expect(splitPlan.polygons).toHaveLength(2);
    expect(
      splitPlan.polygons.some((polygon) =>
        polygon.rings.some((ring) => ring.ringType === "hole")
      )
    ).toBe(false);
  });

  it("rejects split when the polygon has child polygons at the current time", () => {
    const editTime = new TimePoint(1500);
    const targetPolygon = globalThis.createAnchoredPolygon(
      "poly-1",
      [
        createPolygonAnchor({
          id: "anchor-1000",
          start: new TimePoint(1000),
          end: new TimePoint(2000),
          vertexIds: ["v1", "v2", "v3", "v4"],
          childIds: ["child-1"]
        }),
        createPolygonAnchor({
          id: "anchor-2000",
          start: new TimePoint(2000),
          vertexIds: ["v5", "v6", "v7", "v8"],
          childIds: []
        })
      ],
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
      ]
    );

    const context = {
      _editingViewModel: {
        getTargetPolygon: vi.fn(() => targetPolygon),
        getAddingPoints: vi.fn(() => [
          { x: 5, y: -5 },
          { x: 5, y: 15 }
        ]),
        getSplitLineMode: vi.fn(() => "open")
      },
      _viewModel: {
        getWorld: vi.fn(() => ({
          vertices: [
            { id: "v1", x: 0, y: 0 },
            { id: "v2", x: 10, y: 0 },
            { id: "v3", x: 10, y: 10 },
            { id: "v4", x: 0, y: 10 },
            { id: "v5", x: 20, y: 0 },
            { id: "v6", x: 30, y: 0 },
            { id: "v7", x: 30, y: 10 },
            { id: "v8", x: 20, y: 10 }
          ]
        })),
        getCurrentTime: vi.fn(() => editTime),
        _geometryService: new GeometryService()
      },
      _clickToleranceSq: 1e-8
    };

    expect(() => MapView.prototype._buildSplitPlan.call(context)).toThrow(/下位領域を持つ面情報/);
  });

  it("builds a closed split plan when splitLineMode is circle", () => {
    const editTime = new TimePoint(1500);
    const geometryService = new GeometryService();
    const targetPolygon = globalThis.createAnchoredPolygon(
      "poly-1",
      [
        createPolygonAnchor({
          id: "anchor-1000",
          start: new TimePoint(1000),
          end: new TimePoint(2000),
          vertexIds: ["v1", "v2", "v3", "v4"]
        }),
        createPolygonAnchor({
          id: "anchor-2000",
          start: new TimePoint(2000),
          vertexIds: ["v5", "v6", "v7", "v8"]
        })
      ],
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
      ]
    );
    const circlePoints = buildCirclePoints({ x: 5, y: 5 }, 1.5);

    const context = {
      _editingViewModel: {
        getTargetPolygon: vi.fn(() => targetPolygon),
        getAddingPoints: vi.fn(() => circlePoints),
        getSplitLineMode: vi.fn(() => "circle")
      },
      _viewModel: {
        getWorld: vi.fn(() => ({
          vertices: [
            { id: "v1", x: 0, y: 0 },
            { id: "v2", x: 10, y: 0 },
            { id: "v3", x: 10, y: 10 },
            { id: "v4", x: 0, y: 10 },
            { id: "v5", x: 20, y: 0 },
            { id: "v6", x: 30, y: 0 },
            { id: "v7", x: 30, y: 10 },
            { id: "v8", x: 20, y: 10 }
          ]
        })),
        getCurrentTime: vi.fn(() => editTime),
        _geometryService: geometryService
      },
      _clickToleranceSq: 1e-8
    };

    const splitPlan = MapView.prototype._buildSplitPlan.call(context);
    const holeCounts = splitPlan.polygons
      .map((polygon) => polygon.rings.filter((ring) => ring.ringType === "hole").length)
      .sort((left, right) => left - right);

    expect(calculatePlanArea(splitPlan, geometryService)).toBeCloseTo(100, 6);
    expect(holeCounts).toEqual([0, 1]);
  });
});
