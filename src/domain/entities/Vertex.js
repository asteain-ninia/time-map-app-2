/**
 * 地図上の点を表すエンティティ
 */
export class Vertex {
  /**
   * 頂点オブジェクトを作成
   * @param {string} id - 一意の頂点ID
   * @param {number} x - X座標
   * @param {number} y - Y座標
   */
  constructor(id, x, y) {
    this._id = id;
    this._x = x;
    this._y = y;
    Object.freeze(this);
  }

  /**
   * 頂点IDを取得
   * @returns {string} 頂点ID
   */
  get id() {
    return this._id;
  }

  /**
   * X座標を取得
   * @returns {number} X座標値
   */
  get x() {
    return this._x;
  }

  /**
   * Y座標を取得
   * @returns {number} Y座標値
   */
  get y() {
    return this._y;
  }

  /**
   * 座標を取得
   * @returns {Coordinate} 座標オブジェクト
   */
  getCoordinate() {
    return new Coordinate(this._x, this._y);
  }

  /**
   * 新しい座標で新インスタンスを作成
   * @param {number} x - 新しいX座標
   * @param {number} y - 新しいY座標
   * @returns {Vertex} 新しい頂点オブジェクト
   */
  withCoordinates(x, y) {
    return new Vertex(this._id, x, y);
  }

  /**
   * 2つの頂点間の距離を計算
   * @param {Vertex} other - 他の頂点
   * @returns {number} 2点間の距離
   */
  distanceTo(other) {
    const dx = this._x - other.x;
    const dy = this._y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 等価性チェック
   * @param {Vertex} other - 比較する頂点
   * @returns {boolean} 頂点が等しいか
   */
  equals(other) {
    return other instanceof Vertex &&
           this._id === other.id &&
           this._x === other.x &&
           this._y === other.y;
  }

  /**
   * IDのみの等価性チェック
   * @param {Vertex} other - 比較する頂点
   * @returns {boolean} 頂点のIDが等しいか
   */
  equalsById(other) {
    return other instanceof Vertex && this._id === other.id;
  }

  /**
   * 文字列表現
   * @returns {string} 頂点の文字列表現
   */
  toString() {
    return `Vertex ${this._id}: (${this._x}, ${this._y})`;
  }
}