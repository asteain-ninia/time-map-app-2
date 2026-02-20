import { Feature } from "../../src/domain/entities/Feature.js";
import { Point } from "../../src/domain/entities/Point.js";
import { Line } from "../../src/domain/entities/Line.js";
import { Polygon } from "../../src/domain/entities/Polygon.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";

function toPropertyArray(properties) {
  if (Array.isArray(properties)) {
    return properties.filter(property => property instanceof Property);
  }
  if (properties instanceof Property) {
    return [properties];
  }
  return [];
}

function buildAnchorsFromProperties(featureId, properties, shapeBuilder, placementBuilder) {
  const propertyArray = toPropertyArray(properties);
  if (propertyArray.length === 0) {
    throw new Error(`Feature ${featureId} requires non-empty anchors in tests.`);
  }
  return propertyArray.map((property, index) => {
    const start = property.startTime || property.timePoint || null;
    if (!start) {
      throw new Error(`Feature ${featureId} test helper requires a valid start time.`);
    }
    return new FeatureAnchor({
      id: `anchor-${featureId}-${index + 1}`,
      timeRange: {
        start,
        end: property.endTime || null
      },
      property: {
        name: property.name,
        description: property.description,
        attributes: property.getAttributes ? property.getAttributes() : {}
      },
      shape: shapeBuilder(),
      placement: placementBuilder()
    });
  });
}

function cloneRing(ring) {
  return {
    id: ring.id,
    vertexIds: [...ring.vertexIds],
    ringType: ring.ringType,
    parentId: ring.parentId ?? null
  };
}

export function createAnchoredFeature(id, vertexIds, properties, layerId, anchors = null) {
  const preparedAnchors = Array.isArray(anchors) && anchors.length > 0
    ? anchors
    : buildAnchorsFromProperties(id, properties, () => ({}), () => ({ layerId }));
  return new Feature(id, vertexIds, [], layerId, preparedAnchors);
}

export function createAnchoredPoint(id, vertexIds, properties, layerId, anchors = null) {
  const preparedVertexIds = Array.isArray(vertexIds) ? [...vertexIds] : [];
  const preparedAnchors = Array.isArray(anchors) && anchors.length > 0
    ? anchors
    : buildAnchorsFromProperties(
      id,
      properties,
      () => ({ type: "Point", vertexId: preparedVertexIds[0] }),
      () => ({ layerId })
    );
  return new Point(id, preparedVertexIds, [], layerId, preparedAnchors);
}

export function createAnchoredLine(id, vertexIds, properties, layerId, anchors = null) {
  const preparedVertexIds = Array.isArray(vertexIds) ? [...vertexIds] : [];
  const preparedAnchors = Array.isArray(anchors) && anchors.length > 0
    ? anchors
    : buildAnchorsFromProperties(
      id,
      properties,
      () => ({ type: "LineString", vertexIds: [...preparedVertexIds] }),
      () => ({ layerId })
    );
  return new Line(id, preparedVertexIds, [], layerId, preparedAnchors);
}

export function createAnchoredPolygon(
  id,
  properties,
  layerId,
  parentId = "0",
  childIds = [],
  rings = [],
  anchors = null
) {
  const preparedRings = (rings || []).map(ring => cloneRing(ring));
  const preparedChildIds = Array.isArray(childIds) ? [...childIds] : [];
  const preparedAnchors = Array.isArray(anchors) && anchors.length > 0
    ? anchors
    : buildAnchorsFromProperties(
      id,
      properties,
      () => ({ type: "Polygon", rings: preparedRings.map(ring => cloneRing(ring)) }),
      () => ({ layerId, parentId, childIds: [...preparedChildIds] })
    );
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
