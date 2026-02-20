// src\infrastructure\persistence\JSONSerializer.js

import { Point } from '../../domain/entities/Point';
import { Line } from '../../domain/entities/Line';
import { Polygon } from '../../domain/entities/Polygon';
import { Layer } from '../../domain/entities/Layer';
import { TimePoint } from '../../domain/value-objects/TimePoint';
import { FeatureAnchor } from '../../domain/value-objects/FeatureAnchor';

// プロジェクト固有設定のデフォルト値 (JSONWorldRepository._createEmptyWorld と同期)
const DEFAULT_PROJECT_SETTINGS = {
  zoomMin: 1,
  zoomMax: 50,
  equatorLength: 40000,
  gridInterval: 10,
  gridColor: '#cccccc',
  gridOpacity: 0.5,
  sliderMin: 0,
  sliderMax: 10000,
  autoSaveInterval: 300
};

const DEFAULT_RENDERING_SETTINGS = {
  minLabelScreenRatio: 0.0005
};

const FILE_VERSION = '3.0-feature-anchor';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * JSON形式でのデータシリアライズ/デシリアライズ
 */
export class JSONSerializer {
  /**
   * ドメインオブジェクトをJSONにシリアライズ
   * @param {Object} world - 世界データ
   * @returns {string} JSONデータ
   */
  serialize(world) {
    const data = {
      version: FILE_VERSION,
      layers: (world.layers || []).map(layer => this._serializeLayer(layer)),
      vertices: (world.vertices || []).map(vertex => this._serializeVertex(vertex)),
      features: (world.features || []).map(feature => this._serializeFeature(feature)),
      metadata: world.metadata || {}
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * JSONからドメインオブジェクトをデシリアライズ
   * @param {string} json - JSONデータ
   * @returns {Object} 世界データ
   */
  deserialize(json) {
    const data = JSON.parse(json);
    if (data.version !== FILE_VERSION) {
      throw new Error(
        `Unsupported world format version: ${data.version}. Expected ${FILE_VERSION}.`
      );
    }

    const metadata = this._withMetadataDefaults(data.metadata || {});

    return {
      layers: (data.layers || []).map(layer => this._deserializeLayer(layer)),
      vertices: (data.vertices || []).map(vertex => this._deserializeVertex(vertex)),
      features: (data.features || []).map(feature => this._deserializeFeature(feature)),
      metadata
    };
  }

  _withMetadataDefaults(metadata) {
    const cloned = deepClone(metadata || {});
    if (!cloned.settings || typeof cloned.settings !== 'object') {
      cloned.settings = {};
    }

    if (cloned.sliderMin !== undefined && cloned.settings.sliderMin === undefined) {
      cloned.settings.sliderMin = cloned.sliderMin;
      delete cloned.sliderMin;
    }
    if (cloned.sliderMax !== undefined && cloned.settings.sliderMax === undefined) {
      cloned.settings.sliderMax = cloned.sliderMax;
      delete cloned.sliderMax;
    }

    for (const key in DEFAULT_PROJECT_SETTINGS) {
      if (cloned.settings[key] === undefined) {
        cloned.settings[key] = DEFAULT_PROJECT_SETTINGS[key];
      }
    }

    if (!cloned.settings.rendering || typeof cloned.settings.rendering !== 'object') {
      cloned.settings.rendering = { ...DEFAULT_RENDERING_SETTINGS };
    } else {
      for (const key in DEFAULT_RENDERING_SETTINGS) {
        if (cloned.settings.rendering[key] === undefined) {
          cloned.settings.rendering[key] = DEFAULT_RENDERING_SETTINGS[key];
        }
      }
    }

    return cloned;
  }

  _serializeVertex(vertex) {
    return {
      id: vertex.id,
      x: vertex.x,
      y: vertex.y
    };
  }

  _deserializeVertex(data) {
    return {
      id: data.id,
      x: data.x,
      y: data.y
    };
  }

  _serializeTimePoint(timePoint) {
    const result = {
      year: timePoint.year
    };
    if (timePoint.month !== null && timePoint.month !== undefined) {
      result.month = timePoint.month;
    }
    if (timePoint.day !== null && timePoint.day !== undefined) {
      result.day = timePoint.day;
    }
    return result;
  }

  _deserializeTimePoint(data) {
    if (!data || data.year === undefined || data.year === null) {
      throw new Error('TimePoint が不正です。');
    }
    return new TimePoint(
      data.year,
      data.month !== undefined ? data.month : null,
      data.day !== undefined ? data.day : null
    );
  }

  _serializeLayer(layer) {
    return {
      id: layer.id,
      name: layer.name,
      order: layer.order,
      visible: layer.visible,
      opacity: layer.opacity,
      description: layer.description
    };
  }

  _deserializeLayer(data) {
    return new Layer(
      data.id,
      data.name,
      data.order,
      data.visible !== undefined ? data.visible : true,
      data.opacity !== undefined ? data.opacity : 1.0,
      data.description || ''
    );
  }

  _serializeFeature(feature) {
    if (feature instanceof Point) {
      const fallbackShape = { type: 'Point', vertexId: feature.vertexId };
      const fallbackPlacement = { layerId: feature.layerId };
      return {
        id: feature.id,
        featureType: 'Point',
        anchors: this._serializeFeatureAnchors(feature, fallbackShape, fallbackPlacement)
      };
    }

    if (feature instanceof Line) {
      const fallbackShape = { type: 'LineString', vertexIds: [...feature.vertexIds] };
      const fallbackPlacement = { layerId: feature.layerId };
      return {
        id: feature.id,
        featureType: 'Line',
        anchors: this._serializeFeatureAnchors(feature, fallbackShape, fallbackPlacement)
      };
    }

    if (feature instanceof Polygon) {
      const fallbackShape = {
        type: 'Polygon',
        rings: (feature.rings || []).map(ring => ({
          id: ring.id,
          vertexIds: [...ring.vertexIds],
          ringType: ring.ringType,
          parentId: ring.parentId ?? null
        }))
      };
      const fallbackPlacement = {
        layerId: feature.layerId,
        parentId: feature.parentId,
        childIds: [...feature.childIds]
      };
      return {
        id: feature.id,
        featureType: 'Polygon',
        anchors: this._serializeFeatureAnchors(feature, fallbackShape, fallbackPlacement)
      };
    }

    throw new Error(`Unsupported feature type for serialization: ${feature?.constructor?.name}`);
  }

  _serializeFeatureAnchors(feature, fallbackShape, fallbackPlacement) {
    const anchors = Array.isArray(feature.anchors) ? feature.anchors : [];
    if (anchors.length === 0) {
      throw new Error(`Feature ${feature?.id ?? '(unknown)'} に anchors が存在しません。`);
    }

    return anchors.map(anchor => this._serializeFeatureAnchor(anchor));
  }

  _serializeFeatureAnchor(anchor) {
    const timeRange = {
      start: this._serializeTimePoint(anchor.startTime)
    };
    if (anchor.endTime) {
      timeRange.end = this._serializeTimePoint(anchor.endTime);
    }
    return {
      id: anchor.id,
      timeRange,
      property: {
        name: anchor.name,
        description: anchor.description,
        attributes: anchor.getAttributes()
      },
      shape: deepClone(anchor.shape || {}),
      placement: deepClone(anchor.placement || {})
    };
  }

  _deserializeFeature(featureData) {
    if (!featureData || typeof featureData !== 'object') {
      throw new Error('Feature データの形式が不正です。');
    }
    if (typeof featureData.id !== 'string' || featureData.id.trim() === '') {
      throw new Error('Feature.id が不正です。');
    }
    if (!Array.isArray(featureData.anchors) || featureData.anchors.length === 0) {
      throw new Error(`Feature ${featureData.id} に anchors が存在しません。`);
    }

    const anchors = featureData.anchors.map(anchorData => this._deserializeFeatureAnchor(anchorData));
    const latestAnchor = anchors[anchors.length - 1];

    if (featureData.featureType === 'Point') {
      const vertexId = latestAnchor.shape?.type === 'Point'
        ? latestAnchor.shape.vertexId
        : null;
      if (typeof vertexId !== 'string') {
        throw new Error(`Point ${featureData.id} の shape.vertexId が不正です。`);
      }
      const layerId = typeof latestAnchor.placement?.layerId === 'string'
        ? latestAnchor.placement.layerId
        : '';
      return new Point(featureData.id, [vertexId], [], layerId, anchors);
    }

    if (featureData.featureType === 'Line') {
      const vertexIds = latestAnchor.shape?.type === 'LineString' && Array.isArray(latestAnchor.shape.vertexIds)
        ? latestAnchor.shape.vertexIds
        : null;
      if (!Array.isArray(vertexIds) || vertexIds.length < 2) {
        throw new Error(`Line ${featureData.id} の shape.vertexIds が不正です。`);
      }
      const layerId = typeof latestAnchor.placement?.layerId === 'string'
        ? latestAnchor.placement.layerId
        : '';
      return new Line(featureData.id, [...vertexIds], [], layerId, anchors);
    }

    if (featureData.featureType === 'Polygon') {
      const rings = latestAnchor.shape?.type === 'Polygon' && Array.isArray(latestAnchor.shape.rings)
        ? latestAnchor.shape.rings.map(ring => ({
          id: ring.id,
          vertexIds: [...ring.vertexIds],
          ringType: ring.ringType,
          parentId: ring.parentId ?? null
        }))
        : [];
      const layerId = typeof latestAnchor.placement?.layerId === 'string'
        ? latestAnchor.placement.layerId
        : '';
      const parentId = typeof latestAnchor.placement?.parentId === 'string'
        ? latestAnchor.placement.parentId
        : '0';
      const childIds = Array.isArray(latestAnchor.placement?.childIds)
        ? [...latestAnchor.placement.childIds]
        : [];
      return new Polygon(featureData.id, [], layerId, parentId, childIds, rings, anchors);
    }

    throw new Error(`Unsupported featureType: ${featureData.featureType}`);
  }

  _deserializeFeatureAnchor(anchorData) {
    if (!anchorData || typeof anchorData !== 'object') {
      throw new Error('FeatureAnchor データの形式が不正です。');
    }
    return new FeatureAnchor({
      id: anchorData.id,
      timeRange: {
        start: this._deserializeTimePoint(anchorData.timeRange?.start),
        end: anchorData.timeRange?.end ? this._deserializeTimePoint(anchorData.timeRange.end) : null
      },
      property: {
        name: anchorData.property?.name,
        description: anchorData.property?.description,
        attributes: anchorData.property?.attributes || {}
      },
      shape: anchorData.shape || {},
      placement: anchorData.placement || {}
    });
  }
}
