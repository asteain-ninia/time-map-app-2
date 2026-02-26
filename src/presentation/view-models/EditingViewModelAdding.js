import { FeatureAnchor } from '../../domain/value-objects/FeatureAnchor.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { AddFeatureCommand } from '../../application/services/history/commands/AddFeatureCommand.js';
import { AddRingCommand } from '../../application/services/history/commands/AddRingCommand.js';
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
 * 穴/飛び地追加モードを開始 (MapViewから呼び出される)
 * @param {DomainPolygon} polygonInstance - 穴/飛び地を追加するポリゴンのインスタンス
 * @private internal use by MapView
 */
function startAddingHoleOrEnclave(polygonInstance) {
  if (this._tool === 'add-hole') {
    this._targetPolygon = polygonInstance;
    this._addingSubMode = null;
    this._targetRingIdForHole = null;
    this._clearAddingPoints();
    this._notifyObservers('targetPolygon');
    this._notifyObservers('addingSubMode');
    this._notifyObservers('targetRingIdForHole');
  } else { console.warn("startAddingHoleOrEnclave called when tool is not 'add-hole'."); }
}

/**
 * 穴/飛び地追加の準備状態を外部からリセット
 */
function cancelHoleOrEnclavePreparation() {
  if (this._tool !== 'add-hole') { return; }
  this._clearAddingState();
}

/**
 * 穴/飛び地追加対象のポリゴンインスタンスを取得
 * @returns {DomainPolygon | null} 対象ポリゴンインスタンス
 */
function getTargetPolygon() {
  return this._targetPolygon;
}

/**
 * 穴/飛び地追加のサブモードを設定 (MapViewから呼び出される)
 * @param {'hole' | 'enclave' | null} subMode
 * @private internal use by MapView
 */
function setAddingSubMode(subMode) {
  if (this._addingSubMode !== subMode) {
    this._addingSubMode = subMode;
    this._notifyObservers('addingSubMode');
  }
}

/**
 * 穴/飛び地追加のサブモードを取得
 * @returns {'hole' | 'enclave' | null}
 */
function getAddingSubMode() {
  return this._addingSubMode;
}

/**
 * 穴追加対象のリングIDを設定 (MapViewから呼び出される)
 * @param {string | null} ringId - 穴を追加する外周リングのID
 * @private internal use by MapView
 */
function setTargetRingIdForHole(ringId) {
  if (this._targetRingIdForHole !== ringId) {
    this._targetRingIdForHole = ringId;
    this._notifyObservers('targetRingIdForHole');
  }
}

/**
 * 穴追加対象のリングIDを取得
 * @returns {string | null}
 */
function getTargetRingIdForHole() {
  return this._targetRingIdForHole;
}


/**
 * 点を追加（地物追加または穴/飛び地追加モード用）
 * @param {Object} point - 追加する点 { x, y }
 */
function addPoint(point) {
  const isAddingFeature = this._mode === 'add' && this._tool;
  const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole' && this._targetPolygon;
  const isAddingSplitLine = this._mode === 'edit' && this._tool === 'split' && this._targetPolygon;

  if (isAddingFeature || isAddingHoleOrEnclave || isAddingSplitLine) {
    if (this._draggingVerticesInfo.size > 0) return;
    this._addingPoints.push(point);
    this._notifyObservers('addingPoints');
  } else {
    console.warn("Cannot add point in current mode/tool/target:", this._mode, this._tool, !!this._targetPolygon);
  }
}

/**
 * 追加中の点をまとめて更新（分割の閉線入力などに使用）
 * @param {Array<{x:number,y:number}>} points
 */
function setAddingPoints(points) {
  const isAddingFeature = this._mode === 'add' && this._tool;
  const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole' && this._targetPolygon;
  const isAddingSplitLine = this._mode === 'edit' && this._tool === 'split' && this._targetPolygon;

  if (!(isAddingFeature || isAddingHoleOrEnclave || isAddingSplitLine)) {
    console.warn("Cannot set points in current mode/tool/target:", this._mode, this._tool, !!this._targetPolygon);
    return;
  }
  if (!Array.isArray(points)) {
    console.warn("setAddingPoints requires an array of points.");
    return;
  }
  this._addingPoints = points.map(point => ({ x: point.x, y: point.y }));
  this._notifyObservers('addingPoints');
}

/**
 * 最後の点を削除（地物追加または穴/飛び地追加モード用）
 */
function removeLastPoint() {
  const isAddingFeature = this._mode === 'add' && this._tool;
  const isAddingHoleOrEnclave = this._mode === 'edit' && this._tool === 'add-hole';
  const isAddingSplitLine = this._mode === 'edit' && this._tool === 'split';

  if ((isAddingFeature || isAddingHoleOrEnclave || isAddingSplitLine) && this._addingPoints.length > 0) {
    this._addingPoints.pop();
    if (this._addingPoints.length === 0) {
      if (this._addingSubMode !== null) { this.setAddingSubMode(null); }
      if (this._targetRingIdForHole !== null) { this.setTargetRingIdForHole(null); }
    }
    this._notifyObservers('addingPoints');
  }
}

