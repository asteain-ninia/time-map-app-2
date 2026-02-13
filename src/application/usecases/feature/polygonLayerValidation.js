import { Polygon } from '../../../domain/entities/Polygon.js';
import { Property } from '../../../domain/value-objects/Property.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';

function getPropertyStartAnchor(property) {
  if (!(property instanceof Property)) {
    return null;
  }
  return property.startTime || property.timePoint || null;
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
    if (!(polygon instanceof Polygon) || !Array.isArray(polygon.properties)) {
      continue;
    }

    for (const property of polygon.properties) {
      const start = getPropertyStartAnchor(property);
      if (start instanceof TimePoint) {
        unique.set(`${start.year}:${start.month ?? 'null'}:${start.day ?? 'null'}`, start);
      }

      const end = property instanceof Property ? property.endTime : null;
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

    const activePolygons = candidatePolygons.filter(candidate => candidate.existsAt(timePoint));

    if (!layerService.validatePolygonHierarchy(polygon, activePolygons, world.layers)) {
      throw new Error(`ポリゴン ${polygon.id} はレイヤー階層の制約に違反しています。 (時刻: ${formatTimePoint(timePoint)})`);
    }

    if (!layerService.isContainedInHigherLayerPolygon(polygon, activePolygons, world.vertices, world.layers, geometryService)) {
      throw new Error(`ポリゴン ${polygon.id} は上位レイヤーの親ポリゴンの内側に収まる必要があります。 (時刻: ${formatTimePoint(timePoint)})`);
    }

    const layerPolygons = activePolygons.filter(candidate => candidate.layerId === polygon.layerId);
    if (!layerService.checkExclusivity(polygon, layerPolygons, world.vertices, geometryService)) {
      throw new Error(`ポリゴン ${polygon.id} がレイヤー ${polygon.layerId} 上の他の領域と重なっています。 (時刻: ${formatTimePoint(timePoint)})`);
    }
  }
}
