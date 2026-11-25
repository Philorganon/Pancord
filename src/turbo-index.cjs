// ==============================================================================
// PANCORD TURBO ENGINE - FAST BOOT & SMART MEMORY OPTIMIZER
// ==============================================================================

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const Module = require('module');
const { execFile } = require('child_process');

// 1. Preserve V8 bytecode cache, GPU shader cache, and fast TTI settings BEFORE Discord core reads settings.json
try {
    const appData = process.env.APPDATA || app.getPath('appData');
    const userSettingsPath = path.join(appData, 'discord', 'settings.json');
    if (fs.existsSync(userSettingsPath)) {
        const cfg = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8') || '{}');
        const desired = {
            BACKGROUND_COLOR: '#1A1218',
            OPEN_ON_STARTUP: false,
            MINIMIZE_TO_TRAY: true,
            DESKTOP_TTI_REMOVE_V8_CACHE_CLEAR: true,
            DESKTOP_TTI_REMOVE_SHADER_CACHE_CLEAR: true,
            DESKTOP_TTI_DNSTCP_WARMUP: true,
            DESKTOP_TTI_HTTP_CDT: false,
            DESKTOP_NATIVE_PREMAP: true,
            DESKTOP_TTI_UPDATE_CHECK_DEADLINE_MS: 2000,
            DESKTOP_PROCESS_POLLING_PERF: false,
            DESKTOP_TTI_LEGACY_OVERLAY_WORKER: false
        };
        let dirty = false;
        for (const [k, v] of Object.entries(desired)) {
            if (cfg[k] !== v) {
                cfg[k] = v;
                dirty = true;
            }
        }
        if (dirty) {
            fs.writeFileSync(userSettingsPath, JSON.stringify(cfg, null, 2), 'utf8');
        }
    }
} catch (_) {}

// 2. Chromium / V8 flags: persistent code cache, GPU rasterization, balanced 320MB boot heap + --expose-gc
try {
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=320 --expose-gc');
    app.commandLine.appendSwitch('v8-cache-options', 'code');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
} catch (_) {}

// 3. Skip blocking startup network check to updates.discord.com when all local modules are verified installed
const origModuleLoad = Module._load;
let firstBootUpdateSkipped = false;

Module._load = function (request, parent, isMain) {
    const loaded = origModuleLoad.apply(this, arguments);
    if (
        !firstBootUpdateSkipped &&
        typeof request === 'string' &&
        request.toLowerCase().endsWith('updater.node') &&
        loaded &&
        typeof loaded.Updater === 'function' &&
        !loaded.__pancordWrapped
    ) {
        const NativeUpdater = loaded.Updater;
        class FastBootUpdater {
            constructor(options) {
                this._inner = new NativeUpdater(options);
                this._responseHandler = options && options.response_handler;
            }
            command(payload) {
                if (!firstBootUpdateSkipped && typeof payload === 'string' && this._responseHandler) {
                    try {
                        const [reqId, detail] = JSON.parse(payload);
                        if (detail && typeof detail === 'object' && detail.UpdateToLatest) {
                            const syncRaw = this._inner.command_blocking(
                                JSON.stringify([999999, { QueryCurrentVersions: { options: null } }])
                            );
                            const syncRes = JSON.parse(syncRaw);
                            const vi = syncRes && syncRes.VersionInfo;
                            const hostVer = Array.isArray(vi && vi.current_host) ? 'app-' + vi.current_host.join('.') : '';
                            const curExeFolder = path.basename(path.dirname(process.execPath));
                            const reqMods = vi && vi.last_successful_update && vi.last_successful_update.required_modules;
                            const curMods = (vi && vi.current_modules) || {};
                            const allPresent =
                                hostVer === curExeFolder &&
                                Array.isArray(reqMods) &&
                                reqMods.length > 0 &&
                                reqMods.every((m) => Object.prototype.hasOwnProperty.call(curMods, m));

                            if (allPresent) {
                                firstBootUpdateSkipped = true;
                                console.log('[Pancord FastBoot] Bypassed blocking startup update check (modules cached locally).');
                                setImmediate(() => {
                                    try {
                                        this._responseHandler(JSON.stringify([reqId, 'Ok']));
                                    } catch (_) {}
                                });
                                return;
                            }
                        }
                    } catch (_) {}
                }
                return this._inner.command(payload);
            }
            command_blocking(payload) {
                return this._inner.command_blocking(payload);
            }
            known_folder(name) {
                return this._inner.known_folder(name);
            }
            create_shortcut(options) {
                return this._inner.create_shortcut(options);
            }
            destroy() {
                return this._inner.destroy();
            }
        }
        loaded.__pancordWrapped = true;
        loaded.Updater = FastBootUpdater;
    }
    return loaded;
};

