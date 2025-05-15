// src\application\usecases\feature\VertexEditUseCase.js

import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon'; // Polygon をインポート
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
            const newRingsData = []; // {id, vertexIds, isOuter, parentId} のプレーンオブジェクト
            const ringsToDeleteIds = [];

            for (const ring of originalRings) {
                if (ring.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                    const newRingVertexIds = filterVertexIds(ring.vertexIds);
                    if (newRingVertexIds.length >= 3) {
                        newRingsData.push({ ...ring, vertexIds: newRingVertexIds });
                        polygonUpdated = true;
                    } else {
                        // リングが無効になった -> このリングは削除対象とする
                        ringsToDeleteIds.push(ring.id);
                        polygonUpdated = true; // ポリゴン形状が変更された
                        // 注意: このリングが他の穴リングの親だった場合の処理は
                        // PolygonEditService.removeRingFromPolygon の責務とする。
                        // ここでは単純に無効なリングを除外する。
                        // 子リングを持つリングを削除しようとするとremoveRingFromPolygonでエラーになる想定。
                        // しかし、現状 removeRingFromPolygon を直接呼んでいないので、
                        // 子が親を失うケースが発生しうる -> 後の検証でエラーになるはず。
                        // 将来的に、ここで removeRingFromPolygon を呼ぶか、
                        // PolygonEditService にリング削除を伴う頂点削除メソッドを設けるべきかもしれない。
                    }
                } else {
                    newRingsData.push({ ...ring });
                }
            }

            if (polygonUpdated) {
                 let tempPolygon = currentFeature;
                 // まず頂点ID配列が更新されたリングでポリゴンを更新
                 newRingsData.forEach(ringData => {
                     const originalRing = originalRings.find(or => or.id === ringData.id);
                     // 変更があったリングのみ更新
                     if (originalRing && JSON.stringify(originalRing.vertexIds) !== JSON.stringify(ringData.vertexIds)) {
                          try {
                             tempPolygon = tempPolygon.withUpdatedRingVertices(ringData.id, ringData.vertexIds);
                          } catch (updateError) {
                              console.error(`${logPrefix} Error updating ring vertices for ring ${ringData.id}:`, updateError);
                              // 更新に失敗した場合、このポリゴンをエラー状態として扱うか？
                              // ここではエラーをログ出力し、処理を続行する。
                          }
                     }
                 });
                 // 次に無効になったリングを削除 (インスタンス更新)
                 // 注意: 依存関係チェックは Polygon.withRemovedRing が行う
                for (const ringId of ringsToDeleteIds) {
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
    // cleanupUnusedVertices は WorldRepository 保存前に呼び出すべき
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
    
    const originalVertexData = { ...world.vertices[vertexIndex] }; // ロールバック用に元の座標を保持

    // _handleCollisionForVertexMove はまだ未実装なので、ここでは直接 newPosition を使う
    const adjustedPosition = this._handleCollisionForVertexMove(originalVertexData, newPosition, world); // 第1引数を変更

    // world.vertices のデータを一時的に更新して検証
    world.vertices[vertexIndex] = { id: vertexId, x: adjustedPosition.x, y: adjustedPosition.y };

    let selfIntersectionError = null;

    // 影響を受けるポリゴンを特定し、自己交差をチェック
    const affectedPolygons = world.features.filter(f =>
        f instanceof Polygon &&
        f.rings?.some(ring => ring.vertexIds.includes(vertexId))
    );

    const getVerticesByIdsForPolygon = (ids, currentWorldVertices) => {
        const vertexMap = new Map(currentWorldVertices.map(v => [v.id, v]));
        return ids?.map(id => {
            const vData = vertexMap.get(id);
            return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
        }).filter(Boolean) || [];
    };

    for (const polygon of affectedPolygons) {
        for (const ring of polygon.rings) {
            const ringVertices = getVerticesByIdsForPolygon(ring.vertexIds, world.vertices);
            if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
                selfIntersectionError = new Error(`頂点移動によりポリゴン ${polygon.id} のリング ${ring.id} が自己交差しました。`);
                break;
            }
        }
        if (selfIntersectionError) break;
    }

    if (selfIntersectionError) {
        world.vertices[vertexIndex] = originalVertexData; // ロールバック
        throw selfIntersectionError;
    }

    await this._worldRepository.saveWorld(world);
    const updatedVertexData = world.vertices[vertexIndex];
    const affectedFeaturesForReturn = world.features.filter(f => {
         if (!f || typeof f !== 'object') return false;
         const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
         return (f.vertexIds && f.vertexIds.includes(vertexId)) ||
                (isPolygon && f.rings?.some(ring => ring.vertexIds.includes(vertexId)));
     });

    return { vertex: updatedVertexData, affectedFeatures: affectedFeaturesForReturn };
  }

  /**
   * 複数の頂点を移動
   * @param {Array<{ vertexId: string, newPosition: {x: number, y: number} }>} vertexUpdates - 移動する頂点の情報配列
   * @returns {Promise<Object>} 更新情報 { updatedVertices: Object[], affectedFeatures: Object[] }
   */
  async moveVertices(vertexUpdates) {
    const world = await this._worldRepository.getWorld();
    const originalVerticesData = new Map(); // ロールバック用
    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));

    // 1. 元の座標を保存し、仮の更新を行う
    for (const update of vertexUpdates) {
        const vertex = verticesMap.get(update.vertexId);
        if (vertex) {
            originalVerticesData.set(update.vertexId, { ...vertex }); // 元のデータをコピー
            const vertexIndexInWorld = world.vertices.findIndex(v => v.id === update.vertexId);
            if (vertexIndexInWorld !== -1) {
                 // _handleCollisionForVertexMove はここでは呼び出さない (複数の頂点が絡むため複雑)
                 // まずは newPosition をそのまま適用し、後でまとめて検証
                world.vertices[vertexIndexInWorld] = { id: update.vertexId, x: update.newPosition.x, y: update.newPosition.y };
            }
        }
    }

    let selfIntersectionError = null;
    const allAffectedPolygonIds = new Set();
    vertexUpdates.forEach(update => {
        world.features.forEach(f => {
            if (f instanceof Polygon && f.rings?.some(ring => ring.vertexIds.includes(update.vertexId))) {
                allAffectedPolygonIds.add(f.id);
            }
        });
    });

    const getVerticesByIdsForPolygon = (ids, currentWorldVertices) => {
        const vertexMap = new Map(currentWorldVertices.map(v => [v.id, v]));
        return ids?.map(id => {
            const vData = vertexMap.get(id);
            return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
        }).filter(Boolean) || [];
    };

    for (const polygonId of allAffectedPolygonIds) {
        const polygon = world.features.find(f => f.id === polygonId);
        if (polygon instanceof Polygon) {
            for (const ring of polygon.rings) {
                const ringVertices = getVerticesByIdsForPolygon(ring.vertexIds, world.vertices);
                if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
                    selfIntersectionError = new Error(`頂点移動によりポリゴン ${polygon.id} のリング ${ring.id} が自己交差しました。`);
                    break;
                }
            }
        }
        if (selfIntersectionError) break;
    }

    if (selfIntersectionError) {
        // ロールバック: world.vertices を元の状態に戻す
        originalVerticesData.forEach((originalData, vertexId) => {
            const index = world.vertices.findIndex(v => v.id === vertexId);
            if (index !== -1) {
                world.vertices[index] = originalData;
            }
        });
        throw selfIntersectionError;
    }

    // エラーがなければ保存
    await this._worldRepository.saveWorld(world);

    // 更新後の頂点データと影響地物を収集
    const updatedVertices = [];
    const finalAffectedFeatureIds = new Set();
    const finalVerticesMap = new Map(world.vertices.map(v => [v.id, v]));

    for (const update of vertexUpdates) {
      const updatedVertex = finalVerticesMap.get(update.vertexId);
      if (updatedVertex) updatedVertices.push(updatedVertex);

      world.features.forEach(f => {
        if (!f || typeof f !== 'object') return;
        const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
        const usesUpdatedVertex = 
            (f.vertexIds && f.vertexIds.includes(update.vertexId)) ||
            (isPolygon && f.rings?.some(ring => ring.vertexIds.includes(update.vertexId)));
        if (usesUpdatedVertex) {
          finalAffectedFeatureIds.add(f.id);
        }
      });
    }
    const affectedFeatures = world.features.filter(f => finalAffectedFeatureIds.has(f.id));

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
             let tempPolygon = feature;
             let polygonNeedsRingUpdate = false;
             for (const ring of feature.rings) {
                 if (ring.vertexIds.includes(removedVertexId)) {
                     const newRingVertexIds = ring.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
                     tempPolygon = tempPolygon.withUpdatedRingVertices(ring.id, newRingVertexIds);
                     polygonNeedsRingUpdate = true;
                 }
             }
             if (polygonNeedsRingUpdate) {
                 feature = tempPolygon;
                 featureUpdated = true;
             }
        }

        updatedFeatures.push(feature);
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

    // 共有化による形状変更後の自己交差チェック (影響地物のみ)
    let selfIntersectionError = null;
    const getVerticesByIdsForPolygon = (ids, currentWorldVertices) => {
        const vertexMap = new Map(currentWorldVertices.map(v => [v.id, v]));
        return ids?.map(id => {
            const vData = vertexMap.get(id);
            return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
        }).filter(Boolean) || [];
    };

    for (const affFeature of affectedFeatures) {
        if (affFeature instanceof Polygon) {
            for (const ring of affFeature.rings) {
                const ringVertices = getVerticesByIdsForPolygon(ring.vertexIds, world.vertices);
                if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
                    selfIntersectionError = new Error(`頂点共有化によりポリゴン ${affFeature.id} のリング ${ring.id} が自己交差しました。`);
                    break;
                }
            }
        }
        if (selfIntersectionError) break;
    }

    if (selfIntersectionError) {
        // shareVertices のロールバックは複雑なので、ここではエラーを投げるのみ。
        //    本来は、変更前の状態を保存しておき、戻す必要がある。
        //    今回は、このエラーケースは稀であると想定し、簡易的な対応とする。
        throw selfIntersectionError;
    }

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
    }

    // 共有解除による形状変更後の自己交差チェック (対象地物のみ)
    let selfIntersectionError = null;
    if (featureUpdated && feature instanceof Polygon) {
        const getVerticesByIdsForPolygon = (ids, currentWorldVertices) => {
            const vertexMap = new Map(currentWorldVertices.map(v => [v.id, v]));
            return ids?.map(id => {
                const vData = vertexMap.get(id);
                return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
            }).filter(Boolean) || [];
        };
        for (const ring of feature.rings) {
            const ringVertices = getVerticesByIdsForPolygon(ring.vertexIds, world.vertices);
            if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
                selfIntersectionError = new Error(`共有頂点解除によりポリゴン ${feature.id} のリング ${ring.id} が自己交差しました。`);
                break;
            }
        }
    }

    if (selfIntersectionError) {
        // unlinkSharedVertex のロールバックも複雑。
        //    追加した頂点を削除し、featureを元に戻す必要がある。
        //    今回はエラーを投げるのみとする。
        const newVertexIndex = world.vertices.findIndex(v => v.id === newVertexId);
        if (newVertexIndex !== -1) world.vertices.splice(newVertexIndex, 1); // 追加した頂点を削除
        // feature を元に戻すのは、元の feature インスタンスを保持していないと難しい
        throw selfIntersectionError;
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
    if (polygons.length === 0) return newPosition; // ポリゴンでなければ衝突判定不要 (今回のスコープでは)

    // TODO: 衝突判定とエッジ滑り処理 (GeometryServiceを利用)
    // この部分は未実装、現状は衝突を無視して新しい位置をそのまま返す
    // console.warn("_handleCollisionForVertexMove: Collision detection not implemented yet.");
    return newPosition;
  }
}
