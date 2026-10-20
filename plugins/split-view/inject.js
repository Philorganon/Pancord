/**
 * Split View — Dual Chat & Multitasking (v1.1.0).
 *
 * Membagi tampilan chat Discord menjadi dua kolom berdampingan (side-by-side):
 * - Membuka obrolan DM sambil membaca server, atau memantau 2 channel sekaligus.
 * - Divider yang bisa digeser (resizable) dari 25% hingga 75%.
 * - Tombol Popout ke jendela terpisah untuk monitor kedua.
 * - Presets cepat: Direct Messages (@me), Channel Saat Ini, atau Custom URL.
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[SplitView]';
    const VERSION = '1.1.0';
    const CONTAINER_ID = 'pancord-split-container';
    const BUTTON_ID = 'pancord-split-btn';
    const STYLE_ID = 'pancord-split-styles';
    const STORAGE_KEY = 'pancord-split-last-url';
    const STORAGE_RATIO = 'pancord-split-ratio';

    const DEFAULT_CONFIG = {
        enabled: true,
        hotkey: 'ctrl+\\',
        defaultSplitRatio: 50,
        showToolbarButton: true,
        saveLastChannel: true
    };

    const config = Object.assign({}, DEFAULT_CONFIG, window.__SPLIT_VIEW_CONFIG__ || {});

    if (window.__splitView && typeof window.__splitView.stop === 'function') {
        try { window.__splitView.stop(); } catch (e) { /* ignored */ }
    }

    const log = (...args) => console.log(LOG_PREFIX, ...args);

    function getStoredItem(key, fallback = null) {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const val = window.localStorage.getItem(key);
                return val !== null && val !== undefined ? val : fallback;
            }
        } catch (e) { /* ignore */ }
        return fallback;
    }

    function setStoredItem(key, value) {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(key, String(value));
            }
        } catch (e) { /* ignore */ }
    }

    const state = {
        isOpen: false,
        ratio: parseInt(getStoredItem(STORAGE_RATIO, String(config.defaultSplitRatio || 50)), 10) || 50,
        currentUrl: getStoredItem(STORAGE_KEY, 'https://discord.com/channels/@me'),
        containerEl: null,
        toolbarObserver: null,
        keydownHandler: null,
        isDragging: false
    };

    // ─── Hotkey Parser ──────────────────────────────────────────────────

    function parseHotkey(spec) {
        const parts = String(spec || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
        return {
            ctrl: parts.includes('ctrl') || parts.includes('control'),
            shift: parts.includes('shift'),
            alt: parts.includes('alt'),
            meta: parts.includes('meta') || parts.includes('cmd'),
            key: parts.find((p) => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd'].includes(p)) || '\\'
        };
    }

    function matchesHotkey(e, hk) {
        if (!hk.key) return false;
        if (!!e.ctrlKey !== hk.ctrl) return false;
        if (!!e.shiftKey !== hk.shift) return false;
        if (!!e.altKey !== hk.alt) return false;
        if (!!e.metaKey !== hk.meta) return false;
        const key = String(e.key || '').toLowerCase();
        const code = String(e.code || '').toLowerCase();
        if (key === hk.key) return true;
        if (hk.key === '\\' && (code === 'backslash' || key === '\\')) return true;
        return false;
    }

    // ─── Styles ─────────────────────────────────────────────────────────

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const css = `
            /* Split View Panel Container */
            #${CONTAINER_ID} {
                position: fixed;
                top: 0;
                right: 0;
                bottom: 0;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                background: var(--background-secondary, #2b2d31);
                border-left: 2px solid var(--background-modifier-accent, #3f4147);
                box-shadow: -6px 0 24px rgba(0, 0, 0, 0.45);
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }

            /* Resizer Handle di sisi kiri panel */
            .pancord-split-resizer {
                position: absolute;
                top: 0;
                left: -5px;
                bottom: 0;
                width: 10px;
                cursor: col-resize;
                z-index: 1001;
                transition: background 0.15s ease;
            }
            .pancord-split-resizer:hover,
            .pancord-split-resizer.dragging {
                background: rgba(88, 101, 242, 0.5);
            }

            /* Split View Top Header */
            .pancord-split-header {
                height: 48px;
                min-height: 48px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 12px;
                background: var(--background-tertiary, #1e1f22);
                border-bottom: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08));
                color: var(--header-primary, #fff);
                gap: 8px;
                user-select: none;
            }

            .pancord-split-title {
                display: flex;
                align-items: center;
                gap: 6px;
                font-weight: 700;
                font-size: 13px;
                color: var(--header-primary, #fff);
                white-space: nowrap;
            }
            .pancord-split-title svg {
                color: var(--brand-experiment, #5865F2);
            }

            .pancord-split-nav {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
            }

            .pancord-split-url-input {
                flex: 1;
                height: 28px;
                background: var(--background-secondary, #2b2d31);
                border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.12));
                border-radius: 4px;
                padding: 0 10px;
                color: #fff;
                font-size: 12px;
                outline: none;
                transition: border-color 0.15s ease;
            }
            .pancord-split-url-input:focus {
                border-color: var(--brand-experiment, #5865F2);
            }

            /* Action Buttons Header */
            .pancord-split-actions {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .pancord-split-btn {
                background: transparent;
                border: none;
                color: var(--interactive-normal, #b5bac1);
                cursor: pointer;
                width: 28px;
                height: 28px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: background 0.15s ease, color 0.15s ease;
            }
            .pancord-split-btn:hover {
                color: var(--interactive-active, #fff);
                background: var(--background-modifier-hover, rgba(255, 255, 255, 0.08));
            }
            .pancord-split-btn-close:hover {
                color: #ed4245;
                background: rgba(237, 66, 69, 0.18);
            }

            /* Frame Browser / Chat */
            .pancord-split-frame-wrapper {
                flex: 1;
                position: relative;
                width: 100%;
                height: calc(100% - 48px);
                background: var(--background-primary, #313338);
            }

            .pancord-split-frame {
                border: none;
                width: 100%;
                height: 100%;
                background: var(--background-primary, #313338);
            }

            /* Toolbar Button di Header Discord */
            #${BUTTON_ID} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                margin: 0 4px;
                color: var(--interactive-normal, #b5bac1);
                cursor: pointer;
                border-radius: 4px;
                transition: color 0.15s ease, background 0.15s ease;
            }
            #${BUTTON_ID}:hover {
                color: var(--interactive-active, #fff);
                background: var(--background-modifier-hover, rgba(255, 255, 255, 0.08));
            }
            #${BUTTON_ID}.active {
                color: var(--brand-experiment, #5865F2);
                background: rgba(88, 101, 242, 0.15);
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = css;
        (document.head || document.documentElement).appendChild(styleEl);
    }

    // ─── Toolbar Icon Injection ─────────────────────────────────────────

    function findToolbar() {
        return document.querySelector(
            '[class*="toolbar" i], [role="toolbar"], [class*="upperContainer" i] [class*="children" i], header [role="toolbar"], section [role="toolbar"]'
        );
    }

    function injectToolbarButton() {
        if (!config.showToolbarButton) return;
        if (document.getElementById(BUTTON_ID)) return;

        const toolbar = findToolbar();
        if (!toolbar) return;

        const btn = document.createElement('div');
        btn.id = BUTTON_ID;
        btn.className = state.isOpen ? 'active' : '';
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', `Split View (${config.hotkey})`);
        btn.setAttribute('tabindex', '0');
        btn.title = `Split View — Dual Chat (${config.hotkey})`;

        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="12" y1="3" x2="12" y2="21"></line>
            </svg>
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSplitView();
        });

        toolbar.insertBefore(btn, toolbar.firstChild);
    }

    function observeToolbar() {
        if (state.toolbarObserver) return;

        const target = document.body || document.documentElement;
        if (!target) return;

        state.toolbarObserver = new MutationObserver(() => {
            if (!document.getElementById(BUTTON_ID)) {
                injectToolbarButton();
            }
        });

        try {
            state.toolbarObserver.observe(target, { childList: true, subtree: true });
        } catch (e) {
            console.warn(LOG_PREFIX, 'Failed to observe toolbar mutations:', e);
        }
    }

    // ─── Main Chat Margin Resizer ───────────────────────────────────────

    function updateLayout() {
        const chatContent = document.querySelector('[class*="chat_"] [class*="content_"], [class*="chatContent_"]');
        let container = document.getElementById(CONTAINER_ID);

        if (!state.isOpen) {
            if (chatContent) chatContent.style.marginRight = '0';
            if (container) container.remove();
            return;
        }

        if (container) {
            container.style.width = `${state.ratio}%`;
        }

        if (chatContent) {
            chatContent.style.position = 'relative';
            chatContent.style.marginRight = `${state.ratio}%`;
        }
    }

    // ─── Toggle Split View Panel ────────────────────────────────────────

    function toggleSplitView() {
        state.isOpen = !state.isOpen;

        const btn = document.getElementById(BUTTON_ID);
        if (btn) btn.classList.toggle('active', state.isOpen);

        let container = document.getElementById(CONTAINER_ID);

        if (!state.isOpen) {
            updateLayout();
            log('Split View ditutup.');
            return;
        }

        if (!container) {
            container = document.createElement('div');
            container.id = CONTAINER_ID;
            container.style.width = `${state.ratio}%`;

            const initialUrl = state.currentUrl || 'https://discord.com/channels/@me';

            container.innerHTML = `
                <div class="pancord-split-resizer" title="Geser untuk mengatur lebar split view"></div>
                <div class="pancord-split-header">
                    <div class="pancord-split-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="12" y1="3" x2="12" y2="21"></line>
                        </svg>
                        <span>Split View</span>
                    </div>

                    <div class="pancord-split-nav">
                        <input type="text" class="pancord-split-url-input" value="${initialUrl}" placeholder="URL Channel / DM Discord..." />
                    </div>

                    <div class="pancord-split-actions">
                        <button class="pancord-split-btn pancord-split-btn-dms" title="Buka Direct Messages (@me)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </button>
                        <button class="pancord-split-btn pancord-split-btn-refresh" title="Muat Ulang Panel">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M23 4v6h-6"></path>
                                <path d="M1 20v-6h6"></path>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                        </button>
                        <button class="pancord-split-btn pancord-split-btn-popout" title="Popout ke Jendela Baru">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                        </button>
                        <button class="pancord-split-btn pancord-split-btn-close" title="Tutup Split View (${config.hotkey})">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>

                <div class="pancord-split-frame-wrapper">
                    <iframe class="pancord-split-frame" src="${initialUrl}" allow="camera; microphone; display-capture; clipboard-read; clipboard-write;" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"></iframe>
                </div>
            `;

            // Element references
            const input = container.querySelector('.pancord-split-url-input');
            const frame = container.querySelector('.pancord-split-frame');
            const resizer = container.querySelector('.pancord-split-resizer');
            const dmsBtn = container.querySelector('.pancord-split-btn-dms');
            const refreshBtn = container.querySelector('.pancord-split-btn-refresh');
            const popoutBtn = container.querySelector('.pancord-split-btn-popout');
            const closeBtn = container.querySelector('.pancord-split-btn-close');

            // Auto login iframe via Discord token if on Discord domain
            frame.addEventListener('load', () => {
                try {
                    const token = window.__DISCORD_USER_TOKEN__;
                    if (token && frame.contentWindow && frame.contentWindow.localStorage) {
                        frame.contentWindow.localStorage.setItem('token', `"${token}"`);
                    }
                } catch (e) {
                    /* ignore cross-origin */
                }
            });

            // Input URL handler
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    let url = input.value.trim();
                    if (url) {
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            url = 'https://' + url;
                        }
                        frame.src = url;
                        state.currentUrl = url;
                        if (config.saveLastChannel) {
                            setStoredItem(STORAGE_KEY, url);
                        }
                    }
                }
            });

            // Tombol DMs Preset
            dmsBtn.addEventListener('click', () => {
                const dmUrl = 'https://discord.com/channels/@me';
                input.value = dmUrl;
                frame.src = dmUrl;
                state.currentUrl = dmUrl;
                if (config.saveLastChannel) setStoredItem(STORAGE_KEY, dmUrl);
            });

            // Tombol Refresh
            refreshBtn.addEventListener('click', () => {
                frame.src = frame.src;
            });

            // Tombol Popout ke Window Terpisah
            popoutBtn.addEventListener('click', () => {
                const targetUrl = state.currentUrl || 'https://discord.com/channels/@me';
                window.open(targetUrl, '_blank', 'width=800,height=750,menubar=no,toolbar=no');
            });

            // Tombol Close
            closeBtn.addEventListener('click', toggleSplitView);

            // Resizer Drag Handler
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                state.isDragging = true;
                resizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                const onMouseMove = (moveEvt) => {
                    if (!state.isDragging) return;
                    const windowWidth = window.innerWidth;
                    const rightOffset = windowWidth - moveEvt.clientX;
                    let newRatio = Math.round((rightOffset / windowWidth) * 100);

                    // Batas rasio antara 25% dan 75%
                    newRatio = Math.max(25, Math.min(75, newRatio));
                    state.ratio = newRatio;
                    setStoredItem(STORAGE_RATIO, newRatio);
                    updateLayout();
                };

                const onMouseUp = () => {
                    state.isDragging = false;
                    resizer.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });

            document.body.appendChild(container);
        }

        updateLayout();
        log(`Split View terbuka (rasio ${state.ratio}%).`);
    }

    // ─── Init & Start ───────────────────────────────────────────────────

    function start() {
        if (!config.enabled) return;

        try {
            injectStyles();
            injectToolbarButton();
            observeToolbar();

            const hotkey = parseHotkey(config.hotkey);
            if (!state.keydownHandler) {
                state.keydownHandler = (e) => {
                    if (matchesHotkey(e, hotkey)) {
                        e.preventDefault();
                        toggleSplitView();
                    }
                };
                window.addEventListener('keydown', state.keydownHandler);
            }
        } catch (err) {
            console.error(LOG_PREFIX, 'Error initializing Split View:', err);
        }

        log(`Split View v${VERSION} aktif. Tekan ${config.hotkey} untuk toggle.`);
    }

    function stop() {
        if (state.isOpen) {
            toggleSplitView();
        }

        if (state.keydownHandler) {
            window.removeEventListener('keydown', state.keydownHandler);
            state.keydownHandler = null;
        }

        if (state.toolbarObserver) {
            state.toolbarObserver.disconnect();
            state.toolbarObserver = null;
        }

        const btn = document.getElementById(BUTTON_ID);
        if (btn) btn.remove();

        const sty = document.getElementById(STYLE_ID);
        if (sty) sty.remove();

        const container = document.getElementById(CONTAINER_ID);
        if (container) container.remove();

        log('Split View dinonaktifkan.');
    }

    window.__splitView = {
        version: VERSION,
        config,
        start,
        stop,
        toggle: toggleSplitView
    };
    window.toggleSplitView = toggleSplitView;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
