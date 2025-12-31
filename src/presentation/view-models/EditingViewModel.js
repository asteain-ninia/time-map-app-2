// src/presentation/view-models/EditingViewModel.js
import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { Property } from '../../domain/value-objects/Property.js';
import { Vertex } from '../../domain/entities/Vertex.js';
// HistoryService はDIで渡されるのでimport不要
import { AddFeatureCommand } from '../../application/services/history/commands/AddFeatureCommand.js';
import { AddRingCommand } from '../../application/services/history/commands/AddRingCommand.js';
import { AddVertexToEdgeCommand } from '../../application/services/history/commands/AddVertexToEdgeCommand.js';
import { DeleteFeatureCommand } from '../../application/services/history/commands/DeleteFeatureCommand.js';
import { DeleteVerticesCommand } from '../../application/services/history/commands/DeleteVerticesCommand.js';
import { MoveVerticesCommand } from '../../application/services/history/commands/MoveVerticesCommand.js';
import { UpdatePropertiesCommand } from '../../application/services/history/commands/UpdatePropertiesCommand.js';
import { ShareVerticesCommand } from '../../application/services/history/commands/ShareVerticesCommand.js';
import { UnlinkSharedVertexCommand } from '../../application/services/history/commands/UnlinkSharedVertexCommand.js';


/**
 * 編集関連の状態管理
 */
export class EditingViewModel {
  /**
   * 編集ビューモデルを作成
   * @param {EditFeatureUseCase} editFeatureUseCase - 地理オブジェクト編集ユースケース
   * @param {EventBus} eventBus - イベントバス
   * @param {HistoryService} historyService - アンドゥ・リドゥサービス (ファサード)
   */
  constructor(editFeatureUseCase, eventBus, historyService) { // historyService を追加
    this._editFeatureUseCase = editFeatureUseCase;
    this._eventBus = eventBus;
    this._historyService = historyService; // 保持

    // 編集の状態 
    this._mode = 'view';
    this._tool = null;
    this._addingPoints = [];
    this._targetPolygon = null;
    this._targetRingIdForHole = null;
    this._addingSubMode = null;
    this._temporaryElements = [];
    this._draggingVerticesInfo = new Map();
    this._pendingVertexAdditionInfo = null; // 線上点追加からドラッグ操作への連携用

    // アンドゥ・リドゥ関連のプロパティは削除: _undoStack, _redoStack, _maxHistorySize

    this._observers = [];

    // HistoryChanged イベントを購読してUIに通知
    this._eventBus.subscribe('HistoryChanged', this._onHistoryChanged.bind(this));
  }

  /**
   * 編集モードを設定
   */
  setMode(mode) {
    if (this._mode !== mode) {
      if (this._addingPoints.length > 0 || this._addingSubMode) {
        this._clearAddingState();
      }
      if (this._draggingVerticesInfo.size > 0) {
         this._resetDraggingState();
      }
      if (this._pendingVertexAdditionInfo) {
          this._pendingVertexAdditionInfo = null;
      }
      if (mode !== 'edit') {
        this.clearTemporaryElements();
      }
      this._mode = mode;
      this._tool = null;
      this._notifyObservers('mode');
    }
  }

  /**
   * 編集ツールを設定
   */
  setTool(tool) {
    if (this._tool !== tool) {
      if (this._addingPoints.length > 0 || this._addingSubMode) {
        this._clearAddingState();
      }
      if (this._draggingVerticesInfo.size > 0) {
         this._resetDraggingState();
      }
      if (this._pendingVertexAdditionInfo) {
          this._pendingVertexAdditionInfo = null;
      }
       this.clearTemporaryElements();
      this._tool = tool;
      this._notifyObservers('tool');
    }
  }

  /**
   * 編集モードを取得
   * @returns {string} 編集モード
   */
  getMode() {
    return this._mode;
  }

  /**
   * 編集ツールを取得
   * @returns {string} 編集ツール
   */
  getTool() {
    return this._tool;
  }

  /**
   * 穴/飛び地追加モードを開始 (MapViewから呼び出される)
   * @param {DomainPolygon} polygonInstance - 穴/飛び地を追加するポリゴンのインスタンス
   * @private internal use by MapView
   */
  startAddingHoleOrEnclave(polygonInstance) {
      if (this._tool === 'add-hole') {
          this._targetPolygon = polygonInstance;
          this._addingSubMode = null;
          this._targetRingIdForHole = null;
          this._clearAddingPoints();
          this._notifyObservers('targetPolygon');
          this._notifyObservers('addingSubMode');
          this._notifyObservers('targetRingIdForHole');
      } else { console.warn("startAddingHoleOrEnclave called when tool is not 'add-hole'."); }
  }

  /**
   * 穴/飛び地追加の準備状態を外部からリセット
   */
  cancelHoleOrEnclavePreparation() {
      if (this._tool !== 'add-hole') { return; }
      this._clearAddingState();
  }

  /**
   * 穴/飛び地追加対象のポリゴンインスタンスを取得
   * @returns {DomainPolygon | null} 対象ポリゴンインスタンス
   */
  getTargetPolygon() {
      return this._targetPolygon;
  }

