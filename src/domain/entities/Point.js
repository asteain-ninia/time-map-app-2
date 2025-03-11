import { Feature } from './Feature.js';

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
    return new Point(id, [geometry.vertexId], properties, layerId);
  }
}