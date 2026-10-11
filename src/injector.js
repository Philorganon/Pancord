import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createBackup } from './backup.js';

function validateCSS(css, maxSize = 5 * 1024 * 1024) {
    const warnings = [];

    if (css === undefined || css === null) {
        return { valid: true, warnings: ['CSS content is undefined or null'] };
    }

    const trimmed = String(css).trim();

    if (trimmed.length === 0) {
        warnings.push('CSS file is empty');
        return { valid: true, warnings };
    }

    if (trimmed.length > maxSize) {
        warnings.push(`CSS exceeds recommended size of ${maxSize} bytes (${trimmed.length} bytes)`);
    }

    const openBraces = (trimmed.match(/{/g) || []).length;
    const closeBraces = (trimmed.match(/}/g) || []).length;

    if (openBraces !== closeBraces) {
        warnings.push(`Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`);
    }

    const lines = trimmed.split('\n');
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (inBlockComment) {
            if (line.includes('*/')) {
                inBlockComment = false;
                line = line.slice(line.indexOf('*/') + 2).trim();
            } else {
                continue;
            }
        }
        if (line.startsWith('/*')) {
            inBlockComment = true;
            if (!line.includes('*/')) continue;
            line = line.slice(line.indexOf('*/') + 2).trim();
        }
        if (line.length === 0 || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.endsWith('*/') || line.endsWith('{') || line.endsWith('}')) {
            continue;
        }
        if (!line.endsWith(';') && !line.endsWith(',') && !line.includes(':')) {
            warnings.push(`Possible missing semicolon at line ${i + 1}`);
            break;
        }
    }

    return { valid: true, warnings };
}

