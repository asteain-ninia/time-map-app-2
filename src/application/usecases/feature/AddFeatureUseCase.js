// src\application\usecases\feature\AddFeatureUseCase.js

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
        // Point.create は内部で new Point(...) を呼ぶ
        feature = Point.create(featureId, properties, pointGeometry, layerId);
        break;
      case 'line':
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 2) {
          throw new Error("Line geometry must have at least two vertexIds.");
        }
        const lineGeometry = { vertexIds: processedGeometry.vertexIds };
        // Line.create は内部で new Line(...) を呼ぶ
        feature = Line.create(featureId, properties, lineGeometry, layerId);
        break;
      case 'polygon':
        // ポリゴンの検証 (リングベース移行後は PolygonEditService に委譲)
        // this._validatePolygonAddition(processedGeometry, layerId, world); // 検証はPolygonEditServiceで行うためコメントアウト

        // リングベースの Polygon コンストラクタを直接呼び出す
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 3) {
          throw new Error("Polygon geometry must have at least three vertexIds for the outer ring.");
        }

        // 単純なポリゴン追加なので、外周リングを1つ作成
        const outerRing = {
            id: this._generateId('ring'), // リングIDを生成
            vertexIds: [...processedGeometry.vertexIds], // 頂点IDをコピー
            isOuter: true, // 外周フラグ
            parentId: null  // 最外周リングなので親はnull
        };
        const rings = [outerRing];

        // コンストラクタ呼び出し
        feature = new Polygon(
            featureId,
            properties,
            layerId,
            processedGeometry.parentId || "0", // 親ポリゴンID (あれば)
            [], // 新規作成なので childIds は空
            rings // 生成したリング配列
        );
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
    // TODO: リングベース移行後、この検証ロジックは PolygonEditService に移動または再実装される
    // 現在は一時的にコメントアウト

    /*
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
    */
  }
}
