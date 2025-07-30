// src/application/services/history/commands/UpdatePropertiesCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

/**
 * プロパティ更新操作をカプセル化するコマンド
 */
export class UpdatePropertiesCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.featureId - 対象の地物ID
   * @param {Object[]} payload.oldProperties - 更新前のプロパティ（プレーンオブジェクト）
   * @param {Object[]} payload.newProperties - 更新後のプロパティ（プレーンオブジェクト）
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
    const { featureId, newProperties } = this._payload;
    const newPropsInstances = newProperties.map(pPlain => this._serializer.deserialize(pPlain)).filter(Boolean);
    const updateResult = await this._editFeatureUseCase.updateFeature(featureId, { properties: newPropsInstances });
    const updatedFeature = updateResult.feature;
    return { updatedFeature };
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    const { featureId, oldProperties } = this._payload;
    const oldPropsInstances = oldProperties.map(pPlain => this._serializer.deserialize(pPlain)).filter(Boolean);
    const updateResult = await this._editFeatureUseCase.updateFeature(featureId, { properties: oldPropsInstances });
    const revertedFeature = updateResult.feature;
    return { updatedFeature: revertedFeature };
  }
}