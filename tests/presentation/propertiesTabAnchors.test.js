// Tests authored by Codex.
/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertiesTabView } from '../../src/presentation/views/sidebar/PropertiesTabView.js';
import { Point } from '../../src/domain/entities/Point.js';
import { FeatureAnchor } from '../../src/domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../src/domain/value-objects/TimePoint.js';

function createProperty(startYear, endYear, name, description = '') {
  const start = new TimePoint(startYear);
  const end = endYear === null ? null : new TimePoint(endYear);
  return new FeatureAnchor({
    id: `anchor-${name}-${startYear}-${endYear ?? 'null'}`,
    timeRange: { start, end },
    property: {
      name,
      description,
      attributes: {}
    },
    shape: {},
    placement: {}
  });
}

function createFeature(properties) {
  return globalThis.createAnchoredPoint('feature-1', ['v1'], properties, 'layer-1');
}

function createMapViewModel(feature, currentTime) {
  const world = {
    features: [feature],
    vertices: [{ id: 'v1', x: 0, y: 0 }],
    layers: [{ id: 'layer-1', name: 'Layer', order: 0, visible: true, opacity: 1 }]
  };
  return {
    getSelectionContextFeature: () => feature,
    getSelectedFeatureIds: () => new Set([feature.id]),
    getSelectedVertexIds: () => new Set(),
    getVertexSelectionOwnerIds: () => new Set(),
    getCurrentTime: () => currentTime,
    getCalendarConfig: () => ({ monthsPerYear: 12 }),
    getDaysInMonth: () => 31,
    createTimePoint: (year, month = null, day = null) => new TimePoint(year, month, day),
    getFeatures: () => [feature],
    getWorld: () => world
  };
}

function createEditingViewModelMock() {
  return {
    updateFeatureProperties: vi.fn(async () => {}),
    deleteFeature: vi.fn(async () => {})
  };
}

function getAnchorSection(parent) {
  const containers = [...parent.querySelectorAll('.properties-container > div')];
  return containers.find(container => container.firstElementChild?.textContent?.trim() === '履歴アンカー') || null;
}

function getAnchorButtons(parent) {
  const section = getAnchorSection(parent);
  if (!section) {
    return [];
  }
  const list = section.children[1];
  return [...list.querySelectorAll('button')];
}

function getButtonByText(parent, text) {
  return [...parent.querySelectorAll('button')].find(button => button.textContent.trim() === text) || null;
}

function getButtonByIncludedText(parent, fragment) {
  return [...parent.querySelectorAll('button')].find(button => button.textContent.includes(fragment)) || null;
}

