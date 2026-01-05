// Tests authored by Codex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapViewModel } from "../../src/presentation/view-models/MapViewModel.js";
import { TimelineViewModel } from "../../src/presentation/view-models/TimelineViewModel.js";
import { EditingViewModel } from "../../src/presentation/view-models/EditingViewModel.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createEventBus = () => {
  const handlers = new Map();
  return {
    subscribe: vi.fn((event, handler) => {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event).push(handler);
    }),
    publish: vi.fn(),
    emit(event, payload) {
      const callbacks = handlers.get(event) || [];
      callbacks.forEach((handler) => handler(payload));
    },
    handlers
  };
};

const createProperty = (year = 0, name = "Name") => new Property(new TimePoint(year), name, "", {});

describe("MapViewModel", () => {
  const createWorld = () => {
    const activeFeature = new Point(
      "feature-active",
      ["v-visible"],
      [createProperty(0, "Active")],
      "layer-visible"
    );
    const inactiveFeature = new Point(
      "feature-future",
      ["v-future"],
      [new Property(new TimePoint(200), "Future", "", {}, new TimePoint(200))],
      "layer-visible"
    );
    const hiddenFeature = new Point(
      "feature-hidden",
      ["v-hidden"],
      [createProperty(0, "Hidden")],
      "layer-hidden"
    );

    return {
      features: [activeFeature, inactiveFeature, hiddenFeature],
      vertices: [
        { id: "v-visible", x: 0, y: 0 },
        { id: "v-future", x: 1, y: 1 },
        { id: "v-hidden", x: 2, y: 2 }
      ],
      layers: [
        { id: "layer-visible", visible: true },
        { id: "layer-hidden", visible: false }
      ],
      metadata: {
        settings: {
          sliderMin: 0,
          sliderMax: 100,
          zoomMin: 1,
          zoomMax: 50,
          gridInterval: 10,
          gridColor: "#cccccc",
          gridOpacity: 0.5,
          equatorLength: 40000,
          worldName: "World",
          worldDescription: ""
        }
      }
    };
  };

  const setupViewModel = () => {
    const eventBus = createEventBus();
    const worldRepository = {
      getWorld: vi.fn(async () => createWorld()),
      saveWorld: vi.fn(async () => {})
    };
    const editFeatureUseCase = { getWorldRepository: () => worldRepository };
    const navigateTimeUseCase = {
      getCurrentTime: vi.fn(() => new TimePoint(0)),
      moveToTime: vi.fn((year, month = null, day = null) => new TimePoint(year, month, day)),
      createTimePoint: vi.fn((year, month = null, day = null) => new TimePoint(year, month, day))
    };
    const manageLayersUseCase = {};
    const geometryService = {};
    const updateProjectSettingsUseCase = {
      execute: vi.fn(async (settings) => ({ ...settings }))
    };

    const viewModel = new MapViewModel(
      editFeatureUseCase,
      navigateTimeUseCase,
      manageLayersUseCase,
      geometryService,
      eventBus,
      updateProjectSettingsUseCase
    );

    return {
      viewModel,
      eventBus,
      worldRepository,
      updateProjectSettingsUseCase,
      navigateTimeUseCase
    };
  };

  it("loads world data and exposes only visible features", async () => {
    const { viewModel, eventBus, worldRepository } = setupViewModel();
    const notifications = [];
    viewModel.addObserver((type, data) => notifications.push({ type, data }));

    await viewModel.loadWorld();

    expect(worldRepository.getWorld).toHaveBeenCalledTimes(1);
    expect(viewModel.getFeatures().map((feature) => feature.id)).toEqual(["feature-active"]);
    expect(eventBus.publish).toHaveBeenCalledWith(
      "ProjectSettingsUpdated",
      { settings: expect.objectContaining({ sliderMin: 0, sliderMax: 100 }) }
    );
    expect(notifications.some(({ type }) => type === "world")).toBe(true);
  });

  it("provides a default property time range from slider settings", async () => {
    const { viewModel, navigateTimeUseCase } = setupViewModel();

    await viewModel.loadWorld();

    const range = viewModel.getDefaultPropertyTimeRange();
    expect(range.start.year).toBe(0);
    expect(range.end.year).toBe(101);
    expect(navigateTimeUseCase.createTimePoint).toHaveBeenCalledWith(0);
    expect(navigateTimeUseCase.createTimePoint).toHaveBeenCalledWith(101);
  });

  it("updates project settings via the injected use case", async () => {
    const { viewModel, eventBus, updateProjectSettingsUseCase } = setupViewModel();
    const notifications = [];
    viewModel.addObserver((type, data) => notifications.push({ type, data }));

    await viewModel.loadWorld();
    eventBus.publish.mockClear();
    notifications.length = 0;

    updateProjectSettingsUseCase.execute.mockResolvedValue({
      sliderMin: 10,
      sliderMax: 200,
      zoomMin: 2,
      zoomMax: 40,
      gridInterval: 20,
      gridColor: "#000000",
      gridOpacity: 0.3,
      equatorLength: 50000,
      worldName: "Updated",
      worldDescription: "Desc"
    });

    await viewModel.updateProjectSettings({
      sliderMin: 10,
      sliderMax: 200,
      zoomMin: 2,
      zoomMax: 40,
      gridInterval: 20,
      gridColor: "#000000",
      gridOpacity: 0.3,
      equatorLength: 50000,
      worldName: "Updated",
      worldDescription: "Desc"
    });

    expect(updateProjectSettingsUseCase.execute).toHaveBeenCalledWith({
      sliderMin: 10,
      sliderMax: 200,
      zoomMin: 2,
      zoomMax: 40,
      gridInterval: 20,
      gridColor: "#000000",
      gridOpacity: 0.3,
      equatorLength: 50000,
      worldName: "Updated",
      worldDescription: "Desc"
    });
    expect(viewModel.getProjectSettings()).toEqual({
      sliderMin: 10,
      sliderMax: 200,
      zoomMin: 2,
      zoomMax: 40,
      gridInterval: 20,
      gridColor: "#000000",
      gridOpacity: 0.3,
      equatorLength: 50000,
      worldName: "Updated",
      worldDescription: "Desc"
    });
    expect(viewModel.getWorld().metadata.settings).toEqual({
      sliderMin: 10,
      sliderMax: 200,
      zoomMin: 2,
      zoomMax: 40,
      gridInterval: 20,
      gridColor: "#000000",
      gridOpacity: 0.3,
      equatorLength: 50000,
      worldName: "Updated",
      worldDescription: "Desc"
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      "ProjectSettingsUpdated",
      { settings: expect.objectContaining({ sliderMin: 10, sliderMax: 200 }) }
    );
    expect(notifications.some(({ type }) => type === "projectSettingsChanged")).toBe(true);
  });
});

const createNavigateTimeUseCase = () => ({
  getCurrentTime: vi.fn(() => ({ year: 120, month: null, day: null })),
  moveToTime: vi.fn((year, month = null, day = null) => ({ year, month, day }))
});

describe("TimelineViewModel", () => {
  let originalSetInterval;
  let originalClearInterval;

  beforeEach(() => {
    originalSetInterval = globalThis.setInterval;
    originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = (fn) => {
      fn();
      return 1;
    };
    globalThis.clearInterval = vi.fn();
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  const setupViewModel = () => {
    const eventBus = createEventBus();
    const navigateTimeUseCase = createNavigateTimeUseCase();
    const viewModel = new TimelineViewModel(navigateTimeUseCase, eventBus);
    return { viewModel, eventBus, navigateTimeUseCase };
  };

  it("updates range when project settings events arrive", () => {
    const { viewModel, eventBus, navigateTimeUseCase } = setupViewModel();
    const notifications = [];
    viewModel.addObserver((type, data) => notifications.push({ type, data }));

    eventBus.emit("ProjectSettingsUpdated", { settings: { sliderMin: 10, sliderMax: 50 } });

    expect(viewModel.getTimeRange()).toEqual({ minYear: 10, maxYear: 50 });
    expect(navigateTimeUseCase.moveToTime).toHaveBeenCalledWith(50, undefined, undefined);
    expect(viewModel.getCurrentTime().year).toBe(50);
    expect(eventBus.publish).toHaveBeenCalledWith("TimeChanged", { time: viewModel.getCurrentTime() });
    expect(notifications.some(({ type }) => type === "range")).toBe(true);
    expect(notifications.some(({ type }) => type === "currentTime")).toBe(true);
  });

  it("clamps time navigation to the configured range", () => {
    const { viewModel, eventBus, navigateTimeUseCase } = setupViewModel();
    viewModel.setTimeRange(0, 100);
    const notifications = [];
    viewModel.addObserver((type, data) => notifications.push({ type, data }));
    eventBus.publish.mockClear();
    navigateTimeUseCase.moveToTime.mockClear();

    viewModel.moveToTime(150);

    expect(navigateTimeUseCase.moveToTime).toHaveBeenCalledWith(100, undefined, undefined);
    expect(eventBus.publish).toHaveBeenCalledWith("TimeChanged", { time: viewModel.getCurrentTime() });
    expect(viewModel.getCurrentTime().year).toBe(100);
    expect(notifications.some(({ type }) => type === "currentTime")).toBe(true);
  });
});

describe("EditingViewModel", () => {
  const setupViewModel = () => {
    const eventBus = createEventBus();
    const historyService = {
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => false),
      undo: vi.fn(async () => {}),
      redo: vi.fn(async () => {})
    };
    const editFeatureUseCase = {};
    const viewModel = new EditingViewModel(editFeatureUseCase, eventBus, historyService);
    return { viewModel, eventBus, historyService };
  };

  it("starts vertex drag sessions and notifies observers", () => {
    const { viewModel } = setupViewModel();
    const notifications = [];
    viewModel.addObserver((type, data) => notifications.push({ type, data }));

    viewModel.setMode("edit");
    const vertices = new Map([["v1", { x: 0, y: 0 }]]);

    viewModel.startVerticesDrag(vertices);

    expect(viewModel.getDraggingVerticesInfo().size).toBe(1);
    expect(notifications.some(({ type }) => type === "draggingVertices")).toBe(true);
  });

  it("forwards HistoryChanged events to observers", () => {
    const { viewModel, eventBus } = setupViewModel();
    const notifications = [];
    viewModel.addObserver((type, data) => notifications.push({ type, data }));

    eventBus.emit("HistoryChanged", { canUndo: true, canRedo: false });

    expect(notifications).toContainEqual({ type: "history", data: { canUndo: true, canRedo: false } });
  });

  it("executes undo through the history service and resets drag state", async () => {
    const { viewModel, historyService } = setupViewModel();
    const notifications = [];
    viewModel.addObserver((type, data) => notifications.push({ type, data }));

    viewModel.setMode("edit");
    viewModel.startVerticesDrag(new Map([["v1", { x: 0, y: 0 }]]));
    expect(viewModel.getDraggingVerticesInfo().size).toBe(1);

    await viewModel.undo();

    expect(historyService.canUndo).toHaveBeenCalledTimes(1);
    expect(historyService.undo).toHaveBeenCalledTimes(1);
    expect(viewModel.getDraggingVerticesInfo().size).toBe(0);
    expect(notifications.some(({ type }) => type === "draggingVertices")).toBe(true);
  });
});
