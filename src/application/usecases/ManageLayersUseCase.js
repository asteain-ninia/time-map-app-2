import { Layer } from '../../domain/entities/Layer';

/**
 * レイヤー管理を処理するユースケース
 */
export class ManageLayersUseCase {
  /**
   * ユースケースを作成
   * @param {WorldRepository} worldRepository - 世界データリポジトリ
   * @param {LayerService} layerService - レイヤーサービス
   * @param {IdGenerationService|null} idGenerationService - ID生成サービス
   */
  constructor(worldRepository, layerService, idGenerationService = null) {
    this._worldRepository = worldRepository;
    this._layerService = layerService;
    this._idGenerationService = idGenerationService;
    this._localIdCounter = 0;
  }

  /**
   * すべてのレイヤーを取得
   * @returns {Promise<Layer[]>} レイヤーの配列
   */
  async getLayers() {
    const world = await this._worldRepository.getWorld();
    return world.layers;
  }

  /**
   * レイヤーを追加
   * @param {string} name - レイヤー名
   * @param {string} [description=""] - 説明
   * @returns {Promise<Layer>} 追加されたレイヤー
   */
  async addLayer(name, description = "") {
    const world = await this._worldRepository.getWorld();
    const currentLayers = Array.isArray(world.layers) ? world.layers : [];

    // 次のレイヤー順序を決定
    const nextOrder = currentLayers.length > 0
      ? Math.max(...currentLayers.map(l => l.order)) + 1
      : 0;

    // 新しいレイヤーを作成
    const layerId = this._createUniqueLayerId(currentLayers);
    const newLayer = new Layer(layerId, name, nextOrder, true, 1.0, description);

    // レイヤー階層を検証
    const proposedLayers = [...currentLayers, newLayer];
    const isValid = this._layerService.validateLayerHierarchy(proposedLayers);
    if (!isValid) {
      throw new Error('Layer hierarchy validation failed');
    }

    // 世界データを保存
    const updatedWorld = this._buildWorldWithLayers(world, proposedLayers);

    await this._worldRepository.saveWorld(updatedWorld);
    this._replaceLayersInPlace(world, updatedWorld.layers);

    return newLayer;
  }

  /**
   * レイヤーを更新
   * @param {string} layerId - 更新するレイヤーのID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Layer>} 更新されたレイヤー
   */
  async updateLayer(layerId, updates) {
    const world = await this._worldRepository.getWorld();
    const currentLayers = Array.isArray(world.layers) ? world.layers : [];

    // レイヤーを検索
    const layerIndex = currentLayers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) {
      throw new Error(`Layer not found with ID: ${layerId}`);
    }

    let updatedLayer = currentLayers[layerIndex];

    // 更新内容に応じてレイヤーを変更
    if (updates.name !== undefined) {
      updatedLayer = updatedLayer.withName(updates.name);
    }

    if (updates.visible !== undefined) {
      updatedLayer = updatedLayer.withVisibility(updates.visible);
    }

    if (updates.opacity !== undefined) {
      updatedLayer = updatedLayer.withOpacity(updates.opacity);
    }

    if (updates.description !== undefined) {
      updatedLayer = updatedLayer.withDescription(updates.description);
    }

    const updatedLayers = currentLayers.map((layer, index) => index === layerIndex ? updatedLayer : layer);

    // 世界データを保存
    const updatedWorld = this._buildWorldWithLayers(world, updatedLayers);

    await this._worldRepository.saveWorld(updatedWorld);
    this._replaceLayersInPlace(world, updatedWorld.layers);

