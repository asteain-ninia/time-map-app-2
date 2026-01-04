import { Polygon } from '../../domain/entities/Polygon.js';

const BOUNDARY_TOLERANCE_SQ = 1e-9;
const EDGE_LENGTH_EPS = 1e-9;

function buildVertexMap(vertices, overrides) {
  const map = new Map();
  if (Array.isArray(vertices)) {
    vertices.forEach(vertex => {
      if (!vertex || typeof vertex.id !== 'string') {
        return;
      }
      map.set(vertex.id, { x: vertex.x, y: vertex.y });
    });
  }
  if (overrides instanceof Map) {
    overrides.forEach((pos, id) => {
      if (!pos) return;
      map.set(id, { x: pos.x, y: pos.y });
    });
  }
  return map;
}

function buildOriginalPositionMap(vertices, overrides) {
  if (overrides instanceof Map) {
    const map = new Map();
    overrides.forEach((pos, id) => {
      if (!pos) return;
      map.set(id, { x: pos.x, y: pos.y });
    });
    return map;
  }
  return buildVertexMap(vertices);
}

function buildPolygonsByLayer(polygons) {
  const map = new Map();
  if (!Array.isArray(polygons)) {
    return map;
  }
  polygons.forEach(polygon => {
    const layerId = polygon?.layerId;
    if (!map.has(layerId)) {
      map.set(layerId, []);
    }
    map.get(layerId).push(polygon);
  });
  return map;
}

function buildEdgesByPolygon(polygons, vertexMap) {
  const edgesByPolygonId = new Map();
  if (!Array.isArray(polygons)) {
    return edgesByPolygonId;
  }
  polygons.forEach(polygon => {
    edgesByPolygonId.set(polygon.id, collectRingEdges(polygon, vertexMap));
  });
  return edgesByPolygonId;
}

function isSameIdSet(left, right) {
  if (!left || !right) return false;
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}

export function createVertexSlidingContext(world) {
  if (!world || !Array.isArray(world.features) || !Array.isArray(world.vertices)) {
    return null;
  }
  const polygons = collectPolygons(world);
  const vertexMap = buildVertexMap(world.vertices);
  return {
    world,
    polygons,
    vertexMap,
    vertexPolygonIndex: buildVertexPolygonIndex(polygons),
    polygonsByLayer: buildPolygonsByLayer(polygons),
    edgesByPolygonId: buildEdgesByPolygon(polygons, vertexMap),
    movedVertexIds: null
  };
}

function collectPolygons(world) {
  if (!world || !Array.isArray(world.features)) {
    return [];
  }
  return world.features.filter(feature => feature instanceof Polygon);
}

function polygonUsesAnyVertex(polygon, vertexIds) {
  if (!polygon || !vertexIds || vertexIds.size === 0) return false;
  if (!Array.isArray(polygon.rings)) return false;
  for (const ring of polygon.rings) {
    if (!Array.isArray(ring.vertexIds)) continue;
    for (const vertexId of ring.vertexIds) {
      if (vertexIds.has(vertexId)) return true;
    }
  }
  return false;
}

function buildVertexPolygonIndex(polygons) {
  const index = new Map();
  polygons.forEach(polygon => {
    if (!Array.isArray(polygon.rings)) return;
    polygon.rings.forEach(ring => {
      if (!Array.isArray(ring.vertexIds)) return;
      ring.vertexIds.forEach(vertexId => {
        if (!index.has(vertexId)) {
          index.set(vertexId, []);
        }
        index.get(vertexId).push(polygon);
      });
    });
  });
  return index;
}

function buildRingVertices(ring, vertexMap) {
  if (!ring || !Array.isArray(ring.vertexIds)) {
    return null;
  }
  const vertices = [];
  for (const vertexId of ring.vertexIds) {
    const vertex = vertexMap.get(vertexId);
    if (!vertex || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
      return null;
    }
    vertices.push(vertex);
  }
  return vertices.length >= 3 ? vertices : null;
}

