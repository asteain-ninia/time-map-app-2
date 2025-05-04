// src\application\usecases\feature\UpdateFeatureUseCase.js

import { Feature } from '../../../domain/entities/Feature';
import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon';
import { Property } from '../../../domain/value-objects/Property';
import { Vertex } from '../../../domain/entities/Vertex'; // 比較用
import { IPolygonEditService } from '../../services/IPolygonEditService.js';
import { WorldRepository } from '../../WorldRepository.js'; // 型チェック用 (循環参照注意)

/**
 * 地理オブジェクトの更新（プロパティ、レイヤーID、形状）を専門に処理するユースケース
 * ポリゴン形状の更新は PolygonEditService に委譲する
 */
export class UpdateFeatureUseCase {
  /** @type {WorldRepository} */
  _worldRepository;
  /** @type {GeometryService} */
  _geometryService;
  /** @type {LayerService} */
  _layerService;
  /** @type {Function} */
  _processGeometry;
  /** @type {Function} */
  _getVerticesFromIds;
  /** @type {IPolygonEditService} */
  _polygonEditService;

  /**
   * @param {WorldRepository} worldRepository
   * @param {GeometryService} geometryService
   * @param {LayerService} layerService
   * @param {Function} processGeometry - 形状処理関数 (EditFeatureUseCaseから提供)
   * @param {Function} getVerticesFromIds - 頂点取得関数 (EditFeatureUseCaseから提供)
   * @param {IPolygonEditService} polygonEditService - ポリゴン編集サービス
   */
  constructor(worldRepository, geometryService, layerService, processGeometry, getVerticesFromIds, polygonEditService) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService;
    this._layerService = layerService;
    this._processGeometry = processGeometry;
    this._getVerticesFromIds = getVerticesFromIds;
    this._polygonEditService = polygonEditService;
    if (!polygonEditService) {
        throw new Error("PolygonEditService is required for UpdateFeatureUseCase.");
    }
  }

  /**
   * 既存の地理オブジェクトを更新
   * @param {string} featureId - 更新するオブジェクトのID
   * @param {Object} updates - 更新内容 { properties?: Property[], geometry?: Object, layerId?: string }
   *                         geometry (Polygonの場合): {
   *                           newRingCoordinates?: { points: {x,y}[], isOuter: boolean, parentId?: string }[], // 座標から追加 (ID内部生成)
   *                           existingRingData?: { id: string, vertexIds: string[], isOuter: boolean, parentId?: string }[], // ID指定で追加 (Redo用)
   *                           removedRingIds?: string[], // 削除するリングID配列
   *                           updatedRingVertices?: { ringId: string, newVertexIds: string[] }[] // 頂点更新情報配列
   *                         }
   *                         geometry (Point/Lineの場合): { vertexIds?: string[] } または { vertices: [{x,y}] }
   * @returns {Promise<Feature>} 更新されたオブジェクト
   */
  async execute(featureId, updates) {
    let world = await this._worldRepository.getWorld(); // world を let で宣言

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }

    let currentFeature = world.features[featureIndex];
    let updatedFeature = currentFeature;
    let worldVerticesUpdated = false; // _processGeometryが呼ばれたか

    // プロパティ更新
    if (updates.properties) {
      if (!Array.isArray(updates.properties) || !updates.properties.every(p => p instanceof Property)) {
        throw new Error("Invalid properties format: must be an array of Property instances.");
      }
      if (updatedFeature && typeof updatedFeature.withProperties === 'function') {
        updatedFeature = updatedFeature.withProperties(updates.properties);
      } else {
        throw new Error(`Invalid feature object or missing withProperties method for ID: ${featureId}`);
      }
    }

    // ジオメトリ更新
    if (updates.geometry) {
       if (!updatedFeature) {
           throw new Error(`Feature object invalid after property update for ID: ${featureId}`);
       }

      if (updatedFeature instanceof Polygon) {
        // --- リングベースの処理 ---
        const geometryUpdates = updates.geometry;
        const editService = this._polygonEditService;
        let polygonBeingUpdated = updatedFeature;

        try {
            // 1. リング削除 (変更なし)
            if (Array.isArray(geometryUpdates.removedRingIds)) {
                console.log(`[UpdateFeatureUseCase] Removing rings: ${geometryUpdates.removedRingIds.join(', ')} from Polygon ${featureId}`);
                for (const ringId of geometryUpdates.removedRingIds) {
                    polygonBeingUpdated = await editService.removeRingFromPolygon(polygonBeingUpdated.id, ringId);
                }
            }

            // 2. リング頂点更新 (変更なし)
            if (Array.isArray(geometryUpdates.updatedRingVertices)) {
                 console.log(`[UpdateFeatureUseCase] Updating ring vertices for Polygon ${featureId}`, geometryUpdates.updatedRingVertices);
                for (const update of geometryUpdates.updatedRingVertices) {
                    polygonBeingUpdated = await editService.updateRingVertices(polygonBeingUpdated.id, update.ringId, update.newVertexIds);
                }
            }

            // 3. 新リング追加 (座標から - IDは内部生成) (変更なし)
            if (Array.isArray(geometryUpdates.newRingCoordinates)) {
                console.log(`[UpdateFeatureUseCase] Adding new rings from coordinates for Polygon ${featureId}`, geometryUpdates.newRingCoordinates);
                for (const ringCoordData of geometryUpdates.newRingCoordinates) {
                    // 3a. 頂点IDを生成・追加
                    const tempGeometry = { vertices: ringCoordData.points };
                    // ★★★ 副作用: world.vertices が変更される ★★★
                    const processed = this._processGeometry(tempGeometry, world);
                    worldVerticesUpdated = true; // 副作用があったことを記録

                    // 3b. ringData を構築 (IDなし)
                    const ringData = {
                        vertexIds: processed.vertexIds, // 生成されたIDを使用
                        isOuter: ringCoordData.isOuter,
                        parentId: ringCoordData.parentId
                    };
                    // 3c. リング追加 (ID内部生成)
                    polygonBeingUpdated = await editService.addRingToPolygon(polygonBeingUpdated.id, ringData);
                }
            }

            // 4. 既存リングデータ追加 (アンドゥ/リドゥ Redo 用 - ID指定)
            if (Array.isArray(geometryUpdates.existingRingData)) {
                 console.log(`[UpdateFeatureUseCase] Adding existing rings (Redo) for Polygon ${featureId}`, geometryUpdates.existingRingData);
                 // ★ PolygonEditServiceの addRingWithId を呼び出すように修正
                for (const existingRing of geometryUpdates.existingRingData) {
                    // 頂点が存在するか等の事前チェックは addRingWithId 内の validatePolygonRings で行われる想定
                    try {
                        polygonBeingUpdated = await editService.addRingWithId(polygonBeingUpdated.id, existingRing);
                        // ★ 注意: このリングが参照する頂点ID (existingRing.vertexIds) が
                        //    world.vertices に存在することは、呼び出し元(EditingViewModel)で保証されている必要がある。
                    } catch (addError) {
                         console.error(`[UpdateFeatureUseCase] Failed to redo adding ring ${existingRing.id}. Check if vertices exist and polygon remains valid.`, addError);
                         // Redo失敗時のエラーハンドリングが必要
                         throw addError;
                    }
                }
            }

            updatedFeature = polygonBeingUpdated;

        } catch (error) {
            console.error(`Failed to update polygon geometry for ${featureId}:`, error);
            // UseCaseレベルでエラーをラップして再スロー
            throw new Error(`Polygon geometry update failed: ${error.message}`);
        }
        // --- リングベース処理ここまで ---

      } else { // Point or Line (変更なし)
        let processedGeometry = updates.geometry;
        // vertices が渡された場合は _processGeometry を呼び出して頂点を生成
        if (updates.geometry.vertices) {
            processedGeometry = this._processGeometry(updates.geometry, world);
            worldVerticesUpdated = true; // 副作用を記録
        }

        // vertexIds が存在する場合 (直接ID指定、または_processGeometry経由)
        if (processedGeometry.vertexIds !== undefined) {
          if (updatedFeature && typeof updatedFeature.withVertexIds === 'function') {
            if (updatedFeature instanceof Point && (!processedGeometry.vertexIds || processedGeometry.vertexIds.length !== 1)) {
              throw new Error("Point must have exactly one vertexId.");
            }
            if (updatedFeature instanceof Line && (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 2)) {
              throw new Error("Line must have at least two vertexIds.");
            }
            updatedFeature = updatedFeature.withVertexIds(processedGeometry.vertexIds);
          } else {
            throw new Error(`Invalid feature object or missing withVertexIds method for ID: ${featureId}`);
          }
        }
      }
    }

    // レイヤーID更新 (変更なし)
    if (updates.layerId !== undefined) {
      if (!updatedFeature) {
          throw new Error(`Feature object invalid before layer ID update for ID: ${featureId}`);
      }
      if (typeof updatedFeature.withLayerId === 'function') {
        updatedFeature = updatedFeature.withLayerId(updates.layerId);
      } else {
        throw new Error(`Invalid feature object or missing withLayerId method for ID: ${featureId}`);
      }
    }

    // 更新されたオブジェクトを置き換え & 保存 (変更なし)
    if (updatedFeature !== currentFeature || worldVerticesUpdated) { // world.vertices が変更された場合も保存
        world.features[featureIndex] = updatedFeature;
        await this._worldRepository.saveWorld(world); // world全体を保存
    }

    return updatedFeature;
  }

}
