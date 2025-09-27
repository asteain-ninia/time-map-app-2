# テスト実装計画メモ

## 1. 現在のカバレッジ状況
- ドメイン層: TimePoint / Property / GeometryService / TimeService / LayerService の主要パスは網羅済み。GeometryService の距離計算ユーティリティの一部が未検証。
- インフラ層: JSONWorldRepository, JSONSerializer, ConfigManager, FileSystem の入出力・バックアップを確認済み。
- アプリケーション層: HistoryService, HistoryStackManager, ManageLayersUseCase, NavigateTimeUseCase, EditFeatureUseCase, VertexEditUseCase の基本挙動をカバー。HistoryService の `executeAndRecord` が生成する `'deleteVertices'`, `'updateProperties'`, `'addRing'`, `'addVertexToEdge'` 分岐は未テスト。
- プレゼンテーション層: MapViewModel / TimelineViewModel / EditingViewModel のイベント駆動挙動を検証。ただし MapViewModel は `EditFeatureUseCase._worldRepository` に直接依存するスタブ構成。
- 統合タスク: HistoryService + EditFeatureUseCase + HistoryCommand のシナリオを追加済みだが、点追加・頂点移動・削除に限定。

## 2. 次に着手するテスト候補
1. **History undo/redo 拡張**
   - `'deleteVertices'`, `'updateProperties'`, `'addRing'`, `'addVertexToEdge'` を使った `executeAndRecord` の統合シナリオ追加。
   - 各コマンド (AddRingCommand など) のユニットテストで serialize/deserialize と副作用を検証。
2. **設定・検証系の強化**
   - `UpdateProjectSettingsUseCase.execute` のバリデーションエラー、正常保存、`WorldRepository.saveWorld` 呼び出しを確認。
   - `ManageLayersUseCase` で `validateLayerHierarchy` が false を返すケースと再ソート後の order 再計算を確認。
3. **ドメインサービスの境界値**
   - GeometryService の `calculateDistanceSq`, `calculateGreatCirclePath`, `isPointInPolygon`, `doPolygonsOverlap` など未使用 API。
   - TimeService の null 月/日扱い、負の advance/retreat、大きな日数を跨ぐケース。

## 3. 注意点・ハマりどころ
- Property / TimePoint は不正引数を補正するので、HistorySerializer が返すデータをそのまま利用すること。
- IdGenerationService は決定論的なスタブを用意しないと Undo/Redo が安定再現しない。
- EventBus の publish 回数 (WorldUpdated, HistoryChanged) を検証し、履歴 UI 連携が壊れていないか担保。
- WorldRepository は `getWorld`→`saveWorld`→`getWorld` が同一参照を返す点に注意。必要に応じて deep copy を挟む。

## 4. 進め方の提案
1. `createTestContext` を拡張し、頂点削除・プロパティ更新・リング追加・辺への頂点追加用の payload helper を用意。
2. コマンド単体テストを `tests/application/history/commands/` に追加し、UseCase 例外で undo stack を復元する失敗パターンも検証。
3. 設定系・レイヤー系テストでは `vi.spyOn` で repository 呼び出しと warning を捕捉し、期待するバリデーションメッセージを確認。
4. GeometryService / TimeService の境界ケースをドメインテストに追記し、将来的なカスタムカレンダーでも落ちないようデータ駆動化。
5. MapViewModel のスタブを WorldRepository 互換のラッパーに差し替え、実装詳細の変更に備える。

## 5. 既存自動テストの課題
- `tests/application/manageLayersUseCase.test.js` は layerService の検証失敗を想定しておらず、保護ロジックが未確認。
- `tests/domain/timeService.test.js` は月/日の null や負の advance を扱わず、進み戻りの境界挙動が保証されていない。
- `tests/domain/geometryService.test.js` では多角形重なりや大円経路など公開 API の多くが未検証。
- `tests/application/history/historyIntegration.test.js` は `'add'`, `'delete'`, `'moveVertices'` のみで、他コマンド分岐や Redo の破棄条件を確認していない。
- `tests/presentation/viewModels.test.js` は内部フィールドアクセスに依存しており、実装詳細変更で壊れる恐れがある。

---
テストが整ったタイミングでこのメモを削除すること。
