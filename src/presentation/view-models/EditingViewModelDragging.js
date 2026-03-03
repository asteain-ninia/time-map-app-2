import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { TimePoint } from '../../domain/value-objects/TimePoint.js';
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

function getVertexPairKey(vertexId1, vertexId2) {
  if (!vertexId1 || !vertexId2) {
    return null;
  }
  const firstId = String(vertexId1);
  const secondId = String(vertexId2);
  return firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
}

function remapDragInfoForPostMoveSharing(dragInfo, moveResult) {
  if (!(dragInfo instanceof Map) || dragInfo.size === 0) {
    return new Map();
  }
  const replacementMap = moveResult?.replacementMap instanceof Map
    ? moveResult.replacementMap
    : null;
  if (!replacementMap || replacementMap.size === 0) {
    return dragInfo;
  }

  const remapped = new Map();
  dragInfo.forEach((info, vertexId) => {
    const nextVertexId = replacementMap.get(vertexId) || vertexId;
    remapped.set(nextVertexId, info);
  });
  return remapped;
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
  if (this._shareReactivatedPairKeys instanceof Set) {
    this._shareReactivatedPairKeys.clear();
  } else {
    this._shareReactivatedPairKeys = new Set();
  }
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
  if (positionChanged) {
    _updateShareReactivatedPairs.call(this, options);
    this._notifyObservers('draggingVertices');
  }
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
  const shareReactivatedPairKeysCopy = new Set(
    this._shareReactivatedPairKeys instanceof Set ? this._shareReactivatedPairKeys : []
  );
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
        addedVertexData: this._historyService.serializeForHistory(new Vertex(pendingInfo.newVertexId, finalPosition.x, finalPosition.y)),
        featureBeforeData: pendingInfo.featureBeforeData 
      };
      const command = new AddVertexToEdgeCommand(
        payload,
        this._editFeatureUseCase,
        this._historyService.getWorldRepository(),
        this._historyService.getSerializer()
      );
      this._historyService.recordCommand(command);

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
        oldPosition: this._historyService.serializeForHistory(new Vertex(vertexId, info.originalPosition.x, info.originalPosition.y)),
        newPosition: this._historyService.serializeForHistory(new Vertex(vertexId, info.currentPosition.x, info.currentPosition.y))
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
              beforeFeatureData: this._historyService.serializeForHistory(change.beforeFeature),
              afterFeatureData: this._historyService.serializeForHistory(change.afterFeature)
            }))
            .filter(change => change.beforeFeatureData && change.afterFeatureData);

          const addedVertices = addedVerticesRaw
            .map(vertex => this._historyService.serializeForHistory(new Vertex(vertex.id, vertex.x, vertex.y)))
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
          this._historyService.getSerializer(),
          this._historyService.getWorldRepository()
        );
        this._historyService.recordCommand(command);

        const dragInfoForSharing = remapDragInfoForPostMoveSharing(dragInfoCopy, moveResult);
        let shareResult = { shared: false };
        let shareError = null;
        try {
          shareResult = await this._applyVertexSharingAfterDrag(dragInfoForSharing, {
            ...options,
            shareReactivatedPairKeys: shareReactivatedPairKeysCopy
          });
        } catch (error) {
          shareError = error;
          console.error('頂点共有化の確定に失敗しました', error);
        }

        if (moveResult?.requiresWorldRefresh || shareResult.shared || shareError) {
          this._eventBus.publish('WorldUpdated');
        } else if (moveResult && moveResult.updatedVertices) {
          moveResult.updatedVertices.forEach(v => this._eventBus.publish('VertexMoved', { vertexId: v.id, newPosition: {x: v.x, y: v.y} }));
        }

        if (shareError) {
          alert(`頂点共有化に失敗しました: ${shareError.message}`);
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

function _updateShareReactivatedPairs(options = {}) {
  if (!this._draggingVerticesInfo || this._draggingVerticesInfo.size === 0) {
    return;
  }

  const snapWorldDistance = Number.isFinite(options?.snapWorldDistance) ? options.snapWorldDistance : null;
  if (!snapWorldDistance || snapWorldDistance <= 0) {
    return;
  }

  const world = options?.world;
  if (!world || !Array.isArray(world.vertices)) {
    return;
  }

  if (!(this._shareReactivatedPairKeys instanceof Set)) {
    this._shareReactivatedPairKeys = new Set();
  }

  const featuresForSharing = this._resolveFeaturesForSharing(world, options);
  const ownerMap = this._buildVertexOwnerMap(featuresForSharing);
  const visibleVertexIds = new Set(ownerMap.keys());
  if (visibleVertexIds.size === 0) {
    return;
  }

  const verticesMap = new Map(world.vertices.map(v => [v.id, v]));
  const draggedIds = new Set(this._draggingVerticesInfo.keys());
  const snapDistanceSq = snapWorldDistance * snapWorldDistance;
  const worldWidth = Number.isFinite(options?.worldWidth) ? options.worldWidth : null;

  const getCurrentPosition = (vertexId) => {
    const dragEntry = this._draggingVerticesInfo.get(vertexId);
    if (dragEntry && dragEntry.currentPosition) {
      return dragEntry.currentPosition;
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

      const pairKey = getVertexPairKey(draggedId, otherId);
      if (!pairKey || this._shareReactivatedPairKeys.has(pairKey)) {
        continue;
      }

      const ownersA = ownerMap.get(draggedId);
      const ownersB = ownerMap.get(otherId);
      if (ownersA && ownersB && this._hasOwnerIntersection(ownersA, ownersB)) {
        continue;
      }

      const otherVertex = getCurrentPosition(otherId);
      if (!otherVertex) {
        continue;
      }

      const distanceSq = this._calculateDistanceSqWithWrap(draggedVertex, otherVertex, worldWidth);
      if (distanceSq > snapDistanceSq) {
        this._shareReactivatedPairKeys.add(pairKey);
      }
    }
  }
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
  if (this._shareReactivatedPairKeys instanceof Set) {
    this._shareReactivatedPairKeys.clear();
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

  const candidates = this._findShareCandidates(this._draggingVerticesInfo, world, {
    ...options,
    useDragPositions: true,
    shareReactivatedPairKeys: this._shareReactivatedPairKeys
  });
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
  const shareReactivatedPairKeys = options?.shareReactivatedPairKeys instanceof Set
    ? options.shareReactivatedPairKeys
    : (this._shareReactivatedPairKeys instanceof Set ? this._shareReactivatedPairKeys : null);
  const candidates = [];
  const visitedPairs = new Set();
  const useDragPositions = options?.useDragPositions === true;
  const validationWorld = this._buildShareValidationWorld(world, dragInfo, { useDragPositions });
  const canShareVerticesInWorld = this._editFeatureUseCase
    && typeof this._editFeatureUseCase.canShareVerticesInWorld === 'function'
    ? this._editFeatureUseCase.canShareVerticesInWorld.bind(this._editFeatureUseCase)
    : null;

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
      const pairKey = getVertexPairKey(draggedId, otherId);
      if (!pairKey) continue;
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
      const reactivatedDuringDrag = shareReactivatedPairKeys ? shareReactivatedPairKeys.has(pairKey) : false;
      if (originalDistanceSq <= snapDistanceSq && !reactivatedDuringDrag) continue;

      if (canShareVerticesInWorld && !canShareVerticesInWorld(validationWorld, draggedId, otherId, options)) {
        continue;
      }

      candidates.push({ vertexId1: draggedId, vertexId2: otherId, distanceSq });
    }
  }

  return candidates;
}

