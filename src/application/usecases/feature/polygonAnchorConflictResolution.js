import { Polygon } from '../../../domain/entities/Polygon.js';
import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';
import * as polygonClipping from 'polygon-clipping';
import { collectPolygonExclusivityConflicts } from './polygonLayerValidation.js';
import { FeatureAnchorConflictError } from './FeatureAnchorConflictError.js';

const COORD_KEY_PRECISION = 9;
const DEFAULT_TOLERANCE_SQ = 1e-8;

function compareTimePoints(left, right) {
  if (left.equals(right)) {
    return 0;
  }
  return left.isBefore(right) ? -1 : 1;
}

function buildCoordinateKey(point) {
  return `${point.x.toFixed(COORD_KEY_PRECISION)},${point.y.toFixed(COORD_KEY_PRECISION)}`;
}

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function distancePointSegmentSq(point, start, end) {
  const segmentLengthSq = distanceSq(start, end);
  if (segmentLengthSq <= 1e-12) {
    return distanceSq(point, start);
  }
  const projectionRatio = (
    ((point.x - start.x) * (end.x - start.x))
    + ((point.y - start.y) * (end.y - start.y))
  ) / segmentLengthSq;
  const clampedRatio = Math.max(0, Math.min(1, projectionRatio));
  const projected = {
    x: start.x + ((end.x - start.x) * clampedRatio),
    y: start.y + ((end.y - start.y) * clampedRatio)
  };
  return distanceSq(point, projected);
}

function isPointInPolygonFallback(point, polygonVertices, includeBoundary = false, toleranceSq = DEFAULT_TOLERANCE_SQ) {
  if (!point || !Array.isArray(polygonVertices) || polygonVertices.length < 3) {
    return false;
  }

  let inside = false;
  for (let index = 0, previous = polygonVertices.length - 1; index < polygonVertices.length; previous = index, index += 1) {
    const current = polygonVertices[index];
    const last = polygonVertices[previous];
    if (!current || !last) {
      continue;
    }

    if (includeBoundary && distancePointSegmentSq(point, last, current) <= toleranceSq) {
      return true;
    }

    const intersects = ((current.y > point.y) !== (last.y > point.y))
      && (
        point.x
        < (((last.x - current.x) * (point.y - current.y)) / (last.y - current.y)) + current.x
      );
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInPolygon(point, polygonVertices, includeBoundary, geometryService, toleranceSq = DEFAULT_TOLERANCE_SQ) {
  if (geometryService && typeof geometryService.isPointInPolygon === 'function') {
    return geometryService.isPointInPolygon(point, polygonVertices, includeBoundary);
  }
  return isPointInPolygonFallback(point, polygonVertices, includeBoundary, toleranceSq);
}

function normalizeRingPoints(points, toleranceSq = DEFAULT_TOLERANCE_SQ) {
  if (!Array.isArray(points)) {
    return [];
  }
  const normalized = [];
  for (const point of points) {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
      continue;
    }
    if (normalized.length === 0 || distanceSq(normalized[normalized.length - 1], point) > toleranceSq) {
      normalized.push({ x: point.x, y: point.y });
    }
  }
  if (normalized.length >= 2 && distanceSq(normalized[0], normalized[normalized.length - 1]) <= toleranceSq) {
    normalized.pop();
  }
  return normalized;
}

function createIdFactory(prefix, usedIds) {
  let counter = 1;
  return () => {
    let candidate = `${prefix}${counter}`;
    counter += 1;
    while (usedIds.has(candidate)) {
      candidate = `${prefix}${counter}`;
      counter += 1;
    }
    usedIds.add(candidate);
    return candidate;
  };
}

function getRingCoordinates(ring, vertexMap) {
  if (!ring || !Array.isArray(ring.vertexIds) || ring.vertexIds.length < 3) {
    return null;
  }
  const coordinates = [];
  for (const vertexId of ring.vertexIds) {
    const vertex = vertexMap.get(vertexId);
    if (!vertex) {
      return null;
    }
    if (typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
      return null;
    }
    coordinates.push([vertex.x, vertex.y]);
  }
  return coordinates;
}

function buildMultiPolygonFromShape(shape, vertexMap) {
  const rings = Array.isArray(shape?.rings) ? shape.rings : [];
  const territoryRings = rings.filter(ring => ring?.ringType === 'territory');
  if (territoryRings.length === 0) {
    return [];
  }

  const holesByParent = new Map();
  for (const ring of rings) {
    if (ring?.ringType !== 'hole') {
      continue;
    }
    const parentKey = typeof ring.parentId === 'string' ? ring.parentId : null;
    if (!holesByParent.has(parentKey)) {
      holesByParent.set(parentKey, []);
    }
    holesByParent.get(parentKey).push(ring);
  }

  const multiPolygon = [];
  for (const territory of territoryRings) {
    const outer = getRingCoordinates(territory, vertexMap);
    if (!Array.isArray(outer) || outer.length < 3) {
      continue;
    }
    const polygon = [outer];
    const holes = holesByParent.get(territory.id) || [];
    for (const hole of holes) {
      const holeCoords = getRingCoordinates(hole, vertexMap);
      if (Array.isArray(holeCoords) && holeCoords.length >= 3) {
        polygon.push(holeCoords);
      }
    }
    multiPolygon.push(polygon);
  }
  return multiPolygon;
}

function isMultiPolygonEmpty(multiPolygon) {
  if (!Array.isArray(multiPolygon) || multiPolygon.length === 0) {
    return true;
  }
  for (const polygon of multiPolygon) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      continue;
    }
    for (const ring of polygon) {
      if (Array.isArray(ring) && ring.length >= 3) {
        return false;
      }
    }
  }
  return true;
}

function signedArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const left = points[j];
    const right = points[i];
    area += (left.x * right.y) - (right.x * left.y);
  }
  return area / 2;
}

function getBoundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!point) {
      continue;
    }
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
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

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < epsilon) {
      continue;
    }
    const normalX = -dy / length;
    const normalY = dx / length;
    const scale = isCCW ? 1 : -1;
    const candidate = {
      x: (start.x + end.x) / 2 + normalX * epsilon * scale,
      y: (start.y + end.y) / 2 + normalY * epsilon * scale
    };
    if (isPointInPolygon(candidate, points, false, geometryService)) {
      return candidate;
    }
  }

  if (bbox) {
    const center = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
    if (isPointInPolygon(center, points, false, geometryService)) {
      return center;
    }
  }
  return points[0];
}

function buildRingHierarchyFromMultiPolygon(multiPolygon, geometryService, toleranceSq = DEFAULT_TOLERANCE_SQ) {
  const ringEntries = [];

  for (const polygon of multiPolygon || []) {
    if (!Array.isArray(polygon)) {
      continue;
    }
    for (const ringCoords of polygon) {
      if (!Array.isArray(ringCoords)) {
        continue;
      }
      const points = normalizeRingPoints(
        ringCoords.map(coord => ({ x: coord[0], y: coord[1] })),
        toleranceSq
      );
      if (points.length >= 3) {
        ringEntries.push({ points });
      }
    }
  }

  if (ringEntries.length === 0) {
    return [];
  }

  const parentIndices = ringEntries.map(() => null);
  const areas = ringEntries.map(entry => Math.abs(signedArea(entry.points)));

  for (let index = 0; index < ringEntries.length; index += 1) {
    const entry = ringEntries[index];
    const interiorPoint = findInteriorPoint(entry.points, geometryService);
    let parentIndex = null;
    let parentArea = Infinity;

    for (let candidateIndex = 0; candidateIndex < ringEntries.length; candidateIndex += 1) {
      if (candidateIndex === index) {
        continue;
      }
      const candidate = ringEntries[candidateIndex];
      if (!isPointInPolygon(interiorPoint, candidate.points, false, geometryService, toleranceSq)) {
        continue;
      }
      const candidateArea = areas[candidateIndex];
      if (candidateArea < parentArea) {
        parentArea = candidateArea;
        parentIndex = candidateIndex;
      }
    }

    parentIndices[index] = parentIndex;
  }

  const depths = new Array(ringEntries.length).fill(0);
  const resolveDepth = (index) => {
    if (depths[index] !== 0) {
      return depths[index];
    }
    const parentIndex = parentIndices[index];
    if (parentIndex === null || parentIndex === undefined) {
      depths[index] = 1;
      return 1;
    }
    depths[index] = resolveDepth(parentIndex) + 1;
    return depths[index];
  };
  for (let index = 0; index < ringEntries.length; index += 1) {
    resolveDepth(index);
  }

  return ringEntries.map((entry, index) => ({
    points: entry.points,
    ringType: depths[index] % 2 === 1 ? 'territory' : 'hole',
    parentIndex: parentIndices[index]
  }));
}

