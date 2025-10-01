import { Coordinate } from '../value-objects/Coordinate';

function buildVertexMap(allVertices) {
  const map = new Map();
  if (!Array.isArray(allVertices)) {
    return map;
  }

  for (const vertex of allVertices) {
    if (!vertex || typeof vertex.id !== 'string') {
      continue;
    }
    map.set(vertex.id, vertex);
  }
  return map;
}

function toRingCoordinates(ring, vertexMap) {
  if (!ring || !Array.isArray(ring.vertexIds) || ring.vertexIds.length < 3) {
    throw new Error('Ring data must contain at least three vertexIds.');
  }

  return ring.vertexIds.map(vertexId => {
    const vertex = vertexMap.get(vertexId);
    if (!vertex) {
      throw new Error(`Vertex with id ${vertexId} not found while converting ring ${ring.id}.`);
    }
    if (typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
      throw new Error(`Vertex with id ${vertexId} is missing numeric coordinates.`);
    }
    return new Coordinate(vertex.x, vertex.y);
  });
}

function pickRingCoordinatePairs(polygon, vertexMap, ringType) {
  if (!polygon || !Array.isArray(polygon.rings)) {
    return [];
  }

  return polygon.rings
    .filter(ring => ring.ringType === ringType)
    .map(ring => ({ ring, coordinates: toRingCoordinates(ring, vertexMap) }));
}

/**
 * レイヤー間の関係管理を担当するドメインサービス
 */
