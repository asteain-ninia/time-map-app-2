// src/application/services/history/HistoryService.js
import { Vertex } from '../../domain/entities/Vertex.js';
import { Point } from '../../domain/entities/Point.js';
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
        // このswitch文は、addHistoryEntryからほぼそのまま持ってくる
        switch (commandType) {
            case 'add':
                command = new AddFeatureCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
                break;
            case 'delete':
                command = new DeleteFeatureCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
                break;
            case 'deleteVertices':
                command = new DeleteVerticesCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
                break;
            case 'updateProperties':
                command = new UpdatePropertiesCommand(payload, this._editFeatureUseCase, this._serializer);
                break;
            case 'moveVertices':
                command = new MoveVerticesCommand(payload, this._editFeatureUseCase, this._serializer);
                break;
            case 'addRing':
                command = new AddRingCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
                break;
            case 'addVertexToEdge':
                command = new AddVertexToEdgeCommand(payload, this._editFeatureUseCase, this._worldRepository, this._serializer);
                break;
            default:
                console.error(`HistoryService.executeAndRecord: Unsupported command type: ${commandType}`);
                // 操作は実行されたが履歴は残らない。これは設計上の問題を示す可能性がある。
                return operationResult;
        }
    } catch (commandError) {
        console.error(`Command instantiation failed for type ${commandType} after a successful operation. The operation was saved, but undo may not be possible.`, commandError);
        // このケースは深刻なバグを示す。操作は完了しているがアンドゥできない。
        // ここで何らかのフォールバック（例：ユーザーへの警告）が必要かもしれない。
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
    // このメソッドは後方互換性のために残すが、内部で新しい executeAndRecord を呼び出すように変更する
    // これにより、ViewModel側の変更を段階的に行うことができる
    let operationFunc;
    let commandPayload;
    
    // 【コマンド追加方法メモ】ここに新しいcaseを追加し、対応するCommandをインスタンス化してください。
    // このコメントは削除しないでください。
    switch (operationType) {
      case 'add':
        operationFunc = () => this._editFeatureUseCase.addFeature(
            payload.featureType, // ViewModelから渡してもらう必要がある
            [payload.featureInstance.properties[0]], // プロパティインスタンス
            { vertices: payload.featureInstance.vertexIds.map(id => this._worldRepository._world.vertices.find(v => v.id === id)) }, // これは不正確だが、互換性のための仮実装
            payload.featureInstance.layerId
        );
        // addHistoryEntryの呼び出し側でUseCaseが実行済みのため、ここでは何もしない関数を渡すのが安全
        // しかし、それではトランザクションが実現できない。呼び出し側(ViewModel)の変更が必須となる。
        // ここでは、ViewModelがまだ古い形式で呼び出していることを前提とし、
        // 不完全ながらも動作する形を目指すのではなく、新しいフローへの移行を強制する。
        // よって、このメソッドは将来的に非推奨とし、今は新しい形式でラップする。
        console.error("addHistoryEntry is deprecated. Use executeAndRecord instead.");
        return; // 新しいフローに移行するまで何もしない、またはエラーを投げる
    }

    if (command) {
        this._stackManager.pushUndo(command);
        this._notifyHistoryChanged();
    }
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
    // 選択をクリアする
    this._eventBus.publish('ClearSelection');
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
}