// src/presentation/view-models/EditingViewModel.js
import { addingMethods } from './EditingViewModelAdding.js';
import { draggingMethods } from './EditingViewModelDragging.js';
import { operationMethods } from './EditingViewModelOperations.js';
// HistoryService はDIで渡されるのでimport不要


/**
 * 編集関連の状態管理
 */
export class EditingViewModel {
  /**
   * 編集ビューモデルを作成
   * @param {EditFeatureUseCase} editFeatureUseCase - 地理オブジェクト編集ユースケース
   * @param {EventBus} eventBus - イベントバス
   * @param {HistoryService} historyService - アンドゥ・リドゥサービス (ファサード)
   */
  constructor(editFeatureUseCase, eventBus, historyService) { // historyService を追加
    this._editFeatureUseCase = editFeatureUseCase;
    this._eventBus = eventBus;
    this._historyService = historyService; // 保持

    // 編集の状態 
    this._mode = 'view';
    this._tool = null;
    this._addingPoints = [];
    this._targetPolygon = null;
    this._targetRingIdForHole = null;
    this._addingSubMode = null;
    this._temporaryElements = [];
    this._draggingVerticesInfo = new Map();
    this._pendingVertexAdditionInfo = null; // 線上点追加からドラッグ操作への連携用

    // アンドゥ・リドゥ関連のプロパティは削除: _undoStack, _redoStack, _maxHistorySize

    this._observers = [];

    // HistoryChanged イベントを購読してUIに通知
    this._eventBus.subscribe('HistoryChanged', this._onHistoryChanged.bind(this));
  }

  /**
   * 編集モードを設定
   */
  setMode(mode) {
    if (this._mode !== mode) {
      if (this._addingPoints.length > 0 || this._addingSubMode) {
        this._clearAddingState();
      }
      if (this._draggingVerticesInfo.size > 0) {
         this._resetDraggingState();
      }
      if (this._pendingVertexAdditionInfo) {
          this._pendingVertexAdditionInfo = null;
      }
      if (mode !== 'edit') {
        this.clearTemporaryElements();
      }
      this._mode = mode;
      this._tool = null;
      this._notifyObservers('mode');
    }
  }

  /**
   * 編集ツールを設定
   */
  setTool(tool) {
    if (this._tool !== tool) {
      if (this._addingPoints.length > 0 || this._addingSubMode) {
        this._clearAddingState();
      }
      if (this._draggingVerticesInfo.size > 0) {
         this._resetDraggingState();
      }
      if (this._pendingVertexAdditionInfo) {
          this._pendingVertexAdditionInfo = null;
      }
       this.clearTemporaryElements();
      this._tool = tool;
      this._notifyObservers('tool');
    }
  }

  /**
   * 編集モードを取得
   * @returns {string} 編集モード
   */
  getMode() {
    return this._mode;
  }

  /**
   * 編集ツールを取得
   * @returns {string} 編集ツール
   */
  getTool() {
    return this._tool;
  }

  /**
   * 一時的な表示要素を追加
   * @param {Object} element - 表示要素
   */
  addTemporaryElement(element) {
    this._temporaryElements.push(element);
    this._notifyObservers('temporaryElements');
  }

  /**
   * 一時的な表示要素をクリア
   */
  clearTemporaryElements() {
    if (this._temporaryElements.length > 0) {
        this._temporaryElements = [];
        this._notifyObservers('temporaryElements');
    }
  }

  /**
   * 一時的な表示要素を取得
   * @returns {Array} 表示要素の配列
   */
  getTemporaryElements() {
    return this._temporaryElements;
  }

  /**
   * アンドゥ
   * @returns {Promise<void>}
   */
  async undo() {
    if (!this._historyService.canUndo()) return;
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();
    try {
      await this._historyService.undo();
    } catch (error) {
      console.error('アンドゥに失敗しました (ViewModel)', error);
      alert(`アンドゥに失敗しました: ${error.message}`);
    }
  }

  /**
   * リドゥ
   * @returns {Promise<void>}
   */
  async redo() {
    if (!this._historyService.canRedo()) return;
    if (this._draggingVerticesInfo.size > 0) this._resetDraggingState();
    if (this._addingPoints.length > 0 || this._addingSubMode) this._clearAddingState();
    try {
      await this._historyService.redo();
    } catch (error) {
      console.error('リドゥに失敗しました (ViewModel)', error);
      alert(`リドゥに失敗しました: ${error.message}`);
    }
  }

  /**
   * アンドゥ可能かどうかを取得
   * @returns {boolean} アンドゥ可能ならtrue
   */
  canUndo() {
    return this._historyService ? this._historyService.canUndo() : false;
  }

  /**
   * リドゥ可能かどうかを取得
   * @returns {boolean} リドゥ可能ならtrue
   */
  canRedo() {
    return this._historyService ? this._historyService.canRedo() : false;
  }

  /**
   * HistoryService からのイベントを処理
   * @param {Object} data - { canUndo: boolean, canRedo: boolean }
   * @private
   */
  _onHistoryChanged(data) {
      this._notifyObservers('history', data); // 自身のObserverに通知
  }

  /**
   * 観測者を登録
   * @param {Function} observer - コールバック関数 (type, data) => void
   */
  addObserver(observer) { if (!this._observers.includes(observer)) { this._observers.push(observer); } }

  /**
   * 観測者を削除
   * @param {Function} observer - 削除する観測者
   */
  removeObserver(observer) { const index = this._observers.indexOf(observer); if (index !== -1) { this._observers.splice(index, 1); } }

  /**
   * 観測者に通知
   * @param {string} type - 変更タイプ
   * @param {any} [dataOverride] - 通知するデータを上書きする場合に指定
   * @private
   */
  _notifyObservers(type, dataOverride) {
    const data = dataOverride !== undefined ? dataOverride : this._getStateForType(type);
    for (const observer of this._observers) {
      try { observer(type, data); } catch (error) { console.error("Error in observer:", error); }
    }
  }

  /**
   * タイプに応じた状態データを取得
   * @param {string} type - 変更タイプ
   * @returns {*} 状態データ
   * @private
   */
  _getStateForType(type) {
    switch (type) {
      case 'mode': return this._mode;
      case 'tool': return this._tool;
      case 'addingPoints': return this._addingPoints;
      case 'targetPolygon': return this._targetPolygon;
      case 'addingSubMode': return this._addingSubMode;
      case 'targetRingIdForHole': return this._targetRingIdForHole;
      case 'temporaryElements': return this._temporaryElements;
      case 'draggingVertices': return this._draggingVerticesInfo;
      case 'history': return { canUndo: this.canUndo(), canRedo: this.canRedo() };
      case 'addingState':
        return {
          addingPoints: this._addingPoints,
          targetPolygon: this._targetPolygon,
          addingSubMode: this._addingSubMode,
          targetRingIdForHole: this._targetRingIdForHole
        };
      default: return null;
    }
  }
}

Object.assign(EditingViewModel.prototype, addingMethods);
Object.assign(EditingViewModel.prototype, draggingMethods);
Object.assign(EditingViewModel.prototype, operationMethods);