function classifyPointInPolygon(point, polygon, vertexMap, geometryService) {
  if (!polygon || !Array.isArray(polygon.rings)) {
    return { type: 'outside', ringId: null };
  }

  for (const ring of polygon.rings) {
    const ringVertices = buildRingVertices(ring, vertexMap);
    if (!ringVertices) continue;
    if (geometryService.isPointOnPolygonBoundary(point, ringVertices, BOUNDARY_TOLERANCE_SQ)) {
      return { type: 'outside', ringId: null };
    }
  }

  const insideRings = [];
  for (const ring of polygon.rings) {
    const ringVertices = buildRingVertices(ring, vertexMap);
    if (!ringVertices) continue;
    if (geometryService.isPointInPolygon(point, ringVertices, false)) {
      insideRings.push(ring);
    }
  }

  if (insideRings.length === 0) {
    return { type: 'outside', ringId: null };
  }

  const nestingLevel = insideRings.length;
  const isInsideOuter = nestingLevel % 2 === 1;
  return {
    type: isInsideOuter ? 'inside_outer' : 'inside_hole',
    ringId: insideRings[nestingLevel - 1]?.id || null
  };
}

function collectRingEdges(polygon, vertexMap) {
  const edges = [];
  if (!polygon || !Array.isArray(polygon.rings)) {
    return edges;
  }

  polygon.rings.forEach(ring => {
    if (!ring || !Array.isArray(ring.vertexIds) || ring.vertexIds.length < 2) {
      return;
    }
    const ids = ring.vertexIds;
    const count = ids.length;
    for (let i = 0; i < count; i++) {
      const startId = ids[i];
      const endId = ids[(i + 1) % count];
      const start = vertexMap.get(startId);
      const end = vertexMap.get(endId);
      if (!start || !end) continue;
      edges.push({
        polygon,
        ringId: ring.id,
        ringType: ring.ringType,
        ringVertexIds: ids,
        edgeIndex: i,
        startVertexId: startId,
        endVertexId: endId,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y }
      });
    }
  });

  return edges;
}

function collectEdgesIntersectingSegment(segmentStart, segmentEnd, edges, geometryService) {
  const intersections = [];
  edges.forEach(edge => {
    if (geometryService.doLineSegmentsIntersectProperly(segmentStart, segmentEnd, edge.start, edge.end)) {
      intersections.push(edge);
    }
  });
  return intersections;
}

