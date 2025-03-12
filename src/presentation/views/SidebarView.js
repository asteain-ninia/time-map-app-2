/**
 * サイドバー表示
 */
export class SidebarView {
  /**
   * サイドバービューを作成
   * @param {HTMLElement} container - 表示コンテナ
   * @param {MapViewModel} mapViewModel - マップビューモデル
   * @param {ManageLayersUseCase} manageLayersUseCase - レイヤー管理ユースケース
   * @param {EditFeatureUseCase} editFeatureUseCase - 特徴編集ユースケース
   * @param {EventBus} eventBus - イベントバス
   */
  constructor(container, mapViewModel, manageLayersUseCase, editFeatureUseCase, eventBus) {
    this._container = container;
    this._mapViewModel = mapViewModel;
    this._manageLayersUseCase = manageLayersUseCase;
    this._editFeatureUseCase = editFeatureUseCase;
    this._eventBus = eventBus;
    
    // DOM要素
    this._sidebarElement = null;
    this._layersTabElement = null;
    this._featuresTabElement = null;
    this._propertiesTabElement = null;
    
    // 現在のタブ
    this._currentTab = 'layers';
    
    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // サイドバーコンテナ作成
    this._sidebarElement = document.createElement('div');
    this._sidebarElement.className = 'sidebar-container';
    this._sidebarElement.style.width = '100%';
    this._sidebarElement.style.height = '100%';
    this._sidebarElement.style.display = 'flex';
    this._sidebarElement.style.flexDirection = 'column';
    this._sidebarElement.style.backgroundColor = '#f5f5f5';
    this._sidebarElement.style.borderLeft = '1px solid #ddd';
    
    // タブバーの作成
    this._createTabBar();
    
    // タブコンテンツの作成
    this._createLayersTab();
    this._createFeaturesTab();
    this._createPropertiesTab();
    
    // サイドバーコンテナに追加
    this._container.appendChild(this._sidebarElement);
    
    // ビューモデルとの連携
    this._mapViewModel.addObserver(this._onMapViewModelChanged.bind(this));
    
    // 初期タブを表示
    this._switchTab(this._currentTab);
  }

  /**
   * タブバーの作成
   * @private
   */
  _createTabBar() {
    const tabBar = document.createElement('div');
    tabBar.className = 'sidebar-tabs';
    tabBar.style.display = 'flex';
    tabBar.style.borderBottom = '1px solid #ddd';
    
    const tabs = [
      { id: 'layers', label: 'レイヤー' },
      { id: 'features', label: '地物一覧' },
      { id: 'properties', label: 'プロパティ' }
    ];
    
    tabs.forEach(tab => {
      const tabElement = document.createElement('div');
      tabElement.textContent = tab.label;
      tabElement.className = 'sidebar-tab';
      tabElement.style.padding = '10px';
      tabElement.style.cursor = 'pointer';
      tabElement.style.borderRight = '1px solid #ddd';
      tabElement.addEventListener('click', () => this._switchTab(tab.id));
      
      tabBar.appendChild(tabElement);
    });
    
    this._sidebarElement.appendChild(tabBar);
  }

  /**
   * レイヤータブの作成
   * @private
   */
  _createLayersTab() {
    this._layersTabElement = document.createElement('div');
    this._layersTabElement.className = 'sidebar-tab-content';
    this._layersTabElement.style.flex = '1';
    this._layersTabElement.style.overflow = 'auto';
    this._layersTabElement.style.padding = '10px';
    this._layersTabElement.style.display = 'none';
    
    // レイヤー一覧のコンテナ
    const layersContainer = document.createElement('div');
    layersContainer.className = 'layers-container';
    
    // レイヤー追加ボタン
    const addLayerButton = document.createElement('button');
    addLayerButton.textContent = '+ レイヤー追加';
    addLayerButton.style.marginBottom = '10px';
    addLayerButton.addEventListener('click', this._showAddLayerDialog.bind(this));
    
    this._layersTabElement.appendChild(addLayerButton);
    this._layersTabElement.appendChild(layersContainer);
    
    this._sidebarElement.appendChild(this._layersTabElement);
  }

