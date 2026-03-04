// src/infrastructure/rendering/RenderStyleProvider.js

/**
 * レンダリングに利用するスタイル情報を取得するヘルパー
 * 仕様上のスタイル責務は Property.attributes.styleOverrides にあるため、
 * レイヤー個別設定は参照せず、型ごとの既定値 + styleOverrides で解決する。
 * SVGRenderer から利用されるユーティリティ
 * @param {LayerService} layerService
 * @param {FeatureAnchor|Object|null} property
 * @returns {Object}
 */
export function getPointStyle(layerService, property) {
  return resolveFeatureStyle(layerService, property, 'point');
}

/**
 * 線のスタイルを取得
 * @param {LayerService} layerService
 * @param {FeatureAnchor|Object|null} property
 * @returns {Object}
 */
export function getLineStyle(layerService, property) {
  return resolveFeatureStyle(layerService, property, 'line');
}

/**
 * 面のスタイルを取得
 * @param {LayerService} layerService
 * @param {FeatureAnchor|Object|null} property
 * @returns {Object}
 */
export function getPolygonStyle(layerService, property) {
  return resolveFeatureStyle(layerService, property, 'polygon');
}

function resolveFeatureStyle(layerService, property, featureType) {
  const baseStyle = layerService.getLayerStyle(featureType);
  const overrides = readStyleOverrides(property, featureType);
  if (!overrides) {
    return baseStyle;
  }
  return { ...baseStyle, ...overrides };
}

function readStyleOverrides(property, featureType) {
  if (!property || typeof property !== 'object') {
    return null;
  }

  let rawOverrides = null;
  if (typeof property.getAttribute === 'function') {
    rawOverrides = property.getAttribute('styleOverrides', null);
  } else if (typeof property.getAttributes === 'function') {
    const attributes = property.getAttributes();
    rawOverrides = isPlainObject(attributes) ? attributes.styleOverrides : null;
  } else if (isPlainObject(property.attributes)) {
    rawOverrides = property.attributes.styleOverrides;
  }

  if (!isPlainObject(rawOverrides)) {
    return null;
  }

  const typedOverrides = rawOverrides[featureType];
  if (isPlainObject(typedOverrides)) {
    return typedOverrides;
  }

  return rawOverrides;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export const editingStyles = {
  normalVertex: { radius: 5, fill: 'rgba(0, 150, 255, 0.5)', stroke: 'rgba(0, 100, 200, 0.7)', strokeWidth: 1 },
  persistentVertex: { radius: 4, fill: 'rgba(0, 60, 120, 0.35)', stroke: 'rgba(255, 255, 255, 0.9)', strokeWidth: 1 },
  selectedPolygonFill: { stroke: 'none', strokeWidth: 0, fill: 'rgba(0, 255, 255, 0.18)', fillRule: 'evenodd' },
  highlightPolygonFill: { stroke: 'none', strokeWidth: 0, fill: 'rgba(0, 136, 170, 0.14)', fillRule: 'evenodd' },
  selectedOutline: { stroke: '#00ffff', strokeWidth: 5, fill: 'none', strokeDasharray: '' },
  selectedPointOutline: { radius: 9, stroke: '#00ffff', strokeWidth: 2, fill: 'none' },
  selectedVertex: { radius: 7, fill: '#0080ff', stroke: '#0000ff', strokeWidth: 3 },
  sharedVertex: { radius: 6, fill: 'rgba(255, 170, 0, 0.55)', stroke: 'rgba(180, 120, 0, 0.85)', strokeWidth: 2 },
  selectedSharedVertex: { radius: 8, fill: '#ffb300', stroke: '#ff6f00', strokeWidth: 3 },
  highlightOutline: { stroke: '#0088aa', strokeWidth: 3, fill: 'none', strokeDasharray: '4,2' },
  dragVertex: { fill: '#ff00ff', radius: 8, stroke: '#ffffff', strokeWidth: 2 },
  dragShareVertex: { fill: '#ffb000', radius: 9, stroke: '#ffffff', strokeWidth: 2 },
  dragOutline: { stroke: '#ff00ff', strokeWidth: 3, fill: 'none', strokeDasharray: '3,3' },
  addingPointPreview: { fill: '#ffffff', radius: 5, stroke: '#000000', strokeWidth: 1 },
  addingToolPoint: { fill: '#ff0000', radius: 7, stroke: '#ffffff', strokeWidth: 2 },
  linePreviewForLine: { stroke: '#0000ff', strokeWidth: 4, strokeDasharray: '5,5' },
  linePreviewForPolygon: { stroke: '#00ff00', strokeWidth: 4, strokeDasharray: '5,5' },
  linePreviewSplit: { stroke: '#ff0055', strokeWidth: 4, strokeDasharray: '6,4' },
  splitCircle: { radius: 40, fill: 'none', stroke: 'rgba(255, 0, 85, 0.8)', strokeWidth: 2 },
  linePreviewHole: { stroke: '#ff00ff', strokeWidth: 4, strokeDasharray: '5,5' },
  linePreviewEnclave: { stroke: '#ff8800', strokeWidth: 4, strokeDasharray: '5,5' },
  linePreviewPending: { stroke: '#aaaaaa', strokeWidth: 4, strokeDasharray: '5,5' },
  splitOverlay: { fill: 'rgba(0, 0, 0, 0.25)', stroke: 'none', strokeWidth: 0, fillRule: 'evenodd' },
  measurePoint: { fill: '#ffff00', radius: 5, stroke: '#000000', strokeWidth: 1 },
  measureLine: { stroke: '#ffff00', strokeWidth: 3, strokeDasharray: '' },
  greatCircleLine: { stroke: '#ff5500', strokeWidth: 1, strokeDasharray: '2,2' },
  measureLabel: { fontSize: 11, textColor: '#000000', textAnchor: 'middle', dominantBaseline: 'hanging' },
  measureSegmentLabel: { fontSize: 10, textColor: '#333300', textAnchor: 'middle', dominantBaseline: 'alphabetic' },
  totalLabel: { fontSize: 11, textColor: '#000000', textAnchor: 'start', dominantBaseline: 'hanging' },
};

export function getVertexHitTolerancePixels() {
  return Math.max(
    readRadius(editingStyles.persistentVertex),
    readRadius(editingStyles.normalVertex),
    readRadius(editingStyles.sharedVertex),
    readRadius(editingStyles.selectedVertex),
    readRadius(editingStyles.selectedSharedVertex),
    1
  );
}

function readRadius(style) {
  return Number.isFinite(style?.radius) ? style.radius : 0;
}
