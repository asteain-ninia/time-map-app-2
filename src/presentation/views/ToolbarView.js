/**
 * ツールバー表示
 */
export class ToolbarView {
  /**
   * ツールバービューを作成
   * @param {HTMLElement} container - 表示コンテナ
   * @param {EditingViewModel} editingViewModel - 編集ビューモデル
   * @param {MapView} mapView - マップビュー
   */
  constructor(container, editingViewModel, mapView) {
    this._container = container;
    this._editingViewModel = editingViewModel;
    this._mapView = mapView; // MapView への参照を保持

    // DOM要素
    this._toolbarElement = null;
    this._modeButtons = {};
    this._toolButtons = {};
    this._gridButton = null; // グリッドボタンの参照を保持
    this._measureButton = null; // 測定ボタンの参照を保持

    // グリッド表示状態 (MapViewと同期する必要があるかも)
    this._isGridVisible = true; // 初期状態は表示

    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // ツールバーコンテナ作成
    this._toolbarElement = document.createElement('div');
    this._toolbarElement.className = 'toolbar-container';
    this._toolbarElement.style.width = '100%';
    this._toolbarElement.style.backgroundColor = '#f0f0f0';
    this._toolbarElement.style.borderBottom = '1px solid #ddd';
    this._toolbarElement.style.padding = '5px';
    this._toolbarElement.style.display = 'flex'; // Flexboxを使用
    this._toolbarElement.style.flexWrap = 'wrap'; // 折り返し可能に
    this._toolbarElement.style.alignItems = 'center'; // 垂直方向中央揃え


    // ツールバーの要素を作成
    this._createToolbarElements();

    // ツールバーコンテナに追加
    this._container.appendChild(this._toolbarElement);

    // 編集ビューモデルとの連携
    this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));
     // MapView からのイベントも受け取る必要があるかもしれない (測定モードなど)
     // mapView.addObserver のような仕組みがあれば利用

    // 初期状態を反映
    this._updateToolbarDisplay();
     this._updateGridButtonState(); // グリッドボタンの初期状態
     this._updateMeasureButtonState(); // 測定ボタンの初期状態
  }

  /**
   * ツールバー要素の作成
   * @private
   */
  _createToolbarElements() {
     const createSection = () => {
        const section = document.createElement('div');
        section.className = 'toolbar-section';
        section.style.display = 'inline-flex'; // inline-flex に変更
        section.style.alignItems = 'center'; // 中央揃え
        section.style.marginRight = '15px'; // セクション間のマージン
        section.style.marginBottom = '5px'; // 折り返し時の縦マージン
        return section;
    };

    const createLabel = (text) => {
        const label = document.createElement('span');
        label.textContent = text;
        label.style.marginRight = '5px';
        label.style.fontWeight = 'bold';
        return label;
    };

    const createButton = (config, clickHandler) => {
        const button = document.createElement('button');
        button.textContent = `${config.icon || ''} ${config.label}`;
        button.title = config.label; // ツールチップ
        button.style.marginRight = '5px';
        button.addEventListener('click', clickHandler);
        return button;
    };

    // --- モードセクション ---
    const modeSection = createSection();
    modeSection.appendChild(createLabel('モード:'));

    const modes = [
      { id: 'view', label: '表示', icon: '👁️' },
      { id: 'add', label: '追加', icon: '➕' },
      { id: 'edit', label: '編集', icon: '✏️' }
    ];

    modes.forEach(mode => {
      const button = createButton(mode, () => this._editingViewModel.setMode(mode.id));
      modeSection.appendChild(button);
      this._modeButtons[mode.id] = button;
    });
    this._toolbarElement.appendChild(modeSection);


    // --- ツールセクション ---
    const toolSection = createSection();
    toolSection.appendChild(createLabel('ツール:'));

    // 追加モード用ツール
    const addTools = [
      { id: 'point', label: '点', icon: '•' },
      { id: 'line', label: '線', icon: '〰' }, // アイコン変更
      { id: 'polygon', label: '面', icon: '▢' }
    ];
    addTools.forEach(tool => {
      const button = createButton(tool, () => this._editingViewModel.setTool(tool.id));
      button.dataset.mode = 'add'; // モード情報を付与
      toolSection.appendChild(button);
      this._toolButtons[`add-${tool.id}`] = button;
    });

    // 編集モード用ツール
    const editTools = [
      { id: 'select', label: '選択', icon: '◉' },
      { id: 'move', label: '移動', icon: '↔' },
      { id: 'add-hole', label: '穴追加', icon: '◎' },
      { id: 'split', label: '分割', icon: '✂' }
    ];
    editTools.forEach(tool => {
      const button = createButton(tool, () => {
        if (tool.id === 'add-hole') {
          // 穴追加モードは EditingViewModel で管理されるべき
          // this._editingViewModel.setAddingHole(true); // 古い可能性あり
           this._editingViewModel.setTool(tool.id); // ツールとして設定
           console.warn("穴追加ツールの正確な ViewModel 操作を確認してください。");
        } else {
          this._editingViewModel.setTool(tool.id);
        }
      });
       button.dataset.mode = 'edit'; // モード情報を付与
      toolSection.appendChild(button);
      this._toolButtons[`edit-${tool.id}`] = button;
    });
    this._toolbarElement.appendChild(toolSection);


    // --- ユーティリティセクション ---
    const utilSection = createSection();

    // 保存ボタン
    const saveButton = createButton({ label: '保存', icon: '💾' }, () => this._saveWorld());
    utilSection.appendChild(saveButton);

    // 読込ボタン
    const loadButton = createButton({ label: '読込', icon: '📂' }, () => this._loadWorld());
    utilSection.appendChild(loadButton);
    this._toolbarElement.appendChild(utilSection);


    // --- 表示設定セクション ---
    const viewSection = createSection();

    // 測定ボタン
    this._measureButton = createButton({ label: '距離測定', icon: '📏' }, () => {
      const isMeasuring = this._mapView.isMeasuringDistance();
      this._mapView.setMeasuringDistance(!isMeasuring);
      this._updateMeasureButtonState(); // ボタンの状態を更新
    });
    viewSection.appendChild(this._measureButton);

    // 測定クリアボタン
    const clearMeasureButton = createButton({ label: '測定クリア', icon: '🧹' }, () => {
      this._mapView.clearMeasurements();
       this._updateMeasureButtonState(); // クリアしたら通常状態に戻す
    });
    viewSection.appendChild(clearMeasureButton);

    // グリッド表示ボタン
    this._gridButton = createButton({ label: 'グリッド', icon: '⊟' }, () => { // アイコン変更
        this._isGridVisible = !this._isGridVisible; // 内部状態を切り替え
        this._mapView.toggleGrid(this._isGridVisible); // MapView に通知
        this._updateGridButtonState(); // ボタンの状態を更新
    });
    viewSection.appendChild(this._gridButton);
    this._toolbarElement.appendChild(viewSection);


    // --- 履歴セクション ---
    const historySection = createSection();

    // アンドゥ・リドゥボタン
    const undoButton = createButton({ label: '元に戻す', icon: '↩' }, () => this._editingViewModel.undo());
    historySection.appendChild(undoButton);
    this._toolButtons['undo'] = undoButton;

    const redoButton = createButton({ label: 'やり直し', icon: '↪' }, () => this._editingViewModel.redo());
    historySection.appendChild(redoButton);
    this._toolButtons['redo'] = redoButton;
    this._toolbarElement.appendChild(historySection);
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
        this._updateToolbarDisplay();
        break;

      case 'history':
        this._updateHistoryButtons(data);
        break;

      default:
        break;
    }
  }

  /**
   * ツールバー表示の更新
   * @private
   */
  _updateToolbarDisplay() {
    const mode = this._editingViewModel.getMode();
    const tool = this._editingViewModel.getTool();

    // モードボタンの状態を更新
    Object.keys(this._modeButtons).forEach(modeId => {
      this._modeButtons[modeId].classList.toggle('active', modeId === mode);
      // 背景色での表現（クラスでの制御が望ましい）
      this._modeButtons[modeId].style.backgroundColor = modeId === mode ? '#c0c0c0' : '';
    });

    // ツールボタンの表示/非表示と選択状態を更新
    Object.keys(this._toolButtons).forEach(buttonId => {
      const button = this._toolButtons[buttonId];
      if (!button.dataset) return; // undo, redo ボタンは dataset がない

      const buttonMode = button.dataset.mode;
      const toolId = buttonId.startsWith('add-') ? buttonId.substring(4)
                   : buttonId.startsWith('edit-') ? buttonId.substring(5)
                   : null;

      // モードに合わないツールは非表示
      const isVisible = buttonMode === mode;
      button.style.display = isVisible ? 'inline-block' : 'none';

      if (isVisible && toolId) {
          // 選択状態の更新
          const isActive = toolId === tool;
          button.classList.toggle('active', isActive);
          // 背景色での表現
          button.style.backgroundColor = isActive ? '#c0c0c0' : '';
      } else {
          button.classList.remove('active');
          button.style.backgroundColor = '';
      }
    });

     // 履歴ボタンはモードに関わらず表示（有効/無効は _updateHistoryButtons で制御）
     if (this._toolButtons['undo']) this._toolButtons['undo'].style.display = 'inline-block';
     if (this._toolButtons['redo']) this._toolButtons['redo'].style.display = 'inline-block';
  }

  /**
   * グリッドボタンの状態を更新
   * @private
   */
  _updateGridButtonState() {
    if (this._gridButton) {
        this._gridButton.classList.toggle('active', this._isGridVisible);
        this._gridButton.style.backgroundColor = this._isGridVisible ? '#c0c0c0' : '';
    }
  }

   /**
   * 測定ボタンの状態を更新
   * @private
   */
    _updateMeasureButtonState() {
        if (this._measureButton && this._mapView) {
            const isMeasuring = this._mapView.isMeasuringDistance();
            this._measureButton.classList.toggle('active', isMeasuring);
            this._measureButton.style.backgroundColor = isMeasuring ? '#c0c0c0' : '';
        }
    }

  /**
   * 履歴ボタンの更新
   * @param {Object} data - 履歴状態 { canUndo: boolean, canRedo: boolean }
   * @private
   */
  _updateHistoryButtons(data) {
    if (this._toolButtons['undo']) {
      this._toolButtons['undo'].disabled = !data.canUndo;
    }
    if (this._toolButtons['redo']) {
      this._toolButtons['redo'].disabled = !data.canRedo;
    }
  }

  _saveWorld() {
    // 仮実装：アラートを表示
    alert('現在、自動保存のみ実装されています。明示的な保存機能は次期バージョンで実装予定です。');
  }

  _loadWorld() {
    // 仮実装：アラートを表示
    alert('読込機能は次期バージョンで実装予定です。');
  }
}
