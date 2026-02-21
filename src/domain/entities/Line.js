import { Feature } from './Feature.js';
import { FeatureAnchor } from '../value-objects/FeatureAnchor.js';

function buildLineShape(vertexIds) {
  return { type: 'LineString', vertexIds: [...vertexIds] };
}

function ensureLineAnchors(id, vertexIds, layerId, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error(`Line ${id} requires at least one FeatureAnchor.`);
  }
  return anchors.map(anchor => {
    if (!(anchor instanceof FeatureAnchor)) {
      return anchor;
    }
    const shape = anchor.shape?.type === 'LineString' && Array.isArray(anchor.shape?.vertexIds)
      ? anchor.shape
      : buildLineShape(vertexIds);
    const placement = {
      ...(anchor.placement || {}),
      layerId: typeof anchor.placement?.layerId === 'string' ? anchor.placement.layerId : layerId
    };
    return anchor.withShape(shape).withPlacement(placement);
  });
}
/**
 * 線情報を表すエンティティ
 */
export class Line extends Feature {
  /**
   * 線情報オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列（順序付き）
   * @param {*|null|undefined} properties - 互換維持のための未使用引数
   * @param {string} layerId - 所属レイヤーID
   * @param {FeatureAnchor[]|null|undefined} anchors - 履歴アンカー正準データ
   */
  constructor(id, vertexIds, properties, layerId, anchors = null) {
    // 線情報は少なくとも2つの頂点を持つべき
    if (vertexIds.length < 2) {
      throw new Error('Line must have at least two vertices');
    }

    const preparedAnchors = ensureLineAnchors(
      id,
      vertexIds,
      layerId,
      anchors
    );
    super(id, vertexIds, properties, layerId, preparedAnchors);
  }

  /**
   * 新しい線情報を作成するファクトリーメソッド
   * @param {string} id - 一意のID
   * @param {FeatureAnchor[]} anchors - 履歴アンカー配列
   * @param {Object} geometry - 形状情報 { vertexIds: string[] }
   * @param {string} layerId - レイヤーID
   * @returns {Line} 新しい線情報オブジェクト
   */
  static create(id, anchors, geometry, layerId) {
    if (!Array.isArray(anchors) || anchors.length === 0) {
      throw new Error(`Line.create requires at least one FeatureAnchor. (id: ${id})`);
    }
    return new Line(id, geometry.vertexIds, [], layerId, anchors);
  }

  /**
   * 新しい履歴アンカーの配列で新インスタンスを作成
   * @param {FeatureAnchor[]} anchors - 新しい履歴アンカー配列
   * @returns {Line} 新しい線情報オブジェクト
   */
  withAnchors(anchors) {
    const normalizedAnchors = Feature._normalizeAnchors(this._id, anchors);
    if (normalizedAnchors.length === 0) {
      throw new Error(`Line.withAnchors expects at least one anchor. (id: ${this._id})`);
    }
    const latestAnchor = normalizedAnchors[normalizedAnchors.length - 1];
    const latestVertexIds = latestAnchor?.shape?.type === 'LineString' && Array.isArray(latestAnchor.shape?.vertexIds)
      ? [...latestAnchor.shape.vertexIds]
      : this.getVertexIdsAt(null);
    if (latestVertexIds.length < 2) {
      throw new Error(`Line.withAnchors requires at least two vertexIds. (id: ${this._id})`);
    }
    const layerId = typeof latestAnchor?.placement?.layerId === 'string'
      ? latestAnchor.placement.layerId
      : this._layerId;
    return new Line(this._id, latestVertexIds, null, layerId, normalizedAnchors);
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成
   * @param {*|null|undefined} properties - 互換維持のための未使用引数
   * @returns {Line} 新しい線情報オブジェクト
   */
  withProperties(properties) {
    void properties;
    throw new Error(`Line.withProperties は廃止されました。withAnchors を使用してください。 (id: ${this._id})`);
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Line} 新しい線情報オブジェクト
   */
  withLayerId(layerId) {
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withPlacement({
        ...(anchor.placement || {}),
        layerId
      }))
      : null;
    return new Line(this._id, this._vertexIds, null, layerId, nextAnchors);
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成
   * @param {string[]} vertexIds - 新しい頂点IDの配列 (最低2要素を期待)
   * @returns {Line} 新しい線情報オブジェクト
   */
  withVertexIds(vertexIds) {
    if (!Array.isArray(vertexIds) || vertexIds.length < 2) {
      throw new Error('Line.withVertexIds expects an array with at least two vertexIds.');
    }
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withShape(buildLineShape(vertexIds)))
      : null;
    return new Line(this._id, vertexIds, null, this._layerId, nextAnchors);
  }

  /**
   * 指定時刻で有効な頂点ID列を取得
   * @param {TimePoint|null|undefined} timePoint
   * @returns {string[]}
   */
  getVertexIdsAt(timePoint) {
    const anchor = this.getAnchorAt(timePoint);
    if (anchor?.shape?.type === 'LineString' && Array.isArray(anchor.shape.vertexIds)) {
      return [...anchor.shape.vertexIds];
    }
    return [...this._vertexIds];
  }
}

