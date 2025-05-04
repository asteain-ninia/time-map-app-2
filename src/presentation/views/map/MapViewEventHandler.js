// src\presentation\views\map\MapViewEventHandler.js

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

    // マウス/タッチ状態
    this._isMouseDown = false;
    this._isDragging = false;
    this._dragStartScreenPosition = { x: 0, y: 0 }; // スクリーン座標
    this._lastScreenPosition = { x: 0, y: 0 }; // スクリーン座標
    this._svgPoint = null; // SVG座標変換用
    this._clickTolerancePixels = 3; // ピクセル単位での許容範囲
  }

  /**
   * イベントリスナーを設定
   */
  setupEventListeners() {
    // ★ _mapOverlay が設定されてからリスナーを追加
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
    // タッチイベントも同様に設定 (省略、必要なら元のMapViewから移動)
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
    const targetElement = event.target;
    // ダイアログ上のイベントは無視
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;
    // 右クリックは無視 (contextmenuで処理)
    if (event.button === 2) return;

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);
    if (!worldPoint) return;

    this._isMouseDown = true;
    this._lastScreenPosition = { x: pageX, y: pageY };
    this._dragStartScreenPosition = { x: pageX, y: pageY };

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const addToSelection = event.shiftKey;

    switch (mode) {
      case 'view':
        this._viewportManager.startDrag(pageX, pageY);
        break;
      case 'add':
        this.handleAddPoint(worldPoint); // 点追加処理を呼び出す
        break;
      case 'edit':
        if (tool === 'add-hole') {
          // ★ 穴/飛び地追加モードのクリック処理
          this._handleAddHoleOrEnclaveClick(worldPoint);
        } else { // 選択、移動など
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
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);
    if (!worldPoint) return;

    if (this._isMouseDown) { // マウスボタンが押されている -> ドラッグ判定
      if (!this._isDragging) { // まだドラッグ状態でない場合
        const dxScreen = pageX - this._dragStartScreenPosition.x;
        const dyScreen = pageY - this._dragStartScreenPosition.y;
        // 一定距離移動したらドラッグ開始とみなす
        if (Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen) > this._clickTolerancePixels) {
          this._isDragging = true;
        }
      }

      if (this._isDragging) { // ドラッグ状態の場合
        const mode = this._editingViewModel.getMode();
        const tool = this._editingViewModel.getTool();
        const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

        if (mode === 'view') {
          // 表示モードならビューポートをドラッグ
          this._viewportManager.drag(pageX, pageY);
        } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
            // 編集モードで頂点ドラッグ中の場合
            const totalDxScreen = pageX - this._dragStartScreenPosition.x;
            const totalDyScreen = pageY - this._dragStartScreenPosition.y;
            const viewport = this._viewportManager.getViewport();
            const totalDeltaXWorld = totalDxScreen / viewport.zoom;
            const totalDeltaYWorld = totalDyScreen / viewport.zoom; // Y軸の向きに注意

            // ViewModelにワールド座標での総移動量を渡す
            this._editingViewModel.updateVerticesDrag(totalDeltaXWorld, -totalDeltaYWorld);
        }
        // 他のモード・ツールでのドラッグは何もしない（追加モードなど）
      }
    } else { // マウスボタンが押されていない -> ホバー処理
       this.handleMouseHover(worldPoint);
    }

    this._lastScreenPosition = { x: pageX, y: pageY };
  }

  /** マウスアップ */
  handleMouseUp(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;

    // 右クリックの場合は無視
    if (event.button === 2) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

    // ドラッグ終了処理
    if (this._isMouseDown && this._isDragging) {
      if (mode === 'view') {
        this._viewportManager.endDrag();
      } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
        this._editingViewModel.endVerticesDrag(); // ViewModelに頂点移動確定を依頼
      }
    }
    // クリック（ドラッグなし）処理
    else if (this._isMouseDown && !this._isDragging) {
        // クリックでも頂点ドラッグ状態はリセットする必要がある
        if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
            // 移動がなくてもendVerticesDragを呼び出して状態をリセット
            this._editingViewModel.endVerticesDrag();
        } else if (mode === 'view') {
            // 表示モードでのクリック -> 地物選択
            const pageX = event.clientX;
            const pageY = event.clientY;
            const svgPointRaw = this._getSVGPoint(pageX, pageY);
            const worldPoint = this._svgToWorld(svgPointRaw);
            if (worldPoint) {
                this._interactionLogic.handleClickInViewMode(worldPoint);
            }
        }
        // 'add' モードのクリックは MouseDown で点追加済み
        // 'edit' + 'add-hole' モードのクリックも MouseDown で処理済み
    }

    // 状態リセット
    this._isMouseDown = false;
    this._isDragging = false;
  }

  /** マウス離脱 */
  handleMouseLeave(event) {
    // マウスが押されたままウィンドウ外に出た場合の処理
    if (this._isMouseDown) {
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

      // ドラッグ中であればドラッグを終了させる
      if (mode === 'view' && this._isDragging) {
        this._viewportManager.endDrag();
      } else if (mode === 'edit' && tool !== 'add-hole' && this._isDragging && isDraggingVertices) {
        this._editingViewModel.endVerticesDrag();
      }

      // マウスダウン状態をリセット
      this._isMouseDown = false;
      this._isDragging = false;
    }
    // ホバー状態をクリア
     this._viewModel.hoverFeature(null);
     this._viewModel.hoverVertex(null);
     // 再描画はViewModelの通知経由で行われる
  }

  /** ホイール */
  handleWheel(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;
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
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;

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
    } else if (mode === 'view') {
      // 表示モードでのダブルクリックはビューポートリセット（または中心移動など）
      this._viewportManager.updateViewport({ x: worldPoint.x, y: worldPoint.y, zoom: 1 });
    }
  }

  /** コンテキストメニュー */
  handleContextMenu(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;
    event.preventDefault(); // デフォルトのコンテキストメニューを抑制

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);
    if (!worldPoint) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const subMode = this._editingViewModel.getAddingSubMode();

    // 地物追加中、または穴/飛び地追加中に右クリックでキャンセル
    if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
        this.handleCancelClick(); // MapViewのキャンセル処理を呼び出す
        console.log("Add/Hole/Enclave operation cancelled by right-click.");
    }
    // 編集モードで右クリックした場合、オブジェクト選択とコンテキストメニュー表示（未実装）
    else if (mode === 'edit') {
         this._interactionLogic.selectObjectAt(worldPoint); // 右クリック位置のオブジェクトを選択
         // TODO: コンテキストメニューを表示する処理を実装
         alert(`Context menu (not implemented) triggered at ${worldPoint.x.toFixed(2)}, ${worldPoint.y.toFixed(2)}`);
     }
     // 距離測定中に右クリックでキャンセル
     else if (this._mapView.isMeasuringDistance()) {
         this._mapView.clearMeasurements();
         this._mapView.setMeasuringDistance(false);
         console.log("Measurement cancelled by right-click.");
     }
  }

  /** キーダウン */
  handleKeyDown(event) {
    const targetElement = event.target;
    const isInInputDialog = targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form');
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

    if (event.key === 'Escape') {
       event.preventDefault();
       if (this._editingViewModel.getDraggingVerticesInfo().size > 0) {
           // 頂点ドラッグ中にEsc -> ドラッグキャンセル
           this._editingViewModel._resetDraggingState(); // ViewModelにリセットを依頼
           console.log("Vertex drag cancelled by ESC.");
       } else if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
           // 地物/穴/飛び地追加中にEsc -> キャンセル
         this.handleCancelClick(); // MapViewのキャンセル処理を呼び出す
         console.log("Add/Hole/Enclave operation cancelled by ESC.");
       } else if (mode === 'edit' && (this._viewModel.getSelectedFeatureId() || this._viewModel.getSelectedVertexIds().size > 0)) {
           // 編集モードで何か選択中にEsc -> 選択解除
         this._viewModel.clearSelection();
         console.log("Selection cleared by ESC.");
       } else if (this._mapView.isMeasuringDistance()) {
           // 距離測定中にEsc -> キャンセル
           this._mapView.clearMeasurements();
           this._mapView.setMeasuringDistance(false);
           console.log("Measurement cancelled by ESC.");
       } else {
           // その他の場合にEsc -> 表示モードに戻る
         this._editingViewModel.setMode('view');
         console.log("Mode set to 'view' by ESC.");
       }
    } else if (event.key === 'Enter') {
        // 地物/穴/飛び地追加モードで点が十分にあれば確定
        if (((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && subMode)) && this._editingViewModel.getAddingPoints().length > 0) {
            const minPoints = (mode === 'add')
                             ? (tool === 'point' ? 1 : (tool === 'line' ? 2 : 3))
                             : 3; // 穴/飛び地は3点
            if (this._editingViewModel.getAddingPoints().length >= minPoints) {
                event.preventDefault();
                this.handleConfirmClick(); // MapViewの確定処理を呼び出す
                console.log("Add/Hole/Enclave operation confirmed by Enter.");
            }
        }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
        // 編集モードで何か選択中にDelete/Backspace -> 削除
       event.preventDefault();
      const selectedVertexIds = this._viewModel.getSelectedVertexIds();
      const selectedFeatureId = this._viewModel.getSelectedFeatureId();
      if (mode === 'edit') {
          if (selectedVertexIds.size > 0) {
              // 頂点選択中 -> 選択頂点を削除
              const vertexIdsToDelete = Array.from(selectedVertexIds);
              this._editingViewModel.deleteVertices(vertexIdsToDelete);
          } else if (selectedFeatureId) {
              // 地物選択中 -> 選択地物を削除
              // ★ 削除前に地物データを取得する必要がある
              const featureToDelete = this._viewModel.getWorld()?.features.find(f => f.id === selectedFeatureId);
              if (featureToDelete) {
                  this._editingViewModel.deleteFeature(selectedFeatureId, featureToDelete);
              } else { console.error(`Feature with ID ${selectedFeatureId} not found for deletion.`); }
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

  /** マウスホバー処理 */
  handleMouseHover(worldPoint) {
      // 編集モード以外、または穴追加ツール選択中はホバー処理をスキップ
      if (this._editingViewModel.getMode() !== 'edit' || this._editingViewModel.getTool() === 'add-hole') {
          if (this._viewModel.getHoveredVertex() || this._viewModel.getHoveredFeature()) {
              this._viewModel.hoverVertex(null);
              this._viewModel.hoverFeature(null);
          }
          this._mapOverlay.style.cursor = 'default';
          return;
      }
      // 最も近い頂点を検索
      const hoveredVertex = this._interactionLogic.findClosestVertex(worldPoint);
      if (hoveredVertex) {
          // 頂点ホバー
          this._viewModel.hoverVertex(hoveredVertex.id);
          this._viewModel.hoverFeature(null); // 地物ホバーは解除
          this._mapOverlay.style.cursor = 'pointer'; // カーソル変更
      } else {
          // 頂点が見つからなければ地物を検索
          const hoveredFeature = this._interactionLogic.findClosestFeature(worldPoint);
          if (hoveredFeature) {
              // 地物ホバー
              this._viewModel.hoverFeature(hoveredFeature.id);
              this._viewModel.hoverVertex(null); // 頂点ホバーは解除
              this._mapOverlay.style.cursor = 'pointer'; // カーソル変更
          } else {
              // 何も見つからなければホバー解除
              this._viewModel.hoverVertex(null);
              this._viewModel.hoverFeature(null);
              this._mapOverlay.style.cursor = 'default';
          }
      }
      // 再描画はViewModelの通知経由で行われる
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
        // ★ 穴を追加する対象の外周リングIDを設定
        this._editingViewModel.setTargetRingIdForHole(locationInfo.ringId);
        // 最初の点を追加
        this.handleAddPoint(worldPoint);
        console.log(`Adding hole inside ring ${locationInfo.ringId}.`);
      } else if (locationInfo.type === 'outside' || locationInfo.type === 'inside_hole') { // ポリゴン外部または穴内部の場合
        // 飛び地モードを開始
        this._editingViewModel.setAddingSubMode('enclave');
        // ★ 飛び地の場合、ターゲットリングIDは不要なのでnullを設定
        this._editingViewModel.setTargetRingIdForHole(null);
        // 最初の点を追加
        this.handleAddPoint(worldPoint);
        console.log(`Adding enclave (outside or inside hole ${locationInfo.ringId}).`);
      }
    } else { // 3. サブモード決定済みで、頂点を追加していく段階
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices) return;
      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      const locationInfo = this._interactionLogic.locatePointInPolygon(worldPoint, targetPolygon, verticesMap);
      const isOnBoundary = this._interactionLogic.isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
      const targetRingId = this._editingViewModel.getTargetRingIdForHole(); // 穴モードの場合のターゲットリングID

      let isValidClick = false;
      if (currentSubMode === 'hole') {
          // 穴モード: クリック位置がターゲットの外周リング内部 かつ 境界上ではない
          isValidClick = locationInfo.type === 'inside_outer' && locationInfo.ringId === targetRingId && !isOnBoundary;
          if (!isValidClick) console.warn("Invalid click for hole: Must be inside the target outer ring and not on a boundary.", { clickLocation: locationInfo, targetRingId });
      } else if (currentSubMode === 'enclave') {
          // 飛び地モード: クリック位置がポリゴンの外部 または いずれかの穴の内部 かつ 境界上ではない
          isValidClick = (locationInfo.type === 'outside' || locationInfo.type === 'inside_hole') && !isOnBoundary;
           if (!isValidClick) console.warn("Invalid click for enclave: Must be outside the polygon or inside a hole, and not on a boundary.", { clickLocation: locationInfo });
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
