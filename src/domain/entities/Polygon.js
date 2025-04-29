import { Feature } from './Feature.js';

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
   * @param {Object[]} subPolygons - 飛び地ポリゴン情報の配列（isMultiPolygonがtrueの場合） { vertexIds: string[], holesVertexIds: string[][] }
   */
  constructor(id, vertexIds, properties, layerId, holesVertexIds = [], parentId = "0", childIds = [], isMultiPolygon = false, subPolygons = []) {
    // vertexIdsがnullでも空配列としてsuperに渡す (Featureは空配列を受け付ける想定)
    super(id, vertexIds || [], properties, layerId);

    this._holesVertexIds = holesVertexIds.map(hole => [...hole]);
    this._parentId = parentId;
    this._childIds = [...childIds];
    this._isMultiPolygon = isMultiPolygon;
    // isMultiPolygon が false でも subPolygons が渡される場合があるため、フラグで判定し、各要素をコピー
    this._subPolygons = isMultiPolygon
        ? subPolygons.map(sub => ({
            vertexIds: [...(sub.vertexIds || [])],
            holesVertexIds: (sub.holesVertexIds || []).map(hole => [...hole])
          }))
        : [];


    // 不変性を保証
    this._holesVertexIds.forEach(hole => Object.freeze(hole));
    Object.freeze(this._holesVertexIds);
    Object.freeze(this._childIds);
    this._subPolygons.forEach(sub => {
        Object.freeze(sub.vertexIds);
        sub.holesVertexIds.forEach(hole => Object.freeze(hole));
        Object.freeze(sub.holesVertexIds);
        Object.freeze(sub); // subPolygonオブジェクト自体も凍結
    });
    Object.freeze(this._subPolygons);


    // 面情報の検証
    if (vertexIds && vertexIds.length > 0) {
      // 直接頂点で定義される場合、少なくとも3つの頂点が必要
      if (vertexIds.length < 3) {
        throw new Error('Polygon must have at least three vertices');
      }
    } else if (!isMultiPolygon && childIds.length === 0) { // MultiPolygonでなく、子もない場合
        // 頂点がなく、子もなく、MultiPolygonでもない場合はエラー
         throw new Error('Polygon must either have vertices, child polygons, or be a valid MultiPolygon');
    } else if (isMultiPolygon && subPolygons.length === 0 && (!vertexIds || vertexIds.length === 0)) {
        // MultiPolygon だがサブポリゴンも本体の頂点もない場合もエラー
         throw new Error('MultiPolygon must have at least one sub-polygon or main vertices');
    }


    // 穴の検証
    this._holesVertexIds.forEach(hole => {
      if (hole.length < 3) {
        throw new Error('Polygon hole must have at least three vertices');
      }
    });

    // 飛び地の検証
    if (isMultiPolygon) {
      this._subPolygons.forEach((subPoly, index) => {
        if (!subPoly.vertexIds || subPoly.vertexIds.length < 3) {
          throw new Error(`Each sub-polygon (index ${index}) must have at least three vertices`);
        }
        // 飛び地の穴の検証
        (subPoly.holesVertexIds || []).forEach((hole, holeIndex) => {
            if (!hole || hole.length < 3) {
                 throw new Error(`Hole (index ${holeIndex}) in sub-polygon (index ${index}) must have at least three vertices`);
            }
        });
      });
    }
  }

  /**
   * 穴の頂点IDの配列の配列を取得
   * @returns {string[][]} 穴の頂点ID配列の配列
   */
  get holesVertexIds() {
    // 不変性を保つためディープコピーを返す
    return this._holesVertexIds.map(hole => [...hole]);
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
    return [...this._childIds];
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
   * @returns {Object[]} 飛び地情報の配列 { vertexIds: string[], holesVertexIds: string[][] }
   */
  get subPolygons() {
    // 不変性を保つためディープコピーを返す
    return this._subPolygons.map(sub => ({
        vertexIds: [...sub.vertexIds],
        holesVertexIds: sub.holesVertexIds.map(hole => [...hole])
    }));
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
    // vertexIds が null または空配列でないことを確認
    return Array.isArray(this._vertexIds) && this._vertexIds.length > 0;
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成 (Featureクラスのメソッドをオーバーライド)
   * @param {string[] | null} vertexIds - 新しい外周頂点IDの配列、またはnull
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withVertexIds(vertexIds) {
      // Polygon固有のプロパティを含めて新しいインスタンスを生成
      return new Polygon(
          this._id,
          vertexIds, // 新しい頂点ID配列を使用
          this._properties,
          this._layerId,
          this._holesVertexIds, // 穴情報はそのまま引き継ぐ
          this._parentId,
          this._childIds,
          this._isMultiPolygon,
          this._subPolygons // 飛び地情報もそのまま引き継ぐ
      );
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成 (Featureクラスのメソッドをオーバーライド)
   * @param {Property[]} properties - 新しいプロパティの配列
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withProperties(properties) {
    // Polygon固有のプロパティを含めて新しいインスタンスを生成
    return new Polygon(
      this._id,
      this._vertexIds, // 元の頂点IDを引き継ぐ
      properties,      // 新しいプロパティ配列を使用
      this._layerId,   // 元のレイヤーIDを引き継ぐ
      this._holesVertexIds, // 元の穴情報を引き継ぐ
      this._parentId,       // 元の親IDを引き継ぐ
      this._childIds,       // 元の子ID配列を引き継ぐ
      this._isMultiPolygon, // 元のMultiPolygonフラグを引き継ぐ
      this._subPolygons     // 元の飛び地情報を引き継ぐ
    );
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成 (Featureクラスのメソッドをオーバーライド)
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withLayerId(layerId) {
    return new Polygon(
      this._id,
      this._vertexIds,
      this._properties,
      layerId, // 新しいレイヤーIDを使用
      this._holesVertexIds,
      this._parentId,
      this._childIds,
      this._isMultiPolygon,
      this._subPolygons
    );
  }

  /**
   * 新しい穴の頂点IDの配列で新インスタンスを作成
   * @param {string[][]} holesVertexIds - 新しい穴の頂点IDの配列の配列
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withHolesVertexIds(holesVertexIds) {
    // 状態が変わらない場合は元のインスタンスを返す (イミュータブル最適化)
    if (JSON.stringify(this._holesVertexIds) === JSON.stringify(holesVertexIds)) {
        return this;
    }
    return new Polygon(
      this._id,
      this._vertexIds,
      this._properties,
      this._layerId,
      holesVertexIds, // 新しい穴情報を使用
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
    if (this._parentId === parentId) return this; // 変化なし
    return new Polygon(
      this._id,
      this._vertexIds,
      this._properties,
      this._layerId,
      this._holesVertexIds,
      parentId, // 新しい親IDを使用
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
    // 状態が変わらない場合は元のインスタンスを返す (イミュータブル最適化)
    if (this._childIds.length === childIds.length && this._childIds.every((id, i) => id === childIds[i])) {
        return this;
    }
    return new Polygon(
      this._id,
      this._vertexIds,
      this._properties,
      this._layerId,
      this._holesVertexIds,
      this._parentId,
      childIds, // 新しい子ID配列を使用
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
    // 重複チェック
    if (this._childIds.includes(childId)) return this;
    return this.withChildIds([...this._childIds, childId]);
  }

  /**
   * 下位領域IDを削除した新インスタンスを作成
   * @param {string} childId - 削除する下位領域ID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  removeChildId(childId) {
    const newChildIds = this._childIds.filter(id => id !== childId);
    // 変化がなければ元のインスタンスを返す (イミュータブル最適化)
    if (newChildIds.length === this._childIds.length) return this;
    return this.withChildIds(newChildIds);
  }

  /**
   * 飛び地情報を更新した新インスタンスを作成
   * @param {boolean} isMultiPolygon - 飛び地を持つかどうか
   * @param {Object[]} subPolygons - 新しい飛び地情報の配列 { vertexIds: string[], holesVertexIds: string[][] }
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withMultiPolygonData(isMultiPolygon, subPolygons = []) {
    // isMultiPolygon フラグに合わせて subPolygons を調整
    const finalSubPolygons = isMultiPolygon
      ? subPolygons.map(sub => ({ // deep copy
          vertexIds: [...(sub.vertexIds || [])],
          holesVertexIds: (sub.holesVertexIds || []).map(hole => [...hole])
        }))
      : [];

    // 状態が変わらない場合は元のインスタンスを返す (イミュータブル最適化)
    if (this._isMultiPolygon === isMultiPolygon &&
        JSON.stringify(this._subPolygons) === JSON.stringify(finalSubPolygons)) {
      return this;
    }
    return new Polygon(
      this._id,
      this._vertexIds,
      this._properties,
      this._layerId,
      this._holesVertexIds,
      this._parentId,
      this._childIds,
      isMultiPolygon,
      finalSubPolygons // 調整後の飛び地情報を使用
    );
  }

  /**
   * 特定の飛び地の穴情報を更新した新インスタンスを作成
   * @param {number} subPolygonIndex - 穴を更新する飛び地のインデックス
   * @param {string[][]} newHolesVertexIds - 新しい穴情報の配列
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  withSubPolygonHoles(subPolygonIndex, newHolesVertexIds) {
    if (!this._isMultiPolygon || subPolygonIndex < 0 || subPolygonIndex >= this._subPolygons.length) {
      console.warn(`Invalid subPolygonIndex ${subPolygonIndex} or polygon is not a MultiPolygon.`);
      return this; // 不正な場合は変更しない
    }

    // 新しい飛び地配列を作成
    const updatedSubPolygons = this._subPolygons.map((sub, index) => {
        if (index === subPolygonIndex) {
            // 対象の飛び地の穴情報を更新 (deep copy)
            return {
                ...sub, // vertexIds はそのまま
                holesVertexIds: newHolesVertexIds.map(hole => [...hole])
            };
        }
        return sub; // 他の飛び地はそのまま
    });

    // 状態が変わらないかチェック (簡易的にJSON比較)
    if (JSON.stringify(this._subPolygons[subPolygonIndex].holesVertexIds) === JSON.stringify(newHolesVertexIds)) {
        return this;
    }

    // 新しいインスタンスを生成
    return new Polygon(
      this._id,
      this._vertexIds,
      this._properties,
      this._layerId,
      this._holesVertexIds,
      this._parentId,
      this._childIds,
      this._isMultiPolygon,
      updatedSubPolygons // 更新された飛び地情報を使用
    );
  }


  /**
   * 新しい面情報を作成するファクトリーメソッド
   * @param {string} id - 一意のID
   * @param {Property[]} properties - プロパティの配列
   * @param {Object} geometry - 形状情報 { vertexIds?: string[] | null, holesVertexIds?: string[][], parentId?: string, isMultiPolygon?: boolean, subPolygons?: Object[], childIds?: string[] }
   * @param {string} layerId - レイヤーID
   * @returns {Polygon} 新しい面情報オブジェクト
   */
  static create(id, properties, geometry, layerId) {
    // geometry.vertexIds が undefined でも null でも空配列として扱う
    const vertexIds = geometry.vertexIds || null; // 下位領域を持つ場合を考慮し null 許容
    const subPolygons = geometry.subPolygons || [];
    const isMulti = geometry.isMultiPolygon !== undefined ? geometry.isMultiPolygon : (subPolygons.length > 0 || !vertexIds); // subPolygonsがあればMulti、vertexIdsがなければMulti(子がなければエラーになるがそれはコンストラクタで)

    return new Polygon(
      id,
      vertexIds,
      properties,
      layerId,
      geometry.holesVertexIds || [],
      geometry.parentId || "0",
      geometry.childIds || [],
      isMulti, // isMultiPolygonを渡す
      subPolygons // subPolygonsを渡す
    );
  }
}
