import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { AddVertexToEdgeCommand } from '../../application/services/history/commands/AddVertexToEdgeCommand.js';
import { MoveVerticesCommand } from '../../application/services/history/commands/MoveVerticesCommand.js';
import { ShareVerticesCommand } from '../../application/services/history/commands/ShareVerticesCommand.js';
import { applyVertexSliding, createVertexSlidingContext } from '../../application/services/VertexSlideService.js';
import { AnchorConflictResolutionDialog } from '../views/sidebar/AnchorConflictResolutionDialog.js';

const MAX_CONFLICT_RETRY_COUNT = 4;

function isAnchorConflictError(error) {
  return !!(
    error &&
    typeof error === 'object' &&
    error.code === 'FEATURE_ANCHOR_CONFLICTS' &&
    Array.isArray(error.conflicts)
  );
}

function ensureAnchorConflictDialog(context) {
  if (!context._anchorConflictResolutionDialog) {
    context._anchorConflictResolutionDialog = new AnchorConflictResolutionDialog();
  }
  return context._anchorConflictResolutionDialog;
}

function formatFeatureLabel(feature, fallbackId, timePoint = null) {
  if (!feature) {
    return `ID: ${fallbackId}`;
  }
  const anchor = typeof feature.getAnchorAt === 'function'
    ? feature.getAnchorAt(timePoint)
    : null;
  const name = anchor?.name;
  if (typeof name === 'string' && name.trim() !== '') {
    return `${name.trim()} (ID: ${fallbackId})`;
  }
  return `ID: ${fallbackId}`;
}

/**
 * 複数の頂点のドラッグを開始
 * @param {Map<string, {x: number, y: number}>} vertices - ドラッグする頂点のIDと開始位置のMap
 */
function startVerticesDrag(vertices) {
  if (this._mode !== 'edit' || this._tool === 'add-hole') { return; }
  if (!vertices || vertices.size === 0) { return; }
  if (this._draggingVerticesInfo.size > 0) { return; }
  this._draggingVerticesInfo.clear();
  for (const [vertexId, position] of vertices.entries()) {
    this._draggingVerticesInfo.set(vertexId, { originalPosition: { ...position }, currentPosition: { ...position } });
  }
  this._notifyObservers('draggingVertices');
}

/**
 * 頂点ドラッグ中の位置更新
 * @param {number} deltaX - X方向の移動差分 (ワールド座標)
 * @param {number} deltaY - Y方向の移動差分 (ワールド座標)
 */
function updateVerticesDrag(deltaX, deltaY, options = {}) {
  if (this._draggingVerticesInfo.size === 0) { return; }
  let positionChanged = false;

  const desiredPositions = new Map();
  const originalPositions = new Map();
  for (const [vertexId, info] of this._draggingVerticesInfo.entries()) {
    const desired = {
      x: info.originalPosition.x + deltaX,
      y: info.originalPosition.y + deltaY
    };
    desiredPositions.set(vertexId, desired);
    originalPositions.set(vertexId, { x: info.originalPosition.x, y: info.originalPosition.y });
  }

  let resolvedPositions = desiredPositions;
  if (options.world && options.geometryService) {
    if (!this._vertexSlideContext || this._vertexSlideContext.world !== options.world) {
      this._vertexSlideContext = createVertexSlidingContext(options.world);
    }
    resolvedPositions = applyVertexSliding({
      world: options.world,
      geometryService: options.geometryService,
      movedVertexIds: new Set(desiredPositions.keys()),
      desiredPositions,
      originalPositions,
      context: this._vertexSlideContext
    });
  }

  for (const [vertexId, info] of this._draggingVerticesInfo.entries()) {
    const nextPos = resolvedPositions.get(vertexId) || desiredPositions.get(vertexId);
    if (!nextPos) continue;
    if (info.currentPosition.x !== nextPos.x || info.currentPosition.y !== nextPos.y) {
      info.currentPosition = { x: nextPos.x, y: nextPos.y };
      positionChanged = true;
    }
  }
  if (positionChanged) { this._notifyObservers('draggingVertices'); }
}