function dedupeEdges(edges) {
  const seen = new Set();
  const result = [];
  edges.forEach(edge => {
    const key = `${edge.polygon?.id || 'unknown'}|${edge.ringId}|${edge.edgeIndex}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(edge);
  });
  return result;
}

function collectAdjacentSegmentIntersections(vertexId, owningPolygon, desired, otherEdges, vertexMap, geometryService) {
  const hits = [];
  if (!owningPolygon || !Array.isArray(owningPolygon.rings)) {
    return hits;
  }

  owningPolygon.rings.forEach(ring => {
    if (!ring || !Array.isArray(ring.vertexIds) || ring.vertexIds.length < 2) {
      return;
    }
    const ids = ring.vertexIds;
    const count = ids.length;
    for (let i = 0; i < count; i++) {
      if (ids[i] !== vertexId) continue;
      const prevId = ids[(i - 1 + count) % count];
      const nextId = ids[(i + 1) % count];
      const prev = vertexMap.get(prevId);
      const next = vertexMap.get(nextId);
      if (prev) {
        hits.push(...collectEdgesIntersectingSegment(prev, desired, otherEdges, geometryService));
      }
      if (next) {
        hits.push(...collectEdgesIntersectingSegment(desired, next, otherEdges, geometryService));
      }
    }
  });

  return dedupeEdges(hits);
}

function computeSlidePosition(original, desired, edge, geometryService, vertexMap) {
  const start = edge.start;
  const end = edge.end;
  const edgeVector = { x: end.x - start.x, y: end.y - start.y };
  const edgeLengthSq = edgeVector.x * edgeVector.x + edgeVector.y * edgeVector.y;
  if (edgeLengthSq < EDGE_LENGTH_EPS) {
    return { x: start.x, y: start.y };
  }

  const edgeLength = Math.sqrt(edgeLengthSq);
  const edgeUnit = { x: edgeVector.x / edgeLength, y: edgeVector.y / edgeLength };
  const dragVector = { x: desired.x - original.x, y: desired.y - original.y };
  const projection = geometryService.projectPointToEdge(desired, start, end);
  const along = dragVector.x * edgeUnit.x + dragVector.y * edgeUnit.y;

  let candidate = {
    x: projection.x + edgeUnit.x * along,
    y: projection.y + edgeUnit.y * along
  };

  const t = ((candidate.x - start.x) * edgeVector.x + (candidate.y - start.y) * edgeVector.y) / edgeLengthSq;
  if (t >= 0 && t <= 1) {
    return candidate;
  }

  const ringVertexIds = edge.ringVertexIds;
  if (!Array.isArray(ringVertexIds) || ringVertexIds.length < 2) {
    return t < 0 ? { x: start.x, y: start.y } : { x: end.x, y: end.y };
  }

  const count = ringVertexIds.length;
  const beyondEnd = t > 1;
  const edgeIndex = edge.edgeIndex;
  const adjIndex = beyondEnd ? (edgeIndex + 1) % count : (edgeIndex - 1 + count) % count;
  const adjStartId = ringVertexIds[adjIndex];
  const adjEndId = ringVertexIds[(adjIndex + 1) % count];
  const adjStart = vertexMap.get(adjStartId);
  const adjEnd = vertexMap.get(adjEndId);
  const endpoint = beyondEnd ? end : start;

  if (!adjStart || !adjEnd) {
    return { x: endpoint.x, y: endpoint.y };
  }

  const adjVector = { x: adjEnd.x - adjStart.x, y: adjEnd.y - adjStart.y };
  const adjLengthSq = adjVector.x * adjVector.x + adjVector.y * adjVector.y;
  if (adjLengthSq < EDGE_LENGTH_EPS) {
    return { x: endpoint.x, y: endpoint.y };
  }

  const adjLength = Math.sqrt(adjLengthSq);
  const adjUnit = { x: adjVector.x / adjLength, y: adjVector.y / adjLength };
  const alongAdj = dragVector.x * adjUnit.x + dragVector.y * adjUnit.y;
  if (Math.abs(alongAdj) < EDGE_LENGTH_EPS) {
    return { x: endpoint.x, y: endpoint.y };
  }

  let adjCandidate = {
    x: endpoint.x + adjUnit.x * alongAdj,
    y: endpoint.y + adjUnit.y * alongAdj
  };
  const adjT = ((adjCandidate.x - adjStart.x) * adjVector.x + (adjCandidate.y - adjStart.y) * adjVector.y) / adjLengthSq;
  if (adjT < 0) {
    return { x: adjStart.x, y: adjStart.y };
  }
  if (adjT > 1) {
    return { x: adjEnd.x, y: adjEnd.y };
  }
  return adjCandidate;
}

function findBlockingEdgesForPolygon({
  vertexId,
  owningPolygon,
  otherPolygon,
  otherEdges,
  original,
  desired,
  vertexMap,
  geometryService
}) {
  const edges = Array.isArray(otherEdges) ? otherEdges : collectRingEdges(otherPolygon, vertexMap);
  if (edges.length === 0) {
    return [];
  }

  const location = classifyPointInPolygon(desired, otherPolygon, vertexMap, geometryService);
  if (location.type === 'inside_outer') {
    return edges;
  }

  const adjacentHits = collectAdjacentSegmentIntersections(
    vertexId,
    owningPolygon,
    desired,
    edges,
    vertexMap,
    geometryService
  );
  if (adjacentHits.length > 0) {
    return adjacentHits;
  }

  const pathHits = collectEdgesIntersectingSegment(original, desired, edges, geometryService);
  if (pathHits.length > 0) {
    return pathHits;
  }

  return [];
}

function isPointBlockedByPolygon(point, polygon, vertexMap, geometryService) {
  const location = classifyPointInPolygon(point, polygon, vertexMap, geometryService);
  return location.type === 'inside_outer';
}

export function applyVertexSliding({
  world,
  geometryService,
  movedVertexIds,
  desiredPositions,
  originalPositions,
  context
}) {
  if (!world || !geometryService || !(desiredPositions instanceof Map)) {
    return desiredPositions || new Map();
  }

  const movedIds = movedVertexIds instanceof Set
    ? movedVertexIds
    : new Set(desiredPositions.keys());

  if (movedIds.size === 0) {
    return desiredPositions;
  }

  const useContext = context && context.world === world;
  const polygons = useContext ? context.polygons : collectPolygons(world);
  if (polygons.length === 0) {
    return desiredPositions;
  }

  const vertexPolygonIndex = useContext ? context.vertexPolygonIndex : buildVertexPolygonIndex(polygons);
  const polygonsByLayer = useContext ? context.polygonsByLayer : buildPolygonsByLayer(polygons);
  const edgesByPolygonId = useContext ? context.edgesByPolygonId : null;
  let vertexMap = null;
  if (useContext && context.vertexMap instanceof Map) {
    if (!isSameIdSet(context.movedVertexIds, movedIds)) {
      context.vertexMap = buildVertexMap(world.vertices);
      context.movedVertexIds = new Set(movedIds);
    }
    vertexMap = context.vertexMap;
    movedIds.forEach(vertexId => {
      const desired = desiredPositions.get(vertexId);
      if (!desired) return;
      vertexMap.set(vertexId, { x: desired.x, y: desired.y });
    });
  } else {
    vertexMap = buildVertexMap(world.vertices, desiredPositions);
  }
  const originalMap = buildOriginalPositionMap(world.vertices, originalPositions);

  const movingPolygonIds = new Set();
  movedIds.forEach(vertexId => {
    const owningPolygons = vertexPolygonIndex.get(vertexId) || [];
    owningPolygons.forEach(polygon => {
      movingPolygonIds.add(polygon.id);
    });
  });

  const adjustedPositions = new Map(desiredPositions);

  movedIds.forEach(vertexId => {
    const desired = adjustedPositions.get(vertexId);
    const original = originalMap.get(vertexId);
    if (!desired || !original) {
      return;
    }

    const owningPolygons = vertexPolygonIndex.get(vertexId) || [];
    if (owningPolygons.length === 0) {
      return;
    }

    let bestCandidate = desired;
    let bestDistanceSq = Infinity;
    let blockingPolygons = [];
    let blockingEdge = null;

    for (const owningPolygon of owningPolygons) {
      const layerId = owningPolygon.layerId;
      const layerPolygons = polygonsByLayer.get(layerId) || [];
      for (const otherPolygon of layerPolygons) {
        if (otherPolygon.id === owningPolygon.id) continue;
        if (movingPolygonIds.has(otherPolygon.id)) continue;
        const precomputedEdges = edgesByPolygonId ? edgesByPolygonId.get(otherPolygon.id) : null;
        const blockingEdges = findBlockingEdgesForPolygon({
          vertexId,
          owningPolygon,
          otherPolygon,
          otherEdges: precomputedEdges,
          original,
          desired,
          vertexMap,
          geometryService
        });
        if (blockingEdges.length === 0) {
          continue;
        }
        blockingPolygons.push(otherPolygon);
        blockingEdges.forEach(edge => {
          const candidate = computeSlidePosition(original, desired, edge, geometryService, vertexMap);
          const distSq = geometryService.calculateDistanceSq(
            desired.x,
            desired.y,
            candidate.x,
            candidate.y
          );
          if (distSq < bestDistanceSq) {
            bestDistanceSq = distSq;
            bestCandidate = candidate;
            blockingEdge = edge;
          }
        });
      }
    }

    if (blockingEdge) {
      const stillBlocked = blockingPolygons.some(polygon =>
        isPointBlockedByPolygon(bestCandidate, polygon, vertexMap, geometryService)
      );

      if (stillBlocked) {
        const projection = geometryService.projectPointToEdge(desired, blockingEdge.start, blockingEdge.end);
        bestCandidate = { x: projection.x, y: projection.y };
      }

      const finalBlocked = blockingPolygons.some(polygon =>
        isPointBlockedByPolygon(bestCandidate, polygon, vertexMap, geometryService)
      );

      if (finalBlocked) {
        bestCandidate = { x: original.x, y: original.y };
      }

      adjustedPositions.set(vertexId, bestCandidate);
      vertexMap.set(vertexId, bestCandidate);
    }
  });

  return adjustedPositions;
}
