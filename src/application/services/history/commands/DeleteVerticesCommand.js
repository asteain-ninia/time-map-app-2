// src/application/services/history/commands/DeleteVerticesCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { Vertex } from '../../../../domain/entities/Vertex.js';

/**
 * 複数頂点削除操作をカプセル化するコマンド
 */
export class DeleteVerticesCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string[]} payload.deletedVertexIds - 削除対象の頂点ID配列
   * @param {Object[]} payload.verticesToRestoreData - 復元に必要な頂点のデータ（プレーンオブジェクト）
   * @param {Object[]} payload.affectedFeaturesBefore - 影響を受けた地物の操作前の状態（プレーンオブジェクト）
   * @param {EditFeatureUseCase} editFeatureUseCase - 地物編集ユースケース
   * @param {WorldRepository} worldRepository - ワールドリポジトリ（直接操作用）
   * @param {HistorySerializer} serializer - シリアライザ
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
    const { deletedVertexIds } = this._payload;
    const deleteResult = await this._editFeatureUseCase.deleteVertices(deletedVertexIds);
    // deleteVerticesは { deletedVertexIds, updatedFeatureIds, deletedFeatureIds } を返す
    return { deletedVertexResult: deleteResult, eventType: 'VerticesDeletedCustom', eventPayload: deleteResult };
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    let world = await this._worldRepository.getWorld();
    const { verticesToRestoreData, affectedFeaturesBefore } = this._payload;
    const restoredFeatures = [];

    // 1. 削除された頂点をワールドに「追加」
    if (verticesToRestoreData && Array.isArray(verticesToRestoreData)) {
      let verticesRestored = false;
      verticesToRestoreData.forEach(vDataPlain => {
        const vertexInstance = this._serializer.deserialize(vDataPlain);
        if (vertexInstance instanceof Vertex && !world.vertices.some(wv => wv.id === vertexInstance.id)) {
          world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
          verticesRestored = true;
        }
      });
      if (verticesRestored) {
        await this._worldRepository.saveWorld(world);
        world = await this._worldRepository.getWorld();
      }
    }

    // 2. 影響を受けた地物の状態を元に戻す、または削除された地物を復元
    if (affectedFeaturesBefore && Array.isArray(affectedFeaturesBefore)) {
      for (const featureBeforePlain of affectedFeaturesBefore) {
        const featureInstanceToRestore = this._serializer.deserialize(featureBeforePlain);
        if (!featureInstanceToRestore) continue;

        const indexInWorld = world.features.findIndex(f => f.id === featureInstanceToRestore.id);
        if (indexInWorld !== -1) {
          world.features[indexInWorld] = featureInstanceToRestore;
        } else {
          world.features.push(featureInstanceToRestore);
        }
        restoredFeatures.push(featureInstanceToRestore);
      }
      if (restoredFeatures.length > 0) {
        await this._worldRepository.saveWorld(world);
        // 復元された地物インスタンスの配列を返す
        return { updatedFeatures: restoredFeatures };
      }
    }

    return {};
  }
}