/**
 * 頂点ドラッグの終了
 * @returns {Promise<void>}
 */
async function endVerticesDrag(options = {}) {
  if (this._draggingVerticesInfo.size === 0) { return; }

  const isChainedFromVertexAddition = 
    this._pendingVertexAdditionInfo &&
    this._draggingVerticesInfo.has(this._pendingVertexAdditionInfo.newVertexId);

  const dragInfoCopy = new Map(this._draggingVerticesInfo);
  this._resetDraggingState();

  if (isChainedFromVertexAddition) {
    const pendingInfo = { ...this._pendingVertexAdditionInfo };
    this._pendingVertexAdditionInfo = null;
    this.clearTemporaryElements();

    const newVertexInfo = dragInfoCopy.get(pendingInfo.newVertexId);
    if (!newVertexInfo) {
      console.error("Chained vertex drag end failed: Drag info not found for new vertex.");
      return;
    }
    
    const finalPosition = newVertexInfo.currentPosition;

    try {
      const result = await this._editFeatureUseCase.addVertexToFeatureEdge(
        pendingInfo.featureId,
        pendingInfo.segmentStartVertexId,
        pendingInfo.segmentEndVertexId,
        finalPosition,
        pendingInfo.ringId,
        pendingInfo.newVertexId
      );

      const payload = {
        featureId: pendingInfo.featureId,
        ringId: pendingInfo.ringId,
        segmentStartVertexId: pendingInfo.segmentStartVertexId,
        segmentEndVertexId: pendingInfo.segmentEndVertexId,
        newVertexId: pendingInfo.newVertexId,
        newVertexPosition: finalPosition,
        addedVertexData: this._historyService._serializer.serialize(new Vertex(pendingInfo.newVertexId, finalPosition.x, finalPosition.y)),
        featureBeforeData: pendingInfo.featureBeforeData 
      };
      const command = new AddVertexToEdgeCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
      this._historyService._stackManager.pushUndo(command);
      this._historyService._notifyHistoryChanged();

      this._eventBus.publish('FeatureUpdated', { feature: result.updatedFeature });
    } catch (error) {
      console.error('線上への頂点追加（ドラッグ完了時）に失敗しました', error);
      alert(`頂点追加に失敗しました: ${error.message}`);
      this._eventBus.publish('WorldUpdated');
    }
  } else {
    const vertexUpdatesForUseCase = [];
    const historyPayloadUpdates = [];
    let significantMovement = false;
    const clickToleranceSq = 1e-6; 

    for (const [vertexId, info] of dragInfoCopy.entries()) {
      const dx = info.currentPosition.x - info.originalPosition.x;
      const dy = info.currentPosition.y - info.originalPosition.y;
      if ((dx * dx + dy * dy) > clickToleranceSq) {
        significantMovement = true;
      }
      vertexUpdatesForUseCase.push({ vertexId, newPosition: info.currentPosition });
      historyPayloadUpdates.push({
        vertexId,
        oldPosition: this._historyService._serializer.serialize(new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y)),
        newPosition: this._historyService._serializer.serialize(new Vertex(vertexId, info.currentPosition.x, info.currentPosition.y))
      });
    }

    if (significantMovement) {
      try {
        let moveOptions = options?.editTime ? { editTime: options.editTime } : undefined;
        let moveResult = null;
        let retryCount = 0;
        while (retryCount < MAX_CONFLICT_RETRY_COUNT) {
          try {
            moveResult = moveOptions
              ? await this._editFeatureUseCase.moveVertices(vertexUpdatesForUseCase, moveOptions)
              : await this._editFeatureUseCase.moveVertices(vertexUpdatesForUseCase);
            break;
          } catch (error) {
            if (!isAnchorConflictError(error) || !options?.editTime) {
              throw error;
            }
            const worldRepository = this._editFeatureUseCase.getWorldRepository();
            const world = await worldRepository.getWorld();
            const dialog = ensureAnchorConflictDialog(this);
            const conflicts = Array.isArray(error.conflicts) ? error.conflicts : [];
            const resolveFeatureLabel = (featureId) => {
              const feature = world.features.find(candidate => String(candidate?.id) === String(featureId));
              return formatFeatureLabel(feature, String(featureId), options.editTime);
            };
            const resolutions = await dialog.show({
              conflicts,
              resolveFeatureLabel
            });
            if (!resolutions) {
              throw new Error('競合解決をキャンセルしました。');
            }
            moveOptions = {
              editTime: options.editTime,
              conflictResolutions: resolutions
            };
            retryCount += 1;
          }
        }
        if (!moveResult) {
          throw new Error('競合解決の再試行回数が上限を超えました。');
        }

        let payload = { updates: historyPayloadUpdates };
        const featureChangesRaw = Array.isArray(moveResult?.historyPatch?.featureChanges)
          ? moveResult.historyPatch.featureChanges
          : [];
        const addedVerticesRaw = Array.isArray(moveResult?.historyPatch?.addedVertices)
          ? moveResult.historyPatch.addedVertices
          : [];

        if (featureChangesRaw.length > 0) {
          const featureChanges = featureChangesRaw
            .map(change => ({
              featureId: change.featureId,
              beforeFeatureData: this._historyService._serializer.serialize(change.beforeFeature),
              afterFeatureData: this._historyService._serializer.serialize(change.afterFeature)
            }))
            .filter(change => change.beforeFeatureData && change.afterFeatureData);

          const addedVertices = addedVerticesRaw
            .map(vertex => this._historyService._serializer.serialize(new Vertex(vertex.id, vertex.x, vertex.y)))
            .filter(Boolean);

          if (featureChanges.length > 0) {
            payload = {
              featureChanges,
              addedVertices
            };
          }
        }

        const command = new MoveVerticesCommand(
          payload,
          this._editFeatureUseCase,
          this._historyService._serializer,
          this._historyService._worldRepository
        );
        this._historyService._stackManager.pushUndo(command);
        this._historyService._notifyHistoryChanged();

        if (moveResult?.requiresWorldRefresh) {
          this._eventBus.publish('WorldUpdated');
        } else {
          const shareResult = await this._applyVertexSharingAfterDrag(dragInfoCopy, options);
          if (shareResult.shared) {
            this._eventBus.publish('WorldUpdated');
          } else if (moveResult && moveResult.updatedVertices) {
            moveResult.updatedVertices.forEach(v => this._eventBus.publish('VertexMoved', { vertexId: v.id, newPosition: {x: v.x, y: v.y} }));
          }
        }
      } catch (error) {
        console.error('複数頂点の移動確定に失敗しました', error);
        alert(`頂点の移動に失敗しました: ${error.message}`);
        this._eventBus.publish('WorldUpdated');
      }
    }
  }
}

