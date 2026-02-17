import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor.js';
import { Property } from '../../../domain/value-objects/Property.js';

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

function clonePropertyWithEndTime(property, endTime) {
  return new Property(
    property.timePoint,
    property.name,
    property.description,
    property.getAttributes(),
    property.startTime || property.timePoint,
    endTime
  );
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

export function buildAnchorDeletionPlan(properties, targetAnchorKey) {
  const sorted = sortPropertiesByStart(properties);
  if (sorted.length <= 1) {
    throw new Error('最後の履歴アンカーは削除できません。');
  }
  const isAnchorTimeline = sorted.every(entry => entry instanceof FeatureAnchor);

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
      remaining[previousIndex] = isAnchorTimeline
        ? cloneAnchorWithEndTime(previous, nextStart || null)
        : clonePropertyWithEndTime(previous, nextStart || null);
    } else if (previousEnd && nextStart && nextStart.isBefore(previousEnd)) {
      remaining[previousIndex] = isAnchorTimeline
        ? cloneAnchorWithEndTime(previous, nextStart)
        : clonePropertyWithEndTime(previous, nextStart);
    }
  }

  for (let index = 0; index < remaining.length - 1; index += 1) {
    const current = remaining[index];
    const next = remaining[index + 1];
    const nextStart = getPropertyStartAnchor(next);
    if (current.endTime && nextStart && nextStart.isBefore(current.endTime)) {
      remaining[index] = isAnchorTimeline
        ? cloneAnchorWithEndTime(current, nextStart)
        : clonePropertyWithEndTime(current, nextStart);
    }
  }

  const selectionIndex = Math.min(deleteIndex, remaining.length - 1);
  const selectionProperty = remaining[selectionIndex];
  const nextSelectionKey = getAnchorKey(getPropertyStartAnchor(selectionProperty));

  if (isAnchorTimeline) {
    return {
      updatedAnchors: remaining,
      updatedProperties: remaining.map(anchor => anchor.toPropertyProjection()),
      removedAnchor: deleted,
      nextSelectionKey
    };
  }

  return {
    updatedProperties: remaining,
    removedProperty: deleted,
    nextSelectionKey
  };
}