const cssPath = path.join(__dirname, 'custom.css');
const pluginScriptsDir = path.join(__dirname, 'plugin-scripts');
const trimExePath = path.join(__dirname, 'trim_memory.exe');

let cachedCss = null;
const readCustomCss = () => {
    try {
        if (cachedCss === null && fs.existsSync(cssPath)) {
            cachedCss = fs.readFileSync(cssPath, 'utf8');
        }
        return cachedCss || '';
    } catch (_) {
        return '';
    }
};

const pushCssToWindow = (window, cssText) => {
    if (!window || window.isDestroyed()) return;
    const escapedCss = (cssText || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    if (!escapedCss) return;
    window.webContents.executeJavaScript(`
        (function() {
            let style = document.getElementById('pancord-custom-css');
            if (!style) {
                style = document.createElement('style');
                style.id = 'pancord-custom-css';
                (document.head || document.documentElement).appendChild(style);
            }
            style.textContent = \`${escapedCss}\`;
        })();
    `).catch(() => {});
};

// Shallow debounced watcher on app directory for custom.css realtime theme updates
try {
    let cssWatchTimer = null;
    fs.watch(__dirname, (eventType, filename) => {
        if (filename !== 'custom.css') return;
        if (cssWatchTimer) clearTimeout(cssWatchTimer);
        cssWatchTimer = setTimeout(() => {
            cssWatchTimer = null;
            try {
                if (!fs.existsSync(cssPath)) return;
                const nextCss = fs.readFileSync(cssPath, 'utf8');
                if (nextCss === cachedCss) return;
                cachedCss = nextCss;
                const wins = BrowserWindow ? BrowserWindow.getAllWindows() : [];
                for (const w of wins) {
                    if (w && !w.isDestroyed()) {
                        const url = w.webContents.getURL();
                        if (url && url.startsWith('https://')) {
                            pushCssToWindow(w, cachedCss);
                        }
                    }
                }
            } catch (_) {}
        }, 120);
    });
} catch (_) {}

const ensurePluginRuntimeScript = `
    (function() {
        if (typeof window.__PANCORD_REGISTER_STOP__ !== 'function') {
            window.__PANCORD_PLUGIN_STOPPERS__ = window.__PANCORD_PLUGIN_STOPPERS__ || Object.create(null);
            window.__PANCORD_REGISTER_STOP__ = function(slug, fn) {
                if (slug && typeof fn === 'function') {
                    window.__PANCORD_PLUGIN_STOPPERS__[slug] = fn;
                }
            };
        }
        if (typeof window.__PANCORD_DISABLE_PLUGIN__ !== 'function') {
            window.__PANCORD_DISABLE_PLUGIN__ = function(slug) {
                try {
                    const fn = window.__PANCORD_PLUGIN_STOPPERS__ && window.__PANCORD_PLUGIN_STOPPERS__[slug];
                    if (typeof fn === 'function') {
                        try { fn(); } catch (_) {}
                        delete window.__PANCORD_PLUGIN_STOPPERS__[slug];
                    }
                    const fallbacks = {
                        'account-switcher': () => { window.__pancordAccountSwitcher && window.__pancordAccountSwitcher.stop && window.__pancordAccountSwitcher.stop(); delete window.__pancordAccountSwitcher; },
                        'better-media': () => { window.__BETTER_MEDIA_INSTANCE__ && window.__BETTER_MEDIA_INSTANCE__.stop && window.__BETTER_MEDIA_INSTANCE__.stop(); delete window.__BETTER_MEDIA_INSTANCE__; },
                        'deepseek-webhook': () => { window.__DEEPSEEK_WEBHOOK_INSTANCE__ && window.__DEEPSEEK_WEBHOOK_INSTANCE__.stop && window.__DEEPSEEK_WEBHOOK_INSTANCE__.stop(); delete window.__DEEPSEEK_WEBHOOK_INSTANCE__; },
                        'edit-history': () => { window.__editHistory && window.__editHistory.stop && window.__editHistory.stop(); delete window.__editHistory; },
                        'fake-deafen': () => {
                            if (typeof window.__PANCORD_FAKE_DEAFEN_CLEANUP__ === 'function') window.__PANCORD_FAKE_DEAFEN_CLEANUP__();
                            if (typeof window.__fdCleanup === 'function') window.__fdCleanup();
                            ['pancord-fake-deafen-panel-btn', 'pancord-fakedeaf-hud', 'pancord-fakedeaf-toast', 'pancord-fakedeaf-modal-backdrop', 'pancord-fake-deafen-styles'].forEach((id) => {
                                const el = document.getElementById(id);
                                if (el) el.remove();
                            });
                            delete window.__fakeDeafen; delete window.pancordFakeDeafen; delete window.fd;
                        },
                        'fake-nitro-emojis': () => { window.__fakeNitroEmojis && window.__fakeNitroEmojis.stop && window.__fakeNitroEmojis.stop(); delete window.__fakeNitroEmojis; },
                        'false-positive-helper': () => { window.__falsePositiveHelper && window.__falsePositiveHelper.stop && window.__falsePositiveHelper.stop(); delete window.__FALSE_POSITIVE_HELPER_LOADED; },
                        'game-farmer': () => { window.__gameFarmer && window.__gameFarmer.cleanup && window.__gameFarmer.cleanup(); delete window.__GAME_FARMER_LOADED; delete window.__gameFarmer; },
                        'groq-auto-reply': () => { window.__GROQ_AUTO_REPLY_INSTANCE__ && window.__GROQ_AUTO_REPLY_INSTANCE__.stop && window.__GROQ_AUTO_REPLY_INSTANCE__.stop(); delete window.__GROQ_AUTO_REPLY_INSTANCE__; },
                        'live-bridge': () => { window.__liveBridge && window.__liveBridge.stop && window.__liveBridge.stop(); delete window.__liveBridge; },
                        'pending-friend-tracker': () => { window.__pendingFriendTracker && window.__pendingFriendTracker.stop && window.__pendingFriendTracker.stop(); delete window.__pendingFriendTrackerInjected; },
                        'privacy-blur': () => { window.__privacyBlur && window.__privacyBlur.stop && window.__privacyBlur.stop(); delete window.__privacyBlur; },
                        'quest-completer': () => {
                            if (window.__questCompleter && typeof window.__questCompleter.destroy === 'function') window.__questCompleter.destroy();
                            else if (window.__questCompleter && typeof window.__questCompleter.stop === 'function') window.__questCompleter.stop('disabled');
                            delete window.__questCompleter;
                        },
                        'quick-send': () => { window.__quickSend && window.__quickSend.stop && window.__quickSend.stop(); delete window.__quickSendInjected; },
                        'ram-optimizer': () => { window.__ramOptimizer && window.__ramOptimizer.stop && window.__ramOptimizer.stop(); delete window.__RAM_OPTIMIZER_LOADED; },
                        'realtime-translator': () => { window.__REALTIME_TRANSLATOR_INSTANCE__ && window.__REALTIME_TRANSLATOR_INSTANCE__.stop && window.__REALTIME_TRANSLATOR_INSTANCE__.stop(); delete window.__REALTIME_TRANSLATOR_INSTANCE__; },
                        'sound-replacer': () => { window.__soundReplacer && window.__soundReplacer.stop && window.__soundReplacer.stop(); delete window.__soundReplacer; },
                        'split-view': () => { window.__splitView && window.__splitView.stop && window.__splitView.stop(); delete window.__splitView; },
                        'typing-controller': () => { window.__typingController && window.__typingController.stop && window.__typingController.stop(); delete window.__PANCORD_TYPING_CTRL_INJECTED__; }
                    };
                    if (fallbacks[slug]) {
                        try { fallbacks[slug](); } catch (_) {}
                    }
                } catch (_) {}
            };
        }
    })();
`;

const loadActivePluginScripts = (window) => {
    if (!window || window.isDestroyed() || !fs.existsSync(pluginScriptsDir)) return;
    try {
        window.webContents.executeJavaScript(ensurePluginRuntimeScript).catch(() => {});
        const files = fs.readdirSync(pluginScriptsDir);
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.endsWith('.js')) continue;
            try {
                const code = fs.readFileSync(path.join(pluginScriptsDir, file), 'utf8');
                if (code) window.webContents.executeJavaScript(ensurePluginRuntimeScript + '\n' + code).catch(() => {});
            } catch (_) {}
        }
    } catch (_) {}
};

