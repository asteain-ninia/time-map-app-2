import {
  createAnchoredFeature,
  createAnchoredPoint,
  createAnchoredLine,
  createAnchoredPolygon
} from "./helpers/anchoredFeatureFactories.js";

globalThis.createAnchoredFeature = createAnchoredFeature;
globalThis.createAnchoredPoint = createAnchoredPoint;
globalThis.createAnchoredLine = createAnchoredLine;
globalThis.createAnchoredPolygon = createAnchoredPolygon;
