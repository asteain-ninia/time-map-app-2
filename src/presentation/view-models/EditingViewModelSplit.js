import { FeatureAnchor } from '../../domain/value-objects/FeatureAnchor.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { SplitPolygonCommand } from '../../application/services/history/commands/SplitPolygonCommand.js';
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

async function confirmSplit(inheritSideIndex, newAnchor, editTime) {
  if (this._mode !== 'edit' || this._tool !== 'split' || !this._targetPolygon || !this._splitPlan) {
    throw new Error('分割確定の条件を満たしていません。');
  }
  if (!(newAnchor instanceof FeatureAnchor)) {
    throw new Error('分割に必要な履歴アンカーが不正です。');
  }

  const polygonId = this._targetPolygon.id;
  const worldRepository = this._editFeatureUseCase.getWorldRepository();
  const worldBefore = await worldRepository.getWorld();
  const originalPolygon = worldBefore.features.find(feature => feature.id === polygonId);
  if (!originalPolygon) {
    throw new Error('分割対象のポリゴンが見つかりません。');
  }

  try {
    const resolveFeatureLabel = (featureId) => {
      const feature = worldBefore.features.find(candidate => String(candidate?.id) === String(featureId));
      return formatFeatureLabel(feature, String(featureId), editTime);
    };
    let retryCount = 0;
    let splitOptions = undefined;
    let result = null;
    while (retryCount < MAX_CONFLICT_RETRY_COUNT) {
      try {
        result = await this._editFeatureUseCase.splitPolygon(
          polygonId,
          this._splitPlan,
          inheritSideIndex,
          newAnchor,
          editTime,
          splitOptions
        );
        break;
      } catch (error) {
        if (!isAnchorConflictError(error)) {
          throw error;
        }
        const dialog = ensureAnchorConflictDialog(this);
        const conflicts = Array.isArray(error.conflicts) ? error.conflicts : [];
        const resolutions = await dialog.show({
          conflicts,
          resolveFeatureLabel
        });
        if (!resolutions) {
          throw new Error('競合解決をキャンセルしました。');
        }
        splitOptions = { conflictResolutions: resolutions };
        retryCount += 1;
      }
    }
    if (!result) {
      throw new Error('競合解決の再試行回数が上限を超えました。');
    }

    const updatedFeatures = Array.isArray(result.updatedFeatures) ? result.updatedFeatures : [];
    const additionalFeatureChanges = updatedFeatures
      .filter(feature => (
        feature &&
        feature.id !== result.updatedPolygon?.id &&
        feature.id !== result.newPolygon?.id
      ))
      .map(feature => {
        const beforeFeature = worldBefore.features.find(candidate => candidate.id === feature.id);
        if (!beforeFeature) {
          return null;
        }
        return {
          featureId: feature.id,
          beforeFeatureData: this._historyService.serializeForHistory(beforeFeature),
          afterFeatureData: this._historyService.serializeForHistory(feature)
        };
      })
      .filter(Boolean);

    const payload = {
      polygonId,
      originalPolygonData: this._historyService.serializeForHistory(originalPolygon),
      updatedPolygonData: this._historyService.serializeForHistory(result.updatedPolygon),
      newPolygonData: this._historyService.serializeForHistory(result.newPolygon),
      addedVerticesData: (result.addedVerticesData || []).map(vData =>
        this._historyService.serializeForHistory(new Vertex(vData.id, vData.x, vData.y))
      ),
      additionalFeatureChanges
    };

    const command = new SplitPolygonCommand(
      payload,
      this._editFeatureUseCase,
      this._historyService.getWorldRepository(),
      this._historyService.getSerializer()
    );
    this._historyService.recordCommand(command);

    this._eventBus.publish('FeatureUpdated', { feature: result.updatedPolygon });
    additionalFeatureChanges.forEach(change => {
      const feature = updatedFeatures.find(candidate => candidate.id === change.featureId);
      if (feature) {
        this._eventBus.publish('FeatureUpdated', { feature });
      }
    });
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
