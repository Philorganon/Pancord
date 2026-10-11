/**
 * Live Bridge — klien sisi renderer.
 *
 * Kenapa HTTP long-poll, bukan WebSocket:
 * CSP Discord memblokir `ws://localhost` dari halaman https, tapi mengizinkan
 * `http://localhost`. Jadi renderer yang "menarik" perintah dengan POST /poll,
 * bukan menerima koneksi.
 *
 * Kemampuan:
 *   - kirim log console Discord ke terminal injector (level log s/d error + uncaught)
 *   - jalankan kode arbitrer di renderer dari CLI (`eval`)
 *   - reload renderer (`reload`) — dom-ready menyusul, jadi semua plugin-scripts dimuat ulang
 *
 * Kode ini memakai fetch ke 127.0.0.1, jadi jangan aktifkan kalau tidak sedang dipakai:
 * selama hidup, siapa pun yang punya token bisa menjalankan JS di Discord-mu.
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[LiveBridge]';
    const VERSION = '1.0.0';

    const DEFAULT_CONFIG = {
        port: 8788,
        token: 'dsh-live-bridge',
        pollHoldMs: 20000,
        mirrorLog: true,
        logLevels: ['log', 'info', 'warn', 'error', 'debug'],
        maxLogsPerBatch: 40,
        maxLogQueue: 300,
        maxDepth: 6
    };

    const CONFIG = Object.assign({}, DEFAULT_CONFIG, window.__LIVE_BRIDGE_CONFIG__ || {});

    if (window.__liveBridge) {
        try { Object.assign(window.__liveBridge.config, window.__LIVE_BRIDGE_CONFIG__ || {}); } catch (e) { /* diabaikan */ }
        return;
    }

    // Console asli disimpan supaya log bridge sendiri tidak ikut terkirim (dan tidak loop).
    const nativeConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console)
    };
    const nativeLog = (...args) => nativeConsole.log(LOG_PREFIX, ...args);

    const state = {
        baseUrl: null,
        connected: false,
        stopped: false,
        received: 0,
        logsSent: 0,
        logsDropped: 0,
        lastError: null,
        startedAt: Date.now()
    };

    const logQueue = [];

    // ─── Utilitas ───────────────────────────────────────────────────────────

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function serialize(value, depth, seen) {
        const maxDepth = Number(CONFIG.maxDepth) || 6;

        try {
            if (value === undefined) return { __type: 'undefined' };
            if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
            if (typeof value === 'string') {
                return value.length > 4000 ? `${value.slice(0, 4000)}…(+${value.length - 4000} char)` : value;
            }
            if (typeof value === 'bigint') return `${value}n`;
            if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
            if (typeof value === 'symbol') return value.toString();
            if (depth >= maxDepth) return '[kedalaman maksimum]';
            if (seen.has(value)) return '[circular]';
            seen.add(value);

            if (Array.isArray(value)) {
                return value.slice(0, 200).map((item) => serialize(item, depth + 1, seen));
            }
            if (value instanceof Error) {
                return { name: value.name, message: value.message, stack: value.stack };
            }
            if (typeof Node !== 'undefined' && value instanceof Node) {
                const id = value.id ? `#${value.id}` : '';
                const cls = typeof value.className === 'string' && value.className
                    ? `.${value.className.split(/\s+/)[0]}`
                    : '';
                return `<${String(value.nodeName).toLowerCase()}${id}${cls}>`;
            }
            if (value instanceof Map) {
                return {
                    __type: 'Map',
                    size: value.size,
                    entries: Array.from(value.entries()).slice(0, 50)
                        .map(([k, v]) => [serialize(k, depth + 1, seen), serialize(v, depth + 1, seen)])
                };
            }
            if (value instanceof Set) {
                return {
                    __type: 'Set',
                    size: value.size,
                    values: Array.from(value.values()).slice(0, 50).map((v) => serialize(v, depth + 1, seen))
                };
            }

            const out = {};
            for (const key of Object.keys(value).slice(0, 100)) {
                try {
                    out[key] = serialize(value[key], depth + 1, seen);
                } catch (e) {
                    out[key] = '[getter error]';
                }
            }

            const ctorName = value.constructor && value.constructor.name;
            if (ctorName && ctorName !== 'Object') out.__type = ctorName;
            return out;
        } catch (e) {
            return `[tidak bisa diserialisasi: ${e && e.message}]`;
        }
    }

    function formatLogArg(arg) {
        try {
            if (typeof arg === 'string') return arg.length > 2000 ? `${arg.slice(0, 2000)}…` : arg;
            if (arg === null || arg === undefined) return String(arg);
            if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
            if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
            return JSON.stringify(serialize(arg, 0, new Set()));
        } catch (e) {
            return String(arg);
        }
    }

    // ─── Penangkapan log ────────────────────────────────────────────────────

    function capture(level, args) {
        if (!CONFIG.mirrorLog) return;
        if (Array.isArray(CONFIG.logLevels) && !CONFIG.logLevels.includes(level)) return;

        logQueue.push({
            level,
            text: args.map(formatLogArg).join(' '),
            at: Date.now()
        });

        const limit = Number(CONFIG.maxLogQueue) || 300;
        while (logQueue.length > limit) {
            logQueue.shift();
            state.logsDropped += 1;
        }
    }

    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        console[level] = (...args) => {
            nativeConsole[level](...args);
            capture(level, args);
        };
    }

    window.addEventListener('error', (event) => {
        capture('error', [`[uncaught] ${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`]);
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        capture('error', [`[unhandledrejection] ${(reason && (reason.stack || reason.message)) || String(reason)}`]);
    });

    function drainLogs() {
        if (logQueue.length === 0) return [];
        const batch = logQueue.splice(0, Number(CONFIG.maxLogsPerBatch) || 40);
        state.logsSent += batch.length;
        if (state.logsDropped > 0) {
            batch.push({ level: 'warn', text: `[LiveBridge] ${state.logsDropped} log dibuang karena antrean penuh`, at: Date.now() });
            state.logsDropped = 0;
        }
        return batch;
    }

    // ─── HTTP ───────────────────────────────────────────────────────────────

    function candidateUrls() {
        const port = Number(CONFIG.port) || 8788;
        return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    }

    async function post(pathname, payload, timeoutMs) {
        const urls = state.baseUrl ? [state.baseUrl] : candidateUrls();
        let lastError = null;

        for (const base of urls) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);

            try {
                const res = await fetch(base + pathname, {
                    method: 'POST',
                    // text/plain → "simple request", jadi tidak memicu preflight CORS
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                    body: JSON.stringify(payload || {}),
                    signal: controller.signal,
                    cache: 'no-store',
                    credentials: 'omit'
                });

                clearTimeout(timer);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                state.baseUrl = base;
                return await res.json();
            } catch (err) {
                clearTimeout(timer);
                lastError = err;
                if (state.baseUrl === base) state.baseUrl = null;
            }
        }

        throw lastError || new Error('tidak ada endpoint bridge yang bisa dihubungi');
    }

    // ─── Eksekusi perintah ──────────────────────────────────────────────────

    function evalCode(code) {
        return new Promise((resolve, reject) => {
            let value;
            try {
                value = (0, eval)(code);
            } catch (err) {
                if (err instanceof SyntaxError) {
                    try {
                        resolve((0, eval)(`(async () => { ${code} })()`));
                        return;
                    } catch (err2) {
                        reject(err2);
                        return;
                    }
                }
                reject(err);
                return;
            }
            resolve(value);
        });
    }

    async function sendResult(id, ok, value, error) {
        try {
            await post('/result', {
                token: CONFIG.token,
                id,
                ok,
                value: ok ? value : undefined,
                error: ok ? undefined : error,
                logs: drainLogs()
            }, 10000);
        } catch (err) {
            nativeLog('gagal mengirim hasil:', err && err.message);
        }
    }

    async function handleCommand(command) {
        if (!command || !command.id) return;

        if (command.kind === 'reload') {
            await sendResult(command.id, true, 'reload dijadwalkan');
            setTimeout(() => window.location.reload(), 250);
            return;
        }

        if (command.kind !== 'eval') {
            await sendResult(command.id, false, null, `jenis command tidak dikenal: ${command.kind}`);
            return;
        }

        try {
            const value = await evalCode(command.code);
            await sendResult(command.id, true, serialize(value, 0, new Set()));
        } catch (err) {
            await sendResult(command.id, false, null, (err && (err.stack || err.message)) || String(err));
        }
    }

    // ─── Loop polling ───────────────────────────────────────────────────────

    async function loop() {
        let backoff = 1000;
        const holdMs = Number(CONFIG.pollHoldMs) || 20000;

        while (!state.stopped) {
            try {
                const pollStartedAt = Date.now();
                const res = await post('/poll', {
                    token: CONFIG.token,
                    hello: !state.connected,
                    logs: drainLogs(),
                    meta: { version: VERSION, href: location.href }
                }, holdMs + 15000);
                const elapsedMs = Date.now() - pollStartedAt;

                if (res && res.error) {
                    state.lastError = res.error;
                    nativeLog(`ditolak server (${res.error}) — bridge berhenti. Periksa token di config plugin.`);
                    break;
                }

                if (!state.connected) {
                    state.connected = true;
                    nativeLog(`terhubung ke ${state.baseUrl}`);
                }

                backoff = 1000;

                if (res && res.command) {
                    state.received += 1;
                    await handleCommand(res.command);
                } else if (elapsedMs < 500) {
                    // Server seharusnya menahan poll sampai pollHoldMs. Kalau balik
                    // seketika tanpa perintah, beri jeda supaya tidak menghajar server.
                    await sleep(500 - elapsedMs);
                }
            } catch (err) {
                if (state.stopped) break;
                if (state.connected) nativeLog('koneksi terputus:', (err && err.message) || err);
                state.connected = false;
                state.lastError = (err && err.message) || String(err);
                await sleep(backoff);
                backoff = Math.min(backoff * 2, 15000);
            }
        }
    }

    // ─── API publik ─────────────────────────────────────────────────────────

    window.__liveBridge = {
        version: VERSION,
        config: CONFIG,
        status: () => ({
            version: VERSION,
            connected: state.connected,
            baseUrl: state.baseUrl,
            received: state.received,
            logsSent: state.logsSent,
            logsQueued: logQueue.length,
            lastError: state.lastError,
            uptimeMs: Date.now() - state.startedAt
        }),
        eval: (code) => evalCode(code),
        stop: () => { state.stopped = true; },
        start: () => {
            if (!state.stopped) return;
            state.stopped = false;
            loop();
        }
    };

    nativeLog(`v${VERSION} aktif — target http://localhost:${CONFIG.port} (token ${CONFIG.token ? 'diset' : 'kosong'})`);
    loop();
})();
