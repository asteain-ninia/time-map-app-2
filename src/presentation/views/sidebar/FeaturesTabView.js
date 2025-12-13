// src/presentation/views/sidebar/FeaturesTabView.js

// MapViewModel, EventBus はコンストラクタで受け取る想定

export class FeaturesTabView {
  /**
   * FeaturesTabView を作成
   * @param {HTMLElement} parentElement - このタブビューの親となるDOM要素
   * @param {MapViewModel} mapViewModel
   * @param {EventBus} eventBus
   */
  constructor(parentElement, mapViewModel, eventBus) {
    this._parentElement = parentElement;
    this._mapViewModel = mapViewModel;
    this._eventBus = eventBus; // 現状、直接は使わないが将来的に購読する可能性

    this._tabContentElement = null;
    this._featuresContainer = null;
    this._filterInput = null;

    this._initializeDOM();
  }

  /**
   * タブビューのDOM要素を初期化
   * @private
   */
  _initializeDOM() {
    this._tabContentElement = document.createElement('div');
    this._tabContentElement.className = 'sidebar-tab-content features-tab-content';
    this._tabContentElement.style.cssText = `
      flex: 1; 
      overflow-y: auto; 
      overflow-x: hidden;
      padding: 10px; 
      display: none; /* 初期状態は非表示 */
    `;

    // フィルター行
    const filterRow = document.createElement('div');
    filterRow.style.marginBottom = '10px';
    filterRow.style.display = 'flex';
    filterRow.style.alignItems = 'center';

    const filterLabel = document.createElement('span');
    filterLabel.textContent = 'フィルター: ';
    filterLabel.style.marginRight = '5px';

    this._filterInput = document.createElement('input');
    this._filterInput.type = 'text';
    this._filterInput.placeholder = '名前で検索...';
    this._filterInput.style.flex = '1'; // 入力欄が幅を占めるように
    this._filterInput.addEventListener('input', this.update.bind(this)); // 入力時にタブ内容を更新

    filterRow.appendChild(filterLabel);
    filterRow.appendChild(this._filterInput);
    this._tabContentElement.appendChild(filterRow);

    // 地物一覧のコンテナ
    this._featuresContainer = document.createElement('div');
    this._featuresContainer.className = 'features-container';
    this._tabContentElement.appendChild(this._featuresContainer);

    this._parentElement.appendChild(this._tabContentElement);
  }

  /**
   * タブの表示を更新 (SidebarViewの_switchTabから呼び出される想定)
   */
  update() {
    const features = this._mapViewModel.getFeatures(); // 現在表示中の地物のみ取得
    const currentTime = this._mapViewModel.getCurrentTime();

    this._featuresContainer.innerHTML = ''; // 既存の地物アイテムをクリア

    const filterText = this._filterInput ? this._filterInput.value.toLowerCase() : '';

    // 地物をフィルタリング
    const filteredFeatures = this._filterFeaturesByText(features, filterText, currentTime);

    if (filteredFeatures.length === 0) {
      const noFeaturesMsg = document.createElement('p');
      noFeaturesMsg.textContent = '表示する地物がありません。';
      if (filterText) {
        noFeaturesMsg.textContent += ` (フィルター: "${filterText}")`;
      }
      this._featuresContainer.appendChild(noFeaturesMsg);
      return;
    }

    // レイヤーごとにグループ化
    const groupedByLayer = this._groupFeaturesByLayer(filteredFeatures);

    // レイヤーごとに表示
    groupedByLayer.forEach(group => {
      const layerGroup = document.createElement('div');
      layerGroup.className = 'feature-layer-group';
      layerGroup.style.marginBottom = '10px';

      const layerHeader = document.createElement('h3');
      layerHeader.textContent = group.title;
      layerHeader.style.cssText = `
        margin: 5px 0;
        padding: 5px;
        background-color: #eee;
        cursor: pointer;
        font-size: 0.9em;
        font-weight: bold;
      `;

      const layerContent = document.createElement('div');
      layerContent.className = 'layer-content';
      // layerContent.style.display = 'none'; // 初期状態は折りたたむ場合

      layerHeader.addEventListener('click', () => {
        layerContent.style.display =
          layerContent.style.display === 'none' ? 'block' : 'none';
      });

      group.features.forEach(feature => {
        const prop = feature.getPropertyAt(currentTime);
        if (!prop) return;

        const featureItem = document.createElement('div');
        featureItem.className = 'feature-item';
        featureItem.style.cssText = `
          padding: 5px;
          border: 1px solid #ddd;
          margin-bottom: 2px;
          cursor: pointer;
          background-color: #fff; /* デフォルト背景色 */
        `;
        featureItem.dataset.featureId = feature.id; // 地物IDをdata属性に

        const activeFeatureId = this._mapViewModel.getActiveFeatureId();
        if (activeFeatureId === feature.id) {
          featureItem.style.backgroundColor = '#d0e0ff'; // 選択中の地物のスタイル
        }

        const nameLabel = document.createElement('span');
        nameLabel.textContent = prop.name || '名称なし';

        featureItem.addEventListener('click', () => {
          this._mapViewModel.selectFeature(feature.id);
          // クリックされたアイテムのスタイル更新はViewModelの通知経由で行う
        });

        featureItem.appendChild(nameLabel);
        layerContent.appendChild(featureItem);
      });

      layerGroup.appendChild(layerHeader);
      layerGroup.appendChild(layerContent);
      this._featuresContainer.appendChild(layerGroup);
    });
  }

  /**
   * 地物をテキストでフィルタリング
   * @param {Array<Feature>} features - 地物の配列
   * @param {string} text - フィルターテキスト
   * @param {TimePoint} currentTime - 現在の時間
   * @returns {Array<Feature>} フィルタリングされた地物の配列
   * @private
   */
  _filterFeaturesByText(features, text, currentTime) {
    if (!text) return features;
    const lowerText = text.toLowerCase();
    return features.filter(feature => {
      const property = feature.getPropertyAt(currentTime);
      if (!property) return false;
      return (
        (property.name && property.name.toLowerCase().includes(lowerText)) ||
        (property.description && property.description.toLowerCase().includes(lowerText))
      );
    });
  }

  /**
   * 地物をレイヤー単位でグループ化
   * @param {Array<Feature>} features - 地物の配列
   * @returns {Array<{title: string, layerId: string|null, features: Feature[]}>} レイヤーごとの情報
   * @private
   */
  _groupFeaturesByLayer(features) {
    const world = typeof this._mapViewModel.getWorld === 'function'
      ? this._mapViewModel.getWorld()
      : null;
    const sortedLayers = world && Array.isArray(world.layers)
      ? [...world.layers].sort((a, b) => a.order - b.order)
      : [];
    const layerBuckets = [];
    const layerBucketMap = new Map();
    sortedLayers.forEach(layer => {
      const bucket = {
        title: layer.name || `レイヤー (${layer.id})`,
        layerId: layer.id,
        features: []
      };
      layerBuckets.push(bucket);
      layerBucketMap.set(layer.id, bucket);
    });

    const fallbackBucket = { title: '不明なレイヤー', layerId: null, features: [] };

    features.forEach(feature => {
      const bucket = layerBucketMap.get(feature.layerId) || fallbackBucket;
      bucket.features.push(feature);
    });

    const result = layerBuckets.filter(bucket => bucket.features.length > 0);
    if (fallbackBucket.features.length > 0) {
      result.push(fallbackBucket);
    }
    return result;
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
