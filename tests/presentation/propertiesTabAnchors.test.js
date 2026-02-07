// Tests authored by Codex.
/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertiesTabView } from '../../src/presentation/views/sidebar/PropertiesTabView.js';
import { Point } from '../../src/domain/entities/Point.js';
import { Property } from '../../src/domain/value-objects/Property.js';
import { TimePoint } from '../../src/domain/value-objects/TimePoint.js';

function createProperty(startYear, endYear, name, description = '') {
  const start = new TimePoint(startYear);
  const end = endYear === null ? null : new TimePoint(endYear);
  return new Property(start, name, description, {}, start, end);
}

function createFeature(properties) {
  return new Point('feature-1', ['v1'], properties, 'layer-1');
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

    const [, updatedProperties] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(Array.isArray(updatedProperties)).toBe(true);
    expect(updatedProperties.map(property => property.startTime.year)).toEqual([1000, 1300]);
    expect(updatedProperties[0].endTime.equals(new TimePoint(1300))).toBe(true);
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

    const [, updatedProperties] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(updatedProperties[0].endTime.equals(new TimePoint(1050))).toBe(true);
    expect(updatedProperties[1].startTime.equals(new TimePoint(1300))).toBe(true);
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

    const [, updatedProperties] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(updatedProperties.map(property => property.startTime.year)).toEqual([1100, 1300]);
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

    const [, updatedProperties] = editingViewModel.updateFeatureProperties.mock.calls[0];
    expect(updatedProperties.map(property => property.startTime.year)).toEqual([1000, 1100]);
    expect(updatedProperties[1].endTime).toBeNull();
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