// Shallow debounced watcher on plugin-scripts for instant ON/OFF reload without restarting Discord
try {
    if (!fs.existsSync(pluginScriptsDir)) {
        fs.mkdirSync(pluginScriptsDir, { recursive: true });
    }
    const watchDebounce = new Map();
    fs.watch(pluginScriptsDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.js')) return;
        const fullPath = path.join(pluginScriptsDir, filename);
        const slug = filename.replace(/\.js$/i, '');
        if (watchDebounce.has(fullPath)) clearTimeout(watchDebounce.get(fullPath));
        watchDebounce.set(fullPath, setTimeout(() => {
            watchDebounce.delete(fullPath);
            try {
                const wins = BrowserWindow ? BrowserWindow.getAllWindows() : [];
                if (!fs.existsSync(fullPath)) {
                    const disableCode = ensurePluginRuntimeScript + '\ntry { window.__PANCORD_DISABLE_PLUGIN__(' + JSON.stringify(slug) + '); } catch (_) {}';
                    for (const w of wins) {
                        if (w && !w.isDestroyed()) {
                            const url = w.webContents.getURL();
                            if (url && url.startsWith('https://')) {
                                w.webContents.executeJavaScript(disableCode).catch(() => {});
                            }
                        }
                    }
                    return;
                }
                const code = fs.readFileSync(fullPath, 'utf8');
                const runCode = ensurePluginRuntimeScript + '\n' + code;
                for (const w of wins) {
                    if (w && !w.isDestroyed()) {
                        const url = w.webContents.getURL();
                        if (url && url.startsWith('https://')) {
                            w.webContents.executeJavaScript(runCode).catch(() => {});
                        }
                    }
                }
            } catch (_) {}
        }, 150));
    });
} catch (_) {}

