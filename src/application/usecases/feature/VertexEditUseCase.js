// src\application\usecases\feature\VertexEditUseCase.js

import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon'; // ★ Polygon をインポート
import { Vertex } from '../../../domain/entities/Vertex'; // 比較用

/**
 * 頂点の編集（移動、共有、削除）を専門に処理するユースケース
 */
export class VertexEditUseCase {
  /**
   * @param {WorldRepository} worldRepository
   * @param {GeometryService} geometryService - 衝突判定用に保持
   * @param {Function} cleanupUnusedVertices - 頂点クリーンアップ関数 (EditFeatureUseCaseから提供)
   * @param {Function} generateId - ID生成関数 (EditFeatureUseCaseから提供)
   * @param {Function} getOlderVertexId - 古い頂点ID判定関数 (EditFeatureUseCaseから提供)
   */
  constructor(worldRepository, geometryService, cleanupUnusedVertices, generateId, getOlderVertexId) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService; // 衝突判定用に保持
    this._cleanupUnusedVertices = cleanupUnusedVertices;
    this._generateId = generateId;
    this._getOlderVertexId = getOlderVertexId;
  }

  /**
   * 複数の頂点を削除し、関連する地物を更新または削除
   * @param {string[]} vertexIdsToDelete - 削除する頂点のID配列
   * @returns {Promise<{deletedVertexIds: string[], updatedFeatureIds: string[], deletedFeatureIds: string[]}>} 影響結果
   */
  async deleteVertices(vertexIdsToDelete) {
    console.log(`[VertexEditUseCase] deleteVertices called with:`, vertexIdsToDelete);
    if (!vertexIdsToDelete || vertexIdsToDelete.length === 0) {
        return { deletedVertexIds: [], updatedFeatureIds: [], deletedFeatureIds: [] };
    }
    const world = await this._worldRepository.getWorld();
    const verticesToDeleteSet = new Set(vertexIdsToDelete);

    const originalFeatures = world.features;
    const updatedFeatures = [];
    const updatedFeatureIds = new Set();
    const deletedFeatureIds = new Set();
    const parentUpdatesNeeded = new Map(); // 親ポリゴンの子ID削除用

    // 頂点ID配列から削除対象を除外するヘルパー関数
    const filterVertexIds = (ids) => ids?.filter(id => !verticesToDeleteSet.has(id)) || [];

    for (const feature of originalFeatures) {
        let currentFeature = feature;
        let needsUpdate = false;
        let featureShouldBeDeleted = false;
        const logPrefix = `[VertexEditUseCase] Feature ${feature?.id}:`;

        if (!(currentFeature instanceof Point || currentFeature instanceof Line || currentFeature instanceof Polygon)) {
            console.warn(`${logPrefix} Not a valid domain object instance. Skipping. Type: ${typeof currentFeature}`, currentFeature);
            updatedFeatures.push(currentFeature); // 有効でない地物はそのまま保持
            continue;
        }

        if (currentFeature instanceof Point) {
            if (currentFeature.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                featureShouldBeDeleted = true; // 点は頂点がなくなったら削除
            }
        } else if (currentFeature instanceof Line) {
            if (currentFeature.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                const newVertexIds = filterVertexIds(currentFeature.vertexIds);
                if (newVertexIds.length < 2) {
                    featureShouldBeDeleted = true; // 2頂点未満になったら線も削除
                } else {
                    // 線インスタンスを更新
                    currentFeature = currentFeature.withVertexIds(newVertexIds);
                    needsUpdate = true;
                }
            }
        } else if (currentFeature instanceof Polygon) {
            let polygonUpdated = false;
            const originalRings = currentFeature.rings;
            const newRings = [];
            const ringsToDelete = [];

            for (const ring of originalRings) {
                if (ring.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                    const newRingVertexIds = filterVertexIds(ring.vertexIds);
                    if (newRingVertexIds.length >= 3) {
                        // リングの頂点を更新 (Polygonインスタンスは後でまとめて更新)
                        newRings.push({ ...ring, vertexIds: newRingVertexIds });
                        polygonUpdated = true;
                    } else {
                        // リングが無効になった -> このリングは削除対象とする
                        ringsToDelete.push(ring.id);
                        polygonUpdated = true; // ポリゴン形状が変更された
                        // ★注意: このリングが他の穴リングの親だった場合の処理は
                        // PolygonEditService.removeRingFromPolygon の責務とする。
                        // ここでは単純に無効なリングを除外する。
                        // 子リングを持つリングを削除しようとするとremoveRingFromPolygonでエラーになる想定。
                        // しかし、現状 removeRingFromPolygon を直接呼んでいないので、
                        // 子が親を失うケースが発生しうる -> 後の検証でエラーになるはず。
                        // 将来的に、ここで removeRingFromPolygon を呼ぶか、
                        // PolygonEditService にリング削除を伴う頂点削除メソッドを設けるべきかもしれない。
                    }
                } else {
                    newRings.push(ring); // 変更なし
                }
            }

            if (polygonUpdated) {
                 // まず頂点ID配列が更新されたリングでポリゴンを更新
                 let tempPolygon = currentFeature;
                 for (const ring of newRings) {
                     const originalRing = originalRings.find(or => or.id === ring.id);
                     // JSON比較で変更があったか確認（より確実）
                     if (originalRing && JSON.stringify(originalRing.vertexIds) !== JSON.stringify(ring.vertexIds)) {
                          try {
                             tempPolygon = tempPolygon.withUpdatedRingVertices(ring.id, ring.vertexIds);
                          } catch (updateError) {
                              console.error(`${logPrefix} Error updating ring vertices for ring ${ring.id}:`, updateError);
                              // 更新に失敗した場合、このポリゴンをエラー状態として扱うか？
                              // ここではエラーをログ出力し、処理を続行する。
                          }
                     }
                 }
                 // 次に無効になったリングを削除 (インスタンス更新)
                 // ★注意: 依存関係チェックは Polygon.withRemovedRing が行う
                 for (const ringId of ringsToDelete) {
                     try {
                         tempPolygon = tempPolygon.withRemovedRing(ringId);
                     } catch (removeError) {
                          console.error(`${logPrefix} Error removing invalid ring ${ringId}:`, removeError);
                          // リング削除に失敗した場合（例: 子リングが依存している）
                          // ここで処理を中断すべきか？ あるいはエラーのまま進めるか？
                          // 暫定: エラーをログ出力し、削除されなかったものとして進める
                     }
                 }
                 currentFeature = tempPolygon;
                 needsUpdate = true;
            }

            // リング削除後、ポリゴンが空になったかチェック
            if (currentFeature.rings.length === 0 && !currentFeature.hasChildren()) {
                featureShouldBeDeleted = true; // リングも子もないポリゴンは削除
            }
        }

        // 最終的な地物を配列に追加または削除リストへ
        if (featureShouldBeDeleted) {
            deletedFeatureIds.add(currentFeature.id);
            // 親ポリゴンからの子ID削除が必要な場合、情報を記録
            if (currentFeature instanceof Polygon && currentFeature.parentId && currentFeature.parentId !== "0") {
                if (!parentUpdatesNeeded.has(currentFeature.parentId)) {
                    parentUpdatesNeeded.set(currentFeature.parentId, []);
                }
                parentUpdatesNeeded.get(currentFeature.parentId).push(currentFeature.id);
            }
        } else {
            updatedFeatures.push(currentFeature);
            if (needsUpdate) {
                updatedFeatureIds.add(currentFeature.id);
            }
        }
    }

    // 親ポリゴンの子IDリストを更新
    if (parentUpdatesNeeded.size > 0) {
        const featuresWithUpdatedParents = [];
        for (let feature of updatedFeatures) {
            if (parentUpdatesNeeded.has(feature.id) && feature instanceof Polygon) {
                const childrenToRemove = parentUpdatesNeeded.get(feature.id);
                let updatedParent = feature;
                childrenToRemove.forEach(childId => {
                    updatedParent = updatedParent.removeChildId(childId); // Polygonの不変メソッドを使用
                });
                featuresWithUpdatedParents.push(updatedParent);
                updatedFeatureIds.add(updatedParent.id); // 親も更新された
            } else {
                featuresWithUpdatedParents.push(feature);
            }
        }
        world.features = featuresWithUpdatedParents;
    } else {
        world.features = updatedFeatures;
    }

    // 削除対象の頂点を物理的に削除
    const verticesBeforeDelete = world.vertices.length;
    world.vertices = world.vertices.filter(v => !verticesToDeleteSet.has(v.id));
    const deletedVertexCount = verticesBeforeDelete - world.vertices.length;
    console.log(`[VertexEditUseCase] Physically deleted ${deletedVertexCount} vertices from world.vertices.`);

    // 使われなくなった頂点をクリーンアップ (依存関係の解決後に実行)
    // ★ cleanupUnusedVertices は WorldRepository 保存前に呼び出すべき
    this._cleanupUnusedVertices(world, vertexIdsToDelete);

    console.log(`[VertexEditUseCase] Saving world... Features: ${world.features.length}, Vertices: ${world.vertices.length}`);
    await this._worldRepository.saveWorld(world);

    const result = {
        deletedVertexIds: Array.from(verticesToDeleteSet),
        updatedFeatureIds: Array.from(updatedFeatureIds),
        deletedFeatureIds: Array.from(deletedFeatureIds)
    };
    console.log('[VertexEditUseCase] deleteVertices finished. Result:', result);
    return result;
  }

  /**
   * 頂点を移動 (単一)
   * @param {string} vertexId - 移動する頂点のID
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @returns {Promise<Object>} 更新情報 { vertex, affectedFeatures }
   */
  async moveVertex(vertexId, newPosition) {
    const world = await this._worldRepository.getWorld();
    const vertexIndex = world.vertices.findIndex(v => v.id === vertexId);
    if (vertexIndex === -1) throw new Error(`Vertex not found with ID: ${vertexId}`);
    let vertex = world.vertices[vertexIndex];
    const adjustedPosition = this._handleCollisionForVertexMove(vertex, newPosition, world);
    const updatedVertexData = { id: vertex.id, x: adjustedPosition.x, y: adjustedPosition.y };
    world.vertices[vertexIndex] = updatedVertexData;

    // 影響を受ける地物の特定 (リングベース対応)
    const affectedFeatures = world.features.filter(f => {
         if (!f || typeof f !== 'object') return false;
         const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
         return (f.vertexIds && f.vertexIds.includes(vertexId)) || // Point, Line
                (isPolygon && f.rings?.some(ring => ring.vertexIds.includes(vertexId))); // Polygon
     }).map(f => f); // ★ 返り値は参照のまま。不変性が崩れる可能性？ -> ViewModel側でコピーするなど対策が必要か？

    await this._worldRepository.saveWorld(world);
    return { vertex: updatedVertexData, affectedFeatures: affectedFeatures };
  }

  /**
   * 複数の頂点を移動
   * @param {Array<{ vertexId: string, newPosition: {x: number, y: number} }>} vertexUpdates - 移動する頂点の情報配列
   * @returns {Promise<Object>} 更新情報 { updatedVertices: Object[], affectedFeatures: Object[] }
   */
  async moveVertices(vertexUpdates) {
    const world = await this._worldRepository.getWorld();
    const updatedVertices = [];
    const allAffectedFeatureIds = new Set();
    const updatedVerticesMap = new Map();
    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));

    for (const update of vertexUpdates) {
      const { vertexId, newPosition } = update;
      const vertex = verticesMap.get(vertexId);
      if (!vertex) {
        console.warn(`Vertex not found with ID during moveVertices: ${vertexId}`);
        continue;
      }
      // TODO: 衝突検出 (複数頂点移動時の衝突検出は複雑)
      const adjustedPosition = newPosition;
      const updatedVertexData = { id: vertexId, x: adjustedPosition.x, y: adjustedPosition.y };
      updatedVerticesMap.set(vertexId, updatedVertexData);
      updatedVertices.push(updatedVertexData);
    }

    // Worldの頂点データを更新
    world.vertices = world.vertices.map(v => updatedVerticesMap.get(v.id) || v);

    // 影響を受ける地物の特定 (リングベース対応)
    world.features.forEach(f => {
      if (!f || typeof f !== 'object') return;
      const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
      const usesUpdatedVertex = vertexUpdates.some(update =>
          (f.vertexIds && f.vertexIds.includes(update.vertexId)) || // Point, Line
          (isPolygon && f.rings?.some(ring => ring.vertexIds.includes(update.vertexId))) // Polygon
      );
      if (usesUpdatedVertex) {
        allAffectedFeatureIds.add(f.id);
      }
    });

    const affectedFeatures = world.features.filter(f => allAffectedFeatureIds.has(f.id));
    await this._worldRepository.saveWorld(world);
    return { updatedVertices, affectedFeatures };
  }

  /**
   * 頂点を共有化
   * @param {string} vertexId1 - 頂点1のID
   * @param {string} vertexId2 - 頂点2のID
   * @returns {Promise<Object>} 更新情報 { keptVertex, removedVertex, affectedFeatures }
   */
  async shareVertices(vertexId1, vertexId2) {
    const world = await this._worldRepository.getWorld();
    const vertex1 = world.vertices.find(v => v.id === vertexId1);
    const vertex2 = world.vertices.find(v => v.id === vertexId2);
    if (!vertex1 || !vertex2) throw new Error('One or both vertices not found');
    // 座標が完全に一致する場合でも処理を進める（IDを統一するため）
    // if (vertex1.x === vertex2.x && vertex1.y === vertex2.y) {
    //   console.warn(`Vertices ${vertexId1} and ${vertexId2} are already at the same position.`);
    //   // return null; // ID統一のために処理を続ける
    // }

    const keptVertexId = this._getOlderVertexId(vertexId1, vertexId2);
    const removedVertexId = keptVertexId === vertexId1 ? vertexId2 : vertexId1;
    const keptVertex = keptVertexId === vertexId1 ? vertex1 : vertex2;
    const removedVertex = keptVertexId === vertexId1 ? vertex2 : vertex1;
    const affectedFeatures = [];

    // world.features を更新
    const updatedFeatures = [];
    for (let i = 0; i < world.features.length; i++) {
        let feature = world.features[i];
        let featureUpdated = false;

        if (feature instanceof Point || feature instanceof Line) {
            if (feature.vertexIds.includes(removedVertexId)) {
                const newVertexIds = feature.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
                // 不変性を保つため、新しいインスタンスを生成
                feature = feature.withVertexIds(newVertexIds);
                featureUpdated = true;
            }
        } else if (feature instanceof Polygon) {
             let polygonNeedsUpdate = false;
             let tempPolygon = feature;
             // リング配列を走査して更新
             for (const ring of feature.rings) {
                 if (ring.vertexIds.includes(removedVertexId)) {
                     const newRingVertexIds = ring.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
                     // withUpdatedRingVertices を使ってポリゴンインスタンスを更新
                     tempPolygon = tempPolygon.withUpdatedRingVertices(ring.id, newRingVertexIds);
                     polygonNeedsUpdate = true;
                 }
             }
             if (polygonNeedsUpdate) {
                 feature = tempPolygon; // 更新されたインスタンスに差し替え
                 featureUpdated = true;
             }
        }

        updatedFeatures.push(feature); // 更新されたかどうかにかかわらず追加
        if (featureUpdated) {
            if (!affectedFeatures.some(f => f.id === feature.id)) {
                affectedFeatures.push(feature);
            }
        }
    }
    world.features = updatedFeatures; // 更新後の地物リストで置き換え

    // 削除する頂点をWorldから物理的に削除
    const removedVertexIndex = world.vertices.findIndex(v => v.id === removedVertexId);
    if (removedVertexIndex !== -1) {
        world.vertices.splice(removedVertexIndex, 1);
    } else { console.warn(`Vertex to be removed not found: ${removedVertexId}`); }

    await this._worldRepository.saveWorld(world);
    return { keptVertex, removedVertex, affectedFeatures };
  }

  /**
   * 共有頂点を解除
   * @param {string} vertexId - 共有を解除する頂点のID
   * @param {string} featureId - この地物に対して新しい頂点を作成
   * @returns {Promise<Object>} 更新情報 { newVertex, updatedFeature }
   */
  async unlinkSharedVertex(vertexId, featureId) {
    const world = await this._worldRepository.getWorld();
    const vertex = world.vertices.find(v => v.id === vertexId);
    if (!vertex) throw new Error(`Vertex not found with ID: ${vertexId}`);
    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) throw new Error(`Feature not found with ID: ${featureId}`);
    let feature = world.features[featureIndex];
    if (!feature || typeof feature !== 'object') throw new Error(`Invalid feature object found for ID: ${featureId}`);

    // 対象地物が指定された頂点を使用しているか確認 (リングベース対応)
    const isPolygon = feature instanceof Polygon || feature.constructor?.name === 'Polygon';
    const usesVertex = (feature.vertexIds && feature.vertexIds.includes(vertexId)) || // Point, Line
                       (isPolygon && feature.rings?.some(ring => ring.vertexIds.includes(vertexId))); // Polygon
    if (!usesVertex) throw new Error(`Feature ${featureId} does not use vertex with ID: ${vertexId}`);

    // 新しい頂点を作成してWorldに追加
    const newVertexId = this._generateId('vertex');
    const newVertex = { id: newVertexId, x: vertex.x, y: vertex.y }; // プレーンオブジェクト
    world.vertices.push(newVertex);

    // 対象地物の頂点IDを新しいIDに置き換え
    let featureUpdated = false;
    if (feature instanceof Point || feature instanceof Line) {
        if (feature.vertexIds.includes(vertexId)) {
            const newVertexIds = feature.vertexIds.map(id => id === vertexId ? newVertexId : id);
            feature = feature.withVertexIds(newVertexIds);
            featureUpdated = true;
        }
    } else if (feature instanceof Polygon) {
        let tempPolygon = feature;
        for (const ring of feature.rings) {
            if (ring.vertexIds.includes(vertexId)) {
                const newRingVertexIds = ring.vertexIds.map(id => id === vertexId ? newVertexId : id);
                tempPolygon = tempPolygon.withUpdatedRingVertices(ring.id, newRingVertexIds);
                featureUpdated = true;
            }
        }
        feature = tempPolygon; // 更新されたインスタンスに差し替え
    }

    // 更新された地物をWorldに反映
    if (featureUpdated) {
        world.features[featureIndex] = feature;
    } else {
        console.error(`Failed to update feature ${featureId} during vertex unlink.`);
        // エラー発生時、追加した頂点を削除する？ -> ここでは行わない
    }

    await this._worldRepository.saveWorld(world);
    // 更新後の feature を返す
    return { newVertex: newVertex, updatedFeature: world.features[featureIndex] };
  }

  /**
   * 頂点移動時の衝突処理 (EditFeatureUseCaseから移動、リングベース対応)
   * @private
   */
  _handleCollisionForVertexMove(vertex, newPosition, world) {
    // 衝突判定対象となるポリゴンを特定 (リングベース対応)
    const polygons = world.features.filter(f =>
      (f instanceof Polygon || f.constructor?.name === 'Polygon') &&
      f.rings?.some(ring => ring.vertexIds.includes(vertex.id))
    );
    if (polygons.length === 0) return newPosition; // ポリゴンでなければ衝突判定不要

    // TODO: 衝突判定とエッジ滑り処理 (GeometryServiceを利用)
    // この部分は未実装、現状は衝突を無視して新しい位置をそのまま返す
    console.warn("_handleCollisionForVertexMove: Collision detection not implemented yet.");
    return newPosition;
  }
}
