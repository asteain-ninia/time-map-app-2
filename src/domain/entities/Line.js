import { Feature } from './Feature.js';

/**
 * 線情報を表すエンティティ
 */
export class Line extends Feature {
  /**
   * 線情報オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列（順序付き）
   * @param {Property[]} properties - 時間依存プロパティの配列
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
   * @param {Property[]} properties - プロパティの配列
   * @param {Object} geometry - 形状情報 { vertexIds: string[] }
   * @param {string} layerId - レイヤーID
   * @returns {Line} 新しい線情報オブジェクト
   */
  static create(id, properties, geometry, layerId) {
    return new Line(id, geometry.vertexIds, properties, layerId);
  }
}