    return updatedLayer;
  }

  /**
   * レイヤーを削除
   * @param {string} layerId - 削除するレイヤーのID
   * @returns {Promise<void>}
   */
  async deleteLayer(layerId) {
    const world = await this._worldRepository.getWorld();
    const currentLayers = Array.isArray(world.layers) ? world.layers : [];

    // レイヤーを検索
    const layerIndex = currentLayers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) {
      throw new Error(`Layer not found with ID: ${layerId}`);
    }

    const layer = currentLayers[layerIndex];

    // このレイヤーに関連するオブジェクトがあるか確認
    const hasRelatedFeatures = world.features.some(f => f.layerId === layerId);
    if (hasRelatedFeatures) {
      throw new Error('Cannot delete a layer that has related features');
    }

    const remainingLayers = currentLayers.filter(l => l.id !== layerId);
    const sortedLayers = [...remainingLayers].sort((a, b) => a.order - b.order);
    const normalizedLayers = sortedLayers.map((l, index) => (l.order !== index ? l.withOrder(index) : l));

    // 世界データを保存
    const updatedWorld = this._buildWorldWithLayers(world, normalizedLayers);

    await this._worldRepository.saveWorld(updatedWorld);
    this._replaceLayersInPlace(world, updatedWorld.layers);
  }

  /**
   * レイヤーの順序を変更
   * @param {string} layerId - 移動するレイヤーのID
   * @param {number} newOrder - 新しい順序
   * @returns {Promise<Layer[]>} 更新されたレイヤーの配列
   */
  async reorderLayer(layerId, newOrder) {
    const world = await this._worldRepository.getWorld();
    const currentLayers = Array.isArray(world.layers) ? world.layers : [];

    // レイヤーを検索
    const layerIndex = currentLayers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) {
      throw new Error(`Layer not found with ID: ${layerId}`);
    }

    const layer = currentLayers[layerIndex];
    const oldOrder = layer.order;

    // 有効範囲内の順序に調整
    newOrder = Math.max(0, Math.min(currentLayers.length - 1, newOrder));

    // 順序が変わらない場合は何もしない
    if (oldOrder === newOrder) {
      return currentLayers;
    }

    // レイヤーの順序を更新
    // 注意: 実際の実装では、レイヤーの階層変更によって、
    // 関連するポリゴンの親子関係を再検証する必要があります。

    // 一旦レイヤーを取り除いた配列を作成
    const layersWithoutTarget = [
      ...currentLayers.slice(0, layerIndex),
      ...currentLayers.slice(layerIndex + 1)
    ];

    // 新しい順序で再配置
    const reorderedLayers = [...layersWithoutTarget];
    reorderedLayers.splice(newOrder, 0, layer);

    // 順序を再設定
    const normalizedLayers = reorderedLayers.map((l, index) => {
      if (l.order !== index) {
        return l.withOrder(index);
      }
      return l;
    });

    // レイヤー階層を検証
    const isValid = this._layerService.validateLayerHierarchy(normalizedLayers);
    if (!isValid) {
      throw new Error('Layer hierarchy validation failed');
    }

    // 世界データを保存
    const updatedWorld = this._buildWorldWithLayers(world, normalizedLayers);

    await this._worldRepository.saveWorld(updatedWorld);
    this._replaceLayersInPlace(world, updatedWorld.layers);

    return updatedWorld.layers;
  }

  /**
   * 新しいレイヤー配列を反映した世界データを構築する
   * @param {Object} world - 元の世界データ
   * @param {Layer[]} layers - 反映するレイヤー配列
   * @returns {Object} 新しい世界データ
   * @private
   */
  _buildWorldWithLayers(world, layers) {
    return {
      ...world,
      layers: Array.isArray(layers) ? [...layers] : []
    };
  }

  /**
   * 永続化成功後に元のworldオブジェクトへレイヤー配列を反映する
   * @param {Object} targetWorld - 永続化前に取得した世界データ
   * @param {Layer[]} layers - 反映するレイヤー配列
   * @private
   */
  _replaceLayersInPlace(targetWorld, layers) {
    const nextLayers = Array.isArray(layers) ? [...layers] : [];
    if (!Array.isArray(targetWorld.layers)) {
      targetWorld.layers = nextLayers;
      return;
    }
    targetWorld.layers.splice(0, targetWorld.layers.length, ...nextLayers);
  }

  /**
   * レイヤーIDを生成する
   * @param {Layer[]} existingLayers - 既存レイヤー配列
   * @returns {string} 一意のレイヤーID
   * @private
   */
  _createUniqueLayerId(existingLayers) {
    const existingIds = new Set(Array.isArray(existingLayers) ? existingLayers.map(layer => layer.id) : []);
    const maxAttempts = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = this._generateLayerIdCandidate();
      if (!existingIds.has(candidate)) {
        return candidate;
      }
    }

    throw new Error('Failed to generate unique layer ID after multiple attempts');
  }

  /**
   * レイヤーID候補を生成する
   * @returns {string} レイヤーID候補
   * @private
   */
  _generateLayerIdCandidate() {
    if (this._idGenerationService && typeof this._idGenerationService.generateId === 'function') {
      const generated = this._idGenerationService.generateId('layer');
      if (typeof generated === 'string' && generated.length > 0) {
        return generated;
      }
    }

    const timestamp = Date.now();
    const counter = this._localIdCounter++;
    const random = Math.floor(Math.random() * 1000000);
    return `layer-${timestamp}-${counter}-${random}`;
  }
}
