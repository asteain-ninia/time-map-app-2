/**
 * タイムライン操作処理
 */
export class TimelineController {
  /**
   * タイムラインコントローラを作成
   * @param {TimelineView} timelineView - タイムラインビュー
   * @param {TimelineViewModel} timelineViewModel - タイムラインビューモデル
   */
  constructor(timelineView, timelineViewModel) {
    this._timelineView = timelineView;
    this._timelineViewModel = timelineViewModel;
    
    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // 初期設定
    this._timelineViewModel.initialize({
      minYear: 0,
      maxYear: 10000,
      yearMarks: []
    });
  }

  /**
   * 時間範囲の設定
   * @param {number} minYear - 最小年
   * @param {number} maxYear - 最大年
   */
  setTimeRange(minYear, maxYear) {
    this._timelineViewModel.setTimeRange(minYear, maxYear);
  }

  /**
   * 年マークの設定
   * @param {Array} marks - 年マークの配列
   */
  setYearMarks(marks) {
    this._timelineViewModel.setYearMarks(marks);
  }

  /**
   * 再生開始
   * @param {number} [speed=1] - 再生速度
   */
  startPlayback(speed = 1) {
    this._timelineViewModel.startPlayback(speed);
  }

  /**
   * 再生停止
   */
  stopPlayback() {
    this._timelineViewModel.stopPlayback();
  }

  /**
   * 前進
   * @param {number} [years=1] - 進める年数
   */
  stepForward(years = 1) {
    this._timelineViewModel.stepForward(years);
  }

  /**
   * 後退
   * @param {number} [years=1] - 戻す年数
   */
  stepBackward(years = 1) {
    this._timelineViewModel.stepBackward(years);
  }
}