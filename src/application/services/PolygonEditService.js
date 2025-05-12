// src/application/services/PolygonEditService.js

import { IPolygonEditService } from './IPolygonEditService.js';
import { Polygon } from '../../domain/entities/Polygon.js';
import { WorldRepository } from '../WorldRepository.js'; // 型チェック用
import { GeometryService } from '../../domain/services/GeometryService.js';
import { IdGenerationService } from './IdGenerationService.js'; // ★ IdGenerationService をインポート

/**
 * ポリゴン編集サービスの具象実装
 * (リングベース構造への移行後に実装される想定)
 */
export class PolygonEditService extends IPolygonEditService {
  /** @type {WorldRepository} */
  _worldRepository;
  /** @type {IdGenerationService} */
  _idGenerationService;
  /** @type {GeometryService} */
  _geometryService;

  /**
   * PolygonEditServiceを作成
   * @param {WorldRepository} worldRepository
   * @param {IdGenerationService} idGenerationService - ID生成サービス
   */
  constructor(worldRepository, idGenerationService) { // idGenerationService を引数に変更
    super();
    if (!worldRepository) {
      throw new Error("WorldRepository is required for PolygonEditService.");
    }
    if (!(idGenerationService instanceof IdGenerationService)) { // インスタンスチェックに変更
        throw new Error("A valid IdGenerationService instance is required for PolygonEditService.");
    }
    this._worldRepository = worldRepository;
    this._idGenerationService = idGenerationService;
    this._geometryService = new GeometryService();
  }

