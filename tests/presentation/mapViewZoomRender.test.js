// Tests authored by Codex.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapView } from "../../src/presentation/views/MapView.js";

describe("MapView zoom settled render", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes polygon labels and rerenders overlays after zoom settles", () => {
    const viewport = { zoom: 2 };
    const world = { id: "world-1" };
    const currentTime = { year: 1000 };
    const projectSettings = { rendering: { minLabelScreenRatio: 0.0005 } };
    const context = {
      _viewportManager: {
        getViewport: vi.fn(() => viewport)
      },
      _viewModel: {
        getWorld: vi.fn(() => world),
        getCurrentTime: vi.fn(() => currentTime),
        getProjectSettings: vi.fn(() => projectSettings)
      },
      _renderer: {
        updateZoomScale: vi.fn(),
        refreshPolygonLabels: vi.fn()
      },
      _requestRender: vi.fn()
    };

    MapView.prototype._applyZoomSettledRender.call(context);

    expect(context._renderer.updateZoomScale).toHaveBeenCalledWith(viewport);
    expect(context._renderer.refreshPolygonLabels).toHaveBeenCalledWith(
      world,
      viewport,
      currentTime,
      projectSettings
    );
    expect(context._requestRender).toHaveBeenCalledWith("overlay-full");
  });

  it("falls back to full render when label-only refresh is unavailable", () => {
    const context = {
      _viewportManager: {
        getViewport: vi.fn(() => ({ zoom: 1 }))
      },
      _viewModel: {
        getWorld: vi.fn(() => ({ id: "world-1" })),
        getCurrentTime: vi.fn(() => ({ year: 1000 })),
        getProjectSettings: vi.fn(() => ({ rendering: { minLabelScreenRatio: 0.0005 } }))
      },
      _renderer: {
        updateZoomScale: vi.fn()
      },
      _requestRender: vi.fn()
    };

    MapView.prototype._applyZoomSettledRender.call(context);

    expect(context._renderer.updateZoomScale).toHaveBeenCalledWith({ zoom: 1 });
    expect(context._requestRender).toHaveBeenCalledWith();
  });
});

describe("MapView._scheduleZoomRender", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces zoom settled render", () => {
    vi.useFakeTimers();

    const context = {
      _zoomRenderTimeoutId: null,
      _getZoomRenderDelayMs: vi.fn(() => 120),
      _applyZoomSettledRender: vi.fn()
    };

    MapView.prototype._scheduleZoomRender.call(context);
    expect(context._applyZoomSettledRender).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120);

    expect(context._applyZoomSettledRender).toHaveBeenCalledTimes(1);
  });

  it("applies zoom settled render immediately when debounce is disabled", () => {
    const context = {
      _zoomRenderTimeoutId: null,
      _getZoomRenderDelayMs: vi.fn(() => 0),
      _applyZoomSettledRender: vi.fn()
    };

    MapView.prototype._scheduleZoomRender.call(context);

    expect(context._applyZoomSettledRender).toHaveBeenCalledTimes(1);
  });
});
