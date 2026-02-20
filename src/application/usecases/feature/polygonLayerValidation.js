import { Polygon } from '../../../domain/entities/Polygon.js';
import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';

function getPropertyStartAnchor(property) {
  if (!property || typeof property !== 'object') {
    return null;
  }
  return property.startTime || null;
}

function compareTimePoints(left, right) {
  if (left.equals(right)) {
    return 0;
  }
  return left.isBefore(right) ? -1 : 1;
}

function collectValidationTimePoints(polygons) {
  const unique = new Map();

  for (const polygon of polygons) {
    if (!(polygon instanceof Polygon)) {
      continue;
    }
    const timelineEntries = Array.isArray(polygon.anchors) ? polygon.anchors : [];
    if (timelineEntries.length === 0) {
      throw new Error(`Polygon ${polygon.id} に履歴アンカーが存在しません。`);
    }

    for (const entry of timelineEntries) {
      const start = getPropertyStartAnchor(entry);
      if (start instanceof TimePoint) {
        unique.set(`${start.year}:${start.month ?? 'null'}:${start.day ?? 'null'}`, start);
      }

      const end = entry?.endTime ?? null;
      if (end instanceof TimePoint) {
        unique.set(`${end.year}:${end.month ?? 'null'}:${end.day ?? 'null'}`, end);
      }
    }
  }

  const sorted = [...unique.values()];
  sorted.sort((left, right) => compareTimePoints(left, right));
  return sorted;
}

function formatTimePoint(timePoint) {
  if (!(timePoint instanceof TimePoint)) {
    return '不明時刻';
  }
  if (timePoint.month === null || timePoint.month === undefined) {
    return `${timePoint.year}`;
  }
  if (timePoint.day === null || timePoint.day === undefined) {
    return `${timePoint.year}/${timePoint.month}`;
  }
  return `${timePoint.year}/${timePoint.month}/${timePoint.day}`;
}

function toTimeKey(timePoint) {
  if (!(timePoint instanceof TimePoint)) {
    return 'unknown';
  }
  return `${timePoint.year}:${timePoint.month ?? 'null'}:${timePoint.day ?? 'null'}`;
}

function toPairKey(featureIdA, featureIdB) {
  return [String(featureIdA), String(featureIdB)].sort().join('::');
}

function cloneRings(rings) {
  return (rings || []).map(ring => ({
    id: ring.id,
    vertexIds: [...ring.vertexIds],
    ringType: ring.ringType,
    parentId: ring.parentId ?? null
  }));
}

function buildPolygonSnapshotAtTime(polygon, timePoint) {
  if (!(polygon instanceof Polygon) || !polygon.existsAt(timePoint)) {
    return null;
  }

  const activeAnchor = typeof polygon.getAnchorAt === 'function'
    ? polygon.getAnchorAt(timePoint)
    : null;
  if (!(activeAnchor instanceof FeatureAnchor)) {
    return null;
  }

  const ringsAtTime = typeof polygon.getRingsAt === 'function'
    ? polygon.getRingsAt(timePoint)
    : polygon.rings;
  const placementAtTime = typeof polygon.getPlacementAt === 'function'
    ? polygon.getPlacementAt(timePoint)
    : {
      layerId: polygon.layerId,
      parentId: polygon.parentId,
      childIds: polygon.childIds
    };

  const normalizedPlacement = {
    layerId: placementAtTime.layerId,
    parentId: placementAtTime.parentId ?? '0',
    childIds: Array.isArray(placementAtTime.childIds) ? [...placementAtTime.childIds] : []
  };
  const normalizedRings = cloneRings(ringsAtTime || []);
  const snapshotAnchor = new FeatureAnchor({
    id: activeAnchor.id,
    timeRange: {
      start: activeAnchor.startTime,
      end: activeAnchor.endTime
    },
    property: {
      name: activeAnchor.name,
      description: activeAnchor.description,
      attributes: activeAnchor.getAttributes()
    },
    shape: {
      type: 'Polygon',
      rings: normalizedRings
    },
    placement: normalizedPlacement
  });

  return new Polygon(
    polygon.id,
    [],
    normalizedPlacement.layerId,
    normalizedPlacement.parentId,
    normalizedPlacement.childIds,
    normalizedRings,
    [snapshotAnchor]
  );
}

