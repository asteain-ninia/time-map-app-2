// src/domain/entities/Polygon.js

import { Feature } from './Feature.js';
import { FeatureAnchor } from '../value-objects/FeatureAnchor.js';
// Vertex は直接使わないが、概念として関連

/**
 * リングの構造定義 (インターフェースの代わり)
 * @typedef {object} Ring
 * @property {string} id - リングの一意なID (例: "ring-1234567890-123")
 * @property {string[]} vertexIds - 頂点IDの配列 (順序付き、最低3点)
 * @property {'territory' | 'hole'} ringType - リングの種類 ('territory': 領土, 'hole': 穴)
 * @property {string | null} parentId - このリングを直接含む外周リングのID (ポリゴンの最外周リングまたは飛び地外周リングの場合はnull)
 */

function cloneRing(ring) {
  return {
    id: ring.id,
    vertexIds: [...ring.vertexIds],
    ringType: ring.ringType,
    parentId: ring.parentId ?? null
  };
}

function cloneRings(rings) {
  return (rings || []).map(ring => cloneRing(ring));
}

function buildPolygonShape(rings) {
  return {
    type: 'Polygon',
    rings: cloneRings(rings)
  };
}

function ensurePolygonAnchors(id, layerId, parentId, childIds, rings, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error(`Polygon ${id} requires at least one FeatureAnchor.`);
  }
  return anchors.map(anchor => {
    if (!(anchor instanceof FeatureAnchor)) {
      return anchor;
    }
    const shape = anchor.shape?.type === 'Polygon' && Array.isArray(anchor.shape?.rings)
      ? anchor.shape
      : buildPolygonShape(rings);
    const placement = {
      ...(anchor.placement || {}),
      layerId: typeof anchor.placement?.layerId === 'string' ? anchor.placement.layerId : layerId,
      parentId: typeof anchor.placement?.parentId === 'string' ? anchor.placement.parentId : parentId,
      childIds: Array.isArray(anchor.placement?.childIds) ? [...anchor.placement.childIds] : [...childIds]
    };
    return anchor.withShape(shape).withPlacement(placement);
  });
}

/**
 * 面情報を表すエンティティ (リングベース構造)
 */
export class Polygon extends Feature {
  /** @type {ReadonlyArray<Ring>} */
  _rings;
  /** @type {string} */
  _parentId; // ドメイン階層における親ポリゴンのID
  /** @type {ReadonlyArray<string>} */
  _childIds; // ドメイン階層における下位領域IDの配列

  /**
   * 面情報オブジェクトを作成 (リングベース)
   * @param {string} id - 一意のID
   * @param {*|null|undefined} properties - 互換維持のための未使用引数
   * @param {string} layerId - 所属レイヤーID
   * @param {string} parentId - ドメイン階層における上位領域ID（最上位の場合は "0"）
   * @param {string[]} childIds - ドメイン階層における下位領域IDの配列
   * @param {Ring[]} rings - このポリゴンを構成するリングの配列
   * @param {FeatureAnchor[]|null|undefined} anchors - 履歴アンカー正準データ
   */
  constructor(id, properties, layerId, parentId = "0", childIds = [], rings = [], anchors = null) {
    const preparedRings = cloneRings(rings);
    const preparedAnchors = ensurePolygonAnchors(
      id,
      layerId,
      parentId,
      childIds,
      preparedRings,
      anchors
    );

    // Feature基底クラスのコンストラクタ呼び出し
    // リングベースでは Feature._vertexIds は直接使わないが、空配列を渡しておく
    super(id, [], properties, layerId, preparedAnchors);

    this._parentId = parentId;
    this._childIds = [...childIds];

    // リング配列のディープコピーと不変性の確保
    this._rings = preparedRings.map(ring => ({
        id: ring.id,
        vertexIds: [...ring.vertexIds],
        ringType: ring.ringType,
        parentId: ring.parentId // null も許容
    }));

    if (this._anchors.length > 0) {
      const latestAnchor = this._anchors[this._anchors.length - 1];
      if (latestAnchor?.shape?.type === 'Polygon' && Array.isArray(latestAnchor.shape.rings)) {
        this._rings = cloneRings(latestAnchor.shape.rings);
      }
      if (typeof latestAnchor?.placement?.parentId === 'string') {
        this._parentId = latestAnchor.placement.parentId;
      }
      if (Array.isArray(latestAnchor?.placement?.childIds)) {
        this._childIds = [...latestAnchor.placement.childIds];
      }
    }

    // リング配列と各リングの頂点配列を凍結
    this._rings.forEach(ring => {
        Object.freeze(ring.vertexIds);
        Object.freeze(ring); // リングオブジェクト自体も凍結
    });
    Object.freeze(this._rings);
    Object.freeze(this._childIds);

    // --- 基本的な検証 ---
    if (this._rings.length === 0 && this._childIds.length === 0) {
      throw new Error('Polygon must have at least one ring or child polygons.');
    }
    // リングを持たないが子を持つ場合はOK (形状は子から計算される)

    this._rings.forEach((ring, index) => {
      if (!ring.id) {
          throw new Error(`Ring at index ${index} must have an ID.`);
      }
      if (!Array.isArray(ring.vertexIds) || ring.vertexIds.length < 3) {
        throw new Error(`Ring (id: ${ring.id}) must have at least three vertices.`);
      }
      if (ring.ringType !== 'territory' && ring.ringType !== 'hole') {
          throw new Error(`Ring (id: ${ring.id}) must have a 'ringType' of 'territory' or 'hole'.`);
      }
      if (ring.parentId !== null && typeof ring.parentId !== 'string') {
           throw new Error(`Ring (id: ${ring.id}) parentId must be a string or null.`);
      }
    });
  }