export async function injectDiscord(resourcePath, initialCSS) {
    const appFolder = path.join(resourcePath, 'app');
    const appAsarPath = path.join(resourcePath, 'app.asar');
    const originalAsarPath = path.join(resourcePath, 'original.asar');

    if (initialCSS !== undefined) {
        const validation = validateCSS(initialCSS);
        if (validation.warnings.length > 0) {
            validation.warnings.forEach(w => console.log(chalk.yellow(`[CSS Warning] ${w}`)));
        }
    }

    if (fs.existsSync(appAsarPath) && !fs.existsSync(originalAsarPath)) {
        console.log('Renaming app.asar -> original.asar...');
        await fs.rename(appAsarPath, originalAsarPath);
        await createBackup(appAsarPath);
    }

    await fs.ensureDir(appFolder);
    await fs.writeFile(path.join(appFolder, 'custom.css'), initialCSS);
    await fs.writeJson(path.join(appFolder, 'package.json'), { name: "pancord", main: "index.js" });

    const scriptContent = `
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const cssPath = path.join(__dirname, 'custom.css');
const settingsPath = path.join(__dirname, 'settings.json');

const getSettings = () => {
    try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { return {}; }
};

const applyResources = (window) => {
    if (window.isDestroyed()) return;
    const settings = getSettings();

    if (fs.existsSync(cssPath)) {
        window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8')).catch(e => {});
    }

    // Load plugin scripts from plugin-scripts folder
    const pluginScriptsDir = path.join(__dirname, 'plugin-scripts');
    if (fs.existsSync(pluginScriptsDir)) {
        try {
            const files = fs.readdirSync(pluginScriptsDir);
            for (const file of files) {
                if (file.endsWith('.js')) {
                    const filePath = path.join(pluginScriptsDir, file);
                    try {
                        const code = fs.readFileSync(filePath, 'utf8');
                        window.webContents.executeJavaScript(code).catch(e => {
                            console.error('[Injector] Error executing plugin script ' + file + ':', e);
                        });
                    } catch (e) {
                        console.error('[Injector] Error reading plugin script ' + file + ':', e);
                    }
                }
            }
        } catch (e) {
            console.error('[Injector] Error reading plugin-scripts directory:', e);
        }
    }

    const soundUrl = settings.notificationSound;
    if (soundUrl) {
        try {
            const filter = { urls: ["*://*.discord.com/assets/*.mp3", "*://*.discordapp.com/assets/*.mp3", "*://*.discord.com/assets/*.ogg"] };
            window.webContents.session.webRequest.onBeforeRequest(filter, (details, callback) => {
                const url = details.url.toLowerCase();
                if (url.includes('notification') || url.includes('message') || url.includes('23101d2d')) {
                    return callback({ redirectURL: soundUrl });
                }
                callback({});
            });
        } catch (e) {}

        const code = \`(function() {
            if (window._soundHooked) return;
            window._soundHooked = true;
            const target = "\${soundUrl}";
            const isM = (s) => s && typeof s === 'string' && (s.includes('notification') || s.includes('message') || s.includes('assets/'));
            
            const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (desc) {
                Object.defineProperty(HTMLMediaElement.prototype, 'src', {
                    get: function() { return desc.get.call(this); },
                    set: function(v) { return desc.set.call(this, isM(v) ? target : v); }
                });
            }
            
            const OldAudio = window.Audio;
            window.Audio = class extends OldAudio {
                constructor(src) { super(isM(src) ? target : src); }
            };
        })();\`;
        window.webContents.executeJavaScript(code).catch(e => {});
    }

    // Bridge Discord auth token for plugins
    try {
        const apiFilter = { urls: ["*://*.discord.com/api/*", "*://discord.com/api/*"] };
        window.webContents.session.webRequest.onBeforeSendHeaders(apiFilter, (details, callback) => {
            const auth = details.requestHeaders['Authorization'] || details.requestHeaders['authorization'];
            if (auth && typeof auth === 'string' && auth.length > 20 && !auth.startsWith('Bot ')) {
                global.__DISCORD_USER_TOKEN__ = auth;
                window.webContents.executeJavaScript(\`
                    window.__DISCORD_USER_TOKEN__ = \${JSON.stringify(auth)};
                    if (typeof window.__pft_onTokenCaptured === 'function') {
                        window.__pft_onTokenCaptured(\${JSON.stringify(auth)});
                    }
                \`).catch(() => {});
            }
            callback({ requestHeaders: details.requestHeaders });
        });
    } catch (e) {}

    if (global.__DISCORD_USER_TOKEN__) {
        window.webContents.executeJavaScript(\`window.__DISCORD_USER_TOKEN__ = \${JSON.stringify(global.__DISCORD_USER_TOKEN__)};\`).catch(() => {});
    }
};

app.on('browser-window-created', (e, window) => {
    window.webContents.on('dom-ready', () => applyResources(window));
});

const originalAsar = path.join(process.resourcesPath, 'original.asar');
if (fs.existsSync(originalAsar)) {
    require(originalAsar);
}
`;

    await fs.writeFile(path.join(appFolder, 'index.js'), scriptContent);
    const setPath = path.join(appFolder, 'settings.json');
    if (!fs.existsSync(setPath)) await fs.writeJson(setPath, {});

    console.log('Injection script and settings created');
    return true;
}

export async function reinjectDiscord(resourcePath, cssContent) {
    const appFolder = path.join(resourcePath, 'app');
    const cssTarget = path.join(appFolder, 'custom.css');

    if (cssContent !== undefined) {
        const validation = validateCSS(cssContent);
        if (validation.warnings.length > 0) {
            validation.warnings.forEach(w => console.log(chalk.yellow(`[CSS Warning] ${w}`)));
        }
    }

    try {
        await fs.writeFile(cssTarget, cssContent);
        return true;
    } catch (e) {
        console.log(chalk.red(`[Reinject Error] ${e.message}`));
        return false;
    }
}

export async function restoreDiscord(resourcePath) {
    const appFolder = path.join(resourcePath, 'app');
    const appAsarPath = path.join(resourcePath, 'app.asar');
    const originalAsarPath = path.join(resourcePath, 'original.asar');

    let restored = false;

    if (fs.existsSync(appFolder)) {
        console.log('Removing app folder...');
        await fs.remove(appFolder);
        restored = true;
    }

    if (fs.existsSync(originalAsarPath)) {
        console.log('Restoring original.asar -> app.asar...');

        if (fs.existsSync(appAsarPath)) {
            await fs.remove(appAsarPath);
        }

        await fs.rename(originalAsarPath, appAsarPath);
        console.log('app.asar restored');
        restored = true;
    }

    return restored;
}
