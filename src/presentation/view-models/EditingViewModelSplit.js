import { Property } from '../../domain/value-objects/Property.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { SplitPolygonCommand } from '../../application/services/history/commands/SplitPolygonCommand.js';

function setSplitPlan(splitPlan) {
  this._splitPlan = splitPlan;
}

function setSplitLineMode(mode) {
  if (this._splitLineMode !== mode) {
    this._splitLineMode = mode;
    this._notifyObservers('splitLineMode');
  }
}

function getSplitLineMode() {
  return this._splitLineMode;
}

function startSplit(polygonInstance) {
  if (this._tool !== 'split') {
    console.warn("startSplit called when tool is not 'split'.");
    return;
  }
  this._targetPolygon = polygonInstance;
  this._splitPlan = null;
  this._splitLineMode = 'open';
  this._clearAddingPoints();
  this._notifyObservers('targetPolygon');
  this._notifyObservers('addingPoints');
}

function cancelSplitPreparation() {
  if (this._tool !== 'split') {
    return;
  }
  this._clearAddingState();
}

function getSplitPlan() {
  return this._splitPlan;
}

function clearSplitPlan() {
  this._splitPlan = null;
}

async function confirmSplit(inheritSideIndex, newProperty) {
  if (this._mode !== 'edit' || this._tool !== 'split' || !this._targetPolygon || !this._splitPlan) {
    throw new Error('分割確定の条件を満たしていません。');
  }
  if (!(newProperty instanceof Property)) {
    throw new Error('分割に必要なプロパティが不正です。');
  }

  const polygonId = this._targetPolygon.id;
  const worldRepository = this._editFeatureUseCase.getWorldRepository();
  const worldBefore = await worldRepository.getWorld();
  const originalPolygon = worldBefore.features.find(feature => feature.id === polygonId);
  if (!originalPolygon) {
    throw new Error('分割対象のポリゴンが見つかりません。');
  }

  try {
    const result = await this._editFeatureUseCase.splitPolygon(
      polygonId,
      this._splitPlan,
      inheritSideIndex,
      newProperty
    );

    const payload = {
      polygonId,
      originalPolygonData: this._historyService._serializer.serialize(originalPolygon),
      updatedPolygonData: this._historyService._serializer.serialize(result.updatedPolygon),
      newPolygonData: this._historyService._serializer.serialize(result.newPolygon),
      addedVerticesData: (result.addedVerticesData || []).map(vData =>
        this._historyService._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
      )
    };

    const command = new SplitPolygonCommand(
      payload,
      this._editFeatureUseCase,
      this._historyService._worldRepository,
      this._historyService._serializer
    );
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

    this._eventBus.publish('FeatureUpdated', { feature: result.updatedPolygon });
    this._eventBus.publish('FeatureAdded', { feature: result.newPolygon });

    this._clearAddingState();
    this._splitPlan = null;
    return result;
  } catch (error) {
    console.error('分割の確定に失敗しました', error);
    this._clearAddingState();
    this._splitPlan = null;
    throw error;
  }
}

export const splitMethods = {
  setSplitPlan,
  setSplitLineMode,
  getSplitLineMode,
  startSplit,
  cancelSplitPreparation,
  getSplitPlan,
  clearSplitPlan,
  confirmSplit
};