function flushAsync() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('PropertiesTabView anchor UI', () => {
  let parent;
  let alertSpy;
  let confirmSpy;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    document.body.appendChild(parent);
    alertSpy = vi.fn();
    confirmSpy = vi.fn(() => true);
    vi.stubGlobal('alert', alertSpy);
    vi.stubGlobal('confirm', confirmSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders anchor section and sorted list', () => {
    const feature = createFeature([
      createProperty(1300, null, 'Anchor-1300'),
      createProperty(1000, 1100, 'Anchor-1000'),
      createProperty(1100, 1300, 'Anchor-1100')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1100));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();

    expect(parent.textContent).toContain('履歴アンカー');
    const names = getAnchorButtons(parent).map(button => button.textContent);
    expect(names[0]).toContain('Anchor-1000');
    expect(names[1]).toContain('Anchor-1100');
    expect(names[2]).toContain('Anchor-1300');
  });

  it('switches selected anchor and reflects it in form fields', () => {
    const feature = createFeature([
      createProperty(1000, 1100, 'Anchor-1000', 'desc-1000'),
      createProperty(1100, null, 'Anchor-1100', 'desc-1100')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1100));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();

    const nameInput = parent.querySelector('input[name="name"]');
    const descInput = parent.querySelector('textarea[name="description"]');
    expect(nameInput.value).toBe('Anchor-1100');
    expect(descInput.value).toBe('desc-1100');

    const oldAnchorButton = getButtonByIncludedText(parent, 'Anchor-1000');
    oldAnchorButton.click();

    const nameInputAfter = parent.querySelector('input[name="name"]');
    const descInputAfter = parent.querySelector('textarea[name="description"]');
    expect(nameInputAfter.value).toBe('Anchor-1000');
    expect(descInputAfter.value).toBe('desc-1000');
  });

  it('duplicates selected anchor at current time', async () => {
    const feature = createFeature([
      createProperty(1000, 1300, 'Base-1000', 'desc-base'),
      createProperty(1300, null, 'Future-1300', 'desc-future')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1200));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();

    const futureAnchorButton = getButtonByIncludedText(parent, 'Future-1300');
    futureAnchorButton.click();

    const duplicateButton = getButtonByText(parent, '現在時刻へ複製');
    duplicateButton.click();
    await flushAsync();

    expect(editingViewModel.updateFeatureProperties).toHaveBeenCalledTimes(1);
    const [featureId, payload] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(featureId).toBe('feature-1');
    expect(payload.editTime.year).toBe(1200);
    expect(payload.startTime.year).toBe(1200);
    expect(payload.name).toBe('Future-1300');
    expect(payload.description).toBe('desc-future');
  });

  it('rejects duplicate when an anchor already exists at current time', async () => {
    const feature = createFeature([
      createProperty(1000, 1100, 'Anchor-1000'),
      createProperty(1100, null, 'Anchor-1100')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1100));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();

    const duplicateButton = getButtonByText(parent, '現在時刻へ複製');
    duplicateButton.click();
    await flushAsync();

    expect(editingViewModel.updateFeatureProperties).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][0]).toContain('現在時刻には既に履歴アンカー');
  });

  it('deletes middle anchor and bridges previous end to next anchor', async () => {
    const feature = createFeature([
      createProperty(1000, 1100, 'Anchor-1000'),
      createProperty(1100, 1300, 'Anchor-1100'),
      createProperty(1300, null, 'Anchor-1300')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1100));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();

    const middleAnchor = getButtonByIncludedText(parent, 'Anchor-1100');
    middleAnchor.click();

    const deleteAnchorButton = getButtonByText(parent, '選択アンカー削除');
    deleteAnchorButton.click();
    await flushAsync();

    const [, updatedAnchors] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(Array.isArray(updatedAnchors)).toBe(true);
    expect(updatedAnchors.map(anchor => anchor.startTime.year)).toEqual([1000, 1300]);
    expect(updatedAnchors[0].endTime.equals(new TimePoint(1300))).toBe(true);
  });

  it('keeps gap when deleting anchor after an explicit non-bridging end time', async () => {
    const feature = createFeature([
      createProperty(1000, 1050, 'Anchor-1000'),
      createProperty(1100, 1300, 'Anchor-1100'),
      createProperty(1300, null, 'Anchor-1300')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1100));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();
    getButtonByIncludedText(parent, 'Anchor-1100').click();
    getButtonByText(parent, '選択アンカー削除').click();
    await flushAsync();

    const [, updatedAnchors] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(updatedAnchors[0].endTime.equals(new TimePoint(1050))).toBe(true);
    expect(updatedAnchors[1].startTime.equals(new TimePoint(1300))).toBe(true);
  });

  it('deletes first anchor', async () => {
    const feature = createFeature([
      createProperty(1000, 1100, 'Anchor-1000'),
      createProperty(1100, 1300, 'Anchor-1100'),
      createProperty(1300, null, 'Anchor-1300')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1100));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();
    getButtonByIncludedText(parent, 'Anchor-1000').click();
    getButtonByText(parent, '選択アンカー削除').click();
    await flushAsync();

    const [, updatedAnchors] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(updatedAnchors.map(anchor => anchor.startTime.year)).toEqual([1100, 1300]);
  });

  it('deletes last anchor and normalizes previous end time to open-ended', async () => {
    const feature = createFeature([
      createProperty(1000, 1100, 'Anchor-1000'),
      createProperty(1100, 1300, 'Anchor-1100'),
      createProperty(1300, null, 'Anchor-1300')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1300));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();
    getButtonByIncludedText(parent, 'Anchor-1300').click();
    getButtonByText(parent, '選択アンカー削除').click();
    await flushAsync();

    const [, updatedAnchors] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(updatedAnchors.map(anchor => anchor.startTime.year)).toEqual([1000, 1100]);
    expect(updatedAnchors[1].endTime).toBeNull();
  });

  it('shows save failure message when timeline validation rejects end time', async () => {
    const feature = createFeature([
      createProperty(1000, 1300, 'Anchor-1000'),
      createProperty(1300, null, 'Anchor-1300')
    ]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1100));
    const editingViewModel = createEditingViewModelMock();
    editingViewModel.updateFeatureProperties.mockRejectedValueOnce(
      new Error('存在終了は次の歴史の錨の開始時刻を超えられません。')
    );
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();
    const endYearInput = parent.querySelector('input[name="endYear"]');
    endYearInput.value = '1400';

    const saveButton = getButtonByText(parent, '保存');
    saveButton.click();
    await flushAsync();

    expect(editingViewModel.updateFeatureProperties).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'プロパティの保存に失敗: 存在終了は次の歴史の錨の開始時刻を超えられません。'
    );
  });

  it('retries save with conflict resolutions selected in dialog', async () => {
    const featureA = globalThis.createAnchoredPoint('feature-1', ['v1'], [
      createProperty(1000, 1200, 'A-1000'),
      createProperty(1200, null, 'A-1200')
    ], 'layer-1');
    const featureB = globalThis.createAnchoredPoint('feature-2', ['v2'], [
      createProperty(1000, null, 'B-1000')
    ], 'layer-1');
    const world = {
      features: [featureA, featureB],
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 1, y: 1 }
      ],
      layers: [{ id: 'layer-1', name: 'Layer', order: 0, visible: true, opacity: 1 }]
    };

    const mapViewModel = {
      getSelectionContextFeature: () => featureA,
      getSelectedFeatureIds: () => new Set([featureA.id]),
      getSelectedVertexIds: () => new Set(),
      getVertexSelectionOwnerIds: () => new Set(),
      getCurrentTime: () => new TimePoint(1100),
      getCalendarConfig: () => ({ monthsPerYear: 12 }),
      getDaysInMonth: () => 31,
      createTimePoint: (year, month = null, day = null) => new TimePoint(year, month, day),
      getFeatures: () => [featureA, featureB],
      getWorld: () => world
    };

    const conflictError = new Error('同一レイヤー上の面情報が重なっています。解決方針を指定してください。');
    conflictError.code = 'FEATURE_ANCHOR_CONFLICTS';
    conflictError.conflicts = [{
      id: 'polygon-overlap:feature-1::feature-2:1100:null:null',
      timeLabel: '1100',
      featureIdA: 'feature-1',
      featureIdB: 'feature-2'
    }];
    const editingViewModel = {
      updateFeatureProperties: vi.fn()
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce(featureA),
      deleteFeature: vi.fn(async () => {})
    };
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();
    const endYearInput = parent.querySelector('input[name="endYear"]');
    endYearInput.value = '1300';

    const saveButton = getButtonByText(parent, '保存');
    saveButton.click();
    await flushAsync();

    const dialog = document.querySelector('.anchor-conflict-resolution-dialog');
    expect(dialog).not.toBeNull();
    const preferredRadio = dialog.querySelector('input[type="radio"][value="feature-1"]');
    preferredRadio.click();
    const applyButton = [...dialog.querySelectorAll('button')]
      .find(button => button.textContent.includes('解決を適用'));
    applyButton.click();
    await flushAsync();

    expect(editingViewModel.updateFeatureProperties).toHaveBeenCalledTimes(2);
    const secondPayload = editingViewModel.updateFeatureProperties.mock.calls[1][1];
    expect(secondPayload.conflictResolutions).toEqual({
      'polygon-overlap:feature-1::feature-2:1100:null:null': { preferFeatureId: 'feature-1' }
    });
    expect(alertSpy).toHaveBeenCalledWith('プロパティを保存しました。');
  });

  it('keeps conflict apply disabled until all conflicts are selected', async () => {
    const featureA = globalThis.createAnchoredPoint('feature-1', ['v1'], [createProperty(1000, null, 'A')], 'layer-1');
    const featureB = globalThis.createAnchoredPoint('feature-2', ['v2'], [createProperty(1000, null, 'B')], 'layer-1');
    const featureC = globalThis.createAnchoredPoint('feature-3', ['v3'], [createProperty(1000, null, 'C')], 'layer-1');
    const world = {
      features: [featureA, featureB, featureC],
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 1, y: 1 },
        { id: 'v3', x: 2, y: 2 }
      ],
      layers: [{ id: 'layer-1', name: 'Layer', order: 0, visible: true, opacity: 1 }]
    };
    const mapViewModel = {
      getSelectionContextFeature: () => featureA,
      getSelectedFeatureIds: () => new Set([featureA.id]),
      getSelectedVertexIds: () => new Set(),
      getVertexSelectionOwnerIds: () => new Set(),
      getCurrentTime: () => new TimePoint(1100),
      getCalendarConfig: () => ({ monthsPerYear: 12 }),
      getDaysInMonth: () => 31,
      createTimePoint: (year, month = null, day = null) => new TimePoint(year, month, day),
      getFeatures: () => [featureA, featureB, featureC],
      getWorld: () => world
    };
    const conflictError = new Error('同一レイヤー上の面情報が重なっています。解決方針を指定してください。');
    conflictError.code = 'FEATURE_ANCHOR_CONFLICTS';
    conflictError.conflicts = [
      { id: 'conflict-1', timeLabel: '1100', featureIdA: 'feature-1', featureIdB: 'feature-2' },
      { id: 'conflict-2', timeLabel: '1200', featureIdA: 'feature-1', featureIdB: 'feature-3' }
    ];
    const editingViewModel = {
      updateFeatureProperties: vi.fn()
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce(featureA),
      deleteFeature: vi.fn(async () => {})
    };
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();
    getButtonByText(parent, '保存').click();
    await flushAsync();

    const dialog = document.querySelector('.anchor-conflict-resolution-dialog');
    const applyButton = dialog.querySelector('button[data-action="confirm"]');
    expect(applyButton.disabled).toBe(true);

    dialog.querySelector('input[name="conflict-conflict-1"][value="feature-1"]').click();
    expect(applyButton.disabled).toBe(true);

    dialog.querySelector('input[name="conflict-conflict-2"][value="feature-1"]').click();
    expect(applyButton.disabled).toBe(false);

    applyButton.click();
    await flushAsync();

    expect(editingViewModel.updateFeatureProperties).toHaveBeenCalledTimes(2);
    const secondPayload = editingViewModel.updateFeatureProperties.mock.calls[1][1];
    expect(secondPayload.conflictResolutions).toEqual({
      'conflict-1': { preferFeatureId: 'feature-1' },
      'conflict-2': { preferFeatureId: 'feature-1' }
    });
  });

  it('cancels conflict dialog without partial save', async () => {
    const featureA = globalThis.createAnchoredPoint('feature-1', ['v1'], [createProperty(1000, null, 'A')], 'layer-1');
    const featureB = globalThis.createAnchoredPoint('feature-2', ['v2'], [createProperty(1000, null, 'B')], 'layer-1');
    const world = {
      features: [featureA, featureB],
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 1, y: 1 }
      ],
      layers: [{ id: 'layer-1', name: 'Layer', order: 0, visible: true, opacity: 1 }]
    };
    const mapViewModel = {
      getSelectionContextFeature: () => featureA,
      getSelectedFeatureIds: () => new Set([featureA.id]),
      getSelectedVertexIds: () => new Set(),
      getVertexSelectionOwnerIds: () => new Set(),
      getCurrentTime: () => new TimePoint(1100),
      getCalendarConfig: () => ({ monthsPerYear: 12 }),
      getDaysInMonth: () => 31,
      createTimePoint: (year, month = null, day = null) => new TimePoint(year, month, day),
      getFeatures: () => [featureA, featureB],
      getWorld: () => world
    };
    const conflictError = new Error('同一レイヤー上の面情報が重なっています。解決方針を指定してください。');
    conflictError.code = 'FEATURE_ANCHOR_CONFLICTS';
    conflictError.conflicts = [{
      id: 'conflict-cancel',
      timeLabel: '1100',
      featureIdA: 'feature-1',
      featureIdB: 'feature-2'
    }];
    const editingViewModel = {
      updateFeatureProperties: vi.fn().mockRejectedValueOnce(conflictError),
      deleteFeature: vi.fn(async () => {})
    };
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();
    getButtonByText(parent, '保存').click();
    await flushAsync();

    const dialog = document.querySelector('.anchor-conflict-resolution-dialog');
    dialog.querySelector('button[data-action="cancel"]').click();
    await flushAsync();
    await flushAsync();

    expect(document.querySelector('.anchor-conflict-resolution-dialog')).toBeNull();
    expect(editingViewModel.updateFeatureProperties).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('プロパティの保存に失敗: 競合解決をキャンセルしました。');
  });

  it('disables anchor delete when only one anchor exists', () => {
    const feature = createFeature([createProperty(1000, null, 'Only-Anchor')]);
    const mapViewModel = createMapViewModel(feature, new TimePoint(1000));
    const editingViewModel = createEditingViewModelMock();
    const view = new PropertiesTabView(parent, mapViewModel, editingViewModel);

    view.update();

    const deleteAnchorButton = getButtonByText(parent, '選択アンカー削除');
    expect(deleteAnchorButton).not.toBeNull();
    expect(deleteAnchorButton.disabled).toBe(true);
  });
});
