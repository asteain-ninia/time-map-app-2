/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapViewEventHandler } from '../../src/presentation/views/map/MapViewEventHandler.js';

function createHandler() {
  const mapOverlay = document.createElement('div');
  mapOverlay.style.cursor = 'default';
  const mapView = {
    hideContextMenu: vi.fn(),
    isMeasuringDistance: vi.fn(() => false),
    setMeasuringDistance: vi.fn(),
    showContextMenu: vi.fn()
  };
  const viewModel = {
    getSelectedVertexIds: vi.fn(() => new Set()),
    getSelectedFeatureIds: vi.fn(() => new Set()),
    clearSelection: vi.fn()
  };
  const editingViewModel = {};
  const viewportManager = {
    startDrag: vi.fn()
  };
  const renderer = {};
  const interactionLogic = {};

  const handler = new MapViewEventHandler(
    mapView,
    mapOverlay,
    viewModel,
    editingViewModel,
    viewportManager,
    renderer,
    interactionLogic
  );

  return { handler, mapView, mapOverlay, viewportManager };
}

describe('MapViewEventHandler conflict dialog keyboard handling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('clicks confirm button when Enter is pressed in anchor conflict dialog', () => {
    const { handler } = createHandler();
    const dialog = document.createElement('div');
    dialog.className = 'anchor-conflict-resolution-dialog';
    const input = document.createElement('input');
    const confirmButton = document.createElement('button');
    confirmButton.dataset.action = 'confirm';
    const confirmSpy = vi.fn();
    confirmButton.addEventListener('click', confirmSpy);
    dialog.appendChild(input);
    dialog.appendChild(confirmButton);
    document.body.appendChild(dialog);

    const event = {
      key: 'Enter',
      target: input,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    handler.handleKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('clicks cancel button when Escape is pressed in anchor conflict dialog', () => {
    const { handler } = createHandler();
    const dialog = document.createElement('div');
    dialog.className = 'anchor-conflict-resolution-dialog';
    const input = document.createElement('input');
    const cancelButton = document.createElement('button');
    cancelButton.dataset.action = 'cancel';
    const cancelSpy = vi.fn();
    cancelButton.addEventListener('click', cancelSpy);
    dialog.appendChild(input);
    dialog.appendChild(cancelButton);
    document.body.appendChild(dialog);

    const event = {
      key: 'Escape',
      target: input,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    handler.handleKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores mouse down events fired on anchor conflict dialog', () => {
    const { handler, mapView, viewportManager } = createHandler();
    const dialog = document.createElement('div');
    dialog.className = 'anchor-conflict-resolution-dialog';
    const dialogChild = document.createElement('div');
    dialog.appendChild(dialogChild);
    document.body.appendChild(dialog);

    const event = {
      button: 0,
      target: dialogChild
    };
    handler.handleMouseDown(event);

    expect(mapView.hideContextMenu).toHaveBeenCalledTimes(1);
    expect(viewportManager.startDrag).not.toHaveBeenCalled();
    expect(document.body.classList.contains('noselect')).toBe(false);
  });
});

describe('MapViewEventHandler split tool circle guide', () => {
  it('switches to closed split mode and confirms when clicking inside the guide circle', () => {
    const mapOverlay = document.createElement('div');
    const mapView = {
      hideContextMenu: vi.fn(),
      isMeasuringDistance: vi.fn(() => false),
      setMeasuringDistance: vi.fn(),
      showContextMenu: vi.fn(),
      getSplitCircleRadiusWorld: vi.fn(() => 2),
      refresh: vi.fn(),
      _handleConfirmClick: vi.fn()
    };
    const viewModel = {
      getWorld: vi.fn(() => ({ vertices: [] }))
    };
    const editingViewModel = {
      getTargetPolygon: vi.fn(() => ({ id: 'poly-1' })),
      getSplitLineMode: vi.fn(() => 'open'),
      getAddingPoints: vi.fn(() => [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 }
      ]),
      clearSplitPlan: vi.fn(),
      setSplitLineMode: vi.fn(),
      getSplitPlan: vi.fn(() => null),
      addPoint: vi.fn()
    };
    const handler = new MapViewEventHandler(
      mapView,
      mapOverlay,
      viewModel,
      editingViewModel,
      {},
      {},
      {}
    );

    handler._handleSplitToolClick({ x: 1, y: 1 });

    expect(editingViewModel.clearSplitPlan).toHaveBeenCalledTimes(1);
    expect(editingViewModel.setSplitLineMode).toHaveBeenNthCalledWith(1, 'circle');
    expect(mapView.refresh).toHaveBeenCalledTimes(1);
    expect(mapView._handleConfirmClick).toHaveBeenCalledTimes(1);
    expect(editingViewModel.setSplitLineMode).toHaveBeenNthCalledWith(2, 'open');
    expect(editingViewModel.addPoint).not.toHaveBeenCalled();
  });

  it('keeps closed split mode when confirmation produced a split plan', () => {
    const mapOverlay = document.createElement('div');
    const mapView = {
      hideContextMenu: vi.fn(),
      isMeasuringDistance: vi.fn(() => false),
      setMeasuringDistance: vi.fn(),
      showContextMenu: vi.fn(),
      getSplitCircleRadiusWorld: vi.fn(() => 2),
      refresh: vi.fn(),
      _handleConfirmClick: vi.fn()
    };
    const viewModel = {
      getWorld: vi.fn(() => ({ vertices: [] }))
    };
    const editingViewModel = {
      getTargetPolygon: vi.fn(() => ({ id: 'poly-1' })),
      getSplitLineMode: vi.fn(() => 'open'),
      getAddingPoints: vi.fn(() => [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 }
      ]),
      clearSplitPlan: vi.fn(),
      setSplitLineMode: vi.fn(),
      getSplitPlan: vi.fn(() => ({ polygons: [{ rings: [] }, { rings: [] }] })),
      addPoint: vi.fn()
    };
    const handler = new MapViewEventHandler(
      mapView,
      mapOverlay,
      viewModel,
      editingViewModel,
      {},
      {},
      {}
    );

    handler._handleSplitToolClick({ x: 1, y: 1 });

    expect(editingViewModel.setSplitLineMode).toHaveBeenCalledTimes(1);
    expect(editingViewModel.setSplitLineMode).toHaveBeenCalledWith('circle');
    expect(mapView._handleConfirmClick).toHaveBeenCalledTimes(1);
    expect(editingViewModel.addPoint).not.toHaveBeenCalled();
  });
});