/**
 * ドラッグ中の頂点情報を取得
 * @returns {Map<string, { originalPosition: {x, y}, currentPosition: {x, y} }>} ドラッグ情報Map
 */
function getDraggingVerticesInfo() {
  return this._draggingVerticesInfo;
}

/**
 * 保留中の線上点追加情報を取得
 * @returns {Object | null} 
 */
function getPendingVertexAdditionInfo() {
  return this._pendingVertexAdditionInfo;
}

/**
 * ドラッグ状態をリセット
 * @private
 */
function _resetDraggingState() {
  if (this._draggingVerticesInfo.size > 0) {
    this._draggingVerticesInfo.clear();
    this._notifyObservers('draggingVertices');
  }
  this._vertexSlideContext = null;
}

function getSharePreviewVertexIds(options = {}) {
  if (!this._draggingVerticesInfo || this._draggingVerticesInfo.size === 0) {
    return new Set();
  }
  const world = options?.world;
  if (!world || !Array.isArray(world.vertices)) {
    return new Set();
  }

  const candidates = this._findShareCandidates(this._draggingVerticesInfo, world, { ...options, useDragPositions: true });
  if (candidates.length === 0) {
    return new Set();
  }

  const draggedIds = new Set(this._draggingVerticesInfo.keys());
  const previewIds = new Set();
  candidates.forEach(candidate => {
    if (draggedIds.has(candidate.vertexId1)) {
      previewIds.add(candidate.vertexId1);
    }
    if (draggedIds.has(candidate.vertexId2)) {
      previewIds.add(candidate.vertexId2);
    }
  });

  return previewIds;
}

