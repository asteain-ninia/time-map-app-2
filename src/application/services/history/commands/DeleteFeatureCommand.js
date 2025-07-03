// src/application/services/history/commands/DeleteFeatureCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { Vertex } from '../../../../domain/entities/Vertex.js';

/**
 * 地物削除操作をカプセル化するコマンド
 */
export class DeleteFeatureCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.featureId - 削除された地物のID
   * @param {Object} payload.featureData - 削除された地物のデータ（プレーンオブジェクト）
   * @param {Object[]} payload.verticesToRestoreData - 復元に必要な頂点のデータ（プレーンオブジェクト）
   * @param {EditFeatureUseCase} editFeatureUseCase - 地物編集ユースケース
   * @param {WorldRepository} worldRepository - ワールドリポジトリ（直接操作用）
   * @param {HistorySerializer} serializer - シリアライザ
   */
  constructor(payload, editFeatureUseCase, worldRepository, serializer) {
    this._payload = payload;
    this._editFeatureUseCase = editFeatureUseCase;
    this._worldRepository = worldRepository; // 頂点追加と地物復元はUseCaseに無いため直接操作
    this._serializer = serializer;
  }

  /**
   * 操作を実行（Redo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async execute() {
    await this._editFeatureUseCase.deleteFeature(this._payload.featureId);
    return { deletedFeatureId: this._payload.featureId };
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    const world = await this._worldRepository.getWorld();

    // 1. 頂点を復元
    if (this._payload.verticesToRestoreData && Array.isArray(this._payload.verticesToRestoreData)) {
        let verticesAdded = false;
        this._payload.verticesToRestoreData.forEach(vData => {
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

    // 2. 地物を復元
    const featureInstance = this._serializer.deserialize(this._payload.featureData);
    if (featureInstance) {
        const existingFeatureIndex = world.features.findIndex(f => f.id === featureInstance.id);
        if (existingFeatureIndex !== -1) {
            world.features[existingFeatureIndex] = featureInstance;
        } else {
            world.features.push(featureInstance);
        }
        await this._worldRepository.saveWorld(world);
        return { addedFeature: featureInstance };
    }

    return {};
  }
}