import { describe, expect, it } from 'vitest';
import { FeatureAnchor } from '../../src/domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../src/domain/value-objects/TimePoint.js';

const createProperty = (startYear, endYear = null, name = 'property') => {
  const start = new TimePoint(startYear);
  const end = endYear !== null ? new TimePoint(endYear) : null;
  return new FeatureAnchor({
    id: `anchor-${name}-${startYear}-${endYear ?? 'null'}`,
    timeRange: { start, end },
    property: { name, description: '', attributes: {} },
    shape: {},
    placement: {}
  });
};

describe('Feature property lookup', () => {
  it('returns the property active at the requested time', () => {
    const early = createProperty(1750, 1800, 'early');
    const mid = createProperty(1850, 1900, 'mid');
    const latest = createProperty(1920, null, 'latest');

    const feature = globalThis.createAnchoredFeature('feature-1', ['vertex-1'], [mid, early, latest], 'layer-1');

    expect(feature.getPropertyAt(new TimePoint(1760)).name).toBe(early.name);
    expect(feature.getPropertyAt(new TimePoint(1855)).name).toBe(mid.name);
    expect(feature.getPropertyAt(new TimePoint(1950)).name).toBe(latest.name);
    expect(feature.getPropertyAt(new TimePoint(1700))).toBeNull();
    expect(feature.getPropertyAt(null).name).toBe(latest.name);
  });

  it('reports existence only when a property covers the given time', () => {
    const bounded = createProperty(1800, 1850, 'bounded');
    const openEnded = createProperty(1850, null, 'open-ended');

    const feature = globalThis.createAnchoredFeature('feature-2', [], [bounded, openEnded], 'layer-1');

    expect(feature.existsAt(new TimePoint(1825))).toBe(true);
    expect(feature.existsAt(new TimePoint(1799))).toBe(false);
    expect(feature.existsAt(new TimePoint(1850))).toBe(true);
    expect(feature.existsAt(new TimePoint(2100))).toBe(true);
  });

  it('requires anchors when creating a feature', () => {
    expect(() =>
      globalThis.createAnchoredFeature('feature-empty', [], [], 'layer-1')
    ).toThrow(/requires non-empty anchors/);
  });
});
