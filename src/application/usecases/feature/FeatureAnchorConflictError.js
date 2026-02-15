export class FeatureAnchorConflictError extends Error {
  /**
   * @param {string} message
   * @param {Array<object>} conflicts
   */
  constructor(message, conflicts = []) {
    super(message);
    this.name = 'FeatureAnchorConflictError';
    this.code = 'FEATURE_ANCHOR_CONFLICTS';
    this.conflicts = Array.isArray(conflicts) ? conflicts : [];
  }
}
