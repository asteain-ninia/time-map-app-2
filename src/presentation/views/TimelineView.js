/**
 * タイムライン表示
 */
export class TimelineView {
  /**
   * タイムラインビューを作成
   * @param {HTMLElement} container - 表示コンテナ
   * @param {TimelineViewModel} viewModel - タイムラインビューモデル
   */
  constructor(container, viewModel) {
    this._container = container;
    this._viewModel = viewModel;
    
    // DOM要素
    this._timelineElement = null;
    this._sliderElement = null;
    this._yearInputElement = null;
    this._playButtonElement = null;
    
    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // タイムラインコンテナ作成
    this._timelineElement = document.createElement('div');
    this._timelineElement.className = 'timeline-container';
    this._timelineElement.style.width = '100%';
    this._timelineElement.style.padding = '10px';
    this._timelineElement.style.backgroundColor = '#f5f5f5';
    this._timelineElement.style.borderTop = '1px solid #ddd';
    
    // タイムラインの要素を作成
    this._createTimelineElements();
    
    // タイムラインコンテナに追加
    this._container.appendChild(this._timelineElement);
    
    // ビューモデルとの連携
    this._viewModel.addObserver(this._onViewModelChanged.bind(this));
    
    // 初期状態を反映
    this._updateTimelineDisplay();
  }

  /**
   * タイムライン要素の作成
   * @private
   */
  _createTimelineElements() {
    // コントロール行
    const controlRow = document.createElement('div');
    controlRow.style.display = 'flex';
    controlRow.style.alignItems = 'center';
    controlRow.style.marginBottom = '5px';
    
    // 再生ボタン
    this._playButtonElement = document.createElement('button');
    this._playButtonElement.textContent = '▶';
    this._playButtonElement.style.marginRight = '10px';
    this._playButtonElement.addEventListener('click', this._onPlayButtonClick.bind(this));
    
    // 年入力
    const yearLabel = document.createElement('span');
    yearLabel.textContent = '年: ';
    yearLabel.style.marginRight = '5px';
    
    this._yearInputElement = document.createElement('input');
    this._yearInputElement.type = 'number';
    this._yearInputElement.style.width = '80px';
    this._yearInputElement.style.marginRight = '10px';
    this._yearInputElement.addEventListener('change', this._onYearInputChange.bind(this));
    
    // 前後ボタン
    const prevButton = document.createElement('button');
    prevButton.textContent = '◀';
    prevButton.style.marginRight = '5px';
    prevButton.addEventListener('click', () => this._viewModel.stepBackward());
    
    const nextButton = document.createElement('button');
    nextButton.textContent = '▶';
    nextButton.style.marginRight = '10px';
    nextButton.addEventListener('click', () => this._viewModel.stepForward());
    
    // スピード選択
    const speedLabel = document.createElement('span');
    speedLabel.textContent = '速度: ';
    speedLabel.style.marginRight = '5px';
    
    const speedSelect = document.createElement('select');
    speedSelect.style.marginRight = '10px';
    
    const speeds = [
      { value: 0.1, label: '0.1x' },
      { value: 0.5, label: '0.5x' },
      { value: 1, label: '1x' },
      { value: 2, label: '2x' },
      { value: 5, label: '5x' },
      { value: 10, label: '10x' },
    ];
    
    speeds.forEach(speed => {
      const option = document.createElement('option');
      option.value = speed.value;
      option.textContent = speed.label;
      if (speed.value === 1) option.selected = true;
      speedSelect.appendChild(option);
    });
    
    speedSelect.addEventListener('change', e => {
      if (this._viewModel.isPlaying()) {
        this._viewModel.startPlayback(Number(e.target.value));
      }
    });
    
    // コントロール行に要素を追加
    controlRow.appendChild(this._playButtonElement);
    controlRow.appendChild(yearLabel);
    controlRow.appendChild(this._yearInputElement);
    controlRow.appendChild(prevButton);
    controlRow.appendChild(nextButton);
    controlRow.appendChild(speedLabel);
    controlRow.appendChild(speedSelect);
    
    // スライダー行
    const sliderRow = document.createElement('div');
    sliderRow.style.display = 'flex';
    sliderRow.style.alignItems = 'center';
    
    // 最小年ラベル
    const minYearLabel = document.createElement('span');
    minYearLabel.textContent = this._viewModel.getTimeRange().minYear;
    minYearLabel.style.marginRight = '10px';
    minYearLabel.style.minWidth = '40px';
    minYearLabel.style.textAlign = 'right';
    
    // スライダー
    this._sliderElement = document.createElement('input');
    this._sliderElement.type = 'range';
    this._sliderElement.min = this._viewModel.getTimeRange().minYear;
    this._sliderElement.max = this._viewModel.getTimeRange().maxYear;
    this._sliderElement.step = 1;
    this._sliderElement.value = this._viewModel.getCurrentTime().year;
    this._sliderElement.style.flex = '1';
    this._sliderElement.addEventListener('input', this._onSliderChange.bind(this));
    
    // 最大年ラベル
    const maxYearLabel = document.createElement('span');
    maxYearLabel.textContent = this._viewModel.getTimeRange().maxYear;
    maxYearLabel.style.marginLeft = '10px';
    maxYearLabel.style.minWidth = '40px';
    
    // スライダー行に要素を追加
    sliderRow.appendChild(minYearLabel);
    sliderRow.appendChild(this._sliderElement);
    sliderRow.appendChild(maxYearLabel);
    
    // タイムラインに行を追加
    this._timelineElement.appendChild(controlRow);
    this._timelineElement.appendChild(sliderRow);
  }

