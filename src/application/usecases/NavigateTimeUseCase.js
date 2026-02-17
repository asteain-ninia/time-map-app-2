import { TimePoint } from '../../domain/value-objects/TimePoint';

/**
 * 時間移動を処理するユースケース
 */
export class NavigateTimeUseCase {
  /**
   * ユースケースを作成
   * @param {TimeService} timeService - 時間サービス
   */
  constructor(timeService) {
    this._timeService = timeService;
    this._currentTime = new TimePoint(0); // デフォルト値
  }

  /**
   * 現在の時間点を取得
   * @returns {TimePoint} 現在の時間点
   */
  getCurrentTime() {
    return this._currentTime;
  }

  /**
   * 特定の時間点に移動
   * @param {number} year - 年
   * @param {number} [month] - 月（オプション）
   * @param {number} [day] - 日（オプション）
   * @returns {TimePoint} 設定された時間点
   */
  moveToTime(year, month, day) {
    let normalizedMonth = month;
    let normalizedDay = day;

    const currentMonth = this._currentTime.month;
    const currentDay = this._currentTime.day;

    if (normalizedMonth === undefined) {
      normalizedMonth = currentMonth;
    }

    if (normalizedMonth === null) {
      normalizedDay = null;
    } else {
      if (normalizedDay === undefined) {
        normalizedDay = currentDay;
      }

      if (normalizedDay !== null && normalizedMonth !== null) {
        const coercedDay = Math.trunc(normalizedDay);
        const maxDay = this._timeService.getDaysInMonth(year, normalizedMonth);
        normalizedDay = Math.max(1, Math.min(maxDay, coercedDay));
      }
    }

    this._currentTime = this.createTimePoint(year, normalizedMonth, normalizedDay);
    return this._currentTime;
  }

  /**
   * 指定した日数だけ前進
   * @param {number} days - 進める日数
   * @returns {TimePoint} 進んだ後の時間点
   */
  advanceTime(days) {
    this._currentTime = this._timeService.advanceDays(this._currentTime, days);
    return this._currentTime;
  }

  /**
   * 指定した月数だけ前進
   * @param {number} months - 進める月数
   * @returns {TimePoint} 進んだ後の時間点
   */
  advanceMonths(months) {
    this._currentTime = this._timeService.advanceMonths(this._currentTime, months);
    return this._currentTime;
  }

  createTimePoint(year, month = null, day = null) {
    const normalizedMonth = month === undefined ? null : month;
    const normalizedDay = day === undefined ? null : day;
    return this._timeService.createTimePoint(year, normalizedMonth, normalizedDay);
  }

  /**
   * 指定した日数だけ後退
   * @param {number} days - 戻る日数
   * @returns {TimePoint} 戻った後の時間点
   */
  retreatTime(days) {
    return this.advanceTime(-days);
  }

  /**
   * 時間間隔を考慮して次の「意味のある」時点に進む
   * @param {Feature[]} features - 地理オブジェクトの配列
   * @returns {TimePoint} 次の意味のある時間点
   */
  moveToNextSignificantTime(features) {
    const current = this._currentTime;
    let nextTime = null;

    // すべての履歴アンカーを検索して現在より未来の最も近い時間点を見つける
    for (const feature of features) {
      const timelineEntries = this._getTimelineEntries(feature);
      for (const entry of timelineEntries) {
        const startTime = this._getEntryStartTime(entry);
        if (!(startTime instanceof TimePoint)) {
          continue;
        }
        if (startTime.isBefore(current)) {
          continue; // 過去の時間点はスキップ
        }

        if (startTime.equals(current)) {
          continue; // 現在と同じ時間点はスキップ
        }

        if (nextTime === null || startTime.isBefore(nextTime)) {
          nextTime = startTime;
        }
      }
    }

    if (nextTime) {
      this._currentTime = nextTime;
    }

    return this._currentTime;
  }

  /**
   * 時間間隔を考慮して前の「意味のある」時点に戻る
   * @param {Feature[]} features - 地理オブジェクトの配列
   * @returns {TimePoint} 前の意味のある時間点
   */
  moveToPreviousSignificantTime(features) {
    const current = this._currentTime;
    let prevTime = null;

    // すべての履歴アンカーを検索して現在より過去の最も近い時間点を見つける
    for (const feature of features) {
      const timelineEntries = this._getTimelineEntries(feature);
      for (const entry of timelineEntries) {
        const startTime = this._getEntryStartTime(entry);
        if (!(startTime instanceof TimePoint)) {
          continue;
        }
        if (current.isBefore(startTime)) {
          continue; // 未来の時間点はスキップ
        }

        if (startTime.equals(current)) {
          continue; // 現在と同じ時間点はスキップ
        }

        if (prevTime === null || prevTime.isBefore(startTime)) {
          prevTime = startTime;
        }
      }
    }

    if (prevTime) {
      this._currentTime = prevTime;
    }

    return this._currentTime;
  }

  getCalendarConfig() {
    return this._timeService.calendarConfig;
  }

  getDaysInMonth(year, month) {
    return this._timeService.getDaysInMonth(year, month);
  }

  _getTimelineEntries(feature) {
    if (!feature || typeof feature !== 'object') {
      return [];
    }
    if (Array.isArray(feature.anchors) && feature.anchors.length > 0) {
      return feature.anchors;
    }
    if (Array.isArray(feature.properties)) {
      return feature.properties;
    }
    return [];
  }

  _getEntryStartTime(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    return entry.startTime || entry.timePoint || null;
  }
}
