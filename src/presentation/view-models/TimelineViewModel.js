/**
 * タイムラインビューのデータと状態管理
 */
export class TimelineViewModel {
  /**
   * タイムラインビューモデルを作成
   * @param {NavigateTimeUseCase} navigateTimeUseCase - 時間移動ユースケース
   * @param {EventBus} eventBus - イベントバス
   */
  constructor(navigateTimeUseCase, eventBus) {
    this._navigateTimeUseCase = navigateTimeUseCase;
    this._eventBus = eventBus;
    
    // タイムラインの状態
    this._currentTime = navigateTimeUseCase.getCurrentTime();
    this._minYear = 0;
    this._maxYear = 10000;
    this._yearMarks = [];
    this._isPlaying = false;
    this._playbackSpeed = 1;
    this._playbackInterval = null;
    
    // 観測者の登録
    this._observers = [];
  }

  /**
   * 初期化
   * @param {Object} config - 設定
   */
  initialize(config) {
    this._minYear = config.minYear || 0;
    this._maxYear = config.maxYear || 10000;
    this._yearMarks = config.yearMarks || [];
    
    this._notifyObservers('range');
  }

  /**
   * 現在の時間を取得
   * @returns {TimePoint} 現在の時間点
   */
  getCurrentTime() {
    return this._currentTime;
  }

  /**
   * 時間範囲を取得
   * @returns {Object} 時間範囲 { minYear, maxYear }
   */
  getTimeRange() {
    return {
      minYear: this._minYear,
      maxYear: this._maxYear
    };
  }

  /**
   * 特定の時間に移動
   * @param {number} year - 年
   * @param {number} [month] - 月
   * @param {number} [day] - 日
   */
  moveToTime(year, month, day) {
    // 範囲の制約を適用
    const constrainedYear = Math.max(this._minYear, Math.min(this._maxYear, year));
    
    this._currentTime = this._navigateTimeUseCase.moveToTime(constrainedYear, month, day);
    
    // イベントを発行
    this._eventBus.publish('TimeChanged', { time: this._currentTime });
    
    this._notifyObservers('currentTime');
  }

  /**
   * 前進
   * @param {number} [years=1] - 進める年数
   */
  stepForward(years = 1) {
    const currentYear = this._currentTime.year;
    this.moveToTime(currentYear + years, this._currentTime.month, this._currentTime.day);
  }

  /**
   * 後退
   * @param {number} [years=1] - 戻す年数
   */
  stepBackward(years = 1) {
    const currentYear = this._currentTime.year;
    this.moveToTime(currentYear - years, this._currentTime.month, this._currentTime.day);
  }

  /**
   * 再生開始
   * @param {number} [speed=1] - 再生速度（年/秒）
   */
  startPlayback(speed = 1) {
    if (this._isPlaying) {
      this.stopPlayback();
    }
    
    this._isPlaying = true;
    this._playbackSpeed = speed;
    
    // 100ミリ秒ごとに再生
    const stepSize = this._playbackSpeed / 10;
    this._playbackInterval = setInterval(() => {
      this.stepForward(stepSize);
      
      // 最大年に達したら停止
      if (this._currentTime.year >= this._maxYear) {
        this.stopPlayback();
      }
    }, 100);
    
    this._notifyObservers('playback');
  }

  /**
   * 再生停止
   */
  stopPlayback() {
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
      this._playbackInterval = null;
    }
    
    this._isPlaying = false;
    this._notifyObservers('playback');
  }

  /**
   * 再生中かどうかを取得
   * @returns {boolean} 再生中ならtrue
   */
  isPlaying() {
    return this._isPlaying;
  }

  /**
   * 再生速度を取得
   * @returns {number} 再生速度
   */
  getPlaybackSpeed() {
    return this._playbackSpeed;
  }

  /**
   * 時間範囲を設定
   * @param {number} minYear - 最小年
   * @param {number} maxYear - 最大年
   */
  setTimeRange(minYear, maxYear) {
    this._minYear = minYear;
    this._maxYear = maxYear;
    
    // 現在の時間が範囲外になった場合は調整
    if (this._currentTime.year < minYear) {
      this.moveToTime(minYear);
    } else if (this._currentTime.year > maxYear) {
      this.moveToTime(maxYear);
    }
    
    this._notifyObservers('range');
  }

  /**
   * 年マークを設定
   * @param {Array} marks - 年マークの配列 [{ year, label }, ...]
   */
  setYearMarks(marks) {
    this._yearMarks = marks;
    this._notifyObservers('marks');
  }

  /**
   * 年マークを取得
   * @returns {Array} 年マークの配列
   */
  getYearMarks() {
    return this._yearMarks;
  }

  /**
   * 観測者を登録
   * @param {Function} observer - コールバック関数 (type, data) => void
   */
  addObserver(observer) {
    if (!this._observers.includes(observer)) {
      this._observers.push(observer);
    }
  }

  /**
   * 観測者を削除
   * @param {Function} observer - 削除する観測者
   */
  removeObserver(observer) {
    const index = this._observers.indexOf(observer);
    if (index !== -1) {
      this._observers.splice(index, 1);
    }
  }

  /**
   * 観測者に通知
   * @param {string} type - 変更タイプ
   * @private
   */
  _notifyObservers(type) {
    const data = this._getStateForType(type);
    for (const observer of this._observers) {
      observer(type, data);
    }
  }

  /**
   * タイプに応じた状態データを取得
   * @param {string} type - 変更タイプ
   * @returns {*} 状態データ
   * @private
   */
  _getStateForType(type) {
    switch (type) {
      case 'currentTime':
        return this._currentTime;
      case 'range':
        return { minYear: this._minYear, maxYear: this._maxYear };
      case 'marks':
        return this._yearMarks;
      case 'playback':
        return { isPlaying: this._isPlaying, speed: this._playbackSpeed };
      default:
        return null;
    }
  }
}