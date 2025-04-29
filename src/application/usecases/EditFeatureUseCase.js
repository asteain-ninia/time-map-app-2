import { Feature } from '../../domain/entities/Feature';
import { Point } from '../../domain/entities/Point';
import { Line } from '../../domain/entities/Line';
import { Polygon } from '../../domain/entities/Polygon';
// Vertex クラスもインポートしておく (データ比較用など)
import { Vertex } from '../../domain/entities/Vertex';
// Property クラスもインポート (updateFeatureの型チェック用)
import { Property } from '../../domain/value-objects/Property';


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
   * @param {Property[]} properties - プロパティ情報 (Propertyインスタンスの配列)
   * @param {Object} geometry - 形状情報 { vertices?: {x,y}[], vertexIds?: string[], holesVertexIds?: string[][], parentId?: string, isMultiPolygon?: boolean, subPolygons?: object[] }
   * @param {string} layerId - レイヤーID
   * @returns {Promise<Feature>} 追加されたオブジェクト
   */
  async addFeature(featureType, properties, geometry, layerId) {
    if (!Array.isArray(properties) || !properties.every(p => p instanceof Property)) {
        console.error("addFeature: properties must be an array of Property instances.", properties);
        throw new Error("Invalid properties format.");
    }
    const world = await this._worldRepository.getWorld();

    // IDの生成
    const featureId = this._generateId(featureType);

    // 形状情報の検証とID割り当て
    // processedGeometry は { vertexIds?, holesVertexIds?, parentId?, isMultiPolygon?, subPolygons? } を持つ
    const processedGeometry = this._processGeometry(geometry, world);

    // 適切なファクトリーメソッドを使用して地物オブジェクトを作成
    let feature;
    switch (featureType) {
      case 'point':
        // Point.create は geometry.vertexId を期待するが、
        // processedGeometry は geometry.vertexIds (配列) を持つため、
        // 最初の要素を geometry.vertexId として渡す
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length !== 1) {
            throw new Error("Point geometry must have exactly one vertexId.");
        }
        // Point.create は geometry.vertexId を期待するので、それに合わせる
        const pointGeometry = { vertexId: processedGeometry.vertexIds[0] };
        feature = Point.create(featureId, properties, pointGeometry, layerId);
        break;
      case 'line':
        if (!processedGeometry.vertexIds || processedGeometry.vertexIds.length < 2) {
            throw new Error("Line geometry must have at least two vertexIds.");
        }
        // Line.create は geometry { vertexIds } を期待
        const lineGeometry = { vertexIds: processedGeometry.vertexIds };
        feature = Line.create(featureId, properties, lineGeometry, layerId);
        break;
      case 'polygon':
        // ポリゴンの場合、レイヤー内での排他性と階層関係の検証
        this._validatePolygonAddition(processedGeometry, layerId, world);
        // Polygon.create は geometry { vertexIds?, holesVertexIds?, parentId?, isMultiPolygon?, subPolygons?, childIds? } を期待
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
   * @param {Object} updates - 更新内容 { properties?: Property[], geometry?: Object, layerId?: string }
   *                         geometry: {
   *                           vertices?: {x,y}[], // 新しい頂点座標 (ID生成が必要)
   *                           vertexIds?: string[], // 外周の頂点ID配列
   *                           holes?: {x,y}[][], // 新しい穴の頂点座標配列 (ID生成が必要)
   *                           holesVertexIds?: string[][], // トップレベルの穴の頂点ID配列
   *                           parentId?: string,
   *                           isMultiPolygon?: boolean,
   *                           subPolygons?: { vertexIds: string[], holesVertexIds: string[][] }[], // 飛び地全体の上書き
   *                           newSubPolygonVertices?: {x,y}[], // 新しい飛び地の頂点座標 (ID生成が必要)
   *                           targetSubPolygonIndex?: number, // 穴追加対象の飛び地インデックス
   *                           newHolesForSubPolygon?: {x,y}[][] // 飛び地に追加する新しい穴の頂点座標 (ID生成が必要)
   *                         }
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
        if (!Array.isArray(updates.properties) || !updates.properties.every(p => p instanceof Property)) {
           console.warn("updateFeature received 'properties' but it's not an array of Property instances. Attempting to proceed, but this might cause issues.", updates.properties);
           // 必要ならここでインスタンス化を試みる or エラーにする
           throw new Error("Invalid properties format: must be an array of Property instances.");
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
      // geometry の処理: 新しい頂点/穴/飛び地のID生成と、既存IDの処理
      // _processGeometry は新しい頂点/穴/飛び地(newSubPolygonVertices)を処理しIDを割り当てる
      // processedGeometry には、新しく生成された頂点IDも含まれる
      const processedGeometry = this._processGeometry(updates.geometry, world);

      // Null check for feature before proceeding
      if (!feature) {
          console.error(`Feature ${featureId} became null unexpectedly after property update.`);
          throw new Error(`Feature object invalid after property update for ID: ${featureId}`);
      }

      // オブジェクトタイプごとの検証と処理
      if (feature instanceof Polygon) {
        // --- 事前検証 ---
        // Note: 形状変更を伴う場合は、変更後の形状で検証する必要がある
        // const potentialUpdatedFeature = feature.with... // 仮の更新インスタンスで検証
        this._validatePolygonUpdate(processedGeometry, feature, world);

        // --- 飛び地追加処理 (newSubPolygonVerticesがある場合) ---
        if (processedGeometry.newSubPolygonVertices) { // vertices ではなく newSubPolygonVertices
            if (!processedGeometry.newSubPolygonVertexIds || processedGeometry.newSubPolygonVertexIds.length < 3) {
                 throw new Error("New enclave must have at least three vertices.");
            }
            const newSubPolygon = {
                 vertexIds: processedGeometry.newSubPolygonVertexIds,
                 holesVertexIds: [] // 新しい飛び地に穴はまだない
            };
            // 検証 (自己交差、他との重複など)
            this._validateSubPolygon(newSubPolygon, feature, world);

            const existingSubPolygons = feature.subPolygons || [];
            const updatedSubPolygons = [...existingSubPolygons, newSubPolygon];
            // Polygon インスタンスを更新 (withMultiPolygonDataを使用)
            feature = feature.withMultiPolygonData(true, updatedSubPolygons);
        } else {
            // --- 通常のジオメトリ更新 (外周、穴、飛び地の穴など) ---

            // 外周 (vertexIds) の更新
            if (processedGeometry.vertexIds !== undefined) {
              feature = feature.withVertexIds(processedGeometry.vertexIds);
            }

            // トップレベルの穴 (holesVertexIds) の更新
            if (processedGeometry.holesVertexIds) {
              // 穴の検証もここで行うべき
              processedGeometry.holesVertexIds.forEach(hole => this._validatePolygonHole(hole, feature, world, null)); // index=null は本土を示す
              feature = feature.withHolesVertexIds(processedGeometry.holesVertexIds);
            }

            // 特定の飛び地内の穴 (newHolesVertexIdsForSubPolygon) の更新
            if (processedGeometry.targetSubPolygonIndex !== undefined &&
                processedGeometry.newHolesVertexIdsForSubPolygon) {
                const targetIndex = processedGeometry.targetSubPolygonIndex;
                const newHoles = processedGeometry.newHolesVertexIdsForSubPolygon;

                if (targetIndex >= 0 && targetIndex < feature.subPolygons.length) {
                     // 穴の検証
                     newHoles.forEach(hole => this._validatePolygonHole(hole, feature, world, targetIndex));
                     // 既存の穴と新しい穴を結合
                     const currentSubPolygon = feature.subPolygons[targetIndex];
                     const combinedHoles = [...(currentSubPolygon.holesVertexIds || []), ...newHoles];
                     // Polygonエンティティの新しいメソッドで更新
                     feature = feature.withSubPolygonHoles(targetIndex, combinedHoles);
                } else {
                     console.warn(`Invalid targetSubPolygonIndex: ${targetIndex}`);
                     throw new Error(`Invalid target sub-polygon index for adding holes: ${targetIndex}`);
                }
            }


            // 親IDの更新
            if (processedGeometry.parentId !== undefined) {
              feature = feature.withParentId(processedGeometry.parentId);
            }

            // 飛び地情報全体の上書き (isMultiPolygonフラグやsubPolygons配列自体の上書き)
            // 注意: これは飛び地の穴追加とは排他的に行われるべき
            if (processedGeometry.isMultiPolygon !== undefined && processedGeometry.subPolygons) {
              // 検証
              (processedGeometry.subPolygons || []).forEach(sub => this._validateSubPolygon(sub, feature, world));
              feature = feature.withMultiPolygonData(
                processedGeometry.isMultiPolygon,
                processedGeometry.subPolygons || []
              );
            }
        }

      } else { // Point or Line
        // 点または線の頂点IDsの更新
        if (processedGeometry.vertexIds !== undefined) {
          // Null check for feature before calling withVertexIds
          if (feature && typeof feature.withVertexIds === 'function') {
             if (feature instanceof Point && processedGeometry.vertexIds.length !== 1) {
                 throw new Error("Point must have exactly one vertexId.");
             }
             if (feature instanceof Line && processedGeometry.vertexIds.length < 2) {
                  throw new Error("Line must have at least two vertexIds.");
             }
             feature = feature.withVertexIds(processedGeometry.vertexIds);
          } else {
             console.error(`Feature ${featureId} is invalid or missing withVertexIds method (Point/Line).`);
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

    if (updates.layerId !== undefined) {
      if (typeof feature.withLayerId === 'function') {
         // TODO: レイヤー変更に伴う親子関係などの検証
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
    }

    const feature = world.features[featureIndex];
    // Check if feature is valid before accessing properties
    if (!feature) {
        console.error(`Invalid feature data found at index ${featureIndex} for ID ${featureId}`);
        world.features.splice(featureIndex, 1); // Remove invalid data
        await this._worldRepository.saveWorld(world);
        return;
    }
    // 削除対象の全頂点IDを収集
    const vertexIdsToCheck = new Set();
    if (feature.vertexIds) feature.vertexIds.forEach(id => vertexIdsToCheck.add(id));
    if (feature instanceof Polygon) {
        feature.holesVertexIds?.forEach(hole => hole.forEach(id => vertexIdsToCheck.add(id)));
        if(feature.isMultiPolygon && feature.subPolygons) {
            feature.subPolygons.forEach(sub => {
                sub.vertexIds?.forEach(id => vertexIdsToCheck.add(id));
                sub.holesVertexIds?.forEach(hole => hole.forEach(id => vertexIdsToCheck.add(id))); // 飛び地の穴も考慮
            });
        }
    }


    // ポリゴンの場合、依存関係をチェック
    if (feature instanceof Polygon) {
      // 下位領域がある場合は削除不可 (要件確認: 削除して子も削除 or 削除不可)
      // 現状は削除不可とする
      if (feature.hasChildren()) {
        throw new Error('Cannot delete a polygon that has child polygons. Remove children first.');
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
    this._cleanupUnusedVertices(world, Array.from(vertexIdsToCheck)); // Set を Array に変換

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
        if (!vertexIdsToDelete || vertexIdsToDelete.length === 0) {
            return { deletedVertexIds: [], updatedFeatureIds: [], deletedFeatureIds: [] };
        }
        const world = await this._worldRepository.getWorld();
        const verticesToDeleteSet = new Set(vertexIdsToDelete);

        const originalFeatures = world.features;
        const updatedFeatures = []; // 更新後の地物リスト
        const updatedFeatureIds = new Set();
        const deletedFeatureIds = new Set();
        const parentUpdatesNeeded = new Map(); // { parentId: [childIdToRemove] }

        // 削除対象の頂点IDを除外するヘルパー関数
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

            // 1. 外周 vertexIds の更新とチェック
            let newVertexIds = currentFeature.vertexIds; // 更新後の頂点IDリスト
            let vertexIdsUpdated = false;
            if (currentFeature.vertexIds && currentFeature.vertexIds.some(id => verticesToDeleteSet.has(id))) {
                newVertexIds = filterVertexIds(currentFeature.vertexIds);
                needsUpdate = true;
                vertexIdsUpdated = true; // 外周が更新されたフラグ

                // --- 形状維持チェック ---
                if (currentFeature instanceof Point && newVertexIds.length === 0) {
                    featureShouldBeDeleted = true;
                } else if (currentFeature instanceof Line && newVertexIds.length < 2) {
                    featureShouldBeDeleted = true;
                } else if (currentFeature instanceof Polygon && newVertexIds.length < 3) {
                    // ポリゴンの場合、外周が3点未満になっても、飛び地や子があれば地物は残る可能性がある
                    // isMultiPolygon かつ subPolygons が存在するか、または childIds が存在するかチェック
                    const hasOtherParts = (currentFeature.isMultiPolygon && currentFeature.subPolygons?.length > 0) || currentFeature.hasChildren();
                    if (!hasOtherParts) {
                       featureShouldBeDeleted = true; // 単純ポリゴンは削除
                    } else {
                       // MultiPolygon or 親ポリゴンの場合、外周がなくなっても地物は残る
                       // 頂点IDリストを null または空配列に設定する (後続のインスタンス更新ステップで)
                       newVertexIds = null; // null を設定して形状がないことを示す
                    }
                }
            }

            // 2. ポリゴンの穴と飛び地の更新 (地物が削除対象でない場合のみ)
            let newHolesVertexIds = currentFeature instanceof Polygon ? (currentFeature.holesVertexIds || []) : [];
            let newSubPolygons = currentFeature instanceof Polygon ? (currentFeature.subPolygons || []) : [];
            let isMultiPolygon = currentFeature instanceof Polygon ? currentFeature.isMultiPolygon : false;
            let polygonSpecificsUpdated = false;

            if (currentFeature instanceof Polygon && !featureShouldBeDeleted) {
                const originalHolesStr = JSON.stringify(newHolesVertexIds);
                const originalSubPolygonsStr = JSON.stringify(newSubPolygons);
                let holesChanged = false;
                let subPolygonsChanged = false;

                // --- 穴の更新 ---
                if (newHolesVertexIds.some(hole => hole.some(id => verticesToDeleteSet.has(id)))) {
                    const filteredHoles = newHolesVertexIds
                        .map(hole => filterVertexIds(hole))
                        .filter(hole => hole.length >= 3); // 3点未満の穴は削除
                    if (JSON.stringify(filteredHoles) !== originalHolesStr) {
                        newHolesVertexIds = filteredHoles;
                        holesChanged = true;
                    }
                }

                // --- 飛び地の更新 ---
                if (isMultiPolygon && newSubPolygons.some(sub => sub.vertexIds?.some(id => verticesToDeleteSet.has(id)))) {
                     const filteredSubPolygons = newSubPolygons
                        .map(sub => {
                            const filteredSubVertexIds = filterVertexIds(sub.vertexIds);
                            // TODO: 飛び地の穴も更新する必要がある
                            const filteredSubHoleVertexIds = (sub.holesVertexIds || [])
                                .map(hole => filterVertexIds(hole))
                                .filter(hole => hole.length >= 3);
                            return {
                                vertexIds: filteredSubVertexIds,
                                holesVertexIds: filteredSubHoleVertexIds
                            };
                        })
                        .filter(sub => sub.vertexIds && sub.vertexIds.length >= 3); // 3点未満の飛び地は削除
                    if (JSON.stringify(filteredSubPolygons) !== originalSubPolygonsStr) {
                        newSubPolygons = filteredSubPolygons;
                        subPolygonsChanged = true;
                    }
                }

                // 更新があった場合
                if (holesChanged || subPolygonsChanged) {
                    needsUpdate = true;
                    polygonSpecificsUpdated = true;
                }

                // isMultiPolygon フラグと地物削除の最終チェック
                // 更新後の外周が存在するかどうか (vertexIdsUpdatedフラグで判定)
                const mainBodyExistsAfterUpdate = vertexIdsUpdated ? (newVertexIds && newVertexIds.length >= 3) : currentFeature.hasDirectGeometry();
                // 更新後のパーツ数を計算
                const totalPartsAfterUpdate = (mainBodyExistsAfterUpdate ? 1 : 0) + newSubPolygons.length;

                if (totalPartsAfterUpdate < 1) { // 本体も飛び地も全てなくなった場合
                    // 子がいれば地物自体は残すが、形状はなくなる
                    if (!currentFeature.hasChildren()) {
                       featureShouldBeDeleted = true; // 子もいなければ地物を削除
                    } else {
                        // 子がいる場合は形状がなくても地物自体は残す
                        if (vertexIdsUpdated) newVertexIds = null; // 外周をnullに
                        isMultiPolygon = false; // MultiPolygonではなくなる
                        newSubPolygons = []; // サブポリゴンもなくなる
                        needsUpdate = true; // 状態が変わったので更新要
                        polygonSpecificsUpdated = true;
                    }
                } else { // パーツが残る場合
                     const shouldBeMultiPolygon = totalPartsAfterUpdate >= 2 || (totalPartsAfterUpdate === 1 && !mainBodyExistsAfterUpdate); // パーツが2つ以上、またはパーツが1つでそれが飛び地の場合
                     if (isMultiPolygon !== shouldBeMultiPolygon) {
                         isMultiPolygon = shouldBeMultiPolygon;
                         needsUpdate = true;
                         polygonSpecificsUpdated = true;
                     }
                }
            }

            // 3. 地物インスタンスの更新 (必要な場合のみ)
            let finalFeature = currentFeature;
            if (!featureShouldBeDeleted && needsUpdate) {
                 try {
                     let tempFeature = currentFeature; // 更新用の一時変数
                     if (tempFeature instanceof Point) {
                         if (newVertexIds.length === 0) throw new Error("Point deleted");
                         finalFeature = tempFeature.withVertexIds(newVertexIds);
                     } else if (tempFeature instanceof Line) {
                         if (newVertexIds.length < 2) throw new Error("Line deleted");
                         finalFeature = tempFeature.withVertexIds(newVertexIds);
                     } else if (tempFeature instanceof Polygon) {
                         // vertexIds の更新
                         if (vertexIdsUpdated) {
                             tempFeature = tempFeature.withVertexIds(newVertexIds); // null も許容
                         }
                         // 穴、isMultiPolygon, subPolygons の更新
                         if (polygonSpecificsUpdated) {
                             // Note: withMultiPolygonData は isMultiPolygon が false なら subPolygons を空にする
                             tempFeature = tempFeature.withHolesVertexIds(newHolesVertexIds)
                                                    .withMultiPolygonData(isMultiPolygon, newSubPolygons);
                         }
                         finalFeature = tempFeature; // 更新結果を finalFeature に代入
                     } else {
                         console.error(`${logPrefix} Cannot update feature: Unknown type or invalid instance state.`);
                         // 不明な型はそのままにするが、更新フラグが立っているのは不自然
                         needsUpdate = false; // 更新フラグを落とす
                         finalFeature = currentFeature;
                     }
                     if (needsUpdate) updatedFeatureIds.add(finalFeature.id);
                 } catch (e) {
                      console.error(`${logPrefix} Error updating feature instance:`, e);
                      // インスタンス更新でエラーになった場合、削除対象とする
                      featureShouldBeDeleted = true;
                 }
            } else if (!featureShouldBeDeleted) {
                // 更新不要でも削除対象でなければリストに残す
                finalFeature = currentFeature;
            }

            // 4. 最終結果の処理
            if (featureShouldBeDeleted) {
                deletedFeatureIds.add(finalFeature.id);
                // 親ポリゴンから childId を削除する必要がある場合、情報を記録
                if (finalFeature.parentId && finalFeature.parentId !== "0") {
                    if (!parentUpdatesNeeded.has(finalFeature.parentId)) {
                        parentUpdatesNeeded.set(finalFeature.parentId, []);
                    }
                    parentUpdatesNeeded.get(finalFeature.parentId).push(finalFeature.id);
                }
            } else {
                // 削除対象でない場合は、更新後の地物リストに追加
                updatedFeatures.push(finalFeature);
            }
        } // End of feature loop

        // 5. 親ポリゴンの childIds 更新
        if (parentUpdatesNeeded.size > 0) {
            const featuresWithUpdatedParents = [];
            for(let feature of updatedFeatures) { // updatedFeatures (削除されなかった地物リスト) を走査
                if (parentUpdatesNeeded.has(feature.id) && feature instanceof Polygon) {
                   // この地物が親であり、削除された子を持つ場合
                   const childrenToRemove = parentUpdatesNeeded.get(feature.id);
                   let updatedParent = feature;
                   childrenToRemove.forEach(childId => {
                       updatedParent = updatedParent.removeChildId(childId); // イミュータブルに更新
                   });
                   featuresWithUpdatedParents.push(updatedParent);
                   updatedFeatureIds.add(updatedParent.id); // 親も更新された
                } else {
                    // 関係ない地物はそのまま追加
                    featuresWithUpdatedParents.push(feature);
                }
            }
            world.features = featuresWithUpdatedParents; // 更新されたリストで置き換え
        } else {
           // 親の更新が不要な場合は、そのまま更新リストで置き換え
           world.features = updatedFeatures;
        }


        // 6. 頂点リストから削除対象を物理的に削除
        const verticesBeforeDelete = world.vertices.length;
        world.vertices = world.vertices.filter(v => !verticesToDeleteSet.has(v.id));
        const deletedVertexCount = verticesBeforeDelete - world.vertices.length;
        console.log(`[UseCase] Physically deleted ${deletedVertexCount} vertices from world.vertices.`); // ★ Log: Vertex deletion count


        // 7. 不要になった頂点をさらにクリーンアップ (変更なし)
        // this._cleanupUnusedVertices(world, []); // 全頂点をチェック

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
         const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
         return (f.vertexIds && f.vertexIds.includes(vertexId)) ||
                (isPolygon && f.holesVertexIds && f.holesVertexIds.some(hole => hole.includes(vertexId))) ||
                (isPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds && sub.vertexIds.includes(vertexId)));
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
   * 複数の頂点を移動
   * @param {Array<{ vertexId: string, newPosition: {x: number, y: number} }>} vertexUpdates - 移動する頂点の情報配列
   * @returns {Promise<Object>} 更新情報 { updatedVertices: Object[], affectedFeatures: Object[] }
   */
  async moveVertices(vertexUpdates) {
    const world = await this._worldRepository.getWorld();
    const updatedVertices = [];
    const allAffectedFeatureIds = new Set();
    const updatedVerticesMap = new Map(); // 更新された頂点データの一時保存用

    // world.vertices を Map にして高速アクセス
    const verticesMap = new Map(world.vertices.map(v => [v.id, v]));

    for (const update of vertexUpdates) {
      const { vertexId, newPosition } = update;
      const vertex = verticesMap.get(vertexId);

      if (!vertex) {
        console.warn(`Vertex not found with ID during moveVertices: ${vertexId}`);
        continue;
      }

      // TODO: 必要であれば衝突検出と位置調整を追加
      // const adjustedPosition = this._handleCollisionForVertexMove(vertex, newPosition, world);
      const adjustedPosition = newPosition; // 簡易的に調整なし

      const updatedVertexData = {
        id: vertexId,
        x: adjustedPosition.x,
        y: adjustedPosition.y,
      };

      // 更新されたデータを Map と配列で管理
      updatedVerticesMap.set(vertexId, updatedVertexData); // 更新データを一時保存
      updatedVertices.push(updatedVertexData); // 返却用の配列に追加
    }

    // world.vertices 配列を更新されたデータで更新
    // 注意: verticesMap は元のプレーンオブジェクトを含むので、updatedVerticesMapで上書きする
    world.vertices = world.vertices.map(v => updatedVerticesMap.get(v.id) || v);


    // 影響を受ける地物のIDを収集 (更新後の頂点を使用する地物)
    world.features.forEach(f => {
      if (!f || typeof f !== 'object') return;
      const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
      const usesUpdatedVertex = vertexUpdates.some(update =>
          (f.vertexIds && f.vertexIds.includes(update.vertexId)) ||
          (isPolygon && f.holesVertexIds?.some(hole => hole.includes(update.vertexId))) ||
          (isPolygon && f.isMultiPolygon && f.subPolygons?.some(sub => sub.vertexIds?.includes(update.vertexId)))
      );
      if (usesUpdatedVertex) {
        allAffectedFeatureIds.add(f.id);
      }
    });

    // 影響を受けた地物リストを作成
    const affectedFeatures = world.features.filter(f => allAffectedFeatureIds.has(f.id));

    // 世界データを保存 (一度だけ)
    await this._worldRepository.saveWorld(world);

    return {
      updatedVertices, // 更新された頂点のプレーンオブジェクトの配列
      affectedFeatures // 影響を受けた地物のリスト（参照は古い可能性あり）
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
      const isPolygon = isValidFeature && (feature instanceof Polygon || feature.constructor?.name === 'Polygon'); // Use constructor name as fallback
      const hasWithHolesVertexIds = isPolygon && typeof feature.withHolesVertexIds === 'function';
      const hasWithMultiPolygonData = isPolygon && typeof feature.withMultiPolygonData === 'function';
      // 特定の飛び地の穴を更新するメソッド (仮)
      const hasWithSubPolygonHoles = isPolygon && typeof feature.withSubPolygonHoles === 'function';


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
      if (feature.isMultiPolygon && feature.subPolygons) {
          let subPolygonsUpdated = false;
          const newSubPolygons = feature.subPolygons.map((sub, subIndex) => {
              let subUpdated = false;
              let newSubVertexIds = sub.vertexIds;
              let newSubHolesVertexIds = sub.holesVertexIds || [];

              // 飛び地の外周
              if (sub.vertexIds && sub.vertexIds.includes(removedVertexId)) {
                  newSubVertexIds = sub.vertexIds.map(id => id === removedVertexId ? keptVertexId : id);
                  subUpdated = true;
              }

              // 飛び地の穴 (★修正: ここも更新)
              if (hasWithSubPolygonHoles && newSubHolesVertexIds.length > 0) {
                  let subHolesUpdated = false;
                  newSubHolesVertexIds = newSubHolesVertexIds.map(hole => {
                      if (hole.includes(removedVertexId)) {
                          subHolesUpdated = true;
                          return hole.map(id => id === removedVertexId ? keptVertexId : id);
                      }
                      return hole;
                  });
                  if (subHolesUpdated) {
                      subUpdated = true;
                  }
              }

              if (subUpdated) {
                  subPolygonsUpdated = true;
                  // 更新された情報を返す
                  return { vertexIds: newSubVertexIds, holesVertexIds: newSubHolesVertexIds };
              }
              return sub; // 更新なければ元を返す
          });

          if (subPolygonsUpdated) {
              if (hasWithMultiPolygonData) {
                  feature = feature.withMultiPolygonData(true, newSubPolygons);
                  updated = true;
              } else {
                  console.error(`Feature ${feature.id} is missing withMultiPolygonData method.`);
              }
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
   * @param {string} featureId - この地物に対して新しい頂点を作成
   * @returns {Promise<Object>} 更新情報 { newVertex, updatedFeature }
   */
  async unlinkSharedVertex(vertexId, featureId) {
    const world = await this._worldRepository.getWorld();

    // 頂点を検索
    const vertex = world.vertices.find(v => v.id === vertexId);
    if (!vertex) {
      throw new Error(`Vertex not found with ID: ${vertexId}`);
    }

    // 地物を検索
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
    const isPolygon = feature instanceof Polygon || feature.constructor?.name === 'Polygon'; // Use constructor name as fallback
    const usesVertex = (feature.vertexIds && feature.vertexIds.includes(vertexId)) ||
                     (isPolygon && feature.holesVertexIds?.some(hole => hole.includes(vertexId))) ||
                     (isPolygon && feature.isMultiPolygon && feature.subPolygons?.some(sub =>
                         (sub.vertexIds && sub.vertexIds.includes(vertexId)) ||
                         (sub.holesVertexIds?.some(hole => hole.includes(vertexId))) // ★ 飛び地の穴もチェック
                     ));


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
     // ★ 追加: 特定の飛び地の穴を更新するメソッド (仮)
     const hasWithSubPolygonHoles = isPolygon && typeof feature.withSubPolygonHoles === 'function';


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
    if (feature.isMultiPolygon && feature.subPolygons) {
        let subPolygonsUpdated = false;
        const newSubPolygons = feature.subPolygons.map((sub, subIndex) => {
            let subUpdated = false;
            let newSubVertexIds = sub.vertexIds;
            let newSubHolesVertexIds = sub.holesVertexIds || [];

            // 飛び地の外周
            if (sub.vertexIds && sub.vertexIds.includes(vertexId)) {
                newSubVertexIds = sub.vertexIds.map(id => id === vertexId ? newVertexId : id);
                subUpdated = true;
            }

            // 飛び地の穴 (★修正: ここも更新)
            if (hasWithSubPolygonHoles && newSubHolesVertexIds.length > 0) {
                 let subHolesUpdated = false;
                 newSubHolesVertexIds = newSubHolesVertexIds.map(hole => {
                     if (hole.includes(vertexId)) {
                         subHolesUpdated = true;
                         return hole.map(id => id === vertexId ? newVertexId : id);
                     }
                     return hole;
                 });
                 if (subHolesUpdated) {
                     subUpdated = true;
                 }
            }

            if (subUpdated) {
                subPolygonsUpdated = true;
                return { vertexIds: newSubVertexIds, holesVertexIds: newSubHolesVertexIds };
            }
            return sub;
        });

        if (subPolygonsUpdated) {
            if (hasWithMultiPolygonData) {
                feature = feature.withMultiPolygonData(true, newSubPolygons);
                updated = true;
            } else {
                 console.error(`Feature ${feature.id} is missing withMultiPolygonData method.`);
            }
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
      this._validatePolygonHole(holeVertexIds, polygon, world, null); // 本土への穴として検証

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
   * @param {Object} geometry - 形状情報 (updateFeatureのコメント参照)
   * @param {Object} world - 世界データ
   * @returns {Object} 処理された形状情報 (新しい頂点のIDを含む)
   * @private
   */
  _processGeometry(geometry, world) {
    // 既存頂点のコピー
    const processedGeometry = { ...geometry };
    let verticesChanged = false;

    // 新しい外周頂点 (geometry.vertices) のID割り当て
    if (geometry.vertices && Array.isArray(geometry.vertices)) {
      processedGeometry.vertexIds = processedGeometry.vertexIds || []; // 既存IDがあればマージ
      for (const vertex of geometry.vertices) {
          if(vertex.x === undefined || vertex.y === undefined) continue;
          const vertexId = this._generateId('vertex');
          processedGeometry.vertexIds.push(vertexId);
          world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
          verticesChanged = true;
      }
       delete processedGeometry.vertices; // 元の配列は削除
    }

    // 新しいトップレベルの穴 (geometry.holes) のID割り当て
    if (geometry.holes && Array.isArray(geometry.holes)) {
      processedGeometry.holesVertexIds = processedGeometry.holesVertexIds || [];
      for (const hole of geometry.holes) {
        if(!Array.isArray(hole)) continue;
        const holeIds = [];
        for (const vertex of hole) {
            if(vertex.x === undefined || vertex.y === undefined) continue;
            const vertexId = this._generateId('vertex');
            holeIds.push(vertexId);
            world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
            verticesChanged = true;
        }
        if(holeIds.length >= 3) { // 3点以上で有効な穴
           processedGeometry.holesVertexIds.push(holeIds);
        }
      }
      delete processedGeometry.holes; // 元の配列は削除
    }

    // 新しい飛び地 (geometry.newSubPolygonVertices) のID割り当て
    if (geometry.newSubPolygonVertices && Array.isArray(geometry.newSubPolygonVertices)) {
        const newSubPolygonVertexIds = [];
        for (const vertex of geometry.newSubPolygonVertices) {
             if(vertex.x === undefined || vertex.y === undefined) continue;
             const vertexId = this._generateId('vertex');
             newSubPolygonVertexIds.push(vertexId);
             world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
             verticesChanged = true;
        }
        if (newSubPolygonVertexIds.length >= 3) {
            processedGeometry.newSubPolygonVertexIds = newSubPolygonVertexIds;
        }
        // newSubPolygonVertices は削除せず、後続の updateFeature で利用
    }

    // 特定の飛び地に追加する新しい穴 (geometry.newHolesForSubPolygon) のID割り当て
    if (geometry.targetSubPolygonIndex !== undefined && geometry.newHolesForSubPolygon && Array.isArray(geometry.newHolesForSubPolygon)) {
        processedGeometry.newHolesVertexIdsForSubPolygon = [];
        for (const hole of geometry.newHolesForSubPolygon) {
            if(!Array.isArray(hole)) continue;
            const holeIds = [];
            for (const vertex of hole) {
                if(vertex.x === undefined || vertex.y === undefined) continue;
                const vertexId = this._generateId('vertex');
                holeIds.push(vertexId);
                world.vertices.push({ id: vertexId, x: vertex.x, y: vertex.y });
                verticesChanged = true;
            }
            if(holeIds.length >= 3) {
               processedGeometry.newHolesVertexIdsForSubPolygon.push(holeIds);
            }
        }
        delete processedGeometry.newHolesForSubPolygon; // 元の配列は削除
    }


    // 既存の飛び地情報全体の上書き (geometry.subPolygons) - ここではID生成は不要
    if(geometry.subPolygons && Array.isArray(geometry.subPolygons)) {
        processedGeometry.subPolygons = geometry.subPolygons.map(sub => ({
            vertexIds: sub.vertexIds || [],
            holesVertexIds: sub.holesVertexIds || []
        }));
    }

    // 新しい頂点が追加された場合は world.vertices を保存する
    // Note: 本来は非同期にしない方が良いかもしれないが、現状は合わせる
    if (verticesChanged) {
        // await this._worldRepository.saveWorld(world); // UseCaseの外で呼ばれるのでここでは保存しない
    }

    return processedGeometry;
  }

  /**
   * ポリゴンの追加検証
   * @param {Object} geometry - 形状情報 { vertexIds?, holesVertexIds?, parentId?, isMultiPolygon?, subPolygons? }
   * @param {string} layerId - レイヤーID
   * @param {Object} world - 世界データ
   * @private
   */
  _validatePolygonAddition(geometry, layerId, world) {
    // TODO: 同一レイヤー内のポリゴンとの排他性チェック
    // const newPolygon = Polygon.create('temp-id', [], geometry, layerId); // 仮IDでインスタンス生成
    // const layerPolygons = world.features.filter(f => f.layerId === layerId && f instanceof Polygon);
    // this._layerService.checkExclusivity(newPolygon, layerPolygons, world.vertices, this._geometryService);

    // TODO: 親ポリゴンとの関係チェック (指定されたparentIdが存在し、正しい階層にあるか)
    // this._layerService.validatePolygonHierarchy(newPolygon, world.features, world.layers);

    // 自己交差チェック
    if (geometry.vertexIds && geometry.vertexIds.length >= 3) {
        const vertices = this._getVerticesFromIds(geometry.vertexIds, world);
        if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
             throw new Error("Polygon cannot self-intersect.");
        }
    }
    // 穴の自己交差チェック
    geometry.holesVertexIds?.forEach(holeIds => {
        if (holeIds.length >= 3) {
             const vertices = this._getVerticesFromIds(holeIds, world);
             if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                 throw new Error("Polygon hole cannot self-intersect.");
             }
        }
    });
    // 飛び地の自己交差チェック
    geometry.subPolygons?.forEach(sub => {
         if (sub.vertexIds && sub.vertexIds.length >= 3) {
             const vertices = this._getVerticesFromIds(sub.vertexIds, world);
             if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                 throw new Error("Sub-polygon cannot self-intersect.");
             }
         }
         // TODO: 飛び地の穴の自己交差チェック
         sub.holesVertexIds?.forEach(holeIds => {
            if (holeIds.length >= 3) {
                const vertices = this._getVerticesFromIds(holeIds, world);
                if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                    throw new Error("Sub-polygon hole cannot self-intersect.");
                }
            }
         });
    });

  }

  /**
   * ポリゴンの更新検証
   * @param {Object} geometryUpdates - 更新される形状情報
   * @param {Polygon} currentPolygon - 更新前のポリゴンインスタンス
   * @param {Object} world - 世界データ
   * @private
   */
  _validatePolygonUpdate(geometryUpdates, currentPolygon, world) {
    // --- 更新後のポリゴン形状を推定 ---
    // 注意: これは簡易的な推定であり、正確な検証には限界がある
    let potentialVertexIds = geometryUpdates.vertexIds !== undefined ? geometryUpdates.vertexIds : currentPolygon.vertexIds;
    let potentialHoles = geometryUpdates.holesVertexIds !== undefined ? geometryUpdates.holesVertexIds : currentPolygon.holesVertexIds;
    let potentialSubPolygons = currentPolygon.subPolygons;
    // 飛び地穴の更新も考慮
    if (geometryUpdates.targetSubPolygonIndex !== undefined && geometryUpdates.newHolesVertexIdsForSubPolygon) {
        const index = geometryUpdates.targetSubPolygonIndex;
        if (index >= 0 && index < potentialSubPolygons.length) {
             const currentSubHoles = potentialSubPolygons[index].holesVertexIds || [];
             potentialSubPolygons = [...potentialSubPolygons]; // 配列をコピー
             potentialSubPolygons[index] = {
                 ...potentialSubPolygons[index],
                 holesVertexIds: [...currentSubHoles, ...geometryUpdates.newHolesVertexIdsForSubPolygon]
             };
        }
    }
    // 飛び地全体の更新
    if (geometryUpdates.isMultiPolygon !== undefined && geometryUpdates.subPolygons) {
        potentialSubPolygons = geometryUpdates.subPolygons;
    }
    // 新しい飛び地の追加
    if (geometryUpdates.newSubPolygonVertexIds) {
        potentialSubPolygons = [...potentialSubPolygons, { vertexIds: geometryUpdates.newSubPolygonVertexIds, holesVertexIds: [] }];
    }

    // --- 検証実行 ---
    // TODO: 同一レイヤー内のポリゴンとの排他性チェック (更新後の形状で)
    // ...

    // TODO: 親ポリゴンとの関係チェック (更新後の形状で)
    // ...

    // TODO: 子ポリゴンとの関係チェック (子が内部に含まれなくなるような変更はNG)
    // ...

    // 自己交差チェック (形状が変更される場合)
    if (geometryUpdates.vertexIds !== undefined && potentialVertexIds && potentialVertexIds.length >= 3) {
        const vertices = this._getVerticesFromIds(potentialVertexIds, world);
        if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
             throw new Error("Updated polygon cannot self-intersect.");
        }
    }
    // 穴の自己交差チェック
    potentialHoles?.forEach(holeIds => {
        if (holeIds.length >= 3) {
            const vertices = this._getVerticesFromIds(holeIds, world);
            if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                throw new Error("Updated polygon hole cannot self-intersect.");
            }
        }
    });
     // 飛び地の自己交差チェック (更新後の飛び地で)
    potentialSubPolygons?.forEach(sub => {
         if (sub.vertexIds && sub.vertexIds.length >= 3) {
             const vertices = this._getVerticesFromIds(sub.vertexIds, world);
             if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                 throw new Error("Updated sub-polygon cannot self-intersect.");
             }
         }
         // TODO: 飛び地の穴のチェック
         sub.holesVertexIds?.forEach(holeIds => {
             if (holeIds.length >= 3) {
                 const vertices = this._getVerticesFromIds(holeIds, world);
                 if (this._geometryService.isPolygonSelfIntersecting(vertices)) {
                     throw new Error("Updated sub-polygon hole cannot self-intersect.");
                 }
             }
         });
    });
  }

  /**
   * ポリゴンの穴のバリデーション
   * @param {string[]} holeVertexIds - 穴の頂点IDの配列
   * @param {Polygon} polygon - ポリゴン
   * @param {Object} world - 世界データ
   * @param {number | null} targetSubPolygonIndex - 穴が属する飛び地のインデックス（本土の場合はnull）
   * @private
   */
  _validatePolygonHole(holeVertexIds, polygon, world, targetSubPolygonIndex = null) {
    // 穴が少なくとも3つの頂点を持つことを確認
    if (!holeVertexIds || holeVertexIds.length < 3) {
      throw new Error('Polygon hole must have at least three vertices');
    }

    const holeVertices = this._getVerticesFromIds(holeVertexIds, world);
    if (holeVertices.length !== holeVertexIds.length) {
         throw new Error("Invalid vertex ID found in hole definition.");
    }

    // 自己交差チェック
    if (this._geometryService.isPolygonSelfIntersecting(holeVertices)) {
        throw new Error("Polygon hole cannot self-intersect.");
    }

    // 穴が所属する外周を特定
    let outerBoundaryVertices = null;
    if (targetSubPolygonIndex === null) { // 本土の穴
        if (polygon.vertexIds && polygon.vertexIds.length >= 3) {
            outerBoundaryVertices = this._getVerticesFromIds(polygon.vertexIds, world);
        }
    } else if (polygon.isMultiPolygon && polygon.subPolygons &&
               targetSubPolygonIndex >= 0 && targetSubPolygonIndex < polygon.subPolygons.length) { // 飛び地の穴
        const subPolygon = polygon.subPolygons[targetSubPolygonIndex];
        if (subPolygon.vertexIds && subPolygon.vertexIds.length >= 3) {
            outerBoundaryVertices = this._getVerticesFromIds(subPolygon.vertexIds, world);
        }
    }

    // 外周が存在し、穴が内部にあるか検証
    if (outerBoundaryVertices) {
        if (!holeVertices.every(hv => this._geometryService.isPointInPolygon(hv, outerBoundaryVertices))) {
            const targetName = targetSubPolygonIndex === null ? "polygon outer boundary" : `sub-polygon[${targetSubPolygonIndex}]`;
             throw new Error(`Hole must be completely inside the ${targetName}.`);
        }
    } else {
        throw new Error("Cannot validate hole: Outer boundary not found or is invalid.");
    }

    // TODO: 穴が他の穴と交差しないこと、または内部に含まれないことを確認
    // ...
  }

  /**
   * 飛び地のバリデーション (新規追加時)
   * @param {Object} subPolygon - 飛び地情報 { vertexIds, holesVertexIds }
   * @param {Polygon} parentPolygon - 親ポリゴン
   * @param {Object} world - 世界データ
   * @private
   */
   _validateSubPolygon(subPolygon, parentPolygon, world) {
    if (!subPolygon || !subPolygon.vertexIds || subPolygon.vertexIds.length < 3) {
        throw new Error('Sub-polygon must have at least three vertices');
    }
    const subVertices = this._getVerticesFromIds(subPolygon.vertexIds, world);
    if (subVertices.length !== subPolygon.vertexIds.length) {
        throw new Error("Invalid vertex ID found in sub-polygon definition.");
    }

    // 自己交差チェック
    if (this._geometryService.isPolygonSelfIntersecting(subVertices)) {
        throw new Error("Sub-polygon cannot self-intersect.");
    }

    // 飛び地内の穴の検証
    if (subPolygon.holesVertexIds) {
         subPolygon.holesVertexIds.forEach((holeIds, index) => {
             // this._validatePolygonHole を呼び出すが、どの飛び地に属するかを明確にする
             // ここではまだ飛び地のインデックスが不明なため、簡易チェックに留めるか、
             // または validatePolygonAddition/Update 内でインデックス付きで呼び出す
             if (!holeIds || holeIds.length < 3) {
                 throw new Error(`Hole (index ${index}) in sub-polygon must have at least three vertices`);
             }
             const holeVertices = this._getVerticesFromIds(holeIds, world);
             if (holeVertices.length !== holeIds.length) {
                 throw new Error(`Invalid vertex ID found in hole (index ${index}) of sub-polygon.`);
             }
             if (this._geometryService.isPolygonSelfIntersecting(holeVertices)) {
                 throw new Error(`Hole (index ${index}) in sub-polygon cannot self-intersect.`);
             }
             // 穴が飛び地内部にあるかのチェックは、親ポリゴンの検証時に行う
         });
    }

    // TODO: 飛び地が親ポリゴンの外周や他の飛び地、他の穴と重ならないことを確認
    // ...

    // TODO: 飛び地が同じレイヤーの他のポリゴンと重ならないことを確認
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
       (f.isMultiPolygon && f.subPolygons?.some(sub =>
           (sub.vertexIds && sub.vertexIds.includes(vertex.id)) ||
           (sub.holesVertexIds?.some(hole => hole.includes(vertex.id))) // ★ 飛び地の穴も考慮
       )))
    );


    if (polygons.length === 0) {
      // ポリゴンに属さない頂点は自由に移動可能
      return newPosition;
    }

    // TODO: 各ポリゴンについて衝突判定とエッジ滑り処理
    // - 移動後の頂点を含むポリゴンの形状を仮計算
    // - 同一レイヤーの他のポリゴンとの衝突判定 (doPolygonsOverlap)
    // - 衝突する場合、移動ベクトルと衝突エッジから最近接点を計算 (projectPointToEdge)
    // - 穴や自己交差のチェックも必要

    // 本来ならここで衝突判定とエッジ滑り処理を実装するが、簡易的な処理として
    // 新しい位置をそのまま返す
    return newPosition;
  }

  /**
   * 使用されていない頂点のクリーンアップ
   * @param {Object} world - 世界データ
   * @param {string[]} vertexIdsToCheck - チェック対象の頂点ID (指定がなければ全地物をチェック)
   * @private
   */
  _cleanupUnusedVertices(world, vertexIdsToCheck = []) {
      const allUsedVertexIds = new Set();
      world.features.forEach(f => {
           if (!f || typeof f !== 'object') return;
           const isPolygon = f instanceof Polygon || f.constructor?.name === 'Polygon';
           if (f.vertexIds) f.vertexIds.forEach(id => allUsedVertexIds.add(id));
           if (isPolygon && f.holesVertexIds) {
               f.holesVertexIds.flat().forEach(id => allUsedVertexIds.add(id));
           }
           if (isPolygon && f.isMultiPolygon && f.subPolygons) {
               f.subPolygons.forEach(sub => {
                   sub.vertexIds?.forEach(id => allUsedVertexIds.add(id));
                   // 飛び地の穴の頂点も使用中としてマーク
                   sub.holesVertexIds?.flat().forEach(id => allUsedVertexIds.add(id));
               });
           }
       });

      const originalVertexCount = world.vertices.length;
      // 使用されなくなった頂点 = 元のリストにあって、使用リストにない頂点
      // vertexIdsToCheck が指定されている場合は、その中から使用されなくなったものだけを削除対象とする
      const verticesToDelete = vertexIdsToCheck.length > 0
         ? vertexIdsToCheck.filter(id => !allUsedVertexIds.has(id))
         : world.vertices.map(v => v.id).filter(id => !allUsedVertexIds.has(id));

      if (verticesToDelete.length > 0) {
          const deleteSet = new Set(verticesToDelete);
          world.vertices = world.vertices.filter(v => !deleteSet.has(v.id));
          const removedCount = deleteSet.size;
          console.log(`[UseCase] Cleaned up ${removedCount} unused vertices (via _cleanupUnusedVertices).`);
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

  /**
   * 頂点ID配列から頂点オブジェクト配列を取得するヘルパー
   * @param {string[]} vertexIds
   * @param {Object} world
   * @returns {Vertex[]}
   * @private
   */
   _getVerticesFromIds(vertexIds, world) {
    if (!vertexIds || !world || !world.vertices) return [];
    const vertexMap = new Map(world.vertices.map(v => [v.id, v]));
    // Vertex インスタンスを返すように修正
    return vertexIds
        .map(id => {
            const data = vertexMap.get(id);
            // データが存在すれば Vertex インスタンスを生成
            return data ? new Vertex(data.id, data.x, data.y) : null;
        })
        .filter(Boolean); // null を除去
   }
}
