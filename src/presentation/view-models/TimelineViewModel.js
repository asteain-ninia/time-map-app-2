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

    this._currentTime = navigateTimeUseCase.getCurrentTime();
    this._minYear = 0;
    this._maxYear = 10000;
    this._yearMarks = [];
    this._isPlaying = false;
    this._playbackSpeed = 1;
    this._playbackInterval = null;
    this._playbackAccumulator = 0;
    this._stepUnit = 'year';

    this._observers = [];

    this._eventBus.subscribe('ProjectSettingsLoaded', this._onProjectSettingsLoaded.bind(this));
    this._eventBus.subscribe('projectSettingsChanged', this._onProjectSettingsLoaded.bind(this));
    this._eventBus.subscribe('ProjectSettingsUpdated', this._onProjectSettingsLoaded.bind(this));
  }

  /**
   * 初期化 (プロジェクト設定に依存しない部分)
   * @param {Object} [config={}] - 設定 (yearMarksなど)
   */
  initialize(config = {}) {
    this._yearMarks = config.yearMarks || [];
  }

  /**
   * プロジェクト設定読み込み/変更イベントのハンドラ
   * @param {Object} eventData - イベントデータ { settings: { sliderMin, sliderMax, ... } }
   * @private
   */
  _onProjectSettingsLoaded(eventData) {
    if (eventData && eventData.settings) {
      const { sliderMin, sliderMax } = eventData.settings;
      if (sliderMin !== undefined && sliderMax !== undefined) {
        this.setTimeRange(sliderMin, sliderMax);
      }
    }
  }

  getCalendarConfig() {
    return this._navigateTimeUseCase.getCalendarConfig();
  }

  getDaysInMonth(year, month) {
    return this._navigateTimeUseCase.getDaysInMonth(year, month);
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

  getStepUnit() {
    return this._stepUnit;
  }

  setStepUnit(unit) {
    if (!['year', 'month', 'day'].includes(unit)) {
      return;
    }
    if (this._stepUnit !== unit) {
      this._stepUnit = unit;
      this._notifyObservers('stepUnit');
    }
  }

  /**
   * 特定の時間に移動
   * @param {number} year - 年
   * @param {number} [month] - 月
   * @param {number} [day] - 日
   */
  moveToTime(year, month, day) {
    const targetMonth = month === undefined ? this._currentTime.month : month;
    const targetDay = day === undefined ? this._currentTime.day : day;
    const components = this._normalizeComponentsForMove(year, targetMonth, targetDay);
    const updated = this._navigateTimeUseCase.moveToTime(year, components.month, components.day);
    this._applyTimeChange(updated);
  }

  setMonth(month) {
    if (!Number.isInteger(month)) {
      return;
    }
    const year = this._currentTime.year;
    let nextDay = this._currentTime.day;
    if (nextDay !== null) {
      const maxDay = this.getDaysInMonth(year, month);
      if (nextDay > maxDay) {
        nextDay = maxDay;
      }
    }
    const updated = this._navigateTimeUseCase.moveToTime(year, month, nextDay);
    this._applyTimeChange(updated);
  }

  clearMonth() {
    const year = this._currentTime.year;
    const updated = this._navigateTimeUseCase.moveToTime(year, null, null);
    this._applyTimeChange(updated);
  }

  setDay(day) {
    if (!Number.isInteger(day)) {
      return;
    }
    if (this._currentTime.month === null) {
      return;
    }
    const year = this._currentTime.year;
    const month = this._currentTime.month;
    const maxDay = this.getDaysInMonth(year, month);
    const constrainedDay = Math.max(1, Math.min(maxDay, day));
    const updated = this._navigateTimeUseCase.moveToTime(year, month, constrainedDay);
    this._applyTimeChange(updated);
  }

  clearDay() {
    if (this._currentTime.month === null) {
      return;
    }
    const year = this._currentTime.year;
    const month = this._currentTime.month;
    const updated = this._navigateTimeUseCase.moveToTime(year, month, null);
    this._applyTimeChange(updated);
  }

  /**
   * 前進
   */
  stepForward(steps = 1) {
    this._repeatSteps(steps, 1);
  }

  /**
   * 後退
   */
  stepBackward(steps = 1) {
    this._repeatSteps(steps, -1);
  }

  _repeatSteps(steps, direction) {
    const iterations = Math.max(1, Math.abs(Math.trunc(steps)));
    for (let i = 0; i < iterations; i++) {
      this._stepByUnit(direction);
      if (direction > 0 && this._currentTime.year >= this._maxYear) {
        break;
      }
      if (direction < 0 && this._currentTime.year <= this._minYear) {
        break;
      }
    }
  }

  _stepByUnit(direction) {
    switch (this._stepUnit) {
      case 'year': {
        const newYear = this._currentTime.year + direction;
        this.moveToTime(newYear, this._currentTime.month, this._currentTime.day);
        break;
      }
      case 'month': {
        this._ensureDateComponents();
        const updated = this._navigateTimeUseCase.advanceMonths(direction);
        this._applyTimeChange(updated);
        break;
      }
      case 'day': {
        this._ensureDateComponents();
        const updated = this._navigateTimeUseCase.advanceTime(direction);
        this._applyTimeChange(updated);
        break;
      }
      default:
        break;
    }
  }

  /**
   * 再生開始
   * @param {number} [speed=1] - 再生速度（年/秒）
   */
  startPlayback(speed = 1) {
    if (this._isPlaying) {
      this.stopPlayback();
    }

    this._ensureDateComponents();

    this._isPlaying = true;
    this._playbackSpeed = speed;
    this._playbackAccumulator = 0;

    const intervalMs = 100;
    this._playbackInterval = setInterval(() => {
      const shouldContinue = this._performPlaybackTick(intervalMs);
      if (!shouldContinue) {
        this.stopPlayback();
      }
    }, intervalMs);

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
    this._playbackAccumulator = 0;
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

    if (this._currentTime.year < minYear) {
      this.moveToTime(minYear, this._currentTime.month, this._currentTime.day);
    } else if (this._currentTime.year > maxYear) {
      this.moveToTime(maxYear, this._currentTime.month, this._currentTime.day);
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

  _performPlaybackTick(intervalMs) {
    const calendar = this.getCalendarConfig();
    const ticksPerSecond = 1000 / intervalMs;
    const daysPerTick = (this._playbackSpeed * calendar.daysPerYear) / ticksPerSecond;
    this._playbackAccumulator += daysPerTick;

    const wholeDays = Math.trunc(this._playbackAccumulator);
    if (wholeDays === 0) {
      return true;
    }

    this._playbackAccumulator -= wholeDays;
    const updated = this._navigateTimeUseCase.advanceTime(wholeDays);
    this._applyTimeChange(updated);

    if (this._playbackSpeed > 0 && this._currentTime.year >= this._maxYear) {
      return false;
    }
    if (this._playbackSpeed < 0 && this._currentTime.year <= this._minYear) {
      return false;
    }
    return true;
  }


  _normalizeComponentsForMove(year, month, day) {
    if (month === undefined) {
      return { month: undefined, day };
    }
    if (month === null) {
      return { month: null, day: null };
    }

    if (day === undefined || day === null) {
      return { month, day };
    }

    const normalizedDay = Math.max(1, Math.min(this.getDaysInMonth(year, month), day));
    return { month, day: normalizedDay };
  }

  _ensureDateComponents() {
    if (this._currentTime.month === null || this._currentTime.day === null) {
      const resolvedMonth = this._currentTime.month === null ? 1 : this._currentTime.month;
      const resolvedDay = this._currentTime.day === null ? 1 : this._currentTime.day;
      const updated = this._navigateTimeUseCase.moveToTime(this._currentTime.year, resolvedMonth, resolvedDay);
      this._applyTimeChange(updated);
    }
  }

  _applyTimeChange(candidateTime) {
    let finalTime = candidateTime;
    if (candidateTime.year < this._minYear) {
      const components = this._normalizeComponentsForMove(this._minYear, candidateTime.month, candidateTime.day);
      finalTime = this._navigateTimeUseCase.moveToTime(this._minYear, components.month, components.day);
    } else if (candidateTime.year > this._maxYear) {
      const components = this._normalizeComponentsForMove(this._maxYear, candidateTime.month, candidateTime.day);
      finalTime = this._navigateTimeUseCase.moveToTime(this._maxYear, components.month, components.day);
    }

    this._currentTime = finalTime;
    this._eventBus.publish('TimeChanged', { time: this._currentTime });
    this._notifyObservers('currentTime');
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
      case 'stepUnit':
        return this._stepUnit;
      default:
        return null;
    }
  }
}
