/**
 * アプリケーション全体の設定
 */
export class Config {
  constructor() {
    // デフォルト設定
    this._config = {
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
      }
    };
  }

  /**
   * 設定値を取得
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
  }

  /**
   * 設定セクションを取得
   * @param {string} section - セクション名
   * @returns {Object} セクション設定
   */
  getSection(section) {
    return JSON.parse(JSON.stringify(this._config[section] || {}));
  }

  /**
   * 設定セクションを更新
   * @param {string} section - セクション名
   * @param {Object} updates - 更新内容
   */
  updateSection(section, updates) {
    if (!this._config[section]) {
      this._config[section] = {};
    }
    
    this._config[section] = this._deepMerge(this._config[section], updates);
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