// src/domain/services/GeometryService.js

import { Coordinate } from '../value-objects/Coordinate';
import { Vertex } from '../entities/Vertex'; // Vertexも使う可能性があるのでインポートしておく

/**
 * 幾何学計算を提供するドメインサービス
 */
export class GeometryService {
  /**
   * 2点間の距離を計算
   * @param {number} x1 - 点1のX座標
   * @param {number} y1 - 点1のY座標
   * @param {number} x2 - 点2のX座標
   * @param {number} y2 - 点2のY座標
   * @returns {number} 2点間の距離
   */
  calculateDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 2点間の距離の二乗を計算 (平方根の計算を省略)
   * @param {number} x1 - 点1のX座標
   * @param {number} y1 - 点1のY座標
   * @param {number} x2 - 点2のX座標
   * @param {number} y2 - 点2のY座標
   * @returns {number} 2点間の距離の二乗
   */
  calculateDistanceSq(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      return dx * dx + dy * dy;
  }

  /**
   * 2点間の直線距離を計算（キロメートル単位）
   * @param {number} x1 - 点1のX座標
   * @param {number} y1 - 点1のY座標
   * @param {number} x2 - 点2のX座標
   * @param {number} y2 - 点2のY座標
   * @param {number} equatorLength - 赤道長（km）
   * @returns {number} 2点間の距離（km）
   */
  calculateLinearDistanceInKm(x1, y1, x2, y2, equatorLength) {
    // 正距円筒図法に基づく距離計算
    // X座標は経度、Y座標は緯度に対応

    // 経度1度あたりの距離
    const degreeLengthAtEquator = equatorLength / 360;

    // 緯度1度あたりの距離（一定）
    const latitudeDegreeLength = equatorLength / 360;

    // 実際の経度の差（横方向）
    const dx = Math.abs(x2 - x1);

    // 実際の緯度の差（縦方向）
    const dy = Math.abs(y2 - y1);

    // 横方向の距離計算（緯度による経度距離の補正）
    // 緯度の平均値を使用して余弦補正を適用
    const avgLat = (y1 + y2) / 2;
    const cosLat = Math.cos(avgLat * Math.PI / 180);
    const xDistance = dx * degreeLengthAtEquator * cosLat;

    // 縦方向の距離計算
    const yDistance = dy * latitudeDegreeLength;

    // 直線距離の計算
    return Math.sqrt(xDistance * xDistance + yDistance * yDistance);
  }

  /**
   * 2点間の大円距離を計算（キロメートル単位）
   * @param {number} lon1 - 点1の経度
   * @param {number} lat1 - 点1の緯度
   * @param {number} lon2 - 点2の経度
   * @param {number} lat2 - 点2の緯度
   * @param {number} earthRadius - 地球の半径（km）
   * @returns {number} 2点間の大円距離（km）
   */
  calculateGreatCircleDistance(lon1, lat1, lon2, lat2, earthRadius = 6371) {
    // 緯度経度をラジアンに変換
    const dLat = this._toRadians(lat2 - lat1);
    const dLon = this._toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this._toRadians(lat1)) * Math.cos(this._toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  }

