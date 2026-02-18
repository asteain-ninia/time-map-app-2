import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor.js';

export function getPropertyStartAnchor(property) {
  if (!property) {
    return null;
  }
  return property.startTime || property.timePoint || null;
}

export function compareTimePoints(left, right) {
  if (left && right) {
    if (left.isBefore(right)) return -1;
    if (right.isBefore(left)) return 1;
    return 0;
  }
  if (left) return -1;
  if (right) return 1;
  return 0;
}

export function comparePropertiesByStart(left, right) {
  return compareTimePoints(getPropertyStartAnchor(left), getPropertyStartAnchor(right));
}

export function sortPropertiesByStart(properties) {
  const list = Array.isArray(properties) ? [...properties] : [];
  list.sort(comparePropertiesByStart);
  return list;
}

export function getAnchorKey(timePoint) {
  if (!timePoint) {
    return '';
  }
  const month = timePoint.month === null || timePoint.month === undefined ? '' : timePoint.month;
  const day = timePoint.day === null || timePoint.day === undefined ? '' : timePoint.day;
  return `${timePoint.year}|${month}|${day}`;
}

function cloneAnchorWithEndTime(anchor, endTime) {
  return anchor.withTimeRange(anchor.startTime, endTime);
}

function isSameTimePoint(left, right) {
  if (!left || !right) {
    return false;
  }
  return left.equals(right);
}

export function buildAnchorDeletionPlan(anchors, targetAnchorKey) {
  const sorted = sortPropertiesByStart(anchors);
  if (sorted.length <= 1) {
    throw new Error('最後の履歴アンカーは削除できません。');
  }
  if (!sorted.every(entry => entry instanceof FeatureAnchor)) {
    throw new Error('履歴アンカー削除は FeatureAnchor 配列のみ対応しています。');
  }

  const deleteIndex = sorted.findIndex(property =>
    getAnchorKey(getPropertyStartAnchor(property)) === targetAnchorKey
  );
  if (deleteIndex === -1) {
    throw new Error('削除対象の履歴アンカーが見つかりません。');
  }

  const deleted = sorted[deleteIndex];
  const deletedStart = getPropertyStartAnchor(deleted);
  const remaining = sorted.filter((_, index) => index !== deleteIndex);

  if (deleteIndex > 0) {
    const previousIndex = deleteIndex - 1;
    const previous = remaining[previousIndex];
    const next = remaining[previousIndex + 1] || null;
    const previousEnd = previous.endTime;
    const nextStart = next ? getPropertyStartAnchor(next) : null;
    const shouldBridge =
      previousEnd === null ||
      (deletedStart && isSameTimePoint(previousEnd, deletedStart));

    if (shouldBridge) {
      remaining[previousIndex] = cloneAnchorWithEndTime(previous, nextStart || null);
    } else if (previousEnd && nextStart && nextStart.isBefore(previousEnd)) {
      remaining[previousIndex] = cloneAnchorWithEndTime(previous, nextStart);
    }
  }

  for (let index = 0; index < remaining.length - 1; index += 1) {
    const current = remaining[index];
    const next = remaining[index + 1];
    const nextStart = getPropertyStartAnchor(next);
    if (current.endTime && nextStart && nextStart.isBefore(current.endTime)) {
      remaining[index] = cloneAnchorWithEndTime(current, nextStart);
    }
  }

  const selectionIndex = Math.min(deleteIndex, remaining.length - 1);
  const selectionProperty = remaining[selectionIndex];
  const nextSelectionKey = getAnchorKey(getPropertyStartAnchor(selectionProperty));

  return {
    updatedAnchors: remaining,
    removedAnchor: deleted,
    nextSelectionKey
  };
}