  /**
   * 穴/飛び地追加のサブモードを設定 (MapViewから呼び出される)
   * @param {'hole' | 'enclave' | null} subMode
   * @private internal use by MapView
   */
  setAddingSubMode(subMode) {
      if (this._addingSubMode !== subMode) {
          this._addingSubMode = subMode;
          this._notifyObservers('addingSubMode');
      }
  }

  /**
   * 穴/飛び地追加のサブモードを取得
   * @returns {'hole' | 'enclave' | null}
   */
  getAddingSubMode() {
      return this._addingSubMode;
  }

  /**
   * 穴追加対象のリングIDを設定 (MapViewから呼び出される)
   * @param {string | null} ringId - 穴を追加する外周リングのID
   * @private internal use by MapView
   */
  setTargetRingIdForHole(ringId) {
      if (this._targetRingIdForHole !== ringId) {
          this._targetRingIdForHole = ringId;
          this._notifyObservers('targetRingIdForHole');
      }
  }

  /**
   * 穴追加対象のリングIDを取得
   * @returns {string | null}
   */
  getTargetRingIdForHole() {
      return this._targetRingIdForHole;
  }


  /**
   * 点を追加（地物追加または穴/飛び地追加モード用）
   * @param {Object} point - 追加する点 { x, y }
   */
  addPoint(point) {
    const isAddingFeature = this._mode === 'add' && this._tool;
    const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole' && this._targetPolygon;

    if (isAddingFeature || isAddingHoleOrEnclave) {
        if (this._draggingVerticesInfo.size > 0) return;
        this._addingPoints.push(point);
        this._notifyObservers('addingPoints');
    } else {
        console.warn("Cannot add point in current mode/tool/target:", this._mode, this._tool, !!this._targetPolygon);
    }
  }

  /**
   * 最後の点を削除（地物追加または穴/飛び地追加モード用）
   */
  removeLastPoint() {
    const isAddingFeature = this._mode === 'add' && this._tool;
    const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole';

    if ((isAddingFeature || isAddingHoleOrEnclave) && this._addingPoints.length > 0) {
      this._addingPoints.pop();
      if (this._addingPoints.length === 0) {
          if (this._addingSubMode !== null) { this.setAddingSubMode(null); }
          if (this._targetRingIdForHole !== null) { this.setTargetRingIdForHole(null); }
      }
      this._notifyObservers('addingPoints');
    }
  }

  /**
   * 追加中の状態をクリア (点、ターゲット、サブモード、リングID)
   * @private
   */
  _clearAddingState() {
    let changed = false;
    if (this._addingPoints.length > 0) { this._addingPoints = []; changed = true; }
    if (this._targetPolygon !== null) { this._targetPolygon = null; changed = true; }
    if (this._addingSubMode !== null) { this._addingSubMode = null; changed = true; }
    if (this._targetRingIdForHole !== null) { this._targetRingIdForHole = null; changed = true; }
    if (this._pendingVertexAdditionInfo !== null) { this._pendingVertexAdditionInfo = null; changed = true; }
    if (changed) { this._notifyObservers('addingState'); }
    this.clearTemporaryElements(); // プレビューもクリア
  }


  /**
   * 追加中の点をクリア (内部用ヘルパー、基本は _clearAddingState を使う)
   * @private
   */
  _clearAddingPoints() {
    if (this._addingPoints.length > 0) {
        this._addingPoints = [];
        this._notifyObservers('addingPoints');
    }
  }

  /**
   * 追加中の点を取得
   * @returns {Array} 追加中の点の配列
   */
  getAddingPoints() {
    return this._addingPoints;
  }

  /**
   * 地物の追加を確定
   * @param {Property[]} properties - プロパティ (Property インスタンスの配列、要素数1を期待)
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Object>} 追加された地物インスタンス
   */
  async confirmAddFeature(properties, layerId) {
    if (this._mode !== 'add' || !this._tool || this._addingPoints.length === 0) {
      throw new Error('地物の追加状態ではありません');
    }
    if (!Array.isArray(properties) || properties.length !== 1 || !(properties[0] instanceof Property)) {
        throw new Error("Invalid properties format. Expected a single Property instance in an array for confirmAddFeature.");
    }

    const geometryData = { vertices: [...this._addingPoints] };
    const featureType = this._tool;
    
    try {
      const feature = await this._editFeatureUseCase.addFeature(featureType, properties, geometryData, layerId);

      const payload = {
          featureId: feature.id,
          featureData: this._historyService._serializer.serialize(feature),
          addedVerticesData: await this._historyService._getVerticesDataForFeatureForHistory(feature)
      };
      const command = new AddFeatureCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
      this._historyService._stackManager.pushUndo(command);
      this._historyService._notifyHistoryChanged();

      this._clearAddingState();
      this._eventBus.publish('FeatureAdded', { feature });
      return feature;

    } catch (error) {
      console.error('地物の追加に失敗しました', error);
      this._clearAddingState();
      throw error;
    }
  }

  /**
   * 穴の追加を確定
   * @returns {Promise<Object|null>} 更新されたポリゴン、または失敗時にnull
   */
  async confirmAddHole() {
    if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'hole' || !this._targetPolygon || !this._targetRingIdForHole || this._addingPoints.length < 3) {
        console.error('穴の追加確定の条件を満たしていません。');
        this._clearAddingState();
        return null;
    }

