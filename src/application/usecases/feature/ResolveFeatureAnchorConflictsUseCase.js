import { Polygon } from '../../../domain/entities/Polygon.js';
import { resolvePolygonAnchorConflictsOrThrow } from './polygonAnchorConflictResolution.js';

function cloneWorldForPreview(world) {
  return {
    ...world,
    features: Array.isArray(world?.features) ? [...world.features] : [],
    vertices: Array.isArray(world?.vertices)
      ? world.vertices.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }))
      : []
  };
}

export class ResolveFeatureAnchorConflictsUseCase {
  constructor(worldRepository, layerService, geometryService, draftStore) {
    this._worldRepository = worldRepository;
    this._layerService = layerService;
    this._geometryService = geometryService;
    this._draftStore = draftStore;
  }

  async execute({ draftId, resolutions }) {
    if (typeof draftId !== 'string' || draftId.trim() === '') {
      throw new Error('draftId は必須です。');
    }
    if (!resolutions || typeof resolutions !== 'object') {
      throw new Error('resolutions の形式が不正です。');
    }

    const draft = this._draftStore.get(draftId);
    if (!draft) {
      throw new Error(`保存前編集案が見つかりません: ${draftId}`);
    }

    const world = await this._worldRepository.getWorld();
    const featureIndex = world.features.findIndex(feature => feature.id === draft.featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found: ${draft.featureId}`);
    }

    const feature = world.features[featureIndex];
    const candidateAnchors = Array.isArray(draft.candidateAnchors) ? draft.candidateAnchors : [];
    if (candidateAnchors.length === 0) {
      throw new Error('候補の履歴アンカーが空です。');
    }

    const previewWorld = cloneWorldForPreview(world);
    const previewFeature = feature.withAnchors(candidateAnchors);
    previewWorld.features[featureIndex] = previewFeature;

    const changedFeatureIds = previewFeature instanceof Polygon
      ? resolvePolygonAnchorConflictsOrThrow({
          editedPolygons: [previewFeature],
          world: previewWorld,
          layerService: this._layerService,
          geometryService: this._geometryService,
          conflictResolutions: resolutions,
          affectedTimeRange: draft.affectedTimeRange
        })
      : new Set();

    const resolvedFeatureIds = new Set([draft.featureId]);
    changedFeatureIds.forEach(featureId => resolvedFeatureIds.add(featureId));

    const resolvedAnchorsByFeature = {};
    resolvedFeatureIds.forEach(featureId => {
      const resolvedFeature = previewWorld.features.find(featureItem => featureItem.id === featureId);
      if (resolvedFeature && Array.isArray(resolvedFeature.anchors) && resolvedFeature.anchors.length > 0) {
        resolvedAnchorsByFeature[featureId] = [...resolvedFeature.anchors];
      }
    });

    this._draftStore.update(draftId, {
      status: 'ready_to_commit',
      conflictResolutions: resolutions,
      resolvedAnchorsByFeature
    });

    return { resolvedAnchorsByFeature };
  }
}