// 4. Post-boot Win32 Working Set & V8 GC trimmer (NEVER runs during boot, NEVER clears HTTP disk cache)
let isTrimming = false;
let bootCompleted = false;

const runWorkingSetTrim = () => {
    if (!bootCompleted || isTrimming) return;
    isTrimming = true;
    try {
        if (typeof global.gc === 'function') {
            global.gc();
        }
        const windows = BrowserWindow ? BrowserWindow.getAllWindows() : [];
        for (const w of windows) {
            if (w && !w.isDestroyed()) {
                const url = w.webContents.getURL();
                if (url && url.startsWith('https://')) {
                    w.webContents.executeJavaScript(
                        'if (typeof window.gc === "function") { if (window.requestIdleCallback) window.requestIdleCallback(() => window.gc(), { timeout: 1500 }); else window.gc(); }'
                    ).catch(() => {});
                }
            }
        }
        if (fs.existsSync(trimExePath)) {
            execFile(trimExePath, [], { windowsHide: true }, () => {
                isTrimming = false;
            });
        } else {
            isTrimming = false;
        }
    } catch (_) {
        isTrimming = false;
    }
};

ipcMain.once('DISCORD_APP_ASYNC_INDEX_TSX_LOADED', () => {
    bootCompleted = true;
    setTimeout(runWorkingSetTrim, 10000);
    setTimeout(runWorkingSetTrim, 25000);
});

setInterval(runWorkingSetTrim, 45000);

const applyResources = (window) => {
    if (!window || window.isDestroyed()) return;
    pushCssToWindow(window, readCustomCss());

    window.webContents.executeJavaScript(`
        (function() {
            if (window._pancordFastEngine) return;
            window._pancordFastEngine = true;

            const blockedPatterns = ['/science', '/track', 'sentry.io', '/error-reporting-proxy', '/metrics'];
            const isBlocked = (u) => {
                if (!u) return false;
                for (let i = 0; i < blockedPatterns.length; i++) {
                    if (u.indexOf(blockedPatterns[i]) !== -1) return true;
                }
                return false;
            };

            const origFetch = window.fetch;
            window.__PANCORD_NET_LOG__ = window.__PANCORD_NET_LOG__ || [];
            const pushNetLog = (entry) => {
                try {
                    window.__PANCORD_NET_LOG__.push(entry);
                    if (window.__PANCORD_NET_LOG__.length > 300) {
                        window.__PANCORD_NET_LOG__.splice(0, window.__PANCORD_NET_LOG__.length - 300);
                    }
                } catch (_) {}
            };

            if (origFetch) {
                window.fetch = function(input, init) {
                    const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                    const method = (init && init.method) || (input && input.method) || 'GET';
                    if (isBlocked(url)) {
                        pushNetLog({ ts: Date.now(), type: 'fetch', method, url, status: 204, blocked: true, durationMs: 0 });
                        return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
                    }
                    const start = Date.now();
                    return origFetch.apply(this, arguments).then((res) => {
                        pushNetLog({ ts: start, type: 'fetch', method, url, status: res ? res.status : 0, durationMs: Date.now() - start });
                        return res;
                    }, (err) => {
                        pushNetLog({ ts: start, type: 'fetch', method, url, status: 0, error: String(err && err.message ? err.message : err), durationMs: Date.now() - start });
                        throw err;
                    });
                };
            }

            if (window.XMLHttpRequest && !window.__PANCORD_XHR_LOGGED__) {
                window.__PANCORD_XHR_LOGGED__ = true;
                const origOpen = XMLHttpRequest.prototype.open;
                const origSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function(method, url) {
                    this.__pancordNetMeta = { method: String(method || 'GET'), url: String(url || ''), start: 0 };
                    return origOpen.apply(this, arguments);
                };
                XMLHttpRequest.prototype.send = function() {
                    if (this.__pancordNetMeta) {
                        const meta = this.__pancordNetMeta;
                        meta.start = Date.now();
                        this.addEventListener('loadend', () => {
                            pushNetLog({
                                ts: meta.start,
                                type: 'xhr',
                                method: meta.method,
                                url: meta.url,
                                status: this.status || 0,
                                durationMs: Date.now() - meta.start
                            });
                        }, { once: true });
                    }
                    return origSend.apply(this, arguments);
                };
            }

            if (navigator.sendBeacon) {
                const origBeacon = navigator.sendBeacon.bind(navigator);
                navigator.sendBeacon = function(url, data) {
                    if (isBlocked(String(url || ''))) return true;
                    return origBeacon(url, data);
                };
            }

            document.addEventListener('visibilitychange', () => {
                if (document.hidden && typeof window.gc === 'function') {
                    window.gc();
                }
            });
        })();
    `).catch(() => {});

    loadActivePluginScripts(window);
};

