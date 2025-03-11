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
    
    // 子ポリゴンが1つの場合は単純にその形状を使用
    if (childPolygons.length === 1) {
      const child = childPolygons[0];
      return {
        vertexIds: child.vertexIds,
        subPolygons: child.subPolygons,
        isMultiPolygon: child.isMultiPolygon
      };
    }
    
    // 複数の子ポリゴンがある場合はMultiPolygonとして扱う
    const subPolygons = childPolygons.map(child => {
      if (child.isMultiPolygon) {
        // 子自体がMultiPolygonの場合はサブポリゴンを展開
        return child.subPolygons;
      } else {
        // 単一ポリゴンの場合は変換
        return {
          vertexIds: child.vertexIds,
          holesVertexIds: child.holesVertexIds
        };
      }
    }).flat();
    
    return {
      vertexIds: null, // 直接の頂点定義はなし
      subPolygons: subPolygons,
      isMultiPolygon: true
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
    
    // 上位レイヤーのポリゴンを検索
    const higherPolygons = allPolygons.filter(p => 
      higherLayers.some(layer => layer.id === p.layerId)
    );
    
    // ポリゴンの頂点座標を取得
    const polygonVertices = polygon.vertexIds.map(id => 
      allVertices.find(v => v.id === id)
    ).map(v => new Coordinate(v.x, v.y));
    
    // 各上位ポリゴンについて含有関係をチェック
    for (const higherPolygon of higherPolygons) {
      const higherVertices = higherPolygon.vertexIds.map(id => 
        allVertices.find(v => v.id === id)
      ).map(v => new Coordinate(v.x, v.y));
      
      // すべての頂点が上位ポリゴン内に含まれるかチェック
      const isContained = polygonVertices.every(vertex => 
        geometryService.isPointInPolygon(vertex, higherVertices)
      );
      
      if (isContained) {
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
    // ポリゴンの頂点座標を取得
    const polygonVertices = polygon.vertexIds.map(id => 
      allVertices.find(v => v.id === id)
    ).map(v => new Coordinate(v.x, v.y));
    
    // 各レイヤーポリゴンについて重なりをチェック
    for (const layerPolygon of layerPolygons) {
      if (layerPolygon.id === polygon.id) continue; // 自分自身はスキップ
      
      const layerVertices = layerPolygon.vertexIds.map(id => 
        allVertices.find(v => v.id === id)
      ).map(v => new Coordinate(v.x, v.y));
      
      // ポリゴン同士の重なりをチェック
      if (geometryService.doPolygonsOverlap(polygonVertices, layerVertices)) {
        return false;
      }
    }
    
    return true;
  }