  /**
   * このポリゴンを構成するリングの配列を取得 (読み取り専用)
   * @returns {ReadonlyArray<Ring>} リングの配列
   */
  get rings() {
    const latestAnchor = this.getAnchorAt(null);
    if (latestAnchor?.shape?.type === 'Polygon' && Array.isArray(latestAnchor.shape.rings)) {
      return latestAnchor.shape.rings;
    }
    return this._rings;
  }

  /**
   * ドメイン階層における上位領域IDを取得
   * @returns {string} 上位領域ID
   */
  get parentId() {
    return this.getPlacementAt(null).parentId;
  }

  /**
   * ドメイン階層における下位領域IDの配列を取得 (読み取り専用コピー)
   * @returns {ReadonlyArray<string>} 下位領域IDの配列
   */
  get childIds() {
    return this.getPlacementAt(null).childIds;
  }

  /**
   * 指定時刻で有効なリング配列を取得
   * @param {TimePoint|null|undefined} timePoint
   * @returns {ReadonlyArray<Ring>}
   */
  getRingsAt(timePoint) {
    const anchor = this.getAnchorAt(timePoint);
    if (anchor?.shape?.type === 'Polygon' && Array.isArray(anchor.shape.rings)) {
      return anchor.shape.rings;
    }
    return this._rings;
  }

  /**
   * 指定時刻で有効な配置情報を取得
   * @param {TimePoint|null|undefined} timePoint
   * @returns {{layerId:string,parentId:string,childIds:string[]}}
   */
  getPlacementAt(timePoint) {
    const anchor = this.getAnchorAt(timePoint);
    const placement = anchor?.placement || {};
    return {
      layerId: typeof placement.layerId === 'string' ? placement.layerId : this._layerId,
      parentId: typeof placement.parentId === 'string' ? placement.parentId : this._parentId,
      childIds: Array.isArray(placement.childIds) ? [...placement.childIds] : [...this._childIds]
    };
  }

  /**
   * 下位領域を持つかどうかを判定
   * @returns {boolean} 下位領域を持つならtrue
   */
  hasChildren() {
    return this.childIds.length > 0;
  }

  /**
   * ポリゴンが直接的な形状（リング）を持つか判定
   * @returns {boolean} 1つ以上のリングを持つならtrue
   */
  hasShapeRings() {
      return this.rings.length > 0;
  }

  // --- Featureクラスから継承したメソッドのオーバーライド ---

  /**
   * @deprecated リングベース構造ではこのメソッドは直接使用せず、リング操作メソッド(addRing/removeRing/updateRingVertices等)を使用してください。
   *             プロパティやレイヤーIDの更新には withProperties, withLayerId を使用してください。
   */
  withVertexIds(vertexIds) {
      console.warn("Polygon.withVertexIds is deprecated. Use ring manipulation methods instead.");
      // このメソッドはリング構造では意味をなさないため、現状維持またはエラーを投げる
      // (もし Feature 基底クラスがこれを要求するなら、エラーにするか、
      //  特定の外周リングを更新するなどの特殊な意味付けが必要)
      return this; // 何も変更しない
  }

