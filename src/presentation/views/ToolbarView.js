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
    this._mapView = mapView;
    
    // DOM要素
    this._toolbarElement = null;
    this._modeButtons = {};
    this._toolButtons = {};
    
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
    
    // ツールバーの要素を作成
    this._createToolbarElements();
    
    // ツールバーコンテナに追加
    this._container.appendChild(this._toolbarElement);
    
    // 編集ビューモデルとの連携
    this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this));
    
    // 初期状態を反映
    this._updateToolbarDisplay();
  }

  /**
   * ツールバー要素の作成
   * @private
   */
  _createToolbarElements() {
    // モードセクション
    const modeSection = document.createElement('div');
    modeSection.className = 'toolbar-section';
    modeSection.style.display = 'inline-block';
    modeSection.style.marginRight = '20px';
    
    // モードラベル
    const modeLabel = document.createElement('span');
    modeLabel.textContent = 'モード: ';
    modeLabel.style.marginRight = '5px';
    modeSection.appendChild(modeLabel);
    
    // モードボタン
    const modes = [
      { id: 'view', label: '表示', icon: '👁' },
      { id: 'add', label: '追加', icon: '➕' },
      { id: 'edit', label: '編集', icon: '✏️' }
    ];
    
    modes.forEach(mode => {
      const button = document.createElement('button');
      button.textContent = `${mode.icon} ${mode.label}`;
      button.style.marginRight = '5px';
      button.addEventListener('click', () => this._editingViewModel.setMode(mode.id));
      
      modeSection.appendChild(button);
      this._modeButtons[mode.id] = button;
    });
    
    // ツールセクション
    const toolSection = document.createElement('div');
    toolSection.className = 'toolbar-section';
    toolSection.style.display = 'inline-block';
    toolSection.style.marginRight = '20px';
    
    // ツールラベル
    const toolLabel = document.createElement('span');
    toolLabel.textContent = 'ツール: ';
    toolLabel.style.marginRight = '5px';
    toolSection.appendChild(toolLabel);
    
    // ツールボタン（追加モード用）
    const addTools = [
      { id: 'point', label: '点', icon: '•' },
      { id: 'line', label: '線', icon: '✤' },
      { id: 'polygon', label: '面', icon: '▢' }
    ];
    
    addTools.forEach(tool => {
      const button = document.createElement('button');
      button.textContent = `${tool.icon} ${tool.label}`;
      button.style.marginRight = '5px';
      button.style.display = 'none'; // 最初は非表示
      button.addEventListener('click', () => this._editingViewModel.setTool(tool.id));
      
      toolSection.appendChild(button);
      this._toolButtons[`add-${tool.id}`] = button;
    });
    
    // ツールボタン（編集モード用）
    const editTools = [
      { id: 'select', label: '選択', icon: '◉' },
      { id: 'move', label: '移動', icon: '↔' },
      { id: 'add-hole', label: '穴追加', icon: '◎' },
      { id: 'split', label: '分割', icon: '✂' }
    ];
    
    editTools.forEach(tool => {
      const button = document.createElement('button');
      button.textContent = `${tool.icon} ${tool.label}`;
      button.style.marginRight = '5px';
      button.style.display = 'none'; // 最初は非表示
      button.addEventListener('click', () => {
        if (tool.id === 'add-hole') {
          this._editingViewModel.setAddingHole(true);
        } else {
          this._editingViewModel.setTool(tool.id);
        }
      });
      
      toolSection.appendChild(button);
      this._toolButtons[`edit-${tool.id}`] = button;
    });
    
    // ユーティリティセクション
    const utilSection = document.createElement('div');
    utilSection.className = 'toolbar-section';
    utilSection.style.display = 'inline-block';
    // セーブボタン
    const saveButton = document.createElement('button');
    saveButton.textContent = '💾 保存';
    saveButton.style.marginRight = '5px';
    saveButton.addEventListener('click', () => {
      // 保存処理の追加
      console.log('保存ボタンがクリックされました');
      this._saveWorld();
    });
    utilSection.appendChild(saveButton);

    // ロードボタン
    const loadButton = document.createElement('button');
    loadButton.textContent = '📂 読込';
    loadButton.style.marginRight = '5px';
    loadButton.addEventListener('click', () => {
      // 読込処理の追加
      console.log('読込ボタンがクリックされました');
      this._loadWorld();
    });
    utilSection.appendChild(loadButton);
    
    // 測定ボタン
    const measureButton = document.createElement('button');
    measureButton.textContent = '📏 距離測定';
    measureButton.style.marginRight = '5px';
    measureButton.addEventListener('click', () => {
      const isMeasuring = this._mapView.isMeasuringDistance();
      this._mapView.setMeasuringDistance(!isMeasuring);
      measureButton.style.backgroundColor = !isMeasuring ? '#ddd' : '';
    });
    utilSection.appendChild(measureButton);
    
    // 測定クリアボタン
    const clearMeasureButton = document.createElement('button');
    clearMeasureButton.textContent = '🧹 測定クリア';
    clearMeasureButton.style.marginRight = '5px';
    clearMeasureButton.addEventListener('click', () => {
      this._mapView.clearMeasurements();
    });
    utilSection.appendChild(clearMeasureButton);
    
    // グリッド表示ボタン
    const gridButton = document.createElement('button');
    gridButton.textContent = '⊞ グリッド';
    gridButton.style.marginRight = '5px';
    // グリッド表示切替処理はここでは実装しない
    utilSection.appendChild(gridButton);
    
    // アンドゥ・リドゥボタン
    const undoButton = document.createElement('button');
    undoButton.textContent = '↩ 元に戻す';
    undoButton.style.marginRight = '5px';
    undoButton.addEventListener('click', () => this._editingViewModel.undo());
    utilSection.appendChild(undoButton);
    this._toolButtons['undo'] = undoButton;
    
    const redoButton = document.createElement('button');
    redoButton.textContent = '↪ やり直し';
    redoButton.style.marginRight = '5px';
    redoButton.addEventListener('click', () => this._editingViewModel.redo());
    utilSection.appendChild(redoButton);
    this._toolButtons['redo'] = redoButton;
    
    // ツールバーにセクションを追加
    this._toolbarElement.appendChild(modeSection);
    this._toolbarElement.appendChild(toolSection);
    this._toolbarElement.appendChild(utilSection);
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
      this._modeButtons[modeId].style.backgroundColor = modeId === mode ? '#ddd' : '';
    });
    
    // ツールボタンの表示/非表示を切り替え
    Object.keys(this._toolButtons).forEach(buttonId => {
      if (buttonId.startsWith('add-')) {
        this._toolButtons[buttonId].style.display = mode === 'add' ? 'inline-block' : 'none';
      } else if (buttonId.startsWith('edit-')) {
        this._toolButtons[buttonId].style.display = mode === 'edit' ? 'inline-block' : 'none';
      }
    });
    
    // ツールボタンの選択状態を更新
    if (mode === 'add') {
      Object.keys(this._toolButtons).forEach(buttonId => {
        if (buttonId.startsWith('add-')) {
          const toolId = buttonId.substring(4); // 'add-' を除去
          this._toolButtons[buttonId].style.backgroundColor = toolId === tool ? '#ddd' : '';
        }
      });
    } else if (mode === 'edit') {
      Object.keys(this._toolButtons).forEach(buttonId => {
        if (buttonId.startsWith('edit-')) {
          const toolId = buttonId.substring(5); // 'edit-' を除去
          this._toolButtons[buttonId].style.backgroundColor = toolId === tool ? '#ddd' : '';
        }
      });
    }
  }

  /**
   * 履歴ボタンの更新
   * @param {Object} data - 履歴状態
   * @private
   */
  _updateHistoryButtons(data) {
    // アンドゥ・リドゥボタンの有効/無効を更新
    this._toolButtons['undo'].disabled = !data.canUndo;
    this._toolButtons['redo'].disabled = !data.canRedo;
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