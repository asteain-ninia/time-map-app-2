// src/presentation/views/sidebar/ProjectSettingsTabView.js

// MapViewModel はコンストラクタで受け取る想定

export class ProjectSettingsTabView {
  /**
   * ProjectSettingsTabView を作成
   * @param {HTMLElement} parentElement - このビューの親となるDOM要素
   * @param {MapViewModel} mapViewModel
   * @param {ConfigManager} configManager
   */
  constructor(parentElement, mapViewModel, configManager) {
    this._parentElement = parentElement;
    this._mapViewModel = mapViewModel;
    this._configManager = configManager;

    this._modalOverlay = null;
    this._modalWindow = null;
    this._tabContentElement = null;
    this._settingsContainer = null; // 設定フォームを保持するコンテナ

    this._initializeDOM();
  }

  /**
   * タブビューのDOM要素を初期化
   * @private
   */
  _initializeDOM() {
    this._modalOverlay = document.createElement('div');
    this._modalOverlay.className = 'project-settings-modal';
    this._modalOverlay.style.cssText = `
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      background-color: rgba(0, 0, 0, 0.35);
      z-index: 1000;
      overflow: auto;
    `;
    this._modalOverlay.tabIndex = -1;
    this._modalOverlay.addEventListener('click', event => {
      if (event.target === this._modalOverlay) {
        this.close();
      }
    });
    this._modalOverlay.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this._modalWindow = document.createElement('div');
    this._modalWindow.className = 'project-settings-window';
    this._modalWindow.style.cssText = `
      width: min(720px, 92vw);
      max-height: 90vh;
      background-color: #fff;
      border: 1px solid #ccc;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      min-height: 0;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid #ddd;
      background-color: #f5f5f5;
    `;

    const title = document.createElement('div');
    title.textContent = 'プロジェクト設定';
    title.style.fontWeight = 'bold';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';
    closeButton.dataset.action = 'close';
    closeButton.addEventListener('click', () => this.close());

    header.appendChild(title);
    header.appendChild(closeButton);
    this._modalWindow.appendChild(header);

    this._tabContentElement = document.createElement('div');
    this._tabContentElement.className = 'project-settings-content';
    this._tabContentElement.style.cssText = `
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 10px;
    `;

    this._settingsContainer = document.createElement('div');
    this._settingsContainer.className = 'project-settings-container';
    this._tabContentElement.appendChild(this._settingsContainer);

    this._modalWindow.appendChild(this._tabContentElement);
    this._modalOverlay.appendChild(this._modalWindow);
    this._parentElement.appendChild(this._modalOverlay);
  }

