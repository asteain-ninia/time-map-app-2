// src/application/usecases/feature/AddFeatureUseCase.js

import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon';
import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor';
import { ensurePolygonLayerConstraints } from './polygonLayerValidation.js';

/**
 * 地理オブジェクトの追加を専門に処理するユースケース
 */
export class AddFeatureUseCase {
  /**
   * @param {WorldRepository} worldRepository
   * @param {GeometryService} geometryService
   * @param {LayerService} layerService
   * @param {Function} generateId - ID生成関数 (EditFeatureUseCaseから提供)
   * @param {Function} processGeometry - 形状処理関数 (EditFeatureUseCaseから提供)
   * @param {Function} getVerticesFromIds - 頂点取得関数 (EditFeatureUseCaseから提供)
   */
  constructor(worldRepository, geometryService, layerService, generateId, processGeometry, getVerticesFromIds) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService;
    this._layerService = layerService;
    this._generateId = generateId;
    this._processGeometry = processGeometry;
    this._getVerticesFromIds = getVerticesFromIds;
  }

  /**
   * 新しい地理オブジェクトを追加
   * @param {string} featureType - オブジェクトタイプ ('point', 'line', 'polygon')
   * @param {FeatureAnchor[]} anchors - 履歴アンカー（FeatureAnchorインスタンスの配列、要素数1を期待）
   * @param {Object} geometry - 形状情報 { vertices?: {x,y}[], vertexIds?: string[], holesVertexIds?: string[][], parentId?: string, isMultiPolygon?: boolean, subPolygons?: object[] }
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Feature>} 追加されたオブジェクト
   */
  async execute(featureType, anchors, geometry, layerId) {
    if (!Array.isArray(anchors) || anchors.length !== 1 || !(anchors[0] instanceof FeatureAnchor)) {
      throw new Error("Invalid anchors format for AddFeatureUseCase. Expected a single FeatureAnchor instance in an array.");
    }
    const world = await this._worldRepository.getWorld();
    const existingVertexIds = new Set(world.vertices.map(vertex => vertex.id));

    const featureId = this._generateId(featureType);

    const processedGeometry = this._processGeometry(geometry, world); // vertexIds を生成

    let feature;

    try {
      switch (featureType) {
        case 'point':
          if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length !== 1) {
            throw new Error("Point geometry must have exactly one vertexId.");
          }
          const pointVertexId = processedGeometry.vertexIds[0];
          const pointAnchors = this._createAnchorsForNewFeature(
            featureId,
            anchors,
            { type: 'Point', vertexId: pointVertexId },
            { layerId }
          );
          feature = new Point(
            featureId,
            [pointVertexId],
            pointAnchors.map(anchor => anchor.toPropertyProjection()),
            layerId,
            pointAnchors
          );
          break;
        case 'line':
          if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 2) {
            throw new Error("Line geometry must have at least two vertexIds.");
          }
          {
            const lineVertexIds = [...processedGeometry.vertexIds];
            const lineAnchors = this._createAnchorsForNewFeature(
              featureId,
              anchors,
              { type: 'LineString', vertexIds: [...lineVertexIds] },
              { layerId }
            );
            feature = new Line(
              featureId,
              lineVertexIds,
              lineAnchors.map(anchor => anchor.toPropertyProjection()),
              layerId,
              lineAnchors
            );
          }
          break;
        case 'polygon':
          if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 3) {
            throw new Error("Polygon geometry must have at least three vertexIds for the outer ring.");
          }
          const outerRingVertices = this._getVerticesFromIds(processedGeometry.vertexIds, world);
          if (this._geometryService.isPolygonSelfIntersecting(outerRingVertices)) {
              throw new Error("新規ポリゴンの外周リングが自己交差しています。");
          }
          // Polygon コンストラクタ (id, properties, layerId, parentId, childIds, rings)
          const outerRing = {
              id: this._generateId('ring'),
              vertexIds: [...processedGeometry.vertexIds],
              ringType: 'territory',
              parentId: null
          };
          const rings = [outerRing];

          if (Array.isArray(processedGeometry.holesVertexIds) && processedGeometry.holesVertexIds.length > 0) {
            for (const holeVertexIds of processedGeometry.holesVertexIds) {
              if (!Array.isArray(holeVertexIds) || holeVertexIds.length < 3) {
                continue;
              }
              const holeVertices = this._getVerticesFromIds(holeVertexIds, world);
              if (holeVertices.length !== holeVertexIds.length) {
                throw new Error("Hole ring contains unknown vertex IDs.");
              }
              if (this._geometryService.isPolygonSelfIntersecting(holeVertices)) {
                throw new Error("追加された穴リングが自己交差しています。");
              }
              rings.push({
                id: this._generateId('ring'),
                vertexIds: [...holeVertexIds],
                ringType: 'hole',
                parentId: outerRing.id
              });
            }
          }

          {
            const parentId = processedGeometry.parentId || "0";
            const polygonAnchors = this._createAnchorsForNewFeature(
              featureId,
              anchors,
              {
                type: 'Polygon',
                rings: rings.map(ring => ({
                  id: ring.id,
                  vertexIds: [...ring.vertexIds],
                  ringType: ring.ringType,
                  parentId: ring.parentId
                }))
              },
              {
                layerId,
                parentId,
                childIds: []
              }
            );
            feature = new Polygon(
              featureId,
              polygonAnchors.map(anchor => anchor.toPropertyProjection()),
              layerId,
              parentId,
              [],
              rings,
              polygonAnchors
            );
          }

          ensurePolygonLayerConstraints(feature, world, this._layerService, this._geometryService);
          break;
        default:
          throw new Error(`Unknown feature type: ${featureType}`);
      }
    } catch (error) {
      this._revertNewVertices(world, existingVertexIds);
      throw error;
    }

    world.features.push(feature);
    await this._worldRepository.saveWorld(world);
    return feature;
  }

  _createAnchorsForNewFeature(featureId, anchors, shape, placement) {
    return anchors.map((anchor, index) => new FeatureAnchor({
      id: `anchor-${featureId}-${index + 1}`,
      timeRange: {
        start: anchor.startTime,
        end: anchor.endTime ?? null
      },
      property: {
        name: anchor.name,
        description: anchor.description,
        attributes: anchor.getAttributes()
      },
      shape,
      placement
    }));
  }

  _revertNewVertices(world, existingVertexIds) {
    const newVertexIds = world.vertices
      .filter(vertex => !existingVertexIds.has(vertex.id))
      .map(vertex => vertex.id);

    if (newVertexIds.length === 0) {
      return;
    }

    const newVertexSet = new Set(newVertexIds);
    world.vertices = world.vertices.filter(vertex => !newVertexSet.has(vertex.id));
  }

  /**
   * ポリゴンの追加検証 (リングベース移行後は PolygonEditService に移動)
   * @param {Object} geometry - 形状情報 { vertexIds?, holesVertexIds?, parentId?, isMultiPolygon?, subPolygons? }
   * @param {string} layerId - レイヤーID
   * @param {Object} world - 世界データ
   * @private
   */
   _validatePolygonAddition(geometry, layerId, world) {
    // このメソッドはリングベースの PolygonEditService の validatePolygonRings に
    // 責務が移譲されているため、ここでは詳細な実装は不要。
    // AddFeatureUseCase 内での自己交差チェックは既に実行されている。
   }
}
