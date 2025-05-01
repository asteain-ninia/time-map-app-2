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

// 元のEditFeatureUseCase（ファサード）をインポート
import { EditFeatureUseCase } from '../application/usecases/EditFeatureUseCase';
// --- ここから分割されたUseCase/Service ---
// import { AddFeatureUseCase } from '../application/usecases/feature/AddFeatureUseCase';
// import { UpdateFeatureUseCase } from '../application/usecases/feature/UpdateFeatureUseCase';
// import { DeleteFeatureUseCase } from '../application/usecases/feature/DeleteFeatureUseCase';
// import { VertexEditUseCase } from '../application/usecases/feature/VertexEditUseCase';
import { IPolygonEditService } from '../application/services/IPolygonEditService'; // インターフェースをインポート
// --- ここまで分割されたUseCase/Service ---
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
    this._container.logger = new Logger(3);
    this._container.configManager = new ConfigManager();
    this._container.fileSystem = new FileSystem();
    this._container.jsonSerializer = new JSONSerializer();
    this._container.worldRepository = new JSONWorldRepository(
      this._container.fileSystem,
      this._container.jsonSerializer
    );
    this._container.viewportManager = new ViewportManager({ /* ... options ... */ });
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

    // --- PolygonEditServiceのダミー実装 (フェーズ2で実実装に置き換え) ---
    // IPolygonEditService を継承する形でダミー実装を提供
    class DummyPolygonEditService extends IPolygonEditService {
        async validatePolygonRings(polygon, world) { console.warn("DummyPolygonEditService.validatePolygonRings called"); }
        async addRingToPolygon(polygonId, ringData) { console.warn("DummyPolygonEditService.addRingToPolygon called"); return null; }
        async removeRingFromPolygon(polygonId, ringId) { console.warn("DummyPolygonEditService.removeRingFromPolygon called"); return null; }
        async updateRingVertices(polygonId, ringId, newVertexIds) { console.warn("DummyPolygonEditService.updateRingVertices called"); return null; }
        async updatePolygonGeometry(currentPolygon, geometryUpdates, world) { console.warn("DummyPolygonEditService.updatePolygonGeometry called"); return currentPolygon; } // 現状の動作を維持
        async splitPolygon(polygonId, divisionData) { console.warn("DummyPolygonEditService.splitPolygon called"); return { newPolygons: [] }; }
    }
    this._container.polygonEditService = new DummyPolygonEditService();
    // --- ここまでダミー実装 ---

    // ファサードの EditFeatureUseCase を登録し、必要なサービスを注入
    this._container.editFeatureUseCase = new EditFeatureUseCase(
      this._container.worldRepository,
      this._container.geometryService,
      this._container.layerService,
      this._container.polygonEditService // 注入
    );
    // 注意: 分割されたUseCase (AddFeatureUseCaseなど) は EditFeatureUseCase 内部で
    //       インスタンス化されるため、ここでは登録不要。

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
    // --- 変更なし ---
    // ViewModel, Renderer, View, Controller の生成
    // EditingViewModel は EditFeatureUseCase (ファサード) を受け取る
    // MapViewModel は EditFeatureUseCase (ファサード) を受け取る
    // SidebarView は EditingViewModel を受け取る
    // ... (元のコードと同じ) ...
    this._container.editingViewModel = new EditingViewModel(
      this._container.editFeatureUseCase, // ファサードを注入
      this._container.eventBus
    );
    this._container.mapViewModel = new MapViewModel(
      this._container.editFeatureUseCase, // ファサードを注入
      this._container.navigateTimeUseCase,
      this._container.manageLayersUseCase,
      this._container.geometryService,
      this._container.eventBus
    );
    this._container.timelineViewModel = new TimelineViewModel(
      this._container.navigateTimeUseCase,
      this._container.eventBus
    );
    this._container.renderer = new SVGRenderer(
      mapContainer,
      { width: mapContainer.clientWidth, height: mapContainer.clientHeight }
    );
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
      this._container.editingViewModel, // EditingViewModel を注入
      this._container.eventBus
    );
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
