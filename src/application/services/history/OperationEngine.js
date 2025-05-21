// src/application/services/history/OperationEngine.js
import { Vertex } from '../../../domain/entities/Vertex.js';
// Point, Line, Polygon, Property は HistorySerializer がインスタンス化するため、ここでは不要

export class OperationEngine {
  _worldRepository; // EditFeatureUseCase を使わない場合のフォールバック用に残すか、完全に削除するか検討
  _serializer;
  _editFeatureUseCase; // EditFeatureUseCase への依存を追加

  /**
   * OperationEngine を作成
   * @param {WorldRepository} worldRepository
   * @param {HistorySerializer} serializer
   * @param {EditFeatureUseCase} editFeatureUseCase
   */
  constructor(worldRepository, serializer, editFeatureUseCase) {
    this._worldRepository = worldRepository; // UseCaseが使えない場合のフォールバック用として残す場合
    this._serializer = serializer;
    this._editFeatureUseCase = editFeatureUseCase;
  }

  /**
   * 履歴操作を実行 (リドゥ用)
   * @param {Object} operation - 履歴エントリオブジェクト (プレーンデータ)
   * @returns {Promise<{updatedFeature?: Object, addedFeature?: Object, deletedFeatureId?: string, deletedVertexResult?: Object, movedVerticesResult?: Object, eventType?: string, eventPayload?: any}>} イベント発行や状態更新のための情報
   */
  async execute(operation) {
    let world = await this._worldRepository.getWorld(); // worldの最新状態は常に取得
    let resultInfo = {}; // 操作結果の詳細を格納

    switch (operation.type) {
      case 'add':
        // 1. 必要な頂点をワールドに「追加」する (EditFeatureUseCaseには頂点だけを追加するメソッドがないため、WorldRepositoryを直接操作)
        if (operation.addedVerticesData && Array.isArray(operation.addedVerticesData)) {
          let verticesActuallyAddedToWorld = false;
          operation.addedVerticesData.forEach(vDataPlain => {
            const vertexInstance = this._serializer.deserialize(vDataPlain);
            if (vertexInstance instanceof Vertex && !world.vertices.some(wv => wv.id === vertexInstance.id)) {
              // プレーンオブジェクトとして頂点を保存 (WorldRepositoryの仕様に依存)
              world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
              verticesActuallyAddedToWorld = true;
            }
          });
          if (verticesActuallyAddedToWorld) await this._worldRepository.saveWorld(world);
        }
        // 2. 地物をワールドに「追加」する (EditFeatureUseCaseには履歴からの復元用addがないため、WorldRepositoryを直接操作)
        if (operation.featureData) {
          const featureInstance = this._serializer.deserialize(operation.featureData);
          if (featureInstance && !world.features.some(f => f.id === featureInstance.id)) {
            world.features.push(featureInstance);
            await this._worldRepository.saveWorld(world);
            resultInfo = { addedFeature: featureInstance, eventType: 'FeatureAdded', eventPayload: { feature: featureInstance } };
          }
        }
        break;

      case 'delete':
        // EditFeatureUseCase.deleteFeature を呼び出す
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        // deleteFeature が内部でイベント発行や頂点クリーンアップを行う
        resultInfo = { deletedFeatureId: operation.featureId, eventType: 'FeatureDeleted', eventPayload: { featureId: operation.featureId }};
        break;

      case 'deleteVertices':
        if (operation.deletedVertexIds && Array.isArray(operation.deletedVertexIds)) {
            const deleteResult = await this._editFeatureUseCase.deleteVertices(operation.deletedVertexIds);
            // deleteVertices は { deletedVertexIds, updatedFeatureIds, deletedFeatureIds } を返す
            resultInfo = { deletedVertexResult: deleteResult, eventType: 'VerticesDeletedCustom', eventPayload: deleteResult };
        }
        break;

      case 'moveVertices':
        if (operation.updates && Array.isArray(operation.updates)) {
          const updatesForUseCase = operation.updates.map(u => {
            const newPosVertex = this._serializer.deserialize(u.newPosition);
            return newPosVertex ? { vertexId: u.vertexId, newPosition: { x: newPosVertex.x, y: newPosVertex.y } } : null;
          }).filter(Boolean);
          if (updatesForUseCase.length > 0) {
            const moveResult = await this._editFeatureUseCase.moveVertices(updatesForUseCase);
            // moveVertices は { updatedVertices, affectedFeatures } を返す
            // 個別のVertexMovedイベントはuseCase内から発行される前提
            resultInfo = { movedVerticesResult: moveResult, eventType: 'MultipleVerticesMoved', eventPayload: moveResult };
          }
        }
        break;

      case 'updateProperties':
        const newPropsInstancesUpdate = operation.newProperties.map(pPlain => this._serializer.deserialize(pPlain)).filter(Boolean);
        // _editFeatureUseCase.updateFeature は { feature: DomainInstance, ... } を返す
        const updateResultRedo = await this._editFeatureUseCase.updateFeature(operation.featureId, { properties: newPropsInstancesUpdate });
        const updatedFeatureInstanceRedo = updateResultRedo.feature; // ドメインインスタンスを正しく取り出す
        resultInfo = { updatedFeature: updatedFeatureInstanceRedo, eventType: 'FeatureUpdated', eventPayload: { feature: updatedFeatureInstanceRedo }};
        break;
      
      case 'addRing':
        // 1. 必要な頂点をワールドに追加 (EditFeatureUseCaseには(略) WorldRepositoryを直接操作)
        if (operation.addedVerticesData && Array.isArray(operation.addedVerticesData)) {
            let ringVerticesAdded = false;
            operation.addedVerticesData.forEach(vDataPlain => {
              const vertexInstance = this._serializer.deserialize(vDataPlain);
              if (vertexInstance instanceof Vertex && !world.vertices.some(wv => wv.id === vertexInstance.id)) {
                world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
                ringVerticesAdded = true;
              }
            });
            if (ringVerticesAdded) {
                await this._worldRepository.saveWorld(world);
                world = await this._worldRepository.getWorld(); // world再取得
            }
        }
        // 2. リングをポリゴンに追加 (UpdateFeatureUseCase経由でPolygonEditService.addRingWithIdを呼ぶ)
        const ringToAddPlainExecute = operation.addedRing; // プレーンオブジェクト
        if (ringToAddPlainExecute && typeof ringToAddPlainExecute.id === 'string') {
            const geometryUpdate = { existingRingData: [ringToAddPlainExecute] };
            // _editFeatureUseCase.updateFeature は { feature: DomainInstance, ... } を返す
            const updateResultAddRing = await this._editFeatureUseCase.updateFeature(operation.polygonId, { geometry: geometryUpdate });
            const updatedPolygonRing = updateResultAddRing.feature; // ドメインインスタンスを正しく取り出す
            resultInfo = { updatedFeature: updatedPolygonRing, eventType: 'FeatureUpdated', eventPayload: { feature: updatedPolygonRing } };
        }
        break;

      default:
        console.warn(`OperationEngine.execute: Unsupported operation type: ${operation.type}`);
    }
    return resultInfo;
  }

