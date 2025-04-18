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
    this._dragPreviewElements = []; // ドラッグ中のプレビュー描画物

    // 計測モードの状態
    this._isMeasuringDistance = false;
    this._measurePoints = [];
    this._measureElements = []; // 描画した測定要素を保持

    // マウス状態
    this._isMouseDown = false;
    this._isDragging = false;
    this._dragStartPosition = { x: 0, y: 0 }; // ドラッグ開始時のワールド座標
    this._lastMousePosition = { x: 0, y: 0 }; // ページ座標
    // this._draggedVertexId = null; // EditingViewModelで管理するため不要に

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
    requestAnimationFrame(() => {
      const rect = this._mapElement.getBoundingClientRect();
      if (rect.width > 0) {
        const worldWidth = this._viewportManager.getViewport().worldWidth || 360;
        const initialZoom = rect.width / worldWidth;
        console.log(`初期ズーム計算: width=${rect.width}, worldWidth=${worldWidth}, initialZoom=${initialZoom}`);
        this._viewportManager.updateViewport({ zoom: initialZoom });
      } else {
         console.warn("MapView コンテナ幅が 0 のため、初期ズームを計算できませんでした。");
      }
      this._viewModel.addObserver(this._onViewModelChanged.bind(this));
      this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));
      this._viewportManager.addListener(this._onViewportChanged.bind(this));
      this._setupEventListeners();
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
_getSVGPoint(pageX, pageY) {
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
        return this._svgPoint.matrixTransform(ctm.inverse());
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
    return { x: svgPoint.x, y: -svgPoint.y };
}


  /**
   * イベントリスナーの設定
   * @private
   */
  _setupEventListeners() {
    console.log('イベントリスナーを設定します');
    this._mapOverlay.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._mapOverlay.addEventListener('mousemove', this._onMouseMove.bind(this));
    this._mapOverlay.addEventListener('mouseup', this._onMouseUp.bind(this));
    this._mapOverlay.addEventListener('mouseleave', this._onMouseLeave.bind(this));
    this._mapOverlay.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this._mapOverlay.addEventListener('dblclick', this._onDoubleClick.bind(this));
    this._mapOverlay.addEventListener('contextmenu', this._onContextMenu.bind(this));
    this._mapOverlay.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this._mapOverlay.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this._mapOverlay.addEventListener('touchend', this._onTouchEnd.bind(this));
    window.addEventListener('keydown', this._onKeyDown.bind(this));
    window.addEventListener('keyup', this._onKeyUp.bind(this));
    window.addEventListener('resize', this._onResize.bind(this));
  }

  /**
   * ビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onViewModelChanged(type, data) {
    switch (type) {
      case 'world':
      case 'features':
      case 'selectedFeature':
      case 'selectedVertices':
      case 'hoveredFeature':
      case 'hoveredVertex':
      case 'layers':
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
    switch (type) {
      case 'mode':
      case 'tool':
        this._updateActionButtonsVisibility();
        this._render();
         this._viewModel.clearSelection();
         // モード変更時にドラッグ状態をリセット (ViewModel側でも行われるが念のため)
         if (this._editingViewModel.getDraggingVertexInfo()) {
             this._editingViewModel._resetDraggingState();
         }
        break;
      case 'addingPoints':
      case 'addingHoleTarget': // 穴追加対象変更時も再描画
      case 'temporaryElements': // 汎用一時要素の変更
      case 'draggingVertex': // ドラッグ中の頂点変更
        this._render();
        break;
       case 'history':
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
    this._updateClickTolerance();
    this._render();
  }

    /**
     * クリック許容範囲をワールド座標の二乗で更新
     * @private
     */
    _updateClickTolerance() {
        const viewport = this._viewportManager.getViewport();
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

    if (this._renderer && this._renderer._svg && !this._svgPoint) {
        this._svgPoint = this._renderer._svg.createSVGPoint();
        console.log("SVGPointを遅延作成しました。");
    }

    const viewport = this._viewportManager.getViewport();
    const currentTime = this._viewModel.getCurrentTime();
    const draggingVertexInfo = this._editingViewModel.getDraggingVertexInfo();

    // --- 実際の描画 ---
    // 1. 通常の地物を描画 (Rendererに任せる)
    this._renderer.render(world, viewport, currentTime);

    // --- オーバーレイ要素の描画 ---
    // 2. 選択ハイライト
    this._clearSelectionHighlights();
    this._renderSelection();

    // 3. 地物追加/穴追加プレビュー
    this._renderAddingFeature();

    // 4. ドラッグ中のプレビュー (Rendererを使う)
    this._clearDragPreviews();
    if (draggingVertexInfo) {
        this._renderDragPreview(draggingVertexInfo, world, viewport);
    }

    // 5. 汎用一時要素 (EditingViewModelの temporaryElements)
    //    注: ドラッグ中の頂点マーカーは _renderDragPreview で描画される
    //    this._renderTemporaryElements();

    // 6. 距離測定
    this._renderDistanceMeasurement();

    // --- UI更新 ---
    // 7. アクションボタン表示更新
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
     * ドラッグプレビュー描画物をクリア
     * @private
     */
    _clearDragPreviews() {
        this._dragPreviewElements.forEach(el => this._renderer.removeElement(el));
        this._dragPreviewElements = [];
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
    const currentTime = this._viewModel.getCurrentTime();
    if (!world) return;

    const draggingVertexInfo = this._editingViewModel.getDraggingVertexInfo();

    // 選択された地物のハイライト
    if (selectedFeature && selectedFeature.existsAt(currentTime)) {
        let featureVertices = [];
        // ドラッグ中は仮の位置を使用
        const tempVertices = draggingVertexInfo
            ? { [draggingVertexInfo.id]: draggingVertexInfo.currentPosition }
            : {};

        const getVertexPos = (vertexId) => {
            if (tempVertices[vertexId]) return tempVertices[vertexId];
            const v = world.vertices.find(wv => wv.id === vertexId);
            return v ? { x: v.x, y: v.y } : null;
        };

        if (selectedFeature.vertexIds && selectedFeature.vertexIds.length > 0) {
            featureVertices = selectedFeature.vertexIds
                .map(id => getVertexPos(id))
                .filter(Boolean);
        }

        const style = {
            stroke: '#00ffff', strokeWidth: 4, fill: 'none', strokeDasharray: '4,4'
        };

        if (selectedFeature instanceof DomainPoint && featureVertices.length === 1) {
            const elem = this._renderer.drawPoint(featureVertices[0].x, featureVertices[0].y, {
                 radius: 8, stroke: '#00ffff', strokeWidth: 2, fill: 'none', 'stroke-dasharray': '2,2'
            }, viewport);
             if (elem) this._selectionElements.push(elem);
        } else if (selectedFeature instanceof DomainLine && featureVertices.length >= 2) {
            const elem = this._renderer.drawLine(featureVertices, style, viewport);
             if (elem) this._selectionElements.push(elem);
        } else if (selectedFeature instanceof DomainPolygon) {
             // 通常ポリゴンまたはMultiPolygonの外周を描画
            if (featureVertices.length >= 3) {
                const elem = this._renderer.drawLine([...featureVertices, featureVertices[0]], style, viewport);
                if (elem) this._selectionElements.push(elem);
            }
            // MultiPolygonのサブポリゴンも描画
            if (selectedFeature.isMultiPolygon && selectedFeature.subPolygons) {
                selectedFeature.subPolygons.forEach(sub => {
                    const subVertices = sub.vertexIds
                        ?.map(id => getVertexPos(id))
                        .filter(Boolean);
                    if (subVertices && subVertices.length >= 3) {
                        const subElem = this._renderer.drawLine([...subVertices, subVertices[0]], style, viewport);
                        if (subElem) this._selectionElements.push(subElem);
                    }
                });
            }
            // TODO: 穴のハイライト (ドラッグ対応)
        }
    }

    // 選択された頂点のハイライト (ドラッグ中の頂点は除く)
    selectedVertices.forEach(vertex => {
        if (draggingVertexInfo && vertex.id === draggingVertexInfo.id) return; // ドラッグ中の頂点は別で描画
        const elem = this._renderer.drawPoint(vertex.x, vertex.y, {
            radius: 6, fill: '#00ffff', stroke: '#0000ff', strokeWidth: 1,
        }, viewport);
        if (elem) this._selectionElements.push(elem);
    });

     this._selectionElements.forEach(el => el.classList.add('temp-drawing', 'selection-highlight'));
  }

  /**
   * ドラッグ中のプレビューを描画
   * @param {Object} draggingInfo - ドラッグ情報 { id, currentPosition }
   * @param {Object} world - ワールドデータ
   * @param {Object} viewport - ビューポート情報
   * @private
   */
  _renderDragPreview(draggingInfo, world, viewport) {
      // ドラッグ中の頂点マーカー
      const marker = this._renderer.drawPoint(
          draggingInfo.currentPosition.x,
          draggingInfo.currentPosition.y,
          { fill: '#ff00ff', radius: 7, stroke: '#ffffff', strokeWidth: 2 },
          viewport
      );
      if (marker) this._dragPreviewElements.push(marker);

      // 影響を受ける地物を探し、仮の形状を描画
      const affectedFeatures = world.features.filter(f =>
          (f.vertexIds && f.vertexIds.includes(draggingInfo.id)) ||
          (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(draggingInfo.id))) ||
          (f.subPolygons && f.subPolygons.some(sub => sub.vertexIds.includes(draggingInfo.id)))
      );

      const getVertexPos = (vertexId) => {
          if (vertexId === draggingInfo.id) return draggingInfo.currentPosition;
          const v = world.vertices.find(wv => wv.id === vertexId);
          return v ? { x: v.x, y: v.y } : null;
      };

      affectedFeatures.forEach(feature => {
          const style = { stroke: '#ff00ff', strokeWidth: 2, fill: 'none', strokeDasharray: '3,3' };
          if (feature instanceof DomainLine) {
              const lineVertices = feature.vertexIds.map(id => getVertexPos(id)).filter(Boolean);
              if (lineVertices.length >= 2) {
                  const elem = this._renderer.drawLine(lineVertices, style, viewport);
                  if (elem) this._dragPreviewElements.push(elem);
              }
          } else if (feature instanceof DomainPolygon) {
              // 外周
              const outerVertices = feature.vertexIds?.map(id => getVertexPos(id)).filter(Boolean);
              if (outerVertices && outerVertices.length >= 3) {
                  const elem = this._renderer.drawLine([...outerVertices, outerVertices[0]], style, viewport);
                  if (elem) this._dragPreviewElements.push(elem);
              }
              // 穴
              feature.holesVertexIds?.forEach(holeIds => {
                  const holeVertices = holeIds.map(id => getVertexPos(id)).filter(Boolean);
                  if (holeVertices.length >= 3) {
                      const elem = this._renderer.drawLine([...holeVertices, holeVertices[0]], style, viewport);
                      if (elem) this._dragPreviewElements.push(elem);
                  }
              });
              // 飛び地
              feature.subPolygons?.forEach(sub => {
                  const subVertices = sub.vertexIds?.map(id => getVertexPos(id)).filter(Boolean);
                  if (subVertices && subVertices.length >= 3) {
                      const elem = this._renderer.drawLine([...subVertices, subVertices[0]], style, viewport);
                      if (elem) this._dragPreviewElements.push(elem);
                  }
                  // 飛び地の穴も描画する必要がある場合
              });
          }
          // Point は頂点マーカーのみでOK
      });

      this._dragPreviewElements.forEach(el => el.classList.add('temp-drawing', 'drag-preview'));
  }


  /**
   * 追加中の地物または穴の描画
   * @private
   */
  _renderAddingFeature() {
     // 既存の一時要素を削除 (プレフィックスで識別)
     this._clearTemporaryDrawings('adding-');

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();

    // 'add' モードまたは 'edit' モードの 'add-hole' ツールの場合のみ描画
    if (!((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole'))) {
        return;
    }

    const addingPoints = this._editingViewModel.getAddingPoints();
    if (addingPoints.length === 0) return;

    const viewport = this._viewportManager.getViewport();
    let tempElements = []; // この描画で作成した一時要素
    const isAddingHole = tool === 'add-hole';

    // スタイル設定
    const pointStyle = { fill: '#ffffff', radius: 4, stroke: '#000000', strokeWidth: 1 };
    const lineStyle = isAddingHole
        ? { stroke: '#ff00ff', strokeWidth: 3, strokeDasharray: '5,5' } // 穴追加時の線スタイル
        : tool === 'line'
            ? { stroke: '#0000ff', strokeWidth: 3, strokeDasharray: '5,5' } // 線追加時の線スタイル
            : tool === 'polygon'
                ? { stroke: '#00ff00', strokeWidth: 3, strokeDasharray: '5,5' } // 面追加時の線スタイル
                : {}; // 点追加時は線なし

    // ツールタイプに応じた描画
    if (tool === 'point') {
        if (addingPoints.length === 1) {
            const elem = this._renderer.drawPoint(addingPoints[0].x, addingPoints[0].y,
                { fill: '#ff0000', radius: 6, stroke: '#ffffff', strokeWidth: 2 }, viewport);
            if (elem) tempElements.push(elem);
        }
    } else if (tool === 'line' || tool === 'polygon' || tool === 'add-hole') {
        // 線またはポリゴン（穴）のプレビュー線を描画
        if (addingPoints.length >= 2) {
            // ポリゴンまたは穴の場合は閉じる線も描画 (3点以上の場合)
            const pointsToDraw = (tool === 'polygon' || tool === 'add-hole') && addingPoints.length >= 3
                ? [...addingPoints, addingPoints[0]]
                : addingPoints;
            const elem = this._renderer.drawLine(pointsToDraw, lineStyle, viewport);
            if (elem) tempElements.push(elem);
        }
    }

    // 各頂点の描画
    for (const point of addingPoints) {
       const elem = this._renderer.drawPoint(point.x, point.y, pointStyle, viewport);
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
     // 既存の一時要素を削除 (プレフィックスで識別)
     this._clearTemporaryDrawings('temp-'); // 汎用的な一時要素

    const elements = this._editingViewModel.getTemporaryElements();
    const viewport = this._viewportManager.getViewport();
    let tempElements = []; // この描画で作成した一時要素

    elements.forEach(element => {
        let elem = null;
        if (element.type === 'point') {
            elem = this._renderer.drawPoint(element.x, element.y, element.style, viewport);
        } else if (element.type === 'line') {
            elem = this._renderer.drawLine(element.points, element.style, viewport);
        } else if (element.type === 'text') {
             elem = this._renderer.drawText(element.x, element.y, element.content, element.style, viewport);
        }
        if (elem) {
             elem.classList.add('temp-drawing', 'temp-element'); // クラス付与
             tempElements.push(elem);
        }
    });
    // 注: EditingViewModelの _temporaryElements はMapView側でクリアされないため、
    // EditingViewModel 側で適切に管理・クリアする必要がある。
  }

/**
 * 距離測定の描画
 * @private
 */
_renderDistanceMeasurement() {
    this._clearTemporaryDrawings('measure-');
    if (!this._isMeasuringDistance || this._measurePoints.length === 0) return;

    const viewport = this._viewportManager.getViewport();
    let tempElements = [];

    this._measurePoints.forEach((point, index) => {
        const pointElem = this._renderer.drawPoint(point.x, point.y,
            { fill: '#ffff00', radius: 4, stroke: '#000000', strokeWidth: 1 }, viewport);
        if (pointElem) tempElements.push(pointElem);

        const labelElem = this._renderer.drawText(point.x, point.y + 10 / viewport.zoom, // Yオフセット修正
            String.fromCharCode(65 + index),
            { fontSize: 10, textColor: '#000000', textAnchor: 'middle', dominantBaseline: 'hanging'}, viewport);
        if(labelElem) tempElements.push(labelElem);
    });

    if (this._measurePoints.length >= 2) {
        const lineElem = this._renderer.drawLine(this._measurePoints,
            { stroke: '#ffff00', strokeWidth: 2, strokeDasharray: '5,5' }, viewport);
        if (lineElem) tempElements.push(lineElem);

        const equatorLength = this._configManager.get('map.equatorLength', 40000);
        const distances = [];
        let totalLinear = 0;
        let totalGreatCircle = 0;

        for (let i = 1; i < this._measurePoints.length; i++) {
            const p1 = this._measurePoints[i - 1];
            const p2 = this._measurePoints[i];
            const distance = this._viewModel.calculateDistance(p1, p2, equatorLength);
            distances.push(distance);
            totalLinear += distance.linear;
            totalGreatCircle += distance.greatCircle;

            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const segmentLabelElem = this._renderer.drawText(midX, midY - 10 / viewport.zoom, // Yオフセット修正
                `${distance.linear.toFixed(1)}km`,
                { fontSize: 9, textColor: '#333300', textAnchor: 'middle', dominantBaseline: 'alphabetic'}, viewport);
            if(segmentLabelElem) tempElements.push(segmentLabelElem);
        }

        const lastPoint = this._measurePoints[this._measurePoints.length - 1];
        const textYOffset = 15 / viewport.zoom; // Yオフセット修正

        const totalLinearElem = this._renderer.drawText(lastPoint.x + 10 / viewport.zoom, lastPoint.y + textYOffset * 2, // Yオフセット修正
            `直線計: ${totalLinear.toFixed(1)} km`,
            { fontSize: 10, textColor: '#000000', textAnchor: 'start', dominantBaseline: 'hanging'}, viewport);
        if(totalLinearElem) tempElements.push(totalLinearElem);

        const totalGreatCircleElem = this._renderer.drawText(lastPoint.x + 10 / viewport.zoom, lastPoint.y + textYOffset, // Yオフセット修正
            `大円計: ${totalGreatCircle.toFixed(1)} km`,
            { fontSize: 10, textColor: '#000000', textAnchor: 'start', dominantBaseline: 'hanging'}, viewport);
        if(totalGreatCircleElem) tempElements.push(totalGreatCircleElem);
    }
     tempElements.forEach(el => el.classList.add('temp-drawing', 'measure-element'));
     this._measureElements = tempElements;
}

  /**
   * マウスダウンのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
_onMouseDown(event) {
  const targetElement = event.target;
  if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
    return;
  }

    if (event.button === 2) return;

  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw);

  if (!worldPoint) {
      console.error("ワールド座標を取得できませんでした。");
      return;
  }

  this._isMouseDown = true;
  this._lastMousePosition = { x: pageX, y: pageY };
  this._dragStartPosition = worldPoint;
  // this._draggedVertexId = null; // ViewModelで管理

  const mode = this._editingViewModel.getMode();
  const tool = this._editingViewModel.getTool();

  switch (mode) {
    case 'view':
      this._viewportManager.startDrag(pageX, pageY);
      break;

    case 'add':
      this._handleAddPoint(worldPoint);
      break;

    case 'edit':
      if (tool === 'add-hole') {
        // 穴追加モードの場合
        if (!this._editingViewModel.getTargetPolygonIdForHole()) {
             // 最初のクリック: 穴を追加するポリゴンを選択
             const clickedFeature = this._findClosestFeature(worldPoint);
             if (clickedFeature instanceof DomainPolygon) {
                 this._editingViewModel.startAddingHole(clickedFeature.id);
                 this._viewModel.selectFeature(clickedFeature.id); // 対象ポリゴンを選択状態にする
                 console.log(`Hole adding started for polygon: ${clickedFeature.id}`);
             } else {
                 alert("穴を追加するポリゴンを選択してください。");
             }
        } else {
             // 2回目以降のクリック: 穴の頂点を追加
             this._handleAddPoint(worldPoint);
        }
      } else {
        // 通常の編集モード (選択/移動など)
        const clickedVertex = this._findClosestVertex(worldPoint);
        const addToSelection = event.shiftKey;

        if (clickedVertex) {
          // 頂点が見つかった場合、ドラッグ開始
          this._viewModel.selectVertex(clickedVertex.id, addToSelection);
          // ドラッグ開始処理を ViewModel に依頼
          this._editingViewModel.startVertexDrag(clickedVertex.id, { x: clickedVertex.x, y: clickedVertex.y });
          // 関連する地物の選択 (ViewModel側で行うべきかもしれない)
          const features = this._viewModel.getFeatures();
          const ownerFeature = features.find(f =>
              (f.vertexIds && f.vertexIds.includes(clickedVertex.id)) ||
              (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(clickedVertex.id))) ||
              (f.subPolygons && f.subPolygons.some(sub => sub.vertexIds.includes(clickedVertex.id)))
          );
          if (ownerFeature) {
              if (!addToSelection || this._viewModel.getSelectedFeature()?.id !== ownerFeature.id) {
                  this._viewModel._selectedFeature = ownerFeature; // ViewModel内部状態変更は良くない -> selectFeatureを使うべき
                  this._viewModel._notifyObservers('selectedFeature');
              }
          } else {
               if (!addToSelection) {
                   this._viewModel._selectedFeature = null;
                   this._viewModel._notifyObservers('selectedFeature');
               }
          }
        } else {
          // 頂点が見つからない場合、地物を探す
          const clickedFeature = this._findClosestFeature(worldPoint);
          if (clickedFeature) {
              this._viewModel.selectFeature(clickedFeature.id);
          } else {
            if (!addToSelection) {
                this._viewModel.clearSelection();
            }
          }
        }
      }
      break; // case 'edit' の終了

    default:
      break;
  }

  if (this._isMeasuringDistance) {
    this._handleAddMeasurePoint(worldPoint);
  }
}

  /**
   * マウス移動のハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
_onMouseMove(event) {
  const targetElement = event.target;
  if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
    return;
  }

  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw);

  if (!worldPoint) return;

  if (this._isMouseDown) {
    if (!this._isDragging) {
      const dx = pageX - this._lastMousePosition.x;
      const dy = pageY - this._lastMousePosition.y;
      const dragThreshold = 5;
      if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
        this._isDragging = true;
      }
    }

    if (this._isDragging) {
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const isDraggingVertex = !!this._editingViewModel.getDraggingVertexInfo(); // ViewModelからドラッグ状態を取得

      if (mode === 'view') {
        this._viewportManager.drag(pageX, pageY);
      } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertex) { // 頂点ドラッグ中
        this._editingViewModel.updateVertexDrag(worldPoint); // ViewModelに現在の仮位置を通知
      }
    }
  } else {
     this._handleMouseHover(worldPoint);
  }

  this._lastMousePosition = { x: pageX, y: pageY };
}

  /**
   * マウスアップのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
_onMouseUp(event) {
  const targetElement = event.target;
  if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
    return;
  }

  const mode = this._editingViewModel.getMode();
  const tool = this._editingViewModel.getTool();
  const isDraggingVertex = !!this._editingViewModel.getDraggingVertexInfo();

  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw);

  // ドラッグ終了処理
  if (this._isMouseDown && this._isDragging) {
    if (mode === 'view') {
      this._viewportManager.endDrag();
    } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertex) {
        // ドラッグ終了をViewModelに通知して確定処理を依頼
        this._editingViewModel.endVertexDrag();
    }
  }
  // クリック（ドラッグなし）処理
  else if (this._isMouseDown && !this._isDragging && worldPoint) {
    if (mode === 'view') {
      this._handleClick(worldPoint);
    }
    // 'add' と 'edit' モードのクリックは onMouseDown で処理済み
  }

  // 状態リセット
  this._isMouseDown = false;
  this._isDragging = false;
  // ドラッグ状態は ViewModel の endVertexDrag 内でリセットされる
}

  /**
   * マウス離脱のハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onMouseLeave(event) {
    if (this._isMouseDown) {
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const isDraggingVertex = !!this._editingViewModel.getDraggingVertexInfo();

      if (mode === 'view' && this._isDragging) {
        this._viewportManager.endDrag();
      } else if (mode === 'edit' && tool !== 'add-hole' && this._isDragging && isDraggingVertex) {
          // ドラッグ終了をViewModelに通知
          this._editingViewModel.endVertexDrag();
      }

      this._isMouseDown = false;
      this._isDragging = false;
      // ドラッグ状態は ViewModel の endVertexDrag 内でリセットされる
    }
     this._viewModel.hoverFeature(null);
     this._viewModel.hoverVertex(null);
     this._render();
  }

  /**
   * ホイールのハンドラ
   * @param {WheelEvent} event - ホイールイベント
   * @private
   */
_onWheel(event) {
  const targetElement = event.target;
  if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
    return;
  }

  event.preventDefault();

  const delta = -event.deltaY;
  const zoomFactor = delta > 0 ? 0.1 : -0.1;

  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw);

  if (!worldPoint) return;

  this._viewportManager.zoomAt(worldPoint.x, worldPoint.y, zoomFactor);
  }

  /**
   * ダブルクリックのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onDoubleClick(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
      return;
    }

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);

    if (!worldPoint) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();

    if (mode === 'add' && tool) {
      // 地物追加モードでのダブルクリックは確定処理
       this._handleAddPoint(worldPoint); // 最後の点を追加
       this._handleConfirmClick(); // 確定処理
    } else if (mode === 'edit' && tool === 'add-hole') {
        // 穴追加モードでのダブルクリックも確定処理
        this._handleAddPoint(worldPoint); // 最後の点を追加
        this._handleConfirmClick(); // 確定処理 (内部で confirmAddHole を呼ぶ)
    } else if (mode === 'view') {
      // 通常のダブルクリック（ビューポートリセット）
      console.log('ダブルクリック - World:', worldPoint.x, worldPoint.y);
      this._viewportManager.updateViewport({
        x: worldPoint.x,
        y: worldPoint.y,
        zoom: 1
      });
    }
  }

  /**
   * コンテキストメニューのハンドラ
   * @param {MouseEvent} event - マウスイベント
   * @private
   */
  _onContextMenu(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
      return;
    }

    event.preventDefault();

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);

    if (!worldPoint) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();

    if (mode === 'add' || tool === 'add-hole') {
        // 地物追加中または穴追加中の右クリックはキャンセル扱い
        this._handleCancelClick();
        console.log("Add/Hole operation cancelled by right-click.");
    } else if (mode === 'edit') {
         // 編集モードでの右クリック: コンテキストメニュー
         this._selectObjectAt(worldPoint); // 右クリック位置のオブジェクトを選択
         // TODO: 選択状態に基づいてコンテキストメニューを表示する実装
         alert(`Context menu triggered at ${worldPoint.x.toFixed(2)}, ${worldPoint.y.toFixed(2)}`);
     } else if (this._isMeasuringDistance) {
         // 測定中の右クリックはキャンセル
         this.clearMeasurements();
         this.setMeasuringDistance(false);
         console.log("Measurement cancelled by right-click.");
     }
  }

  /**
   * タッチ開始のハンドラ
   * @param {TouchEvent} event - タッチイベント
   * @private
   */
  _onTouchStart(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
      return;
    }
    event.preventDefault();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      const pageX = touch.clientX;
      const pageY = touch.clientY;
      const svgPointRaw = this._getSVGPoint(pageX, pageY);
      const worldPoint = this._svgToWorld(svgPointRaw);

      if (!worldPoint) return;

      this._isMouseDown = true;
      this._lastMousePosition = { x: pageX, y: pageY };
      this._dragStartPosition = worldPoint;
      // this._draggedVertexId = null; // ViewModelで管理

      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();

      if (mode === 'view') {
        this._viewportManager.startDrag(pageX, pageY);
      } else if (mode === 'add' && tool) {
          this._handleAddPoint(worldPoint);
      } else if (mode === 'edit') {
           if (tool === 'add-hole') {
               if (!this._editingViewModel.getTargetPolygonIdForHole()) {
                    const clickedFeature = this._findClosestFeature(worldPoint);
                    if (clickedFeature instanceof DomainPolygon) {
                        this._editingViewModel.startAddingHole(clickedFeature.id);
                        this._viewModel.selectFeature(clickedFeature.id);
                    } else { /* alertなど */ }
               } else {
                    this._handleAddPoint(worldPoint);
               }
           } else {
               const clickedVertex = this._findClosestVertex(worldPoint);
               if (clickedVertex) {
                   this._viewModel.selectVertex(clickedVertex.id, false); // 単一選択
                   this._editingViewModel.startVertexDrag(clickedVertex.id, { x: clickedVertex.x, y: clickedVertex.y });
               } else {
                   this._selectObjectAt(worldPoint); // 頂点以外を選択
               }
           }
      }

      if (this._isMeasuringDistance) {
        this._handleAddMeasurePoint(worldPoint);
      }
    }
    // TODO: ピンチ処理
  }

  /**
   * タッチ移動のハンドラ
   * @param {TouchEvent} event - タッチイベント
   * @private
   */
  _onTouchMove(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
      return;
    }
    event.preventDefault();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      const pageX = touch.clientX;
      const pageY = touch.clientY;
      const svgPointRaw = this._getSVGPoint(pageX, pageY);
      const worldPoint = this._svgToWorld(svgPointRaw);

      if (!worldPoint) return;

      if (this._isMouseDown) {
        if (!this._isDragging) {
          const dx = pageX - this._lastMousePosition.x;
          const dy = pageY - this._lastMousePosition.y;
          const dragThreshold = 10;
          if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
            this._isDragging = true;
          }
        }

        if (this._isDragging) {
          const mode = this._editingViewModel.getMode();
          const tool = this._editingViewModel.getTool();
          const isDraggingVertex = !!this._editingViewModel.getDraggingVertexInfo();

          if (mode === 'view') {
            this._viewportManager.drag(pageX, pageY);
          } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertex) {
            this._editingViewModel.updateVertexDrag(worldPoint);
          }
        }
      }
      this._lastMousePosition = { x: pageX, y: pageY };
    }
    // TODO: ピンチ処理
  }

  /**
   * タッチ終了のハンドラ
   * @param {TouchEvent} event - タッチイベント
   * @private
   */
  _onTouchEnd(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) {
      return;
    }

    if (this._isMouseDown) {
        const mode = this._editingViewModel.getMode();
        const tool = this._editingViewModel.getTool();
        const isDraggingVertex = !!this._editingViewModel.getDraggingVertexInfo();

        if (mode === 'view' && this._isDragging) {
            this._viewportManager.endDrag();
        } else if (mode === 'edit' && tool !== 'add-hole' && this._isDragging && isDraggingVertex) {
            this._editingViewModel.endVertexDrag();
        } else if (!this._isDragging) { // タップ（クリック相当）
             // タップ時の選択処理は onTouchStart で既に行われている場合が多い
             // ダブルタップ検出は別途必要
        }
    }
    this._isMouseDown = false;
    this._isDragging = false;
    // ドラッグ状態は ViewModel の endVertexDrag 内でリセットされる
    // TODO: ピンチ状態リセット
  }

  /**
   * キーダウンのハンドラ
   * @param {KeyboardEvent} event - キーボードイベント
   * @private
   */
  _onKeyDown(event) {
    const targetElement = event.target;
    const isInInputDialog = targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form');

    if (isInInputDialog) {
        if (event.key === 'Enter') {
            event.stopPropagation();
            const dialog = targetElement.closest('.property-input-dialog, .layer-input-form');
            const confirmButton = dialog?.querySelector('button:not([data-action="cancel"])');
            if (confirmButton) confirmButton.click();
            return;
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            const dialog = targetElement.closest('.property-input-dialog, .layer-input-form');
            const cancelButton = dialog?.querySelector('button[data-action="cancel"]');
            if (cancelButton) {
              cancelButton.click();
            } else if (dialog) {
              dialog.remove();
              this._handleCancelClick(); // EditingViewModelの状態もクリア
            }
            return;
        } else {
            return;
        }
    } else if (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement || targetElement instanceof HTMLSelectElement) {
        return;
    }

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();

    if (event.key === 'Escape') {
       event.preventDefault();
       // ドラッグ中ならキャンセル
       if (this._editingViewModel.getDraggingVertexInfo()) {
           this._editingViewModel._resetDraggingState();
           console.log("Vertex drag cancelled by ESC.");
       }
       // 他のキャンセル処理
       else if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
         this._handleCancelClick(); // 追加/穴追加キャンセル
         console.log("Add/Hole operation cancelled by ESC.");
       } else if (mode === 'edit' && (this._viewModel.getSelectedFeature() || this._viewModel.getSelectedVertices().length > 0)) {
         this._viewModel.clearSelection();
         console.log("Selection cleared by ESC.");
       } else if (this._isMeasuringDistance) {
           this.clearMeasurements();
           this.setMeasuringDistance(false);
           console.log("Measurement cancelled by ESC.");
       } else {
         this._editingViewModel.setMode('view');
         console.log("Mode set to 'view' by ESC.");
       }
    } else if (event.key === 'Enter') {
        // 地物追加中 または 穴追加中のEnterキーで確定
        if (((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) && this._editingViewModel.getAddingPoints().length > 0) {
            event.preventDefault();
            this._handleConfirmClick();
            console.log("Add/Hole operation confirmed by Enter.");
        }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
       event.preventDefault();
      const selectedFeature = this._viewModel.getSelectedFeature();
      const selectedVertices = this._viewModel.getSelectedVertices();

      if (mode === 'edit') {
          if (selectedVertices.length > 0) {
              console.log("Deleting selected vertices:", selectedVertices.map(v => v.id));
              // TODO: await this._editingViewModel.deleteVertices(selectedVertices.map(v => v.id));
          } else if (selectedFeature) {
              this._editingViewModel.deleteFeature(selectedFeature.id, selectedFeature);
          }
      }
    } else if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          this._editingViewModel.redo();
        } else {
          this._editingViewModel.undo();
        }
      } else if (event.key === 'y') {
        event.preventDefault();
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
    // 必要であれば実装
  }

  /**
   * リサイズのハンドラ
   * @private
   */
  _onResize() {
    const rect = this._container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    this._renderer.resize(width, height);
    this._viewportManager.resize(width, height);
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
      let minDistanceSq = this._clickToleranceSq;
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
      let minDistanceSq = this._clickToleranceSq;

      for (const feature of features) {
          let distanceSq = Infinity;
          const featureVertices = feature.vertexIds
              ?.map(id => world.vertices.find(v => v.id === id))
              .filter(Boolean);

          if (!featureVertices && !(feature instanceof DomainPolygon && feature.isMultiPolygon)) {
              continue; // MultiPolygon以外で頂点がない場合はスキップ
          }

          if (feature instanceof DomainPoint) {
               if (featureVertices?.length === 1) {
                   distanceSq = this._viewModel._geometryService.calculateDistanceSq(
                       worldPoint.x, worldPoint.y, featureVertices[0].x, featureVertices[0].y
                   );
               }
          } else if (feature instanceof DomainLine) {
               if (featureVertices?.length >= 2) {
                   for (let i = 0; i < featureVertices.length - 1; i++) {
                       const segmentDistSq = this._viewModel._geometryService.distancePointSegmentSq(
                           worldPoint, featureVertices[i], featureVertices[i + 1]
                       );
                       distanceSq = Math.min(distanceSq, segmentDistSq);
                   }
               }
          } else if (feature instanceof DomainPolygon) {
              if (feature.isMultiPolygon && feature.subPolygons) {
                  // MultiPolygon: 各サブポリゴンとの距離を計算し最小値をとる
                  feature.subPolygons.forEach(sub => {
                      const subVertices = sub.vertexIds?.map(id => world.vertices.find(v => v.id === id)).filter(Boolean);
                      if (subVertices && subVertices.length >= 3) {
                          let subDistSq = Infinity;
                          if (this._viewModel._geometryService.isPointInPolygon(worldPoint, subVertices)) {
                              subDistSq = 0;
                          } else {
                              const polygonVertices = [...subVertices, subVertices[0]];
                              for (let i = 0; i < polygonVertices.length - 1; i++) {
                                  subDistSq = Math.min(subDistSq, this._viewModel._geometryService.distancePointSegmentSq(
                                      worldPoint, polygonVertices[i], polygonVertices[i + 1]
                                  ));
                              }
                              // TODO: MultiPolygonの穴も考慮
                          }
                          distanceSq = Math.min(distanceSq, subDistSq);
                      }
                  });
              } else if (featureVertices?.length >= 3) {
                   // 通常ポリゴン
                   if (this._viewModel._geometryService.isPointInPolygon(worldPoint, featureVertices)) {
                       distanceSq = 0;
                   } else {
                       const polygonVertices = [...featureVertices, featureVertices[0]];
                       for (let i = 0; i < polygonVertices.length - 1; i++) {
                           distanceSq = Math.min(distanceSq, this._viewModel._geometryService.distancePointSegmentSq(
                               worldPoint, polygonVertices[i], polygonVertices[i + 1]
                           ));
                       }
                       // TODO: 通常ポリゴンの穴も考慮
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
   * オブジェクト選択処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @param {boolean} [addToSelection=false] - 選択に追加するかどうか
   * @private
   */
   _selectObjectAt(worldPoint, addToSelection = false) {
      const clickedVertex = this._findClosestVertex(worldPoint);
      if (clickedVertex) {
            this._viewModel.selectVertex(clickedVertex.id, addToSelection);
            // this._draggedVertexId = clickedVertex.id; // ViewModelで管理するため不要
            // 関連地物の選択処理
            const features = this._viewModel.getFeatures();
            const ownerFeature = features.find(f =>
                (f.vertexIds && f.vertexIds.includes(clickedVertex.id)) ||
                (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(clickedVertex.id))) ||
                (f.subPolygons && f.subPolygons.some(sub => sub.vertexIds.includes(clickedVertex.id)))
            );
            if (ownerFeature) {
                if (!addToSelection || this._viewModel.getSelectedFeature()?.id !== ownerFeature.id) {
                    this._viewModel.selectFeature(ownerFeature.id); // ViewModelのメソッドを使う
                }
            } else {
                 if (!addToSelection) {
                     this._viewModel.clearSelection(); // 地物の選択もクリア
                 }
            }
      } else {
           const clickedFeature = this._findClosestFeature(worldPoint);
           if (clickedFeature) {
                this._viewModel.selectFeature(clickedFeature.id);
           } else if (!addToSelection) {
                this._viewModel.clearSelection();
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
    const clickedFeature = this._findClosestFeature(worldPoint);
    if (clickedFeature) {
        this._viewModel.selectFeature(clickedFeature.id);
    } else {
        this._viewModel.clearSelection();
    }
  }

  /**
   * オブジェクトドラッグ処理 (内部状態の更新はViewModelへ委譲)
   * @param {object} worldPoint - 現在のワールド座標 {x, y}
   * @private
   */
  _handleDragObject(worldPoint) {
     // ViewModelに現在の位置を通知するだけで、描画は _render で ViewModel の状態を見て行う
     this._editingViewModel.updateVertexDrag(worldPoint);
  }

  /**
   * ドラッグ終了処理 (ViewModelへ委譲)
   * @param {object} worldPoint - 最終的なワールド座標 {x, y}
   * @private
   */
  async _handleDragEnd(worldPoint) {
    // ViewModelにドラッグ終了を通知し、確定処理を依頼
    // 実際の移動処理は ViewModel -> UseCase で行われる
    await this._editingViewModel.endVertexDrag();
    // this._render(); // _onEditingViewModelChangedで呼ばれるはず
  }

  /**
   * マウスホバー処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleMouseHover(worldPoint) {
      if (this._editingViewModel.getMode() !== 'edit') {
          if (this._viewModel.getHoveredVertex() || this._viewModel.getHoveredFeature()) {
              this._viewModel.hoverVertex(null);
              this._viewModel.hoverFeature(null);
              // this._render(); // ViewModelの変更通知でrenderが呼ばれる
          }
          this._mapOverlay.style.cursor = 'default';
          return;
      }

      const hoveredVertex = this._findClosestVertex(worldPoint);
      if (hoveredVertex) {
          this._viewModel.hoverVertex(hoveredVertex.id);
          this._viewModel.hoverFeature(null);
          this._mapOverlay.style.cursor = 'pointer';
      } else {
          const hoveredFeature = this._findClosestFeature(worldPoint);
          if (hoveredFeature) {
              this._viewModel.hoverFeature(hoveredFeature.id);
              this._viewModel.hoverVertex(null);
              this._mapOverlay.style.cursor = 'pointer';
          } else {
              this._viewModel.hoverVertex(null);
              this._viewModel.hoverFeature(null);
              this._mapOverlay.style.cursor = 'default';
          }
      }
      // this._render(); // ViewModelの変更通知でrenderが呼ばれる
  }

  /**
   * 点追加処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleAddPoint(worldPoint) {
    if (!worldPoint) return;
    this._editingViewModel.addPoint(worldPoint);
  }

  /**
   * 測定点追加処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @private
   */
  _handleAddMeasurePoint(worldPoint) {
    if (!worldPoint) return;
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
        if (!enabled) {
            this.clearMeasurements();
        } else {
            this._editingViewModel.setMode('view');
            this._viewModel.clearSelection();
        }
        this._mapOverlay.style.cursor = enabled ? 'crosshair' : 'default';
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
    this._clearTemporaryDrawings('measure-');
    this._measureElements = [];
     this._render();
  }

  /**
   * 特定のクラスを持つ一時的な描画要素を削除
   * @param {string} classNamePrefix - 削除する要素のクラス名プレフィックス
   * @private
   */
  _clearTemporaryDrawings(classNamePrefix) {
      if (!this._renderer || !this._renderer._mainGroup) return;
      const tempElements = this._renderer._mainGroup.querySelectorAll(`.temp-drawing.${classNamePrefix}element, .temp-drawing.${classNamePrefix}feature, .temp-drawing.${classNamePrefix}preview`);
      tempElements.forEach(el => this._renderer.removeElement(el));
  }

  /**
   * グリッド表示の切り替え
   * @param {boolean} show - 表示する場合はtrue
   */
  toggleGrid(show) {
    this._renderer.toggleGrid(show);
    this._render();
  }

  /**
   * アクションボタン（確定/キャンセル）を作成
   * @private
   */
  _createActionButtons() {
      this._actionButtonsContainer.innerHTML = '';
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

      if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3; // 穴もポリゴンと同じ3点
          if (points.length >= minPoints) {
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
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const points = this._editingViewModel.getAddingPoints();

      if (mode === 'add' && tool) {
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3;
          if (points.length >= minPoints) {
              this._showPropertyInputDialog(); // 地物追加のプロパティ入力へ
          } else {
              alert(`${tool === 'point' ? '点' : tool === 'line' ? '線' : '面'}を作成するには、頂点が足りません。`);
          }
      } else if (mode === 'edit' && tool === 'add-hole') {
           if (points.length >= 3) {
               this._editingViewModel.confirmAddHole(); // 穴追加を確定
           } else {
               alert('穴を作成するには、少なくとも3つの頂点が必要です。');
           }
      }
  }

  /**
   * キャンセルボタンクリックのハンドラ
   * @private
   */
  _handleCancelClick() {
      // EditingViewModel の状態をクリアするメソッドを呼び出す
      this._editingViewModel._clearAddingState();

      // 他のキャンセル処理（例：プロパティダイアログを閉じる）
      const existingDialog = this._mapElement.querySelector('.property-input-dialog');
      if (existingDialog) existingDialog.remove();

      // ツールをデフォルトに戻すなど
      if (this._editingViewModel.getTool() === 'add-hole') {
          this._editingViewModel.setTool('select');
      }
  }

  /**
   * プロパティ入力ダイアログを表示 (地物追加用)
   * @private
   */
  _showPropertyInputDialog() {
    const existingDialog = this._mapElement.querySelector('.property-input-dialog');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('div');
    dialog.className = 'property-input-dialog';
    dialog.style.cssText = `
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        z-index: 30; background: white; padding: 20px; border: 1px solid #ccc;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1); min-width: 300px;
    `;

    const form = document.createElement('form');
    form.onsubmit = (e) => { e.preventDefault(); confirmButton.click(); };

    // 名前入力
    const nameRow = document.createElement('div'); nameRow.style.marginBottom='10px';
    const nameLabel = document.createElement('label'); nameLabel.textContent = '名前: '; nameLabel.style.display='block';
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.name = 'name'; nameInput.required = true; nameInput.style.width='100%';
    nameRow.appendChild(nameLabel); nameRow.appendChild(nameInput);
    form.appendChild(nameRow);

    // 説明入力
    const descRow = document.createElement('div'); descRow.style.marginBottom='10px';
    const descLabel = document.createElement('label'); descLabel.textContent = '説明: '; descLabel.style.display='block';
    const descInput = document.createElement('textarea'); descInput.name = 'description'; descInput.style.width='100%'; descInput.rows = 3;
    descRow.appendChild(descLabel); descRow.appendChild(descInput);
    form.appendChild(descRow);

    // カテゴリ選択
    const categoryRow = document.createElement('div'); categoryRow.style.marginBottom='10px';
    const categoryLabel = document.createElement('label'); categoryLabel.textContent = 'カテゴリ: '; categoryLabel.style.display='block';
    const categorySelect = document.createElement('select'); categorySelect.name = 'category'; categorySelect.style.width='100%';
    const currentTool = this._editingViewModel.getTool();
    let categories = [];
    if(currentTool === 'point') categories = this._getCategoriesForFeatureType('point');
    else if(currentTool === 'line') categories = this._getCategoriesForFeatureType('line');
    else if(currentTool === 'polygon') categories = this._getCategoriesForFeatureType('polygon');
    else categories = this._getCategoriesForFeatureType('unknown'); // デフォルト

    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id; option.textContent = cat.name;
        categorySelect.appendChild(option);
    });
    categoryRow.appendChild(categoryLabel); categoryRow.appendChild(categorySelect);
    form.appendChild(categoryRow);

    // ボタン
    const buttonRow = document.createElement('div'); buttonRow.style.textAlign = 'right'; buttonRow.style.marginTop='15px';
    const confirmButton = document.createElement('button'); confirmButton.type = 'button'; confirmButton.textContent = '確定';
    const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.textContent = 'キャンセル';
    cancelButton.dataset.action = 'cancel';
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
            category: categorySelect.value || 'default'
        };
        const currentLayerId = this._viewModel.getWorld()?.layers[0]?.id || 'layer-base'; // 仮
        this._confirmAddFeatureWithProperties(properties, currentLayerId);
        dialog.remove();
    };
    cancelButton.onclick = () => {
        dialog.remove();
        this._handleCancelClick(); // 追加状態をキャンセル
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
        const correctTimePoint = this._viewModel.getCurrentTime();
        const domainProperty = new Property(
            correctTimePoint,
            properties.name,
            properties.description,
            { category: properties.category },
            null, null
        );
        await this._editingViewModel.confirmAddFeature([domainProperty], layerId);
        console.log('地物の追加が確定しました。');
    } catch (error) {
        console.error('地物の追加確定に失敗:', error);
        alert(`エラー: ${error.message}`);
    }
  }

  /**
   * （仮）カテゴリ取得関数
   * @private
   */
  _getCategoriesForFeatureType(featureType) {
      const baseCategories = [{ id: 'default', name: 'デフォルト' }];
      switch (featureType) {
          case 'point': return [...baseCategories, { id: 'city', name: '都市' }, { id: 'town', name: '町村' }, { id: 'battle', name: '戦闘' }, { id: 'ruin', name: '遺跡' }];
          case 'line': return [...baseCategories, { id: 'road', name: '道路' }, { id: 'railway', name: '鉄道' }, { id: 'river', name: '河川' }, { id: 'trade_route', name: '交易路' }, { id: 'border', name: '国境' }];
          case 'polygon': return [...baseCategories, { id: 'kingdom', name: '王国' }, { id: 'empire', name: '帝国' }, { id: 'province', name: '地方' }, { id: 'ocean', name: '海洋' }, { id: 'lake', name: '湖沼' }];
          default: return baseCategories;
      }
  }

}
