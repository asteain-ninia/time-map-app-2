/**
 * ポリゴンラベルのアンカー座標をリングごとに算出する
 * @param {Polygon} polygon
 * @param {Map<string, Array>} childrenByRingId
 * @param {Object} viewport
 * @param {Map<string, Array>} ringVerticesCache
 * @param {number} minLabelScreenRatio
 * @returns {Array<{ringId:string, anchor:{x:number,y:number}, effectiveArea:number}>}
 * @private
 */
export function determinePolygonLabelAnchors(polygon, childrenByRingId, viewport, ringVerticesCache, minLabelScreenRatio) {
  const viewBoxWidth = viewport.width / viewport.zoom;
  const viewBoxHeight = viewport.height / viewport.zoom;
  const visibleWorldArea = viewBoxWidth * viewBoxHeight;
  if (!Number.isFinite(visibleWorldArea) || visibleWorldArea <= 0) {
    return [];
  }

  const ratio = Number.isFinite(minLabelScreenRatio) ? Math.max(0, minLabelScreenRatio) : 0.0005;
  const minEffectiveArea = visibleWorldArea * ratio;

  const ringById = new Map(polygon.rings.map(r => [r.id, r]));
  const anchorCandidates = [];

  for (const ring of polygon.rings) {
    if (ring.ringType !== "territory") continue;

    const outerVertices = (ringVerticesCache.get(ring.id) || []).map(v => ({ x: v.x, y: v.y }));
    if (outerVertices.length < 3) continue;

    const holeRings = (childrenByRingId.get(ring.id) || []).filter(child => child.ringType === "hole");
    const holeInfoList = [];
    let holesArea = 0;
    for (const hole of holeRings) {
      const holeVertices = (ringVerticesCache.get(hole.id) || []).map(v => ({ x: v.x, y: v.y }));
      if (holeVertices.length < 3) continue;
      const areaHole = Math.abs(calculateSignedArea(holeVertices));
      if (!Number.isFinite(areaHole) || areaHole === 0) continue;
      holesArea += areaHole;
      holeInfoList.push({ vertices: holeVertices, area: areaHole });
    }

    const areaOuter = Math.abs(calculateSignedArea(outerVertices));
    if (!Number.isFinite(areaOuter) || areaOuter === 0) continue;

    const effectiveArea = areaOuter - holesArea;
    if (!Number.isFinite(effectiveArea) || effectiveArea <= 0) continue;
    if (effectiveArea < minEffectiveArea) continue;

    const weightedCentroid = calculateWeightedRingCentroid(outerVertices, holeInfoList, areaOuter, effectiveArea);
    if (!weightedCentroid) continue;

    const anchorPoint = locateAnchorPointForRing(weightedCentroid, outerVertices, holeInfoList.map(info => info.vertices), viewport);
    if (!anchorPoint) continue;

    anchorCandidates.push({
      ringId: ring.id,
      anchor: anchorPoint,
      effectiveArea,
      depth: calculateRingDepth(ring, ringById),
    });
  }

  anchorCandidates.sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    if (b.effectiveArea !== a.effectiveArea) {
      return b.effectiveArea - a.effectiveArea;
    }
    return a.ringId.localeCompare(b.ringId);
  });

  return anchorCandidates;
}

/**
 * ラベル表示に用いる最小画面占有率を取得する
 * @param {Object} projectSettings
 * @returns {number}
 * @private
 */
export function resolveMinLabelScreenRatio(projectSettings) {
  const defaultRatio = 0.0005;
  const ratio = projectSettings?.rendering?.minLabelScreenRatio;
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
    return defaultRatio;
  }
  if (ratio < 0) {
    return 0;
  }
  return ratio;
}

/**
 * 穴を考慮したリングの重心を算出する
 * @param {Array<{x:number,y:number}>} outerVertices
 * @param {Array<{vertices:Array<{x:number,y:number}>, area:number}>} holeInfoList
 * @param {number} areaOuter
 * @param {number} effectiveArea
 * @returns {{x:number,y:number}|null}
 * @private
 */
