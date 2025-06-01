// src/presentation/views/map/MapViewInteractionLogic.js

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
   * @param {Function} getWorldWidthFunc - ワールド幅を返す関数
   */
  constructor(viewModel, editingViewModel, geometryService, getClickToleranceSq, getWorldWidthFunc) { // getWorldWidthFunc を追加
    this._viewModel = viewModel;
    this._editingViewModel = editingViewModel;
    this._geometryService = geometryService;
    this._getClickToleranceSq = getClickToleranceSq;
    this._getWorldWidthFunc = getWorldWidthFunc; // 保存
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

    const worldWidth = this._getWorldWidthFunc();
    const offsets = [0, -worldWidth, worldWidth];

    for (const vertexId of visibleVertexIds) {
      const vertexDataOriginal = verticesMap.get(vertexId); // 元の頂点データ
      if (vertexDataOriginal && typeof vertexDataOriginal.x === 'number' && typeof vertexDataOriginal.y === 'number') {
        for (const offsetX of offsets) { // 各オフセットでチェック
          const currentX = vertexDataOriginal.x + offsetX;
          const distanceSq = this._geometryService.calculateDistanceSq(
              worldPoint.x, worldPoint.y, currentX, vertexDataOriginal.y // Yはオフセットなし
          );
          if (distanceSq < minDistanceSq) {
              minDistanceSq = distanceSq;
              closestVertexData = vertexDataOriginal; // 保存するのはオフセットなしの元のデータ
          }
        }
      }
    }
    // Vertex インスタンスを返す
    return closestVertexData ? new Vertex(closestVertexData.id, closestVertexData.x, closestVertexData.y) : null;
  }

  /**
   * クリックされたワールド座標に最も近いエッジ（線分のこと）を探す
   * @param {object} worldPoint - ワールド座標 {x, y}
   * @returns {object | null} 見つかったエッジ情報、またはnull。
   *          情報は { featureId, ringId?, segmentStartVertexId, segmentEndVertexId, projectionPoint }
   */
  findClosestEdge(worldPoint) {
    const features = this._viewModel.getFeatures(); // 表示中の地物のみ
    const world = this._viewModel.getWorld();
    if (!features || features.length === 0 || !world || !world.vertices) {
      return null;
    }

    const verticesMap = new Map(world.vertices.map(v => [v.id, { id: v.id, x: v.x, y: v.y }]));
    let minDistanceSq = this._getClickToleranceSq();
    let closestEdgeInfo = null;

    const worldWidth = this._getWorldWidthFunc();
    const offsets = [0, -worldWidth, worldWidth];

    for (const feature of features) {
      if (feature instanceof DomainLine) {
        if (!feature.vertexIds || feature.vertexIds.length < 2) continue;

        for (let i = 0; i < feature.vertexIds.length - 1; i++) {
          const vStartId = feature.vertexIds[i];
          const vEndId = feature.vertexIds[i + 1];
          const vStartOriginal = verticesMap.get(vStartId);
          const vEndOriginal = verticesMap.get(vEndId);

          if (!vStartOriginal || !vEndOriginal) continue;

          for (const offsetX of offsets) {
            const segmentStartOffset = { x: vStartOriginal.x + offsetX, y: vStartOriginal.y };
            const segmentEndOffset = { x: vEndOriginal.x + offsetX, y: vEndOriginal.y };

            const distSq = this._geometryService.distancePointSegmentSq(worldPoint, segmentStartOffset, segmentEndOffset);

            if (distSq < minDistanceSq) {
              minDistanceSq = distSq;
              let projection = this._geometryService.projectPointToEdge(worldPoint, segmentStartOffset, segmentEndOffset);
              // 投影点をオフセット0の座標系に戻す
              const projectionOriginalX = projection.x - offsetX;
              closestEdgeInfo = {
                featureId: feature.id,
                ringId: null,
                segmentStartVertexId: vStartId,
                segmentEndVertexId: vEndId,
                projectionPoint: { x: projectionOriginalX, y: projection.y }
              };
            }
          }
        }
      } else if (feature instanceof DomainPolygon) {
        if (!feature.rings || feature.rings.length === 0) continue;

        for (const ring of feature.rings) {
          if (!ring.vertexIds || ring.vertexIds.length < 2) continue; // リングは通常3頂点以上だが、線分としては2頂点必要

          for (let i = 0; i < ring.vertexIds.length; i++) {
            const vStartId = ring.vertexIds[i];
            const vEndId = ring.vertexIds[(i + 1) % ring.vertexIds.length]; // リングなので最後は最初に戻る
            const vStartOriginal = verticesMap.get(vStartId);
            const vEndOriginal = verticesMap.get(vEndId);

            if (!vStartOriginal || !vEndOriginal) continue;

            for (const offsetX of offsets) {
              const segmentStartOffset = { x: vStartOriginal.x + offsetX, y: vStartOriginal.y };
              const segmentEndOffset = { x: vEndOriginal.x + offsetX, y: vEndOriginal.y };

              const distSq = this._geometryService.distancePointSegmentSq(worldPoint, segmentStartOffset, segmentEndOffset);

              if (distSq < minDistanceSq) {
                minDistanceSq = distSq;
                let projection = this._geometryService.projectPointToEdge(worldPoint, segmentStartOffset, segmentEndOffset);
                const projectionOriginalX = projection.x - offsetX;
                closestEdgeInfo = {
                  featureId: feature.id,
                  ringId: ring.id,
                  segmentStartVertexId: vStartId,
                  segmentEndVertexId: vEndId,
                  projectionPoint: { x: projectionOriginalX, y: projection.y }
                };
              }
            }
          }
        }
      }
    }
    return closestEdgeInfo;
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
      const worldWidth = this._getWorldWidthFunc();
      const offsets = [0, -worldWidth, worldWidth];

      const verticesMap = new Map(world.vertices.map(v => [v.id, {id:v.id, x:v.x, y:v.y}]));
      const getVerticesByIds = (ids) => ids?.map(id => verticesMap.get(id)).filter(v => v && typeof v.x === 'number' && typeof v.y === 'number') || [];

      for (const feature of features) {
           if (!feature || typeof feature !== 'object') continue;

           if (feature instanceof DomainPoint) {
               const featureVerticesOriginal = getVerticesByIds(feature.vertexIds);
               if (featureVerticesOriginal?.length === 1) {
                   let minDistanceSqOverall = Infinity;
                   for (const offsetX of offsets) {
                       const currentX = featureVerticesOriginal[0].x + offsetX;
                       const distanceSq = this._geometryService.calculateDistanceSq(
                           worldPoint.x, worldPoint.y, currentX, featureVerticesOriginal[0].y
                       );
                       minDistanceSqOverall = Math.min(minDistanceSqOverall, distanceSq);
                   }
                   if (minDistanceSqOverall < clickToleranceSq) {
                       candidatesNearby.push({ feature, distanceSq: minDistanceSqOverall });
                   }
               }
          } else if (feature instanceof DomainLine) {
               const featureVerticesOriginal = getVerticesByIds(feature.vertexIds);
               if (featureVerticesOriginal?.length >= 2) {
                    let minSegmentDistSqOverall = Infinity;
                    for (const offsetX of offsets) {
                        const featureVerticesWithOffset = featureVerticesOriginal.map(v => ({x: v.x + offsetX, y: v.y}));
                        let minSegmentDistSqForOffset = Infinity;
                        for (let i = 0; i < featureVerticesWithOffset.length - 1; i++) {
                             if (featureVerticesWithOffset[i] && featureVerticesWithOffset[i+1]) {
                                const segmentDistSq = this._geometryService.distancePointSegmentSq(
                                    worldPoint, featureVerticesWithOffset[i], featureVerticesWithOffset[i + 1]
                                );
                                minSegmentDistSqForOffset = Math.min(minSegmentDistSqForOffset, segmentDistSq);
                            }
                        }
                       minSegmentDistSqOverall = Math.min(minSegmentDistSqOverall, minSegmentDistSqForOffset);
                    }
                   if (minSegmentDistSqOverall < clickToleranceSq) {
                       candidatesNearby.push({ feature, distanceSq: minSegmentDistSqOverall });
                   }
               }
          } else if (feature instanceof DomainPolygon) {
              // ポリゴンの包含関係と境界近接をチェック
              const locationInfo = this.locatePointInPolygon(worldPoint, feature, verticesMap); // これは既にオフセットを考慮
              const isNearBoundary = this.isPointNearPolygonBoundary(worldPoint, feature, verticesMap); // これもオフセットを考慮

              // locatePointInPolygon の結果に基づいて候補を分類
              if (locationInfo.type === 'inside_outer') {
                  // ポリゴン内部 (穴を除く) にある場合
                  candidatesInside.push({ feature, nestingLevel: locationInfo.nestingLevel });
              } else if (locationInfo.type !== 'inside_hole' && isNearBoundary) {
                  // 穴内部でなく、境界線に近い場合 (typeがoutsideで境界に近い場合など)
                  const distanceSq = this._calculateDistanceToPolygon(worldPoint, feature, verticesMap); // これもオフセットを考慮
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
   * 点がポリゴンの境界線近くにあるか判定 (リングベース対応、オフセット考慮)
   * @param {object} point - ワールド座標 {x, y}
   * @param {DomainPolygon} polygon - 対象ポリゴン
   * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
   * @returns {boolean}
   */
  isPointNearPolygonBoundary(point, polygon, verticesMap) {
        if (!polygon || !Array.isArray(polygon.rings)) return false;

        const worldWidth = this._getWorldWidthFunc();
        const offsets = [0, -worldWidth, worldWidth];
        const toleranceSq = this._getClickToleranceSq();
        
        const getVerticesWithOffset = (ids, offsetX) => ids?.map(id => {
            const v = verticesMap.get(id);
            return v ? { x: v.x + offsetX, y: v.y } : null;
        }).filter(Boolean) || [];

        for (const offsetX of offsets) {
            for (const ring of polygon.rings) {
                if (ring.vertexIds && ring.vertexIds.length >= 2) {
                    const ringVerticesWithOffset = getVerticesWithOffset(ring.vertexIds, offsetX);
                    // GeometryServiceの isPointOnPolygonBoundary を使う
                    if (this._geometryService.isPointOnPolygonBoundary(point, ringVerticesWithOffset, toleranceSq)) {
                        return true; // いずれかのオフセットで境界に近ければ true
                    }
                }
            }
        }
        return false;
  }

  /**
   * 点がポリゴン内部（穴を除く）にあるか判定 (リングベース対応、オフセット考慮)
   * @param {object} point - ワールド座標 {x, y}
   * @param {DomainPolygon} polygon - 対象ポリゴン
   * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
   * @returns {boolean}
   */
  isPointInsidePolygon(point, polygon, verticesMap) {
        if (!polygon || !Array.isArray(polygon.rings)) return false;
        // リングベースの位置判定ヘルパーを使用 (これは既にオフセットを考慮する)
        const location = this.locatePointInPolygon(point, polygon, verticesMap);
        // 'inside_outer' (外周リングの内側かつ穴の外側) の場合に true
        return location.type === 'inside_outer';
  }

   /**
    * 点からポリゴンまでの最短距離の二乗を計算 (リングベース対応、オフセット考慮)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {number} 最短距離の二乗
    */
   _calculateDistanceToPolygon(point, polygon, verticesMap) {
       if (!polygon || !Array.isArray(polygon.rings)) return Infinity;

       const worldWidth = this._getWorldWidthFunc();
       const offsets = [0, -worldWidth, worldWidth];
       let minDistanceOverallSq = Infinity;

       const getVerticesWithOffset = (ids, offsetX) => ids?.map(id => {
           const v = verticesMap.get(id);
           return v ? { x: v.x + offsetX, y: v.y } : null;
       }).filter(Boolean) || [];

       for (const offsetX of offsets) {
           // このオフセットでのポリゴンが点を含んでいれば距離0
           const locationInfoForOffset = this.locatePointInPolygonForSpecificOffset(point, polygon, verticesMap, offsetX);
           if (locationInfoForOffset.type === 'inside_outer') {
               return 0; // 内部なら距離0
           }

           let minDistanceForOffsetSq = Infinity;
           polygon.rings.forEach(ring => {
               const ringVertices = getVerticesWithOffset(ring.vertexIds, offsetX);
                if (ringVertices.length < 2) return;
                // ポリゴンを閉じるために最初の頂点を最後に追加 (GeometryService.isPointOnPolygonBoundaryが期待する形式に合わせる場合)
                // ただし、distancePointSegmentSq は閉じたパスを期待しないので、そのまま使う
                let minDistSqForRing = Infinity;
                for (let i = 0; i < ringVertices.length; i++) { // リングの各セグメントに対して
                    const a = ringVertices[i];
                    const b = ringVertices[(i + 1) % ringVertices.length]; // 次の頂点 (最後は最初に戻る)
                    if (a && b) {
                        minDistSqForRing = Math.min(minDistSqForRing, this._geometryService.distancePointSegmentSq(point, a, b));
                    }
                }
                minDistanceForOffsetSq = Math.min(minDistanceForOffsetSq, minDistSqForRing);
           });
           minDistanceOverallSq = Math.min(minDistanceOverallSq, minDistanceForOffsetSq);
       }
       return minDistanceOverallSq;
   }

   /**
    * 点がポリゴンのどの部分にあるか判定するヘルパー (リングベース実装 - ネストレベル偶奇判定、オフセット考慮)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン (リング構造を持つ前提)
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    */
   locatePointInPolygon(point, polygon, verticesMap) {
     if (!polygon || !Array.isArray(polygon.rings)) {
       return { type: 'outside', ringId: null, nestingLevel: 0 };
     }

     const worldWidth = this._getWorldWidthFunc();
     const offsets = [0, -worldWidth, worldWidth];
     let bestLocationInfo = { type: 'outside', ringId: null, nestingLevel: 0 };
     
     const getVerticesWithOffset = (ids, offsetX) =>
       ids?.map(id => {
           const v = verticesMap.get(id);
           return v ? { x: v.x + offsetX, y: v.y } : null;
       }).filter(Boolean) || [];

     for (const offsetX of offsets) {
         // このオフセットでの境界判定
         let isOnBoundaryWithOffset = false;
         for (const ring of polygon.rings) {
             const ringVerticesWithOffset = getVerticesWithOffset(ring.vertexIds, offsetX);
             if (ringVerticesWithOffset.length >=2 && this._geometryService.isPointOnPolygonBoundary(point, ringVerticesWithOffset, this._getClickToleranceSq())) {
                 isOnBoundaryWithOffset = true;
                 break;
             }
         }
         if (isOnBoundaryWithOffset) {
             if (bestLocationInfo.nestingLevel === 0) { // どのオフセットでも内部でなかった場合のみ境界を考慮
                 bestLocationInfo = { type: 'outside', ringId: null, nestingLevel: 0 }; // 境界は outside とみなす
             }
             continue; 
         }

         const insideRingsForThisOffset = [];
         for (const ring of polygon.rings) {
           const vertsWithOffset = getVerticesWithOffset(ring.vertexIds, offsetX);
           if (vertsWithOffset.length >= 3 &&
               this._geometryService.isPointInPolygon(point, vertsWithOffset, false)) { // includeBoundary=false で厳密な内部判定
             insideRingsForThisOffset.push(ring);
           }
         }

         const nestingLevelForThisOffset = insideRingsForThisOffset.length;
         if (nestingLevelForThisOffset > bestLocationInfo.nestingLevel) {
             const isInsideOuter = nestingLevelForThisOffset % 2 === 1;
             bestLocationInfo = {
                 type: isInsideOuter ? 'inside_outer' : 'inside_hole',
                 ringId: insideRingsForThisOffset[nestingLevelForThisOffset - 1]?.id || null,
                 nestingLevel: nestingLevelForThisOffset
             };
         } else if (nestingLevelForThisOffset === bestLocationInfo.nestingLevel && nestingLevelForThisOffset > 0) {
             const isInsideOuterCurrent = nestingLevelForThisOffset % 2 === 1;
             const isInsideOuterBest = bestLocationInfo.nestingLevel % 2 === 1;
             // 同じネストレベルの場合、inside_outer (塗りつぶし領域) を優先する
             if (isInsideOuterCurrent && !isInsideOuterBest) {
                bestLocationInfo = {
                    type: 'inside_outer',
                    ringId: insideRingsForThisOffset[nestingLevelForThisOffset - 1]?.id || null,
                    nestingLevel: nestingLevelForThisOffset
                };
             }
         }
     }
     return bestLocationInfo;
   }

   /**
    * 特定のオフセットでの内外判定を行うヘルパー (主に _calculateDistanceToPolygon から使用)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @param {number} offsetX - 適用するXオフセット
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    * @private
    */
   locatePointInPolygonForSpecificOffset(point, polygon, verticesMap, offsetX) {
        const getVertices = (ids) => ids?.map(id => {
             const v = verticesMap.get(id);
             return v ? {x: v.x + offsetX, y: v.y } : null; // 指定されたoffsetXを適用
        }).filter(Boolean) || [];

        // 境界判定
        let isOnBoundary = false;
        for (const ring of polygon.rings) {
            const ringVertices = getVertices(ring.vertexIds);
            if (ringVertices.length >=2 && this._geometryService.isPointOnPolygonBoundary(point, ringVertices, this._getClickToleranceSq())) {
                isOnBoundary = true;
                break;
            }
        }
        if (isOnBoundary) return { type: 'outside', ringId: null, nestingLevel: 0 }; // 境界はoutside

        const insideRings = [];
        for (const ring of polygon.rings) {
            const verts = getVertices(ring.vertexIds);
            // GeometryService の isPointInPolygon を使用 (includeBoundary=false)
            if (verts.length >= 3 && this._geometryService.isPointInPolygon(point, verts, false)) {
                insideRings.push(ring); // 元のリングオブジェクト
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
            ringId: insideRings[nestingLevel - 1]?.id || null, // このリングIDはオフセット前のもの
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