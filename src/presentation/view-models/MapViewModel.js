/**
 * マップビューのデータと状態管理
 */
export class MapViewModel {
  /**
   * マップビューモデルを作成
   * @param {EditFeatureUseCase} editFeatureUseCase - 地理オブジェクト編集ユースケース
   * @param {NavigateTimeUseCase} navigateTimeUseCase - 時間移動ユースケース
   * @param {ManageLayersUseCase} manageLayersUseCase - レイヤー管理ユースケース
   * @param {GeometryService} geometryService - 幾何学サービス
   * @param {EventBus} eventBus - イベントバス
   */
  constructor(
    editFeatureUseCase,
    navigateTimeUseCase,
    manageLayersUseCase,
    geometryService,
    eventBus
  ) {
    this._editFeatureUseCase = editFeatureUseCase;
    this._navigateTimeUseCase = navigateTimeUseCase;
    this._manageLayersUseCase = manageLayersUseCase;
    this._geometryService = geometryService;
    this._eventBus = eventBus;
    
    // マップの状態
    this._world = null;
    this._features = [];
    this._selectedFeature = null;
    this._selectedVertices = [];
    this._hoveredFeature = null;
    this._hoveredVertex = null;
    
    // 観測者の登録
    this._observers = [];
    
    // イベントリスナーの設定
    this._setupEventListeners();
  }

  /**
   * 世界データをロード
   * @returns {Promise<void>}
   */
  async loadWorld() {
    try {
      // 世界データを取得（リポジトリは外部から注入される）
      const worldRepository = this._editFeatureUseCase._worldRepository;
      this._world = await worldRepository.getWorld();
      
      // 現在の時間点に対応する地物をフィルタリング
      await this._loadFeaturesForCurrentTime();
      
      this._notifyObservers('world');
    } catch (error) {
      console.error('世界データのロードに失敗しました', error);
      throw error;
    }
  }

  /**
   * 現在の時間点に対応する地物をロード
   * @returns {Promise<void>}
   * @private
   */
  async _loadFeaturesForCurrentTime() {
    if (!this._world) return;
    
    const currentTime = this._navigateTimeUseCase.getCurrentTime();
    
    // 現在の時間点で存在する地物をフィルタリング
    this._features = this._world.features.filter(feature => 
      feature.existsAt(currentTime)
    );
    
    this._notifyObservers('features');
  }

  /**
   * イベントリスナーの設定
   * @private
   */
  _setupEventListeners() {
    // 時間変更イベントの購読
    this._eventBus.subscribe('TimeChanged', this._onTimeChanged.bind(this));
    
    // 地物追加イベントの購読
    this._eventBus.subscribe('FeatureAdded', this._onFeatureAdded.bind(this));
    
    // 地物更新イベントの購読
    this._eventBus.subscribe('FeatureUpdated', this._onFeatureUpdated.bind(this));
    
    // 地物削除イベントの購読
    this._eventBus.subscribe('FeatureDeleted', this._onFeatureDeleted.bind(this));
    
    // レイヤー表示変更イベントの購読
    this._eventBus.subscribe('LayerVisibilityChanged', this._onLayerVisibilityChanged.bind(this));
  }

  /**
   * 時間変更イベントのハンドラ
   * @param {Object} event - イベントデータ
   * @private
   */
  _onTimeChanged(event) {
    this._loadFeaturesForCurrentTime();
  }

  /**
   * 地物追加イベントのハンドラ
   * @param {Object} event - イベントデータ
   * @private
   */
  _onFeatureAdded(event) {
    if (!this._world) return;
    
    // 世界データを更新
    if (!this._world.features.some(f => f.id === event.feature.id)) {
      this._world.features.push(event.feature);
    }
    
    // 現在の時間点に対応する地物をリロード
    this._loadFeaturesForCurrentTime();
  }

  /**
   * 地物更新イベントのハンドラ
   * @param {Object} event - イベントデータ
   * @private
   */
  _onFeatureUpdated(event) {
    if (!this._world) return;
    
    // 世界データを更新
    const index = this._world.features.findIndex(f => f.id === event.feature.id);
    if (index !== -1) {
      this._world.features[index] = event.feature;
    }
    
    // 現在の時間点に対応する地物をリロード
    this._loadFeaturesForCurrentTime();
  }

  /**
   * 地物削除イベントのハンドラ
   * @param {Object} event - イベントデータ
   * @private
   */
  _onFeatureDeleted(event) {
    if (!this._world) return;
    
    // 世界データを更新
    const index = this._world.features.findIndex(f => f.id === event.featureId);
    if (index !== -1) {
      this._world.features.splice(index, 1);
    }
    
    // 選択中の地物が削除された場合、選択を解除
    if (this._selectedFeature && this._selectedFeature.id === event.featureId) {
      this._selectedFeature = null;
      this._selectedVertices = [];
      this._notifyObservers('selectedFeature');
    }
    
    // 現在の時間点に対応する地物をリロード
    this._loadFeaturesForCurrentTime();
  }

