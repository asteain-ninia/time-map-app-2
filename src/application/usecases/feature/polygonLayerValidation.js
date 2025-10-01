import { Polygon } from '../../../domain/entities/Polygon.js';

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

  if (!layerService.validatePolygonHierarchy(polygon, candidatePolygons, world.layers)) {
    throw new Error(`ポリゴン ${polygon.id} はレイヤー階層の制約に違反しています。`);
  }

  if (!layerService.isContainedInHigherLayerPolygon(polygon, candidatePolygons, world.vertices, world.layers, geometryService)) {
    throw new Error(`ポリゴン ${polygon.id} は上位レイヤーの親ポリゴンの内側に収まる必要があります。`);
  }

  const layerPolygons = candidatePolygons.filter(candidate => candidate.layerId === polygon.layerId);
  if (!layerService.checkExclusivity(polygon, layerPolygons, world.vertices, geometryService)) {
    throw new Error(`ポリゴン ${polygon.id} がレイヤー ${polygon.layerId} 上の他の領域と重なっています。`);
  }
}
