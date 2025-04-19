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
        // Null check for feature before calling withProperties
        if (feature && typeof feature.withProperties === 'function') {
           feature = feature.withProperties(updates.properties);
        } else {
           console.error(`Feature ${featureId} is invalid or missing withProperties method.`);
           throw new Error(`Invalid feature object for ID: ${featureId}`);
        }
    }

    if (updates.geometry) {
      const processedGeometry = this._processGeometry(updates.geometry, world);

      // Null check for feature before proceeding
      if (!feature) {
          console.error(`Feature ${featureId} became null unexpectedly after property update.`);
          throw new Error(`Feature object invalid after property update for ID: ${featureId}`);
      }

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
          // Null check for feature before calling withVertexIds
          if (feature && typeof feature.withVertexIds === 'function') {
             feature = feature.withVertexIds(processedGeometry.vertexIds);
          } else {
             console.error(`Feature ${featureId} is invalid or missing withVertexIds method (Point/Line).`);
             throw new Error(`Invalid feature object for ID: ${featureId}`);
          }
        } else if (processedGeometry.vertexId) { // Point用
          if (feature && typeof feature.withVertexIds === 'function') {
            feature = feature.withVertexIds([processedGeometry.vertexId]);
          } else {
            console.error(`Feature ${featureId} is invalid or missing withVertexIds method (Point).`);
            throw new Error(`Invalid feature object for ID: ${featureId}`);
          }
        }
      }
    }

    // Null check for feature before layerId update
    if (!feature) {
        console.error(`Feature ${featureId} became null unexpectedly before layer ID update.`);
        throw new Error(`Feature object invalid before layer ID update for ID: ${featureId}`);
    }

    if (updates.layerId) {
      if (typeof feature.withLayerId === 'function') {
         feature = feature.withLayerId(updates.layerId);
      } else {
         console.error(`Feature ${featureId} is invalid or missing withLayerId method.`);
         throw new Error(`Invalid feature object for ID: ${featureId}`);
      }
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
    // Check if feature is valid before accessing properties
    if (!feature) {
        console.error(`Invalid feature data found at index ${featureIndex} for ID ${featureId}`);
        world.features.splice(featureIndex, 1); // Remove invalid data
        await this._worldRepository.saveWorld(world);
        return;
    }
    const vertexIdsToCheck = feature.vertexIds ? [...feature.vertexIds] : []; // コピーを作成
    if (feature instanceof Polygon) {
        feature.holesVertexIds?.forEach(hole => vertexIdsToCheck.push(...hole));
        if(feature.isMultiPolygon && feature.subPolygons) {
            feature.subPolygons.forEach(sub => sub.vertexIds && vertexIdsToCheck.push(...sub.vertexIds));
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
    console.log(`Deleted feature ${featureId}`);

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
        console.log(`[UseCase] deleteVertices called with:`, vertexIdsToDelete); // ★ Log: Entry point
        const world = await this._worldRepository.getWorld();
        const verticesToDeleteSet = new Set(vertexIdsToDelete);

        const originalFeatures = world.features;
        const updatedFeatures = []; // 更新後の地物リスト
        const updatedFeatureIds = new Set();
        const deletedFeatureIds = new Set();
        const parentUpdatesNeeded = new Map(); // { parentId: [childIdToRemove] }

        const filterVertexIds = (ids) => ids?.filter(id => !verticesToDeleteSet.has(id)) || [];

        for (const feature of originalFeatures) {
            let currentFeature = feature;
            let needsUpdate = false;
            let featureShouldBeDeleted = false; // 地物削除フラグ
            const logPrefix = `[UseCase] Feature ${feature?.id}:`; // ★ Log: Prefix for each feature

            // デシリアライズ確認 & インスタンスチェック
            if (!(currentFeature instanceof Point || currentFeature instanceof Line || currentFeature instanceof Polygon)) {
                console.warn(`${logPrefix} Not a valid domain object instance. Skipping. Type: ${typeof currentFeature}`, currentFeature);
                updatedFeatures.push(currentFeature); // 不明なものはそのまま保持
                continue;
            }
            //console.log(`${logPrefix} Processing as ${currentFeature.constructor.name}`); // ★ Log: Feature Type

            // 1. 外周 vertexIds の更新とチェック
            let newVertexIds = currentFeature.vertexIds; // 更新後の頂点IDリスト
            let vertexIdsUpdated = false;
            if (currentFeature.vertexIds && currentFeature.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                console.log(`${logPrefix} Original vertexIds:`, currentFeature.vertexIds); // ★ Log: Original vertexIds
                newVertexIds = filterVertexIds(currentFeature.vertexIds);
                console.log(`${logPrefix} New vertexIds after filter:`, newVertexIds); // ★ Log: New vertexIds
                needsUpdate = true;
                vertexIdsUpdated = true; // 外周が更新されたフラグ

                // --- 形状維持チェック ---
                if (currentFeature instanceof Line && newVertexIds.length < 2) {
                    console.log(`${logPrefix} Line became < 2 vertices. Marking for deletion.`); // ★ Log: Deletion condition
                    featureShouldBeDeleted = true;
                } else if (currentFeature instanceof Polygon && newVertexIds.length < 3) {
                    console.log(`${logPrefix} Polygon outer ring became < 3 vertices.`); // ★ Log: Polygon vertex check
                    //   Polygonインスタンスでない場合のエラーチェックは上で済んでいるはず
                    //   単純ポリゴン(MultiPolygonでなく子もいない)なら削除
                    const isSimpleOrChildless = !currentFeature.isMultiPolygon && !currentFeature.hasChildren();
                    console.log(`${logPrefix} isMultiPolygon: ${currentFeature.isMultiPolygon}, hasChildren: ${currentFeature.hasChildren()}, SimpleOrChildless: ${isSimpleOrChildless}`); // ★ Log: Polygon state
                    if (isSimpleOrChildless) {
                       console.log(`${logPrefix} Simple/Childless Polygon became < 3 vertices. Marking for deletion.`); // ★ Log: Deletion condition
                       featureShouldBeDeleted = true;
                    } else {
                    //   MultiPolygon or 親ポリゴンの場合、外周がなくなっても地物は残る可能性がある
                        console.log(`${logPrefix} Multi/Parent Polygon outer ring became < 3 vertices. Setting vertexIds to null.`); // ★ Log: Setting vertexIds to null
                        // ▼▼▼ 前回の修正箇所 ▼▼▼
                        try {
                           currentFeature = currentFeature.withVertexIds(null); // null を設定
                        } catch(e) {
                           console.error(`${logPrefix} Error calling withVertexIds(null):`, e);
                           featureShouldBeDeleted = true; // エラー時は削除扱いに
                        }
                        // ▲▲▲ 前回の修正箇所 ▲▲▲
                    }
                }
                // 形状が維持される場合は、この後のインスタンス更新ステップで更新される
            }

            // 2. ポリゴンの穴と飛び地の更新 (地物が削除対象でない場合のみ)
            let newHolesVertexIds = currentFeature instanceof Polygon ? (currentFeature.holesVertexIds || []) : [];
            let newSubPolygons = currentFeature instanceof Polygon ? (currentFeature.subPolygons || []) : [];
            let isMultiPolygon = currentFeature instanceof Polygon ? currentFeature.isMultiPolygon : false;
            let polygonSpecificsUpdated = false;

            if (currentFeature instanceof Polygon && !featureShouldBeDeleted) {
                const originalHolesStr = JSON.stringify(newHolesVertexIds); // 比較用
                const originalSubPolygonsStr = JSON.stringify(newSubPolygons); // 比較用

                // --- 穴の更新 ---
                if (newHolesVertexIds.some(hole => hole.some(id => verticesToDeleteSet.has(id)))) {
                    const filteredHoles = newHolesVertexIds
                        .map(hole => filterVertexIds(hole)) // 穴から頂点を削除
                        .filter(hole => hole.length >= 3); // 3点未満の穴は削除
                    if (JSON.stringify(filteredHoles) !== originalHolesStr) {
                        console.log(`${logPrefix} Holes updated. Before: ${originalHolesStr}, After: ${JSON.stringify(filteredHoles)}`); // ★ Log: Holes changed
                        newHolesVertexIds = filteredHoles;
                        needsUpdate = true;
                        polygonSpecificsUpdated = true;
                    }
                }

                // --- 飛び地の更新 ---
                if (isMultiPolygon && newSubPolygons.some(sub => sub.vertexIds?.some(id => verticesToDeleteSet.has(id)))) {
                     const filteredSubPolygons = newSubPolygons
                        .map(sub => ({
                            ...sub,
                            vertexIds: filterVertexIds(sub.vertexIds) // 飛び地から頂点を削除
                            // TODO: 飛び地の穴も更新
                        }))
                        .filter(sub => sub.vertexIds && sub.vertexIds.length >= 3); // 3点未満の飛び地は削除
                    if (JSON.stringify(filteredSubPolygons) !== originalSubPolygonsStr) {
                        console.log(`${logPrefix} SubPolygons updated. Before: ${originalSubPolygonsStr}, After: ${JSON.stringify(filteredSubPolygons)}`); // ★ Log: SubPolygons changed
                        newSubPolygons = filteredSubPolygons;
                        needsUpdate = true;
                        polygonSpecificsUpdated = true;
                    }
                }

                // isMultiPolygon フラグの更新チェック
                // 更新後の外周(newVertexIds)と飛び地(newSubPolygons)で判定
                const mainBodyExistsAfterUpdate = vertexIdsUpdated ? (newVertexIds && newVertexIds.length >= 3) : (currentFeature.vertexIds && currentFeature.vertexIds.length >= 3);
                const totalParts = (mainBodyExistsAfterUpdate ? 1 : 0) + newSubPolygons.length;
                console.log(`${logPrefix} MultiPolygon check: mainBodyExists=${mainBodyExistsAfterUpdate}, subPolygonsCount=${newSubPolygons.length}, totalParts=${totalParts}`); // ★ Log: MultiPolygon Check

                if (totalParts < 1) { // 本体も飛び地も全てなくなった場合
                    console.log(`${logPrefix} All parts disappeared. Marking for deletion.`); // ★ Log: Deletion condition
                    featureShouldBeDeleted = true;
                } else {
                     const shouldBeMultiPolygon = totalParts >= 2;
                     if (isMultiPolygon !== shouldBeMultiPolygon) {
                         console.log(`${logPrefix} isMultiPolygon changed from ${isMultiPolygon} to ${shouldBeMultiPolygon}`); // ★ Log: isMultiPolygon changed
                         isMultiPolygon = shouldBeMultiPolygon;
                         needsUpdate = true;
                         polygonSpecificsUpdated = true;
                     }
                }
            }

            // 3. 地物インスタンスの更新 (必要な場合のみ)
            let finalFeature = currentFeature; // 更新後のインスタンスを入れる変数
            if (!featureShouldBeDeleted && needsUpdate) {
                 console.log(`${logPrefix} Needs update. Generating new instance...`); // ★ Log: Needs update
                 try {
                     if (currentFeature instanceof Point) {
                         if (vertexIdsUpdated && newVertexIds.length === 1) {
                             finalFeature = currentFeature.withVertexIds(newVertexIds);
                         } else if (vertexIdsUpdated && newVertexIds.length === 0) {
                             console.log(`${logPrefix} Point lost its vertex. Marking for deletion.`); // ★ Log: Point deletion
                             featureShouldBeDeleted = true; // Pointは頂点がなくなったら削除
                         }
                     } else if (currentFeature instanceof Line) {
                         if (vertexIdsUpdated) { // 線は外周更新のみ
                             finalFeature = currentFeature.withVertexIds(newVertexIds);
                         }
                     } else if (currentFeature instanceof Polygon) {
                         let tempFeature = currentFeature;
                         if (vertexIdsUpdated) {
                            // null も渡せるように修正済みのはず
                            tempFeature = tempFeature.withVertexIds(newVertexIds.length > 0 ? newVertexIds : null);
                         }
                         if (polygonSpecificsUpdated) {
                             tempFeature = tempFeature.withHolesVertexIds(newHolesVertexIds)
                                                   .withMultiPolygonData(isMultiPolygon, newSubPolygons);
                         }
                         finalFeature = tempFeature;
                     } else {
                         console.error(`${logPrefix} Cannot update feature: Unknown type or invalid instance state.`);
                         finalFeature = currentFeature; // 不明な場合は元のまま（またはエラー）
                     }
                     if (!featureShouldBeDeleted) { // featureShouldBeDeleted が true になった場合は更新しない
                        updatedFeatureIds.add(finalFeature.id);
                        console.log(`${logPrefix} Instance updated successfully.`); // ★ Log: Update success
                     }
                 } catch (e) {
                      console.error(`${logPrefix} Error updating feature instance:`, e);
                      featureShouldBeDeleted = true; // 不整合が起きる可能性があるので削除扱いにする
                      console.log(`${logPrefix} Marked for deletion due to update error.`); // ★ Log: Deletion due to error
                 }
            } else if (!featureShouldBeDeleted) {
                finalFeature = currentFeature; // 更新不要なら元のインスタンス
                //console.log(`${logPrefix} No update needed.`); // ★ Log: No update needed (verbose)
            }

            // 4. 最終結果の処理
            if (featureShouldBeDeleted) {
                console.log(`${logPrefix} Final decision: DELETE.`); // ★ Log: Final DELETE
                deletedFeatureIds.add(finalFeature.id); // 削除対象IDを追加
                if (finalFeature.parentId && finalFeature.parentId !== "0") {
                    if (!parentUpdatesNeeded.has(finalFeature.parentId)) {
                        parentUpdatesNeeded.set(finalFeature.parentId, []);
                    }
                    parentUpdatesNeeded.get(finalFeature.parentId).push(finalFeature.id);
                }
            } else {
                //console.log(`${logPrefix} Final decision: KEEP/UPDATE.`); // ★ Log: Final KEEP/UPDATE (verbose)
                updatedFeatures.push(finalFeature); // 更新後または元のインスタンスをリストに追加
            }
        } // End of loop

        console.log(`[UseCase] Loop finished. Updated features count: ${updatedFeatures.length}, To delete: ${deletedFeatureIds.size}`); // ★ Log: Loop end stats

        // 5. 親ポリゴンの childIds 更新
        if (parentUpdatesNeeded.size > 0) {
            console.log(`[UseCase] Updating parent childIds...`, parentUpdatesNeeded); // ★ Log: Parent update
            const featuresWithUpdatedParents = [];
            for(let feature of updatedFeatures) {
                if (parentUpdatesNeeded.has(feature.id) && feature instanceof Polygon) {
                   const childrenToRemove = parentUpdatesNeeded.get(feature.id);
                   let updatedParent = feature;
                   childrenToRemove.forEach(childId => {
                       updatedParent = updatedParent.removeChildId(childId);
                   });
                   featuresWithUpdatedParents.push(updatedParent);
                   updatedFeatureIds.add(updatedParent.id); // 親も更新された
                   console.log(`[UseCase] Parent ${updatedParent.id} updated. Removed children:`, childrenToRemove); // ★ Log: Parent updated
                } else {
                    featuresWithUpdatedParents.push(feature);
                }
            }
            world.features = featuresWithUpdatedParents; // 更新されたリストで置き換え
        } else {
           world.features = updatedFeatures; // 更新されたリストで置き換え
        }


        // 6. 頂点リストから削除対象を物理的に削除
        const verticesBeforeDelete = world.vertices.length;
        world.vertices = world.vertices.filter(v => !verticesToDeleteSet.has(v.id));
        const deletedVertexCount = verticesBeforeDelete - world.vertices.length;
        console.log(`[UseCase] Physically deleted ${deletedVertexCount} vertices from world.vertices.`); // ★ Log: Vertex deletion count


        // 7. 不要になった頂点をさらにクリーンアップ
        const allRemainingVertexIds = new Set();
        world.features.forEach(f => {
            try {
                f.vertexIds?.forEach(id => allRemainingVertexIds.add(id));
                if (f instanceof Polygon) {
                     f.holesVertexIds?.flat().forEach(id => allRemainingVertexIds.add(id));
                     f.subPolygons?.forEach(sub => sub.vertexIds?.forEach(id => allRemainingVertexIds.add(id)));
                }
            } catch (e) {
                 console.error(`[UseCase] Error accessing properties of feature ${f?.id} during cleanup check:`, e);
            }
        });
        const verticesBeforeCleanup = world.vertices.length;
        world.vertices = world.vertices.filter(v => allRemainingVertexIds.has(v.id));
        const cleanedUpCount = verticesBeforeCleanup - world.vertices.length;
        if (cleanedUpCount > 0) {
            // このログメッセージは頂点削除後に必ず出るはず
            console.log(`[UseCase] Cleaned up ${cleanedUpCount} additional unused vertices.`); // ★ Log: Cleanup count
        }

        // 8. 世界データを保存
        console.log(`[UseCase] Saving world... Features: ${world.features.length}, Vertices: ${world.vertices.length}`); // ★ Log: Saving world
        await this._worldRepository.saveWorld(world);

        const result = {
            deletedVertexIds: Array.from(verticesToDeleteSet),
            updatedFeatureIds: Array.from(updatedFeatureIds),
            deletedFeatureIds: Array.from(deletedFeatureIds)
        };
        console.log('[UseCase] deleteVertices finished. Result:', result); // ★ Log: Final result
        return result;
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
    // Vertexクラスがない場合を考慮し、プレーンオブジェクトで扱う
    let currentVertexData = { id: vertex.id, x: vertex.x, y: vertex.y };
    const updatedVertexData = {
         id: vertex.id,
         x: adjustedPosition.x,
         y: adjustedPosition.y
     };


    // 更新されたプレーンオブジェクトを保存（リポジトリがプレーンオブジェクトを期待する場合）
    world.vertices[vertexIndex] = updatedVertexData;

    // この頂点を使用するすべての地理オブジェクトを特定
    const affectedFeatures = world.features.filter(f => {
         // Check if feature is a valid object before accessing properties
         if (!f || typeof f !== 'object') return false;
         return (f.vertexIds && f.vertexIds.includes(vertexId)) ||
                (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertexId))) ||
                (f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds && sub.vertexIds.includes(vertexId)));
     }).map(f => {
         // Return a serializable representation or a clone if needed,
         // as the original objects in world.features might be mutated later.
         // For now, returning the reference, assuming downstream consumers handle it.
         return f;
     });


    // 世界データを保存
    await this._worldRepository.saveWorld(world);

    // 返り値もプレーンオブジェクトにする
    return {
      vertex: updatedVertexData, // 更新されたプレーンオブジェクト
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

      // Check if feature is a valid object and has expected methods
      const isValidFeature = feature && typeof feature === 'object';
      const hasWithVertexIds = isValidFeature && typeof feature.withVertexIds === 'function';
      const isPolygon = isValidFeature && feature.constructor?.name === 'Polygon'; // Use constructor name as fallback
      const hasWithHolesVertexIds = isPolygon && typeof feature.withHolesVertexIds === 'function';
      const hasWithMultiPolygonData = isPolygon && typeof feature.withMultiPolygonData === 'function';


      // vertexIds の更新
      if (hasWithVertexIds && feature.vertexIds && feature.vertexIds.includes(removedVertexId)) {
        const newVertexIds = feature.vertexIds.map(id =>
          id === removedVertexId ? keptVertexId : id
        );
        feature = feature.withVertexIds(newVertexIds);
        updated = true;
      }

      // ポリゴンの穴についても処理
      if (hasWithHolesVertexIds && feature.holesVertexIds && feature.holesVertexIds.length > 0) {
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
      if (hasWithMultiPolygonData && feature.isMultiPolygon && feature.subPolygons) {
          let subPolygonsUpdated = false;
          const newSubPolygons = feature.subPolygons.map(sub => {
              if (sub.vertexIds && sub.vertexIds.includes(removedVertexId)) {
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
     // Check if feature is valid before accessing properties
     if (!feature || typeof feature !== 'object') {
         throw new Error(`Invalid feature object found for ID: ${featureId}`);
     }


    // が指定された頂点を使用しているか確認 (穴と飛び地も)
    const isPolygon = feature.constructor?.name === 'Polygon'; // Use constructor name as fallback
    const usesVertex = (feature.vertexIds && feature.vertexIds.includes(vertexId)) ||
                     (isPolygon && feature.holesVertexIds?.some(hole => hole.includes(vertexId))) ||
                     (isPolygon && feature.isMultiPolygon && feature.subPolygons?.some(sub => sub.vertexIds && sub.vertexIds.includes(vertexId)));


    if (!usesVertex) {
      throw new Error(`Feature ${featureId} does not use vertex with ID: ${vertexId}`);
    }

    // 新しい頂点を作成
    const newVertexId = this._generateId('vertex');
    // Vertex インスタンスを生成してからプレーンオブジェクトにする
    // Vertexクラスがない場合を考慮し、プレーンオブジェクトで扱う
    const newVertex = { id: newVertexId, x: vertex.x, y: vertex.y };
    world.vertices.push(newVertex);


    let updated = false;
     const hasWithVertexIds = typeof feature.withVertexIds === 'function';
     const hasWithHolesVertexIds = isPolygon && typeof feature.withHolesVertexIds === 'function';
     const hasWithMultiPolygonData = isPolygon && typeof feature.withMultiPolygonData === 'function';


    // の頂点IDsを更新
    if (hasWithVertexIds && feature.vertexIds && feature.vertexIds.includes(vertexId)) {
        const newVertexIds = feature.vertexIds.map(id =>
            id === vertexId ? newVertexId : id
        );
        feature = feature.withVertexIds(newVertexIds);
        updated = true;
    }


    // ポリゴンの穴についても処理
    if (hasWithHolesVertexIds && feature.holesVertexIds && feature.holesVertexIds.length > 0) {
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
    if (hasWithMultiPolygonData && feature.isMultiPolygon && feature.subPolygons) {
        let subPolygonsUpdated = false;
        const newSubPolygons = feature.subPolygons.map(sub => {
            if (sub.vertexIds && sub.vertexIds.includes(vertexId)) {
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
      f.id === polygonId && f instanceof Polygon // Use instanceof for safety
    );

    if (polygonIndex === -1) {
      throw new Error(`Polygon not found with ID: ${polygonId}`);
    }

    const polygon = world.features[polygonIndex];
     // Check if polygon is a valid Polygon instance
     if (!(polygon instanceof Polygon)) {
         throw new Error(`Feature ${polygonId} is not a valid Polygon.`);
     }


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

      // Get the first property for copying (assuming properties array is not empty)
      const baseProperties = polygon.properties && polygon.properties.length > 0 ? [polygon.properties[0]] : [];


      // 新しいポリゴン1
      const newPoly1Id = this._generateId('polygon');
      const newPoly1 = Polygon.create(
        newPoly1Id,
        baseProperties, // 元のプロパティをコピー
        {
          vertexIds: polygon.vertexIds ? [...polygon.vertexIds.slice(0, Math.ceil(polygon.vertexIds.length / 2))] : [],
          holesVertexIds: [],
          parentId: polygon.parentId
        },
        polygon.layerId
      );

      // 新しいポリゴン2
      const newPoly2Id = this._generateId('polygon');
      const newPoly2 = Polygon.create(
        newPoly2Id,
        properties ? [properties] : baseProperties, // 指定されたプロパティまたは元のプロパティ
        {
          vertexIds: polygon.vertexIds ? [...polygon.vertexIds.slice(Math.floor(polygon.vertexIds.length / 2))] : [],
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
      const updatedHoles = [...(polygon.holesVertexIds || []), holeVertexIds];
      const updatedPolygon = polygon.withHolesVertexIds(updatedHoles);

       // Get the first property for copying (assuming properties array is not empty)
      const baseProperties = polygon.properties && polygon.properties.length > 0 ? [polygon.properties[0]] : [];


      // 穴から新しいポリゴンを作成
      const newPolyId = this._generateId('polygon');
      const newPoly = Polygon.create(
        newPolyId,
        newPolygonProperties ? [newPolygonProperties] : baseProperties,
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
      console.log(`Deleted original polygon ${polygonId} after bisect split.`);
      // 親の子リストからも削除する必要がある
        if (polygon.parentId !== "0") {
            const parentIndex = world.features.findIndex(f => f.id === polygon.parentId);
            if (parentIndex !== -1 && world.features[parentIndex] instanceof Polygon) {
                const parent = world.features[parentIndex];
                if (typeof parent.removeChildId === 'function') {
                   const updatedParent = parent.removeChildId(polygonId);
                   world.features[parentIndex] = updatedParent;
                } else {
                     console.warn(`Parent polygon ${polygon.parentId} is missing removeChildId method.`);
                 }
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
      f.id === polygonId && f instanceof Polygon // Use instanceof for safety
    );

    if (polygonIndex === -1) {
      throw new Error(`Polygon not found with ID: ${polygonId}`);
    }

    const polygon = world.features[polygonIndex];
     // Check if polygon is a valid Polygon instance
     if (!(polygon instanceof Polygon)) {
         throw new Error(`Feature ${polygonId} is not a valid Polygon.`);
     }


    // 下位領域を持つポリゴンは所属変更不可
    if (polygon.hasChildren()) {
      throw new Error('Cannot change parent of a polygon that has child polygons');
    }

    // 新しい親を検索
    let newParent = null;
    let newParentIndex = -1;
    if (newParentId !== "0") {
      newParentIndex = world.features.findIndex(f =>
        f.id === newParentId && f instanceof Polygon // Use instanceof for safety
      );

      if (newParentIndex === -1) {
        throw new Error(`Parent polygon not found or is not a Polygon: ${newParentId}`);
      }

      newParent = world.features[newParentIndex];
      if (!(newParent instanceof Polygon)) {
           throw new Error(`Parent feature ${newParentId} is not a valid Polygon.`);
      }


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
        f.id === polygon.parentId && f instanceof Polygon // Use instanceof for safety
      );

      if (oldParentIndex !== -1) {
        oldParent = world.features[oldParentIndex];
        if (oldParent instanceof Polygon && typeof oldParent.removeChildId === 'function') {
           const updatedOldParent = oldParent.removeChildId(polygonId);
           world.features[oldParentIndex] = updatedOldParent;
        } else {
           console.warn(`Old parent ${polygon.parentId} is not a valid Polygon or missing removeChildId.`);
        }
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
          if (currentNewParent instanceof Polygon && typeof currentNewParent.addChildId === 'function') {
             const updatedNewParent = currentNewParent.addChildId(polygonId);
             world.features[currentNewParentIndex] = updatedNewParent;
          } else {
             console.warn(`New parent ${newParentId} is not a valid Polygon or missing addChildId.`);
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
      f instanceof Polygon && // Check if f is an instance of Polygon
      ((f.vertexIds && f.vertexIds.includes(vertex.id)) ||
       (f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertex.id))) ||
       (f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds && sub.vertexIds.includes(vertex.id)))) // Added null checks
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
          const isUsed = world.features.some(f => {
               // Check if f is a valid object before accessing properties
               if (!f || typeof f !== 'object') return false;
               const isPolygon = f.constructor?.name === 'Polygon'; // Use constructor name as fallback
               return (f.vertexIds && f.vertexIds.includes(vertexId)) ||
                      (isPolygon && f.holesVertexIds?.some(hole => hole.includes(vertexId))) ||
                      (isPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds && sub.vertexIds.includes(vertexId)));
           });


          if (!isUsed) {
              verticesToRemove.add(vertexId);
          }
      }

      if (verticesToRemove.size > 0) {
          world.vertices = world.vertices.filter(v => !verticesToRemove.has(v.id));
          // ★★★ このログは deleteVertices 内のログと重複する可能性がある
          console.log(`[UseCase] Cleaned up ${verticesToRemove.size} unused vertices (via _cleanupUnusedVertices).`);
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
    if (timestamp1 === timestamp2 || isNaN(timestamp1) || isNaN(timestamp2)) {
        return id1 <= id2 ? id1 : id2;
    }

    return timestamp1 < timestamp2 ? id1 : id2;
  }
}
