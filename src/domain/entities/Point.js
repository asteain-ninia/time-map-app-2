// src/domain/entities/Point.js

import { Feature } from './Feature.js';
import { Property } from '../value-objects/Property.js'; // Propertyをインポート
import { FeatureAnchor } from '../value-objects/FeatureAnchor.js';

function buildPointShape(vertexId) {
  return { type: 'Point', vertexId };
}

function buildPointPlacement(layerId) {
  return { layerId };
}

function ensurePointAnchors(id, vertexId, properties, layerId, anchors) {
  if (Array.isArray(anchors) && anchors.length > 0) {
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

  const normalized = Feature._normalizeProperties(id, properties);
  return normalized.map((property, index) => FeatureAnchor.fromProperty(
    property,
    buildPointShape(vertexId),
    buildPointPlacement(layerId),
    `anchor-${id}-${index + 1}`
  ));
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
      properties,
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
   * @param {Property[]} properties - プロパティの配列
   * @param {Object} geometry - 形状情報 { vertexId: string }
   * @param {string} layerId - レイヤーID
   * @returns {Point} 新しい点情報オブジェクト
   */
  static create(id, properties, geometry, layerId) {
    // properties が要素数1の Property インスタンスの配列であることをバリデーション
    // (バリデーションは AddFeatureUseCase で行うので、ここではそのまま渡す)
    // if (!Array.isArray(properties) || properties.length !== 1 || !(properties[0] instanceof Property)) {
    //     console.warn("Point.create: properties must be an array with a single Property instance. Received:", properties);
    // }
    return new Point(id, [geometry.vertexId], properties, layerId);
  }

  /**
   * 新しいプロパティの配列で新インスタンスを作成
   * @param {Property[]} properties - 新しいプロパティの配列
   * @returns {Point} 新しい点情報オブジェクト
   */
  withProperties(properties) {
    const normalized = Feature._normalizeProperties(this._id, properties);
    const nextAnchors = Feature._syncAnchorsWithProperties(
      this._id,
      this._anchors,
      normalized,
      buildPointShape(this._vertexIds[0]),
      buildPointPlacement(this._layerId)
    );
    return new Point(this._id, this._vertexIds, normalized, this._layerId, nextAnchors);
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
    return new Point(this._id, this._vertexIds, this._properties, layerId, nextAnchors);
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
    return new Point(this._id, vertexIds, this._properties, this._layerId, nextAnchors);
  }
}

