import { Feature } from '../../domain/entities/Feature';
import { Point } from '../../domain/entities/Point';
import { Line } from '../../domain/entities/Line';
import { Polygon } from '../../domain/entities/Polygon';

/**
 * 地理オブジェクトの編集を処理するユースケース
 */
export class EditFeatureUseCase {
  /**
   * ユースケースを作成
   * @param {WorldRepository} worldRepository - 世界データリポジトリ
   * @param {GeometryService} geometryService - 幾何学サービス
   * @param {LayerService} layerService - レイヤーサービス
   */
  constructor(worldRepository, geometryService, layerService) {
    this._worldRepository = worldRepository;
    this._geometryService = geometryService;
    this._layerService = layerService;
  }

  /**
   * 新しい地理オブジェクトを追加
   * @param {string} featureType - オブジェクトタイプ ('point', 'line', 'polygon')
   * @param {Object} properties - プロパティ情報
   * @param {Object} geometry - 形状情報
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Feature>} 追加されたオブジェクト
   */
  async addFeature(featureType, properties, geometry, layerId) {
    const world = await this._worldRepository.getWorld();
    
    // IDの生成
    const featureId = this._generateId(featureType);
    
    // 形状情報の検証とID割り当て
    const processedGeometry = this._processGeometry(geometry, world);
    
    // 適切なファクトリーメソッドを使用して特徴オブジェクトを作成
    let feature;
    switch (featureType) {
      case 'point':
        feature = Point.create(featureId, properties, processedGeometry, layerId);
        break;
      case 'line':
        feature = Line.create(featureId, properties, processedGeometry, layerId);
        break;
      case 'polygon':
        // ポリゴンの場合、レイヤー内での排他性と階層関係の検証
        this._validatePolygonAddition(processedGeometry, layerId, world);
        feature = Polygon.create(featureId, properties, processedGeometry, layerId);
        break;
      default:
        throw new Error(`Unknown feature type: ${featureType}`);
    }
    
    // オブジェクトを追加
    world.features.push(feature);
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return feature;
  }

  /**
   * 既存の地理オブジェクトを更新
   * @param {string} featureId - 更新するオブジェクトのID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Feature>} 更新されたオブジェクト
   */
  async updateFeature(featureId, updates) {
    const world = await this._worldRepository.getWorld();
    
    // オブジェクトを検索
    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }
    
    let feature = world.features[featureIndex];
    
    // 更新内容に応じてオブジェクトを変更
    if (updates.properties) {
      feature = feature.withProperties(updates.properties);
    }
    
    if (updates.geometry) {
      const processedGeometry = this._processGeometry(updates.geometry, world);
      
      // オブジェクトタイプごとの検証と処理
      if (feature instanceof Polygon) {
        this._validatePolygonUpdate(processedGeometry, feature, world);
        
        // 頂点IDsの更新
        if (processedGeometry.vertexIds) {
          feature = feature.withVertexIds(processedGeometry.vertexIds);
        }
        
        // 穴の更新
        if (processedGeometry.holesVertexIds) {
          feature = feature.withHolesVertexIds(processedGeometry.holesVertexIds);
        }
        
        // 親IDの更新
        if (processedGeometry.parentId) {
          feature = feature.withParentId(processedGeometry.parentId);
        }
        
        // 飛び地情報の更新
        if (processedGeometry.isMultiPolygon !== undefined) {
          feature = feature.withMultiPolygonData(
            processedGeometry.isMultiPolygon,
            processedGeometry.subPolygons || []
          );
        }
      } else {
        // 点または線の頂点IDsの更新
        if (processedGeometry.vertexIds) {
          feature = feature.withVertexIds(processedGeometry.vertexIds);
        } else if (processedGeometry.vertexId) {
          feature = feature.withVertexIds([processedGeometry.vertexId]);
        }
      }
    }
    
    if (updates.layerId) {
      feature = feature.withLayerId(updates.layerId);
    }
    