  /**
   * 地物一覧タブの作成
   * @private
   */
  _createFeaturesTab() {
    this._featuresTabElement = document.createElement('div');
    this._featuresTabElement.className = 'sidebar-tab-content';
    this._featuresTabElement.style.flex = '1';
    this._featuresTabElement.style.overflow = 'auto';
    this._featuresTabElement.style.padding = '10px';
    this._featuresTabElement.style.display = 'none';
    
    // 地物一覧のコンテナ
    const featuresContainer = document.createElement('div');
    featuresContainer.className = 'features-container';
    
    // フィルター行
    const filterRow = document.createElement('div');
    filterRow.style.marginBottom = '10px';
    
    const filterLabel = document.createElement('span');
    filterLabel.textContent = 'フィルター: ';
    filterLabel.style.marginRight = '5px';
    
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.placeholder = '名前で検索...';
    filterInput.style.width = '150px';
    filterInput.addEventListener('input', this._filterFeatures.bind(this));
    
    filterRow.appendChild(filterLabel);
    filterRow.appendChild(filterInput);
    
    this._featuresTabElement.appendChild(filterRow);
    this._featuresTabElement.appendChild(featuresContainer);
    
    this._sidebarElement.appendChild(this._featuresTabElement);
  }

  /**
   * プロパティタブの作成
   * @private
   */
  _createPropertiesTab() {
    this._propertiesTabElement = document.createElement('div');
    this._propertiesTabElement.className = 'sidebar-tab-content';
    this._propertiesTabElement.style.flex = '1';
    this._propertiesTabElement.style.overflow = 'auto';
    this._propertiesTabElement.style.padding = '10px';
    this._propertiesTabElement.style.display = 'none';
    
    // プロパティフォームのコンテナ
    const propertiesContainer = document.createElement('div');
    propertiesContainer.className = 'properties-container';
    
    // プロパティが何も選択されていない時のメッセージ
    const noSelectionMsg = document.createElement('p');
    noSelectionMsg.textContent = '特徴が選択されていません';
    propertiesContainer.appendChild(noSelectionMsg);
    
    this._propertiesTabElement.appendChild(propertiesContainer);
    
    this._sidebarElement.appendChild(this._propertiesTabElement);
  }

  /**
   * タブの切り替え
   * @param {string} tabId - タブID
   * @private
   */
  _switchTab(tabId) {
    // 現在のタブを非表示
    switch (this._currentTab) {
      case 'layers':
        this._layersTabElement.style.display = 'none';
        break;
      case 'features':
        this._featuresTabElement.style.display = 'none';
        break;
      case 'properties':
        this._propertiesTabElement.style.display = 'none';
        break;
    }
    
    // 新しいタブを表示
    switch (tabId) {
      case 'layers':
        this._layersTabElement.style.display = 'block';
        this._updateLayersTab();
        break;
      case 'features':
        this._featuresTabElement.style.display = 'block';
        this._updateFeaturesTab();
        break;
      case 'properties':
        this._propertiesTabElement.style.display = 'block';
        this._updatePropertiesTab();
        break;
    }
    
    // タブの状態を更新
    const tabs = this._sidebarElement.querySelector('.sidebar-tabs').children;
    for (let i = 0; i < tabs.length; i++) {
      if (i === ['layers', 'features', 'properties'].indexOf(tabId)) {
        tabs[i].style.backgroundColor = '#ddd';
      } else {
        tabs[i].style.backgroundColor = '';
      }
    }
    
    this._currentTab = tabId;
  }

