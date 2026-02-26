export class FeatureAnchorEditDraftStore {
  constructor(maxEntries = 128) {
    this._maxEntries = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 128;
    this._drafts = new Map();
    this._counter = 0;
  }

  create(payload) {
    const draftId = `feature-anchor-draft-${Date.now()}-${this._counter + 1}`;
    this._counter += 1;
    if (this._drafts.size >= this._maxEntries) {
      const oldestKey = this._drafts.keys().next().value;
      if (oldestKey) {
        this._drafts.delete(oldestKey);
      }
    }
    this._drafts.set(draftId, { ...payload, draftId });
    return draftId;
  }

  get(draftId) {
    if (typeof draftId !== 'string' || draftId.trim() === '') {
      return null;
    }
    return this._drafts.get(draftId) || null;
  }

  update(draftId, updates) {
    const existing = this.get(draftId);
    if (!existing) {
      throw new Error(`保存前編集案が見つかりません: ${draftId}`);
    }
    const next = { ...existing, ...(updates || {}) };
    this._drafts.set(draftId, next);
    return next;
  }

  delete(draftId) {
    if (typeof draftId !== 'string' || draftId.trim() === '') {
      return false;
    }
    return this._drafts.delete(draftId);
  }
}
