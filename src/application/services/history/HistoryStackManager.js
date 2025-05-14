// src/application/services/history/HistoryStackManager.js
export class HistoryStackManager {
  _undoStack = [];
  _redoStack = [];
  _maxHistorySize;

  /**
   * HistoryStackManager を作成
   * @param {number} [maxHistorySize=100] - アンドゥ履歴の最大保持数
   */
  constructor(maxHistorySize = 100) {
    this._maxHistorySize = maxHistorySize;
  }

  /**
   * アンドゥスタックに操作を追加する。
   * 最大サイズを超えた場合は最も古い操作を削除する。
   * このメソッドを呼び出すと、リドゥスタックはクリアされる。
   * @param {Object} operation - 履歴に追加する操作オブジェクト
   */
  pushUndo(operation) {
    this._undoStack.push(operation);
    if (this._undoStack.length > this._maxHistorySize) {
      this._undoStack.shift(); // 古いものから削除
    }
    this.clearRedoStack(); // 新しいアンドゥ操作が追加されたらリドゥは無効
  }

  /**
   * アンドゥスタックから操作を取り出して返す。
   * スタックが空の場合は null を返す。
   * @returns {Object | null} アンドゥ操作オブジェクト、または空の場合はnull
   */
  popUndo() {
    if (this.canUndo()) {
      return this._undoStack.pop();
    }
    return null;
  }

  /**
   * リドゥスタックに操作を追加する。
   * @param {Object} operation - リドゥスタックに追加する操作オブジェクト
   */
  pushRedo(operation) {
    this._redoStack.push(operation);
    // Redoスタックの最大サイズは通常考慮しないが、必要であればここで制限を設ける
  }

  /**
   * リドゥスタックから操作を取り出して返す。
   * スタックが空の場合は null を返す。
   * @returns {Object | null} リドゥ操作オブジェクト、または空の場合はnull
   */
  popRedo() {
    if (this.canRedo()) {
      return this._redoStack.pop();
    }
    return null;
  }

  /**
   * アンドゥ操作が可能かどうかを返す。
   * @returns {boolean} アンドゥ可能ならtrue
   */
  canUndo() {
    return this._undoStack.length > 0;
  }

  /**
   * リドゥ操作が可能かどうかを返す。
   * @returns {boolean} リドゥ可能ならtrue
   */
  canRedo() {
    return this._redoStack.length > 0;
  }

  /**
   * リドゥスタックをクリアする。
   * 主に新しいアンドゥ操作が追加された際に呼び出される。
   */
  clearRedoStack() {
    if (this._redoStack.length > 0) {
      this._redoStack = [];
    }
  }

  /**
   * (デバッグ/テスト用) 現在のアンドゥスタックの長さを取得する。
   * @returns {number}
   */
  getUndoStackLength() {
    return this._undoStack.length;
  }

  /**
   * (デバッグ/テスト用) 現在のリドゥスタックの長さを取得する。
   * @returns {number}
   */
  getRedoStackLength() {
    return this._redoStack.length;
  }
}