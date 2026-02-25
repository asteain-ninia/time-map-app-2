// src\application\usecases\feature\UpdateFeatureUseCase.js

import { Feature } from '../../../domain/entities/Feature';
import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon';
import { TimePoint } from '../../../domain/value-objects/TimePoint';
import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor';
import { IPolygonEditService } from '../../services/IPolygonEditService.js';
import { WorldRepository } from '../../WorldRepository.js'; // 型チェック用 (循環参照注意)
import {
  ensurePolygonLayerConstraints,
  normalizeAffectedTimeRange
} from './polygonLayerValidation.js';
import { resolvePolygonAnchorConflictsOrThrow } from './polygonAnchorConflictResolution.js';

/**
 * 地理オブジェクトの更新（プロパティ、レイヤーID、形状）を専門に処理するユースケース
 * ポリゴン形状の更新は PolygonEditService に委譲する
 */
export class UpdateFeatureUseCase {
  /** @type {WorldRepository} */
  _worldRepository;
  /** @type {GeometryService} */
  _geometryService;
  /** @type {LayerService} */
  _layerService;
  /** @type {Function} */
  _processGeometry;
  /** @type {Function} */
  _getVerticesFromIds;
  /** @type {IPolygonEditService} */
  _polygonEditService;

  /**
   * @param {WorldRepository} worldRepository
   * @param {GeometryService} geometryService
   * @param {LayerService} layerService
   * @param {Function} processGeometry - 形状処理関数 (EditFeatureUseCaseから提供)
   * @param {Function} getVerticesFromIds - 頂点取得関数 (EditFeatureUseCaseから提供)
   * @param {IPolygonEditService} polygonEditService - ポリゴン編集サービス
   */
  constructor(worldRepository, geometryService, layerService, processGeometry, getVerticesFromIds, polygonEditService) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService;
    this._layerService = layerService;
    this._processGeometry = processGeometry;
    this._getVerticesFromIds = getVerticesFromIds;
    this._polygonEditService = polygonEditService;
    if (!polygonEditService) {
        throw new Error("PolygonEditService is required for UpdateFeatureUseCase.");
    }
  }

  /**
   * 既存の地理オブジェクトを更新
   * @param {string} featureId - 更新するオブジェクトのID
   * @param {Object} updates - 更新内容 { anchors?: FeatureAnchor[], geometry?: Object, layerId?: string }
   *                         propertyEdit?: {
   *                           editTime: TimePoint,
   *                           startTime?: TimePoint | null,
   *                           endTime?: TimePoint | null,
   *                           name?: string,
   *                           description?: string,
   *                           conflictResolutions?: Record<string, { preferFeatureId: string }>,
   *                           boundaryEdit?: {
   *                             targetAnchorId: string,
   *                             newStart?: TimePoint,
   *                             newEnd?: TimePoint | null
   *                           },
   *                           affectedTimeRange?: { start?: TimePoint, end?: TimePoint | null }
   *                         }
   *                         affectedTimeRange?: { start?: TimePoint, end?: TimePoint | null }
   *                         geometry (Polygonの場合): {
   *                           newRingCoordinates?: { points: {x,y}[], ringType: 'territory' | 'hole', parentId?: string }[],
   *                           existingRingData?: { id: string, vertexIds: string[], ringType: 'territory' | 'hole', parentId?: string }[],
   *                           removedRingIds?: string[],
   *                           updatedRingVertices?: { ringId: string, newVertexIds: string[] }[]
   *                         }
   *                         geometry (Point/Lineの場合): { vertexIds?: string[] } または { vertices: [{x,y}] }
   * @returns {Promise<{feature: Feature, newlyAddedVerticesData?: Array<{id: string, x: number, y: number}>}>} 更新されたオブジェクトと、新規リング追加時に生成された頂点データ（あれば）
   */
  async execute(featureId, updates) {
    const world = await this._worldRepository.getWorld();
    const originalVerticesSnapshot = world.vertices.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }));
    const originalFeaturesSnapshot = [...world.features];

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }

    let currentFeature = world.features[featureIndex];
    let updatedFeature = currentFeature;
    let worldVerticesUpdated = false;
    let newlyAddedVerticesDataForHistory = [];
    const conflictResolvedFeatureIds = new Set();

    const timelineEditPayload = updates.anchorEdit || updates.propertyEdit || null;
    const timelineAffectedTimeRange = timelineEditPayload
      ? normalizeAffectedTimeRange(timelineEditPayload.affectedTimeRange)
      : null;
    const hasAnchorsUpdate = Object.prototype.hasOwnProperty.call(updates, 'anchors');
    const timelineReplacePayload = hasAnchorsUpdate ? updates.anchors : null;
    const hasAnchorConflictResolutions = Object.prototype.hasOwnProperty.call(updates, 'conflictResolutions');
    const anchorConflictResolutions = hasAnchorConflictResolutions
      ? updates.conflictResolutions
      : undefined;
    const topLevelAffectedTimeRange = Object.prototype.hasOwnProperty.call(updates, 'affectedTimeRange')
      ? normalizeAffectedTimeRange(updates.affectedTimeRange)
      : null;
    const affectedTimeRange = timelineAffectedTimeRange || topLevelAffectedTimeRange;
    if (updates.anchorEdit && updates.propertyEdit) {
      throw new Error('anchorEdit と propertyEdit は同時に指定できません。');
    }
    if (updates.anchors && updates.properties) {
      throw new Error('anchors と properties は同時に指定できません。');
    }
    if (updates.properties !== undefined) {
      throw new Error('updates.properties は廃止されました。updates.anchors を使用してください。');
    }
    if (timelineEditPayload && timelineReplacePayload) {
      throw new Error('時間軸編集と履歴全量置換は同時に指定できません。');
    }

    // プロパティ更新
    if (timelineEditPayload) {
      const mergedAnchors = this._buildAnchorsForEditTime(updatedFeature, timelineEditPayload);
      updatedFeature = this._applyAnchorsToFeature(updatedFeature, mergedAnchors, featureId);
    } else if (hasAnchorsUpdate) {
      let normalizedAnchors;
      if (Array.isArray(updates.anchors)) {
        if (updates.anchors.length === 0) {
          throw new Error('履歴アンカー更新は1件以上の anchors が必要です。');
        }
        normalizedAnchors = this._normalizeAndValidateAnchorTimeline(updates.anchors);
      } else {
        throw new Error('履歴更新の形式が不正です。');
      }
      updatedFeature = this._applyAnchorsToFeature(updatedFeature, normalizedAnchors, featureId);
    }

    // ジオメトリ更新
    if (updates.geometry) {
       if (!updatedFeature) {
           throw new Error(`Feature object invalid after property update for ID: ${featureId}`);
       }

      if (updatedFeature instanceof Polygon) {
        const geometryUpdates = updates.geometry;
        const editService = this._polygonEditService;
        let polygonBeingUpdated = updatedFeature;
        const originalPolygonForWorld = world.features[featureIndex];

        try {
            world.features[featureIndex] = polygonBeingUpdated;

            if (Array.isArray(geometryUpdates.removedRingIds)) {
                for (const ringId of geometryUpdates.removedRingIds) {
                    polygonBeingUpdated = await editService.removeRingFromPolygon(polygonBeingUpdated.id, ringId);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            if (Array.isArray(geometryUpdates.updatedRingVertices)) {
                for (const update of geometryUpdates.updatedRingVertices) {
                    polygonBeingUpdated = await editService.updateRingVertices(polygonBeingUpdated.id, update.ringId, update.newVertexIds);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            if (Array.isArray(geometryUpdates.newRingCoordinates)) {
                for (const ringCoordData of geometryUpdates.newRingCoordinates) {
                    const tempGeometry = { vertices: ringCoordData.points };
                    const processed = this._processGeometry(tempGeometry, world);
                    worldVerticesUpdated = true; 

                    if (processed.vertexIds) {
                        const worldVerticesMap = new Map(world.vertices.map(v => [v.id, v]));
                        processed.vertexIds.forEach(id => {
                            const vData = worldVerticesMap.get(id);
                            if (vData) newlyAddedVerticesDataForHistory.push({ id: vData.id, x: vData.x, y: vData.y });
                        });
                    }
                    const ringData = {
                        vertexIds: processed.vertexIds,
                        ringType: ringCoordData.ringType,
                        parentId: ringCoordData.parentId
                    };
                    polygonBeingUpdated = await editService.addRingToPolygon(polygonBeingUpdated.id, ringData);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            if (Array.isArray(geometryUpdates.existingRingData)) {
                for (const existingRing of geometryUpdates.existingRingData) {
                    polygonBeingUpdated = await editService.addRingWithId(polygonBeingUpdated.id, existingRing);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            updatedFeature = polygonBeingUpdated;
        } catch (error) {
            world.features[featureIndex] = originalPolygonForWorld;
            this._restoreWorldVertices(world, originalVerticesSnapshot);
            console.error(`Failed to update polygon geometry for ${featureId}:`, error);
            throw new Error(`Polygon geometry update failed: ${error.message}`);
        }
      } else { 
        let processedGeometry = updates.geometry;
        if (updates.geometry.vertices) {
            processedGeometry = this._processGeometry(updates.geometry, world);
            worldVerticesUpdated = true;
        }
        if (processedGeometry.vertexIds !== undefined) {
          if (updatedFeature && typeof updatedFeature.withVertexIds === 'function') {
            if (updatedFeature instanceof Point && (!processedGeometry.vertexIds || processedGeometry.vertexIds.length !== 1)) {
              throw new Error("Point must have exactly one vertexId.");
            }
            if (updatedFeature instanceof Line && (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 2)) {
              throw new Error("Line must have at least two vertexIds.");
            }
            updatedFeature = updatedFeature.withVertexIds(processedGeometry.vertexIds);
          } else {
            throw new Error(`Invalid feature object or missing withVertexIds method for ID: ${featureId}`);
          }
        }
      }
    }

    // レイヤーID更新
    if (updates.layerId !== undefined) {
      if (!updatedFeature) {
          throw new Error(`Feature object invalid before layer ID update for ID: ${featureId}`);
      }
      if (typeof updatedFeature.withLayerId === 'function') {
        updatedFeature = updatedFeature.withLayerId(updates.layerId);
      } else {
        throw new Error(`Invalid feature object or missing withLayerId method for ID: ${featureId}`);
      }
    }

    world.features[featureIndex] = updatedFeature;

    if (updatedFeature instanceof Polygon) {
      try {
        const shouldResolveAnchorConflicts = !!timelineEditPayload
          || (hasAnchorsUpdate && hasAnchorConflictResolutions);
        if (shouldResolveAnchorConflicts) {
          const conflictResolutions = timelineEditPayload
            ? timelineEditPayload.conflictResolutions
            : anchorConflictResolutions;
          const resolvedIds = this._resolvePropertyEditConflictsOrThrow(
            updatedFeature,
            world,
            conflictResolutions,
            affectedTimeRange
          );
          resolvedIds.forEach(id => conflictResolvedFeatureIds.add(id));
          const refreshedFeature = world.features.find(feature => feature.id === featureId);
          if (refreshedFeature) {
            updatedFeature = refreshedFeature;
          }
        }

        this._ensurePolygonPlacementOrRollback(
          updatedFeature,
          world,
          currentFeature,
          originalVerticesSnapshot,
          featureIndex,
          affectedTimeRange
        );
      } catch (error) {
        world.features = [...originalFeaturesSnapshot];
        this._restoreWorldVertices(world, originalVerticesSnapshot);
        throw error;
      }
    }

    const updatedFeatureIds = new Set();
    if (updatedFeature !== currentFeature || worldVerticesUpdated) {
      updatedFeatureIds.add(featureId);
    }
    conflictResolvedFeatureIds.forEach(id => updatedFeatureIds.add(id));

    if (updatedFeatureIds.size > 0) {
      world.features[featureIndex] = updatedFeature;
      await this._worldRepository.saveWorld(world);
    }

    const updatedFeatures = [...updatedFeatureIds]
      .map(id => world.features.find(feature => feature.id === id))
      .filter(Boolean);

    return {
        feature: updatedFeature,
        updatedFeatures: updatedFeatures.length > 0 ? updatedFeatures : undefined,
        newlyAddedVerticesData: newlyAddedVerticesDataForHistory.length > 0 ? newlyAddedVerticesDataForHistory : undefined
    };
}

  _buildAnchorsForEditTime(feature, anchorEdit) {
    if (!anchorEdit || typeof anchorEdit !== 'object') {
      throw new Error('anchorEdit の形式が不正です。');
    }

    const editTime = anchorEdit.editTime;
    if (!(editTime instanceof TimePoint)) {
      throw new Error('編集時刻は TimePoint で指定してください。');
    }

    let existing = this._getFeatureAnchors(feature);
    if (existing.length === 0) {
      throw new Error('編集対象の履歴アンカーが存在しません。');
    }
    existing = this._normalizeAndValidateAnchorTimeline(existing);

    const resolvedEditAnchor = this._resolveAnchorAtEditTime(feature, existing, editTime);
    const boundaryEdit = this._extractBoundaryEdit(anchorEdit, existing, resolvedEditAnchor, editTime);
    if (boundaryEdit) {
      return this._buildAnchorsForBoundaryEdit(existing, anchorEdit, boundaryEdit);
    }
    return this._buildAnchorsForPointInTimeEdit(feature.id, existing, resolvedEditAnchor, anchorEdit, editTime);
  }

  _resolveAnchorAtEditTime(feature, anchors, editTime) {
    const exactAnchorIndex = anchors.findIndex(anchor => anchor.startTime.equals(editTime));
    const activeAnchor = typeof feature.getAnchorAt === 'function'
      ? feature.getAnchorAt(editTime)
      : null;
    if (exactAnchorIndex === -1 && !(activeAnchor instanceof FeatureAnchor)) {
      throw new Error('編集時刻で有効な履歴アンカーが見つかりません。');
    }

    const activeAnchorIndex = exactAnchorIndex !== -1
      ? exactAnchorIndex
      : this._findActiveAnchorIndex(anchors, activeAnchor, editTime);
    if (activeAnchorIndex === -1) {
      throw new Error('編集時刻で有効な履歴アンカーが見つかりません。');
    }

    return {
      exactAnchorIndex,
      activeAnchorIndex,
      baseAnchor: exactAnchorIndex !== -1 ? anchors[exactAnchorIndex] : anchors[activeAnchorIndex]
    };
  }

  _extractBoundaryEdit(anchorEdit, anchors, resolvedEditAnchor, editTime) {
    const hasStartTime = Object.prototype.hasOwnProperty.call(anchorEdit, 'startTime');
    if (hasStartTime && anchorEdit.startTime !== null && !(anchorEdit.startTime instanceof TimePoint)) {
      throw new Error('存在開始は TimePoint で指定してください。');
    }

    const explicitBoundaryEdit = anchorEdit.boundaryEdit;
    if (explicitBoundaryEdit === undefined || explicitBoundaryEdit === null) {
      if (hasStartTime && anchorEdit.startTime instanceof TimePoint && !anchorEdit.startTime.equals(editTime)) {
        return {
          targetAnchorId: resolvedEditAnchor.baseAnchor.id,
          hasNewStart: true,
          newStart: anchorEdit.startTime,
          hasNewEnd: Object.prototype.hasOwnProperty.call(anchorEdit, 'endTime'),
          newEnd: anchorEdit.endTime
        };
      }
      return null;
    }

    if (typeof explicitBoundaryEdit !== 'object') {
      throw new Error('boundaryEdit の形式が不正です。');
    }

    const targetAnchorId = typeof explicitBoundaryEdit.targetAnchorId === 'string'
      ? explicitBoundaryEdit.targetAnchorId.trim()
      : '';
    if (targetAnchorId === '') {
      throw new Error('boundaryEdit.targetAnchorId は必須です。');
    }
    if (!anchors.some(anchor => anchor.id === targetAnchorId)) {
      throw new Error(`boundaryEdit.targetAnchorId に対応する履歴アンカーが見つかりません: ${targetAnchorId}`);
    }

    const hasNewStart = Object.prototype.hasOwnProperty.call(explicitBoundaryEdit, 'newStart');
    const newStart = hasNewStart ? explicitBoundaryEdit.newStart : undefined;
    if (hasNewStart && !(newStart instanceof TimePoint)) {
      throw new Error('boundaryEdit.newStart は TimePoint で指定してください。');
    }

    const hasNewEnd = Object.prototype.hasOwnProperty.call(explicitBoundaryEdit, 'newEnd');
    const newEnd = hasNewEnd ? explicitBoundaryEdit.newEnd : undefined;
    if (hasNewEnd && newEnd !== null && !(newEnd instanceof TimePoint)) {
      throw new Error('boundaryEdit.newEnd は TimePoint または null で指定してください。');
    }

    return {
      targetAnchorId,
      hasNewStart,
      newStart,
      hasNewEnd,
      newEnd
    };
  }

  _buildAnchorsForPointInTimeEdit(featureId, anchors, resolvedEditAnchor, anchorEdit, editTime) {
    const baseAnchor = resolvedEditAnchor.baseAnchor;
    const nextFutureAnchorStart = this._findNextFutureAnchorStart(anchors, editTime);
    const hasExplicitEndTime = Object.prototype.hasOwnProperty.call(anchorEdit, 'endTime');
    const requestedEndTime = hasExplicitEndTime ? anchorEdit.endTime : baseAnchor.endTime;
    const normalizedEndTime = this._normalizeAnchorEndTime(editTime, requestedEndTime, nextFutureAnchorStart);

    const mergedAnchor = new FeatureAnchor({
      id: resolvedEditAnchor.exactAnchorIndex !== -1
        ? baseAnchor.id
        : this._buildGeneratedAnchorId(featureId, editTime, anchors),
      timeRange: { start: editTime, end: normalizedEndTime },
      property: {
        name: typeof anchorEdit.name === 'string' ? anchorEdit.name : baseAnchor.name,
        description: typeof anchorEdit.description === 'string' ? anchorEdit.description : baseAnchor.description,
        attributes: baseAnchor.getAttributes()
      },
      shape: baseAnchor.shape,
      placement: baseAnchor.placement
    });

    const merged = [...anchors];
    if (resolvedEditAnchor.exactAnchorIndex === -1) {
      merged.push(mergedAnchor);
      const sourceAnchor = merged[resolvedEditAnchor.activeAnchorIndex];
      if (
        sourceAnchor.startTime.isBefore(editTime) &&
        (!sourceAnchor.endTime || editTime.isBefore(sourceAnchor.endTime))
      ) {
        merged[resolvedEditAnchor.activeAnchorIndex] = sourceAnchor.withTimeRange(sourceAnchor.startTime, editTime);
      }
    } else {
      merged[resolvedEditAnchor.exactAnchorIndex] = mergedAnchor;
    }

    return this._normalizeAndValidateAnchorTimeline(merged);
  }

  _buildAnchorsForBoundaryEdit(anchors, anchorEdit, boundaryEdit) {
    const targetAnchorIndex = anchors.findIndex(anchor => anchor.id === boundaryEdit.targetAnchorId);
    if (targetAnchorIndex === -1) {
      throw new Error(`boundaryEdit.targetAnchorId に対応する履歴アンカーが見つかりません: ${boundaryEdit.targetAnchorId}`);
    }
    const targetAnchor = anchors[targetAnchorIndex];

    const requestedStartTime = this._resolveBoundaryStartTime(targetAnchor, anchorEdit, boundaryEdit);
    const requestedEndTime = this._resolveBoundaryEndTime(targetAnchor, anchorEdit, boundaryEdit, requestedStartTime);

    const editedAnchor = new FeatureAnchor({
      id: targetAnchor.id,
      timeRange: { start: requestedStartTime, end: requestedEndTime },
      property: {
        name: typeof anchorEdit.name === 'string' ? anchorEdit.name : targetAnchor.name,
        description: typeof anchorEdit.description === 'string' ? anchorEdit.description : targetAnchor.description,
        attributes: targetAnchor.getAttributes()
      },
      shape: targetAnchor.shape,
      placement: targetAnchor.placement
    });

    const rebuiltTimeline = this._rebuildTimelineForBoundaryEdit(anchors, targetAnchorIndex, editedAnchor);
    return this._normalizeAndValidateAnchorTimeline(rebuiltTimeline);
  }

  _resolveBoundaryStartTime(targetAnchor, anchorEdit, boundaryEdit) {
    const hasPayloadStartTime = Object.prototype.hasOwnProperty.call(anchorEdit, 'startTime');
    let startTime = targetAnchor.startTime;

    if (boundaryEdit.hasNewStart) {
      startTime = boundaryEdit.newStart;
    } else if (hasPayloadStartTime && anchorEdit.startTime instanceof TimePoint) {
      startTime = anchorEdit.startTime;
    }

    if (!(startTime instanceof TimePoint)) {
      throw new Error('存在開始は TimePoint で指定してください。');
    }

    return startTime;
  }

  _resolveBoundaryEndTime(targetAnchor, anchorEdit, boundaryEdit, startTime) {
    const hasPayloadEndTime = Object.prototype.hasOwnProperty.call(anchorEdit, 'endTime');
    let endTime = targetAnchor.endTime;

    if (boundaryEdit.hasNewEnd) {
      endTime = boundaryEdit.newEnd;
    } else if (hasPayloadEndTime) {
      endTime = anchorEdit.endTime;
    }

    if (endTime !== null && endTime !== undefined) {
      if (!(endTime instanceof TimePoint)) {
        throw new Error('存在終了は TimePoint で指定してください。');
      }
      if (!startTime.isBefore(endTime)) {
        throw new Error('存在終了は開始時刻より後に設定してください。');
      }
      return endTime;
    }

    return null;
  }

  _rebuildTimelineForBoundaryEdit(anchors, targetAnchorIndex, editedAnchor) {
    const before = [];
    const after = [];

    for (let index = 0; index < anchors.length; index += 1) {
      if (index === targetAnchorIndex) {
        continue;
      }
      const anchor = anchors[index];
      if (anchor.startTime.isBefore(editedAnchor.startTime)) {
        before.push(anchor);
      } else {
        after.push(anchor);
      }
    }

    if (before.length > 0) {
      const previousIndex = before.length - 1;
      const previousAnchor = before[previousIndex];
      if (previousAnchor.endTime === null || editedAnchor.startTime.isBefore(previousAnchor.endTime)) {
        before[previousIndex] = previousAnchor.withTimeRange(previousAnchor.startTime, editedAnchor.startTime);
      }
    }

    let adjustedAfter = [];
    if (editedAnchor.endTime instanceof TimePoint) {
      for (const anchor of after) {
        if (anchor.startTime.isBefore(editedAnchor.endTime)) {
          if (!(anchor.endTime instanceof TimePoint) || editedAnchor.endTime.isBefore(anchor.endTime)) {
            adjustedAfter.push(anchor.withTimeRange(editedAnchor.endTime, anchor.endTime));
          }
          continue;
        }
        adjustedAfter.push(anchor);
      }
    }

    return [...before, editedAnchor, ...adjustedAfter];
  }

  _applyAnchorsToFeature(feature, anchors, featureId) {
    if (!feature || typeof feature.withAnchors !== 'function') {
      throw new Error(`Invalid feature object or missing withAnchors method for ID: ${featureId}`);
    }
    return feature.withAnchors(anchors);
  }

  _getFeatureAnchors(feature) {
    if (Array.isArray(feature.anchors) && feature.anchors.length > 0) {
      return [...feature.anchors];
    }
    throw new Error(`Feature ${feature?.id ?? '(unknown)'} に履歴アンカーが存在しません。`);
  }

  _compareAnchorStartTimes(left, right) {
    if (!(left instanceof FeatureAnchor) || !(right instanceof FeatureAnchor)) {
      return 0;
    }
    if (left.startTime.equals(right.startTime)) {
      return 0;
    }
    return left.startTime.isBefore(right.startTime) ? -1 : 1;
  }

  _findNextFutureAnchorStart(anchors, editTime) {
    for (const anchor of anchors) {
      if (editTime.isBefore(anchor.startTime)) {
        return anchor.startTime;
      }
    }
    return null;
  }

  _findActiveAnchorIndex(anchors, activeAnchor, editTime) {
    const byReference = anchors.findIndex(anchor =>
      anchor === activeAnchor ||
      (activeAnchor instanceof FeatureAnchor && anchor.id === activeAnchor.id)
    );
    if (byReference !== -1) {
      return byReference;
    }

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      if (editTime.isBefore(anchor.startTime)) {
        break;
      }
      if (anchor instanceof FeatureAnchor && anchor.isActiveAt(editTime)) {
        return index;
      }
    }
    return -1;
  }

  _normalizeAnchorEndTime(editTime, requestedEndTime, nextFutureAnchorStart) {
    if (requestedEndTime !== null && requestedEndTime !== undefined) {
      if (!(requestedEndTime instanceof TimePoint)) {
        throw new Error('存在終了は TimePoint で指定してください。');
      }
      if (!editTime.isBefore(requestedEndTime)) {
        throw new Error('存在終了は編集時刻より後に設定してください。');
      }
      if (nextFutureAnchorStart instanceof TimePoint && nextFutureAnchorStart.isBefore(requestedEndTime)) {
        throw new Error('存在終了は次の歴史の錨の開始時刻を超えられません。');
      }
      return requestedEndTime;
    }

    if (nextFutureAnchorStart instanceof TimePoint) {
      return nextFutureAnchorStart;
    }
    return null;
  }

  _normalizeAndValidateAnchorTimeline(anchors) {
    const sorted = [...anchors];
    sorted.sort((left, right) => this._compareAnchorStartTimes(left, right));

    const seenAnchors = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const anchor = sorted[index];
      if (!(anchor instanceof FeatureAnchor)) {
        throw new Error('履歴アンカーが FeatureAnchor ではありません。');
      }

      const start = anchor.startTime;
      if (!(start instanceof TimePoint)) {
        throw new Error('履歴アンカーの開始時刻が不正です。');
      }
      if (seenAnchors.some(existing => existing.equals(start))) {
        throw new Error('同一時刻の歴史の錨が重複しています。');
      }

      const endTime = anchor.endTime;
      if (endTime !== null && endTime !== undefined) {
        if (!(endTime instanceof TimePoint)) {
          throw new Error('存在終了は TimePoint で指定してください。');
        }
        if (!start.isBefore(endTime)) {
          throw new Error('存在終了は開始時刻より後に設定してください。');
        }
      }

      const nextAnchor = sorted[index + 1];
      if (nextAnchor) {
        if (!(nextAnchor instanceof FeatureAnchor)) {
          throw new Error('履歴アンカーが FeatureAnchor ではありません。');
        }
        if (endTime instanceof TimePoint && nextAnchor.startTime.isBefore(endTime)) {
          throw new Error('存在終了は次の歴史の錨の開始時刻を超えられません。');
        }
      }

      seenAnchors.push(start);
    }

    return sorted;
  }

  _buildGeneratedAnchorId(featureId, startTime, existingAnchors) {
    const month = startTime.month ?? 'null';
    const day = startTime.day ?? 'null';
    const base = `anchor-${featureId}-${startTime.year}-${month}-${day}`;
    const usedIds = new Set((existingAnchors || []).map(anchor => anchor.id));
    if (!usedIds.has(base)) {
      return base;
    }

    let suffix = 1;
    let candidate = `${base}-${suffix}`;
    while (usedIds.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  _resolvePropertyEditConflictsOrThrow(updatedPolygon, world, conflictResolutions, affectedTimeRange = null) {
    return resolvePolygonAnchorConflictsOrThrow({
      editedPolygons: [updatedPolygon],
      world,
      layerService: this._layerService,
      geometryService: this._geometryService,
      conflictResolutions,
      affectedTimeRange
    });
  }

  _ensurePolygonPlacementOrRollback(
    updatedPolygon,
    world,
    originalPolygon,
    originalVerticesSnapshot,
    featureIndex,
    affectedTimeRange = null
  ) {
    if (!(updatedPolygon instanceof Polygon)) {
      return;
    }

    try {
      ensurePolygonLayerConstraints(
        updatedPolygon,
        world,
        this._layerService,
        this._geometryService,
        affectedTimeRange
      );
    } catch (error) {
      world.features[featureIndex] = originalPolygon;
      this._restoreWorldVertices(world, originalVerticesSnapshot);
      throw error;
    }
  }

  _restoreWorldVertices(world, snapshot) {
    world.vertices = snapshot.map(data => ({ id: data.id, x: data.x, y: data.y }));
  }
}

