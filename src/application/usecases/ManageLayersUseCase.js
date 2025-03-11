import { Layer } from '../../domain/entities/Layer';

/**
 * レイヤー管理を処理するユースケース
 */
export class ManageLayersUseCase {
  /**
   * ユースケースを作成
   * @param {WorldRepository} worldRepository - 世界データリポジトリ
   * @param {LayerService} layerService - レイヤーサービス
   */
  constructor(worldRepository, layerService) {
    this._worldRepository = worldRepository;
    this._layerService = layerService;
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
    
    // 次のレイヤー順序を決定
    const nextOrder = world.layers.length > 0 
      ? Math.max(...world.layers.map(l => l.order)) + 1
      : 0;
    
    // 新しいレイヤーを作成
    const layerId = `layer-${new Date().getTime()}`;
    const newLayer = new Layer(layerId, name, nextOrder, true, 1.0, description);
    
    // 世界データに追加
    world.layers.push(newLayer);
    
    // レイヤー階層を検証
    const isValid = this._layerService.validateLayerHierarchy(world.layers);
    if (!isValid) {
      throw new Error('Layer hierarchy validation failed');
    }
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
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
    
    // レイヤーを検索
    const layerIndex = world.layers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) {
      throw new Error(`Layer not found with ID: ${layerId}`);
    }
    
    let layer = world.layers[layerIndex];
    
    // 更新内容に応じてレイヤーを変更
    if (updates.name !== undefined) {
      layer = layer.withName(updates.name);
    }
    
    if (updates.visible !== undefined) {
      layer = layer.withVisibility(updates.visible);
    }
    
    if (updates.opacity !== undefined) {
      layer = layer.withOpacity(updates.opacity);
    }
    
    if (updates.description !== undefined) {
      layer = layer.withDescription(updates.description);
    }
    
    // 更新されたレイヤーを置き換え
    world.layers[layerIndex] = layer;
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return layer;
  }

  /**
   * レイヤーを削除
   * @param {string} layerId - 削除するレイヤーのID
   * @returns {Promise<void>}
   */
  async deleteLayer(layerId) {
    const world = await this._worldRepository.getWorld();
    
    // レイヤーを検索
    const layerIndex = world.layers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) {
      throw new Error(`Layer not found with ID: ${layerId}`);
    }
    
    const layer = world.layers[layerIndex];
    
    // このレイヤーに関連するオブジェクトがあるか確認
    const hasRelatedFeatures = world.features.some(f => f.layerId === layerId);
    if (hasRelatedFeatures) {
      throw new Error('Cannot delete a layer that has related features');
    }
    
    // レイヤーを削除
    world.layers.splice(layerIndex, 1);
    
    // レイヤー順序を再整理
    world.layers.sort((a, b) => a.order - b.order);
    
    for (let i = 0; i < world.layers.length; i++) {
      if (world.layers[i].order !== i) {
        const updatedLayer = world.layers[i].withOrder(i);
        world.layers[i] = updatedLayer;
      }
    }
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
  }

  /**
   * レイヤーの順序を変更
   * @param {string} layerId - 移動するレイヤーのID
   * @param {number} newOrder - 新しい順序
   * @returns {Promise<Layer[]>} 更新されたレイヤーの配列
   */
  async reorderLayer(layerId, newOrder) {
    const world = await this._worldRepository.getWorld();
    
    // レイヤーを検索
    const layerIndex = world.layers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) {
      throw new Error(`Layer not found with ID: ${layerId}`);
    }
    
    const layer = world.layers[layerIndex];
    const oldOrder = layer.order;
    
    // 有効範囲内の順序に調整
    newOrder = Math.max(0, Math.min(world.layers.length - 1, newOrder));
    
    // 順序が変わらない場合は何もしない
    if (oldOrder === newOrder) {
      return world.layers;
    }
    
    // レイヤーの順序を更新
    // 注意: 実際の実装では、レイヤーの階層変更によって、
    // 関連するポリゴンの親子関係を再検証する必要があります。
    
    // 一旦レイヤーを取り除く
    world.layers.splice(layerIndex, 1);
    
    // 新しい順序で再配置
    let updatedLayers = [...world.layers];
    updatedLayers.splice(newOrder, 0, layer);
    
    // 順序を再設定
    updatedLayers = updatedLayers.map((l, index) => {
      if (l.order !== index) {
        const updatedLayer = new Layer(
          l.id, l.name, index, l.visible, l.opacity, l.description
        );
        return updatedLayer;
      }
      return l;
    });
    
    // 更新されたレイヤーで置き換え
    world.layers = updatedLayers;
    
    // レイヤー階層を検証
    const isValid = this._layerService.validateLayerHierarchy(world.layers);
    if (!isValid) {
      throw new Error('Layer hierarchy validation failed');
    }
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return world.layers;
  }
}