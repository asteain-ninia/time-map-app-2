// src/presentation/views/map/MapViewEventHandler.js

import { Point as DomainPoint } from '../../../domain/entities/Point.js';
import { Line as DomainLine } from '../../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../../domain/entities/Polygon.js';
import { Vertex } from '../../../domain/entities/Vertex.js'; // Vertexクラスをインポート

/**
 * MapView におけるユーザーイベントハンドリングを担当
 */
export class MapViewEventHandler {
  /**
   * @param {MapView} mapView - 親ビュー
   * @param {HTMLElement | null} mapOverlay - イベントを受け取るオーバーレイ要素 (初期はnull)
   * @param {MapViewModel} viewModel
   * @param {EditingViewModel} editingViewModel
   * @param {ViewportManager} viewportManager
   * @param {SVGRenderer} renderer
   * @param {MapViewInteractionLogic} interactionLogic
   */
  constructor(mapView, mapOverlay, viewModel, editingViewModel, viewportManager, renderer, interactionLogic) {
    this._mapView = mapView; // 親ビューのメソッド呼び出し用
    this._mapOverlay = mapOverlay; // 初期はnullの場合あり
    this._viewModel = viewModel;
    this._editingViewModel = editingViewModel;
    this._viewportManager = viewportManager;
    this._renderer = renderer;
    this._interactionLogic = interactionLogic;

    // マウス状態
    this._isMouseDown = false;
    this._isDragging = false;
    this._isMiddleButtonDragging = false; // 中ボタンドラッグの状態を追加
    this._dragStartScreenPosition = { x: 0, y: 0 }; // スクリーン座標
    this._lastScreenPosition = { x: 0, y: 0 }; // スクリーン座標
    this._svgPoint = null; // SVG座標変換用
    this._clickTolerancePixels = 3; // ピクセル単位での許容範囲
  }

