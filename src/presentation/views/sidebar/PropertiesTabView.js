// src/presentation/views/sidebar/PropertiesTabView.js

import { TimePoint } from '../../../domain/value-objects/TimePoint.js';
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
    const currentTime = this._mapViewModel.getCurrentTime(); // 現在時刻はViewModelから取得
    
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
    const timeRow = document.createElement('div');
    timeRow.style.marginBottom = '10px';
    timeRow.innerHTML = `
      <label style="display: block; margin-bottom: 3px;">存在期間:</label>
      <span>開始: </span><input type="number" name="startYear" style="width: 70px;" value="${currentProperty.startTime ? currentProperty.startTime.year : ''}">
      <span> 終了: </span><input type="number" name="endYear" style="width: 70px;" value="${currentProperty.endTime ? currentProperty.endTime.year : ''}">
    `;
    form.appendChild(timeRow);

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
    
    const startYearStr = formData.get('startYear');
    const endYearStr = formData.get('endYear');

    // yearが空文字列やnullの場合、Number()は0になるので、明示的にnullを扱う
    const startYear = (startYearStr !== null && startYearStr !== '') ? Number(startYearStr) : null;
    const endYear = (endYearStr !== null && endYearStr !== '') ? Number(endYearStr) : null;
    
    // Property の _timePoint は、_startTime と同じ値にする。
    // _startTime が null の場合は、Property のコンストラクタ内でフォールバック (0年) される。
    const propertyTimePoint = startYear !== null ? new TimePoint(startYear) : null;

    const startTp = startYear !== null ? new TimePoint(startYear) : null;
    const endTp = endYear !== null ? new TimePoint(endYear) : null;

    if (startTp && endTp && endTp.isBefore(startTp)) {
        alert("終了年は開始年より後に設定してください。");
        return;
    }

    const newPropertyInstance = new Property(
      propertyTimePoint,
      name,
      description,
      { category: category },
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