  /**
   * ポリゴンのリング構造を検証する
   * @param {Polygon} polygon - 検証対象のポリゴン (リングベース構造)
   * @param {Object} world - ワールドデータ (頂点情報を参照)
   * @returns {Promise<void>} 検証エラーがあれば例外をスロー
   */
  async validatePolygonRings(polygon, world) {
    if (!polygon || !Array.isArray(polygon.rings)) {
        throw new Error("Invalid polygon or rings data for validation.");
    }
    if (!world || !world.vertices) {
        throw new Error("World vertex data is required for validation.");
    }

    const rings = polygon.rings;
    const verticesMap = new Map(world.vertices.map(v => [v.id, {id: v.id, x: v.x, y: v.y}]));
    const getVertices = (ringId) => {
        const ring = rings.find(r => r.id === ringId);
        return ring ? (ring.vertexIds || []).map(id => verticesMap.get(id)).filter(Boolean) : [];
    };
    const getRingById = (ringId) => rings.find(r => r.id === ringId);

    // 0. リングの基本的な構造チェック
    for (const ring of rings) {
        if (!ring || !ring.id || !Array.isArray(ring.vertexIds) || ring.vertexIds.length < 3 || typeof ring.isOuter !== 'boolean') {
            throw new Error(`Invalid ring structure found (ID: ${ring?.id || 'unknown'}).`);
        }
        if (ring.vertexIds.some(id => !verticesMap.has(id))) {
             throw new Error(`Ring (ID: ${ring.id}) contains non-existent vertex IDs.`);
        }
        if (ring.parentId && !rings.some(r => r.id === ring.parentId)) {
             throw new Error(`Ring (ID: ${ring.id}) refers to a non-existent parent ring (ID: ${ring.parentId}).`);
        }
        if (ring.parentId) {
            const parentRing = getRingById(ring.parentId);
            if (parentRing && !parentRing.isOuter) {
                 throw new Error(`Ring (ID: ${ring.id}) cannot have an inner ring (ID: ${ring.parentId}) as its parent.`);
            }
        }
    }

    // 1. 個別リング検証: 自己交差チェック
    for (const ring of rings) {
      const ringVertices = getVertices(ring.id);
      if (this._geometryService.isPolygonSelfIntersecting(ringVertices)) {
        throw new Error(`Ring (ID: ${ring.id}) is self-intersecting.`);
      }
    }

    const ringGroups = new Map();
    rings.forEach(ring => {
      const parentKey = ring.parentId === null ? 'null' : ring.parentId;
      if (!ringGroups.has(parentKey)) {
        ringGroups.set(parentKey, []);
      }
      ringGroups.get(parentKey).push(ring);
    });

    const ringBBoxes = new Map();
    rings.forEach(ring => {
        const vertices = getVertices(ring.id);
        ringBBoxes.set(ring.id, this._geometryService.getBoundingBox(vertices));
    });

    for (const [parentKey, children] of ringGroups.entries()) {
        const parentRingId = parentKey === 'null' ? null : parentKey;
        const parentRing = parentRingId ? getRingById(parentRingId) : null;
        const parentVertices = parentRing ? getVertices(parentRingId) : null;
        const parentBBox = parentRingId ? ringBBoxes.get(parentRingId) : null;

        for (let i = 0; i < children.length; i++) {
            const ring1 = children[i];
            const vertices1 = getVertices(ring1.id);
            const box1 = ringBBoxes.get(ring1.id);

            if (!ring1.isOuter && parentRing) {
                if (!parentBBox || !box1 /* || !this._geometryService.boxesIntersect(box1, parentBBox) */ ) {
                    // BBoxチェックは必須ではない
                }
                if (!this._geometryService.isRingCompletelyInsideRing(vertices1, parentVertices)) {
                    throw new Error(`Inner ring (Hole ID: ${ring1.id}) is not completely inside its parent outer ring (ID: ${parentRingId}).`);
                }
            }

            for (let j = i + 1; j < children.length; j++) {
                const ring2 = children[j];
                const vertices2 = getVertices(ring2.id);
                const box2 = ringBBoxes.get(ring2.id);

                if (!box1 || !box2 || !this._geometryService.boxesIntersect(box1, box2)) {
                    continue;
                }

                if (this._geometryService.doRingsIntersect(vertices1, vertices2)) {
                    throw new Error(`Sibling rings (ID: ${ring1.id} and ${ring2.id}) intersect.`);
                }

                if (!ring1.isOuter && !ring2.isOuter) {
                    if (this._geometryService.isRingCompletelyInsideRing(vertices1, vertices2)) {
                        throw new Error(`Sibling holes (ID: ${ring1.id} and ${ring2.id}) should not contain each other ( ${ring1.id} is inside ${ring2.id}).`);
                    }
                    if (this._geometryService.isRingCompletelyInsideRing(vertices2, vertices1)) {
                        throw new Error(`Sibling holes (ID: ${ring1.id} and ${ring2.id}) should not contain each other ( ${ring2.id} is inside ${ring1.id}).`);
                    }
                }
            }
        }
    }
  }

  /**
   * ポリゴンに新しいリングを追加する (IDは内部で生成)
   * @param {string} polygonId - 対象ポリゴンのID
   * @param {object} ringData - 追加するリングの情報 { vertexIds: string[], isOuter: boolean, parentId?: string }
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス (保存は呼び出し元で行う)
   * @throws {Error} ポリゴンが見つからない場合、リングデータが無効な場合
   */
  async addRingToPolygon(polygonId, ringData) {
    const world = await this._worldRepository.getWorld();
    const polygonIndex = world.features.findIndex(f => f.id === polygonId && f instanceof Polygon);
    if (polygonIndex === -1) {
      throw new Error(`Polygon with ID ${polygonId} not found.`);
    }
    const currentPolygon = world.features[polygonIndex];

    if (!ringData || !Array.isArray(ringData.vertexIds) || ringData.vertexIds.length < 3 || typeof ringData.isOuter !== 'boolean') {
        throw new Error("Invalid ring data provided. Requires { vertexIds: string[], isOuter: boolean, parentId?: string }.");
    }
    if (ringData.parentId !== undefined && ringData.parentId !== null && typeof ringData.parentId !== 'string') {
        throw new Error("Invalid ringData.parentId. Must be null or a string.");
    }

    const newRingId = this._idGenerationService.generateId('ring'); // ★ IdGenerationService を利用
    const newRing = {
        id: newRingId,
        vertexIds: [...ringData.vertexIds],
        isOuter: ringData.isOuter,
        parentId: ringData.parentId !== undefined ? ringData.parentId : null
    };

    try {
        // ポリゴンエンティティにリングを追加（不変操作）
        const updatedPolygon = currentPolygon.withAddedRing(newRing);
        // 追加後のポリゴン全体を検証
        await this.validatePolygonRings(updatedPolygon, world);
        return updatedPolygon;
    } catch (error) {
        console.error(`Error adding ring to polygon ${polygonId}:`, error);
        throw error;
    }
  }

