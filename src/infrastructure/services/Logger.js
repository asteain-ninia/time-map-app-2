/**
 * ロギングサービス
 */
export class Logger {
  /**
   * ロガーを作成
   * @param {number} [level=3] - ログレベル（0-4）
   */
  constructor(level = 3) {
    this._level = level;
    this._levels = {
      ERROR: 1,
      WARN: 2,
      INFO: 3,
      DEBUG: 4
    };
  }

  /**
   * ログレベルを設定
   * @param {number} level - 新しいログレベル
   */
  setLevel(level) {
    this._level = level;
  }

  /**
   * エラーログ
   * @param {string} context - コンテキスト情報
   * @param {string} message - メッセージ
   * @param {Error} [error] - エラーオブジェクト
   */
  error(context, message, error) {
    if (this._level >= this._levels.ERROR) {
      this._log('ERROR', context, message, error);
    }
  }

  /**
   * 警告ログ
   * @param {string} context - コンテキスト情報
   * @param {string} message - メッセージ
   */
  warn(context, message) {
    if (this._level >= this._levels.WARN) {
      this._log('WARN', context, message);
    }
  }

  /**
   * 情報ログ
   * @param {string} context - コンテキスト情報
   * @param {string} message - メッセージ
   */
  info(context, message) {
    if (this._level >= this._levels.INFO) {
      this._log('INFO', context, message);
    }
  }

  /**
   * デバッグログ
   * @param {string} context - コンテキスト情報
   * @param {string} message - メッセージ
   */
  debug(context, message) {
    if (this._level >= this._levels.DEBUG) {
      this._log('DEBUG', context, message);
    }
  }

  /**
   * ログ出力
   * @param {string} level - ログレベル
   * @param {string} context - コンテキスト情報
   * @param {string} message - メッセージ
   * @param {Error} [error] - エラーオブジェクト
   * @private
   */
  _log(level, context, message, error) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${level}] ${timestamp} [${context}] ${message}`;
    
    if (error) {
      logMessage += `\nStack: ${error.stack || error}`;
    }
    
    // レベルに応じた出力方法
    switch (level) {
      case 'ERROR':
        console.error(logMessage);
        break;
      case 'WARN':
        console.warn(logMessage);
        break;
      case 'INFO':
        console.info(logMessage);
        break;
      case 'DEBUG':
        console.debug(logMessage);
        break;
      default:
        console.log(logMessage);
    }
    
    // ここに外部ロギングシステムへの送信なども実装可能
  }
}