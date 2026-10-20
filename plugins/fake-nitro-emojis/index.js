/**
 * @fileoverview Fake Nitro Emojis & Stickers Plugin — sisi Node (host injector).
 * @description Mendeploy inject.js ke plugin-scripts Discord untuk memungkinkan
 *   pengiriman emoji dan stiker server eksternal tanpa Nitro.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createScriptDeployer } from '../../src/plugins/deploy-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
    enabled: true,
    emojiSize: 48,
    stickerSize: 160,
    animated: true,
    unlockPicker: true,
    unlockStickers: true,
    sendAsLink: true,
    sendStickerDirectly: true,
    quality: 'lossless'
};

export default class FakeNitroEmojis {
    constructor(api) {
        this.api = api;
        this.log = api.log;

        this.config = { ...DEFAULT_CONFIG };

        this.deployer = createScriptDeployer({
            api,
            log: this.log,
            pluginDir: __dirname,
            scriptName: 'fake-nitro-emojis.js',
            configGlobalName: '__FAKE_NITRO_EMOJIS_CONFIG__',
            buildConfig: () => ({
                enabled: this.config.enabled !== false,
                emojiSize: Number(this.config.emojiSize) || 48,
                stickerSize: Number(this.config.stickerSize) || 160,
                animated: this.config.animated !== false,
                unlockPicker: this.config.unlockPicker !== false,
                unlockStickers: this.config.unlockStickers !== false,
                sendAsLink: this.config.sendAsLink !== false,
                sendStickerDirectly: this.config.sendStickerDirectly !== false,
                quality: this.config.quality || 'lossless'
            })
        });
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this._merge(config);
        this.log.info('Fake Nitro Emojis & Stickers plugin initialized');
    }

    async destroy() {
        this.log.info('Fake Nitro Emojis & Stickers plugin destroyed');
    }

    async afterInject(data) {
        if (!this.config.enabled) return;
        await this.deployer.deploy(data?.resourcePath);
    }

    async onDiscordStart() {
        if (!this.config.enabled) return;
        await this.deployer.deploy();
    }

    async onConfigChange(config) {
        this._merge(config);

        if (this.config.enabled) {
            await this.deployer.deploy();
        } else {
            await this.deployer.remove();
        }
    }

    _merge(config) {
        if (!config || typeof config !== 'object') return;
        this.config = { ...this.config, ...config };
    }
}