  /**
   * マップビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onMapViewModelChanged(type, data) {
    // タイプに応じた処理
    switch (type) {
      case 'world':
      case 'layers':
        if (this._currentTab === 'layers') {
          this._updateLayersTab();
        }
        break;
        
      case 'features':
        if (this._currentTab === 'features') {
          this._updateFeaturesTab();
        }
        break;
        
      case 'selectedFeature':
        if (this._currentTab === 'properties') {
          this._updatePropertiesTab();
        }
        // プロパティタブに自動的に切り替え
        if (data) {
          this._switchTab('properties');
        }
        break;
        
      default:
        break;
    }
  }

  /**
   * レイヤータブの更新
   * @private
   */
  _updateLayersTab() {
    const world = this._mapViewModel.getWorld();
    if (!world) return;
    
    const layersContainer = this._layersTabElement.querySelector('.layers-container');
    layersContainer.innerHTML = '';
    
    // レイヤーを順序でソート
    const sortedLayers = [...world.layers].sort((a, b) => a.order - b.order);
    
    // レイヤー一覧の表示
    sortedLayers.forEach(layer => {
      const layerItem = document.createElement('div');
      layerItem.className = 'layer-item';
      layerItem.style.padding = '5px';
      layerItem.style.border = '1px solid #ddd';
      layerItem.style.marginBottom = '5px';
      layerItem.style.backgroundColor = '#fff';
      layerItem.style.display = 'flex';
      layerItem.style.alignItems = 'center';
      
      // 表示/非表示チェックボックス
      const visibilityCheckbox = document.createElement('input');
      visibilityCheckbox.type = 'checkbox';
      visibilityCheckbox.checked = layer.visible;
      visibilityCheckbox.style.marginRight = '5px';
      visibilityCheckbox.addEventListener('change', e => {
        this._updateLayerVisibility(layer.id, e.target.checked);
      });
      
      // レイヤー名
      const nameLabel = document.createElement('span');
      nameLabel.textContent = layer.name;
      nameLabel.style.flex = '1';
      
      // 不透明度スライダー
      const opacityLabel = document.createElement('span');
      opacityLabel.textContent = '不透明度:';
      opacityLabel.style.marginRight = '5px';
      
      const opacitySlider = document.createElement('input');
      opacitySlider.type = 'range';
      opacitySlider.min = '0';
      opacitySlider.max = '1';
      opacitySlider.step = '0.1';
      opacitySlider.value = layer.opacity;
      opacitySlider.style.width = '60px';
      opacitySlider.addEventListener('input', e => {
        this._updateLayerOpacity(layer.id, Number(e.target.value));
      });
      
      // 編集ボタン
      const editButton = document.createElement('button');
      editButton.textContent = '編集';
      editButton.style.marginLeft = '5px';
      editButton.addEventListener('click', () => {
        this._showEditLayerDialog(layer);
      });
      
      // 削除ボタン
      const deleteButton = document.createElement('button');
      deleteButton.textContent = '削除';
      deleteButton.style.marginLeft = '5px';
      deleteButton.addEventListener('click', () => {
        this._showDeleteLayerConfirm(layer);
      });
      
      // アイテムに要素を追加
      layerItem.appendChild(visibilityCheckbox);
      layerItem.appendChild(nameLabel);
      layerItem.appendChild(opacityLabel);
      layerItem.appendChild(opacitySlider);
      layerItem.appendChild(editButton);
      layerItem.appendChild(deleteButton);
      
      layersContainer.appendChild(layerItem);
    });
  }

