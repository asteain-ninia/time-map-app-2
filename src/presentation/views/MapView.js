// src/presentation/views/MapView.js
import { Property } from '../../domain/value-objects/Property.js';
import { TimePoint } from '../../domain/value-objects/TimePoint.js';
// ドメインエンティティの直接インポートは不要 (ViewModel経由で扱うため)
// import { Point as DomainPoint } from '../../domain/entities/Point.js';
// import { Line as DomainLine } from '../../domain/entities/Line.js';
// import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
// import { Vertex } from '../../domain/entities/Vertex.js';

// 分割したクラスをインポート
import { MapViewInteractionLogic } from './map/MapViewInteractionLogic.js';
import { MapViewRendererHelper } from './map/MapViewRendererHelper.js';
import { MapViewEventHandler } from './map/MapViewEventHandler.js';
import { MapContextMenu } from './map/MapContextMenu.js';

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
    this._resizeObserver = null;

    // 状態
    this._isMeasuringDistance = false;
    this._measurePoints = []; // ワールド座標の配列

    // クリック許容範囲 (ピクセル単位)
    this._clickTolerancePixels = 3;
    this._clickToleranceSq = 0; // ワールド座標での二乗値 (動的に更新)

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
        this._render();       // 初回描画
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
      case 'world': // worldデータ全体が変更された場合
      case 'features': // 表示地物リストが変更された場合
      case 'activeFeature': // アクティブ地物が変更された場合
      case 'selectedVertices': // 選択頂点が変更された場合
      case 'vertexContextFeature': // 頂点選択コンテキストが変更された場合
      case 'hoveredFeature': // ホバー地物が変更された場合
      case 'hoveredVertex': // ホバー頂点が変更された場合
      case 'layers': // レイヤー情報が変更された場合
      case 'projectSettingsChanged': // プロジェクト設定が変更された場合も再描画
        this._render(); // 再描画をトリガー
        break;
      // 他のタイプのイベントはここでは処理しない
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
        this._render(); // 再描画
        break;
      case 'addingPoints': // 追加中の点変更
      case 'targetPolygon': // 穴/飛び地追加対象ポリゴン変更
      case 'addingSubMode': // 穴/飛び地追加サブモード変更
      case 'targetRingIdForHole': // 穴追加対象リングID変更
      case 'temporaryElements': // 汎用一時要素変更
      case 'draggingVertices': // ドラッグ中頂点情報変更
      case 'history': // アンドゥ/リドゥ状態変更
      case 'addingState': // 追加関連状態一括変更
        this._updateActionButtonsVisibility(); // ボタン表示更新
        this._render(); // 再描画
        break;
      // 他のタイプのイベントはここでは処理しない
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
    // ズームレベルに基づいてワールド座標での許容距離（の二乗）を計算
    const worldDistance = this._clickTolerancePixels / viewport.zoom;
    this._clickToleranceSq = worldDistance * worldDistance;
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
        // resize -> _onViewportChanged -> _render の流れで再描画されるため、ここでの _render() 呼び出しは不要
    } else {
        console.warn("MapView: Invalid container dimensions on resize.", { width, height });
    }
  }

  // --- Public Methods (ToolbarViewなどから呼び出される) ---

  /** グリッド表示の切り替え */
  toggleGrid(show) {
    this._renderer.toggleGrid(show); // レンダラーに通知
    this._render(); // 再描画をトリガー
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
        this._render(); // 描画更新
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
            await this._editingViewModel.deleteVertices(selectedVertexIds);
          } catch (error) {
            console.error('頂点の削除に失敗しました (ContextMenu)', error);
            alert(`頂点の削除に失敗しました: ${error.message}`);
          }
        }
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
    this._render();
  }

  // --- Private Helper Methods (主にEventHandlerから呼ばれる、または内部で使用) ---

  /** アクションボタンを作成 */
  _createActionButtons() {
      this._actionButtonsContainer.innerHTML = ''; // 既存ボタンをクリア
      const confirmButton = document.createElement('button');
      confirmButton.textContent = '確定 (Enter)';
      confirmButton.style.marginRight = '10px';
      confirmButton.onclick = this._handleConfirmClick.bind(this); // 確定処理をバインド

      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'キャンセル (Esc)';
      cancelButton.onclick = this._handleCancelClick.bind(this); // キャンセル処理をバインド

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

      // コンテナの表示スタイルを更新
      this._actionButtonsContainer.style.display = show ? 'block' : 'none';
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
      }
      // 他のモード/ツールでは確定ボタンは表示されないはず
  }

  /** キャンセルボタンクリック処理 */
  _handleCancelClick() {
      // ViewModelの状態クリアを依頼
      this._editingViewModel._clearAddingState();

      // もしプロパティ入力ダイアログが表示されていれば削除
      const existingDialog = this._mapElement.querySelector('.property-input-dialog');
      if (existingDialog) {
          existingDialog.remove();
      }

      // 穴追加ツールだった場合は選択ツールに戻す
      if (this._editingViewModel.getTool() === 'add-hole') {
          this._editingViewModel.setTool('select');
      }

      // this._render(); // ViewModelの変更通知経由で再描画されるはず
  }

  /** 測定点を追加 (EventHandlerから呼ばれる) */
  _handleAddMeasurePoint(worldPoint) {
      if (!this._isMeasuringDistance) return; // 測定モードでなければ何もしない
      this._measurePoints.push(worldPoint);
      this._render(); // 測定点を追加して再描画
  }

  /** プロパティ入力ダイアログ表示 */
  _showPropertyInputDialog() {
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

    // カテゴリ選択フィールド
    const categoryRow = document.createElement('div');
    categoryRow.style.marginBottom='10px';
    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = 'カテゴリ: ';
    categoryLabel.style.display='block';
    const categorySelect = document.createElement('select');
    categorySelect.name = 'category';
    categorySelect.style.width='100%';
    const currentTool = this._editingViewModel.getTool();
    const categories = this._getCategoriesForFeatureType(currentTool); // 現在のツールに応じたカテゴリを取得
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id; // カテゴリIDを値に設定
        option.textContent = cat.name; // カテゴリ名を表示
        categorySelect.appendChild(option);
    });
    categoryRow.appendChild(categoryLabel);
    categoryRow.appendChild(categorySelect);
    form.appendChild(categoryRow);

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
    confirmButton.onclick = () => {
        const startYearStr = startInput.value;
        const endYearStr = endInput.value;
        const properties = {
            name: nameInput.value.trim() || '名称未設定', // 名前が空ならデフォルト値
            description: descInput.value.trim(),
            category: categorySelect.value || 'default', // カテゴリが空ならデフォルト値
            startYear: (startYearStr !== '') ? Number(startYearStr) : null,
            endYear: (endYearStr !== '') ? Number(endYearStr) : null
        };
        if (properties.startYear !== null && properties.endYear !== null && properties.endYear < properties.startYear) {
            alert('終了年は開始年より後に設定してください。');
            return;
        }
        // 現在のレイヤーIDを取得 (なければデフォルト)
        const currentLayerId = this._viewModel.getWorld()?.layers[0]?.id || 'layer-base';
        // 実際の地物追加処理を呼び出す
        this._confirmAddFeatureWithProperties(properties, currentLayerId);
        dialog.remove(); // ダイアログを閉じる
    };
    // キャンセルボタンのクリック処理
    cancelButton.onclick = () => {
        dialog.remove(); // ダイアログを閉じる
        this._handleCancelClick(); // キャンセル処理を呼び出す
    };
  }

  /** 入力プロパティで地物追加確定 */
  async _confirmAddFeatureWithProperties(properties, layerId) {
    try {
        // ViewModelから現在の時間点を取得
        const correctTimePoint = this._viewModel.getCurrentTime();
        const startTp = properties.startYear !== null ? new TimePoint(properties.startYear) : null;
        const endTp = properties.endYear !== null ? new TimePoint(properties.endYear) : null;
        const propertyTimePoint = startTp || correctTimePoint;
        const domainProperty = new Property(
            propertyTimePoint,
            properties.name,
            properties.description,
            { category: properties.category },
            startTp,
            endTp
        );
        // EditingViewModelに地物追加確定を依頼
        await this._editingViewModel.confirmAddFeature([domainProperty], layerId);
        console.log('地物の追加が確定しました。');
    } catch (error) {
        console.error('地物の追加確定に失敗:', error);
        alert(`エラー: ${error.message}`);
    }
  }

  /** カテゴリ取得ヘルパー */
  _getCategoriesForFeatureType(featureType) {
      // デフォルトカテゴリは選択肢に含めない方がUXが良い場合もある
      const baseCategories = [
        // { id: '', name: '-- カテゴリ選択 --' }, // 選択肢としての空項目
        { id: 'default', name: 'デフォルト' }
      ];
      switch (featureType) {
          case 'point': return [...baseCategories, { id: 'city', name: '都市' }, { id: 'town', name: '町村' }, { id: 'battle', name: '戦闘' }, { id: 'ruin', name: '遺跡' }];
          case 'line': return [...baseCategories, { id: 'road', name: '道路' }, { id: 'railway', name: '鉄道' }, { id: 'river', name: '河川' }, { id: 'trade_route', name: '交易路' }, { id: 'border', name: '国境' }];
          case 'polygon': return [...baseCategories, { id: 'kingdom', name: '王国' }, { id: 'empire', name: '帝国' }, { id: 'province', name: '地方' }, { id: 'ocean', name: '海洋' }, { id: 'lake', name: '湖沼' }];
          default: return baseCategories;
      }
  }
}
