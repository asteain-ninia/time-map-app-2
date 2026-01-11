import { GeometryService } from './GeometryService.js';
import * as polygonClipping from 'polygon-clipping';

const DEFAULT_TOLERANCE_SQ = 1e-8;
const DEFAULT_EPSILON = 1e-9;
const COORD_KEY_PRECISION = 9;

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function buildCoordinateKey(point) {
  return `${point.x.toFixed(COORD_KEY_PRECISION)},${point.y.toFixed(COORD_KEY_PRECISION)}`;
}

function normalizeLinePoints(points, toleranceSq) {
  if (!Array.isArray(points)) return [];
  const result = [];
  points.forEach(point => {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
      return;
    }
    if (result.length === 0 || distanceSq(result[result.length - 1], point) > toleranceSq) {
      result.push({ x: point.x, y: point.y });
    }
  });
  return result;
}

function normalizeRingPoints(points, toleranceSq) {
  const result = normalizeLinePoints(points, toleranceSq);
  if (result.length >= 2 && distanceSq(result[0], result[result.length - 1]) <= toleranceSq) {
    result.pop();
  }
  return result;
}

function getBoundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach(point => {
    if (!point) return;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function mergeBoundingBoxes(boxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  boxes.forEach(box => {
    if (!box) return;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  });
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function signedArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    area += (a.x * b.y - b.x * a.y);
  }
  return area / 2;
}

function findInteriorPoint(points, geometryService) {
  if (!Array.isArray(points) || points.length < 3) {
    return points?.[0] || { x: 0, y: 0 };
  }
  const bbox = getBoundingBox(points);
  const bboxSize = bbox ? Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) : 1;
  const epsilon = Math.max(bboxSize * 1e-6, 1e-6);
  const area = signedArea(points);
  const isCCW = area >= 0;

  for (let i = 0; i < points.length; i++) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < epsilon) continue;
    const nx = -dy / length;
    const ny = dx / length;
    const scale = isCCW ? 1 : -1;
    const candidate = {
      x: (start.x + end.x) / 2 + nx * epsilon * scale,
      y: (start.y + end.y) / 2 + ny * epsilon * scale
    };
    if (geometryService.isPointInPolygon(candidate, points, false)) {
      return candidate;
    }
  }

  if (bbox) {
    const fallback = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
    if (geometryService.isPointInPolygon(fallback, points, false)) {
      return fallback;
    }
  }
  return points[0];
}

function buildRingCoordinates(ring, verticesMap) {
  if (!ring || !Array.isArray(ring.vertexIds)) {
    throw new Error('リングの頂点情報が不正です。');
  }
  return ring.vertexIds.map(vertexId => {
    const vertex = verticesMap.get(vertexId);
    if (!vertex) {
      throw new Error(`頂点が見つかりません: ${vertexId}`);
    }
    return [vertex.x, vertex.y];
  });
}

function buildMultiPolygonFromRings(rings, verticesMap) {
  const territoryRings = rings.filter(ring => ring && ring.ringType === 'territory');
  if (territoryRings.length === 0) {
    throw new Error('領土リングが存在しません。');
  }

  const holesByParent = new Map();
  rings.forEach(ring => {
    if (!ring || ring.ringType !== 'hole') return;
    const parentId = ring.parentId ?? null;
    if (!holesByParent.has(parentId)) {
      holesByParent.set(parentId, []);
    }
    holesByParent.get(parentId).push(ring);
  });

  return territoryRings.map(territory => {
    const ringsForPolygon = [buildRingCoordinates(territory, verticesMap)];
    const holes = holesByParent.get(territory.id) || [];
    holes.forEach(holeRing => {
      ringsForPolygon.push(buildRingCoordinates(holeRing, verticesMap));
    });
    return ringsForPolygon;
  });
}

function isPointOnAnyRingBoundary(point, rings, geometryService, toleranceSq) {
  return rings.some(ringPoints => geometryService.isPointOnPolygonBoundary(point, ringPoints, toleranceSq));
}

function getPointNestingLevel(point, ringPointsList, geometryService) {
  let nestingLevel = 0;
  ringPointsList.forEach(ringPoints => {
    if (geometryService.isPointInPolygon(point, ringPoints, false)) {
      nestingLevel += 1;
    }
  });
  return nestingLevel;
}

function isPointInsideFilledArea(point, ringPointsList, geometryService) {
  return getPointNestingLevel(point, ringPointsList, geometryService) % 2 === 1;
}

