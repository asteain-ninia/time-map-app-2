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
    this._getVerticesFromIds = getVerticesFromIds; // 検証用に保持
  }

  /**
   * 新しい地理オブジェクトを追加
   * @param {string} featureType - オブジェクトタイプ ('point', 'line', 'polygon')
   * @param {Property[]} properties - プロパティ情報 (Propertyインスタンスの配列)
   * @param {Object} geometry - 形状情報 { vertices?: {x,y}[], vertexIds?: string[], holesVertexIds?: string[][], parentId?: string, isMultiPolygon?: boolean, subPolygons?: object[] }
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Feature>} 追加されたオブジェクト
   */
  async execute(featureType, properties, geometry, layerId) {
    if (!Array.isArray(properties) || !properties.every(p => p instanceof Property)) {
      console.error("AddFeatureUseCase: properties must be an array of Property instances.", properties);
      throw new Error("Invalid properties format.");
    }
    const world = await this._worldRepository.getWorld();

    // IDの生成
    const featureId = this._generateId(featureType);

    // 形状情報の検証とID割り当て (EditFeatureUseCaseのヘルパーを利用)
    // processedGeometry は { vertexIds?, holesVertexIds?, parentId?, isMultiPolygon?, subPolygons? } を持つ
    // 注意: _processGeometry は world.vertices を変更する副作用を持つ
    const processedGeometry = this._processGeometry(geometry, world);

    // 適切なファクトリーメソッドを使用して地物オブジェクトを作成
    let feature;
    switch (featureType) {
      case 'point':
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length !== 1) {
          throw new Error("Point geometry must have exactly one vertexId.");
        }
        const pointGeometry = { vertexId: processedGeometry.vertexIds[0] };
        feature = Point.create(featureId, properties, pointGeometry, layerId);
        break;
      case 'line':
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 2) {
          throw new Error("Line geometry must have at least two vertexIds.");
        }
        const lineGeometry = { vertexIds: processedGeometry.vertexIds };
        feature = Line.create(featureId, properties, lineGeometry, layerId);
        break;
      case 'polygon':
        // ポリゴンの検証 (リングベース移行後は PolygonEditService に委譲)
        this._validatePolygonAddition(processedGeometry, layerId, world);
        // Polygon.create は geometry { vertexIds?, holesVertexIds?, parentId?, isMultiPolygon?, subPolygons?, childIds? } を期待
        feature = Polygon.create(featureId, properties, processedGeometry, layerId);
        break;
      default:
        throw new Error(`Unknown feature type: ${featureType}`);
    }

    // オブジェクトを追加
    // 注意: world は _processGeometry で変更されている可能性がある
    world.features.push(feature);

    // 世界データを保存
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
    // TODO: 同一レイヤー内のポリゴンとの排他性チェック (LayerService)
    // TODO: 親ポリゴンとの関係チェック (LayerService)

    // 自己交差チェック
    if (geometry.vertexIds && geometry.vertexIds.length >= 3) {
        const vertices = this._getVerticesFromIds(geometry.vertexIds, world);
        if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
             throw new Error("Polygon cannot self-intersect.");
        }
    }
    geometry.holesVertexIds?.forEach(holeIds => {
        if (holeIds.length >= 3) {
             const vertices = this._getVerticesFromIds(holeIds, world);
             if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                 throw new Error("Polygon hole cannot self-intersect.");
             }
        }
    });
    geometry.subPolygons?.forEach(sub => {
         if (sub.vertexIds && sub.vertexIds.length >= 3) {
             const vertices = this._getVerticesFromIds(sub.vertexIds, world);
             if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                 throw new Error("Sub-polygon cannot self-intersect.");
             }
         }
         sub.holesVertexIds?.forEach(holeIds => {
            if (holeIds.length >= 3) {
                const vertices = this._getVerticesFromIds(holeIds, world);
                if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                    throw new Error("Sub-polygon hole cannot self-intersect.");
                }
            }
         });
    });
  }
}