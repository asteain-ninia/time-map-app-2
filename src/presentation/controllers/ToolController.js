/**
 * 編集ツール操作処理
 */
export class ToolController {
  /**
   * ツールコントローラを作成
   * @param {ToolbarView} toolbarView - ツールバービュー
   * @param {EditingViewModel} editingViewModel - 編集ビューモデル
   */
  constructor(toolbarView, editingViewModel) {
    this._toolbarView = toolbarView;
    this._editingViewModel = editingViewModel;
    
    // 初期化
    this._initialize();
  }

  /**
   * 初期化
   * @private
   */
  _initialize() {
    // 初期モードの設定
    this._editingViewModel.setMode('view');
  }

  /**
   * モードの設定
   * @param {string} mode - モード
   */
  setMode(mode) {
    this._editingViewModel.setMode(mode);
  }

  /**
   * ツールの設定
   * @param {string} tool - ツール
   */
  setTool(tool) {
    this._editingViewModel.setTool(tool);
  }

  /**
   * アンドゥの実行
   */
  undo() {
    this._editingViewModel.undo();
  }

  /**
   * リドゥの実行
   */
  redo() {
    this._editingViewModel.redo();
  }
}