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
    } else if (object._constructorName === 'Ring') { // Ringオブジェクトもシリアライズ対象に
        return {
            _constructorName: 'Ring',
            id: object.id,
            vertexIds: Array.isArray(object.vertexIds) ? [...object.vertexIds] : [],
            isOuter: object.isOuter,
            parentId: object.parentId
        };
    }
     else {
        console.warn("Unsupported object type for history serialization:", object);
        try { return JSON.parse(JSON.stringify(object)); } catch { return null; }
    }
  }

 /**
 * 履歴から読み込んだプレーンオブジェクトを対応するドメインインスタンスにデシリアライズ
 * @param {Object | null} data - シリアライズされたプレーンオブジェクト
 * @returns {Object | null} デシリアライズされたドメインインスタンス、または null
 * @private
 */
_deserializeFromHistory(data) {
    if (!data || !data._constructorName) return null;

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
                return new Point(
                    data.id,
                    data.vertexIds || [],
                    (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(Boolean),
                    data.layerId
                );
            case 'Line':
                return new DomainLine(
                    data.id,
                    data.vertexIds || [],
                    (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(Boolean),
                    data.layerId
                );
            case 'Polygon':
                const rings = (data.rings || []).map(ringData => ({
                    id: ringData.id,
                    vertexIds: ringData.vertexIds || [],
                    isOuter: ringData.isOuter,
                    parentId: ringData.parentId
                }));
                return new DomainPolygon(
                    data.id,
                    (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(Boolean),
                    data.layerId,
                    data.parentId || "0",
                    data.childIds || [],
                    rings
                );
            case 'Ring': // Ringオブジェクトのデシリアライズ (プレーンオブジェクトとして返す)
                 return {
                     // _constructorName は不要
                     id: data.id,
                     vertexIds: data.vertexIds || [],
                     isOuter: data.isOuter,
                     parentId: data.parentId
                 };
            default:
                console.warn(`Unsupported constructor name for history deserialization: ${constructorName}`);
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
    // (このメソッドはステップ2.2でリングベースPolygon生成に対応済みのため変更なし)
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
      switch (this._tool) {
        case 'point':
          if (this._addingPoints.length !== 1) throw new Error('点情報は1つの点のみを持つ必要があります');
          feature = await this._editFeatureUseCase.addFeature('point', properties, geometryData, layerId);
          break;
        case 'line':
          if (this._addingPoints.length < 2) throw new Error('線情報は少なくとも2つの点が必要です');
           feature = await this._editFeatureUseCase.addFeature('line', properties, geometryData, layerId);
          break;
        case 'polygon':
          if (this._addingPoints.length < 3) throw new Error('面情報は少なくとも3つの点が必要です');
           feature = await this._editFeatureUseCase.addFeature('polygon', properties, geometryData, layerId);
          break;
        default:
          throw new Error(`未対応のツールタイプ: ${this._tool}`);
      }
      const addedVerticesData = await this._getVerticesByIds(feature.vertexIds || feature.rings?.flatMap(r => r.vertexIds) || []);
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
      // 条件チェック
      if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'hole' || !this._targetPolygon || !this._targetRingIdForHole || this._addingPoints.length < 3) {
          console.error('穴の追加確定の条件を満たしていません。', { mode: this._mode, tool: this._tool, subMode: this._addingSubMode, target: !!this._targetPolygon, targetRingId: this._targetRingIdForHole, points: this._addingPoints.length });
          this._clearAddingState();
          this.setTool('select');
          return null;
      }

      const polygonId = this._targetPolygon.id;
      const holePoints = [...this._addingPoints]; // 穴の頂点座標 (座標の配列)
      const targetRingId = this._targetRingIdForHole; // 親となる外周リングのID

      // アンドゥ用に更新前の状態を保存
      const polygonBeforeUpdatePlain = this._serializeForHistory(this._targetPolygon);

      try {
          // UpdateFeatureUseCase に渡す形式を構築
          // UseCase側で座標から頂点IDを生成し、リングを追加することを期待
          const geometryUpdate = {
              // 新しいキー: UseCase側でこれを解釈して PolygonEditService.addRingToPolygon を呼ぶ想定
              newRingCoordinates: [{
                  points: holePoints, // 頂点座標の配列
                  isOuter: false,     // 穴なので false
                  parentId: targetRingId // 親リングIDを指定
              }]
              // 古い形式は削除
              // newRings: [...] // これはID生成済みを渡す場合に使う (アンドゥ/リドゥなど)
          };

          // UseCaseを呼び出してポリゴンを更新
          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );

          // アンドゥ履歴に追加 (UseCaseの結果から追加された情報を取得)
          // UseCaseが追加されたリング情報や頂点情報を返すように修正が必要
          // 暫定的に、更新前後の差分から追加されたリングと頂点を推測する（不安定）
          const polygonAfterUpdatePlain = this._serializeForHistory(updatedPolygon);
          const addedRing = polygonAfterUpdatePlain.rings.find(r =>
              !polygonBeforeUpdatePlain.rings.some(br => br.id === r.id)
          );
          let addedVerticesData = [];
          if (addedRing) {
             addedVerticesData = await this._getVerticesByIds(addedRing.vertexIds);
          } else {
             console.warn("Could not identify the added ring for undo history.");
          }

          this._addToHistory({
              type: 'addRing',
              polygonId,
              // addedRing はプレーンオブジェクトで保存
              addedRing: addedRing ? this._serializeForHistory({ _constructorName: 'Ring', ...addedRing }) : null,
              addedVerticesData: addedVerticesData
          });

          // イベント発行と状態クリア
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
      // 条件チェック
      if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'enclave' || !this._targetPolygon || this._addingPoints.length < 3) {
          console.error('飛び地の追加確定の条件を満たしていません。', { mode: this._mode, tool: this._tool, subMode: this._addingSubMode, target: !!this._targetPolygon, points: this._addingPoints.length });
          this._clearAddingState();
          this.setTool('select');
          return null;
      }

      const polygonId = this._targetPolygon.id;
      const enclavePoints = [...this._addingPoints]; // 飛び地の頂点座標

      // アンドゥ用に更新前の状態を保存
      const polygonBeforeUpdatePlain = this._serializeForHistory(this._targetPolygon);

      try {
          // UpdateFeatureUseCase に渡す形式を構築
          const geometryUpdate = {
              newRingCoordinates: [{
                  points: enclavePoints, // 頂点座標の配列
                  isOuter: true,       // 飛び地の外周なので true
                  parentId: null       // 最上位のリングなので null
              }]
          };

          // UseCaseを呼び出してポリゴンを更新
          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );

          // アンドゥ履歴に追加 (UseCaseの結果から追加された情報を取得)
          const polygonAfterUpdatePlain = this._serializeForHistory(updatedPolygon);
          const addedRing = polygonAfterUpdatePlain.rings.find(r =>
              !polygonBeforeUpdatePlain.rings.some(br => br.id === r.id)
          );
          let addedVerticesData = [];
          if (addedRing) {
             addedVerticesData = await this._getVerticesByIds(addedRing.vertexIds);
          } else {
             console.warn("Could not identify the added ring (enclave) for undo history.");
          }

          this._addToHistory({
              type: 'addRing', // 穴追加と同じタイプ
              polygonId: polygonId,
              addedRing: addedRing ? this._serializeForHistory({ _constructorName: 'Ring', ...addedRing }) : null,
              addedVerticesData: addedVerticesData,
          });

          // 状態クリアとイベント発行
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
              await this._editFeatureUseCase.moveVertices(vertexUpdates);
               const historyData = { type: 'moveVertices', updates: [] };
               for (const [vertexId, info] of dragInfoCopy.entries()) {
                   const originalVertex = new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y);
                   const currentVertex = new Vertex(vertexId, info.currentPosition.x, info.currentPosition.y);
                   historyData.updates.push({
                       vertexId: vertexId,
                       oldPosition: this._serializeForHistory(originalVertex),
                       newPosition: this._serializeForHistory(currentVertex)
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
       const verticesToRestoreData = await this._getVerticesDataForFeature(feature);
       await this._editFeatureUseCase.deleteFeature(featureId);
       this._addToHistory({
         type: 'delete',
         featureId,
         featureData: this._serializeForHistory(feature),
         verticesToRestoreData: verticesToRestoreData
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
        const allAffectedVertexIds = new Set();
        if (world && world.features) {
            world.features.forEach(f => {
                 const featureUsesVertex = vertexIds.some(vid =>
                    (f instanceof DomainPolygon)
                        ? f.rings?.some(ring => ring.vertexIds.includes(vid))
                        : f.vertexIds?.includes(vid)
                 );
                 if (featureUsesVertex) {
                     affectedFeaturesBeforePlain[f.id] = this._serializeForHistory(f);
                     if (f instanceof DomainPolygon) {
                         f.rings?.forEach(ring => ring.vertexIds.forEach(id => allAffectedVertexIds.add(id)));
                     } else if (f.vertexIds) {
                         f.vertexIds.forEach(id => allAffectedVertexIds.add(id));
                     }
                 }
            });
        }
        const verticesToRestoreData = await this._getVerticesByIds(Array.from(allAffectedVertexIds));
        const result = await this._editFeatureUseCase.deleteVertices(vertexIds);
        this._addToHistory({
            type: 'deleteVertices',
            deletedVertexIds: vertexIds,
            verticesToRestoreData: verticesToRestoreData,
            affectedFeaturesBefore: affectedFeaturesBeforePlain,
            deletedFeatureIds: result?.deletedFeatureIds || []
        });
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
      const oldPropertiesPlain = featureBefore.properties.map(p => this._serializeForHistory(p)).filter(Boolean);
      const feature = await this._editFeatureUseCase.updateFeature(featureId, { properties: newProperties });
      const newPropertiesPlain = newProperties.map(p => this._serializeForHistory(p)).filter(Boolean);
      this._addToHistory({ type: 'updateProperties', featureId, oldProperties: oldPropertiesPlain, newProperties: newPropertiesPlain });
      this._eventBus.publish('FeatureUpdated', { feature });
      return feature;
    } catch (error) {
      console.error('地物プロパティの更新に失敗しました (EditingViewModel)', error);
      throw error;
    }
  }

  /**
   * アンドゥ/リドゥからリングを追加するための内部ヘルパー (直接呼び出し非推奨)
   * @param {string} polygonId
   * @param {object} ringData - リングのプレーンデータ
   * @returns {Promise<Polygon>}
   * @deprecated Use _executeOperation/ReverseOperation instead.
   */
  /*
  async addRingToPolygon(polygonId, ringData) {
      // このメソッドは _executeOperation から呼ばれる想定だったが、UseCase経由に修正
      console.warn("addRingToPolygon is deprecated for direct use.");
      // UseCase呼び出しロジックをここに書くのは責務違反
      // _executeOperation 内で UpdateFeatureUseCase を呼び出すように修正済み
      return null;
  }
  */


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
    let worldChanged = false;

    switch (operation.type) {
      case 'add':
        if (operation.addedVerticesData) {
            operation.addedVerticesData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                    worldChanged = true;
                }
            });
        }
        if (worldChanged) await worldRepo.saveWorld(world);
        if (operation.featureData) {
            const featureInstance = this._deserializeFromHistory(operation.featureData);
            if (featureInstance) {
                 world = await worldRepo.getWorld();
                 if (!world.features.some(f => f.id === featureInstance.id)) {
                     world.features.push(featureInstance);
                     await worldRepo.saveWorld(world);
                     this._eventBus.publish('FeatureAdded', { feature: featureInstance });
                 }
            }
        }
        break;
      case 'delete':
         await this._editFeatureUseCase.deleteFeature(operation.featureId);
         break;
      case 'deleteVertices':
          await this._editFeatureUseCase.deleteVertices(operation.deletedVertexIds);
          break;
      case 'moveVertices':
        const redoUpdates = operation.updates.map(u => ({
            vertexId: u.vertexId,
            newPosition: { x: u.newPosition.x, y: u.newPosition.y }
        }));
        await this._editFeatureUseCase.moveVertices(redoUpdates);
        redoUpdates.forEach(update => { this._eventBus.publish('VertexMoved', { vertexId: update.vertexId, newPosition: update.newPosition }); });
        break;
      case 'updateProperties':
        const newPropsInstances = operation.newProperties.map(p => this._deserializeFromHistory(p)).filter(Boolean);
        const featureProps = await this._editFeatureUseCase.updateFeature(operation.featureId, { properties: newPropsInstances });
        this._eventBus.publish('FeatureUpdated', { feature: featureProps });
        break;
      case 'addRing':
         // 1. 頂点復元
         let verticesAddedRing = false;
         if (operation.addedVerticesData) {
             operation.addedVerticesData.forEach(vDataPlain => {
                 const vData = this._deserializeFromHistory(vDataPlain);
                 if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                     world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                     verticesAddedRing = true;
                 }
             });
         }
         if (verticesAddedRing) { await worldRepo.saveWorld(world); }
         // 2. リング追加 (UseCase経由)
         // 履歴からリングデータ(プレーン)を取得し、UseCaseが期待する形式で渡す
         const ringToAdd = this._deserializeFromHistory(operation.addedRing);
         if (ringToAdd) {
             const geometryUpdate = {
                 newRings: [ // UseCaseはID付きのリングデータを期待する
                     {
                         vertexIds: ringToAdd.vertexIds,
                         isOuter: ringToAdd.isOuter,
                         parentId: ringToAdd.parentId,
                         // ID は UseCase/Service 内で生成されるので不要？ -> 要確認
                         // id: ringToAdd.id // IDも渡すか？ PolygonEditService.addRingToPolygon はID生成する...
                         // -> addRingToPolygon は ID 生成、UseCaseはそれを呼ぶ。
                         // -> Redo の場合は ID 生成済みなので、UseCaseに直接ID付きデータを渡す？
                         // -> UpdateFeatureUseCase は PolygonEditService.addRingToPolygon を呼ぶ想定。
                         //    しかし、履歴データにはIDが含まれている。どう整合性を取るか？
                         //    暫定案: UseCaseに渡す geometryUpdate に、ID生成済みであることを示すフラグを追加するか、
                         //           あるいは、ID付きのリングデータを渡せる別の口を用意する。
                         //           ここでは、既存の newRings (IDなし期待) とは別に、
                         //           `redoRings: [...]` のようなキーで渡すことを仮定。
                         //           -> UpdateFeatureUseCase の修正が必要。
                         //
                         //           より簡単な方法: Redo時だけ PolygonEditService を直接呼ぶ？ -> 責務違反
                         //           さらに簡単な方法: Redo 時は現状の UpdateFeatureUseCase 経由では実装できないとし、
                         //                           一旦 Redo 機能を無効化するか、警告を出す。
                         //                           -> 今回は警告を出す方針で進め、UseCase修正時に対応。
                         //                           -> いや、UseCaseにID付きリングを受け取れる口を作るのが本筋。
                         //                              今回は geometryUpdate に `existingRingData` キーを追加して渡す。
                         //                              UpdateFeatureUseCase側でこのキーを見て処理を分岐させる。
                         existingRingData: [ringToAdd] // 既存IDを持つリングデータ
                     }
                 ]
             };
             const updatedPolygonRing = await this._editFeatureUseCase.updateFeature(operation.polygonId, { geometry: geometryUpdate });
             this._eventBus.publish('FeatureUpdated', { feature: updatedPolygonRing });
         } else {
             console.error("Redo addRing: Failed to deserialize ring data from history.");
         }
        break;
      default:
        console.warn(`未対応の操作タイプ (Redo): ${operation.type}`);
    }
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
      case 'add':
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        break;
      case 'delete':
        if (operation.verticesToRestoreData) {
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                    worldChanged = true;
                }
            });
        }
         if (worldChanged) await worldRepo.saveWorld(world);
        if (operation.featureData) {
            const featureInstance = this._deserializeFromHistory(operation.featureData);
            if (featureInstance) {
                 world = await worldRepo.getWorld();
                 if (!world.features.some(f => f.id === featureInstance.id)) {
                     world.features.push(featureInstance);
                     await worldRepo.saveWorld(world);
                     this._eventBus.publish('FeatureAdded', { feature: featureInstance });
                 }
            }
        }
        break;
      case 'deleteVertices':
        if (operation.verticesToRestoreData) {
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                    worldChanged = true;
                }
            });
        }
        if (worldChanged) {
            await worldRepo.saveWorld(world);
            world = await worldRepo.getWorld();
            worldChanged = false;
        }
        if (operation.affectedFeaturesBefore) {
            let featuresUpdated = false;
            Object.values(operation.affectedFeaturesBefore).forEach(featurePlain => {
                const featureInstance = this._deserializeFromHistory(featurePlain);
                if (!featureInstance) return;
                const index = world.features.findIndex(f => f.id === featureInstance.id);
                const wasDeleted = operation.deletedFeatureIds?.includes(featureInstance.id);
                if (index !== -1) {
                    const currentFeature = world.features[index];
                    let areEqual = false;
                    if(typeof currentFeature.equals === 'function') { areEqual = currentFeature.equals(featureInstance); }
                    if (!areEqual) {
                        world.features[index] = featureInstance;
                        featuresUpdated = true;
                        this._eventBus.publish('FeatureUpdated', { feature: featureInstance });
                    }
                } else if (wasDeleted) {
                    world.features.push(featureInstance);
                    featuresUpdated = true;
                    this._eventBus.publish('FeatureAdded', { feature: featureInstance });
                } else {
                    console.warn(`Undo deleteVertices: Feature ${featureInstance.id} not found but was not marked as deleted.`);
                }
            });
            if (featuresUpdated) { await worldRepo.saveWorld(world); worldChanged = true; }
        }
        break;
      case 'moveVertices':
          const undoUpdates = operation.updates.map(u => ({
              vertexId: u.vertexId,
              newPosition: { x: u.oldPosition.x, y: u.oldPosition.y }
          }));
          await this._editFeatureUseCase.moveVertices(undoUpdates);
          undoUpdates.forEach(update => { this._eventBus.publish('VertexMoved', { vertexId: update.vertexId, newPosition: update.newPosition }); });
          break;
      case 'updateProperties':
        const oldPropsInstances = operation.oldProperties.map(p => this._deserializeFromHistory(p)).filter(Boolean);
        const featureProps = await this._editFeatureUseCase.updateFeature(operation.featureId, { properties: oldPropsInstances });
        this._eventBus.publish('FeatureUpdated', { feature: featureProps });
        break;
      case 'addRing':
         // 1. リング削除 (UseCase経由)
         const ringToRemove = this._deserializeFromHistory(operation.addedRing);
         if (ringToRemove && ringToRemove.id) {
             const geometryUpdate = {
                 removedRingIds: [ringToRemove.id] // 削除するリングIDを渡す
             };
             const polygonRingUndo = await this._editFeatureUseCase.updateFeature(operation.polygonId, { geometry: geometryUpdate });
             this._eventBus.publish('FeatureUpdated', { feature: polygonRingUndo });
         } else {
             console.error("Undo addRing: Failed to get ring ID to remove from history.");
             break; // エラー処理
         }
         // 2. 頂点削除 (他の地物で使われていなければ)
         if (operation.addedVerticesData) {
             const vertexIdsToRemove = operation.addedVerticesData.map(v => v.id);
             world = await worldRepo.getWorld(); // 最新のWorldを取得
             const existingVertexIdsToRemove = vertexIdsToRemove.filter(id => world.vertices.some(v => v.id === id));
             if (existingVertexIdsToRemove.length > 0) {
                 // deleteVertices UseCase を呼び出す
                 await this._editFeatureUseCase.deleteVertices(existingVertexIdsToRemove);
                 // deleteVertices がイベント発行と保存を行う
             }
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
    if (!vertexIds || vertexIds.length === 0) return [];
    try {
        const worldRepository = this._editFeatureUseCase._worldRepository;
        const world = await worldRepository.getWorld();
        if (!world || !world.vertices) return [];
        const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
        return vertexIds
            .map(id => verticesMap.get(id))
            .filter(Boolean)
            .map(v => this._serializeForHistory(new Vertex(v.id, v.x, v.y)));
    } catch (error) {
        console.error("Error fetching vertices by IDs:", error);
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
      case 'targetRingIdForHole': return this._targetRingIdForHole; // 修正
      case 'temporaryElements': return this._temporaryElements;
      case 'draggingVertices': return this._draggingVerticesInfo;
      case 'history': return { canUndo: this.canUndo(), canRedo: this.canRedo() };
      case 'addingState':
        return {
          addingPoints: this._addingPoints,
          targetPolygon: this._targetPolygon,
          addingSubMode: this._addingSubMode,
          targetRingIdForHole: this._targetRingIdForHole // 修正
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