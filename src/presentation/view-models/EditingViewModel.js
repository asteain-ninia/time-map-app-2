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
    this._tool = null; // 'point', 'line', 'polygon'
    this._addingPoints = []; // 追加中の点の配列
    this._isAddingHole = false;
    this._temporaryElements = []; // 一時的な表示要素 (MapViewで描画)

    // アンドゥ・リドゥの状態
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistorySize = 100;

    // 観測者の登録
    this._observers = [];
  }

  /**
   * 編集モードを設定
   * @param {string} mode - モード ('view', 'add', 'edit')
   */
  setMode(mode) {
    if (this._mode !== mode) {
      // 追加作業中のデータをクリア
      if (this._mode === 'add' && this._addingPoints.length > 0) {
        this._clearAddingPoints();
      }
      // 編集モード終了時に一時要素クリア
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
   * @param {string} tool - ツール ('point', 'line', 'polygon', 'select', ...)
   */
  setTool(tool) {
    if (this._tool !== tool) {
      // 追加作業中のデータをクリア
      if (this._mode === 'add' && this._addingPoints.length > 0) {
        this._clearAddingPoints();
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
   * 穴追加モードを設定
   * @param {boolean} isAddingHole - 穴追加モードかどうか
   */
  setAddingHole(isAddingHole) {
    if (this._isAddingHole !== isAddingHole) {
      this._isAddingHole = isAddingHole;

      if (!isAddingHole) {
        this._clearAddingPoints();
      }

      this._notifyObservers('addingHole');
    }
  }

  /**
   * 穴追加モードを取得
   * @returns {boolean} 穴追加モードならtrue
   */
  isAddingHole() {
    return this._isAddingHole;
  }

  /**
   * 点を追加（オブジェクト追加モード用）
   * @param {Object} point - 追加する点 { x, y }
   */
  addPoint(point) {
    if (this._mode !== 'add' || !this._tool) return;

    this._addingPoints.push(point);

    this._notifyObservers('addingPoints');
  }

  /**
   * 最後の点を削除（オブジェクト追加モード用）
   */
  removeLastPoint() {
    if (this._addingPoints.length > 0) {
      this._addingPoints.pop();
      this._notifyObservers('addingPoints');
    }
  }

  /**
   * 追加中の点をクリア
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
   * @param {Object} properties - プロパティ
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Object>} 追加された地物
   */
  async confirmAddFeature(properties, layerId) {
    if (this._mode !== 'add' || !this._tool || this._addingPoints.length === 0) {
      throw new Error('地物の追加状態ではありません');
    }

    try {
      let feature;

      // ツールタイプに応じた処理
      switch (this._tool) {
        case 'point':
          if (this._addingPoints.length !== 1) {
            throw new Error('点情報は1つの点のみを持つ必要があります');
          }

          feature = await this._editFeatureUseCase.addFeature(
            'point',
            properties,
            { vertices: this._addingPoints },
            layerId
          );
          break;

        case 'line':
          if (this._addingPoints.length < 2) {
            throw new Error('線情報は少なくとも2つの点が必要です');
          }

          feature = await this._editFeatureUseCase.addFeature(
            'line',
            properties,
            { vertices: this._addingPoints },
            layerId
          );
          break;

        case 'polygon':
          if (this._addingPoints.length < 3) {
            throw new Error('面情報は少なくとも3つの点が必要です');
          }

          feature = await this._editFeatureUseCase.addFeature(
            'polygon',
            properties,
            {
              vertices: this._addingPoints,
              holesVertexIds: [],
              parentId: "0"
            },
            layerId
          );
          break;

        default:
          throw new Error(`未対応のツールタイプ: ${this._tool}`);
      }

      // 操作履歴に追加
      // 注意: `feature` オブジェクト全体を履歴に含めるとメモリ使用量が増える可能性がある。
      //       アンドゥに必要な最小限の情報（例：ID、追加前の状態など）を保存する方が良い場合がある。
      this._addToHistory({
        type: 'add',
        featureId: feature.id,
        featureType: this._tool,
        featureData: feature // アンドゥ用に完全なデータを保持（要検討）
      });

      // 追加点をクリア
      this._clearAddingPoints();

      // イベントを発行
      this._eventBus.publish('FeatureAdded', { feature });

      return feature;
    } catch (error) {
      console.error('地物の追加に失敗しました', error);
      throw error;
    }
  }

  /**
   * 頂点を移動
   * @param {string} vertexId - 移動する頂点のID
   * @param {Object} oldPosition - 元の位置 { x, y }
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @returns {Promise<Object>} 移動結果
   */
  async moveVertex(vertexId, oldPosition, newPosition) {
    // console.log(`moveVertex called: ${vertexId}, old:`, oldPosition, `new:`, newPosition);
    if (!vertexId || !oldPosition || !newPosition) {
        console.error("Invalid arguments for moveVertex");
        throw new Error("Invalid arguments for moveVertex");
    }
    try {
      // 実際の移動処理は EditFeatureUseCase に任せる
      const result = await this._editFeatureUseCase.moveVertex(vertexId, newPosition);

      // 操作履歴に追加
      this._addToHistory({
        type: 'moveVertex',
        vertexId: vertexId,
        oldPosition: oldPosition, // 移動「前」の位置を保存
        newPosition: newPosition  // 移動「後」の位置を保存
      });

      // MapViewModel で World データが更新され、イベントは不要かもしれない
      // this._eventBus.publish('VertexMoved', { vertex: result.vertex, affectedFeatures: result.affectedFeatures });

      return result;
    } catch (error) {
      console.error('頂点の移動に失敗しました', error);
      throw error;
    }
  }

  /**
   * 地物を削除
   * @param {string} featureId - 削除する地物のID
   * @param {Object} feature - 削除前の地物データ（アンドゥ用）
   * @returns {Promise<void>}
   */
  async deleteFeature(featureId, feature) {
    try {
      await this._editFeatureUseCase.deleteFeature(featureId);

      // 操作履歴に追加
      this._addToHistory({
        type: 'delete',
        featureId,
        featureData: feature // 削除された地物のデータを保持（アンドゥ用）
      });

      // イベントを発行
      this._eventBus.publish('FeatureDeleted', { featureId });
    } catch (error) {
      console.error('地物の削除に失敗しました', error);
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
    try {
      // oldProperties と newProperties は Property インスタンスの配列である想定
      const feature = await this._editFeatureUseCase.updateFeature(
        featureId, { properties: newProperties }
      );

      // 操作履歴に追加
      this._addToHistory({
        type: 'updateProperties',
        featureId,
        oldProperties: oldProperties, // 更新「前」のプロパティ配列を保存
        newProperties: newProperties  // 更新「後」のプロパティ配列を保存
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
    try {
      if (holePoints.length < 3) {
        throw new Error('穴は少なくとも3つの点が必要です');
      }

      // ポリゴンを取得
      const worldRepository = this._editFeatureUseCase._worldRepository;
      const world = await worldRepository.getWorld();

      const polygon = world.features.find(f => f.id === polygonId);
      if (!polygon) {
        throw new Error(`ポリゴンが見つかりません: ${polygonId}`);
      }

      // 古い穴配列を保存（アンドゥ用）
      const oldHolesVertexIds = polygon.holesVertexIds.map(hole => [...hole]); // ディープコピー

      // 新しい頂点を作成し、頂点IDを取得
      const newHoleVertexIds = [];
      const tempVertices = []; // アンドゥ用に作成した頂点も記録
      for (const point of holePoints) {
          const vertexId = this._editFeatureUseCase._generateId('vertex'); // UseCaseのID生成を利用
          tempVertices.push({ id: vertexId, x: point.x, y: point.y });
          newHoleVertexIds.push(vertexId);
      }
      // 作成した頂点をワールドデータに追加
      world.vertices.push(...tempVertices);

      // 穴を追加
      const newHolesVertexIds = [...oldHolesVertexIds, newHoleVertexIds];

      // ポリゴンを更新 (更新対象の geometry を渡す)
      const updatedPolygon = await this._editFeatureUseCase.updateFeature(
        polygonId,
        { geometry: { holesVertexIds: newHolesVertexIds } } // geometry オブジェクトで渡す
      );

      // 操作履歴に追加
      this._addToHistory({
        type: 'addHole',
        polygonId,
        oldHolesVertexIds,
        newHolesVertexIds: newHoleVertexIds, // 追加された穴の頂点ID
        addedVertices: tempVertices // 追加された頂点の情報
      });

      // イベントを発行
      this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });

      // 穴追加モードを終了
      this.setAddingHole(false);

      return updatedPolygon;
    } catch (error) {
      console.error('穴の追加に失敗しました', error);
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
    this._temporaryElements = [];
    this._notifyObservers('temporaryElements');
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
        // 削除された地物を復元 (addFeature を直接呼ぶのではなく、データ復元が必要)
        const worldRepository = this._editFeatureUseCase._worldRepository;
        const world = await worldRepository.getWorld();
        // 頂点も復元する必要があるかもしれない
        if (operation.featureData && !world.features.some(f => f.id === operation.featureId)) {
            world.features.push(operation.featureData); // 保存しておいたデータを追加
            // TODO: 頂点データも復元する必要があるか確認
            await worldRepository.saveWorld(world);
            this._eventBus.publish('FeatureAdded', { feature: operation.featureData });
        } else {
             console.warn("Redo add: Feature already exists or data missing.", operation.featureId);
        }
        break;

      case 'delete':
         // 地物を再度削除
         await this._editFeatureUseCase.deleteFeature(operation.featureId);
         this._eventBus.publish('FeatureDeleted', { featureId: operation.featureId });
        break;

      case 'moveVertex':
        // 頂点を新しい位置に再度移動
        await this._editFeatureUseCase.moveVertex(
          operation.vertexId,
          operation.newPosition // Redoなので newPosition を使う
        );
         // MapViewModel の更新通知に任せる
        break;

      case 'updateProperties':
        // プロパティを新しい状態に再度更新
        const updatedFeature = await this._editFeatureUseCase.updateFeature(
          operation.featureId,
          { properties: operation.newProperties } // Redoなので newProperties を使う
        );
         this._eventBus.publish('FeatureUpdated', { feature: updatedFeature });
        break;

      case 'addHole':
        // 穴を再度追加
        const updatedPolygon = await this._editFeatureUseCase.updateFeature(
          operation.polygonId,
          { geometry: { holesVertexIds: operation.newHolesVertexIds } } // Redoなので newHolesVertexIds を使う
        );
         // 穴追加時に作成された頂点も復元する必要がある
         const repo = this._editFeatureUseCase._worldRepository;
         const w = await repo.getWorld();
         if (operation.addedVertices) {
             operation.addedVertices.forEach(v => {
                 if (!w.vertices.some(wv => wv.id === v.id)) {
                     w.vertices.push(v);
                 }
             });
             await repo.saveWorld(w);
         }
         this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
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
    switch (operation.type) {
      case 'add':
        // 追加された地物を削除
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        this._eventBus.publish('FeatureDeleted', { featureId: operation.featureId });
        break;

      case 'delete':
        // 削除された地物を復元 (addFeature を直接呼ぶのではなく、データ復元が必要)
        const worldRepository = this._editFeatureUseCase._worldRepository;
        const world = await worldRepository.getWorld();
         // 頂点も復元する必要があるかもしれない
        if (operation.featureData && !world.features.some(f => f.id === operation.featureId)) {
            world.features.push(operation.featureData); // 保存しておいたデータを追加
            // TODO: 頂点データも復元する必要があるか確認
            await worldRepository.saveWorld(world);
            this._eventBus.publish('FeatureAdded', { feature: operation.featureData });
        } else {
             console.warn("Undo delete: Feature already exists or data missing.", operation.featureId);
        }
        break;

      case 'moveVertex':
        // 頂点を元の位置に戻す
        await this._editFeatureUseCase.moveVertex(
          operation.vertexId,
          operation.oldPosition // Undoなので oldPosition を使う
        );
         // MapViewModel の更新通知に任せる
        break;

      case 'updateProperties':
        // プロパティを元の状態に戻す
        const feature = await this._editFeatureUseCase.updateFeature(
          operation.featureId,
          { properties: operation.oldProperties } // Undoなので oldProperties を使う
        );
        this._eventBus.publish('FeatureUpdated', { feature });
        break;

      case 'addHole':
         // 追加された穴を削除（＝元の状態に戻す）
         const updatedPolygon = await this._editFeatureUseCase.updateFeature(
           operation.polygonId,
           { geometry: { holesVertexIds: operation.oldHolesVertexIds } } // Undoなので oldHolesVertexIds を使う
         );
          // 穴追加時に作成された頂点も削除
          const repo = this._editFeatureUseCase._worldRepository;
          const w = await repo.getWorld();
          if (operation.addedVertices) {
              operation.addedVertices.forEach(v => {
                  const index = w.vertices.findIndex(wv => wv.id === v.id);
                  if (index !== -1) {
                      w.vertices.splice(index, 1);
                  }
              });
              await repo.saveWorld(w);
          }
          this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
        break;

      default:
        console.warn(`未対応の操作タイプ (Undo): ${operation.type}`);
        // throw new Error(`未対応の操作タイプ: ${operation.type}`);
    }
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
      observer(type, data);
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
      case 'addingHole':
        return this._isAddingHole;
      case 'temporaryElements':
        return this._temporaryElements;
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
