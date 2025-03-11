/**
 * コンポーネント間の通信を仲介するイベントバス
 */
export class EventBus {
  constructor() {
    this._subscribers = {};
  }

  /**
   * イベントを購読
   * @param {string} eventType - イベントタイプ
   * @param {Function} callback - コールバック関数
   */
  subscribe(eventType, callback) {
    if (!this._subscribers[eventType]) {
      this._subscribers[eventType] = [];
    }
    
    this._subscribers[eventType].push(callback);
  }

  /**
   * イベント購読の解除
   * @param {string} eventType - イベントタイプ
   * @param {Function} callback - 解除するコールバック関数
   */
  unsubscribe(eventType, callback) {
    if (!this._subscribers[eventType]) return;
    
    this._subscribers[eventType] = this._subscribers[eventType].filter(
      subscriber => subscriber !== callback
    );
  }

  /**
   * イベントの発行
   * @param {string} eventType - イベントタイプ
   * @param {Object} [payload={}] - イベントデータ
   */
  publish(eventType, payload = {}) {
    if (!this._subscribers[eventType]) return;
    
    for (const callback of this._subscribers[eventType]) {
      callback(payload);
    }
  }
}