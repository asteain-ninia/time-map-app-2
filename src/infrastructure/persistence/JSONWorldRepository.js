import { WorldRepository } from '../../application/WorldRepository';
import { Layer } from '../../domain/entities/Layer';

/**
 * JSONファイルベースのリポジトリ実装
 */
export class JSONWorldRepository extends WorldRepository {
  /**
   * リポジトリを作成
   * @param {FileSystem} fileSystem - ファイルシステム
   * @param {JSONSerializer} serializer - JSONシリアライザ
   * @param {string} [filePath="world.json"] - 保存ファイルパス
   */
  constructor(fileSystem, serializer, filePath = "world.json") {
    super();
    this._fileSystem = fileSystem;
    this._serializer = serializer;
    this._filePath = filePath;
    this._world = null; // キャッシュ
  }

  /**
   * 世界データの読み込み
   * @returns {Promise<Object>} 世界データ
   */
  async getWorld() {
    // キャッシュがあればそれを返す
    if (this._world) {
      return this._world;
    }
    
    try {
      // ファイルが存在するかチェック
      const exists = await this._fileSystem.fileExists(this._filePath);
      
      if (exists) {
        // ファイルからデータを読み込む
        const data = await this._fileSystem.readFile(this._filePath);
        this._world = this._serializer.deserialize(data);
      } else {
        // 新しい世界データを作成
        this._world = this._createEmptyWorld();
      }
      
      return this._world;
    } catch (error) {
      throw new Error(`Failed to load world data: ${error.message}`);
    }
  }

  /**
   * 世界データの保存
   * @param {Object} world - 保存する世界データ
   * @returns {Promise<void>}
   */
  async saveWorld(world) {
    try {
      // ファイルが存在する場合はバックアップを作成
      const exists = await this._fileSystem.fileExists(this._filePath);
      if (exists) {
        await this._fileSystem.createBackup(this._filePath);
      }
      
      // データをシリアライズしてファイルに保存
      const data = this._serializer.serialize(world);
      await this._fileSystem.writeFile(this._filePath, data);
      
      // キャッシュを更新
      this._world = world;
    } catch (error) {
      throw new Error(`Failed to save world data: ${error.message}`);
    }
  }

  /**
   * 保存ファイルパスの変更
   * @param {string} newFilePath - 新しいファイルパス
   */
  setFilePath(newFilePath) {
    this._filePath = newFilePath;
    this._world = null; // キャッシュをクリア
  }

  /**
   * 空の世界データを作成
   * @returns {Object} 空の世界データ
   * @private
   */
  _createEmptyWorld() {
    return {
      layers: [
        new Layer("layer-base", "基本レイヤー", 0, true, 1.0, "最初のレイヤー")
      ],
      vertices: [],
      features: [],
      metadata: {
        // sliderMin, sliderMax は settings に移動
        worldName: "新しい世界",
        worldDescription: "",
        settings: {
          // zoomMin, zoomMax はアプリ全体設定なので削除
          // gridInterval, autoSaveInterval はプロジェクト固有設定
          gridInterval: 10,
          autoSaveInterval: 300, // autoSaveInterval はアプリ全体設定かもしれないが、一旦プロジェクト固有として残す
          // 新しいプロジェクト固有設定のデフォルト値
          equatorLength: 40000,
          gridColor: "#cccccc",
          gridOpacity: 0.5,
          sliderMin: 0, // metadata直下から移動
          sliderMax: 10000 // metadata直下から移動
        }
      }
    };
  }
}
