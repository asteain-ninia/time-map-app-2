// src/domain/entities/Feature.js
import { TimePoint } from '../value-objects/TimePoint.js';
import { FeatureAnchor } from '../value-objects/FeatureAnchor.js';
// サブクラスのインポートは循環参照になるためここでは行わない

/**
 * 地理オブジェクトの基底クラス
 */
export class Feature {
  /**
   * 地理オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列
   * @param {Property[]|Property|null|undefined} properties - 時間依存プロパティの候補
   * @param {string} layerId - 所属レイヤーID
   * @param {FeatureAnchor[]|null|undefined} anchors - 履歴アンカー正準データ
   */
  constructor(id, vertexIds, properties, layerId, anchors = null) {
    void properties;
    this._id = id;
    this._vertexIds = [...vertexIds];
    Object.freeze(this._vertexIds);

    const normalizedAnchors = Feature._normalizeAnchors(id, anchors);
    if (normalizedAnchors.length === 0) {
      throw new Error(`Feature ${id} requires at least one FeatureAnchor.`);
    }
    this._anchors = Object.freeze(normalizedAnchors);
    const latestAnchor = normalizedAnchors[normalizedAnchors.length - 1];
    const layerFromAnchor = latestAnchor?.placement?.layerId;
    this._layerId = typeof layerFromAnchor === 'string' ? layerFromAnchor : layerId;
  }

  /**
   * 履歴アンカー配列を正規化する
   * @param {string} featureId
   * @param {FeatureAnchor[]|null|undefined} anchors
   * @returns {FeatureAnchor[]}
   * @private
   */
  static _normalizeAnchors(featureId, anchors) {
    if (!Array.isArray(anchors) || anchors.length === 0) {
      return [];
    }

    const validAnchors = [];
    for (const candidate of anchors) {
      if (candidate instanceof FeatureAnchor) {
        validAnchors.push(candidate);
      } else if (candidate !== null && candidate !== undefined) {
        console.warn(
          `Feature (id: ${featureId}) received a non-FeatureAnchor item in anchors and it will be ignored.`,
          candidate
        );
      }
    }

    if (validAnchors.length === 0) {
      return [];
    }

    validAnchors.sort((left, right) => {
      if (left.startTime.equals(right.startTime)) return 0;
      return left.startTime.isBefore(right.startTime) ? -1 : 1;
    });

    for (let index = 1; index < validAnchors.length; index += 1) {
      if (validAnchors[index - 1].startTime.equals(validAnchors[index].startTime)) {
        throw new Error(`Feature ${featureId} has duplicate anchors at the same time.`);
      }
    }
    return validAnchors;
  }

  /**
   * オブジェクトIDを取得
   * @returns {string} オブジェクトID
   */
  get id() {
    return this._id;
  }

  /**
   * 頂点IDの配列を取得
   * @returns {string[]} 頂点IDの配列
   */
  get vertexIds() {
    return this._vertexIds;
  }

  /**
   * @deprecated Feature.properties は廃止。Feature.anchors を使用すること。
   */
  get properties() {
    throw new Error('Feature.properties は廃止されました。Feature.anchors を使用してください。');
  }

  /**
   * 履歴アンカー正準データを取得
   * @returns {FeatureAnchor[]}
   */
  get anchors() {
    return this._anchors;
  }

  /**
   * 所属レイヤーIDを取得
   * @returns {string} レイヤーID
   */
  get layerId() {
    return this._layerId;
  }

  /**
   * 指定時刻で有効な所属レイヤーIDを取得
   * @param {TimePoint|null|undefined} timePoint
   * @returns {string}
   */
  getLayerIdAt(timePoint) {
    const anchor = this.getAnchorAt(timePoint);
    const layerId = anchor?.placement?.layerId;
    return typeof layerId === 'string' ? layerId : this._layerId;
  }

  /**
   * 指定時刻で有効な履歴アンカーを取得
   * @param {TimePoint|null|undefined} timePoint
   * @returns {FeatureAnchor|null}
   */
  getAnchorAt(timePoint) {
    if (!Array.isArray(this._anchors) || this._anchors.length === 0) {
      return null;
    }
    if (!(timePoint instanceof TimePoint)) {
      return this._anchors[this._anchors.length - 1];
    }

    let candidate = null;
    for (const anchor of this._anchors) {
      if (timePoint.isBefore(anchor.startTime)) {
        break;
      }
      if (anchor.isActiveAt(timePoint)) {
        candidate = anchor;
      }
    }
    return candidate;
  }