  /**
   * 新しい履歴アンカーの配列で新インスタンスを作成
   * @param {FeatureAnchor[]} anchors - 新しい履歴アンカー配列
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withAnchors(anchors) {
    const normalizedAnchors = Feature._normalizeAnchors(this._id, anchors);
    if (normalizedAnchors.length === 0) {
      throw new Error(`Polygon.withAnchors expects at least one anchor. (id: ${this._id})`);
    }
    const latestAnchor = normalizedAnchors[normalizedAnchors.length - 1];
    const latestShapeRings = latestAnchor?.shape?.type === 'Polygon' && Array.isArray(latestAnchor.shape?.rings)
      ? cloneRings(latestAnchor.shape.rings)
      : cloneRings(this.getRingsAt(null));
    const latestPlacement = latestAnchor?.placement || {};
    const layerId = typeof latestPlacement.layerId === 'string' ? latestPlacement.layerId : this._layerId;
    const parentId = typeof latestPlacement.parentId === 'string' ? latestPlacement.parentId : this.getPlacementAt(null).parentId;
    const childIds = Array.isArray(latestPlacement.childIds) ? [...latestPlacement.childIds] : this.getPlacementAt(null).childIds;
    return new Polygon(
      this._id,
      null,
      layerId,
      parentId,
      childIds,
      latestShapeRings,
      normalizedAnchors
    );
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成 (Featureクラスのメソッドをオーバーライド)
   * @param {*|null|undefined} properties - 互換維持のための未使用引数
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withProperties(properties) {
    void properties;
    throw new Error(`Polygon.withProperties は廃止されました。withAnchors を使用してください。 (id: ${this._id})`);
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成 (Featureクラスのメソッドをオーバーライド)
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withLayerId(layerId) {
    const placement = this.getPlacementAt(null);
    const baseRings = this.getRingsAt(null);
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withPlacement({
        ...(anchor.placement || {}),
        layerId
      }))
      : null;
    return new Polygon(
      this._id,
      null,
      layerId, // 新しいレイヤーID
      placement.parentId,
      placement.childIds,
      baseRings, // リングはそのまま引き継ぐ
      nextAnchors
    );
  }

  // --- 新しいリング操作メソッド (例) ---
  // PolygonEditService から呼び出されることを想定。
  // これらのメソッドは Polygon の不変性を保つ。

  /**
   * 新しいリング配列でインスタンスを生成する内部ヘルパー
   * @param {Ring[]} newRings
   * @returns {Polygon}
   * @private
   */
   _withRings(newRings) {
       const placement = this.getPlacementAt(null);
       const nextAnchors = this._anchors.length > 0
         ? this._anchors.map(anchor => anchor.withShape(buildPolygonShape(newRings)))
         : null;
       return new Polygon(
            this._id, null, this._layerId,
            placement.parentId, placement.childIds, newRings, nextAnchors
        );
   }

  /**
   * 特定のリングの頂点配列を更新した新しいPolygonインスタンスを返す
   * @param {string} ringId - 更新するリングのID
   * @param {string[]} newVertexIds - 新しい頂点ID配列
   * @returns {Polygon} 更新されたPolygonインスタンス
   * @throws {Error} ringIdが見つからない場合や newVertexIds が不正な場合
   */
  withUpdatedRingVertices(ringId, newVertexIds) {
      if (!Array.isArray(newVertexIds) || newVertexIds.length < 3) {
          throw new Error("New vertex IDs must be an array with at least 3 elements.");
      }
      const currentRings = this.rings;
      const ringIndex = currentRings.findIndex(r => r.id === ringId);
      if (ringIndex === -1) {
          throw new Error(`Ring with id ${ringId} not found in polygon ${this.id}.`);
      }
      const newRings = currentRings.map((ring, index) => {
          if (index === ringIndex) {
              // 対象リングの vertexIds を更新した新しいオブジェクトを返す
              return { ...ring, vertexIds: [...newVertexIds] };
          }
          return ring; // 他のリングはそのまま
      });
      return this._withRings(newRings); // 新しいリング配列でインスタンス生成
  }

