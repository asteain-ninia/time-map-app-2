import { Polygon } from '../../../domain/entities/Polygon.js';
import { FeatureAnchor } from '../../../domain/value-objects/FeatureAnchor.js';
import { Property } from '../../../domain/value-objects/Property.js';
import { TimePoint } from '../../../domain/value-objects/TimePoint.js';
import { ensurePolygonLayerConstraints } from './polygonLayerValidation.js';

export class SplitPolygonUseCase {
  constructor(worldRepository, geometryService, layerService, generateId) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService;
    this._layerService = layerService;
    this._generateId = generateId;
  }

  async execute(polygonId, splitPlan, inheritSideIndex, newProperty, editTime) {
    if (!polygonId) {
      throw new Error('分割対象のポリゴンIDが指定されていません。');
    }
    if (!splitPlan || !Array.isArray(splitPlan.polygons) || splitPlan.polygons.length !== 2) {
      throw new Error('分割結果の情報が不足しています。');
    }
    if (!(newProperty instanceof Property)) {
      throw new Error('新しいプロパティが不正です。');
    }
    if (!(editTime instanceof TimePoint)) {
      throw new Error('分割時刻は TimePoint で指定してください。');
    }
    const inheritIndex = inheritSideIndex === 1 ? 1 : 0;

    const world = await this._worldRepository.getWorld();
    const originalVerticesSnapshot = world.vertices.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }));

    const polygonIndex = world.features.findIndex(
      feature => feature instanceof Polygon && feature.id === polygonId
    );
    if (polygonIndex === -1) {
      throw new Error(`分割対象のポリゴンが見つかりません: ${polygonId}`);
    }

    const originalPolygon = world.features[polygonIndex];
    this._assertSplittablePolygon(originalPolygon);

    const polygonPlanToKeep = splitPlan.polygons[inheritIndex];
    const polygonPlanToCreate = splitPlan.polygons[inheritIndex === 0 ? 1 : 0];
    const ringsToKeepPlan = this._normalizeRingPlan(polygonPlanToKeep);
    const ringsToCreatePlan = this._normalizeRingPlan(polygonPlanToCreate);

    const newVertexIdsByKey = new Map();
    const addedVerticesData = [];

    const resolveVertexId = (point) => {
      if (point.sourceVertexId) {
        return point.sourceVertexId;
      }
      const key = point.key;
      if (!key) {
        throw new Error('分割点の識別子が不足しています。');
      }
      if (newVertexIdsByKey.has(key)) {
        return newVertexIdsByKey.get(key);
      }
      const vertexId = this._generateId('vertex');
      newVertexIdsByKey.set(key, vertexId);
      world.vertices.push({ id: vertexId, x: point.x, y: point.y });
      addedVerticesData.push({ id: vertexId, x: point.x, y: point.y });
      return vertexId;
    };
    const updatedRings = this._buildRingsFromPlan(ringsToKeepPlan, resolveVertexId);
    const newRings = this._buildRingsFromPlan(ringsToCreatePlan, resolveVertexId);

    const { updatedPolygon, nextFutureAnchorStart } = this._buildUpdatedPolygonWithAnchors(
      originalPolygon,
      updatedRings,
      editTime
    );
    const placementAtEditTime = typeof originalPolygon.getPlacementAt === 'function'
      ? originalPolygon.getPlacementAt(editTime)
      : {
        layerId: originalPolygon.layerId,
        parentId: originalPolygon.parentId,
        childIds: originalPolygon.childIds
      };
    const newPolygonId = this._generateId('polygon');
    const newAnchor = this._buildNewPolygonAnchor(
      newPolygonId,
      newProperty,
      newRings,
      placementAtEditTime,
      editTime,
      nextFutureAnchorStart
    );
    const newPolygon = new Polygon(
      newPolygonId,
      [newProperty],
      placementAtEditTime.layerId,
      placementAtEditTime.parentId,
      [],
      newRings,
      [newAnchor]
    );

    const originalFeaturesSnapshot = world.features.slice();
    try {
      world.features[polygonIndex] = updatedPolygon;
      world.features.push(newPolygon);

      ensurePolygonLayerConstraints(updatedPolygon, world, this._layerService, this._geometryService);
      ensurePolygonLayerConstraints(newPolygon, world, this._layerService, this._geometryService);

      await this._worldRepository.saveWorld(world);
    } catch (error) {
      world.vertices = originalVerticesSnapshot.map(vertex => ({ id: vertex.id, x: vertex.x, y: vertex.y }));
      world.features = originalFeaturesSnapshot;
      throw error;
    }

    return {
      updatedPolygon,
      newPolygon,
      addedVerticesData
    };
  }

  _assertSplittablePolygon(polygon) {
    if (!(polygon instanceof Polygon)) {
      throw new Error('分割対象がポリゴンではありません。');
    }
    if (polygon.childIds && polygon.childIds.length > 0) {
      throw new Error('下位領域を持つ面情報は分割できません。');
    }
    if (!Array.isArray(polygon.rings) || polygon.rings.length === 0) {
      throw new Error('形状を持つ面情報のみ分割できます。');
    }
  }

  _normalizeRingPlan(polygonPlan) {
    if (!polygonPlan || !Array.isArray(polygonPlan.rings) || polygonPlan.rings.length === 0) {
      throw new Error('分割結果の面が成立しません。');
    }
    polygonPlan.rings.forEach((ring, index) => {
      if (!ring || !Array.isArray(ring.points) || ring.points.length < 3) {
        throw new Error('分割結果のリングが不正です。');
      }
      if (ring.ringType !== 'territory' && ring.ringType !== 'hole') {
        throw new Error('分割結果のリング種別が不正です。');
      }
      if (ring.parentIndex !== null && ring.parentIndex !== undefined) {
        if (!Number.isInteger(ring.parentIndex) || ring.parentIndex < 0 || ring.parentIndex >= polygonPlan.rings.length) {
          throw new Error('分割結果の親リング指定が不正です。');
        }
        if (ring.parentIndex === index) {
          throw new Error('分割結果の親リング指定が不正です。');
        }
      }
      ring.points.forEach(point => {
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
          throw new Error('分割点の座標が不正です。');
        }
      });
      const coords = ring.points.map(point => ({ x: point.x, y: point.y }));
      if (this._geometryService.isPolygonSelfIntersecting(coords)) {
        throw new Error('分割結果の面が自己交差しています。');
      }
    });
    return polygonPlan.rings;
  }

  _buildRingsFromPlan(ringsPlan, resolveVertexId) {
    const ringsWithIndices = ringsPlan.map((ring) => ({
      id: this._generateId('ring'),
      vertexIds: ring.points.map(resolveVertexId),
      ringType: ring.ringType,
      parentIndex: ring.parentIndex ?? null
    }));

    const idByIndex = new Map();
    ringsWithIndices.forEach((ring, index) => {
      idByIndex.set(index, ring.id);
    });

    return ringsWithIndices.map((ring) => ({
      id: ring.id,
      vertexIds: ring.vertexIds,
      ringType: ring.ringType,
        parentId: ring.parentIndex !== null ? idByIndex.get(ring.parentIndex) : null
    }));
  }

  _buildUpdatedPolygonWithAnchors(originalPolygon, updatedRings, editTime) {
    if (!(editTime instanceof TimePoint)) {
      throw new Error('分割時刻は TimePoint で指定してください。');
    }
    if (!originalPolygon.existsAt(editTime)) {
      throw new Error('指定時刻に存在しない面情報は分割できません。');
    }

    if (Array.isArray(originalPolygon.anchors) && originalPolygon.anchors.length > 0) {
      const nextShape = this._buildPolygonShape(updatedRings);
      const anchors = this._normalizeAnchorTimeline(originalPolygon.anchors);
      const nextFutureAnchorStart = this._findNextFutureAnchorStart(anchors, editTime);
      const exactIndex = anchors.findIndex(anchor => anchor.startTime.equals(editTime));

      if (exactIndex !== -1) {
        const exactAnchor = anchors[exactIndex];
        const nextAnchors = [...anchors];
        nextAnchors[exactIndex] = new FeatureAnchor({
          id: exactAnchor.id,
          timeRange: {
            start: editTime,
            end: this._resolveAnchorEndTime(exactAnchor.endTime, editTime, nextFutureAnchorStart)
          },
          property: {
            name: exactAnchor.name,
            description: exactAnchor.description,
            attributes: exactAnchor.getAttributes()
          },
          shape: nextShape,
          placement: exactAnchor.placement
        });
        return {
          updatedPolygon: originalPolygon.withAnchors(this._normalizeAnchorTimeline(nextAnchors)),
          nextFutureAnchorStart
        };
      }

      const activeIndex = anchors.findIndex(anchor => anchor.isActiveAt(editTime));
      if (activeIndex === -1) {
        throw new Error('指定時刻で有効な履歴アンカーが見つかりません。');
      }

      const activeAnchor = anchors[activeIndex];
      if (!activeAnchor.startTime.isBefore(editTime)) {
        throw new Error('分割時刻が履歴アンカー境界と矛盾しています。');
      }

      const nextAnchors = [...anchors];
      nextAnchors[activeIndex] = activeAnchor.withTimeRange(activeAnchor.startTime, editTime);
      const splitAnchor = this._createSplitAnchorFromSource(
        originalPolygon.id,
        activeAnchor,
        nextShape,
        editTime,
        nextFutureAnchorStart,
        nextAnchors
      );
      nextAnchors.splice(activeIndex + 1, 0, splitAnchor);
      return {
        updatedPolygon: originalPolygon.withAnchors(this._normalizeAnchorTimeline(nextAnchors)),
        nextFutureAnchorStart
      };
    }

    return {
      updatedPolygon: new Polygon(
      originalPolygon.id,
      originalPolygon.properties,
      originalPolygon.layerId,
      originalPolygon.parentId,
      originalPolygon.childIds,
      updatedRings
      ),
      nextFutureAnchorStart: null
    };
  }

  _buildNewPolygonAnchor(newPolygonId, newProperty, newRings, placementAtEditTime, editTime, nextFutureAnchorStart) {
    const endTime = this._resolveAnchorEndTime(newProperty.endTime, editTime, nextFutureAnchorStart);
    return new FeatureAnchor({
      id: `anchor-${newPolygonId}-1`,
      timeRange: { start: editTime, end: endTime },
      property: {
        name: newProperty.name,
        description: newProperty.description,
        attributes: newProperty.getAttributes()
      },
      shape: this._buildPolygonShape(newRings),
      placement: {
        layerId: placementAtEditTime.layerId,
        parentId: placementAtEditTime.parentId,
        childIds: []
      }
    });
  }

  _createSplitAnchorFromSource(featureId, sourceAnchor, nextShape, editTime, nextFutureAnchorStart, existingAnchors) {
    const splitAnchorId = this._buildSplitAnchorId(featureId, existingAnchors);
    return new FeatureAnchor({
      id: splitAnchorId,
      timeRange: {
        start: editTime,
        end: this._resolveAnchorEndTime(sourceAnchor.endTime, editTime, nextFutureAnchorStart)
      },
      property: {
        name: sourceAnchor.name,
        description: sourceAnchor.description,
        attributes: sourceAnchor.getAttributes()
      },
      shape: nextShape,
      placement: sourceAnchor.placement
    });
  }

  _buildSplitAnchorId(featureId, existingAnchors) {
    const usedIds = new Set((existingAnchors || []).map(anchor => anchor.id));
    let candidate = this._generateId('anchor');
    while (usedIds.has(candidate)) {
      candidate = this._generateId('anchor');
    }
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate;
    }
    return `anchor-${featureId}-split`;
  }

  _findNextFutureAnchorStart(anchors, editTime) {
    for (const anchor of anchors) {
      if (editTime.isBefore(anchor.startTime)) {
        return anchor.startTime;
      }
    }
    return null;
  }

  _resolveAnchorEndTime(requestedEndTime, startTime, nextFutureAnchorStart) {
    if (!(startTime instanceof TimePoint)) {
      throw new Error('履歴アンカー開始時刻が不正です。');
    }

    let endTime = null;
    if (requestedEndTime !== null && requestedEndTime !== undefined) {
      if (!(requestedEndTime instanceof TimePoint)) {
        throw new Error('履歴アンカー終了時刻は TimePoint で指定してください。');
      }
      if (!startTime.isBefore(requestedEndTime)) {
        throw new Error('履歴アンカー終了時刻は開始時刻より後に設定してください。');
      }
      endTime = requestedEndTime;
    }

    if (nextFutureAnchorStart instanceof TimePoint) {
      if (endTime === null || nextFutureAnchorStart.isBefore(endTime)) {
        endTime = nextFutureAnchorStart;
      }
    }
    return endTime;
  }

  _normalizeAnchorTimeline(anchors) {
    const sorted = [...anchors].sort((left, right) => this._compareTimePoints(left.startTime, right.startTime));
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index - 1].startTime.equals(sorted[index].startTime)) {
        throw new Error('同一時刻の履歴アンカーが重複しています。');
      }
    }
    return sorted;
  }

  _compareTimePoints(left, right) {
    if (left.equals(right)) {
      return 0;
    }
    return left.isBefore(right) ? -1 : 1;
  }

  _buildPolygonShape(rings) {
    return {
      type: 'Polygon',
      rings: (rings || []).map(ring => ({
        id: ring.id,
        vertexIds: [...ring.vertexIds],
        ringType: ring.ringType,
        parentId: ring.parentId ?? null
      }))
    };
  }
}
