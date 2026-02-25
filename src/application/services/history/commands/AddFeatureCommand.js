// src/application/services/history/commands/AddFeatureCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { Vertex } from '../../../../domain/entities/Vertex.js';

/**
 * 地物追加操作をカプセル化するコマンド
 */
export class AddFeatureCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.featureId - 追加された地物のID
   * @param {Object} payload.featureData - 追加された地物のデータ（プレーンオブジェクト）
   * @param {Object[]} payload.addedVerticesData - 追加された頂点のデータ（プレーンオブジェクト）
   * @param {Array<{featureId:string,beforeFeatureData:Object,afterFeatureData:Object}>} [payload.additionalFeatureChanges]
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
    const world = await this._worldRepository.getWorld();
    let hasChanges = false;

    // 1. 頂点を復元
    if (this._payload.addedVerticesData && Array.isArray(this._payload.addedVerticesData)) {
      this._payload.addedVerticesData.forEach(vData => {
        const vertexInstance = this._serializer.deserialize(vData);
        if (vertexInstance instanceof Vertex && !world.vertices.some(v => v.id === vertexInstance.id)) {
          world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
          hasChanges = true;
        }
      });
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
      hasChanges = true;
    }
    const additionalUpdatedFeatures = [];
    const additionalFeatureChanges = Array.isArray(this._payload.additionalFeatureChanges)
      ? this._payload.additionalFeatureChanges
      : [];
    for (const change of additionalFeatureChanges) {
      const afterFeatureData = change?.afterFeatureData;
      if (!afterFeatureData) {
        continue;
      }
      const afterFeature = this._serializer.deserialize(afterFeatureData);
      if (!afterFeature || afterFeature.id === featureInstance?.id) {
        continue;
      }
      const index = world.features.findIndex(feature => feature.id === afterFeature.id);
      if (index !== -1) {
        world.features[index] = afterFeature;
      } else {
        world.features.push(afterFeature);
      }
      hasChanges = true;
      additionalUpdatedFeatures.push(afterFeature);
    }
    if (hasChanges) {
      await this._worldRepository.saveWorld(world);
    }

    const result = {};
    if (featureInstance) {
      result.addedFeature = featureInstance;
    }
    if (additionalUpdatedFeatures.length > 0) {
      result.updatedFeatures = additionalUpdatedFeatures;
    }
    return result;
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    await this._editFeatureUseCase.deleteFeature(this._payload.featureId);
    const additionalUpdatedFeatures = [];
    const additionalFeatureChanges = Array.isArray(this._payload.additionalFeatureChanges)
      ? this._payload.additionalFeatureChanges
      : [];

    if (additionalFeatureChanges.length > 0) {
      const world = await this._worldRepository.getWorld();
      let hasChanges = false;
      for (const change of additionalFeatureChanges) {
        const beforeFeatureData = change?.beforeFeatureData;
        if (!beforeFeatureData) {
          continue;
        }
        const beforeFeature = this._serializer.deserialize(beforeFeatureData);
        if (!beforeFeature || beforeFeature.id === this._payload.featureId) {
          continue;
        }
        const index = world.features.findIndex(feature => feature.id === beforeFeature.id);
        if (index !== -1) {
          world.features[index] = beforeFeature;
        } else {
          world.features.push(beforeFeature);
        }
        hasChanges = true;
        additionalUpdatedFeatures.push(beforeFeature);
      }

      if (hasChanges) {
        await this._worldRepository.saveWorld(world);
      }
    }

    const result = { deletedFeatureId: this._payload.featureId };
    if (additionalUpdatedFeatures.length > 0) {
      result.updatedFeatures = additionalUpdatedFeatures;
    }
    return result;
  }
}
