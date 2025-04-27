
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
    this._targetPolygonIdForHole = null; // 穴/飛び地追加対象のポリゴンID (互換性のため残すが、_targetPolygon を優先)
    this._targetPolygon = null; // 穴/飛び地追加対象のポリゴンインスタンス
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
      // month, day が undefined または null の場合は null として渡す
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
           return null; // timePoint は必須
      }

      // 基本属性と timeRange, それ以外の属性 (attributes) を分離
      const { timePoint: tpData, timeRange, name, description, ...attributes } = data;

      let startTime = null;
      let endTime = null;
      if (timeRange) {
          startTime = this._deserializeTimePoint(timeRange.start);
          endTime = this._deserializeTimePoint(timeRange.end);
      }

      // name や description が undefined の場合はデフォルト値('')を渡す
      const propName = name !== undefined ? name : '';
      const propDesc = description !== undefined ? description : '';

      return new Property(
          timePoint,
          propName,
          propDesc,
          attributes || {}, // attributes が undefined でも空オブジェクトを渡す
          startTime,
          endTime
      );
  }

  // --- History 用 シリアライズ/デシリアライズ ヘルパー ---

  /**
   * ドメインオブジェクトを履歴保存用のプレーンオブジェクトにシリアライズ
   * @param {Object} object - ドメインオブジェクト (Vertex, Feature, Property, TimePoint)
   * @returns {Object | null} シリアライズされたプレーンオブジェクト、または null
   * @private
   */
   _serializeForHistory(object) {
    if (!object) return null;

    const serializeTimePoint = (tp) => tp ? { year: tp.year, month: tp.month, day: tp.day } : null;
    const serializeProperty = (prop) => {
        if (!prop || !(prop instanceof Property)) return null;
        const attributes = prop.getAttributes ? prop.getAttributes() : {};
        return {
            _constructorName: 'Property',
            timePoint: serializeTimePoint(prop.timePoint),
            name: prop.name,
            description: prop.description,
            attributes: attributes,
            timeRange: {
                start: serializeTimePoint(prop.startTime),
                end: serializeTimePoint(prop.endTime),
            }
        };
    };

    if (object instanceof Vertex) {
        return { _constructorName: 'Vertex', id: object.id, x: object.x, y: object.y };
    } else if (object instanceof Point || object instanceof DomainLine || object instanceof DomainPolygon) {
        const baseData = {
            _constructorName: object.constructor.name,
            id: object.id,
            vertexIds: Array.isArray(object.vertexIds) ? [...object.vertexIds] : null, // Nullable for Polygon
            properties: Array.isArray(object.properties) ? object.properties.map(serializeProperty).filter(Boolean) : [],
            layerId: object.layerId
        };
        if (object instanceof DomainPolygon) {
            baseData.holesVertexIds = Array.isArray(object.holesVertexIds) ? object.holesVertexIds.map(hole => [...hole]) : [];
            baseData.parentId = object.parentId;
            baseData.childIds = Array.isArray(object.childIds) ? [...object.childIds] : [];
            baseData.isMultiPolygon = object.isMultiPolygon;
            baseData.subPolygons = Array.isArray(object.subPolygons) ? object.subPolygons.map(sub => ({
                vertexIds: Array.isArray(sub.vertexIds) ? [...sub.vertexIds] : [],
                holesVertexIds: Array.isArray(sub.holesVertexIds) ? sub.holesVertexIds.map(hole => [...hole]) : []
            })) : [];
        }
        return baseData;
    } else if (object instanceof Property) {
        return serializeProperty(object);
    } else if (object instanceof TimePoint) {
        return { _constructorName: 'TimePoint', ...serializeTimePoint(object) };
    } else {
        console.warn("Unsupported object type for history serialization:", object);
        // 安全策としてJSONシリアライズを試みる（ただし推奨されない）
        try {
             return JSON.parse(JSON.stringify(object));
        } catch {
             return null;
        }
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
                return this._deserializeTimePoint(data); // 既存のヘルパーを使用
            case 'Property':
                // Property のデシリアライズには既存のヘルパーを使用
                // ただし、attributes がネストされている場合に対応が必要な可能性あり
                const attributes = { ...data.attributes }; // Shallow copy
                const propData = { ...data, attributes: attributes }; // Pass copied attributes
                return this._deserializeProperty(propData); // Use existing robust deserializer
            case 'Point':
                return new Point(
                    data.id,
                    data.vertexIds || [], // Point should always have 1 vertexId
                    (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(Boolean),
                    data.layerId
                );
            case 'Line':
                return new DomainLine( // Use alias
                    data.id,
                    data.vertexIds || [],
                    (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(Boolean),
                    data.layerId
                );
            case 'Polygon':
                const subPolygons = (data.subPolygons || []).map(sub => ({
                     vertexIds: sub.vertexIds || [],
                     holesVertexIds: sub.holesVertexIds || []
                }));
                return new DomainPolygon( // Use alias
                    data.id,
                    data.vertexIds, // Can be null
                    (data.properties || []).map(pData => this._deserializeFromHistory(pData)).filter(Boolean),
                    data.layerId,
                    data.holesVertexIds || [],
                    data.parentId || "0",
                    data.childIds || [],
                    data.isMultiPolygon || false,
                    subPolygons
                );
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
      // 追加/穴/飛び地追加作業中のデータをクリア
      if (this._addingPoints.length > 0 || this._addingSubMode) {
        this._clearAddingState();
      }
      // ドラッグ中の場合、ドラッグをキャンセル
      if (this._draggingVerticesInfo.size > 0) {
         this._resetDraggingState();
      }
      // 編集モード終了時に一時要素クリア
      if (mode !== 'edit') {
        this.clearTemporaryElements();
      }

      this._mode = mode;
      this._tool = null; // モード変更時はツールもリセット

      this._notifyObservers('mode');
    }
  }

  /**
   * 編集ツールを設定
   * @param {string} tool - ツール ('point', 'line', 'polygon', 'select', 'add-hole', ...)
   */
  setTool(tool) {
    if (this._tool !== tool) {
      // 追加/穴/飛び地追加作業中のデータをクリア
      if (this._addingPoints.length > 0 || this._addingSubMode) {
        this._clearAddingState();
      }
      // ドラッグ中の場合、ドラッグをキャンセル
      if (this._draggingVerticesInfo.size > 0) {
         this._resetDraggingState();
      }
       // ツール変更時に一時要素クリア
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
          this._targetPolygonIdForHole = polygonInstance.id; // 互換性のためIDも設定
          this._targetPolygon = polygonInstance; // インスタンスを保持
          this._addingSubMode = null; // サブモードはクリックで決定
          this._clearAddingPoints(); // 既存の点をクリア
          this._notifyObservers('addingHoleTarget'); // targetPolygonも通知すべきだがキーがない
          this._notifyObservers('addingSubMode');
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
   * 点を追加（地物追加または穴/飛び地追加モード用）
   * @param {Object} point - 追加する点 { x, y }
   */
  addPoint(point) {
    // 'add' モード または ('edit' モード & 'add-hole' ツール & サブモード設定済み) の場合に追加
    const isAddingFeature = this._mode === 'add' && this._tool;
    const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole' && this._addingSubMode;

    if (isAddingFeature || isAddingHoleOrEnclave) {
        // ドラッグ中は追加しない（誤操作防止）
        if (this._draggingVerticesInfo.size > 0) return;
        this._addingPoints.push(point);
        this._notifyObservers('addingPoints');
    } else {
        console.warn("Cannot add point in current mode/tool/subMode:", this._mode, this._tool, this._addingSubMode);
    }
  }

  /**
   * 最後の点を削除（地物追加または穴/飛び地追加モード用）
   */
  removeLastPoint() {
    const isAddingFeature = this._mode === 'add' && this._tool;
    const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole'; // サブモードは不問

    if ((isAddingFeature || isAddingHoleOrEnclave) && this._addingPoints.length > 0) {
      this._addingPoints.pop();
      // 点がなくなったらサブモードもリセット
      if (this._addingPoints.length === 0 && this._addingSubMode) {
          this.setAddingSubMode(null);
      }
      this._notifyObservers('addingPoints');
    }
  }

  /**
   * 追加中の状態をクリア (点、ターゲット、サブモード)
   * @private
   */
  _clearAddingState() {
    let changed = false;
    if (this._addingPoints.length > 0) {
        this._addingPoints = [];
        changed = true;
    }
    if (this._targetPolygonIdForHole !== null) {
        this._targetPolygonIdForHole = null;
        this._targetPolygon = null;
        changed = true;
    }
    if (this._addingSubMode !== null) {
        this._addingSubMode = null;
        changed = true;
    }
    if (changed) {
        this._notifyObservers('addingPoints'); // 複数状態をまとめて通知
    }
  }


  /**
   * 追加中の点をクリア (内部用ヘルパー、基本は _clearAddingState を使う)
   * @private
   */
  _clearAddingPoints() {
    this._addingPoints = [];
    this._notifyObservers('addingPoints');
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
      const geometryData = { vertices: this._addingPoints };

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
           // ポリゴン追加時は isMultiPolygon: false 固定
           const polygonGeometry = { ...geometryData, holesVertexIds: [], parentId: "0", isMultiPolygon: false, subPolygons: [] };
           feature = await this._editFeatureUseCase.addFeature('polygon', properties, polygonGeometry, layerId);
          break;
        default:
          throw new Error(`未対応のツールタイプ: ${this._tool}`);
      }

      // 操作履歴に追加 (プレーンオブジェクトを保存)
      const addedVerticesData = await this._getVerticesByIds(feature.vertexIds); // worldから取得
      this._addToHistory({
        type: 'add',
        featureId: feature.id,
        featureType: this._tool,
        featureData: this._serializeForHistory(feature), // プレーンオブジェクトで保存
        addedVerticesData: addedVerticesData // プレーンオブジェクト配列
      });

      this._clearAddingState();
      this._eventBus.publish('FeatureAdded', { feature }); // イベントにはインスタンスを渡す

      return feature; // インスタンスを返す
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
      if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'hole' || !this._targetPolygon || this._addingPoints.length < 3) {
          console.error('穴の追加確定の条件を満たしていません。', { mode: this._mode, tool: this._tool, subMode: this._addingSubMode, target: !!this._targetPolygon, points: this._addingPoints.length });
          this._clearAddingState(); // 状態をクリア
          // ツールは add-hole のままにするか、select に戻すか検討 -> selectに戻す
          this.setTool('select');
          return null;
      }

      const polygonId = this._targetPolygon.id;
      const holePoints = [...this._addingPoints]; // コピーを作成

      try {
          // addHoleToPolygon は内部メソッドだが、ここで直接UseCaseを呼ぶのではなく、
          // 状態管理の一環として addHoleToPolygon を呼ぶ形は維持する
          const updatedPolygon = await this.addHoleToPolygon(polygonId, holePoints);
          // addHoleToPolygon 内で状態クリアと履歴追加が行われる
          this.setTool('select'); // 成功したらツールをデフォルトに戻す
          return updatedPolygon;
      } catch (error) {
          console.error('穴の追加確定に失敗しました', error);
          alert(`穴の追加に失敗しました: ${error.message}`);
          this._clearAddingState(); // エラー時も状態をクリア
          this.setTool('select'); // ツールをデフォルトに戻す
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
      const enclavePoints = [...this._addingPoints]; // コピーを作成

      try {
          // 1. UseCaseに渡すための情報を準備
          const geometryUpdate = { newSubPolygonVertices: enclavePoints };

          // 2. UseCaseを呼び出してポリゴンを更新
          // updateFeature は新しい頂点IDの生成とポリゴンデータへの追加を行う
          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );

          // 3. 操作履歴に追加
          // UseCaseから返された更新後のポリゴンデータから、追加された飛び地の情報を取得する必要がある
          const addedSubPolygonIndex = updatedPolygon.subPolygons.length - 1; // 最後に追加されたと仮定
          const addedSubPolygonData = updatedPolygon.subPolygons[addedSubPolygonIndex];
          const addedVerticesData = await this._getVerticesByIds(addedSubPolygonData.vertexIds);

          this._addToHistory({
              type: 'addEnclave',
              polygonId: polygonId,
              addedSubPolygon: this._serializeForHistory({ ...addedSubPolygonData, _constructorName: 'SubPolygon'}), // 仮のクラス名
              addedVerticesData: addedVerticesData,
              oldIsMultiPolygon: this._targetPolygon.isMultiPolygon, // 元がMultiPolygonだったか
              oldSubPolygons: this._targetPolygon.subPolygons.map(sub => this._serializeForHistory({ ...sub, _constructorName: 'SubPolygon'})) // 元の飛び地
          });

          // 4. 状態クリアとイベント発行
          this._clearAddingState();
          this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
          this.setTool('select'); // ツールをデフォルトに戻す

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
      if (!vertices || vertices.size === 0) {
          console.error("Invalid arguments for startVerticesDrag");
          return;
      }
      // 既にドラッグ中なら何もしない（またはエラー）
      if (this._draggingVerticesInfo.size > 0) {
          console.warn("Already dragging vertices:", Array.from(this._draggingVerticesInfo.keys()));
          return;
      }

      this._draggingVerticesInfo.clear();
      for (const [vertexId, position] of vertices.entries()) {
          this._draggingVerticesInfo.set(vertexId, {
              originalPosition: { ...position },
              currentPosition: { ...position } // 初期位置は同じ
          });
      }
      // console.log("Vertices drag started:", this._draggingVerticesInfo);
      this._notifyObservers('draggingVertices');
  }

  /**
   * 頂点ドラッグ中の位置更新
   * @param {number} deltaX - X方向の移動差分 (ワールド座標)
   * @param {number} deltaY - Y方向の移動差分 (ワールド座標)
   */
  updateVerticesDrag(deltaX, deltaY) {
      if (this._draggingVerticesInfo.size === 0) {
          // console.warn("updateVerticesDrag called but not dragging.");
          return;
      }

      let positionChanged = false;
      for (const info of this._draggingVerticesInfo.values()) {
          const newX = info.originalPosition.x + deltaX;
          const newY = info.originalPosition.y + deltaY;
          // パフォーマンスのため、位置が変わった場合のみ更新
          if (info.currentPosition.x !== newX || info.currentPosition.y !== newY) {
              info.currentPosition = { x: newX, y: newY };
              positionChanged = true;
          }
      }

      if (positionChanged) {
           // console.log("Vertices drag updated:", this._draggingVerticesInfo);
           this._notifyObservers('draggingVertices'); // 高頻度で通知される
      }
  }

  /**
   * 頂点ドラッグの終了
   * @returns {Promise<void>}
   */
  async endVerticesDrag() {
      if (this._draggingVerticesInfo.size === 0) {
          // console.warn("endVerticesDrag called but not dragging.");
          return;
      }

      const dragInfoCopy = new Map(this._draggingVerticesInfo); // コピーを作成
      this._resetDraggingState(); // 先に状態をリセット（再描画のため）

      const vertexUpdates = [];
      let significantMovement = false;
      const clickToleranceSq = 1e-6; // 仮の値

      for (const [vertexId, info] of dragInfoCopy.entries()) {
          const dx = info.currentPosition.x - info.originalPosition.x;
          const dy = info.currentPosition.y - info.originalPosition.y;
          const distanceSq = dx * dx + dy * dy;

          if (distanceSq > clickToleranceSq) {
              significantMovement = true;
          }
          vertexUpdates.push({ vertexId, newPosition: info.currentPosition });
      }

      if (significantMovement) {
           console.log("Ending vertices drag and applying move:", vertexUpdates);
          try {
              // 確定処理: EditFeatureUseCaseを呼び出す
              await this._editFeatureUseCase.moveVertices(vertexUpdates);

               // 操作履歴に追加 (移動した場合のみ)
               const historyData = {
                   type: 'moveVertices',
                   updates: []
               };
               for (const [vertexId, info] of dragInfoCopy.entries()) {
                   historyData.updates.push({
                       vertexId: vertexId,
                       oldPosition: info.originalPosition,
                       newPosition: info.currentPosition
                   });
               }
               this._addToHistory(historyData);

              // MapViewModel で World データが更新されるイベントが飛ぶはず
              vertexUpdates.forEach(update => {
                 this._eventBus.publish('VertexMoved', { vertexId: update.vertexId, newPosition: update.newPosition });
              });

          } catch (error) {
              console.error('複数頂点の移動確定に失敗しました', error);
              // 必要であればエラー通知や状態のロールバック
              alert(`頂点の移動に失敗しました: ${error.message}`);
          }
      } else {
          // console.log("Vertices drag ended without significant movement.");
          // 移動がなければアンドゥ履歴には追加しない
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
          this._notifyObservers('draggingVertices'); // ドラッグ終了を通知
      }
  }


  /**
   * 地物を削除
   * @param {string} featureId - 削除する地物のID
   * @param {Object} feature - 削除前の地物データ（アンドゥ用、ドメインインスタンス）
   * @returns {Promise<void>}
   */
  async deleteFeature(featureId, feature) {
    if (!feature) {
        console.error("deleteFeature: Feature data is required for undo.");
        throw new Error("Missing feature data for deletion.");
    }
    try {
       const verticesToRestoreData = await this._getVerticesDataForFeature(feature); // 関連頂点データを取得

       await this._editFeatureUseCase.deleteFeature(featureId);

       // 操作履歴に追加 (プレーンオブジェクトで保存)
       this._addToHistory({
         type: 'delete',
         featureId,
         featureData: this._serializeForHistory(feature), // プレーンオブジェクトで保存
         verticesToRestoreData: verticesToRestoreData // 関連頂点データも保存
       });

      // イベントを発行
       this._eventBus.publish('FeatureDeleted', { featureId });
      // 選択解除もイベントで処理
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
    console.log('Deleting vertices in ViewModel:', vertexIds);

    try {
        const worldRepository = this._editFeatureUseCase._worldRepository;
        const world = await worldRepository.getWorld();

        // 1. 影響を受ける地物の操作前の状態 (プレーン) と、それらが参照する全頂点データ (プレーン) を取得
        const affectedFeaturesBeforePlain = {};
        const allAffectedVertexIds = new Set();
        if (world && world.features) {
            world.features.forEach(f => {
                 const featureUsesVertex = vertexIds.some(vid =>
                    (f.vertexIds && f.vertexIds.includes(vid)) ||
                    (f instanceof DomainPolygon && f.holesVertexIds?.some(hole => hole.includes(vid))) ||
                    (f instanceof DomainPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds?.includes(vid)))
                 );
                 if (featureUsesVertex) {
                     affectedFeaturesBeforePlain[f.id] = this._serializeForHistory(f);
                     // この地物が参照する全ての頂点IDを収集
                     if (f.vertexIds) f.vertexIds.forEach(id => allAffectedVertexIds.add(id));
                     if (f instanceof DomainPolygon) {
                         f.holesVertexIds?.flat().forEach(id => allAffectedVertexIds.add(id));
                         if(f.isMultiPolygon && f.subPolygons) {
                             f.subPolygons.forEach(sub => sub.vertexIds?.forEach(id => allAffectedVertexIds.add(id)));
                         }
                     }
                 }
            });
        }
        const verticesToRestoreData = await this._getVerticesByIds(Array.from(allAffectedVertexIds));

        // 2. UseCaseを呼び出して削除実行
        const result = await this._editFeatureUseCase.deleteVertices(vertexIds);

        // 3. アンドゥ履歴に追加
        this._addToHistory({
            type: 'deleteVertices',
            deletedVertexIds: vertexIds, // ユーザーが指示したID
            verticesToRestoreData: verticesToRestoreData, // 復元に必要な全頂点データ (プレーン)
            affectedFeaturesBefore: affectedFeaturesBeforePlain, // 影響を受けた地物の変更前データ (プレーン)
            deletedFeatureIds: result?.deletedFeatureIds || [] // 実際に削除された地物ID
        });

        // 4. イベント発行
        if (result?.deletedFeatureIds?.length > 0) {
             result.deletedFeatureIds.forEach(id => this._eventBus.publish('FeatureDeleted', { featureId: id }));
        }
        if (result?.updatedFeatureIds?.length > 0) {
             const updatedWorld = await worldRepository.getWorld();
             result.updatedFeatureIds.forEach(id => {
                 const updatedFeature = updatedWorld.features.find(f => f.id === id);
                 if (updatedFeature) {
                     this._eventBus.publish('FeatureUpdated', { feature: updatedFeature });
                 }
             });
        }
        // 頂点削除イベント
        this._eventBus.publish('VerticesDeleted', { deletedVertexIds: vertexIds });
        // 選択解除
        this._eventBus.publish('ClearSelection'); // MapViewModel等で選択解除を処理

    } catch (error) {
        console.error('頂点の削除に失敗しました', error);
        // 必要であればエラー通知
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
      // 1. UseCase を呼び出す前に、現在の地物から古いプロパティを取得
      const worldRepository = this._editFeatureUseCase._worldRepository;
      const world = await worldRepository.getWorld();
      const featureBefore = world.features.find(f => f.id === featureId);
      if (!featureBefore) {
        throw new Error(`Feature not found: ${featureId}`);
      }
      // 古いプロパティをアンドゥ履歴用にシリアライズ (プレーンオブジェクト)
      const oldPropertiesPlain = featureBefore.properties
        .map(p => this._serializeForHistory(p))
        .filter(Boolean); // シリアライズ失敗を除外

      // 2. UseCase を呼び出して地物を更新
      const feature = await this._editFeatureUseCase.updateFeature(
        featureId, { properties: newProperties } // 新しい Property インスタンス配列を渡す
      );

      // 3. アンドゥ履歴に追加 (プレーンオブジェクトを保存)
      // 新しいプロパティもシリアライズ
      const newPropertiesPlain = newProperties
        .map(p => this._serializeForHistory(p))
        .filter(Boolean); // シリアライズ失敗を除外

      this._addToHistory({
        type: 'updateProperties',
        featureId,
        oldProperties: oldPropertiesPlain, // 更新「前」のプレーンデータを保存
        newProperties: newPropertiesPlain  // 更新「後」のプレーンデータを保存
      });

      // 4. イベント発行
      this._eventBus.publish('FeatureUpdated', { feature }); // イベントには更新後のインスタンス

      return feature; // 更新後のインスタンスを返す
    } catch (error) {
      console.error('地物プロパティの更新に失敗しました (EditingViewModel)', error);
      throw error; // エラーを再スロー
    }
  }

  /**
   * ポリゴンに穴を追加 (内部処理)
   * @param {string} polygonId - ポリゴンID
   * @param {Array} holePoints - 穴の頂点配列 [{x, y}, ...]
   * @returns {Promise<Object>} 更新されたポリゴンインスタンス
   * @private アンドゥ/リドゥから呼び出される場合があるため残すが、基本はconfirmAddHole経由
   */
  async addHoleToPolygon(polygonId, holePoints) {
    try {
      if (holePoints.length < 3) {
        throw new Error('穴は少なくとも3つの点が必要です');
      }

      const worldRepository = this._editFeatureUseCase._worldRepository;
      let world = await worldRepository.getWorld(); // Use let for potential reassignment

      const polygonIndex = world.features.findIndex(f => f.id === polygonId && f instanceof DomainPolygon);
      if (polygonIndex === -1) throw new Error(`ポリゴンが見つかりません: ${polygonId}`);
      const polygon = world.features[polygonIndex];

      // UseCase が新しい頂点を生成し、IDを返すようにするべきだが、現状はViewModelが生成
      const newHoleVertexIds = [];
      const addedVerticesData = []; // 追加された頂点のプレーンデータ
      let verticesChanged = false;
      for (const point of holePoints) {
          const vertexId = this._editFeatureUseCase._generateId('vertex');
          const vertexData = { _constructorName: 'Vertex', id: vertexId, x: point.x, y: point.y };
          addedVerticesData.push(vertexData);
          newHoleVertexIds.push(vertexId);
          // UseCaseに頂点追加を依頼する方が理想的
          if (!world.vertices.some(v => v.id === vertexId)) {
             world.vertices.push({ id: vertexId, x: point.x, y: point.y });
             verticesChanged = true;
          }
      }
      if (verticesChanged) {
          await worldRepository.saveWorld(world); // Save added vertices first
          world = await worldRepository.getWorld(); // Reload world state
      }

      // 古い穴情報を取得 (アンドゥ用、更新前のインスタンスから取得)
      const polygonBeforeUpdate = world.features.find(f => f.id === polygonId); // Reloaded polygon
      const oldHolesVertexIdsPlain = this._serializeForHistory({ holesVertexIds: polygonBeforeUpdate.holesVertexIds })?.holesVertexIds || [];

      // 穴を追加
      const newHolesVertexIdsWithNewOne = [...polygonBeforeUpdate.holesVertexIds, newHoleVertexIds];

      // ポリゴンを更新 (更新対象の geometry を渡す)
      const updatedPolygon = await this._editFeatureUseCase.updateFeature(
        polygonId,
        { geometry: { holesVertexIds: newHolesVertexIdsWithNewOne } } // geometry オブジェクトで渡す
      );

      const newHolesVertexIdsPlain = this._serializeForHistory({ holesVertexIds: updatedPolygon.holesVertexIds })?.holesVertexIds || []; // プレーンで保存

      // confirmAddHole がこれを呼ぶ場合、履歴が二重登録される可能性。confirm側で履歴追加する。
      // 外部から直接呼ばれた場合のみ履歴登録すべきだが、そのケースは現状ないはず。
      // _addToHistory({
      //   type: 'addHole',
      //   polygonId,
      //   oldHolesVertexIds: oldHolesVertexIdsPlain, // 更新前のプレーンデータ
      //   newHolesVertexIds: newHolesVertexIdsPlain, // 更新後のプレーンデータ
      //   addedVerticesData: addedVerticesData // 追加された頂点のプレーンデータ
      // });

      // this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
      // this._clearAddingState(); // confirmAddHole側で行う

      return updatedPolygon;
    } catch (error) {
      console.error('穴の追加に失敗しました', error);
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
    if (this._undoStack.length === 0) return;
    // ドラッグ中の場合はキャンセル
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
    // 追加中の場合はキャンセル
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();


    const operation = this._undoStack.pop();
    // console.log("Undoing:", operation);

    try {
      await this._executeReverseOperation(operation);
      this._redoStack.push(operation);
      this._notifyObservers('history');
      this._eventBus.publish('WorldUpdated'); // 全体更新イベント
    } catch (error) {
      // エラーが発生した場合、アンドゥスタックに戻す
      this._undoStack.push(operation);
      console.error('アンドゥに失敗しました', error);
      alert(`アンドゥに失敗しました: ${error.message}`);
      // throw error; // エラーを再スローするかどうか
    }
  }

  /**
   * リドゥ
   * @returns {Promise<void>}
   */
  async redo() {
    if (this._redoStack.length === 0) return;
     // ドラッグ中の場合はキャンセル
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
     // 追加中の場合はキャンセル
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();

    const operation = this._redoStack.pop();
    // console.log("Redoing:", operation);

    try {
      await this._executeOperation(operation);
      this._undoStack.push(operation); // 成功した場合のみアンドゥスタックへ
      this._notifyObservers('history');
      this._eventBus.publish('WorldUpdated'); // 全体更新イベント
    } catch (error) {
      // エラーが発生した場合、リドゥスタックに戻す
      this._redoStack.push(operation);
      console.error('リドゥに失敗しました', error);
      alert(`リドゥに失敗しました: ${error.message}`);
      // throw error; // エラーを再スローするかどうか
    }
  }

  /**
   * 操作履歴に追加
   * @param {Object} operation - 操作情報 (内部データはプレーンオブジェクトであるべき)
   * @private
   */
  _addToHistory(operation) {
    // operation内のデータがプレーンオブジェクトであることを確認 (開発用)
    // JSON.parse(JSON.stringify(operation)); // deep copy & check serializability

    this._undoStack.push(operation);

    if (this._undoStack.length > this._maxHistorySize) {
      this._undoStack.shift();
    }
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
        // 地物と頂点を復元 (プレーンからインスタンス生成)
        if (operation.addedVerticesData) {
            operation.addedVerticesData.forEach(vData => {
                if (!world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push(vData); // UseCaseはプレーンを期待
                    worldChanged = true;
                }
            });
        }
        if (worldChanged) await worldRepo.saveWorld(world); // 先に頂点を保存

        if (operation.featureData) {
            const featureInstance = this._deserializeFromHistory(operation.featureData);
            if (featureInstance) {
                 // UseCase経由で追加する方が望ましいが、ID衝突などを避けるため直接追加
                 world = await worldRepo.getWorld(); // 最新状態を取得
                 if (!world.features.some(f => f.id === featureInstance.id)) {
                     world.features.push(featureInstance);
                     await worldRepo.saveWorld(world); // 地物を保存
                     this._eventBus.publish('FeatureAdded', { feature: featureInstance });
                 }
            }
        }
        break;

      case 'delete':
         await this._editFeatureUseCase.deleteFeature(operation.featureId);
         // Note: deleteFeature内でイベント発行される
         break;

      case 'deleteVertices':
          await this._editFeatureUseCase.deleteVertices(operation.deletedVertexIds);
          // Note: deleteVertices内でイベント発行される
          break;

      case 'moveVertices':
        const redoUpdates = operation.updates.map(u => ({
            vertexId: u.vertexId,
            newPosition: u.newPosition
        }));
        await this._editFeatureUseCase.moveVertices(redoUpdates);
        redoUpdates.forEach(update => {
            this._eventBus.publish('VertexMoved', { vertexId: update.vertexId, newPosition: update.newPosition });
        });
        break;

      case 'updateProperties':
        const newPropsInstances = operation.newProperties.map(p => this._deserializeFromHistory(p)).filter(Boolean);
        const featureProps = await this._editFeatureUseCase.updateFeature(
          operation.featureId, { properties: newPropsInstances }
        );
        this._eventBus.publish('FeatureUpdated', { feature: featureProps });
        break;

      case 'addHole':
         // 追加された頂点をまず復元
         let verticesAddedHole = false;
         if (operation.addedVerticesData) {
             operation.addedVerticesData.forEach(vData => {
                 if (!world.vertices.some(wv => wv.id === vData.id)) {
                     world.vertices.push(vData); // UseCaseはプレーンを期待
                     verticesAddedHole = true;
                 }
             });
         }
         if (verticesAddedHole) {
             await worldRepo.saveWorld(world); // Save added vertices first
         }
         // ポリゴンに穴情報を復元
         const updatedPolygonHole = await this._editFeatureUseCase.updateFeature(
           operation.polygonId,
           { geometry: { holesVertexIds: operation.newHolesVertexIds } }
         );
         this._eventBus.publish('FeatureUpdated', { feature: updatedPolygonHole });
        break;

      case 'addEnclave':
         // 追加された頂点をまず復元
         let verticesAddedEnclave = false;
         if (operation.addedVerticesData) {
             operation.addedVerticesData.forEach(vData => {
                 if (!world.vertices.some(wv => wv.id === vData.id)) {
                     world.vertices.push(vData); // UseCaseはプレーンを期待
                     verticesAddedEnclave = true;
                 }
             });
         }
         if (verticesAddedEnclave) {
             await worldRepo.saveWorld(world); // Save added vertices first
         }
         // ポリゴンに飛び地情報を復元
         const enclaveToAddPlain = operation.addedSubPolygon; // { vertexIds, holesVertexIds }
         world = await worldRepo.getWorld(); // Reload world
         const targetPolygonEnclave = world.features.find(f => f.id === operation.polygonId);
         if (targetPolygonEnclave instanceof DomainPolygon) {
             const currentSubPolygons = targetPolygonEnclave.subPolygons || [];
             const newSubPolygons = [...currentSubPolygons, enclaveToAddPlain];
             const updatedPolygonEnclave = await this._editFeatureUseCase.updateFeature(
                 operation.polygonId,
                 { geometry: { isMultiPolygon: true, subPolygons: newSubPolygons } }
             );
             this._eventBus.publish('FeatureUpdated', { feature: updatedPolygonEnclave });
         } else {
              console.error("Redo addEnclave: Target polygon not found or invalid.", operation.polygonId);
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
        // 追加された地物を削除 (UseCaseを呼ぶ)
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        // Note: deleteFeature内でイベント発行 & 頂点クリーンアップされる
        break;

      case 'delete':
        // 削除された頂点を復元
        if (operation.verticesToRestoreData) {
            operation.verticesToRestoreData.forEach(vData => {
                if (!world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push(vData); // プレーンオブジェクトを追加
                    worldChanged = true;
                }
            });
        }
         if (worldChanged) await worldRepo.saveWorld(world); // 先に頂点を復元

        // 削除された地物を復元 (プレーンからインスタンス生成)
        if (operation.featureData) {
            const featureInstance = this._deserializeFromHistory(operation.featureData);
            if (featureInstance) {
                 world = await worldRepo.getWorld(); // 最新状態を取得
                 if (!world.features.some(f => f.id === featureInstance.id)) {
                     world.features.push(featureInstance); // インスタンスを追加
                     await worldRepo.saveWorld(world); // 地物を保存
                     this._eventBus.publish('FeatureAdded', { feature: featureInstance });
                 }
            }
        }
        break;

      case 'deleteVertices':
        // 1. 関連する頂点を復元
        if (operation.verticesToRestoreData) {
            operation.verticesToRestoreData.forEach(vData => {
                if (!world.vertices.some(v => v.id === vData.id)) {
                    world.vertices.push(vData); // プレーンオブジェクトを追加
                    worldChanged = true;
                }
            });
        }
        if (worldChanged) {
            await worldRepo.saveWorld(world); // 頂点を先に保存
            world = await worldRepo.getWorld(); // 最新のworld状態を取得
            worldChanged = false; // worldChangedフラグをリセット
        }

        // 2. 影響を受けた地物を変更前の状態に復元
        if (operation.affectedFeaturesBefore) {
            let featuresUpdated = false;
            Object.values(operation.affectedFeaturesBefore).forEach(featurePlain => {
                const featureInstance = this._deserializeFromHistory(featurePlain);
                if (!featureInstance) return;

                const index = world.features.findIndex(f => f.id === featureInstance.id);
                const wasDeleted = operation.deletedFeatureIds?.includes(featureInstance.id);

                if (index !== -1) { // 地物が存在する場合 (更新されたケース)
                    if (!world.features[index].equals(featureInstance)) { // 状態が変わっていれば更新
                        world.features[index] = featureInstance; // インスタンスで置き換え
                        featuresUpdated = true;
                        this._eventBus.publish('FeatureUpdated', { feature: featureInstance });
                    }
                } else if (wasDeleted) { // 削除されていた地物を復元
                    world.features.push(featureInstance);
                    featuresUpdated = true;
                    this._eventBus.publish('FeatureAdded', { feature: featureInstance });
                } else {
                    console.warn(`Undo deleteVertices: Feature ${featureInstance.id} not found but was not marked as deleted.`);
                }
            });
            if (featuresUpdated) {
                 await worldRepo.saveWorld(world); // 地物の変更を保存
                 worldChanged = true; // worldが変更されたことをマーク
            }
        }
        break;

      case 'moveVertices':
          const undoUpdates = operation.updates.map(u => ({
              vertexId: u.vertexId,
              newPosition: u.oldPosition // 古い位置に戻す
          }));
          await this._editFeatureUseCase.moveVertices(undoUpdates);
          undoUpdates.forEach(update => {
              this._eventBus.publish('VertexMoved', { vertexId: update.vertexId, newPosition: update.newPosition });
          });
          break;

      case 'updateProperties':
        const oldPropsInstances = operation.oldProperties.map(p => this._deserializeFromHistory(p)).filter(Boolean);
        const featureProps = await this._editFeatureUseCase.updateFeature(
          operation.featureId, { properties: oldPropsInstances }
        );
        this._eventBus.publish('FeatureUpdated', { feature: featureProps });
        break;

      case 'addHole':
         // ポリゴンの穴情報を元に戻す
         const polygonHoleUndo = await this._editFeatureUseCase.updateFeature(
           operation.polygonId,
           { geometry: { holesVertexIds: operation.oldHolesVertexIds } }
         );
         this._eventBus.publish('FeatureUpdated', { feature: polygonHoleUndo });

         // 穴追加時に作成された頂点も削除 (他の地物で使われていない場合)
         if (operation.addedVerticesData) {
             // UseCaseのdeleteVerticesを呼ぶ方が堅牢
             const vertexIdsToRemove = operation.addedVerticesData.map(v => v.id);
             await this._editFeatureUseCase.deleteVertices(vertexIdsToRemove);
             // deleteVertices内でイベント発行とworld保存が行われるはず
             worldChanged = true;
         }
        break;

      case 'addEnclave':
          // ポリゴンの飛び地情報とisMultiPolygonフラグを元に戻す
          const polygonEnclaveUndo = await this._editFeatureUseCase.updateFeature(
              operation.polygonId,
              { geometry: { isMultiPolygon: operation.oldIsMultiPolygon, subPolygons: operation.oldSubPolygons } }
          );
          this._eventBus.publish('FeatureUpdated', { feature: polygonEnclaveUndo });

          // 飛び地追加時に作成された頂点を削除
          if (operation.addedVerticesData) {
              const vertexIdsToRemoveEnclave = operation.addedVerticesData.map(v => v.id);
              await this._editFeatureUseCase.deleteVertices(vertexIdsToRemoveEnclave);
              worldChanged = true;
          }
          break;

      default:
        console.warn(`未対応の操作タイプ (Undo): ${operation.type}`);
    }

    // Note: UseCase内でWorldが保存される場合が多いが、逆操作で明示的にWorldを変更した場合は保存が必要な場合がある
    // if (worldChanged) {
    //   await worldRepo.saveWorld(world);
    // }
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
        const world = await worldRepository.getWorld(); // 最新のworldを取得
        if (!world || !world.vertices) return [];

        const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
        return vertexIds
            .map(id => verticesMap.get(id))
            .filter(Boolean)
            .map(v => this._serializeForHistory(v)); // プレーンオブジェクトで返す
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
    if (feature.vertexIds) feature.vertexIds.forEach(id => vertexIds.add(id));
    if (feature instanceof DomainPolygon) {
        feature.holesVertexIds?.flat().forEach(id => vertexIds.add(id));
        if(feature.isMultiPolygon && feature.subPolygons) {
            feature.subPolygons.forEach(sub => sub.vertexIds?.forEach(id => vertexIds.add(id)));
            // TODO: MultiPolygonの穴の頂点も考慮
        }
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
    if (!this._observers.includes(observer)) {
      this._observers.push(observer);
    }
  }

  /**
   * 観測者を削除
   * @param {Function} observer - 削除する観測者
   */
  removeObserver(observer) {
    const index = this._observers.indexOf(observer);
    if (index !== -1) {
      this._observers.splice(index, 1);
    }
  }

  /**
   * 観測者に通知
   * @param {string} type - 変更タイプ
   * @private
   */
  _notifyObservers(type) {
    const data = this._getStateForType(type);
    for (const observer of this._observers) {
      try { // 念のため try-catch
          observer(type, data);
      } catch (error) {
          console.error("Error in observer:", error);
      }
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
      case 'mode':
        return this._mode;
      case 'tool':
        return this._tool;
      case 'addingPoints':
        return this._addingPoints;
      case 'addingHoleTarget': // 互換性のため残すが、targetPolygon を使うべき
        return this._targetPolygonIdForHole;
      case 'targetPolygon':
        return this._targetPolygon;
      case 'addingSubMode':
        return this._addingSubMode;
      case 'temporaryElements':
        return this._temporaryElements;
      case 'draggingVertices': // 変更: draggingVertex -> draggingVertices
        return this._draggingVerticesInfo;
      case 'history':
        return {
          canUndo: this.canUndo(),
          canRedo: this.canRedo()
        };
      default:
        return null;
    }
  }
}
