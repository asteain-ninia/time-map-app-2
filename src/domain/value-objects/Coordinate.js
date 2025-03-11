/**
 * 座標を表す不変オブジェクト
 */
export class Coordinate {
  /**
   * 座標オブジェクトを作成
   * @param {number} x - X座標
   * @param {number} y - Y座標
   */
  constructor(x, y) {
    this._x = x;
    this._y = y;
    // 不変オブジェクトとして凍結
    Object.freeze(this);
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
   * 新しい座標で新インスタンスを作成
   * @param {number} x - 新しいX座標
   * @param {number} y - 新しいY座標
   * @returns {Coordinate} 新しい座標オブジェクト
   */
  withCoordinates(x, y) {
    return new Coordinate(x, y);
  }

  /**
   * 2つの座標間の距離を計算
   * @param {Coordinate} other - 他の座標
   * @returns {number} 2点間の距離
   */
  distanceTo(other) {
    const dx = this._x - other.x;
    const dy = this._y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 等価性チェック
   * @param {Coordinate} other - 比較する座標
   * @returns {boolean} 座標が等しいか
   */
  equals(other) {
    return other instanceof Coordinate &&
           this._x === other.x &&
           this._y === other.y;
  }

  /**
   * 文字列表現
   * @returns {string} 座標の文字列表現
   */
  toString() {
    return `(${this._x}, ${this._y})`;
  }
}