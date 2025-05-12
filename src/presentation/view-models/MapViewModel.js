// src\presentation\view-models\MapViewModel.js

import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { Vertex } from '../../domain/entities/Vertex.js'; // Vertex をインポート

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
    this._features = []; // 現在の時間点で表示される地物の配列
    this._selectedFeatureId = null; // (string | null) 主選択されている地物のID
    this._selectedVertexIds = new Set(); // (Set<string>) 主選択されている頂点のIDセット
    this._highlightedFeatureId = null; // (string | null) 暗黙的にハイライトする地物のID (頂点選択時に属する地物)
    this._hoveredFeature = null; // ホバー中の地物インスタンス
    this._hoveredVertex = null; // ホバー中の頂点データ {id, x, y}
    this._projectSettings = null; // プロジェクト固有設定を保持

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

      // プロジェクト固有設定を保持
      if (this._world && this._world.metadata && this._world.metadata.settings) {
          this._projectSettings = JSON.parse(JSON.stringify(this._world.metadata.settings));
      } else {
          // world.jsonにsettingsがない場合のフォールバック (本来はSerializerで補完される想定)
          console.warn("Project settings not found in world.metadata. Using default fallbacks.");
          this._projectSettings = { // JSONSerializerのDEFAULT_PROJECT_SETTINGSと一致させる
              equatorLength: 40000,
              gridInterval: 10,
              gridColor: "#cccccc",
              gridOpacity: 0.5,
              sliderMin: 0,
              sliderMax: 10000,
              autoSaveInterval: 300
          };
      }

      // 現在の時間点に対応する地物をフィルタリング
      await this._loadFeaturesForCurrentTime();

      this._notifyObservers('world'); // world全体の変更を通知
      this._eventBus.publish('ProjectSettingsLoaded', { settings: this.getProjectSettings() }); // プロジェクト設定ロードイベント発行

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
        this.clearSelection(); // 選択解除
    }
    // 選択中の頂点が現在の時間で存在しない地物に属する場合も解除
    // また、world.vertices に存在しない頂点IDも選択から除外する
    else if (this._selectedVertexIds.size > 0) {
        const currentVertexIds = new Set(this._world.vertices.map(v => v.id));
        const existingSelectedVertexIds = new Set();
        let selectionChanged = false;

        this._selectedVertexIds.forEach(id => {
            if (currentVertexIds.has(id)) {
                // ★ この頂点が現在表示中の地物のいずれかに属しているかチェック (リングベース対応)
                 const vertexIsVisible = this._features.some(f => {
                     if (f instanceof DomainPolygon) {
                         return f.rings?.some(ring => ring.vertexIds.includes(id));
                     } else if (f instanceof DomainLine || f instanceof DomainPoint) {
                         return f.vertexIds?.includes(id);
                     }
                     return false;
                 });
                 if (vertexIsVisible) {
                    existingSelectedVertexIds.add(id);
                 } else {
                    selectionChanged = true; // 表示されていない頂点は選択解除
                 }
            } else {
                selectionChanged = true; // 存在しない頂点は選択解除
            }
        });

        if (selectionChanged) {
            this._selectedVertexIds = existingSelectedVertexIds;
            this._notifyObservers('selectedVertices'); // 頂点選択の変更を通知
             // ハイライト地物も再評価
            this._updateHighlightedFeature();
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
     // 頂点移動イベントの購読
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

    // 世界データを更新 (重複チェック追加)
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
       // もし更新された地物がworldデータ全体にも影響を与える場合(例:metadata.settingsの更新)
       // this._projectSettingsも更新し、'projectSettingsChanged'イベントを発行する
       if (event.feature.id === this._world.id && this._world.metadata && this._world.metadata.settings) { // 仮にworld全体を表すIDがあるとする
           this._projectSettings = JSON.parse(JSON.stringify(this._world.metadata.settings));
           this._notifyObservers('projectSettingsChanged', this.getProjectSettings());
       }
    } else {
      // 更新対象が見つからない場合は追加 (アンドゥ/リドゥで発生する可能性)
      this._world.features.push(event.feature);
      console.warn(`Feature ${event.feature.id} not found during update, added instead.`);
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

    const featureIdToDelete = event.featureId;
    let selectionAffected = false;

    // 削除された地物が主選択されていた場合
    if (this._selectedFeatureId === featureIdToDelete) {
      this.clearSelection(); // 地物・頂点・ハイライトすべて解除
      selectionAffected = true;
    }
    // 削除された地物がハイライトされていた場合 (頂点選択中)
    else if (this._highlightedFeatureId === featureIdToDelete) {
        this._highlightedFeatureId = null;
        // 頂点選択は維持されるが、ハイライトのみクリア
        this._notifyObservers('highlightedFeature');
        selectionAffected = true;
    }
    // 削除された地物に属する頂点が選択されていた場合
    else if (this._selectedVertexIds.size > 0) {
        // _onVerticesDeleted で頂点選択が更新されることを期待するが、
        // 念のため、削除された地物に属する頂点がないかチェック
        // (このチェックは deleteFeature UseCase が関連頂点も削除する場合に冗長になる可能性あり)
        // const featureToDelete = this._world.features.find(f => f.id === featureIdToDelete); // 削除前の情報を取得するのは難しい
        // => _onVerticesDeleted に任せる方針とする
        // ここでは何もしない
    }

    // 世界データを更新
    const index = this._world.features.findIndex(f => f.id === featureIdToDelete);
    if (index !== -1) {
      this._world.features.splice(index, 1);
    }

    // 地物をリロード (選択解除後に行う)
    this._loadFeaturesForCurrentTime();

    // もし選択状態に影響がなければ、明示的に再描画をトリガー
    // (選択解除されていれば _loadFeaturesForCurrentTime 内の clearSelection で通知される)
    // if (!selectionAffected) {
    //   this._notifyObservers('features');
    // }
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
     // レイヤーが表示された場合は、表示地物リストが更新されるので再描画される
     this._loadFeaturesForCurrentTime(); // 表示地物リストを更新
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
        const selectedFeature = this.getSelectedFeature(); // getWorldから取得するのでレイヤーIDは最新のはず
        if (selectedFeature && selectedFeature.layerId === layerId) {
            this.clearSelection();
            return; // 地物選択が解除されれば頂点選択もクリアされる
        }
    }

    // 選択中の頂点が、表示されている他のレイヤーの地物にも属しているかチェック
    if (this._selectedVertexIds.size > 0) {
        const newSelectedVertexIds = new Set();
        this._selectedVertexIds.forEach(vertexId => {
            // この頂点が、非表示になったレイヤー *以外* の、現在表示されている地物に属しているか
            const belongsToOtherVisibleLayerFeature = this._features.some(f =>
                f.layerId !== layerId && // このレイヤー以外で
                // ★ リングベースで頂点が含まれるかチェック
                ( (f instanceof DomainPolygon && f.rings?.some(r => r.vertexIds.includes(vertexId))) ||
                  ((f instanceof DomainLine || f instanceof DomainPoint) && f.vertexIds?.includes(vertexId)) )
            );

            if (belongsToOtherVisibleLayerFeature) {
                newSelectedVertexIds.add(vertexId); // 他の表示地物にも属していれば維持
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
        // ★ world.vertices 配列自体の参照は変えない
    }

    // ホバー中の頂点も更新
    if (this._hoveredVertex && this._hoveredVertex.id === event.vertexId) {
        this._hoveredVertex = this._world.vertices[vertexIndex] || null;
        this._notifyObservers('hoveredVertex');
    }

    // 地物の形状はインスタンスが不変なので、再描画時に新しい頂点座標が使われる
    // ★ ViewModelの責務として、Worldデータが更新されたことを通知
    this._notifyObservers('world'); // worldオブジェクト自体は変わらないが、内部データ変更を通知
    // ★ 描画更新のために features も通知する（内部の頂点座標が変わったため）
    this._notifyObservers('features');
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
    // ★ world.vertices 配列自体の参照が変わるように filter を使う
    const verticesBefore = this._world.vertices.length;
    this._world.vertices = this._world.vertices.filter(v => !deletedIdsSet.has(v.id));
    const verticesAfter = this._world.vertices.length;

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
    // Worldデータ（頂点リスト）が更新されたことを通知
    if (verticesBefore !== verticesAfter) {
        this._notifyObservers('world');
    }
    // ★ 表示地物リストも再計算が必要 (頂点削除で地物が消える/変わる可能性があるため)
    this._loadFeaturesForCurrentTime();
  }

  /**
   * 地物を選択
   * @param {string} featureId - 選択する地物のID
   */
  selectFeature(featureId) {
    if (!this._world) return;

    const feature = this._features.find(f => f.id === featureId);
    const newSelectedFeatureId = feature ? feature.id : null;

    // 状態変更があった場合のみ通知
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
    if (!this._world || !this._world.vertices) return; // vertices の存在チェック追加

    const vertex = this._world.vertices.find(v => v.id === vertexId);
    if (!vertex) {
         if (!addToSelection) { // 単一選択モードで存在しない頂点をクリックしたらクリア
             if (this._selectedVertexIds.size > 0 || this._selectedFeatureId !== null || this._highlightedFeatureId !== null) {
                 this.clearSelection();
             }
         }
         return;
    }

    // ★ 頂点が現在表示中の地物に属しているか確認 (リングベース対応)
    const isVertexVisible = this._features.some(f => {
         if (f instanceof DomainPolygon) {
             return f.rings?.some(ring => ring.vertexIds.includes(vertexId));
         } else if (f instanceof DomainLine || f instanceof DomainPoint) {
             return f.vertexIds?.includes(vertexId);
         }
         return false;
    });
    if (!isVertexVisible) {
        console.warn(`Vertex ${vertexId} is not part of any currently visible feature. Selection denied.`);
        if (!addToSelection) {
            this.clearSelection();
        }
        return;
    }

    let vertexSelectionChanged = false;
    const newSelectedVertexIds = addToSelection ? new Set(this._selectedVertexIds) : new Set();

    if (addToSelection) {
      if (newSelectedVertexIds.has(vertexId)) {
        newSelectedVertexIds.delete(vertexId); // 解除
        vertexSelectionChanged = true;
      } else {
        newSelectedVertexIds.add(vertexId); // 追加
        vertexSelectionChanged = true;
      }
    } else { // 単一選択
      if (!newSelectedVertexIds.has(vertexId) || newSelectedVertexIds.size !== 1) {
        newSelectedVertexIds.clear();
        newSelectedVertexIds.add(vertexId);
        vertexSelectionChanged = true;
      }
      // 既に単一選択されている場合は何もしない
    }

    // 状態変更があった場合のみ通知
    if (vertexSelectionChanged || this._selectedFeatureId !== null) {
        this._selectedVertexIds = newSelectedVertexIds;
        const oldSelectedFeatureId = this._selectedFeatureId;
        this._selectedFeatureId = null; // 頂点選択時は地物の主選択を解除

        this._updateHighlightedFeature(); // ハイライト地物を更新（通知もここで行われる）

        this._notifyObservers('selectedVertices');
        if (oldSelectedFeatureId !== null) { // 地物選択が解除された場合
            this._notifyObservers('selectedFeature');
        }
    }
  }

  /**
   * ハイライト対象の地物を更新 (内部用)
   * @private
   */
  _updateHighlightedFeature() {
      let newHighlightedFeatureId = null;
      if (this._selectedVertexIds.size > 0) {
          const firstSelectedVertexId = this._selectedVertexIds.values().next().value;
          // ★ 表示中の地物から探す (リングベース対応)
          const ownerFeature = this._features.find(f => {
               if (f instanceof DomainPolygon) {
                   return f.rings?.some(ring => ring.vertexIds.includes(firstSelectedVertexId));
               } else if (f instanceof DomainLine || f instanceof DomainPoint) {
                   return f.vertexIds?.includes(firstSelectedVertexId);
               }
               return false;
          });
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
   * @param {string | null} featureId - ホバーする地物のID、または解除する場合はnull
   */
  hoverFeature(featureId) {
    if (!this._world) return;

    const feature = featureId ? this._features.find(f => f.id === featureId) : null;
    if (this._hoveredFeature !== feature) {
      this._hoveredFeature = feature || null;
      this._notifyObservers('hoveredFeature');
    }
  }

  /**
   * 頂点をホバー
   * @param {string | null} vertexId - ホバーする頂点のID、または解除する場合はnull
   */
  hoverVertex(vertexId) {
    if (!this._world || !this._world.vertices) return;

    const vertex = vertexId ? this._world.vertices.find(v => v.id === vertexId) : null;
    if (this._hoveredVertex !== vertex) {
      // プレーンオブジェクトを保存
      this._hoveredVertex = vertex ? { id: vertex.id, x: vertex.x, y: vertex.y } : null;
      this._notifyObservers('hoveredVertex');
    }
  }

  /**
   * 頂点を移動 (Deprecated: UseCase 経由で行うべき)
   * @deprecated Use EditingViewModel.endVerticesDrag which calls EditFeatureUseCase.moveVertices
   */
  async moveVertex(vertexId, newPosition) {
     console.warn("MapViewModel.moveVertex is deprecated. Vertex movement should be handled via EditingViewModel and EditFeatureUseCase.");
     return null; // 何も実行しない
  }

  /**
   * 地物を追加 (Deprecated: UseCase 経由で行うべき)
   * @deprecated Use EditingViewModel.confirmAddFeature which calls EditFeatureUseCase.addFeature
   */
  async addFeature(featureType, properties, geometry, layerId) {
    console.warn("MapViewModel.addFeature is deprecated. Feature addition should be handled via EditingViewModel and EditFeatureUseCase.");
    return null; // 何も実行しない
  }

  /**
   * 地物を削除 (Deprecated: UseCase 経由で行うべき)
   * @deprecated Use EditingViewModel.deleteFeature which calls EditFeatureUseCase.deleteFeature
   */
  async deleteFeature(featureId) {
     console.warn("MapViewModel.deleteFeature is deprecated. Feature deletion should be handled via EditingViewModel and EditFeatureUseCase.");
     // SidebarView から呼ばれる場合のために EditingViewModel 経由で呼び出す
     try {
        const featureToDelete = this._world?.features.find(f => f.id === featureId);
        if (featureToDelete) {
             // EditingViewModelのメソッドを呼び出す
             await this._editingViewModel.deleteFeature(featureId, featureToDelete);
        } else {
             console.error(`Feature with ID ${featureId} not found for deletion.`);
        }
     } catch (error) {
       console.error('地物の削除に失敗しました (MapViewModel fallback)', error);
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
   * @param {string[]} vertexIds - 頂点IDの配列 (特定のリングの頂点IDを渡す想定)
   * @param {number} equatorLength - 赤道長（km）
   * @returns {number} 面積（km²）
   */
  calculatePolygonArea(vertexIds, equatorLength) {
    if (!this._world || !this._world.vertices || !vertexIds || vertexIds.length < 3) return 0;

    // Vertexインスタンスの配列を生成
    const vertices = vertexIds
      .map(id => {
          const vData = this._world.vertices.find(v => v.id === id);
          return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
      })
      .filter(v => v); // nullを除外

    if (vertices.length < 3) return 0;

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
   * @param {any} [dataOverride] - 通知するデータを上書きする場合に指定
   * @private
   */
  _notifyObservers(type, dataOverride) {
    const data = dataOverride !== undefined ? dataOverride : this._getStateForType(type);
    for (const observer of this._observers) {
      // コールバック呼び出し前に存在チェック (防御的)
      if (typeof observer === 'function') {
          try {
              observer(type, data);
          } catch (error) {
              console.error("Error in observer:", error);
          }
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
      case 'world':
        // Worldオブジェクト全体を返す（変更可能性に注意、コピー推奨？）
        // _projectSettingsも更新されたことを示すため、worldと一緒に渡すのもあり
        return this._world;
      case 'features':
        // 表示中の地物リスト（ドメインインスタンスの配列）
        return this._features;
      case 'selectedFeature': // 主選択地物の変更
        return this.getSelectedFeature(); // ゲッター経由でドメインインスタンスを返す
      case 'selectedVertices': // 主選択頂点の変更
        return this.getSelectedVertices(); // ゲッター経由でVertexインスタンスの配列を返す
      case 'highlightedFeature': // ハイライト地物の変更
        return this.getHighlightedFeature(); // ゲッター経由でドメインインスタンスを返す
      case 'hoveredFeature':
        return this._hoveredFeature; // ドメインインスタンス or null
      case 'hoveredVertex':
        return this._hoveredVertex; // プレーンオブジェクト or null
      case 'layers':
        return this._world ? this._world.layers : []; // Layerインスタンスの配列
      case 'projectSettingsChanged': // プロジェクト設定変更イベント用
        return this.getProjectSettings();
      default:
        return null;
    }
  }

  // --- 新しいゲッターメソッド ---
  /**
   * プロジェクト固有設定を取得 (ディープコピーを返す)
   * @returns {Object | null} プロジェクト設定オブジェクト、または未ロードの場合はnull
   */
  getProjectSettings() {
      return this._projectSettings ? JSON.parse(JSON.stringify(this._projectSettings)) : null;
  }

  /**
   * 赤道長を取得
   * @returns {number} 赤道長 (km)
   */
  getEquatorLength() {
      return this._projectSettings ? this._projectSettings.equatorLength : 40000; // フォールバック値
  }

  /**
   * グリッド設定を取得
   * @returns {{interval: number, color: string, opacity: number}} グリッド設定
   */
  getGridSettings() {
      if (this._projectSettings) {
          return {
              interval: this._projectSettings.gridInterval,
              color: this._projectSettings.gridColor,
              opacity: this._projectSettings.gridOpacity
          };
      }
      return { interval: 10, color: "#cccccc", opacity: 0.5 }; // フォールバック値
  }

  /**
   * 時間スライダーの表示範囲を取得
   * @returns {{min: number, max: number}} 時間スライダーの最小年・最大年
   */
  getTimeSliderRange() {
      if (this._projectSettings) {
          return {
              min: this._projectSettings.sliderMin,
              max: this._projectSettings.sliderMax
          };
      }
      return { min: 0, max: 10000 }; // フォールバック値
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
   * @returns {Object | null} 世界データ、またはロード前はnull
   */
  getWorld() {
    return this._world;
  }

  /**
   * 現在表示中の地物を取得
   * @returns {Array<Feature>} 地物の配列
   */
  getFeatures() {
    return this._features;
  }

  /**
   * 選択中の地物オブジェクトを取得
   * @returns {Feature | null} 選択中の地物オブジェクト、またはnull
   */
  getSelectedFeature() {
    if (!this._world || !this._selectedFeatureId) return null;
    // _world.features から探す
    return this._world.features.find(f => f.id === this._selectedFeatureId) || null;
  }

  /**
   * 選択中の頂点オブジェクトの配列を取得
   * @returns {Array<Vertex>} 選択中の頂点の配列
   */
  getSelectedVertices() {
    if (!this._world || !this._world.vertices || this._selectedVertexIds.size === 0) return [];
    const verticesMap = new Map(this._world.vertices.map(v => [v.id, v]));
    return Array.from(this._selectedVertexIds)
               .map(id => {
                   const vData = verticesMap.get(id);
                   // Vertexインスタンスを生成して返す
                   return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
               })
               .filter(Boolean); // 見つからない頂点は除外
  }

  /**
   * ハイライト中の地物オブジェクトを取得
   * @returns {Feature | null} ハイライト中の地物オブジェクト、またはnull
   */
  getHighlightedFeature() {
      if (!this._world || !this._highlightedFeatureId) return null;
       // _world.features から探す
      return this._world.features.find(f => f.id === this._highlightedFeatureId) || null;
  }


  /**
   * ホバー中の地物を取得
   * @returns {Feature | null} ホバー中の地物
   */
  getHoveredFeature() {
    return this._hoveredFeature;
  }

  /**
   * ホバー中の頂点を取得
   * @returns {Object | null} ホバー中の頂点データ {id, x, y}、またはnull
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