function calculateWeightedRingCentroid(outerVertices, holeInfoList, areaOuter, effectiveArea) {
  const centroidOuter = calculatePolygonCentroid(outerVertices);
  if (!centroidOuter) return null;

  if (!holeInfoList || holeInfoList.length === 0) {
    return centroidOuter;
  }

  let weightedX = centroidOuter.x * areaOuter;
  let weightedY = centroidOuter.y * areaOuter;
  for (const holeInfo of holeInfoList) {
    const centroidHole = calculatePolygonCentroid(holeInfo.vertices);
    if (!centroidHole) continue;
    weightedX -= centroidHole.x * holeInfo.area;
    weightedY -= centroidHole.y * holeInfo.area;
  }

  return {
    x: weightedX / effectiveArea,
    y: weightedY / effectiveArea,
  };
}

/**
 * 指定リングのラベルアンカーを決定する
 * @param {{x:number,y:number}} weightedCentroid
 * @param {Array<{x:number,y:number}>} outerVertices
 * @param {Array<Array<{x:number,y:number}>>} holeVerticesList
 * @param {Object} viewport
 * @returns {{x:number,y:number}|null}
 * @private
 */
function locateAnchorPointForRing(weightedCentroid, outerVertices, holeVerticesList, viewport) {
  const threshold = 2 / viewport.zoom;
  const tolerance = Math.max(1 / viewport.zoom, 1e-4);

  let anchorPoint = null;
  let anchorDistance = -Infinity;

  if (
    Number.isFinite(weightedCentroid.x) &&
    Number.isFinite(weightedCentroid.y) &&
    isPointInPolygon(weightedCentroid, outerVertices, holeVerticesList)
  ) {
    const centroidDistance = pointToPolygonDistance(weightedCentroid, outerVertices, holeVerticesList);
    anchorPoint = { x: weightedCentroid.x, y: weightedCentroid.y };
    anchorDistance = centroidDistance.distance;
  }

  if (!anchorPoint || anchorDistance < threshold) {
    const polyPoint = polylabel(outerVertices, holeVerticesList, tolerance);
    if (polyPoint) {
      anchorPoint = { x: polyPoint.x, y: polyPoint.y };
      anchorDistance = polyPoint.distance;
    }
  }

  if (!anchorPoint) {
    return null;
  }

  if (anchorDistance < 0) {
    anchorDistance = 0;
  }

  return anchorPoint;
}

/**
 * リングのネスト深度を算出する
 * @param {Object} ring
 * @param {Map<string, Object>} ringById
 * @returns {number}
 * @private
 */
function calculateRingDepth(ring, ringById) {
  let depth = 0;
  let parentId = ring.parentId;
  while (parentId) {
    const parentRing = ringById.get(parentId);
    if (!parentRing) break;
    depth += 1;
    parentId = parentRing.parentId;
  }
  return depth;
}

function calculateSignedArea(points) {
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, len = points.length; i < len; i++) {
    const { x: x1, y: y1 } = points[i];
    const { x: x2, y: y2 } = points[(i + 1) % len];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function calculatePolygonCentroid(points) {
  const area = calculateSignedArea(points);
  if (area === 0) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0, len = points.length; i < len; i++) {
    const { x: x1, y: y1 } = points[i];
    const { x: x2, y: y2 } = points[(i + 1) % len];
    const factor = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * factor;
    cy += (y1 + y2) * factor;
  }
  const areaFactor = 1 / (6 * area);
  return { x: cx * areaFactor, y: cy * areaFactor };
}

