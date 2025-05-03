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
      const isPolygon = f instanceof DomainPolygon || f.constructor?.name === 'Polygon';
      if (f.vertexIds) f.vertexIds.forEach(id => visibleVertexIds.add(id));
      if (isPolygon) {
          (f.holesVertexIds || []).flat().forEach(id => visibleVertexIds.add(id));
          if(f.isMultiPolygon && f.subPolygons) {
              (f.subPolygons || []).forEach(sub => {
                  (sub.vertexIds || []).forEach(id => visibleVertexIds.add(id));
                  (sub.holesVertexIds || []).flat().forEach(id => visibleVertexIds.add(id));
              });
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

      for (const feature of features) {
           if (!feature || typeof feature !== 'object') continue;

          let distanceSq = Infinity;
          const getVerticesByIds = (ids) => ids?.map(id => verticesMap.get(id)).filter(v => v && typeof v.x === 'number' && typeof v.y === 'number') || [];
          const featureVertices = getVerticesByIds(feature.vertexIds);
          const isPolygon = feature instanceof DomainPolygon || feature.constructor?.name === 'Polygon';

          if (feature instanceof DomainPoint || feature.constructor?.name === 'Point') {
               if (featureVertices?.length === 1) {
                   distanceSq = this._geometryService.calculateDistanceSq(
                       worldPoint.x, worldPoint.y, featureVertices[0].x, featureVertices[0].y
                   );
               }
          } else if (feature instanceof DomainLine || feature.constructor?.name === 'Line') {
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
          } else if (isPolygon) {
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
                this._viewModel.selectFeature(clickedFeature.id); // 地物選択時は常に単一選択
           } else if (!addToSelection) {
                this._viewModel.clearSelection();
           }
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
   * 点がポリゴンの境界線近くにあるか判定
   * @param {object} point - ワールド座標 {x, y}
   * @param {DomainPolygon} polygon - 対象ポリゴン
   * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
   * @returns {boolean}
   */
  isPointNearPolygonBoundary(point, polygon, verticesMap) {
        const toleranceSq = this._getClickToleranceSq(); // 動的に取得
        const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

        // Ringベースへの移行を想定し、rings プロパティをチェック
        if (polygon.rings && Array.isArray(polygon.rings)) {
            for (const ring of polygon.rings) {
                if (ring.vertexIds && ring.vertexIds.length >= 2) {
                    const ringVertices = getVertices(ring.vertexIds);
                    if (this._geometryService.isPointOnPolygonBoundary(point, ringVertices, toleranceSq)) {
                        return true;
                    }
                }
            }
        } else { // 移行前のフォールバック（現状維持）
            if (polygon.vertexIds && polygon.vertexIds.length >= 2) {
                const outerVertices = getVertices(polygon.vertexIds);
                if (this._geometryService.isPointOnPolygonBoundary(point, outerVertices, toleranceSq)) return true;
            }
            if (polygon.holesVertexIds) {
                for (const holeIds of polygon.holesVertexIds) {
                    if (holeIds.length >= 2) {
                        const holeVertices = getVertices(holeIds);
                        if (this._geometryService.isPointOnPolygonBoundary(point, holeVertices, toleranceSq)) return true;
                    }
                }
            }
            if (polygon.isMultiPolygon && polygon.subPolygons) {
                for (const subPoly of polygon.subPolygons) {
                     if (subPoly.vertexIds && subPoly.vertexIds.length >= 2) {
                        const subVertices = getVertices(subPoly.vertexIds);
                        if (this._geometryService.isPointOnPolygonBoundary(point, subVertices, toleranceSq)) return true;
                     }
                     if (subPoly.holesVertexIds) {
                        for (const holeIds of subPoly.holesVertexIds) {
                            if (holeIds.length >= 2) {
                                const holeVertices = getVertices(holeIds);
                                if (this._geometryService.isPointOnPolygonBoundary(point, holeVertices, toleranceSq)) return true;
                            }
                        }
                     }
                }
            }
        }
        return false;
  }

  /**
   * 点がポリゴン内部（穴を除く）にあるか判定
   * @param {object} point - ワールド座標 {x, y}
   * @param {DomainPolygon} polygon - 対象ポリゴン
   * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
   * @returns {boolean}
   */
  isPointInsidePolygon(point, polygon, verticesMap) {
        // リングベースへの移行を想定
        if (polygon.rings && Array.isArray(polygon.rings)) {
             const location = this.locatePointInPolygon(point, polygon, verticesMap); // リングベース用ヘルパーを呼ぶ
             return location.type === 'inside_outer';
        } else { // 移行前のフォールバック
            const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];
            let isInside = false;
            if (polygon.vertexIds && polygon.vertexIds.length >= 3) {
                 const outerVertices = getVertices(polygon.vertexIds);
                 if (outerVertices.length >= 3 && this._geometryService.isPointInPolygon(point, outerVertices)) {
                     isInside = true;
                 }
            }
            if (!isInside && polygon.isMultiPolygon && polygon.subPolygons) {
                for (const subPoly of polygon.subPolygons) {
                    if (subPoly.vertexIds && subPoly.vertexIds.length >= 3) {
                        const subVertices = getVertices(subPoly.vertexIds);
                        if (subVertices.length >= 3 && this._geometryService.isPointInPolygon(point, subVertices)) {
                             isInside = true;
                             if (subPoly.holesVertexIds) {
                                for (const holeIds of subPoly.holesVertexIds) {
                                    if (holeIds.length >= 3) {
                                        const holeVertices = getVertices(holeIds);
                                        if (holeVertices.length >= 3 && this._geometryService.isPointInPolygon(point, holeVertices)) {
                                             isInside = false; break;
                                        }
                                    }
                                }
                             }
                             if (isInside) break;
                        }
                    }
                }
            }
            if (isInside && polygon.holesVertexIds) {
                for (const holeIds of polygon.holesVertexIds) {
                     if (holeIds.length >= 3) {
                        const holeVertices = getVertices(holeIds);
                        if (holeVertices.length >= 3 && this._geometryService.isPointInPolygon(point, holeVertices)) {
                             isInside = false; break;
                        }
                     }
                }
            }
            return isInside;
        }
  }

   /**
    * 点からポリゴンまでの最短距離の二乗を計算
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {number} 最短距離の二乗
    */
   _calculateDistanceToPolygon(point, polygon, verticesMap) {
       let minDistanceSq = Infinity;
       const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

       const calculateMinDistToRing = (vertexIds) => {
           if (!vertexIds || vertexIds.length < 2) return Infinity;
           const vertices = getVertices(vertexIds);
           if (vertices.length < 2) return Infinity;
           const closedVertices = [...vertices, vertices[0]];
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

        // リングベースへの移行を想定
        if (polygon.rings && Array.isArray(polygon.rings)) {
            if (this.isPointInsidePolygon(point, polygon, verticesMap)) { // 内部判定もリングベースで行う
                return 0;
            }
            polygon.rings.forEach(ring => {
                minDistanceSq = Math.min(minDistanceSq, calculateMinDistToRing(ring.vertexIds));
            });
        } else { // 移行前のフォールバック
            if (this.isPointInsidePolygon(point, polygon, verticesMap)) {
                return 0;
            }
            if (polygon.vertexIds) {
                minDistanceSq = Math.min(minDistanceSq, calculateMinDistToRing(polygon.vertexIds));
            }
            if (polygon.isMultiPolygon && polygon.subPolygons) {
                polygon.subPolygons.forEach(sub => {
                    minDistanceSq = Math.min(minDistanceSq, calculateMinDistToRing(sub.vertexIds));
                });
            }
            // 外部点から穴までの距離は考慮しない（仕様確認）
        }
       return minDistanceSq;
   }

   /**
    * 点がポリゴンのどの部分にあるか判定するヘルパー (リングベース移行後はこちらを使う)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン (リング構造を持つ前提)
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'inside_outer' | 'inside_hole', ringId: string | null, nestingLevel: number}}
    */
    locatePointInPolygon(point, polygon, verticesMap) {
        // 高性能AIからの回答（質問1）をここに統合・実装する想定
        // 以下はダミー実装
        const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];
        if (!polygon.rings || polygon.rings.length === 0) {
            return { type: 'outside', ringId: null, nestingLevel: 0 };
        }
        // 簡易的に最初の外周リング内かチェック (要AI回答統合)
        const firstOuterRing = polygon.rings.find(r => r.isOuter && r.parentId == null);
        if (firstOuterRing) {
            const vertices = getVertices(firstOuterRing.vertexIds);
            if (this._geometryService.isPointInPolygon(point, vertices)) {
                // 本来は穴やネストをチェックする
                return { type: 'inside_outer', ringId: firstOuterRing.id, nestingLevel: 1 };
            }
        }
        return { type: 'outside', ringId: null, nestingLevel: 0 };
    }

   /**
    * 点がポリゴンのどの部分にあるか判定するヘルパー (移行前のフォールバック)
    * @param {object} point - ワールド座標 {x, y}
    * @param {DomainPolygon} polygon - 対象ポリゴン (旧構造)
    * @param {Map<string, {id:string, x:number, y:number}>} verticesMap - 頂点マップ
    * @returns {{type: 'outside' | 'main' | 'enclave' | 'main_hole' | 'enclave_hole', index: number | null}}
    */
   _getPointLocationInPolygon_Old(point, polygon, verticesMap) {
        const getVertices = (ids) => ids?.map(id => verticesMap.get(id)).filter(Boolean) || [];

        // 1. 本土の穴チェック
        if (polygon.holesVertexIds) {
            for (const holeIds of polygon.holesVertexIds) {
                 if (holeIds.length >= 3) {
                    const holeVertices = getVertices(holeIds);
                    if (holeVertices.length >= 3 && this._geometryService.isPointInPolygon(point, holeVertices)) {
                         return { type: 'main_hole', index: null };
                    }
                 }
            }
        }
        // 2. 飛び地チェック
        if (polygon.isMultiPolygon && polygon.subPolygons) {
            for (let i = 0; i < polygon.subPolygons.length; i++) {
                const subPoly = polygon.subPolygons[i];
                if (subPoly.vertexIds && subPoly.vertexIds.length >= 3) {
                    const subVertices = getVertices(subPoly.vertexIds);
                    if (subVertices.length >= 3 && this._geometryService.isPointInPolygon(point, subVertices)) {
                         // 飛び地の穴チェック
                         if (subPoly.holesVertexIds) {
                             for (const holeIds of subPoly.holesVertexIds) {
                                 if (holeIds.length >= 3) {
                                     const holeVertices = getVertices(holeIds);
                                     if (holeVertices.length >= 3 && this._geometryService.isPointInPolygon(point, holeVertices)) {
                                         return { type: 'enclave_hole', index: i };
                                     }
                                 }
                             }
                         }
                         return { type: 'enclave', index: i };
                    }
                }
            }
        }
        // 3. 本土内部チェック
        if (polygon.vertexIds && polygon.vertexIds.length >= 3) {
             const outerVertices = getVertices(polygon.vertexIds);
             if (outerVertices.length >= 3 && this._geometryService.isPointInPolygon(point, outerVertices)) {
                 return { type: 'main', index: null };
             }
        }
        // 4. 外部
        return { type: 'outside', index: null };
   }

   // リングベース移行後に呼び出すメソッド
   getPointLocationInPolygon(point, polygon, verticesMap) {
       // リングベース構造が有効なら新しい方を、なければ古い方を呼ぶ
       if (polygon.rings && Array.isArray(polygon.rings)) {
           return this.locatePointInPolygon(point, polygon, verticesMap);
       } else {
           // 古い構造用の結果を新しい構造にマッピングする (簡易)
           const oldResult = this._getPointLocationInPolygon_Old(point, polygon, verticesMap);
           let newType = 'outside';
           let ringId = null;
           let level = 0;
           if (oldResult.type === 'main' || oldResult.type === 'enclave') {
               newType = 'inside_outer';
               level = oldResult.type === 'main' ? 1 : 3; // 簡易レベル
               // TODO: 対応するリングIDを見つける処理が必要
           } else if (oldResult.type === 'main_hole' || oldResult.type === 'enclave_hole') {
               newType = 'inside_hole';
               level = oldResult.type === 'main_hole' ? 2 : 4; // 簡易レベル
               // TODO: 対応するリングIDを見つける処理が必要
           }
           return { type: newType, ringId: ringId, nestingLevel: level };
       }
   }

}