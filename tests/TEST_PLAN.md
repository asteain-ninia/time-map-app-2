# テスト実装計画メモ

## 1. 現在のカバレッジ状況
- ドメイン層: TimePoint / Property / GeometryService / TimeService / LayerService を網羅。距離計算や階層チェックなど主要ロジックはユニットテスト済み。
- インフラ層: JSONWorldRepository, JSONSerializer, ConfigManager, FileSystem の入出力と分岐を検証済み。
- アプリケーション層: HistoryService, HistoryStackManager, ManageLayersUseCase, NavigateTimeUseCase, EditFeatureUseCase, VertexEditUseCase の振る舞いをテスト済み。HistorySerializer, LayerService, TimeService など facade 的な箇所もカバー。
- プレゼンテーション層: MapViewModel / TimelineViewModel / EditingViewModel のイベント駆動と状態遷移をテスト済み。
- 残タスク: HistoryService + EditFeatureUseCase + HistoryCommand 群を跨ぐ統合シナリオ。

## 2. 次に着手するテスト候補
1. **History統合シナリオ**
   - `HistoryService.executeCommand` → Undo → Redo の往復で world / vertices / layers / イベントが期待通りに変化するか確認。
   - `AddFeatureCommand` / `DeleteFeatureCommand` / `MoveVerticesCommand` / `DeleteVerticesCommand` など性質の異なるコマンドを混在させ、スタック整合性とシリアライズ往復を検証。
   - Undo 直後の新コマンド実行で Redo がクリアされる仕様、連続操作後の `canUndo`/`canRedo` と `HistoryChanged` ペイロードを確認。
   - in-memory `WorldRepository` と固定 ID を返す `IdGenerationService`、必要最低限の `GeometryService` / `LayerService` スタブ、モック `EventBus` を用意。

## 3. 注意点・ハマりどころ
- **Property は `Property` インスタンスで保持**: 履歴に保存する地物も `new Property(...)` で生成。
- **IdGenerationService の固定化**: Undo/Redo で ID が揺れないよう、テスト内で決定的な ID を返す。
- **EventBus の発火シーケンス**: `WorldUpdated` や `FeatureAdded/Deleted` が不足・過剰にならないか、publish モックでシーケンスと引数を検証。
- **WorldRepository のキャッシュ前提**: `getWorld`→`saveWorld`→`getWorld` の流れで同じ参照が返るか、必要に応じてテスト内で再読込処理を実装。

## 4. 進め方の提案
1. テスト専用の in-memory world と serializer / repository を構築し、EditFeatureUseCase・HistoryService を実際に結線した統合フィクスチャを作成。
2. Add → Undo → Redo、Add → Move → Undo → Redo、Add → Delete → Undo → Redo など複数シナリオを用意し、world状態・イベントログ・スタック状態を比較。
3. Undo 後に別コマンドを実行するケースを追加し、Redo スタックが破棄されることを確認。
4. 必要に応じて Vertex 共有/削除など他コマンドもシナリオに組み込み、成果物の整合性と例外処理を監視。

## 5. 既存自動テストの課題
- `tests/application/editFeatureUseCase.test.js` は内部フィールドスタブに依存するため、統合シナリオの充実後にフェーズ移行を検討。
- `tests/application/manageLayersUseCase.test.js` は world 参照共有を前提としているため、防御的コピーや永続化パターンに対応する追加テストを検討。
- `tests/domain/timeService.test.js` は閏年や境界ケースの追加を要検討。
---
テストが完了したらこのメモを削除すること。