function isPointInRing(point, ringPoints) {
  if (!ringPoints || ringPoints.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ringPoints.length - 1; i < ringPoints.length; j = i++) {
    const xi = ringPoints[i].x;
    const yi = ringPoints[i].y;
    const xj = ringPoints[j].x;
    const yj = ringPoints[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function isPointInPolygon(point, outer, holes) {
  if (!isPointInRing(point, outer)) return false;
  if (!holes) return true;
  for (const hole of holes) {
    if (isPointInRing(point, hole)) return false;
  }
  return true;
}

function pointToSegmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const diffX = px - ax;
    const diffY = py - ay;
    return diffX * diffX + diffY * diffY;
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const closestX = ax + clampedT * dx;
  const closestY = ay + clampedT * dy;
  const distX = px - closestX;
  const distY = py - closestY;
  return distX * distX + distY * distY;
}

function pointToPolygonDistance(point, outer, holes) {
  const pointInOuter = isPointInRing(point, outer);
  let pointInHole = false;
  if (pointInOuter && holes) {
    for (const hole of holes) {
      if (isPointInRing(point, hole)) {
        pointInHole = true;
        break;
      }
    }
  }

  let minDistSq = Infinity;
  const processRing = (ring) => {
    for (let i = 0; i < ring.length; i++) {
      const { x: ax, y: ay } = ring[i];
      const { x: bx, y: by } = ring[(i + 1) % ring.length];
      const distSq = pointToSegmentDistanceSquared(point.x, point.y, ax, ay, bx, by);
      if (distSq < minDistSq) {
        minDistSq = distSq;
      }
    }
  };

  processRing(outer);
  if (holes) {
    for (const hole of holes) {
      processRing(hole);
    }
  }

  const distance = Math.sqrt(minDistSq);
  const inside = pointInOuter && !pointInHole;
  return { distance: inside ? distance : -distance };
}

class PolyLabelCell {
  constructor(x, y, h, outer, holes) {
    this.x = x;
    this.y = y;
    this.h = h;
    const distInfo = pointToPolygonDistance({ x, y }, outer, holes);
    this.d = distInfo.distance;
    this.max = this.d + this.h * Math.SQRT2;
  }
}

function polylabel(outer, holes, tolerance) {
  if (!outer || outer.length === 0) return null;

  let minX = outer[0].x;
  let minY = outer[0].y;
  let maxX = outer[0].x;
  let maxY = outer[0].y;
  for (const point of outer) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  let cellSize = Math.max(width, height);
  if (cellSize === 0) {
    const first = outer[0];
    return { x: first.x, y: first.y, distance: 0 };
  }

  const cellQueue = [];
  const h = cellSize / 2;

  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      cellQueue.push(new PolyLabelCell(x + h, y + h, h, outer, holes));
    }
  }

  const centroid = calculatePolygonCentroid(outer);
  const initialPoint = centroid || outer[0];
  let bestCell = new PolyLabelCell(initialPoint.x, initialPoint.y, 0, outer, holes);

  cellQueue.sort((a, b) => b.max - a.max);

  const effectiveTolerance = Math.max(tolerance || 1, 1e-4);

  while (cellQueue.length) {
    const cell = cellQueue.shift();
    if (cell.d > bestCell.d) {
      bestCell = cell;
    }
    if (cell.max - bestCell.d <= effectiveTolerance) {
      continue;
    }
    if (cell.h <= effectiveTolerance) {
      continue;
    }

    const newH = cell.h / 2;
    const cells = [
      new PolyLabelCell(cell.x - newH, cell.y - newH, newH, outer, holes),
      new PolyLabelCell(cell.x + newH, cell.y - newH, newH, outer, holes),
      new PolyLabelCell(cell.x - newH, cell.y + newH, newH, outer, holes),
      new PolyLabelCell(cell.x + newH, cell.y + newH, newH, outer, holes),
    ];
    for (const subCell of cells) {
      cellQueue.push(subCell);
    }
    cellQueue.sort((a, b) => b.max - a.max);
  }

  return {
    x: bestCell.x,
    y: bestCell.y,
    distance: Math.max(bestCell.d, 0),
  };
}
