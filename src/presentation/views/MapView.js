/**
 * メインマップ表示
 */
export class MapView {
  /**
   * マップビューを作成
   * @param {HTMLElement} container - 表示コンテナ
   * @param {MapViewModel} viewModel - マップビューモデル
   * @param {EditingViewModel} editingViewModel - 編集ビューモデル
   * @param {ViewportManager} viewportManager - ビューポートマネージャー
   * @param {SVGRenderer} renderer - SVGレンダラー
   * @param {ConfigManager} configManager - 設定マネージャー
   */
  constructor(container, viewModel, editingViewModel, viewportManager, renderer, configManager) {
    this._container = container;
    this._viewModel = viewModel;
    this._editingViewModel = editingViewModel;
    this._viewportManager = viewportManager;
    this._renderer = renderer;
    this._configManager = configManager;
    
    // DOM要素
    this._mapElement = null;
    
    // 計測モードの状態
    this._isMeasuringDistance = false;
    this._measurePoints = [];
    this._measureElements = [];
    
    // マウス状態
    this._isMouseDown = false;
    this._isDragging = false;
    this._lastMousePosition = { x: 0, y: 0 };
    
    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // マップコンテナ作成
    this._mapElement = document.createElement('div');
    this._mapElement.className = 'map-container';
    this._mapElement.style.width = '100%';
    this._mapElement.style.height = '100%';
    this._mapElement.style.position = 'relative';
    this._mapElement.style.overflow = 'hidden';
    this._mapElement.style.backgroundColor = '#f0f0f0';
    
    // マップコンテナに追加
    this._container.appendChild(this._mapElement);
    
    // ビューモデルとの連携
    this._viewModel.addObserver(this._onViewModelChanged.bind(this));
    this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));
    
    // ビューポートの変更監視
    this._viewportManager.addListener(this._onViewportChanged.bind(this));
    
    // イベントリスナーの設定
    this._setupEventListeners();
    
    // 初回描画
    this._render();
  }

  /**
   * イベントリスナーの設定
   * @private
   */
  _setupEventListeners() {
    console.log('イベントリスナーを設定します');

    // マウスイベント
    this._mapElement.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._mapElement.addEventListener('mousemove', this._onMouseMove.bind(this));
    this._mapElement.addEventListener('mouseup', this._onMouseUp.bind(this));
    this._mapElement.addEventListener('mouseleave', this._onMouseLeave.bind(this));
    this._mapElement.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this._mapElement.addEventListener('dblclick', this._onDoubleClick.bind(this));
    this._mapElement.addEventListener('contextmenu', this._onContextMenu.bind(this));
    
    // タッチイベント
    this._mapElement.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this._mapElement.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this._mapElement.addEventListener('touchend', this._onTouchEnd.bind(this));
    
    // キーボードイベント
    window.addEventListener('keydown', this._onKeyDown.bind(this));
    window.addEventListener('keyup', this._onKeyUp.bind(this));
    
    // ウィンドウリサイズ
    window.addEventListener('resize', this._onResize.bind(this));
  }

  /**
   * ビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onViewModelChanged(type, data) {
    // タイプに応じた処理
    switch (type) {
      case 'world':
      case 'features':
      case 'selectedFeature':
      case 'selectedVertices':
      case 'hoveredFeature':
      case 'hoveredVertex':
      case 'layers':
        // 再描画
        this._render();
        break;
      
      default:
        break;
    }
  }

  /**
   * 編集ビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onEditingViewModelChanged(type, data) {
    // タイプに応じた処理
    switch (type) {
      case 'mode':
      case 'tool':
      case 'addingPoints':
      case 'addingHole':
      case 'temporaryElements':
        // 再描画
        this._render();
        break;
      
      default:
        break;
    }
  }

  /**
   * ビューポート変更のハンドラ
   * @param {Object} viewport - ビューポート情報
   * @private
   */
  _onViewportChanged(viewport) {
    // 再描画
    this._render();
  }

  /**
   * マップを描画
   * @private
   */
  _render() {
    const world = this._viewModel.getWorld();
    if (!world) return;
    
    const viewport = this._viewportManager.getViewport();
    const currentTime = this._viewModel._navigateTimeUseCase.getCurrentTime();
    
    // レンダラーでマップを描画
    this._renderer.render(world, viewport, currentTime);
    
    // 選択要素のハイライト
    this._renderSelection();
    
    // 追加中の特徴の描画
    this._renderAddingFeature();
    
    // 一時的な表示要素の描画
    this._renderTemporaryElements();
    
    // 距離測定の描画
    this._renderDistanceMeasurement();
  }

  /**
   * 選択要素のハイライト
   * @private
   */
  _renderSelection() {
    const selectedFeature = this._viewModel.getSelectedFeature();
    const selectedVertices = this._viewModel.getSelectedVertices();
    const hoveredFeature = this._viewModel.getHoveredFeature();
    const hoveredVertex = this._viewModel.getHoveredVertex();
    
    // TODO: 選択要素のハイライト処理
  }

  /**
   * 追加中の特徴の描画
   * @private
   */
  _renderAddingFeature() {
    if (this._editingViewModel.getMode() !== 'add') return;
    
    const addingPoints = this._editingViewModel.getAddingPoints();
    if (addingPoints.length === 0) return;
    
    const tool = this._editingViewModel.getTool();
    const viewport = this._viewportManager.getViewport();
    
    // ツールタイプに応じた描画
    switch (tool) {
      case 'point':
        // 点の描画
        if (addingPoints.length === 1) {
          this._renderer.drawPoint(
            addingPoints[0].x,
            addingPoints[0].y,
            { fill: '#ff0000', radius: 6, stroke: '#ffffff', strokeWidth: 2 },
            viewport
          );
        }
        break;
        
      case 'line':
        // 線の描画
        if (addingPoints.length >= 2) {
          this._renderer.drawLine(
            addingPoints,
            { stroke: '#0000ff', strokeWidth: 3, strokeDasharray: '5,5' },
            viewport
          );
        }
        break;
        
      case 'polygon':
        // 多角形の描画
        if (addingPoints.length >= 3) {
          // 線の描画（閉じる）
          const polygonPoints = [...addingPoints, addingPoints[0]];
          this._renderer.drawLine(
            polygonPoints,
            { stroke: '#00ff00', strokeWidth: 3, strokeDasharray: '5,5' },
            viewport
          );
        } else if (addingPoints.length >= 2) {
          // 線の描画（開いた状態）
          this._renderer.drawLine(
            addingPoints,
            { stroke: '#00ff00', strokeWidth: 3, strokeDasharray: '5,5' },
            viewport
          );
        }
        break;
        
      default:
        break;
    }
    
    // 各頂点の描画
    for (const point of addingPoints) {
      this._renderer.drawPoint(
        point.x,
        point.y,
        { fill: '#ffffff', radius: 4, stroke: '#000000', strokeWidth: 1 },
        viewport
      );
    }
  }

  /**
   * 一時的な表示要素の描画
   * @private
   */
  _renderTemporaryElements() {
    const elements = this._editingViewModel.getTemporaryElements();
    // TODO: 一時的な表示要素の描画処理
  }

  /**
   * 距離測定の描画
   * @private
   */
  _renderDistanceMeasurement() {
    if (!this._isMeasuringDistance || this._measurePoints.length === 0) return;
    
    const viewport = this._viewportManager.getViewport();
    
    // 測定点の描画
    for (const point of this._measurePoints) {
      this._renderer.drawPoint(
        point.x,
        point.y,
        { fill: '#ffff00', radius: 4, stroke: '#000000', strokeWidth: 1 },
        viewport
      );
    }
    
    // 測定線の描画
    if (this._measurePoints.length >= 2) {
      this._renderer.drawLine(
        this._measurePoints,
        { stroke: '#ffff00', strokeWidth: 2, strokeDasharray: '5,5' },
        viewport
      );
      
      // 距離の計算
      const equatorLength = this._configManager.get('map.equatorLength', 40000);
      
      const distances = [];
      for (let i = 1; i < this._measurePoints.length; i++) {
        const p1 = this._measurePoints[i - 1];
        const p2 = this._measurePoints[i];
        
        const distance = this._viewModel.calculateDistance(p1, p2, equatorLength);
        distances.push(distance);
      }
      
      // 総距離
      const totalLinear = distances.reduce((sum, d) => sum + d.linear, 0);
      const totalGreatCircle = distances.reduce((sum, d) => sum + d.greatCircle, 0);
      
      // 距離表示
      const midIndex = Math.floor(this._measurePoints.length / 2);
      const midPoint = this._measurePoints[midIndex];
      
      this._renderer.drawText(
        midPoint.x,
        midPoint.y - 20,
        `直線距離: ${totalLinear.toFixed(2)} km`,
        { fontSize: 12, textColor: '#000000', textAnchor: 'middle' },
        viewport
      );
      
      this._renderer.drawText(
        midPoint.x,
        midPoint.y - 5,
        `大円距離: ${totalGreatCircle.toFixed(2)} km`,
        { fontSize: 12, textColor: '#000000', textAnchor: 'middle' },
        viewport
      );
    }
  }

  /**
   * マウスダウンのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseDown(event) {
    // 右クリックは無視（コンテキストメニュー用）
    if (event.button === 2) return;
    
    // マウス位置を取得
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    console.log('マウスダウン:', screenX, screenY);
    
    this._isMouseDown = true;
    this._lastMousePosition = { x: screenX, y: screenY };
    
    // 編集モードに応じた処理
    const mode = this._editingViewModel.getMode();
    switch (mode) {
      case 'view':
        // ビューモードでは、ドラッグでパン
        this._viewportManager.startDrag(screenX, screenY);
        break;
        
      case 'add':
        // 追加モードでは、クリックで点を追加
        this._handleAddPoint(event);
        break;
        
      case 'edit':
        // 編集モードでは、クリックで選択
        this._handleSelectObject(event);
        break;
        
      default:
        break;
    }
    
    // 距離測定モード
    if (this._isMeasuringDistance) {
      this._handleAddMeasurePoint(event);
    }
  }

  /**
   * マウス移動のハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseMove(event) {
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    if (this._isMouseDown) {
      // マウスドラッグ
      if (!this._isDragging) {
        // ドラッグ開始判定
        const dx = screenX - this._lastMousePosition.x;
        const dy = screenY - this._lastMousePosition.y;
        const dragThreshold = 5;
        
        if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
          this._isDragging = true;
        }
      }
      
      if (this._isDragging) {
        // ドラッグ処理
        const mode = this._editingViewModel.getMode();
        
        if (mode === 'view') {
          // ビューモードでは、ドラッグでパン
          this._viewportManager.drag(screenX, screenY);
        } else if (mode === 'edit') {
          // 編集モードでは、ドラッグで移動
          this._handleDragObject(event);
        }
      }
    } else {
      // 単なるマウス移動
      this._handleMouseHover(event);
    }
    
    this._lastMousePosition = { x: screenX, y: screenY };
  }

  /**
   * マウスアップのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseUp(event) {
    const mode = this._editingViewModel.getMode();
    
    if (this._isMouseDown && this._isDragging) {
      // ドラッグ終了
      if (mode === 'view') {
        this._viewportManager.endDrag();
      } else if (mode === 'edit') {
        this._handleDragEnd(event);
      }
    } else if (this._isMouseDown && !this._isDragging) {
      // クリック（ドラッグなし）
      if (mode === 'view') {
        this._handleClick(event);
      }
    }
    
    this._isMouseDown = false;
    this._isDragging = false;
  }

  /**
   * マウス離脱のハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseLeave(event) {
    if (this._isMouseDown) {
      const mode = this._editingViewModel.getMode();
      
      if (mode === 'view') {
        this._viewportManager.endDrag();
      }
      
      this._isMouseDown = false;
      this._isDragging = false;
    }
  }

  /**
   * ホイールのハンドラ
   * @param {WheelEvent} event - ホイールイベント
   * @private
   */
  _onWheel(event) {
    event.preventDefault();
    
    const delta = -event.deltaY;
    const zoomFactor = delta > 0 ? 0.1 : -0.1;
    
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    const worldPoint = this._viewportManager.screenToWorld(screenX, screenY);
    
    this._viewportManager.zoomAt(worldPoint.x, worldPoint.y, zoomFactor);
  }

  /**
   * ダブルクリックのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onDoubleClick(event) {
    // ダブルクリックで表示をリセット
    const screenX = event.clientX;
    const screenY = event.clientY;
    
    const rect = this._mapElement.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    
    const worldPoint = this._viewportManager.screenToWorld(x, y);
    
    this._viewportManager.updateViewport({
      x: worldPoint.x,
      y: worldPoint.y,
      zoom: 1
    });
  }

  /**
   * コンテキストメニューのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onContextMenu(event) {
    event.preventDefault();
    
    // 右クリックメニューの表示
    // TODO: コンテキストメニュー処理
  }

  /**
   * タッチ開始のハンドラ
   * @param {TouchEvent} event - タッチイベント
   * @private
   */
  _onTouchStart(event) {
    event.preventDefault();
    
    if (event.touches.length === 1) {
      // 単一タッチはマウスと同様の処理
      const touch = event.touches[0];
      const rect = this._mapElement.getBoundingClientRect();
      const screenX = touch.clientX - rect.left;
      const screenY = touch.clientY - rect.top;
      
      this._isMouseDown = true;
      this._lastMousePosition = { x: screenX, y: screenY };
      
      const mode = this._editingViewModel.getMode();
      if (mode === 'view') {
        this._viewportManager.startDrag(screenX, screenY);
      }
    } else if (event.touches.length === 2) {
      // ピンチ処理の準備
      // TODO: ピンチ処理
    }
  }

  /**
   * タッチ移動のハンドラ
   * @param {TouchEvent} event - タッチイベント
   * @private
   */
  _onTouchMove(event) {
    event.preventDefault();
    
    if (event.touches.length === 1) {
      // 単一タッチはマウスと同様の処理
      const touch = event.touches[0];
      const rect = this._mapElement.getBoundingClientRect();
      const screenX = touch.clientX - rect.left;
      const screenY = touch.clientY - rect.top;
      
      if (this._isMouseDown) {
        if (!this._isDragging) {
          // ドラッグ開始判定
          const dx = screenX - this._lastMousePosition.x;
          const dy = screenY - this._lastMousePosition.y;
          const dragThreshold = 5;
          
          if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
            this._isDragging = true;
          }
        }
        
        if (this._isDragging) {
          const mode = this._editingViewModel.getMode();
          if (mode === 'view') {
            this._viewportManager.drag(screenX, screenY);
          }
        }
      }
      
      this._lastMousePosition = { x: screenX, y: screenY };
    } else if (event.touches.length === 2) {
      // ピンチ処理
      // TODO: ピンチ処理
    }
  }

  /**
   * タッチ終了のハンドラ
   * @param {TouchEvent} event - タッチイベント
   * @private
   */
  _onTouchEnd(event) {
    if (this._isMouseDown) {
      const mode = this._editingViewModel.getMode();
      
      if (mode === 'view') {
        this._viewportManager.endDrag();
      }
      
      this._isMouseDown = false;
      this._isDragging = false;
    }
  }

  /**
   * キーダウンのハンドラ
   * @param {KeyboardEvent} event - キーボードイベント
   * @private
   */
  _onKeyDown(event) {
    // ESCキーで選択解除または編集キャンセル
    if (event.key === 'Escape') {
      const mode = this._editingViewModel.getMode();
      
      if (mode === 'add' && this._editingViewModel.getAddingPoints().length > 0) {
        // 追加作業のキャンセル
        this._editingViewModel._clearAddingPoints();
      } else if (mode === 'edit' && (this._viewModel.getSelectedFeature() || this._viewModel.getSelectedVertices().length > 0)) {
        // 選択解除
        this._viewModel.clearSelection();
      } else {
        // 表示モードに戻る
        this._editingViewModel.setMode('view');
      }
    }
    
    // Deleteキーで選択要素削除
    if (event.key === 'Delete') {
      const selectedFeature = this._viewModel.getSelectedFeature();
      if (selectedFeature) {
        this._editingViewModel.deleteFeature(selectedFeature.id, selectedFeature);
      }
    }
    
    // アンドゥ・リドゥ
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          // Ctrl+Shift+Z: リドゥ
          this._editingViewModel.redo();
        } else {
          // Ctrl+Z: アンドゥ
          this._editingViewModel.undo();
        }
      } else if (event.key === 'y') {
        event.preventDefault();
        // Ctrl+Y: リドゥ
        this._editingViewModel.redo();
      }
    }
  }

  /**
   * キーアップのハンドラ
   * @param {KeyboardEvent} event - キーボードイベント
   * @private
   */
  _onKeyUp(event) {
    // キー修飾子の状態更新など
  }

  /**
   * リサイズのハンドラ
   * @private
   */
  _onResize() {
    const rect = this._container.getBoundingClientRect();
    
    // レンダラーのリサイズ
    this._renderer.resize(rect.width, rect.height);
    
    // ビューポートのリサイズ
    this._viewportManager.resize(rect.width, rect.height);
  }

  /**
   * オブジェクト選択処理
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _handleSelectObject(event) {
    // TODO: オブジェクト選択処理
  }

  /**
   * クリック処理
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _handleClick(event) {
    // TODO: クリック処理
  }

  /**
   * オブジェクトドラッグ処理
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _handleDragObject(event) {
    // TODO: オブジェクトドラッグ処理
  }

  /**
   * ドラッグ終了処理
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _handleDragEnd(event) {
    // TODO: ドラッグ終了処理
  }

  /**
   * マウスホバー処理
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _handleMouseHover(event) {
    // TODO: マウスホバー処理
  }

  /**
   * 点追加処理
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _handleAddPoint(event) {
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    const worldPoint = this._viewportManager.screenToWorld(screenX, screenY);
    
    this._editingViewModel.addPoint(worldPoint);
  }

  /**
   * 測定点追加処理
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _handleAddMeasurePoint(event) {
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    const worldPoint = this._viewportManager.screenToWorld(screenX, screenY);
    
    this._measurePoints.push(worldPoint);
    this._render();
  }

  /**
   * 距離測定モードを設定
   * @param {boolean} enabled - 有効化するかどうか
   */
  setMeasuringDistance(enabled) {
    this._isMeasuringDistance = enabled;
    
    if (!enabled) {
      this._measurePoints = [];
      this._render();
    }
  }

  /**
   * 距離測定モードかどうかを取得
   * @returns {boolean} 距離測定モードならtrue
   */
  isMeasuringDistance() {
    return this._isMeasuringDistance;
  }

  /**
   * 測定結果をクリア
   */
  clearMeasurements() {
    this._measurePoints = [];
    this._render();
  }
}