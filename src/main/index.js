// src/main/index.js 
// アプリケーションのエントリーポイント
import { DependencyInjection } from './DependencyInjection';
import { Config } from './Config';

/**
 * アプリケーションのメインクラス
 */
class TimeMapApp {
  constructor() {
    this._di = new DependencyInjection();
    this._config = new Config();
    
    // 初期化済みフラグ
    this._isInitialized = false;
  }

  /**
   * アプリケーションを初期化
   */
  initialize() {
    if (this._isInitialized) {
      return;
    }
    
    // HTMLコンテナの作成
    this._createContainers();
    
    // 依存性の初期化
    this._di.initialize(
      this._mapContainer,
      this._timelineContainer,
      this._toolbarContainer,
      this._sidebarContainer
    );
    
    // 設定の適用
    this._applyConfig();
    
    // ウィンドウリサイズイベントの設定
    window.addEventListener('resize', this._handleResize.bind(this));
    
    this._isInitialized = true;
    this._loadBackgroundMap();
  }

  /**
   * HTMLコンテナを作成
   * @private
   */
  _createContainers() {
    // メインコンテナ
    this._mainContainer = document.getElementById('app') || document.body;
    this._mainContainer.style.display = 'flex';
    this._mainContainer.style.flexDirection = 'column';
    this._mainContainer.style.height = '100vh';
    this._mainContainer.style.overflow = 'hidden';
    
    // ツールバーコンテナ
    this._toolbarContainer = document.createElement('div');
    this._toolbarContainer.id = 'toolbar-container';
    this._toolbarContainer.style.width = '100%';
    this._toolbarContainer.style.height = '50px';
    this._mainContainer.appendChild(this._toolbarContainer);
    
    // メインエリアコンテナ（左右に分割）
    this._mainAreaContainer = document.createElement('div');
    this._mainAreaContainer.style.display = 'flex';
    this._mainAreaContainer.style.flex = '1';
    this._mainAreaContainer.style.overflow = 'hidden';
    this._mainContainer.appendChild(this._mainAreaContainer);
    
    // マップコンテナ
    this._mapContainer = document.createElement('div');
    this._mapContainer.id = 'map-container';
    this._mapContainer.style.flex = '1';
    this._mapContainer.style.position = 'relative';
    this._mainAreaContainer.appendChild(this._mapContainer);
    
    // サイドバーコンテナ
    this._sidebarContainer = document.createElement('div');
    this._sidebarContainer.id = 'sidebar-container';
    this._sidebarContainer.style.width = `${this._config.get('ui.rightPanelWidth', 300)}px`;
    this._sidebarContainer.style.height = '100%';
    this._mainAreaContainer.appendChild(this._sidebarContainer);
    
    // タイムラインコンテナ
    this._timelineContainer = document.createElement('div');
    this._timelineContainer.id = 'timeline-container';
    this._timelineContainer.style.width = '100%';
    this._timelineContainer.style.height = `${this._config.get('ui.timelineHeight', 100)}px`;
    this._mainContainer.appendChild(this._timelineContainer);
  }

  /**
   * 設定を適用
   * @private
   */
  _applyConfig() {
    // ビューポートマネージャーに設定を適用
    const viewportManager = this._di.get('viewportManager');
    viewportManager.updateViewport({
      minZoom: this._config.get('map.zoomMin', 0.1),
      maxZoom: this._config.get('map.zoomMax', 10)
    });
    
    // タイムラインコントローラに設定を適用
    const timelineController = this._di.get('timelineController');
    timelineController.setTimeRange(
      this._config.get('timeline.minYear', 0),
      this._config.get('timeline.maxYear', 10000)
    );
    
    // 時間サービスに設定を適用
    const timeService = this._di.get('timeService');
    timeService.updateCalendarConfig(this._config.get('calendar', {}));
    
    // 設定マネージャーに設定を適用
    const configManager = this._di.get('configManager');
    Object.keys(this._config._config).forEach(section => {
      configManager.updateSection(section, this._config.getSection(section));
    });
  }

  /**
   * リサイズハンドラ
   * @private
   */
  _handleResize() {
    const rect = this._mapContainer.getBoundingClientRect();
    
    // ビューポートの更新
    const viewportManager = this._di.get('viewportManager');
    viewportManager.resize(rect.width, rect.height);
    
    // レンダラーの更新
    const renderer = this._di.get('renderer');
    renderer.resize(rect.width, rect.height);
  }

  /**
   * サイドバーの幅を変更
   * @param {number} width - 新しい幅
   */
  setSidebarWidth(width) {
    this._sidebarContainer.style.width = `${width}px`;
    this._config.updateSection('ui', { rightPanelWidth: width });
    this._handleResize();
  }

  /**
   * タイムラインの高さを変更
   * @param {number} height - 新しい高さ
   */
  setTimelineHeight(height) {
    this._timelineContainer.style.height = `${height}px`;
    this._config.updateSection('ui', { timelineHeight: height });
    this._handleResize();
  }

  /**
   * ダークモードの切り替え
   * @param {boolean} enabled - 有効にするかどうか
   */
  setDarkMode(enabled) {
    if (enabled) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    
    this._config.updateSection('ui', { darkMode: enabled });
  }
  async _loadBackgroundMap() {
    try {
      // 地図のパスを設定
      const path = require('path');
      const mapPath = path.join(__dirname, '../assets/maps/base-map.svg');
      
      console.log('地図ファイルのパス:', mapPath);
      
      // 背景地図のSVGファイルを読み込む
      const svgContent = await this._di.get('fileSystem').readFile(mapPath, 'utf8');
      
      // レンダラーとビューポートマネージャーを取得
      const renderer = this._di.get('renderer');
      const viewportManager = this._di.get('viewportManager');
      
      // SVG地図を解析して寸法を取得
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
      const svgElement = svgDoc.documentElement;
      
      // viewBoxを取得
      let mapWidth = 360;
      let mapHeight = 180;
      let originalViewBox = svgElement.getAttribute('viewBox');
      
      if (originalViewBox) {
        const [minX, minY, width, height] = originalViewBox.split(/\s+/).map(Number);
        mapWidth = width || 360;
        mapHeight = height || 180;
        console.log(`地図のviewBox: ${minX} ${minY} ${width} ${height}`);
      }
      
      // コンテナのサイズを取得
      const mapContainer = document.getElementById('map-container');
      const containerWidth = mapContainer.clientWidth;
      const containerHeight = mapContainer.clientHeight;
      
      // 適切なズーム値を計算（画面に収まるように）
      const widthRatio = containerWidth / mapWidth;
      const heightRatio = containerHeight / mapHeight;
      const zoom = Math.min(widthRatio, heightRatio) * 0.9; // 少し余裕を持たせる
      
      console.log(`計算されたズーム: ${zoom}`);
      
      // 先にビューポートを設定
      viewportManager.updateViewport({
        x: mapWidth / 2,
        y: mapHeight / 2,
        zoom: zoom
      });
      
      // 背景地図を読み込む
      renderer.loadBackgroundMap(svgContent);
      
      console.log('背景地図を読み込みました');
    } catch (error) {
      console.error('背景地図の読み込みに失敗しました', error);
      console.error('エラーの詳細:', error.message);
      console.error(error.stack);
    }
  }
}

// アプリケーションのインスタンスを作成
const app = new TimeMapApp();

// DOMコンテンツロード後に初期化
document.addEventListener('DOMContentLoaded', () => {
  app.initialize();
});

// グローバルアクセス用
window.timeMapApp = app;