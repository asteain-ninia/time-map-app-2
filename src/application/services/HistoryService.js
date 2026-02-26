// src/application/services/history/HistoryService.js
import { Vertex } from '../../domain/entities/Vertex.js';
import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
// HistoryStackManager, HistorySerializer, OperationEngine はDIで渡されるのでここではimport不要

// 【コマンド追加方法メモ】新しいコマンドクラスをここにインポートしてください。
import { UpdatePropertiesCommand } from './history/commands/UpdatePropertiesCommand.js';
import { MoveVerticesCommand } from './history/commands/MoveVerticesCommand.js';
import { AddFeatureCommand } from './history/commands/AddFeatureCommand.js';
import { DeleteFeatureCommand } from './history/commands/DeleteFeatureCommand.js';
import { DeleteVerticesCommand } from './history/commands/DeleteVerticesCommand.js';
import { AddRingCommand } from './history/commands/AddRingCommand.js';
import { AddVertexToEdgeCommand } from './history/commands/AddVertexToEdgeCommand.js';
import { ShareVerticesCommand } from './history/commands/ShareVerticesCommand.js';
import { UnlinkSharedVertexCommand } from './history/commands/UnlinkSharedVertexCommand.js';
import { SplitPolygonCommand } from './history/commands/SplitPolygonCommand.js';

export class HistoryService {
  _stackManager;
  _serializer;
  _operationEngine; // 最終的に削除される
  _eventBus;
  _worldRepository;
  _editFeatureUseCase; // Commandに渡すために保持

  /**
   * HistoryService (ファサード) を作成
   * @param {HistoryStackManager} stackManager
   * @param {HistorySerializer} serializer
   * @param {OperationEngine} operationEngine
   * @param {EventBus} eventBus
   * @param {WorldRepository} worldRepository
   * @param {EditFeatureUseCase} editFeatureUseCase - OperationEngineとCommandに渡すために必要
   */
  constructor(stackManager, serializer, operationEngine, eventBus, worldRepository, editFeatureUseCase) {
    this._stackManager = stackManager;
    this._serializer = serializer;
    this._operationEngine = operationEngine;
    this._eventBus = eventBus;
    this._worldRepository = worldRepository;
    this._editFeatureUseCase = editFeatureUseCase;
  }

  async undo() {
    if (!this.canUndo()) return;
    const command = this._stackManager.popUndo();
    if (!command) return;

    try {
      // 全ての操作はコマンドオブジェクトになっているはず
      const resultInfo = await command.reverse();
      this._stackManager.pushRedo(command);
      this._publishStandardEvents(resultInfo);
    } catch (error) {
      this._stackManager.pushUndo(command);
      console.error('Undo operation failed in HistoryService:', error, command);
      throw error;
    }
  }

  async redo() {
    if (!this.canRedo()) return;
    const command = this._stackManager.popRedo();
    if (!command) return;

    try {
      const resultInfo = await command.execute();
      this._stackManager.pushUndoFromRedo(command);
      this._publishStandardEvents(resultInfo);
    } catch (error) {
      this._stackManager.pushRedo(command);
      console.error('Redo operation failed in HistoryService:', error, command);
      throw error;
    }
  }

  /**
   * UseCase操作を実行し、成功した場合にのみアンドゥ履歴に記録する
   * @param {Function} operationFunc - 実行するUseCase操作をラップした非同期関数
   * @param {string} commandType - 生成するコマンドの種類
   * @param {Object} payload - コマンド生成に必要なデータ
   * @returns {Promise<any>} UseCase操作の実行結果
   */
  async executeAndRecord(operationFunc, commandType, payload) {
    let operationResult;
    try {
        // 1. UseCaseの操作を実行（ここで永続化まで行われる）
        operationResult = await operationFunc();
    } catch (error) {
        console.error(`Operation failed for command type ${commandType} during execution phase. Undo history will not be recorded.`, error);
        // ViewModelにエラーを再スローして、UIにフィードバックさせる
        throw error;
    }

    // 2. 操作が成功した場合のみ、コマンドを生成して履歴に登録
    let command;
    try {
      command = this._instantiateCommand(commandType, payload);
    } catch (commandError) {
      console.error(
        `Command instantiation failed for type ${commandType} after a successful operation. The operation was saved, but undo may not be possible.`,
        commandError
      );
      return operationResult;
    }

    if (!command) {
      console.error(`HistoryService.executeAndRecord: Unsupported command type: ${commandType}`);
      return operationResult;
    }

    if (command) {
        this._stackManager.pushUndo(command);
        this._notifyHistoryChanged();
    }

    // 3. イベント発行などの後処理は呼び出し元(ViewModel)で行うことが多いが、
    //    WorldUpdatedのような汎用的なイベントはここで発行しても良い。
    // this._publishStandardEvents(operationResult); // operationResult の形式に依存するため、ViewModel側で制御するほうが安全

    return operationResult;
  }

