// src/infrastructure/rendering/ViewportManager.js

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
      x: options.x || 0,      // ワールド座標の中心 X
      y: options.y || 0,      // ワールド座標の中心 Y
      zoom: options.zoom || 1,  // ズームレベル
      width: options.width || 800, // ビューポートの幅 (ピクセル)
      height: options.height || 600, // ビューポートの高さ (ピクセル)
      minZoom: options.minZoom || 0.1,
      maxZoom: options.maxZoom || 10
    };

    this._listeners = [];
    this._isDragging = false;
    this._dragStart = { x: 0, y: 0 }; // ドラッグ開始時のスクリーン座標
    // this._viewportStart = { x: 0, y: 0 }; // startDrag で設定するように変更

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
    // console.log('ビューポート更新前:', this._viewport);
    // console.log('更新内容:', updates);

    const oldViewport = { ...this._viewport };

    // ビューポートを更新
    Object.assign(this._viewport, updates);

    // x 座標を -180 <= x < 180 の範囲に正規化
    if (updates.x !== undefined) {
        const worldWidth = 360; // 地図の幅 (経度)
        // ((値 + 半周期) % 全周期 + 全周期) % 全周期 - 半周期 の形で正規化
        this._viewport.x = ((this._viewport.x + worldWidth / 2) % worldWidth + worldWidth) % worldWidth - worldWidth / 2;
    }

    // ズーム制限を適用
    this._viewport.zoom = Math.max(
      this._viewport.minZoom,
      Math.min(this._viewport.maxZoom, this._viewport.zoom)
    );

    // console.log('ビューポート更新後:', this._viewport);

    // ビューポートに変更があった場合のみリスナーを呼び出す
    if (this._hasViewportChanged(oldViewport, this._viewport)) {
      // console.log('ビューポートに変更があったため、リスナーに通知します');
      this._notifyListeners();
    } else {
      // console.log('ビューポートに変更がなかったため、通知しません');
    }
  }

  /**
   * ビューポートのサイズを変更
   * @param {number} width - 新しい幅
   * @param {number} height - 新しい高さ
   */
  resize(width, height) {
    // console.log('ビューポートリサイズ:', width, height);
    this.updateViewport({ width, height });
  }

  /**
   * 中心座標を変更
   * @param {number} x - 新しいワールドX座標
   * @param {number} y - 新しいワールドY座標
   */
  setCenter(x, y) {
    // console.log('ビューポート中心設定 (World):', x, y);
    this.updateViewport({ x, y });
  }

  /**
   * 中心座標を指定量だけ移動 (スクリーン座標基準)
   * @param {number} dx - スクリーンX方向の移動量
   * @param {number} dy - スクリーンY方向の移動量
   */
  pan(dx, dy) {
    // console.log('パン移動量 (Screen):', dx, dy);

    // ズームレベルに合わせてワールド座標での移動量に変換
    const worldDx = dx / this._viewport.zoom;
    const worldDy = dy / this._viewport.zoom; // スクリーン座標の dy に対応するワールド座標での移動量 (Y軸上向き正)

    // console.log('調整後の移動量 (World):', worldDx, worldDy);

    this.updateViewport({
      x: this._viewport.x - worldDx, // スクリーン右への移動はワールドXを減少
      y: this._viewport.y + worldDy  // スクリーン下への移動はワールドYを増加
    });
  }

  /**
   * ズームレベルを変更
   * @param {number} zoom - 新しいズームレベル
   */
  setZoom(zoom) {
    // console.log('ズームレベル設定:', zoom);
    this.updateViewport({ zoom });
  }

  /**
   * 特定の地点を中心にズーム
   * @param {number} worldX - ズーム中心のワールドX座標
   * @param {number} worldY - ズーム中心のワールドY座標
   * @param {number} zoomDelta - ズーム量の変化率 (例: 0.1 は 10% 拡大, -0.1 は 10% 縮小)
   */
  zoomAt(worldX, worldY, zoomDelta) {
    // console.log('指定地点でのズーム (World):', worldX, worldY, 'Delta:', zoomDelta);

    const oldZoom = this._viewport.zoom;
    // zoomDeltaは変化「率」なので、新しいズームレベルは掛け算で計算
    let newZoom = oldZoom * (1 + zoomDelta);
    newZoom = Math.max(
        this._viewport.minZoom,
        Math.min(this._viewport.maxZoom, newZoom)
    );

    if (Math.abs(newZoom - oldZoom) < 1e-6) {
        // console.log("ズームレベルが変化しないため処理を中断");
        return; // ズームレベルが変わらなければ何もしない
    }

    // console.log('ズーム変更:', oldZoom, '->', newZoom);

    // ズーム中心点の調整
    // ズーム中心はワールド座標で指定されている
    const currentCenterX = this._viewport.x;
    const currentCenterY = this._viewport.y;

    // ズーム中心から現在のビューポート中心へのベクトル（ワールド座標）
    // X座標の差分計算時にループを考慮 (最短距離ベクトル)
    let dx = currentCenterX - worldX;
    const worldWidth = 360;
    if (dx > worldWidth / 2) {
        dx -= worldWidth; // 右回りより左回りの方が近い場合
    } else if (dx < -worldWidth / 2) {
        dx += worldWidth; // 左回りより右回りの方が近い場合
    }
    const dy = currentCenterY - worldY;


    // ズーム後のベクトルを計算
    const scaleRatio = oldZoom / newZoom; // 新しいズームに対する古いズームの比率
    const newDx = dx * scaleRatio;
    const newDy = dy * scaleRatio;

    // 新しいビューポート中心座標を計算
    const newCenterX = worldX + newDx;
    const newCenterY = worldY + newDy;

    // console.log('スケール比:', scaleRatio);
    // console.log('ズーム中心からのベクトル (World):', dx, dy);
    // console.log('新しい中心座標 (World):', newCenterX, newCenterY);

    this.updateViewport({
      zoom: newZoom,
      x: newCenterX,
      y: newCenterY
    });
  }

  /**
   * ドラッグ開始
   * @param {number} screenX - スクリーンX座標
   * @param {number} screenY - スクリーンY座標
   */
  startDrag(screenX, screenY) {
    // console.log('ドラッグ開始 (Screen):', screenX, screenY);
    this._isDragging = true;
    this._dragStart = { x: screenX, y: screenY };
    // ドラッグ開始時のビューポート中心を保存
    this._viewportStart = { x: this._viewport.x, y: this._viewport.y };
  }

  /**
   * ドラッグ中
   * @param {number} screenX - スクリーンX座標
   * @param {number} screenY - スクリーンY座標
   */
  drag(screenX, screenY) {
    if (!this._isDragging) {
      // console.log('ドラッグ中だが、ドラッグ状態でないため無視');
      return;
    }

    // console.log('ドラッグ中 (Screen):', screenX, screenY);

    // ドラッグ開始位置からのスクリーン座標での移動量
    const dxScreen = screenX - this._dragStart.x;
    const dyScreen = screenY - this._dragStart.y;

    // console.log('ドラッグ距離 (Screen):', dxScreen, dyScreen);

    // ワールド座標での移動量に変換
    const dxWorld = dxScreen / this._viewport.zoom;
    const dyWorld = dyScreen / this._viewport.zoom; // スクリーン座標の dy に対応するワールド座標での移動量 (Y軸上向き正)

    // console.log('調整後のドラッグ距離 (World):', dxWorld, dyWorld);
    // console.log('ドラッグ開始位置からの新しい位置 (World):',
    //   this._viewportStart.x - dxWorld,
    //   this._viewportStart.y + dyWorld // 修正: ワールド座標Yは増加
    // );

    // ドラッグ開始時の中心から移動量を引いて新しい中心を計算
    // updateViewport が x を正規化してくれる
    this.updateViewport({
      x: this._viewportStart.x - dxWorld, // スクリーン右へのドラッグはワールドXを減少
      y: this._viewportStart.y + dyWorld  // スクリーン下へのドラッグはワールドYを増加
    });
  }

  /**
   * ドラッグ終了
   */
  endDrag() {
    // console.log('ドラッグ終了');
    this._isDragging = false;
    // _viewportStart は startDrag で毎回設定されるのでクリア不要
  }

  /**
   * 経度を一定量シフト
   * @param {number} degrees - シフトする度数 (ワールド座標系)
   */
  shiftLongitude(degrees) {
    // console.log('経度シフト (World):', degrees);
    this.updateViewport({ x: this._viewport.x + degrees });
  }

  /**
   * ビューポート変更リスナーを追加
   * @param {Function} listener - コールバック関数
   */
  addListener(listener) {
    if (!this._listeners.includes(listener)) {
      this._listeners.push(listener);
      // console.log('ビューポートリスナーを追加しました。現在のリスナー数:', this._listeners.length);
    }
  }

  /**
   * ビューポート変更リスナーを削除
   * @param {Function} listener - 削除するリスナー
   */
  removeListener(listener) {
    const index = this._listeners.indexOf(listener);
    if (index !== -1) {
      this._listeners.splice(index, 1);
      // console.log('ビューポートリスナーを削除しました。現在のリスナー数:', this._listeners.length);
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
    const changed = Math.abs(oldViewport.x - newViewport.x) > 1e-6 ||
           Math.abs(oldViewport.y - newViewport.y) > 1e-6 ||
           Math.abs(oldViewport.zoom - newViewport.zoom) > 1e-6 ||
           oldViewport.width !== newViewport.width ||
           oldViewport.height !== newViewport.height;

    // console.log('ビューポート変更確認:', changed ? '変更あり' : '変更なし');
    return changed;
  }

  /**
   * ビューポート変更を通知
   * @private
   */
  _notifyListeners() {
    const viewport = this.getViewport();
    // console.log('リスナーに通知:', viewport);

    for (const listener of this._listeners) {
      try {
        listener(viewport);
      } catch (error) {
        console.error('ビューポートリスナーでエラーが発生しました:', error);
      }
    }
  }

  /**
   * 画面座標から世界座標へ変換 (注意: MapView._getSVGPoint を使うのが推奨)
   * このメソッドは SVG の viewBox を直接考慮しないため、単純な計算になる。
   * MapView で getScreenCTM を使う方が正確。
   * @param {number} screenX - ビューポート左上からのX座標 (ピクセル)
   * @param {number} screenY - ビューポート左上からのY座標 (ピクセル)
   * @returns {Object} 世界座標 { x, y }
   * @deprecated MapView._getSVGPoint を使用してください
   */
  screenToWorld(screenX, screenY) {
    console.warn("ViewportManager.screenToWorld is deprecated. Use MapView._getSVGPoint instead for accurate conversion with SVG viewBox.");
    const { x, y, zoom, width, height } = this._viewport;

    // ビューポート中心を基準にしたスクリーン座標
    const screenOffsetX = screenX - width / 2;
    const screenOffsetY = screenY - height / 2;

    // ワールド座標に変換
    const worldX = x + screenOffsetX / zoom;
    // ワールドY座標はスクリーンYと逆向きなので符号を反転
    const worldY = y - screenOffsetY / zoom;

    return { x: worldX, y: worldY };
  }

  /**
   * 世界座標から画面座標へ変換 (注意: SVGレンダリングでは通常不要)
   * SVGのviewBoxを使っている場合、ワールド座標がそのままSVG座標になるため、
   * この変換が必要になるケースは少ない。
   * @param {number} worldX - 世界X座標
   * @param {number} worldY - 世界Y座標
   * @returns {Object} ビューポート左上からのスクリーン座標 { x, y } (ピクセル)
   */
  worldToScreen(worldX, worldY) {
    // console.warn("ViewportManager.worldToScreen might not be accurate with SVG viewBox rendering.");
    const { x, y, zoom, width, height } = this._viewport;

    // ビューポート中心からのワールド座標の差分
    const worldOffsetX = worldX - x;
    const worldOffsetY = worldY - y; // ワールドYは上向き正

    // スクリーン座標に変換
    const screenX = worldOffsetX * zoom + width / 2;
    // スクリーンYはワールドYと逆向きなので符号を反転
    const screenY = -worldOffsetY * zoom + height / 2;

    return { x: screenX, y: screenY };
  }
}
