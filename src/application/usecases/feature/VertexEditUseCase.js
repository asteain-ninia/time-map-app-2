import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon';
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
    // 元の EditFeatureUseCase.deleteVertices の実装をほぼそのまま移動
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
        const parentUpdatesNeeded = new Map();

        const filterVertexIds = (ids) => ids?.filter(id => !verticesToDeleteSet.has(id)) || [];

        for (const feature of originalFeatures) {
            let currentFeature = feature;
            let needsUpdate = false;
            let featureShouldBeDeleted = false;
            const logPrefix = `[VertexEditUseCase] Feature ${feature?.id}:`;

            if (!(currentFeature instanceof Point || currentFeature instanceof Line || currentFeature instanceof Polygon)) {
                console.warn(`${logPrefix} Not a valid domain object instance. Skipping. Type: ${typeof currentFeature}`, currentFeature);
                updatedFeatures.push(currentFeature);
                continue;
            }

            let newVertexIds = currentFeature.vertexIds;
            let vertexIdsUpdated = false;
            if (currentFeature.vertexIds && currentFeature.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                newVertexIds = filterVertexIds(currentFeature.vertexIds);
                needsUpdate = true;
                vertexIdsUpdated = true;

                if (currentFeature instanceof Point && newVertexIds.length === 0) {
                    featureShouldBeDeleted = true;
                } else if (currentFeature instanceof Line && newVertexIds.length < 2) {
                    featureShouldBeDeleted = true;
                } else if (currentFeature instanceof Polygon && newVertexIds.length < 3) {
                    const hasOtherParts = (currentFeature.isMultiPolygon && currentFeature.subPolygons?.length > 0) || currentFeature.hasChildren();
                    if (!hasOtherParts) {
                       featureShouldBeDeleted = true;
                    } else {
                       newVertexIds = null;
                    }
                }
            }

            let newHolesVertexIds = currentFeature instanceof Polygon ? (currentFeature.holesVertexIds || []) : [];
            let newSubPolygons = currentFeature instanceof Polygon ? (currentFeature.subPolygons || []) : [];
            let isMultiPolygon = currentFeature instanceof Polygon ? currentFeature.isMultiPolygon : false;
            let polygonSpecificsUpdated = false;

            if (currentFeature instanceof Polygon && !featureShouldBeDeleted) {
                const originalHolesStr = JSON.stringify(newHolesVertexIds);
                const originalSubPolygonsStr = JSON.stringify(newSubPolygons);
                let holesChanged = false;
                let subPolygonsChanged = false;

                if (newHolesVertexIds.some(hole => hole.some(id => verticesToDeleteSet.has(id)))) {
                    const filteredHoles = newHolesVertexIds
                        .map(hole => filterVertexIds(hole))
                        .filter(hole => hole.length >= 3);
                    if (JSON.stringify(filteredHoles) !== originalHolesStr) {
                        newHolesVertexIds = filteredHoles;
                        holesChanged = true;
                    }
                }

                if (isMultiPolygon && newSubPolygons.some(sub => sub.vertexIds?.some(id => verticesToDeleteSet.has(id)))) {
                     const filteredSubPolygons = newSubPolygons
                        .map(sub => {
                            const filteredSubVertexIds = filterVertexIds(sub.vertexIds);
                            const filteredSubHoleVertexIds = (sub.holesVertexIds || [])
                                .map(hole => filterVertexIds(hole))
                                .filter(hole => hole.length >= 3);
                            return {
                                vertexIds: filteredSubVertexIds,
                                holesVertexIds: filteredSubHoleVertexIds
                            };
                        })
                        .filter(sub => sub.vertexIds && sub.vertexIds.length >= 3);
                    if (JSON.stringify(filteredSubPolygons) !== originalSubPolygonsStr) {
                        newSubPolygons = filteredSubPolygons;
                        subPolygonsChanged = true;
                    }
                }

                if (holesChanged || subPolygonsChanged) {
                    needsUpdate = true;
                    polygonSpecificsUpdated = true;
                }

                const mainBodyExistsAfterUpdate = vertexIdsUpdated ? (newVertexIds && newVertexIds.length >= 3) : currentFeature.hasDirectGeometry();
                const totalPartsAfterUpdate = (mainBodyExistsAfterUpdate ? 1 : 0) + newSubPolygons.length;

                if (totalPartsAfterUpdate < 1) {
                    if (!currentFeature.hasChildren()) {
                       featureShouldBeDeleted = true;
                    } else {
                        if (vertexIdsUpdated) newVertexIds = null;
                        isMultiPolygon = false;
                        newSubPolygons = [];
                        needsUpdate = true;
                        polygonSpecificsUpdated = true;
                    }
                } else {
                     const shouldBeMultiPolygon = totalPartsAfterUpdate >= 2 || (totalPartsAfterUpdate === 1 && !mainBodyExistsAfterUpdate);
                     if (isMultiPolygon !== shouldBeMultiPolygon) {
                         isMultiPolygon = shouldBeMultiPolygon;
                         needsUpdate = true;
                         polygonSpecificsUpdated = true;
                     }
                }
            }

            let finalFeature = currentFeature;
            if (!featureShouldBeDeleted && needsUpdate) {
                 try {
                     let tempFeature = currentFeature;
                     if (tempFeature instanceof Point) {
                         if (newVertexIds.length === 0) throw new Error("Point deleted");
                         finalFeature = tempFeature.withVertexIds(newVertexIds);
                     } else if (tempFeature instanceof Line) {
                         if (newVertexIds.length < 2) throw new Error("Line deleted");
                         finalFeature = tempFeature.withVertexIds(newVertexIds);
                     } else if (tempFeature instanceof Polygon) {
                         if (vertexIdsUpdated) {
                             tempFeature = tempFeature.withVertexIds(newVertexIds);
                         }
                         if (polygonSpecificsUpdated) {
                             tempFeature = tempFeature.withHolesVertexIds(newHolesVertexIds)
                                                    .withMultiPolygonData(isMultiPolygon, newSubPolygons);
                         }
                         finalFeature = tempFeature;
                     } else {
                         console.error(`${logPrefix} Cannot update feature: Unknown type or invalid instance state.`);
                         needsUpdate = false;
                         finalFeature = currentFeature;
                     }
                     if (needsUpdate) updatedFeatureIds.add(finalFeature.id);
                 } catch (e) {
                      console.error(`${logPrefix} Error updating feature instance:`, e);
                      featureShouldBeDeleted = true;
                 }
            } else if (!featureShouldBeDeleted) {
                finalFeature = currentFeature;
            }

            if (featureShouldBeDeleted) {
                deletedFeatureIds.add(finalFeature.id);
                if (finalFeature.parentId && finalFeature.parentId !== "0") {
                    if (!parentUpdatesNeeded.has(finalFeature.parentId)) {
                        parentUpdatesNeeded.set(finalFeature.parentId, []);
                    }
                    parentUpdatesNeeded.get(finalFeature.parentId).push(finalFeature.id);
                }
            } else {
                updatedFeatures.push(finalFeature);
            }
        }

        if (parentUpdatesNeeded.size > 0) {
            const featuresWithUpdatedParents = [];
            for(let feature of updatedFeatures) {
                if (parentUpdatesNeeded.has(feature.id) && feature instanceof Polygon) {
                   const childrenToRemove = parentUpdatesNeeded.get(feature.id);
                   let updatedParent = feature;
                   childrenToRemove.forEach(childId => {
                       updatedParent = updatedParent.removeChildId(childId);
                   });
                   featuresWithUpdatedParents.push(updatedParent);
                   updatedFeatureIds.add(updatedParent.id);
                } else {
                    featuresWithUpdatedParents.push(feature);
                }
            }
            world.features = featuresWithUpdatedParents;
        } else {
           world.features = updatedFeatures;
        }


        const verticesBeforeDelete = world.vertices.length;
        world.vertices = world.vertices.filter(v => !verticesToDeleteSet.has(v.id));
        const deletedVertexCount = verticesBeforeDelete - world.vertices.length;
        console.log(`[VertexEditUseCase] Physically deleted ${deletedVertexCount} vertices from world.vertices.`);

        // 不要になった頂点をさらにクリーンアップ (必要であれば EditFeatureUseCase のヘルパーを呼ぶ)
        // this._cleanupUnusedVertices(world, []); // ここでは呼ばない（deleteFeatureから呼ばれる想定）

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
    // 元の EditFeatureUseCase.moveVertex の実装を移動
    const world = await this._worldRepository.getWorld();
    const vertexIndex = world.vertices.findIndex(v => v.id === vertexId);
    if (vertexIndex === -1) throw new Error(`Vertex not found with ID: ${vertexId}`);
    let vertex = world.vertices[vertexIndex];
    const adjustedPosition = this._handleCollisionForVertexMove(vertex, newPosition, world);
    const updatedVertexData = { id: vertex.id, x: adjustedPosition.x, y: adjustedPosition.y };
    world.vertices[vertexIndex] = updatedVertexData;
    const affectedFeatures = world.features.filter(f => {
         if (!f || typeof f !== 'object') return false;
         const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
         return (f.vertexIds && f.vertexIds.includes(vertexId)) ||
                (isPolygon && f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertexId))) ||
                (isPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds && sub.vertexIds.includes(vertexId)));
     }).map(f => f); // 返り値は参照のまま
    await this._worldRepository.saveWorld(world);
    return { vertex: updatedVertexData, affectedFeatures: affectedFeatures };
  }

  /**
   * 複数の頂点を移動
   * @param {Array<{ vertexId: string, newPosition: {x: number, y: number} }>} vertexUpdates - 移動する頂点の情報配列
   * @returns {Promise<Object>} 更新情報 { updatedVertices: Object[], affectedFeatures: Object[] }
   */
  async moveVertices(vertexUpdates) {
     // 元の EditFeatureUseCase.moveVertices の実装を移動
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
      // TODO: 衝突検出
      const adjustedPosition = newPosition;
      const updatedVertexData = { id: vertexId, x: adjustedPosition.x, y: adjustedPosition.y };
      updatedVerticesMap.set(vertexId, updatedVertexData);
      updatedVertices.push(updatedVertexData);
    }

    world.vertices = world.vertices.map(v => updatedVerticesMap.get(v.id) || v);

    world.features.forEach(f => {
      if (!f || typeof f !== 'object') return;
      const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
      const usesUpdatedVertex = vertexUpdates.some(update =>
          (f.vertexIds && f.vertexIds.includes(update.vertexId)) ||
          (isPolygon && f.holesVertexIds?.some(hole => hole.includes(update.vertexId))) ||
          (isPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds?.includes(update.vertexId)))
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
    // 元の EditFeatureUseCase.shareVertices の実装を移動
    const world = await this._worldRepository.getWorld();
    const vertex1 = world.vertices.find(v => v.id === vertexId1);
    const vertex2 = world.vertices.find(v => v.id === vertexId2);
    if (!vertex1 || !vertex2) throw new Error('One or both vertices not found');
    if (vertex1.x === vertex2.x && vertex1.y === vertex2.y) {
      console.warn(`Vertices ${vertexId1} and ${vertexId2} are already at the same position.`);
      return null;
    }

    const keptVertexId = this._getOlderVertexId(vertexId1, vertexId2);
    const removedVertexId = keptVertexId === vertexId1 ? vertexId2 : vertexId1;
    const keptVertex = keptVertexId === vertexId1 ? vertex1 : vertex2;
    const removedVertex = keptVertexId === vertexId1 ? vertex2 : vertex1;
    const affectedFeatures = [];

    for (let i = 0; i < world.features.length; i++) {
      let feature = world.features[i];
      let updated = false;
      const isValidFeature = feature && typeof feature === 'object';
      const hasWithVertexIds = isValidFeature && typeof feature.withVertexIds === 'function';
      const isPolygon = isValidFeature && (feature instanceof Polygon || feature.constructor?.name === 'Polygon');
      const hasWithHolesVertexIds = isPolygon && typeof feature.withHolesVertexIds === 'function';
      const hasWithMultiPolygonData = isPolygon && typeof feature.withMultiPolygonData === 'function';
      const hasWithSubPolygonHoles = isPolygon && typeof feature.withSubPolygonHoles === 'function';

      if (hasWithVertexIds && feature.vertexIds && feature.vertexIds.includes(removedVertexId)) {
        const newVertexIds = feature.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
        feature = feature.withVertexIds(newVertexIds);
        updated = true;
      }

      if (hasWithHolesVertexIds && feature.holesVertexIds && feature.holesVertexIds.length > 0) {
        let holesUpdated = false;
        const newHolesVertexIds = feature.holesVertexIds.map(hole => {
          if (hole.includes(removedVertexId)) {
            holesUpdated = true;
            return hole.map(id => id === removedVertexId ? keptVertexId : id);
          }
          return hole;
        });
        if (holesUpdated) {
          feature = feature.withHolesVertexIds(newHolesVertexIds);
          updated = true;
        }
      }

      if (feature.isMultiPolygon && feature.subPolygons) {
          let subPolygonsUpdated = false;
          const newSubPolygons = feature.subPolygons.map((sub, subIndex) => {
              let subUpdated = false;
              let newSubVertexIds = sub.vertexIds;
              let newSubHolesVertexIds = sub.holesVertexIds || [];
              if (sub.vertexIds && sub.vertexIds.includes(removedVertexId)) {
                  newSubVertexIds = sub.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
                  subUpdated = true;
              }
              if (hasWithSubPolygonHoles && newSubHolesVertexIds.length > 0) {
                  let subHolesUpdated = false;
                  newSubHolesVertexIds = newSubHolesVertexIds.map(hole => {
                      if (hole.includes(removedVertexId)) {
                          subHolesUpdated = true;
                          return hole.map(id => id === removedVertexId ? keptVertexId : id);
                      }
                      return hole;
                  });
                  if (subHolesUpdated) subUpdated = true;
              }
              if (subUpdated) {
                  subPolygonsUpdated = true;
                  return { vertexIds: newSubVertexIds, holesVertexIds: newSubHolesVertexIds };
              }
              return sub;
          });
          if (subPolygonsUpdated) {
              if (hasWithMultiPolygonData) {
                  feature = feature.withMultiPolygonData(true, newSubPolygons);
                  updated = true;
              } else { console.error(`Feature ${feature.id} is missing withMultiPolygonData method.`); }
          }
      }

      if (updated) {
        world.features[i] = feature;
        if (!affectedFeatures.some(f => f.id === feature.id)) {
          affectedFeatures.push(feature);
        }
      }
    }

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
    // 元の EditFeatureUseCase.unlinkSharedVertex の実装を移動
    const world = await this._worldRepository.getWorld();
    const vertex = world.vertices.find(v => v.id === vertexId);
    if (!vertex) throw new Error(`Vertex not found with ID: ${vertexId}`);
    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) throw new Error(`Feature not found with ID: ${featureId}`);
    let feature = world.features[featureIndex];
    if (!feature || typeof feature !== 'object') throw new Error(`Invalid feature object found for ID: ${featureId}`);

    const isPolygon = feature instanceof Polygon || feature.constructor?.name === 'Polygon';
    const usesVertex = (feature.vertexIds && feature.vertexIds.includes(vertexId)) ||
                     (isPolygon && feature.holesVertexIds?.some(hole => hole.includes(vertexId))) ||
                     (isPolygon && feature.isMultiPolygon && feature.subPolygons?.some(sub =>
                         (sub.vertexIds && sub.vertexIds.includes(vertexId)) ||
                         (sub.holesVertexIds?.some(hole => hole.includes(vertexId)))
                     ));
    if (!usesVertex) throw new Error(`Feature ${featureId} does not use vertex with ID: ${vertexId}`);

    const newVertexId = this._generateId('vertex');
    const newVertex = { id: newVertexId, x: vertex.x, y: vertex.y }; // プレーンオブジェクト
    world.vertices.push(newVertex);

    let updated = false;
     const hasWithVertexIds = typeof feature.withVertexIds === 'function';
     const hasWithHolesVertexIds = isPolygon && typeof feature.withHolesVertexIds === 'function';
     const hasWithMultiPolygonData = isPolygon && typeof feature.withMultiPolygonData === 'function';
     const hasWithSubPolygonHoles = isPolygon && typeof feature.withSubPolygonHoles === 'function';

    if (hasWithVertexIds && feature.vertexIds && feature.vertexIds.includes(vertexId)) {
        const newVertexIds = feature.vertexIds.map(id => id === vertexId ? newVertexId : id);
        feature = feature.withVertexIds(newVertexIds);
        updated = true;
    }
    if (hasWithHolesVertexIds && feature.holesVertexIds && feature.holesVertexIds.length > 0) {
      let holesUpdated = false;
      const newHolesVertexIds = feature.holesVertexIds.map(hole => {
        if (hole.includes(vertexId)) {
          holesUpdated = true;
          return hole.map(id => id === vertexId ? newVertexId : id);
        }
        return hole;
      });
      if (holesUpdated) {
        feature = feature.withHolesVertexIds(newHolesVertexIds);
        updated = true;
      }
    }
    if (feature.isMultiPolygon && feature.subPolygons) {
        let subPolygonsUpdated = false;
        const newSubPolygons = feature.subPolygons.map((sub, subIndex) => {
            let subUpdated = false;
            let newSubVertexIds = sub.vertexIds;
            let newSubHolesVertexIds = sub.holesVertexIds || [];
            if (sub.vertexIds && sub.vertexIds.includes(vertexId)) {
                newSubVertexIds = sub.vertexIds.map(id => id === vertexId ? newVertexId : id);
                subUpdated = true;
            }
            if (hasWithSubPolygonHoles && newSubHolesVertexIds.length > 0) {
                 let subHolesUpdated = false;
                 newSubHolesVertexIds = newSubHolesVertexIds.map(hole => {
                     if (hole.includes(vertexId)) {
                         subHolesUpdated = true;
                         return hole.map(id => id === vertexId ? newVertexId : id);
                     }
                     return hole;
                 });
                 if (subHolesUpdated) subUpdated = true;
            }
            if (subUpdated) {
                subPolygonsUpdated = true;
                return { vertexIds: newSubVertexIds, holesVertexIds: newSubHolesVertexIds };
            }
            return sub;
        });
        if (subPolygonsUpdated) {
            if (hasWithMultiPolygonData) {
                feature = feature.withMultiPolygonData(true, newSubPolygons);
                updated = true;
            } else { console.error(`Feature ${feature.id} is missing withMultiPolygonData method.`); }
        }
    }

    if (updated) {
      world.features[featureIndex] = feature;
    } else { console.error(`Failed to update feature ${featureId} during vertex unlink.`); }

    await this._worldRepository.saveWorld(world);
    return { newVertex: newVertex, updatedFeature: world.features[featureIndex] };
  }

  /**
   * 頂点移動時の衝突処理 (EditFeatureUseCaseから移動)
   * @private
   */
  _handleCollisionForVertexMove(vertex, newPosition, world) {
    const polygons = world.features.filter(f =>
      f instanceof Polygon &&
      ((f.vertexIds && f.vertexIds.includes(vertex.id)) ||
       (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertex.id))) ||
       (f.isMultiPolygon && f.subPolygons?.some(sub =>
           (sub.vertexIds && sub.vertexIds.includes(vertex.id)) ||
           (sub.holesVertexIds?.some(hole => hole.includes(vertex.id)))
       )))
    );
    if (polygons.length === 0) return newPosition;
    // TODO: 衝突判定とエッジ滑り処理 (GeometryServiceを利用)
    return newPosition;
  }
}