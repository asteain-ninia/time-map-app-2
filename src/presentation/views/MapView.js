// src/presentation/views/MapView.js

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
    this._mapOverlay = null; // 追加: 透明なオーバーレイ要素
    this._svgPoint = null; // SVG座標変換用

    // 計測モードの状態
    this._isMeasuringDistance = false;
    this._measurePoints = [];
    this._measureElements = []; // 描画した測定要素を保持

    // マウス状態
    this._isMouseDown = false;
    this._isDragging = false;
    this._dragStartPosition = { x: 0, y: 0 }; // ドラッグ開始時のワールド座標
    // _lastMousePosition はページ全体の座標を保持するように変更
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

    // 透明なオーバーレイを作成
    this._mapOverlay = document.createElement('div');
    this._mapOverlay.className = 'map-overlay';
    this._mapOverlay.style.position = 'absolute';
    this._mapOverlay.style.top = '0';
    this._mapOverlay.style.left = '0';
    this._mapOverlay.style.width = '100%';
    this._mapOverlay.style.height = '100%';
    this._mapOverlay.style.zIndex = '10'; // SVGの上に配置
    this._mapOverlay.style.pointerEvents = 'auto'; // マウスイベントを受け取る
    this._mapOverlay.style.cursor = 'default';

    // オーバーレイをマップコンテナに追加
    this._mapElement.appendChild(this._mapOverlay);

    // SVG座標変換用のSVGPointを作成 (SVGRendererの初期化後に実行)
    if (this._renderer && this._renderer._svg) {
        this._svgPoint = this._renderer._svg.createSVGPoint();
    } else {
        console.warn("SVGRendererが初期化されていないため、SVGPointを作成できませんでした。");
        // SVGRendererの初期化を待つか、後で作成するロジックが必要
    }

    // 初期ズームレベルを計算して設定
    // MapView のコンテナサイズが確定してから実行する
    // requestAnimationFrame を使って次の描画フレームで実行を試みる
    requestAnimationFrame(() => {
      const rect = this._mapElement.getBoundingClientRect();
      if (rect.width > 0) {
        const worldWidth = this._viewportManager.getViewport().worldWidth || 360;
        const initialZoom = rect.width / worldWidth;
        console.log(`初期ズーム計算: width=${rect.width}, worldWidth=${worldWidth}, initialZoom=${initialZoom}`);
        // ViewportManagerのzoomも更新する
        this._viewportManager.updateViewport({ zoom: initialZoom });
      } else {
         console.warn("MapView コンテナ幅が 0 のため、初期ズームを計算できませんでした。");
      }
      // ビューモデルとの連携をここで開始するか、タイミングを調整
      this._viewModel.addObserver(this._onViewModelChanged.bind(this));
      this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));

      // ビューポートの変更監視
      this._viewportManager.addListener(this._onViewportChanged.bind(this));

      // イベントリスナーの設定
      this._setupEventListeners();

      // 初回描画
      this._render();
    });


  }

  /**
 * スクリーン座標をSVG座標に変換するヘルパー関数
 * @param {number} pageX - ページ全体のX座標
 * @param {number} pageY - ページ全体のY座標
 * @returns {DOMPoint | null} SVG座標 (DOMPoint, Y軸下向き正) または null
 * @private
 */
_getSVGPoint(pageX, pageY) { // 引数をページ座標に変更
    if (!this._renderer || !this._renderer._svg || !this._svgPoint) {
        console.error("SVG要素またはSVGPointが利用できません。");
        return null;
    }
    this._svgPoint.x = pageX;
    this._svgPoint.y = pageY;
    try {
        const ctm = this._renderer._svg.getScreenCTM();
        if (!ctm) {
            console.error("SVG要素のCTMが取得できませんでした。");
            return null;
        }
        // CTMの逆行列を使ってページ座標をSVG座標に変換
        return this._svgPoint.matrixTransform(ctm.inverse()); // SVG座標(Y軸下向き正)を返す
    } catch (e) {
        console.error("SVG座標への変換中にエラーが発生しました:", e);
        return null;
    }
}

