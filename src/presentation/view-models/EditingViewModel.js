// src\presentation\view-models\EditingViewModel.js
import { Point } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js'; // Line は他の箇所で使用されている可能性があるためエイリアス
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js'; // Polygon も同様にエイリアス
import { TimePoint } from '../../domain/value-objects/TimePoint.js'; // TimePoint をインポート
import { Property } from '../../domain/value-objects/Property.js'; // Property をインポート
import { Vertex } from '../../domain/entities/Vertex.js'; // Vertexクラスをインポート


/**
 * 編集関連の状態管理
 */
export class EditingViewModel {
  /**
   * 編集ビューモデルを作成
   * @param {EditFeatureUseCase} editFeatureUseCase - 地理オブジェクト編集ユースケース
   * @param {EventBus} eventBus - イベントバス
   */
  constructor(editFeatureUseCase, eventBus) {
    this._editFeatureUseCase = editFeatureUseCase;
    this._eventBus = eventBus;

    // 編集の状態
    this._mode = 'view'; // 'view', 'add', 'edit'
    this._tool = null; // 'point', 'line', 'polygon', 'select', 'add-hole', ...
    this._addingPoints = []; // 追加中の点の配列 (地物追加または穴/飛び地追加用)
    // this._targetPolygonIdForHole = null; // リングベースではインスタンスを直接持つため不要
    this._targetPolygon = null; // 穴/飛び地追加対象のポリゴンインスタンス
    // this._targetSubPolygonIndex = null; // リングベースでは不要
    this._targetRingIdForHole = null; // 穴追加対象リングID
    this._addingSubMode = null; // 穴/飛び地追加のサブモード ('hole' or 'enclave')
    this._temporaryElements = []; // 一時的な表示要素 (MapViewで描画)
    this._draggingVerticesInfo = new Map(); // ドラッグ中の頂点情報 Map<vertexId, { originalPosition, currentPosition }>

    // アンドゥ・リドゥの状態
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistorySize = 100;

    // 観測者の登録
    this._observers = [];
  }

  // --- TimePoint と Property のデシリアライズヘルパー (History用も兼ねる) ---

  /**
   * プレーンオブジェクトから TimePoint インスタンスを生成
   * @param {Object | null} data - TimePoint のプレーンオブジェクト ({ year, month?, day? })
   * @returns {TimePoint | null} TimePoint インスタンス、または null
   * @private
   */
  _deserializeTimePoint(data) {
      if (!data || data.year === undefined || data.year === null) return null;
      const month = data.month !== undefined ? data.month : null;
      const day = data.day !== undefined ? data.day : null;
      return new TimePoint(data.year, month, day);
  }

  /**
   * プレーンオブジェクトから Property インスタンスを生成
   * @param {Object | null} data - Property のプレーンオブジェクト
   * @returns {Property | null} Property インスタンス、または null
   * @private
   */
  _deserializeProperty(data) {
      if (!data) return null;
      const timePoint = this._deserializeTimePoint(data.timePoint);
      if (!timePoint) {
           console.warn("Property deserialization failed: Invalid or missing timePoint", data);
           return null;
      }
      const { timePoint: tpData, timeRange, name, description, attributes, ...legacyAttributes } = data;
      const mergedAttributes = { ...legacyAttributes, ...(attributes || {}) };
      let startTime = null;
      let endTime = null;
      if (timeRange) {
          startTime = this._deserializeTimePoint(timeRange.start);
          endTime = this._deserializeTimePoint(timeRange.end);
      }
      const propName = name !== undefined ? name : '';
      const propDesc = description !== undefined ? description : '';
      return new Property(timePoint, propName, propDesc, mergedAttributes, startTime, endTime);
  }

  // --- History 用 シリアライズ/デシリアライズ ヘルパー ---

  /**
   * ドメインオブジェクトを履歴保存用のプレーンオブジェクトにシリアライズ
   * @param {Object} object - ドメインオブジェクト (Vertex, Feature, Property, TimePoint, Ring)
   * @returns {Object | null} シリアライズされたプレーンオブジェクト、または null
   * @private
   */
   _serializeForHistory(object) {
    if (!object) return null;

    const serializeTimePoint = (tp) => tp ? { year: tp.year, month: tp.month, day: tp.day } : null;
    const serializeProperty = (prop) => {
        if (!prop || !(prop instanceof Property)) return null;
        const attributes = prop.getAttributes ? prop.getAttributes() : {};
        const timeRangeData = {};
        let hasTimeRange = false;
        if (prop.startTime) { timeRangeData.start = serializeTimePoint(prop.startTime); hasTimeRange = true; }
        if (prop.endTime) { timeRangeData.end = serializeTimePoint(prop.endTime); hasTimeRange = true; }
        const serialized = {
            _constructorName: 'Property',
            timePoint: serializeTimePoint(prop.timePoint),
            name: prop.name,
            description: prop.description,
            attributes: attributes
        };
        if (hasTimeRange) { serialized.timeRange = timeRangeData; }
        return serialized;
    };

    if (object instanceof Vertex) {
        return { _constructorName: 'Vertex', id: object.id, x: object.x, y: object.y };
    } else if (object instanceof Point || object instanceof DomainLine) {
        const featureData = {
            _constructorName: object.constructor.name,
            id: object.id,
            vertexIds: Array.isArray(object.vertexIds) ? [...object.vertexIds] : [],
            properties: Array.isArray(object.properties) ? object.properties.map(serializeProperty).filter(Boolean) : [],
            layerId: object.layerId
        };
        return featureData;
    } else if (object instanceof DomainPolygon) {
        const polygonData = {
            _constructorName: 'Polygon',
            id: object.id,
            properties: Array.isArray(object.properties) ? object.properties.map(serializeProperty).filter(Boolean) : [],
            layerId: object.layerId,
            parentId: object.parentId,
            childIds: Array.isArray(object.childIds) ? [...object.childIds] : [],
            rings: Array.isArray(object.rings) ? object.rings.map(ring => ({
                // リングデータはプレーンオブジェクトとして保存（_constructorName不要）
                id: ring.id,
                vertexIds: [...ring.vertexIds],
                isOuter: ring.isOuter,
                parentId: ring.parentId
            })) : []
        };
        return polygonData;
    } else if (object instanceof Property) {
        return serializeProperty(object);
    } else if (object instanceof TimePoint) {
        return { _constructorName: 'TimePoint', ...serializeTimePoint(object) };
    }
    // Ringオブジェクトは履歴に直接シリアライズする必要はない想定
    // (Polygonの一部としてプレーンオブジェクトで保存されるため)
    // else if (object._constructorName === 'Ring') { ... }
     else {
        console.warn("Unsupported object type for history serialization:", object);
        try { return JSON.parse(JSON.stringify(object)); } catch { return null; }
    }
  }

