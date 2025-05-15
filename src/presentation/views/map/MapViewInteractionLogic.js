// src\presentation\views\map\MapViewInteractionLogic.js

import { Point as DomainPoint } from '../../../domain/entities/Point.js';
import { Line as DomainLine } from '../../../domain/entities/Line.js';
import { Polygon as DomainPolygon } from '../../../domain/entities/Polygon.js';
import { Vertex } from '../../../domain/entities/Vertex.js';

/**
 * MapView におけるインタラクションロジック（近接判定、選択など）を担当
 */
export class MapViewInteractionLogic {
  /**
   * @param {MapViewModel} viewModel
   * @param {EditingViewModel} editingViewModel
   * @param {GeometryService} geometryService
   * @param {Function} getClickToleranceSq - クリック許容範囲(二乗)を返す関数
   */
  constructor(viewModel, editingViewModel, geometryService, getClickToleranceSq) {
    this._viewModel = viewModel;
    this._editingViewModel = editingViewModel;
    this._geometryService = geometryService;
    this._getClickToleranceSq = getClickToleranceSq; // 関数として受け取る
  }

  /**
   * クリックされたワールド座標に最も近い**表示中の**頂点を探す
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @returns {Vertex | null} 最も近い頂点オブジェクト、またはnull
   */
  findClosestVertex(worldPoint) {
    const world = this._viewModel.getWorld();
    const features = this._viewModel.getFeatures(); // 表示中の地物を取得
    if (!world || !world.vertices || features.length === 0) {
      return null;
    }

    const visibleVertexIds = new Set();
    features.forEach(f => {
      if (f instanceof DomainPoint || f instanceof DomainLine) {
          if (f.vertexIds) f.vertexIds.forEach(id => visibleVertexIds.add(id));
      } else if (f instanceof DomainPolygon) {
          // リングベースで頂点IDを収集
          if (f.rings) {
              f.rings.forEach(ring => ring.vertexIds.forEach(id => visibleVertexIds.add(id)));
          }
      }
    });

    if (visibleVertexIds.size === 0) return null;

    const verticesMap = new Map(world.vertices.map(v => [v.id, {id: v.id, x: v.x, y: v.y}]));
    let closestVertexData = null;
    let minDistanceSq = this._getClickToleranceSq(); // 動的に取得

    for (const vertexId of visibleVertexIds) {
      const vertexData = verticesMap.get(vertexId);
      if (vertexData && typeof vertexData.x === 'number' && typeof vertexData.y === 'number') {
        const distanceSq = this._geometryService.calculateDistanceSq(
            worldPoint.x, worldPoint.y, vertexData.x, vertexData.y
        );
        if (distanceSq < minDistanceSq) {
            minDistanceSq = distanceSq;
            closestVertexData = vertexData;
        }
      }
    }
    // Vertex インスタンスを返す
    return closestVertexData ? new Vertex(closestVertexData.id, closestVertexData.x, closestVertexData.y) : null;
  }

