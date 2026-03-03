// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { MapView } from "../../src/presentation/views/MapView.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { GeometryService } from "../../src/domain/services/GeometryService.js";

const createPolygonAnchor = ({ id, start, end = null, vertexIds, childIds = [] }) =>
  new FeatureAnchor({
    id,
    timeRange: { start, end },
    property: { name: id, description: "", attributes: {} },
    shape: {
      type: "Polygon",
      rings: [
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
});