  async addHistoryEntry(operationType, payload) {
    console.warn("HistoryService.addHistoryEntry is deprecated. Use executeAndRecord instead.");

    if (!payload || typeof payload !== 'object') {
      console.error("HistoryService.addHistoryEntry: payload must be an object.", payload);
      return;
    }

    let command;
    try {
      command = this._instantiateCommand(operationType, payload);
    } catch (error) {
      console.error(`HistoryService.addHistoryEntry: Failed to create command for ${operationType}.`, error, payload);
      throw error;
    }

    if (!command) {
      console.warn(`HistoryService.addHistoryEntry: Unsupported operation type: ${operationType}`);
      return;
    }

    this._stackManager.pushUndo(command);
    this._notifyHistoryChanged();
  }

  /**
   * 履歴用のシリアライザを取得
   * @returns {HistorySerializer}
   */
  getSerializer() {
    return this._serializer;
  }

  /**
   * ワールドリポジトリを取得
   * @returns {WorldRepository}
   */
  getWorldRepository() {
    return this._worldRepository;
  }

  /**
   * 履歴ペイロード向けにオブジェクトをシリアライズ
   * @param {any} value
   * @returns {any}
   */
  serializeForHistory(value) {
    return this._serializer.serialize(value);
  }

  /**
   * 地物に紐づく頂点データを履歴用形式で取得
   * @param {Object} feature
   * @returns {Promise<Object[]>}
   */
  async getVerticesDataForFeatureForHistory(feature) {
    return this._getVerticesDataForFeatureForHistory(feature);
  }

  /**
   * コマンドをアンドゥ履歴へ記録
   * @param {Object} command
   */
  recordCommand(command) {
    this._stackManager.pushUndo(command);
    this._notifyHistoryChanged();
  }

  canUndo() {
    return this._stackManager.canUndo();
  }

  canRedo() {
    return this._stackManager.canRedo();
  }

  _publishStandardEvents(operationResultInfo = {}) {
    // OperationEngineからの詳細な結果に基づいてイベントを発行
    if (operationResultInfo.eventType && operationResultInfo.eventPayload) {
        this._eventBus.publish(operationResultInfo.eventType, operationResultInfo.eventPayload);
    }

    // 更新された地物（単体）に対するイベント
    if (operationResultInfo.updatedFeature) {
        this._eventBus.publish('FeatureUpdated', { feature: operationResultInfo.updatedFeature });
    }
    // 更新された地物（複数）に対するイベント
    if (Array.isArray(operationResultInfo.updatedFeatures)) {
        operationResultInfo.updatedFeatures.forEach(feature => {
            this._eventBus.publish('FeatureUpdated', { feature });
        });
    }
    // 追加された地物に対するイベント
    if (operationResultInfo.addedFeature) {
        this._eventBus.publish('FeatureAdded', { feature: operationResultInfo.addedFeature });
    }
    // 削除された地物に対するイベント
    if (operationResultInfo.deletedFeatureId) {
        this._eventBus.publish('FeatureDeleted', { featureId: operationResultInfo.deletedFeatureId });
    }

    // データソース全体が変更された可能性があることを通知する
    this._eventBus.publish('WorldUpdated');
    // 履歴状態の変更を通知する
    this._notifyHistoryChanged();
  }

  _notifyHistoryChanged() {
    this._eventBus.publish('HistoryChanged', {
        canUndo: this.canUndo(),
        canRedo: this.canRedo()
    });
  }

  async _getVerticesDataForHistory(vertexIds) {
    if (!vertexIds || vertexIds.length === 0) return [];
    try {
      const world = await this._worldRepository.getWorld();
      if (!world || !world.vertices) return [];
      const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
      const foundVerticesData = vertexIds
        .map(id => verticesMap.get(id))
        .filter(Boolean);
      return foundVerticesData
        .map(vData => this._serializer.serialize(new Vertex(vData.id, vData.x, vData.y)))
        .filter(Boolean);
    } catch (error) {
      console.error("HistoryService._getVerticesDataForHistory: Error fetching vertices:", error);
      return [];
    }
  }

  async _getVerticesDataForFeatureForHistory(feature) {
    if (!feature) return [];
    const vertexIds = new Set();
    if (feature instanceof DomainPolygon) {
        (feature.rings || []).forEach(ring => (ring.vertexIds || []).forEach(id => vertexIds.add(id)));
    } else if (feature instanceof DomainLine || feature instanceof DomainPoint) {
        (feature.vertexIds || []).forEach(id => vertexIds.add(id));
    }
    return await this._getVerticesDataForHistory(Array.from(vertexIds));
  }

  _instantiateCommand(commandType, payload) {
    switch (commandType) {
      case 'add':
        return new AddFeatureCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      case 'delete':
        return new DeleteFeatureCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      case 'deleteVertices':
        return new DeleteVerticesCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      case 'updateProperties':
        return new UpdatePropertiesCommand(payload, this._editFeatureUseCase, this._serializer);
      case 'moveVertices':
        return new MoveVerticesCommand(payload, this._editFeatureUseCase, this._serializer, this._worldRepository);
      case 'addRing':
        return new AddRingCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      case 'addVertexToEdge':
        return new AddVertexToEdgeCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      case 'shareVertices':
        return new ShareVerticesCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      case 'unlinkSharedVertex':
        return new UnlinkSharedVertexCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      case 'splitPolygon':
        return new SplitPolygonCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
      default:
        return null;
    }
  }
}