function buildVertexIdResolver(world, toleranceSq = DEFAULT_TOLERANCE_SQ) {
  const vertices = Array.isArray(world.vertices) ? world.vertices : [];
  const usedIds = new Set(vertices
    .filter(vertex => vertex && typeof vertex.id === 'string')
    .map(vertex => vertex.id));
  const coordinateToVertexId = new Map();
  for (const vertex of vertices) {
    if (!vertex || typeof vertex.id !== 'string' || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
      continue;
    }
    coordinateToVertexId.set(buildCoordinateKey(vertex), vertex.id);
  }
  const generateVertexId = createIdFactory('vertex-conflict-', usedIds);

  return (point) => {
    const coordinateKey = buildCoordinateKey(point);
    if (coordinateToVertexId.has(coordinateKey)) {
      return coordinateToVertexId.get(coordinateKey);
    }

    for (const vertex of vertices) {
      if (!vertex || typeof vertex.id !== 'string' || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
        continue;
      }
      if (distanceSq(vertex, point) <= toleranceSq) {
        coordinateToVertexId.set(coordinateKey, vertex.id);
        return vertex.id;
      }
    }

    const id = generateVertexId();
    const nextVertex = { id, x: point.x, y: point.y };
    vertices.push(nextVertex);
    coordinateToVertexId.set(coordinateKey, id);
    return id;
  };
}

function buildRingIdFactory(feature) {
  const usedRingIds = new Set();
  const anchors = Array.isArray(feature?.anchors) ? feature.anchors : [];
  for (const anchor of anchors) {
    const rings = Array.isArray(anchor?.shape?.rings) ? anchor.shape.rings : [];
    for (const ring of rings) {
      if (ring && typeof ring.id === 'string') {
        usedRingIds.add(ring.id);
      }
    }
  }
  return createIdFactory('ring-conflict-', usedRingIds);
}

function buildShapeFromMultiPolygonDifference(multiPolygon, world, geometryService, ringIdFactory) {
  const hierarchy = buildRingHierarchyFromMultiPolygon(multiPolygon, geometryService);
  if (hierarchy.length === 0) {
    return null;
  }

  const resolveVertexId = buildVertexIdResolver(world);
  const ringIdByIndex = new Map();
  hierarchy.forEach((_, index) => {
    ringIdByIndex.set(index, ringIdFactory());
  });

  const rings = hierarchy.map((entry, index) => ({
    id: ringIdByIndex.get(index),
    vertexIds: entry.points.map(point => resolveVertexId(point)),
    ringType: entry.ringType,
    parentId: entry.parentIndex === null || entry.parentIndex === undefined
      ? null
      : ringIdByIndex.get(entry.parentIndex)
  }));

  if (!rings.some(ring => ring.ringType === 'territory')) {
    return null;
  }
  return {
    type: 'Polygon',
    rings
  };
}

