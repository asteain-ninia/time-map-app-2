import { Feature } from '../../../domain/entities/Feature';
import { Point } from '../../../domain/entities/Point';
import { Line } from '../../../domain/entities/Line';
import { Polygon } from '../../../domain/entities/Polygon';
import { Property } from '../../../domain/value-objects/Property';
import { Vertex } from '../../../domain/entities/Vertex'; // 比較用
// import { IPolygonEditService } from '../../services/IPolygonEditService'; // リングベース移行後

/**
 * 地理オブジェクトの更新（プロパティ、レイヤーID、ポリゴン形状以外）を専門に処理するユースケース
 * ポリゴン形状の更新は PolygonEditService に委譲する想定
 */
export class UpdateFeatureUseCase {
  /**
   * @param {WorldRepository} worldRepository
   * @param {GeometryService} geometryService - 検証用に保持 (リングベース移行後は PolygonEditService へ)
   * @param {LayerService} layerService
   * @param {Function} processGeometry - 形状処理関数 (EditFeatureUseCaseから提供)
   * @param {Function} getVerticesFromIds - 頂点取得関数 (EditFeatureUseCaseから提供)
   * @param {IPolygonEditService} polygonEditService - ポリゴン編集サービス (リングベース移行後)
   */
  constructor(worldRepository, geometryService, layerService, processGeometry, getVerticesFromIds, polygonEditService) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService; // 検証用に保持
    this._layerService = layerService;
    this._processGeometry = processGeometry;
    this._getVerticesFromIds = getVerticesFromIds; // 検証用に保持
    this._polygonEditService = polygonEditService; // リングベース移行後に利用
  }

  /**
   * 既存の地理オブジェクトを更新
   * @param {string} featureId - 更新するオブジェクトのID
   * @param {Object} updates - 更新内容 { properties?: Property[], geometry?: Object, layerId?: string }
   *                         geometry: { ... } (詳細は元のEditFeatureUseCase参照)
   * @returns {Promise<Feature>} 更新されたオブジェクト
   */
  async execute(featureId, updates) {
    const world = await this._worldRepository.getWorld();

    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }

    let feature = world.features[featureIndex];

    // プロパティ更新
    if (updates.properties) {
      if (!Array.isArray(updates.properties) || !updates.properties.every(p => p instanceof Property)) {
        console.warn("UpdateFeatureUseCase received 'properties' but it's not an array of Property instances.", updates.properties);
        throw new Error("Invalid properties format: must be an array of Property instances.");
      }
      if (feature && typeof feature.withProperties === 'function') {
        feature = feature.withProperties(updates.properties);
      } else {
        console.error(`Feature ${featureId} is invalid or missing withProperties method.`);
        throw new Error(`Invalid feature object for ID: ${featureId}`);
      }
    }

    // ジオメトリ更新
    if (updates.geometry) {
      // 新しい頂点/穴/飛び地のID生成 (EditFeatureUseCaseのヘルパーを利用)
      // 注意: _processGeometry は world.vertices を変更する副作用を持つ
      const processedGeometry = this._processGeometry(updates.geometry, world);

      if (!feature) {
          console.error(`Feature ${featureId} became null unexpectedly after property update.`);
          throw new Error(`Feature object invalid after property update for ID: ${featureId}`);
      }

      // オブジェクトタイプごとの処理
      if (feature instanceof Polygon) {
        // --- リングベース移行後の理想的な処理 ---
        // if (this._polygonEditService) {
        //   // 形状更新は PolygonEditService に委譲
        //   feature = await this._polygonEditService.updatePolygonGeometry(feature, processedGeometry, world);
        // } else {
        //   console.warn("PolygonEditService not available. Polygon geometry update skipped.");
        // }
        // --- ここまでリングベース移行後の理想 ---

        // --- 現状のロジック (リングベース移行まで暫定) ---
        this._validatePolygonUpdate(processedGeometry, feature, world); // 現状の検証ロジック

        // 飛び地追加処理
        if (processedGeometry.newSubPolygonVertices) {
             if (!processedGeometry.newSubPolygonVertexIds || processedGeometry.newSubPolygonVertexIds.length < 3) {
                 throw new Error("New enclave must have at least three vertices.");
             }
             const newSubPolygon = {
                 vertexIds: processedGeometry.newSubPolygonVertexIds,
                 holesVertexIds: []
             };
             this._validateSubPolygon(newSubPolygon, feature, world); // 現状の検証
             const existingSubPolygons = feature.subPolygons || [];
             const updatedSubPolygons = [...existingSubPolygons, newSubPolygon];
             if (typeof feature.withMultiPolygonData === 'function') {
                 feature = feature.withMultiPolygonData(true, updatedSubPolygons);
             } else { throw new Error("Missing withMultiPolygonData method"); }
        } else {
             // 外周更新
             if (processedGeometry.vertexIds !== undefined && typeof feature.withVertexIds === 'function') {
                 feature = feature.withVertexIds(processedGeometry.vertexIds);
             }
             // トップレベルの穴更新
             if (processedGeometry.holesVertexIds && typeof feature.withHolesVertexIds === 'function') {
                  processedGeometry.holesVertexIds.forEach(hole => this._validatePolygonHole(hole, feature, world, null));
                  feature = feature.withHolesVertexIds(processedGeometry.holesVertexIds);
             }
             // 特定の飛び地の穴更新
            if (processedGeometry.targetSubPolygonIndex !== undefined &&
                processedGeometry.newHolesVertexIdsForSubPolygon &&
                typeof feature.withSubPolygonHoles === 'function') {
                const targetIndex = processedGeometry.targetSubPolygonIndex;
                const newHoles = processedGeometry.newHolesVertexIdsForSubPolygon;
                if (targetIndex >= 0 && targetIndex < feature.subPolygons.length) {
                     newHoles.forEach(hole => this._validatePolygonHole(hole, feature, world, targetIndex));
                     const currentSubPolygon = feature.subPolygons[targetIndex];
                     const combinedHoles = [...(currentSubPolygon.holesVertexIds || []), ...newHoles];
                     feature = feature.withSubPolygonHoles(targetIndex, combinedHoles);
                } else {
                     throw new Error(`Invalid target sub-polygon index for adding holes: ${targetIndex}`);
                }
            }
             // 親ID更新
             if (processedGeometry.parentId !== undefined && typeof feature.withParentId === 'function') {
                 feature = feature.withParentId(processedGeometry.parentId);
             }
             // 飛び地情報全体の上書き
            if (processedGeometry.isMultiPolygon !== undefined && processedGeometry.subPolygons && typeof feature.withMultiPolygonData === 'function') {
               (processedGeometry.subPolygons || []).forEach(sub => this._validateSubPolygon(sub, feature, world));
               feature = feature.withMultiPolygonData(
                 processedGeometry.isMultiPolygon,
                 processedGeometry.subPolygons || []
               );
            }
        }
        // --- ここまで現状のロジック ---

      } else { // Point or Line
        if (processedGeometry.vertexIds !== undefined) {
          if (feature && typeof feature.withVertexIds === 'function') {
            if (feature instanceof Point && processedGeometry.vertexIds.length !== 1) {
              throw new Error("Point must have exactly one vertexId.");
            }
            if (feature instanceof Line && processedGeometry.vertexIds.length < 2) {
              throw new Error("Line must have at least two vertexIds.");
            }
            feature = feature.withVertexIds(processedGeometry.vertexIds);
          } else {
            console.error(`Feature ${featureId} is invalid or missing withVertexIds method (Point/Line).`);
            throw new Error(`Invalid feature object for ID: ${featureId}`);
          }
        }
      }
    }

    // レイヤーID更新
    if (updates.layerId !== undefined) {
      if (!feature) {
          console.error(`Feature ${featureId} became null unexpectedly before layer ID update.`);
          throw new Error(`Feature object invalid before layer ID update for ID: ${featureId}`);
      }
      if (typeof feature.withLayerId === 'function') {
        // TODO: レイヤー変更に伴う親子関係などの検証 (LayerService)
        feature = feature.withLayerId(updates.layerId);
      } else {
        console.error(`Feature ${featureId} is invalid or missing withLayerId method.`);
        throw new Error(`Invalid feature object for ID: ${featureId}`);
      }
    }

    // 更新されたオブジェクトを置き換え
    world.features[featureIndex] = feature;

    // 世界データを保存
    await this._worldRepository.saveWorld(world);

    return feature;
  }

  // --- 現状の検証ロジック (リングベース移行後は PolygonEditService に移動) ---
  _validatePolygonUpdate(geometryUpdates, currentPolygon, world) {
    let potentialVertexIds = geometryUpdates.vertexIds !== undefined ? geometryUpdates.vertexIds : currentPolygon.vertexIds;
    let potentialHoles = geometryUpdates.holesVertexIds !== undefined ? geometryUpdates.holesVertexIds : currentPolygon.holesVertexIds;
    let potentialSubPolygons = currentPolygon.subPolygons || []; // Initialize to empty array if null/undefined
    if (geometryUpdates.targetSubPolygonIndex !== undefined && geometryUpdates.newHolesVertexIdsForSubPolygon) {
        const index = geometryUpdates.targetSubPolygonIndex;
        // Check if potentialSubPolygons is an array and index is valid
        if (Array.isArray(potentialSubPolygons) && index >= 0 && index < potentialSubPolygons.length) {
             const currentSubHoles = potentialSubPolygons[index].holesVertexIds || [];
             potentialSubPolygons = [...potentialSubPolygons];
             potentialSubPolygons[index] = {
                 ...potentialSubPolygons[index],
                 holesVertexIds: [...currentSubHoles, ...geometryUpdates.newHolesVertexIdsForSubPolygon]
             };
        }
    }
    if (geometryUpdates.isMultiPolygon !== undefined && geometryUpdates.subPolygons) {
        potentialSubPolygons = geometryUpdates.subPolygons;
    }
    if (geometryUpdates.newSubPolygonVertexIds) {
        potentialSubPolygons = [...potentialSubPolygons, { vertexIds: geometryUpdates.newSubPolygonVertexIds, holesVertexIds: [] }];
    }

    // 自己交差チェック
    if (geometryUpdates.vertexIds !== undefined && potentialVertexIds && potentialVertexIds.length >= 3) {
        const vertices = this._getVerticesFromIds(potentialVertexIds, world);
        if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
             throw new Error("Updated polygon cannot self-intersect.");
        }
    }
    potentialHoles?.forEach(holeIds => {
        if (holeIds && holeIds.length >= 3) { // Check holeIds is not null/undefined
            const vertices = this._getVerticesFromIds(holeIds, world);
            if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                throw new Error("Updated polygon hole cannot self-intersect.");
            }
        }
    });
    potentialSubPolygons?.forEach(sub => {
         if (sub && sub.vertexIds && sub.vertexIds.length >= 3) { // Check sub and sub.vertexIds
             const vertices = this._getVerticesFromIds(sub.vertexIds, world);
             if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                 throw new Error("Updated sub-polygon cannot self-intersect.");
             }
         }
         sub?.holesVertexIds?.forEach(holeIds => {
             if (holeIds && holeIds.length >= 3) { // Check holeIds
                 const vertices = this._getVerticesFromIds(holeIds, world);
                 if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                     throw new Error("Updated sub-polygon hole cannot self-intersect.");
                 }
             }
         });
    });
    // TODO: 他の検証 (排他性、階層)
  }
  _validatePolygonHole(holeVertexIds, polygon, world, targetSubPolygonIndex = null) {
     if (!holeVertexIds || holeVertexIds.length < 3) throw new Error('Polygon hole must have at least three vertices');
     const holeVertices = this._getVerticesFromIds(holeVertexIds, world);
     if (holeVertices.length !== holeVertexIds.length) throw new Error("Invalid vertex ID found in hole definition.");
     if (this._geometryService.isPolygonSelfIntersecting(holeVertices)) throw new Error("Polygon hole cannot self-intersect.");
     let outerBoundaryVertices = null;
    const polygonVertexIds = polygon.vertexIds || []; // Ensure array even if null
    const subPolygons = polygon.subPolygons || []; // Ensure array even if null

     if (targetSubPolygonIndex === null) {
         if (polygonVertexIds.length >= 3) {
             outerBoundaryVertices = this._getVerticesFromIds(polygonVertexIds, world);
         }
     } else if (polygon.isMultiPolygon && targetSubPolygonIndex >= 0 && targetSubPolygonIndex < subPolygons.length) {
         const subPolygon = subPolygons[targetSubPolygonIndex];
         const subVertexIds = subPolygon.vertexIds || [];
         if (subVertexIds.length >= 3) {
             outerBoundaryVertices = this._getVerticesFromIds(subVertexIds, world);
         }
     }
     if (outerBoundaryVertices && outerBoundaryVertices.length >= 3) {
         if (!holeVertices.every(hv => this._geometryService.isPointInPolygon(hv, outerBoundaryVertices))) {
             const targetName = targetSubPolygonIndex === null ? "polygon outer boundary" : `sub-polygon[${targetSubPolygonIndex}]`;
             throw new Error(`Hole must be completely inside the ${targetName}.`);
         }
     } else {
         throw new Error("Cannot validate hole: Outer boundary not found or is invalid.");
     }
     // TODO: 他の穴との交差チェック
  }
  _validateSubPolygon(subPolygon, parentPolygon, world) {
    if (!subPolygon || !subPolygon.vertexIds || subPolygon.vertexIds.length < 3) throw new Error('Sub-polygon must have at least three vertices');
    const subVertices = this._getVerticesFromIds(subPolygon.vertexIds, world);
    if (subVertices.length !== subPolygon.vertexIds.length) throw new Error("Invalid vertex ID found in sub-polygon definition.");
    if (this._geometryService.isPolygonSelfIntersecting(subVertices)) throw new Error("Sub-polygon cannot self-intersect.");
    (subPolygon.holesVertexIds || []).forEach((holeIds, index) => {
         if (!holeIds || holeIds.length < 3) throw new Error(`Hole (index ${index}) in sub-polygon must have at least three vertices`);
         const holeVertices = this._getVerticesFromIds(holeIds, world);
         if (holeVertices.length !== holeIds.length) throw new Error(`Invalid vertex ID found in hole (index ${index}) of sub-polygon.`);
         if (this._geometryService.isPolygonSelfIntersecting(holeVertices)) throw new Error(`Hole (index ${index}) in sub-polygon cannot self-intersect.`);
    });
     // TODO: 他の形状との重なりチェック
  }
}