function _findShareCandidates(dragInfo, world, options) {
  if (!dragInfo || dragInfo.size === 0) {
    return [];
  }
  const snapWorldDistance = Number.isFinite(options?.snapWorldDistance) ? options.snapWorldDistance : null;
  if (!snapWorldDistance || snapWorldDistance <= 0) {
    return [];
  }
  if (!world || !Array.isArray(world.vertices)) {
    return [];
  }

  const featuresForSharing = this._resolveFeaturesForSharing(world, options);
  const ownerMap = this._buildVertexOwnerMap(featuresForSharing);
  const visibleVertexIds = new Set(ownerMap.keys());
  if (visibleVertexIds.size === 0) {
    return [];
  }

  const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
  const draggedIds = new Set(dragInfo.keys());
  const snapDistanceSq = snapWorldDistance * snapWorldDistance;
  const worldWidth = Number.isFinite(options?.worldWidth) ? options.worldWidth : null;
  const candidates = [];
  const visitedPairs = new Set();
  const useDragPositions = options?.useDragPositions === true;

  const getCurrentPosition = (vertexId) => {
    if (useDragPositions) {
      const dragEntry = dragInfo.get(vertexId);
      if (dragEntry && dragEntry.currentPosition) {
        return dragEntry.currentPosition;
      }
    }
    return verticesMap.get(vertexId);
  };

  const getOriginalPosition = (vertexId) => {
    const dragEntry = dragInfo.get(vertexId);
    if (dragEntry && dragEntry.originalPosition) {
      return dragEntry.originalPosition;
    }
    return verticesMap.get(vertexId);
  };

  for (const draggedId of draggedIds) {
    if (!visibleVertexIds.has(draggedId)) {
      continue;
    }
    const draggedVertex = getCurrentPosition(draggedId);
    if (!draggedVertex) {
      continue;
    }

    for (const otherId of visibleVertexIds) {
      if (otherId === draggedId) continue;
      const pairKey = draggedId < otherId ? `${draggedId}|${otherId}` : `${otherId}|${draggedId}`;
      if (visitedPairs.has(pairKey)) continue;
      visitedPairs.add(pairKey);

      const ownersA = ownerMap.get(draggedId);
      const ownersB = ownerMap.get(otherId);
      if (ownersA && ownersB && this._hasOwnerIntersection(ownersA, ownersB)) {
        continue;
      }

      const otherVertex = getCurrentPosition(otherId);
      if (!otherVertex) continue;

      const distanceSq = this._calculateDistanceSqWithWrap(draggedVertex, otherVertex, worldWidth);
      if (distanceSq > snapDistanceSq) continue;

      const originalPosA = getOriginalPosition(draggedId);
      const originalPosB = getOriginalPosition(otherId);
      if (!originalPosA || !originalPosB) {
        continue;
      }
      const originalDistanceSq = this._calculateDistanceSqWithWrap(originalPosA, originalPosB, worldWidth);
      if (originalDistanceSq <= snapDistanceSq) continue;

      candidates.push({ vertexId1: draggedId, vertexId2: otherId, distanceSq });
    }
  }

  return candidates;
}