function buildSegmentIntersectionInclusive(p1, p2, q1, q2, epsilon) {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = q2.x - q1.x;
  const dy2 = q2.y - q1.y;
  const denominator = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denominator) < epsilon) {
    return null;
  }
  const sx = q1.x - p1.x;
  const sy = q1.y - p1.y;
  const t = (sx * dy2 - sy * dx2) / denominator;
  const u = (sx * dy1 - sy * dx1) / denominator;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) {
    return null;
  }
  return {
    x: p1.x + t * dx1,
    y: p1.y + t * dy1,
    lineT: t,
    edgeT: u
  };
}

function buildRectangleRing(bbox, padding) {
  return [
    { x: bbox.minX - padding, y: bbox.minY - padding },
    { x: bbox.maxX + padding, y: bbox.minY - padding },
    { x: bbox.maxX + padding, y: bbox.maxY + padding },
    { x: bbox.minX - padding, y: bbox.maxY + padding }
  ];
}

function buildExtendedLine(points, extendDistance) {
  if (points.length < 2) {
    return points.slice();
  }
  const start = points[0];
  const next = points[1];
  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const startDx = next.x - start.x;
  const startDy = next.y - start.y;
  const endDx = end.x - prev.x;
  const endDy = end.y - prev.y;
  const startLen = Math.hypot(startDx, startDy) || 1;
  const endLen = Math.hypot(endDx, endDy) || 1;
  const startUnit = { x: startDx / startLen, y: startDy / startLen };
  const endUnit = { x: endDx / endLen, y: endDy / endLen };
  const extendedStart = {
    x: start.x - startUnit.x * extendDistance,
    y: start.y - startUnit.y * extendDistance
  };
  const extendedEnd = {
    x: end.x + endUnit.x * extendDistance,
    y: end.y + endUnit.y * extendDistance
  };
  return [extendedStart, ...points, extendedEnd];
}

function pushIfDistinct(points, point, toleranceSq) {
  if (!point) return;
  if (points.length === 0 || distanceSq(points[points.length - 1], point) > toleranceSq) {
    points.push({ x: point.x, y: point.y });
  }
}

function buildBoundaryPath(rect, entry, exit, clockwise, toleranceSq) {
  const vertexCount = rect.length;
  const direction = clockwise ? 1 : -1;
  const edgeAdvance = (index) => (index + direction + vertexCount) % vertexCount;
  const points = [];

  pushIfDistinct(points, exit.point, toleranceSq);

  if (entry.edgeIndex === exit.edgeIndex) {
    if (clockwise ? entry.edgeT >= exit.edgeT : entry.edgeT <= exit.edgeT) {
      pushIfDistinct(points, entry.point, toleranceSq);
      return points;
    }
  }

  if (clockwise) {
    const endVertex = rect[(exit.edgeIndex + 1) % vertexCount];
    pushIfDistinct(points, endVertex, toleranceSq);
  } else {
    const startVertex = rect[exit.edgeIndex];
    pushIfDistinct(points, startVertex, toleranceSq);
  }

  let edgeIndex = edgeAdvance(exit.edgeIndex);
  while (edgeIndex !== entry.edgeIndex) {
    const vertex = clockwise
      ? rect[(edgeIndex + 1) % vertexCount]
      : rect[edgeIndex];
    pushIfDistinct(points, vertex, toleranceSq);
    edgeIndex = edgeAdvance(edgeIndex);
  }

  pushIfDistinct(points, entry.point, toleranceSq);
  return points;
}

function buildClipPolygonsFromLine(cutLinePoints, bbox, epsilon, toleranceSq) {
  const rect = buildRectangleRing(bbox, Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 2 + 1);
  const extendDistance = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 4 + 1;
  const extendedLine = buildExtendedLine(cutLinePoints, extendDistance);

  const intersections = [];
  for (let i = 0; i < extendedLine.length - 1; i++) {
    const lineStart = extendedLine[i];
    const lineEnd = extendedLine[i + 1];
    for (let edgeIndex = 0; edgeIndex < rect.length; edgeIndex++) {
      const edgeStart = rect[edgeIndex];
      const edgeEnd = rect[(edgeIndex + 1) % rect.length];
      const hit = buildSegmentIntersectionInclusive(lineStart, lineEnd, edgeStart, edgeEnd, epsilon);
      if (!hit) continue;
      const point = { x: hit.x, y: hit.y };
      const duplicate = intersections.find(existing => distanceSq(existing.point, point) <= toleranceSq);
      if (duplicate) continue;
      intersections.push({
        point,
        lineIndex: i,
        lineT: hit.lineT,
        edgeIndex,
        edgeT: hit.edgeT
      });
    }
  }

  if (intersections.length < 2) {
    throw new Error('分断線が領域を横切る必要があります。');
  }

  intersections.sort((a, b) => {
    if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
    return a.lineT - b.lineT;
  });

  const entry = intersections[0];
  const exit = intersections[intersections.length - 1];

  const linePath = [];
  pushIfDistinct(linePath, entry.point, toleranceSq);
  if (entry.lineIndex === exit.lineIndex) {
    pushIfDistinct(linePath, exit.point, toleranceSq);
  } else {
    for (let i = entry.lineIndex + 1; i <= exit.lineIndex; i++) {
      pushIfDistinct(linePath, extendedLine[i], toleranceSq);
    }
    pushIfDistinct(linePath, exit.point, toleranceSq);
  }

  const boundaryCw = buildBoundaryPath(rect, entry, exit, true, toleranceSq);
  const boundaryCcw = buildBoundaryPath(rect, entry, exit, false, toleranceSq);

  const clipA = normalizeRingPoints([...linePath, ...boundaryCw], toleranceSq);
  const clipB = normalizeRingPoints([...linePath, ...boundaryCcw], toleranceSq);

  if (clipA.length < 3 || clipB.length < 3) {
    throw new Error('分断線による分割領域の構成に失敗しました。');
  }

  return [clipA, clipB];
}

