// src/presentation/views/SidebarView.js

import { LayersTabView } from './sidebar/LayersTabView.js';
import { FeaturesTabView } from './sidebar/FeaturesTabView.js';
import { PropertiesTabView } from './sidebar/PropertiesTabView.js';
import { ProjectSettingsTabView } from './sidebar/ProjectSettingsTabView.js';

/**
 * サイドバー表示 (ファサードクラス)
 */
export class SidebarView {
  /**
   * サイドバービューを作成
   * @param {HTMLElement} container - 表示コンテナ
   * @param {MapViewModel} mapViewModel - マップビューモデル
   * @param {ManageLayersUseCase} manageLayersUseCase - レイヤー管理ユースケース
   * @param {EditingViewModel} editingViewModel - 編集ビューモデル
   * @param {EventBus} eventBus - イベントバス
   * @param {ConfigManager} configManager - 設定マネージャー
   */
  constructor(container, mapViewModel, manageLayersUseCase, editingViewModel, eventBus, configManager) {
    this._container = container;
    this._mapViewModel = mapViewModel;
    this._manageLayersUseCase = manageLayersUseCase;
    this._editingViewModel = editingViewModel;
    this._eventBus = eventBus;
    this._configManager = configManager;

    // DOM要素
    this._sidebarElement = null;
    // 各タブビューのインスタンスを保持
    this._layersTabView = null;
    this._featuresTabView = null;
    this._propertiesTabView = null;
    this._projectSettingsTabView = null;

    // 現在のタブID
    this._currentTabId = 'layers'; // 初期タブ

    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    this._sidebarElement = document.createElement('div');
    this._sidebarElement.className = 'sidebar-container';
    this._sidebarElement.style.cssText = `
        width: 100%; 
        height: 100%; 
        display: flex; 
        flex-direction: column; 
        background-color: #f5f5f5; 
        border-left: 1px solid #ddd;
    `;

    this._createTabBar();

    // タブコンテンツの親要素を作成
    const tabContentArea = document.createElement('div');
    tabContentArea.style.cssText = `
        flex: 1;
        position: relative; /* 子要素の絶対配置のため */
        overflow: hidden; /* スクロールは各タブビューに任せる */
    `;
    this._sidebarElement.appendChild(tabContentArea);


    // 各タブビューのインスタンス化とDOM追加
    this._layersTabView = new LayersTabView(tabContentArea, this._mapViewModel, this._manageLayersUseCase, this._eventBus);
    this._featuresTabView = new FeaturesTabView(tabContentArea, this._mapViewModel, this._eventBus); // EventBusも渡す
    this._propertiesTabView = new PropertiesTabView(tabContentArea, this._mapViewModel, this._editingViewModel);
    this._projectSettingsTabView = new ProjectSettingsTabView(tabContentArea, this._mapViewModel, this._configManager);

    this._container.appendChild(this._sidebarElement);

    this._mapViewModel.addObserver(this._onMapViewModelChanged.bind(this));
    this._editingViewModel.addObserver(this._onEditingViewModelChanged.bind(this)); // EditingVMの変更も監視

    if (this._eventBus && typeof this._eventBus.subscribe === 'function') {
      this._eventBus.subscribe('OpenSidebarTab', payload => {
        const targetTab = (payload && payload.tabId) ? payload.tabId : 'properties';
        this._switchTab(targetTab);
      });
    }

    this._switchTab(this._currentTabId); // 初期タブを表示
  }

  /**
   * タブバーの作成
   * @private
   */
  _createTabBar() {
    const tabBar = document.createElement('div');
    tabBar.className = 'sidebar-tabs';
    tabBar.style.cssText = `
        display: flex;
        border-bottom: 1px solid #ddd;
        background-color: #e9e9e9;
    `;

    const tabsConfig = [
      { id: 'layers', label: 'レイヤー' },
      { id: 'features', label: '地物一覧' },
      { id: 'properties', label: 'プロパティ' },
      { id: 'projectSettings', label: '設定' }
    ];

    tabsConfig.forEach(tabConfig => {
      const tabElement = document.createElement('div');
      tabElement.textContent = tabConfig.label;
      tabElement.className = 'sidebar-tab';
      tabElement.dataset.tabId = tabConfig.id; // data属性でIDを保持
      tabElement.style.cssText = `
        padding: 10px 15px;
        cursor: pointer;
        border-right: 1px solid #ddd;
        flex-grow: 1; /* タブが均等に幅を占めるように */
        text-align: center;
        font-size: 0.9em;
      `;
      tabElement.addEventListener('click', () => this._switchTab(tabConfig.id));
      tabBar.appendChild(tabElement);
    });

    this._sidebarElement.appendChild(tabBar);
  }

