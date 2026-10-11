/**
 * Privacy Blur — script sisi renderer.
 *
 * Kerjaannya murni lokal di DOM/CSS: tidak menyentuh API Discord, tidak mengirim
 * apa pun ke mana pun. Dua mode:
 *   - Blur   : buramkan avatar, username, isi pesan, gambar, nama channel
 *   - Clean  : sembunyikan sidebar/daftar member/panel/toolbar untuk screenshot
 *
 * Hotkey default: Ctrl+Shift+B (blur) dan Ctrl+Shift+U (clean UI).
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[PrivacyBlur]';
    const VERSION = '1.0.0';
    const STYLE_ID = 'privacy-blur-styles';
    const INDICATOR_ID = 'privacy-blur-indicator';
    const STORAGE_KEY = 'privacy-blur-state-v1';

    const DEFAULT_CONFIG = {
        enabled: true,
        hotkeyBlur: 'ctrl+shift+b',
        hotkeyCleanUi: 'ctrl+shift+u',
        blurPx: 8,
        revealOnHover: true,
        showIndicator: true,
        hideIndicatorInCleanUi: true,
        persist: true,
        blurOnStart: false,
        cleanUiOnStart: false,
        guardIntervalMs: 5000,
        blur: { avatars: true, usernames: true, text: true, images: true, channels: true },
        cleanUi: { guilds: true, sidebar: true, members: true, panels: true, toolbar: true }
    };

    function mergeConfig(base, override) {
        const source = override && typeof override === 'object' ? override : {};
        const merged = Object.assign({}, base, source);
        merged.blur = Object.assign({}, base.blur, source.blur || {});
        merged.cleanUi = Object.assign({}, base.cleanUi, source.cleanUi || {});
        return merged;
    }

    const config = mergeConfig(DEFAULT_CONFIG, window.__PRIVACY_BLUR_CONFIG__);

    if (window.__privacyBlur) {
        try { window.__privacyBlur.setConfig(window.__PRIVACY_BLUR_CONFIG__ || {}); } catch (e) { /* diabaikan */ }
        return;
    }

    const nativeLog = (...args) => console.log(LOG_PREFIX, ...args);

    // Selector memakai pencocokan substring karena Discord memberi hash pada nama class
    // (mis. "c19a557985eb7793-username"), sama seperti konvensi di src/css/base.css.
    const BLUR_GROUPS = {
        avatars: ['[class*="-avatar"]'],
        usernames: ['[class*="-username"]', '[class*="-nameTag"]', '[class*="-nickname"]', '[class*="-globalName"]'],
        text: ['[class*="-messageContent"]', '[class*="-markup"]', '[class*="-repliedTextContent"]'],
        images: [
            '[class*="-imageWrapper"]',
            '[class*="-messageContent"] img',
            '[class*="-messageContent"] video',
            '[class*="-attachment"] img',
            '[class*="-embedFull"] img'
        ],
        channels: ['[class*="-channelName"]', '[class*="-guildName"]', '[class*="-headerText"]', '[class*="-topic"]']
    };

    const CLEAN_GROUPS = {
        guilds: ['[class*="-guilds"]'],
        sidebar: ['[class*="-sidebar"]'],
        members: ['[class*="-membersWrap"]', '[class*="-members"]'],
        panels: ['[class*="-panels"]'],
        toolbar: ['[class*="-toolbar"]']
    };

    const state = { blur: false, clean: false };

    let styleEl = null;
    let indicator = null;
    let indicatorButtons = null;
    let guardTimer = null;

    // ─── CSS ────────────────────────────────────────────────────────────────

    function activeGroups(groups, flags) {
        return Object.keys(groups).filter((key) => flags[key] !== false);
    }

    function buildCss() {
        const px = Math.max(1, Number(config.blurPx) || 8);
        const lines = ['/* Privacy Blur — dibuat otomatis oleh plugin, jangan diedit manual */'];

        lines.push(
            `#${INDICATOR_ID} { position: fixed; right: 12px; bottom: 12px; z-index: 2147483000;`
            + ' display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 999px;'
            + ' font: 600 11px/1.2 var(--font-primary, "gg sans", sans-serif); background: rgba(17,18,20,.92);'
            + ' color: #f2f3f5; border: 1px solid rgba(255,255,255,.12); box-shadow: 0 4px 16px rgba(0,0,0,.45);'
            + ' user-select: none; }'
        );
        lines.push(`#${INDICATOR_ID} button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.10); color: inherit; font: inherit; }`);
        lines.push(`#${INDICATOR_ID} button:hover { background: rgba(255,255,255,.18); }`);
        lines.push(`#${INDICATOR_ID} button[data-active="true"] { background: #5865f2; color: #fff; }`);
        lines.push(`body.pb-clean #${INDICATOR_ID}.pb-hide-in-clean { display: none !important; }`);

        for (const key of activeGroups(BLUR_GROUPS, config.blur)) {
            const selectors = BLUR_GROUPS[key].map((sel) => `body.pb-blur ${sel}`).join(',\n');
            lines.push(`${selectors} { filter: blur(${px}px) !important; }`);

            if (config.revealOnHover) {
                const hover = BLUR_GROUPS[key].map((sel) => `body.pb-blur.pb-reveal ${sel}:hover`).join(',\n');
                lines.push(`${hover} { filter: none !important; }`);
            }
        }

        for (const key of activeGroups(CLEAN_GROUPS, config.cleanUi)) {
            const selectors = CLEAN_GROUPS[key].map((sel) => `body.pb-clean ${sel}`).join(',\n');
            lines.push(`${selectors} { display: none !important; }`);
        }

        return lines.join('\n');
    }

    function ensureStyles() {
        const existing = document.getElementById(STYLE_ID);
        if (existing) {
            styleEl = existing;
            return styleEl;
        }

        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = buildCss();
        (document.head || document.documentElement).appendChild(styleEl);
        return styleEl;
    }

    function refreshStyles() {
        const el = ensureStyles();
        el.textContent = buildCss();
    }

    // ─── Indikator ──────────────────────────────────────────────────────────

    function buildIndicator() {
        if (!config.showIndicator) return null;

        const existing = document.getElementById(INDICATOR_ID);
        if (existing) return existing;

        const root = document.createElement('div');
        root.id = INDICATOR_ID;
        root.className = 'pb-hide-in-clean';

        const label = document.createElement('span');
        label.textContent = 'Privasi';
        root.appendChild(label);

        const blurButton = document.createElement('button');
        blurButton.type = 'button';
        blurButton.textContent = 'Blur';
        blurButton.title = `Blur — ${String(config.hotkeyBlur).toUpperCase()}`;
        blurButton.addEventListener('click', () => toggleBlur());
        root.appendChild(blurButton);

        const cleanButton = document.createElement('button');
        cleanButton.type = 'button';
        cleanButton.textContent = 'Clean';
        cleanButton.title = `Clean UI — ${String(config.hotkeyCleanUi).toUpperCase()}`;
        cleanButton.addEventListener('click', () => toggleCleanUi());
        root.appendChild(cleanButton);

        document.body.appendChild(root);

        indicatorButtons = { blur: blurButton, clean: cleanButton };
        return root;
    }

    // ─── Terapkan state ─────────────────────────────────────────────────────

    function loadPersisted() {
        if (!config.persist) return false;
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            if (typeof parsed.blur === 'boolean') state.blur = parsed.blur;
            if (typeof parsed.clean === 'boolean') state.clean = parsed.clean;
            return true;
        } catch (e) {
            return false;
        }
    }

    function savePersisted() {
        if (!config.persist) return;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ blur: state.blur, clean: state.clean }));
        } catch (e) { /* localStorage penuh / diblokir — abaikan */ }
    }

    function apply() {
        const body = document.body;
        if (!body) return;

        const reveal = state.blur && config.revealOnHover;
        if (body.classList) {
            body.classList.toggle('pb-blur', state.blur);
            body.classList.toggle('pb-reveal', reveal);
            body.classList.toggle('pb-clean', state.clean);
        }

        if (indicator && indicator.classList) {
            indicator.classList.toggle('pb-hide-in-clean', config.hideIndicatorInCleanUi !== false);
        }

        if (indicatorButtons) {
            indicatorButtons.blur.setAttribute('data-active', String(state.blur));
            indicatorButtons.clean.setAttribute('data-active', String(state.clean));
        }

        savePersisted();
    }

    // ─── Aksi ───────────────────────────────────────────────────────────────

    function setBlur(value) {
        state.blur = !!value;
        apply();
        nativeLog(`blur ${state.blur ? 'AKTIF' : 'mati'}`);
    }

    function setCleanUi(value) {
        state.clean = !!value;
        apply();
        nativeLog(`clean UI ${state.clean ? 'AKTIF' : 'mati'}`);
    }

    function toggleBlur() { setBlur(!state.blur); }
    function toggleCleanUi() { setCleanUi(!state.clean); }

    // ─── Hotkey ─────────────────────────────────────────────────────────────

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

    function matches(event, hotkey) {
        if (!hotkey.key) return false;
        if (!!event.ctrlKey !== hotkey.ctrl) return false;
        if (!!event.shiftKey !== hotkey.shift) return false;
        if (!!event.altKey !== hotkey.alt) return false;
        if (!!event.metaKey !== hotkey.meta) return false;
        return String(event.key || '').toLowerCase() === hotkey.key;
    }

    function isTypingTarget(target) {
        if (!target || !target.tagName) return false;
        const tag = String(target.tagName).toLowerCase();
        return tag === 'input' || tag === 'textarea' || target.isContentEditable === true;
    }

    function onKeydown(event) {
        if (isTypingTarget(event.target)) return;

        if (matches(event, parseHotkey(config.hotkeyBlur))) {
            event.preventDefault();
            event.stopPropagation();
            toggleBlur();
            return;
        }

        if (matches(event, parseHotkey(config.hotkeyCleanUi))) {
            event.preventDefault();
            event.stopPropagation();
            toggleCleanUi();
        }
    }

    window.addEventListener('keydown', onKeydown, true);

    // ─── API publik ─────────────────────────────────────────────────────────

    window.__privacyBlur = {
        version: VERSION,
        config,
        status: () => ({
            version: VERSION,
            blur: state.blur,
            clean: state.clean,
            blurPx: Number(config.blurPx) || 8,
            blurs: Object.keys(BLUR_GROUPS).filter((key) => config.blur[key] !== false),
            hides: Object.keys(CLEAN_GROUPS).filter((key) => config.cleanUi[key] !== false),
            styleInjected: !!document.getElementById(STYLE_ID),
            indicator: !!document.getElementById(INDICATOR_ID)
        }),
        toggleBlur,
        toggleCleanUi,
        setBlur,
        setCleanUi,
        setConfig: (next) => {
            const merged = mergeConfig(config, next || {});
            Object.assign(config, merged);
            if (config.showIndicator) {
                indicator = buildIndicator();
            }
            refreshStyles();
            apply();
        },
        stop: () => {
            if (guardTimer) clearInterval(guardTimer);
            guardTimer = null;

            window.removeEventListener('keydown', onKeydown, true);

            const body = document.body;
            if (body && body.classList) {
                body.classList.remove('pb-blur', 'pb-reveal', 'pb-clean');
            }
            for (const id of [STYLE_ID, INDICATOR_ID]) {
                const el = document.getElementById(id);
                if (el && el.parentNode) el.parentNode.removeChild(el);
            }
            styleEl = null;
            indicator = null;
            indicatorButtons = null;
        }
    };

    // ─── Inisialisasi ───────────────────────────────────────────────────────

    const hadPersisted = loadPersisted();
    if (!hadPersisted) {
        state.blur = config.blurOnStart === true;
        state.clean = config.cleanUiOnStart === true;
    }

    ensureStyles();
    indicator = buildIndicator();
    apply();

    // Discord kadang mengganti isi <head>; pastikan style & indikator tetap ada.
    guardTimer = setInterval(() => {
        if (!document.getElementById(STYLE_ID)) {
            ensureStyles();
            apply();
        }
        if (config.showIndicator && !document.getElementById(INDICATOR_ID) && document.body) {
            indicator = buildIndicator();
            apply();
        }
    }, Math.max(250, Number(config.guardIntervalMs) || 5000));

    nativeLog(`v${VERSION} aktif — ${String(config.hotkeyBlur).toUpperCase()} = blur, ${String(config.hotkeyCleanUi).toUpperCase()} = clean UI`);
    nativeLog('Kontrol manual: window.__privacyBlur.toggleBlur() / .toggleCleanUi() / .status()');
    if (state.blur || state.clean) {
        nativeLog(`state tersimpan dipulihkan (blur=${state.blur}, clean=${state.clean})`);
    }
})();