function normalizePolygonClippingRing(ringCoords, toleranceSq) {
  const points = ringCoords.map(coord => ({ x: coord[0], y: coord[1] }));
  return normalizeRingPoints(points, toleranceSq);
}

function buildRingHierarchyFromMultiPolygon(multiPolygon, geometryService, toleranceSq) {
  const ringEntries = [];

  multiPolygon.forEach(polygon => {
    polygon.forEach(ringCoords => {
      const points = normalizePolygonClippingRing(ringCoords, toleranceSq);
      if (points.length < 3) return;
      ringEntries.push({ points });
    });
  });

  if (ringEntries.length === 0) {
    throw new Error('分割結果の面が成立しません。');
  }

  const areas = ringEntries.map(entry => geometryService.calculatePolygonArea(entry.points));
  const parentIndices = ringEntries.map(() => null);

  ringEntries.forEach((entry, index) => {
    const testPoint = findInteriorPoint(entry.points, geometryService);
    let parentIndex = null;
    let parentArea = Infinity;
    ringEntries.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index) return;
      if (!geometryService.isPointInPolygon(testPoint, candidate.points, false)) return;
      const candidateArea = areas[candidateIndex];
      if (candidateArea < parentArea) {
        parentArea = candidateArea;
        parentIndex = candidateIndex;
      }
    });
    parentIndices[index] = parentIndex;
  });

  const depths = new Array(ringEntries.length).fill(0);
  const resolveDepth = (index) => {
    if (depths[index] !== 0) return depths[index];
    const parentIndex = parentIndices[index];
    if (parentIndex === null || parentIndex === undefined) {
      depths[index] = 1;
      return depths[index];
    }
    depths[index] = resolveDepth(parentIndex) + 1;
    return depths[index];
  };

  ringEntries.forEach((_, index) => resolveDepth(index));

  return ringEntries.map((entry, index) => ({
    points: entry.points,
    ringType: depths[index] % 2 === 1 ? 'territory' : 'hole',
    parentIndex: parentIndices[index]
  }));
}

function assignPointRefsToPlan(polygons, verticesMap, toleranceSq) {
  const vertexIndex = new Map();
  verticesMap.forEach((vertex, id) => {
    vertexIndex.set(buildCoordinateKey(vertex), id);
  });
  const vertexList = Array.from(verticesMap.entries()).map(([id, vertex]) => ({ id, x: vertex.x, y: vertex.y }));
  const pointKeyByCoord = new Map();
  let counter = 0;

  const findExistingVertexId = (point) => {
    const key = buildCoordinateKey(point);
    if (vertexIndex.has(key)) {
      return vertexIndex.get(key);
    }
    for (const vertex of vertexList) {
      if (distanceSq(vertex, point) <= Math.min(DEFAULT_TOLERANCE_SQ, toleranceSq)) {
        return vertex.id;
      }
    }
    return null;
  };

  polygons.forEach(polygon => {
    polygon.rings = polygon.rings.map(ring => {
      const points = ring.points.map(point => {
        const matchedVertexId = findExistingVertexId(point);
        if (matchedVertexId) {
          return { ...point, sourceVertexId: matchedVertexId };
        }
        const coordKey = buildCoordinateKey(point);
        if (!pointKeyByCoord.has(coordKey)) {
          pointKeyByCoord.set(coordKey, `k:${counter++}`);
        }
        return { ...point, key: pointKeyByCoord.get(coordKey) };
      });
      return { ...ring, points };
    });
  });
}

