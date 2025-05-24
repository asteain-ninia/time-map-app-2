// src/presentation/views/sidebar/ProjectSettingsTabView.js

// MapViewModel はコンストラクタで受け取る想定

export class ProjectSettingsTabView {
  /**
   * ProjectSettingsTabView を作成
   * @param {HTMLElement} parentElement - このタブビューの親となるDOM要素
   * @param {MapViewModel} mapViewModel
   */
  constructor(parentElement, mapViewModel) {
    this._parentElement = parentElement;
    this._mapViewModel = mapViewModel;

    this._tabContentElement = null;
    this._settingsContainer = null; // 設定フォームを保持するコンテナ

    this._initializeDOM();
  }

  /**
   * タブビューのDOM要素を初期化
   * @private
   */
  _initializeDOM() {
    this._tabContentElement = document.createElement('div');
    this._tabContentElement.className = 'sidebar-tab-content project-settings-tab-content';
    this._tabContentElement.style.cssText = `
      flex: 1; 
      overflow-y: auto; 
      overflow-x: hidden;
      padding: 10px; 
      display: none; /* 初期状態は非表示 */
    `;

    this._settingsContainer = document.createElement('div');
    this._settingsContainer.className = 'project-settings-container';
    this._tabContentElement.appendChild(this._settingsContainer);

    this._parentElement.appendChild(this._tabContentElement);
  }

  /**
   * タブの表示を更新 (SidebarViewの_switchTabから呼び出される想定)
   */
  update() {
    this._settingsContainer.innerHTML = ''; // 既存の内容をクリア
    const currentSettings = this._mapViewModel.getProjectSettings();

    if (!currentSettings) {
      this._settingsContainer.textContent = "プロジェクト設定を読み込めませんでした。";
      return;
    }
    this._buildSettingsForm(currentSettings);
  }

  /**
   * プロジェクト設定フォームを構築
   * @param {object} currentSettings - 現在のプロジェクト設定
   * @private
   */
  _buildSettingsForm(currentSettings) {
    const form = document.createElement('form');
    form.addEventListener('submit', e => e.preventDefault()); // デフォルト送信抑止

    const createRow = (labelText, inputElement, descriptionText = null) => {
      const row = document.createElement('div');
      row.style.marginBottom = '12px';
      const label = document.createElement('label');
      label.textContent = labelText;
      label.style.display = 'block';
      label.style.fontWeight = 'bold';
      label.style.marginBottom = '3px';
      row.appendChild(label);
      row.appendChild(inputElement);
      if (descriptionText) {
        const desc = document.createElement('small');
        desc.textContent = descriptionText;
        desc.style.display = 'block';
        desc.style.color = '#666';
        desc.style.marginTop = '2px';
        row.appendChild(desc);
      }
      return row;
    };
    
    const createTextInput = (name, value, placeholder = '') => {
        const input = document.createElement('input');
        input.type = 'text';
        input.name = name;
        input.value = value || '';
        input.placeholder = placeholder;
        input.style.width = 'calc(100% - 8px)';
        return input;
    };

    const createTextareaInput = (name, value, placeholder = '') => {
        const textarea = document.createElement('textarea');
        textarea.name = name;
        textarea.value = value || '';
        textarea.placeholder = placeholder;
        textarea.rows = 3;
        textarea.style.width = 'calc(100% - 8px)';
        return textarea;
    };
    
    const createNumberInput = (name, value, min, max, step, required = true) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.name = name;
        input.value = value;
        if (min !== undefined) input.min = min;
        if (max !== undefined) input.max = max;
        if (step !== undefined) input.step = step;
        input.required = required;
        input.style.width = 'calc(100% - 8px)';
        return input;
    };

    const createColorInput = (name, value) => {
        const input = document.createElement('input');
        input.type = 'color';
        input.name = name;
        input.value = value;
        input.style.width = 'calc(100% - 8px)';
        return input;
    };

    // 設定項目
    form.appendChild(createRow('プロジェクト名:', createTextInput('worldName', currentSettings.worldName)));
    form.appendChild(createRow('プロジェクト説明:', createTextareaInput('worldDescription', currentSettings.worldDescription)));
    form.appendChild(createRow('赤道長 (km):', createNumberInput('equatorLength', currentSettings.equatorLength, 1, undefined, 1), '地図の縮尺基準となります。'));
    form.appendChild(createRow('タイムライン最小年:', createNumberInput('sliderMin', currentSettings.sliderMin, undefined, undefined, 1)));
    form.appendChild(createRow('タイムライン最大年:', createNumberInput('sliderMax', currentSettings.sliderMax, undefined, undefined, 1)));
    form.appendChild(createRow('グリッド間隔 (度):', createNumberInput('gridInterval', currentSettings.gridInterval, 1, 90, 1)));
    form.appendChild(createRow('グリッド色:', createColorInput('gridColor', currentSettings.gridColor)));
    form.appendChild(createRow('グリッド不透明度 (0-1):', createNumberInput('gridOpacity', currentSettings.gridOpacity, 0, 1, 0.01)));

