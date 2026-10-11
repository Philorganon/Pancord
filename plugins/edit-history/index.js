/**
 * @fileoverview Edit History plugin — sisi Node (host injector).
 * @description Hanya mendeploy inject.js; pencatatan riwayat, badge, dan panel
 *   seluruhnya jalan di renderer dan disimpan di localStorage Discord.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createScriptDeployer } from '../../src/plugins/deploy-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default class EditHistory {
    constructor(api) {
        this.api = api;
        this.log = api.log;

        this.config = {
            enabled: true,
            persist: true,
            maxVersions: 10,
            maxMessages: 500,
            maxContentChars: 2000,
            showBadge: true,
            hotkeyShowLast: 'ctrl+shift+e',
            logEdits: false,
            panelMaxHeightPx: 420,
            saveDebounceMs: 1500,
            guardIntervalMs: 3000
        };

        this.deployer = createScriptDeployer({
            api,
            log: this.log,
            pluginDir: __dirname,
            scriptName: 'edit-history.js',
            configGlobalName: '__EDIT_HISTORY_CONFIG__',
            buildConfig: () => ({
                enabled: this.config.enabled !== false,
                persist: this.config.persist !== false,
                maxVersions: Math.max(1, Number(this.config.maxVersions) || 10),
                maxMessages: Math.max(10, Number(this.config.maxMessages) || 500),
                maxContentChars: Math.max(50, Number(this.config.maxContentChars) || 2000),
                showBadge: this.config.showBadge !== false,
                hotkeyShowLast: this.config.hotkeyShowLast || 'ctrl+shift+e',
                logEdits: this.config.logEdits === true,
                panelMaxHeightPx: Math.max(160, Number(this.config.panelMaxHeightPx) || 420),
                saveDebounceMs: Math.max(200, Number(this.config.saveDebounceMs) || 1500),
                guardIntervalMs: Math.max(500, Number(this.config.guardIntervalMs) || 3000)
            })
        });
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this.config = { ...this.config, ...(config || {}) };
        this.log.info('Edit History plugin initialized');
    }

    async destroy() {
        this.log.info('Edit History plugin destroyed');
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
        this.config = { ...this.config, ...(config || {}) };

        if (this.config.enabled) {
            await this.deployer.deploy();
        } else {
            await this.deployer.remove();
        }
    }
}
