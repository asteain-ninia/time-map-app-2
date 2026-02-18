// Tests authored by Codex.
import { describe, expect, it } from 'vitest';
import { TimePoint } from '../../src/domain/value-objects/TimePoint.js';
import { FeatureAnchor } from '../../src/domain/value-objects/FeatureAnchor.js';
import {
  buildAnchorDeletionPlan,
  getAnchorKey,
  getPropertyStartAnchor,
  sortPropertiesByStart
} from '../../src/presentation/views/sidebar/propertyAnchorUtils.js';

function createAnchor(startYear, endYear, name) {
  const start = new TimePoint(startYear);
  const end = endYear === null ? null : new TimePoint(endYear);
  return new FeatureAnchor({
    id: `anchor-${startYear}`,
    timeRange: { start, end },
    property: { name, description: '', attributes: {} },
    shape: { type: 'Point', vertexId: 'v1' },
    placement: { layerId: 'layer-1' }
  });
}

describe('propertyAnchorUtils', () => {
  it('sorts properties by start anchor', () => {
    const p1300 = createAnchor(1300, null, 'C');
    const p1000 = createAnchor(1000, 1100, 'A');
    const p1100 = createAnchor(1100, 1300, 'B');

    const sorted = sortPropertiesByStart([p1300, p1000, p1100]);
    expect(sorted.map(property => getPropertyStartAnchor(property).year)).toEqual([1000, 1100, 1300]);
  });

  it('deletes a middle anchor and bridges the previous end time', () => {
    const p1000 = createAnchor(1000, 1100, 'A');
    const p1100 = createAnchor(1100, 1300, 'B');
    const p1300 = createAnchor(1300, null, 'C');

    const deletionPlan = buildAnchorDeletionPlan(
      [p1000, p1100, p1300],
      getAnchorKey(new TimePoint(1100))
    );

    const years = deletionPlan.updatedAnchors.map(property => getPropertyStartAnchor(property).year);
    expect(years).toEqual([1000, 1300]);
    expect(deletionPlan.updatedAnchors[0].endTime.equals(new TimePoint(1300))).toBe(true);
    expect(deletionPlan.nextSelectionKey).toBe(getAnchorKey(new TimePoint(1300)));
  });

  it('keeps explicit gap when previous end time is before deleted anchor start', () => {
    const p1000 = createAnchor(1000, 1050, 'A');
    const p1100 = createAnchor(1100, 1300, 'B');
    const p1300 = createAnchor(1300, null, 'C');

    const deletionPlan = buildAnchorDeletionPlan(
      [p1000, p1100, p1300],
      getAnchorKey(new TimePoint(1100))
    );

    expect(deletionPlan.updatedAnchors[0].endTime.equals(new TimePoint(1050))).toBe(true);
    expect(deletionPlan.updatedAnchors[1].startTime.equals(new TimePoint(1300))).toBe(true);
  });

  it('deletes the first anchor without rewriting the next anchors', () => {
    const p1000 = createAnchor(1000, 1100, 'A');
    const p1100 = createAnchor(1100, 1300, 'B');
    const p1300 = createAnchor(1300, null, 'C');

    const deletionPlan = buildAnchorDeletionPlan(
      [p1000, p1100, p1300],
      getAnchorKey(new TimePoint(1000))
    );

    expect(deletionPlan.updatedAnchors.map(property => property.startTime.year)).toEqual([1100, 1300]);
    expect(deletionPlan.updatedAnchors[0].endTime.equals(new TimePoint(1300))).toBe(true);
  });

  it('deletes the last anchor and normalizes previous end to null', () => {
    const p1000 = createAnchor(1000, 1100, 'A');
    const p1100 = createAnchor(1100, 1300, 'B');
    const p1300 = createAnchor(1300, null, 'C');

    const deletionPlan = buildAnchorDeletionPlan(
      [p1000, p1100, p1300],
      getAnchorKey(new TimePoint(1300))
    );

    expect(deletionPlan.updatedAnchors.map(property => property.startTime.year)).toEqual([1000, 1100]);
    expect(deletionPlan.updatedAnchors[1].endTime).toBeNull();
  });

  it('rejects deleting the final remaining anchor', () => {
    const only = createAnchor(1000, null, 'only');
    expect(() => buildAnchorDeletionPlan([only], getAnchorKey(new TimePoint(1000)))).toThrow(/最後の履歴アンカー/);
  });
});
