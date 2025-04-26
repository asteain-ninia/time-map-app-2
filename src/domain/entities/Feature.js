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
    // 1. timePointにおいて有効なプロパティをフィルタリング
    //    (isActiveAt は startTime/endTime のみで判定するよう修正済み)
    const activeProperties = this._properties.filter(property =>
      property.isActiveAt(timePoint)
    );

    // 2. 有効なプロパティがない場合は null を返す
    if (activeProperties.length === 0) {
      return null;
    }

    // 3. 有効なプロパティの中から、最もtimePointが新しいもの(最も後から定義されたもの)を選択する
    //    指定された timePoint とプロパティ定義の timePoint の前後関係は考慮しない。
    let latestProperty = activeProperties[0]; // 暫定で最初のを設定
    for (let i = 1; i < activeProperties.length; i++) {
        const currentProperty = activeProperties[i];
        // latestProperty の timePoint より currentProperty の timePoint が後なら更新
        if (latestProperty.timePoint.isBefore(currentProperty.timePoint)) {
            latestProperty = currentProperty;
        }
        // timePoint が同じ場合はどうするか？ -> 仕様上は同じ時点に複数の定義はない想定だが、
        // もし存在した場合、現状では配列の後ろにある方が優先される。明確なルールが必要なら追加。
    }

    return latestProperty; // 最も後から定義された有効なプロパティを返す
  }

  /**
   * 特定の時点でこのオブジェクトが存在するかを判定
   * @param {TimePoint} timePoint - チェックする時点
   * @returns {boolean} オブジェクトが存在すればtrue
   */
  existsAt(timePoint) {
    // getPropertyAtがnullでないかで判定
    return this.getPropertyAt(timePoint) !== null;
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成
   * @param {string[]} vertexIds - 新しい頂点IDの配列
   * @returns {Feature} 新しい地理オブジェクト
   */
  withVertexIds(vertexIds) {
    // サブクラスがオーバーライドする必要があるが、基底クラスでも動作するように
    // this.constructor を使うことで、呼び出されたサブクラスのコンストラクタを呼ぶ
    // ただし、サブクラスが追加の引数を必要とする場合は、サブクラスでのオーバーライドが必須
    if (this.constructor === Feature) {
        return new Feature(this._id, vertexIds, this._properties, this._layerId);
    } else {
        // サブクラスのインスタンスから呼ばれた場合、サブクラスのコンストラクタを期待
        // これはサブクラスのオーバーライドに依存するため、警告を出すか、
        // またはサブクラスが必ずオーバーライドすることを前提とする
        // console.warn(`Feature.withVertexIds called on subclass ${this.constructor.name}. Subclass should override this method.`);
        // 簡易的なフォールバック (サブクラスの固有状態は失われる可能性がある)
        // → ポリゴンクラスでオーバーライドされているのでこの警告は基本出ないはず
        return new this.constructor(this._id, vertexIds, this._properties, this._layerId);
    }
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成
   * @param {Property[]} properties - 新しいプロパティの配列
   * @returns {Feature} 新しい地理オブジェクト
   */
  withProperties(properties) {
    // withVertexIdsと同様
    if (this.constructor === Feature) {
        return new Feature(this._id, this._vertexIds, properties, this._layerId);
    } else {
        // console.warn(`Feature.withProperties called on subclass ${this.constructor.name}. Subclass should override this method.`);
        // → ポリゴンクラスでオーバーライドされているのでこの警告は基本出ないはず
        return new this.constructor(this._id, this._vertexIds, properties, this._layerId);
    }
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
    // withVertexIdsと同様
     if (this.constructor === Feature) {
        return new Feature(this._id, this._vertexIds, this._properties, layerId);
    } else {
        // console.warn(`Feature.withLayerId called on subclass ${this.constructor.name}. Subclass should override this method.`);
        // → ポリゴンクラスでオーバーライドされているのでこの警告は基本出ないはず
        return new this.constructor(this._id, this._vertexIds, this._properties, layerId);
    }
  }
}
