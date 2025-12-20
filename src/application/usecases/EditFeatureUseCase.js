// src/application/usecases/EditFeatureUseCase.js

import { Polygon } from '../../domain/entities/Polygon';
import { Vertex } from '../../domain/entities/Vertex';

// 分割されたUseCaseをインポート
import { AddFeatureUseCase } from './feature/AddFeatureUseCase';
import { UpdateFeatureUseCase } from './feature/UpdateFeatureUseCase';
import { DeleteFeatureUseCase } from './feature/DeleteFeatureUseCase';
import { VertexEditUseCase } from './feature/VertexEditUseCase';
// import { IPolygonEditService } from '../services/IPolygonEditService'; // リングベース移行後
import { IdGenerationService } from '../services/IdGenerationService'; // IdGenerationService をインポート

/**
 * 地理オブジェクト編集のファサードユースケース
 * 実際の処理は専門のUseCaseに委譲する
 */
export class EditFeatureUseCase {
  /**
   * ユースケースを作成
   * @param {WorldRepository} worldRepository
   * @param {GeometryService} geometryService
   * @param {LayerService} layerService
   * @param {IPolygonEditService} polygonEditService - ポリゴン編集サービス (リングベース移行後)
   * @param {IdGenerationService} idGenerationService - ID生成サービス
   */
  constructor(worldRepository, geometryService, layerService, polygonEditService, idGenerationService) { // idGenerationService を引数に追加
    this._worldRepository = worldRepository;
    this._geometryService = geometryService;
    this._layerService = layerService;
    this._polygonEditService = polygonEditService;
    this._idGenerationService = idGenerationService; 

    // 共通ヘルパー関数をここで保持または生成
    this._generateIdFunc = this._generateId.bind(this); // _generateId は内部で _idGenerationService を使う
    this._processGeometryFunc = this._processGeometry.bind(this);
    this._getVerticesFromIdsFunc = this._getVerticesFromIds.bind(this);
    this._cleanupUnusedVerticesFunc = this._cleanupUnusedVertices.bind(this);
    this._getOlderVertexIdFunc = this._getOlderVertexId.bind(this);

    // 専門UseCaseのインスタンス化
    this._addFeatureUseCase = new AddFeatureUseCase(
        worldRepository, geometryService, layerService,
        this._generateIdFunc, this._processGeometryFunc, this._getVerticesFromIdsFunc
    );
    this._updateFeatureUseCase = new UpdateFeatureUseCase(
        worldRepository, geometryService, layerService,
        this._processGeometryFunc, this._getVerticesFromIdsFunc,
        polygonEditService
    );
    this._deleteFeatureUseCase = new DeleteFeatureUseCase(
        worldRepository,
        this._cleanupUnusedVerticesFunc
    );
    this._vertexEditUseCase = new VertexEditUseCase(
        worldRepository, geometryService,
        this._cleanupUnusedVerticesFunc,
        this._generateIdFunc, this._getOlderVertexIdFunc,
        layerService
    );
  }

  // --- 公開メソッド (委譲) ---

  async addFeature(featureType, properties, geometry, layerId) {
    return this._addFeatureUseCase.execute(featureType, properties, geometry, layerId);
  }

  async updateFeature(featureId, updates) {
    return this._updateFeatureUseCase.execute(featureId, updates);
  }

  async deleteFeature(featureId) {
    return this._deleteFeatureUseCase.execute(featureId);
  }

  async deleteVertices(vertexIdsToDelete) {
    return this._vertexEditUseCase.deleteVertices(vertexIdsToDelete);
  }

  async moveVertex(vertexId, newPosition) {
    return this._vertexEditUseCase.moveVertex(vertexId, newPosition);
  }

  async moveVertices(vertexUpdates) {
    return this._vertexEditUseCase.moveVertices(vertexUpdates);
  }

  async shareVertices(vertexId1, vertexId2) {
    return this._vertexEditUseCase.shareVertices(vertexId1, vertexId2);
  }

  async unlinkSharedVertex(vertexId, featureId, vertexIdToUse = null) {
    return this._vertexEditUseCase.unlinkSharedVertex(vertexId, featureId, vertexIdToUse);
  }

