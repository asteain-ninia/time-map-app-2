// src/application/services/history/commands/AddRingCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { Vertex } from '../../../../domain/entities/Vertex.js';

/**
 * リング追加操作をカプセル化するコマンド
 */
export class AddRingCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.polygonId
   * @param {Object} payload.addedRing - プレーンオブジェクト
   * @param {Object[]} payload.addedVerticesData - プレーンオブジェクトの配列
   * @param {EditFeatureUseCase} editFeatureUseCase
   * @param {WorldRepository} worldRepository
   * @param {HistorySerializer} serializer
   */
  constructor(payload, editFeatureUseCase, worldRepository, serializer) {
    this._payload = payload;
    this._editFeatureUseCase = editFeatureUseCase;
    this._worldRepository = worldRepository;
    this._serializer = serializer;
  }

  /**
   * 操作を実行（Redo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async execute() {
    let world = await this._worldRepository.getWorld();

    // 1. 必要な頂点をワールドに追加
    if (this._payload.addedVerticesData && Array.isArray(this._payload.addedVerticesData)) {
      let verticesAdded = false;
      this._payload.addedVerticesData.forEach(vData => {
        const vertexInstance = this._serializer.deserialize(vData);
        if (vertexInstance instanceof Vertex && !world.vertices.some(v => v.id === vertexInstance.id)) {
          world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
          verticesAdded = true;
        }
      });
      if (verticesAdded) {
        await this._worldRepository.saveWorld(world);
      }
    }
    
    // 2. リングをポリゴンに追加
    const ringToAdd = this._payload.addedRing;
    if (ringToAdd && typeof ringToAdd.id === 'string') {
        const geometryUpdate = { existingRingData: [ringToAdd] };
        const updateResult = await this._editFeatureUseCase.updateFeature(this._payload.polygonId, { geometry: geometryUpdate });
        const updatedPolygon = updateResult.feature;
        return { updatedFeature: updatedPolygon };
    }
    return {};
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    const ringToRemove = this._payload.addedRing;
    if (ringToRemove && typeof ringToRemove.id === 'string') {
        const geometryUpdate = { removedRingIds: [ringToRemove.id] };
        const updateResult = await this._editFeatureUseCase.updateFeature(this._payload.polygonId, { geometry: geometryUpdate });
        const updatedPolygon = updateResult.feature;

        // 関連する頂点をクリーンアップ
        if (this._payload.addedVerticesData && this._payload.addedVerticesData.length > 0) {
            const vertexIdsToRemove = this._payload.addedVerticesData.map(v => v.id);
            await this._editFeatureUseCase.deleteVertices(vertexIdsToRemove);
        }
        
        return { updatedFeature: updatedPolygon };
    }
    return {};
  }
}