async function _applyVertexSharingAfterDrag(dragInfo, options) {
  const snapWorldDistance = Number.isFinite(options?.snapWorldDistance) ? options.snapWorldDistance : null;
  if (!snapWorldDistance || snapWorldDistance <= 0) {
    return { shared: false };
  }

  const worldRepository = this._editFeatureUseCase.getWorldRepository();
  const world = await worldRepository.getWorld();
  if (!world || !Array.isArray(world.vertices)) {
    return { shared: false };
  }

  const candidates = this._findShareCandidates(dragInfo, world, { ...options, snapWorldDistance, useDragPositions: false });

  if (candidates.length === 0) {
    return { shared: false };
  }

  candidates.sort((a, b) => a.distanceSq - b.distanceSq);
  const mergedIds = new Set();
  let shared = false;

  for (const candidate of candidates) {
    if (mergedIds.has(candidate.vertexId1) || mergedIds.has(candidate.vertexId2)) {
      continue;
    }
    try {
      const isFirstDragged = dragInfo.has(candidate.vertexId1);
      const isSecondDragged = dragInfo.has(candidate.vertexId2);
      const preferredKeptVertexId = isFirstDragged !== isSecondDragged
        ? (isFirstDragged ? candidate.vertexId2 : candidate.vertexId1)
        : null;
      const shareResult = await this._shareVerticesWithHistory(candidate.vertexId1, candidate.vertexId2, { preferredKeptVertexId });
      if (shareResult?.removedVertexId) {
        shared = true;
        mergedIds.add(candidate.vertexId1);
        mergedIds.add(candidate.vertexId2);
        mergedIds.add(shareResult.removedVertexId);
      }
    } catch (error) {
      console.warn('頂点共有化に失敗しました', error);
    }
  }

  return { shared };
}

async function _shareVerticesWithHistory(vertexId1, vertexId2, options = {}) {
  if (!vertexId1 || !vertexId2 || vertexId1 === vertexId2) {
    return null;
  }

  const worldRepository = this._editFeatureUseCase.getWorldRepository();
  const worldBefore = await worldRepository.getWorld();
  const affectedBefore = this._collectAffectedFeaturesForVertices(worldBefore.features, new Set([vertexId1, vertexId2]));

  const shareResult = await this._editFeatureUseCase.shareVertices(vertexId1, vertexId2, options);
  if (!shareResult || !shareResult.removedVertex) {
    return null;
  }

  const removedVertex = shareResult.removedVertex;
  const payload = {
    vertexId1,
    vertexId2,
    keptVertexId: shareResult.keptVertex ? shareResult.keptVertex.id : null,
    removedVertexData: this._historyService._serializer.serialize(new Vertex(removedVertex.id, removedVertex.x, removedVertex.y)),
    affectedFeaturesBefore: affectedBefore.map(feature => this._historyService._serializer.serialize(feature))
  };
  const command = new ShareVerticesCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
  this._historyService._stackManager.pushUndo(command);
  this._historyService._notifyHistoryChanged();

  return { removedVertexId: removedVertex.id };
}

function _resolveFeaturesForSharing(world, options) {
  if (!world || !Array.isArray(world.features)) {
    return [];
  }
  const visibleFeatures = Array.isArray(options?.visibleFeatures) ? options.visibleFeatures : null;
  if (!visibleFeatures) {
    return world.features;
  }
  const visibleIds = new Set(visibleFeatures.map(feature => feature.id));
  return world.features.filter(feature => visibleIds.has(feature.id));
}

function _buildVertexOwnerMap(features) {
  const ownerMap = new Map();
  if (!features) {
    return ownerMap;
  }

  features.forEach(feature => {
    const vertexIds = this._collectFeatureVertexIds(feature);
    vertexIds.forEach(vertexId => {
      if (!ownerMap.has(vertexId)) {
        ownerMap.set(vertexId, new Set());
      }
      ownerMap.get(vertexId).add(feature.id);
    });
  });

  return ownerMap;
}

function _collectAffectedFeaturesForVertices(features, vertexIdSet) {
  if (!features || !vertexIdSet || vertexIdSet.size === 0) {
    return [];
  }
  const affected = [];
  features.forEach(feature => {
    const vertexIds = this._collectFeatureVertexIds(feature);
    for (const id of vertexIds) {
      if (vertexIdSet.has(id)) {
        affected.push(feature);
        break;
      }
    }
  });
  return affected;
}

function _collectVertexOwnerIds(features, vertexId) {
  const owners = new Set();
  if (!features || !vertexId) {
    return owners;
  }
  features.forEach(feature => {
    const vertexIds = this._collectFeatureVertexIds(feature);
    if (vertexIds.has(vertexId)) {
      owners.add(feature.id);
    }
  });
  return owners;
}