  /**
   * 地物のエッジに頂点を追加する (VertexEditUseCaseに委譲)
   * @param {string} featureId - 対象の地物ID
   * @param {string} segmentStartVertexId - 線分の開始頂点ID
   * @param {string} segmentEndVertexId - 線分の終了頂点ID
   * @param {{x: number, y: number}} newVertexPosition - 新しい頂点のワールド座標
   * @param {string | null} [ringId=null] - ポリゴンの場合、対象リングのID
   * @param {string | null} [vertexIdToUse=null] - Redo時に再利用する頂点ID
   * @returns {Promise<{newVertex: Vertex, updatedFeature: Feature}>} 追加された頂点と更新された地物のインスタンス
   */
  async addVertexToFeatureEdge(featureId, segmentStartVertexId, segmentEndVertexId, newVertexPosition, ringId = null, vertexIdToUse = null) {
    // 修正: vertexIdToUse をそのまま VertexEditUseCase に渡す
    return this._vertexEditUseCase.addVertexToFeatureEdge(featureId, segmentStartVertexId, segmentEndVertexId, newVertexPosition, ringId, vertexIdToUse);
  }

  // --- ポリゴン固有操作 (リングベース移行後は PolygonEditService へ委譲) ---

  async splitPolygon(polygonId, divisionData) {
    // TODO: リングベース移行後、PolygonEditService に委譲
    console.warn("splitPolygon is not fully implemented after refactoring.");
    throw new Error("splitPolygon not implemented yet after refactoring.");
  }

  async changePolygonParent(polygonId, newParentId) {
    console.warn("changePolygonParent needs careful review after refactoring.");
    throw new Error("changePolygonParent not implemented yet after refactoring.");
  }

  // --- 共通ヘルパーメソッド (内部利用またはサブUseCaseから参照) ---

  /**
   * ID生成 (IdGenerationServiceを利用)
   * @param {string} type - 生成するIDのタイプ
   * @returns {string} 生成されたID
   * @private
   */
  _generateId(type) {
    // IdGenerationService のメソッドを呼び出す
    return this._idGenerationService.generateId(type);
  }

  /**
   * 形状情報の処理とID割り当て (Add/Update UseCaseから利用)
   * @param {Object} geometry - 形状情報 (updateFeatureのコメント参照)
   * @param {Object} world - 世界データ
   * @returns {Object} 処理された形状情報 (新しい頂点のIDを含む)
   * 副作用: world.vertices を変更する
   * @private
   */
  _processGeometry(geometry, world) {
    const processedGeometry = { ...geometry };
    let verticesChanged = false;

    if (geometry.vertices && Array.isArray(geometry.vertices)) {
      processedGeometry.vertexIds = processedGeometry.vertexIds || [];
      for (const vertex of geometry.vertices) {
          if(vertex.x === undefined || vertex.y === undefined) continue;
          const vertexId = this._generateId('vertex'); // 内部メソッド経由でIdGenerationServiceを利用
          processedGeometry.vertexIds.push(vertexId);
          world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
          verticesChanged = true;
      }
       delete processedGeometry.vertices;
    }

    if (geometry.holes && Array.isArray(geometry.holes)) {
      processedGeometry.holesVertexIds = processedGeometry.holesVertexIds || [];
      for (const hole of geometry.holes) {
        if(!Array.isArray(hole)) continue;
        const holeIds = [];
        for (const vertex of hole) {
            if(vertex.x === undefined || vertex.y === undefined) continue;
            const vertexId = this._generateId('vertex');
            holeIds.push(vertexId);
            world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
            verticesChanged = true;
        }
        if(holeIds.length >= 3) {
           processedGeometry.holesVertexIds.push(holeIds);
        }
      }
      delete processedGeometry.holes;
    }

     if (geometry.newSubPolygonVertices && Array.isArray(geometry.newSubPolygonVertices)) {
         const newSubPolygonVertexIds = [];
         for (const vertex of geometry.newSubPolygonVertices) {
              if(vertex.x === undefined || vertex.y === undefined) continue;
              const vertexId = this._generateId('vertex');
              newSubPolygonVertexIds.push(vertexId);
              world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
              verticesChanged = true;
         }
         if (newSubPolygonVertexIds.length >= 3) {
             processedGeometry.newSubPolygonVertexIds = newSubPolygonVertexIds;
         }
     }

     if (geometry.targetSubPolygonIndex !== undefined && geometry.newHolesForSubPolygon && Array.isArray(geometry.newHolesForSubPolygon)) {
         processedGeometry.newHolesVertexIdsForSubPolygon = [];
         for (const hole of geometry.newHolesForSubPolygon) {
             if(!Array.isArray(hole)) continue;
             const holeIds = [];
             for (const vertex of hole) {
                 if(vertex.x === undefined || vertex.y === undefined) continue;
                 const vertexId = this._generateId('vertex');
                 holeIds.push(vertexId);
                 world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
                 verticesChanged = true;
             }
             if(holeIds.length >= 3) {
                processedGeometry.newHolesVertexIdsForSubPolygon.push(holeIds);
             }
         }
        delete processedGeometry.newHolesForSubPolygon;
     }

    if(geometry.subPolygons && Array.isArray(geometry.subPolygons)) {
        processedGeometry.subPolygons = geometry.subPolygons.map(sub => ({
            vertexIds: sub.vertexIds || [],
            holesVertexIds: sub.holesVertexIds || []
        }));
    }
    return processedGeometry;
  }