// 5. Localhost-only Live Debug & Inspection Bridge (127.0.0.1:9229)
// Enables live screenshot capture, DOM/JS evaluation, console logs, and network inspection
const PANCORD_DEBUG_PORT = Number(process.env.PANCORD_DEBUG_PORT) || 9229;
const pancordConsoleLogs = [];
const MAX_CONSOLE_LOGS = 500;
const CONSOLE_LEVELS = ['verbose', 'info', 'warn', 'error'];

const getPrimaryDiscordWindow = () => {
    const wins = BrowserWindow ? BrowserWindow.getAllWindows() : [];
    const discordWins = wins.filter((w) => {
        if (!w || w.isDestroyed()) return false;
        try {
            const u = w.webContents.getURL() || '';
            return u.startsWith('https://discord.com') || u.startsWith('https://ptb.discord.com') || u.startsWith('https://canary.discord.com') || u.startsWith('https://');
        } catch (_) {
            return false;
        }
    });
    return discordWins.find((w) => w.isVisible()) || discordWins[0] || wins.find((w) => w && !w.isDestroyed()) || null;
};

const readBodyJson = (req) => new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 2 * 1024 * 1024) raw = raw.slice(0, 2 * 1024 * 1024);
    });
    req.on('end', () => {
        try {
            resolve(raw ? JSON.parse(raw) : {});
        } catch (_) {
            resolve({ raw });
        }
    });
    req.on('error', () => resolve({}));
});

const sendJson = (res, statusCode, payload) => {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(JSON.stringify(payload, null, 2));
};

const httpsGetJson = (hostname, reqPath) => new Promise((resolve, reject) => {
    const req = https.request({
        hostname,
        port: 443,
        path: reqPath,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
        }
    }, (resp) => {
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => {
            if ((resp.statusCode || 0) < 200 || (resp.statusCode || 0) >= 300) {
                return reject(new Error(`HTTP ${resp.statusCode}`));
            }
            try {
                resolve(JSON.parse(data));
            } catch (_) {
                reject(new Error('Invalid JSON response'));
            }
        });
    });
    req.setTimeout(8000, () => {
        req.destroy(new Error('Timeout'));
    });
    req.on('error', reject);
    req.end();
});