function calculateMultiPolygonArea(multiPolygon, geometryService, toleranceSq) {
  if (!Array.isArray(multiPolygon) || multiPolygon.length === 0) {
    return 0;
  }
  const hasRings = multiPolygon.some(polygon => Array.isArray(polygon) && polygon.length > 0);
  if (!hasRings) {
    return 0;
  }
  const rings = buildRingHierarchyFromMultiPolygon(multiPolygon, geometryService, toleranceSq);
  return rings.reduce((total, ring) => {
    const area = geometryService.calculatePolygonArea(ring.points);
    return total + (ring.ringType === 'territory' ? area : -area);
  }, 0);
}

export function buildPolygonSplitPlan({
  rings,
  verticesMap,
  cutLinePoints,
  geometryService,
  toleranceSq = DEFAULT_TOLERANCE_SQ,
  epsilon = DEFAULT_EPSILON,
  isClosed = false
}) {
  if (!geometryService) {
    throw new Error('GeometryService is required.');
  }
  if (!Array.isArray(rings) || rings.length === 0) {
    throw new Error('分割対象のリング情報が不正です。');
  }
  if (!Array.isArray(cutLinePoints)) {
    throw new Error('分断線情報が不正です。');
  }

  const normalizedCutLine = normalizeLinePoints(cutLinePoints, toleranceSq);
  if (isClosed) {
    if (normalizedCutLine.length < 3) {
      throw new Error('円形分割は3点以上必要です。');
    }
  } else if (normalizedCutLine.length < 2) {
    throw new Error('分断線は2点以上必要です。');
  }

  const ringPointsList = rings.map(ring => {
    const coords = buildRingCoordinates(ring, verticesMap);
    return coords.map(coord => ({ x: coord[0], y: coord[1] }));
  });
  if (!isClosed) {
    const startPoint = normalizedCutLine[0];
    const endPoint = normalizedCutLine[normalizedCutLine.length - 1];

    if (isPointOnAnyRingBoundary(startPoint, ringPointsList, geometryService, toleranceSq)) {
      throw new Error('分断線の開始点は境界線上に置けません。');
    }
    if (isPointOnAnyRingBoundary(endPoint, ringPointsList, geometryService, toleranceSq)) {
      throw new Error('分断線の終点は境界線上に置けません。');
    }
    if (isPointInsideFilledArea(startPoint, ringPointsList, geometryService)) {
      throw new Error('分断線の開始点は面の外側に置いてください。');
    }
    if (isPointInsideFilledArea(endPoint, ringPointsList, geometryService)) {
      throw new Error('分断線の終点は面の外側に置いてください。');
    }
  }

  const subjectMultiPolygon = buildMultiPolygonFromRings(rings, verticesMap);
  const ringBBoxes = ringPointsList.map(getBoundingBox);
  const lineBBox = getBoundingBox(normalizedCutLine);
  const bbox = mergeBoundingBoxes([...ringBBoxes, lineBBox]);
  if (!bbox) {
    throw new Error('分割対象の座標が不正です。');
  }

  let parts = [];

  if (isClosed) {
    const cutRing = normalizeRingPoints(normalizedCutLine, toleranceSq);
    const clipPolygon = [cutRing.map(point => [point.x, point.y])];
    const inside = polygonClipping.intersection(subjectMultiPolygon, clipPolygon);
    const outside = polygonClipping.difference(subjectMultiPolygon, clipPolygon);
    const insideArea = calculateMultiPolygonArea(inside, geometryService, toleranceSq);
    const outsideArea = calculateMultiPolygonArea(outside, geometryService, toleranceSq);
    if (insideArea <= toleranceSq || outsideArea <= toleranceSq) {
      throw new Error('円形分割が面を二分割できません。');
    }
    parts = [inside, outside];
  } else {
    const [clipA, clipB] = buildClipPolygonsFromLine(normalizedCutLine, bbox, epsilon, toleranceSq);
    const clipPolyA = [clipA.map(point => [point.x, point.y])];
    const clipPolyB = [clipB.map(point => [point.x, point.y])];
    const partA = polygonClipping.intersection(subjectMultiPolygon, clipPolyA);
    const partB = polygonClipping.intersection(subjectMultiPolygon, clipPolyB);
    const areaA = calculateMultiPolygonArea(partA, geometryService, toleranceSq);
    const areaB = calculateMultiPolygonArea(partB, geometryService, toleranceSq);
    if (areaA <= toleranceSq || areaB <= toleranceSq) {
      throw new Error('分断線は面を二分割できません。');
    }
    parts = [partA, partB];
  }

  const polygons = parts.map(part => ({
    rings: buildRingHierarchyFromMultiPolygon(part, geometryService, toleranceSq)
  }));

  assignPointRefsToPlan(polygons, verticesMap, toleranceSq);

  return { polygons };
}

export function createPolygonSplitService(geometryService = new GeometryService()) {
  return {
    buildPlan: (params) => buildPolygonSplitPlan({ ...params, geometryService })
  };
}
