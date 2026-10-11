/**
 * @fileoverview Live Bridge plugin — sisi Node (host injector).
 * @description Menjalankan HTTP server lokal yang di-long-poll oleh renderer Discord,
 *   sehingga terminal injector bisa: melihat log Discord, menjalankan kode di renderer,
 *   dan me-reload renderer tanpa restart aplikasi.
 *
 * Transport sengaja HTTP, bukan WebSocket: CSP Discord memblokir `ws://localhost`
 * dari halaman https, tapi mengizinkan `http://localhost`.
 */

import http from 'http';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import { createScriptDeployer } from '../../src/plugins/deploy-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT_NAME = 'live-bridge.js';
const LOG_RING_SIZE = 300;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Cari port kosong mulai dari `startPort`.
 */
async function findFreePort(startPort, attempts = 20) {
    for (let i = 0; i < attempts; i++) {
        const port = startPort + i;
        const free = await new Promise((resolve) => {
            const probe = net.createServer();
            probe.once('error', () => resolve(false));
            probe.once('listening', () => probe.close(() => resolve(true)));
            probe.listen(port, '127.0.0.1');
        });
        if (free) return port;
    }
    return startPort;
}

/**
 * Baca body request (JSON), dengan batas ukuran.
 */
function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve({});
            }
        });

        req.on('error', () => resolve({}));
    });
}

function sendJson(res, headers, payload, status = 200) {
    const body = JSON.stringify(payload);
    res.writeHead(status, Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    }, headers));
    res.end(body);
}

export default class LiveBridge {
    constructor(api) {
        this.api = api;
        this.log = api.log;

        this.config = {
            enabled: true,
            port: 8788,
            token: 'dsh-live-bridge',
            pollHoldMs: 20000,
            mirrorRendererLog: true,
            commandTimeoutMs: 30000
        };

        this.server = null;
        this.port = null;
        this.queue = [];
        this.pollWaiters = new Set();
        this.pendingResults = new Map();
        this.commandSeq = 0;
        this.pollerConnectedAt = 0;
        this.helloCount = 0;
        this.logRing = [];
        this.logSeq = 0;

        this.deployer = createScriptDeployer({
            api,
            log: this.log,
            pluginDir: __dirname,
            scriptName: SCRIPT_NAME,
            configGlobalName: '__LIVE_BRIDGE_CONFIG__',
            buildConfig: () => ({
                port: this.port || Number(this.config.port) || 8788,
                token: this.config.token,
                pollHoldMs: Number(this.config.pollHoldMs) || 20000,
                mirrorLog: this.config.mirrorRendererLog !== false,
                logLevels: this.config.logLevels,
                maxLogsPerBatch: this.config.maxLogsPerBatch,
                maxLogQueue: this.config.maxLogQueue,
                maxDepth: this.config.maxDepth
            })
        });
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this.config = { ...this.config, ...config };
        if (!this.config.enabled) {
            this.log.info('Live Bridge dimatikan lewat config');
            return;
        }

        await this.startServer();
        await this.deployer.deploy();
    }

    async destroy() {
        this.stopServer();
        this.log.info('Live Bridge plugin destroyed');
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
        const previousPort = this.port;
        const previousToken = this.config.token;

        this.config = { ...this.config, ...config };

        if (!this.config.enabled) {
            this.stopServer();
            await this.deployer.remove();
            return;
        }

        const portChanged = Number(this.config.port) !== Number(previousPort);
        const tokenChanged = this.config.token !== previousToken;

        if (!this.server || portChanged) {
            this.stopServer();
            await this.startServer();
        } else if (tokenChanged) {
            this.log.info('Token live bridge berubah — renderer perlu di-reload agar memakai token baru');
        }

        await this.deployer.deploy();
    }

    // ─── Server ──────────────────────────────────────────────────

