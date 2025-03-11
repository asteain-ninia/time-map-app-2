import { FileSystem } from '../infrastructure/persistence/FileSystem';
import { JSONSerializer } from '../infrastructure/persistence/JSONSerializer';
import { JSONWorldRepository } from '../infrastructure/persistence/JSONWorldRepository';
import { SVGRenderer } from '../infrastructure/rendering/SVGRenderer';
import { ViewportManager } from '../infrastructure/rendering/ViewportManager';
import { Logger } from '../infrastructure/services/Logger';
import { ConfigManager } from '../infrastructure/services/ConfigManager';

import { GeometryService } from '../domain/services/GeometryService';
import { TimeService } from '../domain/services/TimeService';
import { LayerService } from '../domain/services/LayerService';

import { EditFeatureUseCase } from '../application/usecases/EditFeatureUseCase';
import { NavigateTimeUseCase } from '../application/usecases/NavigateTimeUseCase';
import { ManageLayersUseCase } from '../application/usecases/ManageLayersUseCase';

import { MapViewModel } from '../presentation/view-models/MapViewModel';
import { TimelineViewModel } from '../presentation/view-models/TimelineViewModel';
import { EditingViewModel } from '../presentation/view-models/EditingViewModel';

import { MapView } from '../presentation/views/MapView';
import { TimelineView } from '../presentation/views/TimelineView';
import { ToolbarView } from '../presentation/views/ToolbarView';
import { SidebarView } from '../presentation/views/SidebarView';

import { MapController } from '../presentation/controllers/MapController';
import { TimelineController } from '../presentation/controllers/TimelineController';
import { ToolController } from '../presentation/controllers/ToolController';

import { EventBus } from '../presentation/EventBus';

/**
 * アプリケーションの依存性注入を管理するクラス
 */
export class DependencyInjection {
  constructor() {
    this._container = {};
  }

  /**
   * 依存性を初期化
   * @param {HTMLElement} mapContainer - マップコンテナ要素
   * @param {HTMLElement} timelineContainer - タイムラインコンテナ要素
   * @param {HTMLElement} toolbarContainer - ツールバーコンテナ要素
   * @param {HTMLElement} sidebarContainer - サイドバーコンテナ要素
   */
  initialize(mapContainer, timelineContainer, toolbarContainer, sidebarContainer) {
    // インフラストラクチャ層の依存性を登録
    this._registerInfrastructureServices();
    
    // ドメイン層の依存性を登録
    this._registerDomainServices();
    
    // アプリケーション層の依存性を登録
    this._registerApplicationServices();
    
    // プレゼンテーション層の依存性を登録
    this._registerPresentationServices(
      mapContainer,
      timelineContainer,
      toolbarContainer,
      sidebarContainer
    );
  }

  /**
   * インフラストラクチャサービスの登録
   * @private
   */
  _registerInfrastructureServices() {
    // 基本サービス
    this._container.logger = new Logger(3); // INFO レベルで初期化
    this._container.configManager = new ConfigManager();
    
    // 永続化サービス
    this._container.fileSystem = new FileSystem();
    this._container.jsonSerializer = new JSONSerializer();
    this._container.worldRepository = new JSONWorldRepository(
      this._container.fileSystem,
      this._container.jsonSerializer
    );
    
    // レンダリングサービス
    this._container.viewportManager = new ViewportManager({
      width: 800,
      height: 600,
      minZoom: 0.1,
      maxZoom: 10
    });
  }

  /**
   * ドメインサービスの登録
   * @private
   */
  _registerDomainServices() {
    this._container.geometryService = new GeometryService();
    this._container.timeService = new TimeService();
    this._container.layerService = new LayerService();
  }

  /**
   * アプリケーションサービスの登録
   * @private
   */
  _registerApplicationServices() {
    // イベントバス
    this._container.eventBus = new EventBus();
    
    // ユースケース
    this._container.editFeatureUseCase = new EditFeatureUseCase(
      this._container.worldRepository,
      this._container.geometryService,
      this._container.layerService
    );
    
    this._container.navigateTimeUseCase = new NavigateTimeUseCase(
      this._container.timeService
    );
    
    this._container.manageLayersUseCase = new ManageLayersUseCase(
      this._container.worldRepository,
      this._container.layerService
    );
  }

  /**
   * プレゼンテーションサービスの登録
   * @param {HTMLElement} mapContainer - マップコンテナ要素
   * @param {HTMLElement} timelineContainer - タイムラインコンテナ要素
   * @param {HTMLElement} toolbarContainer - ツールバーコンテナ要素
   * @param {HTMLElement} sidebarContainer - サイドバーコンテナ要素
   * @private
   */
  _registerPresentationServices(
    mapContainer,
    timelineContainer,
    toolbarContainer,
    sidebarContainer
  ) {
    // ビューモデル
    this._container.mapViewModel = new MapViewModel(
      this._container.editFeatureUseCase,
      this._container.navigateTimeUseCase,
      this._container.manageLayersUseCase,
      this._container.geometryService,
      this._container.eventBus
    );
    
    this._container.timelineViewModel = new TimelineViewModel(
      this._container.navigateTimeUseCase,
      this._container.eventBus
    );
    
    this._container.editingViewModel = new EditingViewModel(
      this._container.editFeatureUseCase,
      this._container.eventBus
    );
    
    // レンダラー
    this._container.renderer = new SVGRenderer(
      mapContainer,
      { width: mapContainer.clientWidth, height: mapContainer.clientHeight }
    );
    
    // ビュー
    this._container.mapView = new MapView(
      mapContainer,
      this._container.mapViewModel,
      this._container.editingViewModel,
      this._container.viewportManager,
      this._container.renderer,
      this._container.configManager
    );
    
    this._container.timelineView = new TimelineView(
      timelineContainer,
      this._container.timelineViewModel
    );
    
    this._container.toolbarView = new ToolbarView(
      toolbarContainer,
      this._container.editingViewModel,
      this._container.mapView
    );
    
    this._container.sidebarView = new SidebarView(
      sidebarContainer,
      this._container.mapViewModel,
      this._container.manageLayersUseCase,
      this._container.editFeatureUseCase,
      this._container.eventBus
    );
    
    // コントローラ
    this._container.mapController = new MapController(
      this._container.mapView,
      this._container.mapViewModel,
      this._container.editingViewModel,
      this._container.viewportManager
    );
    
    this._container.timelineController = new TimelineController(
      this._container.timelineView,
      this._container.timelineViewModel
    );
    
    this._container.toolController = new ToolController(
      this._container.toolbarView,
      this._container.editingViewModel
    );
  }

  /**
   * コンテナから依存性を取得
   * @param {string} name - 依存性の名前
   * @returns {*} 依存オブジェクト
   */
  get(name) {
    return this._container[name];
  }
}