  /**
   * ポリゴンにID指定でリングを追加する (主にアンドゥ/リドゥ用)
   * @param {string} polygonId - 対象ポリゴンのID
   * @param {object} ringDataWithId - 追加するリングの情報 { id: string, vertexIds: string[], isOuter: boolean, parentId?: string }
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス (保存は呼び出し元で行う)
   * @throws {Error} ポリゴンが見つからない場合、リングデータが無効な場合、IDが重複する場合
   */
  async addRingWithId(polygonId, ringDataWithId) {
    const world = await this._worldRepository.getWorld();
    const polygonIndex = world.features.findIndex(f => f.id === polygonId && f instanceof Polygon);
    if (polygonIndex === -1) {
      throw new Error(`Polygon with ID ${polygonId} not found.`);
    }
    const currentPolygon = world.features[polygonIndex];

    // ringDataWithId の検証 (IDを含む)
    if (!ringDataWithId || typeof ringDataWithId.id !== 'string' || !ringDataWithId.id ||
        !Array.isArray(ringDataWithId.vertexIds) || ringDataWithId.vertexIds.length < 3 ||
        typeof ringDataWithId.isOuter !== 'boolean') {
      throw new Error("Invalid ring data provided. Requires { id: string, vertexIds: string[], isOuter: boolean, parentId?: string }.");
    }
    if (ringDataWithId.parentId !== undefined && ringDataWithId.parentId !== null && typeof ringDataWithId.parentId !== 'string') {
      throw new Error("Invalid ringDataWithId.parentId. Must be null or a string.");
    }

    // IDの重複チェック
    if (currentPolygon.rings.some(r => r.id === ringDataWithId.id)) {
      throw new Error(`Ring with ID ${ringDataWithId.id} already exists in polygon ${polygonId}.`);
    }

    // IDを指定してリングオブジェクトを作成
    const newRing = {
        id: ringDataWithId.id,
        vertexIds: [...ringDataWithId.vertexIds],
        isOuter: ringDataWithId.isOuter,
        parentId: ringDataWithId.parentId !== undefined ? ringDataWithId.parentId : null
    };

    try {
        // ポリゴンエンティティにリングを追加（不変操作）
        // Polygon.withAddedRing は渡されたリングオブジェクトをそのまま使う
        const updatedPolygon = currentPolygon.withAddedRing(newRing);
        // 追加後のポリゴン全体を検証
        await this.validatePolygonRings(updatedPolygon, world);
        return updatedPolygon;
    } catch (error) {
        console.error(`Error adding ring with ID ${ringDataWithId.id} to polygon ${polygonId}:`, error);
        throw error; // エラーを再スロー
    }
  }