  /**
   * 使用されていない頂点のクリーンアップ (Delete/VertexEdit UseCaseから利用)
   * @param {Object} world - 世界データ
   * @param {string[]} vertexIdsToCheck - チェック対象の頂点ID (指定がなければ全地物をチェック)
   * @private
   */
  _cleanupUnusedVertices(world, vertexIdsToCheck = []) {
      const allUsedVertexIds = new Set();
      world.features.forEach(f => {
           if (!f || typeof f !== 'object') return;
           const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
           if (f.vertexIds) f.vertexIds.forEach(id => allUsedVertexIds.add(id));
           if (isPolygon && f.rings && Array.isArray(f.rings)) { // リングベースのポリゴン対応
               f.rings.forEach(ring => {
                   if (ring.vertexIds) ring.vertexIds.forEach(id => allUsedVertexIds.add(id));
               });
           } else if (isPolygon && f.holesVertexIds) { // 古い形式へのフォールバック
               (f.holesVertexIds || []).flat().forEach(id => allUsedVertexIds.add(id));
           }
           // 古い isMultiPolygon / subPolygons 形式はリングベース移行後は通常存在しない
           // if (isPolygon && f.isMultiPolygon && f.subPolygons) { ... }
       });

      const originalVertexCount = world.vertices.length;
      const verticesToDelete = vertexIdsToCheck.length > 0
         ? vertexIdsToCheck.filter(id => !allUsedVertexIds.has(id))
         : world.vertices.map(v => v.id).filter(id => !allUsedVertexIds.has(id));

      if (verticesToDelete.length > 0) {
          const deleteSet = new Set(verticesToDelete);
          world.vertices = world.vertices.filter(v => !deleteSet.has(v.id));
          const removedCount = deleteSet.size;
          if (removedCount > 0) {
            console.log(`[EditFeatureUseCase Facade] Cleaned up ${removedCount} unused vertices (via _cleanupUnusedVertices).`);
          }
      }
  }

  /**
   * 古いほうの頂点IDを特定 (VertexEdit UseCaseから利用)
   * @param {string} id1 - 頂点1のID
   * @param {string} id2 - 頂点2のID
   * @returns {string} 古いほうのID
   * @private
   */
  _getOlderVertexId(id1, id2) {
    const getTimestamp = (id) => {
      if (!id || typeof id !== 'string') return 0;
      const parts = id.split('-');
      return parts.length > 1 ? parseInt(parts[1], 10) : 0;
    };
    const timestamp1 = getTimestamp(id1);
    const timestamp2 = getTimestamp(id2);
    if (timestamp1 === timestamp2 || isNaN(timestamp1) || isNaN(timestamp2)) {
        return id1 <= id2 ? id1 : id2;
    }
    return timestamp1 < timestamp2 ? id1 : id2;
  }

  /**
   * 頂点ID配列から頂点オブジェクト配列を取得 (Add/Update UseCaseから利用)
   * @param {string[]} vertexIds
   * @param {Object} world
   * @returns {Vertex[]}
   * @private
   */
   _getVerticesFromIds(vertexIds, world) {
    if (!vertexIds || !world || !world.vertices) return [];
    const vertexMap = new Map(world.vertices.map(v => [v.id, v]));
    return vertexIds
        .map(id => {
            const data = vertexMap.get(id);
            return data ? new Vertex(data.id, data.x, data.y) : null;
        })
        .filter(Boolean);
   }
}