  /**
   * イベントリスナーを設定
   */
  setupEventListeners() {
    // _mapOverlay が設定されてからリスナーを追加
    if (!this._mapOverlay) {
      console.error("MapViewEventHandler: mapOverlay is not set. Cannot setup event listeners.");
      return;
    }
    if (this._renderer && this._renderer._svg) {
        this._svgPoint = this._renderer._svg.createSVGPoint();
    } else {
        console.error("MapViewEventHandler: SVGRenderer or SVG element not ready for SVGPoint creation.");
        // 必要なら遅延作成のロジック
    }

    this._mapOverlay.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this._mapOverlay.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this._mapOverlay.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this._mapOverlay.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    this._mapOverlay.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
    this._mapOverlay.addEventListener('dblclick', this.handleDoubleClick.bind(this));
    this._mapOverlay.addEventListener('contextmenu', this.handleContextMenu.bind(this));
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  /**
   * スクリーン座標をSVG座標に変換
   * @param {number} pageX
   * @param {number} pageY
   * @returns {DOMPoint | null}
   */
  _getSVGPoint(pageX, pageY) {
    if (!this._renderer || !this._renderer._svg || !this._svgPoint) return null;
    this._svgPoint.x = pageX;
    this._svgPoint.y = pageY;
    try {
        const ctm = this._renderer._svg.getScreenCTM();
        if (!ctm) {
            console.error("MapViewEventHandler: Failed to get CTM from SVG.");
            return null;
        }
        return this._svgPoint.matrixTransform(ctm.inverse());
    } catch (e) {
        console.error("SVG coordinate conversion error:", e);
        return null;
    }
  }

  /**
   * SVG座標をワールド座標に変換
   * @param {DOMPoint} svgPoint
   * @returns {object | null}
   */
  _svgToWorld(svgPoint) {
    return svgPoint ? { x: svgPoint.x, y: -svgPoint.y } : null;
  }

  /** マウスダウン */
  handleMouseDown(event) {
    this._mapView.hideContextMenu();
    const targetElement = event.target;
    // ダイアログ上のイベントは無視
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form') || targetElement.closest('.conflict-resolution-dialog')) return;

    // 中ボタンクリックで視点移動を開始
    if (event.button === 1) {
        event.preventDefault();
        this._isMouseDown = true;
        this._isMiddleButtonDragging = true;
        this._mapOverlay.style.cursor = 'grabbing';
        this._viewportManager.startDrag(event.clientX, event.clientY);
        return;
    }

    // 右クリックは無視 (contextmenuで処理)
    if (event.button === 2) return;

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);
    if (!worldPoint) return;

    this._isMouseDown = true;
    // Disable text selection while dragging to prevent accidental sidebar selection
    document.body.classList.add('noselect');
    this._lastScreenPosition = { x: pageX, y: pageY };
    this._dragStartScreenPosition = { x: pageX, y: pageY };

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const addToSelection = event.shiftKey;

    switch (mode) {
      case 'view':
        this._mapOverlay.style.cursor = 'grabbing';
        this._viewportManager.startDrag(pageX, pageY);
        break;
      case 'add':
        this.handleAddPoint(worldPoint); // 点追加処理を呼び出す
        break;
      case 'edit':
        if (tool === 'add-hole') {
          // 穴/飛び地追加モードのクリック処理
          this._handleAddHoleOrEnclaveClick(worldPoint);
        } else if (tool === 'split') {
          this._handleSplitToolClick(worldPoint);
        } else if (tool === 'add-vertex-on-edge') {
          const closestEdgeInfo = this._interactionLogic.findClosestEdge(worldPoint);
          if (closestEdgeInfo) {
            this._editingViewModel.addVertexToEdge(closestEdgeInfo)
              .then(newVertex => {
                if (newVertex) {
                  const map = new Map([[newVertex.id, { x: newVertex.x, y: newVertex.y }]]);
                  this._editingViewModel.startVerticesDrag(map);
                  this._isDragging = true;
                }
              })
              .catch(error => {
                console.error("[EventHandler] Error calling addVertexToEdge:", error);
                alert(`線上への頂点追加に失敗しました: ${error.message}`);
              });
          } else {
            console.log('[EventHandler] No close edge found for add-vertex-on-edge.');
          }
        } else if (tool === 'move') {
            const clickedFeature = this._interactionLogic.findClosestFeature(worldPoint);
            if (clickedFeature) {
                this._viewModel.selectFeature(clickedFeature.id, false);
                const verticesToDrag = this._collectVerticesForFeature(clickedFeature);
                if (verticesToDrag.size > 0) {
                    this._editingViewModel.startVerticesDrag(verticesToDrag);
                    this._mapOverlay.style.cursor = 'grabbing';
                }
            } else if (!addToSelection) {
                this._viewModel.clearSelection();
            }
        } else { // 選択、頂点移動など
            const clickedVertex = this._interactionLogic.findClosestVertex(worldPoint);
            if (clickedVertex) {
                // 頂点選択処理
                if (addToSelection) {
                    this._viewModel.selectVertex(clickedVertex.id, true);
                } else if (!this._viewModel.getSelectedVertexIds().has(clickedVertex.id)) {
                    // 既存選択になく、単一選択の場合
                    this._viewModel.selectVertex(clickedVertex.id, false);
                }
                // ドラッグ開始判定 (選択状態に基づいてドラッグ対象を決定)
                const verticesToDrag = new Map();
                if (this._viewModel.getSelectedVertexIds().has(clickedVertex.id)) {
                    // 既に選択されている頂点群をドラッグ対象とする
                    this._viewModel.getSelectedVertices().forEach(v => {
                        // Vertexインスタンスから座標を取得
                        const vertexData = this._viewModel.getWorld()?.vertices.find(wv => wv.id === v.id);
                        if(vertexData) verticesToDrag.set(v.id, { x: vertexData.x, y: vertexData.y });
                    });
                } else {
                    // 新たにクリックした頂点のみドラッグ対象 (単一選択の場合)
                     const vertexData = this._viewModel.getWorld()?.vertices.find(wv => wv.id === clickedVertex.id);
                     if(vertexData) verticesToDrag.set(clickedVertex.id, { x: vertexData.x, y: vertexData.y });
                }
                if (verticesToDrag.size > 0) {
                    this._editingViewModel.startVerticesDrag(verticesToDrag);
                    this._mapOverlay.style.cursor = 'grabbing';
                }
            } else {
                // 頂点以外をクリックした場合、地物選択処理
                this._interactionLogic.selectObjectAt(worldPoint, addToSelection);
                 // 地物をクリックした場合もドラッグパンを開始できるようにする？ -> Viewモードでのみパン
            }
        }
        break;
    }
    // 距離測定モードの場合
    if (this._mapView.isMeasuringDistance()) {
      this.handleAddMeasurePoint(worldPoint);
    }
  }

  /** マウス移動 */
  handleMouseMove(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form') || targetElement.closest('.conflict-resolution-dialog')) return;

    const pageX = event.clientX;
    const pageY = event.clientY;

    // 中ボタンドラッグ中の視点移動
    if (this._isMouseDown && this._isMiddleButtonDragging) {
        this._viewportManager.drag(pageX, pageY);
        this._lastScreenPosition = { x: pageX, y: pageY };
        return;
    }

    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);

