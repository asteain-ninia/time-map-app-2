// src/domain/entities/Feature.js
import { TimePoint } from '../value-objects/TimePoint.js';
import { Property } from '../value-objects/Property.js';
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
   */
  constructor(id, vertexIds, properties, layerId) {
    this._id = id;
    this._vertexIds = [...vertexIds];

    const normalizedProperties = Feature._normalizeProperties(id, properties);
    this._properties = Object.freeze(normalizedProperties); // プロパティ配列自体を凍結する
    this._layerId = layerId;

    Object.freeze(this._vertexIds);
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
   * 時間依存プロパティの配列を取得 (現在の単純化モデルでは要素数1の配列)
   * @returns {Property[]} プロパティの配列
   */
  get properties() {
    return this._properties;
  }

  /**
   * 所属レイヤーIDを取得
   * @returns {string} レイヤーID
   */
  get layerId() {
    return this._layerId;
  }

  /**
   * 指定した時点で有効なプロパティを取得する
   * @param {TimePoint|null|undefined} timePoint - 取得対象の時刻
   * @returns {Property|null} 有効なプロパティ。存在しなければnull
   */
  getPropertyAt(timePoint) {
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
    return new Feature(this._id, vertexIds, this._properties, this._layerId);
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
    return new Feature(this._id, this._vertexIds, normalized, this._layerId);
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
    return new Feature(this._id, this._vertexIds, this._properties, layerId);
  }
}