  /**
   * 履歴操作の逆を実行 (アンドゥ用)
   * @param {Object} operation - 履歴エントリオブジェクト (プレーンデータ)
   * @returns {Promise<{updatedFeature?: Object, addedFeature?: Object, deletedFeatureId?: string, deletedVertexResult?: Object, movedVerticesResult?: Object, eventType?: string, eventPayload?: any}>} イベント発行や状態更新のための情報
   */
  async executeReverse(operation) {
    let world = await this._worldRepository.getWorld(); // 最新状態を取得
    let resultInfo = {};

    switch (operation.type) {
      case 'add': // 地物追加のUndo (地物削除)
        await this._editFeatureUseCase.deleteFeature(operation.featureId);
        resultInfo = { deletedFeatureId: operation.featureId, eventType: 'FeatureDeleted', eventPayload: { featureId: operation.featureId }};
        break;

      case 'delete': // 地物削除のUndo (地物復元)
        // 1. 必要な頂点をワールドに「追加」
        if (operation.verticesToRestoreData && Array.isArray(operation.verticesToRestoreData)) {
            let verticesRestored = false;
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vertexInstance = this._serializer.deserialize(vDataPlain);
                if (vertexInstance instanceof Vertex && !world.vertices.some(wv => wv.id === vertexInstance.id)) {
                    world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
                    verticesRestored = true;
                }
            });
            if (verticesRestored) await this._worldRepository.saveWorld(world);
        }
        // 2. 地物をワールドに「追加」
        if (operation.featureData) {
            const featureInstance = this._serializer.deserialize(operation.featureData);
            if (featureInstance && !world.features.some(f => f.id === featureInstance.id)) {
                world.features.push(featureInstance);
                await this._worldRepository.saveWorld(world);
                resultInfo = { addedFeature: featureInstance, eventType: 'FeatureAdded', eventPayload: { feature: featureInstance } };
            }
        }
        break;
      