    if (this._isMouseDown) { // マウスボタンが押されている -> ドラッグ判定
      if (!this._isDragging) { // まだドラッグ状態でない場合
        const dxScreen = pageX - this._dragStartScreenPosition.x;
        const dyScreen = pageY - this._dragStartScreenPosition.y;
        // 一定距離移動したらドラッグ開始とみなす
        if (Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen) > this._clickTolerancePixels) {
          this._isDragging = true;
          if (this._editingViewModel.getMode() === 'view') {
              this._mapOverlay.style.cursor = 'grabbing';
          }
        }
      }

      if (this._isDragging) { // ドラッグ状態の場合
        const mode = this._editingViewModel.getMode();
        const tool = this._editingViewModel.getTool();
        const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

        if (mode === 'view') {
          // 表示モードならビューポートをドラッグ
          this._viewportManager.drag(pageX, pageY);
        } else if (mode === 'edit' && tool !== 'add-hole' && tool !== 'split' && isDraggingVertices) {
            // 編集モードで頂点ドラッグ中の場合
            const totalDxScreen = pageX - this._dragStartScreenPosition.x;
            const totalDyScreen = pageY - this._dragStartScreenPosition.y;
            const viewport = this._viewportManager.getViewport();
            const totalDeltaXWorld = totalDxScreen / viewport.zoom;
            const totalDeltaYWorld = totalDyScreen / viewport.zoom; // Y軸の向きに注意

            // ViewModelにワールド座標での総移動量を渡す
            const world = this._viewModel.getWorld();
            this._editingViewModel.updateVerticesDrag(totalDeltaXWorld, -totalDeltaYWorld, {
              world,
              geometryService: this._viewModel._geometryService
            });
        }
        // 他のモード・ツールでのドラッグは何もしない（追加モードなど）
      }
    } else { // マウスボタンが押されていない -> ホバー処理
       this._updateCursor(worldPoint);
    }

    this._lastScreenPosition = { x: pageX, y: pageY };
  }

  /** マウスアップ */
  handleMouseUp(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form') || targetElement.closest('.conflict-resolution-dialog')) return;

    // 中ボタンのドラッグ終了
    if (event.button === 1) {
        if (this._isMiddleButtonDragging) {
            this._viewportManager.endDrag();
            this._isMiddleButtonDragging = false;
            this._isMouseDown = false;
            // ホバー処理を再評価するためにカーソルを更新
            this._updateCursor(this._svgToWorld(this._getSVGPoint(event.clientX, event.clientY)));
        }
        return;
    }

    // 右クリックの場合は無視
    if (event.button === 2) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

    // ドラッグ終了処理
    if (this._isMouseDown && this._isDragging) {
      if (mode === 'view') {
        this._viewportManager.endDrag();
        this._mapOverlay.style.cursor = 'grab';
      } else if (mode === 'edit' && tool !== 'add-hole' && tool !== 'split' && isDraggingVertices) {
        this._editingViewModel.endVerticesDrag(this._getSharedVertexSnapOptions());
        this._updateCursor(this._svgToWorld(this._getSVGPoint(event.clientX, event.clientY)));
      }
    }
    // クリック（ドラッグなし）処理
    else if (this._isMouseDown && !this._isDragging) {
        // クリックでも頂点ドラッグ状態はリセットする必要がある
        if (mode === 'edit' && tool !== 'add-hole' && tool !== 'split' && isDraggingVertices) {
            // 移動がなくてもendVerticesDragを呼び出して状態をリセット
            this._editingViewModel.endVerticesDrag(this._getSharedVertexSnapOptions());
        } else if (mode === 'view') {
            // 表示モードでのクリック -> 地物選択
            const pageX = event.clientX;
            const pageY = event.clientY;
            const svgPointRaw = this._getSVGPoint(pageX, pageY);
            const worldPoint = this._svgToWorld(svgPointRaw);
            if (worldPoint) {
                this._interactionLogic.handleClickInViewMode(worldPoint, event.shiftKey === true);
            }
        }
        // 'add' モードのクリックは MouseDown で点追加済み
        // 'edit' + 'add-hole' モードのクリックも MouseDown で処理済み
        // 'edit' + 'add-vertex-on-edge' のクリックも MouseDown で処理済み
    }

    // 状態リセット
    this._isMouseDown = false;
    this._isDragging = false;
    // Re-enable text selection after dragging ends
    document.body.classList.remove('noselect');
  }

  /** マウス離脱 */
  handleMouseLeave(event) {
    // マウスが押されたままウィンドウ外に出た場合の処理
    if (this._isMouseDown) {
      // 中ボタンドラッグ中の場合
      if (this._isMiddleButtonDragging) {
          this._viewportManager.endDrag();
          this._isMiddleButtonDragging = false;
      }

      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

      // ドラッグ中であればドラッグを終了させる
      if (mode === 'view' && this._isDragging) {
        this._viewportManager.endDrag();
        this._mapOverlay.style.cursor = 'grab';
      } else if (mode === 'edit' && tool !== 'add-hole' && tool !== 'split' && this._isDragging && isDraggingVertices) {
        this._editingViewModel.endVerticesDrag(this._getSharedVertexSnapOptions());
      }

      // マウスダウン状態をリセット
      this._isMouseDown = false;
      this._isDragging = false;
      document.body.classList.remove('noselect');
    }
    // ホバー状態をクリア
     this._viewModel.hoverFeature(null);
     this._viewModel.hoverVertex(null);
     this._updateCursor(null);
  }

  /** ホイール */
  handleWheel(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form') || targetElement.closest('.conflict-resolution-dialog')) return;
    event.preventDefault(); // デフォルトのスクロール動作をキャンセル
    const delta = -event.deltaY; // ホイールの方向（上方向が正）
    const zoomFactor = delta > 0 ? 0.1 : -0.1; // 10%ずつズーム
    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw); // カーソル位置をワールド座標に変換
    if (!worldPoint) return;
    // カーソル位置を中心にズーム
    this._viewportManager.zoomAt(worldPoint.x, worldPoint.y, zoomFactor);
  }

  /** ダブルクリック */
  handleDoubleClick(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form') || targetElement.closest('.conflict-resolution-dialog')) return;

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);
    if (!worldPoint) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const subMode = this._editingViewModel.getAddingSubMode();

    // 地物追加中、または穴/飛び地追加中にダブルクリックで確定
    if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && subMode)) {
       // 最後の点を追加してから確定処理へ
       this.handleAddPoint(worldPoint);
       this.handleConfirmClick(); // MapViewの確定処理を呼び出す
    } else if (mode === 'edit' && tool === 'split') {
      this.handleConfirmClick();
    } else if (mode === 'view') {
      // 表示モードでのダブルクリックはビューポートリセット（または中心移動など）
      this._viewportManager.updateViewport({ x: worldPoint.x, y: worldPoint.y, zoom: 1 });
    }
  }

  /** コンテキストメニュー */
  handleContextMenu(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form') || targetElement.closest('.conflict-resolution-dialog')) return;
    event.preventDefault(); // デフォルトのコンテキストメニューを抑制
    this._mapView.hideContextMenu();

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);
    if (!worldPoint) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();

    if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole') || (mode === 'edit' && tool === 'split')) {
      this.handleCancelClick();
      return;
    }

    if (this._mapView.isMeasuringDistance()) {
      this._mapView.setMeasuringDistance(false);
      return;
    }

    this._interactionLogic.selectObjectAt(worldPoint);
    this._mapView.showContextMenu(pageX, pageY);
  }

  /** キーダウン */
  handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      return;
    }
    const targetElement = event.target;
    const conflictDialog = targetElement.closest('.conflict-resolution-dialog');
    const isInInputDialog = targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form');
    if (conflictDialog) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            const confirmButton = conflictDialog.querySelector('button[data-action="confirm"]');
            if (confirmButton) confirmButton.click();
            return;
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            const cancelButton = conflictDialog.querySelector('button[data-action="cancel"]');
            if (cancelButton) {
              cancelButton.click();
            }
            return;
        } else {
            return;
        }
    }
    // 入力ダイアログが表示されている場合のEnter/Esc処理
    if (isInInputDialog) {
        if (event.key === 'Enter') {
            event.stopPropagation(); // MapViewへのEnter伝播を防ぐ
            const dialog = targetElement.closest('.property-input-dialog, .layer-input-form');
            // ダイアログ内の確定ボタンを探してクリックイベントを発火
            const confirmButton = dialog?.querySelector('button:not([data-action="cancel"])');
            if (confirmButton) confirmButton.click();
            return; // MapView側の処理は行わない
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation(); // MapViewへのEsc伝播を防ぐ
            const dialog = targetElement.closest('.property-input-dialog, .layer-input-form');
            // ダイアログ内のキャンセルボタンを探してクリックイベントを発火
            const cancelButton = dialog?.querySelector('button[data-action="cancel"]');
            if (cancelButton) {
              cancelButton.click();
            } else if (dialog) {
              // キャンセルボタンがない場合はダイアログ自体を閉じる？
              dialog.remove();
              this.handleCancelClick(); // MapViewのキャンセル処理も呼ぶ
            }
            return; // MapView側の処理は行わない
        } else {
            return; // ダイアログ内の他のキー入力は無視
        }
    }
    // 通常のテキスト入力要素にフォーカスがある場合はキーボードショートカットを無効化
    else if (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement || targetElement instanceof HTMLSelectElement) {
        // Ctrl/Cmd+Z/Y などの一部ショートカットは許可しても良いかもしれない
        if (!((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()))) {
            return;
        }
    }

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const subMode = this._editingViewModel.getAddingSubMode();
    const selectedFeatureIds = typeof this._viewModel.getSelectedFeatureIds === 'function'
      ? this._viewModel.getSelectedFeatureIds()
      : new Set();
    const selectedVertexIdsSnapshot = this._viewModel.getSelectedVertexIds();
    const hasSelection = selectedFeatureIds.size > 0 || selectedVertexIdsSnapshot.size > 0;

    if (event.key === 'Escape') {
       event.preventDefault();
       if (this._editingViewModel.getDraggingVerticesInfo().size > 0) {
           // 頂点ドラッグ中にEsc -> ドラッグキャンセル
           this._editingViewModel._resetDraggingState(); // ViewModelにリセットを依頼
           console.log("Vertex drag cancelled by ESC.");
       } else if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole') || (mode === 'edit' && tool === 'split')) {
           // 地物/穴/飛び地/分割追加中にEsc -> キャンセル
         this.handleCancelClick(); // MapViewのキャンセル処理を呼び出す
         console.log("Add/Hole/Enclave/Split operation cancelled by ESC.");
       } else if (hasSelection) {
           // 選択状態がある場合はEscで選択解除
         this._viewModel.clearSelection();
         console.log("Selection cleared by ESC.");
       } else if (this._mapView.isMeasuringDistance()) {
           // 距離測定中にEsc -> キャンセル
           this._mapView.setMeasuringDistance(false);
           console.log("Measurement cancelled by ESC.");
       } else {
           // その他の場合にEsc -> 表示モードに戻る
         this._editingViewModel.setMode('view');
         console.log("Mode set to 'view' by ESC.");
       }
    } else if (event.key === 'Enter') {
        // 地物/穴/飛び地追加モードで点が十分にあれば確定
        if (((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && subMode) || (mode === 'edit' && tool === 'split')) && this._editingViewModel.getAddingPoints().length > 0) {
            const minPoints = (mode === 'add')
                             ? (tool === 'point' ? 1 : (tool === 'line' ? 2 : 3))
                             : (tool === 'split' ? 2 : 3); // 分割は2点、穴/飛び地は3点
            if (this._editingViewModel.getAddingPoints().length >= minPoints) {
                event.preventDefault();
                this.handleConfirmClick(); // MapViewの確定処理を呼び出す
                console.log("Add/Hole/Enclave/Split operation confirmed by Enter.");
            }
        }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
        // 編集モードで何か選択中にDelete/Backspace -> 削除
       event.preventDefault();
      const selectedVertexIds = this._viewModel.getSelectedVertexIds();
      const selectedFeatures = typeof this._viewModel.getSelectedFeatures === 'function'
        ? this._viewModel.getSelectedFeatures()
        : [];
      const contextFeature = this._viewModel.getSelectionContextFeature();
      if (mode === 'edit') {
          if (selectedVertexIds.size > 0) {
              // 頂点選択中 -> 選択頂点を削除
              const vertexIdsToDelete = Array.from(selectedVertexIds);
              this._editingViewModel.deleteVertices(vertexIdsToDelete);
          } else if (contextFeature) {
              // 地物選択中 -> 選択地物を削除
              this._editingViewModel.deleteFeature(contextFeature.id, contextFeature);
          } else if (selectedFeatures.length > 0) {
              // 複数地物が選択されている場合は全て削除
              selectedFeatures.forEach(feature => {
                  this._editingViewModel.deleteFeature(feature.id, feature);
              });
          } else { console.log("Delete key pressed, but nothing selected."); }
      }
    } else if (event.ctrlKey || event.metaKey) {
        // アンドゥ/リドゥ (Ctrl/Cmd + Z/Y/Shift+Z)
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this._editingViewModel.redo();
        else this._editingViewModel.undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this._editingViewModel.redo();
      }
    }
  }

  /** キーアップ */
  handleKeyUp(event) { /* 必要なら実装 (例: Shiftキー離した時の処理) */ }

  // --- Helper methods called by handlers ---

  /** マウスホバー処理 (リファクタリング) */
  handleMouseHover(worldPoint) {
      this._updateCursor(worldPoint);

      // ホバーハイライトの処理はカーソルとは独立して行う
      const mode = this._editingViewModel.getMode();
      if (mode === 'edit' && this._editingViewModel.getTool() !== 'add-hole') {
          const hoveredVertex = this._interactionLogic.findClosestVertex(worldPoint);
          if (hoveredVertex) {
              this._viewModel.hoverVertex(hoveredVertex.id);
              this._viewModel.hoverFeature(null);
          } else {
              const hoveredFeature = this._interactionLogic.findClosestFeature(worldPoint);
              this._viewModel.hoverFeature(hoveredFeature ? hoveredFeature.id : null);
              this._viewModel.hoverVertex(null);
          }
      } else {
          // 編集モードでない、またはadd-holeツールの場合はホバーをクリア
          this._viewModel.hoverVertex(null);
          this._viewModel.hoverFeature(null);
      }
  }

  /**
   * 現在の状態に応じたカーソル種別を決定する
   * @param {object | null} worldPoint - 現在のマウスのワールド座標
   * @returns {string} CSSのcursorプロパティ値
   * @private
   */
  _getCursorForCurrentState(worldPoint) {
      if (this._isMiddleButtonDragging || (this._isDragging && this._editingViewModel.getMode() === 'view') || (this._isDragging && this._editingViewModel.getDraggingVerticesInfo().size > 0)) {
          return 'grabbing';
      }

      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();

      if (!worldPoint) return 'default';

      switch (mode) {
          case 'view':
              return 'grab';
          case 'add':
              return 'crosshair';
          case 'edit':
              switch (tool) {
                  case 'select':
                      const hoveredVertex = this._interactionLogic.findClosestVertex(worldPoint);
                      const hoveredFeature = hoveredVertex ? null : this._interactionLogic.findClosestFeature(worldPoint);
                      return (hoveredVertex || hoveredFeature) ? 'pointer' : 'default';
                  case 'move':
                      // TODO: 移動ツール実装時に、ホバー対象がある場合のみ 'move' になるように修正する
                      return 'move';
                  case 'add-vertex-on-edge':
                      return this._interactionLogic.findClosestEdge(worldPoint) ? 'copy' : 'not-allowed';
                  case 'add-hole':
                      const targetPolygon = this._editingViewModel.getTargetPolygon();
                      if (targetPolygon) {
                          const subMode = this._editingViewModel.getAddingSubMode();
                          if (subMode) { // 頂点追加中
                              // 有効な位置かどうかの判定ロジック
                              const world = this._viewModel.getWorld();
                              if (!world || !world.vertices) return 'not-allowed';
                              const verticesMap = new Map(world.vertices.map(v => [v.id, { id: v.id, x: v.x, y: v.y }]));
                              const locationInfo = this._interactionLogic.locatePointInPolygon(worldPoint, targetPolygon, verticesMap);
                              const isOnBoundary = this._interactionLogic.isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
                              const targetRingId = this._editingViewModel.getTargetRingIdForHole();
                              
                              let isValidClick = false;
                              if (subMode === 'hole') {
                                  isValidClick = locationInfo.type === 'inside_outer' && locationInfo.ringId === targetRingId && !isOnBoundary;
                              } else if (subMode === 'enclave') {
                                  const condition1 = (targetRingId === null && locationInfo.type === 'outside');
                                  const condition2 = (targetRingId !== null && locationInfo.type === 'inside_hole' && locationInfo.ringId === targetRingId);
                                  isValidClick = (condition1 || condition2) && !isOnBoundary;
                              }
                              return isValidClick ? 'crosshair' : 'not-allowed';
                          } else { // ポリゴンは選択済みだが、サブモード未決定
                              const feature = this._interactionLogic.findClosestFeature(worldPoint);
                              return (feature instanceof DomainPolygon) ? 'pointer' : 'default';
                          }
                      } else { // ターゲットポリゴン選択前
                          const feature = this._interactionLogic.findClosestFeature(worldPoint);
                          return (feature instanceof DomainPolygon) ? 'pointer' : 'default';
                      }
                  case 'split':
                      if (!this._editingViewModel.getTargetPolygon()) {
                          const feature = this._interactionLogic.findClosestFeature(worldPoint);
                          return (feature instanceof DomainPolygon) ? 'pointer' : 'default';
                      }
                      return 'crosshair';
                  default:
                      return 'default';
              }
          default:
              return 'default';
      }
  }

  /**
   * マウスカーソルを現在の状態に基づいて更新する (リファクタリング)
   * @param {object | null} worldPoint - 現在のマウスのワールド座標
   * @private
   */
  _updateCursor(worldPoint) {
      const newCursor = this._getCursorForCurrentState(worldPoint);
      if (this._mapOverlay.style.cursor !== newCursor) {
          this._mapOverlay.style.cursor = newCursor;
      }
  }

  /** 点追加処理 */
  handleAddPoint(worldPoint) {
    if (!worldPoint) return;
    this._editingViewModel.addPoint(worldPoint);
  }

  /** 測定点追加処理 */
  handleAddMeasurePoint(worldPoint) {
    if (!worldPoint) return;
    this._mapView._handleAddMeasurePoint(worldPoint); // MapViewのメソッドを呼ぶ
  }

  /** 確定ボタン/Enterキー処理 (MapViewのメソッドを呼ぶ) */
  handleConfirmClick() {
    this._mapView._handleConfirmClick();
  }

  /** キャンセルボタン/Escキー処理 (MapViewのメソッドを呼ぶ) */
  handleCancelClick() {
    this._mapView._handleCancelClick();
  }

  _getSharedVertexSnapOptions() {
    const snapWorldDistance = typeof this._mapView.getSharedVertexSnapDistanceWorld === 'function'
      ? this._mapView.getSharedVertexSnapDistanceWorld()
      : null;
    const worldWidth = this._renderer && typeof this._renderer.getWorldWidth === 'function'
      ? this._renderer.getWorldWidth()
      : null;
    const visibleFeatures = typeof this._viewModel.getFeatures === 'function'
      ? this._viewModel.getFeatures()
      : [];
    return { snapWorldDistance, worldWidth, visibleFeatures };
  }

  _collectVerticesForFeature(feature) {
    const world = this._viewModel.getWorld();
    if (!world || !Array.isArray(world.vertices) || !feature) {
      return new Map();
    }

    const vertexIds = new Set();
    const isPolygon = feature instanceof DomainPolygon || feature.constructor?.name === 'Polygon';
    const isLine = feature instanceof DomainLine || feature.constructor?.name === 'Line';
    const isPoint = feature instanceof DomainPoint || feature.constructor?.name === 'Point';

    if (isPolygon && Array.isArray(feature.rings)) {
      feature.rings.forEach(ring => {
        if (Array.isArray(ring.vertexIds)) {
          ring.vertexIds.forEach(id => vertexIds.add(id));
        }
      });
    } else if ((isLine || isPoint) && Array.isArray(feature.vertexIds)) {
      feature.vertexIds.forEach(id => vertexIds.add(id));
    }

    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
    const verticesToDrag = new Map();
    vertexIds.forEach(id => {
      const vertexData = verticesMap.get(id);
      if (vertexData) {
        verticesToDrag.set(id, { x: vertexData.x, y: vertexData.y });
      }
    });

    return verticesToDrag;
  }

  /** 分割ツールでのクリック処理 */
  _handleSplitToolClick(worldPoint) {
      const targetPolygon = this._editingViewModel.getTargetPolygon();
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices) return;

      const splitLineMode = typeof this._editingViewModel.getSplitLineMode === 'function'
        ? this._editingViewModel.getSplitLineMode()
        : 'open';
      if (splitLineMode === 'circle') {
        return;
      }

      if (!targetPolygon) {
        const clickedFeature = this._interactionLogic.findClosestFeature(worldPoint);
        if (clickedFeature instanceof DomainPolygon) {
          this._editingViewModel.startSplit(clickedFeature);
          this._viewModel.selectFeature(clickedFeature.id);
        } else {
          alert("分割する面情報を選択してください。");
        }
        return;
      }

      const existingPoints = this._editingViewModel.getAddingPoints();
      if (existingPoints.length >= 1) {
        const radiusWorld = typeof this._mapView.getSplitCircleRadiusWorld === 'function'
          ? this._mapView.getSplitCircleRadiusWorld()
          : null;
        if (Number.isFinite(radiusWorld) && radiusWorld > 0) {
          const center = existingPoints[0];
          const dx = worldPoint.x - center.x;
          const dy = worldPoint.y - center.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq <= radiusWorld * radiusWorld && existingPoints.length >= 3) {
            if (typeof this._editingViewModel.clearSplitPlan === 'function') {
              this._editingViewModel.clearSplitPlan();
            }
            if (typeof this._editingViewModel.setSplitLineMode === 'function') {
              this._editingViewModel.setSplitLineMode('circle');
            }
            if (typeof this._mapView.refresh === 'function') {
              this._mapView.refresh();
            }
            this.handleConfirmClick();
            const splitPlan = typeof this._editingViewModel.getSplitPlan === 'function'
              ? this._editingViewModel.getSplitPlan()
              : null;
            if (!splitPlan && typeof this._editingViewModel.setSplitLineMode === 'function') {
              this._editingViewModel.setSplitLineMode('open');
            }
            return;
          }
        }
      }

      if (existingPoints.length === 0) {
        if (typeof this._editingViewModel.setSplitLineMode === 'function') {
          this._editingViewModel.setSplitLineMode('open');
        }
      }

      this.handleAddPoint(worldPoint);
    }

  /** 穴/飛び地追加モードでのクリック処理 */
    _handleAddHoleOrEnclaveClick(worldPoint) {
    const targetPolygon = this._editingViewModel.getTargetPolygon();
    const currentSubMode = this._editingViewModel.getAddingSubMode();

    if (!targetPolygon) { // 1. 対象ポリゴンがまだ選択されていない場合
      const clickedFeature = this._interactionLogic.findClosestFeature(worldPoint);
      if (clickedFeature instanceof DomainPolygon) {
        // ポリゴンをクリックした場合、それをターゲットに設定
        this._editingViewModel.startAddingHoleOrEnclave(clickedFeature);
        this._viewModel.selectFeature(clickedFeature.id); // 選択してハイライト
        console.log(`Hole/Enclave adding started for polygon: ${clickedFeature.id}. Click inside to add hole, outside to add enclave.`);
      } else {
        alert("穴または飛び地を追加するポリゴンを選択してください。");
      }
    } else if (currentSubMode === null) { // 2. ターゲットポリゴンは選択済みだが、サブモード（穴か飛び地か）が未決定の場合
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices) return;
      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      // クリック位置がポリゴンのどの部分にあるか判定
      const locationInfo = this._interactionLogic.locatePointInPolygon(worldPoint, targetPolygon, verticesMap);
      // 境界線上にクリックされたか判定
      const isOnBoundary = this._interactionLogic.isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);

      if (isOnBoundary) {
         console.warn("Cannot start hole/enclave on the boundary.");
         alert("境界線上には開始できません。ポリゴンの内側または外側をクリックしてください。")
      } else if (locationInfo.type === 'inside_outer') { // ポリゴン外周の内側（穴の外側）の場合
        // 穴モードを開始
        this._editingViewModel.setAddingSubMode('hole');
        // 穴を追加する対象の外周リングIDを設定
        this._editingViewModel.setTargetRingIdForHole(locationInfo.ringId);
        // 最初の点を追加
        this.handleAddPoint(worldPoint);
        console.log(`Adding hole inside ring ${locationInfo.ringId}.`);
      } else if (locationInfo.type === 'outside' || locationInfo.type === 'inside_hole') { // ポリゴン外部または穴内部の場合
        // 飛び地モードを開始
        this._editingViewModel.setAddingSubMode('enclave');
        // 飛び地の場合、親リングIDを設定 (本土外ならnull, 穴の中ならその穴のID)
        this._editingViewModel.setTargetRingIdForHole(locationInfo.ringId);
        // 最初の点を追加
        this.handleAddPoint(worldPoint);
        console.log(`Adding enclave (parent ring: ${locationInfo.ringId || 'root'}).`);
      }
    } else { // 3. サブモード決定済みで、頂点を追加していく段階
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices) return;
      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      const locationInfo = this._interactionLogic.locatePointInPolygon(worldPoint, targetPolygon, verticesMap);
      const isOnBoundary = this._interactionLogic.isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
      const targetRingId = this._editingViewModel.getTargetRingIdForHole(); // 穴または飛び地の親リングID

      let isValidClick = false;
      if (currentSubMode === 'hole') {
          // 穴モード: クリック位置がターゲットの外周リング内部 かつ 境界上ではない
          isValidClick = locationInfo.type === 'inside_outer' && locationInfo.ringId === targetRingId && !isOnBoundary;
          if (!isValidClick) console.warn("Invalid click for hole: Must be inside the target outer ring and not on a boundary.", { clickLocation: locationInfo, targetRingId });
      } else if (currentSubMode === 'enclave') {
          // 飛び地モード:
          // - 本土の外側に作る場合(targetRingId: null): クリック位置がポリゴン外部
          // - 穴の中に作る場合(targetRingId: 穴のID): クリック位置がその穴の内部
          const condition1 = (targetRingId === null && locationInfo.type === 'outside');
          const condition2 = (targetRingId !== null && locationInfo.type === 'inside_hole' && locationInfo.ringId === targetRingId);
          isValidClick = (condition1 || condition2) && !isOnBoundary;
           if (!isValidClick) console.warn("Invalid click for enclave: Must be in the correct region (outside polygon or inside parent hole) and not on a boundary.", { clickLocation: locationInfo, targetRingId });
      }

      if (isValidClick) {
          // 有効なクリックであれば点を追加
          this.handleAddPoint(worldPoint);
      } else {
           // 無効なクリック位置の場合は警告（または何もしない）
           // alert("ここには頂点を追加できません。");
      }
    }
  }

}
