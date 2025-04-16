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
      { id: 'line', label: '線', icon: '〰' },
      { id: 'polygon', label: '面', icon: '▢' }
    ];
    addTools.forEach(tool => {
      const button = createButton(tool, () => this._editingViewModel.setTool(tool.id));
      button.dataset.mode = 'add';
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
        // 'add-hole' ツール選択時にモードも 'edit' にする
        if (this._editingViewModel.getMode() !== 'edit') {
             this._editingViewModel.setMode('edit');
        }
        this._editingViewModel.setTool(tool.id);
        // if (tool.id === 'add-hole') {
        //    // 穴追加モードの開始は MapView 側でポリゴン選択後に行う
        //    console.log("穴追加ツール選択。次にマップ上のポリゴンをクリックしてください。");
        // }
      });
       button.dataset.mode = 'edit';
      toolSection.appendChild(button);
      this._toolButtons[`edit-${tool.id}`] = button;
    });
    this._toolbarElement.appendChild(toolSection);


    // --- ユーティリティセクション ---
    const utilSection = createSection();
    const saveButton = createButton({ label: '保存', icon: '💾' }, () => this._saveWorld());
    utilSection.appendChild(saveButton);
    const loadButton = createButton({ label: '読込', icon: '📂' }, () => this._loadWorld());
    utilSection.appendChild(loadButton);
    this._toolbarElement.appendChild(utilSection);


    // --- 表示設定セクション ---
    const viewSection = createSection();
    this._measureButton = createButton({ label: '距離測定', icon: '📏' }, () => {
      const isMeasuring = this._mapView.isMeasuringDistance();
      this._mapView.setMeasuringDistance(!isMeasuring);
      this._updateMeasureButtonState();
    });
    viewSection.appendChild(this._measureButton);
    const clearMeasureButton = createButton({ label: '測定クリア', icon: '🧹' }, () => {
      this._mapView.clearMeasurements();
       this._updateMeasureButtonState();
    });
    viewSection.appendChild(clearMeasureButton);
    this._gridButton = createButton({ label: 'グリッド', icon: '⊟' }, () => {
        this._isGridVisible = !this._isGridVisible;
        this._mapView.toggleGrid(this._isGridVisible);
        this._updateGridButtonState();
    });
    viewSection.appendChild(this._gridButton);
    this._toolbarElement.appendChild(viewSection);


    // --- 履歴セクション ---
    const historySection = createSection();
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

    Object.keys(this._modeButtons).forEach(modeId => {
      this._modeButtons[modeId].classList.toggle('active', modeId === mode);
      this._modeButtons[modeId].style.backgroundColor = modeId === mode ? '#c0c0c0' : '';
    });

    Object.keys(this._toolButtons).forEach(buttonId => {
      const button = this._toolButtons[buttonId];
      if (!button.dataset) return;

      const buttonMode = button.dataset.mode;
      const toolId = buttonId.startsWith('add-') ? buttonId.substring(4)
                   : buttonId.startsWith('edit-') ? buttonId.substring(5)
                   : null;

      const isVisible = buttonMode === mode;
      button.style.display = isVisible ? 'inline-block' : 'none';

      if (isVisible && toolId) {
          const isActive = toolId === tool;
          button.classList.toggle('active', isActive);
          button.style.backgroundColor = isActive ? '#c0c0c0' : '';
      } else if (buttonId !== 'undo' && buttonId !== 'redo') { // Undo/Redo以外
          button.classList.remove('active');
          button.style.backgroundColor = '';
      }
    });

     if (this._toolButtons['undo']) this._toolButtons['undo'].style.display = 'inline-block';
     if (this._toolButtons['redo']) this._toolButtons['redo'].style.display = 'inline-block';
     this._updateHistoryButtons({ // 履歴ボタンの有効状態も更新
         canUndo: this._editingViewModel.canUndo(),
         canRedo: this._editingViewModel.canRedo()
     });
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
    alert('現在、自動保存のみ実装されています。明示的な保存機能は次期バージョンで実装予定です。');
  }

  _loadWorld() {
    alert('読込機能は次期バージョンで実装予定です。');
  }
}
