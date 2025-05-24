// src/presentation/views/sidebar/LayersTabView.js

// ManageLayersUseCase, MapViewModel, EventBus はコンストラクタで受け取る想定
// ドメインエンティティの直接インポートは原則避けるが、型情報として必要なら追加

export class LayersTabView {
  /**
   * LayersTabView を作成
   * @param {HTMLElement} parentElement - このタブビューの親となるDOM要素
   * @param {MapViewModel} mapViewModel
   * @param {ManageLayersUseCase} manageLayersUseCase
   * @param {EventBus} eventBus
   */
  constructor(parentElement, mapViewModel, manageLayersUseCase, eventBus) {
    this._parentElement = parentElement;
    this._mapViewModel = mapViewModel;
    this._manageLayersUseCase = manageLayersUseCase;
    this._eventBus = eventBus;

    this._tabContentElement = null;
    this._layersContainer = null; // レイヤーアイテムを保持するコンテナ

    this._initializeDOM();
  }

  /**
   * タブビューのDOM要素を初期化
   * @private
   */
  _initializeDOM() {
    this._tabContentElement = document.createElement('div');
    this._tabContentElement.className = 'sidebar-tab-content layers-tab-content';
    this._tabContentElement.style.cssText = `
      flex: 1; 
      overflow-y: auto; /* 縦スクロールのみ */
      overflow-x: hidden; /* 横スクロールは不要 */
      padding: 10px; 
      display: none; /* 初期状態は非表示 */
    `;

    // レイヤー追加ボタン
    const addLayerButton = document.createElement('button');
    addLayerButton.textContent = '+ レイヤー追加';
    addLayerButton.style.marginBottom = '10px';
    addLayerButton.addEventListener('click', this._showAddLayerDialog.bind(this));
    this._tabContentElement.appendChild(addLayerButton);

    // レイヤー一覧のコンテナ
    this._layersContainer = document.createElement('div');
    this._layersContainer.className = 'layers-container';
    this._tabContentElement.appendChild(this._layersContainer);

    this._parentElement.appendChild(this._tabContentElement);
  }

  /**
   * タブの表示を更新 (SidebarViewの_switchTabから呼び出される想定)
   */
  update() {
    const world = this._mapViewModel.getWorld();
    if (!world) {
      this._layersContainer.innerHTML = '<p>プロジェクトデータがロードされていません。</p>';
      return;
    }
    if (!world.layers || world.layers.length === 0) {
      this._layersContainer.innerHTML = '<p>レイヤーがありません。</p>';
      return;
    }

    this._layersContainer.innerHTML = ''; // 既存のレイヤーアイテムをクリア

    // レイヤーを順序でソート
    const sortedLayers = [...world.layers].sort((a, b) => a.order - b.order);

    // レイヤー一覧の表示
    sortedLayers.forEach(layer => {
      const layerItem = document.createElement('div');
      layerItem.className = 'layer-item';
      layerItem.dataset.layerId = layer.id;
      layerItem.style.cssText = `
        padding: 5px;
        border: 1px solid #ddd;
        margin-bottom: 5px;
        background-color: #fff;
        display: flex;
        align-items: center;
        gap: 5px; /* 要素間の間隔 */
      `;

      // 表示/非表示チェックボックス
      const visibilityCheckbox = document.createElement('input');
      visibilityCheckbox.type = 'checkbox';
      visibilityCheckbox.checked = layer.visible;
      visibilityCheckbox.title = layer.visible ? "レイヤーを非表示" : "レイヤーを表示";
      visibilityCheckbox.addEventListener('change', e => {
        this._updateLayerVisibility(layer.id, e.target.checked);
      });

      // レイヤー名
      const nameLabel = document.createElement('span');
      nameLabel.textContent = layer.name;
      nameLabel.style.flex = '1'; // 名前の部分が幅を占めるように

      // 不透明度入力
      const opacityContainer = document.createElement('div');
      opacityContainer.style.display = 'flex';
      opacityContainer.style.alignItems = 'center';

      const opacityLabel = document.createElement('span');
      opacityLabel.textContent = '不透明度:';
      opacityLabel.style.fontSize = '0.8em';
      opacityLabel.style.marginRight = '3px';

      const opacityInput = document.createElement('input');
      opacityInput.type = 'number';
      opacityInput.min = '0';
      opacityInput.max = '1';
      opacityInput.step = '0.1';
      opacityInput.value = layer.opacity;
      opacityInput.style.width = '45px';
      opacityInput.title = "レイヤーの不透明度 (0-1)";
      opacityInput.addEventListener('change', e => {
        const value = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
        opacityInput.value = value; // 値を正規化してUIに反映
        this._updateLayerOpacity(layer.id, value);
      });
      opacityContainer.appendChild(opacityLabel);
      opacityContainer.appendChild(opacityInput);


      // 編集ボタン
      const editButton = document.createElement('button');
      editButton.textContent = '編集';
      editButton.title = "レイヤー名を編集";
      editButton.addEventListener('click', () => {
        this._showEditLayerDialog(layer, layerItem); // layerItemを渡してフォームの挿入位置を指定
      });

      // 削除ボタン
      const deleteButton = document.createElement('button');
      deleteButton.textContent = '削除';
      deleteButton.title = "レイヤーを削除";
      deleteButton.addEventListener('click', () => {
        this._showDeleteLayerConfirm(layer);
      });

      layerItem.appendChild(visibilityCheckbox);
      layerItem.appendChild(nameLabel);
      layerItem.appendChild(opacityContainer);
      layerItem.appendChild(editButton);
      layerItem.appendChild(deleteButton);

      this._layersContainer.appendChild(layerItem);
    });
  }

