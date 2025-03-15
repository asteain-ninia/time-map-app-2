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
   */
  constructor(mapView, mapViewModel, editingViewModel, viewportManager) {
    this._mapView = mapView;
    this._mapViewModel = mapViewModel;
    this._editingViewModel = editingViewModel;
    this._viewportManager = viewportManager;
    
    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // 初期データのロード
    this._loadInitialData();
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