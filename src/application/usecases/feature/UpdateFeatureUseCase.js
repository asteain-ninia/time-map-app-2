// src\application\usecases\feature\UpdateFeatureUseCase.js

import { Feature } from '../../../domain/entities/Feature';
import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon';
import { Property } from '../../../domain/value-objects/Property';
import { TimePoint } from '../../../domain/value-objects/TimePoint';
import { IPolygonEditService } from '../../services/IPolygonEditService.js';
import { WorldRepository } from '../../WorldRepository.js'; // 型チェック用 (循環参照注意)
import { ensurePolygonLayerConstraints } from './polygonLayerValidation.js';

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
   *                         properties は Property インスタンスの配列 (1件以上) を期待。
   *                         propertyEdit?: {
   *                           editTime: TimePoint,
   *                           startTime?: TimePoint | null,
   *                           endTime?: TimePoint | null,
   *                           name?: string,
   *                           description?: string
   *                         }
   *                         geometry (Polygonの場合): {
   *                           newRingCoordinates?: { points: {x,y}[], ringType: 'territory' | 'hole', parentId?: string }[],
   *                           existingRingData?: { id: string, vertexIds: string[], ringType: 'territory' | 'hole', parentId?: string }[],
   *                           removedRingIds?: string[],
   *                           updatedRingVertices?: { ringId: string, newVertexIds: string[] }[]
   *                         }
   *                         geometry (Point/Lineの場合): { vertexIds?: string[] } または { vertices: [{x,y}] }
   * @returns {Promise<{feature: Feature, newlyAddedVerticesData?: Array<{id: string, x: number, y: number}>}>} 更新されたオブジェクトと、新規リング追加時に生成された頂点データ（あれば）
   */
  async execute(featureId, updates) {
    let world = await this._worldRepository.getWorld(); 
    const originalVerticesSnapshot = world.vertices.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }));

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }

    let currentFeature = world.features[featureIndex];
    let updatedFeature = currentFeature;
    let worldVerticesUpdated = false; 
    let newlyAddedVerticesDataForHistory = [];

    if (updates.propertyEdit && updates.properties) {
      throw new Error('propertyEdit と properties は同時に指定できません。');
    }

    // プロパティ更新
    if (updates.propertyEdit) {
      const mergedProperties = this._buildPropertiesForEditTime(updatedFeature, updates.propertyEdit);
      if (updatedFeature && typeof updatedFeature.withProperties === 'function') {
        updatedFeature = updatedFeature.withProperties(mergedProperties);
      } else {
        throw new Error(`Invalid feature object or missing withProperties method for ID: ${featureId}`);
      }
    } else if (updates.properties) {
      // updates.properties が Property インスタンス配列であることをバリデーション
      if (!Array.isArray(updates.properties) || updates.properties.length === 0 || !updates.properties.every(prop => prop instanceof Property)) {
        throw new Error("Invalid properties format for UpdateFeatureUseCase: must be a non-empty array of Property instances. Received:" + JSON.stringify(updates.properties));
      }
      const normalizedProperties = this._normalizeAndValidatePropertyTimeline(updates.properties);
      if (updatedFeature && typeof updatedFeature.withProperties === 'function') {
        updatedFeature = updatedFeature.withProperties(normalizedProperties);
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
        const originalPolygonForWorld = world.features[featureIndex];

        try {
            world.features[featureIndex] = polygonBeingUpdated;

            if (Array.isArray(geometryUpdates.removedRingIds)) {
                for (const ringId of geometryUpdates.removedRingIds) {
                    polygonBeingUpdated = await editService.removeRingFromPolygon(polygonBeingUpdated.id, ringId);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            if (Array.isArray(geometryUpdates.updatedRingVertices)) {
                for (const update of geometryUpdates.updatedRingVertices) {
                    polygonBeingUpdated = await editService.updateRingVertices(polygonBeingUpdated.id, update.ringId, update.newVertexIds);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            if (Array.isArray(geometryUpdates.newRingCoordinates)) {
                for (const ringCoordData of geometryUpdates.newRingCoordinates) {
                    const tempGeometry = { vertices: ringCoordData.points };
                    const processed = this._processGeometry(tempGeometry, world);
                    worldVerticesUpdated = true; 

                    if (processed.vertexIds) {
                        const worldVerticesMap = new Map(world.vertices.map(v => [v.id, v]));
                        processed.vertexIds.forEach(id => {
                            const vData = worldVerticesMap.get(id);
                            if (vData) newlyAddedVerticesDataForHistory.push({ id: vData.id, x: vData.x, y: vData.y });
                        });
                    }
                    const ringData = {
                        vertexIds: processed.vertexIds,
                        ringType: ringCoordData.ringType,
                        parentId: ringCoordData.parentId
                    };
                    polygonBeingUpdated = await editService.addRingToPolygon(polygonBeingUpdated.id, ringData);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            if (Array.isArray(geometryUpdates.existingRingData)) {
                for (const existingRing of geometryUpdates.existingRingData) {
                    polygonBeingUpdated = await editService.addRingWithId(polygonBeingUpdated.id, existingRing);
                    world.features[featureIndex] = polygonBeingUpdated;
                }
            }
            updatedFeature = polygonBeingUpdated;
        } catch (error) {
            world.features[featureIndex] = originalPolygonForWorld;
            this._restoreWorldVertices(world, originalVerticesSnapshot);
            console.error(`Failed to update polygon geometry for ${featureId}:`, error);
            throw new Error(`Polygon geometry update failed: ${error.message}`);
        }
      } else { 
        let processedGeometry = updates.geometry;
        if (updates.geometry.vertices) {
            processedGeometry = this._processGeometry(updates.geometry, world);
            worldVerticesUpdated = true;
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

    if (updatedFeature instanceof Polygon) {
      this._ensurePolygonPlacementOrRollback(
        updatedFeature,
        world,
        currentFeature,
        originalVerticesSnapshot,
        featureIndex
      );
    }

    if (updatedFeature !== currentFeature || worldVerticesUpdated) { 
        world.features[featureIndex] = updatedFeature;
        await this._worldRepository.saveWorld(world); 
    }

    return { 
        feature: updatedFeature, 
        newlyAddedVerticesData: newlyAddedVerticesDataForHistory.length > 0 ? newlyAddedVerticesDataForHistory : undefined 
    };
}

  _buildPropertiesForEditTime(feature, propertyEdit) {
    if (!propertyEdit || typeof propertyEdit !== 'object') {
      throw new Error('propertyEdit の形式が不正です。');
    }

    const editTime = propertyEdit.editTime;
    if (!(editTime instanceof TimePoint)) {
      throw new Error('編集時刻は TimePoint で指定してください。');
    }

    if (propertyEdit.startTime !== undefined && propertyEdit.startTime !== null) {
      if (!(propertyEdit.startTime instanceof TimePoint)) {
        throw new Error('存在開始は TimePoint で指定してください。');
      }
      if (!propertyEdit.startTime.equals(editTime)) {
        throw new Error('存在開始はタイムラインの現在時刻と一致させてください。');
      }
    }

    let existing = Array.isArray(feature.properties) ? [...feature.properties] : [];
    if (existing.length === 0) {
      throw new Error('編集対象の履歴アンカーが存在しません。');
    }

    existing = this._normalizeAndValidatePropertyTimeline(existing);

    const exactAnchorIndex = existing.findIndex(property => {
      const start = this._getPropertyStartAnchor(property);
      return start instanceof TimePoint && start.equals(editTime);
    });

    const activeProperty = typeof feature.getPropertyAt === 'function'
      ? feature.getPropertyAt(editTime)
      : null;
    if (exactAnchorIndex === -1 && !(activeProperty instanceof Property)) {
      throw new Error('編集時刻で有効な履歴アンカーが見つかりません。');
    }

    const activeAnchorIndex = exactAnchorIndex !== -1
      ? exactAnchorIndex
      : this._findActiveAnchorIndex(existing, activeProperty, editTime);
    const baseProperty = exactAnchorIndex !== -1 ? existing[exactAnchorIndex] : activeProperty;
    const nextFutureAnchorStart = this._findNextFutureAnchorStart(existing, editTime);
    const hasExplicitEndTime = Object.prototype.hasOwnProperty.call(propertyEdit, 'endTime');
    const requestedEndTime = hasExplicitEndTime ? propertyEdit.endTime : baseProperty.endTime;
    const normalizedEndTime = this._normalizePropertyEndTime(editTime, requestedEndTime, nextFutureAnchorStart);

    const mergedProperty = new Property(
      editTime,
      typeof propertyEdit.name === 'string' ? propertyEdit.name : baseProperty.name,
      typeof propertyEdit.description === 'string' ? propertyEdit.description : baseProperty.description,
      baseProperty.getAttributes(),
      editTime,
      normalizedEndTime
    );

    const merged = [...existing];
    if (exactAnchorIndex === -1) {
      merged.push(mergedProperty);
      if (activeAnchorIndex !== -1) {
        const sourceProperty = merged[activeAnchorIndex];
        const sourceStart = this._getPropertyStartAnchor(sourceProperty);
        if (
          sourceStart instanceof TimePoint &&
          sourceStart.isBefore(editTime) &&
          (!sourceProperty.endTime || editTime.isBefore(sourceProperty.endTime))
        ) {
          merged[activeAnchorIndex] = new Property(
            sourceProperty.timePoint,
            sourceProperty.name,
            sourceProperty.description,
            sourceProperty.getAttributes(),
            sourceProperty.startTime || sourceProperty.timePoint,
            editTime
          );
        }
      }
    } else {
      merged[exactAnchorIndex] = mergedProperty;
    }

    return this._normalizeAndValidatePropertyTimeline(merged);
  }

  _getPropertyStartAnchor(property) {
    if (!(property instanceof Property)) {
      return null;
    }
    return property.startTime || property.timePoint || null;
  }

  _comparePropertyStartAnchors(left, right) {
    const leftStart = this._getPropertyStartAnchor(left);
    const rightStart = this._getPropertyStartAnchor(right);

    if (leftStart && rightStart) {
      if (leftStart.isBefore(rightStart)) return -1;
      if (rightStart.isBefore(leftStart)) return 1;
      return 0;
    }
    if (leftStart) return -1;
    if (rightStart) return 1;
    return 0;
  }

  _findNextFutureAnchorStart(properties, editTime) {
    for (const property of properties) {
      const start = this._getPropertyStartAnchor(property);
      if (start instanceof TimePoint && editTime.isBefore(start)) {
        return start;
      }
    }
    return null;
  }

  _findActiveAnchorIndex(properties, activeProperty, editTime) {
    const byReference = properties.findIndex(property => property === activeProperty);
    if (byReference !== -1) {
      return byReference;
    }

    for (let index = 0; index < properties.length; index += 1) {
      const property = properties[index];
      const start = this._getPropertyStartAnchor(property);
      if (!(start instanceof TimePoint)) {
        continue;
      }
      if (editTime.isBefore(start)) {
        break;
      }
      if (property instanceof Property && property.isActiveAt(editTime)) {
        return index;
      }
    }
    return -1;
  }

  _normalizePropertyEndTime(editTime, requestedEndTime, nextFutureAnchorStart) {
    if (requestedEndTime !== null && requestedEndTime !== undefined) {
      if (!(requestedEndTime instanceof TimePoint)) {
        throw new Error('存在終了は TimePoint で指定してください。');
      }
      if (!editTime.isBefore(requestedEndTime)) {
        throw new Error('存在終了は編集時刻より後に設定してください。');
      }
      if (nextFutureAnchorStart instanceof TimePoint && nextFutureAnchorStart.isBefore(requestedEndTime)) {
        throw new Error('存在終了は次の歴史の錨の開始時刻を超えられません。');
      }
      return requestedEndTime;
    }

    if (nextFutureAnchorStart instanceof TimePoint) {
      return nextFutureAnchorStart;
    }
    return null;
  }

  _normalizeAndValidatePropertyTimeline(properties) {
    const sorted = [...properties];
    sorted.sort((left, right) => this._comparePropertyStartAnchors(left, right));

    const seenAnchors = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const property = sorted[index];
      if (!(property instanceof Property)) {
        throw new Error('履歴アンカーが Property ではありません。');
      }

      const start = this._getPropertyStartAnchor(property);
      if (!(start instanceof TimePoint)) {
        throw new Error('履歴アンカーの開始時刻が不正です。');
      }
      if (seenAnchors.some(anchor => anchor.equals(start))) {
        throw new Error('同一時刻の歴史の錨が重複しています。');
      }

      const endTime = property.endTime;
      if (endTime !== null && endTime !== undefined) {
        if (!(endTime instanceof TimePoint)) {
          throw new Error('存在終了は TimePoint で指定してください。');
        }
        if (!start.isBefore(endTime)) {
          throw new Error('存在終了は開始時刻より後に設定してください。');
        }
      }

      const nextProperty = sorted[index + 1];
      if (nextProperty) {
        const nextStart = this._getPropertyStartAnchor(nextProperty);
        if (!(nextStart instanceof TimePoint)) {
          throw new Error('履歴アンカーの開始時刻が不正です。');
        }
        if (endTime instanceof TimePoint && nextStart.isBefore(endTime)) {
          throw new Error('存在終了は次の歴史の錨の開始時刻を超えられません。');
        }
      }

      seenAnchors.push(start);
    }

    return sorted;
  }

  _ensurePolygonPlacementOrRollback(updatedPolygon, world, originalPolygon, originalVerticesSnapshot, featureIndex) {
    if (!(updatedPolygon instanceof Polygon)) {
      return;
    }

    try {
      ensurePolygonLayerConstraints(updatedPolygon, world, this._layerService, this._geometryService);
    } catch (error) {
      world.features[featureIndex] = originalPolygon;
      this._restoreWorldVertices(world, originalVerticesSnapshot);
      throw error;
    }
  }

  _restoreWorldVertices(world, snapshot) {
    world.vertices = snapshot.map(data => ({ id: data.id, x: data.x, y: data.y }));
  }
}

