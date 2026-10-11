/**
 * @fileoverview Helper bersama untuk plugin yang mendeploy script ke Discord.
 * @description Menghindari duplikasi logika pencarian path resources Discord dan
 *   penulisan file ke <Discord>/resources/app/plugin-scripts/.
 */

import fs from 'fs-extra';
import path from 'path';

/**
 * Bandingkan nama folder "app-X.Y.Z" secara numerik (descending, versi terbaru duluan).
 */
export function compareAppVersionsDesc(a, b) {
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

/**
 * Cari folder resources Discord yang aktif.
 * Urutan: helper injector → modul finder proyek → inspeksi filesystem langsung.
 *
 * @param {Object} [api] - API plugin (biasanya berisi findDiscordPath)
 * @returns {Promise<string|null>}
 */
export async function findDiscordResourcePath(api) {
    if (api && typeof api.findDiscordPath === 'function') {
        try {
            const found = await api.findDiscordPath();
            if (found && await fs.pathExists(found)) return found;
        } catch { /* lanjut ke cara berikutnya */ }
    }

    try {
        const finder = await import('../finder.js');
        if (finder && typeof finder.findDiscordPath === 'function') {
            const found = await finder.findDiscordPath();
            if (found && await fs.pathExists(found)) return found;
        }
    } catch { /* lanjut ke cara berikutnya */ }

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

/**
 * Buat deployer script plugin.
 *
 * @param {Object} options
 * @param {Object} options.api - API plugin
 * @param {Object} options.log - logger plugin
 * @param {string} options.pluginDir - folder plugin (berisi inject.js)
 * @param {string} options.scriptName - nama file di plugin-scripts (mis. "privacy-blur.js")
 * @param {string} [options.configGlobalName] - nama global window untuk config, mis. "__PRIVACY_BLUR_CONFIG__"
 * @param {Function} [options.buildConfig] - fungsi yang mengembalikan objek config saat deploy
 * @returns {{deploy: Function, remove: Function, buildCode: Function}}
 */
export function createScriptDeployer({ api, log, pluginDir, scriptName, configGlobalName, buildConfig }) {
    const injectPath = path.join(pluginDir, 'inject.js');

    function buildCode() {
        const code = fs.readFileSync(injectPath, 'utf8');
        if (!configGlobalName) return code;

        let config = {};
        if (typeof buildConfig === 'function') {
            try {
                config = buildConfig() || {};
            } catch (err) {
                log.warn(`buildConfig gagal untuk ${scriptName}: ${err.message}`);
            }
        }

        return `window.${configGlobalName} = ${JSON.stringify(config)};\n${code}`;
    }

    return {
        buildCode,

        /**
         * Tulis script ke <Discord>/resources/app/plugin-scripts/.
         * @param {string} [explicitResourcePath]
         * @returns {Promise<boolean>}
         */
        async deploy(explicitResourcePath) {
            try {
                const resourcePath = explicitResourcePath || await findDiscordResourcePath(api);
                if (!resourcePath) {
                    log.warn('Path resources Discord tidak ditemukan — script akan dideploy saat injeksi berikutnya');
                    return false;
                }

                const appFolder = path.join(resourcePath, 'app');
                if (!await fs.pathExists(appFolder)) {
                    log.debug(`Folder app tidak ada di ${resourcePath} — Discord belum diinjeksi`);
                    return false;
                }

                const scriptsDir = path.join(appFolder, 'plugin-scripts');
                await fs.ensureDir(scriptsDir);

                const target = path.join(scriptsDir, scriptName);
                await fs.writeFile(target, buildCode(), 'utf8');

                log.success(`Script dideploy: ${target}`);
                return true;
            } catch (err) {
                log.error(`Gagal deploy ${scriptName}: ${err.message}`);
                return false;
            }
        },

        /**
         * Hapus script dari plugin-scripts (dipakai saat plugin dimatikan).
         * @returns {Promise<boolean>}
         */
        async remove() {
            try {
                const resourcePath = await findDiscordResourcePath(api);
                if (!resourcePath) return false;

                const target = path.join(resourcePath, 'app', 'plugin-scripts', scriptName);
                if (await fs.pathExists(target)) {
                    await fs.remove(target);
                    log.info(`Script dihapus: ${target}`);
                }
                return true;
            } catch (err) {
                log.error(`Gagal menghapus ${scriptName}: ${err.message}`);
                return false;
            }
        }
    };
}
