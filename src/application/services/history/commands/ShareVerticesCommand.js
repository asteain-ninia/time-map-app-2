// src/application/services/history/commands/ShareVerticesCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { Vertex } from '../../../../domain/entities/Vertex.js';

/**
 * 共有頂点化操作をカプセル化するコマンド
 */
export class ShareVerticesCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.vertexId1 - 共有化する頂点ID
   * @param {string} payload.vertexId2 - 共有化する頂点ID
   * @param {string | null} [payload.keptVertexId] - 共有化で残した頂点ID
   * @param {Object} payload.removedVertexData - 共有化で削除された頂点のデータ（プレーンオブジェクト）
   * @param {Object[]} payload.affectedFeaturesBefore - 影響を受けた地物の操作前の状態（プレーンオブジェクト）
   * @param {EditFeatureUseCase} editFeatureUseCase - 地物編集ユースケース
   * @param {WorldRepository} worldRepository - ワールドリポジトリ
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
    const { vertexId1, vertexId2, keptVertexId } = this._payload;
    const options = keptVertexId === vertexId1 || keptVertexId === vertexId2
      ? { preferredKeptVertexId: keptVertexId }
      : {};
    const shareResult = await this._editFeatureUseCase.shareVertices(vertexId1, vertexId2, options);
    return { updatedFeatures: shareResult?.affectedFeatures || [] };
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    let world = await this._worldRepository.getWorld();
    const { removedVertexData, affectedFeaturesBefore } = this._payload;
    const restoredFeatures = [];

    if (removedVertexData) {
      const vertexInstance = this._serializer.deserialize(removedVertexData);
      if (vertexInstance instanceof Vertex && !world.vertices.some(v => v.id === vertexInstance.id)) {
        world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
        await this._worldRepository.saveWorld(world);
        world = await this._worldRepository.getWorld();
      }
    }

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
        return { updatedFeatures: restoredFeatures };
      }
    }

    return {};
  }
}
