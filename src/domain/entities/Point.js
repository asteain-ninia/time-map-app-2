// src/domain/entities/Point.js

import { Feature } from './Feature.js';
import { FeatureAnchor } from '../value-objects/FeatureAnchor.js';

function buildPointShape(vertexId) {
  return { type: 'Point', vertexId };
}

function ensurePointAnchors(id, vertexId, layerId, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error(`Point ${id} requires at least one FeatureAnchor.`);
  }
  return anchors.map(anchor => {
    if (!(anchor instanceof FeatureAnchor)) {
      return anchor;
    }
    const shape = anchor.shape?.type === 'Point' && typeof anchor.shape?.vertexId === 'string'
      ? anchor.shape
      : buildPointShape(vertexId);
    const placement = {
      ...(anchor.placement || {}),
      layerId: typeof anchor.placement?.layerId === 'string' ? anchor.placement.layerId : layerId
    };
    return anchor.withShape(shape).withPlacement(placement);
  });
}

/**
 * 点情報を表すエンティティ
 */
export class Point extends Feature {
  /**
   * 点情報オブジェクトを作成
   * @param {string} id - 一意のID
   * @param {string[]} vertexIds - 頂点IDの配列（通常は単一要素）
   * @param {Property[]} properties - 時間依存プロパティの配列
   * @param {string} layerId - 所属レイヤーID
   * @param {FeatureAnchor[]|null|undefined} anchors - 履歴アンカー正準データ
   */
  constructor(id, vertexIds, properties, layerId, anchors = null) {
    // 点情報は1つの頂点のみを持つべき
    if (vertexIds.length !== 1) {
      throw new Error('Point must have exactly one vertex');
    }

    const preparedAnchors = ensurePointAnchors(
      id,
      vertexIds[0],
      layerId,
      anchors
    );
    super(id, vertexIds, properties, layerId, preparedAnchors);
  }

  /**
   * 頂点IDを取得
   * @returns {string} 頂点ID
   */
  get vertexId() {
    return this.getVertexIdAt(null);
  }

  /**
   * 指定時刻で有効な頂点IDを取得
   * @param {TimePoint|null|undefined} timePoint
   * @returns {string}
   */
  getVertexIdAt(timePoint) {
    const anchor = this.getAnchorAt(timePoint);
    const anchorVertexId = anchor?.shape?.type === 'Point' ? anchor.shape.vertexId : null;
    if (typeof anchorVertexId === 'string') {
      return anchorVertexId;
    }
    return this._vertexIds[0];
  }

  /**
   * 新しい点情報を作成するファクトリーメソッド
   * @param {string} id - 一意のID
   * @param {FeatureAnchor[]} anchors - 履歴アンカー配列
   * @param {Object} geometry - 形状情報 { vertexId: string }
   * @param {string} layerId - レイヤーID
   * @returns {Point} 新しい点情報オブジェクト
   */
  static create(id, anchors, geometry, layerId) {
    if (!Array.isArray(anchors) || anchors.length === 0) {
      throw new Error(`Point.create requires at least one FeatureAnchor. (id: ${id})`);
    }
    return new Point(id, [geometry.vertexId], [], layerId, anchors);
  }

  /**
   * 新しい履歴アンカーの配列で新インスタンスを作成
   * @param {FeatureAnchor[]} anchors - 新しい履歴アンカー配列
   * @returns {Point} 新しい点情報オブジェクト
   */
  withAnchors(anchors) {
    const normalizedAnchors = Feature._normalizeAnchors(this._id, anchors);
    if (normalizedAnchors.length === 0) {
      throw new Error(`Point.withAnchors expects at least one anchor. (id: ${this._id})`);
    }
    const latestAnchor = normalizedAnchors[normalizedAnchors.length - 1];
    const latestVertexId = latestAnchor?.shape?.type === 'Point' && typeof latestAnchor.shape?.vertexId === 'string'
      ? latestAnchor.shape.vertexId
      : this.getVertexIdAt(null);
    const layerId = typeof latestAnchor?.placement?.layerId === 'string'
      ? latestAnchor.placement.layerId
      : this._layerId;
    return new Point(this._id, [latestVertexId], null, layerId, normalizedAnchors);
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成
   * @param {Property[]} properties - 新しいプロパティの配列
   * @returns {Point} 新しい点情報オブジェクト
   */
  withProperties(properties) {
    void properties;
    throw new Error(`Point.withProperties は廃止されました。withAnchors を使用してください。 (id: ${this._id})`);
  }

  /**
   * 新しいレイヤーIDで新インスタンスを作成
   * @param {string} layerId - 新しいレイヤーID
   * @returns {Point} 新しい点情報オブジェクト
   */
  withLayerId(layerId) {
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withPlacement({
        ...(anchor.placement || {}),
        layerId
      }))
      : null;
    return new Point(this._id, this._vertexIds, null, layerId, nextAnchors);
  }

  /**
   * 新しい頂点IDの配列で新インスタンスを作成
   * @param {string[]} vertexIds - 新しい頂点IDの配列 (要素数1を期待)
   * @returns {Point} 新しい点情報オブジェクト
   */
  withVertexIds(vertexIds) {
    if (!Array.isArray(vertexIds) || vertexIds.length !== 1) {
      throw new Error('Point.withVertexIds expects an array with exactly one vertexId.');
    }
    const nextAnchors = this._anchors.length > 0
      ? this._anchors.map(anchor => anchor.withShape(buildPointShape(vertexIds[0])))
      : null;
    return new Point(this._id, vertexIds, null, this._layerId, nextAnchors);
  }
}

