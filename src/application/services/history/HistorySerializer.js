// src/application/services/history/HistorySerializer.js
import { Vertex } from '../../../domain/entities/Vertex.js';
import { Point } from '../../../domain/entities/Point.js';
import { Line as DomainLine } from '../../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../../domain/entities/Polygon.js';
import { Property } from '../../../domain/value-objects/Property.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';

export class HistorySerializer {

  /**
   * プレーンオブジェクトから TimePoint インスタンスを生成 (履歴用)
   * @param {Object | null} data - TimePoint のプレーンオブジェクト ({ year, month?, day? })
   * @returns {TimePoint | null} TimePoint インスタンス、または null
   * @private
   */
  _deserializeTimePointFromData(data) {
    if (!data || data.year === undefined || data.year === null) return null;
    const month = data.month !== undefined ? data.month : null;
    const day = data.day !== undefined ? data.day : null;
    return new TimePoint(data.year, month, day);
  }

  /**
   * プレーンオブジェクトから Property インスタンスを生成 (履歴用)
   * @param {Object | null} data - Property のプレーンオブジェクト
   * @returns {Property | null} Property インスタンス、または null
   * @private
   */
  _deserializePropertyFromData(data) {
    if (!data) return null;
    const timePoint = this._deserializeTimePointFromData(data.timePoint);
    if (!timePoint) {
      console.warn("Property deserialization for history failed: Invalid or missing timePoint", data);
      return null;
    }
    // eslint-disable-next-line no-unused-vars
    const { timePoint: tpData, timeRange, name, description, attributes, ...legacyAttributes } = data;
    const mergedAttributes = { ...legacyAttributes, ...(attributes || {}) };
    let startTime = null;
    let endTime = null;
    if (timeRange) {
      startTime = this._deserializeTimePointFromData(timeRange.start);
      endTime = this._deserializeTimePointFromData(timeRange.end);
    }
    const propName = name !== undefined ? name : '';
    const propDesc = description !== undefined ? description : '';
    return new Property(timePoint, propName, propDesc, mergedAttributes, startTime, endTime);
  }

  /**
   * ドメインオブジェクトを履歴保存用のプレーンオブジェクトにシリアライズする。
   * @param {Object | null} object - シリアライズ対象のドメインオブジェクト (Vertex, Feature, Property, TimePoint など)
   * @returns {Object | null} シリアライズされたプレーンオブジェクト、または変換できない場合はnull
   */
  serialize(object) {
    if (!object) return null;

    const serializeTimePoint = (tp) => tp ? { year: tp.year, month: tp.month, day: tp.day } : null;

    const serializeProperty = (prop) => {
      if (!prop || !(prop instanceof Property)) return null;
      const attributes = prop.getAttributes ? prop.getAttributes() : {}; // 防御的プログラミング
      const timeRangeData = {};
      let hasTimeRange = false;
      if (prop.startTime) { timeRangeData.start = serializeTimePoint(prop.startTime); hasTimeRange = true; }
      if (prop.endTime) { timeRangeData.end = serializeTimePoint(prop.endTime); hasTimeRange = true; }
      
      const serialized = {
        _constructorName: 'Property', // デシリアライズ時の型識別用
        timePoint: serializeTimePoint(prop.timePoint),
        name: prop.name,
        description: prop.description,
        attributes: attributes
      };
      if (hasTimeRange) { serialized.timeRange = timeRangeData; }
      return serialized;
    };

    if (object instanceof Vertex) {
      return { _constructorName: 'Vertex', id: object.id, x: object.x, y: object.y };
    } else if (object instanceof Point || object instanceof DomainLine) {
      return {
        _constructorName: object.constructor.name,
        id: object.id,
        vertexIds: Array.isArray(object.vertexIds) ? [...object.vertexIds] : [],
        properties: Array.isArray(object.properties) ? object.properties.map(serializeProperty).filter(Boolean) : [],
        layerId: object.layerId
      };
    } else if (object instanceof DomainPolygon) {
      return {
        _constructorName: 'Polygon',
        id: object.id,
        properties: Array.isArray(object.properties) ? object.properties.map(serializeProperty).filter(Boolean) : [],
        layerId: object.layerId,
        parentId: object.parentId,
        childIds: Array.isArray(object.childIds) ? [...object.childIds] : [],
        rings: Array.isArray(object.rings) ? object.rings.map(ring => ({ // リングはプレーンオブジェクトとして
          id: ring.id,
          vertexIds: [...ring.vertexIds],
          ringType: ring.ringType,
          parentId: ring.parentId
        })) : []
      };
    } else if (object instanceof Property) {
      return serializeProperty(object);
    } else if (object instanceof TimePoint) {
      return { _constructorName: 'TimePoint', ...serializeTimePoint(object) };
    }
    // リングオブジェクトはPolygonの一部としてプレーンオブジェクトでシリアライズされる想定
    // その他の未知の型
    console.warn("HistorySerializer: Unsupported object type for serialization:", object);
    // 以前の JSON.parse(JSON.stringify(object)) はクラス情報を失うため、nullを返すかエラーを投げるべき
    return null;
  }

