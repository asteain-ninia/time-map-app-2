import { FeatureAnchor } from '../../../../domain/value-objects/FeatureAnchor.js';

/**
 * 複数地物のプロパティ更新操作を単一コマンドとして扱う
 */
export class BatchUpdatePropertiesCommand {
  /**
   * @param {Object} payload
   * @param {{ featureId: string, oldAnchors: Object[], newAnchors: Object[] }[]} payload.updates
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
      const timelineData = update.newAnchors || [];
      const updatePayload = this._buildTimelineUpdatePayload(timelineData);
      const result = await this._editFeatureUseCase.updateFeature(update.featureId, updatePayload);
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
      const timelineData = update.oldAnchors || [];
      const updatePayload = this._buildTimelineUpdatePayload(timelineData);
      const result = await this._editFeatureUseCase.updateFeature(update.featureId, updatePayload);
      if (result?.feature) {
        updatedFeatures.push(result.feature);
      }
    }
    return { updatedFeatures };
  }

  _buildTimelineUpdatePayload(serializedTimeline) {
    const deserialized = (serializedTimeline || [])
      .map(entry => this._serializer.deserialize(entry))
      .filter(Boolean);

    if (deserialized.length === 0) {
      throw new Error('履歴タイムラインが空です。oldAnchors/newAnchors を設定してください。');
    }

    if (deserialized.every(entry => entry instanceof FeatureAnchor)) {
      return { anchors: deserialized };
    }

    throw new Error('履歴タイムラインの形式が不正です。FeatureAnchor のみ許可されています。');
  }
}
