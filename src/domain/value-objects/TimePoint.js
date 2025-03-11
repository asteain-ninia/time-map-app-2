/**
 * 時間を表す不変オブジェクト
 */
export class TimePoint {
  /**
   * 時間点オブジェクトを作成
   * @param {number} year - 年
   * @param {number} [month] - 月（オプション、1-12）
   * @param {number} [day] - 日（オプション、1-31）
   */
  constructor(year, month = null, day = null) {
    this._year = year;
    this._month = month;
    this._day = day;
    Object.freeze(this);
  }

  /**
   * 年を取得
   * @returns {number} 年
   */
  get year() {
    return this._year;
  }

  /**
   * 月を取得
   * @returns {number|null} 月（または指定されていない場合はnull）
   */
  get month() {
    return this._month;
  }

  /**
   * 日を取得
   * @returns {number|null} 日（または指定されていない場合はnull）
   */
  get day() {
    return this._day;
  }

  /**
   * 年で新しいインスタンスを作成
   * @param {number} year - 新しい年
   * @returns {TimePoint} 新しい時間点オブジェクト
   */
  withYear(year) {
    return new TimePoint(year, this._month, this._day);
  }

  /**
   * 月で新しいインスタンスを作成
   * @param {number} month - 新しい月
   * @returns {TimePoint} 新しい時間点オブジェクト
   */
  withMonth(month) {
    return new TimePoint(this._year, month, this._day);
  }

  /**
   * 日で新しいインスタンスを作成
   * @param {number} day - 新しい日
   * @returns {TimePoint} 新しい時間点オブジェクト
   */
  withDay(day) {
    return new TimePoint(this._year, this._month, day);
  }

  /**
   * この時間点が別の時間点より前にあるかどうかを判定
   * @param {TimePoint} other - 比較する時間点
   * @returns {boolean} この時間点が引数の時間点より前にあればtrue
   */
  isBefore(other) {
    if (this._year !== other.year) return this._year < other.year;
    if (this._month !== other.month) {
      if (this._month === null) return true;
      if (other.month === null) return false;
      return this._month < other.month;
    }
    if (this._day !== other.day) {
      if (this._day === null) return true;
      if (other.day === null) return false;
      return this._day < other.day;
    }
    return false;
  }

  /**
   * この時間点が別の時間点と同じかどうかを判定
   * @param {TimePoint} other - 比較する時間点
   * @returns {boolean} 時間点が等しいか
   */
  equals(other) {
    return other instanceof TimePoint &&
           this._year === other.year &&
           this._month === other.month &&
           this._day === other.day;
  }

  /**
   * 文字列表現
   * @returns {string} 時間点の文字列表現
   */
  toString() {
    let result = `${this._year}年`;
    if (this._month !== null) {
      result += `${this._month}月`;
      if (this._day !== null) {
        result += `${this._day}日`;
      }
    }
    return result;
  }
}