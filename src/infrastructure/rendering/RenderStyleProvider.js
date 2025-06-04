// src/infrastructure/rendering/RenderStyleProvider.js

/**
 * ジオメトリタイプごとのスタイル定義を提供する
 * SVGRenderer から利用されるユーティリティ
 */
export function getPointStyle(property) {
  const categoryStyles = {
    city: {
      radius: 5,
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
    town: {
      radius: 3,
      fill: "#ff3333",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    battle: {
      radius: 4,
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    ruin: {
      radius: 4,
      fill: "#996633",
      stroke: "#000000",
      strokeWidth: 1,
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    // デフォルトスタイル
    default: {
      radius: 4,
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
      strokeWidth: 2,
      strokeDasharray: "",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    railway: {
      stroke: "#333333",
      strokeWidth: 2,
      strokeDasharray: "5,5",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    river: {
      stroke: "#3388ff",
      strokeWidth: 2,
      strokeDasharray: "",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    trade_route: {
      stroke: "#ff8800",
      strokeWidth: 2,
      strokeDasharray: "10,2",
      textColor: "#000000",
      fontSize: 10,
      showLabel: true,
    },
    border: {
      stroke: "#ff0000",
      strokeWidth: 3,
      strokeDasharray: "",
      textColor: "#000000",
      fontSize: 10,
      showLabel: false,
    },
    // デフォルトスタイル
    default: {
      stroke: "#3388ff",
      strokeWidth: 2,
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
      strokeWidth: 2,
      fillOpacity: 0.6,
      textColor: "#000000",
      fontSize: 14,
      showLabel: true,
    },
    empire: {
      fill: "#8888ff",
      stroke: "#0000ff",
      strokeWidth: 2,
      fillOpacity: 0.6,
      textColor: "#000000",
      fontSize: 16,
      showLabel: true,
    },
    province: {
      fill: "#88ff88",
      stroke: "#008800",
      strokeWidth: 2,
      fillOpacity: 0.6,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
    ocean: {
      fill: "#3388ff",
      stroke: "#3388ff",
      strokeWidth: 1,
      fillOpacity: 0.4,
      textColor: "#000000",
      fontSize: 14,
      showLabel: true,
    },
    lake: {
      fill: "#3388ff",
      stroke: "#3388ff",
      strokeWidth: 1,
      fillOpacity: 0.6,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
    // デフォルトスタイル
    default: {
      fill: "#ffcc88",
      stroke: "#ff8800",
      strokeWidth: 2,
      fillOpacity: 0.6,
      textColor: "#000000",
      fontSize: 12,
      showLabel: true,
    },
  };

  const category = property.getAttribute("category", "default");
  return categoryStyles[category] || categoryStyles.default;
}