  /**
   * レイヤー表示変更イベントのハンドラ
   * @param {Object} event - イベントデータ
   * @private
   */
  _onLayerVisibilityChanged(event) {
    if (!this._world) return;
    
    // レイヤーデータを更新
    const index = this._world.layers.findIndex(l => l.id === event.layerId);
    if (index !== -1) {
      this._world.layers[index] = event.layer;
    }
    
    this._notifyObservers('layers');
  }

  /**
   * 地物を選択
   * @param {string} featureId - 選択する地物のID
   */
  selectFeature(featureId) {
    if (!this._world) return;
    
    const feature = this._features.find(f => f.id === featureId);
    this._selectedFeature = feature || null;
    this._selectedVertices = [];
    
    this._notifyObservers('selectedFeature');
  }

  /**
   * 頂点を選択
   * @param {string} vertexId - 選択する頂点のID
   * @param {boolean} [addToSelection=false] - 選択に追加するかどうか
   */
  selectVertex(vertexId, addToSelection = false) {
    if (!this._world) return;
    
    const vertex = this._world.vertices.find(v => v.id === vertexId);
    
    if (vertex) {
      if (addToSelection) {
        // 既に選択されている場合は選択解除、そうでなければ追加
        const index = this._selectedVertices.findIndex(v => v.id === vertexId);
        if (index !== -1) {
          this._selectedVertices.splice(index, 1);
        } else {
          this._selectedVertices.push(vertex);
        }
      } else {
        // 単一選択
        this._selectedVertices = [vertex];
      }
    } else if (!addToSelection) {
      // 選択解除
      this._selectedVertices = [];
    }
    
    this._notifyObservers('selectedVertices');
  }

  /**
   * 選択を解除
   */
  clearSelection() {
    this._selectedFeature = null;
    this._selectedVertices = [];
    
    this._notifyObservers('selectedFeature');
    this._notifyObservers('selectedVertices');
  }

  /**
   * 地物をホバー
   * @param {string} featureId - ホバーする地物のID
   */
  hoverFeature(featureId) {
    if (!this._world) return;
    
    const feature = this._features.find(f => f.id === featureId);
    if (this._hoveredFeature !== feature) {
      this._hoveredFeature = feature || null;
      this._notifyObservers('hoveredFeature');
    }
  }

  /**
   * 頂点をホバー
   * @param {string} vertexId - ホバーする頂点のID
   */
  hoverVertex(vertexId) {
    if (!this._world) return;
    
    const vertex = this._world.vertices.find(v => v.id === vertexId);
    if (this._hoveredVertex !== vertex) {
      this._hoveredVertex = vertex || null;
      this._notifyObservers('hoveredVertex');
    }
  }

  /**
   * 頂点を移動
   * @param {string} vertexId - 移動する頂点のID
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @returns {Promise<Object>} 更新情報
   */
  async moveVertex(vertexId, newPosition) {
    try {
      const result = await this._editFeatureUseCase.moveVertex(vertexId, newPosition);
      
      // 世界データを更新
      if (this._world) {
        const vertexIndex = this._world.vertices.findIndex(v => v.id === vertexId);
        if (vertexIndex !== -1) {
          this._world.vertices[vertexIndex] = result.vertex;
        }
        
        // 影響を受けた地物を更新
        for (const feature of result.affectedFeatures) {
          const featureIndex = this._world.features.findIndex(f => f.id === feature.id);
          if (featureIndex !== -1) {
            this._world.features[featureIndex] = feature;
          }
        }
      }
      
      // 選択された頂点も更新
      if (this._selectedVertices.some(v => v.id === vertexId)) {
        this._selectedVertices = this._selectedVertices.map(v => 
          v.id === vertexId ? result.vertex : v
        );
        this._notifyObservers('selectedVertices');
      }
      
      // ホバー中の頂点も更新
      if (this._hoveredVertex && this._hoveredVertex.id === vertexId) {
        this._hoveredVertex = result.vertex;
        this._notifyObservers('hoveredVertex');
      }
      
      // 地物をリロード
      await this._loadFeaturesForCurrentTime();
      
      return result;
    } catch (error) {
      console.error('頂点の移動に失敗しました', error);
      throw error;
    }
  }

