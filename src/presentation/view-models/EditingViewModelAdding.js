import { Property } from '../../domain/value-objects/Property.js';
import { Vertex } from '../../domain/entities/Vertex.js';
import { AddFeatureCommand } from '../../application/services/history/commands/AddFeatureCommand.js';
import { AddRingCommand } from '../../application/services/history/commands/AddRingCommand.js';

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
 * @param {Property[]} properties - プロパティ (Property インスタンスの配列、要素数1を期待)
 * @param {string} layerId - レイヤーID
 * @returns {Promise<Object>} 追加された地物インスタンス
 */
async function confirmAddFeature(properties, layerId) {
  if (this._mode !== 'add' || !this._tool || this._addingPoints.length === 0) {
    throw new Error('地物の追加状態ではありません');
  }
  if (!Array.isArray(properties) || properties.length !== 1 || !(properties[0] instanceof Property)) {
    throw new Error("Invalid properties format. Expected a single Property instance in an array for confirmAddFeature.");
  }

  const geometryData = { vertices: [...this._addingPoints] };
  const featureType = this._tool;
  
  try {
    const feature = await this._editFeatureUseCase.addFeature(featureType, properties, geometryData, layerId);

    const payload = {
      featureId: feature.id,
      featureData: this._historyService._serializer.serialize(feature),
      addedVerticesData: await this._historyService._getVerticesDataForFeatureForHistory(feature)
    };
    const command = new AddFeatureCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

    this._clearAddingState();
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
        this._historyService._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
      )
    };
    const command = new AddRingCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();

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
        this._historyService._serializer.serialize(new Vertex(vData.id, vData.x, vData.y))
      )
    };
    const command = new AddRingCommand(payload, this._editFeatureUseCase, this._historyService._worldRepository, this._historyService._serializer);
    this._historyService._stackManager.pushUndo(command);
    this._historyService._notifyHistoryChanged();
    
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
  removeLastPoint,
  _clearAddingState,
  _clearAddingPoints,
  getAddingPoints,
  confirmAddFeature,
  confirmAddHole,
  confirmAddEnclave
};