  /**
   * タブの切り替え
   * @param {string} tabId - 表示するタブのID
   * @private
   */
  _switchTab(tabId) {
    this._currentTabId = tabId;

    // 全てのタブビューを非表示にする
    this._layersTabView.setVisible(false);
    this._featuresTabView.setVisible(false);
    this._propertiesTabView.setVisible(false);
    this._projectSettingsTabView.setVisible(false);

    // 対応するタブビューを表示し、更新する
    let activeTabView = null;
    switch (tabId) {
      case 'layers':
        activeTabView = this._layersTabView;
        break;
      case 'features':
        activeTabView = this._featuresTabView;
        break;
      case 'properties':
        activeTabView = this._propertiesTabView;
        break;
      case 'projectSettings':
        activeTabView = this._projectSettingsTabView;
        break;
    }

    if (activeTabView) {
      activeTabView.setVisible(true);
      activeTabView.update(); // タブ表示時に必ず内容を更新
    }

    // タブバーのボタンのアクティブ状態を更新
    const tabs = this._sidebarElement.querySelectorAll('.sidebar-tab');
    tabs.forEach(tabButton => {
      if (tabButton.dataset.tabId === tabId) {
        tabButton.style.backgroundColor = '#ddd'; // アクティブなタブの背景色
        tabButton.style.fontWeight = 'bold';
      } else {
        tabButton.style.backgroundColor = '';
        tabButton.style.fontWeight = 'normal';
      }
    });
  }

  /**
   * MapViewModel変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onMapViewModelChanged(type, data) {
    // 現在アクティブなタブの内容を更新
    const activeTabView = this._getActiveTabView();
    if (activeTabView) {
        activeTabView.update();
    }

    // 地物選択時にプロパティタブに自動切り替えするロジック
    const hasActiveFeature = Array.isArray(data) ? data.length > 0 : !!data;
    if (type === 'activeFeature' && hasActiveFeature) { // data は選択された地物インスタンス
      if (this._currentTabId !== 'properties') {
          this._switchTab('properties');
      }
    }
    // プロジェクト設定が変更されたら、設定タブがアクティブでなくても内容を（次に表示される際に）更新する必要がある
    // _switchTab内でupdate()が呼ばれるので、ここで個別タブのupdateを呼ぶ必要は必ずしもない
    if (type === 'projectSettingsChanged' && this._currentTabId === 'projectSettings') {
        this._projectSettingsTabView.update();
    }
    // レイヤー情報が変更されたら、レイヤータブがアクティブでなくても更新
    if (type === 'layers' && this._currentTabId === 'layers') {
        this._layersTabView.update();
    }
    // 他、特定のイベントタイプに応じて特定のタブの更新を強制したい場合はここに追加
  }
  
  /**
   * EditingViewModel変更のハンドラ
   * (主にアンドゥ・リドゥによる状態変化で、MapViewModel経由では検知しきれないケースを想定)
   * @param {string} type
   * @param {*} data
   * @private
   */
  _onEditingViewModelChanged(type, data) {
      if (type === 'history') { // アンドゥ・リドゥ操作完了時
          // 全てのタブが影響を受ける可能性があるので、アクティブなタブを強制更新
          const activeTabView = this._getActiveTabView();
          if (activeTabView) {
              activeTabView.update();
          }
          // 特に、アンドゥ/リドゥで選択状態や地物リストが変わることがあるので
          // PropertiesタブやFeaturesタブは再描画が必要になる
          if (this._currentTabId === 'properties') this._propertiesTabView.update();
          if (this._currentTabId === 'features') this._featuresTabView.update();
          if (this._currentTabId === 'layers') this._layersTabView.update(); // レイヤー変更もアンドゥ対象なら
          if (this._currentTabId === 'projectSettings') this._projectSettingsTabView.update(); // 設定変更もアンドゥ対象なら
      }
  }

  /**
   * 現在アクティブなタブビューインスタンスを取得
   * @returns {LayersTabView | FeaturesTabView | PropertiesTabView | ProjectSettingsTabView | null}
   * @private
   */
  _getActiveTabView() {
    switch (this._currentTabId) {
      case 'layers': return this._layersTabView;
      case 'features': return this._featuresTabView;
      case 'properties': return this._propertiesTabView;
      case 'projectSettings': return this._projectSettingsTabView;
      default: return null;
    }
  }

  // --- 以前 SidebarView が直接持っていたメソッド群は各タブビューに移動したため削除 ---
  // _updateLayersTab, _updateFeaturesTab, _updatePropertiesTab, _updateProjectSettingsTab
  // _showAddLayerDialog, _showEditLayerDialog, _showDeleteLayerConfirm, _addLayer, etc.
  // _saveFeatureProperties, _showDeleteFeatureConfirm
  // _filterFeatures, _categorizeFeaturesBy, _getCategoryDisplayName, _getFeatureTypeName, _getCategoriesForFeatureType

}
