import { WorldRepository } from '../../application/WorldRepository';

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
        {
          id: "layer-base",
          name: "基本レイヤー",
          order: 0,
          visible: true,
          opacity: 1.0,
          description: "最初のレイヤー"
        }
      ],
      vertices: [],
      features: [],
      metadata: {
        sliderMin: 0,
        sliderMax: 10000,
        worldName: "新しい世界",
        worldDescription: "",
        settings: {
          zoomMin: 1,
          zoomMax: 50,
          gridInterval: 10,
          autoSaveInterval: 300
        }
      }
    };
  }
}