/**
 * 面情報を表すエンティティ
 */
export class Polygon extends Feature {
  /**
   * 面情報オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]|null} vertexIds - 頂点IDの配列（外周、順序付き）またはnull（下位領域による構成時）
   * @param {Property[]} properties - 時間依存プロパティの配列
   * @param {string} layerId - 所属レイヤーID
   * @param {string[][]} holesVertexIds - 穴の頂点IDの配列の配列
   * @param {string} parentId - 上位領域ID（最上位の場合は "0"）
   * @param {string[]} childIds - 下位領域IDの配列
   * @param {boolean} isMultiPolygon - 飛び地を持つ複合ポリゴンかどうか
   * @param {Object[]} subPolygons - 飛び地ポリゴン情報の配列（isMultiPolygonがtrueの場合）
   */
  constructor(id, vertexIds, properties, layerId, holesVertexIds = [], parentId = "0", childIds = [], isMultiPolygon = false, subPolygons = []) {
    super(id, vertexIds || [], properties, layerId);
    
    this._holesVertexIds = holesVertexIds.map(hole => [...hole]);
    this._parentId = parentId;
    this._childIds = [...childIds];
    this._isMultiPolygon = isMultiPolygon;
    this._subPolygons = isMultiPolygon ? [...subPolygons] : [];
    
    // 不変性を保証
    this._holesVertexIds.forEach(hole => Object.freeze(hole));
    Object.freeze(this._holesVertexIds);
    Object.freeze(this._childIds);
    Object.freeze(this._subPolygons);
    
    // 面情報の検証
    if (vertexIds && vertexIds.length > 0) {
      // 直接頂点で定義される場合、少なくとも3つの頂点が必要
      if (vertexIds.length < 3) {
        throw new Error('Polygon must have at least three vertices');
      }
    } else if (childIds.length === 0) {
      // 頂点がなく、子もない場合はエラー
      throw new Error('Polygon must either have vertices or child polygons');
    }
    
    // 穴の検証
    this._holesVertexIds.forEach(hole => {
      if (hole.length < 3) {
        throw new Error('Polygon hole must have at least three vertices');
      }
    });
    
    // 飛び地の検証
    if (isMultiPolygon) {
      if (this._subPolygons.length < 2) {
        throw new Error('MultiPolygon must have at least two sub-polygons');
      }
      
      this._subPolygons.forEach(subPoly => {
        if (!subPoly.vertexIds || subPoly.vertexIds.length < 3) {
          throw new Error('Each sub-polygon must have at least three vertices');
        }
      });
    }
  }

  /**
   * 穴の頂点IDの配列の配列を取得
   * @returns {string[][]} 穴の頂点ID配列の配列
   */
  get holesVertexIds() {
    return this._holesVertexIds;
  }

  /**
   * 上位領域IDを取得
   * @returns {string} 上位領域ID
   */
  get parentId() {
    return this._parentId;
  }

  /**
   * 下位領域IDの配列を取得
   * @returns {string[]} 下位領域IDの配列
   */
  get childIds() {
    return this._childIds;
  }

  /**
   * 飛び地を持つ複合ポリゴンかどうかを取得
   * @returns {boolean} 飛び地を持つならtrue
   */
  get isMultiPolygon() {
    return this._isMultiPolygon;
  }

  /**
   * 飛び地ポリゴン情報の配列を取得
   * @returns {Object[]} 飛び地情報の配列
   */
  get subPolygons() {
    return this._subPolygons;
  }

  /**
   * 下位領域を持つかどうかを判定
   * @returns {boolean} 下位領域を持つならtrue
   */
  hasChildren() {
    return this._childIds.length > 0;
  }

  /**
   * 形状が直接頂点で定義されるかどうかを判定
   * @returns {boolean} 直接頂点で定義されるならtrue
   */
  hasDirectGeometry() {
    return this._vertexIds && this._vertexIds.length > 0;
  }

  /**
   * 新しい穴の頂点IDの配列で新インスタンスを作成
   * @param {string[][]} holesVertexIds - 新しい穴の頂点IDの配列の配列
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withHolesVertexIds(holesVertexIds) {
    return new Polygon(
      this._id, 
      this._vertexIds, 
      this._properties, 
      this._layerId,
      holesVertexIds,
      this._parentId,
      this._childIds,
      this._isMultiPolygon,
      this._subPolygons
    );
  }

  /**
   * 新しい上位領域IDで新インスタンスを作成
   * @param {string} parentId - 新しい上位領域ID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withParentId(parentId) {
    return new Polygon(
      this._id, 
      this._vertexIds, 
      this._properties, 
      this._layerId,
      this._holesVertexIds,
      parentId,
      this._childIds,
      this._isMultiPolygon,
      this._subPolygons
    );
  }

  /**
   * 新しい下位領域IDの配列で新インスタンスを作成
   * @param {string[]} childIds - 新しい下位領域IDの配列
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withChildIds(childIds) {
    return new Polygon(
      this._id, 
      this._vertexIds, 
      this._properties, 
      this._layerId,
      this._holesVertexIds,
      this._parentId,
      childIds,
      this._isMultiPolygon,
      this._subPolygons
    );
  }

  /**
   * 下位領域IDを追加した新インスタンスを作成
   * @param {string} childId - 追加する下位領域ID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  addChildId(childId) {
    return this.withChildIds([...this._childIds, childId]);
  }

  /**
   * 下位領域IDを削除した新インスタンスを作成
   * @param {string} childId - 削除する下位領域ID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  removeChildId(childId) {
    return this.withChildIds(this._childIds.filter(id => id !== childId));
  }

  /**
   * 飛び地情報を更新した新インスタンスを作成
   * @param {boolean} isMultiPolygon - 飛び地を持つかどうか
   * @param {Object[]} subPolygons - 新しい飛び地情報の配列
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withMultiPolygonData(isMultiPolygon, subPolygons = []) {
    return new Polygon(
      this._id, 
      this._vertexIds, 
      this._properties, 
      this._layerId,
      this._holesVertexIds,
      this._parentId,
      this._childIds,
      isMultiPolygon,
      subPolygons
    );
  }

  /**
   * 新しい面情報を作成するファクトリーメソッド
   * @param {string} id - 一意のID
   * @param {Property[]} properties - プロパティの配列
   * @param {Object} geometry - 形状情報 { vertexIds: string[], holesVertexIds: string[][], parentId: string, isMultiPolygon: boolean, subPolygons: Object[] }
   * @param {string} layerId - レイヤーID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  static create(id, properties, geometry, layerId) {
    return new Polygon(
      id,
      geometry.vertexIds,
      properties,
      layerId,
      geometry.holesVertexIds || [],
      geometry.parentId || "0",
      geometry.childIds || [],
      geometry.isMultiPolygon || false,
      geometry.subPolygons || []
    );
  }
}