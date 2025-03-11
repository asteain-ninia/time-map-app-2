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
    this._temporaryElements = []; // 一時的な表示要素
    
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
   * 特徴の追加を確定
   * @param {Object} properties - プロパティ
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Object>} 追加された特徴
   */
  async confirmAddFeature(properties, layerId) {
    if (this._mode !== 'add' || !this._tool || this._addingPoints.length === 0) {
      throw new Error('特徴の追加状態ではありません');
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
            [properties],
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
            [properties],
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
            [properties],
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
      this._addToHistory({
        type: 'add',
        featureId: feature.id,
        featureType: this._tool
      });
      
      // 追加点をクリア
      this._clearAddingPoints();
      
      // イベントを発行
      this._eventBus.publish('FeatureAdded', { feature });
      
      return feature;
    } catch (error) {
      console.error('特徴の追加に失敗しました', error);
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
    try {
      const result = await this._editFeatureUseCase.moveVertex(vertexId, newPosition);
      
      // 操作履歴に追加
      this._addToHistory({
        type: 'moveVertex',
        vertexId,
        oldPosition,
        newPosition
      });
      
      return result;
    } catch (error) {
      console.error('頂点の移動に失敗しました', error);
      throw error;
    }
  }

  /**
   * 特徴を削除
   * @param {string} featureId - 削除する特徴のID
   * @param {Object} feature - 削除前の特徴データ（アンドゥ用）
   * @returns {Promise<void>}
   */
  async deleteFeature(featureId, feature) {
    try {
      await this._editFeatureUseCase.deleteFeature(featureId);
      
      // 操作履歴に追加
      this._addToHistory({
        type: 'delete',
        featureId,
        feature
      });
      
      // イベントを発行
      this._eventBus.publish('FeatureDeleted', { featureId });
    } catch (error) {
      console.error('特徴の削除に失敗しました', error);
      throw error;
    }
  }

  /**
   * 特徴プロパティを更新
   * @param {string} featureId - 更新する特徴のID
   * @param {Object} oldProperties - 古いプロパティ
   * @param {Object} newProperties - 新しいプロパティ
   * @returns {Promise<Object>} 更新された特徴
   */
  async updateFeatureProperties(featureId, oldProperties, newProperties) {
    try {
      const feature = await this._editFeatureUseCase.updateFeature(
        featureId, { properties: newProperties }
      );
      
      // 操作履歴に追加
      this._addToHistory({
        type: 'updateProperties',
        featureId,
        oldProperties,
        newProperties
      });
      
      // イベントを発行
      this._eventBus.publish('FeatureUpdated', { feature });
      
      return feature;
    } catch (error) {
      console.error('特徴プロパティの更新に失敗しました', error);
      throw error;
    }
  }

  /**
   * ポリゴンに穴を追加
   * @param {string} polygonId - ポリゴンID
   * @param {Array} holePoints - 穴の頂点配列
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
      const oldHolesVertexIds = polygon.holesVertexIds;
      
      // 頂点を作成
      const holeVertexIds = [];
      for (const point of holePoints) {
        const vertexId = `vertex-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        world.vertices.push({
          id: vertexId,
          x: point.x,
          y: point.y
        });
        holeVertexIds.push(vertexId);
      }
      
      // 穴を追加
      const newHolesVertexIds = [...oldHolesVertexIds, holeVertexIds];
      
      // ポリゴンを更新
      const updatedPolygon = await this._editFeatureUseCase.updateFeature(
        polygonId,
        { geometry: { holesVertexIds: newHolesVertexIds } }
      );
      
      // 操作履歴に追加
      this._addToHistory({
        type: 'addHole',
        polygonId,
        oldHolesVertexIds,
        newHolesVertexIds
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
    this._redoStack.push(operation);
    
    try {
      await this._executeReverseOperation(operation);
      this._notifyObservers('history');
    } catch (error) {
      // エラーが発生した場合、リドゥスタックから削除
      this._redoStack.pop();
      console.error('アンドゥに失敗しました', error);
      throw error;
    }
  }

  /**
   * リドゥ
   * @returns {Promise<void>}
   */
  async redo() {
    if (this._redoStack.length === 0) return;
    
    const operation = this._redoStack.pop();
    this._undoStack.push(operation);
    
    try {
      await this._executeOperation(operation);
      this._notifyObservers('history');
    } catch (error) {
      // エラーが発生した場合、アンドゥスタックから削除
      this._undoStack.pop();
      console.error('リドゥに失敗しました', error);
      throw error;
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
   * 操作を実行
   * @param {Object} operation - 操作情報
   * @returns {Promise<void>}
   * @private
   */
  async _executeOperation(operation) {
    // 操作タイプに応じた処理
    switch (operation.type) {
      case 'add':
        // 特徴の再追加は未実装
        break;
        
      case 'delete':
        // 削除した特徴の復元は未実装
        break;
        
      case 'moveVertex':
        await this._editFeatureUseCase.moveVertex(
          operation.vertexId,
          operation.newPosition
        );
        break;
        
      case 'updateProperties':
        await this._editFeatureUseCase.updateFeature(
          operation.featureId,
          { properties: operation.newProperties }
        );
        break;
        
      case 'addHole':
        await this._editFeatureUseCase.updateFeature(
          operation.polygonId,
          { geometry: { holesVertexIds: operation.newHolesVertexIds } }
        );
        break;
        
      default:
        throw new Error(`未対応の操作タイプ: ${operation.type}`);
    }
  }

  /**
   * 逆操作を実行
   * @param {Object} operation - 操作情報
   * @returns {Promise<void>}
   * @private
   */
  async _executeReverseOperation(operation) {
    // 操作タイプに応じた逆処理
    switch (operation.type) {
      case 'add':
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        this._eventBus.publish('FeatureDeleted', { featureId: operation.featureId });
        break;
        
      case 'delete':
        // 削除した特徴の復元は未実装
        break;
        
      case 'moveVertex':
        await this._editFeatureUseCase.moveVertex(
          operation.vertexId,
          operation.oldPosition
        );
        break;
        
      case 'updateProperties':
        const feature = await this._editFeatureUseCase.updateFeature(
          operation.featureId,
          { properties: operation.oldProperties }
        );
        this._eventBus.publish('FeatureUpdated', { feature });
        break;
        
      case 'addHole':
        const updatedPolygon = await this._editFeatureUseCase.updateFeature(
          operation.polygonId,
          { geometry: { holesVertexIds: operation.oldHolesVertexIds } }
        );
        this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
        break;
        
      default:
        throw new Error(`未対応の操作タイプ: ${operation.type}`);
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