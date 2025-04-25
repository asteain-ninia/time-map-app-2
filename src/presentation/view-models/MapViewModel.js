import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
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
    this._selectedFeatureId = null; // (string | null) 主選択されている地物のID
    this._selectedVertexIds = new Set(); // (Set<string>) 主選択されている頂点のIDセット
    this._highlightedFeatureId = null; // (string | null) 暗黙的にハイライトする地物のID
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

    // 選択中の地物が現在の時間で存在しない場合は選択を解除
    if (this._selectedFeatureId && !this._features.some(f => f.id === this._selectedFeatureId)) {
        this.clearSelection();
    }
    // 選択中の頂点が現在の時間で存在しない地物に属する場合も解除
    // また、world.vertices に存在しない頂点IDも選択から除外する
    if (this._selectedVertexIds.size > 0) {
        const currentVertexIds = new Set(this._world.vertices.map(v => v.id));
        const existingSelectedVertexIds = new Set();
        let selectionChanged = false;
        this._selectedVertexIds.forEach(id => {
            if (currentVertexIds.has(id)) {
                // さらに、この頂点が現在の時間で表示されている地物のいずれかに属しているかチェック
                 const vertexIsVisible = this._features.some(f =>
                    (f.vertexIds && f.vertexIds.includes(id)) ||
                    (f instanceof DomainPolygon && f.holesVertexIds?.some(hole => hole.includes(id))) ||
                    (f instanceof DomainPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds?.includes(id)))
                 );
                 if (vertexIsVisible) {
                    existingSelectedVertexIds.add(id);
                 } else {
                    selectionChanged = true;
                 }
            } else {
                selectionChanged = true;
            }
        });
        if (selectionChanged) {
            this._selectedVertexIds = existingSelectedVertexIds;
            this._notifyObservers('selectedVertices'); // 頂点選択の変更を通知
             // ハイライト地物も再評価
            if (this._selectedVertexIds.size === 0) {
                this._highlightedFeatureId = null;
                this._notifyObservers('highlightedFeature');
            } else {
                 // ハイライト地物の再計算（最初の選択頂点から）
                this._updateHighlightedFeature();
            }
        }
    }

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
     // ViewModel内部のイベントで選択を解除
    this._eventBus.subscribe('ClearSelection', this.clearSelection.bind(this));
     // 頂点移動イベントの購読 (複数移動にも対応できるように)
     this._eventBus.subscribe('VertexMoved', this._onVertexMoved.bind(this));
     // 頂点削除イベントの購読
     this._eventBus.subscribe('VerticesDeleted', this._onVerticesDeleted.bind(this));
  }

  /**
   * 時間変更イベントのハンドラ
   * @param {Object} event - イベントデータ
   * @private
   */
  _onTimeChanged(event) {
    // _loadFeaturesForCurrentTime内で選択解除処理を行うため、ここでの追加処理は不要
    this._loadFeaturesForCurrentTime();
  }

  /**
   * 地物追加イベントのハンドラ
   * @param {Object} event - イベントデータ { feature }
   * @private
   */
  _onFeatureAdded(event) {
    if (!this._world || !event.feature) return;

    // 世界データを更新
    if (!this._world.features.some(f => f.id === event.feature.id)) {
      this._world.features.push(event.feature);
    }

    // 現在の時間点に対応する地物をリロード
    this._loadFeaturesForCurrentTime();
  }

  /**
   * 地物更新イベントのハンドラ
   * @param {Object} event - イベントデータ { feature }
   * @private
   */
  _onFeatureUpdated(event) {
    if (!this._world || !event.feature) return;

    // 世界データを更新
    const index = this._world.features.findIndex(f => f.id === event.feature.id);
    if (index !== -1) {
      this._world.features[index] = event.feature;
    } else {
      // 更新対象が見つからない場合は追加 (アンドゥ/リドゥで発生する可能性)
      this._world.features.push(event.feature);
    }


    // 現在の時間点に対応する地物をリロード
    this._loadFeaturesForCurrentTime();
  }

  /**
   * 地物削除イベントのハンドラ
   * @param {Object} event - イベントデータ { featureId }
   * @private
   */
  _onFeatureDeleted(event) {
    if (!this._world || !event.featureId) return;

    let selectionCleared = false;
    // 削除された地物が主選択されていた場合
    if (this._selectedFeatureId === event.featureId) {
      this.clearSelection();
      selectionCleared = true;
    }
    // 削除された地物がハイライトされていた場合
    else if (this._highlightedFeatureId === event.featureId) {
        this._highlightedFeatureId = null;
        // 頂点選択は維持されるが、ハイライト地物のみクリア
        this._notifyObservers('highlightedFeature');
    }
    // 削除された地物に属する頂点が選択されていた場合 (deleteVerticesで処理されるべきだが念のため)
    else if (this._selectedVertexIds.size > 0) {
        // _world.features から削除される前のデータを参照するのは危険なので、
        // _onVerticesDeleted で頂点選択解除を行う
        // ここでは何もしない、または _highlightedFeatureId の再計算のみ行う
        this._updateHighlightedFeature(); // 選択頂点が変わる可能性があるため
    }

    // 世界データを更新
    const index = this._world.features.findIndex(f => f.id === event.featureId);
    if (index !== -1) {
      this._world.features.splice(index, 1);
    }

    // 地物をリロード (選択解除後に行う)
    this._loadFeaturesForCurrentTime();
  }

  /**
   * レイヤー表示変更イベントのハンドラ
   * @param {Object} event - イベントデータ { layerId, layer }
   * @private
   */
  _onLayerVisibilityChanged(event) {
    if (!this._world || !event.layer) return;

    // レイヤーデータを更新
    const index = this._world.layers.findIndex(l => l.id === event.layerId);
    if (index !== -1) {
      this._world.layers[index] = event.layer;
    }

    this._notifyObservers('layers');
     // レイヤー非表示になった場合、関連する選択を解除
     if (!event.layer.visible) {
         this._clearSelectionForLayer(event.layerId);
     }
  }

  /**
   * 特定レイヤーに関連する選択を解除するヘルパー
   * @param {string} layerId - 非表示になったレイヤーID
   * @private
   */
  _clearSelectionForLayer(layerId) {
    let selectionChanged = false;

    // 選択中の地物がこのレイヤーに属していれば解除
    if (this._selectedFeatureId) {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && selectedFeature.layerId === layerId) {
            this.clearSelection();
            return; // 地物選択が解除されれば頂点選択もクリアされる
        }
    }

    // 選択中の頂点がこのレイヤーの地物にのみ属していれば解除
    if (this._selectedVertexIds.size > 0) {
        const newSelectedVertexIds = new Set();
        this._selectedVertexIds.forEach(vertexId => {
            const belongsToVisibleLayer = this._world.features.some(f =>
                f.layerId !== layerId && // このレイヤー以外で
                this._world.layers.find(l => l.id === f.layerId)?.visible && // 表示されているレイヤーに属し
                ((f.vertexIds && f.vertexIds.includes(vertexId)) ||
                 (f instanceof DomainPolygon && f.holesVertexIds?.some(h => h.includes(vertexId))) ||
                 (f instanceof DomainPolygon && f.isMultiPolygon && f.subPolygons?.some(s => s.vertexIds?.includes(vertexId))))
            );
            if (belongsToVisibleLayer) {
                newSelectedVertexIds.add(vertexId); // 表示レイヤーにも属していれば維持
            } else {
                selectionChanged = true; // このレイヤーにしか属していなければ解除
            }
        });

        if (selectionChanged) {
            this._selectedVertexIds = newSelectedVertexIds;
            this._notifyObservers('selectedVertices');
            this._updateHighlightedFeature(); // ハイライトも更新
        }
    }
  }

  /**
   * 頂点移動イベントのハンドラ
   * @param {Object} event - イベントデータ { vertexId, newPosition }
   * @private
   */
  _onVertexMoved(event) {
    if (!this._world || !event.vertexId || !event.newPosition) return;

    // World内の頂点データを更新
    const vertexIndex = this._world.vertices.findIndex(v => v.id === event.vertexId);
    if (vertexIndex !== -1) {
        // プレーンオブジェクトを更新
        this._world.vertices[vertexIndex] = {
            id: event.vertexId,
            x: event.newPosition.x,
            y: event.newPosition.y
        };
    }

    // 選択中の頂点オブジェクト配列はゲッターで最新が返るので更新不要
    // ホバー中の頂点も更新
    if (this._hoveredVertex && this._hoveredVertex.id === event.vertexId) {
        this._hoveredVertex = this._world.vertices[vertexIndex] || null;
        this._notifyObservers('hoveredVertex');
    }

    // 地物の形状はインスタンスが不変なので、再描画時に新しい頂点座標が使われる
    this._notifyObservers('features'); // 再描画をトリガー
  }

  /**
   * 頂点削除イベントのハンドラ
   * @param {Object} event - イベントデータ { deletedVertexIds: string[] }
   * @private
   */
  _onVerticesDeleted(event) {
    if (!this._world || !event.deletedVertexIds || event.deletedVertexIds.length === 0) return;

    const deletedIdsSet = new Set(event.deletedVertexIds);
    let selectionChanged = false;

    // 削除された頂点を選択セットから削除
    if (this._selectedVertexIds.size > 0) {
        this._selectedVertexIds.forEach(id => {
            if (deletedIdsSet.has(id)) {
                this._selectedVertexIds.delete(id);
                selectionChanged = true;
            }
        });
    }

    // World内の頂点リストからも削除 (UseCaseで削除済みのはずだが念のため同期)
    this._world.vertices = this._world.vertices.filter(v => !deletedIdsSet.has(v.id));

    // ホバー中の頂点が削除された場合
    if (this._hoveredVertex && deletedIdsSet.has(this._hoveredVertex.id)) {
        this._hoveredVertex = null;
        this._notifyObservers('hoveredVertex');
    }

    if (selectionChanged) {
        this._notifyObservers('selectedVertices');
        this._updateHighlightedFeature(); // ハイライトも更新
    }

    // 地物リストは UseCase -> onFeatureUpdated/onFeatureDeleted で更新されるはず
    // ここでは再描画トリガーのみ
    this._notifyObservers('features');
  }

  /**
   * 地物を選択
   * @param {string} featureId - 選択する地物のID
   */
  selectFeature(featureId) {
    if (!this._world) return;

    const feature = this._features.find(f => f.id === featureId);
    const newSelectedFeatureId = feature ? feature.id : null;

    if (this._selectedFeatureId !== newSelectedFeatureId || this._selectedVertexIds.size > 0 || this._highlightedFeatureId !== null) {
        this._selectedFeatureId = newSelectedFeatureId;
        this._selectedVertexIds.clear(); // 地物選択時は頂点選択をクリア
        this._highlightedFeatureId = null; // 地物選択時はハイライトもクリア

        this._notifyObservers('selectedFeature');
        this._notifyObservers('selectedVertices');
        this._notifyObservers('highlightedFeature');
    }
  }

  /**
   * 頂点を選択
   * @param {string} vertexId - 選択する頂点のID
   * @param {boolean} [addToSelection=false] - 選択に追加するかどうか
   */
  selectVertex(vertexId, addToSelection = false) {
    if (!this._world) return;

    const vertex = this._world.vertices.find(v => v.id === vertexId);
    if (!vertex) {
         // 存在しない頂点を選択しようとした場合（またはクリック等で選択解除の場合）
         if (!addToSelection) {
             if (this._selectedVertexIds.size > 0 || this._selectedFeatureId !== null || this._highlightedFeatureId !== null) {
                 this.clearSelection();
             }
         }
         return; // 存在しない頂点は選択できない
    }

    let vertexSelectionChanged = false;
    const newSelectedVertexIds = addToSelection ? new Set(this._selectedVertexIds) : new Set();

    if (addToSelection) {
      if (newSelectedVertexIds.has(vertexId)) {
        newSelectedVertexIds.delete(vertexId); // 既に選択されている場合は解除
        vertexSelectionChanged = true;
      } else {
        newSelectedVertexIds.add(vertexId); // 新しく追加
        vertexSelectionChanged = true;
      }
    } else {
      if (!newSelectedVertexIds.has(vertexId) || newSelectedVertexIds.size !== 1) {
        newSelectedVertexIds.clear();
        newSelectedVertexIds.add(vertexId); // 単一選択
        vertexSelectionChanged = true;
      }
      // すでに単一選択されている頂点を再度クリックした場合は何もしない
    }

    // 主選択状態の変更
    if (vertexSelectionChanged || this._selectedFeatureId !== null) {
        this._selectedVertexIds = newSelectedVertexIds;
        const oldSelectedFeatureId = this._selectedFeatureId;
        this._selectedFeatureId = null; // 頂点選択時は地物の主選択を解除

        this._updateHighlightedFeature(); // ハイライト地物を更新

        this._notifyObservers('selectedVertices');
        if (oldSelectedFeatureId !== null) {
            this._notifyObservers('selectedFeature');
        }
        // ハイライト地物の通知は _updateHighlightedFeature 内で行われる
    }
  }

  /**
   * ハイライト対象の地物を更新 (内部用)
   * @private
   */
  _updateHighlightedFeature() {
      let newHighlightedFeatureId = null;
      if (this._selectedVertexIds.size > 0) {
          // 選択された頂点のいずれかが属する地物を探す（最初の1つで良い）
          const firstSelectedVertexId = this._selectedVertexIds.values().next().value;
          const ownerFeature = this._features.find(f =>
              (f.vertexIds && f.vertexIds.includes(firstSelectedVertexId)) ||
              (f instanceof DomainPolygon && f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(firstSelectedVertexId))) ||
              (f instanceof DomainPolygon && f.subPolygons && f.subPolygons.some(sub => sub.vertexIds?.includes(firstSelectedVertexId)))
          );
          newHighlightedFeatureId = ownerFeature ? ownerFeature.id : null;
      }

      if (this._highlightedFeatureId !== newHighlightedFeatureId) {
          this._highlightedFeatureId = newHighlightedFeatureId;
          this._notifyObservers('highlightedFeature');
      }
  }

  /**
   * 選択を解除
   */
  clearSelection() {
    const changedFeature = this._selectedFeatureId !== null;
    const changedVertices = this._selectedVertexIds.size > 0;
    const changedHighlight = this._highlightedFeatureId !== null;

    this._selectedFeatureId = null;
    this._selectedVertexIds.clear();
    this._highlightedFeatureId = null;

    if (changedFeature) {
        this._notifyObservers('selectedFeature');
    }
    if (changedVertices) {
        this._notifyObservers('selectedVertices');
    }
    if (changedHighlight) {
        this._notifyObservers('highlightedFeature');
    }
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
   * 頂点を移動 (Deprecated: UseCase 経由で行うべき)
   * @param {string} vertexId - 移動する頂点のID
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @returns {Promise<Object>} 更新情報
   * @deprecated Use EditingViewModel.endVerticesDrag which calls EditFeatureUseCase.moveVertices
   */
  async moveVertex(vertexId, newPosition) {
     console.warn("MapViewModel.moveVertex is deprecated. Vertex movement should be handled via EditingViewModel and EditFeatureUseCase.");
     // このメソッドは実際には使われないはず
     try {
       const result = await this._editFeatureUseCase.moveVertex(vertexId, newPosition);
       // イベント発行は onVertexMoved で処理される
       return result;
     } catch (error) {
       console.error('頂点の移動に失敗しました', error);
       throw error;
     }
  }

  /**
   * 地物プロパティを更新
   * @param {string} featureId - 更新する地物のID
   * @param {Object} properties - 新しいプロパティ (Propertyインスタンスの配列)
   * @returns {Promise<Object>} 更新された地物
   */
  async updateFeatureProperties(featureId, properties) {
    // Note: このメソッドは SidebarView から呼ばれる可能性がある
    // EditingViewModel 経由で呼び出す方が一貫性があるかもしれないが、現状維持
    try {
      // アンドゥのために古いプロパティ情報を取得
      const featureBefore = this._world?.features.find(f => f.id === featureId);
      if (!featureBefore) throw new Error("Feature not found for property update.");
      const oldPropertiesPlain = featureBefore.properties.map(p => this._editingViewModel._serializeForHistory(p)).filter(Boolean);
      const newPropertiesPlain = properties.map(p => this._editingViewModel._serializeForHistory(p)).filter(Boolean);

      // EditingViewModelのメソッドを呼び出して履歴管理も行う
      const feature = await this._editingViewModel.updateFeatureProperties(
          featureId,
          oldPropertiesPlain,
          newPropertiesPlain
      );

      // Note: _onFeatureUpdated で ViewModel 内部状態は更新されるはず

      return feature;
    } catch (error) {
      console.error('地物プロパティの更新に失敗しました', error);
      throw error;
    }
  }

  /**
   * 地物を追加 (Deprecated: UseCase 経由で行うべき)
   * @param {string} featureType - 地物タイプ ('point', 'line', 'polygon')
   * @param {Object} properties - プロパティ
   * @param {Object} geometry - 形状情報
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Object>} 追加された地物
   * @deprecated Use EditingViewModel.confirmAddFeature which calls EditFeatureUseCase.addFeature
   */
  async addFeature(featureType, properties, geometry, layerId) {
    console.warn("MapViewModel.addFeature is deprecated. Feature addition should be handled via EditingViewModel and EditFeatureUseCase.");
    // このメソッドは実際には使われないはず
    try {
      const feature = await this._editFeatureUseCase.addFeature(
        featureType, properties, geometry, layerId
      );
      // イベント発行は onFeatureAdded で処理される
      return feature;
    } catch (error) {
      console.error('地物の追加に失敗しました', error);
      throw error;
    }
  }

  /**
   * 地物を削除 (Deprecated: UseCase 経由で行うべき)
   * @param {string} featureId - 削除する地物のID
   * @returns {Promise<void>}
   * @deprecated Use EditingViewModel.deleteFeature which calls EditFeatureUseCase.deleteFeature
   */
  async deleteFeature(featureId) {
     console.warn("MapViewModel.deleteFeature is deprecated. Feature deletion should be handled via EditingViewModel and EditFeatureUseCase.");
     // SidebarView から呼ばれる場合のために EditingViewModel 経由で呼び出す
     try {
        const featureToDelete = this._world?.features.find(f => f.id === featureId);
        if (featureToDelete) {
             await this._editingViewModel.deleteFeature(featureId, featureToDelete);
             // イベント発行は onFeatureDeleted で処理される
        } else {
             console.error(`Feature with ID ${featureId} not found for deletion.`);
        }
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
      case 'selectedFeature': // 主選択地物の変更
        return this.getSelectedFeature(); // ゲッター経由で返す
      case 'selectedVertices': // 主選択頂点の変更
        return this.getSelectedVertices(); // ゲッター経由で返す
      case 'highlightedFeature': // ハイライト地物の変更
        return this.getHighlightedFeature(); // ゲッター経由で返す
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
   * 選択中の地物IDを取得
   * @returns {string | null} 選択中の地物ID
   */
  getSelectedFeatureId() {
      return this._selectedFeatureId;
  }

  /**
   * 選択中の頂点IDのSetを取得
   * @returns {Set<string>} 選択中の頂点IDのSet
   */
  getSelectedVertexIds() {
      return new Set(this._selectedVertexIds); // コピーを返す
  }

  /**
   * ハイライト中の地物IDを取得
   * @returns {string | null} ハイライト中の地物ID
   */
  getHighlightedFeatureId() {
      return this._highlightedFeatureId;
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
   * 選択中の地物オブジェクトを取得
   * @returns {Object | null} 選択中の地物オブジェクト、またはnull
   */
  getSelectedFeature() {
    if (!this._world || !this._selectedFeatureId) return null;
    // _features からではなく _world.features から探す (時間フィルタリングの影響を受けないように)
    return this._world.features.find(f => f.id === this._selectedFeatureId) || null;
  }

  /**
   * 選択中の頂点オブジェクトの配列を取得
   * @returns {Array} 選択中の頂点の配列
   */
  getSelectedVertices() {
    if (!this._world || this._selectedVertexIds.size === 0) return [];
    const verticesMap = new Map(this._world.vertices.map(v => [v.id, v]));
    return Array.from(this._selectedVertexIds)
               .map(id => verticesMap.get(id))
               .filter(Boolean); // 見つからない頂点は除外
  }

  /**
   * ハイライト中の地物オブジェクトを取得
   * @returns {Object | null} ハイライト中の地物オブジェクト、またはnull
   */
  getHighlightedFeature() {
      if (!this._world || !this._highlightedFeatureId) return null;
       // _features からではなく _world.features から探す
      return this._world.features.find(f => f.id === this._highlightedFeatureId) || null;
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
