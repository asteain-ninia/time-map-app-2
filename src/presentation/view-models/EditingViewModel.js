import { Point } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js'; // Line は他の箇所で使用されている可能性があるためエイリアス
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js'; // Polygon も同様にエイリアス
import { TimePoint } from '../../domain/value-objects/TimePoint.js'; // TimePoint をインポート
import { Property } from '../../domain/value-objects/Property.js'; // Property をインポート


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
    this._addingPoints = []; // 追加中の点の配列 (地物追加または穴追加用)
    this._targetPolygonIdForHole = null; // 穴追加対象のポリゴンID
    this._temporaryElements = []; // 一時的な表示要素 (MapViewで描画)
    this._draggingVertexInfo = null; // ドラッグ中の頂点情報 { id: string, originalPosition: {x, y}, currentPosition: {x, y} }

    // アンドゥ・リドゥの状態
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistorySize = 100;

    // 観測者の登録
    this._observers = [];
  }

  // --- TimePoint と Property のデシリアライズヘルパー ---

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


  /**
   * 編集モードを設定
   * @param {string} mode - モード ('view', 'add', 'edit')
   */
  setMode(mode) {
    if (this._mode !== mode) {
      // 追加/穴追加作業中のデータをクリア
      if ((this._mode === 'add' || this._tool === 'add-hole') && this._addingPoints.length > 0) {
        this._clearAddingState();
      }
      // ドラッグ中の場合、ドラッグをキャンセル
      if (this._draggingVertexInfo) {
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
      // 追加/穴追加作業中のデータをクリア
       if ((this._mode === 'add' || this._tool === 'add-hole') && this._addingPoints.length > 0) {
        this._clearAddingState();
      }
      // ドラッグ中の場合、ドラッグをキャンセル
      if (this._draggingVertexInfo) {
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
   * 穴追加モードを開始 (ツール設定時に内部的に行う)
   * @param {string} polygonId - 穴を追加するポリゴンのID
   * @private internal use by MapView or controller
   */
  startAddingHole(polygonId) {
      if (this._tool === 'add-hole') {
          this._targetPolygonIdForHole = polygonId;
          this._clearAddingPoints(); // 既存の点をクリア
          this._notifyObservers('addingHoleTarget');
      } else {
          console.warn("startAddingHole called when tool is not 'add-hole'.");
      }
  }

  /**
   * 穴追加対象のポリゴンIDを取得
   * @returns {string|null} 対象ポリゴンID
   */
  getTargetPolygonIdForHole() {
      return this._targetPolygonIdForHole;
  }


  /**
   * 穴追加モードかどうかを取得 (便宜上残すが、基本は getTool() === 'add-hole' で判断)
   * @returns {boolean} 穴追加モードならtrue
   */
  isAddingHole() {
    // return this._isAddingHole;
     return this.getTool() === 'add-hole';
  }

  /**
   * 点を追加（地物追加または穴追加モード用）
   * @param {Object} point - 追加する点 { x, y }
   */
  addPoint(point) {
    // 'add' モードまたは 'edit' モードの 'add-hole' ツールの場合に追加
    if ((this._mode === 'add' && this._tool) || (this._mode === 'edit' && this._tool === 'add-hole')) {
        // ドラッグ中は追加しない（誤操作防止）
        if(this._draggingVertexInfo) return;
        this._addingPoints.push(point);
        this._notifyObservers('addingPoints');
    } else {
        console.warn("Cannot add point in current mode/tool:", this._mode, this._tool);
    }
  }

  /**
   * 最後の点を削除（地物追加または穴追加モード用）
   */
  removeLastPoint() {
    if (((this._mode === 'add' && this._tool) || (this._mode === 'edit' && this._tool === 'add-hole')) && this._addingPoints.length > 0) {
      this._addingPoints.pop();
      this._notifyObservers('addingPoints');
    }
  }

  /**
   * 追加中の状態をクリア (点とターゲットID)
   * @private
   */
  _clearAddingState() {
    this._addingPoints = [];
    this._targetPolygonIdForHole = null; // ターゲットもクリア
    this._notifyObservers('addingPoints');
    this._notifyObservers('addingHoleTarget');
  }


  /**
   * 追加中の点をクリア (外部から呼び出す場合は clearAddingState を使うべき)
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
   * @returns {Promise<Object>} 追加された地物
   */
  async confirmAddFeature(properties, layerId) {
    if (this._mode !== 'add' || !this._tool || this._addingPoints.length === 0) {
      throw new Error('地物の追加状態ではありません');
    }
     // properties が Property インスタンスの配列であることを確認
    if (!Array.isArray(properties) || !properties.every(p => p instanceof Property)) {
        console.error("confirmAddFeature: properties must be an array of Property instances.", properties);
        throw new Error("Invalid properties format.");
    }

    try {
      let feature;
      const geometryData = { vertices: this._addingPoints }; // 頂点データ

      // ツールタイプに応じた処理
      switch (this._tool) {
        case 'point':
          if (this._addingPoints.length !== 1) {
            throw new Error('点情報は1つの点のみを持つ必要があります');
          }
          feature = await this._editFeatureUseCase.addFeature('point', properties, geometryData, layerId);
          break;
        case 'line':
          if (this._addingPoints.length < 2) {
            throw new Error('線情報は少なくとも2つの点が必要です');
          }
           feature = await this._editFeatureUseCase.addFeature('line', properties, geometryData, layerId);
          break;
        case 'polygon':
          if (this._addingPoints.length < 3) {
            throw new Error('面情報は少なくとも3つの点が必要です');
          }
           // ポリゴンの初期情報（穴なし、親なし）を追加
           const polygonGeometry = { ...geometryData, holesVertexIds: [], parentId: "0" };
           feature = await this._editFeatureUseCase.addFeature('polygon', properties, polygonGeometry, layerId);
          break;
        default:
          throw new Error(`未対応のツールタイプ: ${this._tool}`);
      }

      // 操作履歴に追加
      this._addToHistory({
        type: 'add',
        featureId: feature.id,
        featureType: this._tool,
        // 履歴にはシリアライズ可能なプレーンオブジェクトを保存する方が安全かもしれない
        // featureData: JSON.parse(JSON.stringify(feature)), // Featureインスタンスではなくプレーンデータ
        featureData: feature, // 一旦インスタンスを保存するが、Undo/Redoでの復元に注意
        addedVertices: this._getVerticesByIds(feature.vertexIds) // これはプレーンオブジェクト配列
      });

      // 追加状態をクリア
      this._clearAddingState();

      // イベントを発行
      this._eventBus.publish('FeatureAdded', { feature });

      return feature;
    } catch (error) {
      console.error('地物の追加に失敗しました', error);
      this._clearAddingState(); // エラー時もクリア
      throw error;
    }
  }


  /**
   * 穴の追加を確定
   * @returns {Promise<Object|null>} 更新されたポリゴン、または失敗時にnull
   */
  async confirmAddHole() {
      if (this._mode !== 'edit' || this._tool !== 'add-hole' || !this._targetPolygonIdForHole || this._addingPoints.length < 3) {
          console.error('穴の追加確定の条件を満たしていません。');
          this._clearAddingState(); // 状態をクリア
          this.setTool('select'); // ツールをデフォルトに戻す
          return null;
      }

      const polygonId = this._targetPolygonIdForHole;
      const holePoints = [...this._addingPoints]; // コピーを作成

      try {
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
   * 頂点ドラッグの開始
   * @param {string} vertexId - ドラッグする頂点のID
   * @param {Object} originalPosition - ドラッグ開始時の位置 { x, y }
   */
  startVertexDrag(vertexId, originalPosition) {
      if (this._mode !== 'edit' || this._tool === 'add-hole') {
          console.warn("Cannot start vertex drag in current mode/tool:", this._mode, this._tool);
          return;
      }
      if (!vertexId || !originalPosition) {
          console.error("Invalid arguments for startVertexDrag");
          return;
      }
      // 既にドラッグ中なら何もしない（またはエラー）
      if (this._draggingVertexInfo) {
          console.warn("Already dragging a vertex:", this._draggingVertexInfo.id);
          return;
      }
      this._draggingVertexInfo = {
          id: vertexId,
          originalPosition: { ...originalPosition },
          currentPosition: { ...originalPosition } // 初期位置は同じ
      };
      // console.log("Vertex drag started:", this._draggingVertexInfo);
      this._notifyObservers('draggingVertex');
  }

  /**
   * 頂点ドラッグ中の位置更新
   * @param {Object} currentPosition - 現在のマウス位置（ワールド座標） { x, y }
   */
  updateVertexDrag(currentPosition) {
      if (!this._draggingVertexInfo) {
          // console.warn("updateVertexDrag called but not dragging.");
          return;
      }
      if (!currentPosition) {
          console.error("Invalid currentPosition for updateVertexDrag");
          return;
      }
      // パフォーマンスのため、位置が変わった場合のみ更新＆通知する
      if (this._draggingVertexInfo.currentPosition.x !== currentPosition.x ||
          this._draggingVertexInfo.currentPosition.y !== currentPosition.y) {
          this._draggingVertexInfo.currentPosition = { ...currentPosition };
          // console.log("Vertex drag updated:", this._draggingVertexInfo);
          this._notifyObservers('draggingVertex'); // 高頻度で通知される
      }
  }

  /**
   * 頂点ドラッグの終了
   * @returns {Promise<void>}
   */
  async endVertexDrag() {
      if (!this._draggingVertexInfo) {
          // console.warn("endVertexDrag called but not dragging.");
          return;
      }

      const { id, originalPosition, currentPosition } = this._draggingVertexInfo;
      const dragInfoCopy = { ...this._draggingVertexInfo }; // コピーを作成

      this._resetDraggingState(); // 先に状態をリセット（再描画のため）

      // 移動距離が小さい場合は実際の移動処理をスキップ（クリックと区別）
      const dx = currentPosition.x - originalPosition.x;
      const dy = currentPosition.y - originalPosition.y;
      const distanceSq = dx * dx + dy * dy;
      // クリック許容範囲を MapView から取得するか、ここで定義する (例: 1e-6)
      const clickToleranceSq = 1e-6; // 仮の値

      if (distanceSq > clickToleranceSq) {
           console.log("Ending vertex drag and applying move:", id, originalPosition, currentPosition);
          try {
              // 確定処理: EditFeatureUseCaseを呼び出す
              // moveVertex は内部メソッドではなく公開メソッドを使うべき
              // await this.moveVertex(id, originalPosition, currentPosition); // これはプライベートメソッド
              await this._editFeatureUseCase.moveVertex(id, currentPosition);

               // 操作履歴に追加 (移動した場合のみ)
              this._addToHistory({
                type: 'moveVertex',
                vertexId: id,
                oldPosition: originalPosition, // 移動「前」の位置を保存
                newPosition: currentPosition   // 移動「後」の位置を保存
              });
              // MapViewModel で World データが更新されるイベントが飛ぶはず
              this._eventBus.publish('VertexMoved', { vertexId: id, newPosition: currentPosition });


          } catch (error) {
              console.error('頂点の移動確定に失敗しました', error);
              // 必要であればエラー通知や状態のロールバック
              // 例: this._draggingVertexInfo = dragInfoCopy; // 状態を戻す（あまり推奨されない）
              alert(`頂点の移動に失敗しました: ${error.message}`);
          }
      } else {
          // console.log("Vertex drag ended without significant movement.");
          // 移動がなければアンドゥ履歴には追加しない
      }
  }

  /**
   * ドラッグ中の頂点情報を取得
   * @returns {Object | null} ドラッグ情報、またはnull
   */
  getDraggingVertexInfo() {
      return this._draggingVertexInfo;
  }

  /**
   * ドラッグ状態をリセット
   * @private
   */
  _resetDraggingState() {
      if (this._draggingVertexInfo) {
          this._draggingVertexInfo = null;
          this._notifyObservers('draggingVertex'); // ドラッグ終了を通知
      }
  }


  /**
   * 頂点を移動 (内部メソッド、endVertexDragから呼ばれる) - このメソッドは不要になった
   * @param {string} vertexId - 移動する頂点のID
   * @param {Object} oldPosition - 元の位置 { x, y }
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @returns {Promise<Object>} 移動結果
   * @private internal use by endVertexDrag
   */
  // async moveVertex(vertexId, oldPosition, newPosition) { ... } // 削除またはコメントアウト


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
       // アンドゥ用に削除される頂点の情報も取得・保存
       const verticesToDeleteIds = new Set();
       if (feature.vertexIds) feature.vertexIds.forEach(id => verticesToDeleteIds.add(id));
       if (feature instanceof DomainPolygon) {
           (feature.holesVertexIds || []).flat().forEach(id => verticesToDeleteIds.add(id));
           if (feature.isMultiPolygon && feature.subPolygons) {
               feature.subPolygons.forEach(sub => (sub.vertexIds || []).forEach(id => verticesToDeleteIds.add(id)));
               // TODO: MultiPolygon の穴の頂点も考慮
           }
       }
       const deletedVerticesData = this._getVerticesByIds(Array.from(verticesToDeleteIds));

      await this._editFeatureUseCase.deleteFeature(featureId);

      // 操作履歴に追加
      this._addToHistory({
        type: 'delete',
        featureId,
        // featureData: JSON.parse(JSON.stringify(feature)), // プレーンオブジェクトで保存
        featureData: feature, // インスタンスで保存（Undo時に再生成が必要）
        deletedVerticesData: deletedVerticesData // 削除された頂点のデータ (プレーンオブジェクト)
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
        // --- アンドゥ情報準備 ---
        // 1. 削除対象の頂点データ
        const deletedVerticesData = this._getVerticesByIds(vertexIds);
        if (deletedVerticesData.length === 0) {
            console.warn("No valid vertices found for deletion.");
            return;
        }

        // 2. 影響を受ける地物の「変更前」の状態
        const worldRepository = this._editFeatureUseCase._worldRepository; // UseCase経由が望ましいが一時的にアクセス
        const world = await worldRepository.getWorld();
        const affectedFeaturesBefore = {};

        if (world && world.features) {
            world.features.forEach(f => {
                // 地物が削除される頂点を使用しているかチェック
                 const featureUsesVertex = vertexIds.some(vid =>
                    (f.vertexIds && f.vertexIds.includes(vid)) ||
                    (f instanceof DomainPolygon && f.holesVertexIds?.some(hole => hole.includes(vid))) ||
                    (f instanceof DomainPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds?.includes(vid)))
                 );

                if (featureUsesVertex) {
                    // 変更前の地物データをディープコピーして保存 (インスタンスをそのまま保存)
                    // 注意: Undo時にプレーンオブジェクトからドメインオブジェクトへの変換が必要になる
                    // affectedFeaturesBefore[f.id] = JSON.parse(JSON.stringify(f));
                    affectedFeaturesBefore[f.id] = f; // インスタンスを保存
                }
            });
        }

        // --- UseCaseを呼び出して削除実行 ---
        const result = await this._editFeatureUseCase.deleteVertices(vertexIds);
        // result = { deletedVertexIds, updatedFeatureIds, deletedFeatureIds }

        // --- アンドゥ履歴に追加 ---
        this._addToHistory({
            type: 'deleteVertices',
            deletedVertexIds: vertexIds,
            deletedVerticesData: deletedVerticesData, // 削除された頂点の完全なデータ (プレーン)
            affectedFeaturesBefore: affectedFeaturesBefore, // 影響を受けた地物の変更前データ (インスタンス)
            deletedFeatureIds: result?.deletedFeatureIds || [] // UseCaseの結果から削除された地物IDを取得
        });

        // --- イベント発行 ---
        // UseCaseの結果に基づいてイベントを発行
        if (result?.deletedFeatureIds?.length > 0) {
             result.deletedFeatureIds.forEach(id => this._eventBus.publish('FeatureDeleted', { featureId: id }));
        }
        if (result?.updatedFeatureIds?.length > 0) {
             // 更新された地物の最新データを取得してイベント発行 (オプション)
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
   * @param {Object} oldProperties - 古いプロパティ配列 (Propertyインスタンスの配列)
   * @param {Object} newProperties - 新しいプロパティ配列 (Propertyインスタンスの配列)
   * @returns {Promise<Object>} 更新された地物
   */
  async updateFeatureProperties(featureId, oldProperties, newProperties) {
     // 型チェック
    if (!Array.isArray(oldProperties) || !oldProperties.every(p => p instanceof Property)) {
        console.error("updateFeatureProperties: oldProperties must be an array of Property instances.");
        throw new Error("Invalid oldProperties format.");
    }
    if (!Array.isArray(newProperties) || !newProperties.every(p => p instanceof Property)) {
        console.error("updateFeatureProperties: newProperties must be an array of Property instances.");
        throw new Error("Invalid newProperties format.");
    }
    try {
      const feature = await this._editFeatureUseCase.updateFeature(
        featureId, { properties: newProperties }
      );

      // 操作履歴に追加
      this._addToHistory({
        type: 'updateProperties',
        featureId,
        oldProperties: oldProperties, // 更新「前」のプロパティ配列を保存 (インスタンス)
        newProperties: newProperties  // 更新「後」のプロパティ配列を保存 (インスタンス)
      });

      // イベントを発行
      this._eventBus.publish('FeatureUpdated', { feature });

      return feature;
    } catch (error) {
      console.error('地物プロパティの更新に失敗しました', error);
      throw error;
    }
  }

  /**
   * ポリゴンに穴を追加
   * @param {string} polygonId - ポリゴンID
   * @param {Array} holePoints - 穴の頂点配列 [{x, y}, ...]
   * @returns {Promise<Object>} 更新されたポリゴン
   */
  async addHoleToPolygon(polygonId, holePoints) {
    // console.log(`addHoleToPolygon called: polygonId=${polygonId}, points=`, holePoints);
    try {
      if (holePoints.length < 3) {
        throw new Error('穴は少なくとも3つの点が必要です');
      }

      // ポリゴンを取得
      const worldRepository = this._editFeatureUseCase._worldRepository;
      const world = await worldRepository.getWorld();

      const polygonIndex = world.features.findIndex(f => f.id === polygonId && f instanceof DomainPolygon);
      if (polygonIndex === -1) {
        throw new Error(`ポリゴンが見つかりません: ${polygonId}`);
      }
      const polygon = world.features[polygonIndex];

      // 古い穴配列を保存（アンドゥ用）
      const oldHolesVertexIds = polygon.holesVertexIds.map(hole => [...hole]); // ディープコピー

      // 新しい頂点を作成し、頂点IDを取得
      const newHoleVertexIds = [];
      const tempVertices = []; // アンドゥ用に作成した頂点も記録 (プレーンオブジェクト)
      for (const point of holePoints) {
          const vertexId = this._editFeatureUseCase._generateId('vertex'); // UseCaseのID生成を利用
          tempVertices.push({ id: vertexId, x: point.x, y: point.y });
          newHoleVertexIds.push(vertexId);
      }
      // 作成した頂点をワールドデータに追加
      // updateFeature の _processGeometry で処理されるように修正が必要 -> されないのでここで追加
      if (tempVertices.length > 0) {
          world.vertices.push(...tempVertices);
          await worldRepository.saveWorld(world); // 追加した頂点を一旦保存
      }

      // 穴を追加
      const newHolesVertexIdsWithNewOne = [...oldHolesVertexIds, newHoleVertexIds];

      // ポリゴンを更新 (更新対象の geometry を渡す)
      const updatedPolygon = await this._editFeatureUseCase.updateFeature(
        polygonId,
        { geometry: { holesVertexIds: newHolesVertexIdsWithNewOne } } // geometry オブジェクトで渡す
      );
      // console.log("Polygon updated with new hole:", updatedPolygon);

      // 操作履歴に追加
      this._addToHistory({
        type: 'addHole',
        polygonId,
        oldHolesVertexIds, // 更新前の穴全体
        newHolesVertexIds: updatedPolygon.holesVertexIds, // 更新後の穴全体
        addedVerticesData: tempVertices // 追加された頂点の情報 (プレーン)
      });

      // イベントを発行
      this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });

      // 穴追加状態をクリア (confirmAddHoleから呼ばれる場合は不要かもしれないが念のため)
      this._clearAddingState();

      return updatedPolygon;
    } catch (error) {
      console.error('穴の追加に失敗しました', error);
      this._clearAddingState(); // エラー時もクリア
      throw error;
    }
  }


  /**
   * 一時的な表示要素を追加
   * @param {Object} element - 表示要素
   */
  addTemporaryElement(element) {
    // ドラッグ中の仮表示は ViewModel 内部で管理するため、このメソッドは不要になるかも
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
    if (this._draggingVertexInfo) this._resetDraggingState();

    const operation = this._undoStack.pop();
    // console.log("Undoing:", operation);

    try {
      await this._executeReverseOperation(operation);
      this._redoStack.push(operation); // 成功した場合のみリドゥスタックへ
      this._notifyObservers('history');
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
    if (this._draggingVertexInfo) this._resetDraggingState();

    const operation = this._redoStack.pop();
    // console.log("Redoing:", operation);

    try {
      await this._executeOperation(operation);
      this._undoStack.push(operation); // 成功した場合のみアンドゥスタックへ
      this._notifyObservers('history');
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
   * @param {Object} operation - 操作情報
   * @private
   */
  _addToHistory(operation) {
    this._undoStack.push(operation);

    // 履歴サイズの制限
    if (this._undoStack.length > this._maxHistorySize) {
      this._undoStack.shift();
    }

    // リドゥスタックをクリア
    this._redoStack = [];

    this._notifyObservers('history');
  }

  /**
   * 操作を実行 (リドゥ用)
   * @param {Object} operation - 操作情報
   * @returns {Promise<void>}
   * @private
   */
  async _executeOperation(operation) {
    // console.log("Executing operation (redo):", operation);
    switch (operation.type) {
      case 'add':
        // 地物を復元
        const worldRepoAdd = this._editFeatureUseCase._worldRepository;
        const worldAdd = await worldRepoAdd.getWorld();
        // 頂点も復元 (プレーンオブジェクトを追加)
        if (operation.addedVertices) {
            operation.addedVertices.forEach(vData => {
                if (!worldAdd.vertices.some(wv => wv.id === vData.id)) {
                    worldAdd.vertices.push(vData);
                }
            });
        }
        // 地物自体を復元 (ドメインインスタンスを直接追加)
        if (operation.featureData && !worldAdd.features.some(f => f.id === operation.featureId)) {
            // 履歴に保存されたインスタンスを追加（状態が古くないか注意）
            worldAdd.features.push(operation.featureData);
            await worldRepoAdd.saveWorld(worldAdd);
            this._eventBus.publish('FeatureAdded', { feature: operation.featureData });
        } else {
             console.warn("Redo add: Feature already exists or data missing.", operation.featureId);
        }
        break;

      case 'delete':
         // 地物を再度削除
         await this._editFeatureUseCase.deleteFeature(operation.featureId);
         // 削除された頂点も再度削除 (deleteFeature内で処理されるはず)
         this._eventBus.publish('FeatureDeleted', { featureId: operation.featureId });
         this._eventBus.publish('ClearSelection');
        break;

      case 'deleteVertices': // リドゥ：頂点削除
          // UseCase を呼び出して再度頂点を削除
          const redoResult = await this._editFeatureUseCase.deleteVertices(operation.deletedVertexIds);
          // イベント発行 (UseCase の結果に基づいて)
          if (redoResult?.deletedFeatureIds?.length > 0) {
               redoResult.deletedFeatureIds.forEach(id => this._eventBus.publish('FeatureDeleted', { featureId: id }));
          }
          // 更新イベントは省略（WorldUpdated でカバーする方針なら不要）
          this._eventBus.publish('VerticesDeleted', { deletedVertexIds: operation.deletedVertexIds });
          this._eventBus.publish('ClearSelection');
          break;

      case 'moveVertex':
        // 頂点を新しい位置に再度移動
        await this._editFeatureUseCase.moveVertex(
          operation.vertexId,
          operation.newPosition // Redoなので newPosition を使う
        );
         this._eventBus.publish('VertexMoved', { vertexId: operation.vertexId, newPosition: operation.newPosition });
        break;

      case 'updateProperties':
        // プロパティを新しい状態に再度更新
        const updatedFeatureProps = await this._editFeatureUseCase.updateFeature(
          operation.featureId,
          { properties: operation.newProperties } // Redoなので newProperties を使う (インスタンス配列)
        );
         this._eventBus.publish('FeatureUpdated', { feature: updatedFeatureProps });
        break;

      case 'addHole':
         // 穴追加時に作成された頂点も復元
         const repoHoleAdd = this._editFeatureUseCase._worldRepository;
         const worldHoleAdd = await repoHoleAdd.getWorld();
         let addedVerticesChanged = false;
         if (operation.addedVerticesData) {
             operation.addedVerticesData.forEach(vData => {
                 if (!worldHoleAdd.vertices.some(wv => wv.id === vData.id)) {
                     worldHoleAdd.vertices.push(vData); // プレーンオブジェクトを追加
                     addedVerticesChanged = true;
                 }
             });
         }
        // 穴を再度追加
        const updatedPolygonHole = await this._editFeatureUseCase.updateFeature(
          operation.polygonId,
          { geometry: { holesVertexIds: operation.newHolesVertexIds } } // Redoなので newHolesVertexIds を使う
        );
         if (addedVerticesChanged) await repoHoleAdd.saveWorld(worldHoleAdd); // 頂点追加後に保存
         this._eventBus.publish('FeatureUpdated', { feature: updatedPolygonHole });
        break;

      default:
        console.warn(`未対応の操作タイプ (Redo): ${operation.type}`);
        // throw new Error(`未対応の操作タイプ: ${operation.type}`);
    }
  }

  /**
   * 逆操作を実行 (アンドゥ用)
   * @param {Object} operation - 操作情報
   * @returns {Promise<void>}
   * @private
   */
  async _executeReverseOperation(operation) {
    // console.log("Executing reverse operation (undo):", operation);
    const worldRepo = this._editFeatureUseCase._worldRepository;
    const world = await worldRepo.getWorld();
    let worldChanged = false;

    switch (operation.type) {
      case 'add':
        // 追加された地物を削除
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        // 追加された頂点も削除 (deleteFeature内で処理されるはず)
        this._eventBus.publish('FeatureDeleted', { featureId: operation.featureId });
        this._eventBus.publish('ClearSelection');
        break;

      case 'delete':
        // 削除された地物を復元
        // 削除された頂点も復元 (プレーンオブジェクトを追加)
        if (operation.deletedVerticesData) {
            operation.deletedVerticesData.forEach(vData => {
                if (!world.vertices.some(wv => wv.id === vData.id)) {
                    world.vertices.push(vData);
                    worldChanged = true;
                }
            });
        }
        // 地物自体を復元 (インスタンスを直接追加)
        if (operation.featureData && !world.features.some(f => f.id === operation.featureId)) {
            world.features.push(operation.featureData);
            worldChanged = true;
            this._eventBus.publish('FeatureAdded', { feature: operation.featureData });
        } else {
             console.warn("Undo delete: Feature already exists or data missing.", operation.featureId);
        }
        break;

      case 'deleteVertices': // アンドゥ：頂点削除の復元
        let verticesRestored = false;
        let featuresRestored = false;
        // 1. 削除された頂点を復元 (プレーンオブジェクトを追加)
        if (operation.deletedVerticesData) {
            operation.deletedVerticesData.forEach(vData => {
                if (!world.vertices.some(v => v.id === vData.id)) {
                    world.vertices.push(vData);
                    verticesRestored = true;
                }
            });
        }
        // 2. 影響を受けた地物を変更前の状態に復元
        if (operation.affectedFeaturesBefore) {
            Object.values(operation.affectedFeaturesBefore).forEach(featureBefore => {
                if (!featureBefore || !featureBefore.id) {
                     console.warn("Undo deleteVertices: Invalid feature data in history.", featureBefore);
                     return;
                }
                const index = world.features.findIndex(f => f.id === featureBefore.id);
                // featureBefore はインスタンスのはずなのでそのまま使う
                if (index !== -1) {
                    // 既存の地物を変更前のインスタンスで置き換え
                    if (world.features[index] !== featureBefore) { // 参照が違う場合のみ更新
                        world.features[index] = featureBefore;
                        featuresRestored = true;
                        this._eventBus.publish('FeatureUpdated', { feature: featureBefore });
                    }
                } else if (!operation.deletedFeatureIds || !operation.deletedFeatureIds.includes(featureBefore.id)) {
                    // 地物が削除されていなかった（更新のみだった）のに見つからないのはおかしい
                    // が、Redoで削除された地物の場合は追加する
                    world.features.push(featureBefore);
                    featuresRestored = true;
                    this._eventBus.publish('FeatureAdded', { feature: featureBefore });
                } else {
                     // Redoで削除されていた地物を復元する場合
                     world.features.push(featureBefore);
                     featuresRestored = true;
                     this._eventBus.publish('FeatureAdded', { feature: featureBefore });
                }
            });
        }
         // 3. Redoで削除された地物も復元する必要がある
        if (operation.deletedFeatureIds && operation.affectedFeaturesBefore) {
             operation.deletedFeatureIds.forEach(deletedId => {
                 const featureData = operation.affectedFeaturesBefore[deletedId];
                 if (featureData && !world.features.some(f => f.id === deletedId)) {
                     world.features.push(featureData); // 復元
                     featuresRestored = true;
                     this._eventBus.publish('FeatureAdded', { feature: featureData });
                 }
             });
        }

        worldChanged = verticesRestored || featuresRestored;
        // イベント発行（影響範囲が大きいので再描画を促すなど）
        if (worldChanged) {
             this._eventBus.publish('WorldUpdated'); // 広範な変更を示すイベントが良いかも
             this._eventBus.publish('ClearSelection');
        }
        break;

      case 'moveVertex':
        // 頂点を元の位置に戻す
        await this._editFeatureUseCase.moveVertex(
          operation.vertexId,
          operation.oldPosition // Undoなので oldPosition を使う
        );
         this._eventBus.publish('VertexMoved', { vertexId: operation.vertexId, newPosition: operation.oldPosition });
        break;

      case 'updateProperties':
        // プロパティを元の状態に戻す
        const featureProps = await this._editFeatureUseCase.updateFeature(
          operation.featureId,
          { properties: operation.oldProperties } // Undoなので oldProperties を使う (インスタンス配列)
        );
        this._eventBus.publish('FeatureUpdated', { feature: featureProps });
        break;

      case 'addHole':
         // 追加された穴を削除（＝元の状態に戻す）
         const updatedPolygonUndoHole = await this._editFeatureUseCase.updateFeature(
           operation.polygonId,
           { geometry: { holesVertexIds: operation.oldHolesVertexIds } } // Undoなので oldHolesVertexIds を使う
         );
          // 穴追加時に作成された頂点も削除 (他の地物で使われていない場合)
          let verticesChangedHoleUndo = false;
          if (operation.addedVerticesData) {
              const verticesToRemove = new Set(operation.addedVerticesData.map(v => v.id));
              // 削除前に現在の地物リストで利用状況を再確認
              const currentFeatures = world.features.filter(f => f.id !== operation.polygonId); // 自分以外の地物
              verticesToRemove.forEach(vertexId => {
                  const isUsed = currentFeatures.some(f =>
                     (f.vertexIds && f.vertexIds.includes(vertexId)) ||
                     (f instanceof DomainPolygon && f.holesVertexIds?.some(h => h.includes(vertexId))) ||
                     (f instanceof DomainPolygon && f.isMultiPolygon && f.subPolygons?.some(s => s.vertexIds?.includes(vertexId)))
                  );
                  if (!isUsed) {
                      const index = world.vertices.findIndex(wv => wv.id === vertexId);
                      if (index !== -1) {
                         world.vertices.splice(index, 1);
                         verticesChangedHoleUndo = true;
                      }
                  } else {
                      console.warn(`Undo addHole: Vertex ${vertexId} is still used by other features.`);
                  }
              });
          }
          worldChanged = worldChanged || verticesChangedHoleUndo; // 頂点変更フラグを考慮
          this._eventBus.publish('FeatureUpdated', { feature: updatedPolygonUndoHole });
        break;

      default:
        console.warn(`未対応の操作タイプ (Undo): ${operation.type}`);
        // throw new Error(`未対応の操作タイプ: ${operation.type}`);
    }

    if (worldChanged) {
      await worldRepo.saveWorld(world);
    }
  }


  /**
   * ID配列から頂点オブジェクトの配列を取得 (アンドゥ/リドゥ用)
   * @param {string[]} vertexIds - 頂点IDの配列
   * @returns {Vertex[]} 頂点オブジェクトの配列 (プレーンオブジェクトのコピー)
   * @private
   */
  _getVerticesByIds(vertexIds) {
      const worldRepository = this._editFeatureUseCase._worldRepository; // UseCase経由でアクセス
      const world = worldRepository._world; // キャッシュにアクセス（非推奨だが一時的）
      if (!world || !world.vertices) return [];
      const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
      return vertexIds
          .map(id => verticesMap.get(id))
          .filter(Boolean) // 見つからない場合は除外
          .map(v => ({ ...v })); // ディープコピーして返す (JSON.stringifyより軽量)
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
      case 'addingHoleTarget':
        return this._targetPolygonIdForHole;
      case 'temporaryElements':
        return this._temporaryElements;
      case 'draggingVertex': // ドラッグ状態の変更を通知
        return this._draggingVertexInfo;
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
