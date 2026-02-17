import { Polygon as DomainPolygon } from '../../domain/entities/Polygon.js';
import { FeatureAnchor } from '../../domain/value-objects/FeatureAnchor.js';
import { Property } from '../../domain/value-objects/Property.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { DeleteFeatureCommand } from '../../application/services/history/commands/DeleteFeatureCommand.js';
import { DeleteVerticesCommand } from '../../application/services/history/commands/DeleteVerticesCommand.js';
import { BatchUpdatePropertiesCommand } from '../../application/services/history/commands/BatchUpdatePropertiesCommand.js';
import { UpdatePropertiesCommand } from '../../application/services/history/commands/UpdatePropertiesCommand.js';
import { UnlinkSharedVertexCommand } from '../../application/services/history/commands/UnlinkSharedVertexCommand.js';

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
async function deleteVertices(vertexIds) {
  if (!vertexIds || vertexIds.length === 0) return;
  
  try {
    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const worldBefore = await worldRepository.getWorld();

    const verticesToRestore = vertexIds.map(id => {
      const vData = worldBefore.vertices.find(v => v.id === id);
      return vData ? new Vertex(vData.id, vData.x, vData.y) : null;
    }).filter(Boolean);

    const affectedFeaturesBefore = [];
    const deletedVertexIdsSet = new Set(vertexIds);
    worldBefore.features.forEach(f => {
      const usesAnyDeletedVertex = 
        (f instanceof DomainPolygon && f.rings?.some(r => r.vertexIds.some(id => deletedVertexIdsSet.has(id)))) ||
        (!(f instanceof DomainPolygon) && f.vertexIds?.some(id => deletedVertexIdsSet.has(id)));
      if (usesAnyDeletedVertex) {
        affectedFeaturesBefore.push(f);
      }
    });
    
    const result = await this._editFeatureUseCase.deleteVertices(vertexIds);
    
    const payload = {
      deletedVertexIds: result.deletedVertexIds,
      verticesToRestoreData: verticesToRestore.map(v => this._historyService._serializer.serialize(v)),
      affectedFeaturesBefore: affectedFeaturesBefore.map(f => this._historyService._serializer.serialize(f))
    };
    
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
    this._eventBus.publish('VerticesDeleted', { deletedVertexIds: vertexIds });
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
 * @param {Property[]|Object} propertyUpdate - 新しいプロパティ配列、または時間編集リクエスト
 * @returns {Promise<Object>} 更新された地物インスタンス
 */
async function updateFeatureProperties(featureId, propertyUpdate) {
  let updatePayload = null;
  if (Array.isArray(propertyUpdate)) {
    if (propertyUpdate.length === 0) {
      throw new Error("Invalid newProperties format. Expected a non-empty timeline array.");
    }
    const isAnchorArray = propertyUpdate.every(entry => entry instanceof FeatureAnchor);
    const isPropertyArray = propertyUpdate.every(entry => entry instanceof Property);
    if (!isAnchorArray && !isPropertyArray) {
      throw new Error("Invalid newProperties format. Expected an array of FeatureAnchor or Property instances.");
    }
    updatePayload = isAnchorArray
      ? { anchors: propertyUpdate }
      : { properties: propertyUpdate };
  } else if (propertyUpdate && typeof propertyUpdate === 'object') {
    updatePayload = {
      propertyEdit: {
        editTime: propertyUpdate.editTime,
        startTime: propertyUpdate.startTime,
        endTime: propertyUpdate.endTime,
        name: propertyUpdate.name,
        description: propertyUpdate.description,
        conflictResolutions: propertyUpdate.conflictResolutions
      }
    };
  } else {
    throw new Error("Invalid propertyUpdate format.");
  }

  try {
    const worldRepository = this._editFeatureUseCase.getWorldRepository();
    const world = await worldRepository.getWorld();
    const featureBefore = world.features.find(f => f.id === featureId);
    if (!featureBefore) { throw new Error(`Feature not found: ${featureId}`); }

    const oldPropertiesByFeatureId = new Map();
    (world.features || []).forEach(feature => {
      if (!feature || feature.id === null || feature.id === undefined) {
        return;
      }
      oldPropertiesByFeatureId.set(
        feature.id,
        Array.isArray(feature.anchors) && feature.anchors.length > 0
          ? [...feature.anchors]
          : (Array.isArray(feature.properties) ? [...feature.properties] : [])
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
        const beforeProps = oldPropertiesByFeatureId.get(feature.id) || [];
        const afterProps = Array.isArray(feature.anchors) && feature.anchors.length > 0
          ? feature.anchors
          : (Array.isArray(feature.properties) ? feature.properties : []);
        return {
          featureId: feature.id,
          oldProperties: beforeProps.map(property => this._historyService._serializer.serialize(property)),
          newProperties: afterProps.map(property => this._historyService._serializer.serialize(property))
        };
      });

    const command = updatesPayload.length > 1
      ? new BatchUpdatePropertiesCommand(
          { updates: updatesPayload },
          this._editFeatureUseCase,
          this._historyService._serializer,
          this._historyService._worldRepository
        )
      : new UpdatePropertiesCommand(
          updatesPayload[0] || {
            featureId,
            oldProperties: [],
            newProperties: []
          },
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