  /**
   * ビューモデル変更のハンドラ
   * @param {string} type - 変更タイプ
   * @param {*} data - 変更データ
   * @private
   */
  _onViewModelChanged(type, data) {
    // タイプに応じた処理
    switch (type) {
      case 'currentTime':
        this._updateTimelineDisplay();
        break;
        
      case 'range':
        this._updateTimeRange();
        break;
        
      case 'playback':
        this._updatePlaybackState();
        break;
        
      default:
        break;
    }
  }

  /**
   * タイムライン表示の更新
   * @private
   */
  _updateTimelineDisplay() {
    const currentTime = this._viewModel.getCurrentTime();
    
    // スライダーの更新
    this._sliderElement.value = currentTime.year;
    
    // 年入力の更新
    this._yearInputElement.value = currentTime.year;
  }

  /**
   * 時間範囲の更新
   * @private
   */
  _updateTimeRange() {
    const range = this._viewModel.getTimeRange();
    
    // スライダーの範囲を更新
    this._sliderElement.min = range.minYear;
    this._sliderElement.max = range.maxYear;
    
    // ラベルの更新
    const minYearLabel = this._sliderElement.previousSibling;
    const maxYearLabel = this._sliderElement.nextSibling;
    
    minYearLabel.textContent = range.minYear;
    maxYearLabel.textContent = range.maxYear;
  }

  /**
   * 再生状態の更新
   * @private
   */
  _updatePlaybackState() {
    const isPlaying = this._viewModel.isPlaying();
    
    // 再生ボタンの表示を更新
    this._playButtonElement.textContent = isPlaying ? '⏸' : '▶';
  }

  /**
   * 再生ボタンクリックのハンドラ
   * @private
   */
  _onPlayButtonClick() {
    const isPlaying = this._viewModel.isPlaying();
    
    if (isPlaying) {
      this._viewModel.stopPlayback();
    } else {
      // 速度選択を取得
      const speedSelect = this._playButtonElement.parentNode.querySelector('select');
      const speed = Number(speedSelect.value);
      
      this._viewModel.startPlayback(speed);
    }
  }

  /**
   * スライダー変更のハンドラ
   * @param {Event} event - 入力イベント
   * @private
   */
  _onSliderChange(event) {
    const year = Number(event.target.value);
    this._viewModel.moveToTime(year);
  }

  /**
   * 年入力変更のハンドラ
   * @param {Event} event - 入力イベント
   * @private
   */
  _onYearInputChange(event) {
    const year = Number(event.target.value);
    
    // 範囲内に制限
    const range = this._viewModel.getTimeRange();
    const constrainedYear = Math.max(range.minYear, Math.min(range.maxYear, year));
    
    this._viewModel.moveToTime(constrainedYear);
  }
}