  /**
   * レイヤー表示状態の更新
   * @param {string} layerId - レイヤーID
   * @param {boolean} visible - 表示状態
   * @private
   */
  async _updateLayerVisibility(layerId, visible) {
    try {
      const layer = await this._manageLayersUseCase.updateLayer(layerId, { visible });
      this._eventBus.publish('LayerVisibilityChanged', { layerId, layer }); // MapViewModelが購読
      // this.update(); // SidebarViewの_onMapViewModelChanged経由で呼ばれるので不要
    } catch (error) {
      console.error('レイヤー表示状態の更新に失敗しました', error);
      alert(`レイヤー表示状態の更新エラー: ${error.message}`);
    }
  }

  /**
   * レイヤー不透明度の更新
   * @param {string} layerId - レイヤーID
   * @param {number} opacity - 不透明度
   * @private
   */
  async _updateLayerOpacity(layerId, opacity) {
    try {
      const layer = await this._manageLayersUseCase.updateLayer(layerId, { opacity });
      this._eventBus.publish('LayerVisibilityChanged', { layerId, layer }); // MapViewModelが購読
      // this.update(); // SidebarViewの_onMapViewModelChanged経由で呼ばれるので不要
    } catch (error) {
      console.error('レイヤー不透明度の更新に失敗しました', error);
      alert(`レイヤー不透明度の更新エラー: ${error.message}`);
    }
  }

  /**
   * レイヤー追加用の入力フォームを表示
   * @private
   */
  _showAddLayerDialog() {
    // 既存の入力フォームがあれば削除
    this._removeExistingInputForm();

    const formElement = this._createLayerInputForm(
      '', 
      '追加', 
      (name) => {
        if (name) this._addLayer(name);
        formElement.remove();
      },
      () => formElement.remove()
    );
    // フォームをレイヤーコンテナの先頭に追加
    this._layersContainer.insertBefore(formElement, this._layersContainer.firstChild);
    formElement.querySelector('input[type="text"]')?.focus();
  }

  /**
   * レイヤー編集用の入力フォームを表示
   * @param {Layer} layer - 編集するレイヤー
   * @param {HTMLElement} layerItemElement - フォームを挿入する基準となるレイヤーアイテム要素
   * @private
   */
  _showEditLayerDialog(layer, layerItemElement) {
    this._removeExistingInputForm();

    const formElement = this._createLayerInputForm(
      layer.name,
      '保存',
      (name) => {
        if (name && name !== layer.name) this._updateLayerName(layer.id, name);
        formElement.remove();
      },
      () => formElement.remove()
    );
    // 特定のレイヤーアイテムの直後にフォームを挿入
    layerItemElement.insertAdjacentElement('afterend', formElement);
    const inputField = formElement.querySelector('input[type="text"]');
    if (inputField) {
        inputField.focus();
        inputField.select();
    }
  }

