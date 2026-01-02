import { GeometryService } from './GeometryService.js';

const DEFAULT_TOLERANCE_SQ = 1e-8;
const DEFAULT_EPSILON = 1e-9;

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function buildSegmentIntersection(p1, p2, q1, q2, epsilon) {
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
  if (t <= epsilon || t >= 1 - epsilon || u <= epsilon || u >= 1 - epsilon) {
    return null;
  }
  return {
    x: p1.x + t * dx1,
    y: p1.y + t * dy1,
    lineT: t,
    edgeT: u
  };
}

function normalizeRing(points) {
  const result = [];
  for (const point of points) {
    if (result.length === 0 || result[result.length - 1].key !== point.key) {
      result.push(point);
    }
  }
  if (result.length >= 2 && result[0].key === result[result.length - 1].key) {
    result.pop();
  }
  return result;
}

function ensureOutside(point, ringPoints, geometryService, toleranceSq, label) {
  if (geometryService.isPointInPolygon(point, ringPoints, false)) {
    throw new Error(`${label}は面の外側に置いてください。`);
  }
  if (geometryService.isPointOnPolygonBoundary(point, ringPoints, toleranceSq)) {
    throw new Error(`${label}は境界線上に置けません。`);
  }
}

function buildRingPoints(ringVertexIds, verticesMap) {
  const ringPoints = [];
  const ringPointRefs = [];
  for (const vertexId of ringVertexIds) {
    const vertex = verticesMap.get(vertexId);
    if (!vertex) {
      throw new Error(`頂点が見つかりません: ${vertexId}`);
    }
    const point = {
      x: vertex.x,
      y: vertex.y,
      key: `v:${vertexId}`,
      sourceVertexId: vertexId
    };
    ringPoints.push({ x: vertex.x, y: vertex.y });
    ringPointRefs.push(point);
  }
  return { ringPoints, ringPointRefs };
}

function buildCutLinePoints(cutLinePoints, intersections) {
  const ordered = [...intersections].sort((a, b) => {
    if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
    return a.lineT - b.lineT;
  });
  const cutLine = [ordered[0].pointRef];
  let counter = 0;
  if (ordered[0].lineIndex === ordered[1].lineIndex) {
    cutLine.push(ordered[1].pointRef);
    return { cutLine, ordered };
  }
  for (let i = ordered[0].lineIndex + 1; i <= ordered[1].lineIndex; i++) {
    const point = cutLinePoints[i];
    const ref = {
      x: point.x,
      y: point.y,
      key: `c:${counter++}`
    };
    cutLine.push(ref);
  }
  cutLine.push(ordered[1].pointRef);
  return { cutLine, ordered };
}

export function buildPolygonSplitPlan({
  ringVertexIds,
  verticesMap,
  cutLinePoints,
  geometryService,
  toleranceSq = DEFAULT_TOLERANCE_SQ,
  epsilon = DEFAULT_EPSILON
}) {
  if (!geometryService) {
    throw new Error('GeometryService is required.');
  }
  if (!Array.isArray(ringVertexIds) || ringVertexIds.length < 3) {
    throw new Error('分割対象の外周リングが不正です。');
  }
  if (!Array.isArray(cutLinePoints) || cutLinePoints.length < 2) {
    throw new Error('分断線は2点以上必要です。');
  }
  const { ringPoints, ringPointRefs } = buildRingPoints(ringVertexIds, verticesMap);
  const startPoint = cutLinePoints[0];
  const endPoint = cutLinePoints[cutLinePoints.length - 1];

  ensureOutside(startPoint, ringPoints, geometryService, toleranceSq, '分断線の開始点');
  ensureOutside(endPoint, ringPoints, geometryService, toleranceSq, '分断線の終点');

  const intersections = [];
  for (let i = 0; i < cutLinePoints.length - 1; i++) {
    const lineStart = cutLinePoints[i];
    const lineEnd = cutLinePoints[i + 1];
    for (let j = 0; j < ringPoints.length; j++) {
      const edgeStart = ringPoints[j];
      const edgeEnd = ringPoints[(j + 1) % ringPoints.length];
      const hit = buildSegmentIntersection(lineStart, lineEnd, edgeStart, edgeEnd, epsilon);
      if (!hit) continue;
      const hitPoint = { x: hit.x, y: hit.y };
      const duplicate = intersections.find(existing => distanceSq(existing.point, hitPoint) < toleranceSq);
      if (duplicate) {
        throw new Error('分断線が頂点を通過しています。別の位置で線を引いてください。');
      }
      intersections.push({
        point: hitPoint,
        lineIndex: i,
        lineT: hit.lineT,
        edgeIndex: j,
        edgeT: hit.edgeT
      });
    }
  }

  if (intersections.length !== 2) {
    throw new Error('分断線は境界を2回だけ横切る必要があります。');
  }

  const intersectionRefs = intersections.map((intersection, index) => ({
    x: intersection.point.x,
    y: intersection.point.y,
    key: `i:${index}`
  }));
  intersections.forEach((intersection, index) => {
    intersection.pointRef = intersectionRefs[index];
  });

  const { cutLine, ordered } = buildCutLinePoints(cutLinePoints, intersections);
  const intersectionsByEdge = new Map();
  intersections.forEach(intersection => {
    if (!intersectionsByEdge.has(intersection.edgeIndex)) {
      intersectionsByEdge.set(intersection.edgeIndex, []);
    }
    intersectionsByEdge.get(intersection.edgeIndex).push(intersection);
  });

  const ringSequence = [];
  for (let i = 0; i < ringPointRefs.length; i++) {
    ringSequence.push(ringPointRefs[i]);
    const hits = intersectionsByEdge.get(i);
    if (!hits) continue;
    hits.sort((a, b) => a.edgeT - b.edgeT);
    hits.forEach(hit => {
      ringSequence.push(hit.pointRef);
      hit.ringIndex = ringSequence.length - 1;
    });
  }

  const firstIndex = ordered[0].ringIndex;
  const secondIndex = ordered[1].ringIndex;
  if (firstIndex === undefined || secondIndex === undefined) {
    throw new Error('分断線と面の交差判定に失敗しました。');
  }
  let idx1 = firstIndex;
  let idx2 = secondIndex;
  if (idx1 > idx2) {
    [idx1, idx2] = [idx2, idx1];
  }

  const path1 = ringSequence.slice(idx1, idx2 + 1);
  const path2 = ringSequence.slice(idx2).concat(ringSequence.slice(0, idx1 + 1));

  const cutInterior = cutLine.slice(1, -1);
  const ringA = normalizeRing(path1.concat([...cutInterior].reverse()));
  const ringB = normalizeRing(path2.concat(cutInterior));

  if (ringA.length < 3 || ringB.length < 3) {
    throw new Error('分割結果の面が成立しません。');
  }

  return {
    ringA,
    ringB,
    cutLine
  };
}

export function createPolygonSplitService(geometryService = new GeometryService()) {
  return {
    buildPlan: (params) => buildPolygonSplitPlan({ ...params, geometryService })
  };
}
