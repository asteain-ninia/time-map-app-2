import { Point as DomainPoint } from '../../../domain/entities/Point.js';
import { Line as DomainLine } from '../../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../../domain/entities/Polygon.js';

/**
 * MapView におけるユーザーイベントハンドリングを担当
 */
export class MapViewEventHandler {
  /**
   * @param {MapView} mapView - 親ビュー
   * @param {HTMLElement} mapOverlay - イベントを受け取るオーバーレイ要素
   * @param {MapViewModel} viewModel
   * @param {EditingViewModel} editingViewModel
   * @param {ViewportManager} viewportManager
   * @param {SVGRenderer} renderer
   * @param {MapViewInteractionLogic} interactionLogic
   */
  constructor(mapView, mapOverlay, viewModel, editingViewModel, viewportManager, renderer, interactionLogic) {
    this._mapView = mapView; // 親ビューのメソッド呼び出し用
    this._mapOverlay = mapOverlay;
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
        return ctm ? this._svgPoint.matrixTransform(ctm.inverse()) : null;
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
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;
    if (event.button === 2) return; // 右クリック無視

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
        this.handleAddPoint(worldPoint);
        break;
      case 'edit':
        if (tool === 'add-hole') {
          this._handleAddHoleOrEnclaveClick(worldPoint);
        } else {
            const clickedVertex = this._interactionLogic.findClosestVertex(worldPoint);
            if (clickedVertex) {
                if (addToSelection) {
                    this._viewModel.selectVertex(clickedVertex.id, true);
                } else if (!this._viewModel.getSelectedVertexIds().has(clickedVertex.id)) {
                    this._viewModel.selectVertex(clickedVertex.id, false);
                }
                // ドラッグ開始 (教訓 8.8.1 参照)
                const verticesToDrag = new Map();
                if (this._viewModel.getSelectedVertexIds().has(clickedVertex.id)) {
                    this._viewModel.getSelectedVertices().forEach(v => verticesToDrag.set(v.id, { x: v.x, y: v.y }));
                } else {
                    verticesToDrag.set(clickedVertex.id, { x: clickedVertex.x, y: clickedVertex.y });
                }
                if (verticesToDrag.size > 0) {
                    this._editingViewModel.startVerticesDrag(verticesToDrag);
                }
            } else {
                this._interactionLogic.selectObjectAt(worldPoint, addToSelection);
            }
        }
        break;
    }
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

    if (this._isMouseDown) {
      if (!this._isDragging) {
        const dxScreen = pageX - this._dragStartScreenPosition.x;
        const dyScreen = pageY - this._dragStartScreenPosition.y;
        if (Math.sqrt(dxScreen * dxScreen + dyScreen * dyScreen) > this._clickTolerancePixels) {
          this._isDragging = true;
        }
      }

      if (this._isDragging) {
        const mode = this._editingViewModel.getMode();
        const tool = this._editingViewModel.getTool();
        const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

        if (mode === 'view') {
          this._viewportManager.drag(pageX, pageY);
        } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
            // 教訓 8.2.3 / 8.6.1 修正: 開始点からの総移動量を計算して渡す
            const totalDxScreen = pageX - this._dragStartScreenPosition.x;
            const totalDyScreen = pageY - this._dragStartScreenPosition.y;
            const viewport = this._viewportManager.getViewport();
            const totalDeltaXWorld = totalDxScreen / viewport.zoom;
            const totalDeltaYWorld = totalDyScreen / viewport.zoom; // スクリーンY下向き -> ワールドY上向き

            this._editingViewModel.updateVerticesDrag(totalDeltaXWorld, -totalDeltaYWorld); // ViewModelに総移動量を渡す
        }
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

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();
    const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

    // ドラッグ終了処理
    if (this._isMouseDown && this._isDragging) {
      if (mode === 'view') {
        this._viewportManager.endDrag();
      } else if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
        this._editingViewModel.endVerticesDrag(); // ViewModelに確定を依頼
      }
    }
    // クリック（ドラッグなし）処理
    else if (this._isMouseDown && !this._isDragging) {
        // 教訓 8.2.3: クリックでもドラッグ状態をリセット
        if (mode === 'edit' && tool !== 'add-hole' && isDraggingVertices) {
            this._editingViewModel.endVerticesDrag(); // 移動がなくても状態リセットのため呼ぶ
        } else if (mode === 'view') {
            const pageX = event.clientX;
            const pageY = event.clientY;
            const svgPointRaw = this._getSVGPoint(pageX, pageY);
            const worldPoint = this._svgToWorld(svgPointRaw);
            if (worldPoint) {
                this._interactionLogic.handleClickInViewMode(worldPoint);
            }
        }
        // 'add' と 'edit' のクリックは MouseDown で処理済み
    }

