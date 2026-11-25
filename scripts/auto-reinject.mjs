import fs from 'fs-extra';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { findDiscordPath } from '../src/finder.js';
import { injectDiscord } from '../src/injector.js';
import { pluginManager } from '../src/plugins/manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TASK_NAME = 'PancordAutoReinject';
const LOG_PATH = path.join(ROOT_DIR, 'logs', 'auto-reinject.log');

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try {
        fs.ensureDirSync(path.dirname(LOG_PATH));
        fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
    } catch (_) {}
}

function isDiscordRunning() {
    try {
        const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Discord.exe', '/NH'], { encoding: 'utf8' });
        return out.toLowerCase().includes('discord.exe');
    } catch (_) {
        return false;
    }
}

function killDiscord() {
    try {
        execFileSync('taskkill', ['/F', '/IM', 'Discord.exe'], { stdio: 'ignore' });
    } catch (_) {}
}

function launchDiscordDetached() {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return false;
    const updateExe = path.join(localAppData, 'Discord', 'Update.exe');
    if (!fs.existsSync(updateExe)) return false;

    const child = spawn(updateExe, ['--processStart', 'Discord.exe'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
    });
    child.unref();
    return true;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function resolveActiveCss(config) {
    const activeTheme = config?.activeTheme;
    if (activeTheme) {
        const themePath = path.join(ROOT_DIR, 'src', 'css', 'themes', `${activeTheme}.css`);
        if (await fs.pathExists(themePath)) {
            return { css: await fs.readFile(themePath, 'utf8'), source: `theme:${activeTheme}` };
        }
    }
    const customPath = path.join(ROOT_DIR, 'custom.css');
    if (await fs.pathExists(customPath)) {
        return { css: await fs.readFile(customPath, 'utf8'), source: 'custom.css' };
    }
    return { css: '', source: 'empty' };
}

async function checkAndReinject({ force = false, restartIfRunning = true } = {}) {
    process.chdir(ROOT_DIR);

    const found = await findDiscordPath();
    const resourcePath = typeof found === 'string' ? found : (found?.path || found?.resourcePath);
    if (!resourcePath) {
        log('Discord resource path tidak ditemukan.');
        return { status: 'not-found' };
    }

    const appIndex = path.join(resourcePath, 'app', 'index.js');
    const originalAsar = path.join(resourcePath, 'original.asar');
    const alreadyInjected = (await fs.pathExists(appIndex)) && (await fs.pathExists(originalAsar));

    if (alreadyInjected && !force) {
        return { status: 'already-injected', resourcePath };
    }

    log(`Update Discord terdeteksi di ${resourcePath}. Memulai auto-reinject...`);

    const wasRunning = isDiscordRunning();
    if (wasRunning && restartIfRunning) {
        killDiscord();
        await sleep(1500);
    }

    const configPath = path.join(ROOT_DIR, 'config.json');
    const config = (await fs.pathExists(configPath)) ? await fs.readJson(configPath) : {};
    const { css, source } = await resolveActiveCss(config);

    await fs.writeFile(path.join(ROOT_DIR, 'custom.css'), css, 'utf8');
    await injectDiscord(resourcePath, css);

    config.lastInjection = new Date().toISOString();
    await fs.writeJson(configPath, config, { spaces: 2 });

    const enabledPlugins = config?.plugins?.enabled || [];
    for (const slug of enabledPlugins) {
        try {
            await pluginManager.enable(slug, { persistGlobal: true });
        } catch (err) {
            log(`Gagal deploy plugin ${slug}: ${err.message}`);
        }
    }

    log(`Auto-reinject selesai (${source}, ${enabledPlugins.length} plugin aktif).`);

    if (wasRunning && restartIfRunning) {
        launchDiscordDetached();
        log('Discord dijalankan ulang.');
    }

    return { status: 'reinjected', resourcePath, source, plugins: enabledPlugins };
}

function getStartupVbsPath() {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'PancordAutoReinject.vbs');
}

function installScheduledTask() {
    const vbsPath = path.join(__dirname, 'auto-reinject-silent.vbs');
    if (!fs.existsSync(vbsPath)) {
        throw new Error(`File tidak ditemukan: ${vbsPath}`);
    }

    const tr = `wscript.exe //B //Nologo "${vbsPath}"`;
    // Task periodik setiap 5 menit (tanpa perlu hak Administrator)
    execFileSync('schtasks', [
        '/Create',
        '/TN', TASK_NAME,
        '/SC', 'MINUTE',
        '/MO', '5',
        '/TR', tr,
        '/F'
    ], { stdio: 'inherit' });

    // Salin launcher silent ke folder Windows Startup user (jalan otomatis saat login)
    const startupVbs = getStartupVbsPath();
    if (startupVbs) {
        fs.copyFileSync(vbsPath, startupVbs);
    }

    log(`Auto-Reinject Guard aktif: task ${TASK_NAME} (tiap 5 menit) + Windows Startup.`);
}

function uninstallScheduledTask() {
    try {
        execFileSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { stdio: 'ignore' });
        log(`Scheduled Task dihapus: ${TASK_NAME}`);
    } catch (_) {}

    const startupVbs = getStartupVbsPath();
    if (startupVbs && fs.existsSync(startupVbs)) {
        fs.removeSync(startupVbs);
        log(`Startup launcher dihapus: ${startupVbs}`);
    }
}

const args = process.argv.slice(2);
if (args.includes('--install-task')) {
    installScheduledTask();
} else if (args.includes('--uninstall-task')) {
    uninstallScheduledTask();
} else {
    const force = args.includes('--force');
    const noRestart = args.includes('--no-restart');
    const res = await checkAndReinject({ force, restartIfRunning: !noRestart });
    if (args.includes('--verbose') || res.status !== 'already-injected') {
        console.log(JSON.stringify(res));
    }
}