    // 更新されたオブジェクトを置き換え
    world.features[featureIndex] = feature;
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return feature;
  }

  /**
   * 地理オブジェクトを削除
   * @param {string} featureId - 削除するオブジェクトのID
   * @returns {Promise<void>}
   */
  async deleteFeature(featureId) {
    const world = await this._worldRepository.getWorld();
    
    // オブジェクトを検索
    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }
    
    const feature = world.features[featureIndex];
    
    // ポリゴンの場合、依存関係をチェック
    if (feature instanceof Polygon) {
      // 下位領域がある場合は削除不可
      if (feature.hasChildren()) {
        throw new Error('Cannot delete a polygon that has child polygons');
      }
      
      // 親ポリゴンの子IDsリストから自身を削除
      if (feature.parentId !== "0") {
        const parentIndex = world.features.findIndex(f => f.id === feature.parentId);
        if (parentIndex !== -1) {
          const parent = world.features[parentIndex];
          const updatedParent = parent.removeChildId(featureId);
          world.features[parentIndex] = updatedParent;
        }
      }
    }
    
    // オブジェクトを削除
    world.features.splice(featureIndex, 1);
    
    // 使われなくなった頂点を削除（共有頂点でない場合）
    this._cleanupUnusedVertices(world, feature.vertexIds);
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
  }

  /**
   * 頂点を移動
   * @param {string} vertexId - 移動する頂点のID
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @returns {Promise<Object>} 更新情報 { vertex, affectedFeatures }
   */
  async moveVertex(vertexId, newPosition) {
    const world = await this._worldRepository.getWorld();
    
    // 頂点を検索
    const vertexIndex = world.vertices.findIndex(v => v.id === vertexId);
    if (vertexIndex === -1) {
      throw new Error(`Vertex not found with ID: ${vertexId}`);
    }
    
    const vertex = world.vertices[vertexIndex];
    
    // 新しい位置での衝突検出と処理
    const adjustedPosition = this._handleCollisionForVertexMove(
      vertex, newPosition, world
    );
    
    // 頂点を更新
    const updatedVertex = vertex.withCoordinates(
      adjustedPosition.x,
      adjustedPosition.y
    );
    world.vertices[vertexIndex] = updatedVertex;
    
    // この頂点を使用するすべての地理オブジェクトを特定
    const affectedFeatures = world.features.filter(f => 
      f.vertexIds.includes(vertexId)
    );
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return { 
      vertex: updatedVertex, 
      affectedFeatures: affectedFeatures 
    };
  }

  /**
   * 頂点を共有化
   * @param {string} vertexId1 - 頂点1のID
   * @param {string} vertexId2 - 頂点2のID
   * @returns {Promise<Object>} 更新情報 { keptVertex, removedVertex, affectedFeatures }
   */
  async shareVertices(vertexId1, vertexId2) {
    const world = await this._worldRepository.getWorld();
    
    // 頂点を検索
    const vertex1 = world.vertices.find(v => v.id === vertexId1);
    const vertex2 = world.vertices.find(v => v.id === vertexId2);
    
    if (!vertex1 || !vertex2) {
      throw new Error('One or both vertices not found');
    }
    
    // 既に同じ位置にある場合は何もしない
    if (vertex1.x === vertex2.x && vertex1.y === vertex2.y) {
      return null;
    }
    
    // 古いほうのIDを持つ頂点を保持
    const keptVertexId = this._getOlderVertexId(vertexId1, vertexId2);
    const removedVertexId = keptVertexId === vertexId1 ? vertexId2 : vertexId1;
    
    const keptVertex = keptVertexId === vertexId1 ? vertex1 : vertex2;
    const removedVertex = keptVertexId === vertexId1 ? vertex2 : vertex1;
    
    // この頂点を使用するすべての地理オブジェクトを特定
    const affectedFeatures = [];
    
    // 削除される頂点を使用するすべてのオブジェクトについて頂点IDを置き換え
    for (let i = 0; i < world.features.length; i++) {
      const feature = world.features[i];
      
      if (feature.vertexIds.includes(removedVertexId)) {
        const newVertexIds = feature.vertexIds.map(id => 
          id === removedVertexId ? keptVertexId : id
        );
        
        const updatedFeature = feature.withVertexIds(newVertexIds);
        world.features[i] = updatedFeature;
        affectedFeatures.push(updatedFeature);
      }
      
      // ポリゴンの穴についても処理
      if (feature instanceof Polygon && feature.holesVertexIds.length > 0) {
        let holesUpdated = false;
        const newHolesVertexIds = feature.holesVertexIds.map(hole => {
          if (hole.includes(removedVertexId)) {
            holesUpdated = true;
            return hole.map(id => id === removedVertexId ? keptVertexId : id);
          }
          return hole;
        });
        
        if (holesUpdated) {
          const updatedFeature = feature.withHolesVertexIds(newHolesVertexIds);
          world.features[i] = updatedFeature;
          
          if (!affectedFeatures.some(f => f.id === updatedFeature.id)) {
            affectedFeatures.push(updatedFeature);
          }
        }
      }
    }
    
    // 削除される頂点を削除
    const removedVertexIndex = world.vertices.findIndex(v => v.id === removedVertexId);
    world.vertices.splice(removedVertexIndex, 1);
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return {
      keptVertex,
      removedVertex,
      affectedFeatures
    };
  }

  /**
   * 共有頂点を解除
   * @param {string} vertexId - 共有を解除する頂点のID
   * @param {string} featureId - この特徴に対して新しい頂点を作成
   * @returns {Promise<Object>} 更新情報 { newVertex, updatedFeature }
   */
  async unlinkSharedVertex(vertexId, featureId) {
    const world = await this._worldRepository.getWorld();
    
    // 頂点を検索
    const vertex = world.vertices.find(v => v.id === vertexId);
    if (!vertex) {
      throw new Error(`Vertex not found with ID: ${vertexId}`);
    }
    
    // 特徴を検索
    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }
    
    const feature = world.features[featureIndex];
    
    // 特徴が指定された頂点を使用しているか確認
    if (!feature.vertexIds.includes(vertexId)) {
      throw new Error(`Feature does not use vertex with ID: ${vertexId}`);
    }
    
    // 新しい頂点を作成
    const newVertexId = this._generateId('vertex');
    const newVertex = vertex.withCoordinates(vertex.x, vertex.y);
    Object.defineProperty(newVertex, '_id', { value: newVertexId });
    
    world.vertices.push(newVertex);
    
    // 特徴の頂点IDsを更新
    const newVertexIds = feature.vertexIds.map(id => 
      id === vertexId ? newVertexId : id
    );
    
    const updatedFeature = feature.withVertexIds(newVertexIds);
    world.features[featureIndex] = updatedFeature;
    
    // ポリゴンの穴についても処理
    if (feature instanceof Polygon && feature.holesVertexIds.length > 0) {
      const newHolesVertexIds = feature.holesVertexIds.map(hole => {
        if (hole.includes(vertexId)) {
          return hole.map(id => id === vertexId ? newVertexId : id);
        }
        return hole;
      });
      
      const updatedWithHoles = updatedFeature.withHolesVertexIds(newHolesVertexIds);
      world.features[featureIndex] = updatedWithHoles;
    }
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return {
      newVertex,
      updatedFeature: world.features[featureIndex]
    };
  }

  /**
   * ポリゴンを分裂
   * @param {string} polygonId - 分裂するポリゴンのID
   * @param {Object} divisionData - 分裂情報
   * @returns {Promise<Object>} 更新情報 { originalPolygon, newPolygons }
   */
  async splitPolygon(polygonId, divisionData) {
    const world = await this._worldRepository.getWorld();
    
    // ポリゴンを検索
    const polygonIndex = world.features.findIndex(f => 
      f.id === polygonId && f instanceof Polygon
    );
    
    if (polygonIndex === -1) {
      throw new Error(`Polygon not found with ID: ${polygonId}`);
    }
    
    const polygon = world.features[polygonIndex];
    
    // 下位領域を持つポリゴンは分割不可
    if (polygon.hasChildren()) {
      throw new Error('Cannot split a polygon that has child polygons');
    }
    
    // 分割タイプに応じた処理
    const newPolygons = [];
    
    if (divisionData.type === 'bisect') {
      // 線による二分割
      const { line, properties } = divisionData;
      
      // 二分割アルゴリズムの実装
      // ...

      // 本来はここで二分割処理を実装するが、簡易的な処理として
      // 既存ポリゴンを元に2つの新しいポリゴンを作成する
      
      // 新しいポリゴン1
      const newPoly1Id = this._generateId('polygon');
      const newPoly1 = Polygon.create(
        newPoly1Id,
        [polygon.properties[0]], // 元のプロパティをコピー
        {
          vertexIds: [...polygon.vertexIds.slice(0, Math.ceil(polygon.vertexIds.length / 2))],
          holesVertexIds: [],
          parentId: polygon.parentId
        },
        polygon.layerId
      );
      
      // 新しいポリゴン2
      const newPoly2Id = this._generateId('polygon');
      const newPoly2 = Polygon.create(
        newPoly2Id,
        properties ? [properties] : [polygon.properties[0]], // 指定されたプロパティまたは元のプロパティ
        {
          vertexIds: [...polygon.vertexIds.slice(Math.floor(polygon.vertexIds.length / 2))],
          holesVertexIds: [],
          parentId: polygon.parentId
        },
        polygon.layerId
      );
      
      newPolygons.push(newPoly1, newPoly2);
      
    } else if (divisionData.type === 'hole') {
      // 穴による分割
      const { holeVertexIds, newPolygonProperties } = divisionData;
      
      // 穴のバリデーション
      this._validatePolygonHole(holeVertexIds, polygon, world);
      
      // 穴を追加した元のポリゴン
      const updatedHoles = [...polygon.holesVertexIds, holeVertexIds];
      const updatedPolygon = polygon.withHolesVertexIds(updatedHoles);
      
      // 穴から新しいポリゴンを作成
      const newPolyId = this._generateId('polygon');
      const newPoly = Polygon.create(
        newPolyId,
        newPolygonProperties ? [newPolygonProperties] : [polygon.properties[0]],
        {
          vertexIds: holeVertexIds,
          holesVertexIds: [],
          parentId: polygon.parentId
        },
        polygon.layerId
      );
      
      world.features[polygonIndex] = updatedPolygon;
      newPolygons.push(newPoly);
    }
    
    // 新しいポリゴンを追加
    for (const newPoly of newPolygons) {
      world.features.push(newPoly);
    }
    
    // 元のポリゴンを削除
    if (divisionData.type === 'bisect') {
      world.features.splice(polygonIndex, 1);
    }
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return {
      originalPolygon: polygon,
      newPolygons: newPolygons
    };
  }

  /**
   * ポリゴンの所属変更
   * @param {string} polygonId - 所属を変更するポリゴンのID
   * @param {string} newParentId - 新しい親ポリゴンのID
   * @returns {Promise<Object>} 更新情報 { updatedPolygon, oldParent, newParent }
   */
  async changePolygonParent(polygonId, newParentId) {
    const world = await this._worldRepository.getWorld();
    
    // ポリゴンを検索
    const polygonIndex = world.features.findIndex(f => 
      f.id === polygonId && f instanceof Polygon
    );
    
    if (polygonIndex === -1) {
      throw new Error(`Polygon not found with ID: ${polygonId}`);
    }
    
    const polygon = world.features[polygonIndex];
    
    // 下位領域を持つポリゴンは所属変更不可
    if (polygon.hasChildren()) {
      throw new Error('Cannot change parent of a polygon that has child polygons');
    }
    
    // 新しい親を検索
    let newParent = null;
    if (newParentId !== "0") {
      const newParentIndex = world.features.findIndex(f => 
        f.id === newParentId && f instanceof Polygon
      );
      
      if (newParentIndex === -1) {
        throw new Error(`Parent polygon not found with ID: ${newParentId}`);
      }
      
      newParent = world.features[newParentIndex];
      
      // レイヤーの階層関係を検証
      const polygonLayer = world.layers.find(l => l.id === polygon.layerId);
      const parentLayer = world.layers.find(l => l.id === newParent.layerId);
      
      if (parentLayer.order >= polygonLayer.order) {
        throw new Error('Parent polygon must be in a higher layer');
      }
    }
    
    // 古い親から子IDを削除
    let oldParent = null;
    if (polygon.parentId !== "0") {
      const oldParentIndex = world.features.findIndex(f => 
        f.id === polygon.parentId && f instanceof Polygon
      );
      
      if (oldParentIndex !== -1) {
        oldParent = world.features[oldParentIndex];
        const updatedOldParent = oldParent.removeChildId(polygonId);
        world.features[oldParentIndex] = updatedOldParent;
      }
    }
    
    // ポリゴンの親IDを更新
    const updatedPolygon = polygon.withParentId(newParentId);
    world.features[polygonIndex] = updatedPolygon;
    
    // 新しい親に子IDを追加
    if (newParent) {
      const newParentIndex = world.features.findIndex(f => f.id === newParentId);
      const updatedNewParent = newParent.addChildId(polygonId);
      world.features[newParentIndex] = updatedNewParent;
    }
    
    // 世界データを保存
    await this._worldRepository.saveWorld(world);
    
    return {
      updatedPolygon,
      oldParent,
      newParent
    };
  }

  /**
   * ID生成
   * @param {string} type - 生成するIDのタイプ
   * @returns {string} 生成されたID
   * @private
   */
  _generateId(type) {
    const timestamp = new Date().getTime();
    const random = Math.floor(Math.random() * 10000);
    return `${type}-${timestamp}-${random}`;
  }

  /**
   * 形状情報の処理とID割り当て
   * @param {Object} geometry - 形状情報
   * @param {Object} world - 世界データ
   * @returns {Object} 処理された形状情報
   * @private
   */
  _processGeometry(geometry, world) {
    // 既存頂点のコピー
    const processedGeometry = { ...geometry };
    
    // 新しい頂点の場合はIDを割り当てて頂点リストに追加
    if (geometry.vertices) {
      processedGeometry.vertexIds = [];
      
      for (const vertex of geometry.vertices) {
        const vertexId = this._generateId('vertex');
        processedGeometry.vertexIds.push(vertexId);
        
        // 新しい頂点をワールドに追加
        world.vertices.push({
          id: vertexId,
          x: vertex.x,
          y: vertex.y
        });
      }
    }
    
    // 穴についても同様の処理
    if (geometry.holes) {
      processedGeometry.holesVertexIds = [];
      
      for (const hole of geometry.holes) {
        const holeIds = [];
        for (const vertex of hole) {
          const vertexId = this._generateId('vertex');
          holeIds.push(vertexId);
          
          world.vertices.push({
            id: vertexId,
            x: vertex.x,
            y: vertex.y
          });
        }
        processedGeometry.holesVertexIds.push(holeIds);
      }
    }
    
    return processedGeometry;
  }

  /**
   * ポリゴンの追加検証
   * @param {Object} geometry - 形状情報
   * @param {string} layerId - レイヤーID
   * @param {Object} world - 世界データ
   * @private
   */
  _validatePolygonAddition(geometry, layerId, world) {
    // 同一レイヤー内のポリゴンとの排他性チェック
    // ...
    
    // 親ポリゴンとの関係チェック
    // ...
  }

  /**
   * ポリゴンの更新検証
   * @param {Object} geometry - 形状情報
   * @param {Polygon} polygon - 更新するポリゴン
   * @param {Object} world - 世界データ
   * @private
   */
  _validatePolygonUpdate(geometry, polygon, world) {
    // 同一レイヤー内のポリゴンとの排他性チェック
    // ...
    
    // 親ポリゴンとの関係チェック
    // ...
    
    // 子ポリゴンとの関係チェック
    // ...
  }

  /**
   * ポリゴンの穴のバリデーション
   * @param {string[]} holeVertexIds - 穴の頂点IDの配列
   * @param {Polygon} polygon - ポリゴン
   * @param {Object} world - 世界データ
   * @private
   */
  _validatePolygonHole(holeVertexIds, polygon, world) {
    // 穴が少なくとも3つの頂点を持つことを確認
    if (holeVertexIds.length < 3) {
      throw new Error('Polygon hole must have at least three vertices');
    }
    
    // 穴がポリゴン内部に完全に含まれることを確認
    // ...
    
    // 穴が他の穴と交差しないことを確認
    // ...
  }

  /**
   * 頂点移動時の衝突処理
   * @param {Vertex} vertex - 移動する頂点
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @param {Object} world - 世界データ
   * @returns {Object} 調整された位置 { x, y }
   * @private
   */
  _handleCollisionForVertexMove(vertex, newPosition, world) {
    // この頂点を使用するポリゴンを特定
    const polygons = world.features.filter(f => 
      f instanceof Polygon && f.vertexIds.includes(vertex.id)
    );
    
    if (polygons.length === 0) {
      // ポリゴンに属さない頂点は自由に移動可能
      return newPosition;
    }
    
    // 各ポリゴンについて衝突判定
    // ...
    
    // 本来ならここで衝突判定とエッジ滑り処理を実装するが、簡易的な処理として
    // 新しい位置をそのまま返す
    return newPosition;
  }

  /**
   * 使用されていない頂点のクリーンアップ
   * @param {Object} world - 世界データ
   * @param {string[]} vertexIds - チェックする頂点IDの配列
   * @private
   */
  _cleanupUnusedVertices(world, vertexIds) {
    for (const vertexId of vertexIds) {
      // この頂点を使用する他のオブジェクトがあるかチェック
      const isUsed = world.features.some(f => 
        f.vertexIds.includes(vertexId)
      );
      
      if (!isUsed) {
        // 使用されていない頂点を削除
        const vertexIndex = world.vertices.findIndex(v => v.id === vertexId);
        if (vertexIndex !== -1) {
          world.vertices.splice(vertexIndex, 1);
        }
      }
    }
  }

  /**
   * 古いほうのIDを持つ頂点を特定
   * @param {string} id1 - 頂点1のID
   * @param {string} id2 - 頂点2のID
   * @returns {string} 古いほうのID
   * @private
   */
  _getOlderVertexId(id1, id2) {
    // IDからタイムスタンプ部分を抽出して比較
    const getTimestamp = (id) => {
      const parts = id.split('-');
      return parts.length > 1 ? parseInt(parts[1], 10) : 0;
    };
    
    const timestamp1 = getTimestamp(id1);
    const timestamp2 = getTimestamp(id2);
    
    return timestamp1 <= timestamp2 ? id1 : id2;
  }
}