// src/application/services/IPolygonEditService.js

/**
 * ポリゴン編集サービスのインターフェース定義
 */
export class IPolygonEditService {
  /**
   * ポリゴンのリング構造を検証する
   * @param {Polygon} polygon - 検証対象のポリゴン (リングベース構造)
   * @param {World} world - ワールドデータ
   * @returns {Promise<void>} 検証エラーがあれば例外をスロー
   * @abstract
   */
  async validatePolygonRings(polygon, world) {
    throw new Error("Method 'validatePolygonRings' not implemented.");
  }

  /**
   * ポリゴンに新しいリングを追加する
   * @param {string} polygonId - 対象ポリゴンのID
   * @param {object} ringData - 追加するリングの情報 { vertexIds: string[], ringType: 'territory' | 'hole', parentId?: string }
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス
   * @abstract
   */
  async addRingToPolygon(polygonId, ringData) {
    throw new Error("Method 'addRingToPolygon' not implemented.");
  }

  /**
   * ポリゴンからリングを削除する
   * @param {string} polygonId - 対象ポリゴンのID
   * @param {string} ringId - 削除するリングのID
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス
   * @abstract
   */
  async removeRingFromPolygon(polygonId, ringId) {
    throw new Error("Method 'removeRingFromPolygon' not implemented.");
  }

  /**
   * ポリゴンの特定のリングの頂点を更新する
   * @param {string} polygonId - 対象ポリゴンのID
   * @param {string} ringId - 更新するリングのID
   * @param {string[]} newVertexIds - 新しい頂点ID配列
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス
   * @abstract
   */
  async updateRingVertices(polygonId, ringId, newVertexIds) {
    throw new Error("Method 'updateRingVertices' not implemented.");
  }

  /**
   * ポリゴンの形状情報全体を更新する（リングベース構造を考慮）
   * @param {Polygon} currentPolygon - 更新前のポリゴンインスタンス
   * @param {Object} geometryUpdates - 更新される形状情報 (リング操作を含む可能性)
   * @param {World} world - ワールドデータ
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス
   * @abstract
   */
   async updatePolygonGeometry(currentPolygon, geometryUpdates, world) {
     throw new Error("Method 'updatePolygonGeometry' not implemented.");
   }

  /**
   * ポリゴンを分裂させる (リングベース対応)
   * @param {string} polygonId - 分裂するポリゴンのID
   * @param {Object} divisionData - 分裂情報
   * @returns {Promise<Object>} 更新情報 { originalPolygon?, newPolygons }
   * @abstract
   */
  async splitPolygon(polygonId, divisionData) {
     throw new Error("Method 'splitPolygon' not implemented.");
  }

  // 必要に応じて他のメソッドインターフェースを追加
}