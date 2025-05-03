// src/presentation/views/MapView.js
import { Property } from '../../domain/value-objects/Property.js';
// import { Point as DomainPoint } from '../../domain/entities/Point.js'; // サブクラスへ移動
// import { Line as DomainLine } from '../../domain/entities/Line.js'; // サブクラスへ移動
// import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js'; // サブクラスへ移動
// import { Vertex } from '../../domain/entities/Vertex.js'; // サブクラスへ移動

// 分割したクラスをインポート
import { MapViewInteractionLogic } from './map/MapViewInteractionLogic.js';
import { MapViewRendererHelper } from './map/MapViewRendererHelper.js';
import { MapViewEventHandler } from './map/MapViewEventHandler.js';

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
    this._configManager = configManager;

    // DOM要素
    this._mapElement = null;
    this._mapOverlay = null;
    this._actionButtonsContainer = null;

    // 状態
    this._isMeasuringDistance = false;
    this._measurePoints = [];

    // サブクラスのインスタンス化
    this._interactionLogic = new MapViewInteractionLogic(
        viewModel, editingViewModel, viewModel._geometryService, // GeometryServiceはViewModelが持っている
        () => this._clickToleranceSq // クリック許容範囲を渡す関数
    );
    this._rendererHelper = new MapViewRendererHelper(
        renderer, viewModel, editingViewModel, viewportManager, configManager
    );
    // EventHandlerにはMapView自身の参照を渡す
    this._eventHandler = new MapViewEventHandler(
        this, null, viewModel, editingViewModel, viewportManager, renderer, this._interactionLogic
    );

    // クリック許容範囲
    this._clickTolerancePixels = 3;
    this._clickToleranceSq = 0;

    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    this._mapElement = document.createElement('div');
    this._mapElement.className = 'map-container';
    this._mapElement.style.cssText = 'width: 100%; height: 100%; position: relative; overflow: hidden; background-color: #f0f0f0;';
    this._container.appendChild(this._mapElement);

    this._mapOverlay = document.createElement('div');
    this._mapOverlay.className = 'map-overlay';
    this._mapOverlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: auto; cursor: default;';
    this._mapElement.appendChild(this._mapOverlay);
    this._eventHandler._mapOverlay = this._mapOverlay; // EventHandlerにOverlay要素を渡す

    this._actionButtonsContainer = document.createElement('div');
    this._actionButtonsContainer.className = 'action-buttons-container';
    this._actionButtonsContainer.style.cssText = 'position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 20; display: none; background-color: rgba(255, 255, 255, 0.8); padding: 5px 10px; border-radius: 5px;';
    this._mapElement.appendChild(this._actionButtonsContainer);
    this._createActionButtons();

    // クリック許容範囲初期化
    this._updateClickTolerance();

    // イベントリスナー設定 (EventHandlerに委譲)
    this._eventHandler.setupEventListeners();

    window.addEventListener('resize', this._handleResize.bind(this)); // MapViewのメソッドをバインド

    // ViewModel等の購読
    this._viewModel.addObserver(this._onViewModelChanged.bind(this));
    this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));
    this._viewportManager.addListener(this._onViewportChanged.bind(this));

    // 初期ズームと初回レンダリング
    requestAnimationFrame(() => {
        this._handleResize();
        this._render();
    });
  }

  /**
   * ビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onViewModelChanged(type, data) {
    // 描画が必要な変更の場合、_renderを呼ぶ
    switch (type) {
      case 'world':
      case 'features':
      case 'selectedFeature':
      case 'selectedVertices':
      case 'highlightedFeature':
      case 'hoveredFeature':
      case 'hoveredVertex':
      case 'layers':
        this._render();
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
     // 描画またはUI更新が必要な変更の場合
    switch (type) {
      case 'mode':
      case 'tool':
        this._updateActionButtonsVisibility(); // ボタン表示更新
        this._viewModel.clearSelection(); // モード変更時は選択解除
        if (this._editingViewModel.getDraggingVerticesInfo().size > 0) {
             this._editingViewModel._resetDraggingState(); // ドラッグ状態リセット
        }
        this._render(); // 再描画
        break;
      case 'addingPoints':
      case 'targetPolygon':
      case 'addingSubMode':
      case 'targetSubPolygonIndex':
      case 'temporaryElements': // 汎用一時要素
      case 'draggingVertices': // ドラッグ中
      case 'history':
      case 'addingState': // 一括変更
        this._updateActionButtonsVisibility(); // addingPoints変更でボタン表示が変わる可能性
        this._render(); // 再描画
        break;
    }
  }

  /**
   * ビューポート変更のハンドラ
   * @param {Object} viewport - ビューポート情報
   * @private
   */
  _onViewportChanged(viewport) {
    this._updateClickTolerance(); // クリック許容範囲を再計算
    this._render(); // 再描画
  }

  /** クリック許容範囲を更新 */
  _updateClickTolerance() {
    const viewport = this._viewportManager.getViewport();
    const worldDistance = this._clickTolerancePixels / viewport.zoom;
    this._clickToleranceSq = worldDistance * worldDistance;
  }

  /**
   * マップを描画 (RendererHelperに委譲)
   * @private
   */
  _render() {
    // 1. 通常の地物を描画
    const world = this._viewModel.getWorld();
    if (!world) return;
    const viewport = this._viewportManager.getViewport();
    const currentTime = this._viewModel.getCurrentTime();
    this._renderer.render(world, viewport, currentTime);

    // 2. 一時的な描画要素 (RendererHelperに委譲)
    this._rendererHelper.clearAllTemporaryDrawings(); // 事前にクリア
    this._rendererHelper.renderSelection();
    this._rendererHelper.renderAddingFeaturePreview();
    this._rendererHelper.renderDragPreview();
    this._rendererHelper.renderGenericTemporaryElements();
    this._rendererHelper.renderDistanceMeasurement(this._measurePoints, this._isMeasuringDistance);

    // 3. UI更新
    this._updateActionButtonsVisibility();
  }

  /**
   * リサイズのハンドラ
   * @private
   */
   _handleResize() {
    const rect = this._container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    // Check if dimensions are valid before updating
    if (width > 0 && height > 0) {
        this._renderer.resize(width, height);
        this._viewportManager.resize(width, height);
        // this._render(); // resize が viewportManager 経由で _onViewportChanged -> _render をトリガーするはず
    } else {
        console.warn("MapView: Invalid container dimensions on resize.", { width, height });
    }
  }

  // --- Public Methods (ToolbarViewなどから呼び出される) ---

  /** グリッド表示の切り替え */
  toggleGrid(show) {
    this._renderer.toggleGrid(show);
    this._render(); // 再描画をトリガー
  }

  /** 距離測定モードを設定 */
  setMeasuringDistance(enabled) {
    if (this._isMeasuringDistance !== enabled) {
        this._isMeasuringDistance = enabled;
        if (!enabled) {
            this.clearMeasurements();
        } else {
            // 測定開始時に編集モードなどを解除
            this._editingViewModel.setMode('view');
            this._viewModel.clearSelection();
        }
        this._mapOverlay.style.cursor = enabled ? 'crosshair' : 'default';
        this._render(); // 描画更新
    }
  }

  /** 距離測定モードかどうかを取得 */
  isMeasuringDistance() {
    return this._isMeasuringDistance;
  }

  /** 測定結果をクリア */
  clearMeasurements() {
    this._measurePoints = [];
    this._rendererHelper.clearMeasureElements(); // RendererHelper経由でクリア
    this._render(); // 再描画
  }

  // --- Private Helper Methods (主にEventHandlerから呼ばれる) ---

  /** アクションボタンを作成 */
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

  /** アクションボタンの表示/非表示を更新 */
  _updateActionButtonsVisibility() {
      const mode = this._editingViewModel.getMode();
      const points = this._editingViewModel.getAddingPoints();
      const tool = this._editingViewModel.getTool();
      const subMode = this._editingViewModel.getAddingSubMode();
      let show = false;
      if (mode === 'add' && tool) {
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3;
          if (points.length >= minPoints) show = true;
      } else if (mode === 'edit' && tool === 'add-hole' && subMode) {
          if (points.length >= 3) show = true;
      }
      this._actionButtonsContainer.style.display = show ? 'block' : 'none';
  }

  /** 確定ボタンクリック処理 */
  _handleConfirmClick() {
      const mode = this._editingViewModel.getMode();
      const tool = this._editingViewModel.getTool();
      const points = this._editingViewModel.getAddingPoints();
      const subMode = this._editingViewModel.getAddingSubMode();
      if (mode === 'add' && tool) {
          const minPoints = (tool === 'point') ? 1 : (tool === 'line') ? 2 : 3;
          if (points.length >= minPoints) this._showPropertyInputDialog();
          else alert(`${tool === 'point' ? '点' : tool === 'line' ? '線' : '面'}を作成するには、頂点が足りません。`);
      } else if (mode === 'edit' && tool === 'add-hole') {
           if (points.length >= 3) {
               if (subMode === 'hole') this._editingViewModel.confirmAddHole();
               else if (subMode === 'enclave') this._editingViewModel.confirmAddEnclave();
           } else alert('穴または飛び地を作成するには、少なくとも3つの頂点が必要です。');
      }
  }

  /** キャンセルボタンクリック処理 */
  _handleCancelClick() {
      this._editingViewModel._clearAddingState(); // ViewModelの状態クリアを依頼
      const existingDialog = this._mapElement.querySelector('.property-input-dialog');
      if (existingDialog) existingDialog.remove();
      if (this._editingViewModel.getTool() === 'add-hole') {
          this._editingViewModel.setTool('select'); // ツールも戻す
      }
      this._render(); // 表示を更新
  }

  /** 測定点を追加 */
  _handleAddMeasurePoint(worldPoint) {
      this._measurePoints.push(worldPoint);
      this._render();
  }

  /** プロパティ入力ダイアログ表示 */
  _showPropertyInputDialog() {
    // 元のMapViewにあった実装をほぼそのまま流用 (getCategoriesForFeatureTypeも必要)
    const existingDialog = this._mapElement.querySelector('.property-input-dialog');
    if (existingDialog) existingDialog.remove();
    const dialog = document.createElement('div');
    dialog.className = 'property-input-dialog';
    dialog.style.cssText = `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 30; background: white; padding: 20px; border: 1px solid #ccc; box-shadow: 0 2px 10px rgba(0,0,0,0.1); min-width: 300px;`;
    const form = document.createElement('form');
    form.onsubmit = (e) => { e.preventDefault(); confirmButton.click(); };

    const nameRow = document.createElement('div'); nameRow.style.marginBottom='10px';
    const nameLabel = document.createElement('label'); nameLabel.textContent = '名前: '; nameLabel.style.display='block';
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.name = 'name'; nameInput.required = true; nameInput.style.width='100%';
    nameRow.appendChild(nameLabel); nameRow.appendChild(nameInput);
    form.appendChild(nameRow);

    const descRow = document.createElement('div'); descRow.style.marginBottom='10px';
    const descLabel = document.createElement('label'); descLabel.textContent = '説明: '; descLabel.style.display='block';
    const descInput = document.createElement('textarea'); descInput.name = 'description'; descInput.style.width='100%'; descInput.rows = 3;
    descRow.appendChild(descLabel); descRow.appendChild(descInput);
    form.appendChild(descRow);

    const categoryRow = document.createElement('div'); categoryRow.style.marginBottom='10px';
    const categoryLabel = document.createElement('label'); categoryLabel.textContent = 'カテゴリ: '; categoryLabel.style.display='block';
    const categorySelect = document.createElement('select'); categorySelect.name = 'category'; categorySelect.style.width='100%';
    const currentTool = this._editingViewModel.getTool();
    const categories = this._getCategoriesForFeatureType(currentTool);
    categories.forEach(cat => {
        const option = document.createElement('option'); option.value = cat.id; option.textContent = cat.name;
        categorySelect.appendChild(option);
    });
    categoryRow.appendChild(categoryLabel); categoryRow.appendChild(categorySelect);
    form.appendChild(categoryRow);

    const buttonRow = document.createElement('div'); buttonRow.style.textAlign = 'right'; buttonRow.style.marginTop='15px';
    const confirmButton = document.createElement('button'); confirmButton.type = 'button'; confirmButton.textContent = '確定';
    const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.textContent = 'キャンセル'; cancelButton.dataset.action = 'cancel'; cancelButton.style.marginLeft = '10px';
    buttonRow.appendChild(confirmButton); buttonRow.appendChild(cancelButton);
    form.appendChild(buttonRow);

    dialog.appendChild(form);
    this._mapElement.appendChild(dialog);
    nameInput.focus();

    confirmButton.onclick = () => {
        const properties = { name: nameInput.value.trim() || '名称未設定', description: descInput.value.trim(), category: categorySelect.value || 'default' };
        const currentLayerId = this._viewModel.getWorld()?.layers[0]?.id || 'layer-base';
        this._confirmAddFeatureWithProperties(properties, currentLayerId);
        dialog.remove();
    };
    cancelButton.onclick = () => {
        dialog.remove();
        this._handleCancelClick();
    };
  }

  /** 入力プロパティで地物追加確定 */
  async _confirmAddFeatureWithProperties(properties, layerId) {
    // 元のMapViewにあった実装を流用
    try {
        const correctTimePoint = this._viewModel.getCurrentTime();
        const domainProperty = new Property(correctTimePoint, properties.name, properties.description, { category: properties.category }, null, null);
        await this._editingViewModel.confirmAddFeature([domainProperty], layerId);
        console.log('地物の追加が確定しました。');
    } catch (error) {
        console.error('地物の追加確定に失敗:', error);
        alert(`エラー: ${error.message}`);
    }
  }

  /** カテゴリ取得ヘルパー */
  _getCategoriesForFeatureType(featureType) {
      // 元のMapViewにあった実装を流用
      const baseCategories = [{ id: 'default', name: 'デフォルト' }];
      switch (featureType) {
          case 'point': return [...baseCategories, { id: 'city', name: '都市' }, { id: 'town', name: '町村' }, { id: 'battle', name: '戦闘' }, { id: 'ruin', name: '遺跡' }];
          case 'line': return [...baseCategories, { id: 'road', name: '道路' }, { id: 'railway', name: '鉄道' }, { id: 'river', name: '河川' }, { id: 'trade_route', name: '交易路' }, { id: 'border', name: '国境' }];
          case 'polygon': return [...baseCategories, { id: 'kingdom', name: '王国' }, { id: 'empire', name: '帝国' }, { id: 'province', name: '地方' }, { id: 'ocean', name: '海洋' }, { id: 'lake', name: '湖沼' }];
          default: return baseCategories;
      }
  }
}