/**
 * SVG座標をワールド座標に変換する
 * @param {DOMPoint} svgPoint - SVG座標 (Y軸下向き正)
 * @returns {object | null} ワールド座標 {x, y} (Y軸上向き正) または null
 */
_svgToWorld(svgPoint) {
    if (!svgPoint) return null;
    return { x: svgPoint.x, y: -svgPoint.y }; // Y座標を反転
}


  /**
   * イベントリスナーの設定
   * @private
   */
  _setupEventListeners() {
    console.log('イベントリスナーを設定します');

    // オーバーレイにマウスイベントを設定（_mapElementの代わりに）
    this._mapOverlay.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._mapOverlay.addEventListener('mousemove', this._onMouseMove.bind(this));
    this._mapOverlay.addEventListener('mouseup', this._onMouseUp.bind(this));
    this._mapOverlay.addEventListener('mouseleave', this._onMouseLeave.bind(this));
    this._mapOverlay.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this._mapOverlay.addEventListener('dblclick', this._onDoubleClick.bind(this));
    this._mapOverlay.addEventListener('contextmenu', this._onContextMenu.bind(this));

    // タッチイベント
    this._mapOverlay.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this._mapOverlay.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this._mapOverlay.addEventListener('touchend', this._onTouchEnd.bind(this));

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
       case 'history': // 履歴変更時にも再描画（アンドゥ・リドゥの結果を反映）
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

    // レンダラーに SVGPoint がない場合はここで作成
    if (this._renderer && this._renderer._svg && !this._svgPoint) {
        this._svgPoint = this._renderer._svg.createSVGPoint();
        console.log("SVGPointを遅延作成しました。");
    }

    const viewport = this._viewportManager.getViewport();
    const currentTime = this._viewModel._navigateTimeUseCase.getCurrentTime();

    // レンダラーでマップを描画
    this._renderer.render(world, viewport, currentTime);

    // 選択要素のハイライト
    this._renderSelection();

    // 追加中の地物の描画
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
    // 既存の地物要素を見つけてスタイルを変更するか、
    // 別途ハイライト用の要素をレンダラーで描画する
  }

  /**
   * 追加中の地物の描画
   * @private
   */
  _renderAddingFeature() {
     // 既存の一時要素を削除
     this._clearTemporaryDrawings('adding-');

    if (this._editingViewModel.getMode() !== 'add') return;

    const addingPoints = this._editingViewModel.getAddingPoints();
    if (addingPoints.length === 0) return;

    const tool = this._editingViewModel.getTool();
    const viewport = this._viewportManager.getViewport();
    let tempElements = []; // この描画で作成した一時要素

    // ツールタイプに応じた描画 (ワールド座標を渡す)
    switch (tool) {
      case 'point':
        // 点の描画
        if (addingPoints.length === 1) {
          const elem = this._renderer.drawPoint(
            addingPoints[0].x,
            addingPoints[0].y,
            { fill: '#ff0000', radius: 6, stroke: '#ffffff', strokeWidth: 2 },
            viewport
          );
           if (elem) tempElements.push(elem);
        }
        break;

      case 'line':
        // 線の描画
        if (addingPoints.length >= 2) {
           const elem = this._renderer.drawLine(
            addingPoints,
            { stroke: '#0000ff', strokeWidth: 3, strokeDasharray: '5,5' },
            viewport
          );
           if (elem) tempElements.push(elem);
        }
        break;

      case 'polygon':
        // 多角形の描画
        if (addingPoints.length >= 3) {
          // 線の描画（閉じる）
          const polygonPoints = [...addingPoints, addingPoints[0]];
           const elem = this._renderer.drawLine(
            polygonPoints,
            { stroke: '#00ff00', strokeWidth: 3, strokeDasharray: '5,5' },
            viewport
          );
           if (elem) tempElements.push(elem);
        } else if (addingPoints.length >= 2) {
          // 線の描画（開いた状態）
           const elem = this._renderer.drawLine(
            addingPoints,
            { stroke: '#00ff00', strokeWidth: 3, strokeDasharray: '5,5' },
            viewport
          );
           if (elem) tempElements.push(elem);
        }
        break;

      default:
        break;
    }

    // 各頂点の描画 (ワールド座標を渡す)
    for (const point of addingPoints) {
       const elem = this._renderer.drawPoint(
        point.x,
        point.y,
        { fill: '#ffffff', radius: 4, stroke: '#000000', strokeWidth: 1 },
        viewport
      );
       if (elem) tempElements.push(elem);
    }
     // 作成した一時要素にマーカーを付ける
     tempElements.forEach(el => el.classList.add('temp-drawing', 'adding-feature'));
  }

  /**
   * 一時的な表示要素の描画
   * @private
   */
  _renderTemporaryElements() {
    const elements = this._editingViewModel.getTemporaryElements();
    // TODO: 一時的な表示要素の描画処理
    // _renderer を使って要素を描画し、'temp-drawing' クラスなどを付与する
  }

  /**
 * 距離測定の描画
 * @private
 */