  /**
   * クリックされたワールド座標に最も近い地物を探す (包含関係と境界線上の近さを考慮)
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @returns {Feature | null} 最も適切な地物オブジェクト、またはnull
   */
  findClosestFeature(worldPoint) {
      const features = this._viewModel.getFeatures();
      const world = this._viewModel.getWorld();
      if (!features || features.length === 0 || !world || !world.vertices) {
          return null;
      }

      // 候補リストを分ける
      let candidatesInside = []; // クリック位置を内部に含むポリゴン候補 ({ feature, nestingLevel })
      let candidatesNearby = []; // 境界線に近い地物候補 ({ feature, distanceSq })

      const clickToleranceSq = this._getClickToleranceSq(); // クリック許容範囲(二乗)

      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      const getVerticesByIds = (ids) => ids?.map(id => verticesMap.get(id)).filter(v => v && typeof v.x === 'number' && typeof v.y === 'number') || [];

      for (const feature of features) {
           if (!feature || typeof feature !== 'object') continue;

           if (feature instanceof DomainPoint) {
               const featureVertices = getVerticesByIds(feature.vertexIds);
               if (featureVertices?.length === 1) {
                   const distanceSq = this._geometryService.calculateDistanceSq(
                       worldPoint.x, worldPoint.y, featureVertices[0].x, featureVertices[0].y
                   );
                   if (distanceSq < clickToleranceSq) {
                       candidatesNearby.push({ feature, distanceSq });
                   }
               }
          } else if (feature instanceof DomainLine) {
               const featureVertices = getVerticesByIds(feature.vertexIds);
               if (featureVertices?.length >= 2) {
                    let minSegmentDistSq = Infinity;
                    for (let i = 0; i < featureVertices.length - 1; i++) {
                        if (featureVertices[i] && featureVertices[i+1]) {
                            const segmentDistSq = this._geometryService.distancePointSegmentSq(
                                worldPoint, featureVertices[i], featureVertices[i + 1]
                            );
                            minSegmentDistSq = Math.min(minSegmentDistSq, segmentDistSq);
                        }
                    }
                   if (minSegmentDistSq < clickToleranceSq) {
                       candidatesNearby.push({ feature, distanceSq: minSegmentDistSq });
                   }
               }
          } else if (feature instanceof DomainPolygon) {
              // ポリゴンの包含関係と境界近接をチェック
              const locationInfo = this.locatePointInPolygon(worldPoint, feature, verticesMap);
              const isNearBoundary = this.isPointNearPolygonBoundary(worldPoint, feature, verticesMap);

              // locatePointInPolygon の結果に基づいて候補を分類
              if (locationInfo.type === 'inside_outer') {
                  // ポリゴン内部 (穴を除く) にある場合
                  candidatesInside.push({ feature, nestingLevel: locationInfo.nestingLevel });
              } else if (locationInfo.type !== 'inside_hole' && isNearBoundary) {
                  // 穴内部でなく、境界線に近い場合 (typeがoutsideで境界に近い場合など)
                  const distanceSq = this._calculateDistanceToPolygon(worldPoint, feature, verticesMap);
                   if (distanceSq < clickToleranceSq) { // 念のため再チェック
                       candidatesNearby.push({ feature, distanceSq });
                   }
              }
              // type === 'inside_hole' の場合は、どの候補リストにも追加しない
          }
      }

      // 候補の優先順位付け
      // 1. 内部候補があれば、最もネストレベルが高いものを優先
      if (candidatesInside.length > 0) {
          candidatesInside.sort((a, b) => b.nestingLevel - a.nestingLevel); // ネストレベル降順でソート
          return candidatesInside[0].feature;
      }

      // 2. 内部候補がなく、境界線に近い候補があれば、最も距離が近いものを優先
      if (candidatesNearby.length > 0) {
          candidatesNearby.sort((a, b) => a.distanceSq - b.distanceSq); // 距離昇順でソート
          return candidatesNearby[0].feature;
      }

      // 3. どちらの候補もなければ null を返す
      return null;
  }


  /**
   * 指定されたワールド座標にあるオブジェクト（頂点優先）を選択する
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @param {boolean} [addToSelection=false] - 選択に追加するかどうか
   */
  selectObjectAt(worldPoint, addToSelection = false) {
      const clickedVertex = this.findClosestVertex(worldPoint);
      if (clickedVertex) {
            // 頂点を選択 (複数選択対応)
            this._viewModel.selectVertex(clickedVertex.id, addToSelection);
      } else {
           // 頂点が見つからない場合、地物を検索 (包含関係・ネスト考慮)
           const clickedFeature = this.findClosestFeature(worldPoint);
           if (clickedFeature) {
                // 地物選択時は常に単一選択 (addToSelection は無視)
                this._viewModel.selectFeature(clickedFeature.id);
           } else if (!addToSelection) {
                // 何もヒットせず、追加選択でもない場合は選択解除
                this._viewModel.clearSelection();
           }
           // 追加選択モードで何もない場所をクリックした場合は何もしない
      }
  }

  /**
   * ビューモードでのクリック処理
   * @param {object} worldPoint - ワールド座標 {x, y}
   */
  handleClickInViewMode(worldPoint) {
    console.log("Click at World (view mode):", worldPoint.x, worldPoint.y);
    // findClosestFeature は包含関係を考慮するようになった
    const clickedFeature = this.findClosestFeature(worldPoint);
    if (clickedFeature) {
        this._viewModel.selectFeature(clickedFeature.id);
    } else {
        this._viewModel.clearSelection();
    }
  }

  /**
   * 点がポリゴンの境界線近くにあるか判定 (リングベース対応)
   * @param {object} point - ワールド座標 {x, y}
   * @param {DomainPolygon} polygon - 対象ポリゴン
   * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
   * @returns {boolean}
   */
  isPointNearPolygonBoundary(point, polygon, verticesMap) {
        if (!polygon || !Array.isArray(polygon.rings)) return false;

        const toleranceSq = this._getClickToleranceSq(); // 動的に取得
        const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

        // すべてのリングの境界をチェック
        for (const ring of polygon.rings) {
            if (ring.vertexIds && ring.vertexIds.length >= 2) {
                const ringVertices = getVertices(ring.vertexIds);
                // GeometryServiceの isPointOnPolygonBoundary を使う
                if (this._geometryService.isPointOnPolygonBoundary(point, ringVertices, toleranceSq)) {
                    return true;
                }
            }
        }
        return false;
  }