function _buildShareValidationWorld(world, dragInfo, options = {}) {
  if (!world || !Array.isArray(world.vertices)) {
    return world;
  }
  if (options?.useDragPositions !== true || !dragInfo || dragInfo.size === 0) {
    return world;
  }

  const nextVertices = world.vertices.map(vertex => {
    const dragEntry = dragInfo.get(vertex.id);
    if (!dragEntry?.currentPosition) {
      return vertex;
    }
    const { x, y } = dragEntry.currentPosition;
    if (vertex.x === x && vertex.y === y) {
      return vertex;
    }
    return { id: vertex.id, x, y };
  });

  return {
    ...world,
    vertices: nextVertices
  };
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
  let firstError = null;

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
      const shareResult = await this._shareVerticesWithHistory(candidate.vertexId1, candidate.vertexId2, {
        ...options,
        preferredKeptVertexId
      });
      if (shareResult?.shared) {
        shared = true;
        mergedIds.add(candidate.vertexId1);
        mergedIds.add(candidate.vertexId2);
        if (shareResult.removedVertexId) {
          mergedIds.add(shareResult.removedVertexId);
        }
      }
    } catch (error) {
      if (!firstError) {
        firstError = error;
      }
      console.warn('頂点共有化に失敗しました', error);
    }
  }

  if (!shared && firstError) {
    throw firstError;
  }

  return { shared };
}

