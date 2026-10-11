/**
 * @fileoverview Privacy Blur plugin — sisi Node (host injector).
 * @description Hanya mendeploy inject.js; semua kerja (blur, hotkey, indikator)
 *   jalan di renderer tanpa menyentuh API Discord.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createScriptDeployer } from '../../src/plugins/deploy-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BLUR = { avatars: true, usernames: true, text: true, images: true, channels: true };
const DEFAULT_CLEAN = { guilds: true, sidebar: true, members: true, panels: true, toolbar: true };

export default class PrivacyBlur {
    constructor(api) {
        this.api = api;
        this.log = api.log;

        this.config = {
            enabled: true,
            hotkeyBlur: 'ctrl+shift+b',
            hotkeyCleanUi: 'ctrl+shift+u',
            blurPx: 8,
            revealOnHover: true,
            showIndicator: true,
            hideIndicatorInCleanUi: true,
            persist: true,
            blurOnStart: false,
            cleanUiOnStart: false,
            guardIntervalMs: 5000,
            blur: { ...DEFAULT_BLUR },
            cleanUi: { ...DEFAULT_CLEAN }
        };

        this.deployer = createScriptDeployer({
            api,
            log: this.log,
            pluginDir: __dirname,
            scriptName: 'privacy-blur.js',
            configGlobalName: '__PRIVACY_BLUR_CONFIG__',
            buildConfig: () => ({
                enabled: this.config.enabled !== false,
                hotkeyBlur: this.config.hotkeyBlur || 'ctrl+shift+b',
                hotkeyCleanUi: this.config.hotkeyCleanUi || 'ctrl+shift+u',
                blurPx: Number(this.config.blurPx) || 8,
                revealOnHover: this.config.revealOnHover !== false,
                showIndicator: this.config.showIndicator !== false,
                hideIndicatorInCleanUi: this.config.hideIndicatorInCleanUi !== false,
                persist: this.config.persist !== false,
                blurOnStart: this.config.blurOnStart === true,
                cleanUiOnStart: this.config.cleanUiOnStart === true,
                guardIntervalMs: Number(this.config.guardIntervalMs) || 5000,
                blur: { ...DEFAULT_BLUR, ...(this.config.blur || {}) },
                cleanUi: { ...DEFAULT_CLEAN, ...(this.config.cleanUi || {}) }
            })
        });
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this._merge(config);
        this.log.info('Privacy Blur plugin initialized');
    }

    async destroy() {
        this.log.info('Privacy Blur plugin destroyed');
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

        const { blur, cleanUi, ...rest } = config;
        this.config = { ...this.config, ...rest };
        if (blur) this.config.blur = { ...DEFAULT_BLUR, ...this.config.blur, ...blur };
        if (cleanUi) this.config.cleanUi = { ...DEFAULT_CLEAN, ...this.config.cleanUi, ...cleanUi };
    }
}
