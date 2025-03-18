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
    
    console.log('ViewportManager初期化完了:', this._viewport);
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
    console.log('ビューポート更新前:', this._viewport);
    console.log('更新内容:', updates);
    
    const oldViewport = { ...this._viewport };
    
    // ビューポートを更新
    Object.assign(this._viewport, updates);
    
    // ズーム制限を適用
    this._viewport.zoom = Math.max(
      this._viewport.minZoom,
      Math.min(this._viewport.maxZoom, this._viewport.zoom)
    );
    
    console.log('ビューポート更新後:', this._viewport);
    
    // ビューポートに変更があった場合のみリスナーを呼び出す
    if (this._hasViewportChanged(oldViewport, this._viewport)) {
      console.log('ビューポートに変更があったため、リスナーに通知します');
      this._notifyListeners();
    } else {
      console.log('ビューポートに変更がなかったため、通知しません');
    }
  }

  /**
   * ビューポートのサイズを変更
   * @param {number} width - 新しい幅
   * @param {number} height - 新しい高さ
   */
  resize(width, height) {
    console.log('ビューポートリサイズ:', width, height);
    this.updateViewport({ width, height });
  }

  /**
   * 中心座標を変更
   * @param {number} x - 新しいX座標
   * @param {number} y - 新しいY座標
   */
  setCenter(x, y) {
    console.log('ビューポート中心設定:', x, y);
    this.updateViewport({ x, y });
  }

  /**
   * 中心座標を指定量だけ移動
   * @param {number} dx - X方向の移動量
   * @param {number} dy - Y方向の移動量
   */
  pan(dx, dy) {
    console.log('パン移動量:', dx, dy);
    
    // ズームレベルに合わせて移動量を調整
    const adjustedDx = dx / this._viewport.zoom;
    const adjustedDy = dy / this._viewport.zoom;
    
    console.log('調整後の移動量:', adjustedDx, adjustedDy);
    
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
    console.log('ズームレベル設定:', zoom);
    this.updateViewport({ zoom });
  }

  /**
   * 特定の地点を中心にズーム
   * @param {number} x - 世界X座標
   * @param {number} y - 世界Y座標
   * @param {number} zoomDelta - ズーム量の変化
   */
  zoomAt(x, y, zoomDelta) {
    console.log('指定地点でのズーム:', x, y, zoomDelta);
    
    const oldZoom = this._viewport.zoom;
    const newZoom = Math.max(
      this._viewport.minZoom,
      Math.min(this._viewport.maxZoom, oldZoom * (1 + zoomDelta))
    );
    
    console.log('ズーム変更:', oldZoom, '->', newZoom);
    
    // ズーム中心点の調整
    const viewportX = this._viewport.x;
    const viewportY = this._viewport.y;
    
    const dx = x - viewportX;
    const dy = y - viewportY;
    
    const scaleFactor = newZoom / oldZoom;
    
    console.log('スケールファクター:', scaleFactor);
    console.log('ズーム中心点からの距離:', dx, dy);
    
    const newX = viewportX - dx * (scaleFactor - 1) / scaleFactor;
    const newY = viewportY - dy * (scaleFactor - 1) / scaleFactor;
    
    console.log('新しい中心座標:', newX, newY);
    
    this.updateViewport({
      zoom: newZoom,
      x: newX,
      y: newY
    });
  }

  /**
   * ドラッグ開始
   * @param {number} screenX - スクリーンX座標
   * @param {number} screenY - スクリーンY座標
   */
  startDrag(screenX, screenY) {
    console.log('ドラッグ開始:', screenX, screenY);
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
    if (!this._isDragging) {
      console.log('ドラッグ中だが、ドラッグ状態でないため無視');
      return;
    }
    
    console.log('ドラッグ中:', screenX, screenY);
    
    const dx = screenX - this._dragStart.x;
    const dy = screenY - this._dragStart.y;
    
    console.log('ドラッグ距離:', dx, dy);
    
    // ズームレベルに合わせて移動量を調整
    const adjustedDx = dx / this._viewport.zoom;
    const adjustedDy = dy / this._viewport.zoom;
    
    console.log('調整後のドラッグ距離:', adjustedDx, adjustedDy);
    console.log('ドラッグ開始位置からの新しい位置:', 
      this._viewportStart.x - adjustedDx, 
      this._viewportStart.y - adjustedDy
    );
    
    this.updateViewport({
      x: this._viewportStart.x - adjustedDx,
      y: this._viewportStart.y - adjustedDy
    });
  }

  /**
   * ドラッグ終了
   */
  endDrag() {
    console.log('ドラッグ終了');
    this._isDragging = false;
  }

  /**
   * 経度を一定量シフト
   * @param {number} degrees - シフトする度数
   */
  shiftLongitude(degrees) {
    console.log('経度シフト:', degrees);
    this.updateViewport({ x: this._viewport.x + degrees });
  }

  /**
   * ビューポート変更リスナーを追加
   * @param {Function} listener - コールバック関数
   */
  addListener(listener) {
    this._listeners.push(listener);
    console.log('ビューポートリスナーを追加しました。現在のリスナー数:', this._listeners.length);
  }

  /**
   * ビューポート変更リスナーを削除
   * @param {Function} listener - 削除するリスナー
   */
  removeListener(listener) {
    const index = this._listeners.indexOf(listener);
    if (index !== -1) {
      this._listeners.splice(index, 1);
      console.log('ビューポートリスナーを削除しました。現在のリスナー数:', this._listeners.length);
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
    const changed = oldViewport.x !== newViewport.x ||
           oldViewport.y !== newViewport.y ||
           oldViewport.zoom !== newViewport.zoom ||
           oldViewport.width !== newViewport.width ||
           oldViewport.height !== newViewport.height;
    
    console.log('ビューポート変更確認:', changed ? '変更あり' : '変更なし');
    return changed;
  }

  /**
   * ビューポート変更を通知
   * @private
   */
  _notifyListeners() {
    const viewport = this.getViewport();
    console.log('リスナーに通知:', viewport);
    
    for (const listener of this._listeners) {
      try {
        listener(viewport);
      } catch (error) {
        console.error('ビューポートリスナーでエラーが発生しました:', error);
      }
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
    
    const worldX = (screenX - width / 2) / zoom + x;
    const worldY = (screenY - height / 2) / zoom + y;
    
    return { x: worldX, y: worldY };
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