import { Point as DomainPoint } from '../../domain/entities/Point.js';
import { Line as DomainLine } from '../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { FeatureAnchor } from '../../domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../domain/value-objects/TimePoint.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { DeleteFeatureCommand } from '../../application/services/history/commands/DeleteFeatureCommand.js';
import { DeleteVerticesCommand } from '../../application/services/history/commands/DeleteVerticesCommand.js';
import { BatchUpdatePropertiesCommand } from '../../application/services/history/commands/BatchUpdatePropertiesCommand.js';
import { UpdatePropertiesCommand } from '../../application/services/history/commands/UpdatePropertiesCommand.js';
import { UnlinkSharedVertexCommand } from '../../application/services/history/commands/UnlinkSharedVertexCommand.js';
import { AnchorConflictResolutionDialog } from '../views/sidebar/AnchorConflictResolutionDialog.js';

const MAX_CONFLICT_RETRY_COUNT = 4;

function getFeatureTimelineAnchors(feature) {
  if (!feature || feature.id === null || feature.id === undefined) {
    return [];
  }

  if (Array.isArray(feature.anchors) && feature.anchors.length > 0) {
    return [...feature.anchors];
  }
  throw new Error(`Feature ${feature.id} に履歴アンカーが存在しません。`);
}

function collectFeatureVertexIdsAtTime(feature, editTime = null) {
  if (!feature) {
    return [];
  }

  if (feature instanceof DomainPolygon) {
    const rings = typeof feature.getRingsAt === 'function'
      ? feature.getRingsAt(editTime)
      : feature.rings;
    if (!Array.isArray(rings)) {
      return [];
    }
    const ids = new Set();
    rings.forEach(ring => {
      if (Array.isArray(ring?.vertexIds)) {
        ring.vertexIds.forEach(id => ids.add(id));
      }
    });
    return Array.from(ids);
  }

  if (feature instanceof DomainLine) {
    const vertexIds = typeof feature.getVertexIdsAt === 'function'
      ? feature.getVertexIdsAt(editTime)
      : feature.vertexIds;
    return Array.isArray(vertexIds) ? [...vertexIds] : [];
  }

  if (feature instanceof DomainPoint) {
    const vertexId = typeof feature.getVertexIdAt === 'function'
      ? feature.getVertexIdAt(editTime)
      : feature.vertexId;
    return typeof vertexId === 'string' ? [vertexId] : [];
  }

  if (Array.isArray(feature.vertexIds)) {
    return [...feature.vertexIds];
  }
  return [];
}

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
 * 地物を削除
 * @param {string} featureId - 削除する地物のID
 * @param {Object} feature - 削除前の地物データ（アンドゥ用、ドメインインスタンス）
 * @returns {Promise<void>}
 */
async function deleteFeature(featureId, feature) {
  if (!feature) { throw new Error("Missing feature data for deletion history."); }
  
  const payload = {
    featureId: featureId,
    featureData: this._historyService._serializer.serialize(feature),
    verticesToRestoreData: await this._historyService._getVerticesDataForFeatureForHistory(feature)
  };

  try {
    await this._editFeatureUseCase.deleteFeature(featureId);

    const command = new DeleteFeatureCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

    this._eventBus.publish('FeatureDeleted', { featureId });
    this._eventBus.publish('ClearSelection');
  } catch (error) {
    console.error('地物の削除に失敗しました', error);
    this._eventBus.publish('WorldUpdated');
    throw error;
  }
}

/**
 * 複数の頂点を削除
 * @param {string[]} vertexIds - 削除する頂点のID配列
 * @returns {Promise<void>}
 */
