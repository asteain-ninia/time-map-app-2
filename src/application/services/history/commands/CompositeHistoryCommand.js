/**
 * 複数の履歴コマンドを単一の履歴エントリとして扱う
 */
export class CompositeHistoryCommand {
  /**
   * @param {Object[]} commands
   */
  constructor(commands = []) {
    this._commands = Array.isArray(commands) ? commands.filter(Boolean) : [];
  }

  async execute() {
    const results = [];
    for (const command of this._commands) {
      if (!command || typeof command.execute !== 'function') {
        continue;
      }
      results.push(await command.execute());
    }
    return this._mergeResults(results);
  }

  async reverse() {
    const results = [];
    for (let index = this._commands.length - 1; index >= 0; index -= 1) {
      const command = this._commands[index];
      if (!command || typeof command.reverse !== 'function') {
        continue;
      }
      results.push(await command.reverse());
    }
    return this._mergeResults(results);
  }

  _mergeResults(results) {
    const merged = {};
    const updatedFeatures = [];
    const updatedFeatureIds = new Set();

    for (const result of results) {
      if (!result || typeof result !== 'object') {
        continue;
      }

      if (!merged.eventType && result.eventType && result.eventPayload) {
        merged.eventType = result.eventType;
        merged.eventPayload = result.eventPayload;
      }
      if (!merged.movedVerticesResult && result.movedVerticesResult) {
        merged.movedVerticesResult = result.movedVerticesResult;
      }
      if (!merged.addedFeature && result.addedFeature) {
        merged.addedFeature = result.addedFeature;
      }
      if (!merged.deletedFeatureId && result.deletedFeatureId) {
        merged.deletedFeatureId = result.deletedFeatureId;
      }

      if (result.updatedFeature) {
        const featureId = result.updatedFeature.id;
        if (!updatedFeatureIds.has(featureId)) {
          updatedFeatureIds.add(featureId);
          updatedFeatures.push(result.updatedFeature);
        }
      }
      if (Array.isArray(result.updatedFeatures)) {
        for (const feature of result.updatedFeatures) {
          if (!feature) {
            continue;
          }
          const featureId = feature.id;
          if (!updatedFeatureIds.has(featureId)) {
            updatedFeatureIds.add(featureId);
            updatedFeatures.push(feature);
          }
        }
      }
    }

    if (updatedFeatures.length > 0) {
      merged.updatedFeatures = updatedFeatures;
    }

    return merged;
  }
}
