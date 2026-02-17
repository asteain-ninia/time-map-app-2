// src/application/usecases/feature/VertexEditUseCase.js

import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon'; // Polygon をインポート
import { Vertex } from '../../../domain/entities/Vertex'; // Vertex をインポート
import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';
import { ensurePolygonLayerConstraints } from './polygonLayerValidation.js';
import { applyVertexSliding } from '../../services/VertexSlideService.js';

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
  constructor(worldRepository, geometryService, cleanupUnusedVertices, generateId, getOlderVertexId, layerService) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService; // 衝突判定用に保持
    this._cleanupUnusedVertices = cleanupUnusedVertices;
    this._generateId = generateId;
    this._getOlderVertexId = getOlderVertexId;
    this._layerService = layerService;
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
            const newRingsData = []; // {id, vertexIds, ringType, parentId} のプレーンオブジェクト
            const ringsToDeleteIds = new Set();

            for (const ring of originalRings) {
                if (ring.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                    const newRingVertexIds = filterVertexIds(ring.vertexIds);
                    if (newRingVertexIds.length >= 3) {
                        newRingsData.push({ ...ring, vertexIds: newRingVertexIds });
                        polygonUpdated = true;
                    } else {
                        // リングが無効になった -> このリングは削除対象とする
                        ringsToDeleteIds.add(ring.id);
                        polygonUpdated = true; // ポリゴン形状が変更された
                    }
                } else {
                    newRingsData.push({ ...ring });
                }
            }

            if (polygonUpdated) {
                const willHaveRingsAfterDeletion = newRingsData.length > 0;
                const shouldDeletePolygon = !willHaveRingsAfterDeletion && !currentFeature.hasChildren();

                if (shouldDeletePolygon) {
                    featureShouldBeDeleted = true;
                } else {
                    let tempPolygon = currentFeature;
                    // まず頂点ID配列が更新されたリングでポリゴンを更新
                    newRingsData.forEach(ringData => {
                        const originalRing = originalRings.find(or => or.id === ringData.id);
                        if (originalRing && JSON.stringify(originalRing.vertexIds) !== JSON.stringify(ringData.vertexIds)) {
                            tempPolygon = tempPolygon.withUpdatedRingVertices(ringData.id, ringData.vertexIds);
                        }
                    });

                    // 次に無効になったリングを削除 (カスケード削除と親子関係再構築)
                    for (const ringId of ringsToDeleteIds) {
                        // withRemovedRingは新しいカスケードロジックを持つ
                        tempPolygon = tempPolygon.withRemovedRing(ringId);
                    }
                    currentFeature = tempPolygon;
                    needsUpdate = true;
                }
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
  async moveVertex(vertexId, newPosition, options = undefined) {
    if (options?.editTime instanceof TimePoint) {
      const moveResult = await this.moveVertices([{ vertexId, newPosition }], options);
      const movedVertex = Array.isArray(moveResult.updatedVertices)
        ? moveResult.updatedVertices.find(vertex => vertex.id === vertexId) || moveResult.updatedVertices[0] || null
        : null;
      const vertex = movedVertex
        ? { id: movedVertex.id, x: movedVertex.x, y: movedVertex.y }
        : null;
      return {
        vertex,
        affectedFeatures: moveResult.affectedFeatures || [],
        requiresWorldRefresh: moveResult.requiresWorldRefresh === true,
        historyPatch: moveResult.historyPatch || null
      };
    }

    const world = await this._worldRepository.getWorld();
    const vertexIndex = world.vertices.findIndex(v => v.id === vertexId);
    if (vertexIndex === -1) throw new Error(`Vertex not found with ID: ${vertexId}`);
    
    const vertexEntry = world.vertices[vertexIndex];
    const originalVertexData = { x: vertexEntry.x, y: vertexEntry.y }; // ロールバック用

    const adjustedPosition = this._handleCollisionForVertexMove(
      { id: vertexId, ...originalVertexData },
      newPosition,
      world
    );

    // world.vertices 内の同じ参照をそのまま更新
    vertexEntry.x = adjustedPosition.x;
    vertexEntry.y = adjustedPosition.y;

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

    const constraintError = this._validatePolygonConstraints(affectedPolygons, world, [vertexId]);

    if (selfIntersectionError || constraintError) {
        vertexEntry.x = originalVertexData.x;
        vertexEntry.y = originalVertexData.y;
        throw selfIntersectionError || constraintError;
    }

    await this._worldRepository.saveWorld(world);
    const updatedVertexData = { id: vertexId, x: vertexEntry.x, y: vertexEntry.y };
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
  async moveVertices(vertexUpdates, options = undefined) {
    if (options?.editTime instanceof TimePoint) {
      return this._moveVerticesAtTime(vertexUpdates, options.editTime);
    }

    const world = await this._worldRepository.getWorld();
    const originalVerticesData = new Map(); // { vertexRef, x, y }
    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));

    const desiredPositions = new Map();
    const originalPositions = new Map();
    for (const update of vertexUpdates) {
        const vertex = verticesMap.get(update.vertexId);
        if (vertex) {
            originalPositions.set(update.vertexId, { x: vertex.x, y: vertex.y });
            desiredPositions.set(update.vertexId, update.newPosition);
        }
    }

    const adjustedPositions = applyVertexSliding({
      world,
      geometryService: this._geometryService,
      movedVertexIds: new Set(desiredPositions.keys()),
      desiredPositions,
      originalPositions
    });

    const normalizedUpdates = vertexUpdates.map(update => {
      const adjusted = adjustedPositions.get(update.vertexId);
      if (!adjusted) {
        return update;
      }
      return { ...update, newPosition: adjusted };
    });

    // 1. 元の座標を保存し、仮の更新を行う
    for (const update of normalizedUpdates) {
        const vertex = verticesMap.get(update.vertexId);
        if (vertex) {
            originalVerticesData.set(update.vertexId, { vertexRef: vertex, x: vertex.x, y: vertex.y });
            vertex.x = update.newPosition.x;
            vertex.y = update.newPosition.y;
        }
    }

    let selfIntersectionError = null;
    const allAffectedPolygonIds = new Set();
    normalizedUpdates.forEach(update => {
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

    const constraintError = this._validatePolygonConstraints(
        world.features.filter(feature => feature instanceof Polygon && allAffectedPolygonIds.has(feature.id)),
        world,
        vertexUpdates.map(update => update.vertexId)
    );

    if (selfIntersectionError || constraintError) {
        // ロールバック: world.vertices を元の状態に戻す
        originalVerticesData.forEach(({ vertexRef, x, y }) => {
            vertexRef.x = x;
            vertexRef.y = y;
        });
        throw selfIntersectionError || constraintError;
    }

    // エラーがなければ保存
    await this._worldRepository.saveWorld(world);

    // 更新後の頂点データと影響地物を収集
    const updatedVertices = [];
    const finalAffectedFeatureIds = new Set();
    const finalVerticesMap = new Map(world.vertices.map(v => [v.id, v]));

    for (const update of normalizedUpdates) {
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

  async _moveVerticesAtTime(vertexUpdates, editTime) {
    if (!Array.isArray(vertexUpdates) || vertexUpdates.length === 0) {
      return { updatedVertices: [], affectedFeatures: [], requiresWorldRefresh: false };
    }

    const world = await this._worldRepository.getWorld();
    const verticesMap = new Map(world.vertices.map(vertex => [vertex.id, vertex]));

    const desiredPositions = new Map();
    const originalPositions = new Map();
    for (const update of vertexUpdates) {
      const vertex = verticesMap.get(update.vertexId);
      if (!vertex || !update?.newPosition) {
        continue;
      }
      originalPositions.set(update.vertexId, { x: vertex.x, y: vertex.y });
      desiredPositions.set(update.vertexId, { x: update.newPosition.x, y: update.newPosition.y });
    }

    if (desiredPositions.size === 0) {
      return { updatedVertices: [], affectedFeatures: [], requiresWorldRefresh: false };
    }

    const adjustedPositions = applyVertexSliding({
      world,
      geometryService: this._geometryService,
      movedVertexIds: new Set(desiredPositions.keys()),
      desiredPositions,
      originalPositions
    });

    const movedVertexIds = new Set(desiredPositions.keys());
    const affectedFeatureEntries = [];
    const replacementTargets = new Set();

    world.features.forEach((feature, index) => {
      if (!this._featureUsesAnyVertexAtTime(feature, movedVertexIds, editTime)) {
        return;
      }
      const usedVertexIds = this._collectFeatureVertexIdsAtTime(feature, editTime)
        .filter(vertexId => movedVertexIds.has(vertexId));
      if (usedVertexIds.length === 0) {
        return;
      }
      usedVertexIds.forEach(vertexId => replacementTargets.add(vertexId));
      affectedFeatureEntries.push({ index, feature });
    });

    if (affectedFeatureEntries.length === 0 || replacementTargets.size === 0) {
      return { updatedVertices: [], affectedFeatures: [], requiresWorldRefresh: false };
    }

    const existingVertexIds = new Set(world.vertices.map(vertex => vertex.id));
    const replacementMap = new Map();
    const addedVertices = [];
    for (const sourceVertexId of replacementTargets) {
      const targetPosition = adjustedPositions.get(sourceVertexId) || originalPositions.get(sourceVertexId);
      if (!targetPosition) {
        continue;
      }
      const newVertexId = this._generateUniqueId('vertex', existingVertexIds);
      existingVertexIds.add(newVertexId);
      replacementMap.set(sourceVertexId, newVertexId);
      addedVertices.push({ id: newVertexId, x: targetPosition.x, y: targetPosition.y });
    }

    if (replacementMap.size === 0 || addedVertices.length === 0) {
      return { updatedVertices: [], affectedFeatures: [], requiresWorldRefresh: false };
    }

    const updatedFeatures = [...world.features];
    const historyFeatureChanges = [];
    const updatedPolygons = [];

    for (const entry of affectedFeatureEntries) {
      const beforeFeature = entry.feature;
      const afterFeature = this._buildFeatureForAnchorScopedVertexMove(
        beforeFeature,
        editTime,
        replacementMap
      );
      if (!afterFeature || afterFeature === beforeFeature) {
        continue;
      }
      updatedFeatures[entry.index] = afterFeature;
      historyFeatureChanges.push({
        featureId: afterFeature.id,
        beforeFeature,
        afterFeature
      });
      if (afterFeature instanceof Polygon) {
        updatedPolygons.push(afterFeature);
      }
    }

    if (historyFeatureChanges.length === 0) {
      return { updatedVertices: [], affectedFeatures: [], requiresWorldRefresh: false };
    }

    const candidateWorld = {
      ...world,
      features: updatedFeatures,
      vertices: [...world.vertices, ...addedVertices]
    };

    const selfIntersectionError = this._validatePolygonsSelfIntersectionAtTime(
      updatedPolygons,
      candidateWorld.vertices,
      editTime
    );
    const constraintError = this._validatePolygonConstraints(
      updatedPolygons,
      candidateWorld,
      [...movedVertexIds, ...replacementMap.values()]
    );

    if (selfIntersectionError || constraintError) {
      throw selfIntersectionError || constraintError;
    }

    world.features = updatedFeatures;
    world.vertices = candidateWorld.vertices;
    await this._worldRepository.saveWorld(world);

    return {
      updatedVertices: addedVertices,
      affectedFeatures: historyFeatureChanges.map(change => change.afterFeature),
      requiresWorldRefresh: true,
      historyPatch: {
        featureChanges: historyFeatureChanges,
        addedVertices
      }
    };
  }

  _featureUsesAnyVertexAtTime(feature, vertexIds, timePoint) {
    if (!feature || !(vertexIds instanceof Set) || vertexIds.size === 0) {
      return false;
    }
    const featureVertexIds = this._collectFeatureVertexIdsAtTime(feature, timePoint);
    return featureVertexIds.some(vertexId => vertexIds.has(vertexId));
  }

  _collectFeatureVertexIdsAtTime(feature, timePoint) {
    if (!feature) {
      return [];
    }
    if (feature instanceof Point) {
      const vertexId = typeof feature.getVertexIdAt === 'function'
        ? feature.getVertexIdAt(timePoint)
        : feature.vertexId;
      return typeof vertexId === 'string' ? [vertexId] : [];
    }
    if (feature instanceof Line) {
      const vertexIds = typeof feature.getVertexIdsAt === 'function'
        ? feature.getVertexIdsAt(timePoint)
        : feature.vertexIds;
      return Array.isArray(vertexIds) ? [...vertexIds] : [];
    }
    if (feature instanceof Polygon) {
      const rings = typeof feature.getRingsAt === 'function'
        ? feature.getRingsAt(timePoint)
        : feature.rings;
      if (!Array.isArray(rings)) {
        return [];
      }
      const ids = [];
      rings.forEach(ring => {
        if (Array.isArray(ring?.vertexIds)) {
          ring.vertexIds.forEach(vertexId => ids.push(vertexId));
        }
      });
      return ids;
    }
    return [];
  }

  _buildFeatureForAnchorScopedVertexMove(feature, editTime, replacementMap) {
    if (!feature || !(replacementMap instanceof Map) || replacementMap.size === 0) {
      return feature;
    }
    const hasAnchors = Array.isArray(feature.anchors) && feature.anchors.length > 0;
    if (!hasAnchors) {
      return this._buildLegacyFeatureForVertexReplacement(feature, editTime, replacementMap);
    }

    const anchors = [...feature.anchors];
    let targetAnchorIndex = anchors.findIndex(anchor => anchor.startTime.equals(editTime));
    let splitInserted = false;

    if (targetAnchorIndex === -1) {
      const activeIndex = anchors.findIndex(anchor => anchor.isActiveAt(editTime));
      if (activeIndex === -1) {
        return feature;
      }
      const sourceAnchor = anchors[activeIndex];
      if (!sourceAnchor.startTime.equals(editTime)) {
        const anchorIds = new Set(anchors.map(anchor => anchor.id));
        const splitAnchor = new FeatureAnchor({
          id: this._generateUniqueId('anchor', anchorIds),
          timeRange: { start: editTime, end: sourceAnchor.endTime },
          property: {
            name: sourceAnchor.name,
            description: sourceAnchor.description,
            attributes: sourceAnchor.getAttributes()
          },
          shape: sourceAnchor.shape,
          placement: sourceAnchor.placement
        });
        anchors.splice(
          activeIndex,
          1,
          sourceAnchor.withTimeRange(sourceAnchor.startTime, editTime),
          splitAnchor
        );
        targetAnchorIndex = activeIndex + 1;
        splitInserted = true;
      } else {
        targetAnchorIndex = activeIndex;
      }
    }

    const targetAnchor = anchors[targetAnchorIndex];
    if (!targetAnchor) {
      return feature;
    }

    const replacedShape = this._replaceAnchorShapeVertexIds(feature, targetAnchor, replacementMap, editTime);
    const shapeChanged = JSON.stringify(targetAnchor.shape || {}) !== JSON.stringify(replacedShape || {});
    if (!shapeChanged && !splitInserted) {
      return feature;
    }

    anchors[targetAnchorIndex] = targetAnchor.withShape(replacedShape);
    return this._rebuildFeatureWithAnchors(feature, anchors);
  }

  _buildLegacyFeatureForVertexReplacement(feature, editTime, replacementMap) {
    if (feature instanceof Point) {
      const vertexId = typeof feature.getVertexIdAt === 'function'
        ? feature.getVertexIdAt(editTime)
        : feature.vertexId;
      const replaced = replacementMap.get(vertexId);
      if (!replaced) {
        return feature;
      }
      return feature.withVertexIds([replaced]);
    }
    if (feature instanceof Line) {
      const currentVertexIds = typeof feature.getVertexIdsAt === 'function'
        ? feature.getVertexIdsAt(editTime)
        : feature.vertexIds;
      if (!Array.isArray(currentVertexIds)) {
        return feature;
      }
      const nextVertexIds = currentVertexIds.map(vertexId => replacementMap.get(vertexId) || vertexId);
      if (JSON.stringify(currentVertexIds) === JSON.stringify(nextVertexIds)) {
        return feature;
      }
      return feature.withVertexIds(nextVertexIds);
    }
    if (feature instanceof Polygon) {
      let polygon = feature;
      let changed = false;
      const rings = Array.isArray(feature.rings) ? feature.rings : [];
      rings.forEach(ring => {
        if (!Array.isArray(ring?.vertexIds)) {
          return;
        }
        const nextVertexIds = ring.vertexIds.map(vertexId => replacementMap.get(vertexId) || vertexId);
        if (JSON.stringify(ring.vertexIds) === JSON.stringify(nextVertexIds)) {
          return;
        }
        polygon = polygon.withUpdatedRingVertices(ring.id, nextVertexIds);
        changed = true;
      });
      return changed ? polygon : feature;
    }
    return feature;
  }

  _replaceAnchorShapeVertexIds(feature, anchor, replacementMap, editTime) {
    if (feature instanceof Point) {
      const currentVertexId = anchor?.shape?.type === 'Point' && typeof anchor.shape.vertexId === 'string'
        ? anchor.shape.vertexId
        : (typeof feature.getVertexIdAt === 'function' ? feature.getVertexIdAt(editTime) : feature.vertexId);
      return {
        type: 'Point',
        vertexId: replacementMap.get(currentVertexId) || currentVertexId
      };
    }

    if (feature instanceof Line) {
      const currentVertexIds = anchor?.shape?.type === 'LineString' && Array.isArray(anchor.shape.vertexIds)
        ? [...anchor.shape.vertexIds]
        : (typeof feature.getVertexIdsAt === 'function' ? feature.getVertexIdsAt(editTime) : feature.vertexIds || []);
      return {
        type: 'LineString',
        vertexIds: currentVertexIds.map(vertexId => replacementMap.get(vertexId) || vertexId)
      };
    }

    if (feature instanceof Polygon) {
      const currentRings = anchor?.shape?.type === 'Polygon' && Array.isArray(anchor.shape.rings)
        ? anchor.shape.rings
        : (typeof feature.getRingsAt === 'function' ? feature.getRingsAt(editTime) : feature.rings || []);
      return {
        type: 'Polygon',
        rings: currentRings.map(ring => ({
          id: ring.id,
          vertexIds: Array.isArray(ring.vertexIds)
            ? ring.vertexIds.map(vertexId => replacementMap.get(vertexId) || vertexId)
            : [],
          ringType: ring.ringType,
          parentId: ring.parentId ?? null
        }))
      };
    }

    return anchor?.shape || {};
  }

  _rebuildFeatureWithAnchors(feature, anchors) {
    if (feature && typeof feature.withAnchors === 'function') {
      return feature.withAnchors(anchors);
    }

    if (feature instanceof Point) {
      const latestVertexId = typeof feature.getVertexIdAt === 'function'
        ? feature.getVertexIdAt(null)
        : feature.vertexId;
      return new Point(feature.id, [latestVertexId], feature.properties, feature.layerId, anchors);
    }
    if (feature instanceof Line) {
      const latestVertexIds = typeof feature.getVertexIdsAt === 'function'
        ? feature.getVertexIdsAt(null)
        : feature.vertexIds;
      return new Line(feature.id, latestVertexIds, feature.properties, feature.layerId, anchors);
    }
    if (feature instanceof Polygon) {
      const latestPlacement = typeof feature.getPlacementAt === 'function'
        ? feature.getPlacementAt(null)
        : { parentId: feature.parentId, childIds: feature.childIds };
      const latestRings = typeof feature.getRingsAt === 'function'
        ? feature.getRingsAt(null)
        : feature.rings;
      const clonedRings = Array.isArray(latestRings)
        ? latestRings.map(ring => ({
            id: ring.id,
            vertexIds: [...ring.vertexIds],
            ringType: ring.ringType,
            parentId: ring.parentId ?? null
          }))
        : [];
      return new Polygon(
        feature.id,
        feature.properties,
        feature.layerId,
        latestPlacement.parentId,
        latestPlacement.childIds || [],
        clonedRings,
        anchors
      );
    }
    return feature;
  }

  _validatePolygonsSelfIntersectionAtTime(polygons, vertices, timePoint) {
    if (!(timePoint instanceof TimePoint) || !Array.isArray(polygons) || polygons.length === 0) {
      return null;
    }
    const vertexMap = new Map((vertices || []).map(vertex => [vertex.id, vertex]));

    for (const polygon of polygons) {
      if (!(polygon instanceof Polygon) || !polygon.existsAt(timePoint)) {
        continue;
      }
      const rings = typeof polygon.getRingsAt === 'function'
        ? polygon.getRingsAt(timePoint)
        : polygon.rings;
      for (const ring of rings || []) {
        if (!Array.isArray(ring?.vertexIds) || ring.vertexIds.length < 3) {
          continue;
        }
        const ringVertices = ring.vertexIds.map(vertexId => {
          const vertexData = vertexMap.get(vertexId);
          return vertexData ? new Vertex(vertexData.id, vertexData.x, vertexData.y) : null;
        }).filter(Boolean);
        if (ringVertices.length !== ring.vertexIds.length) {
          return new Error(`頂点移動後のリング ${ring.id} に不足頂点があります。`);
        }
        if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
          return new Error(`頂点移動によりポリゴン ${polygon.id} のリング ${ring.id} が自己交差しました。`);
        }
      }
    }
    return null;
  }

  _generateUniqueId(type, existingIds) {
    let candidate = this._generateId(type);
    while (existingIds.has(candidate)) {
      candidate = this._generateId(type);
    }
    return candidate;
  }

  /**
   * 頂点を共有化
   * @param {string} vertexId1 - 頂点1のID
   * @param {string} vertexId2 - 頂点2のID
   * @param {Object} [options]
   * @param {string} [options.preferredKeptVertexId] - 優先して残す頂点ID
   * @returns {Promise<Object>} 更新情報 { keptVertex, removedVertex, affectedFeatures }
   */
  async shareVertices(vertexId1, vertexId2, options = {}) {
    const world = await this._worldRepository.getWorld();
    if (vertexId1 === vertexId2) {
        throw new Error('Cannot share the same vertex.');
    }
    const vertex1 = world.vertices.find(v => v.id === vertexId1);
    const vertex2 = world.vertices.find(v => v.id === vertexId2);
    if (!vertex1 || !vertex2) throw new Error('One or both vertices not found');

    const preferredKeptVertexId = options?.preferredKeptVertexId;
    const hasPreferredKeptVertex = preferredKeptVertexId === vertexId1 || preferredKeptVertexId === vertexId2;
    const keptVertexId = hasPreferredKeptVertex
      ? preferredKeptVertexId
      : this._getOlderVertexId(vertexId1, vertexId2);
    const removedVertexId = keptVertexId === vertexId1 ? vertexId2 : vertexId1;
    const keptVertex = keptVertexId === vertexId1 ? vertex1 : vertex2;
    const removedVertex = keptVertexId === vertexId1 ? vertex2 : vertex1;
    const affectedFeatures = [];

    // 更新後の地物リストを作成
    const updatedFeatures = [];
    for (let i = 0; i < world.features.length; i++) {
        let feature = world.features[i];
        let featureUpdated = false;

        if (feature instanceof Point || feature instanceof Line) {
            if (feature.vertexIds.includes(removedVertexId)) {
                const newVertexIds = feature.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
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
    const updatedVertices = world.vertices.filter(v => v.id !== removedVertexId);

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
                const ringVertices = getVerticesByIdsForPolygon(ring.vertexIds, updatedVertices);
                if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
                    selfIntersectionError = new Error(`頂点共有化によりポリゴン ${affFeature.id} のリング ${ring.id} が自己交差しました。`);
                    break;
                }
            }
        }
        if (selfIntersectionError) break;
    }

    const constraintError = this._validatePolygonConstraints(
        affectedFeatures.filter(feature => feature instanceof Polygon),
        { ...world, features: updatedFeatures, vertices: updatedVertices },
        [vertexId1, vertexId2]
    );

    if (selfIntersectionError || constraintError) {
        throw selfIntersectionError || constraintError;
    }

    world.features = updatedFeatures;
    world.vertices = updatedVertices;

    await this._worldRepository.saveWorld(world);
    return { keptVertex, removedVertex, affectedFeatures };
  }

  /**
   * 共有頂点を解除
   * @param {string} vertexId - 共有を解除する頂点のID
   * @param {string} featureId - この地物に対して新しい頂点を作成
   * @returns {Promise<Object>} 更新情報 { newVertex, updatedFeature }
   */
  async unlinkSharedVertex(vertexId, featureId, vertexIdToUse = null) {
    const world = await this._worldRepository.getWorld();
    const vertex = world.vertices.find(v => v.id === vertexId);
    if (!vertex) throw new Error(`Vertex not found with ID: ${vertexId}`);
    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) throw new Error(`Feature not found with ID: ${featureId}`);
    const originalFeature = world.features[featureIndex];
    if (!originalFeature || typeof originalFeature !== "object") throw new Error(`Invalid feature object found for ID: ${featureId}`);

    const isPolygon = originalFeature instanceof Polygon || originalFeature.constructor?.name === "Polygon";
    const usesVertex = (originalFeature.vertexIds && originalFeature.vertexIds.includes(vertexId)) ||
                       (isPolygon && originalFeature.rings?.some(ring => ring.vertexIds.includes(vertexId)));
    if (!usesVertex) throw new Error(`Feature ${featureId} does not use vertex with ID: ${vertexId}`);

    const ownerIds = new Set();
    world.features.forEach(feature => {
      const featureUsesVertex = (feature.vertexIds && feature.vertexIds.includes(vertexId)) ||
        ((feature instanceof Polygon || feature.constructor?.name === "Polygon") && feature.rings?.some(ring => ring.vertexIds.includes(vertexId)));
      if (featureUsesVertex) {
        ownerIds.add(feature.id);
      }
    });
    if (ownerIds.size <= 1) {
      throw new Error('共有頂点ではないため解除できません。');
    }

    const newVertexId = vertexIdToUse || this._generateId("vertex");
    if (newVertexId === vertexId) {
      throw new Error('Cannot unlink using the same vertex ID.');
    }
    const newVertex = { id: newVertexId, x: vertex.x, y: vertex.y };

    let featureUpdated = false;
    let updatedFeature = originalFeature;

    if (originalFeature instanceof Point || originalFeature instanceof Line) {
        if (originalFeature.vertexIds.includes(vertexId)) {
            const newVertexIds = originalFeature.vertexIds.map(id => id === vertexId ? newVertexId : id);
            updatedFeature = originalFeature.withVertexIds(newVertexIds);
            featureUpdated = true;
        }
    } else if (isPolygon) {
        let tempPolygon = originalFeature;
        for (const ring of originalFeature.rings) {
            if (ring.vertexIds.includes(vertexId)) {
                const newRingVertexIds = ring.vertexIds.map(id => id === vertexId ? newVertexId : id);
                tempPolygon = tempPolygon.withUpdatedRingVertices(ring.id, newRingVertexIds);
                featureUpdated = true;
            }
        }
        updatedFeature = tempPolygon;
    }

    if (!featureUpdated) {
        console.error(`Failed to update feature ${featureId} during vertex unlink.`);
        throw new Error(`Failed to update feature ${featureId} during vertex unlink.`);
    }

    let selfIntersectionError = null;
    if (isPolygon && updatedFeature instanceof Polygon) {
        const getVerticesByIdsForPolygon = (ids, currentWorldVertices) => {
            const vertexMap = new Map(currentWorldVertices.map(v => [v.id, v]));
            return ids?.map(id => {
                const vData = vertexMap.get(id);
                return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
            }).filter(Boolean) || [];
        };
        for (const ring of updatedFeature.rings) {
            const ringVertices = getVerticesByIdsForPolygon(ring.vertexIds, [...world.vertices.filter(v => v.id !== newVertexId), newVertex]);
            if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
                selfIntersectionError = new Error(`共有頂点解除によりポリゴン ${updatedFeature.id} のリング ${ring.id} が自己交差しました。`);
                break;
            }
        }
    }

    const updatedVertices = world.vertices.map(v => {
      if (v.id === newVertexId) {
        return { id: newVertexId, x: newVertex.x, y: newVertex.y };
      }
      return v;
    });
    if (!updatedVertices.some(v => v.id === newVertexId)) {
      updatedVertices.push(newVertex);
    }

    const updatedFeatures = [...world.features];
    updatedFeatures[featureIndex] = updatedFeature;

    const constraintError = this._validatePolygonConstraints(
      updatedFeature instanceof Polygon ? [updatedFeature] : [],
      { ...world, features: updatedFeatures, vertices: updatedVertices },
      [vertexId, newVertexId]
    );

    if (selfIntersectionError || constraintError) {
        throw selfIntersectionError || constraintError;
    }

    world.features = updatedFeatures;
    world.vertices = updatedVertices;

    await this._worldRepository.saveWorld(world);
    return { newVertex: newVertex, updatedFeature: world.features[featureIndex] };
  }

  /**
   * 地物のエッジに頂点を追加する
   * @param {string} featureId - 対象の地物ID
   * @param {string} segmentStartVertexId - 線分の開始頂点ID
   * @param {string} segmentEndVertexId - 線分の終了頂点ID
   * @param {{x: number, y: number}} newVertexPosition - 新しい頂点のワールド座標
   * @param {string | null} [ringId=null] - ポリゴンの場合、対象リングのID
   * @param {string | null} [vertexIdToUse=null] - Redo時に再利用する頂点ID
   * @returns {Promise<{newVertex: Vertex, updatedFeature: Feature}>} 追加された頂点と更新された地物のインスタンス
   */
  async addVertexToFeatureEdge(featureId, segmentStartVertexId, segmentEndVertexId, newVertexPosition, ringId = null, vertexIdToUse = null) {
    const world = await this._worldRepository.getWorld();
    const newVertexId = vertexIdToUse || this._generateId('vertex');
    const newVertexData = { id: newVertexId, x: newVertexPosition.x, y: newVertexPosition.y };

    if (!world.vertices.some(v => v.id === newVertexId)) {
        world.vertices.push(newVertexData);
    } else {
        console.log(`Vertex with ID ${newVertexId} already exists. Reusing it.`);
    }

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      world.vertices = world.vertices.filter(v => v.id !== newVertexId);
      throw new Error(`Feature not found with ID: ${featureId}`);
    }

    let featureToUpdate = world.features[featureIndex];
    let successfullyUpdated = false;

    try {
      if (featureToUpdate instanceof Line) {
        const oldVertexIds = featureToUpdate.vertexIds;
        const startIndex = oldVertexIds.indexOf(segmentStartVertexId);
        const endIndex = oldVertexIds.indexOf(segmentEndVertexId);

        if (startIndex === -1 || endIndex === -1) {
          throw new Error(`Segment vertices not found in Line ${featureId}`);
        }
        if (Math.abs(startIndex - endIndex) !== 1) {
            throw new Error(`Segment ${segmentStartVertexId}-${segmentEndVertexId} is not a direct segment in Line ${featureId}.`);
        }

        const insertBeforeIndex = Math.max(startIndex, endIndex);
        const newVertexIds = [
          ...oldVertexIds.slice(0, insertBeforeIndex),
          newVertexId,
          ...oldVertexIds.slice(insertBeforeIndex)
        ];
        featureToUpdate = featureToUpdate.withVertexIds(newVertexIds);
        successfullyUpdated = true;

      } else if (featureToUpdate instanceof Polygon) {
        if (!ringId) {
          throw new Error(`ringId is required for adding a vertex to a Polygon edge.`);
        }
        const targetRingIndex = featureToUpdate.rings.findIndex(r => r.id === ringId);
        if (targetRingIndex === -1) {
          throw new Error(`Ring with ID ${ringId} not found in Polygon ${featureId}`);
        }
        const targetRing = featureToUpdate.rings[targetRingIndex];
        const oldRingVertexIds = targetRing.vertexIds;
        const startIndex = oldRingVertexIds.indexOf(segmentStartVertexId);
        const endIndex = oldRingVertexIds.indexOf(segmentEndVertexId);

        if (startIndex === -1 || endIndex === -1) {
          throw new Error(`Segment vertices not found in Ring ${ringId} of Polygon ${featureId}`);
        }

        let insertBeforeIndex = -1;
        if ((startIndex + 1) % oldRingVertexIds.length === endIndex) { // 正順
            insertBeforeIndex = endIndex;
        } else if ((endIndex + 1) % oldRingVertexIds.length === startIndex) { // 逆順
            insertBeforeIndex = startIndex;
        } else {
            throw new Error(`Segment ${segmentStartVertexId}-${segmentEndVertexId} is not a direct segment in Ring ${ringId}.`);
        }
        
        const newRingVertexIds = [
          ...oldRingVertexIds.slice(0, insertBeforeIndex),
          newVertexId,
          ...oldRingVertexIds.slice(insertBeforeIndex)
        ];
        featureToUpdate = featureToUpdate.withUpdatedRingVertices(ringId, newRingVertexIds);
        successfullyUpdated = true;

      } else {
        throw new Error(`Unsupported feature type for adding vertex to edge: ${featureToUpdate.constructor.name}`);
      }

      if (featureToUpdate instanceof Polygon) {
        const getVerticesByIdsForPolygon = (ids, currentWorldVertices) => {
            const vertexMap = new Map(currentWorldVertices.map(v => [v.id, v]));
            return ids?.map(id => {
                const vData = vertexMap.get(id);
                return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
            }).filter(Boolean) || [];
        };
        for (const ring of featureToUpdate.rings) {
            const ringVertices = getVerticesByIdsForPolygon(ring.vertexIds, world.vertices);
            if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
                throw new Error(`Adding vertex to edge resulted in self-intersection in Polygon ${featureId}, Ring ${ring.id}.`);
            }
        }
      }

      world.features[featureIndex] = featureToUpdate;
      await this._worldRepository.saveWorld(world);
      return {
        newVertex: new Vertex(newVertexData.id, newVertexData.x, newVertexData.y),
        updatedFeature: featureToUpdate
      };

    } catch (error) {
      if (!successfullyUpdated) {
          world.vertices = world.vertices.filter(v => v.id !== newVertexId);
      }
      console.error("Error in addVertexToFeatureEdge:", error);
      throw error;
    }
  }

  /**
   * 頂点移動時の衝突処理 (EditFeatureUseCaseから移動、リングベース対応)
   * @private
   */
  _handleCollisionForVertexMove(vertex, newPosition, world) {
    if (!vertex || !world) {
      return newPosition;
    }
    const adjustedPositions = applyVertexSliding({
      world,
      geometryService: this._geometryService,
      movedVertexIds: new Set([vertex.id]),
      desiredPositions: new Map([[vertex.id, newPosition]]),
      originalPositions: new Map([[vertex.id, { x: vertex.x, y: vertex.y }]])
    });
    return adjustedPositions.get(vertex.id) || newPosition;
  }

  _validatePolygonConstraints(polygons, world, vertexIdsInvolved) {
    if (!this._layerService || polygons.length === 0) {
      return null;
    }

    try {
      polygons.forEach(polygon => {
        ensurePolygonLayerConstraints(polygon, world, this._layerService, this._geometryService);
      });
      return null;
    } catch (error) {
      const message = error?.message || '';
      if (vertexIdsInvolved && vertexIdsInvolved.length > 0) {
        error.message = `${message} (頂点: ${vertexIdsInvolved.join(', ')})`;
      }
      return error;
    }
  }
}
