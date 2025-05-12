// src/application/services/IdGenerationService.js

/**
 * ID生成サービス
 */
export class IdGenerationService {
  /**
   * 新しいIDを生成する
   * @param {string} type - 生成するIDのタイプ (例: 'feature', 'vertex', 'ring')
   * @returns {string} 生成された一意のID
   */
  generateId(type) {
    const timestamp = new Date().getTime();
    const random = Math.floor(Math.random() * 10000);
    return `${type}-${timestamp}-${random}`;
  }
}