  /**
   * 地物一覧タブの更新
   * @private
   */
  _updateFeaturesTab() {
    const features = this._mapViewModel.getFeatures();
    const currentTime = this._mapViewModel.getCurrentTime();
    
    const featuresContainer = this._featuresTabElement.querySelector('.features-container');
    featuresContainer.innerHTML = '';
    
    // フィルター入力値を取得
    const filterInput = this._featuresTabElement.querySelector('input');
    const filterText = filterInput ? filterInput.value.toLowerCase() : '';
    
    // 特徴をフィルタリングして表示
    const filteredFeatures = this._filterFeaturesByText(features, filterText, currentTime);
    
    if (filteredFeatures.length === 0) {
      const noFeaturesMsg = document.createElement('p');
      noFeaturesMsg.textContent = '表示する特徴がありません';
      featuresContainer.appendChild(noFeaturesMsg);
      return;
    }
    
    // カテゴリーごとにグループ化
    const categorizedFeatures = this._categorizeFeaturesBy(filteredFeatures, currentTime);
    
    // カテゴリーごとに表示
    Object.keys(categorizedFeatures).forEach(category => {
      const categoryGroup = document.createElement('div');
      categoryGroup.className = 'feature-category';
      categoryGroup.style.marginBottom = '10px';
      
      // カテゴリー見出し
      const categoryHeader = document.createElement('h3');
      categoryHeader.textContent = category;
      categoryHeader.style.margin = '5px 0';
      categoryHeader.style.padding = '5px';
      categoryHeader.style.backgroundColor = '#eee';
      categoryHeader.style.cursor = 'pointer';
      
      // 折りたたみ機能
      const categoryContent = document.createElement('div');
      categoryContent.className = 'category-content';
      
      categoryHeader.addEventListener('click', () => {
        categoryContent.style.display = 
          categoryContent.style.display === 'none' ? 'block' : 'none';
      });
      
      // 地物一覧
      categorizedFeatures[category].forEach(feature => {
        const prop = feature.getPropertyAt(currentTime);
        if (!prop) return;
        
        const featureItem = document.createElement('div');
        featureItem.className = 'feature-item';
        featureItem.style.padding = '5px';
        featureItem.style.border = '1px solid #ddd';
        featureItem.style.marginBottom = '2px';
        featureItem.style.cursor = 'pointer';
        
        // 選択状態の表示
        const selectedFeature = this._mapViewModel.getSelectedFeature();
        if (selectedFeature && selectedFeature.id === feature.id) {
          featureItem.style.backgroundColor = '#d0e0ff';
        } else {
          featureItem.style.backgroundColor = '#fff';
        }
        
        // 特徴名
        const nameLabel = document.createElement('span');
        nameLabel.textContent = prop.name || '名称なし';
        
        // クリックイベント
        featureItem.addEventListener('click', () => {
          this._mapViewModel.selectFeature(feature.id);
        });
        
        // アイテムに要素を追加
        featureItem.appendChild(nameLabel);
        categoryContent.appendChild(featureItem);
      });
      
      // グループに要素を追加
      categoryGroup.appendChild(categoryHeader);
      categoryGroup.appendChild(categoryContent);
      featuresContainer.appendChild(categoryGroup);
    });
  }

  /**
   * プロパティタブの更新
   * @private
   */
  _updatePropertiesTab() {
    const selectedFeature = this._mapViewModel.getSelectedFeature();
    const currentTime = this._mapViewModel.getCurrentTime();
    
    const propertiesContainer = this._propertiesTabElement.querySelector('.properties-container');
    propertiesContainer.innerHTML = '';
    
    if (!selectedFeature) {
      const noSelectionMsg = document.createElement('p');
      noSelectionMsg.textContent = '特徴が選択されていません';
      propertiesContainer.appendChild(noSelectionMsg);
      return;
    }
    
    // 特徴の種類を特定
    let featureType = 'unknown';
    if (selectedFeature.constructor.name === 'Point') {
      featureType = 'point';
    } else if (selectedFeature.constructor.name === 'Line') {
      featureType = 'line';
    } else if (selectedFeature.constructor.name === 'Polygon') {
      featureType = 'polygon';
    }
    
    // 特徴IDと種類
    const idRow = document.createElement('div');
    idRow.style.marginBottom = '10px';
    
    const idLabel = document.createElement('span');
    idLabel.textContent = `ID: ${selectedFeature.id}`;
    idLabel.style.fontSize = '0.8em';
    idLabel.style.color = '#666';
    
    const typeLabel = document.createElement('span');
    typeLabel.textContent = `種類: ${this._getFeatureTypeName(featureType)}`;
    typeLabel.style.fontSize = '0.8em';
    typeLabel.style.color = '#666';
    typeLabel.style.marginLeft = '10px';
    
    idRow.appendChild(idLabel);
    idRow.appendChild(typeLabel);
    propertiesContainer.appendChild(idRow);
    
    // 現在のプロパティを取得
    const currentProperty = selectedFeature.getPropertyAt(currentTime);
    
    // プロパティフォームの作成
    const form = document.createElement('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      this._saveFeatureProperties(selectedFeature.id, form);
    });
    
    // 基本プロパティ
    const basicProps = [
      { id: 'name', label: '名前', type: 'text', value: currentProperty ? currentProperty.name : '' },
      { id: 'description', label: '説明', type: 'textarea', value: currentProperty ? currentProperty.description : '' },
      { id: 'category', label: 'カテゴリ', type: 'select', value: currentProperty ? currentProperty.getAttribute('category', '') : '' }
    ];
    
