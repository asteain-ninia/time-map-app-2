import { TimePoint } from '../value-objects/TimePoint';

const DEFAULT_CALENDAR_CONFIG = {
  daysPerYear: 365.25,
  monthsPerYear: 12,
  daysPerMonth: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
};

/**
 * 時間操作と時間依存データの取得を担当するドメインサービス
 */
export class TimeService {
  /**
   * 時間サービスを作成
   * @param {Object} customCalendarConfig - カスタムカレンダー設定（省略可能）
   */
  constructor(customCalendarConfig = null) {
    this._calendarConfig = this._normalizeCalendarConfig(customCalendarConfig, DEFAULT_CALENDAR_CONFIG);
  }

  /**
   * カスタムカレンダー設定を取得
   * @returns {Object} カレンダー設定
   */
  get calendarConfig() {
    return {
      ...this._calendarConfig,
      daysPerMonth: [...this._calendarConfig.daysPerMonth]
    };
  }

  /**
   * カスタムカレンダー設定を更新
   * @param {Object} newConfig - 新しいカレンダー設定
   */
  updateCalendarConfig(newConfig) {
    this._calendarConfig = this._normalizeCalendarConfig(newConfig, this._calendarConfig);
  }

  createTimePoint(year, month = null, day = null) {
    if (!Number.isInteger(year)) {
      throw new Error('Year must be an integer');
    }

    let normalizedMonth = month;
    let normalizedDay = day;

    if (normalizedMonth !== null) {
      if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > this._calendarConfig.monthsPerYear) {
        throw new Error('Month is out of range');
      }

      if (normalizedDay !== null) {
        if (!Number.isInteger(normalizedDay) || normalizedDay < 1) {
          throw new Error('Day must be a positive integer');
        }

        const maxDay = this._getMonthDays(normalizedMonth - 1, year);
        if (normalizedDay > maxDay) {
          throw new Error('Day exceeds the number of days in the month');
        }
      }
    } else if (normalizedDay !== null) {
      throw new Error('Day cannot be specified when month is unspecified');
    }

