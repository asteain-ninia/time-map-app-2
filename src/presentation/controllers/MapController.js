/**
 * マップ操作処理
 */
export class MapController {
  /**
   * マップコントローラを作成
   * @param {MapView} mapView - マップビュー
   * @param {MapViewModel} mapViewModel - マップビューモデル
   * @param {EditingViewModel} editingViewModel - 編集ビューモデル
   * @param {ViewportManager} viewportManager - ビューポートマネージャー
   * @param {EventBus} eventBus - イベントバス
   */
  constructor(mapView, mapViewModel, editingViewModel, viewportManager, eventBus) {
    this._mapView = mapView;
    this._mapViewModel = mapViewModel;
    this._editingViewModel = editingViewModel;
    this._viewportManager = viewportManager;
    this._eventBus = eventBus;
    
    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // 初期データのロード
    this._setupEventListeners();
    this._loadInitialData();
  }

  _setupEventListeners() {
    if (!this._eventBus || typeof this._eventBus.subscribe !== 'function') {
      return;
    }
    this._eventBus.subscribe('ProjectSettingsUpdated', this._onProjectSettingsUpdated.bind(this));
  }

  _onProjectSettingsUpdated(eventData) {
    const settings = eventData?.settings;
    if (!settings) {
      return;
    }
    const zoomMin = Number(settings.zoomMin);
    const zoomMax = Number(settings.zoomMax);
    if (!Number.isFinite(zoomMin) || !Number.isFinite(zoomMax) || zoomMin <= 0 || zoomMin >= zoomMax) {
      return;
    }
    this._viewportManager.updateViewport({ minZoom: zoomMin, maxZoom: zoomMax });
  }

  /**
   * 初期データのロード
   * @private
   */
  async _loadInitialData() {
    try {
      await this._mapViewModel.loadWorld();
    } catch (error) {
      console.error('世界データのロードに失敗しました', error);
    }
  }

  /**
   * 中心座標の設定
   * @param {number} x - X座標
   * @param {number} y - Y座標
   */
  setCenter(x, y) {
    this._viewportManager.setCenter(x, y);
  }

  /**
   * ズームレベルの設定
   * @param {number} zoom - ズームレベル
   */
  setZoom(zoom) {
    this._viewportManager.setZoom(zoom);
  }

  /**
   * ビューポートのリセット
   */
  resetViewport() {
    this._viewportManager.updateViewport({
      x: 0,
      y: 0,
      zoom: 1
    });
  }

  /**
   * 経度シフトの実行
   * @param {number} degrees - シフトする度数
   */
  shiftLongitude(degrees) {
    this._viewportManager.shiftLongitude(degrees);
  }

  /**
   * 地物の追加をキャンセル
   */
  cancelAddFeature() {
    if (this._editingViewModel.getMode() === 'add') {
      this._editingViewModel._clearAddingPoints();
    }
  }
}
