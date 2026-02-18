// src/application/services/history/commands/UpdatePropertiesCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { FeatureAnchor } from '../../../../domain/value-objects/FeatureAnchor.js';

/**
 * プロパティ更新操作をカプセル化するコマンド
 */
export class UpdatePropertiesCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.featureId - 対象の地物ID
   * @param {Object[]} payload.oldAnchors - 更新前の履歴アンカー（プレーンオブジェクト）
   * @param {Object[]} payload.newAnchors - 更新後の履歴アンカー（プレーンオブジェクト）
   * @param {EditFeatureUseCase} editFeatureUseCase - 地物編集ユースケース
   * @param {HistorySerializer} serializer - シリアライザ
   * @param {WorldRepository} worldRepository - ワールドリポジトリ（追加）
   */
  constructor(payload, editFeatureUseCase, serializer, worldRepository) {
    this._payload = payload;
    this._editFeatureUseCase = editFeatureUseCase;
    this._serializer = serializer;
    this._worldRepository = worldRepository; // 保持するが一貫性のため。直接は使わない。
  }

  /**
   * 操作を実行（Redo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async execute() {
    const { featureId } = this._payload;
    const timelineData = this._payload.newAnchors || [];
    const updatePayload = this._buildTimelineUpdatePayload(timelineData);
    const updateResult = await this._editFeatureUseCase.updateFeature(featureId, updatePayload);
    const updatedFeature = updateResult.feature;
    return { updatedFeature };
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    const { featureId } = this._payload;
    const timelineData = this._payload.oldAnchors || [];
    const updatePayload = this._buildTimelineUpdatePayload(timelineData);
    const updateResult = await this._editFeatureUseCase.updateFeature(featureId, updatePayload);
    const revertedFeature = updateResult.feature;
    return { updatedFeature: revertedFeature };
  }

  _buildTimelineUpdatePayload(serializedTimeline) {
    const deserialized = (serializedTimeline || [])
      .map(entry => this._serializer.deserialize(entry))
      .filter(Boolean);

    if (deserialized.length === 0) {
      throw new Error('履歴タイムラインが空です。oldAnchors/newAnchors を設定してください。');
    }

    if (deserialized.every(entry => entry instanceof FeatureAnchor)) {
      return { anchors: deserialized };
    }

    throw new Error('履歴タイムラインの形式が不正です。FeatureAnchor のみ許可されています。');
  }
}
