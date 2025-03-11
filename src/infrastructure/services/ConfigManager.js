/**
 * 設定管理
 */
export class ConfigManager {
  /**
   * 設定マネージャーを作成
   * @param {string} [storageKey="time-map-config"] - ストレージキー
   * @param {Object} [defaultConfig={}] - デフォルト設定
   */
  constructor(storageKey = "time-map-config", defaultConfig = {}) {
    this._storageKey = storageKey;
    this._defaultConfig = {
      // 地図表示設定
      map: {
        zoomMin: 0.1,
        zoomMax: 10,
        gridInterval: 10,
        gridColor: "#cccccc",
        gridOpacity: 0.5,
        equatorLength: 40000 // 赤道長（km）
      },
      
      // 時間スライダー設定
      timeline: {
        minYear: 0,
        maxYear: 10000,
        stepSize: 1
      },
      
      // 自動保存設定
      autoSave: {
        enabled: true,
        interval: 300, // 秒
        maxBackups: 5
      },
      
      // UIレイアウト設定
      ui: {
        leftPanelWidth: 250,
        rightPanelWidth: 300,
        timelineHeight: 100,
        darkMode: false
      },
      
      // カスタムカレンダー設定
      calendar: {
        daysPerYear: 365.25,
        monthsPerYear: 12,
        daysPerMonth: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      },
      
      ...defaultConfig
    };
    
    this._config = this._loadConfig();
  }

  /**
   * 現在の設定を取得
   * @returns {Object} 設定オブジェクト
   */
  getConfig() {
    return JSON.parse(JSON.stringify(this._config));
  }

  /**
   * 特定のセクションの設定を取得
   * @param {string} section - セクション名
   * @returns {Object} セクション設定
   */
  getSection(section) {
    return JSON.parse(JSON.stringify(this._config[section] || {}));
  }

  /**
   * 特定の設定値を取得
   * @param {string} path - 設定パス（例: "map.zoomMax"）
   * @param {*} [defaultValue=null] - デフォルト値
   * @returns {*} 設定値
   */
  get(path, defaultValue = null) {
    const parts = path.split('.');
    let current = this._config;
    
    for (const part of parts) {
      if (current === undefined || current === null) {
        return defaultValue;
      }
      current = current[part];
    }
    
    return current !== undefined ? current : defaultValue;
  }

  /**
   * 設定を更新
   * @param {Object} updates - 更新内容
   */
  update(updates) {
    this._config = this._deepMerge(this._config, updates);
    this._saveConfig();
  }

  /**
   * セクション設定を更新
   * @param {string} section - セクション名
   * @param {Object} updates - 更新内容
   */
  updateSection(section, updates) {
    if (!this._config[section]) {
      this._config[section] = {};
    }
    
    this._config[section] = this._deepMerge(this._config[section], updates);
    this._saveConfig();
  }

  /**
   * 特定の設定値を更新
   * @param {string} path - 設定パス（例: "map.zoomMax"）
   * @param {*} value - 新しい値
   */
  set(path, value) {
    const parts = path.split('.');
    let current = this._config;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined) {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
    this._saveConfig();
  }

  /**
   * 設定をリセット
   * @param {string} [section] - リセットするセクション（省略時は全体）
   */
  reset(section) {
    if (section) {
      this._config[section] = JSON.parse(JSON.stringify(this._defaultConfig[section] || {}));
    } else {
      this._config = JSON.parse(JSON.stringify(this._defaultConfig));
    }
    
    this._saveConfig();
  }

  /**
   * 設定を読み込み
   * @returns {Object} 設定オブジェクト
   * @private
   */
  _loadConfig() {
    try {
      const stored = localStorage.getItem(this._storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return this._deepMerge(JSON.parse(JSON.stringify(this._defaultConfig)), parsed);
      }
    } catch (error) {
      console.error("設定の読み込みに失敗しました", error);
    }
    
    return JSON.parse(JSON.stringify(this._defaultConfig));
  }

  /**
   * 設定を保存
   * @private
   */
  _saveConfig() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(this._config));
    } catch (error) {
      console.error("設定の保存に失敗しました", error);
    }
  }

  /**
   * オブジェクトの深いマージ
   * @param {Object} target - ターゲットオブジェクト
   * @param {Object} source - ソースオブジェクト
   * @returns {Object} マージされたオブジェクト
   * @private
   */
  _deepMerge(target, source) {
    const output = { ...target };
    
    if (this._isObject(target) && this._isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this._isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this._deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }

  /**
   * オブジェクトかどうかをチェック
   * @param {*} item - チェックする項目
   * @returns {boolean} オブジェクトならtrue
   * @private
   */
  _isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }
}