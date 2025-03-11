/**
 * 世界データのリポジトリインターフェース
 */
export class WorldRepository {
  /**
   * 世界データの読み込み
   * @returns {Promise<Object>} 世界データ
   */
  async getWorld() {
    throw new Error('Method not implemented');
  }

  /**
   * 世界データの保存
   * @param {Object} world - 保存する世界データ
   * @returns {Promise<void>}
   */
  async saveWorld(world) {
    throw new Error('Method not implemented');
  }
}