  /**
   * 点がポリゴン内部（穴を除く）にあるか判定 (リングベース対応)
   * @param {object} point - ワールド座標 {x, y}
   * @param {DomainPolygon} polygon - 対象ポリゴン
   * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
   * @returns {boolean}
   */
  isPointInsidePolygon(point, polygon, verticesMap) {
        if (!polygon || !Array.isArray(polygon.rings)) return false;
        // リングベースの位置判定ヘルパーを使用
        const location = this.locatePointInPolygon(point, polygon, verticesMap);
        // 'inside_outer' (外周リングの内側かつ穴の外側) の場合に true
        return location.type === 'inside_outer';
  }

   /**
    * 点からポリゴンまでの最短距離の二乗を計算 (リングベース対応)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {number} 最短距離の二乗
    */
   _calculateDistanceToPolygon(point, polygon, verticesMap) {
       if (!polygon || !Array.isArray(polygon.rings)) return Infinity;

       let minDistanceSq = Infinity;
       const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

       // 点がポリゴン内部 (穴を除く) かまずチェック
       if (this.isPointInsidePolygon(point, polygon, verticesMap)) {
           return 0; // 内部なら距離0
       }

       // 内部でない場合、すべてのリングの境界までの最短距離を計算
       const calculateMinDistToRing = (vertexIds) => {
           if (!vertexIds || vertexIds.length < 2) return Infinity;
           const vertices = getVertices(vertexIds);
           if (vertices.length < 2) return Infinity;
           const closedVertices = [...vertices, vertices[0]]; // 閉じたパスにする
           let minDistSq = Infinity;
           for (let i = 0; i < closedVertices.length - 1; i++) {
               const a = closedVertices[i];
               const b = closedVertices[i + 1];
               if (a && b) {
                   minDistSq = Math.min(minDistSq, this._geometryService.distancePointSegmentSq(point, a, b));
               }
           }
           return minDistSq;
       };

        // すべてのリングの境界までの最短距離を計算
        polygon.rings.forEach(ring => {
            minDistanceSq = Math.min(minDistanceSq, calculateMinDistToRing(ring.vertexIds));
        });

       return minDistanceSq;
   }

   /**
    * 点がポリゴンのどの部分にあるか判定するヘルパー (リングベース実装 - ネストレベル偶奇判定)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン (リング構造を持つ前提)
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    */
   locatePointInPolygon(point, polygon, verticesMap) {
     if (!polygon || !Array.isArray(polygon.rings)) {
       return { type: 'outside', ringId: null, nestingLevel: 0 };
     }

     const getVertices = (ids) =>
       ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

     // 境界線上なら outside
     if (this.isPointNearPolygonBoundary(point, polygon, verticesMap)) {
       return { type: 'outside', ringId: null, nestingLevel: 0 };
     }

     // ❶ 何本のリングが point を包含しているかを偶奇で判定
     const insideRings = [];
     for (const ring of polygon.rings) {
       const verts = getVertices(ring.vertexIds);
       // GeometryService の isPointInPolygon を使用 (includeBoundary=false)
       if (verts.length >= 3 &&
           this._geometryService.isPointInPolygon(point, verts, false)) {
         insideRings.push(ring);
       }
     }

     const nestingLevel = insideRings.length;
     if (nestingLevel === 0) {
       return { type: 'outside', ringId: null, nestingLevel: 0 };
     }

     //    最も内側のリングを取得 (包含リストの最後)
     //    ただし、このリングIDがネストレベルに対して適切かは保証されないため注意
     //    (例: 複数の独立した飛び地に含まれる場合など。本来はより詳細な分析が必要)
     //    今回は簡易的に最後のリングIDを使用する
     const innermostRing = insideRings[nestingLevel - 1];
     // ネストレベルの偶奇で判定
     const isInsideOuter = nestingLevel % 2 === 1; // 奇数: 塗りつぶし領域

     return {
       type: isInsideOuter ? 'inside_outer' : 'inside_hole',
       ringId: innermostRing.id, // 最も内側のリングIDを返す
       nestingLevel
     };
   }

   /**
    * 点がポリゴンのどの部分にあるか判定する (公開メソッド、内部でリングベース判定を呼ぶ)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    */
   getPointLocationInPolygon(point, polygon, verticesMap) {
       return this.locatePointInPolygon(point, polygon, verticesMap);
   }

}