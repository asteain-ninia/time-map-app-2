// src/presentation/view-models/EditingViewModel.js
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { Property } from '../../domain/value-objects/Property.js';
import { Vertex } from '../../domain/entities/Vertex.js';
// HistoryService はDIで渡されるのでimport不要

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
    if (changed) { this._notifyObservers('addingState'); } // 一括で通知する場合
    else { // 個別に通知する場合 (より細かいUI更新が可能)
        if (this._addingPoints.length > 0) this._notifyObservers('addingPoints');
        if (this._targetPolygon !== null) this._notifyObservers('targetPolygon');
        if (this._addingSubMode !== null) this._notifyObservers('addingSubMode');
        if (this._targetRingIdForHole !== null) this._notifyObservers('targetRingIdForHole');
    }
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

    const operationFunc = async () => {
        const feature = await this._editFeatureUseCase.addFeature(featureType, properties, geometryData, layerId);
        // HistoryServiceに渡すために、追加された地物インスタンスを返す
        return { addedFeature: feature };
    };

    try {
        const result = await operationFunc(); // 先に実行してIDなどを確定させる
        const feature = result.addedFeature;

        const payload = {
            featureId: feature.id,
            featureData: this._historyService._serializer.serialize(feature),
            addedVerticesData: await this._historyService._getVerticesDataForFeatureForHistory(feature)
        };
        
        // 操作は既に完了しているので、履歴登録のみを行う別のメソッドを呼ぶか、HistoryServiceを修正する必要がある。
        // ここでは、executeAndRecordの第一引数に「何もしない関数」を渡すことで、履歴登録のみを行わせる。
        // ただし、これはアーキテクチャとして不完全。理想はUseCaseが永続化しないこと。
        // 今回の修正では、UseCaseは永続化を行う前提なので、この実装は矛盾する。
        // → HistoryService.executeAndRecordの設計を見直し、ViewModelで事前実行した結果を渡せるようにするべきかもしれない。
        // → 今回は、addHistoryEntryを単純な履歴登録メソッドとして再利用する。
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

    const geometryUpdate = {
        newRingCoordinates: [{ points: holePoints, ringType: 'hole', parentId: targetRingId }]
    };
    const operationFunc = () => this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });

    try {
        // 先に操作を実行
        const updateResult = await operationFunc();
        const updatedPolygon = updateResult.feature;
        const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];
        const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

        // 履歴ペイロードを作成
        const payload = {
            polygonId: polygonId,
            addedRing: addedRingPlain ? { ...addedRingPlain } : null,
            addedVerticesData: newlyAddedVerticesData.map(vData => 
                this._historyService._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
            )
        };
        
        // 履歴登録
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

    const geometryUpdate = {
        newRingCoordinates: [{ points: enclavePoints, ringType: 'territory', parentId: parentRingId }]
    };
    const operationFunc = () => this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });

    try {
        // 先に操作を実行
        const updateResult = await operationFunc();
        const updatedPolygon = updateResult.feature;
        const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];
        const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

        // 履歴ペイロードを作成
        const payload = {
            polygonId: polygonId,
            addedRing: addedRingPlain ? { ...addedRingPlain } : null,
            addedVerticesData: newlyAddedVerticesData.map(vData => 
                this._historyService._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
            )
        };
        
        // 履歴登録
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
  async endVerticesDrag() {
    if (this._draggingVerticesInfo.size === 0) { return; }

    const isChainedFromVertexAddition = 
        this._pendingVertexAdditionInfo &&
        this._draggingVerticesInfo.has(this._pendingVertexAdditionInfo.newVertexId);

    const dragInfoCopy = new Map(this._draggingVerticesInfo);
    this._resetDraggingState();

    if (isChainedFromVertexAddition) {
        const pendingInfo = { ...this._pendingVertexAdditionInfo };
        this._pendingVertexAdditionInfo = null;

        const newVertexInfo = dragInfoCopy.get(pendingInfo.newVertexId);
        if (!newVertexInfo) {
            console.error("Chained vertex drag end failed: Drag info not found.");
            return;
        }
        
        const finalPosition = newVertexInfo.currentPosition;
        pendingInfo.featureBeforeData.rings.forEach(r => {
            const index = r.vertexIds.indexOf(pendingInfo.newVertexId);
            if(index !== -1) { r.vertexIds.splice(index, 1); }
        });

        const operationFunc = () => this._editFeatureUseCase.addVertexToFeatureEdge(
            pendingInfo.featureId,
            pendingInfo.segmentStartVertexId,
            pendingInfo.segmentEndVertexId,
            finalPosition,
            pendingInfo.ringId,
            pendingInfo.newVertexId
        );

        const payload = {
            ...pendingInfo,
            newVertexPosition: finalPosition,
            addedVertexData: this._historyService._serializer.serialize(new Vertex(pendingInfo.newVertexId, finalPosition.x, finalPosition.y)),
            featureBeforeData: pendingInfo.featureBeforeData
        };
        
        try {
            const result = await operationFunc();
            const command = new AddVertexToEdgeCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
            this._historyService._stackManager.pushUndo(command);
            this._historyService._notifyHistoryChanged();
            this._eventBus.publish('FeatureUpdated', { feature: result.updatedFeature });
        } catch (error) {
            console.error('線上への頂点追加（ドラッグ完了時）に失敗しました', error);
            alert(`頂点追加に失敗しました: ${error.message}`);
            // 失敗した場合、ロールバックが必要だが、現状のアーキテクチャでは難しい。
            // UseCaseが永続化するため、手動でのリロードを促すなどが必要になる。
            this._eventBus.publish('WorldUpdated'); // とにかく再描画してサーバの状態に同期
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
                oldPosition: new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y),
                newPosition: new Vertex(vertexId, info.currentPosition.x, info.currentPosition.y)
            });
        }

        if (significantMovement) {
            const operationFunc = () => this._editFeatureUseCase.moveVertices(vertexUpdatesForUseCase);
            const payload = { updates: historyPayloadUpdates };
            try {
                const moveResult = await this._historyService.executeAndRecord(operationFunc, 'moveVertices', payload);
                if (moveResult && moveResult.updatedVertices) {
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
    const operationFunc = () => this._editFeatureUseCase.deleteFeature(featureId);

    try {
        await this._historyService.executeAndRecord(operationFunc, 'delete', payload);
        this._eventBus.publish('FeatureDeleted', { featureId });
        this._eventBus.publish('ClearSelection');
    } catch (error) {
        console.error('地物の削除に失敗しました', error);
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
        const worldRepository = this._editFeatureUseCase._worldRepository;
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
        
        const operationFunc = () => this._editFeatureUseCase.deleteVertices(vertexIds);
        
        // UseCaseを先に実行して結果を取得
        const result = await operationFunc();
        
        const payload = {
            deletedVertexIds: result.deletedVertexIds,
            verticesToRestoreData: verticesToRestore.map(v => this._historyService._serializer.serialize(v)),
            affectedFeaturesBefore: affectedFeaturesBefore.map(f => this._historyService._serializer.serialize(f))
        };
        
        // 履歴登録
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
        throw error;
    }
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
        const worldRepository = this._editFeatureUseCase._worldRepository;
        const world = await worldRepository.getWorld();
        const featureBefore = world.features.find(f => f.id === featureId);
        if (!featureBefore) { throw new Error(`Feature not found: ${featureId}`); }
        
        const oldPropertiesInstances = (featureBefore.properties && featureBefore.properties.length > 0)
                                        ? [featureBefore.properties[0]]
                                        : [];

        const operationFunc = () => this._editFeatureUseCase.updateFeature(featureId, { properties: newProperties });
        
        const updateResult = await operationFunc();
        const updatedFeature = updateResult.feature;

        const payload = {
            featureId: featureId,
            oldProperties: oldPropertiesInstances.map(p => this._historyService._serializer.serialize(p)),
            newProperties: updatedFeature.properties.map(p => this._historyService._serializer.serialize(p))
        };

        const command = new UpdatePropertiesCommand(payload, this._editFeatureUseCase, this._historyService._serializer);
        this._historyService._stackManager.pushUndo(command);
        this._historyService._notifyHistoryChanged();

        this._eventBus.publish('FeatureUpdated', { feature: updatedFeature });
        return updatedFeature;
    } catch (error) {
        console.error('地物プロパティの更新に失敗しました (EditingViewModel)', error);
        throw error;
    }
  }

  /**
   * 指定されたエッジに頂点を追加する
   * @param {object} edgeInfo - エッジ情報 { featureId, ringId?, segmentStartVertexId, segmentEndVertexId, projectionPoint }
   * @returns {Promise<void>}
   */
  async addVertexToEdge(edgeInfo) {
    if (!edgeInfo || !edgeInfo.featureId || !edgeInfo.segmentStartVertexId || !edgeInfo.segmentEndVertexId || !edgeInfo.projectionPoint) {
      console.error("Invalid edgeInfo provided to addVertexToEdge", edgeInfo);
      throw new Error("頂点追加のためのエッジ情報が不完全です。");
    }

    try {
        // この操作は永続化を伴わないプレビューとして扱う
        const worldRepository = this._editFeatureUseCase._worldRepository;
        let world = await worldRepository.getWorld(); // 現在のワールドを取得
        const featureBeforeUpdate = world.features.find(f => f.id === edgeInfo.featureId);
        if (!featureBeforeUpdate) {
            throw new Error(`対象の地物が見つかりません: ${edgeInfo.featureId}`);
        }

        const newVertexId = this._editFeatureUseCase._generateIdFunc('vertex');
        const newVertex = new Vertex(newVertexId, edgeInfo.projectionPoint.x, edgeInfo.projectionPoint.y);

        // メモリ上のworldオブジェクトにプレビュー用の頂点を一時的に追加
        world.vertices.push({ id: newVertex.id, x: newVertex.x, y: newVertex.y });
        
        let featureWithNewVertex;
        if (featureBeforeUpdate instanceof DomainPolygon) {
            const ring = featureBeforeUpdate.rings.find(r => r.id === edgeInfo.ringId);
            const oldIds = ring.vertexIds;
            const startIndex = oldIds.indexOf(edgeInfo.segmentStartVertexId);
            const endIndex = oldIds.indexOf(edgeInfo.segmentEndVertexId);
            let insertBeforeIndex = -1;
            if ((startIndex + 1) % oldIds.length === endIndex) { insertBeforeIndex = endIndex; }
            else if ((endIndex + 1) % oldIds.length === startIndex) { insertBeforeIndex = startIndex; }
            const newIds = [...oldIds.slice(0, insertBeforeIndex), newVertexId, ...oldIds.slice(insertBeforeIndex)];
            featureWithNewVertex = featureBeforeUpdate.withUpdatedRingVertices(edgeInfo.ringId, newIds);
        } else { // Line
            const oldIds = featureBeforeUpdate.vertexIds;
            const startIndex = oldIds.indexOf(edgeInfo.segmentStartVertexId);
            const endIndex = oldIds.indexOf(edgeInfo.segmentEndVertexId);
            const insertBeforeIndex = Math.max(startIndex, endIndex);
            const newIds = [...oldIds.slice(0, insertBeforeIndex), newVertexId, ...oldIds.slice(insertBeforeIndex)];
            featureWithNewVertex = featureBeforeUpdate.withVertexIds(newIds);
        }
        world.features[world.features.findIndex(f=>f.id === edgeInfo.featureId)] = featureWithNewVertex;


        this._pendingVertexAdditionInfo = {
            featureId: edgeInfo.featureId,
            ringId: edgeInfo.ringId,
            segmentStartVertexId: edgeInfo.segmentStartVertexId,
            segmentEndVertexId: edgeInfo.segmentEndVertexId,
            newVertexId: newVertexId,
            featureBeforeData: this._historyService._serializer.serialize(featureBeforeUpdate)
        };

        this._eventBus.publish('WorldUpdated'); // プレビューを再描画

        return newVertex;

    } catch (error) {
      console.error('エッジへの頂点追加プレビューに失敗しました', error);
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
      // イベント発行は HistoryService が行う
    } catch (error) {
      console.error('アンドゥに失敗しました (ViewModel)', error);
      alert(`アンドゥに失敗しました: ${error.message}`);
      // 状態のロールバックは HistoryService 内部で行われる
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
      // イベント発行は HistoryService が行う
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