async function deleteVertices(vertexIds, options = undefined) {
  if (!vertexIds || vertexIds.length === 0) return;
  
  try {
    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const worldBefore = await worldRepository.getWorld();
    const editTime = options?.editTime instanceof TimePoint ? options.editTime : null;
    let deleteOptions = editTime ? { editTime } : undefined;

    const verticesToRestore = vertexIds.map(id => {
      const vData = worldBefore.vertices.find(v => v.id === id);
      return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
    }).filter(Boolean);

    let result = null;
    let retryCount = 0;
    while (retryCount < MAX_CONFLICT_RETRY_COUNT) {
      try {
        result = await this._editFeatureUseCase.deleteVertices(vertexIds, deleteOptions);
        break;
      } catch (error) {
        if (!isAnchorConflictError(error) || !(editTime instanceof TimePoint)) {
          throw error;
        }
        const dialog = ensureAnchorConflictDialog(this);
        const conflicts = Array.isArray(error.conflicts) ? error.conflicts : [];
        const resolutions = await dialog.show({
          conflicts,
          resolveFeatureLabel: (featureId) => {
            const feature = worldBefore.features.find(candidate => String(candidate?.id) === String(featureId));
            return formatFeatureLabel(feature, String(featureId), editTime);
          }
        });
        if (!resolutions) {
          throw new Error('競合解決をキャンセルしました。');
        }
        deleteOptions = {
          editTime,
          conflictResolutions: resolutions
        };
        retryCount += 1;
      }
    }

    if (!result) {
      throw new Error('競合解決の再試行回数が上限を超えました。');
    }

    const affectedFeatureIds = new Set();
    if (Array.isArray(result.updatedFeatureIds)) {
      result.updatedFeatureIds.forEach(featureId => {
        if (featureId !== null && featureId !== undefined) {
          affectedFeatureIds.add(featureId);
        }
      });
    }
    if (Array.isArray(result.deletedFeatureIds)) {
      result.deletedFeatureIds.forEach(featureId => {
        if (featureId !== null && featureId !== undefined) {
          affectedFeatureIds.add(featureId);
        }
      });
    }
    if (affectedFeatureIds.size === 0) {
      const deletedVertexIdsSet = new Set(vertexIds);
      worldBefore.features.forEach(feature => {
        const vertexIdsAtTime = collectFeatureVertexIdsAtTime(feature, editTime);
        if (vertexIdsAtTime.some(id => deletedVertexIdsSet.has(id))) {
          affectedFeatureIds.add(feature.id);
        }
      });
    }
    const affectedFeaturesBefore = [...affectedFeatureIds]
      .map(featureId => worldBefore.features.find(feature => feature.id === featureId))
      .filter(Boolean);
    
    const payload = {
      deletedVertexIds: result.deletedVertexIds,
      verticesToRestoreData: verticesToRestore.map(v => this._historyService._serializer.serialize(v)),
      affectedFeaturesBefore: affectedFeaturesBefore.map(f => this._historyService._serializer.serialize(f)),
      editTime: editTime
        ? { year: editTime.year, month: editTime.month, day: editTime.day }
        : null
    };
    if (deleteOptions?.conflictResolutions && typeof deleteOptions.conflictResolutions === 'object') {
      payload.conflictResolutions = deleteOptions.conflictResolutions;
    }
    
    const command = new DeleteVerticesCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

    if (result?.deletedFeatureIds?.length > 0) { result.deletedFeatureIds.forEach(id => this._eventBus.publish('FeatureDeleted', { featureId: id })); }
    if (result?.updatedFeatureIds?.length > 0) {
      const updatedWorld = await worldRepository.getWorld();
      result.updatedFeatureIds.forEach(id => {
        const updatedFeature = updatedWorld.features.find(f => f.id === id);
        if (updatedFeature) { this._eventBus.publish('FeatureUpdated', { feature: updatedFeature }); }
      });
    }
    this._eventBus.publish('VerticesDeleted', {
      deletedVertexIds: vertexIds,
      editTime: payload.editTime
    });
    this._eventBus.publish('ClearSelection');
  } catch (error) {
    console.error('頂点の削除に失敗しました', error);
    this._eventBus.publish('WorldUpdated');
    throw error;
  }
}

async function unlinkSharedVertex(vertexId, featureId) {
  if (!vertexId || !featureId) {
    throw new Error('共有解除に必要な情報が不足しています。');
  }

  const worldRepository = this._editFeatureUseCase.getWorldRepository();
  const worldBefore = await worldRepository.getWorld();
  const featureBefore = worldBefore.features.find(f => f.id === featureId);
  if (!featureBefore) {
    throw new Error(`地物が見つかりません: ${featureId}`);
  }

  const ownerIds = this._collectVertexOwnerIds(worldBefore.features, vertexId);
  if (!ownerIds.has(featureId)) {
    throw new Error('指定された地物は共有頂点の所有者ではありません。');
  }
  if (ownerIds.size <= 1) {
    throw new Error('共有頂点ではないため解除できません。');
  }

  const result = await this._editFeatureUseCase.unlinkSharedVertex(vertexId, featureId);
  const newVertex = result?.newVertex;
  if (!newVertex) {
    throw new Error('共有解除の結果が取得できませんでした。');
  }

  const payload = {
    vertexId,
    featureId,
    newVertexId: newVertex.id,
    newVertexData: this._historyService._serializer.serialize(new Vertex(newVertex.id, newVertex.x, newVertex.y)),
    featureBeforeData: this._historyService._serializer.serialize(featureBefore)
  };
  const command = new UnlinkSharedVertexCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
  this._historyService._stackManager.pushUndo(command);
  this._historyService._notifyHistoryChanged();

  this._eventBus.publish('WorldUpdated');
  return result;
}