  /**
   * 地物プロパティを更新
   * @param {string} featureId - 更新する地物のID
   * @param {Object} properties - 新しいプロパティ
   * @returns {Promise<Object>} 更新された地物
   */
  async updateFeatureProperties(featureId, properties) {
    try {
      const feature = await this._editFeatureUseCase.updateFeature(featureId, { properties });
      
      // 世界データを更新
      if (this._world) {
        const index = this._world.features.findIndex(f => f.id === featureId);
        if (index !== -1) {
          this._world.features[index] = feature;
        }
      }
      
      // 選択中の地物が更新された場合、選択も更新
      if (this._selectedFeature && this._selectedFeature.id === featureId) {
        this._selectedFeature = feature;
        this._notifyObservers('selectedFeature');
      }
      
      // 地物をリロード
      await this._loadFeaturesForCurrentTime();
      
      return feature;
    } catch (error) {
      console.error('地物プロパティの更新に失敗しました', error);
      throw error;
    }
  }

  /**
   * 地物を追加
   * @param {string} featureType - 地物タイプ ('point', 'line', 'polygon')
   * @param {Object} properties - プロパティ
   * @param {Object} geometry - 形状情報
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Object>} 追加された地物
   */
  async addFeature(featureType, properties, geometry, layerId) {
    try {
      const feature = await this._editFeatureUseCase.addFeature(
        featureType, properties, geometry, layerId
      );
      
      // イベントを発行
      this._eventBus.publish('FeatureAdded', { feature });
      
      return feature;
    } catch (error) {
      console.error('地物の追加に失敗しました', error);
      throw error;
    }
  }

  /**
   * 地物を削除
   * @param {string} featureId - 削除する地物のID
   * @returns {Promise<void>}
   */
  async deleteFeature(featureId) {
    try {
      await this._editFeatureUseCase.deleteFeature(featureId);
      
      // イベントを発行
      this._eventBus.publish('FeatureDeleted', { featureId });
    } catch (error) {
      console.error('地物の削除に失敗しました', error);
      throw error;
    }
  }

  /**
   * 2点間の距離を計算
   * @param {Object} point1 - 点1 { x, y }
   * @param {Object} point2 - 点2 { x, y }
   * @param {number} equatorLength - 赤道長（km）
   * @returns {Object} 距離情報 { linear, greatCircle }
   */
  calculateDistance(point1, point2, equatorLength) {
    const linearDistance = this._geometryService.calculateLinearDistanceInKm(
      point1.x, point1.y, point2.x, point2.y, equatorLength
    );
    
    const greatCircleDistance = this._geometryService.calculateGreatCircleDistance(
      point1.x, point1.y, point2.x, point2.y
    );
    
    return {
      linear: linearDistance,
      greatCircle: greatCircleDistance
    };
  }

  /**
   * 多角形の面積を計算
   * @param {string[]} vertexIds - 頂点IDの配列
   * @param {number} equatorLength - 赤道長（km）
   * @returns {number} 面積（km²）
   */
  calculatePolygonArea(vertexIds, equatorLength) {
    if (!this._world || !vertexIds || vertexIds.length < 3) return 0;
    
    const vertices = vertexIds
      .map(id => this._world.vertices.find(v => v.id === id))
      .filter(v => v);
    
    return this._geometryService.calculatePolygonAreaInKm2(vertices, equatorLength);
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
      case 'world':
        return this._world;
      case 'features':
        return this._features;
      case 'selectedFeature':
        return this._selectedFeature;
      case 'selectedVertices':
        return this._selectedVertices;
      case 'hoveredFeature':
        return this._hoveredFeature;
      case 'hoveredVertex':
        return this._hoveredVertex;
      case 'layers':
        return this._world ? this._world.layers : [];
      default:
        return null;
    }
  }

  /**
   * 世界データを取得
   * @returns {Object} 世界データ
   */
  getWorld() {
    return this._world;
  }

  /**
   * 現在表示中の地物を取得
   * @returns {Array} 地物の配列
   */
  getFeatures() {
    return this._features;
  }

  /**
   * 選択中の地物を取得
   * @returns {Object} 選択中の地物
   */
  getSelectedFeature() {
    return this._selectedFeature;
  }

  /**
   * 選択中の頂点を取得
   * @returns {Array} 選択中の頂点の配列
   */
  getSelectedVertices() {
    return this._selectedVertices;
  }

  /**
   * ホバー中の地物を取得
   * @returns {Object} ホバー中の地物
   */
  getHoveredFeature() {
    return this._hoveredFeature;
  }

  /**
   * ホバー中の頂点を取得
   * @returns {Object} ホバー中の頂点
   */
  getHoveredVertex() {
    return this._hoveredVertex;
  }

  /**
   * 現在の時間点を取得
   * @returns {TimePoint} 現在の時間点
   */
  getCurrentTime() {
    return this._navigateTimeUseCase.getCurrentTime();
  }
}