export class LayerService {
  /**
   * レイヤーが正しい階層関係にあるかを検証
   * @param {Layer[]} layers - レイヤーの配列
   * @returns {boolean} 階層関係が正しければtrue
   */
  validateLayerHierarchy(layers) {
    // 順序の一意性をチェック
    const orders = layers.map(layer => layer.order);
    const uniqueOrders = new Set(orders);
    if (orders.length !== uniqueOrders.size) {
      return false;
    }
    
    // 順序が連続しているかをチェック
    orders.sort((a, b) => a - b);
    for (let i = 1; i < orders.length; i++) {
      if (orders[i] !== orders[i-1] + 1) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * ポリゴンがレイヤー階層に従っているかを検証
   * @param {Polygon} polygon - 検証するポリゴン
   * @param {Polygon[]} allPolygons - すべてのポリゴンの配列
   * @param {Layer[]} layers - すべてのレイヤーの配列
   * @returns {boolean} 階層関係に従っていればtrue
   */
  validatePolygonHierarchy(polygon, allPolygons, layers) {
    // 最上位レイヤーのポリゴンは親を持たなくても良い
    const polygonLayer = layers.find(layer => layer.id === polygon.layerId);
    if (polygonLayer.order === 0 && polygon.parentId === "0") {
      return true;
    }
    
    // 親ポリゴンの存在確認
    if (polygon.parentId === "0") {
      return false; // 最上位レイヤー以外は親が必要
    }
    
    const parentPolygon = allPolygons.find(p => p.id === polygon.parentId);
    if (!parentPolygon) {
      return false; // 親ポリゴンが存在しない
    }
    
    // 親ポリゴンが上位レイヤーにあることを確認
    const parentLayer = layers.find(layer => layer.id === parentPolygon.layerId);
    return parentLayer.order < polygonLayer.order;
  }

  /**
   * 下位ポリゴンから親ポリゴンの形状を計算
   * @param {string} parentId - 親ポリゴンのID
   * @param {Polygon[]} allPolygons - すべてのポリゴンの配列
   * @param {Vertex[]} allVertices - すべての頂点の配列
   * @returns {Object} 計算された形状 { vertexIds, subPolygons, isMultiPolygon }
   */
  calculateParentShape(parentId, allPolygons, allVertices) {
    // 親IDを持つすべての子ポリゴンを取得
    const childPolygons = allPolygons.filter(p => p.parentId === parentId);
    if (childPolygons.length === 0) {
      return null;
    }

    const aggregatedRings = childPolygons.flatMap(child =>
      child.rings.map(ring => ({
        id: ring.id,
        vertexIds: [...ring.vertexIds],
        ringType: ring.ringType,
        parentId: ring.parentId
      }))
    );

    const topLevelTerritories = aggregatedRings.filter(ring => ring.ringType === 'territory' && ring.parentId === null);

    return {
      rings: aggregatedRings,
      isMultiPolygon: topLevelTerritories.length > 1,
      childPolygonIds: childPolygons.map(p => p.id)
    };
  }

  /**
   * ポリゴンが特定のレイヤーに属する別のポリゴンに含まれているかチェック
   * @param {Polygon} polygon - チェックするポリゴン
   * @param {Polygon[]} allPolygons - すべてのポリゴンの配列
   * @param {Vertex[]} allVertices - すべての頂点の配列
   * @param {Layer[]} layers - すべてのレイヤーの配列
   * @param {GeometryService} geometryService - 幾何学サービス
   * @returns {boolean} 含まれていればtrue
   */
  isContainedInHigherLayerPolygon(polygon, allPolygons, allVertices, layers, geometryService) {
    // ポリゴンのレイヤーを特定
    const polygonLayer = layers.find(layer => layer.id === polygon.layerId);
    
    // 上位レイヤーをすべて特定
    const higherLayers = layers.filter(layer => layer.order < polygonLayer.order);

    if (higherLayers.length === 0) {
      return true;
    }

    // 上位レイヤーのポリゴンを検索
    const higherPolygons = allPolygons.filter(p => 
      higherLayers.some(layer => layer.id === p.layerId)
    );

    const vertexMap = buildVertexMap(allVertices);
    const targetTerritoryRings = pickRingCoordinatePairs(polygon, vertexMap, 'territory');

    if (targetTerritoryRings.length === 0) {
      // 自身の形状がなく、子ポリゴン由来で構成される場合はここでの判定対象外
      return true;
    }

    // 各上位ポリゴンについて含有関係をチェック
    for (const higherPolygon of higherPolygons) {
      const higherTerritories = pickRingCoordinatePairs(higherPolygon, vertexMap, 'territory');
      if (higherTerritories.length === 0) {
        continue;
      }
      const higherHoles = pickRingCoordinatePairs(higherPolygon, vertexMap, 'hole');

      const allRingsContained = targetTerritoryRings.every(({ coordinates: targetCoords }) => {
        return higherTerritories.some(({ coordinates: territoryCoords }) => {
          if (!geometryService.isRingCompletelyInsideRing(targetCoords, territoryCoords)) {
            return false;
          }

          // テリトリー内に存在する穴に完全に含まれていないかチェック
          return higherHoles.every(({ coordinates: holeCoords }) =>
            !geometryService.isRingCompletelyInsideRing(targetCoords, holeCoords)
          );
        });
      });

      if (allRingsContained) {
        return true;
      }
    }

    return false;
  }

  /**
   * 子ポリゴンのリストを取得
   * @param {string} parentId - 親ポリゴンのID
   * @param {Polygon[]} allPolygons - すべてのポリゴンの配列
   * @returns {Polygon[]} 子ポリゴンの配列
   */
  getChildPolygons(parentId, allPolygons) {
    return allPolygons.filter(p => p.parentId === parentId);
  }

  /**
   * レイヤー内での領域の排他性をチェック
   * @param {Polygon} polygon - チェックするポリゴン
   * @param {Polygon[]} layerPolygons - 同じレイヤーの他のポリゴン
   * @param {Vertex[]} allVertices - すべての頂点の配列
   * @param {GeometryService} geometryService - 幾何学サービス
   * @returns {boolean} 排他的であればtrue（重なりがなければtrue）
   */
  checkExclusivity(polygon, layerPolygons, allVertices, geometryService) {
    const vertexMap = buildVertexMap(allVertices);
    const targetTerritories = pickRingCoordinatePairs(polygon, vertexMap, 'territory');

    if (targetTerritories.length === 0) {
      // 自身が直接持つリングが無い場合は排他対象外
      return true;
    }

    // 同一ポリゴン内の領土リング同士が干渉していないかチェック
    for (let i = 0; i < targetTerritories.length; i++) {
      const first = targetTerritories[i];
      for (let j = i + 1; j < targetTerritories.length; j++) {
        const second = targetTerritories[j];

        if (geometryService.doRingsIntersect(first.coordinates, second.coordinates)) {
          return false;
        }

        if (
          geometryService.isRingCompletelyInsideRing(first.coordinates, second.coordinates) ||
          geometryService.isRingCompletelyInsideRing(second.coordinates, first.coordinates)
        ) {
          return false;
        }
      }
    }

    // 各レイヤーポリゴンについて重なりをチェック
    for (const layerPolygon of layerPolygons) {
      if (layerPolygon.id === polygon.id) continue; // 自分自身はスキップ

      const otherTerritories = pickRingCoordinatePairs(layerPolygon, vertexMap, 'territory');
      const otherHoles = pickRingCoordinatePairs(layerPolygon, vertexMap, 'hole');
      if (otherTerritories.length === 0) {
        continue;
      }

      for (const { coordinates: targetCoords } of targetTerritories) {
        for (const { coordinates: otherCoords } of otherTerritories) {
          if (geometryService.doRingsIntersect(targetCoords, otherCoords)) {
            return false;
          }

          if (geometryService.isRingCompletelyInsideRing(otherCoords, targetCoords)) {
            return false;
          }

          if (geometryService.isRingCompletelyInsideRing(targetCoords, otherCoords)) {
            const isInsidePermittedHole = otherHoles.some(({ coordinates: holeCoords }) =>
              geometryService.isRingCompletelyInsideRing(targetCoords, holeCoords)
            );
            if (!isInsidePermittedHole) {
              return false;
            }
          }
        }

        for (const { coordinates: holeCoords } of otherHoles) {
          if (geometryService.doRingsIntersect(targetCoords, holeCoords)) {
            return false;
          }
        }
      }
    }

    return true;
  }
}

