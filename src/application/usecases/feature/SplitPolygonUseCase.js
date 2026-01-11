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
    if (!splitPlan || !Array.isArray(splitPlan.polygons) || splitPlan.polygons.length !== 2) {
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

    const polygonPlanToKeep = splitPlan.polygons[inheritIndex];
    const polygonPlanToCreate = splitPlan.polygons[inheritIndex === 0 ? 1 : 0];
    const ringsToKeepPlan = this._normalizeRingPlan(polygonPlanToKeep);
    const ringsToCreatePlan = this._normalizeRingPlan(polygonPlanToCreate);

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
    const updatedRings = this._buildRingsFromPlan(ringsToKeepPlan, resolveVertexId);
    const newRings = this._buildRingsFromPlan(ringsToCreatePlan, resolveVertexId);

    const updatedPolygon = new Polygon(
      originalPolygon.id,
      originalPolygon.properties,
      originalPolygon.layerId,
      originalPolygon.parentId,
      originalPolygon.childIds,
      updatedRings
    );
    const newPolygonId = this._generateId('polygon');
    const newPolygon = new Polygon(
      newPolygonId,
      [newProperty],
      originalPolygon.layerId,
      originalPolygon.parentId,
      [],
      newRings
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
    if (!Array.isArray(polygon.rings) || polygon.rings.length === 0) {
      throw new Error('形状を持つ面情報のみ分割できます。');
    }
  }

  _normalizeRingPlan(polygonPlan) {
    if (!polygonPlan || !Array.isArray(polygonPlan.rings) || polygonPlan.rings.length === 0) {
      throw new Error('分割結果の面が成立しません。');
    }
    polygonPlan.rings.forEach((ring, index) => {
      if (!ring || !Array.isArray(ring.points) || ring.points.length < 3) {
        throw new Error('分割結果のリングが不正です。');
      }
      if (ring.ringType !== 'territory' && ring.ringType !== 'hole') {
        throw new Error('分割結果のリング種別が不正です。');
      }
      if (ring.parentIndex !== null && ring.parentIndex !== undefined) {
        if (!Number.isInteger(ring.parentIndex) || ring.parentIndex < 0 || ring.parentIndex >= polygonPlan.rings.length) {
          throw new Error('分割結果の親リング指定が不正です。');
        }
        if (ring.parentIndex === index) {
          throw new Error('分割結果の親リング指定が不正です。');
        }
      }
      ring.points.forEach(point => {
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
          throw new Error('分割点の座標が不正です。');
        }
      });
      const coords = ring.points.map(point => ({ x: point.x, y: point.y }));
      if (this._geometryService.isPolygonSelfIntersecting(coords)) {
        throw new Error('分割結果の面が自己交差しています。');
      }
    });
    return polygonPlan.rings;
  }

  _buildRingsFromPlan(ringsPlan, resolveVertexId) {
    const ringsWithIndices = ringsPlan.map((ring) => ({
      id: this._generateId('ring'),
      vertexIds: ring.points.map(resolveVertexId),
      ringType: ring.ringType,
      parentIndex: ring.parentIndex ?? null
    }));

    const idByIndex = new Map();
    ringsWithIndices.forEach((ring, index) => {
      idByIndex.set(index, ring.id);
    });

    return ringsWithIndices.map((ring) => ({
      id: ring.id,
      vertexIds: ring.vertexIds,
      ringType: ring.ringType,
      parentId: ring.parentIndex !== null ? idByIndex.get(ring.parentIndex) : null
    }));
  }
}