/**
 * 地物プロパティを更新
 * @param {string} featureId - 更新する地物のID
 * @param {FeatureAnchor[]|Object} propertyUpdate - 新しい履歴アンカー配列、または時間編集リクエスト
 * @returns {Promise<Object>} 更新された地物インスタンス
 */
async function updateFeatureProperties(featureId, propertyUpdate) {
  const buildAnchorsUpdatePayload = (anchors, includeConflictResolutions, conflictResolutions) => {
    if (!Array.isArray(anchors) || anchors.length === 0) {
      throw new Error('Invalid anchors format. Expected a non-empty anchor timeline array.');
    }
    const isAnchorArray = anchors.every(entry => entry instanceof FeatureAnchor);
    if (!isAnchorArray) {
      throw new Error('Invalid anchors format. Expected an array of FeatureAnchor instances.');
    }
    const payload = { anchors };
    if (includeConflictResolutions) {
      payload.conflictResolutions = conflictResolutions;
    }
    return payload;
  };

  let updatePayload = null;
  if (Array.isArray(propertyUpdate)) {
    updatePayload = buildAnchorsUpdatePayload(propertyUpdate, false, undefined);
  } else if (propertyUpdate && typeof propertyUpdate === 'object') {
    if (Object.prototype.hasOwnProperty.call(propertyUpdate, 'anchors')) {
      updatePayload = buildAnchorsUpdatePayload(
        propertyUpdate.anchors,
        Object.prototype.hasOwnProperty.call(propertyUpdate, 'conflictResolutions'),
        propertyUpdate.conflictResolutions
      );
    } else {
      updatePayload = {
        propertyEdit: {
          editTime: propertyUpdate.editTime,
          startTime: propertyUpdate.startTime,
          endTime: propertyUpdate.endTime,
          name: propertyUpdate.name,
          description: propertyUpdate.description,
          conflictResolutions: propertyUpdate.conflictResolutions,
          boundaryEdit: propertyUpdate.boundaryEdit,
          affectedTimeRange: propertyUpdate.affectedTimeRange
        }
      };
    }
  } else {
    throw new Error("Invalid propertyUpdate format.");
  }

  try {
    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const world = await worldRepository.getWorld();
    const featureBefore = world.features.find(f => f.id === featureId);
    if (!featureBefore) { throw new Error(`Feature not found: ${featureId}`); }

    const oldAnchorsByFeatureId = new Map();
    (world.features || []).forEach(feature => {
      if (!feature || feature.id === null || feature.id === undefined) {
        return;
      }
      oldAnchorsByFeatureId.set(
        feature.id,
        getFeatureTimelineAnchors(feature)
      );
    });

    const updateResult = await this._editFeatureUseCase.updateFeature(featureId, updatePayload);
    const updatedFeature = updateResult.feature;
    const updatedFeatures = Array.isArray(updateResult.updatedFeatures) && updateResult.updatedFeatures.length > 0
      ? updateResult.updatedFeatures
      : (updatedFeature ? [updatedFeature] : []);

    const updatesPayload = updatedFeatures
      .filter(feature => feature && feature.id !== null && feature.id !== undefined)
      .map(feature => {
        const beforeAnchors = oldAnchorsByFeatureId.get(feature.id) || [];
        const afterAnchors = getFeatureTimelineAnchors(feature);
        return {
          featureId: feature.id,
          oldAnchors: beforeAnchors.map(anchor => this._historyService._serializer.serialize(anchor)),
          newAnchors: afterAnchors.map(anchor => this._historyService._serializer.serialize(anchor))
        };
      });

    if (updatesPayload.length === 0) {
      throw new Error('更新対象の履歴アンカーが取得できませんでした。');
    }

    const command = updatesPayload.length > 1
      ? new BatchUpdatePropertiesCommand(
          { updates: updatesPayload },
          this._editFeatureUseCase,
          this._historyService._serializer,
          this._historyService._worldRepository
        )
      : new UpdatePropertiesCommand(
          updatesPayload[0],
          this._editFeatureUseCase,
          this._historyService._serializer,
          this._historyService._worldRepository
        );
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

    updatedFeatures.forEach(feature => {
      this._eventBus.publish('FeatureUpdated', { feature });
    });
    return updatedFeature;
  } catch (error) {
    console.error('地物プロパティの更新に失敗しました (EditingViewModel)', error);
    this._eventBus.publish('WorldUpdated');
    throw error;
  }
}

export const operationMethods = {
  deleteFeature,
  deleteVertices,
  unlinkSharedVertex,
  updateFeatureProperties
};
