// src/application/services/HistoryService.js
import { Vertex } from '../../domain/entities/Vertex.js';
import { Point } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
// HistoryStackManager, HistorySerializer, OperationEngine はDIで渡されるのでここではimport不要

export class HistoryService {
  _stackManager;
  _serializer;
  _operationEngine;
  _eventBus;
  _worldRepository;
  // _editFeatureUseCase は OperationEngine が持つので、HistoryService自身は直接は不要

  /**
   * HistoryService (ファサード) を作成
   * @param {HistoryStackManager} stackManager
   * @param {HistorySerializer} serializer
   * @param {OperationEngine} operationEngine
   * @param {EventBus} eventBus
   * @param {WorldRepository} worldRepository
   * @param {EditFeatureUseCase} editFeatureUseCase - OperationEngineに渡すために必要
   */
  constructor(stackManager, serializer, operationEngine, eventBus, worldRepository, editFeatureUseCase) {
    this._stackManager = stackManager;
    this._serializer = serializer;
    this._operationEngine = operationEngine;
    this._eventBus = eventBus;
    this._worldRepository = worldRepository;
    // this._editFeatureUseCase = editFeatureUseCase; // OperationEngineに渡す

    // OperationEngine に EditFeatureUseCase のインスタンスを渡す (コンストラクタで行うべきだったが、後からセットする形も可)
    // もしOperationEngineのコンストラクタで受け取るなら、ここは不要
    if (this._operationEngine && typeof this._operationEngine.setEditFeatureUseCase === 'function') {
        this._operationEngine.setEditFeatureUseCase(editFeatureUseCase);
    } else if (this._operationEngine && !this._operationEngine._editFeatureUseCase) {
        // OperationEngineがコンストラクタでDIを受ける場合、ここでのセットは不要
        // console.warn("HistoryService: OperationEngine does not have setEditFeatureUseCase or _editFeatureUseCase already set.");
    }
  }

  async undo() {
    if (!this.canUndo()) return;
    const operation = this._stackManager.popUndo();
    if (!operation) return;

    try {
      const resultInfo = await this._operationEngine.executeReverse(operation);
      this._stackManager.pushRedo(operation);
      this._publishStandardEvents(resultInfo); // 結果情報を渡す
    } catch (error) {
      this._stackManager.pushUndo(operation);
      console.error('Undo operation failed in HistoryService:', error, operation);
      throw error;
    }
  }

  async redo() {
    if (!this.canRedo()) return;
    const operation = this._stackManager.popRedo();
    if (!operation) return;

    try {
      const resultInfo = await this._operationEngine.execute(operation);
      this._stackManager.pushUndoFromRedo(operation);
      this._publishStandardEvents(resultInfo); // 結果情報を渡す
    } catch (error) {
      this._stackManager.pushRedo(operation);
      console.error('Redo operation failed in HistoryService:', error, operation);
      throw error;
    }
  }

