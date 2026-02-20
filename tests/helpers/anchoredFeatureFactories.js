import { Feature } from "../../src/domain/entities/Feature.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";

function requireAnchors(featureId, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error(`Feature ${featureId} requires non-empty anchors in tests.`);
  }
  for (const anchor of anchors) {
    if (!(anchor instanceof FeatureAnchor)) {
      throw new Error(`Feature ${featureId} test helper requires FeatureAnchor instances.`);
    }
  }
  return anchors;
}

function prepareFeatureAnchors(featureId, primaryAnchors, fallbackAnchors = null) {
  if (Array.isArray(fallbackAnchors) && fallbackAnchors.length > 0) {
    return requireAnchors(featureId, fallbackAnchors);
  }
  return requireAnchors(featureId, primaryAnchors);
}

function cloneRing(ring) {
  return {
    id: ring.id,
    vertexIds: [...ring.vertexIds],
    ringType: ring.ringType,
    parentId: ring.parentId ?? null
  };
}

function normalizePointAnchor(anchor, vertexId, layerId) {
  const shape = anchor.shape && typeof anchor.shape === "object" ? anchor.shape : {};
  const placement = anchor.placement && typeof anchor.placement === "object" ? anchor.placement : {};
  return anchor
    .withShape({
      type: "Point",
      vertexId: typeof shape.vertexId === "string" ? shape.vertexId : vertexId
    })
    .withPlacement({
      ...placement,
      layerId: typeof placement.layerId === "string" ? placement.layerId : layerId
    });
}

function normalizeLineAnchor(anchor, vertexIds, layerId) {
  const shape = anchor.shape && typeof anchor.shape === "object" ? anchor.shape : {};
  const placement = anchor.placement && typeof anchor.placement === "object" ? anchor.placement : {};
  return anchor
    .withShape({
      type: "LineString",
      vertexIds: Array.isArray(shape.vertexIds) && shape.vertexIds.length > 0
        ? [...shape.vertexIds]
        : [...vertexIds]
    })
    .withPlacement({
      ...placement,
      layerId: typeof placement.layerId === "string" ? placement.layerId : layerId
    });
}

function normalizePolygonAnchor(anchor, rings, layerId, parentId, childIds) {
  const shape = anchor.shape && typeof anchor.shape === "object" ? anchor.shape : {};
  const placement = anchor.placement && typeof anchor.placement === "object" ? anchor.placement : {};
  return anchor
    .withShape({
      type: "Polygon",
      rings: Array.isArray(shape.rings) && shape.rings.length > 0
        ? shape.rings.map(ring => cloneRing(ring))
        : rings.map(ring => cloneRing(ring))
    })
    .withPlacement({
      ...placement,
      layerId: typeof placement.layerId === "string" ? placement.layerId : layerId,
      parentId: placement.parentId ?? parentId,
      childIds: Array.isArray(placement.childIds) ? [...placement.childIds] : [...childIds]
    });
}

export function createAnchoredFeature(id, vertexIds, anchors, layerId, anchorsOverride = null) {
  const preparedAnchors = prepareFeatureAnchors(id, anchors, anchorsOverride);
  return new Feature(id, vertexIds, [], layerId, preparedAnchors);
}

export function createAnchoredPoint(id, vertexIds, anchors, layerId, anchorsOverride = null) {
  const preparedVertexIds = Array.isArray(vertexIds) ? [...vertexIds] : [];
  const preparedAnchors = prepareFeatureAnchors(id, anchors, anchorsOverride)
    .map(anchor => normalizePointAnchor(anchor, preparedVertexIds[0], layerId));
  return new Point(id, preparedVertexIds, [], layerId, preparedAnchors);
}

export function createAnchoredLine(id, vertexIds, anchors, layerId, anchorsOverride = null) {
  const preparedVertexIds = Array.isArray(vertexIds) ? [...vertexIds] : [];
  const preparedAnchors = prepareFeatureAnchors(id, anchors, anchorsOverride)
    .map(anchor => normalizeLineAnchor(anchor, preparedVertexIds, layerId));
  return new Line(id, preparedVertexIds, [], layerId, preparedAnchors);
}

export function createAnchoredPolygon(
  id,
  anchors,
  layerId,
  parentId = "0",
  childIds = [],
  rings = [],
  anchorsOverride = null
) {
  const preparedRings = (rings || []).map(ring => cloneRing(ring));
  const preparedChildIds = Array.isArray(childIds) ? [...childIds] : [];
  const preparedAnchors = prepareFeatureAnchors(id, anchors, anchorsOverride)
    .map(anchor => normalizePolygonAnchor(anchor, preparedRings, layerId, parentId, preparedChildIds));
  return new Polygon(
    id,
    [],
    layerId,
    parentId,
    preparedChildIds,
    preparedRings,
    preparedAnchors
  );
}
