// src/main/DependencyInjection.js

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

import { IdGenerationService } from '../application/services/IdGenerationService';
// --- History関連サービス ---
import { HistoryStackManager } from '../application/services/history/HistoryStackManager.js';
import { HistorySerializer } from '../application/services/history/HistorySerializer.js';
import { OperationEngine } from '../application/services/history/OperationEngine.js';
import { HistoryService } from '../application/services/HistoryService.js';

import { EditFeatureUseCase } from '../application/usecases/EditFeatureUseCase';
import { IPolygonEditService } from '../application/services/IPolygonEditService';
import { PolygonEditService } from '../application/services/PolygonEditService';

import { NavigateTimeUseCase } from '../application/usecases/NavigateTimeUseCase';
import { ManageLayersUseCase } from '../application/usecases/ManageLayersUseCase';
import { UpdateProjectSettingsUseCase } from '../application/usecases/UpdateProjectSettingsUseCase';

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
  constructor() { this._container = {}; }

  /**
   * 依存性を初期化
   * @param {HTMLElement} mapContainer - マップコンテナ要素
   * @param {HTMLElement} timelineContainer - タイムラインコンテナ要素
   * @param {HTMLElement} toolbarContainer - ツールバーコンテナ要素
   * @param {HTMLElement} sidebarContainer - サイドバーコンテナ要素
   */
  initialize(mapContainer, timelineContainer, toolbarContainer, sidebarContainer) {
    this._registerInfrastructureServices();
    this._registerDomainServices();
    this._registerApplicationServices();
    this._registerPresentationServices(mapContainer, timelineContainer, toolbarContainer, sidebarContainer);
  }

  _registerInfrastructureServices() {
    this._container.logger = new Logger(3);
    this._container.configManager = new ConfigManager(); // maxHistorySizeはここから取得も可
    this._container.fileSystem = new FileSystem();
    this._container.jsonSerializer = new JSONSerializer(); // これはWorldRepository用
    this._container.worldRepository = new JSONWorldRepository(this._container.fileSystem, this._container.jsonSerializer);
    const worldWidth = 360; // ConfigManagerから取得する方が望ましい
    this._container.viewportManager = new ViewportManager({ worldWidth: worldWidth });
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
    this._container.eventBus = new EventBus();
    this._container.idGenerationService = new IdGenerationService();
    this._container.polygonEditService = new PolygonEditService(this._container.worldRepository, this._container.idGenerationService);

    // EditFeatureUseCase を先に登録 (History関連サービスが依存する可能性)
    this._container.editFeatureUseCase = new EditFeatureUseCase(
      this._container.worldRepository,
      this._container.geometryService,
      this._container.layerService,
      this._container.polygonEditService,
      this._container.idGenerationService
    );

    // --- History 関連サービスの登録 ---
    const maxHistorySize = this._container.configManager.get('history.maxSize', 100); // ConfigManagerから取得 (なければデフォルト)
    this._container.historyStackManager = new HistoryStackManager(maxHistorySize);
    this._container.historySerializer = new HistorySerializer(); // 依存なし
    this._container.operationEngine = new OperationEngine(
        this._container.worldRepository,      // WorldRepositoryを渡す
        this._container.historySerializer,    // HistorySerializerを渡す
        this._container.editFeatureUseCase    // EditFeatureUseCaseを渡す
    );
    this._container.historyService = new HistoryService( // ファサード
        this._container.historyStackManager,
        this._container.historySerializer,
        this._container.operationEngine,
        this._container.eventBus,
        this._container.worldRepository,
        this._container.editFeatureUseCase    // HistoryServiceもEditFeatureUseCaseを持つ
    );
    // --- History 関連サービスここまで ---

    this._container.navigateTimeUseCase = new NavigateTimeUseCase(this._container.timeService);
    this._container.manageLayersUseCase = new ManageLayersUseCase(this._container.worldRepository, this._container.layerService);
    this._container.updateProjectSettingsUseCase = new UpdateProjectSettingsUseCase(this._container.worldRepository);
  }

    /**
   * プレゼンテーションサービスの登録
   * @param {HTMLElement} mapContainer - マップコンテナ要素
   * @param {HTMLElement} timelineContainer - タイムラインコンテナ要素
   * @param {HTMLElement} toolbarContainer - ツールバーコンテナ要素
   * @param {HTMLElement} sidebarContainer - サイドバーコンテナ要素
   * @private
   */
  _registerPresentationServices(mapContainer, timelineContainer, toolbarContainer, sidebarContainer) {
    this._container.editingViewModel = new EditingViewModel( // historyServiceを注入
      this._container.editFeatureUseCase,
      this._container.eventBus,
      this._container.historyService // HistoryServiceファサードを渡す
    );
    // MapViewModel, TimelineViewModel, Renderer, Views, Controllers は変更なし
    this._container.mapViewModel = new MapViewModel(this._container.editFeatureUseCase, this._container.navigateTimeUseCase, this._container.manageLayersUseCase, this._container.geometryService, this._container.eventBus, this._container.updateProjectSettingsUseCase);
    this._container.timelineViewModel = new TimelineViewModel(this._container.navigateTimeUseCase, this._container.eventBus);
    this._container.renderer = new SVGRenderer(mapContainer, {});
    this._container.mapView = new MapView(mapContainer, this._container.mapViewModel, this._container.editingViewModel, this._container.viewportManager, this._container.renderer, this._container.configManager);
    this._container.timelineView = new TimelineView(timelineContainer, this._container.timelineViewModel);
    this._container.toolbarView = new ToolbarView(toolbarContainer, this._container.editingViewModel, this._container.mapView);
    this._container.sidebarView = new SidebarView(sidebarContainer, this._container.mapViewModel, this._container.manageLayersUseCase, this._container.editingViewModel, this._container.eventBus);
    this._container.mapController = new MapController(this._container.mapView, this._container.mapViewModel, this._container.editingViewModel, this._container.viewportManager);
    this._container.timelineController = new TimelineController(this._container.timelineView, this._container.timelineViewModel);
    this._container.toolController = new ToolController(this._container.toolbarView, this._container.editingViewModel);
  }

  /**
   * コンテナから依存性を取得
   * @param {string} name - 依存性の名前
   * @returns {*} 依存オブジェクト
   */
  get(name) {
    if (!this._container[name]) {
        console.error(`Dependency not found: ${name}`);
    }
    return this._container[name];
  }
}