function _collectFeatureVertexIds(feature) {
  const ids = new Set();
  if (!feature) {
    return ids;
  }
  if (feature instanceof DomainPolygon && Array.isArray(feature.rings)) {
    feature.rings.forEach(ring => {
      if (Array.isArray(ring.vertexIds)) ring.vertexIds.forEach(id => ids.add(id));
    });
  } else if (feature instanceof DomainLine && Array.isArray(feature.vertexIds)) {
    feature.vertexIds.forEach(id => ids.add(id));
  } else if (feature instanceof DomainPoint && Array.isArray(feature.vertexIds)) {
    feature.vertexIds.forEach(id => ids.add(id));
  }
  return ids;
}

function _hasOwnerIntersection(ownersA, ownersB) {
  for (const ownerId of ownersA) {
    if (ownersB.has(ownerId)) {
      return true;
    }
  }
  return false;
}

function _calculateDistanceSqWithWrap(pointA, pointB, worldWidth) {
  if (!pointA || !pointB) {
    return Infinity;
  }
  const dy = pointA.y - pointB.y;
  const dx = Math.abs(pointA.x - pointB.x);
  let dxMin = dx;
  if (Number.isFinite(worldWidth) && worldWidth > 0) {
    const dxPlus = Math.abs(pointA.x - (pointB.x + worldWidth));
    const dxMinus = Math.abs(pointA.x - (pointB.x - worldWidth));
    dxMin = Math.min(dx, dxPlus, dxMinus);
  }
  return (dxMin * dxMin) + (dy * dy);
}

/**
 * 指定されたエッジに頂点を追加する（プレビュー用）
 * @param {object} edgeInfo - エッジ情報 { featureId, ringId?, segmentStartVertexId, segmentEndVertexId, projectionPoint }
 * @returns {Promise<Vertex>} プレビュー用の新しい頂点インスタンス
 */
async function addVertexToEdge(edgeInfo) {
  if (!edgeInfo || !edgeInfo.featureId || !edgeInfo.segmentStartVertexId || !edgeInfo.segmentEndVertexId || !edgeInfo.projectionPoint) {
    throw new Error("頂点追加のためのエッジ情報が不完全です。");
  }

  // 既存の中間情報をクリア
  if (this._pendingVertexAdditionInfo) {
    this._clearAddingState();
  }

  try {
    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const worldBefore = await worldRepository.getWorld();
    const featureBeforeUpdate = worldBefore.features.find(f => f.id === edgeInfo.featureId);
    if (!featureBeforeUpdate) {
      throw new Error(`対象の地物が見つかりません: ${edgeInfo.featureId}`);
    }

    const newVertexId = this._editFeatureUseCase._idGenerationService.generateId('vertex');
    const newVertex = new Vertex(newVertexId, edgeInfo.projectionPoint.x, edgeInfo.projectionPoint.y);
    
    this._pendingVertexAdditionInfo = {
      featureId: edgeInfo.featureId,
      ringId: edgeInfo.ringId,
      segmentStartVertexId: edgeInfo.segmentStartVertexId,
      segmentEndVertexId: edgeInfo.segmentEndVertexId,
      newVertexId: newVertex.id,
      featureBeforeData: this._historyService._serializer.serialize(featureBeforeUpdate)
    };

    this.addTemporaryElement({
      type: 'point',
      x: newVertex.x,
      y: newVertex.y,
      style: { fill: '#ff00ff', radius: 8, stroke: '#ffffff', strokeWidth: 2 }
    });

    return newVertex;

  } catch (error) {
    console.error('エッジへの頂点追加プレビューの準備に失敗しました', error);
    this._clearAddingState();
    throw error;
  }
}

export const draggingMethods = {
  startVerticesDrag,
  updateVerticesDrag,
  endVerticesDrag,
  getDraggingVerticesInfo,
  getPendingVertexAdditionInfo,
  _resetDraggingState,
  getSharePreviewVertexIds,
  _findShareCandidates,
  _applyVertexSharingAfterDrag,
  _shareVerticesWithHistory,
  _resolveFeaturesForSharing,
  _buildVertexOwnerMap,
  _collectAffectedFeaturesForVertices,
  _collectVertexOwnerIds,
  _collectFeatureVertexIds,
  _hasOwnerIntersection,
  _calculateDistanceSqWithWrap,
  addVertexToEdge
};