  /**
   * 履歴から読み込んだプレーンオブジェクトを対応するドメインインスタンスにデシリアライズする。
   * リングデータの場合はプレーンオブジェクトのまま返す。
   * @param {Object | null} data - シリアライズされたプレーンオブジェクト
   * @returns {Object | null} デシリアライズされたドメインインスタンス、またはリングの場合はプレーンオブジェクト、それ以外はnull
   */
  deserialize(data) {
    if (!data) return null;

    // リングデータは _constructorName を持たない前提で処理 (Polygonの一部として保存されているため)
    if (data.id && Array.isArray(data.vertexIds) && (data.ringType === 'territory' || data.ringType === 'hole') && data._constructorName === undefined) {
      return { // リングデータはプレーンオブジェクトとして返す
        id: data.id,
        vertexIds: data.vertexIds || [],
        ringType: data.ringType,
        parentId: data.parentId !== undefined ? data.parentId : null
      };
    }

    // _constructorName を持つオブジェクトの処理
    if (!data._constructorName) {
        console.warn("HistorySerializer: Cannot deserialize data without _constructorName.", data);
        return null;
    }
    const constructorName = data._constructorName;

    try {
      switch (constructorName) {
        case 'Vertex':
          return new Vertex(data.id, data.x, data.y);
        case 'TimePoint':
          // _deserializeTimePointFromData は _constructorName を期待しないため、data をそのまま渡す
          return this._deserializeTimePointFromData(data);
        case 'Property':
          // _deserializePropertyFromData は _constructorName を期待しないため、data をそのまま渡す
          return this._deserializePropertyFromData(data);
        case 'Point':
          const pointProps = (data.properties || []).map(pData => this.deserialize(pData)).filter(p => p instanceof Property);
          return new Point(data.id, data.vertexIds || [], pointProps, data.layerId);
        case 'Line':
          const lineProps = (data.properties || []).map(pData => this.deserialize(pData)).filter(p => p instanceof Property);
          return new DomainLine(data.id, data.vertexIds || [], lineProps, data.layerId);
        case 'Polygon':
          const polygonRings = (data.rings || []).map(ringData => ({ // リングはプレーンオブジェクトのまま
            id: ringData.id,
            vertexIds: ringData.vertexIds || [],
            ringType: ringData.ringType,
            parentId: ringData.parentId !== undefined ? ringData.parentId : null
          }));
          const polygonProps = (data.properties || []).map(pData => this.deserialize(pData)).filter(p => p instanceof Property);
          return new DomainPolygon(data.id, polygonProps, data.layerId, data.parentId || "0", data.childIds || [], polygonRings);
        default:
          console.warn(`HistorySerializer: Unsupported constructor name for deserialization: ${constructorName}`, data);
          return null;
      }
    } catch (error) {
      console.error(`HistorySerializer: Error deserializing object with constructor ${constructorName}:`, error, data);
      return null;
    }
  }
}