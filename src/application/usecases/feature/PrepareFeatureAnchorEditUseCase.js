import { Polygon } from '../../../domain/entities/Polygon.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';
import { FeatureAnchorConflictError } from './FeatureAnchorConflictError.js';
import { normalizeAffectedTimeRange } from './polygonLayerValidation.js';
import { resolvePolygonAnchorConflictsOrThrow } from './polygonAnchorConflictResolution.js';

function compareTimePoints(left, right) {
  if (!(left instanceof TimePoint) || !(right instanceof TimePoint)) {
    return 0;
  }
  if (left.equals(right)) {
    return 0;
  }
  return left.isBefore(right) ? -1 : 1;
}

function cloneWorldForPreview(world) {
  return {
    ...world,
    features: Array.isArray(world?.features) ? [...world.features] : [],
    vertices: Array.isArray(world?.vertices)
      ? world.vertices.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }))
      : []
  };
}

function getAnchorRangeKey(anchor) {
  if (!anchor || typeof anchor.id !== 'string') {
    return '';
  }
  const start = anchor.startTime instanceof TimePoint
    ? `${anchor.startTime.year}:${anchor.startTime.month ?? 'null'}:${anchor.startTime.day ?? 'null'}`
    : 'null';
  const end = anchor.endTime instanceof TimePoint
    ? `${anchor.endTime.year}:${anchor.endTime.month ?? 'null'}:${anchor.endTime.day ?? 'null'}`
    : 'null';
  return `${anchor.id}|${start}|${end}`;
}

function deriveAffectedTimeRange(existingAnchors, candidateAnchors) {
  const before = Array.isArray(existingAnchors) ? existingAnchors : [];
  const after = Array.isArray(candidateAnchors) ? candidateAnchors : [];

  const beforeMap = new Map(before.map(anchor => [anchor.id, anchor]));
  const afterMap = new Map(after.map(anchor => [anchor.id, anchor]));
  const targetIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changedAnchors = [];
  targetIds.forEach(id => {
    const oldAnchor = beforeMap.get(id) || null;
    const nextAnchor = afterMap.get(id) || null;
    if (!oldAnchor || !nextAnchor) {
      if (oldAnchor) {
        changedAnchors.push(oldAnchor);
      }
      if (nextAnchor) {
        changedAnchors.push(nextAnchor);
      }
      return;
    }
    if (getAnchorRangeKey(oldAnchor) !== getAnchorRangeKey(nextAnchor)) {
      changedAnchors.push(oldAnchor, nextAnchor);
    }
  });

  if (changedAnchors.length === 0) {
    return null;
  }

  let start = null;
  let end = null;
  for (const anchor of changedAnchors) {
    if (!(anchor?.startTime instanceof TimePoint)) {
      continue;
    }
    if (!(start instanceof TimePoint) || compareTimePoints(anchor.startTime, start) < 0) {
      start = anchor.startTime;
    }
    if (end === null || end === undefined || anchor.endTime === null || anchor.endTime === undefined) {
      end = null;
    } else if (anchor.endTime instanceof TimePoint && compareTimePoints(end, anchor.endTime) < 0) {
      end = anchor.endTime;
    }
  }

  if (!(start instanceof TimePoint)) {
    return null;
  }
  return { start, end };
}

function buildPropertyEditPayload(editTime, draftPatch) {
  if (!(editTime instanceof TimePoint)) {
    throw new Error('編集時刻は TimePoint で指定してください。');
  }
  if (!draftPatch || typeof draftPatch !== 'object') {
    throw new Error('draftPatch の形式が不正です。');
  }
  return {
    editTime,
    startTime: draftPatch.startTime,
    endTime: draftPatch.endTime,
    name: draftPatch.name,
    description: draftPatch.description,
    boundaryEdit: draftPatch.boundaryEdit,
    affectedTimeRange: draftPatch.affectedTimeRange
  };
}

export class PrepareFeatureAnchorEditUseCase {
  constructor(worldRepository, updateFeatureUseCase, layerService, geometryService, draftStore) {
    this._worldRepository = worldRepository;
    this._updateFeatureUseCase = updateFeatureUseCase;
    this._layerService = layerService;
    this._geometryService = geometryService;
    this._draftStore = draftStore;
  }

  async execute({ featureId, editMode, editTime, draftPatch }) {
    if (typeof featureId !== 'string' || featureId.trim() === '') {
      throw new Error('featureId は必須です。');
    }
    if (editMode !== 'property_only' && editMode !== 'shape_and_property') {
      throw new Error('editMode は "property_only" または "shape_and_property" を指定してください。');
    }

    const propertyEdit = buildPropertyEditPayload(editTime, draftPatch);
    const world = await this._worldRepository.getWorld();
    const featureIndex = world.features.findIndex(feature => feature.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found: ${featureId}`);
    }
    const feature = world.features[featureIndex];

    const candidateAnchors = this._updateFeatureUseCase.buildAnchorsForEditDraft(feature, propertyEdit);
    const explicitAffectedTimeRange = normalizeAffectedTimeRange(propertyEdit.affectedTimeRange);
    const derivedAffectedTimeRange = deriveAffectedTimeRange(feature.anchors, candidateAnchors);
    const affectedTimeRange = explicitAffectedTimeRange || derivedAffectedTimeRange;

    let status = 'ready_to_commit';
    let conflicts = [];
    if (feature instanceof Polygon) {
      const previewWorld = cloneWorldForPreview(world);
      const previewFeature = feature.withAnchors(candidateAnchors);
      previewWorld.features[featureIndex] = previewFeature;
      try {
        resolvePolygonAnchorConflictsOrThrow({
          editedPolygons: [previewFeature],
          world: previewWorld,
          layerService: this._layerService,
          geometryService: this._geometryService,
          affectedTimeRange
        });
      } catch (error) {
        if (error instanceof FeatureAnchorConflictError || error?.code === 'FEATURE_ANCHOR_CONFLICTS') {
          status = 'requires_resolution';
          conflicts = Array.isArray(error.conflicts) ? error.conflicts : [];
        } else {
          throw error;
        }
      }
    }

    const draftId = this._draftStore.create({
      featureId,
      editMode,
      editTime,
      draftPatch: propertyEdit,
      candidateAnchors: [...candidateAnchors],
      affectedTimeRange,
      status,
      conflicts,
      conflictResolutions: null,
      resolvedAnchorsByFeature: null
    });

    return {
      draftId,
      status,
      candidateAnchors: [...candidateAnchors],
      affectedTimeRange,
      conflicts: status === 'requires_resolution' ? conflicts : []
    };
  }
}
