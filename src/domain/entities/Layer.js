/**
 * レイヤー情報を表すエンティティ
 */
export class Layer {
  /**
   * レイヤーオブジェクトを作成
   * @param {string} id - 一意のレイヤーID
   * @param {string} name - レイヤー名
   * @param {number} order - レイヤー順序（小さいほど下位）
   * @param {boolean} visible - 表示/非表示状態
   * @param {number} opacity - 不透明度（0.0～1.0）
   * @param {string} [description=""] - 説明
   */
  constructor(id, name, order, visible = true, opacity = 1.0, description = "") {
    this._id = id;
    this._name = name;
    this._order = order;
    this._visible = visible;
    this._opacity = opacity;
    this._description = description;
    Object.freeze(this);
  }

  /**
   * レイヤーIDを取得
   * @returns {string} レイヤーID
   */
  get id() {
    return this._id;
  }

  /**
   * レイヤー名を取得
   * @returns {string} レイヤー名
   */
  get name() {
    return this._name;
  }

  /**
   * レイヤー順序を取得
   * @returns {number} レイヤー順序
   */
  get order() {
    return this._order;
  }

  /**
   * 表示/非表示状態を取得
   * @returns {boolean} 表示中ならtrue
   */
  get visible() {
    return this._visible;
  }

  /**
   * 不透明度を取得
   * @returns {number} 不透明度（0.0～1.0）
   */
  get opacity() {
    return this._opacity;
  }

  /**
   * 説明を取得
   * @returns {string} 説明
   */
  get description() {
    return this._description;
  }

  /**
   * 新しい名前で新インスタンスを作成
   * @param {string} name - 新しい名前
   * @returns {Layer} 新しいレイヤーオブジェクト
   */
  withName(name) {
    return new Layer(this._id, name, this._order, this._visible, this._opacity, this._description);
  }

  /**
   * 新しい表示状態で新インスタンスを作成
   * @param {boolean} visible - 新しい表示状態
   * @returns {Layer} 新しいレイヤーオブジェクト
   */
  withVisibility(visible) {
    return new Layer(this._id, this._name, this._order, visible, this._opacity, this._description);
  }

  /**
   * 新しい不透明度で新インスタンスを作成
   * @param {number} opacity - 新しい不透明度
   * @returns {Layer} 新しいレイヤーオブジェクト
   */
  withOpacity(opacity) {
    return new Layer(this._id, this._name, this._order, this._visible, opacity, this._description);
  }

  /**
   * 新しい説明で新インスタンスを作成
   * @param {string} description - 新しい説明
   * @returns {Layer} 新しいレイヤーオブジェクト
   */
  withDescription(description) {
    return new Layer(this._id, this._name, this._order, this._visible, this._opacity, description);
  }

  /**
   * 等価性チェック
   * @param {Layer} other - 比較するレイヤー
   * @returns {boolean} レイヤーが等しいか
   */
  equals(other) {
    return other instanceof Layer &&
           this._id === other.id &&
           this._name === other.name &&
           this._order === other.order &&
           this._visible === other.visible &&
           this._opacity === other.opacity &&
           this._description === other.description;
  }

  /**
   * IDのみの等価性チェック
   * @param {Layer} other - 比較するレイヤー
   * @returns {boolean} レイヤーのIDが等しいか
   */
  equalsById(other) {
    return other instanceof Layer && this._id === other.id;
  }

  /**
   * 文字列表現
   * @returns {string} レイヤーの文字列表現
   */
  toString() {
    return `Layer ${this._id}: ${this._name} (order: ${this._order}, visible: ${this._visible})`;
  }
}