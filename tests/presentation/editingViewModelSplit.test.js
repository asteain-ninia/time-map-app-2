import { describe, expect, it, vi } from "vitest";
import { splitMethods } from "../../src/presentation/view-models/EditingViewModelSplit.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { SplitPolygonCommand } from "../../src/application/services/history/commands/SplitPolygonCommand.js";

const createDomainAnchor = () =>
  new FeatureAnchor({
    id: "anchor-draft",
    timeRange: { start: new TimePoint(1000), end: null },
    property: { name: "Split", description: "", attributes: {} },
    shape: {},
    placement: {}
  });

const buildContext = ({ splitResult, splitError = null }) => {
  const world = {
    features: [{ id: "poly-1" }],
    vertices: [],
    layers: []
  };
  const worldRepository = {
    getWorld: vi.fn(async () => world)
  };
  const editFeatureUseCase = {
    getWorldRepository: vi.fn(() => worldRepository),
    splitPolygon: splitError
      ? vi.fn(async () => {
          throw splitError;
        })
      : vi.fn(async () => splitResult)
  };
  const serializer = {
    serialize: vi.fn((value) => value)
  };
  const historyService = {
    _serializer: serializer,
    _stackManager: { pushUndo: vi.fn() },
    _notifyHistoryChanged: vi.fn(),
    _worldRepository: worldRepository
  };
  const eventBus = {
    publish: vi.fn()
  };

  const context = {
    _mode: "edit",
    _tool: "split",
    _targetPolygon: { id: "poly-1" },
    _splitPlan: { polygons: [{ rings: [] }, { rings: [] }] },
    _editFeatureUseCase: editFeatureUseCase,
    _historyService: historyService,
    _eventBus: eventBus,
    _clearAddingState: vi.fn()
  };

  return { context, editFeatureUseCase, historyService, eventBus };
};

describe("EditingViewModelSplit.confirmSplit", () => {
  it("forwards editTime to split usecase and records one history command", async () => {
    const splitResult = {
      updatedPolygon: { id: "poly-1" },
      newPolygon: { id: "poly-2" },
      addedVerticesData: [{ id: "v-new", x: 1, y: 2 }]
    };
    const { context, editFeatureUseCase, historyService, eventBus } = buildContext({ splitResult });
    const anchor = createDomainAnchor();
    const editTime = new TimePoint(1500);
    const splitPlan = context._splitPlan;

    const result = await splitMethods.confirmSplit.call(context, 1, anchor, editTime);

    expect(result).toBe(splitResult);
    expect(editFeatureUseCase.splitPolygon).toHaveBeenCalledTimes(1);
    expect(editFeatureUseCase.splitPolygon).toHaveBeenCalledWith(
      "poly-1",
      splitPlan,
      1,
      anchor,
      editTime
    );
    expect(historyService._stackManager.pushUndo).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo.mock.calls[0][0]).toBeInstanceOf(SplitPolygonCommand);
    expect(historyService._notifyHistoryChanged).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureUpdated", { feature: splitResult.updatedPolygon });
    expect(eventBus.publish).toHaveBeenCalledWith("FeatureAdded", { feature: splitResult.newPolygon });
    expect(context._clearAddingState).toHaveBeenCalledTimes(1);
    expect(context._splitPlan).toBeNull();
  });

  it("does not record history when split usecase fails", async () => {
    const splitError = new Error("split failed");
    const { context, editFeatureUseCase, historyService, eventBus } = buildContext({
      splitResult: null,
      splitError
    });
    const anchor = createDomainAnchor();
    const editTime = new TimePoint(1500);

    await expect(
      splitMethods.confirmSplit.call(context, 0, anchor, editTime)
    ).rejects.toThrow("split failed");

    expect(editFeatureUseCase.splitPolygon).toHaveBeenCalledTimes(1);
    expect(historyService._stackManager.pushUndo).not.toHaveBeenCalled();
    expect(historyService._notifyHistoryChanged).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalledWith("FeatureUpdated", expect.anything());
    expect(eventBus.publish).not.toHaveBeenCalledWith("FeatureAdded", expect.anything());
    expect(context._clearAddingState).toHaveBeenCalledTimes(1);
    expect(context._splitPlan).toBeNull();
  });
});