  /**
   * 指定した時点で有効な履歴アンカーを取得する（後方互換メソッド）
   * @param {TimePoint|null|undefined} timePoint - 取得対象の時刻
   * @returns {FeatureAnchor|null} 有効な履歴アンカー。存在しなければnull
   */
  getPropertyAt(timePoint) {
    return this.getAnchorAt(timePoint);
  }

  /**
   * 指定した時点に地物が存在するか判定する
   * @param {TimePoint|null|undefined} timePoint - 判定対象の時刻
   * @returns {boolean} 存在する場合はtrue
   */
  existsAt(timePoint) {
    return this.getAnchorAt(timePoint) !== null;
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成
   * 注意: このメソッドはサブクラスでオーバーライドされることを強く推奨します。
   *       基底クラスの実装ではサブクラス固有のプロパティが失われる可能性があります。
   * @param {string[]} vertexIds - 置き換える頂点IDの配列
   * @returns {Feature} 新しいFeatureインスタンス (サブクラスでは上書き推奨)
   */
  withVertexIds(vertexIds) {
    console.warn(
      `Feature.withVertexIds (id: ${this._id}) was called on a Feature instance. Subclasses should override this method to return an instance of their own type.`
    );
    return new Feature(this._id, vertexIds, null, this._layerId, this._anchors);
  }

  /**
   * 新しい履歴アンカー集合を適用したインスタンスを作成する
   * 注意: このメソッドはサブクラスでオーバーライドされることを強く推奨します。
   * @param {FeatureAnchor[]} anchors - 置き換える履歴アンカー集合
   * @returns {Feature} 新しいFeatureインスタンス (サブクラスでは上書き推奨)
   */
  withAnchors(anchors) {
    console.warn(
      `Feature.withAnchors (id: ${this._id}) was called on a Feature instance. Subclasses should override this method to return an instance of their own type.`
    );
    const normalizedAnchors = Feature._normalizeAnchors(this._id, anchors);
    if (normalizedAnchors.length === 0) {
      throw new Error(`Feature.withAnchors (id: ${this._id}) requires at least one FeatureAnchor.`);
    }
    const latestAnchor = normalizedAnchors[normalizedAnchors.length - 1];
    const layerId = typeof latestAnchor?.placement?.layerId === 'string'
      ? latestAnchor.placement.layerId
      : this._layerId;
    return new Feature(this._id, this._vertexIds, null, layerId, normalizedAnchors);
  }

  /**
   * 新しいプロパティ集合を適用したインスタンスを作成する
   * 注意: このメソッドはサブクラスでオーバーライドされることを強く推奨します。
   *       基底クラスの実装ではサブクラス固有のプロパティが失われる可能性があります。
   * @param {Property[]|Property|null|undefined} properties - 置き換えるプロパティ集合
   * @returns {Feature} 新しいFeatureインスタンス (サブクラスでは上書き推奨)
   */
  withProperties(properties) {
    void properties;
    throw new Error('Feature.withProperties は廃止されました。FeatureAnchor を使用してください。');
  }

  /**
   * プロパティを追加したインスタンスを作成する
   * @param {Property} property - 追加するプロパティ
   * @returns {Feature} 追加後のFeatureインスタンス
   */
  addProperty(property) {
    void property;
    throw new Error('Feature.addProperty は廃止されました。FeatureAnchor を使用してください。');
  }

  /**
   * 所属レイヤーIDを変更したインスタンスを作成する
   * @param {string} layerId - 置き換えるレイヤーID
   * @returns {Feature} 新しいFeatureインスタンス (サブクラスでは上書き推奨)
   */
  withLayerId(layerId) {
    console.warn(
      `Feature.withLayerId (id: ${this._id}) was called on a Feature instance. Subclasses should override this method to return an instance of their own type.`
    );
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withPlacement({
        ...(anchor.placement || {}),
        layerId
      }))
      : null;
    return new Feature(this._id, this._vertexIds, null, layerId, nextAnchors);
  }
}