  /**
   * 汎用的なレイヤー入力フォームを作成
   * @param {string} initialName - 初期名
   * @param {string} okButtonText - OKボタンのテキスト
   * @param {function(string)} onOk - OKボタンクリック時のコールバック (引数は入力された名前)
   * @param {function} onCancel - キャンセルボタンクリック時のコールバック
   * @returns {HTMLDivElement} 作成されたフォーム要素
   * @private
   */
  _createLayerInputForm(initialName, okButtonText, onOk, onCancel) {
    const formElement = document.createElement('div');
    formElement.className = 'layer-input-form'; // CSSでのスタイル付け用クラス
    formElement.style.cssText = `
        margin-bottom: 10px;
        padding: 8px;
        border: 1px solid #ccc;
        background-color: #f9f9f9;
    `;

    const label = document.createElement('label');
    label.textContent = 'レイヤー名: ';
    label.style.display = 'block';
    label.style.marginBottom = '5px';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialName;
    input.style.width = 'calc(100% - 10px)'; // paddingを考慮
    input.style.marginBottom = '8px';
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            onOk(input.value.trim());
        } else if (e.key === 'Escape') {
            onCancel();
        }
    });


    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.display = 'flex';
    buttonsDiv.style.justifyContent = 'flex-end';
    buttonsDiv.style.gap = '5px';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'キャンセル';
    cancelButton.addEventListener('click', onCancel);

    const okButton = document.createElement('button');
    okButton.textContent = okButtonText;
    okButton.addEventListener('click', () => onOk(input.value.trim()));

    buttonsDiv.appendChild(cancelButton);
    buttonsDiv.appendChild(okButton);

    formElement.appendChild(label);
    formElement.appendChild(input);
    formElement.appendChild(buttonsDiv);

    return formElement;
  }
  
  /**
   * 既存の入力フォームを削除するヘルパー
   * @private
   */
  _removeExistingInputForm() {
    const existingForm = this._tabContentElement.querySelector('.layer-input-form');
    if (existingForm) {
      existingForm.remove();
    }
  }


  /**
   * レイヤー削除確認の表示
   * @param {Layer} layer - レイヤー
   * @private
   */
  _showDeleteLayerConfirm(layer) {
    const confirmResult = window.confirm(`レイヤー「${layer.name}」を削除してもよろしいですか？\nこの操作は元に戻せません。`);
    if (confirmResult) {
      this._deleteLayer(layer.id);
    }
  }

  /**
   * レイヤー追加
   * @param {string} name - レイヤー名
   * @private
   */
  async _addLayer(name) {
    try {
      await this._manageLayersUseCase.addLayer(name);
      // this.update(); // ViewModelの変更通知でSidebarView経由で更新されるはず
      // 直接 MapViewModel に通知を促すか、EventBus を使う
      this._eventBus.publish('LayersChanged'); // SidebarView (ファサード) が購読して関連タブを更新
    } catch (error) {
      console.error('レイヤーの追加に失敗しました (LayersTabView)', error);
      alert('レイヤーの追加に失敗しました: ' + error.message);
    }
  }

  /**
   * レイヤー名の更新
   * @param {string} layerId - レイヤーID
   * @param {string} name - 新しい名前
   * @private
   */
  async _updateLayerName(layerId, name) {
    try {
      await this._manageLayersUseCase.updateLayer(layerId, { name });
      this._eventBus.publish('LayersChanged');
    } catch (error) {
      console.error('レイヤー名の更新に失敗しました (LayersTabView)', error);
      alert('レイヤー名の更新に失敗しました: ' + error.message);
    }
  }

  /**
   * レイヤーの削除
   * @param {string} layerId - レイヤーID
   * @private
   */
  async _deleteLayer(layerId) {
    try {
      await this._manageLayersUseCase.deleteLayer(layerId);
      this._eventBus.publish('LayersChanged');
    } catch (error) {
      console.error('レイヤーの削除に失敗しました (LayersTabView)', error);
      alert('レイヤーの削除に失敗しました: ' + error.message);
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