    async startServer() {
        if (this.server) return this.port;

        const preferred = Number(this.config.port) || 8788;
        const port = await findFreePort(preferred);

        if (port !== preferred) {
            this.log.warn(`Port ${preferred} sedang dipakai — live bridge pindah ke ${port}`);
        }

        const server = http.createServer((req, res) => {
            this._handle(req, res).catch((err) => {
                this.log.error(`Live bridge request error: ${err.message}`);
                try { sendJson(res, this._corsHeaders(), { error: err.message }, 500); } catch { /* diabaikan */ }
            });
        });

        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', resolve);
        });

        // Jangan tahan event loop: perintah CLI sekali-jalan (mis. `node index.js plugins --list`)
        // harus tetap bisa keluar sendiri, sementara `node index.js` yang interaktif tetap hidup
        // karena readline-nya menahan loop.
        if (typeof server.unref === 'function') server.unref();

        this.server = server;
        this.port = port;

        this.log.success(`Live bridge mendengarkan di http://localhost:${port}`);
        this.log.info(`Kontrol: node plugins/live-bridge/cli.mjs status | eval "<kode>" | reload | logs`);

        return port;
    }

    stopServer() {
        for (const waiter of Array.from(this.pollWaiters)) {
            try { waiter(null); } catch { /* diabaikan */ }
        }
        this.pollWaiters.clear();

        for (const [id, pending] of this.pendingResults) {
            clearTimeout(pending.timer);
            pending.reject(new Error('live bridge dihentikan sebelum hasil diterima'));
            this.pendingResults.delete(id);
        }

        if (this.server) {
            try { this.server.close(); } catch { /* diabaikan */ }
            this.server = null;
            this.port = null;
            this.pollerConnectedAt = 0;
        }
    }

    _corsHeaders() {
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600'
        };
    }

    async _handle(req, res) {
        const cors = this._corsHeaders();

        if (req.method === 'OPTIONS') {
            res.writeHead(204, cors);
            res.end();
            return;
        }

        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const route = url.pathname;
        const body = req.method === 'POST' ? await readBody(req) : {};

        if (route === '/health' || route === '/status') {
            sendJson(res, cors, this.status());
            return;
        }

        if (route === '/logs') {
            const since = Number(url.searchParams.get('since') || 0);
            const limit = Math.min(Number(url.searchParams.get('limit') || 100), LOG_RING_SIZE);
            const entries = this.logRing.filter((entry) => entry.seq > since).slice(-limit);
            sendJson(res, cors, { ok: true, cursor: this.logSeq, entries });
            return;
        }

        const token = body.token || url.searchParams.get('token');
        if (!this.config.token || token !== this.config.token) {
            sendJson(res, cors, { error: 'bad token' });
            return;
        }

        if (route === '/poll') {
            await this._handlePoll(res, cors, body);
            return;
        }

        if (route === '/result') {
            this._handleResult(res, cors, body);
            return;
        }

        if (route === '/command') {
            await this._handleCommandRequest(res, cors, body);
            return;
        }

        sendJson(res, cors, { error: `rute tidak dikenal: ${route}` }, 404);
    }

    // ─── Handler rute ────────────────────────────────────────────

    async _handlePoll(res, cors, body) {
        this._ingestLogs(body.logs);

        if (body.hello) {
            this.helloCount += 1;
            const href = body.meta && body.meta.href ? ` (${body.meta.href})` : '';
            this.log.info(`Renderer Discord terhubung${href}`);
        }

        this.pollerConnectedAt = Date.now();

        const holdMs = Math.max(1000, Math.min(Number(this.config.pollHoldMs) || 20000, 60000));
        const command = await this._nextCommand(holdMs);

        sendJson(res, cors, { ok: true, command: command || null, logCursor: this.logSeq });
    }

    _handleResult(res, cors, body) {
        this._ingestLogs(body.logs);

        const pending = this.pendingResults.get(body.id);
        if (pending) {
            this.pendingResults.delete(body.id);
            clearTimeout(pending.timer);
            if (body.ok) pending.resolve(body.value);
            else pending.reject(new Error(body.error || 'perintah gagal di renderer'));
        }

        sendJson(res, cors, { ok: true });
    }

    async _handleCommandRequest(res, cors, body) {
        try {
            let value;
            if (body.action === 'reload') {
                value = await this.reloadRenderer(body.timeoutMs);
            } else {
                value = await this.evalInRenderer(body.code, body.timeoutMs);
            }
            sendJson(res, cors, { ok: true, value });
        } catch (err) {
            sendJson(res, cors, { ok: false, error: err.message });
        }
    }

    // ─── Antrean perintah ────────────────────────────────────────

    _nextCommand(timeoutMs) {
        return new Promise((resolve) => {
            if (this.queue.length > 0) {
                resolve(this.queue.shift());
                return;
            }

            const waiter = (command) => {
                clearTimeout(timer);
                this.pollWaiters.delete(waiter);
                resolve(command);
            };

            const timer = setTimeout(() => {
                this.pollWaiters.delete(waiter);
                resolve(null);
            }, timeoutMs);

            this.pollWaiters.add(waiter);
        });
    }

    _enqueue(command) {
        this.commandSeq += 1;
        const entry = Object.assign({ id: `cmd-${this.commandSeq}` }, command);

        const waiter = this.pollWaiters.values().next();
        if (!waiter.done) {
            this.pollWaiters.delete(waiter.value);
            waiter.value(entry);
        } else {
            this.queue.push(entry);
        }

        return entry;
    }

    _awaitResult(id, timeoutMs) {
        const ms = Math.max(1000, Number(timeoutMs || this.config.commandTimeoutMs) || 30000);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingResults.delete(id);
                reject(new Error(`timeout ${ms} ms menunggu hasil dari renderer`));
            }, ms);

            this.pendingResults.set(id, { resolve, reject, timer });
        });
    }

    _pollerAlive() {
        if (!this.pollerConnectedAt) return false;
        const window = (Number(this.config.pollHoldMs) || 20000) + 15000;
        return (Date.now() - this.pollerConnectedAt) < window;
    }

    // ─── API publik (juga bisa dipakai plugin lain lewat injector) ───

    /**
     * Jalankan kode di renderer Discord dan kembalikan hasilnya.
     * @param {string} code
     * @param {number} [timeoutMs]
     */
    evalInRenderer(code, timeoutMs) {
        if (typeof code !== 'string' || !code.trim()) {
            return Promise.reject(new Error('code harus string yang tidak kosong'));
        }
        if (!this._pollerAlive()) {
            return Promise.reject(new Error('renderer belum terhubung — pastikan Discord jalan dan plugin-scripts/live-bridge.js termuat'));
        }

        const entry = this._enqueue({ kind: 'eval', code });
        return this._awaitResult(entry.id, timeoutMs);
    }

    /**
     * Reload renderer Discord (dom-ready menyusul → semua plugin-scripts dimuat ulang).
     * @param {number} [timeoutMs]
     */
    reloadRenderer(timeoutMs) {
        if (!this._pollerAlive()) {
            return Promise.reject(new Error('renderer belum terhubung — tidak ada yang bisa di-reload'));
        }

        const entry = this._enqueue({ kind: 'reload' });
        return this._awaitResult(entry.id, timeoutMs);
    }

    status() {
        return {
            ok: true,
            listening: !!this.server,
            port: this.port,
            pollerConnected: this._pollerAlive(),
            queuedCommands: this.queue.length,
            waitingPolls: this.pollWaiters.size,
            pendingResults: this.pendingResults.size,
            helloCount: this.helloCount,
            logCursor: this.logSeq,
            bufferedLogs: this.logRing.length
        };
    }

    getLogs(since = 0, limit = 100) {
        return this.logRing
            .filter((entry) => entry.seq > since)
            .slice(-Math.min(limit, LOG_RING_SIZE));
    }

    // ─── Log renderer ────────────────────────────────────────────

    _ingestLogs(logs) {
        if (!Array.isArray(logs) || logs.length === 0) return;

        for (const entry of logs) {
            if (!entry || typeof entry.text !== 'string') continue;

            this.logSeq += 1;
            const record = {
                seq: this.logSeq,
                level: entry.level || 'log',
                text: entry.text,
                at: Number(entry.at) || Date.now()
            };

            this.logRing.push(record);
            while (this.logRing.length > LOG_RING_SIZE) this.logRing.shift();

            if (this.config.mirrorRendererLog === false) continue;

            const line = `[Discord] ${entry.text}`;
            if (record.level === 'error') this.log.error(line);
            else if (record.level === 'warn') this.log.warn(line);
            else if (record.level === 'debug') this.log.debug(line);
            else this.log.info(line);
        }
    }
}
