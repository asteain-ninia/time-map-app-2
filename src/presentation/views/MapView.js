// src/presentation/views/MapView.js
import { Property } from '../../domain/value-objects/Property.js'; // Propertyクラスをインポート
import { Point as DomainPoint } from '../../domain/entities/Point.js'; // ドメインエンティティをインポート
import { Line as DomainLine } from '../../domain/entities/Line.js'; // ドメインエンティティをインポート
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js'; // ドメインエンティティをインポート
import { Vertex } from '../../domain/entities/Vertex.js'; // Vertex をインポート

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
    this._dragStartScreenPosition = { x: 0, y: 0 }; // ドラッグ開始時のスクリーン座標
    this._lastMousePosition = { x: 0, y: 0 }; // ページ座標

    // クリック許容範囲（ワールド座標での距離の二乗）
    this._clickToleranceSq = 0; // _initialize で設定
    this._clickTolerancePixels = 3; // ピクセル単位での許容範囲

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
      case 'selectedFeature': // ViewModel側の修正により、地物選択/頂点選択の両方で通知される可能性あり
      case 'selectedVertices': // 同上
      case 'highlightedFeature': // 新しい通知タイプ
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
         if (this._editingViewModel.getDraggingVerticesInfo().size > 0) {
             this._editingViewModel._resetDraggingState();
         }
        break;
      case 'addingPoints':
      case 'targetPolygon': // ターゲット変更時も再描画
      case 'addingSubMode': // サブモード変更時も再描画
      case 'targetSubPolygonIndex': // 穴追加対象インデックス変更時も再描画
      case 'temporaryElements': // 汎用一時要素の変更
      case 'draggingVertices': // ドラッグ中の頂点変更
        this._render();
        break;
       case 'history':
         this._render();
         break;
      case 'addingState': // 関連状態一括変更
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
    const draggingVerticesInfo = this._editingViewModel.getDraggingVerticesInfo(); // 複数形に変更

    // --- 実際の描画 ---
    // 1. 通常の地物を描画 (Rendererに任せる)
    this._renderer.render(world, viewport, currentTime);

    // --- オーバーレイ要素の描画 ---
    // 2. 選択ハイライト
    this._clearSelectionHighlights();
    this._renderSelection(); // 修正: 選択状態の描画

    // 3. 地物追加/穴/飛び地追加プレビュー
    this._renderAddingFeature();

    // 4. ドラッグ中のプレビュー (Rendererを使う)
    this._clearDragPreviews();
    if (draggingVerticesInfo.size > 0) { // Mapのsizeで判定
        this._renderDragPreview(draggingVerticesInfo, world, viewport);
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
    const selectedFeatureId = this._viewModel.getSelectedFeatureId();
    const selectedVertexIds = this._viewModel.getSelectedVertexIds();
    const highlightedFeatureId = this._viewModel.getHighlightedFeatureId(); // 暗黙ハイライト用

    const viewport = this._viewportManager.getViewport();
    const world = this._viewModel.getWorld();
    const currentTime = this._viewModel.getCurrentTime(); // 現在時刻も考慮
    if (!world) return;

    const draggingVerticesInfo = this._editingViewModel.getDraggingVerticesInfo(); // 複数形

    // 座標取得ヘルパー（ドラッグ中も考慮）
    const getVertexPos = (vertexId) => {
        const dragInfo = draggingVerticesInfo.get(vertexId);
        if (dragInfo) {
            return dragInfo.currentPosition;
        }
        const v = world.vertices.find(wv => wv.id === vertexId);
        return v ? { x: v.x, y: v.y } : null;
    };

    // 描画ヘルパー
    const drawHighlightLine = (vertices, style) => {
        if (vertices && vertices.length >= 2) {
            const elem = this._renderer.drawLine(vertices, style, viewport);
            if (elem) this._selectionElements.push(elem);
        }
    };
    const drawHighlightClosedLine = (vertices, style) => {
        if (vertices && vertices.length >= 3) {
             drawHighlightLine([...vertices, vertices[0]], style);
        }
    };


    // --- 主選択された地物のハイライト ---
    if (selectedFeatureId) {
        const feature = this._viewModel.getFeatures().find(f => f.id === selectedFeatureId);
        if (feature && feature.existsAt(currentTime)) {
            const style = { stroke: '#00ffff', strokeWidth: 4, fill: 'none', strokeDasharray: '4,4' };
            let vertices = [];
            if (feature.vertexIds) {
                vertices = feature.vertexIds.map(id => getVertexPos(id)).filter(Boolean);
            }

            if (feature instanceof DomainPoint && vertices.length === 1) {
                const elem = this._renderer.drawPoint(vertices[0].x, vertices[0].y, {
                     radius: 8, stroke: '#00ffff', strokeWidth: 2, fill: 'none', 'stroke-dasharray': '2,2'
                }, viewport);
                 if (elem) this._selectionElements.push(elem);
            } else if (feature instanceof DomainLine) {
                drawHighlightLine(vertices, style);
            } else if (feature instanceof DomainPolygon) {
                // 本土の外周
                drawHighlightClosedLine(vertices, style);
                // 飛び地の外周
                if (feature.isMultiPolygon && feature.subPolygons) {
                    feature.subPolygons.forEach(sub => {
                        const subVertices = sub.vertexIds?.map(id => getVertexPos(id)).filter(Boolean);
                        drawHighlightClosedLine(subVertices, style);
                        // 飛び地の穴もハイライト
                        if (sub.holesVertexIds) {
                            sub.holesVertexIds.forEach(holeIds => {
                                const holeVertices = holeIds.map(id => getVertexPos(id)).filter(Boolean);
                                drawHighlightClosedLine(holeVertices, style);
                            });
                        }
                    });
                }
                // 本土の穴
                if (feature.holesVertexIds) {
                    feature.holesVertexIds.forEach(holeIds => {
                        const holeVertices = holeIds.map(id => getVertexPos(id)).filter(Boolean);
                        drawHighlightClosedLine(holeVertices, style);
                    });
                }
            }
        }
    }

    // --- 暗黙的にハイライトされた地物 ---
    if (highlightedFeatureId && highlightedFeatureId !== selectedFeatureId) { // 主選択と重複しない
        const feature = this._viewModel.getFeatures().find(f => f.id === highlightedFeatureId);
        if (feature && feature.existsAt(currentTime)) {
            const style = { stroke: '#0088aa', strokeWidth: 2, fill: 'none', strokeDasharray: '2,2' };
            let vertices = [];
            if (feature.vertexIds) {
                vertices = feature.vertexIds.map(id => getVertexPos(id)).filter(Boolean);
            }

            if (feature instanceof DomainLine) {
                drawHighlightLine(vertices, style);
            } else if (feature instanceof DomainPolygon) {
                 // 本土の外周
                 drawHighlightClosedLine(vertices, style);
                 // 飛び地の外周
                 if (feature.isMultiPolygon && feature.subPolygons) {
                    feature.subPolygons.forEach(sub => {
                        const subVertices = sub.vertexIds?.map(id => getVertexPos(id)).filter(Boolean);
                        drawHighlightClosedLine(subVertices, style);
                        // 飛び地の穴もハイライト
                        if (sub.holesVertexIds) {
                            sub.holesVertexIds.forEach(holeIds => {
                                const holeVertices = holeIds.map(id => getVertexPos(id)).filter(Boolean);
                                drawHighlightClosedLine(holeVertices, style);
                            });
                        }
                    });
                 }
                 // 本土の穴
                 if (feature.holesVertexIds) {
                    feature.holesVertexIds.forEach(holeIds => {
                        const holeVertices = holeIds.map(id => getVertexPos(id)).filter(Boolean);
                        drawHighlightClosedLine(holeVertices, style);
                    });
                 }
            }
        }
    }

    // --- 主選択された頂点のハイライト ---
    selectedVertexIds.forEach(vertexId => {
        if (draggingVerticesInfo.has(vertexId)) return; // ドラッグ中は別で描画

        const vertexPos = getVertexPos(vertexId);
        if (vertexPos) {
            const elem = this._renderer.drawPoint(vertexPos.x, vertexPos.y, {
                radius: 6, fill: '#00ffff', stroke: '#0000ff', strokeWidth: 2, // 太めの枠
            }, viewport);
            if (elem) this._selectionElements.push(elem);
        }
    });

    this._selectionElements.forEach(el => el.classList.add('temp-drawing', 'selection-highlight'));
  }


  /**
   * ドラッグ中のプレビューを描画
   * @param {Map<string, { originalPosition: {x, y}, currentPosition: {x, y} }>} draggingVerticesInfo - ドラッグ中の頂点情報Map
   * @param {Object} world - ワールドデータ
   * @param {Object} viewport - ビューポート情報
   * @private
   */
  _renderDragPreview(draggingVerticesInfo, world, viewport) {
      // ドラッグ中の頂点マーカー
      for (const [vertexId, info] of draggingVerticesInfo.entries()) {
          const marker = this._renderer.drawPoint(
              info.currentPosition.x,
              info.currentPosition.y,
              { fill: '#ff00ff', radius: 7, stroke: '#ffffff', strokeWidth: 2 },
              viewport
          );
          if (marker) this._dragPreviewElements.push(marker);
      }

      // 影響を受ける地物を探し、仮の形状を描画
      const draggedVertexIds = new Set(draggingVerticesInfo.keys());
      const affectedFeatures = world.features.filter(f => {
          // ドメインクラスのインスタンスかチェック
          const isPolygon = f instanceof DomainPolygon || f.constructor?.name === 'Polygon';
          // 地物がドラッグ中の頂点のいずれかを使用しているかチェック
          return Array.from(draggedVertexIds).some(draggedId =>
              (f.vertexIds && f.vertexIds.includes(draggedId)) ||
              (isPolygon && (f.holesVertexIds || []).some(hole => hole.includes(draggedId))) ||
              (isPolygon && f.isMultiPolygon && (f.subPolygons || []).some(sub =>
                  (sub.vertexIds && sub.vertexIds.includes(draggedId)) ||
                  (sub.holesVertexIds?.some(hole => hole.includes(draggedId))) // 飛び地の穴も考慮
               ))
          );
      });


      const getVertexPos = (vertexId) => {
          const dragInfo = draggingVerticesInfo.get(vertexId);
          if (dragInfo) return dragInfo.currentPosition;
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
                  // 飛び地の外周
                  const subVertices = sub.vertexIds?.map(id => getVertexPos(id)).filter(Boolean);
                  if (subVertices && subVertices.length >= 3) {
                      const elem = this._renderer.drawLine([...subVertices, subVertices[0]], style, viewport);
                      if (elem) this._dragPreviewElements.push(elem);
                  }
                  // 飛び地の穴も描画
                  sub.holesVertexIds?.forEach(holeIds => {
                      const holeVertices = holeIds.map(id => getVertexPos(id)).filter(Boolean);
                      if (holeVertices.length >= 3) {
                          const holeElem = this._renderer.drawLine([...holeVertices, holeVertices[0]], style, viewport);
                          if (holeElem) this._dragPreviewElements.push(holeElem);
                      }
                  });
              });
          }
          // Point は頂点マーカーのみでOK
      });

      this._dragPreviewElements.forEach(el => el.classList.add('temp-drawing', 'drag-preview'));
  }


  /**
   * 追加中の地物または穴/飛び地の描画
   * @private
   */
  _renderAddingFeature() {
     // 既存の一時要素を削除 (プレフィックスで識別)
     this._clearTemporaryDrawings('adding-');

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const subMode = this._editingViewModel.getAddingSubMode(); // サブモード取得

    // 'add' モードまたは 'edit' モードの 'add-hole' ツールの場合のみ描画
    if (!((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && this._editingViewModel.getTargetPolygon()))) {
        return;
    }

    const addingPoints = this._editingViewModel.getAddingPoints();
    if (addingPoints.length === 0) return;

    const viewport = this._viewportManager.getViewport();
    let tempElements = []; // この描画で作成した一時要素

    // スタイル設定
    const pointStyle = { fill: '#ffffff', radius: 4, stroke: '#000000', strokeWidth: 1 };
    let lineStyle = {};
    if (mode === 'add') {
        lineStyle = tool === 'line'
            ? { stroke: '#0000ff', strokeWidth: 3, strokeDasharray: '5,5' } // 線追加時
            : tool === 'polygon'
                ? { stroke: '#00ff00', strokeWidth: 3, strokeDasharray: '5,5' } // 面追加時
                : {}; // 点追加時は線なし
    } else if (mode === 'edit' && tool === 'add-hole') {
        lineStyle = subMode === 'hole'
            ? { stroke: '#ff00ff', strokeWidth: 3, strokeDasharray: '5,5' } // 穴追加時 (紫)
            : subMode === 'enclave'
                ? { stroke: '#ff8800', strokeWidth: 3, strokeDasharray: '5,5' } // 飛び地追加時 (オレンジ)
                : { stroke: '#aaaaaa', strokeWidth: 3, strokeDasharray: '5,5' }; // サブモード未定時 (グレー)
    }


    // ツールタイプに応じた描画
    if (tool === 'point') {
        if (addingPoints.length === 1) {
            const elem = this._renderer.drawPoint(addingPoints[0].x, addingPoints[0].y,
                { fill: '#ff0000', radius: 6, stroke: '#ffffff', strokeWidth: 2 }, viewport);
            if (elem) tempElements.push(elem);
        }
    } else if (tool === 'line' || tool === 'polygon' || tool === 'add-hole') {
        // 線またはポリゴン（穴/飛び地）のプレビュー線を描画
        if (addingPoints.length >= 2) {
            // ポリゴンまたは穴/飛び地の場合は閉じる線も描画 (3点以上の場合)
            const isClosedShape = tool === 'polygon' || tool === 'add-hole';
            const pointsToDraw = isClosedShape && addingPoints.length >= 3
                ? [...addingPoints, addingPoints[0]]
                : addingPoints;
            if (Object.keys(lineStyle).length > 0) { // スタイルが定義されていれば描画
                 const elem = this._renderer.drawLine(pointsToDraw, lineStyle, viewport);
                 if (elem) tempElements.push(elem);
            }
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

    if (event.button === 2) return; // 右クリックは無視

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
  this._dragStartScreenPosition = { x: pageX, y: pageY }; // スクリーン座標を保存

  const mode = this._editingViewModel.getMode();
  const tool = this._editingViewModel.getTool();
  const addToSelection = event.shiftKey;

  switch (mode) {
    case 'view':
      this._viewportManager.startDrag(pageX, pageY);
      break;

    case 'add':
      this._handleAddPoint(worldPoint);
      break;

    case 'edit':
      if (tool === 'add-hole') {
        // 穴/飛び地追加モードの処理
        const targetPolygon = this._editingViewModel.getTargetPolygon(); // 対象ポリゴンインスタンスを取得
        const currentSubMode = this._editingViewModel.getAddingSubMode();

        if (!targetPolygon) { // 1. 対象ポリゴン選択フェーズ
          const clickedFeature = this._findClosestFeature(worldPoint);
          if (clickedFeature instanceof DomainPolygon) {
            this._editingViewModel.startAddingHoleOrEnclave(clickedFeature); // インスタンスを渡す
            this._viewModel.selectFeature(clickedFeature.id); // 対象をハイライト
            console.log(`Hole/Enclave adding started for polygon: ${clickedFeature.id}. Click inside or outside.`);
          } else {
            alert("穴または飛び地を追加するポリゴンを選択してください。");
          }
        } else if (currentSubMode === null) { // 2. サブモード決定フェーズ (最初の頂点クリック)
            const world = this._viewModel.getWorld();
            if (!world || !world.vertices) return;
            const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}])); // プレーンオブジェクト

            // 他ポリゴン情報取得
            const otherPolygonsInLayer = world.features.filter(f =>
                f.id !== targetPolygon.id &&
                f.layerId === targetPolygon.layerId &&
                f instanceof DomainPolygon
            );

            const locationInfo = this._getPointLocationInPolygon(worldPoint, targetPolygon, verticesMap);
            const isOnBoundary = this._isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
            const isInOtherPolygon = otherPolygonsInLayer.some(otherPoly => this._isPointInsidePolygon(worldPoint, otherPoly, verticesMap));
            const isOnOtherBoundary = otherPolygonsInLayer.some(otherPoly => this._isPointNearPolygonBoundary(worldPoint, otherPoly, verticesMap));

            if (isOnBoundary || isOnOtherBoundary) {
                 console.warn("Cannot start on boundary.");
                 // クリック無効
            } else if (locationInfo.type === 'main' || locationInfo.type === 'enclave') { // 本土または飛び地内部
                if (isInOtherPolygon) { // 他のポリゴンの中はNG
                    console.warn("Cannot start hole inside another polygon.");
                } else {
                    this._editingViewModel.setAddingSubMode('hole'); // 穴モード
                    this._editingViewModel.setTargetSubPolygonIndex(locationInfo.index);
                    this._handleAddPoint(worldPoint); // 最初の点を追加
                }
            } else { // 外部 or 穴の内部
                 if (isInOtherPolygon) { // 他のポリゴンの中はNG
                     console.warn("Cannot start enclave inside another polygon.");
                 } else {
                     this._editingViewModel.setAddingSubMode('enclave'); // 飛び地追加モード
                     this._editingViewModel.setTargetSubPolygonIndex(null); // 飛び地追加時はnull
                     this._handleAddPoint(worldPoint); // 最初の点を追加
                 }
            }
        } else { // 3. 頂点追加フェーズ (2点目以降)
            const world = this._viewModel.getWorld();
            if (!world || !world.vertices) return;
            const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}])); // プレーンオブジェクト
            const otherPolygonsInLayer = world.features.filter(f =>
                f.id !== targetPolygon.id &&
                f.layerId === targetPolygon.layerId &&
                f instanceof DomainPolygon
            );

            const locationInfo = this._getPointLocationInPolygon(worldPoint, targetPolygon, verticesMap);
            const isOnBoundary = this._isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
            const isInOtherPolygon = otherPolygonsInLayer.some(otherPoly => this._isPointInsidePolygon(worldPoint, otherPoly, verticesMap));
            const isOnOtherBoundary = otherPolygonsInLayer.some(otherPoly => this._isPointNearPolygonBoundary(worldPoint, otherPoly, verticesMap));
            const targetSubIndex = this._editingViewModel.getTargetSubPolygonIndex();

            let isValidClick = false;
            if (currentSubMode === 'hole') {
                // 穴モード: 対象領域(本土or飛び地)の内部、かつ境界や他のポリゴン上でない
                const isInsideTargetArea = (targetSubIndex === null && locationInfo.type === 'main') ||
                                           (targetSubIndex !== null && locationInfo.type === 'enclave' && locationInfo.index === targetSubIndex);
                isValidClick = isInsideTargetArea && !isOnBoundary && !isInOtherPolygon && !isOnOtherBoundary;
            } else if (currentSubMode === 'enclave') {
                // 飛び地追加モード: 対象ポリゴン(本土or飛び地)の外部「または穴の内部」
                // かつ他のポリゴン外部、かつ境界上でない
                // 穴内部 (main_hole, enclave_hole) も許容
                const isOutsideOrInHole = locationInfo.type === 'outside' || locationInfo.type === 'main_hole' || locationInfo.type === 'enclave_hole';
                isValidClick = isOutsideOrInHole && !isInOtherPolygon && !isOnBoundary && !isOnOtherBoundary;
            }

            if (isValidClick) {
                this._handleAddPoint(worldPoint); // 有効な場合のみ点を追加
            } else {
                 console.warn("Invalid click location for current subMode:", currentSubMode, locationInfo);
                 // クリック無効
            }
        }
      } else { // 通常の編集モード (選択/移動など)
        const clickedVertex = this._findClosestVertex(worldPoint);
        const currentlySelectedVertexIds = this._viewModel.getSelectedVertexIds();

        if (clickedVertex) {
          // 頂点が見つかった場合
          if (addToSelection) {
            // Shiftキーあり: 既存の選択に追加/削除
            this._viewModel.selectVertex(clickedVertex.id, true);
          } else if (!currentlySelectedVertexIds.has(clickedVertex.id)) {
            // Shiftキーなし & 未選択の頂点: 新規単一選択
            this._viewModel.selectVertex(clickedVertex.id, false);
          }
          // else (Shiftキーなし & 既に選択中の頂点): 何もしない（ドラッグ開始のため選択維持）

          // ドラッグ開始処理 (複数選択対応)
          const verticesToDrag = new Map();
          if (this._viewModel.getSelectedVertexIds().has(clickedVertex.id)) {
              // クリックされた頂点が（現在の）選択セットに含まれていれば、選択セット全体をドラッグ対象とする
              this._viewModel.getSelectedVertices().forEach(v => {
                  verticesToDrag.set(v.id, { x: v.x, y: v.y });
              });
          } else {
              // 含まれていない場合（新規単一選択など）は、クリックされた頂点のみドラッグ対象
              verticesToDrag.set(clickedVertex.id, { x: clickedVertex.x, y: clickedVertex.y });
          }
          if (verticesToDrag.size > 0) {
              this._editingViewModel.startVerticesDrag(verticesToDrag);
          }

        } else {
          // 頂点が見つからない場合、地物を探して選択
          this._selectObjectAt(worldPoint, addToSelection); // 地物または選択解除
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
      const dxScreen = pageX - this._dragStartScreenPosition.x; // スクリーン座標で比較
      const dyScreen = pageY - this._dragStartScreenPosition.y;
      if (Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen) > this._clickTolerancePixels) {
        this._isDragging = true;
      }
    }

    if (this._isDragging) {
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0; // 複数形

      if (mode === 'view') {
        this._viewportManager.drag(pageX, pageY);
      } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) { // 頂点ドラッグ中
        // マウス移動差分をワールド座標で計算
        const dxScreen = pageX - this._dragStartScreenPosition.x;
        const dyScreen = pageY - this._dragStartScreenPosition.y;
        const viewport = this._viewportManager.getViewport();
        const deltaXWorld = dxScreen / viewport.zoom;
        const deltaYWorld = dyScreen / viewport.zoom; // スクリーンY下向き -> ワールドY上向き

        this._editingViewModel.updateVerticesDrag(deltaXWorld, -deltaYWorld); // Y座標の符号反転
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
  const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0; // ドラッグ状態を取得

  const pageX = event.clientX;
  const pageY = event.clientY;
  const svgPointRaw = this._getSVGPoint(pageX, pageY);
  const worldPoint = this._svgToWorld(svgPointRaw);

  // ドラッグ終了処理
  if (this._isMouseDown && this._isDragging) {
    if (mode === 'view') {
      this._viewportManager.endDrag();
    } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
        // ドラッグ終了をViewModelに通知して確定処理を依頼
        this._editingViewModel.endVerticesDrag(); // 複数形
    }
  }
  // クリック（ドラッグなし）処理
  else if (this._isMouseDown && !this._isDragging) {
    // ドラッグが発生しなかった場合でも、もし頂点ドラッグが開始されていたら終了処理を呼ぶ
    if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
        this._editingViewModel.endVerticesDrag(); // 複数形
    }
    // 元々のクリック処理（ビューモードのみ）
    else if (mode === 'view' && worldPoint) {
      this._handleClick(worldPoint);
    }
    // 'add' と 'edit' モードのクリックは onMouseDown で処理済み
  }

  // 状態リセット
  this._isMouseDown = false;
  this._isDragging = false;
  // ドラッグ状態は ViewModel の endVerticesDrag 内でリセットされる
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
      const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0; // 複数形

      if (mode === 'view' && this._isDragging) {
        this._viewportManager.endDrag();
      } else if (mode === 'edit' && tool !== 'add-hole' && this._isDragging && isDraggingVertices) {
          // ドラッグ終了をViewModelに通知
          this._editingViewModel.endVerticesDrag(); // 複数形
      }

      this._isMouseDown = false;
      this._isDragging = false;
      // ドラッグ状態は ViewModel の endVerticesDrag 内でリセットされる
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
    const subMode = this._editingViewModel.getAddingSubMode();

    // 地物追加中または穴/飛び地追加中のダブルクリックは確定扱い
    if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && subMode)) {
       this._handleAddPoint(worldPoint); // 最後の点を追加
       this._handleConfirmClick(); // 確定処理
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

    if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
        // 地物追加中または穴/飛び地追加中の右クリックはキャンセル扱い
        this._handleCancelClick();
        console.log("Add/Hole/Enclave operation cancelled by right-click.");
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
      this._dragStartScreenPosition = { x: pageX, y: pageY }; // スクリーン座標を保存

      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      // Note: タッチ操作での複数選択(addToSelection=true)は考慮しない簡易実装

      if (mode === 'view') {
        this._viewportManager.startDrag(pageX, pageY);
      } else if (mode === 'add' && tool) {
          this._handleAddPoint(worldPoint);
      } else if (mode === 'edit') {
           if (tool === 'add-hole') {
                // onMouseDown と同様のロジック
               const targetPolygon = this._editingViewModel.getTargetPolygon();
               const currentSubMode = this._editingViewModel.getAddingSubMode();

               if (!targetPolygon) {
                   const clickedFeature = this._findClosestFeature(worldPoint);
                   if (clickedFeature instanceof DomainPolygon) {
                       this._editingViewModel.startAddingHoleOrEnclave(clickedFeature);
                       this._viewModel.selectFeature(clickedFeature.id);
                   } else { /* alertなど */ }
               } else if (currentSubMode === null) {
                     const world = this._viewModel.getWorld();
                     if (!world || !world.vertices) return;
                     const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
                     const locationInfo = this._getPointLocationInPolygon(worldPoint, targetPolygon, verticesMap);
                     const isOnBoundary = this._isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
                     // 他ポリゴンチェックも必要
                     if (!isOnBoundary /* && !isInOtherPolygon && !isOnOtherBoundary */) {
                        if (locationInfo.type === 'main' || locationInfo.type === 'enclave') {
                             this._editingViewModel.setAddingSubMode('hole');
                             this._editingViewModel.setTargetSubPolygonIndex(locationInfo.index);
                             this._handleAddPoint(worldPoint);
                        } else {
                             this._editingViewModel.setAddingSubMode('enclave');
                             this._editingViewModel.setTargetSubPolygonIndex(null);
                             this._handleAddPoint(worldPoint);
                        }
                     }
               } else {
                   // 2点目以降の追加
                    // 修正: onMouseDown と同様の検証ロジック
                     const world = this._viewModel.getWorld();
                     if (!world || !world.vertices) return;
                     const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
                     const locationInfo = this._getPointLocationInPolygon(worldPoint, targetPolygon, verticesMap);
                     const isOnBoundary = this._isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
                     // ... 他ポリゴンチェック ...
                     const targetSubIndex = this._editingViewModel.getTargetSubPolygonIndex();
                     let isValidClick = false;
                     if (currentSubMode === 'hole') {
                        const isInsideTargetArea = (targetSubIndex === null && locationInfo.type === 'main') ||
                                                (targetSubIndex !== null && locationInfo.type === 'enclave' && locationInfo.index === targetSubIndex);
                        isValidClick = isInsideTargetArea && !isOnBoundary /* && !isInOther && !isOnOtherBoundary */;
                     } else if (currentSubMode === 'enclave') {
                        // ★ 修正: 穴内部も許容
                        const isOutsideOrInHole = locationInfo.type === 'outside' || locationInfo.type === 'main_hole' || locationInfo.type === 'enclave_hole';
                        isValidClick = isOutsideOrInHole && !isOnBoundary /* && !isInOther && !isOnOtherBoundary */;
                     }
                     if (isValidClick) this._handleAddPoint(worldPoint);
               }
           } else { // 通常の編集モード
               const clickedVertex = this._findClosestVertex(worldPoint);
               if (clickedVertex) {
                   // タッチでは常に単一選択 -> ドラッグ開始
                   this._viewModel.selectVertex(clickedVertex.id, false);
                   const verticesToDrag = new Map();
                   verticesToDrag.set(clickedVertex.id, { x: clickedVertex.x, y: clickedVertex.y });
                   this._editingViewModel.startVerticesDrag(verticesToDrag); // 複数形メソッドを呼ぶ
               } else {
                   this._selectObjectAt(worldPoint); // 頂点以外を選択 (単一選択)
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
          const dxScreen = pageX - this._dragStartScreenPosition.x;
          const dyScreen = pageY - this._dragStartScreenPosition.y;
          const dragThreshold = 10; // タッチは閾値を少し大きく
          if (Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen) > dragThreshold) {
            this._isDragging = true;
          }
        }

        if (this._isDragging) {
          const mode = this._editingViewModel.getMode();
          const tool = this._editingViewModel.getTool();
          const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0; // 複数形

          if (mode === 'view') {
            this._viewportManager.drag(pageX, pageY);
          } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
            // マウス移動差分をワールド座標で計算
            const dxScreen = pageX - this._dragStartScreenPosition.x;
            const dyScreen = pageY - this._dragStartScreenPosition.y;
            const viewport = this._viewportManager.getViewport();
            const deltaXWorld = dxScreen / viewport.zoom;
            const deltaYWorld = dyScreen / viewport.zoom;

            this._editingViewModel.updateVerticesDrag(deltaXWorld, -deltaYWorld); // 複数形
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
        const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0; // 複数形

        if (mode === 'view' && this._isDragging) {
            this._viewportManager.endDrag();
        } else if (mode === 'edit' && tool !== 'add-hole' && this._isDragging && isDraggingVertices) {
            this._editingViewModel.endVerticesDrag(); // 複数形
        } else if (!this._isDragging) { // タップ（クリック相当）
             // タップ時の選択処理は onTouchStart で既に行われている場合が多い
             // ダブルタップ検出は別途必要
        }
    }
    this._isMouseDown = false;
    this._isDragging = false;
    // ドラッグ状態は ViewModel の endVerticesDrag 内でリセットされる
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
    const subMode = this._editingViewModel.getAddingSubMode();

    if (event.key === 'Escape') {
       event.preventDefault();
       // ドラッグ中ならキャンセル
       if (this._editingViewModel.getDraggingVerticesInfo().size > 0) { // 複数形
           this._editingViewModel._resetDraggingState();
           console.log("Vertex drag cancelled by ESC.");
       }
       // 他のキャンセル処理
       else if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
         this._handleCancelClick(); // 追加/穴/飛び地追加キャンセル
         console.log("Add/Hole/Enclave operation cancelled by ESC.");
       } else if (mode === 'edit' && (this._viewModel.getSelectedFeatureId() || this._viewModel.getSelectedVertexIds().size > 0)) { // 修正: 選択状態のチェック
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
        // 地物追加中 または 穴/飛び地追加中のEnterキーで確定
        if (((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && subMode)) && this._editingViewModel.getAddingPoints().length > 0) {
            event.preventDefault();
            this._handleConfirmClick();
            console.log("Add/Hole/Enclave operation confirmed by Enter.");
        }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
       event.preventDefault();
      const selectedVertexIds = this._viewModel.getSelectedVertexIds(); // 修正: 頂点IDのSetを取得
      const selectedFeatureId = this._viewModel.getSelectedFeatureId(); // 修正: 地物IDを取得

      console.log(`[MapView._onKeyDown Delete] Mode: ${mode}`);
      console.log(`[MapView._onKeyDown Delete] Selected Vertex IDs (before check):`, Array.from(selectedVertexIds));
      console.log(`[MapView._onKeyDown Delete] Selected Feature ID (before check):`, selectedFeatureId);

      if (mode === 'edit') {
          if (selectedVertexIds.size > 0) { // 修正: Setのsizeで判定
              console.log(`[MapView._onKeyDown Delete] Condition TRUE: selectedVertexIds.size > 0`);
              const vertexIdsToDelete = Array.from(selectedVertexIds); // 修正: Setから配列へ
              console.log("Deleting selected vertices:", vertexIdsToDelete);
              this._editingViewModel.deleteVertices(vertexIdsToDelete);
          } else if (selectedFeatureId) { // 修正: IDで判定
              console.log(`[MapView._onKeyDown Delete] Condition FALSE: selectedVertexIds.size === 0, selectedFeatureId exists.`);
              console.log(`[MapView] No vertices selected, deleting feature: ${selectedFeatureId}`);
              // アンドゥ用に削除前の地物データを取得する必要がある
              const featureToDelete = this._viewModel.getWorld()?.features.find(f => f.id === selectedFeatureId);
              if (featureToDelete) {
                  this._editingViewModel.deleteFeature(selectedFeatureId, featureToDelete);
              } else {
                   console.error(`[MapView] Feature with ID ${selectedFeatureId} not found for deletion.`);
              }
          } else {
               console.log(`[MapView._onKeyDown Delete] Condition FALSE: selectedVertexIds.size === 0, selectedFeatureId is NULL.`);
               console.log("[MapView] Delete key pressed, but nothing selected.");
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
   * クリックされたワールド座標に最も近い**表示中の**頂点を探す
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @returns {Vertex | null} 最も近い頂点オブジェクト、またはnull
   * @private
   */
  _findClosestVertex(worldPoint) {
      const world = this._viewModel.getWorld();
      const features = this._viewModel.getFeatures(); // 表示中の地物を取得
      if (!world || !world.vertices || features.length === 0) {
          return null;
      }

      const visibleVertexIds = new Set();
      features.forEach(f => {
          // ドメインクラスのインスタンスかチェック
          const isPolygon = f instanceof DomainPolygon || f.constructor?.name === 'Polygon';
          if (f.vertexIds) f.vertexIds.forEach(id => visibleVertexIds.add(id));
          if (isPolygon) {
              (f.holesVertexIds || []).flat().forEach(id => visibleVertexIds.add(id));
              if(f.isMultiPolygon && f.subPolygons) {
                  f.subPolygons.forEach(sub => {
                      (sub.vertexIds || []).forEach(id => visibleVertexIds.add(id));
                      // 飛び地の穴の頂点も考慮
                      (sub.holesVertexIds || []).flat().forEach(id => visibleVertexIds.add(id));
                  });
              }
          }
      });

      if (visibleVertexIds.size === 0) return null;

      const verticesMap = new Map(world.vertices.map(v => [v.id, {id: v.id, x: v.x, y: v.y}])); // プレーンオブジェクトとして保持
      let closestVertex = null;
      let minDistanceSq = this._clickToleranceSq;

      for (const vertexId of visibleVertexIds) { // 表示中の頂点IDのみループ
          const vertex = verticesMap.get(vertexId);
          if (vertex && typeof vertex.x === 'number' && typeof vertex.y === 'number') {
            const distanceSq = this._viewModel._geometryService.calculateDistanceSq(
                worldPoint.x, worldPoint.y, vertex.x, vertex.y
            );
            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                closestVertex = vertex;
            }
          }
      }
      // Vertex インスタンスを返す
      return closestVertex ? new Vertex(closestVertex.id, closestVertex.x, closestVertex.y) : null;
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
      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}])); // プレーンオブジェクトとして保持

      for (const feature of features) {
           if (!feature || typeof feature !== 'object') {
               continue;
           }

          let distanceSq = Infinity;
          // 頂点データをMapから取得するヘルパー
          const getVerticesByIds = (ids) => ids?.map(id => verticesMap.get(id)).filter(v => v && typeof v.x === 'number' && typeof v.y === 'number') || [];

          const featureVertices = getVerticesByIds(feature.vertexIds);
          const isPolygon = feature instanceof DomainPolygon || feature.constructor?.name === 'Polygon';

          if (feature instanceof DomainPoint || feature.constructor?.name === 'Point') {
               if (featureVertices?.length === 1) {
                   distanceSq = this._viewModel._geometryService.calculateDistanceSq(
                       worldPoint.x, worldPoint.y, featureVertices[0].x, featureVertices[0].y
                   );
               }
          } else if (feature instanceof DomainLine || feature.constructor?.name === 'Line') {
               if (featureVertices?.length >= 2) {
                   for (let i = 0; i < featureVertices.length - 1; i++) {
                       if (featureVertices[i] && featureVertices[i+1]) {
                         const segmentDistSq = this._viewModel._geometryService.distancePointSegmentSq(
                             worldPoint, featureVertices[i], featureVertices[i + 1]
                         );
                         distanceSq = Math.min(distanceSq, segmentDistSq);
                       }
                   }
               }
          } else if (isPolygon) {
              // verticesMap を渡すように修正
              distanceSq = this._calculateDistanceToPolygon(worldPoint, feature, verticesMap);
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
            // 関連地物のハイライトはViewModelが行う
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
   * @param {number} deltaX - X方向の移動差分 (ワールド座標)
   * @param {number} deltaY - Y方向の移動差分 (ワールド座標)
   * @private
   */
  _handleDragObject(deltaX, deltaY) {
     // ViewModelに現在の位置を通知するだけで、描画は _render で ViewModel の状態を見て行う
     this._editingViewModel.updateVerticesDrag(deltaX, deltaY); // 複数形
  }

  /**
   * ドラッグ終了処理 (ViewModelへ委譲)
   * @param {object} worldPoint - 最終的なワールド座標 {x, y}
   * @private
   */
  async _handleDragEnd(worldPoint) {
    // ViewModelにドラッグ終了を通知し、確定処理を依頼
    // 実際の移動処理は ViewModel -> UseCase で行われる
    await this._editingViewModel.endVerticesDrag(); // 複数形
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
      const selector = `.temp-drawing.${classNamePrefix}element, .temp-drawing.${classNamePrefix}feature, .temp-drawing.${classNamePrefix}highlight, .temp-drawing.${classNamePrefix}preview`;
      const tempElements = this._renderer._mainGroup.querySelectorAll(selector);
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
      const subMode = this._editingViewModel.getAddingSubMode();
      let show = false;

      if (mode === 'add' && tool) {
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3;
          if (points.length >= minPoints) {
              show = true;
          }
      } else if (mode === 'edit' && tool === 'add-hole' && subMode) { // サブモード決定後
          const minPoints = 3; // 穴も飛び地も最低3点
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
      const subMode = this._editingViewModel.getAddingSubMode();

      if (mode === 'add' && tool) {
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3;
          if (points.length >= minPoints) {
              this._showPropertyInputDialog(); // 地物追加のプロパティ入力へ
          } else {
              alert(`${tool === 'point' ? '点' : tool === 'line' ? '線' : '面'}を作成するには、頂点が足りません。`);
          }
      } else if (mode === 'edit' && tool === 'add-hole') {
           if (points.length >= 3) {
               if (subMode === 'hole') {
                   this._editingViewModel.confirmAddHole(); // 穴追加を確定
               } else if (subMode === 'enclave') {
                   this._editingViewModel.confirmAddEnclave(); // 飛び地追加を確定
               }
           } else {
               alert('穴または飛び地を作成するには、少なくとも3つの頂点が必要です。');
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

    /**
     * 点がポリゴンの境界線近くにあるか判定
     * @param {object} point - ワールド座標 {x, y}
     * @param {DomainPolygon} polygon - 対象ポリゴン
     * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点IDと頂点データ(プレーン)のMap
     * @returns {boolean}
     * @private
     */
    _isPointNearPolygonBoundary(point, polygon, verticesMap) {
        const geometryService = this._viewModel._geometryService;
        const toleranceSq = this._clickToleranceSq;

        // 頂点データを取得するヘルパー
        const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

        // 外周境界チェック
        if (polygon.vertexIds && polygon.vertexIds.length >= 2) {
            const outerVertices = getVertices(polygon.vertexIds);
            if (geometryService.isPointOnPolygonBoundary(point, outerVertices, toleranceSq)) {
                return true;
            }
        }

        // 穴境界チェック
        if (polygon.holesVertexIds) {
            for (const holeIds of polygon.holesVertexIds) {
                if (holeIds.length >= 2) {
                    const holeVertices = getVertices(holeIds);
                    if (geometryService.isPointOnPolygonBoundary(point, holeVertices, toleranceSq)) {
                        return true;
                    }
                }
            }
        }

        // 飛び地境界チェック (MultiPolygonの場合)
        if (polygon.isMultiPolygon && polygon.subPolygons) {
            for (const subPoly of polygon.subPolygons) {
                 if (subPoly.vertexIds && subPoly.vertexIds.length >= 2) {
                    const subVertices = getVertices(subPoly.vertexIds);
                    if (geometryService.isPointOnPolygonBoundary(point, subVertices, toleranceSq)) {
                         return true;
                    }
                 }
                 // 飛び地の穴の境界もチェック
                 if (subPoly.holesVertexIds) {
                    for (const holeIds of subPoly.holesVertexIds) {
                        if (holeIds.length >= 2) {
                            const holeVertices = getVertices(holeIds);
                            if (geometryService.isPointOnPolygonBoundary(point, holeVertices, toleranceSq)) {
                                return true;
                            }
                        }
                    }
                 }
            }
        }

        return false;
    }

    /**
     * 点がポリゴン内部（穴を除く）にあるか判定
     * @param {object} point - ワールド座標 {x, y}
     * @param {DomainPolygon} polygon - 対象ポリゴン
     * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点IDと頂点データ(プレーン)のMap
     * @returns {boolean}
     * @private
     */
    _isPointInsidePolygon(point, polygon, verticesMap) {
        const geometryService = this._viewModel._geometryService;
        // 頂点データを取得するヘルパー
        const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

        let isInside = false;

        // 外周内部か判定
        if (polygon.vertexIds && polygon.vertexIds.length >= 3) {
             const outerVertices = getVertices(polygon.vertexIds);
             if (outerVertices.length >= 3 && geometryService.isPointInPolygon(point, outerVertices)) {
                 isInside = true;
             }
        }

        // 飛び地内部か判定 (MultiPolygonの場合)
        if (!isInside && polygon.isMultiPolygon && polygon.subPolygons) {
            for (const subPoly of polygon.subPolygons) {
                if (subPoly.vertexIds && subPoly.vertexIds.length >= 3) {
                    const subVertices = getVertices(subPoly.vertexIds);
                    if (subVertices.length >= 3 && geometryService.isPointInPolygon(point, subVertices)) {
                         isInside = true;
                         // 飛び地内部でも、その飛び地内の穴に入っていたら isInside = false にする必要がある
                         if (subPoly.holesVertexIds) {
                            for (const holeIds of subPoly.holesVertexIds) {
                                if (holeIds.length >= 3) {
                                    const holeVertices = getVertices(holeIds);
                                    if (holeVertices.length >= 3 && geometryService.isPointInPolygon(point, holeVertices)) {
                                         isInside = false; // 飛び地の穴の中なので除外
                                         break; // この飛び地のチェックは終了
                                    }
                                }
                            }
                         }
                         if (isInside) break; // 他の飛び地をチェックする必要はない
                    }
                }
            }
        }

        // 内部にいても、本土の穴の中なら対象外 (isInside が true の場合のみチェック)
        if (isInside && polygon.holesVertexIds) {
            for (const holeIds of polygon.holesVertexIds) {
                 if (holeIds.length >= 3) {
                    const holeVertices = getVertices(holeIds);
                    if (holeVertices.length >= 3 && geometryService.isPointInPolygon(point, holeVertices)) {
                         isInside = false; // 本土の穴の中なので除外
                         break;
                    }
                 }
            }
        }

        return isInside;
    }

     /**
      * 点からポリゴンまでの最短距離の二乗を計算
      * @param {object} point - ワールド座標 {x, y}
      * @param {DomainPolygon} polygon - 対象ポリゴン
      * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点IDと頂点データ(プレーン)のMap
      * @returns {number} 最短距離の二乗
      * @private
      */
     _calculateDistanceToPolygon(point, polygon, verticesMap) {
         const geometryService = this._viewModel._geometryService;
         let minDistanceSq = Infinity;
         // 頂点データを取得するヘルパー
         const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

         const calculateMinDistToRing = (vertexIds) => {
             if (!vertexIds || vertexIds.length < 2) return Infinity;
             const vertices = getVertices(vertexIds);
             if (vertices.length < 2) return Infinity;

             const closedVertices = [...vertices, vertices[0]];
             let minDistSq = Infinity;
             for (let i = 0; i < closedVertices.length - 1; i++) {
                 const a = closedVertices[i];
                 const b = closedVertices[i + 1];
                 if (a && b) {
                     minDistSq = Math.min(minDistSq, geometryService.distancePointSegmentSq(point, a, b));
                 }
             }
             return minDistSq;
         };

         // 点がポリゴン内部にある場合は距離0 (穴は考慮済み)
         if (this._isPointInsidePolygon(point, polygon, verticesMap)) {
             return 0;
         }

         // 外周までの距離
         if (polygon.vertexIds) {
             minDistanceSq = Math.min(minDistanceSq, calculateMinDistToRing(polygon.vertexIds));
         }

         // 飛び地までの距離 (MultiPolygonの場合)
         if (polygon.isMultiPolygon && polygon.subPolygons) {
             polygon.subPolygons.forEach(sub => {
                 minDistanceSq = Math.min(minDistanceSq, calculateMinDistToRing(sub.vertexIds));
             });
         }

         // 外部の点から穴までの距離は計算しない

         return minDistanceSq;
     }

     /**
      * 点がポリゴンのどの部分にあるか判定するヘルパー
      * @param {object} point - ワールド座標 {x, y}
      * @param {DomainPolygon} polygon - 対象ポリゴン
      * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点IDと頂点データ(プレーン)のMap
      * @returns {{type: 'outside' | 'main' | 'enclave' | 'main_hole' | 'enclave_hole', index: number | null}}
      *          type: outside=外部, main=本土内部, enclave=飛び地内部, main_hole=本土の穴内部, enclave_hole=飛び地の穴内部
      *          index: typeがenclaveまたはenclave_holeの場合、その飛び地のインデックス
      * @private
      */
     _getPointLocationInPolygon(point, polygon, verticesMap) {
         const geometryService = this._viewModel._geometryService;
         const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

         // 1. 本土の穴チェック
         if (polygon.holesVertexIds) {
             for (const holeIds of polygon.holesVertexIds) {
                  if (holeIds.length >= 3) {
                     const holeVertices = getVertices(holeIds);
                     if (holeVertices.length >= 3 && geometryService.isPointInPolygon(point, holeVertices)) {
                          return { type: 'main_hole', index: null };
                     }
                  }
             }
         }

         // 2. 飛び地チェック (飛び地内部か、飛び地の穴内部か)
         if (polygon.isMultiPolygon && polygon.subPolygons) {
             for (let i = 0; i < polygon.subPolygons.length; i++) {
                 const subPoly = polygon.subPolygons[i];
                 if (subPoly.vertexIds && subPoly.vertexIds.length >= 3) {
                     const subVertices = getVertices(subPoly.vertexIds);
                     if (subVertices.length >= 3 && geometryService.isPointInPolygon(point, subVertices)) {
                          // 飛び地内部。さらにその穴の中かチェック
                          if (subPoly.holesVertexIds) {
                              for (const holeIds of subPoly.holesVertexIds) {
                                  if (holeIds.length >= 3) {
                                      const holeVertices = getVertices(holeIds);
                                      if (holeVertices.length >= 3 && geometryService.isPointInPolygon(point, holeVertices)) {
                                          return { type: 'enclave_hole', index: i };
                                      }
                                  }
                              }
                          }
                          // 飛び地の穴の中ではなかった -> 飛び地内部
                          return { type: 'enclave', index: i };
                     }
                 }
             }
         }

         // 3. 本土内部チェック
         if (polygon.vertexIds && polygon.vertexIds.length >= 3) {
              const outerVertices = getVertices(polygon.vertexIds);
              if (outerVertices.length >= 3 && geometryService.isPointInPolygon(point, outerVertices)) {
                  return { type: 'main', index: null };
              }
         }

         // 4. 上記いずれでもなければ外部
         return { type: 'outside', index: null };
     }
}
