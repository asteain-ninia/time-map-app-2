import { Polygon } from '../../../domain/entities/Polygon.js';
import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';
import { collectPolygonExclusivityConflicts } from './polygonLayerValidation.js';
import { FeatureAnchorConflictError } from './FeatureAnchorConflictError.js';

function compareTimePoints(left, right) {
  if (left.equals(right)) {
    return 0;
  }
  return left.isBefore(right) ? -1 : 1;
}

function getFeatureAnchors(feature) {
  if (Array.isArray(feature?.anchors) && feature.anchors.length > 0) {
    return [...feature.anchors];
  }
  throw new Error(`Feature ${feature?.id ?? '(unknown)'} に履歴アンカーが存在しません。`);
}

function normalizeAndValidateAnchorTimeline(anchors) {
  const sorted = [...anchors];
  sorted.sort((left, right) => compareTimePoints(left.startTime, right.startTime));

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

function normalizeConflictResolutions(conflictResolutions) {
  const normalized = new Map();
  if (!conflictResolutions || typeof conflictResolutions !== 'object') {
    return normalized;
  }
  for (const [conflictId, value] of Object.entries(conflictResolutions)) {
    if (!conflictId) {
      continue;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      normalized.set(conflictId, value.trim());
      continue;
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof value.preferFeatureId === 'string' &&
      value.preferFeatureId.trim() !== ''
    ) {
      normalized.set(conflictId, value.preferFeatureId.trim());
    }
  }
  return normalized;
}

function collectConflictsForPolygons(polygons, world, layerService, geometryService) {
  const conflictMap = new Map();
  polygons.forEach(polygon => {
    if (!(polygon instanceof Polygon)) {
      return;
    }
    const conflicts = collectPolygonExclusivityConflicts(
      polygon,
      world,
      layerService,
      geometryService
    );
    conflicts.forEach(conflict => {
      if (!conflictMap.has(conflict.id)) {
        conflictMap.set(conflict.id, conflict);
      }
    });
  });
  return [...conflictMap.values()];
}

function truncateFeatureTimelineAt(world, featureId, cutoffTime) {
  const featureIndex = world.features.findIndex(feature => feature.id === featureId);
  if (featureIndex === -1) {
    throw new Error(`競合解決対象の地物が見つかりません: ${featureId}`);
  }

  const feature = world.features[featureIndex];
  if (!feature || typeof feature.withAnchors !== 'function') {
    throw new Error(`競合解決対象の地物が更新できません: ${featureId}`);
  }

  const anchors = normalizeAndValidateAnchorTimeline(getFeatureAnchors(feature));
  const activeAnchorIndex = anchors.findIndex(anchor => anchor.isActiveAt(cutoffTime));
  if (activeAnchorIndex === -1) {
    return false;
  }

  const activeAnchor = anchors[activeAnchorIndex];
  const start = activeAnchor.startTime;
  if (!(start instanceof TimePoint)) {
    throw new Error(`地物 ${featureId} の履歴アンカー開始時刻が不正です。`);
  }

  const nextAnchors = [...anchors];
  if (start.equals(cutoffTime)) {
    if (nextAnchors.length <= 1) {
      throw new Error(`地物 ${featureId} の履歴アンカーが空になるため、この競合解決方針は適用できません。`);
    }
    nextAnchors.splice(activeAnchorIndex, 1);
  } else {
    if (activeAnchor.endTime instanceof TimePoint && activeAnchor.endTime.equals(cutoffTime)) {
      return false;
    }
    nextAnchors[activeAnchorIndex] = activeAnchor.withTimeRange(activeAnchor.startTime, cutoffTime);
  }

  world.features[featureIndex] = feature.withAnchors(normalizeAndValidateAnchorTimeline(nextAnchors));
  return true;
}

/**
 * @param {{
 *   editedPolygons: Polygon[],
 *   world: {features: any[]},
 *   layerService: any,
 *   geometryService: any,
 *   conflictResolutions?: Record<string, {preferFeatureId: string}>
 * }} options
 * @returns {Set<string>}
 */
export function resolvePolygonAnchorConflictsOrThrow(options) {
  const polygons = Array.isArray(options?.editedPolygons)
    ? options.editedPolygons.filter(polygon => polygon instanceof Polygon)
    : [];
  if (polygons.length === 0) {
    return new Set();
  }
  const world = options?.world;
  if (!world || !Array.isArray(world.features)) {
    return new Set();
  }
  const layerService = options?.layerService;
  const geometryService = options?.geometryService;
  if (!layerService || !geometryService) {
    return new Set();
  }

  const conflicts = collectConflictsForPolygons(polygons, world, layerService, geometryService);
  if (conflicts.length === 0) {
    return new Set();
  }

  const normalizedResolutions = normalizeConflictResolutions(options?.conflictResolutions);
  const unresolvedConflicts = conflicts.filter(conflict => !normalizedResolutions.has(conflict.id));
  if (unresolvedConflicts.length > 0) {
    throw new FeatureAnchorConflictError(
      '同一レイヤー上の面情報が重なっています。解決方針を指定してください。',
      conflicts
    );
  }

  const changedFeatureIds = new Set();
  for (const conflict of conflicts) {
    const preferredFeatureId = normalizedResolutions.get(conflict.id);
    if (preferredFeatureId !== conflict.featureIdA && preferredFeatureId !== conflict.featureIdB) {
      throw new Error(`競合 ${conflict.id} の解決方針が不正です。`);
    }

    const loserFeatureId = preferredFeatureId === conflict.featureIdA
      ? conflict.featureIdB
      : conflict.featureIdA;
    const didChange = truncateFeatureTimelineAt(world, loserFeatureId, conflict.timePoint);
    if (didChange) {
      changedFeatureIds.add(loserFeatureId);
    }
  }

  const refreshedPolygons = polygons
    .map(polygon => world.features.find(feature => feature.id === polygon.id))
    .filter(feature => feature instanceof Polygon);
  const remainingConflicts = collectConflictsForPolygons(
    refreshedPolygons.length > 0 ? refreshedPolygons : polygons,
    world,
    layerService,
    geometryService
  );
  if (remainingConflicts.length > 0) {
    throw new FeatureAnchorConflictError(
      '指定された解決方針では重なりを解消できません。別の方針を選択してください。',
      remainingConflicts
    );
  }

  return changedFeatureIds;
}
