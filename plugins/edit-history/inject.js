/**
 * Edit History — script sisi renderer.
 *
 * Mencatat versi lama pesan setiap kali seseorang mengeditnya, lalu menandai pesan
 * itu dengan badge kecil. Versi lama diambil dari FluxDispatcher SEBELUM store
 * memproses aksi MESSAGE_UPDATE, jadi yang terbaca masih isi yang lama.
 *
 * Cara buka riwayat (badge sengaja pakai pseudo-element + atribut, bukan node baru
 * di dalam pohon React, supaya tidak mengganggu rendering Discord):
 *   - Alt + klik pada pesan yang punya badge
 *   - Hotkey Ctrl+Shift+E untuk pesan terakhir yang tercatat diedit
 *
 * Semua data lokal: disimpan di localStorage, tidak ada yang dikirim ke mana pun.
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[EditHistory]';
    const VERSION = '1.0.0';
    const STYLE_ID = 'edit-history-styles';
    const PANEL_ID = 'edit-history-panel';
    const STORAGE_KEY = 'edit-history-v1';
    const ATTR = 'data-eh-versions';
    const HINT_ATTR = 'data-eh-hint';

    const DEFAULT_CONFIG = {
        enabled: true,
        persist: true,
        maxVersions: 10,
        maxMessages: 500,
        maxContentChars: 2000,
        showBadge: true,
        hotkeyShowLast: 'ctrl+shift+e',
        logEdits: true,
        panelMaxHeightPx: 420,
        saveDebounceMs: 1500,
        guardIntervalMs: 3000
    };

    function mergeConfig(base, override) {
        const source = override && typeof override === 'object' ? override : {};
        return Object.assign({}, base, source);
    }

    const config = mergeConfig(DEFAULT_CONFIG, window.__EDIT_HISTORY_CONFIG__);

    if (window.__editHistory) {
        try { window.__editHistory.setConfig(window.__EDIT_HISTORY_CONFIG__ || {}); } catch (e) { /* diabaikan */ }
        return;
    }

    const nativeLog = (...args) => console.log(LOG_PREFIX, ...args);
    const debugLog = (...args) => { if (config.logEdits) console.log(LOG_PREFIX, ...args); };

    /** messageId -> { channelId, content, updatedAt, versions: [{ content, at }] } */
    const tracked = new Map();
    /** id pesan yang punya versi, urut dari yang paling baru diedit */
    const editOrder = [];

    const state = {
        dispatcher: null,
        messageStore: null,
        patchedDispatch: null,
        unsubscribers: [],
        usingFallback: false,
        observer: null,
        listEl: null,
        panel: null,
        panelFor: null,
        recorded: 0,
        saveTimer: null,
        guardTimer: null,
        persistenceBroken: false
    };

    // ─── Utilitas umum ──────────────────────────────────────────────────────

    function truncateContent(value) {
        const text = typeof value === 'string' ? value : String(value == null ? '' : value);
        const limit = Math.max(50, Number(config.maxContentChars) || 2000);
        return text.length > limit ? `${text.slice(0, limit)}…[dipotong]` : text;
    }

    function formatTime(ms) {
        try {
            return new Date(ms).toLocaleString();
        } catch (e) {
            return String(ms);
        }
    }

    function parseElementId(value) {
        const text = String(value || '');
        const prefix = 'chat-messages-';
        if (!text.startsWith(prefix)) return null;

        // ID Discord berupa snowflake (angka), tapi dibuat toleran supaya
        // perubahan format di sisi Discord tidak langsung mematikan badge.
        const parts = text.slice(prefix.length).split('-');
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

        return { channelId: parts[0], messageId: parts[1] };
    }

    function isTypingTarget(target) {
        if (!target || !target.tagName) return false;
        const tag = String(target.tagName).toLowerCase();
        return tag === 'input' || tag === 'textarea' || target.isContentEditable === true;
    }

    function parseHotkey(spec) {
        const parts = String(spec || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
        return {
            ctrl: parts.includes('ctrl') || parts.includes('control'),
            shift: parts.includes('shift'),
            alt: parts.includes('alt'),
            meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command'),
            key: parts.find((p) => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd', 'command'].includes(p)) || ''
        };
    }

    function matchesHotkey(event, hotkey) {
        if (!hotkey.key) return false;
        if (!!event.ctrlKey !== hotkey.ctrl) return false;
        if (!!event.shiftKey !== hotkey.shift) return false;
        if (!!event.altKey !== hotkey.alt) return false;
        if (!!event.metaKey !== hotkey.meta) return false;
        return String(event.key || '').toLowerCase() === hotkey.key;
    }

    // ─── Resolusi modul Discord ─────────────────────────────────────────────

    function collectWebpackModules() {
        const modules = [];
        if (typeof window.webpackChunkdiscord_app === 'undefined') return modules;

        try {
            window.webpackChunkdiscord_app.push([['eh_' + Math.random().toString(36).slice(2, 8)], {}, (req) => {
                for (const id in req.c) modules.push(req.c[id]);
            }]);
        } catch (e) {
            nativeLog('gagal membaca webpack modules:', e && e.message);
        } finally {
            try { window.webpackChunkdiscord_app.pop(); } catch (e) { /* diabaikan */ }
        }

        return modules;
    }

    function resolveModules() {
        const modules = collectWebpackModules();
        let dispatcher = null;
        let messageStore = null;

        for (const mod of modules) {
            const exp = mod && mod.exports;
            if (!exp) continue;

            for (const candidate of [exp, exp.default, exp.Z, exp.ZP]) {
                if (!candidate) continue;

                if (!messageStore
                    && typeof candidate.getMessage === 'function'
                    && typeof candidate.getMessages === 'function') {
                    messageStore = candidate;
                }

                if (!dispatcher
                    && typeof candidate.dispatch === 'function'
                    && typeof candidate.subscribe === 'function'
                    && typeof candidate.unsubscribe === 'function') {
                    dispatcher = candidate;
                }
            }

            if (!dispatcher && exp.h && exp.h.__proto__ && exp.h.__proto__.flushWaitQueue) dispatcher = exp.h;
            if (!messageStore && exp.A && exp.A.__proto__ && typeof exp.A.__proto__.getMessage === 'function') {
                messageStore = exp.A;
            }

            if (dispatcher && messageStore) break;
        }

        return { dispatcher, messageStore, moduleCount: modules.length };
    }

    function readStoreContent(channelId, messageId) {
        if (!state.messageStore || !channelId) return undefined;
        try {
            const message = state.messageStore.getMessage(channelId, messageId);
            return message && typeof message.content === 'string' ? message.content : undefined;
        } catch (e) {
            return undefined;
        }
    }

    // ─── Pencatatan riwayat ─────────────────────────────────────────────────

    function touch(id) {
        const record = tracked.get(id);
        if (!record) return;

        tracked.delete(id);
        tracked.set(id, record);

        while (tracked.size > Math.max(10, Number(config.maxMessages) || 500)) {
            const oldest = tracked.keys().next();
            if (oldest.done) break;
            tracked.delete(oldest.value);
        }
    }

    function remember(message) {
        if (!message || !message.id) return;
        if (typeof message.content !== 'string') return;

        const existing = tracked.get(message.id);
        if (existing) {
            existing.channelId = message.channel_id || existing.channelId;
            existing.content = message.content;
            touch(message.id);
            return;
        }

        tracked.set(message.id, {
            channelId: message.channel_id || null,
            content: message.content,
            updatedAt: Date.now(),
            versions: []
        });

        while (tracked.size > Math.max(10, Number(config.maxMessages) || 500)) {
            const oldest = tracked.keys().next();
            if (oldest.done) break;
            tracked.delete(oldest.value);
        }
    }

    function forget(messageId) {
        tracked.delete(messageId);
        const index = editOrder.indexOf(messageId);
        if (index >= 0) editOrder.splice(index, 1);
    }

    function pushVersion(messageId, content, at) {
        const record = tracked.get(messageId);
        if (!record) return;

        record.versions.push({ content: truncateContent(content), at });
        while (record.versions.length > Math.max(1, Number(config.maxVersions) || 10)) {
            record.versions.shift();
        }

        record.updatedAt = at;
        state.recorded += 1;

        const index = editOrder.indexOf(messageId);
        if (index >= 0) editOrder.splice(index, 1);
        editOrder.unshift(messageId);

        scheduleSave();
        refreshBadges();
    }

    /**
     * Inti: dipanggil SEBELUM store memproses aksi.
     */
    function handleUpdate(action) {
        const message = action && action.message;
        if (!message || !message.id) return;

        const messageId = message.id;
        const record = tracked.get(messageId);
        const channelId = message.channel_id || (record && record.channelId) || null;

        if (typeof message.content !== 'string') {
            // Update parsial (mis. embed/reaction) — bukan edit teks.
            return;
        }

        const newContent = message.content;
        const oldContent = record ? record.content : readStoreContent(channelId, messageId);

        if (oldContent === undefined || oldContent === null) {
            // Belum punya baseline (pesan lama sebelum plugin aktif) — simpan yang sekarang.
            tracked.set(messageId, {
                channelId,
                content: newContent,
                updatedAt: Date.now(),
                versions: record ? record.versions : []
            });
            return;
        }

        if (oldContent === newContent) return;

        if (!record) {
            tracked.set(messageId, {
                channelId,
                content: newContent,
                updatedAt: Date.now(),
                versions: [{ content: truncateContent(oldContent), at: Date.now() }]
            });
            state.recorded += 1;
            editOrder.unshift(messageId);
            debugLog(`edit tercatat (baseline store): ${messageId}`);
            scheduleSave();
            refreshBadges();
            return;
        }

        pushVersion(messageId, oldContent, record.updatedAt || Date.now());
        record.content = newContent;
        debugLog(`edit tercatat: ${messageId} (total ${record.versions.length} versi)`);
    }

    function onAction(action) {
        if (!action || typeof action.type !== 'string') return;

        try {
            switch (action.type) {
                case 'MESSAGE_CREATE':
                    remember(action.message);
                    break;
                case 'LOAD_MESSAGES_SUCCESS':
                    if (Array.isArray(action.messages)) action.messages.forEach(remember);
                    break;
                case 'MESSAGE_UPDATE':
                    handleUpdate(action);
                    break;
                case 'MESSAGE_DELETE':
                    if (action.id) forget(action.id);
                    break;
                case 'MESSAGE_DELETE_BULK':
                    if (Array.isArray(action.ids)) action.ids.forEach(forget);
                    break;
                default:
                    break;
            }
        } catch (e) {
            // Jangan pernah sampai mengganggu dispatcher Discord.
            nativeLog('error saat memproses aksi:', (e && e.message) || e);
        }
    }

    function hookDispatcher(dispatcher) {
        const original = dispatcher.dispatch;

        try {
            dispatcher.dispatch = function patchedDispatch(action) {
                onAction(action);
                return original.apply(this, arguments);
            };
        } catch (e) {
            nativeLog('tidak bisa mem-patch dispatch:', (e && e.message) || e);
        }

        if (dispatcher.dispatch !== original) {
            state.patchedDispatch = { dispatcher, original };
            return true;
        }

        // Fallback: dispatch tidak bisa ditimpa → pakai subscribe (baseline dari
        // MESSAGE_CREATE, jadi edit tetap tertangkap untuk pesan baru).
        state.usingFallback = true;
        try {
            for (const type of ['MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'LOAD_MESSAGES_SUCCESS']) {
                const handler = (action) => onAction(action);
                dispatcher.subscribe(type, handler);
                state.unsubscribers.push({ dispatcher, type, handler });
            }
            nativeLog('dispatch tidak bisa ditimpa — memakai mode subscribe (baseline dari MESSAGE_CREATE)');
        } catch (e) {
            nativeLog('gagal memasang subscribe:', (e && e.message) || e);
        }

        return false;
    }

    // ─── Badge ──────────────────────────────────────────────────────────────

    function buildCss() {
        const maxHeight = Math.max(160, Number(config.panelMaxHeightPx) || 420);

        return [
            '/* Edit History — dibuat otomatis oleh plugin */',
            ...(config.showBadge ? [
                `[id^="chat-messages-"][${ATTR}] { position: relative; }`,
                `[id^="chat-messages-"][${ATTR}]::after {`
                + ` content: " ⟳ " attr(${ATTR}) "×";`
                + ' position: absolute; top: 2px; right: 12px; padding: 1px 6px; border-radius: 999px;'
                + ' background: rgba(88,101,242,.85); color: #fff; pointer-events: none;'
                + ' font: 600 10px/1.6 var(--font-primary, "gg sans", sans-serif); }'
            ] : []),
            `#${PANEL_ID} { position: fixed; z-index: 2147483000; width: 400px; max-width: 92vw;`
            + ` max-height: ${maxHeight}px; display: flex; flex-direction: column;`
            + ' background: #111214; color: #f2f3f5; border: 1px solid rgba(255,255,255,.12);'
            + ' border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.55);'
            + ' font: 400 13px/1.45 var(--font-primary, "gg sans", sans-serif); overflow: hidden; }',
            `#${PANEL_ID} .eh-header { display: flex; align-items: center; justify-content: space-between;`
            + ' gap: 8px; padding: 10px 12px; background: rgba(255,255,255,.04);'
            + ' border-bottom: 1px solid rgba(255,255,255,.08); font-weight: 600; }',
            `#${PANEL_ID} .eh-header button, #${PANEL_ID} .eh-meta button { all: unset; cursor: pointer;`
            + ' padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,.10); font-size: 11px; }',
            `#${PANEL_ID} .eh-header button:hover, #${PANEL_ID} .eh-meta button:hover { background: rgba(255,255,255,.2); }`,
            `#${PANEL_ID} .eh-body { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }`,
            `#${PANEL_ID} .eh-item { background: rgba(255,255,255,.04); border-radius: 6px; padding: 8px; }`,
            `#${PANEL_ID} .eh-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px;`
            + ' margin-bottom: 6px; color: #b5bac1; font-size: 11px; }',
            `#${PANEL_ID} .eh-text { white-space: pre-wrap; word-break: break-word; color: #dbdee1; }`,
            `#${PANEL_ID} .eh-empty { color: #b5bac1; padding: 12px; text-align: center; }`
        ].join('\n');
    }

    function ensureStyles() {
        const existing = document.getElementById(STYLE_ID);
        if (existing) {
            existing.textContent = buildCss();
            return existing;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = buildCss();
        (document.head || document.documentElement).appendChild(style);
        return style;
    }

    function listMessageElements() {
        const list = state.listEl;
        if (!list || typeof list.querySelectorAll !== 'function') return [];

        try {
            return Array.from(list.querySelectorAll('[id^="chat-messages-"]'));
        } catch (e) {
            return [];
        }
    }

    function refreshBadges() {
        if (!config.showBadge) return;

        for (const element of listMessageElements()) {
            const parsed = parseElementId(element.id);
            if (!parsed) continue;

            const record = tracked.get(parsed.messageId);
            const count = record && record.versions ? record.versions.length : 0;

            if (count > 0) {
                if (element.getAttribute(ATTR) !== String(count)) {
                    element.setAttribute(ATTR, String(count));
                }
                if (element.getAttribute(HINT_ATTR) !== '1') {
                    element.setAttribute(HINT_ATTR, '1');
                    try { element.setAttribute('title', `Diedit ${count}× — Alt+klik untuk riwayat`); } catch (e) { /* diabaikan */ }
                }
            } else if (element.getAttribute(ATTR) !== null) {
                element.removeAttribute(ATTR);
                element.removeAttribute(HINT_ATTR);
            }
        }
    }

    function clearBadges() {
        for (const element of listMessageElements()) {
            if (element.getAttribute(ATTR) !== null) element.removeAttribute(ATTR);
            if (element.getAttribute(HINT_ATTR) !== null) element.removeAttribute(HINT_ATTR);
        }
    }

    // ─── Panel riwayat ──────────────────────────────────────────────────────

    function closePanel() {
        if (state.panel && state.panel.parentNode) {
            state.panel.parentNode.removeChild(state.panel);
        }
        state.panel = null;
        state.panelFor = null;
    }

    function copyText(text) {
        try {
            if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
                window.navigator.clipboard.writeText(text).catch(() => { /* diabaikan */ });
                return true;
            }
        } catch (e) { /* jatuh ke cara manual */ }
        return false;
    }

    function positionPanel(panel, anchorEl) {
        let top = 80;
        let left = 80;

        try {
            if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
                const rect = anchorEl.getBoundingClientRect();
                top = Math.max(12, Math.min(rect.bottom + 6, (window.innerHeight || 900) - 220));
                left = Math.max(12, Math.min(rect.left + 40, (window.innerWidth || 1200) - 430));
            }
        } catch (e) { /* pakai posisi default */ }

        panel.style.top = `${Math.round(top)}px`;
        panel.style.left = `${Math.round(left)}px`;
    }

    function openPanel(messageId, anchorEl) {
        const record = tracked.get(messageId);
        if (!record || record.versions.length === 0) {
            nativeLog('belum ada riwayat edit untuk pesan itu');
            return null;
        }

        closePanel();
        ensureStyles();

        const panel = document.createElement('div');
        panel.id = PANEL_ID;

        const header = document.createElement('div');
        header.className = 'eh-header';

        const title = document.createElement('span');
        title.textContent = `Riwayat edit — ${record.versions.length} versi`;
        header.appendChild(title);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '✕';
        closeButton.title = 'Tutup';
        closeButton.addEventListener('click', () => closePanel());
        header.appendChild(closeButton);

        panel.appendChild(header);

        const body = document.createElement('div');
        body.className = 'eh-body';

        const versions = record.versions.slice().reverse();
        versions.forEach((version, index) => {
            const item = document.createElement('div');
            item.className = 'eh-item';

            const meta = document.createElement('div');
            meta.className = 'eh-meta';

            const when = document.createElement('span');
            when.textContent = index === 0 ? `${formatTime(version.at)} (versi sebelumnya)` : formatTime(version.at);
            meta.appendChild(when);

            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.textContent = 'Copy';
            copyButton.addEventListener('click', () => {
                copyButton.textContent = copyText(version.content) ? 'Tersalin' : 'Gagal';
            });
            meta.appendChild(copyButton);

            item.appendChild(meta);

            const text = document.createElement('div');
            text.className = 'eh-text';
            text.textContent = version.content || '(kosong)';
            item.appendChild(text);

            body.appendChild(item);
        });

        panel.appendChild(body);
        document.body.appendChild(panel);
        positionPanel(panel, anchorEl);

        state.panel = panel;
        state.panelFor = messageId;

        return panel;
    }

    // ─── Persistensi ────────────────────────────────────────────────────────

    function scheduleSave() {
        if (!config.persist || state.persistenceBroken) return;
        if (state.saveTimer) clearTimeout(state.saveTimer);

        state.saveTimer = setTimeout(() => {
            state.saveTimer = null;
            saveNow();
        }, Math.max(200, Number(config.saveDebounceMs) || 1500));
    }

    function serializeRecords() {
        return Array.from(tracked.entries()).map(([id, record]) => [
            id,
            record.channelId,
            truncateContent(record.content),
            record.updatedAt,
            record.versions.map((version) => [version.content, version.at])
        ]);
    }

    function saveNow() {
        if (!config.persist || state.persistenceBroken) return false;

        const write = (records) => {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), records }));
        };

        try {
            write(serializeRecords());
            return true;
        } catch (e) {
            // Kemungkinan kuota localStorage penuh: buang separuh yang tertua lalu coba sekali lagi.
            try {
                const records = serializeRecords();
                const trimmed = records.slice(Math.floor(records.length / 2));
                write(trimmed);
                nativeLog('kuota localStorage hampir penuh — riwayat lama dibuang sebagian');
                return true;
            } catch (err) {
                state.persistenceBroken = true;
                nativeLog('gagal menyimpan riwayat; persistensi dimatikan untuk sesi ini:', (err && err.message) || err);
                return false;
            }
        }
    }

    function loadPersisted() {
        if (!config.persist) return 0;

        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return 0;

            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.records)) return 0;

            let restored = 0;
            for (const entry of parsed.records) {
                if (!Array.isArray(entry) || entry.length < 5) continue;
                const [id, channelId, content, updatedAt, versions] = entry;
                if (!id) continue;

                tracked.set(id, {
                    channelId: channelId || null,
                    content: truncateContent(content),
                    updatedAt: Number(updatedAt) || Date.now(),
                    versions: Array.isArray(versions)
                        ? versions
                            .filter((v) => Array.isArray(v) && typeof v[0] === 'string')
                            .map((v) => ({ content: v[0], at: Number(v[1]) || Date.now() }))
                            .slice(-Math.max(1, Number(config.maxVersions) || 10))
                        : []
                });
                if (tracked.get(id).versions.length > 0) restored += 1;
            }

            const ordered = Array.from(tracked.entries())
                .filter(([, record]) => record.versions.length > 0)
                .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
                .map(([id]) => id);

            editOrder.length = 0;
            editOrder.push(...ordered);

            return restored;
        } catch (e) {
            nativeLog('riwayat tersimpan tidak bisa dibaca:', (e && e.message) || e);
            return 0;
        }
    }

    // ─── Observer daftar pesan ──────────────────────────────────────────────

    function ensureObserver() {
        if (!state.listEl) {
            try {
                state.listEl = document.querySelector('[data-list-id="chat-messages"]');
            } catch (e) {
                state.listEl = null;
            }

            if (state.listEl && state.observer && typeof state.observer.observe === 'function') {
                try {
                    state.observer.observe(state.listEl, { childList: true, subtree: true });
                } catch (e) { /* diabaikan */ }
            }
        }

        if (state.listEl) refreshBadges();
    }

    function startObserver() {
        if (typeof MutationObserver === 'undefined') return;

        state.observer = new MutationObserver(() => {
            try {
                refreshBadges();
            } catch (e) {
                nativeLog('refresh badge gagal:', (e && e.message) || e);
            }
        });

        ensureObserver();
    }

    // ─── Interaksi ──────────────────────────────────────────────────────────

    function onDocumentClick(event) {
        if (!event || !event.altKey) return;

        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        let element = null;
        try {
            element = target.closest(`[${ATTR}]`);
        } catch (e) {
            element = null;
        }
        if (!element) return;

        const parsed = parseElementId(element.id);
        if (!parsed) return;

        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();

        openPanel(parsed.messageId, element);
    }

    function onKeydown(event) {
        if (isTypingTarget(event.target)) return;

        if (matchesHotkey(event, parseHotkey(config.hotkeyShowLast))) {
            event.preventDefault();
            event.stopPropagation();

            const messageId = editOrder.find((id) => {
                const record = tracked.get(id);
                return record && record.versions.length > 0;
            });

            if (!messageId) {
                nativeLog('belum ada pesan yang tercatat diedit');
                return;
            }

            const record = tracked.get(messageId);
            let element = null;
            try {
                element = document.getElementById(`chat-messages-${record.channelId}-${messageId}`);
            } catch (e) {
                element = null;
            }

            openPanel(messageId, element);
            return;
        }

        if (event.key === 'Escape' && state.panel) closePanel();
    }

    // ─── API publik ─────────────────────────────────────────────────────────

    window.__editHistory = {
        version: VERSION,
        config,
        status: () => ({
            version: VERSION,
            patchedDispatch: !!state.patchedDispatch,
            usingFallback: state.usingFallback,
            trackedMessages: tracked.size,
            messagesWithVersions: editOrder.length,
            recordedVersions: state.recorded,
            panelOpen: !!state.panel,
            persistenceBroken: state.persistenceBroken,
            hasMessageStore: !!state.messageStore,
            listFound: !!state.listEl
        }),
        /** Riwayat satu pesan (untuk inspeksi manual dari console). */
        history: (messageId) => {
            const record = tracked.get(messageId);
            return record ? record.versions.map((v) => ({ at: v.at, content: v.content })) : null;
        },
        scan: () => resolveModules().moduleCount,
        openPanel,
        closePanel,
        saveNow,
        clearAll: () => {
            tracked.clear();
            editOrder.length = 0;
            state.recorded = 0;
            clearBadges();
            closePanel();
            if (config.persist) {
                try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* diabaikan */ }
            }
        },
        setConfig: (next) => {
            Object.assign(config, mergeConfig(config, next || {}));
            ensureStyles();
            refreshBadges();
        },
        stop: () => {
            if (state.guardTimer) clearInterval(state.guardTimer);
            state.guardTimer = null;

            if (state.saveTimer) clearTimeout(state.saveTimer);
            state.saveTimer = null;

            if (state.patchedDispatch) {
                try {
                    state.patchedDispatch.dispatcher.dispatch = state.patchedDispatch.original;
                } catch (e) { /* diabaikan */ }
                state.patchedDispatch = null;
            }

            for (const { dispatcher, type, handler } of state.unsubscribers) {
                try { dispatcher.unsubscribe(type, handler); } catch (e) { /* diabaikan */ }
            }
            state.unsubscribers = [];

            if (state.observer) {
                try { state.observer.disconnect(); } catch (e) { /* diabaikan */ }
                state.observer = null;
            }

            clearBadges();
            closePanel();

            document.removeEventListener('click', onDocumentClick, true);
            window.removeEventListener('keydown', onKeydown, true);

            for (const id of [STYLE_ID, PANEL_ID]) {
                const element = document.getElementById(id);
                if (element && element.parentNode) element.parentNode.removeChild(element);
            }

            saveNow();
        }
    };

    // ─── Inisialisasi ───────────────────────────────────────────────────────

    ensureStyles();

    const restored = loadPersisted();
    if (restored > 0) nativeLog(`${restored} pesan dengan riwayat dipulihkan dari localStorage`);

    const modules = resolveModules();
    state.dispatcher = modules.dispatcher;
    state.messageStore = modules.messageStore;

    if (state.dispatcher) {
        hookDispatcher(state.dispatcher);
    } else {
        nativeLog('FluxDispatcher belum ketemu — riwayat tidak bisa dicatat. Discord mungkin masih memuat, atau struktur modulnya berubah.');
    }

    startObserver();

    state.guardTimer = setInterval(() => {
        if (!document.getElementById(STYLE_ID)) ensureStyles();
        if (!state.listEl) ensureObserver();

        if (!state.dispatcher) {
            const retry = resolveModules();
            if (retry.dispatcher) {
                state.dispatcher = retry.dispatcher;
                state.messageStore = retry.messageStore || state.messageStore;
                hookDispatcher(state.dispatcher);
                nativeLog('FluxDispatcher ditemukan pada percobaan ulang — pencatatan aktif');
            }
        }
    }, Math.max(500, Number(config.guardIntervalMs) || 3000));

    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('keydown', onKeydown, true);

    nativeLog(`v${VERSION} aktif — ${state.dispatcher ? (state.usingFallback ? 'mode subscribe' : 'dispatch dipatch') : 'menunggu FluxDispatcher'}`);
    nativeLog(`Alt+klik pesan ber-badge atau ${String(config.hotkeyShowLast).toUpperCase()} untuk lihat riwayat edit`);
    if (!config.persist) nativeLog('persistensi mati: riwayat hanya bertahan selama sesi ini');
})();
