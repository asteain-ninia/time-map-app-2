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

    this._timelineElement = null;
    this._sliderElement = null;
    this._minYearLabel = null;
    this._maxYearLabel = null;
    this._yearInputElement = null;
    this._monthInputElement = null;
    this._monthUnsetCheckbox = null;
    this._dayInputElement = null;
    this._dayUnsetCheckbox = null;
    this._stepUnitSelect = null;
    this._speedSelectElement = null;
    this._playButtonElement = null;

    this._suppressInputHandlers = false;

    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    this._timelineElement = document.createElement('div');
    this._timelineElement.className = 'timeline-container';
    this._timelineElement.style.width = '100%';
    this._timelineElement.style.padding = '10px';
    this._timelineElement.style.backgroundColor = '#f5f5f5';
    this._timelineElement.style.borderTop = '1px solid #ddd';

    this._createTimelineElements();

    this._container.appendChild(this._timelineElement);

    this._viewModel.addObserver(this._onViewModelChanged.bind(this));

    this._updateTimelineDisplay();
    this._updateTimeRange();
    this._updatePlaybackState();
    this._syncStepUnit();
  }

  /**
   * タイムライン要素の作成
   * @private
   */
  _createTimelineElements() {
    const controlRow = document.createElement('div');
    controlRow.style.display = 'flex';
    controlRow.style.alignItems = 'center';
    controlRow.style.flexWrap = 'wrap';
    controlRow.style.gap = '8px';
    controlRow.style.marginBottom = '5px';

    // 再生ボタン
    this._playButtonElement = document.createElement('button');
    this._playButtonElement.textContent = '▶';
    this._playButtonElement.addEventListener('click', this._onPlayButtonClick.bind(this));

    // 年入力
    const yearGroup = document.createElement('div');
    yearGroup.style.display = 'flex';
    yearGroup.style.alignItems = 'center';
    const yearLabel = document.createElement('span');
    yearLabel.textContent = '年:';
    yearLabel.style.marginRight = '4px';
    this._yearInputElement = document.createElement('input');
    this._yearInputElement.type = 'number';
    this._yearInputElement.style.width = '80px';
    this._yearInputElement.addEventListener('change', this._onYearInputChange.bind(this));
    yearGroup.appendChild(yearLabel);
    yearGroup.appendChild(this._yearInputElement);

    // 月入力
    const monthGroup = document.createElement('div');
    monthGroup.style.display = 'flex';
    monthGroup.style.alignItems = 'center';
    const monthLabel = document.createElement('span');
    monthLabel.textContent = '月:';
    monthLabel.style.marginRight = '4px';
    this._monthInputElement = document.createElement('input');
    this._monthInputElement.type = 'number';
    this._monthInputElement.style.width = '60px';
    this._monthInputElement.min = 1;
    this._monthInputElement.addEventListener('change', this._onMonthInputChange.bind(this));
    this._monthUnsetCheckbox = document.createElement('input');
    this._monthUnsetCheckbox.type = 'checkbox';
    const monthUnsetLabel = document.createElement('label');
    monthUnsetLabel.style.display = 'flex';
    monthUnsetLabel.style.alignItems = 'center';
    monthUnsetLabel.style.marginLeft = '4px';
    monthUnsetLabel.appendChild(this._monthUnsetCheckbox);
    const monthUnsetText = document.createElement('span');
    monthUnsetText.textContent = '未指定';
    monthUnsetText.style.marginLeft = '2px';
    monthUnsetLabel.appendChild(monthUnsetText);
    this._monthUnsetCheckbox.addEventListener('change', this._onMonthUnsetChange.bind(this));
    monthGroup.appendChild(monthLabel);
    monthGroup.appendChild(this._monthInputElement);
    monthGroup.appendChild(monthUnsetLabel);

    // 日入力
    const dayGroup = document.createElement('div');
    dayGroup.style.display = 'flex';
    dayGroup.style.alignItems = 'center';
    const dayLabel = document.createElement('span');
    dayLabel.textContent = '日:';
    dayLabel.style.marginRight = '4px';
    this._dayInputElement = document.createElement('input');
    this._dayInputElement.type = 'number';
    this._dayInputElement.style.width = '60px';
    this._dayInputElement.min = 1;
    this._dayInputElement.addEventListener('change', this._onDayInputChange.bind(this));
    this._dayUnsetCheckbox = document.createElement('input');
    this._dayUnsetCheckbox.type = 'checkbox';
    const dayUnsetLabel = document.createElement('label');
    dayUnsetLabel.style.display = 'flex';
    dayUnsetLabel.style.alignItems = 'center';
    dayUnsetLabel.style.marginLeft = '4px';
    dayUnsetLabel.appendChild(this._dayUnsetCheckbox);
    const dayUnsetText = document.createElement('span');
    dayUnsetText.textContent = '未指定';
    dayUnsetText.style.marginLeft = '2px';
    dayUnsetLabel.appendChild(dayUnsetText);
    this._dayUnsetCheckbox.addEventListener('change', this._onDayUnsetChange.bind(this));
    dayGroup.appendChild(dayLabel);
    dayGroup.appendChild(this._dayInputElement);
    dayGroup.appendChild(dayUnsetLabel);

    // 前後ボタン
    const prevButton = document.createElement('button');
    prevButton.textContent = '◀';
    prevButton.addEventListener('click', () => this._viewModel.stepBackward());
    const nextButton = document.createElement('button');
    nextButton.textContent = '▶';
    nextButton.addEventListener('click', () => this._viewModel.stepForward());

    // ステップ単位
    const unitGroup = document.createElement('div');
    unitGroup.style.display = 'flex';
    unitGroup.style.alignItems = 'center';
    const unitLabel = document.createElement('span');
    unitLabel.textContent = '単位:';
    unitLabel.style.marginRight = '4px';
    this._stepUnitSelect = document.createElement('select');
    const unitOptions = [
      { value: 'year', label: '年' },
      { value: 'month', label: '月' },
      { value: 'day', label: '日' }
    ];
    unitOptions.forEach(option => {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      this._stepUnitSelect.appendChild(opt);
    });
    this._stepUnitSelect.addEventListener('change', this._onStepUnitChange.bind(this));
    unitGroup.appendChild(unitLabel);
    unitGroup.appendChild(this._stepUnitSelect);

    // 速度選択
    const speedGroup = document.createElement('div');
    speedGroup.style.display = 'flex';
    speedGroup.style.alignItems = 'center';
    const speedLabel = document.createElement('span');
    speedLabel.textContent = '速度:';
    speedLabel.style.marginRight = '4px';
    this._speedSelectElement = document.createElement('select');
    const speeds = [
      { value: 0.1, label: '0.1x' },
      { value: 0.5, label: '0.5x' },
      { value: 1, label: '1x' },
      { value: 2, label: '2x' },
      { value: 5, label: '5x' },
      { value: 10, label: '10x' }
    ];
    speeds.forEach(speed => {
      const option = document.createElement('option');
      option.value = speed.value;
      option.textContent = speed.label;
      if (speed.value === 1) {
        option.selected = true;
      }
      this._speedSelectElement.appendChild(option);
    });
    this._speedSelectElement.addEventListener('change', event => {
      if (this._viewModel.isPlaying()) {
        this._viewModel.startPlayback(Number(event.target.value));
      }
    });
    speedGroup.appendChild(speedLabel);
    speedGroup.appendChild(this._speedSelectElement);

    controlRow.appendChild(this._playButtonElement);
    controlRow.appendChild(yearGroup);
    controlRow.appendChild(monthGroup);
    controlRow.appendChild(dayGroup);
    controlRow.appendChild(prevButton);
    controlRow.appendChild(nextButton);
    controlRow.appendChild(unitGroup);
    controlRow.appendChild(speedGroup);

    const sliderRow = document.createElement('div');
    sliderRow.style.display = 'flex';
    sliderRow.style.alignItems = 'center';
    sliderRow.style.marginTop = '8px';

    this._minYearLabel = document.createElement('span');
    this._minYearLabel.style.marginRight = '10px';
    this._minYearLabel.style.minWidth = '40px';
    this._minYearLabel.style.textAlign = 'right';

    this._sliderElement = document.createElement('input');
    this._sliderElement.type = 'range';
    this._sliderElement.step = 1;
    this._sliderElement.style.flex = '1';
    this._sliderElement.addEventListener('input', this._onSliderChange.bind(this));

    this._maxYearLabel = document.createElement('span');
    this._maxYearLabel.style.marginLeft = '10px';
    this._maxYearLabel.style.minWidth = '40px';

    sliderRow.appendChild(this._minYearLabel);
    sliderRow.appendChild(this._sliderElement);
    sliderRow.appendChild(this._maxYearLabel);

    this._timelineElement.appendChild(controlRow);
    this._timelineElement.appendChild(sliderRow);
  }

  _onViewModelChanged(type) {
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
      case 'stepUnit':
        this._syncStepUnit();
        break;
      default:
        break;
    }
  }

  _updateTimelineDisplay() {
    const currentTime = this._viewModel.getCurrentTime();
    this._suppressInputHandlers = true;

    this._sliderElement.value = currentTime.year;
    this._yearInputElement.value = currentTime.year;

    const calendar = this._viewModel.getCalendarConfig();
    this._monthInputElement.max = calendar.monthsPerYear;

    const monthSpecified = currentTime.month !== null;
    this._monthUnsetCheckbox.checked = !monthSpecified;
    this._monthInputElement.disabled = !monthSpecified;
    this._monthInputElement.value = monthSpecified ? currentTime.month : '';

    const daySelectable = monthSpecified;
    this._dayUnsetCheckbox.disabled = !daySelectable;
    const daySpecified = daySelectable && currentTime.day !== null;
    this._dayUnsetCheckbox.checked = !daySpecified;
    this._dayInputElement.disabled = !daySpecified;

    if (daySelectable) {
      const maxDay = this._viewModel.getDaysInMonth(currentTime.year, currentTime.month);
      this._dayInputElement.max = maxDay;
      this._dayInputElement.value = daySpecified ? currentTime.day : '';
    } else {
      this._dayInputElement.value = '';
      this._dayInputElement.removeAttribute('max');
    }

    this._syncStepUnit();

    this._suppressInputHandlers = false;
  }

  _updateTimeRange() {
    const range = this._viewModel.getTimeRange();
    this._sliderElement.min = range.minYear;
    this._sliderElement.max = range.maxYear;
    this._minYearLabel.textContent = range.minYear;
    this._maxYearLabel.textContent = range.maxYear;
  }

  _updatePlaybackState() {
    this._playButtonElement.textContent = this._viewModel.isPlaying() ? '⏸' : '▶';
  }

  _syncStepUnit() {
    if (this._stepUnitSelect) {
      this._stepUnitSelect.value = this._viewModel.getStepUnit();
    }
  }

  _onPlayButtonClick() {
    if (this._viewModel.isPlaying()) {
      this._viewModel.stopPlayback();
    } else {
      const speed = Number(this._speedSelectElement.value);
      this._viewModel.startPlayback(speed);
    }
  }

  _onSliderChange(event) {
    if (this._suppressInputHandlers) {
      return;
    }
    const year = Number(event.target.value);
    const current = this._viewModel.getCurrentTime();
    this._viewModel.moveToTime(year, current.month, current.day);
  }

  _onYearInputChange(event) {
    if (this._suppressInputHandlers) {
      return;
    }
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) {
      this._updateTimelineDisplay();
      return;
    }
    const range = this._viewModel.getTimeRange();
    const constrainedYear = Math.max(range.minYear, Math.min(range.maxYear, Math.trunc(value)));
    const current = this._viewModel.getCurrentTime();
    this._viewModel.moveToTime(constrainedYear, current.month, current.day);
  }

  _onMonthInputChange(event) {
    if (this._suppressInputHandlers) {
      return;
    }
    const value = Number(event.target.value);
    const calendar = this._viewModel.getCalendarConfig();
    if (!Number.isInteger(value) || value < 1 || value > calendar.monthsPerYear) {
      this._updateTimelineDisplay();
      return;
    }
    this._viewModel.setMonth(value);
  }

  _onMonthUnsetChange(event) {
    if (this._suppressInputHandlers) {
      return;
    }
    if (event.target.checked) {
      this._viewModel.clearMonth();
    } else {
      this._viewModel.setMonth(1);
    }
  }

  _onDayInputChange(event) {
    if (this._suppressInputHandlers) {
      return;
    }
    const value = Number(event.target.value);
    const current = this._viewModel.getCurrentTime();
    if (current.month === null || !Number.isInteger(value)) {
      this._updateTimelineDisplay();
      return;
    }
    const maxDay = this._viewModel.getDaysInMonth(current.year, current.month);
    if (value < 1 || value > maxDay) {
      this._updateTimelineDisplay();
      return;
    }
    this._viewModel.setDay(value);
  }

  _onDayUnsetChange(event) {
    if (this._suppressInputHandlers) {
      return;
    }
    if (event.target.checked) {
      this._viewModel.clearDay();
    } else {
      this._viewModel.setDay(1);
    }
  }

  _onStepUnitChange(event) {
    if (this._suppressInputHandlers) {
      return;
    }
    this._viewModel.setStepUnit(event.target.value);
  }
}