   /**
    * 新しいリングを追加した新しいPolygonインスタンスを返す
    * @param {Ring} newRing - 追加するリングオブジェクト
    * @returns {Polygon} 更新されたPolygonインスタンス
    * @throws {Error} リングIDが重複する場合など
    */
   withAddedRing(newRing) {
        if (!newRing || !newRing.id || !Array.isArray(newRing.vertexIds) || (newRing.ringType !== 'territory' && newRing.ringType !== 'hole')) {
            throw new Error("Invalid ring data provided.");
        }
       const currentRings = this.rings;
       if (currentRings.some(r => r.id === newRing.id)) {
            throw new Error(`Ring with id ${newRing.id} already exists in polygon ${this.id}.`);
        }
        // parentId の存在チェックなどは Service 層で行う前提
        const newRings = [...currentRings, newRing];
        return this._withRings(newRings);
    }

   /**
    * 特定のリングを削除し、子の親子関係を再構築した新しいPolygonインスタンスを返す
    * @param {string} ringIdToRemove - 削除するリングのID
    * @returns {Polygon} 更新されたPolygonインスタンス
    */
   withRemovedRing(ringIdToRemove) {
         const currentRings = this.rings;
         const ringToRemove = currentRings.find(r => r.id === ringIdToRemove);
         if (!ringToRemove) {
             console.warn(`Ring with id ${ringIdToRemove} not found in polygon ${this.id}. Returning original polygon.`);
             return this;
         }

         const childrenByParent = new Map();
         for (const ring of currentRings) {
             const parentKey = ring.parentId !== undefined ? ring.parentId : null;
             if (!childrenByParent.has(parentKey)) {
                 childrenByParent.set(parentKey, []);
             }
             childrenByParent.get(parentKey).push(ring);
        }

        const ringsToRemove = new Set([ringIdToRemove]);
        const parentUpdates = new Map();

        if (ringToRemove.ringType === 'hole') {
            const reattachParentId = ringToRemove.parentId !== undefined ? ringToRemove.parentId : null;
            const territoryChildren = (childrenByParent.get(ringIdToRemove) || []).filter(child => child.ringType === 'territory');
            for (const territoryChild of territoryChildren) {
                ringsToRemove.add(territoryChild.id);
                const holeGrandChildren = childrenByParent.get(territoryChild.id) || [];
                for (const holeGrandChild of holeGrandChildren) {
                    if (holeGrandChild.ringType === 'hole') {
                        parentUpdates.set(holeGrandChild.id, reattachParentId);
                    } else {
                        console.warn(`Unexpected ringType ${holeGrandChild.ringType} under territory ring ${territoryChild.id} while removing hole ${ringIdToRemove}.`);
                    }
                }
            }
        } else if (ringToRemove.ringType === 'territory') {
            const promotionParentId = ringToRemove.parentId !== undefined ? ringToRemove.parentId : null;
            const holeChildren = (childrenByParent.get(ringIdToRemove) || []).filter(child => child.ringType === 'hole');
            for (const holeChild of holeChildren) {
                ringsToRemove.add(holeChild.id);
                const territoryGrandChildren = childrenByParent.get(holeChild.id) || [];
                for (const territoryGrandChild of territoryGrandChildren) {
                    if (territoryGrandChild.ringType === 'territory') {
                        parentUpdates.set(territoryGrandChild.id, promotionParentId);
                    } else {
                        console.warn(`Unexpected ringType ${territoryGrandChild.ringType} under hole ring ${holeChild.id} while removing territory ${ringIdToRemove}.`);
                    }
                }
            }
        } else {
            console.warn(`Ring ${ringIdToRemove} has unsupported ringType ${ringToRemove.ringType}.`);
            return this;
        }

         const newRings = currentRings
             .filter(ring => !ringsToRemove.has(ring.id))
             .map(ring => {
                 if (parentUpdates.has(ring.id)) {
                     return { ...ring, parentId: parentUpdates.get(ring.id) };
                 }
                return ring;
            });

        return this._withRings(newRings);
   }

  // --- ドメイン階層操作メソッド ---