  /**
   * ポリゴンからリングを削除する
   * @param {string} polygonId - 対象ポリゴンのID
   * @param {string} ringId - 削除するリングのID
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス (保存は呼び出し元で行う)
   * @throws {Error} ポリゴンが見つからない場合
   */
  async removeRingFromPolygon(polygonId, ringId) {
    const world = await this._worldRepository.getWorld();
    const polygonIndex = world.features.findIndex(f => f.id === polygonId && f instanceof Polygon);
    if (polygonIndex === -1) {
      throw new Error(`Polygon with ID ${polygonId} not found.`);
    }
    const currentPolygon = world.features[polygonIndex];

    try {
        const updatedPolygon = currentPolygon.withRemovedRing(ringId);
        // 削除後、ポリゴンが空でなければ検証する
        if (updatedPolygon.rings.length > 0 || updatedPolygon.hasChildren()) {
             await this.validatePolygonRings(updatedPolygon, world);
        } else if (updatedPolygon.rings.length === 0 && !updatedPolygon.hasChildren()) {
            // ポリゴンが空になった場合の警告（削除は上位のUseCaseが判断）
            console.warn(`Polygon ${polygonId} became empty after removing ring ${ringId}. It might need to be deleted.`);
        }
        return updatedPolygon;
    } catch (error) {
        // Polygon.withRemovedRingが子リング依存エラーを投げる可能性あり
        console.error(`Error removing ring ${ringId} from polygon ${polygonId}:`, error);
        throw error;
    }
  }

  /**
   * ポリゴンの特定のリングの頂点を更新する
   * @param {string} polygonId - 対象ポリゴンのID
   * @param {string} ringId - 更新するリングのID
   * @param {string[]} newVertexIds - 新しい頂点ID配列
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス (保存は呼び出し元で行う)
   * @throws {Error} ポリゴンが見つからない場合、リングが見つからない場合、頂点データが無効な場合
   */
  async updateRingVertices(polygonId, ringId, newVertexIds) {
    const world = await this._worldRepository.getWorld();
    const polygonIndex = world.features.findIndex(f => f.id === polygonId && f instanceof Polygon);
    if (polygonIndex === -1) {
      throw new Error(`Polygon with ID ${polygonId} not found.`);
    }
    const currentPolygon = world.features[polygonIndex];

    if (!Array.isArray(newVertexIds) || newVertexIds.length < 3) {
        throw new Error("Invalid new vertex IDs provided. Requires an array with at least 3 elements.");
    }

    try {
        // ポリゴンエンティティのメソッドでリング頂点を更新
        const updatedPolygon = currentPolygon.withUpdatedRingVertices(ringId, newVertexIds);
        // 更新後のポリゴン全体を検証
        await this.validatePolygonRings(updatedPolygon, world);
        return updatedPolygon;
    } catch (error) {
        // Polygon.withUpdatedRingVerticesがエラーを投げる可能性あり (ringIdが見つからないなど)
        console.error(`Error updating vertices for ring ${ringId} in polygon ${polygonId}:`, error);
        throw error;
    }
  }

  /**
   * ポリゴンの形状情報全体を更新する（リングベース構造を考慮）(未実装)
   * このメソッドは、UseCase が個別のリング操作メソッドを呼び出す方針（案B）を採用したため、実装されません。
   * @param {Polygon} currentPolygon - 更新前のポリゴンインスタンス
   * @param {Object} geometryUpdates - 更新される形状情報
   * @param {Object} world - ワールドデータ
   * @returns {Promise<Polygon>} 更新されたポリゴンインスタンス (保存は呼び出し元で行う)
   * @abstract
   * @deprecated Use individual ring manipulation methods (addRingToPolygon, etc.) instead.
   */
   async updatePolygonGeometry(currentPolygon, geometryUpdates, world) {
     console.error("Method 'updatePolygonGeometry' is deprecated and not implemented. Use individual ring manipulation methods.");
     throw new Error("Method 'updatePolygonGeometry' is deprecated and not implemented.");
   }

  /**
   * ポリゴンを分裂させる (リングベース対応) (未実装)
   * @param {string} polygonId - 分裂するポリゴンのID
   * @param {Object} divisionData - 分裂情報 (例: 分割線を示す頂点配列など)
   * @returns {Promise<Object>} 更新情報 { originalPolygon?, newPolygons }
   * @abstract
   */
  async splitPolygon(polygonId, divisionData) {
     // TODO: リングベースでの分裂ロジックを実装 (将来のタスク)
     console.warn("Method 'splitPolygon' not implemented yet.");
     throw new Error("Method 'splitPolygon' not implemented.");
  }

}