 /**
 * 履歴から読み込んだプレーンオブジェクトを対応するドメインインスタンスにデシリアライズ
 * @param {Object | null} data - シリアライズされたプレーンオブジェクト
 * @returns {Object | null} デシリアライズされたドメインインスタンス、またはリングの場合はプレーンオブジェクト、それ以外はnull
 * @private
 */
_deserializeFromHistory(data) {
    if (!data) return null;
    // リングデータは _constructorName を持たない前提で処理を追加
    // リングデータはプレーンオブジェクトとして扱われるため、ここでは new Ring() のようなことはしない
    if (data.id && Array.isArray(data.vertexIds) && typeof data.isOuter === 'boolean' && data._constructorName === undefined) { // リング判定条件をより明確に
        return { // リングデータはプレーンオブジェクトとして返す
            id: data.id,
            vertexIds: data.vertexIds || [],
            isOuter: data.isOuter,
            parentId: data.parentId !== undefined ? data.parentId : null // parentIdがなければnull
        };
    }
    // _constructorName を持つオブジェクトの処理
    if (!data._constructorName) return null;
    const constructorName = data._constructorName;

    try {
        switch (constructorName) {
            case 'Vertex':
                return new Vertex(data.id, data.x, data.y);
            case 'TimePoint':
                return this._deserializeTimePoint(data);
            case 'Property':
                return this._deserializeProperty(data);
            case 'Point':
                const pointProps = (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(p => p instanceof Property);
                return new Point(
                    data.id,
                    data.vertexIds || [],
                    pointProps,
                    data.layerId
                );
            case 'Line':
                const lineProps = (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(p => p instanceof Property);
                return new DomainLine( // エイリアスを使用
                    data.id,
                    data.vertexIds || [],
                    lineProps,
                    data.layerId
                );
            case 'Polygon':
                const polygonRings = (data.rings || []).map(ringData => { // リングはプレーンオブジェクト
                    // ここでもリングデータの parentId をnullにフォールバック
                    return {
                        id: ringData.id,
                        vertexIds: ringData.vertexIds || [],
                        isOuter: ringData.isOuter,
                        parentId: ringData.parentId !== undefined ? ringData.parentId : null
                    };
                });
                const polygonProps = (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(p => p instanceof Property);
                return new DomainPolygon( // エイリアスを使用
                    data.id,
                    polygonProps,
                    data.layerId,
                    data.parentId || "0",
                    data.childIds || [],
                    polygonRings
                );
            default:
                console.warn(`Unsupported constructor name for history deserialization: ${constructorName}`, data);
                return null;
        }
    } catch (error) {
        console.error(`Error deserializing object with constructor ${constructorName}:`, error, data);
        return null;
    }
}


  /**
   * 編集モードを設定
   * @param {string} mode - モード ('view', 'add', 'edit')
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
   * @param {string} tool - ツール ('point', 'line', 'polygon', 'select', 'add-hole', ...)
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
      } else {
          console.warn("startAddingHoleOrEnclave called when tool is not 'add-hole'.");
      }
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
    if (changed) { this._notifyObservers('addingState'); }
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
   * @param {Object} properties - プロパティ (Property インスタンスの配列)
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Object>} 追加された地物インスタンス
   */
  async confirmAddFeature(properties, layerId) {
    if (this._mode !== 'add' || !this._tool || this._addingPoints.length === 0) {
      throw new Error('地物の追加状態ではありません');
    }
    if (!Array.isArray(properties) || !properties.every(p => p instanceof Property)) {
        console.error("confirmAddFeature: properties must be an array of Property instances.", properties);
        throw new Error("Invalid properties format.");
    }
    try {
      let feature;
      const geometryData = { vertices: [...this._addingPoints] };
      console.log("[confirmAddFeature] Calling _editFeatureUseCase.addFeature with tool:", this._tool, "properties:", properties, "geometryData:", geometryData, "layerId:", layerId);
      feature = await this._editFeatureUseCase.addFeature(this._tool, properties, geometryData, layerId);
      console.log("[confirmAddFeature] Feature returned from use case:", JSON.parse(JSON.stringify(feature))); // ★ feature オブジェクトの内容をログ出力

      let vertexIdsForHistory = [];
      if (feature) {
          if (this._tool === 'point' && feature.vertexIds && feature.vertexIds.length > 0) {
              vertexIdsForHistory = feature.vertexIds;
          } else if ((this._tool === 'line' || this._tool === 'polygon') && feature.rings && feature.rings.length > 0) {
              vertexIdsForHistory = feature.rings.flatMap(r => r.vertexIds || []);
          } else if (this._tool === 'line' && feature.vertexIds && feature.vertexIds.length > 0) { // PolygonでないLineの場合
              vertexIdsForHistory = feature.vertexIds;
          }
          // Feature基底クラスのvertexIdsも考慮（リングベースでないポリゴンやLine/Pointのフォールバック）
          if (vertexIdsForHistory.length === 0 && feature.vertexIds && feature.vertexIds.length > 0) {
              console.warn("[confirmAddFeature] Falling back to feature.vertexIds for history as rings might be empty or tool type mismatch for ring extraction.");
              vertexIdsForHistory = feature.vertexIds;
          }
      }
      console.log("[confirmAddFeature] Vertex IDs extracted for history (_getVerticesByIds input):", JSON.parse(JSON.stringify(vertexIdsForHistory))); // ★ _getVerticesByIdsに渡すIDリストをログ出力

      const addedVerticesData = await this._getVerticesByIds(vertexIdsForHistory);
      console.log("[confirmAddFeature] Data returned from _getVerticesByIds (addedVerticesData for history):", JSON.parse(JSON.stringify(addedVerticesData))); // ★ _getVerticesByIdsの結果をログ出力

      this._addToHistory({
        type: 'add',
        featureId: feature.id,
        featureType: this._tool,
        featureData: this._serializeForHistory(feature),
        addedVerticesData: addedVerticesData
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
          console.error('穴の追加確定の条件を満たしていません。', { mode: this._mode, tool: this._tool, subMode: this._addingSubMode, target: !!this._targetPolygon, targetRingId: this._targetRingIdForHole, points: this._addingPoints.length });
          this._clearAddingState();
          this.setTool('select');
          return null;
      }

      const polygonId = this._targetPolygon.id;
      const holePoints = [...this._addingPoints];
      const targetRingId = this._targetRingIdForHole;

      const polygonBeforeUpdatePlain = this._serializeForHistory(this._targetPolygon); // 更新前のポリゴンを履歴用に保存

      try {
          const geometryUpdate = {
              newRingCoordinates: [{
                  points: holePoints,
                  isOuter: false,
                  parentId: targetRingId
              }]
          };

          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );

          const polygonAfterUpdatePlain = this._serializeForHistory(updatedPolygon); // 更新後のポリゴン
          // 更新前後のリングリストを比較して追加されたリングを特定
          const addedRingData = polygonAfterUpdatePlain.rings.find(r =>
              !polygonBeforeUpdatePlain.rings.some(br => br.id === r.id)
          );
          let addedVerticesData = [];
          if (addedRingData) {
             addedVerticesData = await this._getVerticesByIds(addedRingData.vertexIds);
          } else {
             console.warn("Could not identify the added ring for undo history.");
          }

          this._addToHistory({
              type: 'addRing',
              polygonId,
              addedRing: addedRingData || null, // ★ プレーンオブジェクトを保存
              addedVerticesData: addedVerticesData // プレーンオブジェクトの配列
          });

          this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
          this._clearAddingState();
          this.setTool('select');
          return updatedPolygon;
      } catch (error) {
          console.error('穴の追加確定に失敗しました', error);
          alert(`穴の追加に失敗しました: ${error.message}`);
          this._clearAddingState();
          this.setTool('select');
          return null;
      }
  }

  /**
   * 飛び地の追加を確定
   * @returns {Promise<Object|null>} 更新されたポリゴン、または失敗時にnull
   */
  async confirmAddEnclave() {
      if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'enclave' || !this._targetPolygon || this._addingPoints.length < 3) {
          console.error('飛び地の追加確定の条件を満たしていません。', { mode: this._mode, tool: this._tool, subMode: this._addingSubMode, target: !!this._targetPolygon, points: this._addingPoints.length });
          this._clearAddingState();
          this.setTool('select');
          return null;
      }

      const polygonId = this._targetPolygon.id;
      const enclavePoints = [...this._addingPoints];

      const polygonBeforeUpdatePlain = this._serializeForHistory(this._targetPolygon); // 更新前のポリゴンを履歴用に保存

      try {
          const geometryUpdate = {
              newRingCoordinates: [{
                  points: enclavePoints,
                  isOuter: true,
                  parentId: null
              }]
          };

          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );

          const polygonAfterUpdatePlain = this._serializeForHistory(updatedPolygon); // 更新後のポリゴン
          // 更新前後のリングリストを比較して追加されたリングを特定
          const addedRingData = polygonAfterUpdatePlain.rings.find(r =>
              !polygonBeforeUpdatePlain.rings.some(br => br.id === r.id)
          );
          let addedVerticesData = [];
          if (addedRingData) {
             addedVerticesData = await this._getVerticesByIds(addedRingData.vertexIds);
          } else {
             console.warn("Could not identify the added ring (enclave) for undo history.");
          }

          this._addToHistory({
              type: 'addRing', // 穴追加と同じタイプ
              polygonId: polygonId,
              addedRing: addedRingData || null, // ★ プレーンオブジェクトを保存
              addedVerticesData: addedVerticesData, // プレーンオブジェクトの配列
          });

          this._clearAddingState();
          this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
          this.setTool('select');

          return updatedPolygon;
      } catch (error) {
          console.error('飛び地の追加確定に失敗しました', error);
          alert(`飛び地の追加に失敗しました: ${error.message}`);
          this._clearAddingState();
          this.setTool('select');
          return null;
      }
  }


  /**
   * 複数の頂点のドラッグを開始
   * @param {Map<string, {x: number, y: number}>} vertices - ドラッグする頂点のIDと開始位置のMap
   */
  startVerticesDrag(vertices) {
      if (this._mode !== 'edit' || this._tool === 'add-hole') {
          console.warn("Cannot start vertex drag in current mode/tool:", this._mode, this._tool);
          return;
      }
      if (!vertices || vertices.size === 0) { console.error("Invalid arguments for startVerticesDrag"); return; }
      if (this._draggingVerticesInfo.size > 0) { console.warn("Already dragging vertices:", Array.from(this._draggingVerticesInfo.keys())); return; }
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
      const dragInfoCopy = new Map(this._draggingVerticesInfo);
      this._resetDraggingState();
      const vertexUpdates = [];
      let significantMovement = false;
      const clickToleranceSq = 1e-6;
      for (const [vertexId, info] of dragInfoCopy.entries()) {
          const dx = info.currentPosition.x - info.originalPosition.x;
          const dy = info.currentPosition.y - info.originalPosition.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > clickToleranceSq) { significantMovement = true; }
          vertexUpdates.push({ vertexId, newPosition: info.currentPosition });
      }
      if (significantMovement) {
          try {
              // 履歴用に移動前の頂点データを取得
              const verticesBeforePlain = [];
               for (const [vertexId, info] of dragInfoCopy.entries()) {
                  verticesBeforePlain.push(this._serializeForHistory(new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y)));
               }
              // UseCaseを呼び出して頂点を移動
              await this._editFeatureUseCase.moveVertices(vertexUpdates);
              // 履歴データを生成・追加
               const historyData = { type: 'moveVertices', updates: [] };
               for (const [vertexId, info] of dragInfoCopy.entries()) {
                   // const originalVertex = new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y);
                   const currentVertex = new Vertex(vertexId, info.currentPosition.x, info.currentPosition.y);
                   const originalVertexPlain = verticesBeforePlain.find(v => v.id === vertexId);
                   historyData.updates.push({
                       vertexId: vertexId,
                       oldPosition: originalVertexPlain, // シリアライズ済みの元データ
                       newPosition: this._serializeForHistory(currentVertex) // シリアライズした新データ
                   });
               }
               this._addToHistory(historyData);
              vertexUpdates.forEach(update => { this._eventBus.publish('VertexMoved', { vertexId: update.vertexId, newPosition: update.newPosition }); });
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
  async deleteFeature(featureId, feature) {
    if (!feature) { throw new Error("Missing feature data for deletion."); }
    try {
       const verticesToRestoreData = await this._getVerticesDataForFeature(feature); // 参照頂点を履歴用に取得
       await this._editFeatureUseCase.deleteFeature(featureId);
       this._addToHistory({
         type: 'delete',
         featureId,
         featureData: this._serializeForHistory(feature), // 削除された地物データを履歴用に保存
         verticesToRestoreData: verticesToRestoreData // 削除された頂点データを履歴用に保存
       });
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
        const world = await worldRepository.getWorld();
        const affectedFeaturesBeforePlain = {};
        const verticesToRestoreData = await this._getVerticesByIds(vertexIds); // 削除される頂点自身のデータ
        const deletedVertexIdsSet = new Set(vertexIds);

        if (world && world.features) {
            world.features.forEach(f => {
                // リングベースで頂点が含まれるかチェック
                 const featureUsesVertex = (f instanceof DomainPolygon)
                     ? f.rings?.some(ring => ring.vertexIds.some(id => deletedVertexIdsSet.has(id)))
                     : f.vertexIds?.some(id => deletedVertexIdsSet.has(id));

                 if (featureUsesVertex) {
                     // 影響を受ける地物の状態を履歴用に保存
                     affectedFeaturesBeforePlain[f.id] = this._serializeForHistory(f);
                 }
            });
        }

        // UseCaseを呼び出して頂点を削除
        const result = await this._editFeatureUseCase.deleteVertices(vertexIds);

        // 履歴に追加
        this._addToHistory({
            type: 'deleteVertices',
            deletedVertexIds: vertexIds, // 削除された頂点IDリスト
            verticesToRestoreData: verticesToRestoreData, // 削除された頂点データ(Undo用)
            affectedFeaturesBefore: affectedFeaturesBeforePlain, // 影響を受けた地物の削除前の状態(Undo用)
            deletedFeatureIds: result?.deletedFeatureIds || [] // UseCaseによって削除された地物のID
        });

        // イベント発行
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
      const worldRepository = this._editFeatureUseCase._worldRepository;
      const world = await worldRepository.getWorld();
      const featureBefore = world.features.find(f => f.id === featureId);
      if (!featureBefore) { throw new Error(`Feature not found: ${featureId}`); }
      const oldPropertiesPlain = featureBefore.properties.map(p => this._serializeForHistory(p)).filter(Boolean); // 履歴用に古いプロパティを保存
      const feature = await this._editFeatureUseCase.updateFeature(featureId, { properties: newProperties });
      const newPropertiesPlain = newProperties.map(p => this._serializeForHistory(p)).filter(Boolean); // 履歴用に新しいプロパティを保存
      this._addToHistory({ type: 'updateProperties', featureId, oldProperties: oldPropertiesPlain, newProperties: newPropertiesPlain });
      this._eventBus.publish('FeatureUpdated', { feature });
      return feature;
    } catch (error) {
      console.error('地物プロパティの更新に失敗しました (EditingViewModel)', error);
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
    if (this._undoStack.length === 0) return;
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();
    const operation = this._undoStack.pop();
    try {
      await this._executeReverseOperation(operation);
      this._redoStack.push(operation);
      this._notifyObservers('history');
      this._eventBus.publish('WorldUpdated');
      this._eventBus.publish('ClearSelection'); // Undo/Redo後は選択をクリア
    } catch (error) {
      this._undoStack.push(operation); // エラー時は戻す
      console.error('アンドゥに失敗しました', error);
      alert(`アンドゥに失敗しました: ${error.message}`);
    }
  }

  /**
   * リドゥ
   * @returns {Promise<void>}
   */
  async redo() {
    if (this._redoStack.length === 0) return;
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();
    const operation = this._redoStack.pop();
    try {
      await this._executeOperation(operation);
      this._undoStack.push(operation);
      this._notifyObservers('history');
      this._eventBus.publish('WorldUpdated');
      this._eventBus.publish('ClearSelection'); // Undo/Redo後は選択をクリア
    } catch (error) {
      this._redoStack.push(operation); // エラー時は戻す
      console.error('リドゥに失敗しました', error);
      alert(`リドゥに失敗しました: ${error.message}`);
    }
  }

  /**
   * 操作履歴に追加
   * @param {Object} operation - 操作情報 (内部データはプレーンオブジェクトであるべき)
   * @private
   */
  _addToHistory(operation) {
    this._undoStack.push(operation);
    if (this._undoStack.length > this._maxHistorySize) { this._undoStack.shift(); }
    this._redoStack = [];
    this._notifyObservers('history');
  }

  /**
   * 操作を実行 (リドゥ用)
   * @param {Object} operation - 操作情報 (プレーンオブジェクト)
   * @returns {Promise<void>}
   * @private
   */
  async _executeOperation(operation) {
    const worldRepo = this._editFeatureUseCase._worldRepository;
    let world = await worldRepo.getWorld();
    let madeChangesToWorld = false; // この操作で実際にworldが変更されたかを示すフラグ
    console.log(`[Redo] Executing operation:`, JSON.parse(JSON.stringify(operation)));
    console.log(`[Redo] Initial world.vertices.length: ${world.vertices.length}, world.features.length: ${world.features.length}`);

    switch (operation.type) {
      case 'add': // 地物追加のRedo
        let addedFeatureForEvent = null; // イベント発行のために、追加された地物インスタンスを保持

        // 1. 必要な頂点を復元
        if (operation.addedVerticesData && Array.isArray(operation.addedVerticesData)) {
            console.log("[Redo 'add'] Processing addedVerticesData:", JSON.parse(JSON.stringify(operation.addedVerticesData)));
            operation.addedVerticesData.forEach(vDataPlain => {
                console.log("[Redo 'add'] Deserializing vertex data from history:", JSON.parse(JSON.stringify(vDataPlain)));
                const vData = this._deserializeFromHistory(vDataPlain);
                console.log("[Redo 'add'] Deserialized vertex instance (vData):", vData, `Is vData instanceof Vertex? ${vData instanceof Vertex}`);

                if (vData instanceof Vertex) {
                    const vertexExists = world.vertices.some(wv => wv.id === vData.id);
                    console.log(`[Redo 'add'] Vertex ${vData.id} (from vData) exists in world.vertices? ${vertexExists}`);
                    if (!vertexExists) {
                        world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                        madeChangesToWorld = true;
                        console.log(`[Redo 'add'] Pushed vertex ${vData.id} to world.vertices. world.vertices.length is now ${world.vertices.length}`);
                    }
                } else {
                    console.warn("[Redo 'add'] Expected Vertex instance from history for vertexData, but got:", vData, "Original data from history:", vDataPlain);
                }
            });
            console.log("[Redo 'add'] After processing all addedVerticesData, world.vertices.length:", world.vertices.length);
        } else {
            console.log("[Redo 'add'] No addedVerticesData found in operation history or it's not an array.");
        }

        // 2. 地物を復元して追加
        if (operation.featureData) {
            console.log("[Redo 'add'] Processing featureData:", JSON.parse(JSON.stringify(operation.featureData)));
            const featureInstance = this._deserializeFromHistory(operation.featureData);
            console.log("[Redo 'add'] Deserialized feature instance:", featureInstance);

            if (featureInstance &&
                (featureInstance instanceof DomainPolygon || featureInstance instanceof DomainLine || featureInstance instanceof Point)) {
                const featureExists = world.features.some(f => f.id === featureInstance.id);
                console.log(`[Redo 'add'] Feature ${featureInstance.id} exists in world.features? ${featureExists}`);
                if (!featureExists) {
                     world.features.push(featureInstance);
                     addedFeatureForEvent = featureInstance;
                     madeChangesToWorld = true;
                     console.log(`[Redo 'add'] Pushed feature ${featureInstance.id} to world.features. world.features.length is now ${world.features.length}`);
                }
            } else {
                console.warn("[Redo 'add'] Expected Feature instance from history for featureData, but got:", featureInstance, "Original data from history:", operation.featureData);
            }
        } else {
            console.log("[Redo 'add'] No featureData found in operation history.");
        }

        console.log(`[Redo 'add'] Before saveWorld, madeChangesToWorld: ${madeChangesToWorld}, world.vertices.length: ${world.vertices.length}, world.features.length: ${world.features.length}`);
        if (madeChangesToWorld) {
            await worldRepo.saveWorld(world);
            console.log("[Redo 'add'] saveWorld executed.");
            if (addedFeatureForEvent) {
                this._eventBus.publish('FeatureAdded', { feature: addedFeatureForEvent });
                console.log("[Redo 'add'] FeatureAdded event published for feature:", addedFeatureForEvent.id);
            }
        } else {
            console.log("[Redo 'add'] No changes made to world, saveWorld skipped.");
        }
        break;
      case 'delete': // 地物削除のRedo
         console.log(`[Redo 'delete'] Deleting feature: ${operation.featureId}`);
         await this._editFeatureUseCase.deleteFeature(operation.featureId);
         console.log(`[Redo 'delete'] deleteFeature called for: ${operation.featureId}`);
         break;
      case 'deleteVertices': // 頂点削除のRedo
          console.log(`[Redo 'deleteVertices'] Deleting vertices:`, operation.deletedVertexIds);
          await this._editFeatureUseCase.deleteVertices(operation.deletedVertexIds);
          console.log(`[Redo 'deleteVertices'] deleteVertices called for:`, operation.deletedVertexIds);
          break;
      case 'moveVertices': // 頂点移動のRedo
        console.log(`[Redo 'moveVertices'] Moving vertices:`, JSON.parse(JSON.stringify(operation.updates)));
        const redoUpdates = operation.updates.map(u => {
            const newPosVertex = this._deserializeFromHistory(u.newPosition);
            if (!newPosVertex || !(newPosVertex instanceof Vertex)){
                 console.error("[Redo 'moveVertices'] Invalid newPosition data in history for vertexId " + u.vertexId + ":", u.newPosition, "Deserialized as:", newPosVertex);
                 return null;
            }
            return { vertexId: u.vertexId, newPosition: { x: newPosVertex.x, y: newPosVertex.y }};
        }).filter(Boolean);
        if (redoUpdates.length > 0) {
            await this._editFeatureUseCase.moveVertices(redoUpdates);
            console.log(`[Redo 'moveVertices'] moveVertices called with:`, redoUpdates);
        } else {
            console.warn(`[Redo 'moveVertices'] No valid vertex updates to execute.`);
        }
        break;
      case 'updateProperties': // プロパティ更新のRedo
        console.log(`[Redo 'updateProperties'] Updating properties for feature: ${operation.featureId}`, JSON.parse(JSON.stringify(operation.newProperties)));
        const newPropsInstances = operation.newProperties.map(p => {
            const propInstance = this._deserializeFromHistory(p);
            if (!propInstance || !(propInstance instanceof Property)) {
                console.error("[Redo 'updateProperties'] Invalid property data in history:", p, "Deserialized as:", propInstance);
                return null;
            }
            return propInstance;
        }).filter(Boolean);
        // プロパティが空になる更新（newPropsInstancesが空配列）も有効な操作として扱う
        if (newPropsInstances.length > 0 || operation.newProperties.length === 0) {
             await this._editFeatureUseCase.updateFeature(operation.featureId, { properties: newPropsInstances });
             console.log(`[Redo 'updateProperties'] updateFeature (properties) called for: ${operation.featureId}`);
        } else if (operation.newProperties.length > 0) { // 元の履歴にはプロパティがあったが、デシリアライズで全て無効になった場合
            console.warn(`[Redo 'updateProperties'] All new properties were invalid for feature: ${operation.featureId}`);
        }
        break;
      case 'addRing': // リング追加のRedo
         console.log(`[Redo 'addRing'] Adding ring to polygon: ${operation.polygonId}`, JSON.parse(JSON.stringify(operation.addedRing)));
         let verticesAddedForRing = false;
         if (operation.addedVerticesData && Array.isArray(operation.addedVerticesData)) {
             console.log("[Redo 'addRing'] Processing addedVerticesData for ring:", JSON.parse(JSON.stringify(operation.addedVerticesData)));
             operation.addedVerticesData.forEach(vDataPlain => {
                 console.log("[Redo 'addRing'] Deserializing vertex data from history for ring:", JSON.parse(JSON.stringify(vDataPlain)));
                 const vData = this._deserializeFromHistory(vDataPlain);
                 console.log("[Redo 'addRing'] Deserialized vertex instance for ring (vData):", vData, `Is vData instanceof Vertex? ${vData instanceof Vertex}`);
                 if (vData instanceof Vertex && !world.vertices.some(wv => wv.id === vData.id)) {
                     world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                     verticesAddedForRing = true;
                     console.log(`[Redo 'addRing'] Pushed vertex ${vData.id} for ring. world.vertices.length: ${world.vertices.length}`);
                 } else if (vData && !(vData instanceof Vertex)){
                      console.warn("[Redo 'addRing'] Expected Vertex instance from history for ring, but got:", vData, "Original data:", vDataPlain);
                 }
             });
             console.log("[Redo 'addRing'] After processing addedVerticesData for ring, world.vertices.length:", world.vertices.length);
             if (verticesAddedForRing) {
                 await worldRepo.saveWorld(world);
                 console.log("[Redo 'addRing'] saveWorld executed for vertices of the ring.");
                 world = await worldRepo.getWorld(); // worldを再取得
                 console.log("[Redo 'addRing'] World re-fetched. world.vertices.length:", world.vertices.length);
             }
         }
         const ringToAddPlain = operation.addedRing;
         if (ringToAddPlain && typeof ringToAddPlain.id === 'string') {
             const geometryUpdate = { existingRingData: [ringToAddPlain] };
             await this._editFeatureUseCase.updateFeature(operation.polygonId, { geometry: geometryUpdate });
             console.log(`[Redo 'addRing'] updateFeature (addRingWithId) called for polygon: ${operation.polygonId} with ring: ${ringToAddPlain.id}`);
         } else {
             console.error("[Redo 'addRing'] Failed to get ring data or ring ID missing from history. Ring data:", ringToAddPlain);
         }
        break;
      default:
        console.warn(`[Redo] Unsupported operation type: ${operation.type}`);
    }
    console.log(`[Redo] Finished operation: ${operation.type}. Final world.vertices.length: ${world.vertices.length}, world.features.length: ${world.features.length}`);
  }

  /**
   * 逆操作を実行 (アンドゥ用)
   * @param {Object} operation - 操作情報 (プレーンオブジェクト)
   * @returns {Promise<void>}
   * @private
   */
  async _executeReverseOperation(operation) {
    const worldRepo = this._editFeatureUseCase._worldRepository;
    let world = await worldRepo.getWorld();
    let worldChanged = false;

    switch (operation.type) {
      case 'add': // 地物追加のUndo (地物削除)
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        // deleteFeature が関連頂点のクリーンアップ、イベント発行、保存を行う
        break;
      case 'delete': // 地物削除のUndo (地物復元)
        // 1. 必要な頂点を復元
        if (operation.verticesToRestoreData) {
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                    worldChanged = true;
                }
            });
            if (worldChanged) { await worldRepo.saveWorld(world); world = await worldRepo.getWorld(); }
        }
        // 2. 地物を復元して追加
        if (operation.featureData) {
            const featureInstance = this._deserializeFromHistory(operation.featureData);
            if (featureInstance && !world.features.some(f => f.id === featureInstance.id)) {
                 world.features.push(featureInstance);
                 await worldRepo.saveWorld(world);
                 this._eventBus.publish('FeatureAdded', { feature: featureInstance });
            }
        }
        break;
      case 'deleteVertices': // 頂点削除のUndo (頂点と影響地物の復元)
        // 1. 削除された頂点を復元
        if (operation.verticesToRestoreData) {
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                    worldChanged = true;
                }
            });
            if (worldChanged) { await worldRepo.saveWorld(world); world = await worldRepo.getWorld(); }
        }
        // 2. 影響を受けた地物の状態を元に戻す
        if (operation.affectedFeaturesBefore) {
            let featuresUpdated = false;
            for (const featureId in operation.affectedFeaturesBefore) {
                const featureBeforePlain = operation.affectedFeaturesBefore[featureId];
                const featureInstance = this._deserializeFromHistory(featureBeforePlain); // 削除前の状態に復元
                if (!featureInstance) continue;

                const index = world.features.findIndex(f => f.id === featureId);
                if (index !== -1) { // 地物がまだ存在する場合 (更新されたケース)
                    world.features[index] = featureInstance;
                    this._eventBus.publish('FeatureUpdated', { feature: featureInstance });
                    featuresUpdated = true;
                } else { // 地物が削除されていた場合
                    world.features.push(featureInstance);
                    this._eventBus.publish('FeatureAdded', { feature: featureInstance });
                    featuresUpdated = true;
                }
            }
            if (featuresUpdated) { await worldRepo.saveWorld(world); }
        }
        break;
      case 'moveVertices': // 頂点移動のUndo (元の位置に戻す)
          const undoUpdates = operation.updates.map(u => {
              const oldPos = this._deserializeFromHistory(u.oldPosition); // oldPositionはVertexプレーンデータ
              return { vertexId: u.vertexId, newPosition: { x: oldPos.x, y: oldPos.y }};
          });
          await this._editFeatureUseCase.moveVertices(undoUpdates);
          // moveVertices がイベント発行と保存を行う
          break;
      case 'updateProperties': // プロパティ更新のUndo (古いプロパティに戻す)
        const oldPropsInstances = operation.oldProperties.map(p => this._deserializeFromHistory(p)).filter(Boolean);
        const featureProps = await this._editFeatureUseCase.updateFeature(operation.featureId, { properties: oldPropsInstances });
        // updateFeature がイベント発行と保存を行う
        break;
      case 'addRing': // リング追加のUndo (リング削除)
         const ringToRemove = this._deserializeFromHistory(operation.addedRing); // リングプレーンデータを取得
         if (ringToRemove && ringToRemove.id) {
             // 1. UseCase経由でリングを削除
             const geometryUpdate = { removedRingIds: [ringToRemove.id] };
             const polygonRingUndo = await this._editFeatureUseCase.updateFeature(operation.polygonId, { geometry: geometryUpdate });
             // updateFeature がイベント発行と保存を行う

             // 2. 関連する頂点を削除 (他の地物で使われていなければ)
             if (operation.addedVerticesData) {
                 const vertexIdsToRemove = operation.addedVerticesData.map(v => v.id);
                 // deleteVertices UseCase を呼び出す (内部で未使用かチェックされる)
                 await this._editFeatureUseCase.deleteVertices(vertexIdsToRemove);
                 // deleteVertices がイベント発行と保存を行う
             }
         } else {
             console.error("Undo addRing: Failed to get ring ID to remove from history.");
         }
        break;
      default:
        console.warn(`未対応の操作タイプ (Undo): ${operation.type}`);
    }
  }


  /**
   * ID配列から頂点オブジェクトの配列を取得 (アンドゥ/リドゥ用)
   * @param {string[]} vertexIds - 頂点IDの配列
   * @returns {Promise<Array<Object>>} 頂点オブジェクトのプレーンコピー配列
   * @private
   */
  async _getVerticesByIds(vertexIds) {
    if (!vertexIds || vertexIds.length === 0) {
        console.log("[_getVerticesByIds] Received empty or null vertexIds, returning empty array.");
        return [];
    }
    try {
        const worldRepository = this._editFeatureUseCase._worldRepository;
        console.log("[_getVerticesByIds] Calling worldRepository.getWorld() for vertexIds:", JSON.parse(JSON.stringify(vertexIds)));
        const world = await worldRepository.getWorld();
        if (!world || !world.vertices) {
            console.warn("[_getVerticesByIds] World or world.vertices is null/undefined. Current world.vertices:", world ? world.vertices : 'world_is_null');
            return [];
        }
        console.log(`[_getVerticesByIds] world.vertices (length ${world.vertices.length}) from repository:`, JSON.parse(JSON.stringify(world.vertices.slice(0, 5))) , `... (first 5 shown if many)`);

        const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
        const foundVertices = vertexIds.map(id => {
            const foundVertex = verticesMap.get(id);
            if (!foundVertex) {
                console.warn(`[_getVerticesByIds] Vertex with ID ${id} not found in world.vertices map.`);
            }
            return foundVertex;
        }).filter(Boolean);

        console.log(`[_getVerticesByIds] Found ${foundVertices.length} vertex objects from world.vertices for ${vertexIds.length} IDs.`);

        return foundVertices.map(v => {
            const serializedVertex = this._serializeForHistory(new Vertex(v.id, v.x, v.y));
            if (!serializedVertex) {
                console.error(`[_getVerticesByIds] Serialization failed for vertex:`, v);
            }
            return serializedVertex;
        }).filter(Boolean);
    } catch (error) {
        console.error("[_getVerticesByIds] Error fetching vertices by IDs:", error);
        return [];
    }
  }

  /**
   * 特定の地物が参照する全ての頂点データを取得するヘルパー
   * @param {Feature} feature - 地物インスタンス
   * @returns {Promise<Array<Object>>} 頂点オブジェクトのプレーンコピー配列
   * @private
   */
  async _getVerticesDataForFeature(feature) {
    if (!feature) return [];
    const vertexIds = new Set();
    if (feature instanceof DomainPolygon) {
        feature.rings?.forEach(ring => ring.vertexIds.forEach(id => vertexIds.add(id)));
    } else if (feature.vertexIds) {
        feature.vertexIds.forEach(id => vertexIds.add(id));
    }
    return await this._getVerticesByIds(Array.from(vertexIds));
  }


  /**
   * アンドゥ可能かどうかを取得
   * @returns {boolean} アンドゥ可能ならtrue
   */
  canUndo() {
    return this._undoStack.length > 0;
  }

  /**
   * リドゥ可能かどうかを取得
   * @returns {boolean} リドゥ可能ならtrue
   */
  canRedo() {
    return this._redoStack.length > 0;
  }

  /**
   * 観測者を登録
   * @param {Function} observer - コールバック関数 (type, data) => void
   */
  addObserver(observer) {
    if (!this._observers.includes(observer)) { this._observers.push(observer); }
  }

  /**
   * 観測者を削除
   * @param {Function} observer - 削除する観測者
   */
  removeObserver(observer) {
    const index = this._observers.indexOf(observer);
    if (index !== -1) { this._observers.splice(index, 1); }
  }

  /**
   * 観測者に通知
   * @param {string} type - 変更タイプ
   * @private
   */
  _notifyObservers(type) {
    const data = this._getStateForType(type);
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

  /**
   * 配列Bにあって配列Aにない要素を見つけるヘルパー
   * @param {Array} arrayA - 元の配列
   * @param {Array} arrayB - 新しい配列
   * @returns {Array} 追加された要素の配列
   * @private
   */
  _findAddedIds(arrayA, arrayB) {
      const setA = new Set(arrayA);
      return arrayB.filter(item => !setA.has(item));
  }
}