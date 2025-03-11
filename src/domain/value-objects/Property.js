/**
 * 時間依存の属性を表す不変オブジェクト
 */
export class Property {
  /**
   * プロパティオブジェクトを作成
   * @param {TimePoint} timePoint - 適用開始時点
   * @param {string} name - 名称
   * @param {string} description - 説明
   * @param {Object} [attributes={}] - 追加属性
   * @param {TimePoint} [startTime=null] - 存在開始時点（省略可）
   * @param {TimePoint} [endTime=null] - 存在終了時点（省略可）
   */
  constructor(timePoint, name, description, attributes = {}, startTime = null, endTime = null) {
    this._timePoint = timePoint;
    this._name = name;
    this._description = description;
    this._attributes = { ...attributes };
    this._startTime = startTime;
    this._endTime = endTime;
    Object.freeze(this._attributes);
    Object.freeze(this);
  }

  /**
   * 適用開始時点を取得
   * @returns {TimePoint} 適用開始時点
   */
  get timePoint() {
    return this._timePoint;
  }

  /**
   * 名称を取得
   * @returns {string} 名称
   */
  get name() {
    return this._name;
  }

  /**
   * 説明を取得
   * @returns {string} 説明
   */
  get description() {
    return this._description;
  }

  /**
   * 存在開始時点を取得
   * @returns {TimePoint|null} 存在開始時点（または指定されていない場合はnull）
   */
  get startTime() {
    return this._startTime;
  }

  /**
   * 存在終了時点を取得
   * @returns {TimePoint|null} 存在終了時点（または指定されていない場合はnull）
   */
  get endTime() {
    return this._endTime;
  }

  /**
   * 特定の属性を取得
   * @param {string} key - 属性キー
   * @param {*} [defaultValue=null] - 属性が存在しない場合のデフォルト値
   * @returns {*} 属性値または指定されたデフォルト値
   */
  getAttribute(key, defaultValue = null) {
    return key in this._attributes ? this._attributes[key] : defaultValue;
  }

  /**
   * すべての属性をコピーして取得
   * @returns {Object} 属性オブジェクトのコピー
   */
  getAttributes() {
    return { ...this._attributes };
  }

  /**
   * 新しい名前で新しいインスタンスを作成
   * @param {string} name - 新しい名前
   * @returns {Property} 新しいプロパティオブジェクト
   */
  withName(name) {
    return new Property(this._timePoint, name, this._description, this._attributes, this._startTime, this._endTime);
  }

  /**
   * 新しい説明で新しいインスタンスを作成
   * @param {string} description - 新しい説明
   * @returns {Property} 新しいプロパティオブジェクト
   */
  withDescription(description) {
    return new Property(this._timePoint, this._name, description, this._attributes, this._startTime, this._endTime);
  }

  /**
   * 特定の時点でこのプロパティが有効かどうかを判定
   * @param {TimePoint} timePoint - チェックする時点
   * @returns {boolean} プロパティが有効ならtrue
   */
  isActiveAt(timePoint) {
    // 時間点が適用開始時点より前なら非アクティブ
    if (timePoint.isBefore(this._timePoint)) return false;
    
    // 開始時点が設定されていて、それよりも前なら非アクティブ
    if (this._startTime && timePoint.isBefore(this._startTime)) return false;
    
    // 終了時点が設定されていて、それよりも後なら非アクティブ
    if (this._endTime && this._endTime.isBefore(timePoint)) return false;
    
    return true;
  }

  /**
   * 等価性チェック
   * @param {Property} other - 比較するプロパティ
   * @returns {boolean} プロパティが等しいか
   */
  equals(other) {
    if (!(other instanceof Property)) return false;
    if (!this._timePoint.equals(other.timePoint)) return false;
    if (this._name !== other.name) return false;
    if (this._description !== other.description) return false;
    
    // 開始時間と終了時間の比較
    if ((this._startTime === null) !== (other.startTime === null)) return false;
    if (this._startTime && !this._startTime.equals(other.startTime)) return false;
    
    if ((this._endTime === null) !== (other.endTime === null)) return false;
    if (this._endTime && !this._endTime.equals(other.endTime)) return false;
    
    // 属性の比較
    const thisKeys = Object.keys(this._attributes);
    const otherKeys = Object.keys(other.getAttributes());
    if (thisKeys.length !== otherKeys.length) return false;
    
    for (const key of thisKeys) {
      if (this._attributes[key] !== other.getAttribute(key)) return false;
    }
    
    return true;
  }
}