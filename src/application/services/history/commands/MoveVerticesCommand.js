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
   * @param {WorldRepository} worldRepository - ワールドリポジトリ（追加）
   */
  constructor(payload, editFeatureUseCase, serializer, worldRepository) {
    this._payload = payload;
    this._editFeatureUseCase = editFeatureUseCase;
    this._serializer = serializer;
    this._worldRepository = worldRepository; // 保持するが一貫性のため。直接は使わない。
  }

  _hasFeaturePatchPayload() {
    return Array.isArray(this._payload?.featureChanges) && this._payload.featureChanges.length > 0;
  }

  async _applyFeaturePatch(direction) {
    if (!this._worldRepository || typeof this._worldRepository.getWorld !== 'function') {
      throw new Error('MoveVerticesCommand requires worldRepository for feature patch payloads.');
    }

    const world = await this._worldRepository.getWorld();
    const isExecute = direction === 'execute';
    const featureDataKey = isExecute ? 'afterFeatureData' : 'beforeFeatureData';
    const featureChanges = Array.isArray(this._payload.featureChanges) ? this._payload.featureChanges : [];

    for (const change of featureChanges) {
      const serializedFeature = change?.[featureDataKey];
      if (!serializedFeature) {
        continue;
      }
      const deserializedFeature = this._serializer.deserialize(serializedFeature);
      if (!deserializedFeature) {
        continue;
      }
      const index = world.features.findIndex(feature => feature.id === change.featureId);
      if (index >= 0) {
        world.features[index] = deserializedFeature;
      } else {
        world.features.push(deserializedFeature);
      }
    }

    const serializedAddedVertices = Array.isArray(this._payload.addedVertices)
      ? this._payload.addedVertices
      : [];
    const addedVertices = serializedAddedVertices
      .map(data => this._serializer.deserialize(data))
      .filter(vertex => vertex && typeof vertex.id === 'string');

    if (isExecute) {
      const verticesById = new Map(world.vertices.map(vertex => [vertex.id, vertex]));
      for (const vertex of addedVertices) {
        verticesById.set(vertex.id, { id: vertex.id, x: vertex.x, y: vertex.y });
      }
      world.vertices = [...verticesById.values()];
    } else if (addedVertices.length > 0) {
      const removeIds = new Set(addedVertices.map(vertex => vertex.id));
      world.vertices = world.vertices.filter(vertex => !removeIds.has(vertex.id));
    }

    await this._worldRepository.saveWorld(world);
    return { eventType: 'WorldUpdated', eventPayload: null };
  }

  /**
   * 操作を実行（Redo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async execute() {
    if (this._hasFeaturePatchPayload()) {
      return this._applyFeaturePatch('execute');
    }

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
    if (this._hasFeaturePatchPayload()) {
      return this._applyFeaturePatch('reverse');
    }

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
