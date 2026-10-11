/**
 * @fileoverview Quest Completer plugin — sisi Node (host injector).
 * @description Men-deploy inject.js ke <Discord>/resources/app/plugin-scripts/quest-completer.js
 *   supaya skrip otomasi quest dimuat otomatis setiap Discord start.
 *
 * Skrip renderer-nya adalah port dari gist "Complete Recent Discord Quest" oleh aamiaa
 * (GPL-3.0): https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb
 *
 * PERINGATAN: otomasi quest melanggar ToS Discord. Sejak 26 Agustus 2026 Discord
 * menangguhkan akses quest untuk akun yang ketahuan mengotomasi quest.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT_NAME = 'quest-completer.js';

/**
 * Bandingkan nama folder "app-X.Y.Z" secara numerik (descending, versi terbaru duluan).
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

export default class QuestCompleter {
    constructor(api) {
        this.api = api;
        this.log = api.log;
        this.config = {
            enabled: true,
            autoRun: false,
            hotkeyStart: 'ctrl+shift+q',
            hotkeyStop: 'ctrl+shift+x',
            videoSpeedSeconds: 7,
            playActivityHeartbeatMs: 20000,
            onlyTasks: [],
            dryRun: false,
            verbose: true
        };
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this.config = { ...this.config, ...config };
        this.log.info('Quest Completer plugin initialized');
    }

    async destroy() {
        this.log.info('Quest Completer plugin destroyed');
    }

    async afterInject(data) {
        if (!this.config.enabled) return;
        await this.deploy(data?.resourcePath);
    }

    async onDiscordStart() {
        if (!this.config.enabled) return;
        await this.deploy();
    }

    async onConfigChange(config) {
        this.config = { ...this.config, ...config };

        if (this.config.enabled) {
            await this.deploy();
        } else {
            await this.removeInjectScript();
        }
    }

    // ─── Deploy ──────────────────────────────────────────────────

    /**
     * Tulis inject.js (plus config) ke plugin-scripts milik Discord.
     * @param {string} [explicitResourcePath] - Path resources Discord, kalau sudah diketahui
     * @returns {Promise<boolean>}
     */
    async deploy(explicitResourcePath) {
        try {
            const resourcePath = explicitResourcePath || await this._findDiscordResourcePath();

            if (!resourcePath) {
                this.log.warn('Path resources Discord tidak ditemukan — skrip akan dideploy saat injeksi berikutnya');
                return false;
            }

            const appFolder = path.join(resourcePath, 'app');
            if (!await fs.pathExists(appFolder)) {
                this.log.debug(`Folder app tidak ada di ${resourcePath} — Discord belum diinjeksi`);
                return false;
            }

            const pluginScriptsDir = path.join(appFolder, 'plugin-scripts');
            await fs.ensureDir(pluginScriptsDir);

            const targetFile = path.join(pluginScriptsDir, SCRIPT_NAME);
            await fs.writeFile(targetFile, this._generateInjectScript(), 'utf8');

            this.log.success(`Quest Completer script deployed ke ${targetFile}`);
            return true;
        } catch (err) {
            this.log.error(`Gagal deploy quest completer: ${err.message}`);
            return false;
        }
    }

    /**
     * Hapus skrip dari plugin-scripts (dipakai saat plugin dimatikan).
     * @returns {Promise<boolean>}
     */
    async removeInjectScript() {
        try {
            const resourcePath = await this._findDiscordResourcePath();
            if (!resourcePath) return false;

            const targetFile = path.join(resourcePath, 'app', 'plugin-scripts', SCRIPT_NAME);
            if (await fs.pathExists(targetFile)) {
                await fs.remove(targetFile);
                this.log.info('Quest Completer script dihapus dari plugin-scripts');
            }
            return true;
        } catch (err) {
            this.log.error(`Gagal menghapus quest completer script: ${err.message}`);
            return false;
        }
    }

    // ─── Discord Resource Path ───────────────────────────────────

    async _findDiscordResourcePath() {
        // Prioritas 1: helper dari injector
        if (typeof this.api?.findDiscordPath === 'function') {
            try {
                const found = await this.api.findDiscordPath();
                if (found && await fs.pathExists(found)) return found;
            } catch { /* lanjut ke cara berikutnya */ }
        }

        // Prioritas 2: modul finder proyek
        try {
            const finder = await import('../../src/finder.js');
            if (finder && typeof finder.findDiscordPath === 'function') {
                const found = await finder.findDiscordPath();
                if (found && await fs.pathExists(found)) return found;
            }
        } catch { /* lanjut ke cara berikutnya */ }

        // Prioritas 3: inspeksi filesystem langsung
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
                        .filter((e) => e.startsWith('app-'))
                        .sort(compareAppVersionsDesc);

                    for (const appDir of appDirs) {
                        const resourcePath = path.join(basePath, appDir, 'resources');
                        if (await fs.pathExists(path.join(resourcePath, 'app'))) return resourcePath;
                        if (await fs.pathExists(path.join(resourcePath, 'original.asar'))) return resourcePath;
                        if (await fs.pathExists(path.join(resourcePath, 'app.asar'))) return resourcePath;
                    }
                } else if (platform === 'darwin') {
                    const resourcePath = path.join(basePath, 'Resources');
                    if (await fs.pathExists(resourcePath)) return resourcePath;
                } else {
                    const resourcePath = path.join(basePath, 'resources');
                    if (await fs.pathExists(resourcePath)) return resourcePath;
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    // ─── Inject Script Generation ────────────────────────────────

    _generateInjectScript() {
        const injectPath = path.join(__dirname, 'inject.js');

        let code = '';
        try {
            code = fs.readFileSync(injectPath, 'utf8');
        } catch (err) {
            this.log.error(`Gagal membaca inject.js: ${err.message}`);
        }

        const config = {
            enabled: this.config.enabled !== false,
            autoRun: this.config.autoRun === true,
            hotkeyStart: this.config.hotkeyStart || 'ctrl+shift+q',
            hotkeyStop: this.config.hotkeyStop || 'ctrl+shift+x',
            videoSpeedSeconds: Number(this.config.videoSpeedSeconds) || 7,
            playActivityHeartbeatMs: Number(this.config.playActivityHeartbeatMs) || 20000,
            onlyTasks: Array.isArray(this.config.onlyTasks) ? this.config.onlyTasks : [],
            dryRun: this.config.dryRun === true,
            verbose: this.config.verbose !== false
        };

        return `window.__QUEST_COMPLETER_CONFIG__ = ${JSON.stringify(config)};\n${code}`;
    }
}
