/**
 * @fileoverview Quick Send Plugin — Stiker & Template Messages [FIXED]
 * @description Menambahkan popup UI di Discord untuk kirim gambar custom
 *   (dikirim sebagai attachment biasa, tanpa perlu Nitro) dan kalimat
 *   template dengan cepat.
 *
 *   🔧 FIX: Sekarang template message langsung terkirim tanpa perlu Enter,
 *   dan text benar-benar terdeteksi Discord sebagai input valid (bukan ghost text).
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bandingkan dua nama folder "app-X.Y.Z" secara numerik (descending, versi
 * terbaru duluan).
 */
function compareAppVersionsDesc(a, b) {
    const toParts = (name) => name
        .replace(/^app-/, '')
        .split('.')
        .map((n) => parseInt(n, 10) || 0);

    const pa = toParts(a);
    const pb = toParts(b);
    const len = Math.max(pa.length, pb.length);

    for (let i = 0; i < len; i++) {
        const diff = (pb[i] || 0) - (pa[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

export default class QuickSend {
    constructor(api) {
        this.api = api;
        this.log = api.log;
        this.config = {};
        this.stickers = [];
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async init(config) {
        this.config = config;
        this.log.info('Quick Send plugin initialized');
        await this._loadStickers();
        if (config.enabled) {
            await this._deployInjectScript();
        }
    }

    async destroy() {
        this.log.info('Quick Send plugin destroyed');
    }

    async afterInject(data) {
        if (!this.config.enabled) return;
        await this._loadStickers();
        await this._deployInjectScript(data?.resourcePath);
        this.log.success('Quick Send inject script deployed');
    }

    async onDiscordStart() {
        if (!this.config.enabled) return;
        await this._loadStickers();
        await this._deployInjectScript();
    }

    async onConfigChange(config) {
        this.config = config;
        if (config.enabled) {
            await this._loadStickers();
            await this._deployInjectScript();
        }
    }

    // ─── Sticker Management ─────────────────────────────────────

    async _loadStickers() {
        const stickersDir = path.join(__dirname, 'stickers');
        await fs.ensureDir(stickersDir);

        const supportedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        };

        try {
            const files = await fs.readdir(stickersDir);
            const loaded = [];

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (!supportedExts.includes(ext)) continue;

                const filePath = path.join(stickersDir, file);
                const stat = await fs.stat(filePath);

                if (stat.size > 8 * 1024 * 1024) {
                    this.log.warn(`Sticker too large, skipping: ${file} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
                    continue;
                }

                const buffer = await fs.readFile(filePath);
                const base64 = buffer.toString('base64');

                loaded.push({
                    name: path.basename(file, ext),
                    filename: file,
                    base64,
                    mimeType: mimeTypes[ext] || 'image/png',
                    size: stat.size
                });
            }

            loaded.sort((a, b) => a.name.localeCompare(b.name));
            this.stickers = loaded;
            this.log.info(`Loaded ${this.stickers.length} stickers`);
        } catch (err) {
            this.log.error(`Failed to load stickers: ${err.message}`);
            this.stickers = [];
        }
    }

    // ─── Inject Script Generation ────────────────────────────────

    async _deployInjectScript(explicitResourcePath) {
        try {
            let resourcePath = explicitResourcePath || null;

            if (!resourcePath) {
                resourcePath = await this._findDiscordResourcePath();
            }

            if (!resourcePath) {
                this.log.warn('Discord resource path not found — inject script will be deployed on next injection');
                return;
            }

            const appFolder = path.join(resourcePath, 'app');
            const pluginScriptsDir = path.join(appFolder, 'plugin-scripts');

            if (!await fs.pathExists(appFolder)) {
                this.log.debug('App folder not found — Discord not injected yet');
                return;
            }

            await fs.ensureDir(pluginScriptsDir);

            const injectCode = this._generateInjectScript();
            await fs.writeFile(
                path.join(pluginScriptsDir, 'quick-send.js'),
                injectCode
            );

            this.log.success('Inject script written to plugin-scripts/quick-send.js');
        } catch (err) {
            this.log.error(`Failed to deploy inject script: ${err.message}`);
        }
    }

    async _findDiscordResourcePath() {
        const platform = process.platform;
        let basePaths = [];

        if (platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA || '';
            basePaths = [
                path.join(localAppData, 'Discord'),
                path.join(localAppData, 'DiscordPTB'),
                path.join(localAppData, 'DiscordCanary'),
                path.join(localAppData, 'DiscordDevelopment')
            ];
        } else if (platform === 'darwin') {
            basePaths = [
                '/Applications/Discord.app/Contents',
                `${process.env.HOME}/Applications/Discord.app/Contents`
            ];
        } else {
            basePaths = [
                `${process.env.HOME}/.config/discord`,
                '/opt/Discord',
                '/usr/share/discord'
            ];
        }

        for (const basePath of basePaths) {
            try {
                if (!await fs.pathExists(basePath)) continue;

                if (platform === 'win32') {
                    const entries = await fs.readdir(basePath);
                    const appDirs = entries
                        .filter(e => e.startsWith('app-'))
                        .sort(compareAppVersionsDesc);

                    for (const appDir of appDirs) {
                        const resourcePath = path.join(basePath, appDir, 'resources');
                        if (await fs.pathExists(path.join(resourcePath, 'app'))) {
                            return resourcePath;
                        }
                        if (await fs.pathExists(path.join(resourcePath, 'original.asar'))) {
                            return resourcePath;
                        }
                        if (await fs.pathExists(path.join(resourcePath, 'app.asar'))) {
                            return resourcePath;
                        }
                    }
                } else if (platform === 'darwin') {
                    const resourcePath = path.join(basePath, 'Resources');
                    if (await fs.pathExists(resourcePath)) {
                        return resourcePath;
                    }
                } else {
                    const resourcePath = path.join(basePath, 'resources');
                    if (await fs.pathExists(resourcePath)) {
                        return resourcePath;
                    }
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    _formatHotkeyDisplay(hotkey) {
        return String(hotkey || '')
            .split('+')
            .map((part) => {
                const p = part.trim().toLowerCase();
                if (!p) return '';
                if (p === 'ctrl' || p === 'control') return 'Ctrl';
                if (p === 'shift') return 'Shift';
                if (p === 'alt') return 'Alt';
                if (p === 'meta' || p === 'cmd' || p === 'command') return 'Cmd';
                return p.toUpperCase();
            })
            .filter(Boolean)
            .join(' + ');
    }

    /**
     * Generate the complete inject script yang sudah diperbaiki
     */
    _generateInjectScript() {
        const stickersJSON = JSON.stringify(this.stickers.map(s => ({
            name: s.name,
            filename: s.filename,
            base64: s.base64,
            mimeType: s.mimeType,
            size: s.size
        })));

        const templatesJSON = JSON.stringify(this.config.templates || []);
        const stickerSize = this.config.stickerSize || 80;
        const maxColumns = this.config.maxColumns || 5;
        const hotkey = this.config.hotkey || 'ctrl+shift+q';
        const hotkeyDisplayJSON = JSON.stringify(this._formatHotkeyDisplay(hotkey));

        return `(function() {
    'use strict';

    if (window.__quickSendInjected) return;
    window.__quickSendInjected = true;

    const STICKERS = ${stickersJSON};
    const TEMPLATES = ${templatesJSON};
    const STICKER_SIZE = ${stickerSize};
    const MAX_COLUMNS = ${maxColumns};
    const HOTKEY = '${hotkey}';
    const HOTKEY_DISPLAY = ${hotkeyDisplayJSON};

    const ICONS = {
        zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
        note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
    };

    const CATEGORY_COLORS = {
        busy: '#f59e0b',
        afk: '#64748b',
        omw: '#22c55e',
        gaming: '#06b6d4',
        thanks: '#fb923c',
        confirm: '#10b981',
        done: '#eab308',
        info: '#3b82f6',
        default: '#71717a'
    };

    const stickerMin = Math.max(48, Math.min(160, STICKER_SIZE));

    const STYLES = \`
        #qs-root {
            --qs-bg-panel: rgba(17, 18, 20, 0.92);
            --qs-bg-surface: #1a1b1e;
            --qs-bg-input: #0d0e10;
            --qs-border: #2b2c30;
            --qs-border-soft: #222327;
            --qs-text-primary: #eef0f2;
            --qs-text-secondary: #9799a1;
            --qs-text-muted: #5a5c63;
            --qs-accent: #ff7a45;
            --qs-accent-strong: #e8632e;
            --qs-accent-soft: rgba(255, 122, 69, 0.16);
            --qs-accent-2: #ffb84d;
            --qs-warm: #ffb84d;
            --qs-danger: #ef4444;
            --qs-success: #2dd4a7;
            position: fixed;
            bottom: 0;
            right: 0;
            z-index: 2147483647;
            pointer-events: none;
        }

        #qs-trigger-btn {
            position: fixed;
            bottom: 28px;
            right: 28px;
            width: 52px;
            height: 52px;
            border-radius: 16px;
            background: linear-gradient(135deg, #ff7a45 0%, #ffb84d 100%);
            border: none;
            cursor: pointer;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 20px rgba(255, 122, 69, 0.35), 0 2px 8px rgba(0,0,0,0.35);
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            outline: none;
            pointer-events: auto;
            user-select: none;
        }
        #qs-trigger-btn:hover {
            transform: scale(1.08) translateY(-2px);
            box-shadow: 0 8px 28px rgba(255, 122, 69, 0.5), 0 4px 12px rgba(0,0,0,0.4);
        }
        #qs-trigger-btn:active {
            transform: scale(0.95);
        }
        #qs-trigger-btn.qs-open {
            background: linear-gradient(135deg, #ef4444 0%, #f97316 100%);
            box-shadow: 0 4px 20px rgba(239, 68, 68, 0.4);
        }
        #qs-trigger-btn svg {
            width: 24px;
            height: 24px;
            stroke: white;
            fill: none;
            transition: transform 0.25s;
        }
        #qs-trigger-btn.qs-open svg {
            transform: rotate(90deg);
        }

        #qs-popup {
            position: fixed;
            bottom: 92px;
            right: 28px;
            width: 380px;
            max-height: 540px;
            background: var(--qs-bg-panel);
            backdrop-filter: blur(18px) saturate(140%);
            -webkit-backdrop-filter: blur(18px) saturate(140%);
            border-radius: 18px;
            box-shadow: 0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px var(--qs-border);
            z-index: 2147483646;
            display: none;
            flex-direction: column;
            overflow: hidden;
            animation: qsSlideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1);
            font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: var(--qs-text-primary);
            pointer-events: auto;
            user-select: none;
        }
        #qs-popup.qs-visible {
            display: flex;
        }
        @keyframes qsSlideUp {
            from { opacity: 0; transform: translateY(14px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        .qs-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid var(--qs-border);
            background: var(--qs-bg-surface);
        }
        .qs-header-title {
            font-size: 15px;
            font-weight: 700;
            color: var(--qs-text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .qs-header-title svg {
            width: 16px;
            height: 16px;
            color: var(--qs-accent);
        }
        .qs-header-title .qs-badge {
            font-size: 10px;
            background: var(--qs-accent-soft);
            color: var(--qs-accent);
            padding: 2px 7px;
            border-radius: 6px;
            font-weight: 700;
            letter-spacing: 0.3px;
        }
        .qs-close-btn {
            width: 28px;
            height: 28px;
            border-radius: 8px;
            border: none;
            background: transparent;
            color: var(--qs-text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
        }
        .qs-close-btn svg { width: 15px; height: 15px; }
        .qs-close-btn:hover {
            background: var(--qs-border-soft);
            color: var(--qs-text-primary);
        }

        .qs-tabs {
            display: flex;
            background: var(--qs-bg-surface);
            border-bottom: 1px solid var(--qs-border);
            padding: 0 8px;
        }
        .qs-tab {
            flex: 1;
            padding: 10px 12px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--qs-text-secondary);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .qs-tab svg { width: 14px; height: 14px; }
        .qs-tab:hover {
            color: var(--qs-text-primary);
        }
        .qs-tab.qs-active {
            color: var(--qs-text-primary);
            border-bottom-color: var(--qs-accent);
        }
        .qs-tab .qs-tab-count {
            font-size: 10px;
            background: var(--qs-border-soft);
            color: var(--qs-text-secondary);
            padding: 1px 6px;
            border-radius: 8px;
            min-width: 18px;
            text-align: center;
        }
        .qs-tab.qs-active .qs-tab-count {
            background: var(--qs-accent);
            color: #2a1608;
        }

        .qs-search {
            padding: 10px 12px 6px;
        }
        .qs-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .qs-search-wrap svg {
            position: absolute;
            left: 11px;
            width: 14px;
            height: 14px;
            color: var(--qs-text-muted);
            pointer-events: none;
        }
        .qs-search input {
            width: 100%;
            padding: 8px 12px 8px 32px;
            border-radius: 9px;
            border: 1px solid var(--qs-border);
            background: var(--qs-bg-input);
            color: var(--qs-text-primary);
            font-size: 13px;
            outline: none;
            transition: box-shadow 0.15s, border-color 0.15s;
            box-sizing: border-box;
        }
        .qs-search input::placeholder {
            color: var(--qs-text-muted);
        }
        .qs-search input:focus {
            border-color: var(--qs-accent);
            box-shadow: 0 0 0 3px var(--qs-accent-soft);
        }

        .qs-content {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 8px;
            min-height: 200px;
            max-height: 360px;
        }
        .qs-content::-webkit-scrollbar { width: 6px; }
        .qs-content::-webkit-scrollbar-track { background: transparent; }
        .qs-content::-webkit-scrollbar-thumb {
            background: #4e5058;
            border-radius: 3px;
        }
        .qs-content::-webkit-scrollbar-thumb:hover { background: #6d6f78; }

        .qs-sticker-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(\${stickerMin}px, 1fr));
            max-width: calc(\${stickerMin}px * \${MAX_COLUMNS} + 6px * (\${MAX_COLUMNS} - 1));
            margin: 0 auto;
            gap: 6px;
            padding: 4px;
        }
        .qs-sticker-item {
            aspect-ratio: 1;
            border-radius: 11px;
            overflow: hidden;
            cursor: pointer;
            background: var(--qs-bg-input);
            border: 2px solid transparent;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }
        .qs-sticker-item:hover {
            border-color: var(--qs-accent);
            transform: scale(1.07);
            z-index: 2;
            box-shadow: 0 4px 16px rgba(255, 122, 69, 0.28);
        }
        .qs-sticker-item:active { transform: scale(0.96); }
        .qs-sticker-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .qs-sticker-item .qs-sticker-name {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 4px 6px;
            background: linear-gradient(transparent, rgba(0,0,0,0.78));
            color: #fff;
            font-size: 9px;
            font-weight: 600;
            text-align: center;
            opacity: 0;
            transition: opacity 0.15s;
            text-overflow: ellipsis;
            overflow: hidden;
            white-space: nowrap;
        }
        .qs-sticker-item:hover .qs-sticker-name { opacity: 1; }

        .qs-template-item {
            display: flex;
            align-items: center;
            padding: 10px 14px;
            margin: 3px 4px;
            border-radius: 11px;
            cursor: pointer;
            color: var(--qs-text-primary);
            font-size: 14px;
            background: var(--qs-bg-input);
            transition: all 0.15s;
            gap: 10px;
            border: 1px solid transparent;
        }
        .qs-template-item:hover {
            background: var(--qs-border-soft);
            border-color: var(--qs-accent);
            transform: translateX(3px);
        }
        .qs-template-item:active { transform: translateX(1px) scale(0.99); }
        .qs-template-icon {
            width: 30px;
            height: 30px;
            border-radius: 9px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            flex-shrink: 0;
        }
        .qs-template-icon svg { width: 15px; height: 15px; }
        .qs-template-text {
            flex: 1;
            line-height: 1.4;
        }
        .qs-template-category {
            font-size: 10px;
            color: var(--qs-text-secondary);
            background: var(--qs-border-soft);
            padding: 2px 7px;
            border-radius: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }

        .qs-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            color: var(--qs-text-secondary);
            text-align: center;
        }
        .qs-empty svg {
            width: 34px;
            height: 34px;
            color: var(--qs-text-muted);
            margin-bottom: 12px;
        }
        .qs-empty-text {
            font-size: 14px;
            font-weight: 600;
            color: var(--qs-text-secondary);
            margin-bottom: 4px;
        }
        .qs-empty-sub {
            font-size: 12px;
            color: var(--qs-text-muted);
        }

        .qs-toast {
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: var(--qs-success);
            color: white;
            padding: 10px 16px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            z-index: 100001;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
            box-shadow: 0 4px 20px rgba(45, 212, 167, 0.35);
            font-family: 'gg sans', 'Noto Sans', sans-serif;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .qs-toast svg { width: 15px; height: 15px; flex-shrink: 0; }
        .qs-toast.qs-toast-show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .qs-toast.qs-toast-error {
            background: var(--qs-danger);
            box-shadow: 0 4px 20px rgba(239, 68, 68, 0.35);
        }

        .qs-footer {
            padding: 8px 12px;
            border-top: 1px solid var(--qs-border);
            background: var(--qs-bg-surface);
        }
        .qs-footer-text {
            font-size: 11px;
            color: var(--qs-text-muted);
            text-align: center;
        }
        .qs-footer-text kbd {
            background: var(--qs-bg-input);
            padding: 1px 5px;
            border-radius: 4px;
            font-family: 'gg sans', monospace;
            font-size: 10px;
            color: var(--qs-text-secondary);
            border: 1px solid var(--qs-border);
        }
    \`;

    // ═══ HELPERS ═══

    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Find the Slate editor instance by traversing React fiber tree
     * Discord stores the Slate editor in React component props/state
     */
    function findSlateEditor(element) {
        try {
            // Find React fiber key on the DOM element
            const fiberKey = Object.keys(element).find(k =>
                k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
            );
            if (!fiberKey) return null;

            let fiber = element[fiberKey];
            let maxDepth = 40;

            while (fiber && maxDepth-- > 0) {
                // Check memoizedProps for editor
                const props = fiber.memoizedProps;
                if (props) {
                    // Slate's Editable component passes editor via context/props
                    if (props.editor && typeof props.editor.insertText === 'function') {
                        return props.editor;
                    }
                    if (props.node && typeof props.node.insertText === 'function') {
                        return props.node;
                    }
                }

                // Check pendingProps
                const pending = fiber.pendingProps;
                if (pending) {
                    if (pending.editor && typeof pending.editor.insertText === 'function') {
                        return pending.editor;
                    }
                }

                // Check stateNode for class components
                if (fiber.stateNode && fiber.stateNode !== element) {
                    const sn = fiber.stateNode;
                    if (sn.editor && typeof sn.editor.insertText === 'function') {
                        return sn.editor;
                    }
                    // Check state
                    if (sn.state && sn.state.editor && typeof sn.state.editor.insertText === 'function') {
                        return sn.state.editor;
                    }
                }

                // Check memoizedState (hooks)
                let hookState = fiber.memoizedState;
                let hookDepth = 20;
                while (hookState && hookDepth-- > 0) {
                    const q = hookState.queue;
                    const memo = hookState.memoizedState;
                    if (memo && typeof memo === 'object' && !Array.isArray(memo)) {
                        if (typeof memo.insertText === 'function') return memo;
                        if (memo.editor && typeof memo.editor.insertText === 'function') return memo.editor;
                    }
                    // Check array memoizedState (useRef, etc.)
                    if (Array.isArray(memo)) {
                        for (const item of memo) {
                            if (item && typeof item === 'object' && typeof item.insertText === 'function') {
                                return item;
                            }
                        }
                    }
                    hookState = hookState.next;
                }

                fiber = fiber.return;
            }
        } catch (e) {
            console.error('[QuickSend] Error finding Slate editor:', e);
        }
        return null;
    }

    /**
     * Place cursor at the end of Slate document using Slate's own API
     */
    function selectEndOfSlateDoc(slateEditor) {
        try {
            if (!slateEditor.children || slateEditor.children.length === 0) return;

            // Navigate to last leaf text node
            let node = slateEditor;
            let path = [];
            while (node.children && node.children.length > 0) {
                const lastIdx = node.children.length - 1;
                path.push(lastIdx);
                node = node.children[lastIdx];
            }

            const offset = (node.text || '').length;
            const point = { path, offset };
            slateEditor.selection = { anchor: { ...point }, focus: { ...point } };
        } catch (e) {
            console.warn('[QuickSend] Could not set Slate selection:', e);
        }
    }

    /**
     * Clear any existing text in the Slate editor before inserting
     */
    function clearSlateEditor(slateEditor) {
        try {
            if (!slateEditor.children || slateEditor.children.length === 0) return;

            // Check if there's actual text content
            const hasText = slateEditor.children.some(child => {
                if (child.text && child.text.length > 0) return true;
                if (child.children) {
                    return child.children.some(c => c.text && c.text.length > 0);
                }
                return false;
            });

            if (!hasText) return;

            // Select all and delete
            const start = { path: [0, 0], offset: 0 };
            let endNode = slateEditor;
            let endPath = [];
            while (endNode.children && endNode.children.length > 0) {
                const lastIdx = endNode.children.length - 1;
                endPath.push(lastIdx);
                endNode = endNode.children[lastIdx];
            }
            const end = { path: endPath, offset: (endNode.text || '').length };

            slateEditor.selection = { anchor: start, focus: end };
            if (typeof slateEditor.deleteFragment === 'function') {
                slateEditor.deleteFragment();
            }
        } catch (e) {}
    }

    /**
     * @param {HTMLElement} editorEl
     * @param {string} text
     * Insert text into Slate editor using Slate's own API
     */
    function insertTextToSlateEditor(editorEl, text) {
        editorEl.focus();

        // ═══ PRIMARY: Use Slate Editor API directly ═══
        const slateEditor = findSlateEditor(editorEl);
        if (slateEditor) {
            try {
                console.log('[QuickSend] Found Slate editor instance, using native API');

                // Clear any ghost text from previous attempts
                clearSlateEditor(slateEditor);

                // Set cursor position to end
                selectEndOfSlateDoc(slateEditor);

                // Use Slate's insertText — this updates Slate's internal model
                slateEditor.insertText(text);

                // Force onChange if available
                if (typeof slateEditor.onChange === 'function') {
                    slateEditor.onChange();
                }

                return 'slate';
            } catch (e) {
                console.warn('[QuickSend] Slate API insert failed:', e);
            }
        } else {
            console.warn('[QuickSend] Slate editor instance not found, trying fallbacks');
        }

        // ═══ FALLBACK 1: execCommand (might cause ghost text but worth trying) ═══
        try {
            const sel = window.getSelection();
            const range = document.createRange();
            // Find deepest text node for proper Slate-compatible selection
            const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null, false);
            let lastTextNode = null;
            while (walker.nextNode()) lastTextNode = walker.currentNode;

            if (lastTextNode) {
                range.setStart(lastTextNode, lastTextNode.length);
                range.collapse(true);
            } else {
                range.selectNodeContents(editorEl);
                range.collapse(false);
            }
            sel.removeAllRanges();
            sel.addRange(range);

            const ok = document.execCommand('insertText', false, text);
            if (ok) return 'execCommand';
        } catch (e) {}

        // ═══ FALLBACK 2: Synthetic InputEvent ═══
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            editorEl.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: text,
                dataTransfer: dt,
                isComposing: false,
                composed: true
            }));
            return 'inputEvent';
        } catch (e) {}

        return false;
    }

    /**
     * @param {HTMLElement} editorEl
     * Press Enter to submit message — uses Slate API if possible
     */
    function pressEnterOnEditor(editorEl) {
        editorEl.focus();
        const opts = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
        };
        editorEl.dispatchEvent(new KeyboardEvent('keydown', opts));
        editorEl.dispatchEvent(new KeyboardEvent('keypress', opts));
        editorEl.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    /**
     * 🔧 IMPROVED: Lebih reliable dalam mencari editor Slate Discord
     * Dengan multiple fallback selectors
     */
    function getComposerElement() {
        return (
            document.querySelector('[role="textbox"][data-slate-editor="true"]') ||
            document.querySelector('[class*="slateTextArea"]') ||
            document.querySelector('[contenteditable="true"][role="textbox"]') ||
            document.querySelector('[class*="channelTextArea"] [role="textbox"]') ||
            document.querySelector('[class*="PrivateChannel"] [role="textbox"]') ||
            document.querySelector('[role="textbox"]') ||
            document.querySelector('[contenteditable="true"]')
        );
    }

    /**
     * 🔧 HOTFIX: Temukan send button di Discord (lebih aggressive)
     * Multiple selector untuk handle berbagai Discord UI variant
     */
    function getSendButton() {
        const btn = (
            // Method 1: Form submit button (most reliable)
            document.querySelector('form [type="submit"]') ||
            document.querySelector('[class*="messageForm"] [type="submit"]') ||
            document.querySelector('[class*="channelTextArea"] [type="submit"]') ||
            
            // Method 2: Aria-label based
            document.querySelector('[aria-label*="Send"][role="button"]') ||
            document.querySelector('[aria-label="Send a message"][role="button"]') ||
            document.querySelector('[aria-label*="Send"]') ||
            
            // Method 3: Button dalam form area
            document.querySelector('[class*="form"] button[type="submit"]') ||
            document.querySelector('[class*="buttonContainer"] [type="submit"]') ||
            
            // Method 4: Generic (last resort)
            document.querySelector('button[type="submit"]') ||
            document.querySelector('[type="submit"]')
        );
        
        if (btn) {
            console.log('[QuickSend] Send button found:', btn);
        } else {
            console.warn('[QuickSend] Send button NOT found - will use Enter key fallback');
        }
        
        return btn;
    }

    // ═══ HTML ═══
    function createUI() {
        const root = document.createElement('div');
        root.id = 'qs-root';
        document.body.appendChild(root);

        const styleEl = document.createElement('style');
        styleEl.id = 'qs-styles';
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        const triggerBtn = document.createElement('button');
        triggerBtn.id = 'qs-trigger-btn';
        triggerBtn.title = 'Quick Send (Stiker & Template)';
        triggerBtn.innerHTML = ICONS.zap;
        root.appendChild(triggerBtn);

        const popup = document.createElement('div');
        popup.id = 'qs-popup';
        popup.innerHTML = \`
            <div class="qs-header">
                <div class="qs-header-title">
                    \${ICONS.zap}
                    Quick Send
                    <span class="qs-badge">v1.2</span>
                </div>
                <button class="qs-close-btn" id="qs-close-btn" title="Tutup">\${ICONS.close}</button>
            </div>
            <div class="qs-tabs">
                <button class="qs-tab qs-active" data-tab="stickers">
                    \${ICONS.image}
                    Stiker
                    <span class="qs-tab-count" id="qs-sticker-count">\${STICKERS.length}</span>
                </button>
                <button class="qs-tab" data-tab="templates">
                    \${ICONS.note}
                    Template
                    <span class="qs-tab-count" id="qs-template-count">\${TEMPLATES.length}</span>
                </button>
            </div>
            <div class="qs-search">
                <div class="qs-search-wrap">
                    \${ICONS.search}
                    <input type="text" id="qs-search-input" placeholder="Cari stiker..." autocomplete="off" />
                </div>
            </div>
            <div class="qs-content" id="qs-content"></div>
            <div class="qs-footer">
                <div class="qs-footer-text">
                    Tekan <kbd>\${HOTKEY_DISPLAY}</kbd> untuk toggle • Langsung terkirim tanpa Enter
                </div>
            </div>
        \`;
        root.appendChild(popup);

        const toast = document.createElement('div');
        toast.className = 'qs-toast';
        toast.id = 'qs-toast';
        root.appendChild(toast);

        return { triggerBtn, popup, toast };
    }

    // ═══ LOGIC ═══
    const { triggerBtn, popup, toast } = createUI();
    let currentTab = 'stickers';
    let isOpen = false;
    let toastTimer = null;
    let isSending = false;

    function togglePopup() {
        isOpen = !isOpen;
        popup.classList.toggle('qs-visible', isOpen);
        triggerBtn.classList.toggle('qs-open', isOpen);

        if (isOpen) {
            renderContent();
            const searchInput = document.getElementById('qs-search-input');
            searchInput.value = '';
            searchInput.focus();
        }
    }

    function closePopup() {
        isOpen = false;
        popup.classList.remove('qs-visible');
        triggerBtn.classList.remove('qs-open');
    }

    function showToast(message, isError) {
        const toastEl = document.getElementById('qs-toast');
        const icon = isError ? ICONS.alert : ICONS.check;
        toastEl.innerHTML = icon + '<span>' + escapeHtml(message) + '</span>';
        toastEl.classList.toggle('qs-toast-error', !!isError);
        toastEl.classList.add('qs-toast-show');

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastEl.classList.remove('qs-toast-show');
            toastTimer = null;
        }, 2500);
    }

    function renderContent(filter) {
        const content = document.getElementById('qs-content');
        const filterLower = (filter || '').toLowerCase();

        if (currentTab === 'stickers') {
            const count = renderStickers(content, filterLower);
            document.getElementById('qs-sticker-count').textContent = count;
        } else {
            const count = renderTemplates(content, filterLower);
            document.getElementById('qs-template-count').textContent = count;
        }
    }

    function renderStickers(container, filter) {
        const filtered = STICKERS.filter(s =>
            !filter || s.name.toLowerCase().includes(filter)
        );

        if (filtered.length === 0) {
            container.innerHTML = \`
                <div class="qs-empty">
                    \${ICONS.image}
                    <div class="qs-empty-text">\${filter ? 'Tidak ditemukan' : 'Belum ada stiker'}</div>
                    <div class="qs-empty-sub">\${filter ? 'Coba kata kunci lain' : 'Tambahkan gambar ke folder plugins/quick-send/stickers/'}</div>
                </div>
            \`;
            return 0;
        }

        let html = '<div class="qs-sticker-grid">';
        for (const sticker of filtered) {
            const safeName = escapeHtml(sticker.name);
            const safeFilename = escapeHtml(sticker.filename);
            html += \`
                <div class="qs-sticker-item" data-sticker="\${safeFilename}" title="\${safeName}">
                    <img src="data:\${sticker.mimeType};base64,\${sticker.base64}" alt="\${safeName}" loading="lazy" />
                    <div class="qs-sticker-name">\${safeName}</div>
                </div>
            \`;
        }
        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.qs-sticker-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                sendSticker(item.dataset.sticker);
            });
        });

        return filtered.length;
    }

    function renderTemplates(container, filter) {
        const filtered = TEMPLATES.filter(t =>
            !filter || t.text.toLowerCase().includes(filter) ||
            (t.category && t.category.toLowerCase().includes(filter))
        );

        if (filtered.length === 0) {
            container.innerHTML = \`
                <div class="qs-empty">
                    \${ICONS.note}
                    <div class="qs-empty-text">\${filter ? 'Tidak ditemukan' : 'Belum ada template'}</div>
                    <div class="qs-empty-sub">\${filter ? 'Coba kata kunci lain' : 'Tambahkan template di config plugin'}</div>
                </div>
            \`;
            return 0;
        }

        let html = '';
        for (const tmpl of filtered) {
            const category = tmpl.category || '';
            const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
            const initial = category ? escapeHtml(category.charAt(0).toUpperCase()) : '';
            const badge = initial
                ? '<div class="qs-template-icon" style="background:' + color + '">' + initial + '</div>'
                : '<div class="qs-template-icon" style="background:' + color + '">' + ICONS.note + '</div>';

            html += \`
                <div class="qs-template-item" data-text="\${escapeHtml(tmpl.text)}">
                    \${badge}
                    <div class="qs-template-text">\${escapeHtml(tmpl.text)}</div>
                    \${category ? '<span class="qs-template-category">' + escapeHtml(category) + '</span>' : ''}
                </div>
            \`;
        }
        container.innerHTML = html;

        container.querySelectorAll('.qs-template-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                sendTemplate(item.dataset.text);
            });
        });

        return filtered.length;
    }

    // ═══ SEND FUNCTIONS [IMPROVED] ═══

    /**
     * 🔧 IMPROVED: Send sticker dengan paste yang lebih reliable
     */
    function sendSticker(filename) {
        const sticker = STICKERS.find(s => s.filename === filename);
        if (!sticker) {
            showToast('Stiker tidak ditemukan', true);
            return;
        }

        try {
            const byteString = atob(sticker.base64);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            const file = new File([ab], sticker.filename, { type: sticker.mimeType });
            const composer = getComposerElement();

            if (!composer) {
                showToast('Kolom chat tidak ditemukan — buka channel dulu', true);
                return;
            }

            composer.focus();

            const dt = new DataTransfer();
            dt.items.add(file);

            // Trigger paste dengan file binary yang sebenarnya
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            });
            const handled = composer.dispatchEvent(pasteEvent);

            showToast('Stiker siap dikirim — klik Send di preview upload');
            closePopup();

        } catch (err) {
            console.error('[QuickSend] Failed to send sticker:', err);
            showToast('Gagal mengirim stiker: ' + err.message, true);
        }
    }

    function sendTemplate(text) {
        if (isSending) return;
        isSending = true;

        try {
            const editor = getComposerElement();
            if (!editor) {
                showToast('Kolom chat tidak ditemukan — buka channel dulu', true);
                isSending = false;
                return;
            }

            closePopup();

            // Delay to let popup close and focus return to Discord
            setTimeout(() => {
                editor.focus();

                // Insert text using Slate API (primary) or fallbacks
                const method = insertTextToSlateEditor(editor, text);
                console.log('[QuickSend] Text inserted via:', method);

                // Wait for Slate to process
                const delay = method === 'slate' ? 100 : 250;

                setTimeout(() => {
                    // Press Enter to send
                    pressEnterOnEditor(editor);

                    if (method === 'slate') {
                        showToast('Template terkirim!');
                    } else if (method) {
                        showToast('Template dikirim (fallback mode)');
                    } else {
                        showToast('Gagal insert teks — coba ketik manual', true);
                    }

                    setTimeout(() => {
                        isSending = false;
                    }, 300);
                }, delay);
            }, 150);

        } catch (err) {
            console.error('[QuickSend] Failed to send template:', err);
            showToast('Gagal mengirim template: ' + err.message, true);
            isSending = false;
        }
    }

    // ═══ EVENT HANDLERS ═══

    triggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopup();
    });
    
    popup.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    document.getElementById('qs-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        closePopup();
    });

    document.querySelectorAll('.qs-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.qs-tab').forEach(t => t.classList.remove('qs-active'));
            tab.classList.add('qs-active');
            currentTab = tab.dataset.tab;
            const searchInput = document.getElementById('qs-search-input');
            searchInput.value = '';
            renderContent();
            searchInput.placeholder = currentTab === 'stickers' ? 'Cari stiker...' : 'Cari template...';
        });
    });

    document.getElementById('qs-search-input').addEventListener('input', (e) => {
        renderContent(e.target.value);
    });
    
    document.getElementById('qs-search-input').addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    document.getElementById('qs-search-input').addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) {
            closePopup();
            return;
        }

        const parts = HOTKEY.toLowerCase().split('+').map(p => p.trim());
        const needCtrl = parts.includes('ctrl');
        const needShift = parts.includes('shift');
        const needAlt = parts.includes('alt');
        const key = parts.find(p => !['ctrl', 'shift', 'alt'].includes(p));

        if (
            key &&
            e.key.toLowerCase() === key &&
            e.ctrlKey === needCtrl &&
            e.shiftKey === needShift &&
            e.altKey === needAlt
        ) {
            e.preventDefault();
            togglePopup();
        }
    });

    renderContent();

    console.log('[QuickSend v1.2] Plugin loaded — ' + STICKERS.length + ' stickers, ' + TEMPLATES.length + ' templates');
})();`;
    }
}