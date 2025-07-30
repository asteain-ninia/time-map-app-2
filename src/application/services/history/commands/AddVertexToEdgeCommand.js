// src/application/services/history/commands/AddVertexToEdgeCommand.js
// 【コマンド追加方法メモ】このファイルを参考に、他のコマンドクラスを作成してください。
// ・ICommandインターフェースを実装する（execute, reverseメソッドを持つ）。
// ・コンストラクタで、操作に必要なデータ（payload）と、実行に必要なサービス（UseCaseなど）を受け取る。
// ・executeとreverseメソッドは、対応するUseCaseのメソッドを呼び出すロジックを実装する。
// ・このコメントは削除しないでください。

import { Vertex } from '../../../../domain/entities/Vertex.js';

/**
 * エッジへの頂点追加操作をカプセル化するコマンド
 */
export class AddVertexToEdgeCommand {
  /**
   * @param {Object} payload - 操作に必要なデータ
   * @param {string} payload.featureId
   * @param {string|null} payload.ringId
   * @param {string} payload.segmentStartVertexId
   * @param {string} payload.segmentEndVertexId
   * @param {string} payload.newVertexId
   * @param {Object} payload.addedVertexData - プレーンオブジェクト
   * @param {Object} payload.featureBeforeData - プレーンオブジェクト
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
    const { featureId, segmentStartVertexId, segmentEndVertexId, addedVertexData, ringId, newVertexId } = this._payload;
    const newVertex = this._serializer.deserialize(addedVertexData);
    if (!newVertex) {
      throw new Error("Failed to deserialize new vertex data for redo.");
    }

    // UseCaseを呼び出す。永続化はUseCaseが担当する。
    const result = await this._editFeatureUseCase.addVertexToFeatureEdge(
      featureId,
      segmentStartVertexId,
      segmentEndVertexId,
      { x: newVertex.x, y: newVertex.y }, // ワールド座標
      ringId,
      newVertexId // ★ 再利用する頂点ID
    );

    // UseCaseが永続化を行うため、ここでのsaveWorld呼び出しは不要であり、エラーの原因だったため削除。

    // イベント発行のための情報を返す
    return { 
      updatedFeature: result.updatedFeature, 
      eventType: 'VertexAddedToEdge',
      eventPayload: { 
        featureId: result.updatedFeature.id, 
        addedVertex: result.newVertex,
        updatedFeature: result.updatedFeature
      }
    };
  }

  /**
   * 操作を元に戻す（Undo）
   * @returns {Promise<Object>} イベント発行のための情報
   */
  async reverse() {
    const { featureId, newVertexId, featureBeforeData } = this._payload;
    let world = await this._worldRepository.getWorld();

    // 1. 頂点をワールドから削除
    world.vertices = world.vertices.filter(v => v.id !== newVertexId);

    // 2. 地物の状態を操作前に戻す
    const featureToRestore = this._serializer.deserialize(featureBeforeData);
    if (!featureToRestore) {
      throw new Error("Failed to deserialize featureBeforeData for undo.");
    }

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex !== -1) {
      world.features[featureIndex] = featureToRestore;
    } else {
      // 地物が存在しない場合（Redoで追加された直後など）は追加する
      world.features.push(featureToRestore);
    }

    // 変更を永続化
    await this._worldRepository.saveWorld(world);

    return {
      updatedFeature: featureToRestore,
      eventType: 'VertexRemovedFromEdge',
      eventPayload: {
        featureId: featureId,
        removedVertexId: newVertexId,
        updatedFeature: featureToRestore
      }
    };
  }
}