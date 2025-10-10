import { describe, expect, it } from 'vitest';
import { Feature } from '../../src/domain/entities/Feature.js';
import { Property } from '../../src/domain/value-objects/Property.js';
import { TimePoint } from '../../src/domain/value-objects/TimePoint.js';

const createProperty = (startYear, endYear = null, name = 'property') => {
  const start = new TimePoint(startYear);
  const end = endYear !== null ? new TimePoint(endYear) : null;
  return new Property(start, name, '', {}, start, end);
};

describe('Feature property lookup', () => {
  it('returns the property active at the requested time', () => {
    const early = createProperty(1750, 1800, 'early');
    const mid = createProperty(1850, 1900, 'mid');
    const latest = new Property(
      new TimePoint(1920),
      'latest',
      '',
      {},
      new TimePoint(1920),
      null
    );

    const feature = new Feature('feature-1', ['vertex-1'], [mid, early, latest], 'layer-1');

    expect(feature.getPropertyAt(new TimePoint(1760))).toBe(early);
    expect(feature.getPropertyAt(new TimePoint(1855))).toBe(mid);
    expect(feature.getPropertyAt(new TimePoint(1950))).toBe(latest);
    expect(feature.getPropertyAt(new TimePoint(1700))).toBeNull();
    expect(feature.getPropertyAt(null)).toBe(latest);
  });

  it('reports existence only when a property covers the given time', () => {
    const bounded = createProperty(1800, 1850, 'bounded');
    const openEnded = new Property(
      new TimePoint(1850),
      'open-ended',
      '',
      {},
      new TimePoint(1850),
      null
    );

    const feature = new Feature('feature-2', [], [bounded, openEnded], 'layer-1');

    expect(feature.existsAt(new TimePoint(1825))).toBe(true);
    expect(feature.existsAt(new TimePoint(1799))).toBe(false);
    expect(feature.existsAt(new TimePoint(1850))).toBe(true);
    expect(feature.existsAt(new TimePoint(2100))).toBe(true);
  });

  it('creates a default property when none are supplied', () => {
    const feature = new Feature('feature-empty', [], [], 'layer-1');
    const property = feature.getPropertyAt(new TimePoint(10));

    expect(property).toBeInstanceOf(Property);
    expect(property.startTime.year).toBe(0);
    expect(property.endTime).toBeNull();
  });
});