const translateCache = new Map();
const translateTextNode = async (text, fromLang = 'auto', toLang = 'id') => {
    const clean = String(text || '').trim();
    if (!clean) return { translated: '', detectedLang: fromLang };
    const sl = String(fromLang || 'auto').trim();
    const tl = String(toLang || 'id').trim();
    const cacheKey = `${sl}|${tl}|${clean}`;
    if (translateCache.has(cacheKey)) {
        return translateCache.get(cacheKey);
    }

    let out = null;
    const errors = [];

    // Provider 1: Google Chrome Extension endpoint (clients5.google.com)
    if (!out) {
        try {
            const qs = `client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(clean)}`;
            const parsed = await httpsGetJson('clients5.google.com', `/translate_a/t?${qs}`);
            if (Array.isArray(parsed)) {
                if (typeof parsed[0] === 'string') {
                    out = { translated: parsed[0].trim(), detectedLang: sl };
                } else if (Array.isArray(parsed[0]) && typeof parsed[0][0] === 'string') {
                    out = { translated: parsed[0][0].trim(), detectedLang: String(parsed[0][1] || sl) };
                }
            }
        } catch (e) {
            errors.push(`clients5:${e.message}`);
        }
    }

    // Provider 2: Google Translate gtx
    if (!out) {
        try {
            const qs = `client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(clean)}`;
            const parsed = await httpsGetJson('translate.googleapis.com', `/translate_a/single?${qs}`);
            const translated = Array.isArray(parsed?.[0])
                ? parsed[0].map((seg) => (Array.isArray(seg) ? seg[0] : '')).join('')
                : '';
            if (translated.trim()) {
                out = {
                    translated: translated.trim(),
                    detectedLang: typeof parsed?.[2] === 'string' ? parsed[2] : sl
                };
            }
        } catch (e) {
            errors.push(`gtx:${e.message}`);
        }
    }

    // Provider 3: MyMemory fallback (butuh kode bahasa sumber spesifik jika auto -> en)
    if (!out) {
        try {
            const srcCode = sl === 'auto' ? (tl === 'en' ? 'id' : 'en') : sl;
            const qs = `q=${encodeURIComponent(clean.slice(0, 480))}&langpair=${encodeURIComponent(srcCode + '|' + tl)}`;
            const parsed = await httpsGetJson('api.mymemory.translated.net', `/get?${qs}`);
            const translated = parsed?.responseData?.translatedText;
            if (translated && typeof translated === 'string' && translated.trim()) {
                out = { translated: translated.trim(), detectedLang: srcCode };
            }
        } catch (e) {
            errors.push(`mymemory:${e.message}`);
        }
    }

    if (!out || !out.translated) {
        throw new Error(`Semua provider gagal (${errors.join(', ')})`);
    }

    translateCache.set(cacheKey, out);
    if (translateCache.size > 600) {
        const firstKey = translateCache.keys().next().value;
        translateCache.delete(firstKey);
    }
    return out;
};

