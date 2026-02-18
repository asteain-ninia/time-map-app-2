// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { MapView } from "../../src/presentation/views/MapView.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

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
});
