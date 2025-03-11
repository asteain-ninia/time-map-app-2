/**
 * ビューポート管理（ズーム、パンなど）
 */
export class ViewportManager {
  /**
   * ビューポートマネージャーを作成
   * @param {Object} [options={}] - ビューポートオプション
   */
  constructor(options = {}) {
    this._viewport = {
      x: options.x || 0,
      y: options.y || 0,
      zoom: options.zoom || 1,
      width: options.width || 800,
      height: options.height || 600,
      minZoom: options.minZoom || 0.1,
      maxZoom: options.maxZoom || 10
    };
    
    this._listeners = [];
    this._isDragging = false;
    this._dragStart = { x: 0, y: 0 };
    this._viewportStart = { x: 0, y: 0 };
  }

  /**
   * 現在のビューポート情報を取得
   * @returns {Object} ビューポート情報
   */
  getViewport() {
    return { ...this._viewport };
  }

  /**
   * ビューポートを更新
   * @param {Object} updates - 更新内容
   */
  updateViewport(updates) {
    const oldViewport = { ...this._viewport };
    
    // ビューポートを更新
    Object.assign(this._viewport, updates);
    
    // ズーム制限を適用
    this._viewport.zoom = Math.max(
      this._viewport.minZoom,
      Math.min(this._viewport.maxZoom, this._viewport.zoom)
    );
    
    // ビューポートに変更があった場合のみリスナーを呼び出す
    if (this._hasViewportChanged(oldViewport, this._viewport)) {
      this._notifyListeners();
    }
  }

  /**
   * ビューポートのサイズを変更
   * @param {number} width - 新しい幅
   * @param {number} height - 新しい高さ
   */
  resize(width, height) {
    this.updateViewport({ width, height });
  }

  /**
   * 中心座標を変更
   * @param {number} x - 新しいX座標
   * @param {number} y - 新しいY座標
   */
  setCenter(x, y) {
    this.updateViewport({ x, y });
  }

  /**
   * 中心座標を指定量だけ移動
   * @param {number} dx - X方向の移動量
   * @param {number} dy - Y方向の移動量
   */
  pan(dx, dy) {
    // ズームレベルに合わせて移動量を調整
    const adjustedDx = dx / this._viewport.zoom;
    const adjustedDy = dy / this._viewport.zoom;
    
    this.updateViewport({
      x: this._viewport.x - adjustedDx,
      y: this._viewport.y - adjustedDy
    });
  }

  /**
   * ズームレベルを変更
   * @param {number} zoom - 新しいズームレベル
   */
  setZoom(zoom) {
    this.updateViewport({ zoom });
  }

  /**
   * 特定の地点を中心にズーム
   * @param {number} x - 世界X座標
   * @param {number} y - 世界Y座標
   * @param {number} zoomDelta - ズーム量の変化
   */
  zoomAt(x, y, zoomDelta) {
    const oldZoom = this._viewport.zoom;
    const newZoom = Math.max(
      this._viewport.minZoom,
      Math.min(this._viewport.maxZoom, oldZoom * (1 + zoomDelta))
    );
    
    // ズーム中心点の調整
    const viewportX = this._viewport.x;
    const viewportY = this._viewport.y;
    
    const dx = x - viewportX;
    const dy = y - viewportY;
    
    const scaleFactor = newZoom / oldZoom;
    
    this.updateViewport({
      zoom: newZoom,
      x: viewportX - dx * (scaleFactor - 1) / scaleFactor,
      y: viewportY - dy * (scaleFactor - 1) / scaleFactor
    });
  }

  /**
   * ドラッグ開始
   * @param {number} screenX - スクリーンX座標
   * @param {number} screenY - スクリーンY座標
   */
  startDrag(screenX, screenY) {
    this._isDragging = true;
    this._dragStart = { x: screenX, y: screenY };
    this._viewportStart = { x: this._viewport.x, y: this._viewport.y };
  }

  /**
   * ドラッグ中
   * @param {number} screenX - スクリーンX座標
   * @param {number} screenY - スクリーンY座標
   */
  drag(screenX, screenY) {
    if (!this._isDragging) return;
    
    const dx = screenX - this._dragStart.x;
    const dy = screenY - this._dragStart.y;
    
    // ズームレベルに合わせて移動量を調整
    const adjustedDx = dx / this._viewport.zoom;
    const adjustedDy = dy / this._viewport.zoom;
    
    this.updateViewport({
      x: this._viewportStart.x - adjustedDx,
      y: this._viewportStart.y - adjustedDy
    });
  }

  /**
   * ドラッグ終了
   */
  endDrag() {
    this._isDragging = false;
  }

  /**
   * 経度を一定量シフト
   * @param {number} degrees - シフトする度数
   */
  shiftLongitude(degrees) {
    this.updateViewport({ x: this._viewport.x + degrees });
  }

  /**
   * ビューポート変更リスナーを追加
   * @param {Function} listener - コールバック関数
   */
  addListener(listener) {
    this._listeners.push(listener);
  }

  /**
   * ビューポート変更リスナーを削除
   * @param {Function} listener - 削除するリスナー
   */
  removeListener(listener) {
    const index = this._listeners.indexOf(listener);
    if (index !== -1) {
      this._listeners.splice(index, 1);
    }
  }

  /**
   * ビューポートが変更されたかチェック
   * @param {Object} oldViewport - 古いビューポート
   * @param {Object} newViewport - 新しいビューポート
   * @returns {boolean} 変更があればtrue
   * @private
   */
  _hasViewportChanged(oldViewport, newViewport) {
    return oldViewport.x !== newViewport.x ||
           oldViewport.y !== newViewport.y ||
           oldViewport.zoom !== newViewport.zoom ||
           oldViewport.width !== newViewport.width ||
           oldViewport.height !== newViewport.height;
  }

  /**
   * ビューポート変更を通知
   * @private
   */
  _notifyListeners() {
    const viewport = this.getViewport();
    for (const listener of this._listeners) {
      listener(viewport);
    }
  }

  /**
   * 画面座標から世界座標へ変換
   * @param {number} screenX - スクリーンX座標
   * @param {number} screenY - スクリーンY座標
   * @returns {Object} 世界座標 { x, y }
   */
  screenToWorld(screenX, screenY) {
    const { x, y, zoom, width, height } = this._viewport;
    
    return {
      x: (screenX - width / 2) / zoom + x,
      y: (screenY - height / 2) / zoom + y
    };
  }

  /**
   * 世界座標から画面座標へ変換
   * @param {number} worldX - 世界X座標
   * @param {number} worldY - 世界Y座標
   * @returns {Object} スクリーン座標 { x, y }
   */
  worldToScreen(worldX, worldY) {
    const { x, y, zoom, width, height } = this._viewport;
    
    return {
      x: (worldX - x) * zoom + width / 2,
      y: (worldY - y) * zoom + height / 2
    };
  }
}