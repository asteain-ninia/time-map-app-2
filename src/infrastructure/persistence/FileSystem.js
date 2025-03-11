/**
 * ファイルシステム操作の抽象化
 */
export class FileSystem {
  /**
   * ファイルを読み込む
   * @param {string} filePath - ファイルパス
   * @returns {Promise<string>} ファイル内容
   */
  async readFile(filePath) {
    try {
      // Electronの場合
      if (window.electron && window.electron.fs) {
        return await window.electron.fs.readFile(filePath, 'utf8');
      }
      
      // ブラウザでのテスト用ローカルストレージ
      if (typeof localStorage !== 'undefined') {
        const content = localStorage.getItem(filePath);
        if (content) {
          return content;
        }
      }
      
      throw new Error('File system not available');
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  /**
   * ファイルを書き込む
   * @param {string} filePath - ファイルパス
   * @param {string} content - 書き込む内容
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content) {
    try {
      // Electronの場合
      if (window.electron && window.electron.fs) {
        await window.electron.fs.writeFile(filePath, content, 'utf8');
        return;
      }
      
      // ブラウザでのテスト用ローカルストレージ
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(filePath, content);
        return;
      }
      
      throw new Error('File system not available');
    } catch (error) {
      throw new Error(`Failed to write file: ${error.message}`);
    }
  }

  /**
   * ファイルが存在するか確認
   * @param {string} filePath - ファイルパス
   * @returns {Promise<boolean>} 存在すればtrue
   */
  async fileExists(filePath) {
    try {
      // Electronの場合
      if (window.electron && window.electron.fs) {
        return await window.electron.fs.exists(filePath);
      }
      
      // ブラウザでのテスト用ローカルストレージ
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(filePath) !== null;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * ディレクトリを作成
   * @param {string} dirPath - ディレクトリパス
   * @returns {Promise<void>}
   */
  async makeDirectory(dirPath) {
    try {
      // Electronの場合
      if (window.electron && window.electron.fs) {
        await window.electron.fs.mkdir(dirPath, { recursive: true });
      }
      // ブラウザでは何もしない
    } catch (error) {
      throw new Error(`Failed to create directory: ${error.message}`);
    }
  }

  /**
   * バックアップを作成
   * @param {string} filePath - 元ファイルパス
   * @returns {Promise<string>} バックアップファイルパス
   */
  async createBackup(filePath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.${timestamp}.bak`;
    
    try {
      const content = await this.readFile(filePath);
      await this.writeFile(backupPath, content);
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }
}