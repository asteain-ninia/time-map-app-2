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
          // ★ リングベースで頂点IDを収集
          if (f.rings) {
              f.rings.forEach(ring => ring.vertexIds.forEach(id => visibleVertexIds.add(id)));
          }
          // 古い形式のフォールバックは削除
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
   * クリックされたワールド座標に最も近い地物を探す
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @returns {Feature | null} 最も近い地物オブジェクト、またはnull
   */
  findClosestFeature(worldPoint) {
      const features = this._viewModel.getFeatures();
      const world = this._viewModel.getWorld();
      if (!features || features.length === 0 || !world || !world.vertices) {
          return null;
      }

      let closestFeature = null;
      let minDistanceSq = this._getClickToleranceSq(); // 動的に取得
      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      const getVerticesByIds = (ids) => ids?.map(id => verticesMap.get(id)).filter(v => v && typeof v.x === 'number' && typeof v.y === 'number') || [];

      for (const feature of features) {
           if (!feature || typeof feature !== 'object') continue;

          let distanceSq = Infinity;

          if (feature instanceof DomainPoint) {
               const featureVertices = getVerticesByIds(feature.vertexIds);
               if (featureVertices?.length === 1) {
                   distanceSq = this._geometryService.calculateDistanceSq(
                       worldPoint.x, worldPoint.y, featureVertices[0].x, featureVertices[0].y
                   );
               }
          } else if (feature instanceof DomainLine) {
               const featureVertices = getVerticesByIds(feature.vertexIds);
               if (featureVertices?.length >= 2) {
                   for (let i = 0; i < featureVertices.length - 1; i++) {
                       if (featureVertices[i] && featureVertices[i+1]) {
                         const segmentDistSq = this._geometryService.distancePointSegmentSq(
                             worldPoint, featureVertices[i], featureVertices[i + 1]
                         );
                         distanceSq = Math.min(distanceSq, segmentDistSq);
                       }
                   }
               }
          } else if (feature instanceof DomainPolygon) {
              // ★ リングベースで距離計算
              distanceSq = this._calculateDistanceToPolygon(worldPoint, feature, verticesMap);
          }

          if (distanceSq < minDistanceSq) {
              minDistanceSq = distanceSq;
              closestFeature = feature;
          }
      }
      return closestFeature;
  }

  /**
   * 指定されたワールド座標にあるオブジェクト（頂点優先）を選択する
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @param {boolean} [addToSelection=false] - 選択に追加するかどうか
   */
  selectObjectAt(worldPoint, addToSelection = false) {
      const clickedVertex = this.findClosestVertex(worldPoint);
      if (clickedVertex) {
            this._viewModel.selectVertex(clickedVertex.id, addToSelection);
      } else {
           const clickedFeature = this.findClosestFeature(worldPoint);
           if (clickedFeature) {
                // 地物選択時は常に単一選択 (addToSelection は無視)
                this._viewModel.selectFeature(clickedFeature.id);
           } else if (!addToSelection) {
                // 何もヒットせず、追加選択でもない場合はクリア
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

        // ★ すべてのリングの境界をチェック
        for (const ring of polygon.rings) {
            if (ring.vertexIds && ring.vertexIds.length >= 2) {
                const ringVertices = getVertices(ring.vertexIds);
                // GeometryServiceの isPointOnPolygonBoundary を使う
                if (this._geometryService.isPointOnPolygonBoundary(point, ringVertices, toleranceSq)) {
                    return true;
                }
            }
        }
        // 古い形式へのフォールバックは削除
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
        // ★ リングベースの位置判定ヘルパーを使用
        const location = this.locatePointInPolygon(point, polygon, verticesMap);
        // 'inside_outer' (外周リングの内側かつ穴の外側) の場合に true
        return location.type === 'inside_outer';
        // 古い形式へのフォールバックは削除
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

       // ★ 点がポリゴン内部 (穴を除く) かまずチェック
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

        // ★ すべてのリングの境界までの最短距離を計算
        polygon.rings.forEach(ring => {
            minDistanceSq = Math.min(minDistanceSq, calculateMinDistToRing(ring.vertexIds));
        });

        // 古い形式へのフォールバックは削除
       return minDistanceSq;
   }

   /**
    * 点がポリゴンのどの部分にあるか判定するヘルパー (リングベース実装)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン (リング構造を持つ前提)
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    *   - type: 点の位置タイプ
    *   - ringId: 点が含まれる最も内側の外周リングID (inside_outerの場合)、または点が内部にある穴リングID (inside_holeの場合)
    *   - nestingLevel: ネストレベル (outside: 0, 最外周内部: 1, 最初の穴内部: 2, 穴の中の飛び地内部: 3, ...)
    */
    locatePointInPolygon(point, polygon, verticesMap) {
        if (!polygon || !Array.isArray(polygon.rings)) {
            return { type: 'outside', ringId: null, nestingLevel: 0 };
        }
        const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

        let containingOuterRingId = null;
        let innermostContainingOuterRingId = null;
        let innermostContainingHoleRingId = null;
        let maxNestingLevel = 0;

        // リングをIDでマップ化
        const ringsMap = new Map(polygon.rings.map(r => [r.id, r]));

        // 再帰的にリングを探索する関数
        const checkRing = (ringId, currentLevel) => {
            const ring = ringsMap.get(ringId);
            if (!ring) return;

            const vertices = getVertices(ring.vertexIds);
            if (vertices.length < 3) return;

            // 点が現在のリングの内側か？
            if (this._geometryService.isPointInPolygon(point, vertices)) {
                if (ring.isOuter) { // 外周リングの内側
                    // より深いネストレベルの外周リングを見つけた
                    if (currentLevel > maxNestingLevel) {
                        maxNestingLevel = currentLevel;
                        innermostContainingOuterRingId = ring.id;
                        innermostContainingHoleRingId = null; // 内側の穴は見つかっていない
                    }
                    containingOuterRingId = ring.id; // 現在包含されている外周リングを記録

                    // この外周リングの子リング（穴）を探索
                    polygon.rings.forEach(childRing => {
                        if (!childRing.isOuter && childRing.parentId === ring.id) {
                            checkRing(childRing.id, currentLevel + 1);
                        }
                    });
                } else { // 穴リングの内側
                    // より深いネストレベルの穴リングを見つけた
                    if (currentLevel > maxNestingLevel) {
                        maxNestingLevel = currentLevel;
                        innermostContainingHoleRingId = ring.id;
                        // 外周リングIDは親を辿るか、包含チェックで見つける必要があるが、
                        // ここでは直前に記録した containingOuterRingId を使う（単純化）
                        innermostContainingOuterRingId = containingOuterRingId;
                    }

                    // この穴リングの子リング（飛び地）を探索
                    polygon.rings.forEach(childRing => {
                        if (childRing.isOuter && childRing.parentId === ring.id) {
                            checkRing(childRing.id, currentLevel + 1);
                        }
                    });
                }
            }
            // 点がリングの外側なら何もしない
        };

        // 最上位の外周リングから探索開始
        polygon.rings.forEach(ring => {
            if (ring.isOuter && ring.parentId === null) {
                checkRing(ring.id, 1); // 最上位はレベル1
            }
        });

        // 結果の判定
        if (maxNestingLevel === 0) {
            return { type: 'outside', ringId: null, nestingLevel: 0 };
        } else if (innermostContainingHoleRingId !== null) {
            // 最も深いレベルが穴の中だった場合
            return { type: 'inside_hole', ringId: innermostContainingHoleRingId, nestingLevel: maxNestingLevel };
        } else {
            // 最も深いレベルが外周リングの中だった場合
            return { type: 'inside_outer', ringId: innermostContainingOuterRingId, nestingLevel: maxNestingLevel };
        }
    }

   /**
    * 点がポリゴンのどの部分にあるか判定するヘルパー (古い形式用、削除)
    * @deprecated Use locatePointInPolygon instead.
    */
   // _getPointLocationInPolygon_Old(point, polygon, verticesMap) { ... } // ★ 削除

   /**
    * 点がポリゴンのどの部分にあるか判定する (公開メソッド、内部でリングベース判定を呼ぶ)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    */
   getPointLocationInPolygon(point, polygon, verticesMap) {
       // locatePointInPolygon がリングベースとフォールバックを内部で処理する想定だったが、
       // フォールバックは不要になったため、直接 locatePointInPolygon を呼ぶ
       return this.locatePointInPolygon(point, polygon, verticesMap);
   }

}