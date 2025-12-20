// src/infrastructure/rendering/RenderStyleProvider.js

/**
 * レイヤーサービスが提供するスタイル情報を取得するヘルパー
 * SVGRenderer から利用されるユーティリティ
 * @param {LayerService} layerService
 * @param {Layer|null} layer
 * @returns {Object}
 */
export function getPointStyle(layerService, layer) {
  return layerService.getLayerStyle(layer, 'point');
}

/**
 * 線のスタイルを取得
 * @param {LayerService} layerService
 * @param {Layer|null} layer
 * @returns {Object}
 */
export function getLineStyle(layerService, layer) {
  return layerService.getLayerStyle(layer, 'line');
}

/**
 * 面のスタイルを取得
 * @param {LayerService} layerService
 * @param {Layer|null} layer
 * @returns {Object}
 */
export function getPolygonStyle(layerService, layer) {
  return layerService.getLayerStyle(layer, 'polygon');
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
  linePreviewHole: { stroke: '#ff00ff', strokeWidth: 4, strokeDasharray: '5,5' },
  linePreviewEnclave: { stroke: '#ff8800', strokeWidth: 4, strokeDasharray: '5,5' },
  linePreviewPending: { stroke: '#aaaaaa', strokeWidth: 4, strokeDasharray: '5,5' },
  measurePoint: { fill: '#ffff00', radius: 5, stroke: '#000000', strokeWidth: 1 },
  measureLine: { stroke: '#ffff00', strokeWidth: 3, strokeDasharray: '' },
  greatCircleLine: { stroke: '#ff5500', strokeWidth: 1, strokeDasharray: '2,2' },
  measureLabel: { fontSize: 11, textColor: '#000000', textAnchor: 'middle', dominantBaseline: 'hanging' },
  measureSegmentLabel: { fontSize: 10, textColor: '#333300', textAnchor: 'middle', dominantBaseline: 'alphabetic' },
  totalLabel: { fontSize: 11, textColor: '#000000', textAnchor: 'start', dominantBaseline: 'hanging' },
};