async function _shareVerticesWithHistory(vertexId1, vertexId2, options = {}) {
  if (!vertexId1 || !vertexId2 || vertexId1 === vertexId2) {
    return null;
  }

  const worldRepository = this._editFeatureUseCase.getWorldRepository();
  const worldBefore = await worldRepository.getWorld();
  const featuresBeforeSnapshot = Array.isArray(worldBefore?.features)
    ? [...worldBefore.features]
    : [];

  const shareResult = await this._editFeatureUseCase.shareVertices(vertexId1, vertexId2, options);
  const affectedFeatures = Array.isArray(shareResult?.affectedFeatures)
    ? shareResult.affectedFeatures
    : [];
  if (!shareResult || affectedFeatures.length === 0) {
    return null;
  }

  const removedVertex = shareResult.removedVertex;
  const affectedFeatureIds = new Set(affectedFeatures.map(feature => feature.id));
  const affectedBefore = featuresBeforeSnapshot
    .filter(feature => affectedFeatureIds.has(feature.id));
  const editTime = options?.editTime instanceof TimePoint
    ? {
        year: options.editTime.year,
        month: options.editTime.month,
        day: options.editTime.day
      }
    : null;
  const payload = {
    vertexId1,
    vertexId2,
    keptVertexId: shareResult.keptVertex ? shareResult.keptVertex.id : null,
    removedVertexData: removedVertex
      ? this._historyService.serializeForHistory(new Vertex(removedVertex.id, removedVertex.x, removedVertex.y))
      : null,
    editTime,
    conflictResolutions: options?.conflictResolutions && typeof options.conflictResolutions === 'object'
      ? options.conflictResolutions
      : null,
    affectedFeaturesBefore: affectedBefore.map(feature => this._historyService.serializeForHistory(feature))
  };
  const command = new ShareVerticesCommand(
    payload,
    this._editFeatureUseCase,
    this._historyService.getWorldRepository(),
    this._historyService.getSerializer()
  );
  this._historyService.recordCommand(command);

  return {
    shared: true,
    removedVertexId: removedVertex ? removedVertex.id : null
  };
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

    const newVertexId = this._editFeatureUseCase.generateId('vertex');
    const newVertex = new Vertex(newVertexId, edgeInfo.projectionPoint.x, edgeInfo.projectionPoint.y);
    
    this._pendingVertexAdditionInfo = {
      featureId: edgeInfo.featureId,
      ringId: edgeInfo.ringId,
      segmentStartVertexId: edgeInfo.segmentStartVertexId,
      segmentEndVertexId: edgeInfo.segmentEndVertexId,
      newVertexId: newVertex.id,
      featureBeforeData: this._historyService.serializeForHistory(featureBeforeUpdate)
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
  _buildShareValidationWorld,
  _buildVertexOwnerMap,
  _collectAffectedFeaturesForVertices,
  _collectVertexOwnerIds,
  _collectFeatureVertexIds,
  _hasOwnerIntersection,
  _calculateDistanceSqWithWrap,
  addVertexToEdge
};
