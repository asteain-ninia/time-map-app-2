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
   *                           newRingCoordinates?: { points: {x,y}[], isOuter: boolean, parentId?: string }[],
   *                           existingRingData?: { id: string, vertexIds: string[], isOuter: boolean, parentId?: string }[],
   *                           removedRingIds?: string[],
   *                           updatedRingVertices?: { ringId: string, newVertexIds: string[] }[]
   *                         }
   *                         geometry (Point/Lineの場合): { vertexIds?: string[] } または { vertices: [{x,y}] }
   * @returns {Promise<{feature: Feature, newlyAddedVerticesData?: Array<{id: string, x: number, y: number}>}>} 更新されたオブジェクトと、新規リング追加時に生成された頂点データ（あれば）
   */
  async execute(featureId, updates) {
    let world = await this._worldRepository.getWorld(); 

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }

    let currentFeature = world.features[featureIndex];
    let updatedFeature = currentFeature;
    let worldVerticesUpdated = false; 
    let newlyAddedVerticesDataForHistory = []; // 新規リング追加時に生成された頂点データ

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
        const geometryUpdates = updates.geometry;
        const editService = this._polygonEditService;
        let polygonBeingUpdated = updatedFeature;

        try {
            if (Array.isArray(geometryUpdates.removedRingIds)) {
                for (const ringId of geometryUpdates.removedRingIds) {
                    polygonBeingUpdated = await editService.removeRingFromPolygon(polygonBeingUpdated.id, ringId);
                }
            }
            if (Array.isArray(geometryUpdates.updatedRingVertices)) {
                for (const update of geometryUpdates.updatedRingVertices) {
                    polygonBeingUpdated = await editService.updateRingVertices(polygonBeingUpdated.id, update.ringId, update.newVertexIds);
                }
            }
            if (Array.isArray(geometryUpdates.newRingCoordinates)) {
                for (const ringCoordData of geometryUpdates.newRingCoordinates) {
                    const tempGeometry = { vertices: ringCoordData.points };
                    const processed = this._processGeometry(tempGeometry, world); // world.vertices が変更される
                    worldVerticesUpdated = true; 

                    // 生成された頂点のデータを収集 (プレーンオブジェクト)
                    if (processed.vertexIds) {
                        const worldVerticesMap = new Map(world.vertices.map(v => [v.id, v]));
                        processed.vertexIds.forEach(id => {
                            const vData = worldVerticesMap.get(id);
                            if (vData) newlyAddedVerticesDataForHistory.push({ id: vData.id, x: vData.x, y: vData.y });
                        });
                    }
                    const ringData = {
                        vertexIds: processed.vertexIds,
                        isOuter: ringCoordData.isOuter,
                        parentId: ringCoordData.parentId
                    };
                    polygonBeingUpdated = await editService.addRingToPolygon(polygonBeingUpdated.id, ringData);
                }
            }
            if (Array.isArray(geometryUpdates.existingRingData)) {
                for (const existingRing of geometryUpdates.existingRingData) {
                    // existingRing.vertexIds が world.vertices に存在することは呼び出し元で保証される前提
                    polygonBeingUpdated = await editService.addRingWithId(polygonBeingUpdated.id, existingRing);
                }
            }
            updatedFeature = polygonBeingUpdated;
        } catch (error) {
            console.error(`Failed to update polygon geometry for ${featureId}:`, error);
            throw new Error(`Polygon geometry update failed: ${error.message}`);
        }
      } else { 
        let processedGeometry = updates.geometry;
        if (updates.geometry.vertices) {
            processedGeometry = this._processGeometry(updates.geometry, world);
            worldVerticesUpdated = true;
            // Point/Line の頂点追加の場合も newlyAddedVerticesDataForHistory に追加する（必要であれば）
            // 今回の修正はリング追加に限定するため、ここでは追加しない。
        }
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

    // レイヤーID更新
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

    if (updatedFeature !== currentFeature || worldVerticesUpdated) { 
        world.features[featureIndex] = updatedFeature;
        await this._worldRepository.saveWorld(world); 
    }

    // 戻り値をオブジェクトに変更
    return { 
        feature: updatedFeature, 
        newlyAddedVerticesData: newlyAddedVerticesDataForHistory.length > 0 ? newlyAddedVerticesDataForHistory : undefined 
    };
  }
}