    // ボタンコンテナ
    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '20px';
    buttonContainer.style.textAlign = 'right';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '10px';

    const saveButton = document.createElement('button');
    saveButton.type = 'button'; // submitはformでハンドリング
    saveButton.textContent = '設定を保存';
    saveButton.addEventListener('click', () => this._handleSaveSettings(form));
    buttonContainer.appendChild(saveButton);

    const defaultsButton = document.createElement('button');
    defaultsButton.type = 'button';
    defaultsButton.textContent = 'デフォルトに戻す';
    defaultsButton.addEventListener('click', () => this._handleResetToDefaults(form));
    buttonContainer.appendChild(defaultsButton);

    form.appendChild(buttonContainer);
    this._settingsContainer.appendChild(form);
  }

  /**
   * 設定保存処理
   * @param {HTMLFormElement} formElement
   * @private
   */
  async _handleSaveSettings(formElement) {
    const formData = new FormData(formElement);
    const newSettings = {
      worldName: formData.get('worldName')?.trim() || '',
      worldDescription: formData.get('worldDescription')?.trim() || '',
      equatorLength: parseFloat(formData.get('equatorLength')),
      sliderMin: parseInt(formData.get('sliderMin'), 10),
      sliderMax: parseInt(formData.get('sliderMax'), 10),
      gridInterval: parseFloat(formData.get('gridInterval')),
      gridColor: formData.get('gridColor'),
      gridOpacity: parseFloat(formData.get('gridOpacity'))
    };

    // UIバリデーション
    if (isNaN(newSettings.equatorLength) || newSettings.equatorLength <= 0) {
      alert("赤道長は正の数値で入力してください。"); return;
    }
    if (isNaN(newSettings.sliderMin) || isNaN(newSettings.sliderMax) || newSettings.sliderMin >= newSettings.sliderMax) {
      alert("タイムラインの年は、最小年 < 最大年 となるように入力してください。"); return;
    }
    if (isNaN(newSettings.gridInterval) || newSettings.gridInterval <= 0) {
      alert("グリッド間隔は正の数値で入力してください。"); return;
    }
    if (newSettings.gridColor && !/^#[0-9a-fA-F]{3,6}$/.test(newSettings.gridColor)) { // 3桁HEXも許容
         alert("グリッド色は有効なHEXカラーコード (例: #RRGGBB または #RGB) で入力してください。"); return;
    }
    if (isNaN(newSettings.gridOpacity) || newSettings.gridOpacity < 0 || newSettings.gridOpacity > 1) {
      alert("グリッド不透明度は0から1の間で入力してください。"); return;
    }

    try {
      await this._mapViewModel.updateProjectSettings(newSettings);
      alert('プロジェクト設定を保存しました。');
      // this.update(); // MapViewModelの変更通知でSidebarView経由で更新される
    } catch (error) {
      console.error('プロジェクト設定の保存に失敗しました (ProjectSettingsTabView)', error);
      alert(`設定の保存に失敗: ${error.message}`);
    }
  }

  /**
   * デフォルト設定に戻す処理
   * @param {HTMLFormElement} formElement
   * @private
   */
  _handleResetToDefaults(formElement) {
    const defaultSettings = this._mapViewModel.getDefaultProjectSettings();
    if (defaultSettings) {
      formElement.worldName.value = defaultSettings.worldName || '';
      formElement.worldDescription.value = defaultSettings.worldDescription || '';
      formElement.equatorLength.value = defaultSettings.equatorLength;
      formElement.sliderMin.value = defaultSettings.sliderMin;
      formElement.sliderMax.value = defaultSettings.sliderMax;
      formElement.gridInterval.value = defaultSettings.gridInterval;
      formElement.gridColor.value = defaultSettings.gridColor;
      formElement.gridOpacity.value = defaultSettings.gridOpacity;
      alert('フォームをデフォルト値にリセットしました。保存するには「設定を保存」ボタンを押してください。');
    } else {
      alert('デフォルト設定の読み込みに失敗しました。');
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