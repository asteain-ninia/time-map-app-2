// src/presentation/views/sidebar/PropertiesTabView.js

import { Property } from '../../../domain/value-objects/Property.js';

// MapViewModel, EditingViewModel はコンストラクタで受け取る想定

export class PropertiesTabView {
  /**
   * PropertiesTabView を作成
   * @param {HTMLElement} parentElement - このタブビューの親となるDOM要素
   * @param {MapViewModel} mapViewModel
   * @param {EditingViewModel} editingViewModel
   */
  constructor(parentElement, mapViewModel, editingViewModel) {
    this._parentElement = parentElement;
    this._mapViewModel = mapViewModel;
    this._editingViewModel = editingViewModel;

    this._tabContentElement = null;
    this._propertiesContainer = null; // プロパティフォームを保持するコンテナ
    this._timeFieldRefs = {};

    this._initializeDOM();
  }

  /**
   * タブビューのDOM要素を初期化
   * @private
   */
  _initializeDOM() {
    this._tabContentElement = document.createElement('div');
    this._tabContentElement.className = 'sidebar-tab-content properties-tab-content';
    this._tabContentElement.style.cssText = `
      flex: 1; 
      overflow-y: auto; 
      overflow-x: hidden;
      padding: 10px; 
      display: none; /* 初期状態は非表示 */
    `;

    this._propertiesContainer = document.createElement('div');
    this._propertiesContainer.className = 'properties-container';
    this._tabContentElement.appendChild(this._propertiesContainer);

    this._parentElement.appendChild(this._tabContentElement);
  }

  /**
   * タブの表示を更新 (SidebarViewの_switchTabから呼び出される想定)
   */
  update() {
    // --- 変更ここから ---
    const featureForProperties = this._mapViewModel.getSelectionContextFeature();
    // --- 変更ここまで ---

    this._propertiesContainer.innerHTML = ''; // 既存の内容をクリア

    // --- 変更ここから ---
    if (!featureForProperties) {
      const noSelectionMsg = document.createElement('p');
      // メッセージをより包括的に変更
      noSelectionMsg.textContent = '地物または頂点が選択されていません';
      this._propertiesContainer.appendChild(noSelectionMsg);
      return;
    }
    this._buildPropertyForm(featureForProperties);
    // --- 変更ここまで ---
  }

  /**
   * プロパティ編集フォームを構築
   * @param {Feature} feature - 選択された地物インスタンス
   * @private
   */
  _buildPropertyForm(feature) {
    this._timeFieldRefs = {};
    
    // 地物の種類を特定
    let featureType = 'unknown';
    if (feature.constructor.name === 'Point') featureType = 'point';
    else if (feature.constructor.name === 'Line') featureType = 'line';
    else if (feature.constructor.name === 'Polygon') featureType = 'polygon';

    // 地物IDと種類表示
    const idRow = document.createElement('div');
    idRow.style.marginBottom = '10px';
    idRow.innerHTML = `
      <span style="font-size: 0.8em; color: #666;">ID: ${feature.id}</span>
      <span style="font-size: 0.8em; color: #666; margin-left: 10px;">種類: ${this._getFeatureTypeName(featureType)}</span>
    `;
    this._propertiesContainer.appendChild(idRow);

    // Featureが持つ唯一のPropertyを取得 (現在の単純化モデルに基づく)
    const currentProperty = (feature.properties && feature.properties.length > 0)
                            ? feature.properties[0]
                            : null;
    
    if (!currentProperty) {
        const noPropertyMsg = document.createElement('p');
        noPropertyMsg.textContent = 'この地物のプロパティ情報が見つかりません。';
        this._propertiesContainer.appendChild(noPropertyMsg);
        return;
    }


    const form = document.createElement('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      this._handleSaveProperties(feature.id, form);
    });

    // 基本プロパティ (名前, 説明, カテゴリ)
    const basicPropsConfig = [
      { id: 'name', label: '名前', type: 'text', value: currentProperty.name || '' },
      { id: 'description', label: '説明', type: 'textarea', value: currentProperty.description || '' },
      { id: 'category', label: 'カテゴリ', type: 'select', value: currentProperty.getAttribute('category', 'default') }
    ];

