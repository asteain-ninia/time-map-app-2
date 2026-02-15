/**
 * 複数地物のプロパティ更新操作を単一コマンドとして扱う
 */
export class BatchUpdatePropertiesCommand {
  /**
   * @param {Object} payload
   * @param {{ featureId: string, oldProperties: Object[], newProperties: Object[] }[]} payload.updates
   * @param {EditFeatureUseCase} editFeatureUseCase
   * @param {HistorySerializer} serializer
   * @param {WorldRepository} worldRepository
   */
  constructor(payload, editFeatureUseCase, serializer, worldRepository) {
    this._payload = payload;
    this._editFeatureUseCase = editFeatureUseCase;
    this._serializer = serializer;
    this._worldRepository = worldRepository;
  }

  async execute() {
    const updatedFeatures = [];
    for (const update of this._payload.updates || []) {
      const properties = (update.newProperties || [])
        .map(property => this._serializer.deserialize(property))
        .filter(Boolean);
      const result = await this._editFeatureUseCase.updateFeature(update.featureId, { properties });
      if (result?.feature) {
        updatedFeatures.push(result.feature);
      }
    }
    return { updatedFeatures };
  }

  async reverse() {
    const updatedFeatures = [];
    const updates = this._payload.updates || [];
    for (let index = updates.length - 1; index >= 0; index -= 1) {
      const update = updates[index];
      const properties = (update.oldProperties || [])
        .map(property => this._serializer.deserialize(property))
        .filter(Boolean);
      const result = await this._editFeatureUseCase.updateFeature(update.featureId, { properties });
      if (result?.feature) {
        updatedFeatures.push(result.feature);
      }
    }
    return { updatedFeatures };
  }
}
