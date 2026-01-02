import { Polygon } from '../../../domain/entities/Polygon.js';
import { Property } from '../../../domain/value-objects/Property.js';
import { ensurePolygonLayerConstraints } from './polygonLayerValidation.js';

export class SplitPolygonUseCase {
  constructor(worldRepository, geometryService, layerService, generateId) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService;
    this._layerService = layerService;
    this._generateId = generateId;
  }

  async execute(polygonId, splitPlan, inheritSideIndex, newProperty) {
    if (!polygonId) {
      throw new Error('分割対象のポリゴンIDが指定されていません。');
    }
    if (!splitPlan || !Array.isArray(splitPlan.ringA) || !Array.isArray(splitPlan.ringB)) {
      throw new Error('分割結果の情報が不足しています。');
    }
    if (!(newProperty instanceof Property)) {
      throw new Error('新しいプロパティが不正です。');
    }
    const inheritIndex = inheritSideIndex === 1 ? 1 : 0;

    const world = await this._worldRepository.getWorld();
    const originalVerticesSnapshot = world.vertices.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }));

    const polygonIndex = world.features.findIndex(
      feature => feature instanceof Polygon && feature.id === polygonId
    );
    if (polygonIndex === -1) {
      throw new Error(`分割対象のポリゴンが見つかりません: ${polygonId}`);
    }

    const originalPolygon = world.features[polygonIndex];
    this._assertSplittablePolygon(originalPolygon);

    const ringToUpdate = originalPolygon.rings[0];
    const ringPointsToKeep = inheritIndex === 0 ? splitPlan.ringA : splitPlan.ringB;
    const ringPointsToCreate = inheritIndex === 0 ? splitPlan.ringB : splitPlan.ringA;

    this._validateRingPoints(ringPointsToKeep);
    this._validateRingPoints(ringPointsToCreate);

    const ringKeepCoords = ringPointsToKeep.map(point => ({ x: point.x, y: point.y }));
    const ringCreateCoords = ringPointsToCreate.map(point => ({ x: point.x, y: point.y }));
    if (this._geometryService.isPolygonSelfIntersecting(ringKeepCoords)) {
      throw new Error('分割結果の面が自己交差しています。');
    }
    if (this._geometryService.isPolygonSelfIntersecting(ringCreateCoords)) {
      throw new Error('分割結果の面が自己交差しています。');
    }

    const newVertexIdsByKey = new Map();
    const addedVerticesData = [];

    const resolveVertexId = (point) => {
      if (point.sourceVertexId) {
        return point.sourceVertexId;
      }
      const key = point.key;
      if (!key) {
        throw new Error('分割点の識別子が不足しています。');
      }
      if (newVertexIdsByKey.has(key)) {
        return newVertexIdsByKey.get(key);
      }
      const vertexId = this._generateId('vertex');
      newVertexIdsByKey.set(key, vertexId);
      world.vertices.push({ id: vertexId, x: point.x, y: point.y });
      addedVerticesData.push({ id: vertexId, x: point.x, y: point.y });
      return vertexId;
    };

    const updatedRingVertexIds = ringPointsToKeep.map(resolveVertexId);
    const newRingVertexIds = ringPointsToCreate.map(resolveVertexId);

    const updatedPolygon = originalPolygon.withUpdatedRingVertices(ringToUpdate.id, updatedRingVertexIds);
    const newPolygonId = this._generateId('polygon');
    const newRing = {
      id: this._generateId('ring'),
      vertexIds: [...newRingVertexIds],
      ringType: 'territory',
      parentId: null
    };
    const newPolygon = new Polygon(
      newPolygonId,
      [newProperty],
      originalPolygon.layerId,
      originalPolygon.parentId,
      [],
      [newRing]
    );

    const originalFeaturesSnapshot = world.features.slice();
    try {
      world.features[polygonIndex] = updatedPolygon;
      world.features.push(newPolygon);

      ensurePolygonLayerConstraints(updatedPolygon, world, this._layerService, this._geometryService);
      ensurePolygonLayerConstraints(newPolygon, world, this._layerService, this._geometryService);

      await this._worldRepository.saveWorld(world);
    } catch (error) {
      world.vertices = originalVerticesSnapshot.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }));
      world.features = originalFeaturesSnapshot;
      throw error;
    }

    return {
      updatedPolygon,
      newPolygon,
      addedVerticesData
    };
  }

  _assertSplittablePolygon(polygon) {
    if (!(polygon instanceof Polygon)) {
      throw new Error('分割対象がポリゴンではありません。');
    }
    if (polygon.childIds && polygon.childIds.length > 0) {
      throw new Error('下位領域を持つ面情報は分割できません。');
    }
    if (!Array.isArray(polygon.rings) || polygon.rings.length !== 1) {
      throw new Error('外周リングが1つの面情報のみ分割できます。');
    }
    const ring = polygon.rings[0];
    if (!ring || ring.ringType !== 'territory') {
      throw new Error('外周リングの情報が不正です。');
    }
  }

  _validateRingPoints(points) {
    if (!Array.isArray(points) || points.length < 3) {
      throw new Error('分割結果の面が成立しません。');
    }
    points.forEach(point => {
      if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
        throw new Error('分割点の座標が不正です。');
      }
    });
  }
}
