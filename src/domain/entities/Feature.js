// src/domain/entities/Feature.js
import { TimePoint } from '../value-objects/TimePoint.js';
import { Property } from '../value-objects/Property.js';
// サブクラスのインポートを削除します。これにより循環参照が解消されます。
// import { Point as DomainPoint } from './Point.js';
// import { Line as DomainLine } from './Line.js';
// import { Polygon as DomainPolygon } from './Polygon.js';


/**
 * 地理オブジェクトの基底クラス
 */
export class Feature {
  /**
   * 地理オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列
   * @param {Property[]} properties - 時間依存プロパティの配列 (現在の単純化モデルでは要素数1を期待)
   * @param {string} layerId - 所属レイヤーID
   */
  constructor(id, vertexIds, properties, layerId) {
    this._id = id;
    this._vertexIds = [...vertexIds];

    if (Array.isArray(properties) && properties.length > 0 && properties[0] instanceof Property) {
        this._properties = [properties[0]]; // 最初の有効なPropertyのみ格納
    } else if (properties instanceof Property) { // 単一Propertyインスタンスが直接渡された場合
        this._properties = [properties];
    } else {
        console.warn(`Feature constructor (id: ${id}): properties array is empty, invalid, or not a Property instance. Initializing with a default Property at year 0. Received:`, properties);
        // フォールバックとして、0年から始まるデフォルトPropertyを生成
        const defaultTimePoint = new TimePoint(0); // このTimePointは Propertyの_timePointと_startTimeに使われる
        this._properties = [new Property(defaultTimePoint, "Default Name", "Default Description", {}, defaultTimePoint, null)];
    }
    this._layerId = layerId;

    Object.freeze(this._vertexIds);
    Object.freeze(this._properties); // properties 配列自体を凍結
    // properties 配列の要素である Property インスタンスは、Propertyクラスのコンストラクタで既に凍結されている
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
   * 特定の時点でのプロパティを取得 (現在の単純化モデルでは、唯一のプロパティが存在期間内かを返す)
   * @param {TimePoint} timePoint - 時点
   * @returns {Property|null} 適用されるプロパティまたはnull
   */
  getPropertyAt(timePoint) {
    if (this._properties.length === 0) {
      // このケースはコンストラクタのフォールバックにより通常発生しないはず
      console.error(`Feature.getPropertyAt (id: ${this._id}): _properties array is empty.`);
      return null;
    }
    const property = this._properties[0]; // 常に最初の（唯一の）Propertyを参照
    return property.isActiveAt(timePoint) ? property : null;
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
   * 注意: このメソッドはサブクラスでオーバーライドされることを強く推奨します。
   *       基底クラスの実装ではサブクラス固有のプロパティが失われる可能性があります。
   * @param {string[]} vertexIds - 新しい頂点IDの配列
   * @returns {Feature} 新しいFeatureオブジェクト（サブクラスの型情報は失われる可能性がある）
   */
  withVertexIds(vertexIds) {
    console.warn(`Feature.withVertexIds (id: ${this._id}) was called on a Feature instance. Subclasses should override this method to return an instance of their own type.`);
    return new Feature(this._id, vertexIds, this._properties, this._layerId);
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成 (現在の単純化モデルでは要素数1の配列を期待)
   * 注意: このメソッドはサブクラスでオーバーライドされることを強く推奨します。
   *       基底クラスの実装ではサブクラス固有のプロパティが失われる可能性があります。
   * @param {Property[]} properties - 新しいプロパティの配列 (要素数1を期待)
   * @returns {Feature} 新しいFeatureオブジェクト（サブクラスの型情報は失われる可能性がある）
   */
  withProperties(properties) {
    console.warn(`Feature.withProperties (id: ${this._id}) was called on a Feature instance. Subclasses should override this method to return an instance of their own type.`);
    let singlePropertyArray;
    if (Array.isArray(properties) && properties.length > 0 && properties[0] instanceof Property) {
        singlePropertyArray = [properties[0]];
    } else if (properties instanceof Property) {
        singlePropertyArray = [properties];
    } else {
        console.warn(`Feature.withProperties (id: ${this._id}): new properties array is empty, invalid, or not a Property instance. Keeping original properties. Received:`, properties);
        singlePropertyArray = this._properties;
    }
    return new Feature(this._id, this._vertexIds, singlePropertyArray, this._layerId);
  }

  /**
   * 既存のプロパティ配列に新しいプロパティを追加した新インスタンスを作成
   * (現在の単純化モデルでは、このメソッドは実質的にwithPropertiesと同じ意味になる)
   * @param {Property} property - 追加するプロパティ (Propertyインスタンスを期待)
   * @returns {Feature} 新しい地理オブジェクト
   */
  addProperty(property) {
    if (!(property instanceof Property)) {
        console.error(`Feature.addProperty (id: ${this._id}): Provided property is not an instance of Property. Keeping original properties. Received:`, property);
        return this; // 不正な場合は変更しない
    }
    // 常に新しい property で既存のものを置き換える (要素数1の配列として渡す)
    return this.withProperties([property]);
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成
   * 注意: このメソッドはサブクラスでオーバーライドされることを強く推奨します。
   *       基底クラスの実装ではサブクラス固有のプロパティが失われる可能性があります。
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Feature} 新しいFeatureオブジェクト（サブクラスの型情報は失われる可能性がある）
   */
  withLayerId(layerId) {
    console.warn(`Feature.withLayerId (id: ${this._id}) was called on a Feature instance. Subclasses should override this method to return an instance of their own type.`);
    return new Feature(this._id, this._vertexIds, this._properties, layerId);
  }
}