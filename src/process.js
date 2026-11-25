import ps from 'ps-node';
import { exec } from 'child_process';

export function killDiscord() {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            exec('taskkill /F /IM Discord.exe /IM DiscordPTB.exe /IM DiscordCanary.exe /IM DiscordDevelopment.exe /T', () => {
                setTimeout(() => resolve(true), 1200);
            });
            return;
        }

        ps.lookup({ command: 'Discord' }, (err, resultList) => {
            if (err) return resolve(false);

            const pids = resultList.map(p => p.pid);
            if (pids.length === 0) return resolve(true);

            pids.forEach(pid => {
                try { process.kill(pid); } catch (e) { }
            });

            setTimeout(() => resolve(true), 1500);
        });
    });
}

