import { Polygon } from '../../../domain/entities/Polygon';

/**
 * 地理オブジェクトの削除を専門に処理するユースケース
 */
export class DeleteFeatureUseCase {
  /**
   * @param {WorldRepository} worldRepository
   * @param {Function} cleanupUnusedVertices - 頂点クリーンアップ関数 (EditFeatureUseCaseから提供)
   */
  constructor(worldRepository, cleanupUnusedVertices) {
    this._worldRepository = worldRepository;
    this._cleanupUnusedVertices = cleanupUnusedVertices;
  }

  /**
   * 地理オブジェクトを削除
   * @param {string} featureId - 削除するオブジェクトのID
   * @returns {Promise<void>}
   */
  async execute(featureId) {
    const world = await this._worldRepository.getWorld();

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      console.warn(`Feature not found with ID during deletion: ${featureId}`);
      return;
    }

    const feature = world.features[featureIndex];
    if (!feature) {
        console.error(`Invalid feature data found at index ${featureIndex} for ID ${featureId}`);
        world.features.splice(featureIndex, 1);
        await this._worldRepository.saveWorld(world);
        return;
    }

    // 削除対象の全頂点IDを収集
    const vertexIdsToCheck = new Set();
    if (feature.vertexIds) feature.vertexIds.forEach(id => vertexIdsToCheck.add(id));
    if (feature instanceof Polygon) {
        (feature.holesVertexIds || []).forEach(hole => hole.forEach(id => vertexIdsToCheck.add(id)));
        if(feature.isMultiPolygon && feature.subPolygons) {
            feature.subPolygons.forEach(sub => {
                (sub.vertexIds || []).forEach(id => vertexIdsToCheck.add(id));
                (sub.holesVertexIds || []).forEach(hole => hole.forEach(id => vertexIdsToCheck.add(id)));
            });
        }
    }


    // ポリゴンの依存関係チェックと処理
    if (feature instanceof Polygon) {
      // 下位領域チェック
      if (feature.hasChildren()) {
        throw new Error('Cannot delete a polygon that has child polygons. Remove children first.');
      }
      // 親ポリゴンの子IDリストから削除
      if (feature.parentId && feature.parentId !== "0") { // parentId が null や undefined でないことも確認
        const parentIndex = world.features.findIndex(f => f.id === feature.parentId);
        if (parentIndex !== -1) {
          const parent = world.features[parentIndex];
          if (parent instanceof Polygon && typeof parent.removeChildId === 'function') {
            const updatedParent = parent.removeChildId(featureId);
            world.features[parentIndex] = updatedParent;
          } else {
            console.warn(`Parent feature ${feature.parentId} is not a valid Polygon or lacks removeChildId method.`);
          }
        }
      }
    }

    // オブジェクトを削除
    world.features.splice(featureIndex, 1);
    console.log(`Deleted feature ${featureId}`);

    // 使われなくなった頂点をクリーンアップ (EditFeatureUseCaseのヘルパーを利用)
    this._cleanupUnusedVertices(world, Array.from(vertexIdsToCheck));

    // 世界データを保存
    await this._worldRepository.saveWorld(world);
  }
}