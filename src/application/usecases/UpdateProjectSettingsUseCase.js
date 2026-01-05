// src/application/usecases/UpdateProjectSettingsUseCase.js
import { WorldRepository } from '../WorldRepository.js'; // 型チェック用

export class UpdateProjectSettingsUseCase {
    /** @type {WorldRepository} */
    _worldRepository;

    /**
     * @param {WorldRepository} worldRepository
     */
    constructor(worldRepository) {
        if (!worldRepository) {
            throw new Error("WorldRepository is required for UpdateProjectSettingsUseCase.");
        }
        this._worldRepository = worldRepository;
    }

    /**
     * プロジェクト設定を更新し保存する
     * @param {object} newSettings - 更新する設定値の完全なオブジェクト (metadata.settings に対応)
     * @returns {Promise<object>} 更新後の設定オブジェクト
     * @throws {Error} バリデーションエラーまたは保存エラーの場合
     */
    async execute(newSettings) {
        // 1. バリデーション
        if (!newSettings) {
            throw new Error("New settings cannot be null or undefined.");
        }
        if (typeof newSettings.equatorLength !== 'number' || newSettings.equatorLength <= 0) {
            throw new Error("無効な赤道長です。正の数値を入力してください。");
        }
        if (!Number.isFinite(newSettings.zoomMin) || newSettings.zoomMin < 0.1 || newSettings.zoomMin > 10000) {
            throw new Error("無効な最小ズーム倍率です。0.1〜10000の範囲で入力してください。");
        }
        if (!Number.isFinite(newSettings.zoomMax) || newSettings.zoomMax < 0.1 || newSettings.zoomMax > 10000) {
            throw new Error("無効な最大ズーム倍率です。0.1〜10000の範囲で入力してください。");
        }
        if (newSettings.zoomMin >= newSettings.zoomMax) {
            throw new Error("無効なズーム範囲です。最小ズームは最大ズームより小さくしてください。");
        }
        if (typeof newSettings.sliderMin !== 'number' || typeof newSettings.sliderMax !== 'number' || newSettings.sliderMin >= newSettings.sliderMax) {
            throw new Error("無効なタイムライン範囲です。最小年は最大年より小さく設定してください。");
        }
        if (typeof newSettings.gridInterval !== 'number' || newSettings.gridInterval <= 0) {
            throw new Error("無効なグリッド間隔です。正の数値を入力してください。");
        }
        if (typeof newSettings.gridColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(newSettings.gridColor)) {
            // throw new Error("無効なグリッド色です。HEXカラーコード (例: #RRGGBB) で入力してください。");
            // 警告に留め、処理は続行する。ブラウザのcolor inputがバリデーションする前提。
            console.warn("Potentially invalid gridColor format:", newSettings.gridColor);
        }
        if (typeof newSettings.gridOpacity !== 'number' || newSettings.gridOpacity < 0 || newSettings.gridOpacity > 1) {
            throw new Error("無効なグリッド不透明度です。0から1の間の数値を入力してください。");
        }
        // worldName, worldDescription は文字列であればOKとする (空文字列も許容)
        if (typeof newSettings.worldName !== 'string') {
            newSettings.worldName = ""; // 不正な場合は空文字にフォールバック
        }
        if (typeof newSettings.worldDescription !== 'string') {
            newSettings.worldDescription = ""; // 不正な場合は空文字にフォールバック
        }


        const world = await this._worldRepository.getWorld();
        if (!world.metadata) {
            world.metadata = {};
        }
        // 新しい設定で world.metadata.settings を完全に上書きする
        // settingsオブジェクト全体を置き換えることで、不要な古い設定が残ることを防ぐ
        world.metadata.settings = { ...newSettings }; 

        await this._worldRepository.saveWorld(world);
        
        // 更新後の設定オブジェクトを返す (ディープコピーして不変性を保証)
        return JSON.parse(JSON.stringify(world.metadata.settings));
    }
}
