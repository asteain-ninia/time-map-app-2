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
  moveToTime(year, month = null, day = null) {
    this._currentTime = new TimePoint(year, month, day);
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
    
    // すべての特徴のプロパティを検索して現在より未来の最も近い時間点を見つける
    for (const feature of features) {
      for (const prop of feature.properties) {
        if (prop.timePoint.isBefore(current)) {
          continue; // 過去の時間点はスキップ
        }
        
        if (prop.timePoint.equals(current)) {
          continue; // 現在と同じ時間点はスキップ
        }
        
        if (nextTime === null || prop.timePoint.isBefore(nextTime)) {
          nextTime = prop.timePoint;
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
    
    // すべての特徴のプロパティを検索して現在より過去の最も近い時間点を見つける
    for (const feature of features) {
      for (const prop of feature.properties) {
        if (current.isBefore(prop.timePoint)) {
          continue; // 未来の時間点はスキップ
        }
        
        if (prop.timePoint.equals(current)) {
          continue; // 現在と同じ時間点はスキップ
        }
        
        if (prevTime === null || prevTime.isBefore(prop.timePoint)) {
          prevTime = prop.timePoint;
        }
      }
    }
    
    if (prevTime) {
      this._currentTime = prevTime;
    }
    
    return this._currentTime;
  }
}