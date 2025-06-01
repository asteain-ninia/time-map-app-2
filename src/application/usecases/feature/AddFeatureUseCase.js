// src/application/usecases/feature/AddFeatureUseCase.js

import { Feature } from '../../../domain/entities/Feature';
import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon';
import { Property } from '../../../domain/value-objects/Property';
import { Vertex } from '../../../domain/entities/Vertex'; // 比較用

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
   * @param {Property[]} properties - プロパティ情報 (Propertyインスタンスの配列、要素数1を期待)
   * @param {Object} geometry - 形状情報 { vertices?: {x,y}[], vertexIds?: string[], holesVertexIds?: string[][], parentId?: string, isMultiPolygon?: boolean, subPolygons?: object[] }
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Feature>} 追加されたオブジェクト
   */
  async execute(featureType, properties, geometry, layerId) {
    // properties が要素数1の Property インスタンスの配列であることをバリデーション
    if (!Array.isArray(properties) || properties.length !== 1 || !(properties[0] instanceof Property)) {
      console.error("AddFeatureUseCase: properties must be an array containing a single Property instance. Received:", properties);
      throw new Error("Invalid properties format for AddFeatureUseCase. Expected a single Property instance in an array.");
    }
    const world = await this._worldRepository.getWorld();

    const featureId = this._generateId(featureType);

    const processedGeometry = this._processGeometry(geometry, world); // vertexIds を生成

    let feature;
    // properties は検証済みの要素数1の Property[] 配列

    switch (featureType) {
      case 'point':
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length !== 1) {
          throw new Error("Point geometry must have exactly one vertexId.");
        }
        // Point.create のシグネチャ (id, properties, geometry, layerId) に合わせる
        const pointGeometry = { vertexId: processedGeometry.vertexIds[0] };
        feature = Point.create(featureId, properties, pointGeometry, layerId); // 修正: properties を直接使用
        break;
      case 'line':
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 2) {
          throw new Error("Line geometry must have at least two vertexIds.");
        }
        // Line.create のシグネチャ (id, properties, geometry, layerId) に合わせる
        const lineGeometry = { vertexIds: processedGeometry.vertexIds };
        feature = Line.create(featureId, properties, lineGeometry, layerId); // 修正: properties を直接使用
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
            isOuter: true,
            parentId: null
        };
        const rings = [outerRing];
        feature = new Polygon(
            featureId,
            properties, // 修正: properties を直接使用
            layerId,
            processedGeometry.parentId || "0",
            [], // 新規作成なので childIds は空
            rings
        );
        break;
      default:
        throw new Error(`Unknown feature type: ${featureType}`);
    }

    world.features.push(feature);
    await this._worldRepository.saveWorld(world);
    return feature;
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