  async addHistoryEntry(operationType, payload) {
    let historyEntryData = {};

    try {
        switch (operationType) {
        case 'add':
            const featureInstanceAdd = payload.featureInstance; // Domain Instance
            const featureTypeAdd = payload.featureType;         // string
            let vertexIdsForHistoryAdd = [];
            if (featureInstanceAdd) {
                if (featureTypeAdd === 'point' && featureInstanceAdd.vertexIds && featureInstanceAdd.vertexIds.length > 0) {
                    vertexIdsForHistoryAdd = featureInstanceAdd.vertexIds;
                } else if (featureTypeAdd === 'line' && featureInstanceAdd.vertexIds && featureInstanceAdd.vertexIds.length > 0 && (!featureInstanceAdd.rings || featureInstanceAdd.rings.length === 0)) { // Line の場合
                    vertexIdsForHistoryAdd = featureInstanceAdd.vertexIds;
                } else if (featureInstanceAdd.rings && featureInstanceAdd.rings.length > 0) { // Polygon やリングを持つ可能性のあるLine
                    vertexIdsForHistoryAdd = featureInstanceAdd.rings.flatMap(r => r.vertexIds || []);
                }
                 if (vertexIdsForHistoryAdd.length === 0 && featureInstanceAdd.vertexIds && featureInstanceAdd.vertexIds.length > 0) {
                    vertexIdsForHistoryAdd = featureInstanceAdd.vertexIds; // フォールバック
                }
            }
            const addedVerticesDataPlain = await this._getVerticesDataForHistory(vertexIdsForHistoryAdd);
            historyEntryData = {
                featureId: featureInstanceAdd.id,
                featureType: featureTypeAdd,
                featureData: this._serializer.serialize(featureInstanceAdd),
                addedVerticesData: addedVerticesDataPlain
            };
            break;
        case 'delete':
            const deletedFeatureInstance = payload.featureInstance; // Domain Instance
            const verticesToRestoreDataPlainDelete = await this._getVerticesDataForFeatureForHistory(deletedFeatureInstance);
            historyEntryData = {
                featureId: deletedFeatureInstance.id,
                featureData: this._serializer.serialize(deletedFeatureInstance),
                verticesToRestoreData: verticesToRestoreDataPlainDelete
            };
            break;
        case 'deleteVertices':
            // payload: { deletedVertexIds: string[], verticesToRestore: Vertex[], affectedFeaturesBefore: Feature[], deletedFeatureIdsInOperation: string[] }
            // verticesToRestore と affectedFeaturesBefore はドメインインスタンスの配列
            const verticesToRestorePlainDV = payload.verticesToRestore.map(v => this._serializer.serialize(v));
            const affectedFeaturesBeforePlainDV = payload.affectedFeaturesBefore.map(f => this._serializer.serialize(f));
            historyEntryData = {
                deletedVertexIds: payload.deletedVertexIds, // string[]
                verticesToRestoreData: verticesToRestorePlainDV, // PlainObject[]
                affectedFeaturesBefore: affectedFeaturesBeforePlainDV, // PlainObject[]
                deletedFeatureIds: payload.deletedFeatureIdsInOperation // string[] (UseCaseの結果から)
            };
            break;
        case 'moveVertices':
            // payload: { updates: [{ vertexId: string, oldPosition: Vertex, newPosition: Vertex }] }
            // oldPosition, newPosition はドメインインスタンス
            const serializedUpdatesMove = payload.updates.map(u => ({
                vertexId: u.vertexId,
                oldPosition: this._serializer.serialize(u.oldPosition),
                newPosition: this._serializer.serialize(u.newPosition)
            }));
            historyEntryData = { updates: serializedUpdatesMove };
            break;
        case 'updateProperties':
            // payload: { featureId: string, oldProperties: Property[], newProperties: Property[] }
            // oldProperties, newProperties はドメインインスタンスの配列
            historyEntryData = {
                featureId: payload.featureId,
                oldProperties: payload.oldProperties.map(p => this._serializer.serialize(p)),
                newProperties: payload.newProperties.map(p => this._serializer.serialize(p))
            };
            break;
        case 'addRing':
            // payload: { polygonId: string, addedRing: PlainRingObject, addedVerticesDataFromUseCase: PlainVertexObject[] }
            // addedRing は PolygonEditService が返すプレーンオブジェクト
            // addedVerticesDataFromUseCase は UpdateFeatureUseCase (newRingCoordinates) 内で _processGeometry を通して生成された頂点のデータ (プレーン)
            historyEntryData = {
                polygonId: payload.polygonId,
                addedRing: payload.addedRing, // 既にプレーンオブジェクト
                addedVerticesData: payload.addedVerticesDataFromUseCase // 既にプレーンオブジェクト
            };
            break;
        default:
            console.warn(`HistoryService.addHistoryEntry: Unsupported operation type: ${operationType}`);
            return;
        }

        const completeHistoryEntry = {
            type: operationType,
            ...historyEntryData
        };
        this._stackManager.pushUndo(completeHistoryEntry);
        this._notifyHistoryChanged();
    } catch (error) {
        console.error(`HistoryService.addHistoryEntry: Failed to add history for ${operationType}:`, error, payload);
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
    } else {
        // フォールバックまたは追加の標準イベント
        if (operationResultInfo.addedFeature) {
            this._eventBus.publish('FeatureAdded', { feature: operationResultInfo.addedFeature });
        }
        if (operationResultInfo.updatedFeature) {
            this._eventBus.publish('FeatureUpdated', { feature: operationResultInfo.updatedFeature });
        }
        if (operationResultInfo.deletedFeatureId) {
            this._eventBus.publish('FeatureDeleted', { featureId: operationResultInfo.deletedFeatureId });
        }
        // 必要なら 'VerticesDeletedCustom' や 'MultipleVerticesMoved' をここで汎用的なイベントに変換
    }

    this._eventBus.publish('WorldUpdated');
    this._eventBus.publish('ClearSelection');
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