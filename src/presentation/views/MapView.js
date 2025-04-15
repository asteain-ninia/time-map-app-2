// src/presentation/views/MapView.js
import { Property } from '../../domain/value-objects/Property.js'; // Propertyクラスをインポート
import { Point as DomainPoint } from '../../domain/entities/Point.js'; // ドメインエンティティをインポート
import { Line as DomainLine } from '../../domain/entities/Line.js'; // ドメインエンティティをインポート
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js'; // ドメインエンティティをインポート

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
    this._actionButtonsContainer = null; // 追加: アクションボタン用コンテナ
    this._selectionElements = []; // 選択要素の描画物を保持

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
    this._draggedVertexId = null; // ドラッグ中の頂点ID

    // クリック許容範囲（ワールド座標での距離の二乗）
    this._clickToleranceSq = 0; // _initialize で設定
    this._clickTolerancePixels = 10; // ピクセル単位での許容範囲

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

    // アクションボタンコンテナを作成
    this._actionButtonsContainer = document.createElement('div');
    this._actionButtonsContainer.className = 'action-buttons-container';
    this._actionButtonsContainer.style.position = 'absolute';
    this._actionButtonsContainer.style.bottom = '20px';
    this._actionButtonsContainer.style.left = '50%';
    this._actionButtonsContainer.style.transform = 'translateX(-50%)';
    this._actionButtonsContainer.style.zIndex = '20'; // オーバーレイより上
    this._actionButtonsContainer.style.display = 'none'; // 初期状態は非表示
    this._actionButtonsContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    this._actionButtonsContainer.style.padding = '5px 10px';
    this._actionButtonsContainer.style.borderRadius = '5px';
    this._mapElement.appendChild(this._actionButtonsContainer);
    this._createActionButtons(); // ボタンを作成

    // SVG座標変換用のSVGPointを作成 (SVGRendererの初期化後に実行)
    if (this._renderer && this._renderer._svg) {
        this._svgPoint = this._renderer._svg.createSVGPoint();
    } else {
        console.warn("SVGRendererが初期化されていないため、SVGPointを作成できませんでした。");
        // SVGRendererの初期化を待つか、後で作成するロジックが必要
    }

    // クリック許容範囲を計算 (ビューポート変更時に再計算)
    this._updateClickTolerance();

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
        this._updateActionButtonsVisibility(); // ボタン表示状態を更新
        this._render(); // 再描画
         // モードやツールが変わったら選択をクリア
         this._viewModel.clearSelection();
         // 編集モードでなければドラッグ中の頂点IDもクリア
         if (this._editingViewModel.getMode() !== 'edit') {
             this._draggedVertexId = null;
         }
        break;
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
    // クリック許容範囲を更新
    this._updateClickTolerance();
    // 再描画
    this._render();
  }

    /**
     * クリック許容範囲をワールド座標の二乗で更新
     * @private
     */
    _updateClickTolerance() {
        const viewport = this._viewportManager.getViewport();
        // スクリーン座標でのピクセル許容範囲を、現在のズームレベルでワールド座標の距離に変換
        const worldDistance = this._clickTolerancePixels / viewport.zoom;
        this._clickToleranceSq = worldDistance * worldDistance;
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
    const currentTime = this._viewModel.getCurrentTime(); // 描画時点の現在時間を取得

    // レンダラーでマップを描画
    this._renderer.render(world, viewport, currentTime);

    // 既存の選択要素の描画物をクリア
    this._clearSelectionHighlights();

    // 選択要素のハイライト
    this._renderSelection(); // currentTime を引数に追加

    // 追加中の地物の描画
    this._renderAddingFeature();

    // 一時的な表示要素の描画
    this._renderTemporaryElements();

    // 距離測定の描画
    this._renderDistanceMeasurement();

    // アクションボタンの表示更新
    this._updateActionButtonsVisibility();
  }

    /**
     * 選択要素のハイライト描画物をクリア
     * @private
     */
    _clearSelectionHighlights() {
        this._selectionElements.forEach(el => this._renderer.removeElement(el));
        this._selectionElements = [];
    }

  /**
   * 選択要素のハイライト
   * @private
   */
  _renderSelection() {
    const selectedFeature = this._viewModel.getSelectedFeature();
    const selectedVertices = this._viewModel.getSelectedVertices();
    const viewport = this._viewportManager.getViewport();
    const world = this._viewModel.getWorld();
    const currentTime = this._viewModel.getCurrentTime(); // 現在時間を取得
    if (!world) return;

    // 選択された地物のハイライト
    // 地物が現在の時間で存在する場合のみ描画
    if (selectedFeature && selectedFeature.existsAt(currentTime)) {
        let featureVertices = [];
        if (selectedFeature.vertexIds && selectedFeature.vertexIds.length > 0) {
            featureVertices = selectedFeature.vertexIds
                .map(id => world.vertices.find(v => v.id === id))
                .filter(Boolean);
        }

        const style = {
            stroke: '#00ffff', // Cyan
            strokeWidth: 4, // 太めに
            fill: 'none',
            strokeDasharray: '4,4'
        };

        if (selectedFeature instanceof DomainPoint && featureVertices.length === 1) {
            const elem = this._renderer.drawPoint(featureVertices[0].x, featureVertices[0].y, {
                 radius: 8, // 少し大きめに
                 stroke: '#00ffff',
                 strokeWidth: 2,
                 fill: 'none',
                 'stroke-dasharray': '2,2' // 破線円
            }, viewport);
             if (elem) this._selectionElements.push(elem);
        } else if (selectedFeature instanceof DomainLine && featureVertices.length >= 2) {
            const elem = this._renderer.drawLine(featureVertices, style, viewport);
             if (elem) this._selectionElements.push(elem);
        } else if (selectedFeature instanceof DomainPolygon && featureVertices.length >= 3) {
            const elem = this._renderer.drawLine([...featureVertices, featureVertices[0]], style, viewport); // 閉じた線で描画
             if (elem) this._selectionElements.push(elem);
             // TODO: 穴のハイライト
             // TODO: MultiPolygonのハイライト
        }
    }

    // 選択された頂点のハイライト
    // 頂点自体は常に存在する前提だが、念のため
    selectedVertices.forEach(vertex => {
        // 頂点が属する（可能性のある）地物が存在するかを簡易的にチェックする
        // （より厳密には、この頂点が選択地物の一部であるかを MapViewModel 側で保証すべき）
        // if (!selectedFeature || selectedFeature.existsAt(currentTime)) { // 地物が選択されていないか、存在する場合
            const elem = this._renderer.drawPoint(vertex.x, vertex.y, {
                radius: 6,
                fill: '#00ffff', // Cyan fill
                stroke: '#0000ff', // Blue stroke
                strokeWidth: 1,
            }, viewport);
            if (elem) this._selectionElements.push(elem);
        // }
    });

     // 作成した要素にクラス付与
     this._selectionElements.forEach(el => el.classList.add('temp-drawing', 'selection-highlight'));
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
  this._draggedVertexId = null; // ドラッグ対象の頂点IDをリセット

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
      const clickedVertex = this._findClosestVertex(worldPoint);
      const addToSelection = event.shiftKey; // Shiftキーの状態

      if (clickedVertex) {
        // ★ 頂点が見つかった場合 ★
        // 1. 頂点を選択 (ViewModelのメソッドを呼ぶ)
        this._viewModel.selectVertex(clickedVertex.id, addToSelection);
        this._draggedVertexId = clickedVertex.id; // ドラッグ対象

        // 2. 頂点が属する地物を特定
        const features = this._viewModel.getFeatures(); // 現在表示中の地物から検索
        const ownerFeature = features.find(f =>
            (f.vertexIds && f.vertexIds.includes(clickedVertex.id)) ||
            (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(clickedVertex.id))) ||
            (f.subPolygons && f.subPolygons.some(sub => sub.vertexIds.includes(clickedVertex.id))) // MultiPolygon対応
        );

        // 3. 地物を直接ViewModelに設定 (selectFeatureを呼ばない)
        if (ownerFeature) {
            // Shiftキーが押されていない、または現在の選択地物と異なる場合は、新しい地物を選択
            if (!addToSelection || this._viewModel.getSelectedFeature()?.id !== ownerFeature.id) {
                this._viewModel._selectedFeature = ownerFeature; // 直接設定
                this._viewModel._notifyObservers('selectedFeature'); // 通知
            }
            // Shiftキーが押されていて、かつ同じ地物が既に選択されている場合は何もしない（頂点選択のみ追加される）
        } else {
            // 頂点に対応する地物が見つからない場合
             if (!addToSelection) { // Shift押下時以外は地物選択をクリア
                 this._viewModel._selectedFeature = null; // 直接設定
                 this._viewModel._notifyObservers('selectedFeature'); // 通知
             }
        }

      } else {
        // ★ 頂点が見つからなかった場合 ★
        const clickedFeature = this._findClosestFeature(worldPoint);
        if (clickedFeature) {
            // 地物を選択 (ViewModelのメソッドを呼ぶ -> これで頂点選択はクリアされる)
            this._viewModel.selectFeature(clickedFeature.id);
        } else {
          // 何もヒットしなかったら両方の選択を解除
          if (!addToSelection) {
              this._viewModel.clearSelection();
          }
        }
      }
      break; // case 'edit' の終了

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
    // マウスホバー処理 (ドラッグしていない場合)
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

  // worldPoint が null の場合は処理中断
  if (!worldPoint && this._isMouseDown) {
      console.warn("MouseUp: Failed to get world coordinates.");
      // ドラッグ中だった場合の終了処理は行う
      if (this._isDragging) {
          if (mode === 'view') {
              this._viewportManager.endDrag();
          }
          // 編集モードのドラッグ終了は座標が必要なため、ここでは実行しない
      }
      this._isMouseDown = false;
      this._isDragging = false;
      this._draggedVertexId = null;
      return;
  }


  if (this._isMouseDown && this._isDragging) {
    // ドラッグ終了
    // console.log('ドラッグ終了処理');

    if (mode === 'view') {
      // console.log('ビューモードでドラッグ終了');
      this._viewportManager.endDrag();
    } else if (mode === 'edit' && this._draggedVertexId) { // ドラッグ対象の頂点がある場合のみ
       // console.log('編集モードでドラッグ終了');
       this._handleDragEnd(worldPoint); // ワールド座標でドラッグ終了
    }
  } else if (this._isMouseDown && !this._isDragging && worldPoint) { // クリック（ドラッグなし）かつ worldPoint が有効な場合
    // console.log('クリック処理（ドラッグなし）');
    if (mode === 'view') {
      this._handleClick(worldPoint); // ワールド座標でクリック
    }
    // 'add' モードのクリックは onMouseDown で処理
    // 'edit' モードのクリック（選択）も onMouseDown で処理
  }

  this._isMouseDown = false;
  this._isDragging = false;
  this._draggedVertexId = null; // マウスアップ時にリセット
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
      } else if (mode === 'edit' && this._isDragging && this._draggedVertexId) {
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
      this._draggedVertexId = null; // ドラッグ対象もリセット
       // console.log("Mouse leave during drag, drag ended.");
    }
     // ホバー状態などもリセット
     this._viewModel.hoverFeature(null);
     this._viewModel.hoverVertex(null);
     this._render(); // ホバー解除を反映
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

    // 追加モードでのダブルクリックは確定処理とする
    if (this._editingViewModel.getMode() === 'add') {
      // 確定前に最後のクリック位置を追加
       this._handleAddPoint(worldPoint);
       // 確定処理
      this._handleConfirmClick();
    } else if (this._editingViewModel.getMode() === 'view') {
      // 通常のダブルクリック（ビューポートリセット）
      console.log('ダブルクリック - World:', worldPoint.x, worldPoint.y);
      this._viewportManager.updateViewport({
        x: worldPoint.x,
        y: worldPoint.y, // ワールド座標のYをセット
        zoom: 1 // Zoomを1にリセット
      });
    }
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
    //       編集モードの場合、右クリック位置のオブジェクトを選択してからメニュー表示
     if (this._editingViewModel.getMode() === 'edit') {
         const clickedVertex = this._findClosestVertex(worldPoint);
         if (clickedVertex) {
             this._viewModel.selectVertex(clickedVertex.id); // 単一選択
         } else {
             const clickedFeature = this._findClosestFeature(worldPoint);
             if (clickedFeature) {
                 this._viewModel.selectFeature(clickedFeature.id);
             } else {
                 this._viewModel.clearSelection();
             }
         }
         // TODO: 選択状態に基づいてコンテキストメニューを表示
         alert(`Context menu triggered at ${worldPoint.x.toFixed(2)}, ${worldPoint.y.toFixed(2)}`);
     }
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
      this._draggedVertexId = null; // リセット

      const mode = this._editingViewModel.getMode();
      if (mode === 'view') {
        this._viewportManager.startDrag(pageX, pageY);
      } else if (mode === 'add') {
          this._handleAddPoint(worldPoint);
      } else if (mode === 'edit') {
           const clickedVertex = this._findClosestVertex(worldPoint);
           if (clickedVertex) {
                // ★ 頂点が見つかった場合 ★
                // 1. 頂点を選択 (ViewModelのメソッドを呼ぶ)
                this._viewModel.selectVertex(clickedVertex.id); // 単一選択
                this._draggedVertexId = clickedVertex.id; // ドラッグ対象

                // 2. 頂点が属する地物を特定
                const features = this._viewModel.getFeatures();
                const ownerFeature = features.find(f =>
                    (f.vertexIds && f.vertexIds.includes(clickedVertex.id)) ||
                    (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(clickedVertex.id))) ||
                    (f.subPolygons && f.subPolygons.some(sub => sub.vertexIds.includes(clickedVertex.id)))
                );

                // 3. 地物を直接ViewModelに設定
                if (ownerFeature) {
                    this._viewModel._selectedFeature = ownerFeature;
                    this._viewModel._notifyObservers('selectedFeature');
                } else {
                    this._viewModel._selectedFeature = null;
                    this._viewModel._notifyObservers('selectedFeature');
                }
           } else {
               // ★ 頂点が見つからなかった場合 ★
               const clickedFeature = this._findClosestFeature(worldPoint);
               if (clickedFeature) {
                   // 地物を選択 (ViewModelのメソッドを呼ぶ -> これで頂点選択はクリアされる)
                   this._viewModel.selectFeature(clickedFeature.id);
               } else {
                   // 何もヒットしなかったら両方の選択を解除
                   this._viewModel.clearSelection();
               }
           }
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
          } else if (mode === 'edit' && this._draggedVertexId) {
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
        } else if (mode === 'edit' && this._isDragging && this._draggedVertexId) {
            if (worldPoint) this._handleDragEnd(worldPoint);
        } else if (!this._isDragging && worldPoint) {
             // タップ（クリック相当）
             if (mode === 'view') {
                 this._handleClick(worldPoint);
             }
             // add/editモードのタップは onTouchStart で処理済み
             // ダブルタップでの確定処理は別途考慮
             // if (mode === 'add' && !this._isDragging) {
             //    // ダブルタップ検出が必要
             //    this._handleConfirmClick();
             // }
        }
    }

    this._isMouseDown = false;
    this._isDragging = false;
    this._draggedVertexId = null;

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
      // ただし、プロパティ入力ダイアログ表示中のEnterは確定として扱いたい
       const propertyDialog = this._mapElement.querySelector('.property-input-dialog');
       if (propertyDialog && event.key === 'Enter') {
           // プロパティ入力ダイアログ内のEnterキーはフォーム送信に任せる（または特定のボタンをクリック）
           event.stopPropagation(); // MapView全体でのEnter処理を抑制
           const confirmButton = propertyDialog.querySelector('button:not([data-action="cancel"])');
            if (confirmButton) confirmButton.click();
           return;
       } else if (propertyDialog && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            const cancelButton = propertyDialog.querySelector('button[data-action="cancel"]');
            if (cancelButton) cancelButton.click();
            else propertyDialog.remove(); // キャンセルボタンがなければダイアログを閉じる
           return;
       } else if(propertyDialog) {
           // プロパティダイアログ表示中は他のキー操作を無効化
           event.stopPropagation();
           return;
       }
       else if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement){
            // それ以外の入力要素の場合
            return;
       }
    }

    const mode = this._editingViewModel.getMode();

    // ESCキーで選択解除または編集キャンセル
    if (event.key === 'Escape') {
       event.preventDefault();

       if (mode === 'add' && this._editingViewModel.getAddingPoints().length > 0) {
         this._handleCancelClick(); // キャンセル処理を呼び出す
         console.log("Add operation cancelled by ESC.");
       } else if (mode === 'edit' && (this._viewModel.getSelectedFeature() || this._viewModel.getSelectedVertices().length > 0)) {
         // 選択解除
         this._viewModel.clearSelection();
         console.log("Selection cleared by ESC.");
       } else if (this._isMeasuringDistance) {
           // 測定キャンセル
           this.clearMeasurements();
           this.setMeasuringDistance(false);
           console.log("Measurement cancelled by ESC.");
       } else {
         // 表示モードに戻る
         this._editingViewModel.setMode('view');
         console.log("Mode set to 'view' by ESC.");
       }
    } else if (event.key === 'Enter') { // Enterキーで確定
        if (mode === 'add' && this._editingViewModel.getAddingPoints().length > 0) {
            event.preventDefault();
            this._handleConfirmClick();
            console.log("Add operation confirmed by Enter.");
        }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) { // 修飾キーなし
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
    } else if (event.ctrlKey || event.metaKey) { // アンドゥ/リドゥ
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
   * クリックされたワールド座標に最も近い頂点を探す
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @returns {Vertex | null} 最も近い頂点オブジェクト、またはnull
   * @private
   */
  _findClosestVertex(worldPoint) {
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices || world.vertices.length === 0) {
          return null;
      }

      let closestVertex = null;
      let minDistanceSq = this._clickToleranceSq; // クリック許容範囲の二乗

      for (const vertex of world.vertices) {
          const distanceSq = this._viewModel._geometryService.calculateDistanceSq(
              worldPoint.x, worldPoint.y, vertex.x, vertex.y
          );

          if (distanceSq < minDistanceSq) {
              minDistanceSq = distanceSq;
              closestVertex = vertex;
          }
      }
      return closestVertex;
  }

  /**
   * クリックされたワールド座標に最も近い地物を探す
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @returns {Feature | null} 最も近い地物オブジェクト、またはnull
   * @private
   */
  _findClosestFeature(worldPoint) {
      const features = this._viewModel.getFeatures();
      const world = this._viewModel.getWorld();
      if (!features || features.length === 0 || !world || !world.vertices) {
          return null;
      }

      let closestFeature = null;
      let minDistanceSq = this._clickToleranceSq; // クリック許容範囲の二乗

      for (const feature of features) {
          let distanceSq = Infinity;

          // 地物の頂点を取得 (存在しない場合スキップ)
          const featureVertices = feature.vertexIds
              ?.map(id => world.vertices.find(v => v.id === id))
              .filter(Boolean);

          if (!featureVertices || featureVertices.length === 0) {
              // MultiPolygon の場合、subPolygons から頂点を取得する
              if (feature instanceof DomainPolygon && feature.isMultiPolygon && feature.subPolygons) {
                  // 最初のサブポリゴンを代表として使う（簡易的な処理）
                  const firstSubVertices = feature.subPolygons[0]?.vertexIds
                      ?.map(id => world.vertices.find(v => v.id === id))
                      .filter(Boolean);
                  if (!firstSubVertices || firstSubVertices.length === 0) continue;
                  // MultiPolygon の距離判定は複雑なので、ここでは最初のサブポリゴンで代用
                   // ポリゴン内部にあれば距離0とする
                   if (this._viewModel._geometryService.isPointInPolygon(worldPoint, firstSubVertices)) {
                       distanceSq = 0; // 内部なら最優先
                   } else {
                       // 外部の場合、境界線との最短距離を計算
                       const polygonVertices = [...firstSubVertices, firstSubVertices[0]]; // 閉じたパス
                       for (let i = 0; i < polygonVertices.length - 1; i++) {
                           const segmentDistSq = this._viewModel._geometryService.distancePointSegmentSq(
                               worldPoint, polygonVertices[i], polygonVertices[i + 1]
                           );
                           distanceSq = Math.min(distanceSq, segmentDistSq);
                       }
                   }
              } else {
                continue; // 通常の地物で頂点がない場合はスキップ
              }
          }


          if (feature instanceof DomainPoint) {
               if (featureVertices.length === 1) {
                   distanceSq = this._viewModel._geometryService.calculateDistanceSq(
                       worldPoint.x, worldPoint.y, featureVertices[0].x, featureVertices[0].y
                   );
               }
          } else if (feature instanceof DomainLine) {
               if (featureVertices.length >= 2) {
                   // 線分ごとに最短距離を計算し、最小値を取得
                   for (let i = 0; i < featureVertices.length - 1; i++) {
                       const segmentDistSq = this._viewModel._geometryService.distancePointSegmentSq(
                           worldPoint, featureVertices[i], featureVertices[i + 1]
                       );
                       distanceSq = Math.min(distanceSq, segmentDistSq);
                   }
               }
          } else if (feature instanceof DomainPolygon) {
                // isMultiPolygon は上で処理済み、そうでなければ通常のポリゴン
                if (!feature.isMultiPolygon && featureVertices.length >= 3) {
                     // ポリゴン内部にあれば距離0とする
                     if (this._viewModel._geometryService.isPointInPolygon(worldPoint, featureVertices)) {
                         distanceSq = 0; // 内部なら最優先
                     } else {
                         // 外部の場合、境界線との最短距離を計算
                         const polygonVertices = [...featureVertices, featureVertices[0]]; // 閉じたパス
                         for (let i = 0; i < polygonVertices.length - 1; i++) {
                             const segmentDistSq = this._viewModel._geometryService.distancePointSegmentSq(
                                 worldPoint, polygonVertices[i], polygonVertices[i + 1]
                             );
                             distanceSq = Math.min(distanceSq, segmentDistSq);
                         }
                         // TODO: 穴との距離も考慮
                     }
                }
          }

          if (distanceSq < minDistanceSq) {
              minDistanceSq = distanceSq;
              closestFeature = feature;
          }
      }
      return closestFeature;
  }


  /**
   * オブジェクト選択処理 (旧 _handleSelectObject から改名・整理)
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @param {boolean} [addToSelection=false] - 選択に追加するかどうか
   * @private
   */
   _selectObjectAt(worldPoint, addToSelection = false) {
      // まず頂点選択を試みる
      const clickedVertex = this._findClosestVertex(worldPoint);
      if (clickedVertex) {
           // ★ 頂点が見つかった場合 ★
            // 1. 頂点を選択 (ViewModelのメソッドを呼ぶ)
            this._viewModel.selectVertex(clickedVertex.id, addToSelection);
            this._draggedVertexId = clickedVertex.id; // ドラッグ対象

            // 2. 頂点が属する地物を特定
            const features = this._viewModel.getFeatures();
            const ownerFeature = features.find(f =>
                (f.vertexIds && f.vertexIds.includes(clickedVertex.id)) ||
                (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(clickedVertex.id))) ||
                (f.subPolygons && f.subPolygons.some(sub => sub.vertexIds.includes(clickedVertex.id)))
            );

            // 3. 地物を直接ViewModelに設定
            if (ownerFeature) {
                if (!addToSelection || this._viewModel.getSelectedFeature()?.id !== ownerFeature.id) {
                    this._viewModel._selectedFeature = ownerFeature;
                    this._viewModel._notifyObservers('selectedFeature');
                }
            } else {
                 if (!addToSelection) {
                     this._viewModel._selectedFeature = null;
                     this._viewModel._notifyObservers('selectedFeature');
                 }
            }
      } else {
           // ★ 頂点が見つからなかった場合 ★
           const clickedFeature = this._findClosestFeature(worldPoint);
           if (clickedFeature) {
                // 地物を選択 (ViewModelのメソッドを呼ぶ -> これで頂点選択はクリアされる)
                this._viewModel.selectFeature(clickedFeature.id);
           } else if (!addToSelection) { // 追加選択でない場合のみクリア
                this._viewModel.clearSelection(); // 何もヒットしなかったら選択解除
           }
      }
  }

  /**
   * クリック処理 (ビューモード)
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleClick(worldPoint) {
    console.log("Click at World (view mode):", worldPoint.x, worldPoint.y);
    // 情報表示など
    const clickedFeature = this._findClosestFeature(worldPoint);
    if (clickedFeature) {
        this._viewModel.selectFeature(clickedFeature.id); // ビューモードでも選択できるように
    } else {
        this._viewModel.clearSelection();
    }
  }

  /**
   * オブジェクトドラッグ処理
   * @param {object} worldPoint - 現在のワールド座標 {x, y}
   * @private
   */
  _handleDragObject(worldPoint) {
     if (!this._draggedVertexId) return; // ドラッグ対象の頂点がなければ何もしない

    // 選択されている頂点（単一のはず）を取得
    const selectedVertices = this._viewModel.getSelectedVertices();
    if (selectedVertices.length !== 1 || selectedVertices[0].id !== this._draggedVertexId) {
        // 予期せぬ状態。ドラッグ対象が選択されていない。
        console.warn("Dragging vertex is not selected. Clearing drag target.");
        this._draggedVertexId = null;
        return;
    }

     // ドラッグ中はリアルタイム更新せず、仮表示だけ行う
     // MapViewModel の状態は変更せず、EditingViewModel の一時要素で表現
     this._editingViewModel.clearTemporaryElements(); // 前の仮表示をクリア

     const vertex = selectedVertices[0];
     // ドラッグ中の仮の頂点を描画
     this._editingViewModel.addTemporaryElement({
         type: 'point',
         x: worldPoint.x,
         y: worldPoint.y,
         style: { fill: '#ff00ff', radius: 7, stroke: '#ffffff', strokeWidth: 2 }
     });

     // TODO: ドラッグ中の線や面の仮表示（必要であれば）
     this._render(); // 再描画をトリガー
  }

  /**
   * ドラッグ終了処理
   * @param {object} worldPoint - 最終的なワールド座標 {x, y}
   * @private
   */
  async _handleDragEnd(worldPoint) { // asyncに変更
    this._editingViewModel.clearTemporaryElements(); // 仮表示をクリア

    if (!this._draggedVertexId) return; // ドラッグ対象がなければ終了

    // 選択されていた頂情報を取得 (移動前の座標が必要)
    const world = this._viewModel.getWorld();
    const originalVertex = world?.vertices.find(v => v.id === this._draggedVertexId);

    if (!originalVertex) {
        console.error("Failed to find original vertex for drag end.");
        this._draggedVertexId = null;
        return;
    }

    // _dragStartPosition はマウスダウン時のワールド座標
    const oldPosition = { x: originalVertex.x, y: originalVertex.y };
    const newPosition = { x: worldPoint.x, y: worldPoint.y };

    // 開始位置と終了位置がほぼ同じなら何もしない（誤操作防止）
    const distSq = this._viewModel._geometryService.calculateDistanceSq(
        oldPosition.x, oldPosition.y, newPosition.x, newPosition.y
    );

    if (distSq < 1e-9) { // 閾値を小さく設定
        console.log("Drag ended but position didn't change significantly.");
        this._draggedVertexId = null; // ドラッグ対象をリセット
        this._render(); // 仮表示を消すために再描画
        return;
    }

    console.log("Drag ended for vertex:", this._draggedVertexId, "New position:", newPosition);
    try {
        // ViewModel経由で頂点を移動（アンドゥ対応）
        await this._editingViewModel.moveVertex(this._draggedVertexId, oldPosition, newPosition);
        // 成功したらドラッグ対象をクリア
        this._draggedVertexId = null;
        // ViewModelの変更通知により自動で再描画されるはず
    } catch (error) {
        console.error("Failed to move vertex:", error);
        // エラー時のUIフィードバックなど
        this._draggedVertexId = null; // エラー時もリセット
        this._render(); // 状態を元に戻すために再描画
    }

  }

  /**
   * マウスホバー処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleMouseHover(worldPoint) {
      // 編集モードでのみホバー処理を行う
      if (this._editingViewModel.getMode() !== 'edit') {
          // 編集モード以外ではホバー状態をクリア
          if (this._viewModel.getHoveredVertex() || this._viewModel.getHoveredFeature()) {
              this._viewModel.hoverVertex(null);
              this._viewModel.hoverFeature(null);
              this._render(); // ホバー解除を反映
          }
          this._mapOverlay.style.cursor = 'default'; // カーソルをデフォルトに
          return;
      }

      // 最も近い頂点をホバー
      const hoveredVertex = this._findClosestVertex(worldPoint);
      if (hoveredVertex) {
          this._viewModel.hoverVertex(hoveredVertex.id);
          this._viewModel.hoverFeature(null); // 地物のホバーは解除
          this._mapOverlay.style.cursor = 'pointer'; // カーソル変更
      } else {
          // 頂点がなければ地物をホバー
          const hoveredFeature = this._findClosestFeature(worldPoint);
          if (hoveredFeature) {
              this._viewModel.hoverFeature(hoveredFeature.id);
              this._viewModel.hoverVertex(null); // 頂点のホバーは解除
              this._mapOverlay.style.cursor = 'pointer'; // カーソル変更
          } else {
              // 何もホバーしていなければ解除
              this._viewModel.hoverVertex(null);
              this._viewModel.hoverFeature(null);
              this._mapOverlay.style.cursor = 'default'; // カーソルをデフォルトに
          }
      }
      this._render(); // ホバー状態を反映
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
            this._viewModel.clearSelection(); // 選択も解除
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

  /**
   * アクションボタン（確定/キャンセル）を作成
   * @private
   */
  _createActionButtons() {
      this._actionButtonsContainer.innerHTML = ''; // 既存ボタンをクリア

      const confirmButton = document.createElement('button');
      confirmButton.textContent = '確定 (Enter)';
      confirmButton.style.marginRight = '10px';
      confirmButton.onclick = this._handleConfirmClick.bind(this);

      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'キャンセル (Esc)';
      cancelButton.onclick = this._handleCancelClick.bind(this);

      this._actionButtonsContainer.appendChild(confirmButton);
      this._actionButtonsContainer.appendChild(cancelButton);
  }

  /**
   * アクションボタンの表示/非表示を更新
   * @private
   */
  _updateActionButtonsVisibility() {
      const mode = this._editingViewModel.getMode();
      const points = this._editingViewModel.getAddingPoints();
      const tool = this._editingViewModel.getTool();
      let show = false;

      if (mode === 'add' && points.length > 0) {
          // ツールに応じて表示条件を設定
          if (tool === 'point' && points.length === 1) {
              show = true;
          } else if (tool === 'line' && points.length >= 2) {
              show = true;
          } else if (tool === 'polygon' && points.length >= 3) {
              show = true;
          }
      }

      this._actionButtonsContainer.style.display = show ? 'block' : 'none';
  }

  /**
   * 確定ボタンクリックのハンドラ
   * @private
   */
  _handleConfirmClick() {
      const points = this._editingViewModel.getAddingPoints();
      const tool = this._editingViewModel.getTool();

      // ツールごとの最小頂点数をチェック
      let isValid = false;
      if (tool === 'point' && points.length === 1) isValid = true;
      if (tool === 'line' && points.length >= 2) isValid = true;
      if (tool === 'polygon' && points.length >= 3) isValid = true;

      if (isValid) {
          this._showPropertyInputDialog();
      } else {
          alert(`${tool === 'point' ? '点' : tool === 'line' ? '線' : '面'}を作成するには、頂点が足りません。`);
      }
  }

  /**
   * キャンセルボタンクリックのハンドラ
   * @private
   */
  _handleCancelClick() {
      // EditingViewModel の内部メソッドを直接呼ぶのは避けるべきだが、暫定対応
      this._editingViewModel._clearAddingPoints();
      // 他のキャンセル処理（例：プロパティダイアログを閉じる）
      const existingDialog = this._mapElement.querySelector('.property-input-dialog');
      if (existingDialog) existingDialog.remove();
  }

  /**
   * プロパティ入力ダイアログを表示
   * @private
   */
  _showPropertyInputDialog() {
    // 既存のダイアログがあれば削除
    const existingDialog = this._mapElement.querySelector('.property-input-dialog');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('div');
    dialog.className = 'property-input-dialog';
    dialog.style.position = 'absolute';
    dialog.style.top = '50%';
    dialog.style.left = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.zIndex = '30';
    dialog.style.background = 'white';
    dialog.style.padding = '20px';
    dialog.style.border = '1px solid #ccc';
    dialog.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';

    const form = document.createElement('form');
    form.onsubmit = (e) => { e.preventDefault(); confirmButton.click(); }; // Enterで確定

    // 名前入力
    const nameLabel = document.createElement('label');
    nameLabel.textContent = '名前: ';
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.name = 'name'; nameInput.required = true;
    const nameRow = document.createElement('div'); nameRow.style.marginBottom='10px';
    nameRow.appendChild(nameLabel); nameRow.appendChild(nameInput);
    form.appendChild(nameRow);

    // 説明入力
    const descLabel = document.createElement('label');
    descLabel.textContent = '説明: ';
    const descInput = document.createElement('textarea');
    descInput.name = 'description';
    const descRow = document.createElement('div'); descRow.style.marginBottom='10px';
    descRow.appendChild(descLabel); descRow.appendChild(descInput);
    form.appendChild(descRow);

    // カテゴリ選択
    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = 'カテゴリ: ';
    const categorySelect = document.createElement('select');
    categorySelect.name = 'category';
    // サイドバーと同じカテゴリ取得ロジックを使うべきだが、ここでは簡易的に
    const categories = this._getFeatureCategories(); // 仮のカテゴリ取得関数
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id; option.textContent = cat.name;
        categorySelect.appendChild(option);
    });
    const categoryRow = document.createElement('div'); categoryRow.style.marginBottom='10px';
    categoryRow.appendChild(categoryLabel); categoryRow.appendChild(categorySelect);
    form.appendChild(categoryRow);

    // ボタン
    const buttonRow = document.createElement('div'); buttonRow.style.textAlign = 'right';
    const confirmButton = document.createElement('button'); confirmButton.type = 'button'; confirmButton.textContent = '確定';
    const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.textContent = 'キャンセル';
    cancelButton.dataset.action = 'cancel'; // キャンセルボタン識別用
    cancelButton.style.marginLeft = '10px';
    buttonRow.appendChild(confirmButton); buttonRow.appendChild(cancelButton);
    form.appendChild(buttonRow);

    dialog.appendChild(form);
    this._mapElement.appendChild(dialog);
    nameInput.focus();

    confirmButton.onclick = () => {
        const properties = {
            name: nameInput.value.trim() || '名称未設定',
            description: descInput.value.trim(),
            category: categorySelect.value || 'default' // デフォルトカテゴリ
        };
        // TODO: 現在選択中のレイヤーIDを取得する
        const currentLayerId = this._viewModel.getWorld()?.layers[0]?.id || 'layer-base'; // 仮
        this._confirmAddFeatureWithProperties(properties, currentLayerId);
        dialog.remove();
    };
    cancelButton.onclick = () => {
        dialog.remove();
        // キャンセルしたので追加中の点もクリアする
        this._handleCancelClick();
    };
  }

  /**
   * 入力されたプロパティで地物追加を確定
   * @param {Object} properties - UIから入力されたプロパティ { name, description, category }
   * @param {string} layerId - レイヤーID
   * @private
   */
  async _confirmAddFeatureWithProperties(properties, layerId) {
    try {
        // 正しいTimePointインスタンスを使う
        const correctTimePoint = this._viewModel.getCurrentTime();

        // Propertyインスタンスの生成 (TimePointを使う)
        const domainProperty = new Property(
            correctTimePoint, // TimePointインスタンスを使用
            properties.name,
            properties.description,
            { category: properties.category }, // 属性はオブジェクトで
            null, // startTime
            null  // endTime
        );

        // EditingViewModelのメソッドを呼び出す
        // プロパティを配列で渡す
        await this._editingViewModel.confirmAddFeature([domainProperty], layerId);

        console.log('地物の追加が確定しました。');
        // 成功した場合、ViewModelの変更通知によって自動的にUIが更新されるはず
        // (追加中の線が消え、確定された地物が描画される)

    } catch (error) {
        console.error('地物の追加確定に失敗:', error);
        alert(`エラー: ${error.message}`);
        // 必要であれば、エラー発生時に追加中の点を保持するなどの処理を追加
    }
  }

  /**
   * （仮）カテゴリ取得関数
   * @private
   */
  _getFeatureCategories() {
      // 本来はConfigManagerやViewModelから取得すべき
      return [
          { id: 'default', name: 'デフォルト' },
          { id: 'city', name: '都市' },
          { id: 'road', name: '道路' },
          { id: 'kingdom', name: '王国' },
      ];
  }

}