    basicPropsConfig.forEach(propConfig => {
      const row = document.createElement('div');
      row.style.marginBottom = '10px';

      const label = document.createElement('label');
      label.textContent = propConfig.label + ':';
      label.style.display = 'block';
      label.style.marginBottom = '3px';

      let inputElement;
      if (propConfig.type === 'textarea') {
        inputElement = document.createElement('textarea');
        inputElement.style.width = 'calc(100% - 6px)'; /* padding考慮 */
        inputElement.style.minHeight = '60px';
        inputElement.value = propConfig.value;
      } else if (propConfig.type === 'select') {
        inputElement = document.createElement('select');
        inputElement.style.width = '100%';
        const categories = this._getCategoriesForFeatureType(featureType);
        categories.forEach(cat => {
          const option = document.createElement('option');
          option.value = cat.id;
          option.textContent = cat.name;
          if (cat.id === propConfig.value) option.selected = true;
          inputElement.appendChild(option);
        });
      } else {
        inputElement = document.createElement('input');
        inputElement.type = propConfig.type;
        inputElement.style.width = 'calc(100% - 6px)'; /* padding考慮 */
        inputElement.value = propConfig.value;
      }
      inputElement.name = propConfig.id;
      row.appendChild(label);
      row.appendChild(inputElement);
      form.appendChild(row);
    });

    // 時間範囲 (存在期間)
    // 存在期間入力
    this._buildExistenceSection(form, currentProperty);

    // ボタン行
    const buttonRow = document.createElement('div');
    buttonRow.style.marginTop = '20px';
    buttonRow.style.textAlign = 'right';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '削除';
    deleteButton.style.marginRight = '10px';
    deleteButton.addEventListener('click', () => this._handleDeleteFeature(feature));

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = '保存';

    buttonRow.appendChild(deleteButton);
    buttonRow.appendChild(saveButton);
    form.appendChild(buttonRow);

