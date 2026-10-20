/**
 * @fileoverview Split View Plugin — sisi Node (host injector).
 * @description Mendeploy inject.js ke plugin-scripts Discord untuk dual chat multitasking.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createScriptDeployer } from '../../src/plugins/deploy-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
    enabled: true,
    hotkey: 'ctrl+\\',
    defaultSplitRatio: 50,
    showToolbarButton: true,
    saveLastChannel: true
};

export default class SplitView {
    constructor(api) {
        this.api = api;
        this.log = api.log;

        this.config = { ...DEFAULT_CONFIG };

        this.deployer = createScriptDeployer({
            api,
            log: this.log,
            pluginDir: __dirname,
            scriptName: 'split-view.js',
            configGlobalName: '__SPLIT_VIEW_CONFIG__',
            buildConfig: () => ({
                enabled: this.config.enabled !== false,
                hotkey: this.config.hotkey || 'ctrl+\\',
                defaultSplitRatio: Number(this.config.defaultSplitRatio) || 50,
                showToolbarButton: this.config.showToolbarButton !== false,
                saveLastChannel: this.config.saveLastChannel !== false
            })
        });
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this._merge(config);
        this.log.info('Split View plugin initialized');
    }

    async destroy() {
        this.log.info('Split View plugin destroyed');
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
