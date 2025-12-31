import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MapViewModel } from '../../src/presentation/view-models/MapViewModel.js';
import { MapViewInteractionLogic } from '../../src/presentation/views/map/MapViewInteractionLogic.js';

const createStubEventBus = () => ({
  subscribe: vi.fn(),
  publish: vi.fn()
});

const createStubNavigateTimeUseCase = () => ({
  getCurrentTime: vi.fn(() => ({ year: 0, month: null, day: null, isBefore: () => false })),
  getCalendarConfig: vi.fn(() => ({ monthsPerYear: 12 })),
  getDaysInMonth: vi.fn(() => 30),
  createTimePoint: vi.fn((year, month = null, day = null) => ({ year, month, day, isBefore: () => false }))
});

const createMapViewModel = () => {
  const eventBus = createStubEventBus();
  const editFeatureUseCase = { getWorldRepository: () => null };
  const navigateTimeUseCase = createStubNavigateTimeUseCase();
  const manageLayersUseCase = {};
  const geometryService = {};
  const updateProjectSettingsUseCase = { execute: vi.fn() };

  const vm = new MapViewModel(
    editFeatureUseCase,
    navigateTimeUseCase,
    manageLayersUseCase,
    geometryService,
    eventBus,
    updateProjectSettingsUseCase
  );
  vm._world = {
    features: [],
    vertices: [],
    layers: [],
    metadata: { settings: { sliderMin: 0, sliderMax: 10 } }
  };
  return vm;
};

describe('MapViewModel feature selection', () => {
  let mapViewModel;

  beforeEach(() => {
    mapViewModel = createMapViewModel();
    mapViewModel._world.features = [
      { id: 'f1', layerId: 'layer-1', existsAt: () => true },
      { id: 'f2', layerId: 'layer-1', existsAt: () => true }
    ];
    mapViewModel._features = [...mapViewModel._world.features];
  });

  it('supports additive feature selection and keeps the latest as primary', () => {
    mapViewModel.selectFeature('f1');
    expect(mapViewModel.getActiveFeatureId()).toBe('f1');
    expect(mapViewModel.getSelectedFeatureIds()).toEqual(new Set(['f1']));
    expect(mapViewModel.getSelectionContextFeature()?.id).toBe('f1');

    mapViewModel.selectFeature('f2', true);
    expect(mapViewModel.getActiveFeatureId()).toBe('f2'); // 直近選択を主選択とする
    expect(mapViewModel.getSelectedFeatureIds()).toEqual(new Set(['f1', 'f2']));
    expect(mapViewModel.getSelectionContextFeature()).toBeNull(); // 複数選択ではコンテキストなし

    mapViewModel.selectFeature('f2', true); // トグルで解除
    expect(mapViewModel.getSelectedFeatureIds()).toEqual(new Set(['f1']));
    expect(mapViewModel.getActiveFeatureId()).toBe('f1');
    expect(mapViewModel.getSelectionContextFeature()?.id).toBe('f1');
  });
});

describe('MapViewInteractionLogic selection forwarding', () => {
  const createLogic = viewModel => {
    const editingViewModel = {};
    const geometryService = {};
    return new MapViewInteractionLogic(viewModel, editingViewModel, geometryService, () => 0, () => 360);
  };

  it('respects additive flag when selecting features via selectObjectAt', () => {
    const viewModel = {
      selectVertex: vi.fn(),
      selectFeature: vi.fn(),
      clearSelection: vi.fn(),
      _geometryService: {},
      getFeatures: vi.fn(() => [])
    };
    const logic = createLogic(viewModel);
    logic.findClosestVertex = vi.fn(() => null);
    logic.findClosestFeature = vi.fn(() => ({ id: 'feature-1' }));

    logic.selectObjectAt({ x: 0, y: 0 }, true);

    expect(viewModel.selectFeature).toHaveBeenCalledWith('feature-1', true);
  });

  it('keeps additive flag in view mode clicks', () => {
    const viewModel = {
      selectFeature: vi.fn(),
      clearSelection: vi.fn(),
      _geometryService: {},
      getFeatures: vi.fn(() => [])
    };
    const logic = createLogic(viewModel);
    logic.findClosestFeature = vi.fn(() => ({ id: 'feature-2' }));

    logic.handleClickInViewMode({ x: 0, y: 0 }, true);

    expect(viewModel.selectFeature).toHaveBeenCalledWith('feature-2', true);
  });
});
