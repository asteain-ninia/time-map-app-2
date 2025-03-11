import { TimePoint } from '../value-objects/TimePoint';

/**
 * 時間操作と時間依存データの取得を担当するドメインサービス
 */
export class TimeService {
  /**
   * 時間サービスを作成
   * @param {Object} customCalendarConfig - カスタムカレンダー設定（省略可能）
   */
  constructor(customCalendarConfig = null) {
    // デフォルトのカレンダー設定
    this._calendarConfig = customCalendarConfig || {
      daysPerYear: 365.25,   // 1年の日数
      monthsPerYear: 12,     // 1年の月数
      daysPerMonth: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // 各月の日数
    };
  }

  /**
   * カスタムカレンダー設定を取得
   * @returns {Object} カレンダー設定
   */
  get calendarConfig() {
    return { ...this._calendarConfig };
  }

  /**
   * カスタムカレンダー設定を更新
   * @param {Object} newConfig - 新しいカレンダー設定
   */
  updateCalendarConfig(newConfig) {
    this._calendarConfig = { ...newConfig };
  }

  /**
   * 時間点が特定の範囲内にあるかチェック
   * @param {TimePoint} timePoint - チェックする時間点
   * @param {TimePoint} startTime - 開始時間（含む）
   * @param {TimePoint} endTime - 終了時間（含む）
   * @returns {boolean} 範囲内ならtrue
   */
  isWithinRange(timePoint, startTime, endTime) {
    return (!startTime || !startTime.isBefore(timePoint)) && 
           (!endTime || !timePoint.isBefore(endTime));
  }

  /**
   * 2つの時間点の間の日数を計算
   * @param {TimePoint} timePoint1 - 時間点1
   * @param {TimePoint} timePoint2 - 時間点2
   * @returns {number} 日数差（概算）
   */
  calculateDaysBetween(timePoint1, timePoint2) {
    // 基本的な年の差
    let yearDiff = timePoint2.year - timePoint1.year;
    
    // 月と日の差を計算
    let days = yearDiff * this._calendarConfig.daysPerYear;
    
    // 月が指定されている場合、月の差を計算
    if (timePoint1.month !== null && timePoint2.month !== null) {
      let monthDays1 = 0;
      let monthDays2 = 0;
      
      // 時間点1の月までの日数
      for (let i = 0; i < timePoint1.month - 1; i++) {
        monthDays1 += this._getMonthDays(i, timePoint1.year);
      }
      
      // 時間点2の月までの日数
      for (let i = 0; i < timePoint2.month - 1; i++) {
        monthDays2 += this._getMonthDays(i, timePoint2.year);
      }
      
      // 月による日数の調整
      days = yearDiff * this._calendarConfig.daysPerYear - monthDays1 + monthDays2;
      
      // 日が指定されている場合、日の差を計算
      if (timePoint1.day !== null && timePoint2.day !== null) {
        days += (timePoint2.day - timePoint1.day);
      }
    }
    
    return days;
  }

  /**
   * 指定された月の日数を取得
   * @param {number} monthIndex - 0基準の月インデックス
   * @param {number} year - 年
   * @returns {number} 指定された月の日数
   * @private
   */
  _getMonthDays(monthIndex, year) {
    if (this._calendarConfig.daysPerMonth) {
      const idx = monthIndex % this._calendarConfig.daysPerMonth.length;
      let days = this._calendarConfig.daysPerMonth[idx];
      
      // うるう年の2月（インデックス1）の処理
      if (idx === 1 && this._isLeapYear(year)) {
        days += 1;
      }
      
      return days;
    }
    
    // daysPerMonthが定義されていない場合の均等な割り当て
    return this._calendarConfig.daysPerYear / this._calendarConfig.monthsPerYear;
  }

  /**
   * うるう年かどうかを判定
   * @param {number} year - 判定する年
   * @returns {boolean} うるう年ならtrue
   * @private
   */
  _isLeapYear(year) {
    // 通常のグレゴリオ暦のうるう年ロジック
    // カスタムカレンダーの場合は、別のロジックを実装する必要がある
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  /**
   * 時間点を特定の日数進める
   * @param {TimePoint} timePoint - 元の時間点
   * @param {number} days - 進める日数
   * @returns {TimePoint} 新しい時間点
   */
  advanceDays(timePoint, days) {
    // 基本実装 - 実際のアプリケーションではより複雑なロジックが必要
    // ここでは簡易的に実装
    const totalDays = days;
    let newYear = timePoint.year;
    let newMonth = timePoint.month;
    let newDay = timePoint.day;
    
    // 日単位で計算
    if (newDay !== null && newMonth !== null) {
      newDay += totalDays;
      
      // 月をまたぐ場合の処理
      while (newDay > this._getMonthDays(newMonth - 1, newYear)) {
        newDay -= this._getMonthDays(newMonth - 1, newYear);
        newMonth++;
        
        // 年をまたぐ場合の処理
        if (newMonth > this._calendarConfig.monthsPerYear) {
          newMonth = 1;
          newYear++;
        }
      }
    } else {
      // 日付が指定されていない場合は、年だけを進める
      newYear += Math.floor(totalDays / this._calendarConfig.daysPerYear);
    }
    
    return new TimePoint(newYear, newMonth, newDay);
  }
}