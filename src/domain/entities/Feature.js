import { Property } from '../value-objects/Property.js';

/**
 * 地理オブジェクトの基底クラス
 */
export class Feature {
  /**
   * 地理オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列
   * @param {Property[]} properties - 時間依存プロパティの配列
   * @param {string} layerId - 所属レイヤーID
   */
  constructor(id, vertexIds, properties, layerId) {
    this._id = id;
    this._vertexIds = [...vertexIds];
    this._properties = [...properties];
    this._layerId = layerId;
    
    // vertexIdsとpropertiesは変更可能だが、内部要素は不変
    Object.freeze(this._vertexIds);
    Object.freeze(this._properties);
    
    // このオブジェクト自体は変更不可
    Object.freeze(this);
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
   * 所属レイヤーIDを取得
   * @returns {string} レイヤーID
   */
  get layerId() {
    return this._layerId;
  }

  /**
   * 特定の時点でのプロパティを取得
   * @param {TimePoint} timePoint - 時点
   * @returns {Property|null} 適用されるプロパティまたはnull
   */
  getPropertyAt(timePoint) {
    // timePointにおいて有効かつ最も新しいプロパティを検索
    let latestProperty = null;
    
    for (const property of this._properties) {
      if (property.isActiveAt(timePoint)) {
        if (!latestProperty || latestProperty.timePoint.isBefore(property.timePoint)) {
          latestProperty = property;
        }
      }
    }
    
    return latestProperty;
  }

  /**
   * 特定の時点でこのオブジェクトが存在するかを判定
   * @param {TimePoint} timePoint - チェックする時点
   * @returns {boolean} オブジェクトが存在すればtrue
   */
  existsAt(timePoint) {
    return this.getPropertyAt(timePoint) !== null;
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成
   * @param {string[]} vertexIds - 新しい頂点IDの配列
   * @returns {Feature} 新しい地理オブジェクト
   */
  withVertexIds(vertexIds) {
    return new this.constructor(this._id, vertexIds, this._properties, this._layerId);
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成
   * @param {Property[]} properties - 新しいプロパティの配列
   * @returns {Feature} 新しい地理オブジェクト
   */
  withProperties(properties) {
    return new this.constructor(this._id, this._vertexIds, properties, this._layerId);
  }

  /**
   * 既存のプロパティ配列に新しいプロパティを追加した新インスタンスを作成
   * @param {Property} property - 追加するプロパティ
   * @returns {Feature} 新しい地理オブジェクト
   */
  addProperty(property) {
    return this.withProperties([...this._properties, property]);
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Feature} 新しい地理オブジェクト
   */
  withLayerId(layerId) {
    return new this.constructor(this._id, this._vertexIds, this._properties, layerId);
  }
}