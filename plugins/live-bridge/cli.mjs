#!/usr/bin/env node
/**
 * Live Bridge CLI — kontrol renderer Discord dari terminal.
 *
 *   node plugins/live-bridge/cli.mjs status
 *   node plugins/live-bridge/cli.mjs eval "document.title"
 *   node plugins/live-bridge/cli.mjs eval "return [...document.querySelectorAll('[class*=\"-username\"]')].slice(0,5).map(e=>e.textContent)"
 *   node plugins/live-bridge/cli.mjs reload
 *   node plugins/live-bridge/cli.mjs logs --follow
 *   node plugins/live-bridge/cli.mjs                # mode interaktif
 *
 * Opsi: --port <n>  --token <t>  --url <http://host:port>  --limit <n>  --follow
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Pengaturan ─────────────────────────────────────────────────────────────

function loadSettings() {
    let config = { port: 8788, token: 'dsh-live-bridge' };

    for (const file of ['manifest.json', 'config.json']) {
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
            const source = file === 'manifest.json' ? raw.config : raw;
            if (source && typeof source === 'object') config = { ...config, ...source };
        } catch { /* file tidak ada / tidak valid — pakai default */ }
    }

    return config;
}

function parseArgs(argv) {
    const options = { follow: false, limit: 100, positionals: [] };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--port') options.port = Number(argv[++i]);
        else if (arg === '--token') options.token = argv[++i];
        else if (arg === '--url') options.url = argv[++i];
        else if (arg === '--limit') options.limit = Number(argv[++i]);
        else if (arg === '--follow' || arg === '-f') options.follow = true;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else options.positionals.push(arg);
    }

    return options;
}

const options = parseArgs(process.argv.slice(2));
const settings = loadSettings();
const baseUrl = options.url || `http://localhost:${options.port || settings.port || 8788}`;
const token = options.token || settings.token || 'dsh-live-bridge';

// ─── HTTP ───────────────────────────────────────────────────────────────────

async function api(route, payload, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(baseUrl + route, {
            method: payload === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: payload === undefined ? undefined : JSON.stringify(payload),
            signal: controller.signal
        });
        return await res.json();
    } catch (err) {
        if (err && err.name === 'AbortError') throw new Error(`timeout saat menghubungi ${baseUrl}`);
        throw new Error(`tidak bisa menghubungi ${baseUrl} — jalankan "node index.js" dulu supaya server bridge hidup`);
    } finally {
        clearTimeout(timer);
    }
}

function format(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

const LEVEL_TAG = { error: 'ERR ', warn: 'WARN', info: 'INFO', debug: 'DBG ', log: 'LOG ' };

function printLogs(entries) {
    for (const entry of entries) {
        const time = new Date(entry.at).toLocaleTimeString();
        console.log(`\x1b[90m${time}\x1b[0m ${LEVEL_TAG[entry.level] || 'LOG '} ${entry.text}`);
    }
}

// ─── Perintah ───────────────────────────────────────────────────────────────

async function cmdStatus() {
    const status = await api('/status');
    console.log(`bridge     : ${baseUrl}`);
    console.log(`listening  : ${status.listening}`);
    console.log(`port       : ${status.port}`);
    console.log(`renderer   : ${status.pollerConnected ? 'terhubung' : 'BELUM terhubung (buka Discord)'}`);
    console.log(`antrean    : ${status.queuedCommands} perintah, ${status.pendingResults} menunggu hasil`);
    console.log(`log buffer : ${status.bufferedLogs} entri (cursor ${status.logCursor})`);
    return status;
}

async function cmdEval(code) {
    if (!code || !code.trim()) throw new Error('kode kosong');
    const res = await api('/command', { token, code });
    if (!res.ok) throw new Error(res.error || 'gagal');
    console.log(format(res.value));
}

async function cmdReload() {
    const res = await api('/command', { token, action: 'reload' });
    if (!res.ok) throw new Error(res.error || 'gagal');
    console.log('renderer di-reload — plugin-scripts dimuat ulang setelah dom-ready');
}

let cursor = 0;

async function cmdLogs({ follow = false, limit = options.limit, signal } = {}) {
    const res = await api(`/logs?since=${cursor}&limit=${limit}`);
    if (res.entries && res.entries.length > 0) {
        printLogs(res.entries);
        cursor = res.cursor;
    } else if (!follow) {
        console.log('(belum ada log baru)');
    }

    if (!follow) return;

    while (!signal || !signal.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
            const next = await api(`/logs?since=${cursor}&limit=200`);
            if (next.entries && next.entries.length > 0) {
                printLogs(next.entries);
                cursor = next.cursor;
            }
        } catch (err) {
            console.error(`\x1b[31m${err.message}\x1b[0m`);
            return;
        }
    }
}

function printHelp() {
    console.log(`
Live Bridge CLI

  status                    keadaan bridge + apakah renderer terhubung
  eval <kode>               jalankan kode di renderer Discord, tampilkan hasilnya
  reload                    reload renderer (plugin-scripts dimuat ulang)
  logs [--follow]           tampilkan log Discord; --follow untuk mengalir terus
  help                      pesan ini
  quit                      keluar (mode interaktif)

Opsi: --port <n>  --token <t>  --url <http://host:port>  --limit <n>  --follow

Kode eval: satu ekspresi langsung mengembalikan nilainya; kalau memakai
beberapa statement, akhiri dengan return, misalnya:
  eval "const a = 1; const b = 2; return a + b"
`);
}

// ─── Mode interaktif ────────────────────────────────────────────────────────

async function interactive() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '\x1b[36mbridge>\x1b[0m '
    });

    const followState = { stopped: false, running: false };

    console.log(`Live Bridge CLI → ${baseUrl}`);
    console.log('Ketik "help" untuk daftar perintah.\n');
    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();

        if (!input) {
            rl.prompt();
            return;
        }

        const [command, ...rest] = input.split(' ');
        const argument = rest.join(' ');

        try {
            if (command === 'quit' || command === 'exit') {
                followState.stopped = true;
                rl.close();
                return;
            } else if (command === 'help') {
                printHelp();
            } else if (command === 'status') {
                await cmdStatus();
            } else if (command === 'eval') {
                await cmdEval(argument);
            } else if (command === 'reload') {
                await cmdReload();
            } else if (command === 'logs') {
                if (argument.includes('--follow') || argument === 'follow') {
                    if (!followState.running) {
                        followState.running = true;
                        cmdLogs({ follow: true, signal: followState }).finally(() => { followState.running = false; });
                    }
                    console.log('(mengalirkan log… ketik "quit" untuk berhenti)');
                } else {
                    await cmdLogs({});
                }
            } else {
                // Perlakukan baris tak dikenal sebagai kode untuk dieksekusi.
                await cmdEval(input);
            }
        } catch (err) {
            console.error(`\x1b[31m${err.message}\x1b[0m`);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        followState.stopped = true;
        process.exit(0);
    });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const [command, ...rest] = options.positionals;
    const argument = rest.join(' ');

    if (options.help || command === 'help') {
        printHelp();
        return;
    }

    if (!command) {
        await interactive();
        return;
    }

    if (command === 'status') await cmdStatus();
    else if (command === 'eval') await cmdEval(argument);
    else if (command === 'reload') await cmdReload();
    else if (command === 'logs') await cmdLogs({ follow: options.follow });
    else throw new Error(`perintah tidak dikenal: ${command} (coba "help")`);
}

main().catch((err) => {
    console.error(`\x1b[31m${err.message}\x1b[0m`);
    process.exit(1);
});