/**
 * 追加中の状態をクリア (点、ターゲット、サブモード、リングID)
 * @private
 */
function _clearAddingState() {
  let changed = false;
  if (this._addingPoints.length > 0) { this._addingPoints = []; changed = true; }
  if (this._targetPolygon !== null) { this._targetPolygon = null; changed = true; }
  if (this._addingSubMode !== null) { this._addingSubMode = null; changed = true; }
  if (this._targetRingIdForHole !== null) { this._targetRingIdForHole = null; changed = true; }
  if (this._pendingVertexAdditionInfo !== null) { this._pendingVertexAdditionInfo = null; changed = true; }
  if (this._splitPlan !== null) { this._splitPlan = null; changed = true; }
  if (this._splitLineMode !== 'open') { this._splitLineMode = 'open'; changed = true; }
  if (changed) { this._notifyObservers('addingState'); }
  this.clearTemporaryElements(); // プレビューもクリア
}


/**
 * 追加中の点をクリア (内部用ヘルパー、基本は _clearAddingState を使う)
 * @private
 */
function _clearAddingPoints() {
  if (this._addingPoints.length > 0) {
    this._addingPoints = [];
    this._notifyObservers('addingPoints');
  }
}

/**
 * 追加中の点を取得
 * @returns {Array} 追加中の点の配列
 */
function getAddingPoints() {
  return this._addingPoints;
}

/**
 * 地物の追加を確定
 * @param {FeatureAnchor[]} anchors - 履歴アンカー草案（FeatureAnchor インスタンスの配列、要素数1を期待）
 * @param {string} layerId - レイヤーID
 * @returns {Promise<Object>} 追加された地物インスタンス
 */
async function confirmAddFeature(anchors, layerId) {
  if (this._mode !== 'add' || !this._tool || this._addingPoints.length === 0) {
    throw new Error('地物の追加状態ではありません');
  }
  if (!Array.isArray(anchors) || anchors.length !== 1 || !(anchors[0] instanceof FeatureAnchor)) {
    throw new Error("Invalid anchors format. Expected a single FeatureAnchor instance in an array for confirmAddFeature.");
  }

  const geometryData = { vertices: [...this._addingPoints] };
  const featureType = this._tool;
  const worldRepository = this._editFeatureUseCase.getWorldRepository();
  const worldBefore = await worldRepository.getWorld();
  const anchorStartTime = anchors[0].startTime ?? null;
  
  try {
    let retryCount = 0;
    let addOptions = { returnDetails: true };
    let addResult = null;
    while (retryCount < MAX_CONFLICT_RETRY_COUNT) {
      try {
        addResult = await this._editFeatureUseCase.addFeature(
          featureType,
          anchors,
          geometryData,
          layerId,
          addOptions
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
          resolveFeatureLabel: (featureId) => {
            const feature = worldBefore.features.find(candidate => String(candidate?.id) === String(featureId));
            return formatFeatureLabel(feature, String(featureId), anchorStartTime);
          }
        });
        if (!resolutions) {
          throw new Error('競合解決をキャンセルしました。');
        }
        addOptions = {
          returnDetails: true,
          conflictResolutions: resolutions
        };
        retryCount += 1;
      }
    }
    if (!addResult) {
      throw new Error('競合解決の再試行回数が上限を超えました。');
    }

    const feature = addResult?.feature || addResult;
    const updatedFeatures = Array.isArray(addResult?.updatedFeatures) && addResult.updatedFeatures.length > 0
      ? addResult.updatedFeatures
      : [feature];
    const additionalFeatureChanges = updatedFeatures
      .filter(updatedFeature => (
        updatedFeature &&
        updatedFeature.id !== feature.id
      ))
      .map(updatedFeature => {
        const beforeFeature = worldBefore.features.find(candidate => candidate.id === updatedFeature.id);
        if (!beforeFeature) {
          return null;
        }
        return {
          featureId: updatedFeature.id,
          beforeFeatureData: this._historyService.serializeForHistory(beforeFeature),
          afterFeatureData: this._historyService.serializeForHistory(updatedFeature)
        };
      })
      .filter(Boolean);

    const payload = {
      featureId: feature.id,
      featureData: this._historyService.serializeForHistory(feature),
      addedVerticesData: await this._historyService.getVerticesDataForFeatureForHistory(feature)
    };
    if (additionalFeatureChanges.length > 0) {
      payload.additionalFeatureChanges = additionalFeatureChanges;
    }
    const command = new AddFeatureCommand(
      payload,
      this._editFeatureUseCase,
      this._historyService.getWorldRepository(),
      this._historyService.getSerializer()
    );
    this._historyService.recordCommand(command);

    this._clearAddingState();
    additionalFeatureChanges.forEach(change => {
      const updatedFeature = updatedFeatures.find(candidate => candidate?.id === change.featureId);
      if (updatedFeature) {
        this._eventBus.publish('FeatureUpdated', { feature: updatedFeature });
      }
    });
    this._eventBus.publish('FeatureAdded', { feature });
    return feature;

  } catch (error) {
    console.error('地物の追加に失敗しました', error);
    this._clearAddingState();
    throw error;
  }
}

