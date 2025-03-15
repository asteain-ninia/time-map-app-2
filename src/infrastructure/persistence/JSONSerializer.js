import { Vertex } from '../../domain/entities/Vertex';
import { Point } from '../../domain/entities/Point';
import { Line } from '../../domain/entities/Line';
import { Polygon } from '../../domain/entities/Polygon';
import { Layer } from '../../domain/entities/Layer';
import { TimePoint } from '../../domain/value-objects/TimePoint';
import { Property } from '../../domain/value-objects/Property';

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
      version: "1.0",
      layers: world.layers.map(layer => this._serializeLayer(layer)),
      vertices: world.vertices.map(vertex => this._serializeVertex(vertex)),
      points: [],
      lines: [],
      polygons: [],
      metadata: world.metadata || {}
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
    if (!data.version || data.version !== "1.0") {
      console.warn(`Warning: Unknown data version ${data.version}`);
    }
    
    const world = {
      // レイヤーの復元
      layers: (data.layers || []).map(layer => this._deserializeLayer(layer)),
      
      // 頂点の復元
      vertices: (data.vertices || []).map(vertex => this._deserializeVertex(vertex)),
      
      // の復元（空の配列で初期化）
      features: [],
      
      // メタデータの復元
      metadata: data.metadata || {}
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

  // 以下、個別のシリアライズ/デシリアライズメソッド

  /**
   * 頂点をシリアライズ
   * @param {Vertex} vertex - 頂点
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
   * @returns {Vertex} 頂点
   * @private
   */
  _deserializeVertex(data) {
    return new Vertex(data.id, data.x, data.y);
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
    const result = {
      timePoint: this._serializeTimePoint(property.timePoint),
      name: property.name,
      description: property.description,
      ...property.getAttributes()
    };
    
    if (property.startTime) {
      result.timeRange = {
        start: this._serializeTimePoint(property.startTime)
      };
      
      if (property.endTime) {
        result.timeRange.end = this._serializeTimePoint(property.endTime);
      }
    } else if (property.endTime) {
      result.timeRange = {
        end: this._serializeTimePoint(property.endTime)
      };
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
    const { timePoint: tp, timeRange, name, description, ...attributes } = data;
    
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
      attributes,
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
    return {
      id: layer.id,
      name: layer.name,
      order: layer.order,
      visible: layer.visible,
      opacity: layer.opacity,
      description: layer.description
    };
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
      data.visible,
      data.opacity,
      data.description || ""
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
      data.vertexIds,
      data.properties.map(prop => this._deserializeProperty(prop)),
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
      data.vertexIds,
      data.properties.map(prop => this._deserializeProperty(prop)),
      data.layerId
    );
  }

  /**
   * 面情報をシリアライズ
   * @param {Polygon} polygon - 面情報
   * @returns {Object} シリアライズされた面情報
   * @private
   */
  _serializePolygon(polygon) {
    const result = {
      id: polygon.id,
      vertexIds: polygon.vertexIds && polygon.vertexIds.length > 0 ? [...polygon.vertexIds] : null,
      holesVertexIds: polygon.holesVertexIds.map(hole => [...hole]),
      properties: polygon.properties.map(prop => this._serializeProperty(prop)),
      layerId: polygon.layerId,
      parentId: polygon.parentId,
      childIds: [...polygon.childIds],
      isMultiPolygon: polygon.isMultiPolygon
    };
    
    if (polygon.isMultiPolygon) {
      result.subPolygons = polygon.subPolygons.map(subPoly => ({
        vertexIds: [...subPoly.vertexIds],
        holesVertexIds: subPoly.holesVertexIds.map(hole => [...hole])
      }));
    }
    
    return result;
  }

  /**
   * 面情報をデシリアライズ
   * @param {Object} data - シリアライズされた面情報
   * @returns {Polygon} 面情報
   * @private
   */
  _deserializePolygon(data) {
    return new Polygon(
      data.id,
      data.vertexIds || [],
      data.properties.map(prop => this._deserializeProperty(prop)),
      data.layerId,
      data.holesVertexIds || [],
      data.parentId || "0",
      data.childIds || [],
      data.isMultiPolygon || false,
      data.subPolygons || []
    );
  }
}