  /**
   * 表示内容を更新
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
    const projectForm = document.createElement('form');
    projectForm.addEventListener('submit', e => e.preventDefault()); // デフォルト送信抑止

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
    projectForm.appendChild(createRow('プロジェクト名:', createTextInput('worldName', currentSettings.worldName)));
    projectForm.appendChild(createRow('プロジェクト説明:', createTextareaInput('worldDescription', currentSettings.worldDescription)));
    projectForm.appendChild(createRow('赤道長 (km):', createNumberInput('equatorLength', currentSettings.equatorLength, 1, undefined, 1), '地図の縮尺基準となります。'));
    projectForm.appendChild(createRow('ズーム最小倍率:', createNumberInput('zoomMin', currentSettings.zoomMin, 0.1, 10000, 0.1), '0.1〜10000の範囲で設定します。'));
    projectForm.appendChild(createRow('ズーム最大倍率:', createNumberInput('zoomMax', currentSettings.zoomMax, 0.1, 10000, 0.1)));
    projectForm.appendChild(createRow('タイムライン最小年:', createNumberInput('sliderMin', currentSettings.sliderMin, undefined, undefined, 1)));
    projectForm.appendChild(createRow('タイムライン最大年:', createNumberInput('sliderMax', currentSettings.sliderMax, undefined, undefined, 1)));
    projectForm.appendChild(createRow('グリッド間隔 (度):', createNumberInput('gridInterval', currentSettings.gridInterval, 1, 90, 1)));
    projectForm.appendChild(createRow('グリッド色:', createColorInput('gridColor', currentSettings.gridColor)));
    projectForm.appendChild(createRow('グリッド不透明度 (0-1):', createNumberInput('gridOpacity', currentSettings.gridOpacity, 0, 1, 0.01)));

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
    saveButton.addEventListener('click', () => this._handleSaveSettings(projectForm));
    buttonContainer.appendChild(saveButton);

    const defaultsButton = document.createElement('button');
    defaultsButton.type = 'button';
    defaultsButton.textContent = 'デフォルトに戻す';
    defaultsButton.addEventListener('click', () => this._handleResetToDefaults(projectForm));
    buttonContainer.appendChild(defaultsButton);

    projectForm.appendChild(buttonContainer);
    this._settingsContainer.appendChild(projectForm);

    if (this._configManager && typeof this._configManager.get === 'function') {
      const appSection = document.createElement('div');
      appSection.style.marginTop = '20px';

      const appTitle = document.createElement('div');
      appTitle.textContent = 'アプリ設定';
      appTitle.style.fontWeight = 'bold';
      appTitle.style.marginBottom = '8px';
      appSection.appendChild(appTitle);

      const appForm = document.createElement('form');
      appForm.addEventListener('submit', e => e.preventDefault());

      const snapPixelsRaw = this._configManager.get('ui.sharedVertexSnapPixels', 50);
      const snapPixels = Number.isFinite(snapPixelsRaw) ? snapPixelsRaw : 50;
      appForm.appendChild(createRow(
        '共有頂点スナップ距離 (px):',
        createNumberInput('sharedVertexSnapPixels', snapPixels, 1, undefined, 1),
        'ドラッグ時に共有頂点化する距離の基準です。'
      ));

      const renderFpsRaw = this._configManager.get('ui.renderFps', 60);
      const renderFps = Number.isFinite(renderFpsRaw) ? renderFpsRaw : 60;
      appForm.appendChild(createRow(
        '描画更新頻度 (FPS):',
        createNumberInput('renderFps', renderFps, 1, 60, 1),
        '地図描画の最大更新頻度です。低くすると描画負荷を抑えられます。'
      ));

      const appButtonContainer = document.createElement('div');
      appButtonContainer.style.marginTop = '20px';
      appButtonContainer.style.textAlign = 'right';
      appButtonContainer.style.display = 'flex';
      appButtonContainer.style.justifyContent = 'flex-end';
      appButtonContainer.style.gap = '10px';

      const appSaveButton = document.createElement('button');
      appSaveButton.type = 'button';
      appSaveButton.textContent = 'アプリ設定を保存';
      appSaveButton.addEventListener('click', () => this._handleSaveAppSettings(appForm));
      appButtonContainer.appendChild(appSaveButton);

      const appDefaultsButton = document.createElement('button');
      appDefaultsButton.type = 'button';
      appDefaultsButton.textContent = 'デフォルトに戻す';
      appDefaultsButton.addEventListener('click', () => this._handleResetAppSettings(appForm));
      appButtonContainer.appendChild(appDefaultsButton);

      appForm.appendChild(appButtonContainer);
      appSection.appendChild(appForm);
      this._settingsContainer.appendChild(appSection);
    }
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
      zoomMin: parseFloat(formData.get('zoomMin')),
      zoomMax: parseFloat(formData.get('zoomMax')),
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
    if (isNaN(newSettings.zoomMin) || newSettings.zoomMin < 0.1 || newSettings.zoomMin > 10000) {
      alert("ズーム最小倍率は0.1から10000の範囲で入力してください。"); return;
    }
    if (isNaN(newSettings.zoomMax) || newSettings.zoomMax < 0.1 || newSettings.zoomMax > 10000) {
      alert("ズーム最大倍率は0.1から10000の範囲で入力してください。"); return;
    }
    if (newSettings.zoomMin >= newSettings.zoomMax) {
      alert("ズーム最小倍率はズーム最大倍率より小さくしてください。"); return;
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
      formElement.zoomMin.value = defaultSettings.zoomMin;
      formElement.zoomMax.value = defaultSettings.zoomMax;
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

  _handleSaveAppSettings(formElement) {
    if (!this._configManager || typeof this._configManager.set !== 'function') {
      alert('設定マネージャーが利用できません。');
      return;
    }
    const formData = new FormData(formElement);
    const snapPixels = parseFloat(formData.get('sharedVertexSnapPixels'));
    const renderFps = parseInt(formData.get('renderFps'), 10);

    if (isNaN(snapPixels) || snapPixels <= 0) {
      alert('共有頂点スナップ距離は正の数値で入力してください。');
      return;
    }
    if (isNaN(renderFps) || renderFps < 1 || renderFps > 60) {
      alert('描画更新頻度は1から60の範囲で入力してください。');
      return;
    }

    this._configManager.set('ui.sharedVertexSnapPixels', snapPixels);
    this._configManager.set('ui.renderFps', renderFps);
    alert('アプリ設定を保存しました。');
  }

  _handleResetAppSettings(formElement) {
    if (!this._configManager || typeof this._configManager.set !== 'function') {
      alert('設定マネージャーが利用できません。');
      return;
    }

    const defaultSnapPixels = 50;
    const defaultRenderFps = 60;
    formElement.sharedVertexSnapPixels.value = defaultSnapPixels;
    formElement.renderFps.value = defaultRenderFps;
    this._configManager.set('ui.sharedVertexSnapPixels', defaultSnapPixels);
    this._configManager.set('ui.renderFps', defaultRenderFps);
    alert('アプリ設定をデフォルト値にリセットしました。');
  }

  /**
   * このタブのメインDOM要素を取得
   * @returns {HTMLElement}
   */
  getDOMElement() {
    return this._modalOverlay;
  }

  /**
   * 表示状態を設定
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (visible) {
      this.open();
    } else {
      this.close();
    }
  }

  open() {
    this.update();
    this._modalOverlay.style.display = 'flex';
    this._modalOverlay.focus();
    document.body.classList.add('project-settings-open');
  }

  close() {
    this._modalOverlay.style.display = 'none';
    document.body.classList.remove('project-settings-open');
  }
}
