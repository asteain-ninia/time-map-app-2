import { Feature } from '../../domain/entities/Feature';
import { Point } from '../../domain/entities/Point';
import { Line } from '../../domain/entities/Line';
import { Polygon } from '../../domain/entities/Polygon';
// Vertex クラスもインポートしておく (データ比較用など)
import { Vertex } from '../../domain/entities/Vertex';

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

    // 適切なファクトリーメソッドを使用して地物オブジェクトを作成
    let feature;
    switch (featureType) {
      case 'point':
        // Point.create は geometry.vertexId を期待するが、
        // processedGeometry は geometry.vertexIds (配列) を持つため、
        // 最初の要素を geometry.vertexId として渡す
        const pointGeometry = { ...processedGeometry, vertexId: processedGeometry.vertexIds[0] };
        feature = Point.create(featureId, properties, pointGeometry, layerId);
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
        // properties は Property インスタンスの配列であることを期待
        if (!Array.isArray(updates.properties) || !updates.properties.every(p => p.constructor.name === 'Property')) {
           console.warn("updateFeature received 'properties' but it's not an array of Property instances. Attempting to proceed, but this might cause issues.", updates.properties);
           // ここで変換処理を入れることも検討できるが、呼び出し元で正しく渡すのが基本
        }
        feature = feature.withProperties(updates.properties);
    }

    if (updates.geometry) {
      const processedGeometry = this._processGeometry(updates.geometry, world);

      // オブジェクトタイプごとの検証と処理
      if (feature instanceof Polygon) {
        this._validatePolygonUpdate(processedGeometry, feature, world);

        // 頂点IDsの更新
        if (processedGeometry.vertexIds !== undefined) { // null や空配列も更新対象とするため undefined チェック
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
        } else if (processedGeometry.vertexId) { // Point用
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
      // すでに削除されている可能性もあるため、エラーではなく警告に留めるか、何もしない
      console.warn(`Feature not found with ID during deletion: ${featureId}`);
      return;
      // throw new Error(`Feature not found with ID: ${featureId}`);
    }

    const feature = world.features[featureIndex];
    const vertexIdsToCheck = feature.vertexIds ? [...feature.vertexIds] : []; // コピーを作成
    if (feature instanceof Polygon) {
        feature.holesVertexIds.forEach(hole => vertexIdsToCheck.push(...hole));
        if(feature.isMultiPolygon && feature.subPolygons) {
            feature.subPolygons.forEach(sub => vertexIdsToCheck.push(...sub.vertexIds));
            // TODO: 飛び地の穴も考慮
        }
    }


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
          // 親が Polygon で removeChildId メソッドを持っていることを確認
          if (parent instanceof Polygon && typeof parent.removeChildId === 'function') {
            const updatedParent = parent.removeChildId(featureId);
            world.features[parentIndex] = updatedParent;
          } else {
            console.warn(`Parent feature ${feature.parentId} is not a valid Polygon or lacks removeChildId method.`);
          }
        }
      }
    }

    // オブジェクトを削除
    world.features.splice(featureIndex, 1);

    // 使われなくなった頂点を削除（共有頂点でない場合）
    this._cleanupUnusedVertices(world, vertexIdsToCheck);

    // 世界データを保存
    await this._worldRepository.saveWorld(world);
  }

   /**
   * 複数の頂点を削除し、関連する地物を更新または削除
   * @param {string[]} vertexIdsToDelete - 削除する頂点のID配列
   * @returns {Promise<{deletedVertexIds: string[], updatedFeatureIds: string[], deletedFeatureIds: string[]}>} 影響結果
   */
    async deleteVertices(vertexIdsToDelete) {
        const world = await this._worldRepository.getWorld();
        const verticesToDeleteSet = new Set(vertexIdsToDelete);

        const originalFeatures = world.features;
        const updatedFeatures = []; // 更新後の地物リスト
        const updatedFeatureIds = new Set();
        const deletedFeatureIds = new Set();
        const parentUpdatesNeeded = new Map(); // { parentId: [childIdToRemove] }

        for (const feature of originalFeatures) {
            let currentFeature = feature;
            let needsUpdate = false;
            let featureShouldBeDeleted = false;

            const filterVertexIds = (ids) => ids?.filter(id => !verticesToDeleteSet.has(id)) || [];

            // 頂点リストの更新
            if (currentFeature.vertexIds && currentFeature.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                const newVertexIds = filterVertexIds(currentFeature.vertexIds);
                needsUpdate = true;
                if (currentFeature instanceof Line && newVertexIds.length < 2) {
                    featureShouldBeDeleted = true;
                } else if (currentFeature instanceof Polygon && newVertexIds.length < 3) {
                    // ポリゴンの外周が3頂点未満になった場合
                    // MultiPolygonでなく、子もない場合は削除。MultiPolygonの場合は null にするだけ
                    if (!currentFeature.isMultiPolygon && !currentFeature.hasChildren()) {
                       featureShouldBeDeleted = true;
                    } else {
                        // 外周がなくなったMultiPolygon or 親Polygon
                       currentFeature = currentFeature.withVertexIds(null); // null を許容するように変更が必要
                    }
                } else {
                    currentFeature = currentFeature.withVertexIds(newVertexIds);
                }
            }

            // ポリゴンの穴と飛び地の更新
            if (currentFeature instanceof Polygon && !featureShouldBeDeleted) {
                // 穴の更新
                let newHolesVertexIds = currentFeature.holesVertexIds || [];
                if (newHolesVertexIds.some(hole => hole.some(id => verticesToDeleteSet.has(id)))) {
                    newHolesVertexIds = newHolesVertexIds
                        .map(hole => filterVertexIds(hole))
                        .filter(hole => hole.length >= 3); // 3頂点未満の穴は削除
                    needsUpdate = true;
                    currentFeature = currentFeature.withHolesVertexIds(newHolesVertexIds);
                }

                // 飛び地の更新
                let newSubPolygons = currentFeature.subPolygons || [];
                let isMultiPolygon = currentFeature.isMultiPolygon;
                if (isMultiPolygon && newSubPolygons.some(sub => sub.vertexIds.some(id => verticesToDeleteSet.has(id)))) {
                    newSubPolygons = newSubPolygons
                        .map(sub => ({
                            ...sub, // 他のプロパティ（穴など）も保持
                            vertexIds: filterVertexIds(sub.vertexIds)
                        }))
                        .filter(sub => sub.vertexIds.length >= 3); // 3頂点未満の飛び地は削除
                    needsUpdate = true;

                    // 飛び地がなくなった、または1つになった場合の処理
                    const mainBodyExists = currentFeature.vertexIds && currentFeature.vertexIds.length >= 3;
                    const totalParts = (mainBodyExists ? 1 : 0) + newSubPolygons.length;
                    if (totalParts < 1) { // 本体も飛び地もなくなった
                        featureShouldBeDeleted = true;
                    } else if (totalParts < 2) { // MultiPolygonではなくなった
                        isMultiPolygon = false;
                    }
                    currentFeature = currentFeature.withMultiPolygonData(isMultiPolygon, newSubPolygons);
                }
            }

            if (featureShouldBeDeleted) {
                deletedFeatureIds.add(currentFeature.id);
                // 親から子IDを削除する準備
                if (currentFeature.parentId && currentFeature.parentId !== "0") {
                    if (!parentUpdatesNeeded.has(currentFeature.parentId)) {
                        parentUpdatesNeeded.set(currentFeature.parentId, []);
                    }
                    parentUpdatesNeeded.get(currentFeature.parentId).push(currentFeature.id);
                }
            } else if (needsUpdate) {
                updatedFeatures.push(currentFeature);
                updatedFeatureIds.add(currentFeature.id);
            } else {
                // 変更なし
                updatedFeatures.push(currentFeature);
            }
        }

        // 親ポリゴンの childIds を更新
        if (parentUpdatesNeeded.size > 0) {
            const finalFeatures = [];
            for(let feature of updatedFeatures) {
                if (parentUpdatesNeeded.has(feature.id) && feature instanceof Polygon) {
                   const childrenToRemove = parentUpdatesNeeded.get(feature.id);
                   let updatedParent = feature;
                   childrenToRemove.forEach(childId => {
                       updatedParent = updatedParent.removeChildId(childId);
                   });
                   finalFeatures.push(updatedParent);
                   updatedFeatureIds.add(updatedParent.id); // 親も更新された
                } else {
                    finalFeatures.push(feature);
                }
            }
            world.features = finalFeatures;
        } else {
           world.features = updatedFeatures;
        }


        // 頂点リストから削除
        const originalVertices = world.vertices;
        world.vertices = originalVertices.filter(v => !verticesToDeleteSet.has(v.id));

        // 不要になった頂点をさらにクリーンアップ（オプションだが推奨）
        const allRemainingVertexIds = new Set();
        world.features.forEach(f => {
            f.vertexIds?.forEach(id => allRemainingVertexIds.add(id));
            f.holesVertexIds?.flat().forEach(id => allRemainingVertexIds.add(id));
            f.subPolygons?.forEach(sub => sub.vertexIds.forEach(id => allRemainingVertexIds.add(id)));
            // TODO: 飛び地の穴
        });
        world.vertices = world.vertices.filter(v => allRemainingVertexIds.has(v.id));


        // 世界データを保存
        await this._worldRepository.saveWorld(world);

        return {
            deletedVertexIds: Array.from(verticesToDeleteSet),
            updatedFeatureIds: Array.from(updatedFeatureIds),
            deletedFeatureIds: Array.from(deletedFeatureIds)
        };
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

    let vertex = world.vertices[vertexIndex]; // Vertex インスタンスではない場合がある

    // 新しい位置での衝突検出と処理
    const adjustedPosition = this._handleCollisionForVertexMove(
      vertex, newPosition, world // Vertex インスタンスを期待している可能性がある
    );

    // Vertex インスタンスで更新
    // 注意: world.vertices の要素が Vertex インスタンスでない場合、
    // ここでインスタンスを生成するか、型を合わせる必要がある。
    // JSONWorldRepositoryはプレーンオブジェクトを返す可能性があるため。
    const currentVertex = new Vertex(vertex.id, vertex.x, vertex.y);
    const updatedVertex = currentVertex.withCoordinates(
        adjustedPosition.x,
        adjustedPosition.y
    );

    // 更新されたプレーンオブジェクトを保存（リポジトリがプレーンオブジェクトを期待する場合）
    world.vertices[vertexIndex] = { id: updatedVertex.id, x: updatedVertex.x, y: updatedVertex.y };

    // この頂点を使用するすべての地理オブジェクトを特定
    const affectedFeatures = world.features.filter(f =>
        (f.vertexIds && f.vertexIds.includes(vertexId)) ||
        (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertexId))) ||
        (f.subPolygons && f.subPolygons.some(sub => sub.vertexIds.includes(vertexId)))
    );

    // 世界データを保存
    await this._worldRepository.saveWorld(world);

    // 返り値も Vertex インスタンスにする
    return {
      vertex: updatedVertex, // 更新された Vertex インスタンス
      affectedFeatures: affectedFeatures // 影響を受けた地物のリスト（参照は古い可能性あり）
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
      // 同じ位置でもIDが異なる場合は共有化が必要なケースもあるが、
      // ここでは単純化のため位置が同じなら何もしない
      console.warn(`Vertices ${vertexId1} and ${vertexId2} are already at the same position.`);
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
      let feature = world.features[i];
      let updated = false;

      // vertexIds の更新
      if (feature.vertexIds && feature.vertexIds.includes(removedVertexId)) {
        const newVertexIds = feature.vertexIds.map(id =>
          id === removedVertexId ? keptVertexId : id
        );
        // 重複チェック（必要であれば）
        // const uniqueVertexIds = [...new Set(newVertexIds)];
        feature = feature.withVertexIds(newVertexIds);
        updated = true;
      }

      // ポリゴンの穴についても処理
      if (feature instanceof Polygon && feature.holesVertexIds && feature.holesVertexIds.length > 0) {
        let holesUpdated = false;
        const newHolesVertexIds = feature.holesVertexIds.map(hole => {
          if (hole.includes(removedVertexId)) {
            holesUpdated = true;
            return hole.map(id => id === removedVertexId ? keptVertexId : id);
          }
          return hole;
        });

        if (holesUpdated) {
          feature = feature.withHolesVertexIds(newHolesVertexIds);
          updated = true;
        }
      }

       // ポリゴンの飛び地についても処理
      if (feature instanceof Polygon && feature.isMultiPolygon && feature.subPolygons) {
          let subPolygonsUpdated = false;
          const newSubPolygons = feature.subPolygons.map(sub => {
              if (sub.vertexIds.includes(removedVertexId)) {
                  subPolygonsUpdated = true;
                  const newSubVertexIds = sub.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
                  // TODO: 飛び地の穴も考慮する必要がある
                  return { ...sub, vertexIds: newSubVertexIds };
              }
              return sub;
          });
          if (subPolygonsUpdated) {
              feature = feature.withMultiPolygonData(true, newSubPolygons);
              updated = true;
          }
      }


      if (updated) {
        world.features[i] = feature;
        // 影響を受けた地物を重複なく追加
        if (!affectedFeatures.some(f => f.id === feature.id)) {
          affectedFeatures.push(feature);
        }
      }
    }

    // 削除される頂点を削除
    const removedVertexIndex = world.vertices.findIndex(v => v.id === removedVertexId);
    if (removedVertexIndex !== -1) {
        world.vertices.splice(removedVertexIndex, 1);
    } else {
        console.warn(`Vertex to be removed not found: ${removedVertexId}`);
    }


    // 世界データを保存
    await this._worldRepository.saveWorld(world);

    return {
      keptVertex, // プレーンオブジェクトの可能性
      removedVertex, // プレーンオブジェクトの可能性
      affectedFeatures // 更新後のFeatureインスタンスのリスト
    };
  }

  /**
   * 共有頂点を解除
   * @param {string} vertexId - 共有を解除する頂点のID
   * @param {string} featureId - このに対して新しい頂点を作成
   * @returns {Promise<Object>} 更新情報 { newVertex, updatedFeature }
   */
  async unlinkSharedVertex(vertexId, featureId) {
    const world = await this._worldRepository.getWorld();

    // 頂点を検索
    const vertex = world.vertices.find(v => v.id === vertexId);
    if (!vertex) {
      throw new Error(`Vertex not found with ID: ${vertexId}`);
    }

    // を検索
    const featureIndex = world.features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      throw new Error(`Feature not found with ID: ${featureId}`);
    }

    let feature = world.features[featureIndex];

    // が指定された頂点を使用しているか確認 (穴と飛び地も)
    const usesVertex = (feature.vertexIds && feature.vertexIds.includes(vertexId)) ||
                     (feature instanceof Polygon && feature.holesVertexIds?.some(hole => hole.includes(vertexId))) ||
                     (feature instanceof Polygon && feature.subPolygons?.some(sub => sub.vertexIds.includes(vertexId)));

    if (!usesVertex) {
      throw new Error(`Feature ${featureId} does not use vertex with ID: ${vertexId}`);
    }

    // 新しい頂点を作成
    const newVertexId = this._generateId('vertex');
    // Vertex インスタンスを生成してからプレーンオブジェクトにする
    const originalVertex = new Vertex(vertex.id, vertex.x, vertex.y);
    const newVertexInstance = originalVertex.withCoordinates(vertex.x, vertex.y);
    // 新しいIDでプレーンオブジェクトとしてワールドに追加
    const newVertex = { id: newVertexId, x: newVertexInstance.x, y: newVertexInstance.y };
    world.vertices.push(newVertex);

    let updated = false;

    // の頂点IDsを更新
    if (feature.vertexIds && feature.vertexIds.includes(vertexId)) {
        const newVertexIds = feature.vertexIds.map(id =>
            id === vertexId ? newVertexId : id
        );
        feature = feature.withVertexIds(newVertexIds);
        updated = true;
    }


    // ポリゴンの穴についても処理
    if (feature instanceof Polygon && feature.holesVertexIds && feature.holesVertexIds.length > 0) {
      let holesUpdated = false;
      const newHolesVertexIds = feature.holesVertexIds.map(hole => {
        if (hole.includes(vertexId)) {
          holesUpdated = true;
          return hole.map(id => id === vertexId ? newVertexId : id);
        }
        return hole;
      });

      if (holesUpdated) {
        feature = feature.withHolesVertexIds(newHolesVertexIds);
        updated = true;
      }
    }

    // ポリゴンの飛び地についても処理
    if (feature instanceof Polygon && feature.isMultiPolygon && feature.subPolygons) {
        let subPolygonsUpdated = false;
        const newSubPolygons = feature.subPolygons.map(sub => {
            if (sub.vertexIds.includes(vertexId)) {
                subPolygonsUpdated = true;
                const newSubVertexIds = sub.vertexIds.map(id => id === vertexId ? newVertexId : id);
                // TODO: 飛び地の穴も考慮
                return { ...sub, vertexIds: newSubVertexIds };
            }
            return sub;
        });
        if (subPolygonsUpdated) {
            feature = feature.withMultiPolygonData(true, newSubPolygons);
            updated = true;
        }
    }

    if (updated) {
      world.features[featureIndex] = feature;
    } else {
        // 万が一更新されなかった場合 (ロジックエラー)
        console.error(`Failed to update feature ${featureId} during vertex unlink.`);
    }


    // 世界データを保存
    await this._worldRepository.saveWorld(world);

    return {
      newVertex: newVertex, // 追加されたプレーンオブジェクト
      updatedFeature: world.features[featureIndex] // 更新後のFeatureインスタンス
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
          parentId: polygon.parentId // 穴から作ったポリゴンは元のポリゴンと同じ親を持つ
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

    // 元のポリゴンを削除 (二分割の場合のみ)
    if (divisionData.type === 'bisect') {
      world.features.splice(polygonIndex, 1);
      // 親の子リストからも削除する必要がある
        if (polygon.parentId !== "0") {
            const parentIndex = world.features.findIndex(f => f.id === polygon.parentId);
            if (parentIndex !== -1 && world.features[parentIndex] instanceof Polygon) {
                const parent = world.features[parentIndex];
                const updatedParent = parent.removeChildId(polygonId);
                world.features[parentIndex] = updatedParent;
            }
        }
       // 関連する頂点のクリーンアップも必要
       this._cleanupUnusedVertices(world, polygon.vertexIds);
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
    let newParentIndex = -1;
    if (newParentId !== "0") {
      newParentIndex = world.features.findIndex(f =>
        f.id === newParentId && f instanceof Polygon
      );

      if (newParentIndex === -1) {
        throw new Error(`Parent polygon not found with ID: ${newParentId}`);
      }

      newParent = world.features[newParentIndex];

      // レイヤーの階層関係を検証
      const polygonLayer = world.layers.find(l => l.id === polygon.layerId);
      const parentLayer = world.layers.find(l => l.id === newParent.layerId);
      if (!polygonLayer || !parentLayer) {
          throw new Error('Cannot find layers for polygon or parent.');
      }

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
      // newParentIndex を再検索する必要があるかもしれない（配列が変更されている可能性）
      const currentNewParentIndex = world.features.findIndex(f => f.id === newParentId);
      if (currentNewParentIndex !== -1) {
          const currentNewParent = world.features[currentNewParentIndex];
          if (currentNewParent instanceof Polygon) {
             const updatedNewParent = currentNewParent.addChildId(polygonId);
             world.features[currentNewParentIndex] = updatedNewParent;
          }
      }
    }

    // 世界データを保存
    await this._worldRepository.saveWorld(world);

    // 返り値の親も更新後のインスタンスにする
    const finalOldParentIndex = world.features.findIndex(f => oldParent && f.id === oldParent.id);
    const finalNewParentIndex = world.features.findIndex(f => newParent && f.id === newParent.id);

    return {
      updatedPolygon: world.features[polygonIndex], // 更新後のインスタンス
      oldParent: finalOldParentIndex !== -1 ? world.features[finalOldParentIndex] : null,
      newParent: finalNewParentIndex !== -1 ? world.features[finalNewParentIndex] : null
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
    if (geometry.vertices && Array.isArray(geometry.vertices)) {
      processedGeometry.vertexIds = [];

      for (const vertex of geometry.vertices) {
          if(vertex.x === undefined || vertex.y === undefined) continue; // 不正な頂点データはスキップ
        const vertexId = this._generateId('vertex');
        processedGeometry.vertexIds.push(vertexId);

        // 新しい頂点をワールドに追加
        world.vertices.push({
          id: vertexId,
          x: vertex.x,
          y: vertex.y
        });
      }
       // 元の vertices 配列は不要なので削除 (vertexIds に置き換え)
       delete processedGeometry.vertices;
    }

    // 穴についても同様の処理
    if (geometry.holes && Array.isArray(geometry.holes)) {
      processedGeometry.holesVertexIds = [];

      for (const hole of geometry.holes) {
        if(!Array.isArray(hole)) continue;
        const holeIds = [];
        for (const vertex of hole) {
            if(vertex.x === undefined || vertex.y === undefined) continue;
          const vertexId = this._generateId('vertex');
          holeIds.push(vertexId);

          world.vertices.push({
            id: vertexId,
            x: vertex.x,
            y: vertex.y
          });
        }
        if(holeIds.length > 0) { // 有効な頂点がある穴のみ追加
           processedGeometry.holesVertexIds.push(holeIds);
        }
      }
      // 元の holes 配列は不要なので削除
      delete processedGeometry.holes;
    }

    // 飛び地の処理 (頂点ID割り当て)
    if(geometry.subPolygons && Array.isArray(geometry.subPolygons)) {
        processedGeometry.subPolygons = geometry.subPolygons.map(sub => {
            if (!sub.vertices || !Array.isArray(sub.vertices)) return sub; // verticesがない場合はそのまま

            const subVertexIds = [];
            for (const vertex of sub.vertices) {
                if(vertex.x === undefined || vertex.y === undefined) continue;
                const vertexId = this._generateId('vertex');
                subVertexIds.push(vertexId);
                world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
            }
            // TODO: 飛び地の穴の頂点ID割り当ても必要
            const processedSub = { ...sub, vertexIds: subVertexIds };
            delete processedSub.vertices; // 元の vertices は削除
            return processedSub;
        });
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
    // TODO: 同一レイヤー内のポリゴンとの排他性チェック
    // ...

    // TODO: 親ポリゴンとの関係チェック (指定されたparentIdが存在し、正しい階層にあるか)
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
    // TODO: 同一レイヤー内のポリゴンとの排他性チェック
    // ...

    // TODO: 親ポリゴンとの関係チェック
    // ...

    // TODO: 子ポリゴンとの関係チェック (子が内部に含まれなくなるような変更はNG)
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

    // TODO: 穴がポリゴン内部に完全に含まれることを確認
    // ...

    // TODO: 穴が他の穴と交差しないことを確認
    // ...
  }

  /**
   * 頂点移動時の衝突処理
   * @param {Vertex | {id: string, x: number, y: number}} vertex - 移動する頂点
   * @param {Object} newPosition - 新しい位置 { x, y }
   * @param {Object} world - 世界データ
   * @returns {Object} 調整された位置 { x, y }
   * @private
   */
  _handleCollisionForVertexMove(vertex, newPosition, world) {
    // この頂点を使用するポリゴンを特定
    const polygons = world.features.filter(f =>
      f instanceof Polygon &&
      ((f.vertexIds && f.vertexIds.includes(vertex.id)) ||
       (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertex.id))) ||
       (f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds.includes(vertex.id))))
    );

    if (polygons.length === 0) {
      // ポリゴンに属さない頂点は自由に移動可能
      return newPosition;
    }

    // TODO: 各ポリゴンについて衝突判定とエッジ滑り処理
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
      if (!vertexIds || vertexIds.length === 0) return;

      const verticesToRemove = new Set();
      const vertexIdsToCheck = new Set(vertexIds); // チェック対象の頂点

      for (const vertexId of vertexIdsToCheck) {
          // この頂点を使用する他の地物が存在するかチェック
          const isUsed = world.features.some(f =>
              (f.vertexIds && f.vertexIds.includes(vertexId)) ||
              (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertexId))) ||
              (f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds.includes(vertexId)))
          );

          if (!isUsed) {
              verticesToRemove.add(vertexId);
          }
      }

      if (verticesToRemove.size > 0) {
          world.vertices = world.vertices.filter(v => !verticesToRemove.has(v.id));
          console.log(`Cleaned up ${verticesToRemove.size} unused vertices.`);
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
      if (!id || typeof id !== 'string') return 0;
      const parts = id.split('-');
      // タイムスタンプは2番目の要素と仮定
      return parts.length > 1 ? parseInt(parts[1], 10) : 0;
    };

    const timestamp1 = getTimestamp(id1);
    const timestamp2 = getTimestamp(id2);

    // タイムスタンプが同じ、または取得できない場合は、辞書順で比較（一意性を保つため）
    if (timestamp1 === timestamp2) {
        return id1 <= id2 ? id1 : id2;
    }

    return timestamp1 < timestamp2 ? id1 : id2;
  }
}