      case 'deleteVertices': // 頂点削除のUndo (頂点と影響地物の復元)
        // 1. 削除された頂点をワールドに「追加」
        if (operation.verticesToRestoreData && Array.isArray(operation.verticesToRestoreData)) {
            let dvVerticesRestored = false;
            operation.verticesToRestoreData.forEach(vDataPlain => {
                const vertexInstance = this._serializer.deserialize(vDataPlain);
                if (vertexInstance instanceof Vertex && !world.vertices.some(wv => wv.id === vertexInstance.id)) {
                    world.vertices.push({ id: vertexInstance.id, x: vertexInstance.x, y: vertexInstance.y });
                    dvVerticesRestored = true;
                }
            });
            if (dvVerticesRestored) {
                await this._worldRepository.saveWorld(world);
                world = await this._worldRepository.getWorld(); // world再取得
            }
        }
        // 2. 影響を受けた地物の状態を元に戻す、または削除された地物を復元
        //    affectedFeaturesBefore: PlainFeatureObject[]
        //    deletedFeatureIdsInOperation: string[] (UseCaseによって実際に削除された地物ID)
        if (operation.affectedFeaturesBefore && Array.isArray(operation.affectedFeaturesBefore)) {
            let featuresStateRestored = false;
            for (const featureBeforePlain of operation.affectedFeaturesBefore) {
                const featureInstanceToRestore = this._serializer.deserialize(featureBeforePlain);
                if (!featureInstanceToRestore) continue;

                const indexInWorld = world.features.findIndex(f => f.id === featureInstanceToRestore.id);
                if (indexInWorld !== -1) { // 地物がまだ存在する場合 (更新されたケースのUndo)
                    world.features[indexInWorld] = featureInstanceToRestore;
                    // この操作は複数の地物に影響する可能性があるので、個別のFeatureUpdatedイベントはここでは発行せず、
                    // 呼び出し元(HistoryService)がVerticesDeletedCustomのような包括的なイベントを発行するか、
                    // あるいは個別に updatedFeature を resultInfo に詰めて返す。
                    // 今回は、affectedFeaturesBefore 全体を復元する操作なので、resultInfo.eventType は
                    // 'MultipleFeaturesRestored' のようなカスタムイベントにするか、
                    // または、各 FeatureUpdated/FeatureAdded イベントを配列で返す必要がある。
                    // 簡単のため、ここでは最後に更新/追加されたものを resultInfo に含める。
                    resultInfo = { updatedFeature: featureInstanceToRestore, eventType: 'FeatureUpdated', eventPayload: { feature: featureInstanceToRestore } };
                } else { // 地物が削除されていた場合 (削除された地物のUndo)
                    world.features.push(featureInstanceToRestore);
                    resultInfo = { addedFeature: featureInstanceToRestore, eventType: 'FeatureAdded', eventPayload: { feature: featureInstanceToRestore } };
                }
                featuresStateRestored = true;
            }
            if (featuresStateRestored) await this._worldRepository.saveWorld(world);
            // TODO: deleteVerticesのUndoでは複数の地物が影響を受ける可能性があるため、resultInfoの扱いやイベント発行方法を再検討する必要がある。
            // 現状では最後に処理された地物の情報のみがresultInfoに残る。
            // ひとまず、eventType を 'VerticesRestoredCustom'のようなものにして、ペイロードに affectedFeaturesBefore を渡すのが良いかもしれない。
            if (featuresStateRestored) {
                resultInfo = { eventType: 'VerticesRestoredCustom', eventPayload: { restoredFeatureIds: operation.affectedFeaturesBefore.map(f => f.id), verticesToRestoreData: operation.verticesToRestoreData }};
            }
        }
        break;

