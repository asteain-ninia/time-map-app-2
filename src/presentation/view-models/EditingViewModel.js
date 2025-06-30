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
    // properties が要素数1の Property インスタンスの配列であることをバリデーション
    if (!Array.isArray(properties) || properties.length !== 1 || !(properties[0] instanceof Property)) {
        console.error("EditingViewModel.confirmAddFeature: properties must be an array containing a single Property instance. Received:", properties);
        throw new Error("Invalid properties format. Expected a single Property instance in an array for confirmAddFeature.");
    }
    try {
      const geometryData = { vertices: [...this._addingPoints] };
      // EditFeatureUseCase.addFeature は要素数1のプロパティ配列をそのまま渡す
      const feature = await this._editFeatureUseCase.addFeature(this._tool, properties, geometryData, layerId);

      // HistoryService に履歴追加を依頼
      // feature.properties は要素数1のはず (ドメイン層で強制される)
      await this._historyService.addHistoryEntry('add', {
        featureInstance: feature, 
        featureType: this._tool
      });

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

    const polygonBeforeUpdate = this._targetPolygon; // 更新前のポリゴンインスタンス

    try {
        const geometryUpdate = {
            newRingCoordinates: [{ points: holePoints, isOuter: false, parentId: targetRingId }]
        };
        // UpdateFeatureUseCase.execute は { feature, newlyAddedVerticesData? } を返す
        const updateResult = await this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });
        const updatedPolygon = updateResult.feature;
        const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];

        const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

        // HistoryService に履歴追加を依頼
        await this._historyService.addHistoryEntry('addRing', {
            polygonId: polygonId,
            addedRing: addedRingPlain ? { ...addedRingPlain } : null, // プレーンオブジェクトで
            addedVerticesDataFromUseCase: newlyAddedVerticesData, // UseCaseから取得したプレーンな頂点データ
            // polygonBeforeData: polygonBeforeUpdate // 必要なら更新前ポリゴンも渡す
        });

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
    const parentRingId = this.getTargetRingIdForHole(); // 穴の中の飛び地なら穴のID、本土外ならnull

    const polygonBeforeUpdate = this._targetPolygon; // 更新前のポリゴンインスタンス

    try {
        const geometryUpdate = {
            newRingCoordinates: [{ points: enclavePoints, isOuter: true, parentId: parentRingId }]
        };
        const updateResult = await this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });
        const updatedPolygon = updateResult.feature;
        const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];
        
        const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

        await this._historyService.addHistoryEntry('addRing', {
            polygonId: polygonId,
            addedRing: addedRingPlain ? { ...addedRingPlain } : null,
            addedVerticesDataFromUseCase: newlyAddedVerticesData
        });
        
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
    const dragInfoCopy = new Map(this._draggingVerticesInfo); // これが originalPosition と currentPosition を持つ
    this._resetDraggingState(); // UI上のドラッグプレビュー等をクリアするため先に呼ぶ

    const vertexUpdatesForUseCase = [];
    const historyPayloadUpdates = [];
    let significantMovement = false;
    const clickToleranceSq = 1e-6; // 小さな移動は無視

    for (const [vertexId, info] of dragInfoCopy.entries()) {
        const dx = info.currentPosition.x - info.originalPosition.x;
        const dy = info.currentPosition.y - info.originalPosition.y;
        if ((dx * dx + dy * dy) > clickToleranceSq) {
            significantMovement = true;
        }
        // UseCase に渡すデータ (新しい位置のみ)
        vertexUpdatesForUseCase.push({ vertexId, newPosition: info.currentPosition });
        // 履歴に渡すデータ (古い位置と新しい位置のVertexインスタンス)
        historyPayloadUpdates.push({
            vertexId,
            oldPosition: new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y),
            newPosition: new Vertex(vertexId, info.currentPosition.x, info.currentPosition.y)
        });
    }

    if (significantMovement) {
        try {
            // UseCase呼び出し (EditFeatureUseCase.moveVertices は { updatedVertices, affectedFeatures } を返す)
            const moveResult = await this._editFeatureUseCase.moveVertices(vertexUpdatesForUseCase);
            
            // HistoryService に履歴追加を依頼
            await this._historyService.addHistoryEntry('moveVertices', {
                updates: historyPayloadUpdates // oldPosition と newPosition の Vertex インスタンスを含む配列
            });

            // イベント発行 (個別のVertexMovedはUseCase内で発行されるか、moveResultを元にここで発行)
            if (moveResult && moveResult.updatedVertices) {
                 moveResult.updatedVertices.forEach(v => this._eventBus.publish('VertexMoved', { vertexId: v.id, newPosition: {x: v.x, y: v.y} }));
            }
        } catch (error) {
            console.error('複数頂点の移動確定に失敗しました', error);
            alert(`頂点の移動に失敗しました: ${error.message}`);
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
  async deleteFeature(featureId, feature) { // feature は削除前のインスタンス
    if (!feature) { throw new Error("Missing feature data for deletion history."); }
    try {
       // --- 変更ここから ---
       // HistoryService に渡すために、削除「前」の feature インスタンスが必要
       // feature.properties は要素数1のはず
       await this._historyService.addHistoryEntry('delete', {
         featureInstance: feature // 削除前のドメインインスタンス
       });

       await this._editFeatureUseCase.deleteFeature(featureId); // 地物削除処理
       // --- 変更ここまで ---

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
        const worldRepository = this._editFeatureUseCase._worldRepository; // 仮
        const worldBefore = await worldRepository.getWorld(); // 変更前のワールド状態

        // 1. 削除対象の頂点の「削除前」のVertexインスタンスを取得
        const verticesToRestore = vertexIds.map(id => {
            const vData = worldBefore.vertices.find(v => v.id === id);
            return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
        }).filter(Boolean);

        // 2. 頂点削除によって影響を受ける地物の「削除前」のFeatureインスタンスを取得
        const affectedFeaturesBefore = [];
        const deletedVertexIdsSet = new Set(vertexIds);
        worldBefore.features.forEach(f => {
            const usesAnyDeletedVertex = 
                (f instanceof DomainPolygon && f.rings?.some(r => r.vertexIds.some(id => deletedVertexIdsSet.has(id)))) ||
                (!(f instanceof DomainPolygon) && f.vertexIds?.some(id => deletedVertexIdsSet.has(id)));
            if (usesAnyDeletedVertex) {
                affectedFeaturesBefore.push(f); // ディープコピーが望ましいが、HistoryServiceでシリアライズ時に行われる
            }
        });
        
        // 3. UseCaseを呼び出して頂点を削除
        // EditFeatureUseCase.deleteVertices は { deletedVertexIds, updatedFeatureIds, deletedFeatureIds } を返す
        const result = await this._editFeatureUseCase.deleteVertices(vertexIds);

        // 4. HistoryService に履歴追加を依頼
        await this._historyService.addHistoryEntry('deleteVertices', {
            deletedVertexIds: result.deletedVertexIds, // 実際に削除されたID (UseCaseから)
            verticesToRestore: verticesToRestore,         // 削除前のVertexインスタンス配列
            affectedFeaturesBefore: affectedFeaturesBefore, // 影響前のFeatureインスタンス配列
            deletedFeatureIdsInOperation: result.deletedFeatureIds // この操作で削除された地物ID (UseCaseから)
        });

        // イベント発行 (UseCase内またはHistoryService経由で行われるので、ここでは不要な場合も)
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
    try {
      // newProperties が要素数1の Property インスタンスの配列であることをバリデーション
      if (!Array.isArray(newProperties) || newProperties.length !== 1 || !(newProperties[0] instanceof Property)) {
        console.error("EditingViewModel.updateFeatureProperties: newProperties must be an array containing a single Property instance. Received:", newProperties);
        throw new Error("Invalid newProperties format. Expected a single Property instance in an array for updateFeatureProperties.");
      }

      const worldRepository = this._editFeatureUseCase._worldRepository;
      const world = await worldRepository.getWorld();
      const featureBefore = world.features.find(f => f.id === featureId);
      if (!featureBefore) { throw new Error(`Feature not found: ${featureId}`); }
      
      // featureBefore.properties も要素数1のはず (ドメイン層で強制)
      const oldPropertiesInstances = (featureBefore.properties && featureBefore.properties.length > 0)
                                      ? [featureBefore.properties[0]]
                                      : [];

      const updateResult = await this._editFeatureUseCase.updateFeature(featureId, { properties: newProperties });
      const updatedFeature = updateResult.feature; // updatedFeature.properties も要素数1のはず

      await this._historyService.addHistoryEntry('updateProperties', {
          featureId: featureId,
          oldProperties: oldPropertiesInstances, // 要素数1の配列
          newProperties: updatedFeature.properties // 要素数1の配列のはず
      });

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
      const worldRepository = this._editFeatureUseCase._worldRepository;
      const worldBefore = await worldRepository.getWorld();
      const featureBeforeUpdate = worldBefore.features.find(f => f.id === edgeInfo.featureId);
      if (!featureBeforeUpdate) {
        throw new Error(`対象の地物が見つかりません: ${edgeInfo.featureId}`);
      }

      // UseCaseを呼び出し (VertexEditUseCaseに新しいメソッドを追加する想定)
      const result = await this._editFeatureUseCase.addVertexToFeatureEdge(
        edgeInfo.featureId,
        edgeInfo.segmentStartVertexId,
        edgeInfo.segmentEndVertexId,
        edgeInfo.projectionPoint, // {x, y}
        edgeInfo.ringId // ポリゴンの場合のみ ringId を渡す
      );
      // result は { newVertex: Vertex, updatedFeature: Feature } を想定

      if (!result || !result.newVertex || !result.updatedFeature) {
        throw new Error("VertexEditUseCase.addVertexToFeatureEdge did not return expected result.");
      }

      // HistoryService に履歴追加を依頼
      await this._historyService.addHistoryEntry('addVertexToEdge', {
        featureId: edgeInfo.featureId,
        ringId: edgeInfo.ringId, // ポリゴンの場合のみ
        segmentStartVertexId: edgeInfo.segmentStartVertexId,
        segmentEndVertexId: edgeInfo.segmentEndVertexId,
        newVertexId: result.newVertex.id,
        newVertexPosition: { x: result.newVertex.x, y: result.newVertex.y }, // プレーンオブジェクト
        featureBeforeData: this._historyService._serializer.serialize(featureBeforeUpdate) // 更新前の地物データ
      });

      // イベント発行
      this._eventBus.publish('VertexAddedToEdge', {
        newVertex: result.newVertex, // Vertexインスタンス
        updatedFeature: result.updatedFeature // Featureインスタンス
      });
      // 地物全体の更新としても通知
      this._eventBus.publish('FeatureUpdated', { feature: result.updatedFeature });

      return result.newVertex;

    } catch (error) {
      console.error('エッジへの頂点追加に失敗しました (EditingViewModel)', error);
      alert(`エッジへの頂点追加に失敗: ${error.message}`);
      throw error; // 必要に応じて呼び出し元でさらに処理
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