    const polygonId = this._targetPolygon.id;
    const holePoints = [...this._addingPoints];
    const targetRingId = this.getTargetRingIdForHole();
    const polygonBeforeUpdate = this._targetPolygon;

    try {
        const geometryUpdate = {
            newRingCoordinates: [{ points: holePoints, ringType: 'hole', parentId: targetRingId }]
        };
        const updateResult = await this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });
        const updatedPolygon = updateResult.feature;
        const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];
        const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

        const payload = {
            polygonId: polygonId,
            addedRing: addedRingPlain ? { ...addedRingPlain } : null,
            addedVerticesData: newlyAddedVerticesData.map(vData => 
                this._historyService._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
            )
        };
        const command = new AddRingCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
        this._historyService._stackManager.pushUndo(command);
        this._historyService._notifyHistoryChanged();

        this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
        this._clearAddingState();
        return updatedPolygon;
    } catch (error) {
        console.error('穴の追加確定に失敗しました', error);
        alert(`穴の追加に失敗しました: ${error.message}`);
        this._clearAddingState();
        return null;
    }
  }

  /**
   * 飛び地の追加を確定
   * @returns {Promise<Object|null>} 更新されたポリゴン、または失敗時にnull
   */
  async confirmAddEnclave() {
    if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'enclave' || !this._targetPolygon || this._addingPoints.length < 3) {
        console.error('飛び地の追加確定の条件を満たしていません。');
        this._clearAddingState();
        return null;
    }

    const polygonId = this._targetPolygon.id;
    const enclavePoints = [...this._addingPoints];
    const parentRingId = this.getTargetRingIdForHole();
    const polygonBeforeUpdate = this._targetPolygon;

    try {
        const geometryUpdate = {
            newRingCoordinates: [{ points: enclavePoints, ringType: 'territory', parentId: parentRingId }]
        };
        const updateResult = await this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });
        const updatedPolygon = updateResult.feature;
        const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];
        
        const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

        const payload = {
            polygonId: polygonId,
            addedRing: addedRingPlain ? { ...addedRingPlain } : null,
            addedVerticesData: newlyAddedVerticesData.map(vData => 
                this._historyService._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
            )
        };
        const command = new AddRingCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
        this._historyService._stackManager.pushUndo(command);
        this._historyService._notifyHistoryChanged();
        
        this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
        this._clearAddingState();
        return updatedPolygon;
    } catch (error) {
        console.error('飛び地の追加確定に失敗しました', error);
        alert(`飛び地の追加に失敗しました: ${error.message}`);
        this._clearAddingState();
        return null;
    }
  }


  /**
   * 複数の頂点のドラッグを開始
   * @param {Map<string, {x: number, y: number}>} vertices - ドラッグする頂点のIDと開始位置のMap
   */
  startVerticesDrag(vertices) {
      if (this._mode !== 'edit' || this._tool === 'add-hole') { return; }
      if (!vertices || vertices.size === 0) { return; }
      if (this._draggingVerticesInfo.size > 0) { return; }
      this._draggingVerticesInfo.clear();
      for (const [vertexId, position] of vertices.entries()) {
          this._draggingVerticesInfo.set(vertexId, { originalPosition: { ...position }, currentPosition: { ...position } });
      }
      this._notifyObservers('draggingVertices');
  }

  /**
   * 頂点ドラッグ中の位置更新
   * @param {number} deltaX - X方向の移動差分 (ワールド座標)
   * @param {number} deltaY - Y方向の移動差分 (ワールド座標)
   */
  updateVerticesDrag(deltaX, deltaY) {
      if (this._draggingVerticesInfo.size === 0) { return; }
      let positionChanged = false;
      for (const info of this._draggingVerticesInfo.values()) {
          const newX = info.originalPosition.x + deltaX;
          const newY = info.originalPosition.y + deltaY;
          if (info.currentPosition.x !== newX || info.currentPosition.y !== newY) {
              info.currentPosition = { x: newX, y: newY };
              positionChanged = true;
          }
      }
      if (positionChanged) { this._notifyObservers('draggingVertices'); }
  }

  /**
   * 頂点ドラッグの終了
   * @returns {Promise<void>}
   */
  async endVerticesDrag(options = {}) {
    if (this._draggingVerticesInfo.size === 0) { return; }

    const isChainedFromVertexAddition = 
        this._pendingVertexAdditionInfo &&
        this._draggingVerticesInfo.has(this._pendingVertexAdditionInfo.newVertexId);

    const dragInfoCopy = new Map(this._draggingVerticesInfo);
    this._resetDraggingState();

    if (isChainedFromVertexAddition) {
        const pendingInfo = { ...this._pendingVertexAdditionInfo };
        this._pendingVertexAdditionInfo = null;
        this.clearTemporaryElements();

        const newVertexInfo = dragInfoCopy.get(pendingInfo.newVertexId);
        if (!newVertexInfo) {
            console.error("Chained vertex drag end failed: Drag info not found for new vertex.");
            return;
        }
        
        const finalPosition = newVertexInfo.currentPosition;

        try {
            const result = await this._editFeatureUseCase.addVertexToFeatureEdge(
                pendingInfo.featureId,
                pendingInfo.segmentStartVertexId,
                pendingInfo.segmentEndVertexId,
                finalPosition,
                pendingInfo.ringId,
                pendingInfo.newVertexId
            );

            const payload = {
                featureId: pendingInfo.featureId,
                ringId: pendingInfo.ringId,
                segmentStartVertexId: pendingInfo.segmentStartVertexId,
                segmentEndVertexId: pendingInfo.segmentEndVertexId,
                newVertexId: pendingInfo.newVertexId,
                newVertexPosition: finalPosition,
                addedVertexData: this._historyService._serializer.serialize(new Vertex(pendingInfo.newVertexId, finalPosition.x, finalPosition.y)),
                featureBeforeData: pendingInfo.featureBeforeData 
            };
            const command = new AddVertexToEdgeCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
            this._historyService._stackManager.pushUndo(command);
            this._historyService._notifyHistoryChanged();

            this._eventBus.publish('FeatureUpdated', { feature: result.updatedFeature });
        } catch (error) {
            console.error('線上への頂点追加（ドラッグ完了時）に失敗しました', error);
            alert(`頂点追加に失敗しました: ${error.message}`);
            this._eventBus.publish('WorldUpdated');
        }
    } else {
        const vertexUpdatesForUseCase = [];
        const historyPayloadUpdates = [];
        let significantMovement = false;
        const clickToleranceSq = 1e-6; 

        for (const [vertexId, info] of dragInfoCopy.entries()) {
            const dx = info.currentPosition.x - info.originalPosition.x;
            const dy = info.currentPosition.y - info.originalPosition.y;
            if ((dx * dx + dy * dy) > clickToleranceSq) {
                significantMovement = true;
            }
            vertexUpdatesForUseCase.push({ vertexId, newPosition: info.currentPosition });
            historyPayloadUpdates.push({
                vertexId,
                oldPosition: this._historyService._serializer.serialize(new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y)),
                newPosition: this._historyService._serializer.serialize(new Vertex(vertexId, info.currentPosition.x, info.currentPosition.y))
            });
        }

        if (significantMovement) {
            try {
                const moveResult = await this._editFeatureUseCase.moveVertices(vertexUpdatesForUseCase);
                
                const payload = { updates: historyPayloadUpdates };
                const command = new MoveVerticesCommand(payload, this._editFeatureUseCase, this._historyService._serializer, this._historyService._worldRepository);
                this._historyService._stackManager.pushUndo(command);
                this._historyService._notifyHistoryChanged();

                const shareResult = await this._applyVertexSharingAfterDrag(dragInfoCopy, options);
                if (shareResult.shared) {
                    this._eventBus.publish('WorldUpdated');
                } else if (moveResult && moveResult.updatedVertices) {
                    moveResult.updatedVertices.forEach(v => this._eventBus.publish('VertexMoved', { vertexId: v.id, newPosition: {x: v.x, y: v.y} }));
                }
            } catch (error) {
                console.error('複数頂点の移動確定に失敗しました', error);
                alert(`頂点の移動に失敗しました: ${error.message}`);
                this._eventBus.publish('WorldUpdated');
            }
        }
    }
  }

  /**
   * ドラッグ中の頂点情報を取得
   * @returns {Map<string, { originalPosition: {x, y}, currentPosition: {x, y} }>} ドラッグ情報Map
   */
  getDraggingVerticesInfo() {
      return this._draggingVerticesInfo;
  }

  /**
   * 保留中の線上点追加情報を取得
   * @returns {Object | null} 
   */
  getPendingVertexAdditionInfo() {
      return this._pendingVertexAdditionInfo;
  }

  /**
   * ドラッグ状態をリセット
   * @private
   */
  _resetDraggingState() {
      if (this._draggingVerticesInfo.size > 0) {
          this._draggingVerticesInfo.clear();
          this._notifyObservers('draggingVertices');
      }
  }

  /**
   * 地物を削除
   * @param {string} featureId - 削除する地物のID
   * @param {Object} feature - 削除前の地物データ（アンドゥ用、ドメインインスタンス）
   * @returns {Promise<void>}
   */
  async deleteFeature(featureId, feature) {
    if (!feature) { throw new Error("Missing feature data for deletion history."); }
    
    const payload = {
        featureId: featureId,
        featureData: this._historyService._serializer.serialize(feature),
        verticesToRestoreData: await this._historyService._getVerticesDataForFeatureForHistory(feature)
    };

    try {
        await this._editFeatureUseCase.deleteFeature(featureId);

        const command = new DeleteFeatureCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
        this._historyService._stackManager.pushUndo(command);
        this._historyService._notifyHistoryChanged();

        this._eventBus.publish('FeatureDeleted', { featureId });
        this._eventBus.publish('ClearSelection');
    } catch (error) {
        console.error('地物の削除に失敗しました', error);
        this._eventBus.publish('WorldUpdated');
        throw error;
    }
  }

  /**
   * 複数の頂点を削除
   * @param {string[]} vertexIds - 削除する頂点のID配列
   * @returns {Promise<void>}
   */
  async deleteVertices(vertexIds) {
    if (!vertexIds || vertexIds.length === 0) return;
    
    try {
        const worldRepository = this._editFeatureUseCase.getWorldRepository();
        const worldBefore = await worldRepository.getWorld();

        const verticesToRestore = vertexIds.map(id => {
            const vData = worldBefore.vertices.find(v => v.id === id);
            return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
        }).filter(Boolean);

        const affectedFeaturesBefore = [];
        const deletedVertexIdsSet = new Set(vertexIds);
        worldBefore.features.forEach(f => {
            const usesAnyDeletedVertex = 
                (f instanceof DomainPolygon && f.rings?.some(r => r.vertexIds.some(id => deletedVertexIdsSet.has(id)))) ||
                (!(f instanceof DomainPolygon) && f.vertexIds?.some(id => deletedVertexIdsSet.has(id)));
            if (usesAnyDeletedVertex) {
                affectedFeaturesBefore.push(f);
            }
        });
        
        const result = await this._editFeatureUseCase.deleteVertices(vertexIds);
        
        const payload = {
            deletedVertexIds: result.deletedVertexIds,
            verticesToRestoreData: verticesToRestore.map(v => this._historyService._serializer.serialize(v)),
            affectedFeaturesBefore: affectedFeaturesBefore.map(f => this._historyService._serializer.serialize(f))
        };
        
        const command = new DeleteVerticesCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
        this._historyService._stackManager.pushUndo(command);
        this._historyService._notifyHistoryChanged();

        if (result?.deletedFeatureIds?.length > 0) { result.deletedFeatureIds.forEach(id => this._eventBus.publish('FeatureDeleted', { featureId: id })); }
        if (result?.updatedFeatureIds?.length > 0) {
             const updatedWorld = await worldRepository.getWorld();
             result.updatedFeatureIds.forEach(id => {
                 const updatedFeature = updatedWorld.features.find(f => f.id === id);
                 if (updatedFeature) { this._eventBus.publish('FeatureUpdated', { feature: updatedFeature }); }
             });
        }
        this._eventBus.publish('VerticesDeleted', { deletedVertexIds: vertexIds });
        this._eventBus.publish('ClearSelection');
    } catch (error) {
        console.error('頂点の削除に失敗しました', error);
        this._eventBus.publish('WorldUpdated');
        throw error;
    }
  }

  async unlinkSharedVertex(vertexId, featureId) {
    if (!vertexId || !featureId) {
      throw new Error('共有解除に必要な情報が不足しています。');
    }

    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const worldBefore = await worldRepository.getWorld();
    const featureBefore = worldBefore.features.find(f => f.id === featureId);
    if (!featureBefore) {
      throw new Error(`地物が見つかりません: ${featureId}`);
    }

    const ownerIds = this._collectVertexOwnerIds(worldBefore.features, vertexId);
    if (!ownerIds.has(featureId)) {
      throw new Error('指定された地物は共有頂点の所有者ではありません。');
    }
    if (ownerIds.size <= 1) {
      throw new Error('共有頂点ではないため解除できません。');
    }

    const result = await this._editFeatureUseCase.unlinkSharedVertex(vertexId, featureId);
    const newVertex = result?.newVertex;
    if (!newVertex) {
      throw new Error('共有解除の結果が取得できませんでした。');
    }

    const payload = {
      vertexId,
      featureId,
      newVertexId: newVertex.id,
      newVertexData: this._historyService._serializer.serialize(new Vertex(newVertex.id, newVertex.x, newVertex.y)),
      featureBeforeData: this._historyService._serializer.serialize(featureBefore)
    };
    const command = new UnlinkSharedVertexCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

    this._eventBus.publish('WorldUpdated');
    return result;
  }

  /**
   * 地物プロパティを更新
   * @param {string} featureId - 更新する地物のID
   * @param {Property[]} newProperties - 新しいプロパティ配列 (Property インスタンスの配列)
   * @returns {Promise<Object>} 更新された地物インスタンス
   */
  async updateFeatureProperties(featureId, newProperties) {
    if (!Array.isArray(newProperties) || newProperties.length !== 1 || !(newProperties[0] instanceof Property)) {
        throw new Error("Invalid newProperties format.");
    }

    try {
        const worldRepository = this._editFeatureUseCase.getWorldRepository();
        const world = await worldRepository.getWorld();
        const featureBefore = world.features.find(f => f.id === featureId);
        if (!featureBefore) { throw new Error(`Feature not found: ${featureId}`); }
        
        const oldPropertiesInstances = (featureBefore.properties && featureBefore.properties.length > 0)
                                        ? [featureBefore.properties[0]]
                                        : [];

        const updateResult = await this._editFeatureUseCase.updateFeature(featureId, { properties: newProperties });
        const updatedFeature = updateResult.feature;

        const payload = {
            featureId: featureId,
            oldProperties: oldPropertiesInstances.map(p => this._historyService._serializer.serialize(p)),
            newProperties: updatedFeature.properties.map(p => this._historyService._serializer.serialize(p))
        };

        const command = new UpdatePropertiesCommand(payload, this._editFeatureUseCase, this._historyService._serializer, this._historyService._worldRepository);
        this._historyService._stackManager.pushUndo(command);
        this._historyService._notifyHistoryChanged();

        this._eventBus.publish('FeatureUpdated', { feature: updatedFeature });
        return updatedFeature;
    } catch (error) {
        console.error('地物プロパティの更新に失敗しました (EditingViewModel)', error);
        this._eventBus.publish('WorldUpdated');
        throw error;
    }
  }

  getSharePreviewVertexIds(options = {}) {
    if (!this._draggingVerticesInfo || this._draggingVerticesInfo.size === 0) {
      return new Set();
    }
    const world = options?.world;
    if (!world || !Array.isArray(world.vertices)) {
      return new Set();
    }

    const candidates = this._findShareCandidates(this._draggingVerticesInfo, world, { ...options, useDragPositions: true });
    if (candidates.length === 0) {
      return new Set();
    }

    const draggedIds = new Set(this._draggingVerticesInfo.keys());
    const previewIds = new Set();
    candidates.forEach(candidate => {
      if (draggedIds.has(candidate.vertexId1)) {
        previewIds.add(candidate.vertexId1);
      }
      if (draggedIds.has(candidate.vertexId2)) {
        previewIds.add(candidate.vertexId2);
      }
    });

    return previewIds;
  }

  _findShareCandidates(dragInfo, world, options) {
    if (!dragInfo || dragInfo.size === 0) {
      return [];
    }
    const snapWorldDistance = Number.isFinite(options?.snapWorldDistance) ? options.snapWorldDistance : null;
    if (!snapWorldDistance || snapWorldDistance <= 0) {
      return [];
    }
    if (!world || !Array.isArray(world.vertices)) {
      return [];
    }

    const featuresForSharing = this._resolveFeaturesForSharing(world, options);
    const ownerMap = this._buildVertexOwnerMap(featuresForSharing);
    const visibleVertexIds = new Set(ownerMap.keys());
    if (visibleVertexIds.size === 0) {
      return [];
    }

    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
    const draggedIds = new Set(dragInfo.keys());
    const snapDistanceSq = snapWorldDistance * snapWorldDistance;
    const worldWidth = Number.isFinite(options?.worldWidth) ? options.worldWidth : null;
    const candidates = [];
    const visitedPairs = new Set();
    const useDragPositions = options?.useDragPositions === true;

    const getCurrentPosition = (vertexId) => {
      if (useDragPositions) {
        const dragEntry = dragInfo.get(vertexId);
        if (dragEntry && dragEntry.currentPosition) {
          return dragEntry.currentPosition;
        }
      }
      return verticesMap.get(vertexId);
    };

    const getOriginalPosition = (vertexId) => {
      const dragEntry = dragInfo.get(vertexId);
      if (dragEntry && dragEntry.originalPosition) {
        return dragEntry.originalPosition;
      }
      return verticesMap.get(vertexId);
    };

    for (const draggedId of draggedIds) {
      if (!visibleVertexIds.has(draggedId)) {
        continue;
      }
      const draggedVertex = getCurrentPosition(draggedId);
      if (!draggedVertex) {
        continue;
      }

      for (const otherId of visibleVertexIds) {
        if (otherId === draggedId) continue;
        const pairKey = draggedId < otherId ? `${draggedId}|${otherId}` : `${otherId}|${draggedId}`;
        if (visitedPairs.has(pairKey)) continue;
        visitedPairs.add(pairKey);

        const ownersA = ownerMap.get(draggedId);
        const ownersB = ownerMap.get(otherId);
        if (ownersA && ownersB && this._hasOwnerIntersection(ownersA, ownersB)) {
          continue;
        }

        const otherVertex = getCurrentPosition(otherId);
        if (!otherVertex) continue;

        const distanceSq = this._calculateDistanceSqWithWrap(draggedVertex, otherVertex, worldWidth);
        if (distanceSq > snapDistanceSq) continue;

        const originalPosA = getOriginalPosition(draggedId);
        const originalPosB = getOriginalPosition(otherId);
        if (!originalPosA || !originalPosB) {
          continue;
        }
        const originalDistanceSq = this._calculateDistanceSqWithWrap(originalPosA, originalPosB, worldWidth);
        if (originalDistanceSq <= snapDistanceSq) continue;

        candidates.push({ vertexId1: draggedId, vertexId2: otherId, distanceSq });
      }
    }

    return candidates;
  }

  async _applyVertexSharingAfterDrag(dragInfo, options) {
    const snapWorldDistance = Number.isFinite(options?.snapWorldDistance) ? options.snapWorldDistance : null;
    if (!snapWorldDistance || snapWorldDistance <= 0) {
      return { shared: false };
    }

    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const world = await worldRepository.getWorld();
    if (!world || !Array.isArray(world.vertices)) {
      return { shared: false };
    }

    const candidates = this._findShareCandidates(dragInfo, world, { ...options, snapWorldDistance, useDragPositions: false });

    if (candidates.length === 0) {
      return { shared: false };
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const mergedIds = new Set();
    let shared = false;

    for (const candidate of candidates) {
      if (mergedIds.has(candidate.vertexId1) || mergedIds.has(candidate.vertexId2)) {
        continue;
      }
      try {
        const isFirstDragged = dragInfo.has(candidate.vertexId1);
        const isSecondDragged = dragInfo.has(candidate.vertexId2);
        const preferredKeptVertexId = isFirstDragged !== isSecondDragged
          ? (isFirstDragged ? candidate.vertexId2 : candidate.vertexId1)
          : null;
        const shareResult = await this._shareVerticesWithHistory(candidate.vertexId1, candidate.vertexId2, { preferredKeptVertexId });
        if (shareResult?.removedVertexId) {
          shared = true;
          mergedIds.add(candidate.vertexId1);
          mergedIds.add(candidate.vertexId2);
          mergedIds.add(shareResult.removedVertexId);
        }
      } catch (error) {
        console.warn('頂点共有化に失敗しました', error);
      }
    }

    return { shared };
  }

  async _shareVerticesWithHistory(vertexId1, vertexId2, options = {}) {
    if (!vertexId1 || !vertexId2 || vertexId1 === vertexId2) {
      return null;
    }

    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const worldBefore = await worldRepository.getWorld();
    const affectedBefore = this._collectAffectedFeaturesForVertices(worldBefore.features, new Set([vertexId1, vertexId2]));

    const shareResult = await this._editFeatureUseCase.shareVertices(vertexId1, vertexId2, options);
    if (!shareResult || !shareResult.removedVertex) {
      return null;
    }

    const removedVertex = shareResult.removedVertex;
    const payload = {
      vertexId1,
      vertexId2,
      keptVertexId: shareResult.keptVertex ? shareResult.keptVertex.id : null,
      removedVertexData: this._historyService._serializer.serialize(new Vertex(removedVertex.id, removedVertex.x, removedVertex.y)),
      affectedFeaturesBefore: affectedBefore.map(feature => this._historyService._serializer.serialize(feature))
    };
    const command = new ShareVerticesCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

    return { removedVertexId: removedVertex.id };
  }

  _resolveFeaturesForSharing(world, options) {
    if (!world || !Array.isArray(world.features)) {
      return [];
    }
    const visibleFeatures = Array.isArray(options?.visibleFeatures) ? options.visibleFeatures : null;
    if (!visibleFeatures) {
      return world.features;
    }
    const visibleIds = new Set(visibleFeatures.map(feature => feature.id));
    return world.features.filter(feature => visibleIds.has(feature.id));
  }

  _buildVertexOwnerMap(features) {
    const ownerMap = new Map();
    if (!features) {
      return ownerMap;
    }

    features.forEach(feature => {
      const vertexIds = this._collectFeatureVertexIds(feature);
      vertexIds.forEach(vertexId => {
        if (!ownerMap.has(vertexId)) {
          ownerMap.set(vertexId, new Set());
        }
        ownerMap.get(vertexId).add(feature.id);
      });
    });

    return ownerMap;
  }

  _collectAffectedFeaturesForVertices(features, vertexIdSet) {
    if (!features || !vertexIdSet || vertexIdSet.size === 0) {
      return [];
    }
    const affected = [];
    features.forEach(feature => {
      const vertexIds = this._collectFeatureVertexIds(feature);
      for (const id of vertexIds) {
        if (vertexIdSet.has(id)) {
          affected.push(feature);
          break;
        }
      }
    });
    return affected;
  }

  _collectVertexOwnerIds(features, vertexId) {
    const owners = new Set();
    if (!features || !vertexId) {
      return owners;
    }
    features.forEach(feature => {
      const vertexIds = this._collectFeatureVertexIds(feature);
      if (vertexIds.has(vertexId)) {
        owners.add(feature.id);
      }
    });
    return owners;
  }

  _collectFeatureVertexIds(feature) {
    const ids = new Set();
    if (!feature) {
      return ids;
    }
    if (feature instanceof DomainPolygon && Array.isArray(feature.rings)) {
      feature.rings.forEach(ring => {
        if (Array.isArray(ring.vertexIds)) ring.vertexIds.forEach(id => ids.add(id));
      });
    } else if (feature instanceof DomainLine && Array.isArray(feature.vertexIds)) {
      feature.vertexIds.forEach(id => ids.add(id));
    } else if (feature instanceof DomainPoint && Array.isArray(feature.vertexIds)) {
      feature.vertexIds.forEach(id => ids.add(id));
    }
    return ids;
  }

  _hasOwnerIntersection(ownersA, ownersB) {
    for (const ownerId of ownersA) {
      if (ownersB.has(ownerId)) {
        return true;
      }
    }
    return false;
  }

  _calculateDistanceSqWithWrap(pointA, pointB, worldWidth) {
    if (!pointA || !pointB) {
      return Infinity;
    }
    const dy = pointA.y - pointB.y;
    const dx = Math.abs(pointA.x - pointB.x);
    let dxMin = dx;
    if (Number.isFinite(worldWidth) && worldWidth > 0) {
      const dxPlus = Math.abs(pointA.x - (pointB.x + worldWidth));
      const dxMinus = Math.abs(pointA.x - (pointB.x - worldWidth));
      dxMin = Math.min(dx, dxPlus, dxMinus);
    }
    return (dxMin * dxMin) + (dy * dy);
  }

  /**
   * 指定されたエッジに頂点を追加する（プレビュー用）
   * @param {object} edgeInfo - エッジ情報 { featureId, ringId?, segmentStartVertexId, segmentEndVertexId, projectionPoint }
   * @returns {Promise<Vertex>} プレビュー用の新しい頂点インスタンス
   */
  async addVertexToEdge(edgeInfo) {
    if (!edgeInfo || !edgeInfo.featureId || !edgeInfo.segmentStartVertexId || !edgeInfo.segmentEndVertexId || !edgeInfo.projectionPoint) {
      throw new Error("頂点追加のためのエッジ情報が不完全です。");
    }

    // 既存の中間情報をクリア
    if (this._pendingVertexAdditionInfo) {
        this._clearAddingState();
    }

    try {
        const worldRepository = this._editFeatureUseCase.getWorldRepository();
        const worldBefore = await worldRepository.getWorld();
        const featureBeforeUpdate = worldBefore.features.find(f => f.id === edgeInfo.featureId);
        if (!featureBeforeUpdate) {
            throw new Error(`対象の地物が見つかりません: ${edgeInfo.featureId}`);
        }

        const newVertexId = this._editFeatureUseCase._idGenerationService.generateId('vertex');
        const newVertex = new Vertex(newVertexId, edgeInfo.projectionPoint.x, edgeInfo.projectionPoint.y);
        
        this._pendingVertexAdditionInfo = {
            featureId: edgeInfo.featureId,
            ringId: edgeInfo.ringId,
            segmentStartVertexId: edgeInfo.segmentStartVertexId,
            segmentEndVertexId: edgeInfo.segmentEndVertexId,
            newVertexId: newVertex.id,
            featureBeforeData: this._historyService._serializer.serialize(featureBeforeUpdate)
        };

        this.addTemporaryElement({
            type: 'point',
            x: newVertex.x,
            y: newVertex.y,
            style: { fill: '#ff00ff', radius: 8, stroke: '#ffffff', strokeWidth: 2 }
        });

        return newVertex;

    } catch (error) {
      console.error('エッジへの頂点追加プレビューの準備に失敗しました', error);
      this._clearAddingState();
      throw error;
    }
  }


  /**
   * 一時的な表示要素を追加
   * @param {Object} element - 表示要素
   */
  addTemporaryElement(element) {
    this._temporaryElements.push(element);
    this._notifyObservers('temporaryElements');
  }

  /**
   * 一時的な表示要素をクリア
   */
  clearTemporaryElements() {
    if (this._temporaryElements.length > 0) {
        this._temporaryElements = [];
        this._notifyObservers('temporaryElements');
    }
  }

  /**
   * 一時的な表示要素を取得
   * @returns {Array} 表示要素の配列
   */
  getTemporaryElements() {
    return this._temporaryElements;
  }

  /**
   * アンドゥ
   * @returns {Promise<void>}
   */
  async undo() {
    if (!this._historyService.canUndo()) return;
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();
    try {
      await this._historyService.undo();
    } catch (error) {
      console.error('アンドゥに失敗しました (ViewModel)', error);
      alert(`アンドゥに失敗しました: ${error.message}`);
    }
  }

  /**
   * リドゥ
   * @returns {Promise<void>}
   */
  async redo() {
    if (!this._historyService.canRedo()) return;
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();
    try {
      await this._historyService.redo();
    } catch (error) {
      console.error('リドゥに失敗しました (ViewModel)', error);
      alert(`リドゥに失敗しました: ${error.message}`);
    }
  }

  /**
   * アンドゥ可能かどうかを取得
   * @returns {boolean} アンドゥ可能ならtrue
   */
  canUndo() {
    return this._historyService ? this._historyService.canUndo() : false;
  }

  /**
   * リドゥ可能かどうかを取得
   * @returns {boolean} リドゥ可能ならtrue
   */
  canRedo() {
    return this._historyService ? this._historyService.canRedo() : false;
  }

  /**
   * HistoryService からのイベントを処理
   * @param {Object} data - { canUndo: boolean, canRedo: boolean }
   * @private
   */
  _onHistoryChanged(data) {
      this._notifyObservers('history', data); // 自身のObserverに通知
  }

  /**
   * 観測者を登録
   * @param {Function} observer - コールバック関数 (type, data) => void
   */
  addObserver(observer) { if (!this._observers.includes(observer)) { this._observers.push(observer); } }

  /**
   * 観測者を削除
   * @param {Function} observer - 削除する観測者
   */
  removeObserver(observer) { const index = this._observers.indexOf(observer); if (index !== -1) { this._observers.splice(index, 1); } }

  /**
   * 観測者に通知
   * @param {string} type - 変更タイプ
   * @param {any} [dataOverride] - 通知するデータを上書きする場合に指定
   * @private
   */
  _notifyObservers(type, dataOverride) {
    const data = dataOverride !== undefined ? dataOverride : this._getStateForType(type);
    for (const observer of this._observers) {
      try { observer(type, data); } catch (error) { console.error("Error in observer:", error); }
    }
  }

  /**
   * タイプに応じた状態データを取得
   * @param {string} type - 変更タイプ
   * @returns {*} 状態データ
   * @private
   */
  _getStateForType(type) {
    switch (type) {
      case 'mode': return this._mode;
      case 'tool': return this._tool;
      case 'addingPoints': return this._addingPoints;
      case 'targetPolygon': return this._targetPolygon;
      case 'addingSubMode': return this._addingSubMode;
      case 'targetRingIdForHole': return this._targetRingIdForHole;
      case 'temporaryElements': return this._temporaryElements;
      case 'draggingVertices': return this._draggingVerticesInfo;
      case 'history': return { canUndo: this.canUndo(), canRedo: this.canRedo() };
      case 'addingState':
        return {
          addingPoints: this._addingPoints,
          targetPolygon: this._targetPolygon,
          addingSubMode: this._addingSubMode,
          targetRingIdForHole: this._targetRingIdForHole
        };
      default: return null;
    }
  }
}