  /**
   * 新しい上位領域IDで新インスタンスを作成
   * @param {string} parentId - 新しい上位領域ID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withParentId(parentId) {
    const placement = this.getPlacementAt(null);
    if (placement.parentId === parentId) return this;
    const baseRings = this.getRingsAt(null);
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withPlacement({
        ...(anchor.placement || {}),
        parentId
      }))
      : null;
    return new Polygon(
      this._id, null, this._layerId,
      parentId, // 新しい親ID
      placement.childIds, baseRings, nextAnchors
    );
  }

  /**
   * 下位領域IDを追加した新インスタンスを作成
   * @param {string} childId - 追加する下位領域ID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  addChildId(childId) {
    const placement = this.getPlacementAt(null);
    if (placement.childIds.includes(childId)) return this;
    const nextChildIds = [...placement.childIds, childId];
    const baseRings = this.getRingsAt(null);
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withPlacement({
        ...(anchor.placement || {}),
        childIds: nextChildIds
      }))
      : null;
    return new Polygon(
      this._id, null, this._layerId,
      placement.parentId,
      nextChildIds, // 子ID追加
      baseRings,
      nextAnchors
    );
  }

  /**
   * 下位領域IDを削除した新インスタンスを作成
   * @param {string} childId - 削除する下位領域ID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  removeChildId(childId) {
    const placement = this.getPlacementAt(null);
    const newChildIds = placement.childIds.filter(id => id !== childId);
    if (newChildIds.length === placement.childIds.length) return this;
    const baseRings = this.getRingsAt(null);
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withPlacement({
        ...(anchor.placement || {}),
        childIds: newChildIds
      }))
      : null;
    return new Polygon(
      this._id, null, this._layerId,
      placement.parentId,
      newChildIds, // 子ID削除
      baseRings,
      nextAnchors
    );
  }


  // --- 古いメソッド (非推奨化) ---

  /**
   * @deprecated リングベース構造では非推奨。代わりに Polygon.rings を使用してください。
   */
  get holesVertexIds() {
    console.warn("Polygon.holesVertexIds getter is deprecated. Use polygon.rings instead.");
    // 最上位の穴リングの頂点ID配列を返す（簡易的な互換性のため）
    return this.rings.filter(r => r.ringType === 'hole' && r.parentId === null).map(r => r.vertexIds);
  }

  /**
   * @deprecated リングベース構造では非推奨。代わりに Polygon.rings を使用してください。
   */
  get isMultiPolygon() {
    console.warn("Polygon.isMultiPolygon getter is deprecated. Use polygon.rings instead.");
    // 複数の最上位領土リングがある場合に true を返す（簡易的な互換性のため）
    return this.rings.filter(r => r.ringType === 'territory' && r.parentId === null).length > 1;
  }

  /**
   * @deprecated リングベース構造では非推奨。代わりに Polygon.rings を使用してください。
   */
  get subPolygons() {
    console.warn("Polygon.subPolygons getter is deprecated. Use polygon.rings instead.");
    // 最上位の飛び地リング（と、それにネストするリング全て）を旧形式に変換して返すのは複雑なため、空配列を返す
    return [];
  }

   /**
    * @deprecated リングベース構造では非推奨。代わりに hasShapeRings() を使用してください。
    */
   hasDirectGeometry() {
      console.warn("Polygon.hasDirectGeometry is deprecated. Use hasShapeRings() instead.");
      return this.hasShapeRings();
   }

  /**
   * @deprecated リングベース構造では非推奨。PolygonEditServiceを使用してリングを操作してください。
   */
  withHolesVertexIds(holesVertexIds) {
    console.warn("Polygon.withHolesVertexIds is deprecated. Use ring manipulation methods via PolygonEditService instead.");
    return this; // 何もしない
  }

  /**
   * @deprecated リングベース構造では非推奨。PolygonEditServiceを使用してリングを操作してください。
   */
  withMultiPolygonData(isMultiPolygon, subPolygons = []) {
    console.warn("Polygon.withMultiPolygonData is deprecated. Use ring manipulation methods via PolygonEditService instead.");
    return this; // 何もしない
  }

  /**
   * @deprecated リングベース構造では非推奨。PolygonEditServiceを使用してリングを操作してください。
   */
  withSubPolygonHoles(subPolygonIndex, newHolesVertexIds) {
      console.warn("Polygon.withSubPolygonHoles is deprecated. Use ring manipulation methods via PolygonEditService instead.");
      return this; // 何もしない
  }

  /**
   * @deprecated リングベース構造では、PolygonEditService を使用して Polygon インスタンスを生成してください。
   */
  static create(id, properties, geometry, layerId) {
    console.error("Polygon.create is deprecated. Use the Polygon constructor directly after preparing the 'rings' array using PolygonEditService or similar logic.");
    // このメソッドで古い geometry から rings を生成するのは複雑すぎるため、エラーにするか、
    // 最低限の互換性（外周のみ）を提供する。ここではエラーを投げる。
    throw new Error("Polygon.create is deprecated. Please use the constructor with a pre-built 'rings' array.");
    // return new Polygon(id, properties, layerId, geometry.parentId || "0", geometry.childIds || [], []);
  }
}
