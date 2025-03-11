import { Coordinate } from '../value-objects/Coordinate';

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
   * @param {Vertex[]} vertices - 頂点の配列
   * @returns {number} 多角形の面積
   */
  calculatePolygonArea(vertices) {
    if (vertices.length < 3) return 0;
    
    let area = 0;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
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
    if (vertices.length < 3) return 0;
    
    // 基本的な面積を計算
    const areaInPixels = this.calculatePolygonArea(vertices);
    
    // 緯度1度あたりの距離（km）
    const latDegreeLength = equatorLength / 360;
    
    // 面積の計算（緯度による経度の長さの変化を考慮）
    // 簡易計算として平均緯度を使用
    let avgLat = 0;
    for (const vertex of vertices) {
      avgLat += vertex.y;
    }
    avgLat /= vertices.length;
    
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
    if (denominator === 0) return false; // 平行
    
    const ua = ((dx2 * (p1.y - q1.y)) - (dy2 * (p1.x - q1.x))) / denominator;
    const ub = ((dx1 * (p1.y - q1.y)) - (dy1 * (p1.x - q1.x))) / denominator;
    
    return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1);
  }

  /**
   * 点が多角形内部にあるかをチェック
   * @param {Coordinate} point - チェックする点
   * @param {Coordinate[]} polygonVertices - 多角形の頂点配列
   * @returns {boolean} 点が多角形内部にあればtrue
   */
  isPointInPolygon(point, polygonVertices) {
    if (polygonVertices.length < 3) return false;
    
    let inside = false;
    for (let i = 0, j = polygonVertices.length - 1; i < polygonVertices.length; j = i++) {
      const xi = polygonVertices[i].x;
      const yi = polygonVertices[i].y;
      const xj = polygonVertices[j].x;
      const yj = polygonVertices[j].y;
      
      const intersect = ((yi > point.y) !== (yj > point.y)) && 
                        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      
      if (intersect) inside = !inside;
    }
    
    return inside;
  }

  /**
   * 多角形と多角形が重なるかどうかをチェック
   * @param {Coordinate[]} polygon1Vertices - 多角形1の頂点配列
   * @param {Coordinate[]} polygon2Vertices - 多角形2の頂点配列
   * @returns {boolean} 多角形が重なればtrue
   */
  doPolygonsOverlap(polygon1Vertices, polygon2Vertices) {
    // 1. エッジの交差をチェック
    for (let i = 0, j = polygon1Vertices.length - 1; i < polygon1Vertices.length; j = i++) {
      const p1 = polygon1Vertices[j];
      const p2 = polygon1Vertices[i];
      
      for (let k = 0, l = polygon2Vertices.length - 1; k < polygon2Vertices.length; l = k++) {
        const q1 = polygon2Vertices[l];
        const q2 = polygon2Vertices[k];
        
        if (this.doLineSegmentsIntersect(p1, p2, q1, q2)) {
          return true;
        }
      }
    }
    
    // 2. 一方が他方に完全に含まれているかチェック
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
    const edgeLength = Math.sqrt(
      edgeVector.x * edgeVector.x + edgeVector.y * edgeVector.y
    );
    
    if (edgeLength === 0) return new Coordinate(edgeStart.x, edgeStart.y);
    
    const dotProduct = 
      pointVector.x * edgeVector.x + pointVector.y * edgeVector.y;
    
    const projectionRatio = Math.max(0, Math.min(1, dotProduct / (edgeLength * edgeLength)));
    
    // 投影点の座標を計算
    return new Coordinate(
      edgeStart.x + projectionRatio * edgeVector.x,
      edgeStart.y + projectionRatio * edgeVector.y
    );
  }
}