_renderDistanceMeasurement() {
    // 既存の測定要素を削除
    this._clearTemporaryDrawings('measure-');

    if (!this._isMeasuringDistance || this._measurePoints.length === 0) return;

    const viewport = this._viewportManager.getViewport();
    let tempElements = []; // この描画で作成した一時要素

    // 測定点の描画 (ワールド座標を渡す)
    this._measurePoints.forEach((point, index) => {
        const pointElem = this._renderer.drawPoint(
            point.x,
            point.y,
            { fill: '#ffff00', radius: 4, stroke: '#000000', strokeWidth: 1 },
            viewport
        );
        if (pointElem) tempElements.push(pointElem);

        // 点ラベル (A, B, C...) (ワールド座標を渡す)
        const labelElem = this._renderer.drawText(
            point.x,
            point.y + 10 / Math.sqrt(viewport.zoom), // ラベルの位置調整 (ワールド座標で上方向)
            String.fromCharCode(65 + index), // A, B, C...
            { fontSize: 10, textColor: '#000000', textAnchor: 'middle', dominantBaseline: 'hanging'}, // 修正: ベースライン
            viewport
        );
        if(labelElem) tempElements.push(labelElem);
    });


    // 測定線の描画 (ワールド座標を渡す)
    if (this._measurePoints.length >= 2) {
        const lineElem = this._renderer.drawLine(
            this._measurePoints,
            { stroke: '#ffff00', strokeWidth: 2, strokeDasharray: '5,5' },
            viewport
        );
        if (lineElem) tempElements.push(lineElem);

        // 距離の計算
        const equatorLength = this._configManager.get('map.equatorLength', 40000);

        const distances = [];
        for (let i = 1; i < this._measurePoints.length; i++) {
            const p1 = this._measurePoints[i - 1];
            const p2 = this._measurePoints[i];

            const distance = this._viewModel.calculateDistance(p1, p2, equatorLength);
            distances.push(distance);

            // 各区間の距離表示 (ワールド座標を渡す)
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const segmentLabelElem = this._renderer.drawText(
                midX,
                midY - 10 / Math.sqrt(viewport.zoom), // 線からのオフセット (ワールド座標で下方向)
                `${distance.linear.toFixed(1)}km`, // 簡易表示
                { fontSize: 9, textColor: '#333300', textAnchor: 'middle', dominantBaseline: 'alphabetic'}, // 修正: ベースライン
                viewport
            );
            if(segmentLabelElem) tempElements.push(segmentLabelElem);
        }

        // 総距離
        const totalLinear = distances.reduce((sum, d) => sum + d.linear, 0);
        const totalGreatCircle = distances.reduce((sum, d) => sum + d.greatCircle, 0);

        // 距離表示 (ワールド座標を渡す)
        const lastPoint = this._measurePoints[this._measurePoints.length - 1];
        const textYOffset = 15 / Math.sqrt(viewport.zoom);

        const totalLinearElem = this._renderer.drawText(
            lastPoint.x + 10 / Math.sqrt(viewport.zoom),
            lastPoint.y + textYOffset * 2, // Yオフセット (ワールド座標で上)
            `直線計: ${totalLinear.toFixed(1)} km`,
            { fontSize: 10, textColor: '#000000', textAnchor: 'start', dominantBaseline: 'hanging'}, // 左上揃え
            viewport
        );
        if(totalLinearElem) tempElements.push(totalLinearElem);

        const totalGreatCircleElem = this._renderer.drawText(
            lastPoint.x + 10 / Math.sqrt(viewport.zoom),
            lastPoint.y + textYOffset, // Yオフセット (ワールド座標で上)
            `大円計: ${totalGreatCircle.toFixed(1)} km`,
            { fontSize: 10, textColor: '#000000', textAnchor: 'start', dominantBaseline: 'hanging'}, // 左上揃え
            viewport
        );
        if(totalGreatCircleElem) tempElements.push(totalGreatCircleElem);
    }
     // 作成した一時要素にマーカーを付ける
     tempElements.forEach(el => el.classList.add('temp-drawing', 'measure-element'));
     this._measureElements = tempElements; // 描画要素を保持
}

  /**
   * マウスダウンのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
_onMouseDown(event) {
  // 右クリックは無視（コンテキストメニュー用）
    if (event.button === 2) return; // 右クリックは無視

  // ページ全体の座標を取得
  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

  if (!worldPoint) {
      console.error("ワールド座標を取得できませんでした。");
      return;
  }

  // console.log('マウスダウン - Page:', pageX, pageY, 'World:', worldPoint.x, worldPoint.y);

  this._isMouseDown = true;
  this._lastMousePosition = { x: pageX, y: pageY }; // ページ座標
  this._dragStartPosition = worldPoint; // ★ ドラッグ開始時のワールド座標を保存

  // 編集モードに応じた処理
  const mode = this._editingViewModel.getMode();
  // console.log('現在の編集モード:', mode);

  switch (mode) {
    case 'view':
      // console.log('ビューモードでドラッグ開始');
      this._viewportManager.startDrag(pageX, pageY);
      break;

    case 'add':
      // console.log('追加モードで点を追加');
      this._handleAddPoint(worldPoint); // ワールド座標を渡す
      break;

    case 'edit':
      // console.log('編集モードでオブジェクト選択/ドラッグ開始');
      this._handleSelectObject(worldPoint); // ワールド座標で選択
      // ドラッグ開始処理はここで行わず、mousemove で判定する
      break;

    default:
      // console.log('不明なモード:', mode);
      break;
  }

  // 距離測定モード
  if (this._isMeasuringDistance) {
    // console.log('距離測定点を追加');
    this._handleAddMeasurePoint(worldPoint); // ワールド座標を渡す
  }
}

  /**
   * マウス移動のハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
_onMouseMove(event) {
  // ページ全体の座標を取得
  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

  if (!worldPoint) return;

  if (this._isMouseDown) {
    // マウスドラッグ
    if (!this._isDragging) {
      // ドラッグ開始判定
      const dx = pageX - this._lastMousePosition.x;
      const dy = pageY - this._lastMousePosition.y;
      const dragThreshold = 5;

      if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
        this._isDragging = true;
        // console.log('ドラッグ開始判定: ドラッグ開始');
        // 編集モードの場合、ドラッグ対象（頂点など）をここで確定する方が良いかも
      }
    }

    if (this._isDragging) {
      // ドラッグ処理
      const mode = this._editingViewModel.getMode();
      // console.log('ドラッグ中 - モード:', mode);

      if (mode === 'view') {
        this._viewportManager.drag(pageX, pageY);
      } else if (mode === 'edit') {
        // console.log('編集モードでオブジェクト移動');
        this._handleDragObject(worldPoint); // ワールド座標でドラッグ
      }
    }
  } else {
    // console.log('マウスホバー');
    this._handleMouseHover(worldPoint); // ワールド座標でホバー
  }

  this._lastMousePosition = { x: pageX, y: pageY }; // ページ座標を更新
}

  /**
   * マウスアップのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
_onMouseUp(event) {
  const mode = this._editingViewModel.getMode();
  // console.log('マウスアップ - モード:', mode);

  // ページ全体の座標を取得
  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

  if (!worldPoint) return;

  if (this._isMouseDown && this._isDragging) {
    // ドラッグ終了
    // console.log('ドラッグ終了処理');

    if (mode === 'view') {
      // console.log('ビューモードでドラッグ終了');
      this._viewportManager.endDrag();
    } else if (mode === 'edit') {
      // console.log('編集モードでドラッグ終了');
      this._handleDragEnd(worldPoint); // ワールド座標でドラッグ終了
    }
  } else if (this._isMouseDown && !this._isDragging) {
    // クリック（ドラッグなし）
    // console.log('クリック処理（ドラッグなし）');

    if (mode === 'view') {
      this._handleClick(worldPoint); // ワールド座標でクリック
    }
    // add/editモードのクリックは onMouseDown で処理
  }

  this._isMouseDown = false;
  this._isDragging = false;
  // this._dragStartPosition はリセット不要
}

  /**
   * マウス離脱のハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseLeave(event) {
    if (this._isMouseDown) {
      const mode = this._editingViewModel.getMode();

      if (mode === 'view' && this._isDragging) {
        this._viewportManager.endDrag();
         // console.log("Mouse leave during view drag, drag ended.");
      } else if (mode === 'edit' && this._isDragging) {
          // 編集モードでのドラッグ中に離れた場合、最後の位置で確定
          const svgPointRaw = this._getSVGPoint(this._lastMousePosition.x, this._lastMousePosition.y);
          const worldPoint = this._svgToWorld(svgPointRaw);
          if (worldPoint) {
              this._handleDragEnd(worldPoint);
              // console.log("Mouse leave during edit drag, drag ended at last position.");
          }
      }

      this._isMouseDown = false;
      this._isDragging = false;
       console.log("Mouse leave during drag, drag ended.");
    }
     // ホバー状態などもリセット
     this._viewModel.hoverFeature(null);
     this._viewModel.hoverVertex(null);
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

  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

  if (!worldPoint) return;

  // console.log('ホイール位置 - Page:', pageX, pageY, 'World:', worldPoint.x, worldPoint.y);

  this._viewportManager.zoomAt(worldPoint.x, worldPoint.y, zoomFactor); // ワールド座標でズーム
  }

  /**
   * ダブルクリックのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onDoubleClick(event) {
    // ページ全体の座標を取得
    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

    if (!worldPoint) return;

    // console.log('ダブルクリック - World:', worldPoint.x, worldPoint.y);
    this._viewportManager.updateViewport({
      x: worldPoint.x,
      y: worldPoint.y, // ワールド座標のYをセット
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

    // ページ全体の座標を取得
    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

    if (!worldPoint) return;

    // console.log("Context menu at World:", worldPoint.x, worldPoint.y);
    // TODO: コンテキストメニュー処理 (ワールド座標を使用)
  }

  /**
   * タッチ開始のハンドラ
   * @param {TouchEvent} event - タッチイベント
   * @private
   */
  _onTouchStart(event) {
    event.preventDefault();

    if (event.touches.length === 1) {
      // 単一タッチ
      const touch = event.touches[0];
      // ページ全体の座標を取得
      const pageX = touch.clientX;
      const pageY = touch.clientY;
      const svgPointRaw = this._getSVGPoint(pageX, pageY);
      const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

      if (!worldPoint) return;

      this._isMouseDown = true;
      this._lastMousePosition = { x: pageX, y: pageY };
      this._dragStartPosition = worldPoint; // ★ ドラッグ開始ワールド座標

      const mode = this._editingViewModel.getMode();
      if (mode === 'view') {
        this._viewportManager.startDrag(pageX, pageY);
      } else if (mode === 'add') {
          this._handleAddPoint(worldPoint);
      } else if (mode === 'edit') {
          this._handleSelectObject(worldPoint);
      }

      if (this._isMeasuringDistance) {
        this._handleAddMeasurePoint(worldPoint);
      }

    } else if (event.touches.length === 2) {
      // TODO: ピンチ処理準備
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
      // 単一タッチ
      const touch = event.touches[0];
      // ページ全体の座標を取得
      const pageX = touch.clientX;
      const pageY = touch.clientY;
      const svgPointRaw = this._getSVGPoint(pageX, pageY);
      const worldPoint = this._svgToWorld(svgPointRaw); // ワールド座標に変換

      if (!worldPoint) return;

      if (this._isMouseDown) {
        if (!this._isDragging) {
          // ドラッグ開始判定
          const dx = pageX - this._lastMousePosition.x;
          const dy = pageY - this._lastMousePosition.y;
          const dragThreshold = 10;
          if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
            this._isDragging = true;
          }
        }

        if (this._isDragging) {
          const mode = this._editingViewModel.getMode();
          if (mode === 'view') {
            this._viewportManager.drag(pageX, pageY);
          } else if (mode === 'edit') {
            this._handleDragObject(worldPoint); // ワールド座標でドラッグ
          }
        }
      }

      this._lastMousePosition = { x: pageX, y: pageY };
    } else if (event.touches.length === 2) {
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
        // 最後のタッチ座標を取得
        const lastTouch = event.changedTouches[0];
        const pageX = lastTouch ? lastTouch.clientX : this._lastMousePosition.x;
        const pageY = lastTouch ? lastTouch.clientY : this._lastMousePosition.y;
        const svgPointRaw = this._getSVGPoint(pageX, pageY);
        const worldPoint = this._svgToWorld(svgPointRaw);

        if (mode === 'view' && this._isDragging) {
            this._viewportManager.endDrag();
        } else if (mode === 'edit' && this._isDragging) {
            if (worldPoint) this._handleDragEnd(worldPoint);
        } else if (!this._isDragging) {
             // タップ（クリック相当）
             if (mode === 'view' && worldPoint) {
                 this._handleClick(worldPoint);
             }
             // add/editモードのタップは onTouchStart で処理済み
        }
    }

    this._isMouseDown = false;
    this._isDragging = false;

    // TODO: ピンチ状態リセット
  }

  /**
   * キーダウンのハンドラ
   * @param {KeyboardEvent} event - キーボードイベント
   * @private
   */
  _onKeyDown(event) {
    // 対象が入力要素の場合は無視
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    // ESCキーで選択解除または編集キャンセル
    if (event.key === 'Escape') {
       event.preventDefault();
      const mode = this._editingViewModel.getMode();

      if (mode === 'add' && this._editingViewModel.getAddingPoints().length > 0) {
        this._editingViewModel._clearAddingPoints(); // 公開メソッドがないので内部メソッドを呼ぶ（要検討）
         // console.log("Add operation cancelled by ESC.");
      } else if (mode === 'edit' && (this._viewModel.getSelectedFeature() || this._viewModel.getSelectedVertices().length > 0)) {
        // 選択解除
        this._viewModel.clearSelection();
         // console.log("Selection cleared by ESC.");
      } else if (this._isMeasuringDistance) {
          // 測定キャンセル
          this.clearMeasurements();
          this.setMeasuringDistance(false);
          // console.log("Measurement cancelled by ESC.");
      } else {
        // 表示モードに戻る
        this._editingViewModel.setMode('view');
         // console.log("Mode set to 'view' by ESC.");
      }
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) { // 修飾キーなし
       event.preventDefault();
      const selectedFeature = this._viewModel.getSelectedFeature();
      const selectedVertices = this._viewModel.getSelectedVertices();

      if (this._editingViewModel.getMode() === 'edit') { // 編集モードでのみ削除
          if (selectedVertices.length > 0) {
              // TODO: 選択された頂点の削除処理を実装
              console.log("Deleting selected vertices:", selectedVertices.map(v => v.id));
              // await this._editingViewModel.deleteVertices(selectedVertices.map(v => v.id));
          } else if (selectedFeature) {
              // console.log("Deleting feature:", selectedFeature.id);
              this._editingViewModel.deleteFeature(selectedFeature.id, selectedFeature); // ViewModel経由でアンドゥ対応
          }
      }
    }

    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          // console.log("Redo triggered");
          this._editingViewModel.redo();
        } else {
          // console.log("Undo triggered");
          this._editingViewModel.undo();
        }
      } else if (event.key === 'y') {
        event.preventDefault();
        // console.log("Redo triggered");
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
    // キー修飾子の状態更新など (必要であれば)
  }

  /**
   * リサイズのハンドラ
   * @private
   */
  _onResize() {
    // コンテナのサイズを取得
    // 注意: getBoundingClientRect() は小数点を含むことがあるため、整数化が必要な場合がある
    const rect = this._container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    // console.log("Resize event:", width, height);

    // レンダラーのリサイズ
    this._renderer.resize(width, height);

    // ビューポートのリサイズ (幅と高さのみ更新)
    this._viewportManager.resize(width, height);
    // resize は内部で updateViewport を呼び、変更があれば _onViewportChanged がトリガーされるはず
  }

  /**
   * オブジェクト選択処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleSelectObject(worldPoint) {
    // TODO: オブジェクト選択処理
    // 1. svgPoint に最も近いオブジェクト（頂点、線、面）を特定する
    //    - 空間インデックスを使うと効率的
    //    - クリック許容範囲 (tolerance) を考慮する
    // 2. 見つかったオブジェクトを viewModel.selectFeature または viewModel.selectVertex で選択する
    // 3. 何も見つからなければ viewModel.clearSelection() を呼ぶ
    console.log("Select object at World:", worldPoint.x, worldPoint.y);
    // 仮実装: 選択解除
    this._viewModel.clearSelection();
  }

  /**
   * クリック処理 (ビューモード)
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleClick(worldPoint) {
    console.log("Click at World (view mode):", worldPoint.x, worldPoint.y);
    // 情報表示など
  }

  /**
   * オブジェクトドラッグ処理
   * @param {object} worldPoint - 現在のワールド座標 {x, y}
   * @private
   */
  _handleDragObject(worldPoint) {
    // TODO: オブジェクトドラッグ処理
    // 1. 選択されているオブジェクト（頂点など）を取得
    // 2. editingViewModel.moveVertex などを使って移動を試みる
    // 3. 描画は ViewModel の変更通知 → _render で行われる
    const selectedVertices = this._viewModel.getSelectedVertices();
    if (selectedVertices.length === 1) {
        const vertex = selectedVertices[0];
        // console.log("Dragging vertex:", vertex.id, "to World:", worldPoint.x, worldPoint.y);
        // ドラッグ中はリアルタイムに更新せず、仮表示だけ行うことも検討
        // 仮表示は _renderAddingFeature のような仕組みを使う
        // ここでは何もしない or 仮表示更新
    } else if (this._viewModel.getSelectedFeature()) {
        // TODO: 地物全体のドラッグ
    }
  }

  /**
   * ドラッグ終了処理
   * @param {object} worldPoint - 最終的なワールド座標 {x, y}
   * @private
   */
  async _handleDragEnd(worldPoint) { // asyncに変更
    const selectedVertices = this._viewModel.getSelectedVertices();
    if (selectedVertices.length === 1) {
        const vertex = selectedVertices[0];
        const oldPosition = { x: this._dragStartPosition.x, y: this._dragStartPosition.y }; // 開始位置を使用
        const newPosition = { x: worldPoint.x, y: worldPoint.y };

        // 開始位置と終了位置がほぼ同じなら何もしない（誤操作防止）
        const dx = newPosition.x - oldPosition.x;
        const dy = newPosition.y - oldPosition.y;
        if (Math.sqrt(dx*dx + dy*dy) < 1e-6) {
            // console.log("Drag ended but position didn't change.");
            return;
        }

        console.log("Drag ended for vertex:", vertex.id, "New position:", newPosition);
        try {
            // ViewModel経由で頂点を移動（アンドゥ対応）
            await this._editingViewModel.moveVertex(vertex.id, oldPosition, newPosition);
        } catch (error) {
            console.error("Failed to move vertex:", error);
            // エラー時のUIフィードバックなど
        }
    }
    // TODO: feature全体のドラッグ終了処理
  }

  /**
   * マウスホバー処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleMouseHover(worldPoint) {
    // TODO: マウスホバー処理
    // 1. svgPoint に最も近いオブジェクトを特定
    // 2. viewModel.hoverFeature または viewModel.hoverVertex を呼ぶ
    // 3. マウスカーソルの形状を変更するなど
    // console.log("Hover at World:", worldPoint.x, worldPoint.y);
    // 仮実装：ホバー解除
    this._viewModel.hoverFeature(null);
    this._viewModel.hoverVertex(null);
  }

  /**
   * 点追加処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleAddPoint(worldPoint) {
    if (!worldPoint) return;
    // console.log("Adding point at World:", worldPoint.x, worldPoint.y);
    this._editingViewModel.addPoint(worldPoint);
  }

  /**
   * 測定点追加処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleAddMeasurePoint(worldPoint) {
    if (!worldPoint) return;
    // console.log("Adding measure point at World:", worldPoint.x, worldPoint.y);
    this._measurePoints.push(worldPoint);
    this._render();
  }

  /**
   * 距離測定モードを設定
   * @param {boolean} enabled - 有効化するかどうか
   */
  setMeasuringDistance(enabled) {
    if (this._isMeasuringDistance !== enabled) {
        this._isMeasuringDistance = enabled;
        // console.log("Measuring distance mode:", enabled);
        if (!enabled) {
            this.clearMeasurements(); // モード解除時に測定結果をクリア
        } else {
            // 測定モード開始時に他のモードを解除するなど（必要であれば）
            this._editingViewModel.setMode('view');
        }
        // カーソル形状の変更など
        this._mapOverlay.style.cursor = enabled ? 'crosshair' : 'default';
        this._render(); // 状態が変わったので再描画
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
    this._clearTemporaryDrawings('measure-');
    this._measureElements = [];
     // console.log("Measurements cleared.");
     this._render(); // クリア後に再描画
  }

  /**
   * 特定のクラスを持つ一時的な描画要素を削除
   * @param {string} classNamePrefix - 削除する要素のクラス名プレフィックス (e.g., 'measure-', 'adding-')
   * @private
   */
  _clearTemporaryDrawings(classNamePrefix) {
      if (!this._renderer || !this._renderer._mainGroup) return;
      // クラス名プレフィックスに合致する要素を削除
      const tempElements = this._renderer._mainGroup.querySelectorAll(`.temp-drawing.${classNamePrefix}element, .temp-drawing.${classNamePrefix}feature`);
      tempElements.forEach(el => this._renderer.removeElement(el));
      // console.log(`Cleared temporary drawings with prefix: ${classNamePrefix}`);
  }

  /**
   * グリッド表示の切り替え
   * @param {boolean} show - 表示する場合はtrue
   */
  toggleGrid(show) {
    this._renderer.toggleGrid(show);
    this._render(); // グリッドの状態が変わったので再描画
  }
}
