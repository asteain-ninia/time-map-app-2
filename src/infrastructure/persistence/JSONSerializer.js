// src\infrastructure\persistence\JSONSerializer.js

import { Point } from '../../domain/entities/Point';
import { Line } from '../../domain/entities/Line';
import { Polygon } from '../../domain/entities/Polygon';
import { Layer } from '../../domain/entities/Layer';
import { TimePoint } from '../../domain/value-objects/TimePoint';
import { Property } from '../../domain/value-objects/Property';

// プロジェクト固有設定のデフォルト値 (JSONWorldRepository._createEmptyWorld と同期)
const DEFAULT_PROJECT_SETTINGS = {
  zoomMin: 1,
  zoomMax: 50,
  equatorLength: 40000,
  gridInterval: 10,
  gridColor: "#cccccc",
  gridOpacity: 0.5,
  sliderMin: 0,
  sliderMax: 10000,
  autoSaveInterval: 300, // autoSaveIntervalもプロジェクト固有と見なす場合
};

const DEFAULT_RENDERING_SETTINGS = {
  minLabelScreenRatio: 0.0005,
};


/**
 * JSON形式でのデータシリアライズ/デシリアライズ
 */
export class JSONSerializer {
  /**
   * ドメインオブジェクトをJSONにシリアライズ
   * @param {Object} world - 世界データ
   * @returns {string} JSONデータ
   */
  serialize(world) {
    const data = {
      version: "1.2-ringtype", // バージョン更新 (ringType移行)
      layers: world.layers.map(layer => this._serializeLayer(layer)),
      vertices: world.vertices.map(vertex => this._serializeVertex(vertex)),
      points: [],
      lines: [],
      polygons: [],
      metadata: world.metadata || {} // metadata全体を保存
    };

    // 地理オブジェクトを種類別に分類
    for (const feature of world.features) {
      if (feature instanceof Point) {
        data.points.push(this._serializePoint(feature));
      } else if (feature instanceof Line) {
        data.lines.push(this._serializeLine(feature));
      } else if (feature instanceof Polygon) {
        data.polygons.push(this._serializePolygon(feature));
      }
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * JSONからドメインオブジェクトをデシリアライズ
   * @param {string} json - JSONデータ
   * @returns {Object} 世界データ
   */
  deserialize(json) {
    const data = JSON.parse(json);

    // バージョンチェック
    if (!data.version || !data.version.startsWith("1.2")) {
      console.warn(`Warning: Data version ${data.version} is not the expected ringType-based version (1.2). Deserialization may fail.`);
      // ここでデータ移行ロジックを入れることも可能だが、今回は警告のみ
    }

    // メタデータのデフォルト値補完
    let metadata = data.metadata || {};
    if (!metadata.settings) {
      metadata.settings = {};
    }
    // sliderMin/Max が metadata 直下にある古い形式の場合、settings に移動
    if (metadata.sliderMin !== undefined && metadata.settings.sliderMin === undefined) {
      metadata.settings.sliderMin = metadata.sliderMin;
      delete metadata.sliderMin;
    }
    if (metadata.sliderMax !== undefined && metadata.settings.sliderMax === undefined) {
      metadata.settings.sliderMax = metadata.sliderMax;
      delete metadata.sliderMax;
    }

    // プロジェクト固有設定のデフォルト値で補完
    for (const key in DEFAULT_PROJECT_SETTINGS) {
      if (metadata.settings[key] === undefined) {
        metadata.settings[key] = DEFAULT_PROJECT_SETTINGS[key];
      }
    }

    if (!metadata.settings.rendering || typeof metadata.settings.rendering !== 'object') {
      metadata.settings.rendering = { ...DEFAULT_RENDERING_SETTINGS };
    } else {
      for (const key in DEFAULT_RENDERING_SETTINGS) {
        if (metadata.settings.rendering[key] === undefined) {
          metadata.settings.rendering[key] = DEFAULT_RENDERING_SETTINGS[key];
        }
      }
    }


    const world = {
      // レイヤーの復元
      layers: (data.layers || []).map(layer => this._deserializeLayer(layer)),

      // 頂点の復元
      vertices: (data.vertices || []).map(vertex => this._deserializeVertex(vertex)),

      // 地物の復元（空の配列で初期化）
      features: [],

      // メタデータの復元 (デフォルト値で補完済み)
      metadata: metadata
    };

    // 点情報の復元
    if (data.points) {
      for (const pointData of data.points) {
        world.features.push(this._deserializePoint(pointData));
      }
    }

    // 線情報の復元
    if (data.lines) {
      for (const lineData of data.lines) {
        world.features.push(this._deserializeLine(lineData));
      }
    }

    // 面情報の復元
    if (data.polygons) {
      for (const polygonData of data.polygons) {
        world.features.push(this._deserializePolygon(polygonData));
      }
    }

    return world;
  }

  // --- 個別シリアライズ/デシリアライズメソッド (Point, Line, Vertex, Layer, TimePoint, Property は変更なし) ---

  /**
   * 頂点をシリアライズ
   * @param {{id: string, x: number, y: number}} vertex - 頂点
   * @returns {Object} シリアライズされた頂点
   * @private
   */
  _serializeVertex(vertex) {
    return {
      id: vertex.id,
      x: vertex.x,
      y: vertex.y
    };
  }

  /**
   * 頂点をデシリアライズ
   * @param {Object} data - シリアライズされた頂点
   * @returns {{id: string, x: number, y: number}} プレーンな頂点データ
   * @private
   */
  _deserializeVertex(data) {
    return {
      id: data.id,
      x: data.x,
      y: data.y
    };
  }

  /**
   * 時間点をシリアライズ
   * @param {TimePoint} timePoint - 時間点
   * @returns {Object} シリアライズされた時間点
   * @private
   */
  _serializeTimePoint(timePoint) {
    const result = {
      year: timePoint.year
    };

    if (timePoint.month !== null) {
      result.month = timePoint.month;
    }

    if (timePoint.day !== null) {
      result.day = timePoint.day;
    }

    return result;
  }

  /**
   * 時間点をデシリアライズ
   * @param {Object} data - シリアライズされた時間点
   * @returns {TimePoint} 時間点
   * @private
   */
  _deserializeTimePoint(data) {
    return new TimePoint(
      data.year,
      data.month !== undefined ? data.month : null,
      data.day !== undefined ? data.day : null
    );
  }

  /**
   * プロパティをシリアライズ
   * @param {Property} property - プロパティ
   * @returns {Object} シリアライズされたプロパティ
   * @private
   */
  _serializeProperty(property) {
    const attributes = property.getAttributes();
    const result = {
      timePoint: this._serializeTimePoint(property.timePoint),
      name: property.name,
      description: property.description,
      attributes
    };

    if (property.startTime || property.endTime) { // startかendどちらかがあればtimeRangeを作る
      result.timeRange = {};
      if (property.startTime) {
        result.timeRange.start = this._serializeTimePoint(property.startTime);
      }
      if (property.endTime) {
        result.timeRange.end = this._serializeTimePoint(property.endTime);
      }
    }

    return result;
  }

  /**
   * プロパティをデシリアライズ
   * @param {Object} data - シリアライズされたプロパティ
   * @returns {Property} プロパティ
   * @private
   */
  _deserializeProperty(data) {
    const timePoint = this._deserializeTimePoint(data.timePoint);

    // 基本属性と追加属性を分離
    // 修正: attributes フィールドを直接参照するように変更
    const { timePoint: tp, timeRange, name, description, attributes, ...legacyAttributes } = data;

    // timeRange より前の古い形式の属性も attributes にマージする（互換性のため）
    const mergedAttributes = { ...legacyAttributes, ...(attributes || {}) };

    // 時間範囲の処理
    let startTime = null;
    let endTime = null;

    if (timeRange) {
      if (timeRange.start) {
        startTime = this._deserializeTimePoint(timeRange.start);
      }

      if (timeRange.end) {
        endTime = this._deserializeTimePoint(timeRange.end);
      }
    }

    return new Property(
      timePoint,
      name,
      description,
      mergedAttributes, // マージした属性を渡す
      startTime,
      endTime
    );
  }

  /**
   * レイヤーをシリアライズ
   * @param {Layer} layer - レイヤー
   * @returns {Object} シリアライズされたレイヤー
   * @private
   */
  _serializeLayer(layer) {
    const serialized = {
      id: layer.id,
      name: layer.name,
      order: layer.order,
      visible: layer.visible,
      opacity: layer.opacity,
      description: layer.description
    };
    if (layer.style) {
      serialized.style = JSON.parse(JSON.stringify(layer.style));
    }
    return serialized;
  }

  /**
   * レイヤーをデシリアライズ
   * @param {Object} data - シリアライズされたレイヤー
   * @returns {Layer} レイヤー
   * @private
   */
  _deserializeLayer(data) {
    return new Layer(
      data.id,
      data.name,
      data.order,
      data.visible !== undefined ? data.visible : true, // visibleのデフォルト値をtrueに
      data.opacity !== undefined ? data.opacity : 1.0,   // opacityのデフォルト値を1.0に
      data.description || "",
      data.style || null
    );
  }

  /**
   * 点情報をシリアライズ
   * @param {Point} point - 点情報
   * @returns {Object} シリアライズされた点情報
   * @private
   */
  _serializePoint(point) {
    return {
      id: point.id,
      vertexIds: [...point.vertexIds],
      properties: point.properties.map(prop => this._serializeProperty(prop)),
      layerId: point.layerId
    };
  }

  /**
   * 点情報をデシリアライズ
   * @param {Object} data - シリアライズされた点情報
   * @returns {Point} 点情報
   * @private
   */
  _deserializePoint(data) {
    return new Point(
      data.id,
      data.vertexIds || [], // 念のためデフォルト値
      (data.properties || []).map(prop => this._deserializeProperty(prop)), // propertiesがなくてもエラーにならないように
      data.layerId
    );
  }

  /**
   * 線情報をシリアライズ
   * @param {Line} line - 線情報
   * @returns {Object} シリアライズされた線情報
   * @private
   */
  _serializeLine(line) {
    return {
      id: line.id,
      vertexIds: [...line.vertexIds],
      properties: line.properties.map(prop => this._serializeProperty(prop)),
      layerId: line.layerId
    };
  }

  /**
   * 線情報をデシリアライズ
   * @param {Object} data - シリアライズされた線情報
   * @returns {Line} 線情報
   * @private
   */
  _deserializeLine(data) {
    return new Line(
      data.id,
      data.vertexIds || [], // 念のためデフォルト値
      (data.properties || []).map(prop => this._deserializeProperty(prop)), // propertiesがなくてもエラーにならないように
      data.layerId
    );
  }

  /**
   * 面情報をシリアライズ (リングベース対応)
   * @param {Polygon} polygon - 面情報
   * @returns {Object} シリアライズされた面情報
   * @private
   */
  _serializePolygon(polygon) {
    const result = {
      id: polygon.id,
      properties: polygon.properties.map(prop => this._serializeProperty(prop)),
      layerId: polygon.layerId,
      parentId: polygon.parentId,
      childIds: [...polygon.childIds],
      // 新しいリング構造をシリアライズ
      rings: polygon.rings.map(ring => ({
        id: ring.id,
        vertexIds: [...ring.vertexIds], // 頂点IDをコピー
        ringType: ring.ringType,
        parentId: ring.parentId // nullもそのまま保存
      }))
    };
    return result;
  }

  /**
   * 面情報をデシリアライズ (リングベース対応)
   * @param {Object} data - シリアライズされた面情報
   * @returns {Polygon} 面情報
   * @private
   */
  _deserializePolygon(data) {
    // リング配列を読み込む (存在しない場合は空配列)
    const rings = (data.rings || []).map(ringData => ({
      id: ringData.id,
      vertexIds: ringData.vertexIds || [], // 念のためデフォルト値
      ringType: ringData.ringType,
      parentId: ringData.parentId // nullもそのまま読み込む
    }));

    // Polygon コンストラクタを呼び出す
    return new Polygon(
      data.id,
      (data.properties || []).map(prop => this._deserializeProperty(prop)), // propertiesがなくてもエラーにならないように
      data.layerId,
      data.parentId || "0", // parentIdがなければ "0"
      data.childIds || [], // childIdsがなければ []
      rings // 読み込んだリング配列
    );
  }
}