/**
 * 穴の追加を確定
 * @returns {Promise<Object|null>} 更新されたポリゴン、または失敗時にnull
 */
async function confirmAddHole() {
  if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'hole' || !this._targetPolygon || !this._targetRingIdForHole || this._addingPoints.length < 3) {
    console.error('穴の追加確定の条件を満たしていません。');
    this._clearAddingState();
    return null;
  }

  const polygonId = this._targetPolygon.id;
  const holePoints = [...this._addingPoints];
  const targetRingId = this.getTargetRingIdForHole();
  const polygonBeforeUpdate = this._targetPolygon;

  try {
    const geometryUpdate = {
      newRingCoordinates: [{ points: holePoints, ringType: 'hole', parentId: targetRingId }]
    };
    const updateResult = await this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });
    const updatedPolygon = updateResult.feature;
    const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];
    const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

    const payload = {
      polygonId: polygonId,
      addedRing: addedRingPlain ? { ...addedRingPlain } : null,
      addedVerticesData: newlyAddedVerticesData.map(vData => 
        this._historyService.serializeForHistory(new Vertex(vData.id, vData.x, vData.y))
      )
    };
    const command = new AddRingCommand(
      payload,
      this._editFeatureUseCase,
      this._historyService.getWorldRepository(),
      this._historyService.getSerializer()
    );
    this._historyService.recordCommand(command);

    this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
    this._clearAddingState();
    return updatedPolygon;
  } catch (error) {
    console.error('穴の追加確定に失敗しました', error);
    alert(`穴の追加に失敗しました: ${error.message}`);
    this._clearAddingState();
    return null;
  }
}

/**
 * 飛び地の追加を確定
 * @returns {Promise<Object|null>} 更新されたポリゴン、または失敗時にnull
 */
async function confirmAddEnclave() {
  if (this._mode !== 'edit' || this._tool !== 'add-hole' || this._addingSubMode !== 'enclave' || !this._targetPolygon || this._addingPoints.length < 3) {
    console.error('飛び地の追加確定の条件を満たしていません。');
    this._clearAddingState();
    return null;
  }

  const polygonId = this._targetPolygon.id;
  const enclavePoints = [...this._addingPoints];
  const parentRingId = this.getTargetRingIdForHole();
  const polygonBeforeUpdate = this._targetPolygon;

  try {
    const geometryUpdate = {
      newRingCoordinates: [{ points: enclavePoints, ringType: 'territory', parentId: parentRingId }]
    };
    const updateResult = await this._editFeatureUseCase.updateFeature(polygonId, { geometry: geometryUpdate });
    const updatedPolygon = updateResult.feature;
    const newlyAddedVerticesData = updateResult.newlyAddedVerticesData || [];
    
    const addedRingPlain = updatedPolygon.rings.find(r => !polygonBeforeUpdate.rings.some(br => br.id === r.id));

    const payload = {
      polygonId: polygonId,
      addedRing: addedRingPlain ? { ...addedRingPlain } : null,
      addedVerticesData: newlyAddedVerticesData.map(vData => 
        this._historyService.serializeForHistory(new Vertex(vData.id, vData.x, vData.y))
      )
    };
    const command = new AddRingCommand(
      payload,
      this._editFeatureUseCase,
      this._historyService.getWorldRepository(),
      this._historyService.getSerializer()
    );
    this._historyService.recordCommand(command);
    
    this._eventBus.publish('FeatureUpdated', { feature: updatedPolygon });
    this._clearAddingState();
    return updatedPolygon;
  } catch (error) {
    console.error('飛び地の追加確定に失敗しました', error);
    alert(`飛び地の追加に失敗しました: ${error.message}`);
    this._clearAddingState();
    return null;
  }
}

export const addingMethods = {
  startAddingHoleOrEnclave,
  cancelHoleOrEnclavePreparation,
  getTargetPolygon,
  setAddingSubMode,
  getAddingSubMode,
  setTargetRingIdForHole,
  getTargetRingIdForHole,
  addPoint,
  setAddingPoints,
  removeLastPoint,
  _clearAddingState,
  _clearAddingPoints,
  getAddingPoints,
  confirmAddFeature,
  confirmAddHole,
  confirmAddEnclave
};