    this._propertiesContainer.appendChild(form);
  }

  /**
   * 地物プロパティの保存
   * @param {string} featureId - 地物ID
   * @param {HTMLFormElement} formElement - プロパティフォーム
   * @private
   */
  async _handleSaveProperties(featureId, formElement) {
    const formData = new FormData(formElement);
    const name = formData.get('name')?.trim() || '名称未設定';
    const description = formData.get('description')?.trim() || '';
    const category = formData.get('category') || 'default';

    const startResult = this._extractTimePoint('start');
    if (startResult.error) {
      return;
    }
    const endResult = this._extractTimePoint('end');
    if (endResult.error) {
      return;
    }

    const startTp = startResult.value;
    const endTp = endResult.value;

    if (startTp && endTp && endTp.isBefore(startTp)) {
      alert('存在終了は存在開始より後に設定してください。');
      return;
    }

    const newPropertyInstance = new Property(
      startTp ?? null,
      name,
      description,
      { category },
      startTp,
      endTp
    );

    try {
      await this._editingViewModel.updateFeatureProperties(featureId, [newPropertyInstance]);
      alert('プロパティを保存しました。');
      // update() は SidebarView経由で呼ばれるのでここでは不要
    } catch (error) {
      console.error('プロパティの保存に失敗しました (PropertiesTabView)', error);
      alert(`プロパティの保存に失敗: ${error.message}`);
    }
  }

  _buildExistenceSection(form, currentProperty) {
    const section = document.createElement('div');
    section.style.marginBottom = '15px';

    const label = document.createElement('label');
    label.textContent = '存在期間:';
    label.style.display = 'block';
    label.style.marginBottom = '6px';
    section.appendChild(label);

    section.appendChild(this._createTimeInputRow('start', '開始', currentProperty.startTime));
    section.appendChild(this._createTimeInputRow('end', '終了', currentProperty.endTime));

    form.appendChild(section);
  }

  _createTimeInputRow(prefix, title, timePoint) {
    const calendar = this._mapViewModel.getCalendarConfig();

    const container = document.createElement('div');
    container.style.marginBottom = '6px';

    const header = document.createElement('div');
    header.textContent = title;
    header.style.fontWeight = 'bold';
    header.style.marginBottom = '3px';
    container.appendChild(header);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';
    row.style.gap = '6px';
    container.appendChild(row);

    const yearLabel = document.createElement('span');
    yearLabel.textContent = '年:';
    row.appendChild(yearLabel);
    const yearInput = document.createElement('input');
    yearInput.type = 'number';
    yearInput.name = `${prefix}Year`;
    yearInput.style.width = '80px';
    yearInput.step = '1';
    yearInput.value = timePoint ? timePoint.year : '';
    row.appendChild(yearInput);

    const monthLabel = document.createElement('span');
    monthLabel.textContent = '月:';
    row.appendChild(monthLabel);
    const monthInput = document.createElement('input');
    monthInput.type = 'number';
    monthInput.name = `${prefix}Month`;
    monthInput.style.width = '60px';
    monthInput.min = '1';
    monthInput.max = String(calendar.monthsPerYear);
    row.appendChild(monthInput);

    const monthUnsetLabel = document.createElement('label');
    monthUnsetLabel.style.display = 'flex';
    monthUnsetLabel.style.alignItems = 'center';
    monthUnsetLabel.style.gap = '2px';
    const monthUnsetCheckbox = document.createElement('input');
    monthUnsetCheckbox.type = 'checkbox';
    monthUnsetCheckbox.name = `${prefix}MonthUnset`;
    monthUnsetLabel.appendChild(monthUnsetCheckbox);
    const monthUnsetText = document.createElement('span');
    monthUnsetText.textContent = '未指定';
    monthUnsetLabel.appendChild(monthUnsetText);
    row.appendChild(monthUnsetLabel);

    const dayLabel = document.createElement('span');
    dayLabel.textContent = '日:';
    row.appendChild(dayLabel);
    const dayInput = document.createElement('input');
    dayInput.type = 'number';
    dayInput.name = `${prefix}Day`;
    dayInput.style.width = '60px';
    dayInput.min = '1';
    row.appendChild(dayInput);

    const dayUnsetLabel = document.createElement('label');
    dayUnsetLabel.style.display = 'flex';
    dayUnsetLabel.style.alignItems = 'center';
    dayUnsetLabel.style.gap = '2px';
    const dayUnsetCheckbox = document.createElement('input');
    dayUnsetCheckbox.type = 'checkbox';
    dayUnsetCheckbox.name = `${prefix}DayUnset`;
    dayUnsetLabel.appendChild(dayUnsetCheckbox);
    const dayUnsetText = document.createElement('span');
    dayUnsetText.textContent = '未指定';
    dayUnsetLabel.appendChild(dayUnsetText);
    row.appendChild(dayUnsetLabel);

    const refs = {
      prefix,
      container,
      yearInput,
      monthInput,
      monthUnsetCheckbox,
      dayInput,
      dayUnsetCheckbox
    };
    this._timeFieldRefs[prefix] = refs;

    this._applyTimeFieldInitialState(refs, timePoint);

    yearInput.addEventListener('change', () => this._onTimeFieldYearChange(prefix));
    monthInput.addEventListener('change', () => this._onTimeFieldMonthChange(prefix));
    monthUnsetCheckbox.addEventListener('change', event => this._onTimeFieldMonthUnsetChange(prefix, event.target.checked));
    dayInput.addEventListener('change', () => this._onTimeFieldDayChange(prefix));
    dayUnsetCheckbox.addEventListener('change', event => this._onTimeFieldDayUnsetChange(prefix, event.target.checked));

    return container;
  }

  _applyTimeFieldInitialState(refs, timePoint) {
    const monthSpecified = !!(timePoint && timePoint.month !== null);
    const daySpecified = monthSpecified && !!(timePoint && timePoint.day !== null);

    if (monthSpecified) {
      refs.monthInput.value = String(timePoint.month);
      refs.monthInput.disabled = false;
      refs.monthUnsetCheckbox.checked = false;
      refs.dayUnsetCheckbox.disabled = false;
    } else {
      refs.monthInput.value = '';
      refs.monthInput.disabled = true;
      refs.monthUnsetCheckbox.checked = true;
      refs.dayUnsetCheckbox.checked = true;
      refs.dayUnsetCheckbox.disabled = true;
    }

    if (daySpecified) {
      refs.dayInput.value = String(timePoint.day);
      refs.dayInput.disabled = false;
      refs.dayUnsetCheckbox.checked = false;
    } else {
      refs.dayInput.value = '';
      refs.dayInput.disabled = true;
      if (refs.monthUnsetCheckbox.checked) {
        refs.dayUnsetCheckbox.checked = true;
      }
    }

    refs.dayInput.removeAttribute('max');
    if (monthSpecified) {
      this._updateDayLimit(refs);
    }
  }

  _onTimeFieldYearChange(prefix) {
    const refs = this._timeFieldRefs[prefix];
    if (!refs) return;
    this._updateDayLimit(refs);
  }

  _onTimeFieldMonthChange(prefix) {
    const refs = this._timeFieldRefs[prefix];
    if (!refs || refs.monthUnsetCheckbox.checked) return;
    const value = refs.monthInput.value.trim();
    if (value === '') {
      this._onTimeFieldMonthUnsetChange(prefix, true);
      return;
    }
    const calendar = this._mapViewModel.getCalendarConfig();
    let month = this._parseInteger(value);
    if (!Number.isInteger(month)) {
      return;
    }
    month = Math.max(1, Math.min(calendar.monthsPerYear, month));
    refs.monthInput.value = String(month);
    refs.dayUnsetCheckbox.disabled = false;
    this._updateDayLimit(refs);
  }

  _onTimeFieldMonthUnsetChange(prefix, isChecked) {
    const refs = this._timeFieldRefs[prefix];
    if (!refs) return;
    refs.monthUnsetCheckbox.checked = isChecked;
    if (isChecked) {
      refs.monthInput.value = '';
      refs.monthInput.disabled = true;
      refs.dayInput.value = '';
      refs.dayInput.disabled = true;
      refs.dayUnsetCheckbox.checked = true;
      refs.dayUnsetCheckbox.disabled = true;
      refs.dayInput.removeAttribute('max');
    } else {
      const calendar = this._mapViewModel.getCalendarConfig();
      refs.monthInput.disabled = false;
      let month = this._parseInteger(refs.monthInput.value);
      if (!Number.isInteger(month) || month < 1 || month > calendar.monthsPerYear) {
        month = 1;
      }
      refs.monthInput.value = String(month);
      refs.dayUnsetCheckbox.disabled = false;
      refs.dayUnsetCheckbox.checked = true;
      refs.dayInput.value = '';
      refs.dayInput.disabled = true;
      this._updateDayLimit(refs);
    }
  }

  _onTimeFieldDayChange(prefix) {
    const refs = this._timeFieldRefs[prefix];
    if (!refs || refs.dayUnsetCheckbox.checked || refs.dayInput.disabled) return;
    const value = refs.dayInput.value.trim();
    if (value === '') {
      return;
    }
    const day = this._parseInteger(value);
    if (!Number.isInteger(day)) {
      return;
    }
    const maxDay = this._updateDayLimit(refs);
    let normalized = day;
    if (maxDay !== null && maxDay !== undefined) {
      normalized = Math.min(maxDay, normalized);
    }
    normalized = Math.max(1, normalized);
    refs.dayInput.value = String(normalized);
  }

  _onTimeFieldDayUnsetChange(prefix, isChecked) {
    const refs = this._timeFieldRefs[prefix];
    if (!refs) return;
    if (!isChecked && refs.monthUnsetCheckbox.checked) {
      this._onTimeFieldMonthUnsetChange(prefix, false);
    }
    refs.dayUnsetCheckbox.checked = isChecked;
    if (isChecked) {
      refs.dayInput.value = '';
      refs.dayInput.disabled = true;
      refs.dayInput.removeAttribute('max');
    } else {
      refs.dayInput.disabled = false;
      const maxDay = this._updateDayLimit(refs);
      let day = this._parseInteger(refs.dayInput.value);
      if (!Number.isInteger(day) || day < 1) {
        day = 1;
      }
      if (maxDay !== null && maxDay !== undefined && day > maxDay) {
        day = maxDay;
      }
      refs.dayInput.value = String(day);
    }
  }

  _updateDayLimit(refs) {
    if (!refs || refs.monthUnsetCheckbox.checked) {
      refs.dayInput.removeAttribute('max');
      return null;
    }
    const month = this._parseInteger(refs.monthInput.value);
    const year = this._parseInteger(refs.yearInput.value);
    if (!Number.isInteger(month) || !Number.isInteger(year)) {
      refs.dayInput.removeAttribute('max');
      return null;
    }
    try {
      const maxDay = this._mapViewModel.getDaysInMonth(year, month);
      if (typeof maxDay === 'number' && Number.isFinite(maxDay)) {
        refs.dayInput.max = String(maxDay);
        const currentDay = this._parseInteger(refs.dayInput.value);
        if (Number.isInteger(currentDay) && currentDay > maxDay) {
          refs.dayInput.value = String(maxDay);
        }
        return maxDay;
      }
    } catch (error) {
      console.error('日数の取得に失敗しました', error);
    }
    refs.dayInput.removeAttribute('max');
    return null;
  }

  _extractTimePoint(prefix) {
    const refs = this._timeFieldRefs[prefix];
    if (!refs) {
      return { value: null };
    }
    const label = prefix === 'start' ? '存在開始' : '存在終了';
    const yearValue = refs.yearInput.value.trim();
    if (yearValue === '') {
      if (!refs.monthUnsetCheckbox.checked || !refs.dayUnsetCheckbox.checked) {
        alert(`${label}の年を入力してください。`);
        return { error: true };
      }
      return { value: null };
    }
    const year = this._parseInteger(yearValue);
    if (!Number.isInteger(year)) {
      alert(`${label}の年は整数で入力してください。`);
      return { error: true };
    }

    let month = null;
    let day = null;

    if (!refs.monthUnsetCheckbox.checked) {
      const monthValue = refs.monthInput.value.trim();
      const calendar = this._mapViewModel.getCalendarConfig();
      const parsedMonth = this._parseInteger(monthValue);
      if (!Number.isInteger(parsedMonth)) {
        alert(`${label}の月は整数で入力してください。`);
        return { error: true };
      }
      if (parsedMonth < 1 || parsedMonth > calendar.monthsPerYear) {
        alert(`${label}の月は1〜${calendar.monthsPerYear}の範囲で設定してください。`);
        return { error: true };
      }
      month = parsedMonth;

      if (!refs.dayUnsetCheckbox.checked) {
        const dayValue = refs.dayInput.value.trim();
        const parsedDay = this._parseInteger(dayValue);
        if (!Number.isInteger(parsedDay)) {
          alert(`${label}の日は整数で入力してください。`);
          return { error: true };
        }
        const maxDay = this._mapViewModel.getDaysInMonth(year, month);
        if (parsedDay < 1 || parsedDay > maxDay) {
          alert(`${label}の日は1〜${maxDay}の範囲で設定してください。`);
          return { error: true };
        }
        day = parsedDay;
      }
    } else if (!refs.dayUnsetCheckbox.checked) {
      alert(`${label}の日付を指定する前に月を指定してください。`);
      return { error: true };
    }

    try {
      return { value: this._mapViewModel.createTimePoint(year, month, day) };
    } catch (error) {
      alert(`${label}の設定に失敗しました: ${error.message}`);
      return { error: true };
    }
  }

  _parseInteger(value) {
    const normalized = (value ?? '').toString().trim();
    if (normalized === '') {
      return null;
    }
    if (!/^[-+]?\d+$/.test(normalized)) {
      return NaN;
    }
    return Number(normalized);
  }

  /**
   * 地物削除の処理
   * @param {Feature} feature - 削除する地物インスタンス
   * @private
   */
  _handleDeleteFeature(feature) {
    const currentTime = this._mapViewModel.getCurrentTime();
    const property = feature.getPropertyAt(currentTime); // 削除確認ダイアログ用の名前取得
    const name = property ? property.name : '名称なし';

    if (window.confirm(`地物「${name}」(ID: ${feature.id}) を削除してもよろしいですか？`)) {
      this._editingViewModel.deleteFeature(feature.id, feature)
        .catch(error => {
          console.error('地物の削除に失敗しました (PropertiesTabView)', error);
          alert(`地物の削除に失敗: ${error.message}`);
        });
      // 削除後、選択がクリアされ、update()がViewModel経由で呼ばれるはず
    }
  }

  /**
   * 地物種類の表示名取得 (SidebarViewから移植)
   * @param {string} type - 地物種類
   * @returns {string} 表示名
   * @private
   */
  _getFeatureTypeName(type) {
    const typeMap = {
      'point': '点', 'line': '線', 'polygon': '面', 'unknown': '不明'
    };
    return typeMap[type.toLowerCase()] || type;
  }

  /**
   * 地物種類に応じたカテゴリの取得 (SidebarViewから移植)
   * @param {string} type - 地物種類
   * @returns {Array<{id: string, name: string}>} カテゴリの配列
   * @private
   */
  _getCategoriesForFeatureType(type) {
    const defaultCategories = [
      { id: '', name: '-- カテゴリなし --' },
      { id: 'default', name: 'デフォルト' }
    ];
    switch (type.toLowerCase()) {
      case 'point':
        return [ ...defaultCategories,
          { id: 'city', name: '都市' },
          { id: 'town', name: '町村' },
          { id: 'battle', name: '戦闘' },
          { id: 'ruin', name: '遺跡' }];
      case 'line':
        return [ ...defaultCategories,
          { id: 'road', name: '道路' },
          { id: 'railway', name: '鉄道' },
          { id: 'river', name: '河川' },
          { id: 'trade_route', name: '交易路' },
          { id: 'border', name: '国境' }];
      case 'polygon':
        return [ ...defaultCategories,
          { id: 'kingdom', name: '王国' },
          { id: 'empire', name: '帝国' },
          { id: 'province', name: '地方' },
          { id: 'ocean', name: '海洋' },
          { id: 'lake', name: '湖沼' }];
      default: return defaultCategories;
    }
  }

  /**
   * このタブのメインDOM要素を取得
   * @returns {HTMLElement}
   */
  getDOMElement() {
    return this._tabContentElement;
  }

  /**
   * タブの表示状態を設定
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._tabContentElement.style.display = visible ? 'block' : 'none';
  }
}
