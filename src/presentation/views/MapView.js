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
    this._addDebugEventChecker();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    console.log('MapView: 初期化開始');
    
    // マップコンテナ作成
    this._mapElement = document.createElement('div');
    this._mapElement.className = 'map-container';
    this._mapElement.style.width = '100%';
    this._mapElement.style.height = '100%';
    this._mapElement.style.position = 'relative';
    this._mapElement.style.overflow = 'hidden';
    this._mapElement.style.backgroundColor = '#f0f0f0';
    
    // コンテナに追加
    this._container.appendChild(this._mapElement);
    console.log('MapView: コンテナにマップ要素を追加しました');
    
    // 透明オーバーレイレイヤーを作成
    this._overlayElement = document.createElement('div');
    this._overlayElement.className = 'map-overlay';
    this._overlayElement.style.position = 'absolute';
    this._overlayElement.style.top = '0';
    this._overlayElement.style.left = '0';
    this._overlayElement.style.width = '100%';
    this._overlayElement.style.height = '100%';
    this._overlayElement.style.zIndex = '10'; // SVGよりも上のレイヤー
    this._overlayElement.style.pointerEvents = 'auto';
    this._overlayElement.style.cursor = 'default';
    
    // ビューモデルとの連携
    this._viewModel.addObserver(this._onViewModelChanged.bind(this));
    this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));
    
    // ビューポートの変更監視
    this._viewportManager.addListener(this._onViewportChanged.bind(this));
    
    // オーバーレイレイヤーをマップ要素に追加
    this._mapElement.appendChild(this._overlayElement);
    console.log('MapView: オーバーレイレイヤーを追加しました');
    
    // オーバーレイにイベントリスナーを設定
    this._setupEventListeners();
    console.log('MapView: イベントリスナーを設定しました');
    
    // 初回描画
    this._render();
    console.log('MapView: 初期描画完了');
    
    // デバッグ用: イベントの発火をチェック
    this._addDebugEventChecker();
  }

  _setSVGPointerEvents() {
    // SVG要素にポインターイベントを設定
    const svg = this._renderer.getSVGElement();
    if (svg) {
      console.log('SVG要素を見つけました、ポインターイベントを設定します');
      svg.style.pointerEvents = 'all';
      
      // SVG内のすべての要素に対してポインターイベントを再帰的に設定
      const setPointerEventsRecursively = (element) => {
        if (element.nodeType === Node.ELEMENT_NODE) {
          // 背景地図の要素はイベントを透過
          if (element.classList.contains('background-map')) {
            element.style.pointerEvents = 'none';
          } else {
            element.style.pointerEvents = 'all';
          }
          
          // 子要素にも適用
          for (const child of element.children) {
            setPointerEventsRecursively(child);
          }
        }
      };
      
      setPointerEventsRecursively(svg);
      
      console.log('SVG要素のポインターイベント設定完了');
    } else {
      console.warn('SVG要素が見つかりません');
      
      // SVGが見つからない場合は再試行
      setTimeout(() => {
        this._setSVGPointerEvents();
      }, 100);
    }
  }

  /**
   * イベントリスナーの設定
   * @private
   */
  _setupEventListeners() {
    console.log('MapView: イベントリスナーを設定します');
    
    // オーバーレイ要素にイベントリスナーを設定
    const overlay = this._overlayElement;
    
    overlay.addEventListener('mousedown', (e) => {
      console.log('MapView: mousedown イベントが発火しました', e.clientX, e.clientY);
      this._onMouseDown(e);
    });
    
    overlay.addEventListener('mousemove', (e) => {
      // マウス移動は頻繁に発火するのでログは出さない
      this._onMouseMove(e);
    });
    
    overlay.addEventListener('mouseup', (e) => {
      console.log('MapView: mouseup イベントが発火しました', e.clientX, e.clientY);
      this._onMouseUp(e);
    });
    
    overlay.addEventListener('mouseleave', this._onMouseLeave.bind(this));
    
    overlay.addEventListener('wheel', (e) => {
      console.log('MapView: wheel イベントが発火しました', e.deltaY);
      this._onWheel(e);
      e.preventDefault(); // スクロールの伝播を防止
    }, { passive: false });
    
    overlay.addEventListener('dblclick', this._onDoubleClick.bind(this));
    overlay.addEventListener('contextmenu', this._onContextMenu.bind(this));
    
    // タッチイベント
    overlay.addEventListener('touchstart', (e) => {
      console.log('MapView: touchstart イベントが発火しました', e.touches.length);
      this._onTouchStart(e);
      e.preventDefault(); // デフォルトのタッチ動作を防止
    }, { passive: false });
    
    overlay.addEventListener('touchmove', (e) => {
      this._onTouchMove(e);
      e.preventDefault(); // デフォルトのタッチ動作を防止
    }, { passive: false });
    
    overlay.addEventListener('touchend', this._onTouchEnd.bind(this));
    
    // 文書レベルのキーボードイベント
    document.addEventListener('keydown', this._onKeyDown.bind(this));
    document.addEventListener('keyup', this._onKeyUp.bind(this));
    
    // ウィンドウリサイズ
    window.addEventListener('resize', this._onResize.bind(this));
    
    console.log('MapView: すべてのイベントリスナーを設定しました');
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
    console.log('MapView: マウスダウンイベントが処理されました', event.clientX, event.clientY);
    
    // 右クリックは無視（コンテキストメニュー用）
    if (event.button === 2) return;
    
    // マウス位置を取得（マップコンテナを基準）
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    console.log('マップ座標:', screenX, screenY);
    
    this._isMouseDown = true;
    this._isDragging = false; // ドラッグフラグをリセット
    this._lastMousePosition = { x: screenX, y: screenY };
    
    // 編集モードに応じた処理
    const mode = this._editingViewModel.getMode();
    console.log('現在の編集モード:', mode);
    
    if (mode === 'view') {
      // ビューモードでは、ドラッグでパン
      this._viewportManager.startDrag(screenX, screenY);
      console.log('MapView: パン開始', screenX, screenY);
      
      // ドラッグカーソルに変更
      this._overlayElement.style.cursor = 'grabbing';
    } else if (mode === 'add') {
      // 追加モードでは、クリックで点を追加
      const worldPoint = this._viewportManager.screenToWorld(screenX, screenY);
      console.log('MapView: 点追加', worldPoint);
      this._editingViewModel.addPoint(worldPoint);
    } else if (mode === 'edit') {
      // 編集モードでは、クリックで選択
      console.log('MapView: オブジェクト選択');
      // 選択処理
    }
    
    // 距離測定モード
    if (this._isMeasuringDistance) {
      const worldPoint = this._viewportManager.screenToWorld(screenX, screenY);
      console.log('MapView: 測定点追加', worldPoint);
      this._measurePoints.push(worldPoint);
      this._render();
    }
    
    // デフォルトの動作を防止
    event.preventDefault();
    event.stopPropagation();
  }
  

  /**
   * マウス移動のハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseMove(event) {
    // マウス位置を取得
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    if (this._isMouseDown) {
      // マウスドラッグ中
      if (!this._isDragging) {
        // ドラッグ開始判定
        const dx = screenX - this._lastMousePosition.x;
        const dy = screenY - this._lastMousePosition.y;
        const dragThreshold = 5;
        
        if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
          this._isDragging = true;
          console.log('MapView: ドラッグ開始', screenX, screenY);
        }
      }
      
      if (this._isDragging) {
        // ドラッグ処理
        const mode = this._editingViewModel.getMode();
        
        if (mode === 'view') {
          // ビューモードでは、ドラッグでパン
          this._viewportManager.drag(screenX, screenY);
          console.log('MapView: パン中', screenX, screenY);
          this._render(); // 描画更新を追加
        } else if (mode === 'edit') {
          // 編集モードでは、ドラッグで移動
          console.log('MapView: オブジェクト移動');
        }
      }
    } else {
      // ホバー処理（将来の実装用）
      const mode = this._editingViewModel.getMode();
      if (mode === 'add') {
        this._overlayElement.style.cursor = 'crosshair';
      } else if (mode === 'edit') {
        this._overlayElement.style.cursor = 'pointer';
      } else {
        this._overlayElement.style.cursor = 'grab';
      }
    }
    
    this._lastMousePosition = { x: screenX, y: screenY };
  }

  /**
   * マウスアップのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseUp(event) {
    console.log('MapView: マウスアップイベントが処理されました', event.clientX, event.clientY);
    
    if (this._isMouseDown) {
      const mode = this._editingViewModel.getMode();
      
      if (this._isDragging) {
        // ドラッグ終了
        if (mode === 'view') {
          this._viewportManager.endDrag();
          console.log('MapView: パン終了');
          
          // カーソルを元に戻す
          this._overlayElement.style.cursor = 'grab';
        } else if (mode === 'edit') {
          console.log('MapView: オブジェクト移動終了');
        }
      } else {
        // クリック（ドラッグなし）
        console.log('MapView: クリックイベント（ドラッグなし）');
        
        // この場合はクリックハンドラを呼び出す
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
    console.log('MapView: ホイールイベント', event.deltaY);
    event.preventDefault();
    
    // マウス位置を取得
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    // 世界座標に変換
    const worldPoint = this._viewportManager.screenToWorld(screenX, screenY);
    
    // ズームの変化量
    const zoomFactor = event.deltaY < 0 ? 0.1 : -0.1;
    
    // ズーム処理
    this._viewportManager.zoomAt(worldPoint.x, worldPoint.y, zoomFactor);
    console.log('MapView: ズーム', zoomFactor, worldPoint);
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
    // クリック位置を取得
    const rect = this._mapElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    // 世界座標に変換
    const worldPoint = this._viewportManager.screenToWorld(screenX, screenY);
    
    console.log('MapView: クリック処理', worldPoint);
    
    // モードに応じた処理
    const mode = this._editingViewModel.getMode();
    
    if (mode === 'add') {
      // 追加モードでの処理
      console.log('MapView: 追加モードでのクリック');
      this._editingViewModel.addPoint(worldPoint);
    } else if (mode === 'edit') {
      // 編集モードでの処理
      console.log('MapView: 編集モードでのクリック');
      // 選択処理
    } else if (mode === 'view') {
      // 表示モードでの処理
      console.log('MapView: 表示モードでのクリック');
      // オブジェクト情報表示など
    }
    
    // 距離測定モード
    if (this._isMeasuringDistance) {
      console.log('MapView: 測定点追加（クリック）', worldPoint);
      this._measurePoints.push(worldPoint);
      this._render();
    }
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

_addDebugEventChecker() {
  console.log('MapView: デバッグ用イベントチェッカーを追加');
  
  // オーバーレイ要素にデバッグ用のクリックイベントリスナーを追加
  this._overlayElement.addEventListener('click', (e) => {
    const rect = this._mapElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    console.log('MapView: オーバーレイがクリックされました', x, y);
    
    // クリック時に世界座標も表示
    const worldPoint = this._viewportManager.screenToWorld(x, y);
    console.log('MapView: クリック世界座標', worldPoint.x, worldPoint.y);
  });
  
  console.log('MapView: デバッグリスナーを追加しました');
}
}