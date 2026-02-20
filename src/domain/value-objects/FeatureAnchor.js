import { TimePoint } from './TimePoint.js';

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map(item => deepClone(item));
  }
  if (value && typeof value === 'object') {
    const cloned = {};
    Object.entries(value).forEach(([key, child]) => {
      cloned[key] = deepClone(child);
    });
    return cloned;
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    value.forEach(item => deepFreeze(item));
    return Object.freeze(value);
  }
  Object.values(value).forEach(item => deepFreeze(item));
  return Object.freeze(value);
}

function normalizeProperty(property) {
  if (!property || typeof property !== 'object') {
    return { name: '', description: '', attributes: {} };
  }
  return {
    name: typeof property.name === 'string' ? property.name : '',
    description: typeof property.description === 'string' ? property.description : '',
    attributes: property.attributes && typeof property.attributes === 'object'
      ? deepClone(property.attributes)
      : {}
  };
}

export class FeatureAnchor {
  /**
   * @param {{
   *   id: string,
   *   timeRange: { start: TimePoint, end?: TimePoint | null },
   *   property: { name?: string, description?: string, attributes?: Object },
   *   shape: Object,
   *   placement: Object
   * }} data
   */
  constructor(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('FeatureAnchor の形式が不正です。');
    }
    if (typeof data.id !== 'string' || data.id.trim() === '') {
      throw new Error('FeatureAnchor.id は必須です。');
    }
    const timeRange = data.timeRange || {};
    if (!(timeRange.start instanceof TimePoint)) {
      throw new Error('FeatureAnchor.timeRange.start は TimePoint で指定してください。');
    }
    if (timeRange.end !== undefined && timeRange.end !== null && !(timeRange.end instanceof TimePoint)) {
      throw new Error('FeatureAnchor.timeRange.end は TimePoint で指定してください。');
    }
    if (timeRange.end instanceof TimePoint && !timeRange.start.isBefore(timeRange.end)) {
      throw new Error('FeatureAnchor の終了時刻は開始時刻より後である必要があります。');
    }

    this._id = data.id.trim();
    this._startTime = timeRange.start;
    this._endTime = timeRange.end ?? null;

    const normalizedProperty = normalizeProperty(data.property);
    this._name = normalizedProperty.name;
    this._description = normalizedProperty.description;
    this._attributes = deepFreeze(normalizedProperty.attributes);

    this._shape = deepFreeze(deepClone(data.shape || {}));
    this._placement = deepFreeze(deepClone(data.placement || {}));

    Object.freeze(this);
  }

  get id() {
    return this._id;
  }

  get startTime() {
    return this._startTime;
  }

  get endTime() {
    return this._endTime;
  }

  get name() {
    return this._name;
  }

  get description() {
    return this._description;
  }

  get shape() {
    return this._shape;
  }

  get placement() {
    return this._placement;
  }

  getAttributes() {
    return deepClone(this._attributes);
  }

  isActiveAt(timePoint) {
    if (!(timePoint instanceof TimePoint)) {
      return false;
    }
    if (timePoint.isBefore(this._startTime)) {
      return false;
    }
    if (this._endTime && !timePoint.isBefore(this._endTime)) {
      return false;
    }
    return true;
  }

  withTimeRange(startTime, endTime) {
    return new FeatureAnchor({
      id: this._id,
      timeRange: { start: startTime, end: endTime },
      property: {
        name: this._name,
        description: this._description,
        attributes: this._attributes
      },
      shape: this._shape,
      placement: this._placement
    });
  }

  withProperty(propertyData) {
    const merged = {
      name: this._name,
      description: this._description,
      attributes: this._attributes,
      ...(propertyData || {})
    };
    return new FeatureAnchor({
      id: this._id,
      timeRange: { start: this._startTime, end: this._endTime },
      property: merged,
      shape: this._shape,
      placement: this._placement
    });
  }

  withShape(shape) {
    return new FeatureAnchor({
      id: this._id,
      timeRange: { start: this._startTime, end: this._endTime },
      property: {
        name: this._name,
        description: this._description,
        attributes: this._attributes
      },
      shape,
      placement: this._placement
    });
  }

  withPlacement(placement) {
    return new FeatureAnchor({
      id: this._id,
      timeRange: { start: this._startTime, end: this._endTime },
      property: {
        name: this._name,
        description: this._description,
        attributes: this._attributes
      },
      shape: this._shape,
      placement
    });
  }

}
