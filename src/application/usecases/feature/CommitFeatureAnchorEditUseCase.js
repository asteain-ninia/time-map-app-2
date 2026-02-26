export class CommitFeatureAnchorEditUseCase {
  constructor(updateFeatureUseCase, draftStore) {
    this._updateFeatureUseCase = updateFeatureUseCase;
    this._draftStore = draftStore;
  }

  async execute({ draftId, resolvedAnchorsByFeature }) {
    if (typeof draftId !== 'string' || draftId.trim() === '') {
      throw new Error('draftId は必須です。');
    }

    const draft = this._draftStore.get(draftId);
    if (!draft) {
      throw new Error(`保存前編集案が見つかりません: ${draftId}`);
    }
    if (draft.status !== 'ready_to_commit') {
      throw new Error('競合解決が完了するまで Commit は実行できません。');
    }

    const hasConflicts = Array.isArray(draft.conflicts) && draft.conflicts.length > 0;
    const effectiveResolvedAnchors = (
      resolvedAnchorsByFeature && typeof resolvedAnchorsByFeature === 'object'
    )
      ? resolvedAnchorsByFeature
      : draft.resolvedAnchorsByFeature;
    if (hasConflicts) {
      if (!draft.conflictResolutions || typeof draft.conflictResolutions !== 'object') {
        throw new Error('競合解決方針が不足しているため Commit を実行できません。');
      }
      if (!effectiveResolvedAnchors || typeof effectiveResolvedAnchors !== 'object') {
        throw new Error('resolvedAnchorsByFeature が不足しているため Commit を実行できません。');
      }
    }

    const propertyEdit = {
      ...draft.draftPatch,
      editTime: draft.editTime,
      affectedTimeRange: draft.affectedTimeRange
    };
    if (hasConflicts) {
      propertyEdit.conflictResolutions = draft.conflictResolutions;
    }

    try {
      const result = await this._updateFeatureUseCase.execute(draft.featureId, { propertyEdit });
      const updatedFeatures = Array.isArray(result?.updatedFeatures) && result.updatedFeatures.length > 0
        ? result.updatedFeatures
        : (result?.feature ? [result.feature] : []);
      return {
        feature: result?.feature || null,
        updatedFeatures,
        historyEntryId: draftId
      };
    } finally {
      this._draftStore.delete(draftId);
    }
  }
}
