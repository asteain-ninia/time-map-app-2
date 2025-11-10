/**
 * Builds compound polygon loops (territories with their holes) for rendering overlays.
 * @param {import('../../../domain/entities/Polygon.js').Polygon} polygon
 * @param {Map<string, {id: string, x: number, y: number}>} verticesMap
 * @param {number} offsetX - Horizontal world offset to duplicate polygons across wraps.
 * @returns {Array<Array<{x:number,y:number}>>} Array of loop sets. Each set contains the outer loop followed by hole loops.
 */
export function buildPolygonFillLoopSets(polygon, verticesMap, offsetX = 0) {
  if (!polygon || !Array.isArray(polygon.rings) || polygon.rings.length === 0) {
    return [];
  }

  const childrenByRingId = new Map();
  for (const ring of polygon.rings) {
    if (!ring || !ring.id) continue;
    if (!childrenByRingId.has(ring.id)) {
      childrenByRingId.set(ring.id, []);
    }
  }

  for (const ring of polygon.rings) {
    if (!ring || ring.parentId === null || ring.parentId === undefined) continue;
    const bucket = childrenByRingId.get(ring.parentId);
    if (bucket) {
      bucket.push(ring);
    }
  }

  const loopSets = [];
  for (const ring of polygon.rings) {
    if (!ring || ring.ringType !== 'territory') continue;
    const territoryLoop = buildRingLoop(ring, verticesMap, offsetX);
    if (!territoryLoop) continue;
    const loops = [territoryLoop];
    const children = childrenByRingId.get(ring.id) || [];
    for (const child of children) {
      if (!child || child.ringType !== 'hole') continue;
      const holeLoop = buildRingLoop(child, verticesMap, offsetX);
      if (holeLoop) {
        loops.push(holeLoop);
      }
    }
    if (loops.length > 0) {
      loopSets.push(loops);
    }
  }
  return loopSets;
}

function buildRingLoop(ring, verticesMap, offsetX) {
  if (!ring || !Array.isArray(ring.vertexIds)) return null;
  const points = [];
  for (const vertexId of ring.vertexIds) {
    const vertex = verticesMap.get(vertexId);
    if (!vertex) continue;
    points.push({ x: vertex.x + offsetX, y: vertex.y });
  }
  return points.length >= 3 ? points : null;
}
