/**
 * Quest Completer — renderer-side inject script.
 *
 * Port dari gist "Complete Recent Discord Quest" oleh aamiaa (GPL-3.0):
 *   https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb
 * Dimodifikasi menjadi plugin script untuk Pancord:
 *   - dibungkus guard anti dobel-inject
 *   - ada start()/stop() + hotkey, patch store dikembalikan saat stop
 *   - config dibaca dari window.__QUEST_COMPLETER_CONFIG__
 *
 * PERINGATAN: skrip ini melanggar ToS Discord (otomasi quest). Penulis aslinya
 * sendiri menulis "you WILL get flagged by doing so", dan sejak 26 Agustus 2026
 * Discord menangguhkan akses quest untuk akun yang ketahuan mengotomasi quest.
 * Pakai dengan risiko sendiri. Tidak ada fitur anti-deteksi di sini — dan tidak
 * akan ditambahkan.
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[QuestCompleter]';
    const VERSION = '1.0.0';

    const DEFAULT_CONFIG = {
        enabled: true,
        autoRun: false,
        hotkeyStart: 'ctrl+shift+q',
        hotkeyStop: 'ctrl+shift+x',
        videoSpeedSeconds: 7,
        playActivityHeartbeatMs: 20000,
        onlyTasks: [],
        dryRun: false,
        verbose: true
    };

    const CONFIG = Object.assign({}, DEFAULT_CONFIG, window.__QUEST_COMPLETER_CONFIG__ || {});

    const SUPPORTED_TASKS = [
        'WATCH_VIDEO',
        'PLAY_ON_DESKTOP',
        'STREAM_ON_DESKTOP',
        'PLAY_ACTIVITY',
        'WATCH_VIDEO_ON_MOBILE'
    ];

    // Discord memicu dom-ready lebih dari sekali. Kalau script ini sudah terpasang,
    // cukup segarkan config-nya (objek CONFIG yang sama dipakai oleh closure lama).
    if (window.__questCompleter) {
        try {
            Object.assign(window.__questCompleter.config, window.__QUEST_COMPLETER_CONFIG__ || {});
        } catch (e) { /* diabaikan */ }
        return;
    }

    // ─── Logging ────────────────────────────────────────────────────────────

    const log = (...args) => console.log(LOG_PREFIX, ...args);
    const warn = (...args) => console.warn(LOG_PREFIX, ...args);
    const dbg = (...args) => { if (CONFIG.verbose) console.log(LOG_PREFIX, ...args); };

    // ─── State ──────────────────────────────────────────────────────────────

    const state = {
        running: false,
        stopped: false,
        quests: [],
        completed: 0,
        current: null,
        stores: null,
        cleanups: []
    };

    // Waiter tidur yang bisa dibangunkan paksa oleh stop().
    const waiters = new Map();
    let waiterSeq = 0;

    function sleep(ms) {
        return new Promise((resolve) => {
            const id = ++waiterSeq;
            const timer = setTimeout(() => {
                waiters.delete(id);
                resolve();
            }, ms);
            waiters.set(id, () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    function flushWaiters() {
        const pending = Array.from(waiters.values());
        waiters.clear();
        for (const cancel of pending) {
            try { cancel(); } catch (e) { /* diabaikan */ }
        }
    }

    function addCleanup(fn) {
        if (typeof fn === 'function') state.cleanups.push(fn);
    }

    function runCleanups() {
        const list = state.cleanups.splice(0).reverse();
        for (const fn of list) {
            try { fn(); } catch (e) { dbg('cleanup error:', e && e.message); }
        }
    }

    // ─── Resolusi modul Discord ─────────────────────────────────────────────

    function collectWebpackModules() {
        const modules = [];
        if (typeof window.webpackChunkdiscord_app === 'undefined') return modules;

        const chunkId = 'quest_completer_' + Math.random().toString(36).slice(2, 8);
        try {
            window.webpackChunkdiscord_app.push([
                [chunkId],
                {},
                (req) => {
                    for (const id in req.c) modules.push(req.c[id]);
                }
            ]);
        } catch (e) {
            warn('gagal membaca webpack modules:', e && e.message);
        } finally {
            try { window.webpackChunkdiscord_app.pop(); } catch (e) { /* diabaikan */ }
        }

        return modules;
    }

    function findExport(modules, predicate) {
        for (const mod of modules) {
            const exp = mod && mod.exports;
            if (!exp) continue;
            try {
                if (predicate(exp)) return exp;
            } catch (e) { /* modul ini tidak cocok */ }
        }
        return null;
    }

    /**
     * Cari store/internal Discord lewat predikat yang sama dengan skrip aslinya.
     * @returns {Object|null} map nama -> store, atau null kalau webpack belum siap
     */
    function resolveStores() {
        const modules = collectWebpackModules();
        if (modules.length === 0) return null;

        const pick = (predicate, key) => {
            const holder = findExport(modules, predicate);
            return holder ? holder[key] : null;
        };

        return {
            ApplicationStreamingStore: pick(
                (x) => x.A && x.A.__proto__ && x.A.__proto__.getStreamerActiveStreamMetadata, 'A'),
            RunningGameStore: pick(
                (x) => x.Ay && x.Ay.getRunningGames, 'Ay'),
            QuestsStore: pick(
                (x) => x.A && x.A.__proto__ && x.A.__proto__.getQuest, 'A'),
            ChannelStore: pick(
                (x) => x.A && x.A.__proto__ && x.A.__proto__.getAllThreadsForParent, 'A'),
            GuildChannelStore: pick(
                (x) => x.Ay && x.Ay.getSFWDefaultChannel, 'Ay'),
            FluxDispatcher: pick(
                (x) => x.h && x.h.__proto__ && x.h.__proto__.flushWaitQueue, 'h'),
            api: pick(
                (x) => x.Bo && x.Bo.get, 'Bo')
        };
    }

    function requiredStoresFor(taskName) {
        switch (taskName) {
            case 'WATCH_VIDEO':
            case 'WATCH_VIDEO_ON_MOBILE':
                return ['QuestsStore', 'api'];
            case 'PLAY_ON_DESKTOP':
                return ['QuestsStore', 'api', 'RunningGameStore', 'FluxDispatcher'];
            case 'STREAM_ON_DESKTOP':
                return ['QuestsStore', 'api', 'ApplicationStreamingStore', 'FluxDispatcher'];
            case 'PLAY_ACTIVITY':
                return ['QuestsStore', 'api', 'ChannelStore', 'GuildChannelStore'];
            default:
                return ['QuestsStore', 'api'];
        }
    }

    // ─── Quest helpers ──────────────────────────────────────────────────────

    function questNameOf(quest) {
        try { return quest.config.messages.questName; } catch (e) { return quest.id; }
    }

    function taskConfigOf(quest) {
        try {
            return quest.config.taskConfig || quest.config.taskConfigV2 || null;
        } catch (e) {
            return null;
        }
    }

    function taskNameOf(quest) {
        const tc = taskConfigOf(quest);
        if (!tc || !tc.tasks) return null;

        const present = Object.keys(tc.tasks);
        const allowed = Array.isArray(CONFIG.onlyTasks) && CONFIG.onlyTasks.length > 0
            ? CONFIG.onlyTasks
            : SUPPORTED_TASKS;

        return SUPPORTED_TASKS.find((t) => present.includes(t) && allowed.includes(t)) || null;
    }

    function applicationIdOf(quest, taskData) {
        try {
            if (quest.config.application && quest.config.application.id) {
                return quest.config.application.id;
            }
        } catch (e) { /* jatuh ke taskData */ }

        const apps = taskData && taskData.applications;
        return Array.isArray(apps) && apps[0] ? apps[0].id : null;
    }

    function collectQuests(stores) {
        const all = stores && stores.QuestsStore && stores.QuestsStore.quests;
        if (!all || typeof all.values !== 'function') return [];

        const list = [];
        for (const quest of all.values()) {
            try {
                const enrolled = quest.userStatus && quest.userStatus.enrolledAt;
                const completed = quest.userStatus && quest.userStatus.completedAt;
                const notExpired = new Date(quest.config.expiresAt).getTime() > Date.now();
                const taskName = taskNameOf(quest);

                if (enrolled && !completed && notExpired && taskName) {
                    list.push({ quest, taskName });
                } else {
                    dbg('lewati quest:', questNameOf(quest), {
                        enrolled: !!enrolled,
                        completed: !!completed,
                        notExpired,
                        taskName
                    });
                }
            } catch (e) {
                dbg('lewati quest (error):', e && e.message);
            }
        }
        return list;
    }

    // ─── API wrapper (mendukung dry run) ────────────────────────────────────

    async function apiGet(url) {
        if (CONFIG.dryRun) {
            log('[dry-run] GET', url);
            return { body: [] };
        }
        return await state.stores.api.get({ url });
    }

    async function apiPost(url, body) {
        if (CONFIG.dryRun) {
            log('[dry-run] POST', url, JSON.stringify(body));
            return { body: { progress: {}, completed_at: null } };
        }
        return await state.stores.api.post({ url, body });
    }

    // ─── Handler per jenis task ─────────────────────────────────────────────

    /**
     * WATCH_VIDEO / WATCH_VIDEO_ON_MOBILE — lapor progress video tanpa menonton.
     * videoSpeedSeconds = besar lompatan timestamp tiap request (default 7, sama
     * seperti skrip asli). Ini bukan pengali kecepatan: durasi nyata tetap
     * mendekati target quest, hanya jumlah request-nya yang lebih sedikit.
     */
    async function handleWatchVideo(quest, secondsNeeded, secondsDone) {
        const step = Math.max(1, Number(CONFIG.videoSpeedSeconds) || 7);
        let done = secondsDone;
        let completed = false;

        log(`Spoofing video untuk "${questNameOf(quest)}" — ${done}/${secondsNeeded}s.`);

        while (!state.stopped) {
            const remaining = Math.min(step, secondsNeeded - done);
            await sleep(remaining * 1000);
            if (state.stopped) break;

            const timestamp = done + step;
            const res = await apiPost(`/quests/${quest.id}/video-progress`, {
                timestamp: Math.min(secondsNeeded, timestamp + Math.random())
            });

            completed = !!(res && res.body && res.body.completed_at != null);
            done = Math.min(secondsNeeded, timestamp);

            if (timestamp >= secondsNeeded) break;
        }

        if (state.stopped) return false;

        if (!completed) {
            await apiPost(`/quests/${quest.id}/video-progress`, { timestamp: secondsNeeded });
        }

        log('Quest completed!');
        return true;
    }

    /**
     * PLAY_ON_DESKTOP — pura-pura game target sedang jalan.
     */
    async function handlePlayOnDesktop(quest, taskData, secondsNeeded, secondsDone) {
        if (typeof DiscordNative === 'undefined') {
            warn(`Quest "${questNameOf(quest)}" butuh game jalan — tidak bisa dari browser. Pakai aplikasi desktop Discord.`);
            return false;
        }

        const RunningGameStore = state.stores.RunningGameStore;
        const FluxDispatcher = state.stores.FluxDispatcher;

        const applicationId = applicationIdOf(quest, taskData);
        if (!applicationId) {
            warn('applicationId tidak ditemukan untuk quest ini.');
            return false;
        }

        const res = await apiGet(`/applications/public?application_ids=${applicationId}`);
        const appData = res && res.body && res.body[0];
        if (!appData) {
            warn('gagal mengambil data aplikasi dari API.');
            return false;
        }

        const exeFromApi = appData.executables
            && appData.executables.find((x) => x.os === 'win32')
            && appData.executables.find((x) => x.os === 'win32').name;

        const exeName = (exeFromApi && exeFromApi.replace('>', ''))
            || String(appData.name || 'game').replace(/[/\\:*?"<>|]/g, '');

        const pid = Math.floor(Math.random() * 30000) + 1000;
        const fakeGame = {
            cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
            exeName,
            exePath: `c:/program files/${String(appData.name).toLowerCase()}/${exeName}`,
            hidden: false,
            isLauncher: false,
            id: applicationId,
            name: appData.name,
            pid,
            pidPath: [pid],
            processName: appData.name,
            start: Date.now()
        };

        const realGames = RunningGameStore.getRunningGames();
        const realGetRunningGames = RunningGameStore.getRunningGames;
        const realGetGameForPID = RunningGameStore.getGameForPID;
        const fakeGames = [fakeGame];

        addCleanup(() => {
            try {
                RunningGameStore.getRunningGames = realGetRunningGames;
                RunningGameStore.getGameForPID = realGetGameForPID;
                FluxDispatcher.dispatch({
                    type: 'RUNNING_GAMES_CHANGE',
                    removed: [fakeGame],
                    added: [],
                    games: []
                });
            } catch (e) {
                dbg('restore RunningGameStore gagal:', e && e.message);
            }
        });

        RunningGameStore.getRunningGames = () => fakeGames;
        RunningGameStore.getGameForPID = (id) => fakeGames.find((x) => x.pid === id);
        FluxDispatcher.dispatch({
            type: 'RUNNING_GAMES_CHANGE',
            removed: realGames,
            added: [fakeGame],
            games: fakeGames
        });

        const waitMinutes = Math.ceil(Math.max(0, secondsNeeded - secondsDone) / 60);
        log(`Spoofed game ke "${appData.name}". Tunggu ±${waitMinutes} menit lagi.`);

        return await new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const onHeartbeat = (data) => {
                try {
                    const progress = quest.config.configVersion === 1
                        ? data.userStatus.streamProgressSeconds
                        : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);

                    log(`Quest progress: ${progress}/${secondsNeeded}`);

                    if (progress >= secondsNeeded) {
                        log('Quest completed!');
                        finish(true);
                    }
                } catch (e) {
                    dbg('heartbeat handler error:', e && e.message);
                }
            };

            addCleanup(() => {
                try { FluxDispatcher.unsubscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', onHeartbeat); } catch (e) { /* diabaikan */ }
                finish(false);
            });

            FluxDispatcher.subscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', onHeartbeat);
        });
    }

    /**
     * STREAM_ON_DESKTOP — pura-pura stream game target di VC.
     */
    async function handleStreamOnDesktop(quest, taskData, secondsNeeded, secondsDone) {
        if (typeof DiscordNative === 'undefined') {
            warn(`Quest "${questNameOf(quest)}" butuh stream — tidak bisa dari browser. Pakai aplikasi desktop Discord.`);
            return false;
        }

        const ApplicationStreamingStore = state.stores.ApplicationStreamingStore;
        const FluxDispatcher = state.stores.FluxDispatcher;

        const applicationId = applicationIdOf(quest, taskData);
        if (!applicationId) {
            warn('applicationId tidak ditemukan untuk quest ini.');
            return false;
        }

        const pid = Math.floor(Math.random() * 30000) + 1000;
        const realGetStreamerActiveStreamMetadata = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

        addCleanup(() => {
            try {
                ApplicationStreamingStore.getStreamerActiveStreamMetadata = realGetStreamerActiveStreamMetadata;
            } catch (e) {
                dbg('restore ApplicationStreamingStore gagal:', e && e.message);
            }
        });

        ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
            id: applicationId,
            pid,
            sourceName: null
        });

        const waitMinutes = Math.ceil(Math.max(0, secondsNeeded - secondsDone) / 60);
        log(`Spoofed stream ke game target. Stream window apa saja di VC selama ±${waitMinutes} menit lagi.`);
        log('Ingat: butuh minimal 1 orang lain di VC-nya.');

        return await new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const onHeartbeat = (data) => {
                try {
                    const progress = quest.config.configVersion === 1
                        ? data.userStatus.streamProgressSeconds
                        : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);

                    log(`Quest progress: ${progress}/${secondsNeeded}`);

                    if (progress >= secondsNeeded) {
                        log('Quest completed!');
                        finish(true);
                    }
                } catch (e) {
                    dbg('heartbeat handler error:', e && e.message);
                }
            };

            addCleanup(() => {
                try { FluxDispatcher.unsubscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', onHeartbeat); } catch (e) { /* diabaikan */ }
                finish(false);
            });

            FluxDispatcher.subscribe('QUESTS_SEND_HEARTBEAT_SUCCESS', onHeartbeat);
        });
    }

    /**
     * PLAY_ACTIVITY — kirim heartbeat langsung ke API tanpa benar-benar main.
     */
    async function handlePlayActivity(quest, secondsNeeded, secondsDone) {
        const ChannelStore = state.stores.ChannelStore;
        const GuildChannelStore = state.stores.GuildChannelStore;

        const channelId = resolveActivityChannelId(ChannelStore, GuildChannelStore);
        if (!channelId) {
            warn('tidak menemukan channel untuk streamKey PLAY_ACTIVITY (butuh DM atau VC).');
            return false;
        }

        const streamKey = `call:${channelId}:1`;
        const interval = Math.max(5000, Number(CONFIG.playActivityHeartbeatMs) || 20000);
        let progress = secondsDone;

        log('Completing quest', questNameOf(quest));

        while (!state.stopped) {
            const res = await apiPost(`/quests/${quest.id}/heartbeat`, {
                stream_key: streamKey,
                terminal: false
            });

            const value = res && res.body && res.body.progress
                && res.body.progress.PLAY_ACTIVITY
                && res.body.progress.PLAY_ACTIVITY.value;

            if (typeof value === 'number') progress = value;
            log(`Quest progress: ${progress}/${secondsNeeded}`);

            if (progress >= secondsNeeded) {
                await apiPost(`/quests/${quest.id}/heartbeat`, {
                    stream_key: streamKey,
                    terminal: true
                });
                log('Quest completed!');
                return true;
            }

            await sleep(interval);
        }

        return false;
    }

    function resolveActivityChannelId(ChannelStore, GuildChannelStore) {
        try {
            const privateChannels = ChannelStore && ChannelStore.getSortedPrivateChannels
                ? ChannelStore.getSortedPrivateChannels()
                : null;
            if (privateChannels && privateChannels[0] && privateChannels[0].id) {
                return privateChannels[0].id;
            }
        } catch (e) {
            dbg('getSortedPrivateChannels gagal:', e && e.message);
        }

        try {
            const guilds = GuildChannelStore && GuildChannelStore.getAllGuilds
                ? GuildChannelStore.getAllGuilds()
                : null;

            if (guilds) {
                const withVocal = Object.values(guilds)
                    .find((g) => g != null && Array.isArray(g.VOCAL) && g.VOCAL.length > 0);
                if (withVocal) return withVocal.VOCAL[0].channel.id;
            }
        } catch (e) {
            dbg('getAllGuilds gagal:', e && e.message);
        }

        return null;
    }

    // ─── Antrian ────────────────────────────────────────────────────────────

    async function runQueue() {
        while (!state.stopped) {
            const item = state.quests.shift();
            if (!item) break;

            const quest = item.quest;
            const taskName = item.taskName;
            state.current = taskName;

            log(`▶ ${questNameOf(quest)} (${taskName})`);

            const tc = taskConfigOf(quest);
            const taskData = tc && tc.tasks ? tc.tasks[taskName] : null;
            if (!taskData) {
                warn(`taskData kosong untuk ${taskName}, quest dilewati.`);
                state.current = null;
                continue;
            }

            const missing = requiredStoresFor(taskName).filter((k) => !state.stores[k]);
            if (missing.length > 0) {
                warn(`lewati ${taskName}: modul Discord tidak ditemukan (${missing.join(', ')}).`);
                state.current = null;
                continue;
            }

            const secondsNeeded = Number(taskData.target) || 0;
            const secondsDone = (quest.userStatus
                && quest.userStatus.progress
                && quest.userStatus.progress[taskName]
                && quest.userStatus.progress[taskName].value) || 0;

            if (secondsNeeded <= 0) {
                warn(`target durasi ${taskName} tidak diketahui, quest dilewati.`);
                state.current = null;
                continue;
            }

            let ok = false;
            try {
                if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
                    ok = await handleWatchVideo(quest, secondsNeeded, secondsDone);
                } else if (taskName === 'PLAY_ON_DESKTOP') {
                    ok = await handlePlayOnDesktop(quest, taskData, secondsNeeded, secondsDone);
                } else if (taskName === 'STREAM_ON_DESKTOP') {
                    ok = await handleStreamOnDesktop(quest, taskData, secondsNeeded, secondsDone);
                } else if (taskName === 'PLAY_ACTIVITY') {
                    ok = await handlePlayActivity(quest, secondsNeeded, secondsDone);
                }
            } catch (e) {
                warn(`handler ${taskName} gagal:`, (e && e.message) || e);
            } finally {
                runCleanups();
                state.current = null;
            }

            if (ok) state.completed += 1;
            if (!state.stopped) await sleep(1000);
        }
    }

    // ─── Start / stop ───────────────────────────────────────────────────────

    async function start(trigger) {
        if (!CONFIG.enabled) {
            warn('plugin sedang dimatikan lewat config (enabled: false).');
            return false;
        }

        if (state.running) {
            warn('sudah jalan — tunggu selesai atau stop dulu (hotkey stop).');
            return false;
        }

        state.stopped = false;
        state.running = true;
        state.completed = 0;
        runCleanups();

        log(`start (${trigger})${CONFIG.dryRun ? ' — DRY RUN: tidak ada request API sungguhan' : ''}`);

        const stores = resolveStores();
        if (!stores) {
            warn('webpackChunkdiscord_app belum siap — coba lagi beberapa detik lagi.');
            state.running = false;
            return false;
        }
        state.stores = stores;

        const missingCore = ['QuestsStore', 'api'].filter((k) => !stores[k]);
        if (missingCore.length > 0) {
            warn(`modul inti tidak ditemukan: ${missingCore.join(', ')}. Discord mungkin mengubah struktur internalnya.`);
            state.running = false;
            return false;
        }

        state.quests = collectQuests(stores);
        if (state.quests.length === 0) {
            log("You don't have any uncompleted quests!");
            state.running = false;
            return false;
        }

        log(`${state.quests.length} quest siap diproses.`);

        try {
            await runQueue();
        } catch (e) {
            warn('antrian berhenti karena error:', (e && e.message) || e);
        } finally {
            flushWaiters();
            runCleanups();
            state.running = false;
            state.current = null;
            log(`selesai — ${state.completed} quest berhasil, ${state.quests.length} tidak diproses.`);
        }

        return true;
    }

    function stop(reason) {
        const wasRunning = state.running;

        state.stopped = true;
        state.running = false;
        state.quests = [];
        state.current = null;

        flushWaiters();
        runCleanups();

        if (wasRunning) {
            log(`stop (${reason || 'manual'}) — semua patch store sudah dikembalikan.`);
        } else {
            dbg('stop dipanggil saat tidak ada proses yang jalan.');
        }
    }

    // ─── Hotkey ─────────────────────────────────────────────────────────────

    function parseHotkey(spec) {
        const parts = String(spec || '')
            .toLowerCase()
            .split('+')
            .map((s) => s.trim())
            .filter(Boolean);

        return {
            ctrl: parts.includes('ctrl') || parts.includes('control'),
            shift: parts.includes('shift'),
            alt: parts.includes('alt'),
            meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command'),
            key: parts.find((p) => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd', 'command'].includes(p)) || ''
        };
    }

    function eventMatchesHotkey(event, hk) {
        if (!hk.key) return false;
        if (!!event.ctrlKey !== hk.ctrl) return false;
        if (!!event.shiftKey !== hk.shift) return false;
        if (!!event.altKey !== hk.alt) return false;
        if (!!event.metaKey !== hk.meta) return false;

        const key = String(event.key || '').toLowerCase();
        return key === hk.key || (hk.key === 'space' && key === ' ');
    }

    function isTypingTarget(target) {
        if (!target || !target.tagName) return false;
        const tag = String(target.tagName).toLowerCase();
        return tag === 'input' || tag === 'textarea' || target.isContentEditable === true;
    }

    window.addEventListener('keydown', (event) => {
        if (isTypingTarget(event.target)) return;

        if (eventMatchesHotkey(event, parseHotkey(CONFIG.hotkeyStart))) {
            event.preventDefault();
            event.stopPropagation();
            start('hotkey');
            return;
        }

        if (eventMatchesHotkey(event, parseHotkey(CONFIG.hotkeyStop))) {
            event.preventDefault();
            event.stopPropagation();
            stop('hotkey');
        }
    }, true);

    // ─── Auto run (opsional) ────────────────────────────────────────────────

    function waitForStores(timeoutMs, intervalMs) {
        const deadline = Date.now() + (timeoutMs || 90000);

        return new Promise((resolve) => {
            const tick = () => {
                if (state.stopped) return resolve(false);

                const stores = resolveStores();
                if (stores && stores.QuestsStore && stores.api) return resolve(true);
                if (Date.now() > deadline) return resolve(false);

                setTimeout(tick, intervalMs || 2000);
            };
            tick();
        });
    }

    // ─── Public API ─────────────────────────────────────────────────────────

    window.__questCompleter = {
        version: VERSION,
        config: CONFIG,
        start: () => start('api'),
        stop: (reason) => stop(reason || 'api'),
        status: () => ({
            version: VERSION,
            running: state.running,
            stopped: state.stopped,
            current: state.current,
            queued: state.quests.length,
            completed: state.completed,
            dryRun: !!CONFIG.dryRun,
            hasStores: !!state.stores
        }),
        /** Nama store/internal Discord yang berhasil ditemukan (diagnostik). */
        probe: () => {
            const stores = resolveStores();
            if (!stores) return null;
            return Object.keys(stores).filter((k) => !!stores[k]);
        }
    };

    log(`v${VERSION} terpasang — ${String(CONFIG.hotkeyStart).toUpperCase()} untuk mulai, ${String(CONFIG.hotkeyStop).toUpperCase()} untuk stop.`);
    log('Kontrol manual: window.__questCompleter.start() / .stop() / .status() / .probe()');
    if (!CONFIG.autoRun) {
        log('autoRun mati: tidak ada quest yang diproses otomatis sampai kamu menekan hotkey start.');
    }
    log('PERINGATAN: otomasi quest melanggar ToS Discord — akun bisa kena flag/suspend. Risiko ditanggung sendiri.');

    if (CONFIG.autoRun && CONFIG.enabled) {
        waitForStores().then((ready) => {
            if (!ready) {
                warn('autoRun timeout: modul Discord tidak siap dalam 90 detik.');
                return;
            }
            start('autoRun');
        });
    }
})();