const postGroqChatNode = (apiKey, payloadObj) => new Promise((resolve, reject) => {
    try {
        const bodyStr = JSON.stringify(payloadObj || {});
        const req = https.request({
            hostname: 'api.groq.com',
            port: 443,
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${String(apiKey || '').trim()}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'User-Agent': 'Pancord-Groq-Relay/1.0'
            }
        }, (resp) => {
            let data = '';
            resp.on('data', (c) => { data += c; });
            resp.on('end', () => resolve({ status: resp.statusCode || 0, body: data }));
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    } catch (err) {
        reject(err);
    }
});

const postDiscordWebhookNode = (webhookUrl, payloadObj) => new Promise((resolve, reject) => {
    try {
        const u = new URL(webhookUrl);
        const allowedHosts = ['discord.com', 'canary.discord.com', 'ptb.discord.com'];
        if (u.protocol !== 'https:' || !allowedHosts.includes(u.hostname) || !u.pathname.startsWith('/api/webhooks/')) {
            return reject(new Error('URL bukan Discord Webhook yang valid.'));
        }
        const bodyStr = JSON.stringify(payloadObj || {});
        const req = https.request({
            hostname: u.hostname,
            port: 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'User-Agent': 'Pancord-Webhook-Relay/1.0'
            }
        }, (resp) => {
            let data = '';
            resp.on('data', (c) => { data += c; });
            resp.on('end', () => resolve({ status: resp.statusCode || 0, body: data }));
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    } catch (err) {
        reject(err);
    }
});

try {
    const debugServer = http.createServer(async (req, res) => {
        try {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
                });
                return res.end();
            }

            const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${PANCORD_DEBUG_PORT}`);
            const pathname = parsedUrl.pathname;
            const query = parsedUrl.searchParams;

            if (pathname === '/webhook' && req.method === 'POST') {
                const body = await readBodyJson(req);
                if (!body || !body.url) {
                    return sendJson(res, 400, { ok: false, error: 'Missing webhook url' });
                }
                const result = await postDiscordWebhookNode(body.url, body.payload || {});
                return sendJson(res, 200, { ok: result.status >= 200 && result.status < 300, status: result.status, body: result.body });
            }

            if (pathname === '/groq' && req.method === 'POST') {
                const body = await readBodyJson(req);
                if (!body || !body.apiKey || !body.payload) {
                    return sendJson(res, 400, { ok: false, error: 'Missing apiKey or payload' });
                }
                const result = await postGroqChatNode(body.apiKey, body.payload);
                return sendJson(res, 200, { ok: result.status >= 200 && result.status < 300, status: result.status, body: result.body });
            }

            if (pathname === '/translate' && req.method === 'POST') {
                const body = await readBodyJson(req);
                if (!body || !body.text) {
                    return sendJson(res, 400, { ok: false, error: 'Missing text' });
                }
                const result = await translateTextNode(body.text, body.from || 'auto', body.to || 'id');
                return sendJson(res, 200, { ok: true, ...result });
            }

            if (pathname === '/health' && req.method === 'GET') {
                const wins = (BrowserWindow ? BrowserWindow.getAllWindows() : []).map((w) => {
                    if (!w || w.isDestroyed()) return null;
                    return {
                        id: w.id,
                        title: w.getTitle(),
                        url: w.webContents.getURL(),
                        visible: w.isVisible(),
                        bounds: w.getBounds()
                    };
                }).filter(Boolean);
                return sendJson(res, 200, { ok: true, pid: process.pid, port: PANCORD_DEBUG_PORT, windows: wins });
            }

            if (pathname === '/screenshot' && req.method === 'GET') {
                const win = getPrimaryDiscordWindow();
                if (!win) return sendJson(res, 404, { ok: false, error: 'No active Discord window found' });
                if (query.get('focus') === '1' && typeof win.showInactive === 'function') {
                    try { win.showInactive(); } catch (_) {}
                }
                try { win.webContents.invalidate(); } catch (_) {}
                await new Promise((r) => setTimeout(r, 80));
                let rect = undefined;
                const rectParam = query.get('rect');
                if (rectParam) {
                    const parts = rectParam.split(',').map((n) => parseInt(n, 10));
                    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
                        rect = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
                    }
                }
                const image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
                const pngBuf = image.toPNG();
                const size = image.getSize();
                const outPath = query.get('out');
                if (outPath) {
                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    fs.writeFileSync(outPath, pngBuf);
                    return sendJson(res, 200, { ok: true, path: outPath, width: size.width, height: size.height, bytes: pngBuf.length });
                }
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': pngBuf.length });
                return res.end(pngBuf);
            }

            if (pathname === '/eval' && req.method === 'POST') {
                const win = getPrimaryDiscordWindow();
                if (!win) return sendJson(res, 404, { ok: false, error: 'No active Discord window found' });
                const body = await readBodyJson(req);
                const code = typeof body.code === 'string' ? body.code : '';
                if (!code) return sendJson(res, 400, { ok: false, error: 'Missing "code" field' });
                try {
                    const result = await win.webContents.executeJavaScript(code, true);
                    return sendJson(res, 200, { ok: true, result });
                } catch (err) {
                    return sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
                }
            }

            if (pathname === '/console' && req.method === 'GET') {
                const limit = Math.max(1, Math.min(500, parseInt(query.get('limit') || '100', 10) || 100));
                const level = (query.get('level') || '').toLowerCase();
                let list = pancordConsoleLogs;
                if (level && level !== 'all') {
                    list = list.filter((item) => item.level === level);
                }
                const out = list.slice(-limit);
                if (query.get('clear') === '1') {
                    pancordConsoleLogs.length = 0;
                }
                return sendJson(res, 200, { ok: true, total: list.length, logs: out });
            }

            if (pathname === '/network' && req.method === 'GET') {
                const win = getPrimaryDiscordWindow();
                if (!win) return sendJson(res, 404, { ok: false, error: 'No active Discord window found' });
                const limit = Math.max(1, Math.min(300, parseInt(query.get('limit') || '100', 10) || 100));
                const filter = query.get('filter') || '';
                const clear = query.get('clear') === '1';
                const result = await win.webContents.executeJavaScript(`
                    (function() {
                        const net = Array.isArray(window.__PANCORD_NET_LOG__) ? window.__PANCORD_NET_LOG__.slice() : [];
                        const perf = (window.performance && performance.getEntriesByType)
                            ? performance.getEntriesByType('resource').slice(-150).map((e) => ({
                                ts: Math.round((performance.timeOrigin || 0) + e.startTime),
                                type: e.initiatorType || 'resource',
                                method: 'GET',
                                url: e.name,
                                status: e.responseStatus || 0,
                                durationMs: Math.round(e.duration || 0),
                                transferSize: e.transferSize || 0
                            }))
                            : [];
                        if (${JSON.stringify(clear)} && Array.isArray(window.__PANCORD_NET_LOG__)) {
                            window.__PANCORD_NET_LOG__.length = 0;
                        }
                        return { net, perf };
                    })();
                `, true);
                let combined = [...(result.net || []), ...(result.perf || [])];
                if (filter) {
                    const low = filter.toLowerCase();
                    combined = combined.filter((r) => String(r.url || '').toLowerCase().includes(low));
                }
                combined.sort((a, b) => (a.ts || 0) - (b.ts || 0));
                return sendJson(res, 200, { ok: true, count: combined.length, requests: combined.slice(-limit) });
            }

            if (pathname === '/plugins' && req.method === 'GET') {
                const deployed = fs.existsSync(pluginScriptsDir)
                    ? fs.readdirSync(pluginScriptsDir).filter((f) => f.endsWith('.js'))
                    : [];
                const win = getPrimaryDiscordWindow();
                let activeStoppers = [];
                if (win) {
                    try {
                        activeStoppers = await win.webContents.executeJavaScript(
                            'Object.keys(window.__PANCORD_PLUGIN_STOPPERS__ || {})',
                            true
                        );
                    } catch (_) {}
                }
                return sendJson(res, 200, { ok: true, pluginScriptsDir, deployed, activeStoppers });
            }

            if (pathname === '/dom' && req.method === 'GET') {
                const win = getPrimaryDiscordWindow();
                if (!win) return sendJson(res, 404, { ok: false, error: 'No active Discord window found' });
                const selector = query.get('selector') || '';
                if (!selector) return sendJson(res, 400, { ok: false, error: 'Missing ?selector=' });
                const result = await win.webContents.executeJavaScript(`
                    (function(sel) {
                        const els = Array.from(document.querySelectorAll(sel));
                        return {
                            count: els.length,
                            items: els.slice(0, 30).map((el) => {
                                const r = el.getBoundingClientRect();
                                return {
                                    tag: el.tagName.toLowerCase(),
                                    id: el.id || '',
                                    className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
                                    text: (el.textContent || '').trim().slice(0, 160),
                                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
                                };
                            })
                        };
                    })(${JSON.stringify(selector)});
                `, true);
                return sendJson(res, 200, { ok: true, selector, ...result });
            }

            return sendJson(res, 404, {
                ok: false,
                error: 'Unknown endpoint',
                endpoints: ['GET /health', 'GET /screenshot', 'POST /eval', 'GET /console', 'GET /network', 'GET /plugins', 'GET /dom?selector=...']
            });
        } catch (err) {
            return sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
        }
    });

    debugServer.on('error', () => {});
    debugServer.listen(PANCORD_DEBUG_PORT, '127.0.0.1');
} catch (_) {}

let cspLocalhostPatched = false;
function patchLocalhostCsp(win) {
    if (cspLocalhostPatched || !win || !win.webContents || !win.webContents.session) return;
    cspLocalhostPatched = true;
    try {
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
            const headers = details.responseHeaders || {};
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === 'content-security-policy') {
                    headers[key] = headers[key].map((val) => {
                        if (typeof val === 'string' && val.includes('connect-src')) {
                            return val.replace(/connect-src\s+/i, 'connect-src http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://api.groq.com ');
                        }
                        return val;
                    });
                }
            }
            callback({ responseHeaders: headers });
        });
    } catch (_) {}
}

app.on('browser-window-created', (e, window) => {
    patchLocalhostCsp(window);
    window.on('minimize', () => {
        setTimeout(runWorkingSetTrim, 1500);
    });
    window.on('hide', () => {
        setTimeout(runWorkingSetTrim, 1500);
    });
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        try {
            pancordConsoleLogs.push({
                ts: Date.now(),
                level: CONSOLE_LEVELS[level] || String(level),
                message: String(message || '').slice(0, 1000),
                line: line || 0,
                sourceId: String(sourceId || '').slice(0, 200)
            });
            if (pancordConsoleLogs.length > MAX_CONSOLE_LOGS) {
                pancordConsoleLogs.splice(0, pancordConsoleLogs.length - MAX_CONSOLE_LOGS);
            }
        } catch (_) {}
    });
    window.webContents.on('dom-ready', () => {
        try {
            const url = window.webContents.getURL();
            if (url && url.startsWith('https://')) {
                applyResources(window);
            }
        } catch (_) {}
    });
});

// Load original Discord core
const originalAsar = path.join(process.resourcesPath, 'original.asar');
try {
    if (fs.existsSync(originalAsar)) {
        require(originalAsar);
    }
} catch (err) {
    try {
        fs.writeFileSync(path.join(__dirname, 'error.log'), 'Error loading original.asar: ' + err.stack);
    } catch (_) {}
}
