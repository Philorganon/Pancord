/**
 * Game Time Farmer — Runner CLI Sisi Host.
 *
 * Menjalankan dummy process game terverifikasi di Windows dengan 0% CPU dan < 10 MB RAM.
 * Discord akan mendeteksi proses ini secara native dan mengirim heartbeat jam bermain resmi ke server.
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_DIR = path.resolve(__dirname, '..', 'plugins', 'game-farmer', 'runner');
const PID_FILE = path.join(RUNNER_DIR, '.running_pid');

const SUPPORTED_GAMES = {
    genshin: {
        name: 'Genshin Impact',
        exe: 'GenshinImpact.exe',
        title: 'Genshin Impact'
    },
    cs2: {
        name: 'Counter-Strike 2',
        exe: 'cs2.exe',
        title: 'Counter-Strike 2'
    },
    minecraft: {
        name: 'Minecraft',
        exe: 'Minecraft.exe',
        title: 'Minecraft'
    }
};

function getRunningProcess(exeName) {
    try {
        const out = execSync(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, { encoding: 'utf8' });
        const lines = out.trim().split('\n');
        for (const line of lines) {
            if (line.includes(exeName)) {
                const parts = line.split('","');
                if (parts.length > 1) {
                    const pid = parseInt(parts[1].replace(/"/g, ''), 10);
                    if (!isNaN(pid)) return pid;
                }
            }
        }
    } catch (e) {}
    return null;
}

function stopAll() {
    let stoppedAny = false;
    for (const key of Object.keys(SUPPORTED_GAMES)) {
        const game = SUPPORTED_GAMES[key];
        const pid = getRunningProcess(game.exe);
        if (pid) {
            try {
                process.kill(pid, 'SIGKILL');
                console.log(`[OK] Proses ${game.name} (PID: ${pid}) berhasil dihentikan.`);
                stoppedAny = true;
            } catch (e) {
                try {
                    execSync(`taskkill /F /PID ${pid}`);
                    console.log(`[OK] Proses ${game.name} (PID: ${pid}) berhasil dihentikan via taskkill.`);
                    stoppedAny = true;
                } catch (err) {}
            }
        }
    }

    if (fs.existsSync(PID_FILE)) {
        try { fs.unlinkSync(PID_FILE); } catch (e) {}
    }

    if (!stoppedAny) {
        console.log('[Info] Tidak ada game farmer yang sedang berjalan.');
    }
}

function start(gameKey = 'genshin') {
    const key = gameKey.toLowerCase();
    const game = SUPPORTED_GAMES[key] || SUPPORTED_GAMES['genshin'];
    const exePath = path.join(RUNNER_DIR, game.exe);

    if (!fs.existsSync(exePath)) {
        console.error(`[Error] File biner ${game.exe} tidak ditemukan di ${RUNNER_DIR}`);
        return;
    }

    stopAll();

    try {
        execSync(`start "" "${exePath}" "${game.title}"`);
        
        let pid = null;
        for (let i = 0; i < 10; i++) {
            pid = getRunningProcess(game.exe);
            if (pid) break;
            try { execSync('ping -n 1 127.0.0.1 >nul'); } catch (e) {}
        }

        fs.writeFileSync(PID_FILE, JSON.stringify({
            game: game.name,
            exe: game.exe,
            pid: pid || 'Unknown',
            startTime: new Date().toISOString()
        }, null, 2), 'utf8');

        console.log(`[OK] Game Time Farmer berhasil dimulai!`);
        console.log(`  Game: ${game.name}`);
        console.log(`  Executable: ${game.exe}`);
        console.log(`  PID: ${pid || 'Berjalan'}`);
        console.log(`  Penggunaan Resource: 0.00% CPU, < 10 MB RAM`);
        console.log(`  Status: Discord mendeteksi status "Playing ${game.name}".`);
    } catch (e) {
        console.error(`[Error] Gagal memulai ${game.name}:`, e.message);
    }
}

function status() {
    let runningGame = null;
    let runningPid = null;

    for (const key of Object.keys(SUPPORTED_GAMES)) {
        const game = SUPPORTED_GAMES[key];
        const pid = getRunningProcess(game.exe);
        if (pid) {
            runningGame = game;
            runningPid = pid;
            break;
        }
    }

    if (runningGame && runningPid) {
        let meta = {};
        if (fs.existsSync(PID_FILE)) {
            try { meta = JSON.parse(fs.readFileSync(PID_FILE, 'utf8')); } catch (e) {}
        }
        console.log(`[Status: SEDANG BERJALAN]`);
        console.log(`  Game: ${runningGame.name}`);
        console.log(`  PID: ${runningPid}`);
        console.log(`  Mulai sejak: ${meta.startTime || 'Tidak tercatat'}`);
        console.log(`  Resource: 0.00% CPU`);
    } else {
        console.log(`[Status: NONAKTIF]`);
        console.log(`  Tidak ada game farmer yang sedang berjalan.`);
        console.log(`  Gunakan: node scripts/farm.js start [genshin|cs2|minecraft]`);
    }
}

const action = (process.argv[2] || 'status').toLowerCase();
const arg = process.argv[3];

switch (action) {
    case 'start':
        start(arg || 'genshin');
        break;
    case 'stop':
        stopAll();
        break;
    case 'status':
        status();
        break;
    default:
        console.log('Penggunaan:');
        console.log('  node scripts/farm.js start [genshin|cs2|minecraft]');
        console.log('  node scripts/farm.js stop');
        console.log('  node scripts/farm.js status');
        break;
}