      case 'moveVertices': // 頂点移動のUndo (元の位置に戻す)
        if (operation.updates && Array.isArray(operation.updates)) {
            const updatesForUseCaseUndoMove = operation.updates.map(u => {
                const oldPosVertex = this._serializer.deserialize(u.oldPosition); // oldPositionはVertexのプレーンデータ
                return oldPosVertex ? { vertexId: u.vertexId, newPosition: { x: oldPosVertex.x, y: oldPosVertex.y } } : null;
            }).filter(Boolean);
            if (updatesForUseCaseUndoMove.length > 0) {
                const moveUndoResult = await this._editFeatureUseCase.moveVertices(updatesForUseCaseUndoMove);
                resultInfo = { movedVerticesResult: moveUndoResult, eventType: 'MultipleVerticesMoved', eventPayload: moveUndoResult };
            }
        }
        break;

      case 'updateProperties': // プロパティ更新のUndo (古いプロパティに戻す)
        const oldPropsInstancesUpdate = operation.oldProperties.map(pPlain => this._serializer.deserialize(pPlain)).filter(Boolean);
        // _editFeatureUseCase.updateFeature は { feature: DomainInstance, ... } を返す
        const updateResultUndo = await this._editFeatureUseCase.updateFeature(operation.featureId, { properties: oldPropsInstancesUpdate });
        const revertedFeatureInstance = updateResultUndo.feature; // ドメインインスタンスを正しく取り出す
        resultInfo = { updatedFeature: revertedFeatureInstance, eventType: 'FeatureUpdated', eventPayload: { feature: revertedFeatureInstance }};
        break;

      case 'addRing': // リング追加のUndo (リング削除と関連頂点削除)
        const ringToRemovePlainUndo = operation.addedRing; // プレーンオブジェクト
        if (ringToRemovePlainUndo && typeof ringToRemovePlainUndo.id === 'string') {
             const geometryUpdateUndo = { removedRingIds: [ringToRemovePlainUndo.id] };
             // _editFeatureUseCase.updateFeature は { feature: DomainInstance, ... } を返す
             const updateResultUndoAddRing = await this._editFeatureUseCase.updateFeature(operation.polygonId, { geometry: geometryUpdateUndo });
             const updatedPolygonUndo = updateResultUndoAddRing.feature; // ドメインインスタンスを正しく取り出す
             resultInfo = { updatedFeature: updatedPolygonUndo, eventType: 'FeatureUpdated', eventPayload: { feature: updatedPolygonUndo } };

             // 関連する頂点を削除 (他の地物で使われていなければ)
             if (operation.addedVerticesData && Array.isArray(operation.addedVerticesData)) {
                 const vertexIdsToRemoveUndo = operation.addedVerticesData.map(vDataPlain => {
                     const vertexInstance = this._serializer.deserialize(vDataPlain);
                     return vertexInstance ? vertexInstance.id : null;
                 }).filter(Boolean);
                 if (vertexIdsToRemoveUndo.length > 0) {
                     // deleteVertices は副作用があるので、イベント情報は上書きされる可能性がある
                     // ここでは、addRingのUndo操作の一部として頂点削除を行っているので、
                     // deleteVerticesの操作結果をresultInfoには含めない（メインはPolygonの更新）
                     await this._editFeatureUseCase.deleteVertices(vertexIdsToRemoveUndo);
                 }
             }
        }
        break;

      default:
        console.warn(`OperationEngine.executeReverse: Unsupported operation type: ${operation.type}`);
    }
    return resultInfo;
  }
}