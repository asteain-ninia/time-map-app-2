// src/infrastructure/rendering/RenderStyleProvider.js

/**
 * ジオメトリタイプごとのスタイル定義を提供する
 * SVGRenderer から利用されるユーティリティ
 */
export function getPointStyle(property) {
  const categoryStyles = {
    city: {
      radius: 6,
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
    town: {
      radius: 4,
      fill: "#ff3333",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    battle: {
      radius: 5,
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    ruin: {
      radius: 5,
      fill: "#996633",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    // デフォルトスタイル
    default: {
      radius: 5,
      fill: "#3388ff",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
  };

  const category = property.getAttribute("category", "default");
  return categoryStyles[category] || categoryStyles.default;
}

export function getLineStyle(property) {
  const categoryStyles = {
    road: {
      stroke: "#996633",
      strokeWidth: 3,
      strokeDasharray: "",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    railway: {
      stroke: "#333333",
      strokeWidth: 3,
      strokeDasharray: "5,5",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    river: {
      stroke: "#3388ff",
      strokeWidth: 3,
      strokeDasharray: "",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    trade_route: {
      stroke: "#ff8800",
      strokeWidth: 3,
      strokeDasharray: "10,2",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    border: {
      stroke: "#ff0000",
      strokeWidth: 4,
      strokeDasharray: "",
      textColor: "#000000",
      fontSize: 10,
      showLabel: false,
    },
    // デフォルトスタイル
    default: {
      stroke: "#3388ff",
      strokeWidth: 3,
      strokeDasharray: "",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
  };

  const category = property.getAttribute("category", "default");
  return categoryStyles[category] || categoryStyles.default;
}

export function getPolygonStyle(property) {
  const categoryStyles = {
    kingdom: {
      fill: "#ff8888",
      stroke: "#ff0000",
      strokeWidth: 3,
      fillOpacity: 0.7,
      textColor: "#000000",
      fontSize: 14,
      showLabel: true,
    },
    empire: {
      fill: "#8888ff",
      stroke: "#0000ff",
      strokeWidth: 3,
      fillOpacity: 0.7,
      textColor: "#000000",
      fontSize: 16,
      showLabel: true,
    },
    province: {
      fill: "#88ff88",
      stroke: "#008800",
      strokeWidth: 3,
      fillOpacity: 0.7,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
    ocean: {
      fill: "#3388ff",
      stroke: "#3388ff",
      strokeWidth: 2,
      fillOpacity: 0.5,
      textColor: "#000000",
      fontSize: 14,
      showLabel: true,
    },
    lake: {
      fill: "#3388ff",
      stroke: "#3388ff",
      strokeWidth: 2,
      fillOpacity: 0.7,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
    // デフォルトスタイル
    default: {
      fill: "#ffcc88",
      stroke: "#ff8800",
      strokeWidth: 3,
      fillOpacity: 0.7,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
  };

  const category = property.getAttribute("category", "default");
  return categoryStyles[category] || categoryStyles.default;
}

export const editingStyles = {
  normalVertex: { radius: 5, fill: 'rgba(0, 150, 255, 0.5)', stroke: 'rgba(0, 100, 200, 0.7)', strokeWidth: 1 },
  selectedOutline: { stroke: '#00ffff', strokeWidth: 5, fill: 'none', strokeDasharray: '' },
  selectedPointOutline: { radius: 9, stroke: '#00ffff', strokeWidth: 2, fill: 'none' },
  selectedVertex: { radius: 7, fill: '#0080ff', stroke: '#0000ff', strokeWidth: 3 },
  highlightOutline: { stroke: '#0088aa', strokeWidth: 3, fill: 'none', strokeDasharray: '4,2' },
  dragVertex: { fill: '#ff00ff', radius: 8, stroke: '#ffffff', strokeWidth: 2 },
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