export function collectPolygonExclusivityConflicts(polygon, world, layerService, geometryService) {
  if (!(polygon instanceof Polygon)) {
    return [];
  }

  const worldPolygons = world.features.filter(feature => feature instanceof Polygon);
  const hasExisting = worldPolygons.some(existing => existing.id === polygon.id);
  const candidatePolygons = hasExisting
    ? worldPolygons.map(existing => (existing.id === polygon.id ? polygon : existing))
    : [...worldPolygons, polygon];

  const validationTimes = collectValidationTimePoints(candidatePolygons);
  const conflictsByPair = new Map();

  for (const timePoint of validationTimes) {
    if (!polygon.existsAt(timePoint)) {
      continue;
    }

    const activeSnapshots = candidatePolygons
      .map(candidate => buildPolygonSnapshotAtTime(candidate, timePoint))
      .filter(candidate => candidate instanceof Polygon);
    const polygonSnapshot = activeSnapshots.find(candidate => candidate.id === polygon.id);
    if (!polygonSnapshot) {
      continue;
    }
    const sameLayerPolygons = activeSnapshots.filter(candidate => candidate.layerId === polygonSnapshot.layerId);

    if (!layerService.checkExclusivity(polygonSnapshot, [polygonSnapshot], world.vertices, geometryService)) {
      throw new Error(
        `ポリゴン ${polygonSnapshot.id} の形状が不正です。競合解決前に形状を修正してください。 (時刻: ${formatTimePoint(timePoint)})`
      );
    }

    for (const otherPolygon of sameLayerPolygons) {
      if (otherPolygon.id === polygonSnapshot.id) {
        continue;
      }
      const isExclusive = layerService.checkExclusivity(
        polygonSnapshot,
        [polygonSnapshot, otherPolygon],
        world.vertices,
        geometryService
      );
      if (isExclusive) {
        continue;
      }

      const pairKey = toPairKey(polygon.id, otherPolygon.id);
      if (conflictsByPair.has(pairKey)) {
        continue;
      }

      conflictsByPair.set(pairKey, {
        id: `polygon-overlap:${pairKey}:${toTimeKey(timePoint)}`,
        type: 'polygon_overlap',
        timePoint,
        timeLabel: formatTimePoint(timePoint),
        layerId: polygonSnapshot.layerId,
        featureIdA: polygonSnapshot.id,
        featureIdB: otherPolygon.id
      });
    }
  }

  return [...conflictsByPair.values()];
}

/**
 * ポリゴンがレイヤー/階層ルールを満たしているか検証する。
 * @param {Polygon} polygon
 * @param {{features: any[], layers: any[], vertices: any[]}} world
 * @param {LayerService} layerService
 * @param {GeometryService} geometryService
 * @throws {Error} いずれかの検証に失敗した場合
 */
export function ensurePolygonLayerConstraints(polygon, world, layerService, geometryService) {
  if (!(polygon instanceof Polygon)) {
    return;
  }

  const worldPolygons = world.features.filter(feature => feature instanceof Polygon);
  const hasExisting = worldPolygons.some(existing => existing.id === polygon.id);
  const candidatePolygons = hasExisting
    ? worldPolygons.map(existing => (existing.id === polygon.id ? polygon : existing))
    : [...worldPolygons, polygon];

  const validationTimes = collectValidationTimePoints(candidatePolygons);
  for (const timePoint of validationTimes) {
    if (!polygon.existsAt(timePoint)) {
      continue;
    }

    const activePolygons = candidatePolygons
      .map(candidate => buildPolygonSnapshotAtTime(candidate, timePoint))
      .filter(candidate => candidate instanceof Polygon);
    const targetPolygon = activePolygons.find(candidate => candidate.id === polygon.id);
    if (!targetPolygon) {
      continue;
    }

    if (!layerService.validatePolygonHierarchy(targetPolygon, activePolygons, world.layers)) {
      throw new Error(`ポリゴン ${targetPolygon.id} はレイヤー階層の制約に違反しています。 (時刻: ${formatTimePoint(timePoint)})`);
    }

    if (!layerService.isContainedInHigherLayerPolygon(targetPolygon, activePolygons, world.vertices, world.layers, geometryService)) {
      throw new Error(`ポリゴン ${targetPolygon.id} は上位レイヤーの親ポリゴンの内側に収まる必要があります。 (時刻: ${formatTimePoint(timePoint)})`);
    }

    const layerPolygons = activePolygons.filter(candidate => candidate.layerId === targetPolygon.layerId);
    if (!layerService.checkExclusivity(targetPolygon, layerPolygons, world.vertices, geometryService)) {
      throw new Error(`ポリゴン ${targetPolygon.id} がレイヤー ${targetPolygon.layerId} 上の他の領域と重なっています。 (時刻: ${formatTimePoint(timePoint)})`);
    }
  }
}
