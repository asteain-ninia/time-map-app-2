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

  async addHistoryEntry(operationType, payload) {
    let command;
    // 【コマンド追加方法メモ】ここに新しいcaseを追加し、対応するCommandをインスタンス化してください。
    // このコメントは削除しないでください。
    switch (operationType) {
      case 'add':
        const addPayload = {
            featureId: payload.featureInstance.id,
            featureData: this._serializer.serialize(payload.featureInstance),
            addedVerticesData: await this._getVerticesDataForFeatureForHistory(payload.featureInstance)
        };
        command = new AddFeatureCommand(addPayload, this._editFeatureUseCase, this._worldRepository, this._serializer);
        break;

      case 'delete':
        const deletePayload = {
            featureId: payload.featureInstance.id,
            featureData: this._serializer.serialize(payload.featureInstance),
            verticesToRestoreData: await this._getVerticesDataForFeatureForHistory(payload.featureInstance)
        };
        command = new DeleteFeatureCommand(deletePayload, this._editFeatureUseCase, this._worldRepository, this._serializer);
        break;

      case 'deleteVertices':
        const deleteVerticesPayload = {
            deletedVertexIds: payload.deletedVertexIds,
            verticesToRestoreData: payload.verticesToRestore.map(v => this._serializer.serialize(v)),
            affectedFeaturesBefore: payload.affectedFeaturesBefore.map(f => this._serializer.serialize(f))
        };
        command = new DeleteVerticesCommand(deleteVerticesPayload, this._editFeatureUseCase, this._worldRepository, this._serializer);
        break;

      case 'updateProperties':
        const updatePropsPayload = {
            featureId: payload.featureId,
            oldProperties: payload.oldProperties.map(p => this._serializer.serialize(p)),
            newProperties: payload.newProperties.map(p => this._serializer.serialize(p))
        };
        command = new UpdatePropertiesCommand(updatePropsPayload, this._editFeatureUseCase, this._serializer);
        break;

      case 'moveVertices':
        const moveVerticesPayload = {
            updates: payload.updates.map(u => ({
                vertexId: u.vertexId,
                oldPosition: this._serializer.serialize(u.oldPosition),
                newPosition: this._serializer.serialize(u.newPosition)
            }))
        };
        command = new MoveVerticesCommand(moveVerticesPayload, this._editFeatureUseCase, this._serializer);
        break;

      case 'addRing':
        const addRingPayload = {
            polygonId: payload.polygonId,
            addedRing: payload.addedRing,
            // UseCaseから受け取ったプレーンな頂点データをVertexインスタンスに変換し、シリアライズする
            addedVerticesData: payload.addedVerticesDataFromUseCase.map(vData => 
                this._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
            )
        };
        command = new AddRingCommand(addRingPayload, this._editFeatureUseCase, this._worldRepository, this._serializer);
        break;

      case 'addVertexToEdge':
        const addVertexPayload = {
            featureId: payload.featureId,
            ringId: payload.ringId,
            segmentStartVertexId: payload.segmentStartVertexId,
            segmentEndVertexId: payload.segmentEndVertexId,
            newVertexId: payload.newVertexId,
            addedVertexData: this._serializer.serialize(new Vertex(payload.newVertexId, payload.newVertexPosition.x, payload.newVertexPosition.y)),
            featureBeforeData: payload.featureBeforeData
        };
        command = new AddVertexToEdgeCommand(addVertexPayload, this._editFeatureUseCase, this._worldRepository, this._serializer);
        break;

      default:
        console.error(`HistoryService.addHistoryEntry: Unsupported operation type: ${operationType}`);
        return;
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
    } else if (feature instanceof DomainLine || feature instanceof Point) {
        (feature.vertexIds || []).forEach(id => vertexIds.add(id));
    }
    return await this._getVerticesDataForHistory(Array.from(vertexIds));
  }
}