  /**
   * 2点間の大円コースを取得
   * @param {number} lon1 - 点1の経度
   * @param {number} lat1 - 点1の緯度
   * @param {number} lon2 - 点2の経度
   * @param {number} lat2 - 点2の緯度
   * @param {number} segments - 分割数
   * @returns {{x:number,y:number}[]} 大円上の点配列
   */
  calculateGreatCirclePath(lon1, lat1, lon2, lat2, segments = 32) {
    const φ1 = this._toRadians(lat1);
    const λ1 = this._toRadians(lon1);
    const φ2 = this._toRadians(lat2);
    const λ2 = this._toRadians(lon2);

    // 経度差を -π〜π の範囲に正規化して最短経路を求める
    const Δλ = this._normalizeRadians(λ2 - λ1);

    const δ = 2 * Math.asin(Math.sqrt(
      Math.sin((φ2 - φ1) / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
    ));
    if (δ === 0) return [{ x: lon1, y: lat1 }, { x: lon2, y: lat2 }];
    const sinδ = Math.sin(δ);
    const path = [];
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const A = Math.sin((1 - f) * δ) / sinδ;
      const B = Math.sin(f * δ) / sinδ;
      const λ = λ1 + f * Δλ;
      const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ);
      const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ);
      const z = A * Math.sin(φ1) + B * Math.sin(φ2);
      const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
      const λOut = Math.atan2(y, x);
      path.push({ x: this._toDegrees(λOut), y: this._toDegrees(φ) });
    }
    return path;
  }

  /**
   * 度をラジアンに変換
   * @param {number} degrees - 度数
   * @returns {number} ラジアン
   * @private
   */
  _toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  /**
   * ラジアンを度に変換
   * @param {number} radians - ラジアン
   * @returns {number} 度数
   * @private
   */
  _toDegrees(radians) {
    return radians * 180 / Math.PI;
  }

  /**
   * ラジアン値を -π〜π の範囲に正規化
   * @param {number} rad - ラジアン
   * @returns {number} 正規化されたラジアン
   * @private
   */
  _normalizeRadians(rad) {
    const twoPi = 2 * Math.PI;
    return ((rad + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  }

  /**
   * 多角形の面積を計算
   * @param {Vertex[] | Coordinate[]} vertices - 頂点の配列
   * @returns {number} 多角形の面積
   */
  calculatePolygonArea(vertices) {
    if (!vertices || vertices.length < 3) return 0; // Add null check

    let area = 0;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      // Check if vertices[j] and vertices[i] are valid objects with x and y properties
      if (!vertices[j] || typeof vertices[j].x !== 'number' || typeof vertices[j].y !== 'number' ||
          !vertices[i] || typeof vertices[i].x !== 'number' || typeof vertices[i].y !== 'number') {
        // console.warn('Invalid vertex data in calculatePolygonArea:', vertices[j], vertices[i]);
        continue; // Skip this iteration if data is invalid
      }
      area += (vertices[j].x + vertices[i].x) * (vertices[j].y - vertices[i].y);
    }

    return Math.abs(area / 2);
  }

  /**
   * 多角形の面積をキロメートル単位で計算
   * @param {Vertex[]} vertices - 頂点の配列
   * @param {number} equatorLength - 赤道長（km）
   * @returns {number} 多角形の面積（km²）
   */
  calculatePolygonAreaInKm2(vertices, equatorLength) {
    if (!vertices || vertices.length < 3) return 0;
    // Filter out invalid vertices before calculation
    const validVertices = vertices.filter(v => v && typeof v.x === 'number' && typeof v.y === 'number');
    if (validVertices.length < 3) return 0;


    // 基本的な面積を計算
    const areaInPixels = this.calculatePolygonArea(validVertices);

    // 緯度1度あたりの距離（km）
    const latDegreeLength = equatorLength / 360;

    // 面積の計算（緯度による経度の長さの変化を考慮）
    // 簡易計算として平均緯度を使用
    let avgLat = 0;
    for (const vertex of validVertices) {
      avgLat += vertex.y;
    }
    avgLat /= validVertices.length;

    // 緯度による距離の補正係数（余弦）
    const cosLat = Math.cos(avgLat * Math.PI / 180);

    // 1平方ピクセルあたりの面積（km²）
    const pixelAreaInKm2 = (latDegreeLength * latDegreeLength) * cosLat;

    return areaInPixels * pixelAreaInKm2;
  }

  /**
   * 2つの線分が**端点を除いて**交差するかどうかをチェック
   * @param {Coordinate} p1 - 線分1の始点
   * @param {Coordinate} p2 - 線分1の終点
   * @param {Coordinate} q1 - 線分2の始点
   * @param {Coordinate} q2 - 線分2の終点
   * @returns {boolean} 線分が端点以外で交差すればtrue
   */
  doLineSegmentsIntersectProperly(p1, p2, q1, q2) {
    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = q2.x - q1.x;
    const dy2 = q2.y - q1.y;

    const denominator = (dy2 * dx1 - dx2 * dy1);
    // 平行または同一直線上の場合は交差しない（許容誤差）
    if (Math.abs(denominator) < 1e-9) return false;

    const ua = ((dx2 * (p1.y - q1.y)) - (dy2 * (p1.x - q1.x))) / denominator;
    const ub = ((dx1 * (p1.y - q1.y)) - (dy1 * (p1.x - q1.x))) / denominator;

    // 線分内部での交差をチェック (端点での接触を除く)
    const epsilon = 1e-9; // 浮動小数点誤差の許容範囲
    return (ua > epsilon && ua < (1 - epsilon) && ub > epsilon && ub < (1 - epsilon));
  }

  /**
   * 点が多角形内部にあるかをチェック (レイキャスティング法)
   * @param {Coordinate} point - チェックする点
   * @param {Coordinate[] | Vertex[]} polygonVertices - 多角形の頂点配列 (順序付き)
   * @param {boolean} [includeBoundary=false] - 境界線上の点を内部とみなすか
   * @returns {boolean} 点が多角形内部にあればtrue
   */
  isPointInPolygon(point, polygonVertices, includeBoundary = false) {
    if (!polygonVertices || polygonVertices.length < 3) return false;

    let inside = false;
    const n = polygonVertices.length;
    const toleranceSq = 1e-9; // 境界判定用の許容誤差

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pi = polygonVertices[i];
      const pj = polygonVertices[j];

      if (!pi || !pj) continue; // 頂点データチェック

      // 境界線上の判定 (オプション)
      if (includeBoundary && this.distancePointSegmentSq(point, pi, pj) < toleranceSq) {
        return true;
      }

      // レイキャスティング法の交差判定
      const intersect = ((pi.y > point.y) !== (pj.y > point.y)) &&
                        (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x);

      if (intersect) {
          // 水平線や頂点通過のケースを扱う (より厳密な実装が必要な場合あり)
          // ここでは簡易的な実装
          inside = !inside;
      }
    }

    return inside;
  }

  /**
   * 多角形と多角形が重なるかどうかをチェック (使用停止: doRingsIntersect に置き換え)
   * @param {Coordinate[] | Vertex[]} polygon1Vertices - 多角形1の頂点配列
   * @param {Coordinate[] | Vertex[]} polygon2Vertices - 多角形2の頂点配列
   * @returns {boolean} 多角形が重なればtrue (交差または包含)
   * @deprecated Use doRingsIntersect instead for ring validation logic.
   */
  doPolygonsOverlap(polygon1Vertices, polygon2Vertices) {
    console.warn("doPolygonsOverlap is deprecated. Use doRingsIntersect for ring validation.");
    // このメソッドはリング検証では使わない
    return false;
  }

  /**
   * 点をエッジに投影する（滑り機能のため）
   * @param {Coordinate} point - 投影する点
   * @param {Coordinate} edgeStart - エッジの始点
   * @param {Coordinate} edgeEnd - エッジの終点
   * @returns {Coordinate} エッジ上の最近接点
   */
  projectPointToEdge(point, edgeStart, edgeEnd) {
    const edgeVector = {
      x: edgeEnd.x - edgeStart.x,
      y: edgeEnd.y - edgeStart.y
    };

    const pointVector = {
      x: point.x - edgeStart.x,
      y: point.y - edgeStart.y
    };

    // エッジベクトルへの射影
    const edgeLengthSq = edgeVector.x * edgeVector.x + edgeVector.y * edgeVector.y;

    // エッジの長さがゼロの場合、始点を返す
    if (edgeLengthSq < 1e-9) return new Coordinate(edgeStart.x, edgeStart.y);

    const dotProduct =
      pointVector.x * edgeVector.x + pointVector.y * edgeVector.y;

    // 射影パラメータtを計算し、[0, 1]の範囲にクランプする
    const projectionRatio = Math.max(0, Math.min(1, dotProduct / edgeLengthSq));

    // 投影点の座標を計算
    return new Coordinate(
      edgeStart.x + projectionRatio * edgeVector.x,
      edgeStart.y + projectionRatio * edgeVector.y
    );
  }

  /**
   * 点と線分間の最短距離の二乗を計算
   * @param {Coordinate} p - 点
   * @param {Coordinate} a - 線分の始点
   * @param {Coordinate} b - 線分の終点
   * @returns {number} 最短距離の二乗
   */
  distancePointSegmentSq(p, a, b) {
    const l2 = this.calculateDistanceSq(a.x, a.y, b.x, b.y);
    // 線分の長さがゼロの場合、点aとの距離を返す
    if (l2 < 1e-9) return this.calculateDistanceSq(p.x, p.y, a.x, a.y);

    // 点pから線分abへの射影パラメータtを計算
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    // tを[0, 1]の範囲にクランプする
    t = Math.max(0, Math.min(1, t));

    // 線分上の最近接点 (projection) を計算
    const projectionX = a.x + t * (b.x - a.x);
    const projectionY = a.y + t * (b.y - a.y);

    // 点pと最近接点との距離の二乗を返す
    return this.calculateDistanceSq(p.x, p.y, projectionX, projectionY);
  }

  /**
   * 点がポリゴンの境界線上に（または非常に近くに）あるかチェック
   * @param {Coordinate} point - チェックする点
   * @param {Coordinate[] | Vertex[]} polygonVertices - ポリゴンの頂点配列（順序付き）
   * @param {number} toleranceSq - 許容誤差（距離の二乗）
   * @returns {boolean} 境界線上に近ければtrue
   */
  isPointOnPolygonBoundary(point, polygonVertices, toleranceSq) {
    if (!polygonVertices || polygonVertices.length < 2) return false; // 線分がなければ境界もない

    // ポリゴンを閉じるために最初の頂点を最後に追加
    const closedVertices = [...polygonVertices, polygonVertices[0]];

    for (let i = 0; i < closedVertices.length - 1; i++) {
        const a = closedVertices[i];
        const b = closedVertices[i + 1];
        // 頂点データが不正な場合はスキップ
        if (!a || typeof a.x !== 'number' || typeof a.y !== 'number' ||
            !b || typeof b.x !== 'number' || typeof b.y !== 'number') {
            continue;
        }
        const distSq = this.distancePointSegmentSq(point, a, b);
        if (distSq < toleranceSq) {
            return true;
        }
    }
    return false;
  }

    /**
     * ポリゴン（単一リング）が自己交差しているかチェック
     * @param {Coordinate[] | Vertex[]} vertices - ポリゴンの頂点配列
     * @returns {boolean} 自己交差していればtrue
     */
    isPolygonSelfIntersecting(vertices) {
        if (!vertices || vertices.length < 4) {
            return false; // 3点以下では自己交差しない
        }

        const n = vertices.length;
        for (let i = 0; i < n; i++) {
            const p1 = vertices[i];
            const p2 = vertices[(i + 1) % n]; // 次の頂点（最後は最初に戻る）
            if (!p1 || !p2) continue; // 不正な頂点はスキップ

            // 隣接しない他の線分と交差するかチェック
            for (let j = (i + 2) % n; j !== i && j !== ((i + n - 1) % n) ; j = (j + 1) % n) { // 修正: 隣接セグメントを除外
                const q1 = vertices[j];
                const q2 = vertices[(j + 1) % n];
                if (!q1 || !q2) continue; // 不正な頂点はスキップ

                // 厳密な交差（端点を除く）をチェック
                if (this.doLineSegmentsIntersectProperly(p1, p2, q1, q2)) {
                    console.warn("Self-intersection detected between segment", i, "and", j);
                    return true;
                }
            }
        }
        return false;
    }

  // --- リング検証用 新メソッド ---

  /**
   * 内側のリングが外側のリング内に完全に含まれているかチェック (境界接触許容)
   * @param {Coordinate[] | Vertex[]} innerRingVertices - 内側リングの頂点配列
   * @param {Coordinate[] | Vertex[]} outerRingVertices - 外側リングの頂点配列
   * @returns {boolean} 完全に含まれていれば true
   */
  isRingCompletelyInsideRing(innerRingVertices, outerRingVertices) {
    if (!innerRingVertices || innerRingVertices.length < 3 || !outerRingVertices || outerRingVertices.length < 3) {
      return false;
    }
    // 1. バウンディングボックスチェック (高速除外)
    const innerBox = this.getBoundingBox(innerRingVertices);
    const outerBox = this.getBoundingBox(outerRingVertices);
    if (!innerBox || !outerBox ||
        innerBox.minX < outerBox.minX || innerBox.minY < outerBox.minY ||
        innerBox.maxX > outerBox.maxX || innerBox.maxY > outerBox.maxY) {
        // ボックスが完全には含まれていない場合、内部にある可能性は低いがゼロではない
        // return false; // ここで除外するとエッジケースで間違う可能性
    }

    // 2. 内側リングの各頂点が外側リングの内側または境界線上にあるかチェック
    const toleranceSq = 1e-9; // 境界判定の許容誤差
    for (const innerVertex of innerRingVertices) {
        if (!innerVertex) continue;
        // isPointInPolygon の includeBoundary=true を使う
        if (!this.isPointInPolygon(innerVertex, outerRingVertices, true)) {
            // 1つでも外側の頂点があれば false
            return false;
        }
    }

    // 3. リング同士が交差していないかチェック (境界接触は許容する)
    //    (doRingsIntersect は境界接触を許容しないので、そのままは使えない)
    //    ここでは簡易的に、頂点が全て内部にあればOKとする。
    //    より厳密には、エッジが外側リングの外部に出ていないかのチェックが必要。
    //    TODO: 必要であれば、より厳密な交差チェック（境界接触許容）を実装する

    return true; // すべての頂点が内側または境界上にあり、交差がない（簡易判定）
  }

  /**
   * 2つのリング（閉じたポリゴン）が交差するかチェック (境界接触は交差とみなさない)
   * @param {Coordinate[] | Vertex[]} ring1Vertices - リング1の頂点配列
   * @param {Coordinate[] | Vertex[]} ring2Vertices - リング2の頂点配列
   * @returns {boolean} 交差していれば true
   */
  doRingsIntersect(ring1Vertices, ring2Vertices) {
    if (!ring1Vertices || ring1Vertices.length < 3 || !ring2Vertices || ring2Vertices.length < 3) {
      return false;
    }

    // 1. バウンディングボックスチェック (高速除外)
    const box1 = this.getBoundingBox(ring1Vertices);
    const box2 = this.getBoundingBox(ring2Vertices);
    if (!box1 || !box2 || !this.boxesIntersect(box1, box2)) {
      return false; // ボックスが交差しなければリングも交差しない
    }

    // 2. エッジ同士の厳密な交差（端点を除く）をチェック
    const n1 = ring1Vertices.length;
    const n2 = ring2Vertices.length;
    for (let i = 0; i < n1; i++) {
        const p1 = ring1Vertices[i];
        const p2 = ring1Vertices[(i + 1) % n1];
        if (!p1 || !p2) continue;
        for (let j = 0; j < n2; j++) {
            const q1 = ring2Vertices[j];
            const q2 = ring2Vertices[(j + 1) % n2];
            if (!q1 || !q2) continue;
            // 厳密な交差判定
            if (this.doLineSegmentsIntersectProperly(p1, p2, q1, q2)) {
                return true;
            }
        }
    }

    // 3. 一方が他方に完全に含まれているケースは「交差」ではないとする
    //    (isRingCompletelyInsideRing のような包含判定とは目的が異なる)
    //    自己交差チェックは isPolygonSelfIntersecting で別途行う前提

    return false; // 厳密な交差が見つからなければ false
  }

  /**
   * 頂点配列からバウンディングボックスを計算
   * @param {Coordinate[] | Vertex[]} vertices - 頂点配列
   * @returns {{minX: number, minY: number, maxX: number, maxY: number} | null} バウンディングボックス、または無効な場合はnull
   */
  getBoundingBox(vertices) {
    if (!vertices || vertices.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let validVertexFound = false;

    for (const v of vertices) {
      if (v && typeof v.x === 'number' && typeof v.y === 'number') {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
        validVertexFound = true;
      }
    }

    return validVertexFound ? { minX, minY, maxX, maxY } : null;
  }

  /**
   * 2つのバウンディングボックスが交差するかチェック
   * @param {{minX: number, minY: number, maxX: number, maxY: number}} box1
   * @param {{minX: number, minY: number, maxX: number, maxY: number}} box2
   * @returns {boolean} 交差すれば true
   */
  boxesIntersect(box1, box2) {
    if (!box1 || !box2) return false;
    return box1.minX <= box2.maxX &&
           box1.maxX >= box2.minX &&
           box1.minY <= box2.maxY &&
           box1.maxY >= box2.minY;
  }

   /**
    * 点がポリゴンのどの部分にあるか判定するヘルパー (リングベース移行後用 - 未実装)
    * @param {object} point - ワールド座標 {x, y}
    * @param {Ring[]} rings - ポリゴンを構成するリングの配列
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    */
   locatePointInPolygon(point, rings, verticesMap) {
       // TODO: 高性能AIの提案に基づいて実装する (フェーズ5)
       console.warn("locatePointInPolygon is not implemented yet.");
       // 暫定的な戻り値
       return { type: 'outside', ringId: null, nestingLevel: 0 };
   }

}
