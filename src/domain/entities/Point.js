// src/domain/entities/Point.js

import { Feature } from './Feature.js';
import { Property } from '../value-objects/Property.js'; // Propertyをインポート

/**
 * 点情報を表すエンティティ
 */
export class Point extends Feature {
  /**
   * 点情報オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列（通常は単一要素）
   * @param {Property[]} properties - 時間依存プロパティの配列
   * @param {string} layerId - 所属レイヤーID
   */
  constructor(id, vertexIds, properties, layerId) {
    super(id, vertexIds, properties, layerId);
    
    // 点情報は1つの頂点のみを持つべき
    if (vertexIds.length !== 1) {
      throw new Error('Point must have exactly one vertex');
    }
  }

  /**
   * 頂点IDを取得
   * @returns {string} 頂点ID
   */
  get vertexId() {
    return this._vertexIds[0];
  }

  /**
   * 新しい点情報を作成するファクトリーメソッド
   * @param {string} id - 一意のID
   * @param {Property[]} properties - プロパティの配列
   * @param {Object} geometry - 形状情報 { vertexId: string }
   * @param {string} layerId - レイヤーID
   * @returns {Point} 新しい点情報オブジェクト
   */
  static create(id, properties, geometry, layerId) {
    // properties が要素数1の Property インスタンスの配列であることをバリデーション
    // (バリデーションは AddFeatureUseCase で行うので、ここではそのまま渡す)
    // if (!Array.isArray(properties) || properties.length !== 1 || !(properties[0] instanceof Property)) {
    //     console.warn("Point.create: properties must be an array with a single Property instance. Received:", properties);
    // }
    return new Point(id, [geometry.vertexId], properties, layerId);
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成
   * @param {Property[]} properties - 新しいプロパティの配列
   * @returns {Point} 新しい点情報オブジェクト
   */
  withProperties(properties) {
    const normalized = Feature._normalizeProperties(this._id, properties);
    return new Point(this._id, this._vertexIds, normalized, this._layerId);
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Point} 新しい点情報オブジェクト
   */
  withLayerId(layerId) {
    // this._properties を引き継ぐ
    return new Point(this._id, this._vertexIds, this._properties, layerId);
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成
   * @param {string[]} vertexIds - 新しい頂点IDの配列 (要素数1を期待)
   * @returns {Point} 新しい点情報オブジェクト
   */
  withVertexIds(vertexIds) {
    if (!Array.isArray(vertexIds) || vertexIds.length !== 1) {
      throw new Error('Point.withVertexIds expects an array with exactly one vertexId.');
    }
    // this._properties を引き継ぐ
    return new Point(this._id, vertexIds, this._properties, this._layerId);
  }
}