    return new TimePoint(year, normalizedMonth, normalizedDay);
  }

  /**
   * カレンダー設定を正規化
   * @param {Object|null|undefined} overrides - 新しい設定
   * @param {Object} baseConfig - 既存設定
   * @returns {{daysPerYear: number, monthsPerYear: number, daysPerMonth: number[]}}
   * @private
   */
  _normalizeCalendarConfig(overrides, baseConfig = DEFAULT_CALENDAR_CONFIG) {
    const candidate = (overrides && typeof overrides === 'object') ? overrides : null;

    const baseDaysPerYear = Number.isFinite(baseConfig?.daysPerYear) && baseConfig.daysPerYear > 0
      ? baseConfig.daysPerYear
      : DEFAULT_CALENDAR_CONFIG.daysPerYear;
    const baseMonthsPerYear = Number.isInteger(baseConfig?.monthsPerYear) && baseConfig.monthsPerYear >= 1
      ? baseConfig.monthsPerYear
      : DEFAULT_CALENDAR_CONFIG.monthsPerYear;

    let daysPerYear = baseDaysPerYear;
    let monthsPerYear = baseMonthsPerYear;
    let daysPerMonth = this._normalizeDaysPerMonth(baseConfig?.daysPerMonth) ?? [...DEFAULT_CALENDAR_CONFIG.daysPerMonth];

    if (candidate) {
      if ('daysPerYear' in candidate) {
        const numericDaysPerYear = Number(candidate.daysPerYear);
        if (Number.isFinite(numericDaysPerYear) && numericDaysPerYear > 0) {
          daysPerYear = numericDaysPerYear;
        }
      }

      if ('monthsPerYear' in candidate) {
        const numericMonths = Number(candidate.monthsPerYear);
        if (Number.isInteger(numericMonths) && numericMonths >= 1) {
          monthsPerYear = numericMonths;
        }
      }

      if ('daysPerMonth' in candidate) {
        const normalizedOverride = this._normalizeDaysPerMonth(candidate.daysPerMonth);
        if (normalizedOverride) {
          daysPerMonth = normalizedOverride;
        }
      }
    }

    if (!Number.isFinite(daysPerYear) || daysPerYear <= 0) {
      daysPerYear = DEFAULT_CALENDAR_CONFIG.daysPerYear;
    }

    if (!Number.isInteger(monthsPerYear) || monthsPerYear < 1) {
      monthsPerYear = DEFAULT_CALENDAR_CONFIG.monthsPerYear;
    }

    if (!Array.isArray(daysPerMonth) || daysPerMonth.length === 0) {
      daysPerMonth = [...DEFAULT_CALENDAR_CONFIG.daysPerMonth];
    }

    const normalizedDaysPerMonth = [];
    for (let i = 0; i < monthsPerYear; i++) {
      normalizedDaysPerMonth.push(daysPerMonth[i % daysPerMonth.length]);
    }

    return {
      daysPerYear,
      monthsPerYear,
      daysPerMonth: normalizedDaysPerMonth
    };
  }

  /**
   * 月ごとの日数配列を検証・正規化
   * @param {*} source - 入力の候補
   * @returns {number[]|null}
   * @private
   */
  _normalizeDaysPerMonth(source) {
    if (!Array.isArray(source) || source.length === 0) {
      return null;
    }

    const normalized = [];
    for (const value of source) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
      }
      normalized.push(numeric);
    }

    return normalized;
  }

  getDaysInMonth(year, month) {
    if (!Number.isInteger(month) || month < 1 || month > this._calendarConfig.monthsPerYear) {
      throw new Error('Month is out of range');
    }
    return this._getMonthDays(month - 1, year);
  }


  /**
   * 時間点が特定の範囲内にあるかチェック
   * @param {TimePoint} timePoint - チェックする時間点
   * @param {TimePoint} startTime - 開始時間（含む）
   * @param {TimePoint} endTime - 終了時間（含む）
   * @returns {boolean} 範囲内ならtrue
   */
  isWithinRange(timePoint, startTime, endTime) {
    const meetsStart = !startTime || !timePoint.isBefore(startTime);
    const meetsEnd = !endTime || timePoint.isBefore(endTime);
    return meetsStart && meetsEnd;
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
  advanceMonths(timePoint, months) {
    if (!Number.isInteger(months)) {
      throw new Error('Months increment must be an integer');
    }

    if (timePoint.month === null) {
      throw new Error('Cannot advance months when month is unspecified');
    }

    const monthsPerYear = this._calendarConfig.monthsPerYear;
    const startIndex = timePoint.year * monthsPerYear + (timePoint.month - 1);
    const totalMonths = startIndex + months;

    const newYear = Math.floor(totalMonths / monthsPerYear);
    let monthIndex = totalMonths - newYear * monthsPerYear;
    if (monthIndex < 0) {
      monthIndex += monthsPerYear;
    }

    const newMonth = monthIndex + 1;
    let newDay = timePoint.day;
    if (newDay !== null) {
      const maxDay = this._getMonthDays(newMonth - 1, newYear);
      if (newDay > maxDay) {
        newDay = maxDay;
      }
    }

    return this.createTimePoint(newYear, newMonth, newDay);
  }

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

      // 月をまたぐ場合の処理（負方向の借り入れを含む）
      while (newDay <= 0) {
        newMonth -= 1;
        if (newMonth < 1) {
          newMonth = this._calendarConfig.monthsPerYear;
          newYear -= 1;
        }
        newDay += this._getMonthDays(newMonth - 1, newYear);
      }

      while (true) {
        const daysInCurrentMonth = this._getMonthDays(newMonth - 1, newYear);
        if (newDay <= daysInCurrentMonth) {
          break;
        }

        newDay -= daysInCurrentMonth;
        newMonth += 1;

        // 年をまたぐ場合の処理
        if (newMonth > this._calendarConfig.monthsPerYear) {
          newMonth = 1;
          newYear += 1;
        }
      }
    } else {
      // 日付が指定されていない場合は、年だけを進める
      const daysPerYear = this._calendarConfig.daysPerYear;
      if (!Number.isFinite(daysPerYear) || daysPerYear === 0) {
        return this.createTimePoint(newYear, null, null);
      }

      if (totalDays === 0) {
        return this.createTimePoint(newYear, null, null);
      }

      const absDaysPerYear = Math.abs(daysPerYear);
      const tolerance = 1 / absDaysPerYear; // compensate fractional year lengths (e.g., 365.25)
      const rawYears = totalDays / daysPerYear;
      let yearDelta;

      if (totalDays > 0) {
        yearDelta = Math.floor(rawYears + tolerance);
      } else {
        const absTotalDays = Math.abs(totalDays);
        const guardThreshold = Math.max(0, Math.floor(absDaysPerYear) - 1);
        if (absTotalDays <= guardThreshold) {
          return this.createTimePoint(newYear, null, null);
        }
        if (absTotalDays < absDaysPerYear) {
          yearDelta = -1;
        } else {
          // ceil handles negative fractional years without over-borrowing (e.g. -1.09 -> -1)
          yearDelta = Math.ceil(rawYears - tolerance);
        }
      }

      if (yearDelta === 0) {
        return this.createTimePoint(newYear, null, null);
      }

      newYear += yearDelta;
    }

    return this.createTimePoint(newYear, newMonth, newDay);
  }
}

