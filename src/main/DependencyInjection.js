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
// UseCase分割後のファイル (AddFeatureUseCase など) は EditFeatureUseCase 内部でインスタンス化
import { IPolygonEditService } from '../application/services/IPolygonEditService'; // インターフェースをインポート
import { PolygonEditService } from '../application/services/PolygonEditService'; // 実装クラスをインポート

// --- ここまで分割されたUseCase/Service ---
import { NavigateTimeUseCase } from '../application/usecases/NavigateTimeUseCase';
import { ManageLayersUseCase } from '../application/usecases/ManageLayersUseCase';
import { UpdateProjectSettingsUseCase } from '../application/usecases/UpdateProjectSettingsUseCase'; // 新規インポート

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
    // ViewportManager の初期設定で worldWidth を渡すようにする
    // (ConfigManager から取得するのが理想だが、ここでは直接指定)
    const worldWidth = this._container.configManager.get('map.worldWidth', 360); // worldWidth はアプリ全体設定として残すか検討の余地あり。プロジェクト固有の場合もあるため。現状はConfigManagerから。
    this._container.viewportManager = new ViewportManager({ worldWidth: worldWidth });
  }

  /**
   * ドメインサービスの登録
   * @private
   */
  _registerDomainServices() {
    this._container.geometryService = new GeometryService();
    this._container.timeService = new TimeService(); // カレンダー設定はConfigManagerから後で適用
    this._container.layerService = new LayerService();
  }

  /**
   * アプリケーションサービスの登録
   * @private
   */
  _registerApplicationServices() {
    this._container.eventBus = new EventBus();

    // --- PolygonEditServiceの実装を登録 ---
    // ダミー実装ではなく、実際の実装クラスを使用する
    // ID生成関数は EditFeatureUseCase のものを参照させる
    const generateIdFunc = (type) => {
        // EditFeatureUseCaseインスタンスがまだないので、暫定的にここで生成ロジックを持つ
        // EditFeatureUseCase生成後に参照を差し替えるのが理想だが、循環依存の問題があるため注意
        // → EditFeatureUseCase 側に getter を用意するか、DIコンテナが解決する仕組みが必要
        // 今回は EditFeatureUseCase の実装を仮定して、似たロジックで生成
        const timestamp = new Date().getTime();
        const random = Math.floor(Math.random() * 10000);
        return `${type}-${timestamp}-${random}`;
    };
    this._container.polygonEditService = new PolygonEditService(
        this._container.worldRepository,
        generateIdFunc // ★ 暫定ID生成関数
    );
    // --- ここまで PolygonEditService 登録 ---

    // ファサードの EditFeatureUseCase を登録し、必要なサービスを注入
    this._container.editFeatureUseCase = new EditFeatureUseCase(
      this._container.worldRepository,
      this._container.geometryService,
      this._container.layerService,
      this._container.polygonEditService // ★ 実装を注入
    );
    // ★ PolygonEditService に EditFeatureUseCase のID生成関数を正しく渡す
    // EditFeatureUseCase インスタンス生成後に PolygonEditService の参照を更新するか、
    // EditFeatureUseCase コンストラクタ内で PolygonEditService に関数を渡す
    // → EditFeatureUseCaseコンストラクタ内で、自身の _generateId を PolygonEditService に注入するのが良さそう
    //    (ただし、現状はそうなっていないため、暫定対応として上記 generateIdFunc を使用)
    //    EditFeatureUseCaseのコンストラクタを修正するのが本筋だが、今回は影響範囲を最小限にするため見送り

    this._container.navigateTimeUseCase = new NavigateTimeUseCase(
      this._container.timeService
    );

    this._container.manageLayersUseCase = new ManageLayersUseCase(
      this._container.worldRepository,
      this._container.layerService
    );

    this._container.updateProjectSettingsUseCase = new UpdateProjectSettingsUseCase( // 新規登録
        this._container.worldRepository
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
    // ViewModel, Renderer, View, Controller の生成
    this._container.editingViewModel = new EditingViewModel(
      this._container.editFeatureUseCase, // ファサードを注入
      this._container.eventBus
    );
    this._container.mapViewModel = new MapViewModel(
      this._container.editFeatureUseCase, // ファサードを注入
      this._container.navigateTimeUseCase,
      this._container.manageLayersUseCase,
      this._container.geometryService, // GeometryService を注入
      this._container.eventBus,
      this._container.updateProjectSettingsUseCase // UpdateProjectSettingsUseCase を注入
    );
    this._container.timelineViewModel = new TimelineViewModel(
      this._container.navigateTimeUseCase,
      this._container.eventBus
    );
    this._container.renderer = new SVGRenderer(
      mapContainer,
      { /* オプションは ConfigManager から取得するが、プロジェクト固有グリッド設定は削除 */ }
    );
    this._container.mapView = new MapView(
      mapContainer,
      this._container.mapViewModel,
      this._container.editingViewModel,
      this._container.viewportManager,
      this._container.renderer,
      this._container.configManager // ConfigManager を注入
    );
    this._container.timelineView = new TimelineView(
      timelineContainer,
      this._container.timelineViewModel
    );
    this._container.toolbarView = new ToolbarView(
      toolbarContainer,
      this._container.editingViewModel,
      this._container.mapView // MapView を注入
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
    if (!this._container[name]) {
        console.error(`Dependency not found: ${name}`);
        // エラーを投げるか、null/undefined を返すか
        // throw new Error(`Dependency not found: ${name}`);
    }
    return this._container[name];
  }
}
