// src/application/services/history/commands/MoveVerticesCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

/**
 * 複数頂点移動操作をカプセル化するコマンド
 */
export class MoveVerticesCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {Array<Object>} payload.updates - 頂点更新情報の配列 { vertexId, oldPosition, newPosition }
   *        oldPosition, newPosition はシリアライズされたプレーンオブジェクト
   * @param {EditFeatureUseCase} editFeatureUseCase - 地物編集ユースケース
   * @param {HistorySerializer} serializer - シリアライザ
   */
  constructor(payload, editFeatureUseCase, serializer) {
    this._payload = payload;
    this._editFeatureUseCase = editFeatureUseCase;
    this._serializer = serializer;
  }

  /**
   * 操作を実行（Redo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async execute() {
    const updatesForUseCase = this._payload.updates.map(u => {
        const newPosVertex = this._serializer.deserialize(u.newPosition);
        return newPosVertex ? { vertexId: u.vertexId, newPosition: { x: newPosVertex.x, y: newPosVertex.y } } : null;
    }).filter(Boolean);

    if (updatesForUseCase.length > 0) {
        const moveResult = await this._editFeatureUseCase.moveVertices(updatesForUseCase);
        // moveVerticesは { updatedVertices, affectedFeatures } を返す
        return { movedVerticesResult: moveResult, eventType: 'MultipleVerticesMoved', eventPayload: moveResult };
    }
    return {};
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    const updatesForUseCaseUndo = this._payload.updates.map(u => {
        const oldPosVertex = this._serializer.deserialize(u.oldPosition);
        return oldPosVertex ? { vertexId: u.vertexId, newPosition: { x: oldPosVertex.x, y: oldPosVertex.y } } : null;
    }).filter(Boolean);

    if (updatesForUseCaseUndo.length > 0) {
        const moveUndoResult = await this._editFeatureUseCase.moveVertices(updatesForUseCaseUndo);
        return { movedVerticesResult: moveUndoResult, eventType: 'MultipleVerticesMoved', eventPayload: moveUndoResult };
    }
    return {};
  }
}