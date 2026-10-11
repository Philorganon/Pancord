/**
 * @fileoverview Pending Friend Tracker Plugin
 * @description Melacak dan menampilkan berapa lama orang berada di daftar pending
 *   add friend (Incoming & Outgoing Friend Requests) di Discord, lengkap dengan
 *   badge durasi pada list Discord dan popup panel tracker interaktif.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bandingkan dua nama folder "app-X.Y.Z" secara numerik (descending, versi terbaru duluan).
 */
function compareAppVersionsDesc(a, b) {
    const toParts = (name) => name
        .replace(/^app-/, '')
        .split('.')
        .map((n) => parseInt(n, 10) || 0);

    const pa = toParts(a);
    const pb = toParts(b);
    const len = Math.max(pa.length, pb.length);

    for (let i = 0; i < len; i++) {
        const diff = (pb[i] || 0) - (pa[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

export default class PendingFriendTracker {
    constructor(api) {
        this.api = api;
        this.log = api.log;
        this.config = {
            enabled: true,
            hotkey: 'ctrl+shift+p',
            showBadgeInFriendsList: true,
            showFloatingButton: true,
            alertThresholdDays: 7,
            autoRefreshIntervalSec: 15
        };
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this.config = { ...this.config, ...config };
        this.log.info('Pending Friend Tracker plugin initialized');
        if (this.config.enabled) {
            await this._deployInjectScript();
        }
    }

    async destroy() {
        this.log.info('Pending Friend Tracker plugin destroyed');
    }

    async afterInject(data) {
        if (!this.config.enabled) return;
        await this._deployInjectScript(data?.resourcePath);
        this.log.success('Pending Friend Tracker inject script deployed');
    }

    async onDiscordStart() {
        if (!this.config.enabled) return;
        await this._deployInjectScript();
    }

    async onConfigChange(config) {
        this.config = { ...this.config, ...config };
        if (this.config.enabled) {
            await this._deployInjectScript();
        }
    }

    // ─── Discord Path Resolution ─────────────────────────────────

    async _findDiscordResourcePath() {
        // Priority 1: Use finder from API if provided
        if (typeof this.api?.findDiscordPath === 'function') {
            try {
                const found = await this.api.findDiscordPath();
                if (found && await fs.pathExists(found)) return found;
            } catch {}
        }

        // Priority 2: Use project finder module
        try {
            const finder = await import('../../src/finder.js');
            if (finder && typeof finder.findDiscordPath === 'function') {
                const found = await finder.findDiscordPath();
                if (found && await fs.pathExists(found)) return found;
            }
        } catch {}

        // Priority 3: Native filesystem inspection
        const platform = process.platform;
        let basePaths = [];

        if (platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA || '';
            basePaths = [
                path.join(localAppData, 'Discord'),
                path.join(localAppData, 'DiscordPTB'),
                path.join(localAppData, 'DiscordCanary'),
                path.join(localAppData, 'DiscordDevelopment')
            ];
        } else if (platform === 'darwin') {
            basePaths = [
                '/Applications/Discord.app/Contents',
                `${process.env.HOME}/Applications/Discord.app/Contents`
            ];
        } else {
            basePaths = [
                `${process.env.HOME}/.config/discord`,
                '/opt/Discord',
                '/usr/share/discord'
            ];
        }

        for (const basePath of basePaths) {
            try {
                if (!await fs.pathExists(basePath)) continue;

                if (platform === 'win32') {
                    const entries = await fs.readdir(basePath);
                    const appDirs = entries
                        .filter(e => e.startsWith('app-'))
                        .sort(compareAppVersionsDesc);

                    for (const appDir of appDirs) {
                        const resourcePath = path.join(basePath, appDir, 'resources');
                        if (await fs.pathExists(path.join(resourcePath, 'app'))) {
                            return resourcePath;
                        }
                        if (await fs.pathExists(path.join(resourcePath, 'original.asar'))) {
                            return resourcePath;
                        }
                        if (await fs.pathExists(path.join(resourcePath, 'app.asar'))) {
                            return resourcePath;
                        }
                    }
                } else if (platform === 'darwin') {
                    const resourcePath = path.join(basePath, 'Resources');
                    if (await fs.pathExists(resourcePath)) {
                        return resourcePath;
                    }
                } else {
                    const resourcePath = path.join(basePath, 'resources');
                    if (await fs.pathExists(resourcePath)) {
                        return resourcePath;
                    }
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    // ─── Deploy Script ───────────────────────────────────────────

    async deploy(explicitResourcePath) {
        return await this._deployInjectScript(explicitResourcePath);
    }

    async _deployInjectScript(explicitResourcePath) {
        try {
            let resourcePath = explicitResourcePath || null;

            if (!resourcePath) {
                resourcePath = await this._findDiscordResourcePath();
            }

            if (!resourcePath) {
                this.log.warn('Discord resource path not found — inject script will be deployed on next injection');
                return false;
            }

            const appFolder = path.join(resourcePath, 'app');
            const pluginScriptsDir = path.join(appFolder, 'plugin-scripts');

            if (!await fs.pathExists(appFolder)) {
                this.log.debug(`App folder not found in ${resourcePath} — Discord not injected yet`);
                return false;
            }

            await fs.ensureDir(pluginScriptsDir);

            const injectCode = this._generateInjectScript();
            await fs.writeFile(
                path.join(pluginScriptsDir, 'pending-friend-tracker.js'),
                injectCode,
                'utf8'
            );

            const targetFile = path.join(pluginScriptsDir, 'pending-friend-tracker.js');
            this.log.success(`Pending Friend Tracker script deployed to ${targetFile}`);
            return true;
        } catch (err) {
            this.log.error(`Failed to deploy pending friend tracker inject script: ${err.message}`);
            return false;
        }
    }

    _formatHotkeyDisplay(hotkey) {
        return String(hotkey || 'ctrl+shift+p')
            .split('+')
            .map((part) => {
                const p = part.trim().toLowerCase();
                if (!p) return '';
                if (p === 'ctrl' || p === 'control') return 'Ctrl';
                if (p === 'shift') return 'Shift';
                if (p === 'alt') return 'Alt';
                if (p === 'meta' || p === 'cmd' || p === 'command') return 'Cmd';
                return p.toUpperCase();
            })
            .filter(Boolean)
            .join(' + ');
    }

    // ─── Inject Script Generation ────────────────────────────────

    _generateInjectScript() {
        const injectPath = path.join(__dirname, 'inject.js');
        let code = '';
        try {
            code = fs.readFileSync(injectPath, 'utf8');
        } catch (e) {
            this.log.error(`Failed to read inject.js: ${e.message}`);
        }

        const configJSON = JSON.stringify(this.config);
        const hotkeyDisplay = JSON.stringify(this._formatHotkeyDisplay(this.config.hotkey));

        return `window.__PENDING_FRIEND_TRACKER_CONFIG__ = ${configJSON};\n` +
               `window.__PENDING_FRIEND_TRACKER_HOTKEY_DISPLAY__ = ${hotkeyDisplay};\n` +
               code;
    }
}
