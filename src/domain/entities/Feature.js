// src/domain/entities/Feature.js
import { TimePoint } from '../value-objects/TimePoint.js';
import { Property } from '../value-objects/Property.js';
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
    this._id = id;
    this._vertexIds = [...vertexIds];
    Object.freeze(this._vertexIds);

    const normalizedAnchors = Feature._normalizeAnchors(id, anchors);
    this._anchors = Object.freeze(normalizedAnchors);

    if (normalizedAnchors.length > 0) {
      this._properties = Object.freeze(
        normalizedAnchors.map(anchor => anchor.toPropertyProjection())
      );
      const latestAnchor = normalizedAnchors[normalizedAnchors.length - 1];
      const layerFromAnchor = latestAnchor?.placement?.layerId;
      this._layerId = typeof layerFromAnchor === 'string' ? layerFromAnchor : layerId;
    } else {
      const normalizedProperties = Feature._normalizeProperties(id, properties);
      this._properties = Object.freeze(normalizedProperties); // プロパティ配列自体を凍結する
      this._layerId = layerId;
    }
  }

  /**
   * プロパティ配列を正規化する
   * @param {string} featureId - 対象となるFeatureのID
   * @param {Property[]|Property|null|undefined} properties - 正規化前のプロパティ集合
   * @returns {Property[]} 時系列順に整列されたプロパティ配列
   * @private
   */
  static _normalizeProperties(featureId, properties) {
    const arrayInput = Array.isArray(properties)
      ? properties
      : properties instanceof Property || properties === null || properties === undefined
        ? [properties].filter(Boolean)
        : [];

    const validProperties = [];
    for (const candidate of arrayInput) {
      if (candidate instanceof Property) {
        validProperties.push(candidate);
      } else if (candidate !== null && candidate !== undefined) {
        console.warn(
          `Feature (id: ${featureId}) received a non-Property item in properties and it will be ignored.`,
          candidate
        );
      }
    }

    if (validProperties.length === 0) {
      console.warn(
        `Feature constructor (id: ${featureId}) did not receive any Property instances. Falling back to a default Property.`
      );
      const defaultTimePoint = new TimePoint(0);
      return [
        new Property(defaultTimePoint, 'Default Property', '', {}, defaultTimePoint, null)
      ];
    }

    validProperties.sort((a, b) => Feature._comparePropertiesByStart(a, b));
    return [...validProperties];
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
   * プロパティの開始時刻で並び替える際の比較関数
   * @param {Property} left - 比較対象のプロパティA
   * @param {Property} right - 比較対象のプロパティB
   * @returns {number} 並び順を表す値
   * @private
   */
  static _comparePropertiesByStart(left, right) {
    const leftStart = Feature._selectTimeAnchor(left);
    const rightStart = Feature._selectTimeAnchor(right);

    if (leftStart && rightStart) {
      if (leftStart.isBefore(rightStart)) return -1;
      if (rightStart.isBefore(leftStart)) return 1;
      return 0;
    }

    if (leftStart) return -1;
    if (rightStart) return 1;
    return 0;
  }

  /**
   * 比較用の基準時刻を取得する
   * @param {Property} property - 対象のプロパティ
   * @returns {TimePoint|null} 比較に使用する開始時刻
   * @private
   */
  static _selectTimeAnchor(property) {
    return property.startTime || property.timePoint || null;
  }

  static _buildAnchorId(featureId, start, index) {
    const month = start?.month ?? 'null';
    const day = start?.day ?? 'null';
    return `anchor-${featureId}-${index + 1}-${start?.year ?? 0}-${month}-${day}`;
  }

  static _resolveTemplateAnchor(existingAnchors, startTime) {
    if (!Array.isArray(existingAnchors) || existingAnchors.length === 0) {
      return null;
    }

    const exact = existingAnchors.find(anchor => anchor.startTime.equals(startTime));
    if (exact) {
      return exact;
    }

    const active = existingAnchors.find(anchor => anchor.isActiveAt(startTime));
    if (active) {
      return active;
    }

    const earlier = existingAnchors
      .filter(anchor => anchor.startTime.isBefore(startTime))
      .sort((left, right) => left.startTime.isBefore(right.startTime) ? 1 : -1);
    if (earlier.length > 0) {
      return earlier[0];
    }

    return existingAnchors[0];
  }

  /**
   * 既存アンカーを保持しつつ、Property 配列に対応するアンカー列へ同期する。
   * @param {string} featureId
   * @param {FeatureAnchor[]} existingAnchors
   * @param {Property[]} normalizedProperties
   * @param {Object} fallbackShape
   * @param {Object} fallbackPlacement
   * @returns {FeatureAnchor[]}
   */
  static _syncAnchorsWithProperties(
    featureId,
    existingAnchors,
    normalizedProperties,
    fallbackShape,
    fallbackPlacement
  ) {
    const anchors = Array.isArray(existingAnchors) ? existingAnchors : [];
    const fallbackAnchor = new FeatureAnchor({
      id: `anchor-${featureId}-fallback`,
      timeRange: {
        start: new TimePoint(0),
        end: null
      },
      property: {
        name: 'Default Property',
        description: '',
        attributes: {}
      },
      shape: fallbackShape || {},
      placement: fallbackPlacement || {}
    });

    return normalizedProperties.map((property, index) => {
      const start = Feature._selectTimeAnchor(property);
      const end = property.endTime || null;
      const exactAnchor = anchors.find(anchor => anchor.startTime.equals(start));
      const template = exactAnchor || Feature._resolveTemplateAnchor(anchors, start) || fallbackAnchor;
      const anchorId = exactAnchor ? exactAnchor.id : Feature._buildAnchorId(featureId, start, index);

      return new FeatureAnchor({
        id: anchorId,
        timeRange: { start, end },
        property: {
          name: property.name,
          description: property.description,
          attributes: property.getAttributes()
        },
        shape: template.shape,
        placement: template.placement
      });
    });
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
   * 時間依存プロパティの配列を取得
   * @returns {Property[]} プロパティの配列
   */
  get properties() {
    return this._properties;
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
   * 指定した時点で有効なプロパティを取得する
   * @param {TimePoint|null|undefined} timePoint - 取得対象の時刻
   * @returns {Property|null} 有効なプロパティ。存在しなければnull
   */
  getPropertyAt(timePoint) {
    if (this._anchors.length > 0) {
      const anchor = this.getAnchorAt(timePoint);
      return anchor ? anchor.toPropertyProjection() : null;
    }

    if (this._properties.length === 0) {
      return null;
    }

    if (!(timePoint instanceof TimePoint)) {
      // Without a valid time, expose the latest definition
      return this._properties[this._properties.length - 1];
    }

    let candidate = null;
    for (const property of this._properties) {
      const start = Feature._selectTimeAnchor(property);
      if (start && timePoint.isBefore(start)) {
        break;
      }
      if (property.isActiveAt(timePoint)) {
        candidate = property;
      }
    }

    return candidate;
  }

  /**
   * 指定した時点に地物が存在するか判定する
   * @param {TimePoint|null|undefined} timePoint - 判定対象の時刻
   * @returns {boolean} 存在する場合はtrue
   */
  existsAt(timePoint) {
    if (this._anchors.length > 0 && timePoint instanceof TimePoint) {
      return this.getAnchorAt(timePoint) !== null;
    }
    return this.getPropertyAt(timePoint) !== null;
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
    return new Feature(this._id, vertexIds, this._properties, this._layerId, this._anchors);
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
    return new Feature(this._id, this._vertexIds, this._properties, layerId, normalizedAnchors);
  }

  /**
   * 新しいプロパティ集合を適用したインスタンスを作成する
   * 注意: このメソッドはサブクラスでオーバーライドされることを強く推奨します。
   *       基底クラスの実装ではサブクラス固有のプロパティが失われる可能性があります。
   * @param {Property[]|Property|null|undefined} properties - 置き換えるプロパティ集合
   * @returns {Feature} 新しいFeatureインスタンス (サブクラスでは上書き推奨)
   */
  withProperties(properties) {
    console.warn(
      `Feature.withProperties (id: ${this._id}) was called on a Feature instance. Subclasses should override this method to return an instance of their own type.`
    );
    const normalized = Feature._normalizeProperties(this._id, properties);
    const nextAnchors = this._anchors.length > 0
      ? Feature._syncAnchorsWithProperties(this._id, this._anchors, normalized, {}, { layerId: this._layerId })
      : null;
    if (Array.isArray(nextAnchors) && nextAnchors.length > 0) {
      return this.withAnchors(nextAnchors);
    }
    return new Feature(this._id, this._vertexIds, normalized, this._layerId, nextAnchors);
  }

  /**
   * プロパティを追加したインスタンスを作成する
   * @param {Property} property - 追加するプロパティ
   * @returns {Feature} 追加後のFeatureインスタンス
   */
  addProperty(property) {
    if (!(property instanceof Property)) {
      console.error(
        `Feature.addProperty (id: ${this._id}): Provided property is not an instance of Property. Keeping original properties. Received:`,
        property
      );
      return this;
    }

    return this.withProperties([...this._properties, property]);
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
    return new Feature(this._id, this._vertexIds, this._properties, layerId, nextAnchors);
  }
}