    basicProps.forEach(prop => {
      const row = document.createElement('div');
      row.style.marginBottom = '10px';
      
      const label = document.createElement('label');
      label.textContent = prop.label;
      label.style.display = 'block';
      label.style.marginBottom = '5px';
      
      let input;
      
      if (prop.type === 'textarea') {
        input = document.createElement('textarea');
        input.style.width = '100%';
        input.style.height = '80px';
        input.value = prop.value;
      } else if (prop.type === 'select') {
        input = document.createElement('select');
        input.style.width = '100%';
        
        // カテゴリオプション
        const categories = this._getCategoriesForFeatureType(featureType);
        
        categories.forEach(cat => {
          const option = document.createElement('option');
          option.value = cat.id;
          option.textContent = cat.name;
          if (cat.id === prop.value) {
            option.selected = true;
          }
          input.appendChild(option);
        });
      } else {
        input = document.createElement('input');
        input.type = prop.type;
        input.style.width = '100%';
        input.value = prop.value;
      }
      
      input.name = prop.id;
      
      row.appendChild(label);
      row.appendChild(input);
      form.appendChild(row);
    });
    
    // 時間範囲
    const timeRow = document.createElement('div');
    timeRow.style.marginBottom = '10px';
    
    const timeLabel = document.createElement('label');
    timeLabel.textContent = '存在期間';
    timeLabel.style.display = 'block';
    timeLabel.style.marginBottom = '5px';
    
    const startLabel = document.createElement('span');
    startLabel.textContent = '開始: ';
    
    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.name = 'startYear';
    startInput.style.width = '80px';
    startInput.value = currentProperty && currentProperty.startTime ? currentProperty.startTime.year : '';
    
    const endLabel = document.createElement('span');
    endLabel.textContent = ' 終了: ';
    
    const endInput = document.createElement('input');
    endInput.type = 'number';
    endInput.name = 'endYear';
    endInput.style.width = '80px';
    endInput.value = currentProperty && currentProperty.endTime ? currentProperty.endTime.year : '';
    
    timeRow.appendChild(timeLabel);
    timeRow.appendChild(startLabel);
    timeRow.appendChild(startInput);
    timeRow.appendChild(endLabel);
    timeRow.appendChild(endInput);
    form.appendChild(timeRow);
    
    // 特徴タイプに応じた追加プロパティ
    if (featureType === 'point') {
      // 点特有のプロパティ
    } else if (featureType === 'line') {
      // 線特有のプロパティ
    } else if (featureType === 'polygon') {
      // 面特有のプロパティ
    }
    
    // ボタン行
    const buttonRow = document.createElement('div');
    buttonRow.style.marginTop = '20px';
    buttonRow.style.textAlign = 'right';
    
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '削除';
    deleteButton.style.marginRight = '10px';
    deleteButton.addEventListener('click', () => {
      this._showDeleteFeatureConfirm(selectedFeature);
    });
    
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = '保存';
    
    buttonRow.appendChild(deleteButton);
    buttonRow.appendChild(saveButton);
    form.appendChild(buttonRow);
    
