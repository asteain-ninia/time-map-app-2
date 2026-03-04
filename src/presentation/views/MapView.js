// src/presentation/views/MapView.js
import { FeatureAnchor } from '../../domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../domain/value-objects/TimePoint.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { buildPolygonSplitPlan } from '../../domain/services/PolygonSplitService.js';
import { getVertexHitTolerancePixels as getRenderedVertexHitTolerancePixels } from '../../infrastructure/rendering/RenderStyleProvider.js';

// 分割したクラスをインポート
import { MapViewInteractionLogic } from './map/MapViewInteractionLogic.js';
import { MapViewRendererHelper } from './map/MapViewRendererHelper.js';
import { MapViewEventHandler } from './map/MapViewEventHandler.js';
import { MapContextMenu } from './map/MapContextMenu.js';
import { ConflictResolutionDialog } from './map/ConflictResolutionDialog.js';

/**
 * メインマップ表示 (ファサードクラス)
 * 実際のロジックはサブクラスに委譲
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
    this._configManager = configManager; // configManager は他のアプリ全体設定で使われる可能性があるので残す

    // DOM要素
    this._mapElement = null;
    this._mapOverlay = null;
    this._actionButtonsContainer = null;
    this._confirmButton = null;
    this._cancelButton = null;
    this._splitGuideElement = null;
    this._resizeObserver = null;

    // 状態
    this._isMeasuringDistance = false;
    this._measurePoints = []; // ワールド座標の配列

    // 頂点ヒット判定
    this._clickToleranceSq = 0; // ワールド座標での二乗値 (動的に更新)
    this._renderScheduled = false;
    this._renderPending = false;
    this._renderPendingMode = 'full';
    this._lastRenderTimestamp = 0;
    this._lastDragVertexCount = 0;
    this._lastViewport = null;
    this._zoomRenderTimeoutId = null;

    // サブクラスのインスタンス化
    // InteractionLogic にはクリック許容範囲(二乗)を返す関数とワールド幅取得関数を渡す
    this._interactionLogic = new MapViewInteractionLogic(
        viewModel,
        editingViewModel,
        viewModel._geometryService, // GeometryServiceはViewModelが持っている想定
        () => this._clickToleranceSq, // クリック許容範囲(二乗)を返す関数
        () => this._renderer.getWorldWidth() // ワールド幅取得関数を追加
    );
    this._rendererHelper = new MapViewRendererHelper(
        renderer,
        viewModel,
        editingViewModel,
        viewportManager,
        configManager // RendererHelperもconfigManagerに依存する部分があるかもしれない
    );
    // EventHandlerにはMapView自身の参照、Overlay要素、関連クラスを渡す
    this._eventHandler = new MapViewEventHandler(
        this, // MapView自身の参照
        null, // _mapOverlay は _initialize で設定
        viewModel,
        editingViewModel,
        viewportManager,
        renderer,
        this._interactionLogic
    );
    this._contextMenu = new MapContextMenu();
    this._conflictDialog = new ConflictResolutionDialog();

    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // Mapコンテナ要素の作成
    this._mapElement = document.createElement('div');
    this._mapElement.className = 'map-container';
    this._mapElement.style.cssText = 'width: 100%; height: 100%; position: relative; overflow: hidden; background-color: #f0f0f0;';
    this._container.appendChild(this._mapElement);

    // イベントを受け取るオーバーレイ要素の作成
    this._mapOverlay = document.createElement('div');
    this._mapOverlay.className = 'map-overlay';
    // pointer-events: auto でマウスイベントを受け取る
    this._mapOverlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: auto; cursor: default;';
    this._mapElement.appendChild(this._mapOverlay);
    // EventHandlerにOverlay要素への参照を渡す
    this._eventHandler._mapOverlay = this._mapOverlay;

    // アクションボタン（確定/キャンセル）のコンテナ作成
    this._actionButtonsContainer = document.createElement('div');
    this._actionButtonsContainer.className = 'action-buttons-container';
    this._actionButtonsContainer.style.cssText = 'position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 20; display: none; background-color: rgba(255, 255, 255, 0.8); padding: 5px 10px; border-radius: 5px;';
    this._mapElement.appendChild(this._actionButtonsContainer);
    this._createActionButtons(); // ボタンの生成とイベントリスナー設定

    this._splitGuideElement = document.createElement('div');
    this._splitGuideElement.className = 'split-guide-message';
    this._splitGuideElement.style.cssText = 'position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%); z-index: 20; display: none; background-color: rgba(255, 255, 255, 0.85); padding: 6px 10px; border-radius: 4px; font-size: 12px; color: #333; white-space: pre-line; text-align: center;';
    this._splitGuideElement.textContent = '分割ツール: 分断線の点はどこでも配置できます。\n3点以上でガイド円内をクリックすると閉線に切り替わり、そのまま確定フローに進みます。';
    this._mapElement.appendChild(this._splitGuideElement);

    // クリック許容範囲の初期化
    this._updateClickTolerance();

    // イベントリスナー設定 (EventHandlerに委譲)
    this._eventHandler.setupEventListeners();

    // コンテナサイズの変化を監視
    if (typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(() => {
            this._handleResize();
        });
        this._resizeObserver.observe(this._container);
    }

    // ウィンドウリサイズイベントの設定 (MapView自身で処理)
    window.addEventListener('resize', this._handleResize.bind(this));

    // ViewModel等の購読
    this._viewModel.addObserver(this._onViewModelChanged.bind(this));
    this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));
    this._viewportManager.addListener(this._onViewportChanged.bind(this));

    // 初期ズームと初回レンダリング
    // requestAnimationFrameを使用して、DOMの準備ができてから実行
    requestAnimationFrame(() => {
        this._handleResize(); // コンテナサイズに基づいてビューポート等を更新
        this._requestRender();       // 初回描画
    });
  }

  /**
   * ビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onViewModelChanged(type, data) {
    if (type === 'world' || type === 'features' || type === 'layers') {
      if (this._interactionLogic && typeof this._interactionLogic.invalidateIndex === 'function') {
        this._interactionLogic.invalidateIndex();
      }
    }
    // 描画が必要な変更の場合、_renderを呼ぶ
    switch (type) {
      case 'world': // worldデータ全体が変更された場合
      case 'features': // 表示地物リストが変更された場合
      case 'layers': // レイヤー情報が変更された場合
      case 'projectSettingsChanged': // プロジェクト設定が変更された場合も再描画
        this._requestRender(); // 再描画をトリガー
        break;
      case 'activeFeature': // アクティブ地物が変更された場合
      case 'selectedVertices': // 選択頂点が変更された場合
      case 'vertexContextFeature': // 頂点選択コンテキストが変更された場合
        this._requestRender('overlay-full'); // 選択系はオーバーレイのみ更新
        break;
      // 他のタイプのイベントはここでは処理しない
    }
    if (type === 'activeFeature') {
        const primaryFeature = Array.isArray(data)
          ? (data.length === 1 ? data[0] : this._viewModel.getActiveFeature())
          : data;
        this._syncAddHoleToolTarget(primaryFeature);
        this._syncSplitToolTarget(primaryFeature);
    }
  }

  /**
   * 編集ビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onEditingViewModelChanged(type, data) {
     // 描画またはUI更新が必要な変更の場合
    switch (type) {
      case 'mode': // 編集モード変更
      case 'tool': // 選択ツール変更
        this._updateActionButtonsVisibility(); // ボタン表示更新
        if (this._editingViewModel.getDraggingVerticesInfo().size > 0) {
             this._editingViewModel._resetDraggingState(); // ドラッグ状態リセット
        }
        this._requestRender('overlay-full'); // 再描画
        break;
      case 'addingPoints': // 追加中の点変更
      case 'targetPolygon': // 穴/飛び地追加対象ポリゴン変更
      case 'addingSubMode': // 穴/飛び地追加サブモード変更
      case 'targetRingIdForHole': // 穴追加対象リングID変更
      case 'splitLineMode': // 分割線のモード変更
      case 'temporaryElements': // 汎用一時要素変更
      case 'history': // アンドゥ/リドゥ状態変更
      case 'addingState': // 追加関連状態一括変更
        this._updateActionButtonsVisibility(); // ボタン表示更新
        this._requestRender('overlay-full'); // 再描画
        break;
      case 'draggingVertices': { // ドラッグ中頂点情報変更
        this._updateActionButtonsVisibility();
        const draggingCount = this._editingViewModel.getDraggingVerticesInfo().size;
        const shouldRefreshOverlay = (draggingCount === 0 && this._lastDragVertexCount > 0)
          || (draggingCount > 0 && this._lastDragVertexCount === 0);
        this._lastDragVertexCount = draggingCount;
        this._requestRender(shouldRefreshOverlay ? 'overlay-full' : 'overlay');
        break;
      }
      // 他のタイプのイベントはここでは処理しない
    }
    if (
        type === 'tool' ||
        type === 'targetPolygon' ||
        type === 'addingState'
    ) {
        this._syncAddHoleToolTarget();
        this._syncSplitToolTarget();
    }
  }

  /**
   * ビューポート変更のハンドラ
   * @param {Object} viewport - ビューポート情報
   * @private
   */
  _onViewportChanged(viewport) {
    this._updateClickTolerance(); // クリック許容範囲を再計算
    const projectSettings = this._viewModel.getProjectSettings();
    const prev = this._lastViewport;
    const zoomChanged = !prev || Math.abs(prev.zoom - viewport.zoom) > 1e-6;
    const canFastUpdate = this._renderer && typeof this._renderer.updateViewport === 'function';

    if (canFastUpdate) {
      this._renderer.updateViewport(viewport, projectSettings);
      if (this._rendererHelper && typeof this._rendererHelper.renderSplitOverlayOnly === 'function') {
        this._rendererHelper.renderSplitOverlayOnly();
      }
      if (zoomChanged) {
        this._scheduleZoomRender();
      }
      this._lastViewport = { ...viewport };
      return;
    }

    this._requestRender(); // 再描画
    this._lastViewport = { ...viewport };
  }

  /** クリック許容範囲を更新 */
  _updateClickTolerance() {
    const viewport = this._viewportManager.getViewport();
    if (!viewport || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
      this._clickToleranceSq = 0;
      return;
    }
    // ズームレベルに基づいてワールド座標での許容距離（の二乗）を計算
    const worldDistance = this.getVertexHitTolerancePixels() / viewport.zoom;
    this._clickToleranceSq = worldDistance * worldDistance;
  }

  getVertexHitTolerancePixels() {
    return getRenderedVertexHitTolerancePixels();
  }

  _getSharedVertexSnapPixels() {
    if (!this._configManager || typeof this._configManager.get !== 'function') {
      return 50;
    }
    const snapPixels = this._configManager.get('ui.sharedVertexSnapPixels', 50);
    return Number.isFinite(snapPixels) ? snapPixels : 50;
  }

  getSharedVertexSnapDistanceWorld() {
    const viewport = this._viewportManager.getViewport();
    const snapPixels = this._getSharedVertexSnapPixels();
    if (!Number.isFinite(snapPixels) || snapPixels <= 0) {
      return null;
    }
    if (!viewport || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
      return null;
    }
    return snapPixels / viewport.zoom;
  }

  _getSplitCircleRadiusPixels() {
    if (!this._configManager || typeof this._configManager.get !== 'function') {
      return 40;
    }
    const radiusPixels = this._configManager.get('ui.splitCircleRadiusPixels', 40);
    return Number.isFinite(radiusPixels) ? radiusPixels : 40;
  }

  getSplitCircleRadiusWorld() {
    const viewport = this._viewportManager.getViewport();
    const radiusPixels = this._getSplitCircleRadiusPixels();
    if (!Number.isFinite(radiusPixels) || radiusPixels <= 0) {
      return null;
    }
    if (!viewport || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
      return null;
    }
    return radiusPixels / viewport.zoom;
  }

  _getRenderFrameIntervalMs() {
    if (!this._configManager || typeof this._configManager.get !== 'function') {
      return 0;
    }
    const fpsRaw = this._configManager.get('ui.renderFps', 60);
    const fpsValue = Number.isFinite(fpsRaw) ? fpsRaw : 60;
    const clampedFps = Math.max(1, Math.min(60, fpsValue));
    return 1000 / clampedFps;
  }

  _getZoomRenderDelayMs() {
    return 120;
  }

  _scheduleZoomRender() {
    if (this._zoomRenderTimeoutId) {
      clearTimeout(this._zoomRenderTimeoutId);
    }
    const delayMs = this._getZoomRenderDelayMs();
    if (delayMs <= 0) {
      this._zoomRenderTimeoutId = null;
      this._applyZoomSettledRender();
      return;
    }
    this._zoomRenderTimeoutId = setTimeout(() => {
      this._zoomRenderTimeoutId = null;
      this._applyZoomSettledRender();
    }, delayMs);
  }

  _applyZoomSettledRender() {
    const viewport = this._viewportManager.getViewport();
    if (this._renderer && typeof this._renderer.updateZoomScale === 'function') {
      this._renderer.updateZoomScale(viewport);
    }

    const world = this._viewModel.getWorld();
    const currentTime = this._viewModel.getCurrentTime();
    const projectSettings = this._viewModel.getProjectSettings();
    const canRefreshPolygonLabels = this._renderer && typeof this._renderer.refreshPolygonLabels === 'function';
    if (canRefreshPolygonLabels && world && currentTime && projectSettings) {
      this._renderer.refreshPolygonLabels(world, viewport, currentTime, projectSettings);
      this._requestRender('overlay-full');
      return;
    }

    this._requestRender();
  }

  _requestRender(mode = 'full') {
    // 高頻度の描画要求をまとめて、設定FPSの範囲で描画する
    this._renderPending = true;
    if (mode === 'full') {
      this._renderPendingMode = 'full';
    } else if (this._renderPendingMode !== 'full') {
      this._renderPendingMode = mode;
    }
    if (this._renderScheduled) {
      return;
    }
    this._renderScheduled = true;

    const tryRender = (timestamp) => {
      const minFrameMs = this._getRenderFrameIntervalMs();
      if (minFrameMs > 0 && this._lastRenderTimestamp > 0 && (timestamp - this._lastRenderTimestamp) < minFrameMs) {
        requestAnimationFrame(tryRender);
        return;
      }
      this._renderScheduled = false;
      if (!this._renderPending) {
        return;
      }
      this._renderPending = false;
      const pendingMode = this._renderPendingMode || 'full';
      this._renderPendingMode = 'full';
      this._lastRenderTimestamp = timestamp;
      if (pendingMode === 'overlay') {
        this._renderDragOverlay();
      } else if (pendingMode === 'overlay-full') {
        this._renderOverlayFull();
      } else {
        this._render();
      }
    };

    requestAnimationFrame(tryRender);
  }

  /**
   * マップを描画
   * @private
   */
  _render() {
    // 1. 通常の地物を描画 (SVGRendererに委譲)
    const world = this._viewModel.getWorld();
    if (!world) {
        console.warn("MapView._render: World data not loaded yet.");
        return; // worldデータがなければ描画しない
    }
    const viewport = this._viewportManager.getViewport();
    const currentTime = this._viewModel.getCurrentTime();
    // プロジェクト設定をMapViewModelから取得
    const projectSettings = this._viewModel.getProjectSettings(); 
    if (!projectSettings) {
        console.warn("MapView._render: Project settings not available from MapViewModel.");
        // 必要であればここでフォールバック値を設定するか、エラー処理
        return; 
    }
    // SVGRenderer.renderにprojectSettingsを渡す
    this._renderer.render(world, viewport, currentTime, projectSettings);

    // 2. 一時的な描画要素 (RendererHelperに委譲)
    this._rendererHelper.clearAllTemporaryDrawings(); // 事前に既存の一時描画をクリア
    this._rendererHelper.renderSelection(); // 選択ハイライト
    this._rendererHelper.renderAddingFeaturePreview(); // 追加中のプレビュー
    this._rendererHelper.renderDragPreview(); // ドラッグ中のプレビュー
    this._rendererHelper.renderGenericTemporaryElements(); // 汎用一時要素
    this._rendererHelper.renderDistanceMeasurement(this._measurePoints, this._isMeasuringDistance); // 距離測定

    // 3. UI更新
    this._updateActionButtonsVisibility(); // アクションボタンの表示/非表示
  }

  _renderDragOverlay() {
    this._rendererHelper.renderDragPreview();
  }

  _renderOverlayFull() {
    this._rendererHelper.clearAllTemporaryDrawings();
    this._rendererHelper.renderSelection();
    this._rendererHelper.renderAddingFeaturePreview();
    this._rendererHelper.renderDragPreview();
    this._rendererHelper.renderGenericTemporaryElements();
    this._rendererHelper.renderDistanceMeasurement(this._measurePoints, this._isMeasuringDistance);
  }

  /**
   * リサイズのハンドラ
   * @private
   */
   _handleResize() {
    // MapViewのコンテナ(_container)のサイズを取得
    const rect = this._container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    // 有効なサイズの場合のみ更新
    if (width > 0 && height > 0) {
        this._renderer.resize(width, height); // レンダラーにサイズ変更を通知
        this._viewportManager.resize(width, height); // ビューポートマネージャーにサイズ変更を通知
        // resize -> _onViewportChanged -> _requestRender の流れで再描画されるため、ここでの _render() 呼び出しは不要
    } else {
        console.warn("MapView: Invalid container dimensions on resize.", { width, height });
    }
  }

  // --- Public Methods (ToolbarViewなどから呼び出される) ---

  /** グリッド表示の切り替え */
  toggleGrid(show) {
    this._renderer.toggleGrid(show); // レンダラーに通知
    this._requestRender(); // 再描画をトリガー
  }

  /** 距離測定モードを設定 */
  setMeasuringDistance(enabled) {
    if (this._isMeasuringDistance !== enabled) {
        this.hideContextMenu();
        this._isMeasuringDistance = enabled;
        if (enabled) {
            // 測定開始時に編集モードなどを解除
            this._editingViewModel.setMode('view');
            this._viewModel.clearSelection();
        }
        // カーソル形状を更新
        this._mapOverlay.style.cursor = enabled ? 'crosshair' : 'default';
        this._requestRender(); // 描画更新
    }
  }

  /** 距離測定モードかどうかを取得 */
  isMeasuringDistance() {
    return this._isMeasuringDistance;
  }

  /** 測定結果をクリア */
  clearMeasurements() {
    this._measurePoints = []; // 測定点をクリア
    this._rendererHelper.clearMeasureElements(); // 描画ヘルパー経由で関連描画をクリア
    // this._render(); // 描画更新は不要な場合もあるが、念のため呼ぶ
  }

  showContextMenu(screenX, screenY) {
    const items = this._buildContextMenuItems();
    this._contextMenu.show(screenX, screenY, items);
  }

  hideContextMenu() {
    this._contextMenu.hide();
  }

  _buildContextMenuItems() {
    const items = [];
    const selectedVertexIds = Array.from(this._viewModel.getSelectedVertexIds());
    const vertexOwnerIds = this._viewModel.getVertexSelectionOwnerIds();
    const contextFeature = this._viewModel.getSelectionContextFeature();
    const currentTime = this._viewModel.getCurrentTime();

    if (selectedVertexIds.length > 0) {
      items.push({
        label: '頂点を削除',
        danger: true,
        action: async () => {
          if (!window.confirm('選択した頂点を削除しますか？')) {
            return;
          }
          try {
            await this._editingViewModel.deleteVertices(selectedVertexIds, {
              editTime: currentTime
            });
          } catch (error) {
            console.error('頂点の削除に失敗しました (ContextMenu)', error);
            alert(`頂点の削除に失敗しました: ${error.message}`);
          }
        }
      });
    }

    if (selectedVertexIds.length === 1 && vertexOwnerIds.size > 1) {
      const targetVertexId = selectedVertexIds[0];
      const ownerIdList = Array.from(vertexOwnerIds)
        .filter(ownerId => ownerId !== null && ownerId !== undefined)
        .sort();

      ownerIdList.forEach(ownerId => {
        const ownerFeature = this._viewModel.getWorld()?.features.find(f => f.id === ownerId);
        const ownerProperty = ownerFeature && typeof ownerFeature.getPropertyAt === 'function'
          ? ownerFeature.getPropertyAt(currentTime)
          : null;
        const ownerName = ownerProperty?.name || ownerFeature?.id || ownerId;

        items.push({
          label: `共有解除: ${ownerName}`,
          action: async () => {
            if (!window.confirm(`地物「${ownerName}」の共有頂点を解除しますか？`)) {
              return;
            }
            try {
              await this._editingViewModel.unlinkSharedVertex(targetVertexId, ownerId);
            } catch (error) {
              console.error('共有解除に失敗しました (ContextMenu)', error);
              alert(`共有解除に失敗しました: ${error.message}`);
            }
          }
        });
      });
    }

    if (contextFeature) {
      const property = typeof contextFeature.getPropertyAt === 'function'
        ? contextFeature.getPropertyAt(currentTime)
        : null;
      const featureName = property && property.name ? property.name : contextFeature.id;

      if (items.length > 0 && items[items.length - 1].type !== 'separator') {
        items.push({ type: 'separator' });
      }

      items.push({
        label: 'プロパティを編集',
        action: () => {
          this._eventBus.publish('OpenSidebarTab', { tabId: 'properties' });
        }
      });

      items.push({
        label: '地物を削除',
        danger: true,
        action: async () => {
          if (!window.confirm(`地物「${featureName}」を削除しますか？`)) {
            return;
          }
          try {
            await this._editingViewModel.deleteFeature(contextFeature.id, contextFeature);
          } catch (error) {
            console.error('地物の削除に失敗しました (ContextMenu)', error);
            alert(`地物の削除に失敗しました: ${error.message}`);
          }
        }
      });
    }

    if (contextFeature || selectedVertexIds.length > 0) {
      if (items.length > 0 && items[items.length - 1].type !== 'separator') {
        items.push({ type: 'separator' });
      }
      items.push({
        label: '選択を解除',
        action: () => {
          this._viewModel.clearSelection();
        }
      });
    }

    return items.filter((item, index, array) =>
      !(item.type === 'separator' && (index === 0 || array[index - 1].type === 'separator'))
    );
  }

  /** 強制的に再描画 */
  refresh() {
    this._requestRender();
  }

  // --- Private Helper Methods (主にEventHandlerから呼ばれる、または内部で使用) ---

  /** アクションボタンを作成 */
  _createActionButtons() {
      this._actionButtonsContainer.innerHTML = ''; // 既存ボタンをクリア
      const confirmButton = document.createElement('button');
      confirmButton.textContent = '確定 (Enter)';
      confirmButton.style.marginRight = '10px';
      confirmButton.dataset.action = 'confirm';
      confirmButton.onclick = this._handleConfirmClick.bind(this); // 確定処理をバインド

      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'キャンセル (Esc)';
      cancelButton.dataset.action = 'cancel';
      cancelButton.onclick = this._handleCancelClick.bind(this); // キャンセル処理をバインド

      this._actionButtonsContainer.appendChild(confirmButton);
      this._actionButtonsContainer.appendChild(cancelButton);
      this._confirmButton = confirmButton;
      this._cancelButton = cancelButton;
  }

  /** アクションボタンの表示/非表示を更新 */
  _updateActionButtonsVisibility() {
      const mode = this._editingViewModel.getMode();
      const points = this._editingViewModel.getAddingPoints();
      const tool = this._editingViewModel.getTool();
      const subMode = this._editingViewModel.getAddingSubMode();
      let show = false;
      let confirmEnabled = true;

      // 地物追加モードの場合
      if (mode === 'add' && tool) {
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3;
          if (points.length >= minPoints) {
              show = true;
          }
      }
      // 穴/飛び地追加モードの場合 (サブモード決定後)
      else if (mode === 'edit' && tool === 'add-hole' && subMode) {
          if (points.length >= 3) { // 穴/飛び地は最低3点必要
              show = true;
          }
      }
      else if (mode === 'edit' && tool === 'split') {
          if (points.length > 0) {
              show = true;
          }
          confirmEnabled = this._canConfirmSplit();
      }

      // コンテナの表示スタイルを更新
      this._actionButtonsContainer.style.display = show ? 'block' : 'none';
      if (this._confirmButton) {
        this._confirmButton.disabled = !show || !confirmEnabled;
      }

      const isSplitToolActive = mode === 'edit' && tool === 'split';
      if (this._splitGuideElement) {
        this._splitGuideElement.style.display = isSplitToolActive ? 'block' : 'none';
        this._splitGuideElement.style.bottom = show ? '70px' : '20px';
      }
  }

  /** 確定ボタンクリック処理 */
  _handleConfirmClick() {
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const points = this._editingViewModel.getAddingPoints();
      const subMode = this._editingViewModel.getAddingSubMode();

      if (mode === 'add' && tool) { // 地物追加モード
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3;
          if (points.length >= minPoints) {
              this._showPropertyInputDialog(); // プロパティ入力へ
          } else {
              alert(`${tool === 'point' ? '点' : tool === 'line' ? '線' : '面'}を作成するには、頂点が足りません。`);
          }
      } else if (mode === 'edit' && tool === 'add-hole') { // 穴/飛び地追加モード
           if (points.length >= 3) {
               if (subMode === 'hole') {
                   this._editingViewModel.confirmAddHole(); // ViewModelに穴追加確定を依頼
               } else if (subMode === 'enclave') {
                   this._editingViewModel.confirmAddEnclave(); // ViewModelに飛び地追加確定を依頼
               }
           } else {
               alert('穴または飛び地を作成するには、少なくとも3つの頂点が必要です。');
           }
      } else if (mode === 'edit' && tool === 'split') {
          try {
              const splitPlan = this._buildSplitPlan();
              this._editingViewModel.setSplitPlan(splitPlan);
              this._showSplitInheritanceDialog(splitPlan);
          } catch (error) {
              alert(error.message);
          }
      }
      // 他のモード/ツールでは確定ボタンは表示されないはず
  }

  /** キャンセルボタンクリック処理 */
  _handleCancelClick() {
      const tool = this._editingViewModel.getTool();
      const points = this._editingViewModel.getAddingPoints();
      if (tool === 'split' && points.length > 0) {
          if (!window.confirm('分割をキャンセルしますか？')) {
              return;
          }
      }
      // ViewModelの状態クリアを依頼
      this._editingViewModel._clearAddingState();

      // もしプロパティ入力ダイアログが表示されていれば削除
      const existingDialog = this._mapElement.querySelector('.property-input-dialog');
      if (existingDialog) {
          existingDialog.remove();
      }

      // 穴追加ツールだった場合は選択ツールに戻す
      if (tool === 'add-hole' || tool === 'split') {
          this._editingViewModel.setTool('select');
      }

      // this._render(); // ViewModelの変更通知経由で再描画されるはず
  }

  _canConfirmSplit() {
      if (this._editingViewModel.getMode() !== 'edit' || this._editingViewModel.getTool() !== 'split') {
          return false;
      }
      const points = this._editingViewModel.getAddingPoints();
      if (!Array.isArray(points) || points.length < 2) {
          return false;
      }
      try {
          this._buildSplitPlan();
          return true;
      } catch (error) {
          return false;
      }
  }

  _buildSplitPlan() {
      const targetPolygon = this._editingViewModel.getTargetPolygon();
      if (!targetPolygon) {
          throw new Error('分割対象の面情報を選択してください。');
      }
      if (!(targetPolygon instanceof DomainPolygon)) {
          throw new Error('分割対象が面情報ではありません。');
      }
      const currentTime = typeof this._viewModel.getCurrentTime === 'function'
        ? this._viewModel.getCurrentTime()
        : null;
      const placementAtCurrentTime = typeof targetPolygon.getPlacementAt === 'function'
        ? targetPolygon.getPlacementAt(currentTime)
        : {
          childIds: targetPolygon.childIds
        };
      if (placementAtCurrentTime.childIds && placementAtCurrentTime.childIds.length > 0) {
          throw new Error('下位領域を持つ面情報は分割できません。');
      }
      const ringsAtCurrentTime = typeof targetPolygon.getRingsAt === 'function'
        ? targetPolygon.getRingsAt(currentTime)
        : targetPolygon.rings;
      if (!Array.isArray(ringsAtCurrentTime) || ringsAtCurrentTime.length === 0) {
          throw new Error('形状を持つ面情報のみ分割できます。');
      }
      const points = this._editingViewModel.getAddingPoints();
      if (!Array.isArray(points) || points.length < 2) {
          throw new Error('分断線は2点以上必要です。');
      }
      const world = this._viewModel.getWorld();
      if (!world || !world.vertices) {
          throw new Error('ワールドデータが読み込まれていません。');
      }
      const geometryService = this._viewModel._geometryService;
      if (!geometryService) {
          throw new Error('幾何計算サービスが初期化されていません。');
      }
      const verticesMap = new Map(world.vertices.map(v => [v.id, { x: v.x, y: v.y }]));
      const isClosed = typeof this._editingViewModel.getSplitLineMode === 'function'
        ? this._editingViewModel.getSplitLineMode() === 'circle'
        : false;
      return buildPolygonSplitPlan({
          rings: ringsAtCurrentTime,
          verticesMap,
          cutLinePoints: points,
          geometryService,
          toleranceSq: this._clickToleranceSq,
          isClosed
      });
  }

  _showSplitInheritanceDialog(splitPlan) {
      const geometryService = this._viewModel._geometryService;
      const polygons = Array.isArray(splitPlan?.polygons) ? splitPlan.polygons : [];
      if (polygons.length !== 2) {
        throw new Error('分割結果の情報が不足しています。');
      }

      const polygonA = {
        rings: polygons[0].rings.map(ring => ({
          ringType: ring.ringType,
          points: ring.points.map(point => ({ x: point.x, y: point.y }))
        }))
      };
      const polygonB = {
        rings: polygons[1].rings.map(ring => ({
          ringType: ring.ringType,
          points: ring.points.map(point => ({ x: point.x, y: point.y }))
        }))
      };

      const calculatePolygonArea = (polygon) => polygon.rings.reduce((total, ring) => {
        const ringArea = geometryService.calculatePolygonArea(ring.points);
        return total + (ring.ringType === 'territory' ? ringArea : -ringArea);
      }, 0);

      const areaA = calculatePolygonArea(polygonA);
      const areaB = calculatePolygonArea(polygonB);
      const smallerIndex = areaA <= areaB ? 0 : 1;

      this._conflictDialog.showSplitSelection(this._mapElement, {
        polygonA,
        polygonB,
        smallerIndex
      }).then(selectedIndex => {
          this._showPropertyInputDialog({
              onConfirm: (properties) => {
                  this._confirmSplitWithProperties(selectedIndex, properties);
              },
              onCancel: () => {
                  this._editingViewModel._clearAddingState();
              }
          });
      }).catch(() => {
          this._editingViewModel._clearAddingState();
      });
  }

  async _confirmSplitWithProperties(inheritSideIndex, properties) {
      try {
          const domainAnchor = this._createDomainProperty(properties);
          await this._editingViewModel.confirmSplit(
            inheritSideIndex,
            domainAnchor,
            this._viewModel.getCurrentTime()
          );
          console.log('分割が確定しました。');
      } catch (error) {
          console.error('分割確定に失敗:', error);
          alert(`エラー: ${error.message}`);
      }
  }

  /**
   * 穴追加ツールのターゲットと現在の地物選択を同期
   * @param {Feature|null} [activeFeatureOverride]
   * @private
   */
  _syncAddHoleToolTarget(activeFeatureOverride) {
      if (this._editingViewModel.getTool() !== 'add-hole') {
          return;
      }
      const candidate = arguments.length > 0 ? activeFeatureOverride : this._viewModel.getActiveFeature();
      if (candidate && candidate instanceof DomainPolygon) {
          const currentTarget = this._editingViewModel.getTargetPolygon();
          if (!currentTarget || currentTarget.id !== candidate.id) {
              this._editingViewModel.startAddingHoleOrEnclave(candidate);
          }
      } else {
          this._editingViewModel.cancelHoleOrEnclavePreparation();
      }
  }

  /**
   * 分割ツールのターゲットと現在の地物選択を同期
   * @param {Feature|null} [activeFeatureOverride]
   * @private
   */
  _syncSplitToolTarget(activeFeatureOverride) {
      if (this._editingViewModel.getTool() !== 'split') {
          return;
      }
      const candidate = arguments.length > 0 ? activeFeatureOverride : this._viewModel.getActiveFeature();
      if (candidate && candidate instanceof DomainPolygon) {
          const currentTarget = this._editingViewModel.getTargetPolygon();
          if (!currentTarget || currentTarget.id !== candidate.id) {
              this._editingViewModel.startSplit(candidate);
          }
      } else {
          this._editingViewModel.cancelSplitPreparation();
      }
  }

  /** 測定点を追加 (EventHandlerから呼ばれる) */
  _handleAddMeasurePoint(worldPoint) {
      if (!this._isMeasuringDistance) return; // 測定モードでなければ何もしない
      this._measurePoints.push(worldPoint);
      this._requestRender(); // 測定点を追加して再描画
  }

  /** プロパティ入力ダイアログ表示 */
  _showPropertyInputDialog(options = {}) {
    // 既存ダイアログがあれば削除
    const existingDialog = this._mapElement.querySelector('.property-input-dialog');
    if (existingDialog) {
        existingDialog.remove();
    }

    // ダイアログ要素を作成
    const dialog = document.createElement('div');
    dialog.className = 'property-input-dialog';
    // スタイル設定 (中央表示、前面表示など)
    dialog.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 30;
        background: white;
        padding: 20px;
        border: 1px solid #ccc;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        min-width: 300px;
        max-width: 90%;
    `;

    // フォーム要素を作成
    const form = document.createElement('form');
    // Enterキーでの送信を防ぎ、確定ボタンに処理を委譲
    form.onsubmit = (e) => { e.preventDefault(); confirmButton.click(); };

    // 名前入力フィールド
    const nameRow = document.createElement('div');
    nameRow.style.marginBottom='10px';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = '名前: ';
    nameLabel.style.display='block';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.name = 'name';
    nameInput.required = true; // 名前は必須とする
    nameInput.style.width='100%';
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);
    form.appendChild(nameRow);

    // 説明入力フィールド
    const descRow = document.createElement('div');
    descRow.style.marginBottom='10px';
    const descLabel = document.createElement('label');
    descLabel.textContent = '説明: ';
    descLabel.style.display='block';
    const descInput = document.createElement('textarea');
    descInput.name = 'description';
    descInput.style.width='100%';
    descInput.rows = 3;
    descRow.appendChild(descLabel);
    descRow.appendChild(descInput);
    form.appendChild(descRow);

    const defaultTimeRange = typeof this._viewModel.getDefaultPropertyTimeRange === 'function'
      ? this._viewModel.getDefaultPropertyTimeRange()
      : null;

    // 存在期間入力フィールド
    const timeRow = document.createElement('div');
    timeRow.style.marginBottom = '10px';
    const startLabel = document.createElement('span');
    startLabel.textContent = '開始: ';
    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.name = 'startYear';
    startInput.style.width = '70px';
    const endLabel = document.createElement('span');
    endLabel.textContent = ' 終了: ';
    const endInput = document.createElement('input');
    endInput.type = 'number';
    endInput.name = 'endYear';
    endInput.style.width = '70px';

    if (defaultTimeRange?.start) {
      startInput.value = `${defaultTimeRange.start.year}`;
    }
    if (defaultTimeRange?.end) {
      const inclusiveEndYear = defaultTimeRange.end.year - 1;
      if (Number.isFinite(inclusiveEndYear)) {
        endInput.value = `${inclusiveEndYear}`;
      }
    }
    timeRow.appendChild(startLabel);
    timeRow.appendChild(startInput);
    timeRow.appendChild(endLabel);
    timeRow.appendChild(endInput);
    form.appendChild(timeRow);

    // ボタン行
    const buttonRow = document.createElement('div');
    buttonRow.style.textAlign = 'right';
    buttonRow.style.marginTop='15px';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button'; // submitではなくbutton
    confirmButton.textContent = '確定';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button'; // submitではなくbutton
    cancelButton.textContent = 'キャンセル';
    cancelButton.dataset.action = 'cancel'; // キャンセルボタン識別用
    cancelButton.style.marginLeft = '10px';
    buttonRow.appendChild(confirmButton);
    buttonRow.appendChild(cancelButton);
    form.appendChild(buttonRow);

    dialog.appendChild(form);
    this._mapElement.appendChild(dialog); // Mapコンテナに追加
    nameInput.focus(); // 名前入力にフォーカス

    // 確定ボタンのクリック処理
    const { onConfirm, onCancel } = options;
    confirmButton.onclick = () => {
        const startYearStr = startInput.value;
        const endYearStr = endInput.value;
        const properties = {
            name: nameInput.value.trim() || '名称未設定', // 名前が空ならデフォルト値
            description: descInput.value.trim(),
            startYear: (startYearStr !== '') ? Number(startYearStr) : null,
            endYear: (endYearStr !== '') ? Number(endYearStr) : null
        };
        if (properties.startYear !== null && properties.endYear !== null && properties.endYear < properties.startYear) {
            alert('終了年は開始年より後に設定してください。');
            return;
        }

        const rangeForFallback = defaultTimeRange || (typeof this._viewModel.getDefaultPropertyTimeRange === 'function'
          ? this._viewModel.getDefaultPropertyTimeRange()
          : null);

        const currentLayerId = this._viewModel.getWorld()?.layers[0]?.id || 'layer-base';
        const payload = {
            ...properties,
            rangeFallback: rangeForFallback
        };
        if (typeof onConfirm === 'function') {
            onConfirm(payload, currentLayerId);
        } else {
            this._confirmAddFeatureWithProperties(payload, currentLayerId);
        }
        dialog.remove();
    };
    // キャンセルボタンのクリック処理
    cancelButton.onclick = () => {
        dialog.remove(); // ダイアログを閉じる
        if (typeof onCancel === 'function') {
            onCancel();
        } else {
            this._handleCancelClick(); // キャンセル処理を呼び出す
        }
    };
  }

  /** 入力プロパティで地物追加確定 */
  _createDomainProperty(properties) {
    const rangeForFallback = properties.rangeFallback || (typeof this._viewModel.getDefaultPropertyTimeRange === 'function'
      ? this._viewModel.getDefaultPropertyTimeRange()
      : null);
    const correctTimePoint = this._viewModel.getCurrentTime();
    const startTp = properties.startYear !== null
      ? new TimePoint(properties.startYear)
      : (rangeForFallback?.start || correctTimePoint);
    const endTp = properties.endYear !== null
      ? new TimePoint(properties.endYear + 1)
      : (rangeForFallback?.end || null);
    const propertyTimePoint = startTp || correctTimePoint;
    const { name, description } = properties;
    return new FeatureAnchor({
      id: 'anchor-draft',
      timeRange: {
        start: propertyTimePoint,
        end: endTp
      },
      property: {
        name,
        description,
        attributes: {}
      },
      shape: {},
      placement: {}
    });
  }

  async _confirmAddFeatureWithProperties(properties, layerId) {
    try {
        const domainAnchor = this._createDomainProperty(properties);
        // EditingViewModelに地物追加確定を依頼
        await this._editingViewModel.confirmAddFeature([domainAnchor], layerId);
        console.log('地物の追加が確定しました。');
    } catch (error) {
        console.error('地物の追加確定に失敗:', error);
        alert(`エラー: ${error.message}`);
    }
  }

}
