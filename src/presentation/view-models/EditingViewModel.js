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
    this._targetPolygonIdForHole = null; // 互換性のため残すが、_targetPolygon を優先
    this._targetPolygon = null; // 穴/飛び地追加対象のポリゴンインスタンス
    this._targetSubPolygonIndex = null; // 穴追加対象の飛び地インデックス (null=本土)
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
    } else if (object._constructorName === 'SubPolygon') { // 仮の飛び地データ用
         return {
             _constructorName: 'SubPolygon',
             vertexIds: Array.isArray(object.vertexIds) ? [...object.vertexIds] : [],
             holesVertexIds: Array.isArray(object.holesVertexIds) ? object.holesVertexIds.map(hole => [...hole]) : []
         };
    }
     else {
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
            case 'SubPolygon': // 仮の飛び地データ用
                 return { // インスタンスではなくプレーンオブジェクトを返す
                     vertexIds: data.vertexIds || [],
                     holesVertexIds: data.holesVertexIds || []
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
          this._targetSubPolygonIndex = null; // 対象インデックスもリセット
          this._clearAddingPoints(); // 既存の点をクリア
          this._notifyObservers('targetPolygon'); // ターゲットポリゴン変更を通知
          this._notifyObservers('addingSubMode');
          this._notifyObservers('targetSubPolygonIndex'); // インデックス変更を通知
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
   * 穴追加対象の飛び地インデックスを設定 (MapViewから呼び出される)
   * @param {number | null} index - 飛び地のインデックス (本土の場合は null)
   * @private internal use by MapView
   */
  setTargetSubPolygonIndex(index) {
      if (this._targetSubPolygonIndex !== index) {
          this._targetSubPolygonIndex = index;
          this._notifyObservers('targetSubPolygonIndex');
      }
  }

  /**
   * 穴追加対象の飛び地インデックスを取得
   * @returns {number | null}
   */
  getTargetSubPolygonIndex() {
      return this._targetSubPolygonIndex;
  }


  /**
   * 点を追加（地物追加または穴/飛び地追加モード用）
   * @param {Object} point - 追加する点 { x, y }
   */
  addPoint(point) {
    // 'add' モード または ('edit' モード & 'add-hole' ツール & サブモード設定済み) の場合に追加
    const isAddingFeature = this._mode === 'add' && this._tool;
    // サブモードが null でも最初の点は追加できるようにする (null -> hole/enclave の遷移のため)
    const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole' && this._targetPolygon;

    if (isAddingFeature || isAddingHoleOrEnclave) {
        // ドラッグ中は追加しない（誤操作防止）
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
    const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole'; // サブモードは不問

    if ((isAddingFeature || isAddingHoleOrEnclave) && this._addingPoints.length > 0) {
      this._addingPoints.pop();
      // 点がなくなったらサブモードとターゲットインデックスもリセット
      if (this._addingPoints.length === 0) {
          if (this._addingSubMode !== null) {
              this.setAddingSubMode(null);
          }
          if (this._targetSubPolygonIndex !== null) {
              this.setTargetSubPolygonIndex(null); // インデックスもリセット
          }
          // ターゲットポリゴン自体はツールが add-hole である限り維持
      }
      this._notifyObservers('addingPoints');
    }
  }

  /**
   * 追加中の状態をクリア (点、ターゲット、サブモード、インデックス)
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
        changed = true; // targetPolygon の変更も通知する
    }
    if (this._addingSubMode !== null) {
        this._addingSubMode = null;
        changed = true;
    }
    if (this._targetSubPolygonIndex !== null) { // インデックスもクリア
        this._targetSubPolygonIndex = null;
        changed = true;
    }
    if (changed) {
        this._notifyObservers('addingState'); // 関連状態をまとめて通知
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
      // _processGeometryは頂点生成のみに使い、UseCaseには座標を渡す
      const geometryData = { vertices: [...this._addingPoints] }; // 座標のコピーを渡す

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
      const addedVerticesData = await this._getVerticesByIds(feature.vertexIds); // UseCaseから返されたインスタンスのIDを使う
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
      // サブモードが 'hole' であること、対象ポリゴンがあること、点が3つ以上あることを確認
      if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'hole' || !this._targetPolygon || this._addingPoints.length < 3) {
          console.error('穴の追加確定の条件を満たしていません。', { mode: this._mode, tool: this._tool, subMode: this._addingSubMode, target: !!this._targetPolygon, points: this._addingPoints.length });
          this._clearAddingState(); // 状態をクリア
          this.setTool('select');
          return null;
      }

      const polygonId = this._targetPolygon.id;
      const holePoints = [...this._addingPoints]; // 穴の頂点座標
      const targetSubIndex = this._targetSubPolygonIndex; // 対象が本土か飛び地か

      // アンドゥ用に更新前の状態を保存 (プレーン)
      const polygonBeforeUpdatePlain = this._serializeForHistory(this._targetPolygon);
      const oldHoles = targetSubIndex === null
          ? polygonBeforeUpdatePlain?.holesVertexIds || []
          : polygonBeforeUpdatePlain?.subPolygons?.[targetSubIndex]?.holesVertexIds || [];

      try {
          // UseCaseに渡す情報を組み立てる
          let geometryUpdate = {};
          if (targetSubIndex === null) { // 本土への穴追加
              // 新しい穴の頂点座標を渡す (ID生成はUseCaseが行う)
              geometryUpdate = { holes: [holePoints] };
          } else { // 飛び地への穴追加
              // 新しい穴の頂点座標と対象インデックスを渡す
              geometryUpdate = {
                  targetSubPolygonIndex: targetSubIndex,
                  newHolesForSubPolygon: [holePoints] // UseCaseは座標の配列の配列を期待
              };
          }

          // UseCaseを呼び出してポリゴンを更新
          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );

          // アンドゥ履歴に追加
          // 更新後のポリゴンから追加された穴の頂点IDを取得する必要がある
          const updatedPolygonPlain = this._serializeForHistory(updatedPolygon);
          const newHoles = targetSubIndex === null
              ? updatedPolygonPlain?.holesVertexIds || []
              : updatedPolygonPlain?.subPolygons?.[targetSubIndex]?.holesVertexIds || [];
          // 注意: 追加された穴の頂点IDを正確に特定するのは難しい場合がある
          //     -> UseCaseが追加した頂点IDを返すようにするのが理想
          //     -> ここでは簡易的に、更新前後の差分から追加されたIDを推測する (不安定)
          const addedHoleVertexIds = this._findAddedIds(oldHoles.flat(), newHoles.flat());
          const addedVerticesData = await this._getVerticesByIds(addedHoleVertexIds);


          this._addToHistory({
              type: 'addHole',
              polygonId,
              targetSubPolygonIndex: targetSubIndex, // 対象インデックスも保存
              oldHolesVertexIds: oldHoles, // 更新前の穴(プレーン)
              newHolesVertexIds: newHoles, // 更新後の穴(プレーン)
              addedVerticesData: addedVerticesData // 追加された頂点データ(プレーン)
          });

          // イベント発行
          this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
          this._clearAddingState(); // 成功時に状態クリア
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
      // サブモードが 'enclave' であること、対象ポリゴンがあること、点が3つ以上あることを確認
      if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'enclave' || !this._targetPolygon || this._addingPoints.length < 3) {
          console.error('飛び地の追加確定の条件を満たしていません。', { mode: this._mode, tool: this._tool, subMode: this._addingSubMode, target: !!this._targetPolygon, points: this._addingPoints.length });
          this._clearAddingState();
          this.setTool('select');
          return null;
      }

      const polygonId = this._targetPolygon.id;
      const enclavePoints = [...this._addingPoints]; // 飛び地の頂点座標

      // アンドゥ用に更新前の状態を保存 (プレーン)
      const polygonBeforeUpdatePlain = this._serializeForHistory(this._targetPolygon);

      try {
          // 1. UseCaseに渡すための情報を準備
          // 新しい飛び地の頂点座標を渡す (ID生成はUseCaseが行う)
          const geometryUpdate = { newSubPolygonVertices: enclavePoints };

          // 2. UseCaseを呼び出してポリゴンを更新
          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );

          // 3. 操作履歴に追加
          // 更新後のポリゴンから追加された飛び地の情報を取得
          const updatedPolygonPlain = this._serializeForHistory(updatedPolygon);
          const addedSubPolygonIndex = updatedPolygonPlain.subPolygons.length - 1; // 最後に追加されたと仮定
          const addedSubPolygonData = updatedPolygonPlain.subPolygons[addedSubPolygonIndex];

          // 追加された頂点データを取得
          const addedVerticesData = await this._getVerticesByIds(addedSubPolygonData.vertexIds);

          this._addToHistory({
              type: 'addEnclave',
              polygonId: polygonId,
              addedSubPolygonIndex: addedSubPolygonIndex, // 追加されたインデックス
              addedSubPolygon: addedSubPolygonData, // 追加された飛び地データ (プレーン)
              addedVerticesData: addedVerticesData, // 追加された頂点データ (プレーン)
              oldIsMultiPolygon: polygonBeforeUpdatePlain.isMultiPolygon, // 元がMultiPolygonだったか
              oldSubPolygons: polygonBeforeUpdatePlain.subPolygons // 元の飛び地 (プレーン)
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
                       oldPosition: this._serializeForHistory({ _constructorName: 'Vertex', ...info.originalPosition, id: vertexId }), // プレーンで保存
                       newPosition: this._serializeForHistory({ _constructorName: 'Vertex', ...info.currentPosition, id: vertexId }) // プレーンで保存
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
   * ポリゴンに穴を追加 (内部処理用 - 通常はconfirmAddHole経由)
   * @param {string} polygonId - ポリゴンID
   * @param {Array} holePoints - 穴の頂点配列 [{x, y}, ...]
   * @param {number | null} targetSubIndex - 対象の飛び地インデックス (本土はnull)
   * @returns {Promise<Object>} 更新されたポリゴンインスタンス
   * @private このメソッドはアンドゥ/リドゥから直接呼び出される可能性を考慮
   */
  async addHoleToPolygon(polygonId, holePoints, targetSubIndex = null) {
      try {
          if (holePoints.length < 3) {
              throw new Error('穴は少なくとも3つの点が必要です');
          }

          // UseCaseに渡す情報を組み立てる
          let geometryUpdate = {};
          if (targetSubIndex === null) { // 本土への穴追加
              geometryUpdate = { holes: [holePoints] };
          } else { // 飛び地への穴追加
              geometryUpdate = {
                  targetSubPolygonIndex: targetSubIndex,
                  newHolesForSubPolygon: [holePoints]
              };
          }

          // UseCaseを呼び出してポリゴンを更新
          const updatedPolygon = await this._editFeatureUseCase.updateFeature(
              polygonId,
              { geometry: geometryUpdate }
          );
          return updatedPolygon;
      } catch (error) {
          console.error('穴の追加(内部処理)に失敗しました', error);
          this._clearAddingState(); // 失敗時も状態クリア
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
    // ドラッグ中/追加中はキャンセル
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
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
     // ドラッグ中/追加中はキャンセル
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
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
            operation.addedVerticesData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain); // Vertexインスタンスに
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y }); // リポジトリはプレーンを期待
                    worldChanged = true;
                }
            });
        }
        if (worldChanged) await worldRepo.saveWorld(world); // 先に頂点を保存

        if (operation.featureData) {
            const featureInstance = this._deserializeFromHistory(operation.featureData);
            if (featureInstance) {
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
            // 履歴からプレーンな座標を取り出す
            newPosition: { x: u.newPosition.x, y: u.newPosition.y }
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
             operation.addedVerticesData.forEach(vDataPlain => {
                 const vData = this._deserializeFromHistory(vDataPlain);
                 if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                     world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
                     verticesAddedHole = true;
                 }
             });
         }
         if (verticesAddedHole) {
             await worldRepo.saveWorld(world); // Save added vertices first
         }
         // ポリゴンに穴情報を復元
         let geometryUpdateHole = {};
         if (operation.targetSubPolygonIndex === null) { // 本土の穴
             geometryUpdateHole = { holesVertexIds: operation.newHolesVertexIds };
         } else { // 飛び地の穴
             // UseCase は newHolesVertexIdsForSubPolygon を期待するが、
             // Redo 時には既に ID が振られている newHolesVertexIds を使って
             // withSubPolygonHoles を呼ぶ必要がある。
             // -> UseCase 側でこの Redo パターンに対応するか、
             //    ViewModel が addHoleToPolygon を直接呼ぶか。
             //    ここでは UseCase 修正前提で進める（ただし現状のUseCaseは未対応）
             //    暫定策: UseCase が対応するまで Redo は期待通りに動かない可能性
             // geometryUpdateHole = {
             //    targetSubPolygonIndex: operation.targetSubPolygonIndex,
             //    // UseCase が newHolesVertexIdsForSubPolygon (座標) でなく
             //    //   holesVertexIdsForSubPolygon (ID) を受け取れるようにする必要あり
             //    holesVertexIdsForSubPolygon: operation.newHolesVertexIds
             // };
             // 暫定的に、更新後の穴配列全体を渡す
              world = await worldRepo.getWorld();
              const targetPolygonHole = world.features.find(f => f.id === operation.polygonId);
              if (targetPolygonHole instanceof DomainPolygon) {
                  const updatedSubPolygons = targetPolygonHole.subPolygons.map((sub, index) => {
                      if (index === operation.targetSubPolygonIndex) {
                          return { ...sub, holesVertexIds: operation.newHolesVertexIds };
                      }
                      return sub;
                  });
                  geometryUpdateHole = { subPolygons: updatedSubPolygons };
              } else {
                   console.error("Redo addHole (sub): Target polygon not found or invalid.");
                   break; // エラー処理
              }
         }

         const updatedPolygonHole = await this._editFeatureUseCase.updateFeature(
           operation.polygonId,
           { geometry: geometryUpdateHole }
         );
         this._eventBus.publish('FeatureUpdated', { feature: updatedPolygonHole });
        break;

      case 'addEnclave':
         // 追加された頂点をまず復元
         let verticesAddedEnclave = false;
         if (operation.addedVerticesData) {
             operation.addedVerticesData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                 if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                     world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
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
             // 履歴から取得したプレーンオブジェクトをそのまま追加
             const newSubPolygons = [...currentSubPolygons];
             // 正しいインデックスに挿入または末尾に追加
             if(operation.addedSubPolygonIndex !== undefined && operation.addedSubPolygonIndex >= 0) {
                 newSubPolygons.splice(operation.addedSubPolygonIndex, 0, enclaveToAddPlain);
             } else {
                 newSubPolygons.push(enclaveToAddPlain);
             }

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
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
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
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vData = this._deserializeFromHistory(vDataPlain);
                if (vData && !world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push({ id: vData.id, x: vData.x, y: vData.y });
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
                    // equals があれば使うが、なければプロパティ比較などで代用検討
                    const currentFeature = world.features[index];
                    let areEqual = false;
                    if(typeof currentFeature.equals === 'function') {
                        areEqual = currentFeature.equals(featureInstance);
                    } else {
                        // 簡易比較 (JSON比較は循環参照などで失敗する可能性あり)
                        // areEqual = JSON.stringify(currentFeature) === JSON.stringify(featureInstance);
                        // IDが同じならとりあえず置き換える、という方針も
                        areEqual = false; // 常に更新とみなす
                    }

                    if (!areEqual) { // 状態が変わっていれば更新
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
              // 履歴からプレーンな座標を取り出す
              newPosition: { x: u.oldPosition.x, y: u.oldPosition.y } // 古い位置に戻す
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
         let geometryUpdateUndoHole = {};
         if (operation.targetSubPolygonIndex === null) { // 本土の穴
             geometryUpdateUndoHole = { holesVertexIds: operation.oldHolesVertexIds };
         } else { // 飛び地の穴
             // UseCase 側でこの Undo パターンに対応するか、ViewModel が直接操作するか。
             // 暫定的に、更新前の穴配列全体を渡す
              world = await worldRepo.getWorld();
              const targetPolygonUndoHole = world.features.find(f => f.id === operation.polygonId);
              if (targetPolygonUndoHole instanceof DomainPolygon) {
                  const updatedSubPolygonsUndo = targetPolygonUndoHole.subPolygons.map((sub, index) => {
                      if (index === operation.targetSubPolygonIndex) {
                          return { ...sub, holesVertexIds: operation.oldHolesVertexIds };
                      }
                      return sub;
                  });
                  geometryUpdateUndoHole = { subPolygons: updatedSubPolygonsUndo };
              } else {
                  console.error("Undo addHole (sub): Target polygon not found or invalid.");
                  break; // エラー処理
              }
         }
         const polygonHoleUndo = await this._editFeatureUseCase.updateFeature(
           operation.polygonId,
           { geometry: geometryUpdateUndoHole }
         );
         this._eventBus.publish('FeatureUpdated', { feature: polygonHoleUndo });

         // 穴追加時に作成された頂点も削除 (他の地物で使われていない場合)
         if (operation.addedVerticesData) {
             const vertexIdsToRemove = operation.addedVerticesData.map(v => v.id);
             // 削除前に world.vertices に存在するか確認する方が安全
             world = await worldRepo.getWorld();
             const existingVertexIdsToRemove = vertexIdsToRemove.filter(id => world.vertices.some(v => v.id === id));
             if (existingVertexIdsToRemove.length > 0) {
                 await this._editFeatureUseCase.deleteVertices(existingVertexIdsToRemove);
                 // deleteVertices内でイベント発行とworld保存が行われるはず
                 worldChanged = true;
             }
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
              // 削除前に world.vertices に存在するか確認
              world = await worldRepo.getWorld();
              const existingVertexIdsToRemoveEnclave = vertexIdsToRemoveEnclave.filter(id => world.vertices.some(v => v.id === id));
               if (existingVertexIdsToRemoveEnclave.length > 0) {
                  await this._editFeatureUseCase.deleteVertices(existingVertexIdsToRemoveEnclave);
                  worldChanged = true;
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
        const world = await worldRepository.getWorld(); // 最新のworldを取得
        if (!world || !world.vertices) return [];

        const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
        return vertexIds
            .map(id => verticesMap.get(id))
            .filter(Boolean)
            .map(v => this._serializeForHistory({ _constructorName: 'Vertex', ...v })); // プレーンオブジェクトで返す
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
            feature.subPolygons.forEach(sub => {
                sub.vertexIds?.forEach(id => vertexIds.add(id));
                // TODO: MultiPolygonの穴の頂点も考慮
                 sub.holesVertexIds?.flat().forEach(id => vertexIds.add(id));
            });
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
      case 'targetPolygon': // キー名変更
        return this._targetPolygon;
      case 'addingSubMode':
        return this._addingSubMode;
      case 'targetSubPolygonIndex': // 穴追加対象インデックス
        return this._targetSubPolygonIndex;
      case 'temporaryElements':
        return this._temporaryElements;
      case 'draggingVertices': // 変更: draggingVertex -> draggingVertices
        return this._draggingVerticesInfo;
      case 'history':
        return {
          canUndo: this.canUndo(),
          canRedo: this.canRedo()
        };
      case 'addingState': // 関連状態をまとめて通知
        return {
          addingPoints: this._addingPoints,
          targetPolygon: this._targetPolygon,
          addingSubMode: this._addingSubMode,
          targetSubPolygonIndex: this._targetSubPolygonIndex
        };
      default:
        return null;
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