    propertiesContainer.appendChild(form);
  }

  /**
   * レイヤー表示状態の更新
   * @param {string} layerId - レイヤーID
   * @param {boolean} visible - 表示状態
   * @private
   */
  async _updateLayerVisibility(layerId, visible) {
    try {
      const layer = await this._manageLayersUseCase.updateLayer(layerId, { visible });
      
      // イベントを発行
      this._eventBus.publish('LayerVisibilityChanged', { layerId, layer });
    } catch (error) {
      console.error('レイヤー表示状態の更新に失敗しました', error);
    }
  }

  /**
   * レイヤー不透明度の更新
   * @param {string} layerId - レイヤーID
   * @param {number} opacity - 不透明度
   * @private
   */
  async _updateLayerOpacity(layerId, opacity) {
    try {
      const layer = await this._manageLayersUseCase.updateLayer(layerId, { opacity });
      
      // イベントを発行
      this._eventBus.publish('LayerVisibilityChanged', { layerId, layer });
    } catch (error) {
      console.error('レイヤー不透明度の更新に失敗しました', error);
    }
  }

  /**
   * レイヤー追加用のダイアログの代わりに入力フィールドを表示
   * @private
   */
  _showAddLayerDialog() {
    // プロンプトをダイアログの代わりに実装
    const container = this._sidebarElement.querySelector('.layers-container');

    // 既存の入力フォームがあれば削除
    const existingForm = container.querySelector('.layer-input-form');
    if (existingForm) {
      existingForm.remove();
    }

    // 入力フォームを作成
    const formElement = document.createElement('div');
    formElement.className = 'layer-input-form';
    formElement.style.marginBottom = '10px';
    formElement.style.padding = '5px';
    formElement.style.border = '1px solid #ddd';
    formElement.style.backgroundColor = '#f9f9f9';

    const label = document.createElement('label');
    label.textContent = 'レイヤー名: ';
    label.style.display = 'block';
    label.style.marginBottom = '5px';

    const input = document.createElement('input');
    input.type = 'text';
    input.style.width = '100%';
    input.style.marginBottom = '5px';

    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.display = 'flex';
    buttonsDiv.style.justifyContent = 'flex-end';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'キャンセル';
    cancelButton.style.marginRight = '5px';
    cancelButton.addEventListener('click', () => formElement.remove());

    const okButton = document.createElement('button');
    okButton.textContent = '追加';
    okButton.addEventListener('click', () => {
      const name = input.value.trim();
      if (name) {
        this._addLayer(name);
      }
      formElement.remove();
    });

    buttonsDiv.appendChild(cancelButton);
    buttonsDiv.appendChild(okButton);

    formElement.appendChild(label);
    formElement.appendChild(input);
    formElement.appendChild(buttonsDiv);

    // フォームを追加
    container.insertBefore(formElement, container.firstChild);

    // 入力フィールドにフォーカス
    input.focus();
  }

  /**
   * レイヤー編集用のダイアログの代わりに入力フィールドを表示
   * @param {Layer} layer - 編集するレイヤー
   * @private
   */
  _showEditLayerDialog(layer) {
    const container = this._sidebarElement.querySelector('.layers-container');

    // 既存の入力フォームがあれば削除
    const existingForm = container.querySelector('.layer-input-form');
    if (existingForm) {
      existingForm.remove();
    }

    // 入力フォームを作成
    const formElement = document.createElement('div');
    formElement.className = 'layer-input-form';
    formElement.style.marginBottom = '10px';
    formElement.style.padding = '5px';
    formElement.style.border = '1px solid #ddd';
    formElement.style.backgroundColor = '#f9f9f9';

    const label = document.createElement('label');
    label.textContent = 'レイヤー名: ';
    label.style.display = 'block';
    label.style.marginBottom = '5px';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = layer.name;
    input.style.width = '100%';
    input.style.marginBottom = '5px';

    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.display = 'flex';
    buttonsDiv.style.justifyContent = 'flex-end';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'キャンセル';
    cancelButton.style.marginRight = '5px';
    cancelButton.addEventListener('click', () => formElement.remove());

    const okButton = document.createElement('button');
    okButton.textContent = '保存';
    okButton.addEventListener('click', () => {
      const name = input.value.trim();
      if (name) {
        this._editLayer(layer.id, name);
      }
      formElement.remove();
    });

    buttonsDiv.appendChild(cancelButton);
    buttonsDiv.appendChild(okButton);

    formElement.appendChild(label);
    formElement.appendChild(input);
    formElement.appendChild(buttonsDiv);

    // フォームを追加
    const layerElement = this._sidebarElement.querySelector(`[data-layer-id="${layer.id}"]`);
    if (layerElement) {
      layerElement.insertAdjacentElement('afterend', formElement);
    } else {
      container.appendChild(formElement);
    }

    // 入力フィールドにフォーカス
    input.focus();
    input.select();
  }

  /**
   * レイヤー削除確認の表示
   * @param {Object} layer - レイヤー
   * @private
   */
  _showDeleteLayerConfirm(layer) {
    // 簡易的な確認ダイアログ
    const confirm = window.confirm(`レイヤー「${layer.name}」を削除してもよろしいですか？`);
    if (confirm) {
      this._deleteLayer(layer.id);
    }
  }

  /**
   * 特徴削除確認の表示
   * @param {Object} feature - 特徴
   * @private
   */
  _showDeleteFeatureConfirm(feature) {
    const currentTime = this._mapViewModel.getCurrentTime();
    const property = feature.getPropertyAt(currentTime);
    const name = property ? property.name : '名称なし';
    
    // 簡易的な確認ダイアログ
    const confirm = window.confirm(`特徴「${name}」を削除してもよろしいですか？`);
    if (confirm) {
      this._mapViewModel.deleteFeature(feature.id);
    }
  }

  /**
   * レイヤー追加
   * @param {string} name - レイヤー名
   * @private
   */
  async _addLayer(name) {
    try {
      await this._manageLayersUseCase.addLayer(name);
      this._updateLayersTab();
    } catch (error) {
      console.error('レイヤーの追加に失敗しました', error);
      alert('レイヤーの追加に失敗しました: ' + error.message);
    }
  }

  /**
   * レイヤー名の更新
   * @param {string} layerId - レイヤーID
   * @param {string} name - 新しい名前
   * @private
   */
  async _updateLayerName(layerId, name) {
    try {
      await this._manageLayersUseCase.updateLayer(layerId, { name });
      this._updateLayersTab();
    } catch (error) {
      console.error('レイヤー名の更新に失敗しました', error);
      alert('レイヤー名の更新に失敗しました: ' + error.message);
    }
  }

  /**
   * レイヤーの削除
   * @param {string} layerId - レイヤーID
   * @private
   */
  async _deleteLayer(layerId) {
    try {
      await this._manageLayersUseCase.deleteLayer(layerId);
      this._updateLayersTab();
    } catch (error) {
      console.error('レイヤーの削除に失敗しました', error);
      alert('レイヤーの削除に失敗しました: ' + error.message);
    }
  }

  /**
   * 特徴プロパティの保存
   * @param {string} featureId - 特徴ID
   * @param {HTMLFormElement} form - プロパティフォーム
   * @private
   */
  async _saveFeatureProperties(featureId, form) {
    // フォームデータの収集
    const formData = new FormData(form);
    
    // 基本プロパティの取得
    const name = formData.get('name');
    const description = formData.get('description');
    const category = formData.get('category');
    
    // 時間範囲の取得
    const startYear = formData.get('startYear') ? Number(formData.get('startYear')) : null;
    const endYear = formData.get('endYear') ? Number(formData.get('endYear')) : null;
    
    // 現在の特徴を取得
    const selectedFeature = this._mapViewModel.getSelectedFeature();
    const currentTime = this._mapViewModel.getCurrentTime();
    const currentProperty = selectedFeature.getPropertyAt(currentTime);
    
    // 古いプロパティを保存（アンドゥ用）
    const oldProperties = [...selectedFeature.properties];
    
    // 新しいプロパティを作成
    // （実際の実装では、TimePoint及びPropertyクラスのインスタンスを正しく作成する必要があります）
    const newProperty = {
      timePoint: { year: currentTime.year, month: currentTime.month, day: currentTime.day },
      name,
      description,
      attributes: { category },
      startTime: startYear ? { year: startYear } : null,
      endTime: endYear ? { year: endYear } : null
    };
    
    // 既存のプロパティを更新または新しいプロパティを追加
    let newProperties;
    if (currentProperty) {
      newProperties = selectedFeature.properties.map(prop => {
        if (prop === currentProperty) {
          return newProperty;
        }
        return prop;
      });
    } else {
      newProperties = [...selectedFeature.properties, newProperty];
    }
    
    try {
      // 特徴を更新
      await this._mapViewModel.updateFeatureProperties(featureId, newProperties);
      
      alert('プロパティを保存しました');
    } catch (error) {
      console.error('プロパティの保存に失敗しました', error);
      alert('プロパティの保存に失敗しました: ' + error.message);
    }
  }

  /**
   * 特徴をテキストでフィルタリング
   * @param {Array} features - 特徴の配列
   * @param {string} text - フィルターテキスト
   * @param {Object} currentTime - 現在の時間
   * @returns {Array} フィルタリングされた特徴の配列
   * @private
   */
  _filterFeaturesByText(features, text, currentTime) {
    if (!text) return features;
    
    return features.filter(feature => {
      const property = feature.getPropertyAt(currentTime);
      if (!property) return false;
      
      // 名前または説明が検索テキストを含むか
      return (
        (property.name && property.name.toLowerCase().includes(text)) ||
        (property.description && property.description.toLowerCase().includes(text))
      );
    });
  }

  /**
   * 特徴のフィルタリング
   * @param {Event} event - 入力イベント
   * @private
   */
  _filterFeatures(event) {
    this._updateFeaturesTab();
  }

  /**
   * 特徴をカテゴリでグループ化
   * @param {Array} features - 特徴の配列
   * @param {Object} currentTime - 現在の時間
   * @returns {Object} カテゴリごとの特徴オブジェクト
   * @private
   */
  _categorizeFeaturesBy(features, currentTime) {
    const categorized = {};
    
    features.forEach(feature => {
      const property = feature.getPropertyAt(currentTime);
      if (!property) return;
      
      // カテゴリを取得（なければデフォルト）
      let category = property.getAttribute('category');
      
      if (!category) {
        // 特徴タイプに基づくデフォルトカテゴリ
        if (feature.constructor.name === 'Point') {
          category = 'point';
        } else if (feature.constructor.name === 'Line') {
          category = 'line';
        } else if (feature.constructor.name === 'Polygon') {
          category = 'polygon';
        } else {
          category = 'other';
        }
      }
      
      // カテゴリ名の表示用変換
      const categoryName = this._getCategoryDisplayName(category);
      
      // カテゴリグループに追加
      if (!categorized[categoryName]) {
        categorized[categoryName] = [];
      }
      
      categorized[categoryName].push(feature);
    });
    
    return categorized;
  }

  /**
   * カテゴリ表示名の取得
   * @param {string} category - カテゴリID
   * @returns {string} 表示名
   * @private
   */
  _getCategoryDisplayName(category) {
    const categoryMap = {
      'city': '都市',
      'town': '町村',
      'battle': '戦闘',
      'ruin': '遺跡',
      'road': '道路',
      'railway': '鉄道',
      'river': '河川',
      'trade_route': '交易路',
      'border': '国境',
      'kingdom': '王国',
      'empire': '帝国',
      'province': '地方',
      'ocean': '海洋',
      'lake': '湖沼',
      'point': '点',
      'line': '線',
      'polygon': '面',
      'other': 'その他'
    };
    
    return categoryMap[category] || category;
  }

  /**
   * 特徴種類の表示名取得
   * @param {string} type - 特徴種類
   * @returns {string} 表示名
   * @private
   */
  _getFeatureTypeName(type) {
    const typeMap = {
      'point': '点',
      'line': '線',
      'polygon': '面',
      'unknown': '不明'
    };
    
    return typeMap[type] || type;
  }

  /**
   * 特徴種類に応じたカテゴリの取得
   * @param {string} type - 特徴種類
   * @returns {Array} カテゴリの配列
   * @private
   */
  _getCategoriesForFeatureType(type) {
    // デフォルトカテゴリ
    const defaultCategories = [
      { id: '', name: '-- カテゴリなし --' }
    ];
    
    // 特徴種類に応じたカテゴリ
    switch (type) {
      case 'point':
        return [
          ...defaultCategories,
          { id: 'city', name: '都市' },
          { id: 'town', name: '町村' },
          { id: 'battle', name: '戦闘' },
          { id: 'ruin', name: '遺跡' }
        ];
        
      case 'line':
        return [
          ...defaultCategories,
          { id: 'road', name: '道路' },
          { id: 'railway', name: '鉄道' },
          { id: 'river', name: '河川' },
          { id: 'trade_route', name: '交易路' },
          { id: 'border', name: '国境' }
        ];
        
      case 'polygon':
        return [
          ...defaultCategories,
          { id: 'kingdom', name: '王国' },
          { id: 'empire', name: '帝国' },
          { id: 'province', name: '地方' },
          { id: 'ocean', name: '海洋' },
          { id: 'lake', name: '湖沼' }
        ];
        
      default:
        return defaultCategories;
    }
  }
}