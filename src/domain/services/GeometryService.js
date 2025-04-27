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
   * 度をラジアンに変換
   * @param {number} degrees - 度数
   * @returns {number} ラジアン
   * @private
   */
  _toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  /**
   * 多角形の面積を計算
   * @param {Vertex[] | Coordinate[]} vertices - 頂点の配列
   * @returns {number} 多角形の面積
   */
  calculatePolygonArea(vertices) {
    if (vertices.length < 3) return 0;

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
   * 2つの線分が交差するかどうかをチェック
   * @param {Coordinate} p1 - 線分1の始点
   * @param {Coordinate} p2 - 線分1の終点
   * @param {Coordinate} q1 - 線分2の始点
   * @param {Coordinate} q2 - 線分2の終点
   * @returns {boolean} 線分が交差すればtrue
   */
  doLineSegmentsIntersect(p1, p2, q1, q2) {
    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = q2.x - q1.x;
    const dy2 = q2.y - q1.y;

    const denominator = (dy2 * dx1 - dx2 * dy1);
    if (Math.abs(denominator) < 1e-9) return false; // 平行または同一直線上（許容誤差）

    const ua = ((dx2 * (p1.y - q1.y)) - (dy2 * (p1.x - q1.x))) / denominator;
    const ub = ((dx1 * (p1.y - q1.y)) - (dy1 * (p1.x - q1.x))) / denominator;

    // 線分内部での交差をチェック (端点での接触を除く場合は 0 < ua < 1 and 0 < ub < 1)
    return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1);
  }

  /**
   * 点が多角形内部にあるかをチェック (レイキャスティング法)
   * @param {Coordinate} point - チェックする点
   * @param {Coordinate[] | Vertex[]} polygonVertices - 多角形の頂点配列 (順序付き)
   * @returns {boolean} 点が多角形内部にあればtrue (境界上は内部と判定しない)
   */
  isPointInPolygon(point, polygonVertices) {
    if (!polygonVertices || polygonVertices.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygonVertices.length - 1; i < polygonVertices.length; j = i++) {
      const xi = polygonVertices[i].x;
      const yi = polygonVertices[i].y;
      const xj = polygonVertices[j].x;
      const yj = polygonVertices[j].y;

      // 境界上の判定を除外するため、yi === point.y の場合などをスキップするか、
      // intersection計算を工夫する必要があるが、ここでは標準的な実装とする
      const intersect = ((yi > point.y) !== (yj > point.y)) &&
                        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /**
   * 多角形と多角形が重なるかどうかをチェック
   * @param {Coordinate[] | Vertex[]} polygon1Vertices - 多角形1の頂点配列
   * @param {Coordinate[] | Vertex[]} polygon2Vertices - 多角形2の頂点配列
   * @returns {boolean} 多角形が重なればtrue (交差または包含)
   */
  doPolygonsOverlap(polygon1Vertices, polygon2Vertices) {
    if (!polygon1Vertices || polygon1Vertices.length < 3 || !polygon2Vertices || polygon2Vertices.length < 3) {
        return false;
    }
    // 1. エッジの交差をチェック
    for (let i = 0, j = polygon1Vertices.length - 1; i < polygon1Vertices.length; j = i++) {
      const p1 = polygon1Vertices[j];
      const p2 = polygon1Vertices[i];
      // Check if p1 and p2 are valid
      if (!p1 || !p2) continue;

      for (let k = 0, l = polygon2Vertices.length - 1; k < polygon2Vertices.length; l = k++) {
        const q1 = polygon2Vertices[l];
        const q2 = polygon2Vertices[k];
        // Check if q1 and q2 are valid
        if (!q1 || !q2) continue;

        if (this.doLineSegmentsIntersect(p1, p2, q1, q2)) {
          return true;
        }
      }
    }

    // 2. 一方が他方に完全に含まれているかチェック (いずれかの頂点が内部にあればOK)
    if (this.isPointInPolygon(polygon1Vertices[0], polygon2Vertices) ||
        this.isPointInPolygon(polygon2Vertices[0], polygon1Vertices)) {
      return true;
    }

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
     * ポリゴンが自己交差しているかチェック
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
            for (let j = i + 2; j < n; j++) {
                // 隣接する線分 (i, i+1) と (i+1, i+2) はチェックしない
                // 最後の線分 (n-1, 0) と (0, 1) もチェックしない
                if ((j + 1) % n === i) continue;

                const q1 = vertices[j];
                const q2 = vertices[(j + 1) % n];
                if (!q1 || !q2) continue; // 不正な頂点はスキップ

                if (this.doLineSegmentsIntersect(p1, p2, q1, q2)) {
                     // 端点での接触は許容する場合があるかもしれないが、ここでは交差とみなす
                     // より厳密には、交差点を計算し、それが線分の端点以外かチェックする
                    console.warn("Self-intersection detected between segment", i, "and", j);
                    return true;
                }
            }
        }
        return false;
    }
}
