#!/usr/bin/env node
/**
 * Pancord Live Debug & Inspection CLI
 * Berkomunikasi dengan Pancord Debug Bridge (127.0.0.1:9229) di dalam Electron Discord.
 *
 * Penggunaan:
 *   node scripts/inspect.mjs health
 *   node scripts/inspect.mjs screenshot [output.png]
 *   node scripts/inspect.mjs eval "<javascript>"
 *   node scripts/inspect.mjs console [limit] [level]
 *   node scripts/inspect.mjs network [filter] [limit]
 *   node scripts/inspect.mjs plugins
 *   node scripts/inspect.mjs dom "<css-selector>"
 */

import path from 'path';

const PORT = Number(process.env.PANCORD_DEBUG_PORT) || 9229;
const BASE = `http://127.0.0.1:${PORT}`;

const [, , cmd, ...args] = process.argv;

function printUsage() {
    console.log([
        'Pancord Live Inspection CLI (Bridge: ' + BASE + ')',
        '',
        'Commands:',
        '  health                       Cek status bridge dan daftar window Discord aktif',
        '  screenshot [output.png]      Ambil screenshot PNG dari window Discord aktif',
        '  eval "<js code>"             Eksekusi JavaScript di renderer Discord dan cetak hasilnya',
        '  console [limit] [level]      Lihat log console Discord (level: all|info|warn|error)',
        '  network [filter] [limit]     Lihat traffic network (fetch, xhr, resource)',
        '  plugins                      Lihat plugin yang terdeploy dan aktif di renderer',
        '  dom "<selector>"             Inspeksi elemen DOM di Discord berdasarkan CSS selector'
    ].join('\n'));
}

async function run() {
    if (!cmd || cmd === '--help' || cmd === '-h') {
        printUsage();
        return;
    }

    try {
        if (cmd === 'health') {
            const res = await fetch(`${BASE}/health`);
            console.log(JSON.stringify(await res.json(), null, 2));
            return;
        }

        if (cmd === 'screenshot') {
            const outFile = path.resolve(args[0] || 'logs/discord-screenshot.png');
            const res = await fetch(`${BASE}/screenshot?out=${encodeURIComponent(outFile)}`);
            console.log(JSON.stringify(await res.json(), null, 2));
            return;
        }

        if (cmd === 'eval') {
            const code = args.join(' ');
            if (!code) {
                console.error('[ERR] Masukkan ekspresi JavaScript untuk dievaluasi.');
                process.exit(1);
            }
            const res = await fetch(`${BASE}/eval`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            console.log(JSON.stringify(await res.json(), null, 2));
            return;
        }

        if (cmd === 'console') {
            const limit = args[0] || '60';
            const level = args[1] || 'all';
            const res = await fetch(`${BASE}/console?limit=${encodeURIComponent(limit)}&level=${encodeURIComponent(level)}`);
            const data = await res.json();
            if (!data.ok) {
                console.error(JSON.stringify(data, null, 2));
                process.exit(1);
            }
            for (const item of data.logs || []) {
                const time = new Date(item.ts).toTimeString().slice(0, 8);
                console.log(`[${time}] [${String(item.level).toUpperCase()}] ${item.message}`);
            }
            console.log(`--- Total displayed: ${(data.logs || []).length} / ${data.total} ---`);
            return;
        }

        if (cmd === 'network') {
            const filter = args[0] || '';
            const limit = args[1] || '60';
            const res = await fetch(`${BASE}/network?filter=${encodeURIComponent(filter)}&limit=${encodeURIComponent(limit)}`);
            const data = await res.json();
            if (!data.ok) {
                console.error(JSON.stringify(data, null, 2));
                process.exit(1);
            }
            for (const r of data.requests || []) {
                const time = r.ts ? new Date(r.ts).toTimeString().slice(0, 8) : '--:--:--';
                const status = r.blocked ? 'BLOCKED' : (r.status || '---');
                console.log(`[${time}] [${r.type}] ${r.method} ${status} (${r.durationMs || 0}ms) ${r.url}`);
            }
            console.log(`--- Total displayed: ${(data.requests || []).length} / ${data.count} ---`);
            return;
        }

        if (cmd === 'plugins') {
            const res = await fetch(`${BASE}/plugins`);
            console.log(JSON.stringify(await res.json(), null, 2));
            return;
        }

        if (cmd === 'dom') {
            const selector = args.join(' ');
            if (!selector) {
                console.error('[ERR] Masukkan CSS selector.');
                process.exit(1);
            }
            const res = await fetch(`${BASE}/dom?selector=${encodeURIComponent(selector)}`);
            console.log(JSON.stringify(await res.json(), null, 2));
            return;
        }

        console.error(`[ERR] Command tidak dikenal: ${cmd}`);
        printUsage();
        process.exit(1);
    } catch (err) {
        console.error(`[ERR] Tidak dapat terhubung ke Pancord Debug Bridge di ${BASE}: ${err.message}`);
        console.error('Pastikan Discord sudah diinjeksi dengan Pancord terbaru dan sedang berjalan.');
        process.exit(1);
    }
}

run();
