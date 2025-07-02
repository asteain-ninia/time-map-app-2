// src/application/services/history/OperationEngine.js
import { Vertex } from '../../../domain/entities/Vertex.js';
import { Point } from '../../../domain/entities/Point.js'; // executeReverseでのインスタンス生成のため
import { Line as DomainLine } from '../../../domain/entities/Line.js'; // 同上
import { Polygon as DomainPolygon } from '../../../domain/entities/Polygon.js'; // 同上
// Property は HistorySerializer がインスタンス化するため、ここでは不要

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
          if (verticesActuallyAddedToWorld) await this._worldRepository.saveWorld(world); // 頂点追加後に一度保存
        }
        // 2. 地物をワールドに「追加」する (EditFeatureUseCaseには履歴からの復元用addがないため、WorldRepositoryを直接操作)
        if (operation.featureData) {
          const featureInstance = this._serializer.deserialize(operation.featureData);
          if (featureInstance && !world.features.some(f => f.id === featureInstance.id)) {
            // world.features.push(featureInstance); // ここでドメインインスタンスを直接push
             const existingFeatureIndex = world.features.findIndex(f => f.id === featureInstance.id);
             if (existingFeatureIndex !== -1) {
                 world.features[existingFeatureIndex] = featureInstance;
             } else {
                 world.features.push(featureInstance);
             }
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
      
      case 'addVertexToEdge': // Redo時の処理
        const newVertexPlainRedo = this._serializer.deserialize(operation.addedVertexData);
        if (!newVertexPlainRedo || !(newVertexPlainRedo instanceof Vertex)) {
            throw new Error("Invalid vertex data in history for addVertexToEdge redo.");
        }
        // 1. 頂点をワールドに追加 (重複チェック)
        if (!world.vertices.some(v => v.id === newVertexPlainRedo.id)) {
            world.vertices.push({ id: newVertexPlainRedo.id, x: newVertexPlainRedo.x, y: newVertexPlainRedo.y });
            // この後、地物更新と合わせて一度だけsaveWorldする
        }

        // 2. 地物の頂点リストを更新
        const featureIndexRedo = world.features.findIndex(f => f.id === operation.featureId);
        if (featureIndexRedo === -1) {
            throw new Error(`Feature ${operation.featureId} not found for addVertexToEdge redo.`);
        }
        let featureToUpdateRedo = world.features[featureIndexRedo];

        if (featureToUpdateRedo instanceof DomainLine) {
            const oldVertexIds = featureToUpdateRedo.vertexIds;
            const startIndex = oldVertexIds.indexOf(operation.segmentStartVertexId);
            const endIndex = oldVertexIds.indexOf(operation.segmentEndVertexId);
            if (startIndex === -1 || endIndex === -1 || Math.abs(startIndex - endIndex) !== 1) {
                 throw new Error(`Invalid segment for Line in addVertexToEdge redo: ${operation.segmentStartVertexId}-${operation.segmentEndVertexId}`);
            }
            const insertBeforeIndex = Math.max(startIndex, endIndex);
            const newVertexIdsLine = [
                ...oldVertexIds.slice(0, insertBeforeIndex),
                newVertexPlainRedo.id,
                ...oldVertexIds.slice(insertBeforeIndex)
            ];
            featureToUpdateRedo = featureToUpdateRedo.withVertexIds(newVertexIdsLine);
        } else if (featureToUpdateRedo instanceof DomainPolygon) {
            if (!operation.ringId) throw new Error("ringId missing for Polygon in addVertexToEdge redo.");
            const targetRingIndex = featureToUpdateRedo.rings.findIndex(r => r.id === operation.ringId);
            if (targetRingIndex === -1) throw new Error(`Ring ${operation.ringId} not found in Polygon for redo.`);
            
            const targetRing = featureToUpdateRedo.rings[targetRingIndex];
            const oldRingVertexIds = targetRing.vertexIds;
            const startIndex = oldRingVertexIds.indexOf(operation.segmentStartVertexId);
            const endIndex = oldRingVertexIds.indexOf(operation.segmentEndVertexId);

            let insertBeforeIndexRing = -1;
            if ((startIndex + 1) % oldRingVertexIds.length === endIndex) { // 正順
                insertBeforeIndexRing = endIndex;
            } else if ((endIndex + 1) % oldRingVertexIds.length === startIndex) { // 逆順で閉路の終端と始点
                insertBeforeIndexRing = startIndex;
            } else {
                 throw new Error(`Invalid segment for Polygon Ring in addVertexToEdge redo: ${operation.segmentStartVertexId}-${operation.segmentEndVertexId}`);
            }
            const newRingVertexIdsPoly = [
                ...oldRingVertexIds.slice(0, insertBeforeIndexRing),
                newVertexPlainRedo.id,
                ...oldRingVertexIds.slice(insertBeforeIndexRing)
            ];
            featureToUpdateRedo = featureToUpdateRedo.withUpdatedRingVertices(operation.ringId, newRingVertexIdsPoly);
        } else {
            throw new Error(`Unsupported feature type for addVertexToEdge redo: ${featureToUpdateRedo.constructor.name}`);
        }
        
        world.features[featureIndexRedo] = featureToUpdateRedo;
        await this._worldRepository.saveWorld(world);
        resultInfo = { 
            updatedFeature: featureToUpdateRedo, 
            eventType: 'VertexAddedToEdge', // カスタムイベントタイプ
            eventPayload: { 
                featureId: featureToUpdateRedo.id, 
                addedVertex: newVertexPlainRedo, // Vertexインスタンス
                updatedFeature: featureToUpdateRedo // 更新後地物インスタンス
            }
        };
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
            if (verticesRestored) await this._worldRepository.saveWorld(world); // 頂点復元後に一度保存
        }
        // 2. 地物をワールドに「追加」
        if (operation.featureData) {
            const featureInstance = this._serializer.deserialize(operation.featureData);
            if (featureInstance) { // 存在チェックはせずに上書きまたは追加
                // world.features.push(featureInstance);
                 const existingFeatureIndex = world.features.findIndex(f => f.id === featureInstance.id);
                 if (existingFeatureIndex !== -1) {
                     world.features[existingFeatureIndex] = featureInstance; // 既存なら上書き
                 } else {
                     world.features.push(featureInstance); // なければ追加
                 }
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
        if (operation.affectedFeaturesBefore && Array.isArray(operation.affectedFeaturesBefore)) {
            const restoredFeatures = [];
            for (const featureBeforePlain of operation.affectedFeaturesBefore) {
                const featureInstanceToRestore = this._serializer.deserialize(featureBeforePlain);
                if (!featureInstanceToRestore) continue;

                const indexInWorld = world.features.findIndex(f => f.id === featureInstanceToRestore.id);
                if (indexInWorld !== -1) { // 地物がまだ存在する場合 (更新されたケースのUndo)
                    world.features[indexInWorld] = featureInstanceToRestore;
                } else { // 地物が削除されていた場合 (削除された地物のUndo)
                    world.features.push(featureInstanceToRestore);
                }
                restoredFeatures.push(featureInstanceToRestore);
            }
            if (restoredFeatures.length > 0) {
                await this._worldRepository.saveWorld(world);
                // 復元された地物インスタンスの配列を返す
                // これにより、HistoryServiceは個別のFeatureUpdatedイベントを発行できる
                resultInfo = { updatedFeatures: restoredFeatures };
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

      case 'addVertexToEdge': // Undo時の処理
        // 1. 頂点をワールドから削除
        world.vertices = world.vertices.filter(v => v.id !== operation.newVertexId);
        
        // 2. 地物の状態を操作前に戻す (featureBeforeData を使用)
        const featureToRestoreUndo = this._serializer.deserialize(operation.featureBeforeData);
        if (!featureToRestoreUndo) {
            throw new Error("Failed to deserialize featureBeforeData for addVertexToEdge undo.");
        }
        const featureIndexUndo = world.features.findIndex(f => f.id === operation.featureId);
        if (featureIndexUndo === -1) {
             // 地物が何らかの理由で見つからない場合 (通常はありえない)、エラーまたは警告
            console.warn(`Feature ${operation.featureId} not found during addVertexToEdge undo, cannot restore its state.`);
             // この場合、頂点削除のみで終了する可能性がある
        } else {
            world.features[featureIndexUndo] = featureToRestoreUndo;
        }
        
        await this._worldRepository.saveWorld(world);
        resultInfo = { 
            updatedFeature: featureToRestoreUndo, // 復元された地物
            eventType: 'VertexRemovedFromEdge', // カスタムイベントタイプ
            eventPayload: { 
                featureId: operation.featureId, 
                removedVertexId: operation.newVertexId,
                updatedFeature: featureToRestoreUndo 
            }
        };
        break;

      default:
        console.warn(`OperationEngine.executeReverse: Unsupported operation type: ${operation.type}`);
    }
    return resultInfo;
  }
}