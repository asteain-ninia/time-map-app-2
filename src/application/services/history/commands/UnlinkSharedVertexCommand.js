// src/application/services/history/commands/UnlinkSharedVertexCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

/**
 * 共有頂点解除操作をカプセル化するコマンド
 */
export class UnlinkSharedVertexCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.vertexId - 共有元の頂点ID
   * @param {string} payload.featureId - 解除対象の地物ID
   * @param {string} payload.newVertexId - 解除後に作成された頂点ID
   * @param {Object} payload.newVertexData - 作成された頂点のデータ（プレーンオブジェクト）
   * @param {Object} payload.featureBeforeData - 解除前の地物データ（プレーンオブジェクト）
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
    const { vertexId, featureId, newVertexId } = this._payload;
    const result = await this._editFeatureUseCase.unlinkSharedVertex(vertexId, featureId, newVertexId);
    return { updatedFeature: result?.updatedFeature };
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    let world = await this._worldRepository.getWorld();
    const { newVertexId, featureBeforeData } = this._payload;

    if (newVertexId) {
      const beforeCount = world.vertices.length;
      world.vertices = world.vertices.filter(v => v.id !== newVertexId);
      if (world.vertices.length !== beforeCount) {
        await this._worldRepository.saveWorld(world);
        world = await this._worldRepository.getWorld();
      }
    }

    if (featureBeforeData) {
      const featureInstanceToRestore = this._serializer.deserialize(featureBeforeData);
      if (featureInstanceToRestore) {
        const indexInWorld = world.features.findIndex(f => f.id === featureInstanceToRestore.id);
        if (indexInWorld !== -1) {
          world.features[indexInWorld] = featureInstanceToRestore;
        } else {
          world.features.push(featureInstanceToRestore);
        }
        await this._worldRepository.saveWorld(world);
        return { updatedFeature: featureInstanceToRestore };
      }
    }

    return {};
  }
}