function buildConflictAnchorId(featureId, cutoffTime, anchors) {
  const month = cutoffTime.month ?? 'null';
  const day = cutoffTime.day ?? 'null';
  const base = `anchor-${featureId}-${cutoffTime.year}-${month}-${day}-conflict`;
  const usedIds = new Set((anchors || []).map(anchor => anchor.id));
  if (!usedIds.has(base)) {
    return base;
  }
  let suffix = 1;
  let candidate = `${base}-${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function getFeatureAnchors(feature) {
  if (Array.isArray(feature?.anchors) && feature.anchors.length > 0) {
    return [...feature.anchors];
  }
  throw new Error(`Feature ${feature?.id ?? '(unknown)'} に履歴アンカーが存在しません。`);
}

function normalizeAndValidateAnchorTimeline(anchors) {
  const sorted = [...anchors];
  sorted.sort((left, right) => compareTimePoints(left.startTime, right.startTime));

  const seenAnchors = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const anchor = sorted[index];
    if (!(anchor instanceof FeatureAnchor)) {
      throw new Error('履歴アンカーが FeatureAnchor ではありません。');
    }

    const start = anchor.startTime;
    if (!(start instanceof TimePoint)) {
      throw new Error('履歴アンカーの開始時刻が不正です。');
    }
    if (seenAnchors.some(existing => existing.equals(start))) {
      throw new Error('同一時刻の歴史の錨が重複しています。');
    }

    const endTime = anchor.endTime;
    if (endTime !== null && endTime !== undefined) {
      if (!(endTime instanceof TimePoint)) {
        throw new Error('存在終了は TimePoint で指定してください。');
      }
      if (!start.isBefore(endTime)) {
        throw new Error('存在終了は開始時刻より後に設定してください。');
      }
    }

    const nextAnchor = sorted[index + 1];
    if (nextAnchor) {
      if (!(nextAnchor instanceof FeatureAnchor)) {
        throw new Error('履歴アンカーが FeatureAnchor ではありません。');
      }
      if (endTime instanceof TimePoint && nextAnchor.startTime.isBefore(endTime)) {
        throw new Error('存在終了は次の歴史の錨の開始時刻を超えられません。');
      }
    }

    seenAnchors.push(start);
  }

  return sorted;
}

function normalizeConflictResolutions(conflictResolutions) {
  const normalized = new Map();
  if (!conflictResolutions || typeof conflictResolutions !== 'object') {
    return normalized;
  }
  for (const [conflictId, value] of Object.entries(conflictResolutions)) {
    if (!conflictId) {
      continue;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      normalized.set(conflictId, value.trim());
      continue;
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof value.preferFeatureId === 'string' &&
      value.preferFeatureId.trim() !== ''
    ) {
      normalized.set(conflictId, value.preferFeatureId.trim());
    }
  }
  return normalized;
}

function collectConflictsForPolygons(polygons, world, layerService, geometryService, affectedTimeRange = undefined) {
  const conflictMap = new Map();
  polygons.forEach(polygon => {
    if (!(polygon instanceof Polygon)) {
      return;
    }
    const conflicts = collectPolygonExclusivityConflicts(
      polygon,
      world,
      layerService,
      geometryService,
      affectedTimeRange
    );
    conflicts.forEach(conflict => {
      if (!conflictMap.has(conflict.id)) {
        conflictMap.set(conflict.id, conflict);
      }
    });
  });
  return [...conflictMap.values()];
}

function resolveConflictByPreferredFeature(world, winnerFeatureId, loserFeatureId, cutoffTime, geometryService) {
  const loserFeatureIndex = world.features.findIndex(feature => feature.id === loserFeatureId);
  if (loserFeatureIndex === -1) {
    throw new Error(`競合解決対象の地物が見つかりません: ${loserFeatureId}`);
  }
  const winnerFeature = world.features.find(feature => feature.id === winnerFeatureId);
  if (!(winnerFeature instanceof Polygon)) {
    throw new Error(`競合解決で優先された地物が見つかりません: ${winnerFeatureId}`);
  }
  const loserFeature = world.features[loserFeatureIndex];
  if (!(loserFeature instanceof Polygon) || typeof loserFeature.withAnchors !== 'function') {
    throw new Error(`競合解決対象の地物が更新できません: ${loserFeatureId}`);
  }

  const loserAnchors = normalizeAndValidateAnchorTimeline(getFeatureAnchors(loserFeature));
  const activeAnchorIndex = loserAnchors.findIndex(anchor => anchor.isActiveAt(cutoffTime));
  if (activeAnchorIndex === -1) {
    return false;
  }
  const winnerAnchor = winnerFeature.getAnchorAt(cutoffTime);
  if (!(winnerAnchor instanceof FeatureAnchor)) {
    return false;
  }

  const activeAnchor = loserAnchors[activeAnchorIndex];
  const start = activeAnchor.startTime;
  if (!(start instanceof TimePoint)) {
    throw new Error(`地物 ${loserFeatureId} の履歴アンカー開始時刻が不正です。`);
  }

  const vertexMap = new Map(
    (world.vertices || [])
      .filter(vertex => vertex && typeof vertex.id === 'string')
      .map(vertex => [vertex.id, vertex])
  );
  const loserMultiPolygon = buildMultiPolygonFromShape(activeAnchor.shape, vertexMap);
  const winnerMultiPolygon = buildMultiPolygonFromShape(winnerAnchor.shape, vertexMap);
  if (isMultiPolygonEmpty(loserMultiPolygon) || isMultiPolygonEmpty(winnerMultiPolygon)) {
    return false;
  }

  const overlap = polygonClipping.intersection(loserMultiPolygon, winnerMultiPolygon);
  if (isMultiPolygonEmpty(overlap)) {
    return false;
  }

  const difference = polygonClipping.difference(loserMultiPolygon, winnerMultiPolygon);
  const ringIdFactory = buildRingIdFactory(loserFeature);
  const nextShape = buildShapeFromMultiPolygonDifference(difference, world, geometryService, ringIdFactory);
  const nextAnchors = [...loserAnchors];

  if (!nextShape) {
    if (start.equals(cutoffTime)) {
      if (nextAnchors.length <= 1) {
        throw new Error(`地物 ${loserFeatureId} の履歴アンカーが空になるため、この競合解決方針は適用できません。`);
      }
      nextAnchors.splice(activeAnchorIndex, 1);
    } else {
      if (activeAnchor.endTime instanceof TimePoint && activeAnchor.endTime.equals(cutoffTime)) {
        return false;
      }
      nextAnchors[activeAnchorIndex] = activeAnchor.withTimeRange(activeAnchor.startTime, cutoffTime);
    }
  } else if (start.equals(cutoffTime)) {
    nextAnchors[activeAnchorIndex] = activeAnchor.withShape(nextShape);
  } else {
    const splitAnchor = new FeatureAnchor({
      id: buildConflictAnchorId(loserFeature.id, cutoffTime, nextAnchors),
      timeRange: {
        start: cutoffTime,
        end: activeAnchor.endTime
      },
      property: {
        name: activeAnchor.name,
        description: activeAnchor.description,
        attributes: activeAnchor.getAttributes()
      },
      shape: nextShape,
      placement: activeAnchor.placement
    });
    nextAnchors.splice(
      activeAnchorIndex,
      1,
      activeAnchor.withTimeRange(activeAnchor.startTime, cutoffTime),
      splitAnchor
    );
  }

  world.features[loserFeatureIndex] = loserFeature.withAnchors(normalizeAndValidateAnchorTimeline(nextAnchors));
  return true;
}

/**
 * @param {{
 *   editedPolygons: Polygon[],
  *   world: {features: any[]},
  *   layerService: any,
  *   geometryService: any,
 *   conflictResolutions?: Record<string, {preferFeatureId: string}>,
 *   affectedTimeRange?: {start?: TimePoint, end?: TimePoint | null}
 * }} options
 * @returns {Set<string>}
 */
export function resolvePolygonAnchorConflictsOrThrow(options) {
  const polygons = Array.isArray(options?.editedPolygons)
    ? options.editedPolygons.filter(polygon => polygon instanceof Polygon)
    : [];
  if (polygons.length === 0) {
    return new Set();
  }
  const world = options?.world;
  if (!world || !Array.isArray(world.features)) {
    return new Set();
  }
  const layerService = options?.layerService;
  const geometryService = options?.geometryService;
  if (!layerService || !geometryService) {
    return new Set();
  }

  const affectedTimeRange = options?.affectedTimeRange;
  const conflicts = collectConflictsForPolygons(polygons, world, layerService, geometryService, affectedTimeRange);
  if (conflicts.length === 0) {
    return new Set();
  }

  const normalizedResolutions = normalizeConflictResolutions(options?.conflictResolutions);
  const unresolvedConflicts = conflicts.filter(conflict => !normalizedResolutions.has(conflict.id));
  if (unresolvedConflicts.length > 0) {
    throw new FeatureAnchorConflictError(
      '同一レイヤー上の面情報が重なっています。解決方針を指定してください。',
      conflicts
    );
  }

  const changedFeatureIds = new Set();
  for (const conflict of conflicts) {
    const preferredFeatureId = normalizedResolutions.get(conflict.id);
    if (preferredFeatureId !== conflict.featureIdA && preferredFeatureId !== conflict.featureIdB) {
      throw new Error(`競合 ${conflict.id} の解決方針が不正です。`);
    }

    const loserFeatureId = preferredFeatureId === conflict.featureIdA
      ? conflict.featureIdB
      : conflict.featureIdA;
    const winnerFeatureId = preferredFeatureId;
    const didChange = resolveConflictByPreferredFeature(
      world,
      winnerFeatureId,
      loserFeatureId,
      conflict.timePoint,
      geometryService
    );
    if (didChange) {
      changedFeatureIds.add(loserFeatureId);
    }
  }

  const refreshedPolygons = polygons
    .map(polygon => world.features.find(feature => feature.id === polygon.id))
    .filter(feature => feature instanceof Polygon);
  const remainingConflicts = collectConflictsForPolygons(
    refreshedPolygons.length > 0 ? refreshedPolygons : polygons,
    world,
    layerService,
    geometryService,
    affectedTimeRange
  );
  if (remainingConflicts.length > 0) {
    throw new FeatureAnchorConflictError(
      '指定された解決方針では重なりを解消できません。別の方針を選択してください。',
      remainingConflicts
    );
  }

  return changedFeatureIds;
}
