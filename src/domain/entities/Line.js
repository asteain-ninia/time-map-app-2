import { Feature } from './Feature.js';
import { Property } from '../value-objects/Property.js'; // Propertyをインポート

/**
 * 線情報を表すエンティティ
 */
export class Line extends Feature {
  /**
   * 線情報オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列（順序付き）
   * @param {Property[]} properties - 時間依存プロパティの配列 (要素数1を期待)
   * @param {string} layerId - 所属レイヤーID
   */
  constructor(id, vertexIds, properties, layerId) {
    super(id, vertexIds, properties, layerId);
    
    // 線情報は少なくとも2つの頂点を持つべき
    if (vertexIds.length < 2) {
      throw new Error('Line must have at least two vertices');
    }
  }

  /**
   * 新しい線情報を作成するファクトリーメソッド
   * @param {string} id - 一意のID
   * @param {Property[]} properties - プロパティの配列 (要素数1を期待)
   * @param {Object} geometry - 形状情報 { vertexIds: string[] }
   * @param {string} layerId - レイヤーID
   * @returns {Line} 新しい線情報オブジェクト
   */
  static create(id, properties, geometry, layerId) {
    // properties が要素数1の Property インスタンスの配列であることをバリデーション
    if (!Array.isArray(properties) || properties.length !== 1 || !(properties[0] instanceof Property)) {
        console.warn("Line.create: properties must be an array with a single Property instance. Received:", properties);
    }
    return new Line(id, geometry.vertexIds, properties, layerId);
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成
   * @param {Property[]} properties - 新しいプロパティの配列 (要素数1を期待)
   * @returns {Line} 新しい線情報オブジェクト
   */
  withProperties(properties) {
    const normalized = Feature._normalizeProperties(this._id, properties);
    return new Line(this._id, this._vertexIds, normalized, this._layerId);
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Line} 新しい線情報オブジェクト
   */
  withLayerId(layerId) {
    return new Line(this._id, this._vertexIds, this._properties, layerId);
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成
   * @param {string[]} vertexIds - 新しい頂点IDの配列 (最低2要素を期待)
   * @returns {Line} 新しい線情報オブジェクト
   */
  withVertexIds(vertexIds) {
    if (!Array.isArray(vertexIds) || vertexIds.length < 2) {
      throw new Error('Line.withVertexIds expects an array with at least two vertexIds.');
    }
    return new Line(this._id, vertexIds, this._properties, this._layerId);
  }
}