    // 状態リセット
    this._isMouseDown = false;
    this._isDragging = false;
  }

  /** マウス離脱 */
  handleMouseLeave(event) {
    if (this._isMouseDown) {
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const isDraggingVertices = this._editingViewModel.getDraggingVerticesInfo().size > 0;

      if (mode === 'view' && this._isDragging) {
        this._viewportManager.endDrag();
      } else if (mode === 'edit' && tool !== 'add-hole' && this._isDragging && isDraggingVertices) {
        this._editingViewModel.endVerticesDrag();
      }

      this._isMouseDown = false;
      this._isDragging = false;
    }
     this._viewModel.hoverFeature(null);
     this._viewModel.hoverVertex(null);
     // this._mapView._render(); // MapView側で処理
  }

  /** ホイール */
  handleWheel(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;
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

    if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && subMode)) {
       this.handleAddPoint(worldPoint);
       this.handleConfirmClick(); // MapViewのメソッド呼び出しに変更
    } else if (mode === 'view') {
      this._viewportManager.updateViewport({ x: worldPoint.x, y: worldPoint.y, zoom: 1 });
    }
  }

  /** コンテキストメニュー */
  handleContextMenu(event) {
    const targetElement = event.target;
    if (targetElement.closest('.property-input-dialog') || targetElement.closest('.layer-input-form')) return;
    event.preventDefault();

    const pageX = event.clientX;
    const pageY = event.clientY;
    const svgPointRaw = this._getSVGPoint(pageX, pageY);
    const worldPoint = this._svgToWorld(svgPointRaw);
    if (!worldPoint) return;

    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();

    if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
        this.handleCancelClick(); // MapViewのメソッド呼び出しに変更
        console.log("Add/Hole/Enclave operation cancelled by right-click.");
    } else if (mode === 'edit') {
         this._interactionLogic.selectObjectAt(worldPoint); // 右クリック位置のオブジェクトを選択
         alert(`Context menu triggered at ${worldPoint.x.toFixed(2)}, ${worldPoint.y.toFixed(2)}`);
     } else if (this._mapView.isMeasuringDistance()) {
         this._mapView.clearMeasurements();
         this._mapView.setMeasuringDistance(false);
         console.log("Measurement cancelled by right-click.");
     }
  }

  /** キーダウン */
  handleKeyDown(event) {
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
              this.handleCancelClick(); // MapViewのメソッド呼び出しに変更
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
       if (this._editingViewModel.getDraggingVerticesInfo().size > 0) {
           this._editingViewModel._resetDraggingState(); // ViewModelにリセットを依頼
           console.log("Vertex drag cancelled by ESC.");
       } else if ((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole')) {
         this.handleCancelClick(); // MapViewのメソッド呼び出しに変更
         console.log("Add/Hole/Enclave operation cancelled by ESC.");
       } else if (mode === 'edit' && (this._viewModel.getSelectedFeatureId() || this._viewModel.getSelectedVertexIds().size > 0)) {
         this._viewModel.clearSelection();
         console.log("Selection cleared by ESC.");
       } else if (this._mapView.isMeasuringDistance()) {
           this._mapView.clearMeasurements();
           this._mapView.setMeasuringDistance(false);
           console.log("Measurement cancelled by ESC.");
       } else {
         this._editingViewModel.setMode('view');
         console.log("Mode set to 'view' by ESC.");
       }
    } else if (event.key === 'Enter') {
        if (((mode === 'add' && tool) || (mode === 'edit' && tool === 'add-hole' && subMode)) && this._editingViewModel.getAddingPoints().length > 0) {
            event.preventDefault();
            this.handleConfirmClick(); // MapViewのメソッド呼び出しに変更 (教訓3.1修正)
            console.log("Add/Hole/Enclave operation confirmed by Enter.");
        }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
       event.preventDefault();
      const selectedVertexIds = this._viewModel.getSelectedVertexIds();
      const selectedFeatureId = this._viewModel.getSelectedFeatureId();
      if (mode === 'edit') {
          if (selectedVertexIds.size > 0) {
              const vertexIdsToDelete = Array.from(selectedVertexIds);
              this._editingViewModel.deleteVertices(vertexIdsToDelete);
          } else if (selectedFeatureId) {
              const featureToDelete = this._viewModel.getWorld()?.features.find(f => f.id === selectedFeatureId);
              if (featureToDelete) {
                  this._editingViewModel.deleteFeature(selectedFeatureId, featureToDelete);
              } else { console.error(`Feature with ID ${selectedFeatureId} not found.`); }
          } else { console.log("Delete key pressed, but nothing selected."); }
      }
    } else if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z') {
        event.preventDefault();
        if (event.shiftKey) this._editingViewModel.redo();
        else this._editingViewModel.undo();
      } else if (event.key === 'y') {
        event.preventDefault();
        this._editingViewModel.redo();
      }
    }
  }

  /** キーアップ */
  handleKeyUp(event) { /* 必要なら実装 */ }

  // --- Helper methods called by handlers ---

  /** マウスホバー処理 */
  handleMouseHover(worldPoint) {
      if (this._editingViewModel.getMode() !== 'edit') {
          if (this._viewModel.getHoveredVertex() || this._viewModel.getHoveredFeature()) {
              this._viewModel.hoverVertex(null);
              this._viewModel.hoverFeature(null);
          }
          this._mapOverlay.style.cursor = 'default';
          return;
      }
      const hoveredVertex = this._interactionLogic.findClosestVertex(worldPoint);
      if (hoveredVertex) {
          this._viewModel.hoverVertex(hoveredVertex.id);
          this._viewModel.hoverFeature(null);
          this._mapOverlay.style.cursor = 'pointer';
      } else {
          const hoveredFeature = this._interactionLogic.findClosestFeature(worldPoint);
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

    if (!targetPolygon) { // 1. 対象ポリゴン選択
      const clickedFeature = this._interactionLogic.findClosestFeature(worldPoint);
      if (clickedFeature instanceof DomainPolygon) {
        this._editingViewModel.startAddingHoleOrEnclave(clickedFeature);
        this._viewModel.selectFeature(clickedFeature.id); // ハイライト
        console.log(`Hole/Enclave adding started for polygon: ${clickedFeature.id}.`);
      } else {
        alert("穴または飛び地を追加するポリゴンを選択してください。");
      }
    } else if (currentSubMode === null) { // 2. サブモード決定
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices) return;
      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      const locationInfo = this._interactionLogic.getPointLocationInPolygon(worldPoint, targetPolygon, verticesMap);
      const isOnBoundary = this._interactionLogic.isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
      // TODO: 他ポリゴンとの内外・境界判定も追加
      if (isOnBoundary /* || isOnOtherBoundary */) {
         console.warn("Cannot start on boundary.");
      } else if (locationInfo.type === 'inside_outer' /* && !isInOtherPolygon */) { // 本土or飛び地内部
        this._editingViewModel.setAddingSubMode('hole');
        this._editingViewModel.setTargetSubPolygonIndex(locationInfo.ringId); // リングIDを仮でインデックス代わりに使う（要調整）
        this.handleAddPoint(worldPoint);
      } else { // 外部 or 穴内部
        this._editingViewModel.setAddingSubMode('enclave');
        this._editingViewModel.setTargetSubPolygonIndex(null);
        this.handleAddPoint(worldPoint);
      }
    } else { // 3. 頂点追加
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices) return;
      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      const locationInfo = this._interactionLogic.getPointLocationInPolygon(worldPoint, targetPolygon, verticesMap);
      const isOnBoundary = this._interactionLogic.isPointNearPolygonBoundary(worldPoint, targetPolygon, verticesMap);
      // TODO: 他ポリゴンとの内外・境界判定も追加
      const targetRingId = this._editingViewModel.getTargetSubPolygonIndex(); // 仮でリングIDとして取得

      let isValidClick = false;
      if (currentSubMode === 'hole') {
          // 穴モード: 対象リング('inside_outer')内部 かつ 境界上ではない
          isValidClick = locationInfo.type === 'inside_outer' && locationInfo.ringId === targetRingId && !isOnBoundary;
      } else if (currentSubMode === 'enclave') {
          // 飛び地モード: 対象ポリゴンの外部('outside') または 穴内部('inside_hole') かつ 境界上ではない
          isValidClick = (locationInfo.type === 'outside' || locationInfo.type === 'inside_hole') && !isOnBoundary;
      }

      if (isValidClick) {
          this.handleAddPoint(worldPoint);
      } else {
           console.warn("Invalid click location for current subMode:", currentSubMode, locationInfo);
      }
    }
  }

}