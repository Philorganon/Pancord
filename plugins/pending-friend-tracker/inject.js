(function() {
    'use strict';

    if (window.__pendingFriendTrackerInjected) return;
    window.__pendingFriendTrackerInjected = true;

    const CONFIG = window.__PENDING_FRIEND_TRACKER_CONFIG__ || {
        enabled: true,
        hotkey: "ctrl+shift+p",
        alertThresholdDays: 7,
        showBadgeInFriendsList: true,
        showFloatingButton: true,
        autoRefreshIntervalSec: 20
    };
    const HOTKEY_DISPLAY = CONFIG.hotkey ? CONFIG.hotkey.toUpperCase() : "CTRL + SHIFT + P";
    const STORAGE_KEY = '__discord_pending_friends_tracker_v1';

    // Relationship Types in Discord
    const REL_TYPES = {
        NONE: 0,
        FRIEND: 1,
        BLOCKED: 2,
        PENDING_INCOMING: 3,
        PENDING_OUTGOING: 4,
        IMPLICIT: 5
    };

    const ICONS = {
        clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        userCheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>',
        inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
        send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
        chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
        external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
    };

    const STYLES = `
        #pft-root {
            --pft-bg-panel: rgba(18, 19, 23, 0.96);
            --pft-bg-card: rgba(28, 30, 36, 0.88);
            --pft-bg-card-hover: rgba(38, 41, 50, 0.98);
            --pft-bg-input: #101114;
            --pft-border: rgba(255, 255, 255, 0.08);
            --pft-border-highlight: rgba(88, 101, 242, 0.45);
            --pft-text-primary: #f2f3f5;
            --pft-text-secondary: #949ba4;
            --pft-text-muted: #646872;
            --pft-accent: #5865f2;
            --pft-accent-hover: #4752c4;
            --pft-danger: #f23f43;
            --pft-danger-soft: rgba(242, 63, 67, 0.16);
            --pft-warning: #f0b232;
            --pft-warning-soft: rgba(240, 178, 50, 0.16);
            --pft-success: #23a55a;
            --pft-success-soft: rgba(35, 165, 90, 0.16);
            font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        #pft-trigger-btn {
            position: fixed;
            bottom: 24px;
            right: 84px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #5865f2;
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border: none;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
            z-index: 999998;
            transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.15s ease, box-shadow 0.2s ease;
        }
        #pft-trigger-btn:hover {
            transform: scale(1.1);
            background: #4752c4;
            box-shadow: 0 6px 20px rgba(88, 101, 242, 0.45);
        }
        #pft-trigger-btn:active {
            transform: scale(0.95);
        }
        #pft-trigger-btn.pft-open {
            background: #4e5058;
            transform: rotate(45deg);
        }
        #pft-trigger-btn svg {
            width: 22px;
            height: 22px;
            pointer-events: none;
        }
        .pft-badge-counter {
            position: absolute;
            top: -4px;
            right: -4px;
            background: #f23f43;
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 10px;
            border: 2px solid #18191c;
            min-width: 18px;
            text-align: center;
            pointer-events: none;
        }

        #pft-popup {
            position: fixed;
            bottom: 80px;
            right: 84px;
            width: 480px;
            max-width: calc(100vw - 80px);
            height: 600px;
            max-height: calc(100vh - 110px);
            background: rgba(18, 19, 23, 0.96);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 14px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
            display: flex;
            flex-direction: column;
            z-index: 999999;
            opacity: 0;
            pointer-events: none;
            transform: translateY(16px) scale(0.96);
            transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            overflow: hidden;
            color: #f2f3f5;
        }
        #pft-popup.pft-visible {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0) scale(1);
        }

        .pft-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(255, 255, 255, 0.02);
        }
        .pft-header-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 15px;
            font-weight: 700;
            color: #f2f3f5;
            letter-spacing: -0.2px;
        }
        .pft-header-title svg {
            width: 20px;
            height: 20px;
            color: #5865f2;
        }
        .pft-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .pft-icon-btn {
            background: transparent;
            border: none;
            color: #949ba4;
            width: 30px;
            height: 30px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .pft-icon-btn:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #f2f3f5;
        }
        .pft-icon-btn svg {
            width: 16px;
            height: 16px;
        }
        .pft-icon-btn.pft-spinning svg {
            animation: pft-spin 0.8s linear infinite;
        }
        @keyframes pft-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .pft-tabs {
            display: flex;
            padding: 8px 14px;
            gap: 6px;
            background: rgba(0, 0, 0, 0.15);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .pft-tab {
            flex: 1;
            padding: 7px 10px;
            border-radius: 8px;
            background: transparent;
            border: none;
            color: #949ba4;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.15s ease;
        }
        .pft-tab:hover {
            background: rgba(255, 255, 255, 0.04);
            color: #dbdee1;
        }
        .pft-tab.pft-active {
            background: #5865f2;
            color: #ffffff;
            box-shadow: 0 2px 8px rgba(88, 101, 242, 0.35);
        }
        .pft-tab svg {
            width: 15px;
            height: 15px;
        }
        .pft-tab-badge {
            background: rgba(0, 0, 0, 0.25);
            padding: 1px 6px;
            border-radius: 10px;
            font-size: 11px;
        }

        .pft-controls {
            padding: 10px 16px;
            display: flex;
            gap: 10px;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .pft-search-box {
            position: relative;
            flex: 1;
        }
        .pft-search-box svg {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            color: #646872;
            pointer-events: none;
        }
        .pft-search-box input {
            width: 100%;
            background: #101114;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 6px 10px 6px 30px;
            font-size: 12px;
            color: #f2f3f5;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.15s ease;
        }
        .pft-search-box input:focus {
            border-color: #5865f2;
        }
        .pft-sort-select {
            background: #101114;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 6px 8px;
            font-size: 12px;
            color: #dbdee1;
            outline: none;
            cursor: pointer;
        }

        .pft-list-container {
            flex: 1;
            overflow-y: auto;
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .pft-list-container::-webkit-scrollbar {
            width: 6px;
        }
        .pft-list-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15);
            border-radius: 3px;
        }

        .pft-user-card {
            background: rgba(28, 30, 36, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 10px 12px;
            display: flex;
            align-items: center;
            gap: 12px;
            transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease;
        }
        .pft-user-card:hover {
            background: rgba(38, 41, 50, 0.98);
            border-color: rgba(88, 101, 242, 0.35);
            transform: translateY(-1px);
        }
        .pft-user-avatar {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: #2b2d31;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            font-size: 16px;
            font-weight: 700;
            color: #dbdee1;
            flex-shrink: 0;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .pft-user-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .pft-user-info {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .pft-user-name-row {
            display: flex;
            align-items: center;
            gap: 6px;
            overflow: hidden;
        }
        .pft-user-display-name {
            font-size: 13.5px;
            font-weight: 700;
            color: #f2f3f5;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .pft-user-username {
            font-size: 11.5px;
            color: #949ba4;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .pft-user-meta {
            display: flex;
            align-items: center;
            gap: 7px;
            flex-wrap: wrap;
        }
        .pft-duration-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 6px;
        }
        .pft-duration-pill svg {
            width: 12px;
            height: 12px;
        }
        .pft-duration-incoming {
            background: rgba(35, 165, 90, 0.16);
            color: #23a55a;
            border: 1px solid rgba(35, 165, 90, 0.35);
        }
        .pft-duration-outgoing {
            background: rgba(88, 101, 242, 0.16);
            color: #8390fa;
            border: 1px solid rgba(88, 101, 242, 0.35);
        }
        .pft-duration-warning {
            background: rgba(240, 178, 50, 0.2);
            color: #f0b232;
            border: 1px solid rgba(240, 178, 50, 0.4);
        }
        .pft-duration-alert {
            background: rgba(242, 63, 67, 0.22);
            color: #f23f43;
            border: 1px solid rgba(242, 63, 67, 0.45);
            animation: pft-pulse 2s infinite ease-in-out;
        }
        @keyframes pft-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.75; }
        }
        .pft-date-text {
            font-size: 10.5px;
            color: #949ba4;
        }
        .pft-verified-badge {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            background: rgba(35, 165, 90, 0.16);
            color: #23a55a;
            border: 1px solid rgba(35, 165, 90, 0.3);
            border-radius: 4px;
            padding: 1px 5px;
            font-size: 10px;
            font-weight: 700;
        }
        .pft-unverified-badge {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            background: rgba(240, 178, 50, 0.16);
            color: #f0b232;
            border: 1px solid rgba(240, 178, 50, 0.3);
            border-radius: 4px;
            padding: 1px 5px;
            font-size: 10px;
            font-weight: 600;
        }

        .pft-card-actions {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .pft-action-btn {
            background: transparent;
            border: none;
            color: #80848e;
            width: 26px;
            height: 26px;
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.12s ease;
        }
        .pft-action-btn:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #dbdee1;
        }
        .pft-action-btn svg {
            width: 14px;
            height: 14px;
        }

        .pft-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 50px 20px;
            text-align: center;
            color: #646872;
        }
        .pft-empty svg {
            width: 48px;
            height: 48px;
            margin-bottom: 12px;
            opacity: 0.5;
            color: #5865f2;
        }
        .pft-empty-title {
            font-size: 14px;
            font-weight: 600;
            color: #949ba4;
            margin-bottom: 4px;
        }
        .pft-empty-sub {
            font-size: 12px;
            margin-bottom: 14px;
        }
        .pft-scan-btn {
            background: #5865f2;
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: background 0.15s ease;
        }
        .pft-scan-btn:hover {
            background: #4752c4;
        }

        .pft-footer {
            padding: 10px 16px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(0, 0, 0, 0.2);
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            color: #646872;
        }
        .pft-footer kbd {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 4px;
            padding: 1px 5px;
            font-size: 10px;
            color: #dbdee1;
            font-family: inherit;
        }

        .pft-toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(30px);
            background: #23a55a;
            color: #fff;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            opacity: 0;
            pointer-events: none;
            transition: all 0.2s ease;
            z-index: 1000000;
        }
        .pft-toast.pft-toast-show {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
            pointer-events: auto;
        }
        .pft-toast.pft-toast-error {
            background: #f23f43;
        }
        .pft-toast svg {
            width: 15px;
            height: 15px;
        }

        /* Friends List Injected Badges */
        .pft-injected-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 4px;
            margin-left: 8px;
            vertical-align: middle;
            transition: all 0.15s ease;
            user-select: none;
            letter-spacing: -0.1px;
        }
        .pft-badge-incoming {
            background: rgba(35, 165, 90, 0.18);
            color: #23a55a;
            border: 1px solid rgba(35, 165, 90, 0.35);
        }
        .pft-badge-outgoing {
            background: rgba(88, 101, 242, 0.18);
            color: #8390fa;
            border: 1px solid rgba(88, 101, 242, 0.35);
        }
        .pft-badge-warning {
            background: rgba(240, 178, 50, 0.2);
            color: #f0b232;
            border: 1px solid rgba(240, 178, 50, 0.4);
        }
        .pft-badge-old {
            background: rgba(242, 63, 67, 0.22);
            color: #f23f43;
            border: 1px solid rgba(242, 63, 67, 0.45);
        }

        .pft-stats-panel {
            padding: 10px 4px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .pft-stat-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .pft-stat-card {
            background: rgba(28, 30, 36, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 12px;
            text-align: center;
        }
        .pft-stat-val {
            font-size: 22px;
            font-weight: 800;
            color: #f2f3f5;
            margin-top: 4px;
        }
        .pft-stat-label {
            font-size: 11.5px;
            color: #949ba4;
            font-weight: 600;
        }
        .pft-stat-highlight {
            background: rgba(28, 30, 36, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 12px;
            font-size: 12.5px;
        }
    `;

    // ═══ LOCAL PERSISTENCE ═══
    const _memoryStorage = (typeof window !== 'undefined' && window.__pft_memory_store) ? window.__pft_memory_store : {};
    if (typeof window !== 'undefined') window.__pft_memory_store = _memoryStorage;

    function getStorage() {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage;
            }
        } catch {}
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage;
            }
        } catch {}
        return null;
    }

    function getStoredData() {
        try {
            const storage = getStorage();
            if (storage) {
                const raw = storage.getItem(STORAGE_KEY);
                if (raw) return JSON.parse(raw);
            }
        } catch {}
        return _memoryStorage[STORAGE_KEY] || {};
    }

    function saveStoredData(data) {
        _memoryStorage[STORAGE_KEY] = data;
        try {
            const storage = getStorage();
            if (storage) {
                storage.setItem(STORAGE_KEY, JSON.stringify(data));
            }
        } catch {}
    }

    // Purge bad stale entries that lack real server timestamps
    function purgeStaleUnverifiedEntries() {
        const stored = getStoredData();
        let changed = false;
        for (const k in stored) {
            if (!stored[k].since && !stored[k].customDate) {
                delete stored[k];
                changed = true;
            }
        }
        if (changed) {
            saveStoredData(stored);
        }
    }

    // ═══ DURATION FORMATTER ═══
    function formatDuration(ms) {
        if (ms < 0) ms = 0;
        const totalSeconds = Math.floor(ms / 1000);
        const totalMinutes = Math.floor(totalSeconds / 60);
        const totalHours = Math.floor(totalMinutes / 60);
        const totalDays = Math.floor(totalHours / 24);

        if (totalMinutes < 1) {
            return '< 1 menit lalu';
        }
        if (totalHours < 1) {
            return totalMinutes + ' menit lalu';
        }
        if (totalDays < 1) {
            const remMin = totalMinutes % 60;
            return remMin > 0 ? (totalHours + ' jam ' + remMin + 'm lalu') : (totalHours + ' jam lalu');
        }
        if (totalDays < 7) {
            const remHours = totalHours % 24;
            return remHours > 0 ? (totalDays + ' hari ' + remHours + 'j lalu') : (totalDays + ' hari lalu');
        }
        if (totalDays < 30) {
            const weeks = Math.floor(totalDays / 7);
            const remDays = totalDays % 7;
            return remDays > 0 ? (weeks + ' minggu ' + remDays + 'h lalu') : (weeks + ' minggu lalu');
        }
        if (totalDays < 365) {
            const months = Math.floor(totalDays / 30);
            const remDays = totalDays % 30;
            return remDays > 0 ? (months + ' bulan ' + remDays + 'h lalu') : (months + ' bulan lalu');
        }
        const years = Math.floor(totalDays / 365);
        const remMonths = Math.floor((totalDays % 365) / 30);
        return remMonths > 0 ? (years + ' tahun ' + remMonths + 'bln lalu') : (years + ' tahun lalu');
    }

    function formatDateExact(timestamp) {
        if (!timestamp) return '-';
        try {
            const date = new Date(timestamp);
            return date.toLocaleString('id-ID', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch {
            return new Date(timestamp).toISOString();
        }
    }

    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ═══ DISCORD WEBPACK & TOKEN RESOLUTION ═══
    let RelationshipStore = null;
    let UserStore = null;
    let TokenStore = null;
    let Dispatcher = null;
    let cachedToken = null;

    // Listen for token bridged by Electron main process
    window.__pft_onTokenCaptured = function(token) {
        if (token && typeof token === 'string' && token.length > 20) {
            console.log('[PendingTracker] Token captured via Electron bridge!');
            cachedToken = token;
            tracker.fetchServerTimestamps().then(() => {
                injectFriendsListBadges();
                if (isOpen) renderUI();
            });
        }
    };

    function getDiscordToken() {
        if (cachedToken && cachedToken.length > 20) return cachedToken;
        if (window.__DISCORD_USER_TOKEN__ && typeof window.__DISCORD_USER_TOKEN__ === 'string' && window.__DISCORD_USER_TOKEN__.length > 20) {
            cachedToken = window.__DISCORD_USER_TOKEN__;
            return cachedToken;
        }

        // Webpack extraction
        try {
            if (typeof window.webpackChunkdiscord_app !== 'undefined') {
                let modules = [];
                window.webpackChunkdiscord_app.push([
                    ['pft_tok_' + Math.random().toString(36).slice(2, 6)],
                    {},
                    (e) => {
                        for (const c in e.c) {
                            modules.push(e.c[c]);
                        }
                    }
                ]);

                for (const m of modules) {
                    const exp = m?.exports;
                    if (!exp) continue;
                    const candidates = [exp, exp.default, exp.Z, exp.ZP];
                    for (const c of candidates) {
                        if (!c) continue;
                        if (typeof c.getToken === 'function') {
                            try {
                                const t = c.getToken();
                                if (typeof t === 'string' && t.length > 20) {
                                    cachedToken = t;
                                    return t;
                                }
                            } catch {}
                        }
                    }
                }
            }
        } catch (e) {}

        return null;
    }

    function extractDiscordModules() {
        try {
            if (typeof window.webpackChunkdiscord_app !== 'undefined') {
                let modules = [];
                window.webpackChunkdiscord_app.push([
                    ['pft_mod_' + Math.random().toString(36).slice(2, 6)],
                    {},
                    (e) => {
                        for (const c in e.c) modules.push(e.c[c]);
                    }
                ]);

                for (const m of modules) {
                    const exp = m?.exports;
                    if (!exp) continue;
                    const candidates = [exp, exp.default, exp.Z, exp.ZP];
                    for (const c of candidates) {
                        if (!c) continue;

                        if (!RelationshipStore && (typeof c.getRelationships === 'function' || c.getName?.() === 'RelationshipStore')) {
                            RelationshipStore = c;
                        }

                        if (!UserStore && (typeof c.getUser === 'function' || c.getName?.() === 'UserStore')) {
                            UserStore = c;
                        }

                        if (!Dispatcher && (typeof c.dispatch === 'function' && typeof c.subscribe === 'function')) {
                            Dispatcher = c;
                        }
                    }
                }
            }
        } catch (e) {}
    }

    let dispatcherHooked = false;
    function tryHookDispatcher() {
        if (dispatcherHooked) return true;
        extractDiscordModules();
        if (Dispatcher && typeof Dispatcher.subscribe === 'function') {
            try {
                Dispatcher.subscribe('CONNECTION_OPEN', (action) => {
                    if (action && Array.isArray(action.relationships)) {
                        tracker.processRawRelationships(action.relationships, 'connection_open');
                    }
                    setTimeout(() => {
                        tracker.fetchServerTimestamps();
                        tracker.syncFromStores();
                        injectFriendsListBadges();
                    }, 1500);
                });

                Dispatcher.subscribe('LOAD_RELATIONSHIPS_SUCCESS', (action) => {
                    if (action && Array.isArray(action.relationships)) {
                        tracker.processRawRelationships(action.relationships, 'load_relationships_success');
                    }
                    tracker.handleRelationshipChange();
                });

                Dispatcher.subscribe('RELATIONSHIP_ADD', (action) => {
                    if (action?.relationship) {
                        tracker.processRawRelationships([action.relationship], 'rel_add');
                    } else if (action?.relationships) {
                        tracker.processRawRelationships(action.relationships, 'rel_add');
                    }
                    tracker.handleRelationshipChange();
                });

                Dispatcher.subscribe('RELATIONSHIP_UPDATE', (action) => {
                    if (action?.relationship) {
                        tracker.processRawRelationships([action.relationship], 'rel_update');
                    }
                    tracker.handleRelationshipChange();
                });

                Dispatcher.subscribe('RELATIONSHIP_REMOVE', (action) => {
                    const relId = action?.relationship?.id || action?.id;
                    if (relId) tracker.removeRelationship(relId);
                    tracker.handleRelationshipChange();
                });

                dispatcherHooked = true;
                return true;
            } catch (e) {
                console.warn('[PendingTracker] Dispatcher error:', e);
            }
        }
        return false;
    }

    // ═══ TRACKER CORE ENGINE ═══
    class TrackerEngine {
        constructor() {
            this.pendingList = new Map();
        }

        handleRelationshipChange() {
            setTimeout(() => {
                this.syncFromStores();
                if (isOpen) renderUI();
                injectFriendsListBadges();
            }, 300);
        }

        processRawRelationships(relationships, source = 'unknown') {
            if (!Array.isArray(relationships) || relationships.length === 0) return 0;
            const stored = getStoredData();
            let updatedCount = 0;

            for (const rel of relationships) {
                if (!rel) continue;
                const uid = rel.id || rel.user?.id;
                if (!uid) continue;

                const relType = Number(rel.type);

                // If relationship has changed to friend or cancelled, clean up
                if (relType === REL_TYPES.FRIEND || relType === REL_TYPES.NONE) {
                    if (stored[uid]) {
                        delete stored[uid];
                        updatedCount++;
                    }
                    continue;
                }

                if (relType !== REL_TYPES.PENDING_INCOMING && relType !== REL_TYPES.PENDING_OUTGOING) {
                    continue;
                }

                const u = rel.user || {};
                let sinceTimestamp = null;
                if (rel.since) {
                    const parsed = new Date(rel.since).getTime();
                    if (!isNaN(parsed) && parsed > 0) {
                        sinceTimestamp = parsed;
                    }
                }

                const username = u.username || 'User';
                const globalName = u.global_name || u.globalName || u.username || username;
                const avatar = u.avatar || null;
                const discriminator = u.discriminator || '0';

                if (!stored[uid]) {
                    stored[uid] = {
                        userId: uid,
                        type: relType,
                        since: sinceTimestamp,
                        serverVerified: !!sinceTimestamp,
                        username: username,
                        globalName: globalName,
                        avatar: avatar,
                        discriminator: discriminator,
                        lastActive: Date.now()
                    };
                    updatedCount++;
                } else {
                    let changed = false;
                    // CRITICAL: Overwrite with genuine server timestamp
                    if (sinceTimestamp) {
                        stored[uid].since = sinceTimestamp;
                        stored[uid].serverVerified = true;
                        changed = true;
                    }
                    if (stored[uid].type !== relType) {
                        stored[uid].type = relType;
                        changed = true;
                    }
                    if (username && username !== 'User' && stored[uid].username !== username) {
                        stored[uid].username = username;
                        changed = true;
                    }
                    if (globalName && globalName !== 'User' && stored[uid].globalName !== globalName) {
                        stored[uid].globalName = globalName;
                        changed = true;
                    }
                    if (avatar && stored[uid].avatar !== avatar) {
                        stored[uid].avatar = avatar;
                        changed = true;
                    }
                    stored[uid].lastActive = Date.now();
                    if (changed) updatedCount++;
                }
            }

            if (updatedCount > 0) {
                saveStoredData(stored);
                this.pendingList = new Map(Object.entries(stored));
                console.log(`[PendingTracker] Processed ${updatedCount} relationships via ${source}`);
            }

            return updatedCount;
        }

        removeRelationship(userId) {
            const stored = getStoredData();
            if (stored[userId]) {
                delete stored[userId];
                saveStoredData(stored);
                this.pendingList.delete(userId);
                return true;
            }
            return false;
        }

        async fetchServerTimestamps() {
            const token = getDiscordToken();
            if (!token) {
                console.log('[PendingTracker] Token not ready yet');
                return { success: false, reason: 'no_token' };
            }

            try {
                console.log('[PendingTracker] Fetching relationships with token...');
                const res = await fetch('/api/v9/users/@me/relationships', {
                    method: 'GET',
                    headers: {
                        'Authorization': token,
                        'Content-Type': 'application/json'
                    }
                });

                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        console.log(`[PendingTracker] Received ${data.length} relationships from server API`);
                        // Purge any stale unverified entries before processing
                        purgeStaleUnverifiedEntries();
                        const count = this.processRawRelationships(data, 'discord_api_fetch');
                        return { success: true, count, total: data.length };
                    }
                } else {
                    console.warn('[PendingTracker] API status:', res.status);
                }
            } catch (e) {
                console.warn('[PendingTracker] API fetch error:', e);
            }
            return { success: false, reason: 'error' };
        }

        scanDOMForPending() {
            const peopleContainer = document.querySelector('[class*="peopleColumn"], [class*="peopleList"], main[class*="chatContent"]');
            if (!peopleContainer) return getStoredData();

            const rows = peopleContainer.querySelectorAll('[class*="peopleListItem"], [class*="listItem"], [role="listitem"]');
            if (rows.length === 0) return getStoredData();

            const stored = getStoredData();
            const now = Date.now();
            let changed = false;

            rows.forEach(row => {
                const hasCheckmark = !!row.querySelector('[aria-label*="Accept"], [aria-label*="Terima"], svg path[d*="M20"], svg path[d*="9.5 16"]');
                const hasCancel = !!row.querySelector('[aria-label*="Cancel"], [aria-label*="Batalkan"], [aria-label*="Ignore"], [aria-label*="Tolak"]');
                if (!hasCheckmark && !hasCancel) return;

                const img = row.querySelector('img[src*="/avatars/"], img[src*="cdn.discordapp.com"]');
                let userId = null;
                let avatarHash = null;
                if (img && img.src) {
                    const match = img.src.match(/\/avatars\/(\d+)\/([a-f0-9]+)/i);
                    if (match) {
                        userId = match[1];
                        avatarHash = match[2];
                    }
                }

                let displayName = '';
                let username = '';

                const textEls = row.querySelectorAll('[class*="discordTag"], [class*="username"], [class*="name_"], [class*="userSummary"], [class*="subtext"]');
                if (textEls.length >= 2) {
                    displayName = textEls[0].textContent.trim();
                    username = textEls[1].textContent.trim().replace(/^@/, '');
                } else if (textEls.length === 1) {
                    displayName = textEls[0].textContent.trim();
                    username = displayName;
                }

                if (!displayName && !username) return;

                // Inspect React Fiber on row for immediate `since` timestamp
                let fiberSince = null;
                try {
                    const fKey = Object.keys(row).find(k => k.startsWith('__reactFiber$'));
                    if (fKey) {
                        let f = row[fKey];
                        let depth = 25;
                        while (f && depth-- > 0) {
                            const mp = f.memoizedProps;
                            if (mp) {
                                const r = mp.relationship || (mp.user && mp);
                                const s = r?.since || mp.since;
                                if (s) {
                                    const parsed = new Date(s).getTime();
                                    if (!isNaN(parsed) && parsed > 0) {
                                        fiberSince = parsed;
                                        break;
                                    }
                                }
                            }
                            f = f.return;
                        }
                    }
                } catch {}

                let relType = hasCheckmark ? REL_TYPES.PENDING_INCOMING : REL_TYPES.PENDING_OUTGOING;
                const uid = userId || ('u_' + encodeURIComponent((username || displayName).toLowerCase().replace(/[^a-z0-9]/g, '')));

                if (!stored[uid]) {
                    stored[uid] = {
                        userId: uid,
                        type: relType,
                        since: fiberSince,
                        serverVerified: !!fiberSince,
                        username: username || displayName,
                        globalName: displayName || username,
                        avatar: avatarHash,
                        discriminator: '0',
                        lastActive: now
                    };
                    changed = true;
                } else {
                    if (fiberSince && (!stored[uid].since || fiberSince !== stored[uid].since)) {
                        stored[uid].since = fiberSince;
                        stored[uid].serverVerified = true;
                        changed = true;
                    }
                    stored[uid].username = username || stored[uid].username;
                    stored[uid].globalName = displayName || stored[uid].globalName;
                    stored[uid].avatar = avatarHash || stored[uid].avatar;
                    stored[uid].type = relType;
                    stored[uid].lastActive = now;
                }
            });

            if (changed) {
                saveStoredData(stored);
            }
            return stored;
        }

        syncFromStores() {
            extractDiscordModules();
            const stored = getStoredData();
            const now = Date.now();
            let changed = false;

            if (RelationshipStore) {
                let relationships = null;
                if (typeof RelationshipStore.getRelationships === 'function') {
                    relationships = RelationshipStore.getRelationships();
                } else if (RelationshipStore._relationships) {
                    relationships = RelationshipStore._relationships;
                }

                if (relationships && typeof relationships === 'object') {
                    for (const [userId, typeVal] of Object.entries(relationships)) {
                        const type = Number(typeVal);
                        if (type === REL_TYPES.PENDING_INCOMING || type === REL_TYPES.PENDING_OUTGOING) {
                            let userObj = UserStore?.getUser?.(userId) || null;
                            let existing = stored[userId];

                            let sinceTimestamp = null;
                            if (typeof RelationshipStore.getSince === 'function') {
                                const rawSince = RelationshipStore.getSince(userId);
                                if (rawSince) sinceTimestamp = new Date(rawSince).getTime() || null;
                            }
                            if (!sinceTimestamp && typeof RelationshipStore.getRelationship === 'function') {
                                const relObj = RelationshipStore.getRelationship(userId);
                                if (relObj?.since) sinceTimestamp = new Date(relObj.since).getTime() || null;
                            }

                            if (!existing) {
                                stored[userId] = {
                                    userId,
                                    type,
                                    since: sinceTimestamp,
                                    serverVerified: !!sinceTimestamp,
                                    username: userObj?.username || ('User ' + userId.slice(-4)),
                                    globalName: userObj?.globalName || userObj?.username || 'User',
                                    avatar: userObj?.avatar || null,
                                    discriminator: userObj?.discriminator || '0',
                                    lastActive: now
                                };
                                changed = true;
                            } else {
                                if (sinceTimestamp && (!existing.since || sinceTimestamp !== existing.since)) {
                                    existing.since = sinceTimestamp;
                                    existing.serverVerified = true;
                                    changed = true;
                                }
                                existing.type = type;
                                if (userObj) {
                                    existing.username = userObj.username || existing.username;
                                    existing.globalName = userObj.globalName || userObj.username || existing.globalName;
                                    existing.avatar = userObj.avatar || existing.avatar;
                                }
                                existing.lastActive = now;
                                changed = true;
                            }
                        }
                    }
                }
            }

            this.scanDOMForPending();

            const finalData = getStoredData();
            this.pendingList = new Map(Object.entries(finalData));
            return this.pendingList;
        }

        getPendingItems() {
            this.syncFromStores();
            return Array.from(this.pendingList.values());
        }

        getDurationForUser(userId) {
            const item = this.pendingList.get(userId) || getStoredData()[userId];
            if (!item) return null;

            // Custom manual timestamp set by user
            if (item.customDate) {
                const elapsed = Math.max(0, Date.now() - item.customDate);
                return {
                    elapsedMs: elapsed,
                    formatted: formatDuration(elapsed),
                    exactDate: formatDateExact(item.customDate),
                    serverVerified: false,
                    isCustom: true,
                    isPendingSync: false,
                    type: item.type,
                    days: Math.floor(elapsed / (1000 * 60 * 60 * 24))
                };
            }

            // Real Discord server timestamp
            if (item.since) {
                const elapsed = Math.max(0, Date.now() - item.since);
                return {
                    elapsedMs: elapsed,
                    formatted: formatDuration(elapsed),
                    exactDate: formatDateExact(item.since),
                    serverVerified: true,
                    isCustom: false,
                    isPendingSync: false,
                    type: item.type,
                    days: Math.floor(elapsed / (1000 * 60 * 60 * 24))
                };
            }

            // Never fake 1 minute! Tell the user it's syncing
            return {
                elapsedMs: 0,
                formatted: 'Sinkronisasi server...',
                exactDate: 'Waktu belum disinkronkan',
                serverVerified: false,
                isCustom: false,
                isPendingSync: true,
                type: item.type,
                days: 0
            };
        }

        updateUserCustomDate(userId, timestamp) {
            const stored = getStoredData();
            if (stored[userId]) {
                stored[userId].customDate = timestamp;
                stored[userId].since = timestamp;
                stored[userId].serverVerified = false;
                saveStoredData(stored);
                this.pendingList = new Map(Object.entries(stored));
                return true;
            }
            return false;
        }

        clearAll() {
            try {
                const storage = getStorage();
                if (storage) storage.removeItem(STORAGE_KEY);
            } catch {}
            delete _memoryStorage[STORAGE_KEY];
            this.pendingList.clear();
            this.syncFromStores();
        }
    }

    const tracker = new TrackerEngine();

    // ═══ DOM BADGE INJECTION ═══
    function injectFriendsListBadges() {
        if (!CONFIG.showBadgeInFriendsList) return;

        try {
            const peopleContainer = document.querySelector('[class*="peopleColumn"], [class*="peopleList"], main[class*="chatContent"]');
            if (!peopleContainer) return;

            const rows = peopleContainer.querySelectorAll('[class*="peopleListItem"], [class*="listItem"], [role="listitem"]');
            if (rows.length === 0) return;

            rows.forEach(row => {
                const hasCheckmark = !!row.querySelector('[aria-label*="Accept"], [aria-label*="Terima"], svg path[d*="M20"], svg path[d*="9.5 16"]');
                const hasCancel = !!row.querySelector('[aria-label*="Cancel"], [aria-label*="Batalkan"], [aria-label*="Ignore"], [aria-label*="Tolak"]');
                if (!hasCheckmark && !hasCancel) return;

                const img = row.querySelector('img[src*="/avatars/"], img[src*="cdn.discordapp.com"]');
                let userId = null;
                if (img && img.src) {
                    const m = img.src.match(/\/avatars\/(\d+)\//);
                    if (m) userId = m[1];
                }

                if (!userId) {
                    const textEl = row.querySelector('[class*="discordTag"], [class*="username"]');
                    const uname = textEl ? textEl.textContent.trim().replace(/^@/, '') : '';
                    if (uname) userId = 'u_' + encodeURIComponent(uname.toLowerCase().replace(/[^a-z0-9]/g, ''));
                }

                if (!userId) return;

                const durationInfo = tracker.getDurationForUser(userId);
                if (!durationInfo) return;

                let badge = row.querySelector('.pft-injected-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'pft-injected-badge';
                    const nameWrap = row.querySelector('[class*="discordTag"], [class*="username"], [class*="name_"]') || row;
                    nameWrap.appendChild(badge);
                }

                if (durationInfo.isPendingSync) {
                    badge.className = 'pft-injected-badge pft-badge-warning';
                    badge.title = 'Menyinkronkan waktu dari server Discord... Klik tombol 🔄 di panel tracker jika belum berubah.';
                    badge.innerHTML = '⏱️ Menyinkronkan...';
                    return;
                }

                const days = durationInfo.days || 0;
                let urgencyClass = '';
                if (days >= 30) {
                    urgencyClass = 'pft-badge-old';
                } else if (days >= (CONFIG.alertThresholdDays || 7)) {
                    urgencyClass = 'pft-badge-warning';
                } else {
                    urgencyClass = (Number(durationInfo.type) === REL_TYPES.PENDING_OUTGOING) ? 'pft-badge-outgoing' : 'pft-badge-incoming';
                }

                const verifiedTag = durationInfo.serverVerified ? '⚡ ' : '⏱️ ';
                badge.className = `pft-injected-badge ${urgencyClass}`;
                badge.title = `⏱️ Pending sejak: ${durationInfo.exactDate} (${durationInfo.formatted})${durationInfo.serverVerified ? ' [Terverifikasi Server Discord]' : ''}`;
                badge.innerHTML = `${verifiedTag}${durationInfo.formatted}`;
            });
        } catch (err) {
            console.warn('[PendingTracker] List badge notice:', err);
        }
    }

    // UI state
    let triggerBtn = null;
    let popup = null;
    let toast = null;
    let currentTab = 'incoming';
    let isOpen = false;
    let toastTimer = null;
    let searchQuery = '';
    let currentSort = 'oldest';
    let observer = null;

    // ═══ UI HUB GENERATION ═══
    function createUI() {
        if (!document.body) return null;
        if (document.getElementById('pft-root')) {
            return {
                triggerBtn: document.getElementById('pft-trigger-btn'),
                popup: document.getElementById('pft-popup'),
                toast: document.getElementById('pft-toast')
            };
        }

        const root = document.createElement('div');
        root.id = 'pft-root';
        document.body.appendChild(root);

        if (!document.getElementById('pft-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'pft-styles';
            styleEl.textContent = STYLES;
            (document.head || document.body).appendChild(styleEl);
        }

        if (CONFIG.showFloatingButton !== false) {
            triggerBtn = document.createElement('button');
            triggerBtn.id = 'pft-trigger-btn';
            triggerBtn.title = 'Pending Friend Tracker (Durasi Add Friend)';
            triggerBtn.innerHTML = ICONS.clock + '<span class="pft-badge-counter" id="pft-btn-count" style="display:none">0</span>';
            root.appendChild(triggerBtn);
        }

        popup = document.createElement('div');
        popup.id = 'pft-popup';
        popup.innerHTML = `
            <div class="pft-header">
                <div class="pft-header-title">
                    ${ICONS.clock}
                    Pending Friend Tracker
                </div>
                <div class="pft-header-actions">
                    <button class="pft-icon-btn" id="pft-refresh-btn" title="Sinkronkan Waktu Asli dari Server Discord">${ICONS.refresh}</button>
                    <button class="pft-icon-btn" id="pft-close-btn" title="Tutup">${ICONS.close}</button>
                </div>
            </div>
            <div class="pft-tabs">
                <button class="pft-tab pft-active" data-tab="incoming">
                    ${ICONS.inbox}
                    Masuk
                    <span class="pft-tab-badge" id="pft-incoming-count">0</span>
                </button>
                <button class="pft-tab" data-tab="outgoing">
                    ${ICONS.send}
                    Terkirim
                    <span class="pft-tab-badge" id="pft-outgoing-count">0</span>
                </button>
                <button class="pft-tab" data-tab="stats">
                    ${ICONS.chart}
                    Statistik
                </button>
            </div>
            <div class="pft-controls" id="pft-controls-bar">
                <div class="pft-search-box">
                    ${ICONS.search}
                    <input type="text" id="pft-search-input" placeholder="Cari username atau ID..." autocomplete="off" />
                </div>
                <select class="pft-sort-select" id="pft-sort-select">
                    <option value="oldest">Paling Lama Pending ⏱️</option>
                    <option value="newest">Paling Baru ⚡</option>
                    <option value="moreThan7">> 7 Hari Menunggu ⚠️</option>
                    <option value="moreThan30">> 30 Hari Menunggu 🚨</option>
                    <option value="name">Nama (A-Z)</option>
                </select>
            </div>
            <div class="pft-list-container" id="pft-content-list"></div>
            <div class="pft-footer">
                <div>Tekan <kbd>${HOTKEY_DISPLAY}</kbd> untuk toggle</div>
                <div id="pft-footer-summary">Memuat...</div>
            </div>
        `;
        root.appendChild(popup);

        toast = document.createElement('div');
        toast.className = 'pft-toast';
        toast.id = 'pft-toast';
        root.appendChild(toast);

        return { triggerBtn, popup, toast };
    }

    function showToast(message, isError = false) {
        const toastEl = document.getElementById('pft-toast');
        if (!toastEl) return;
        toastEl.innerHTML = (isError ? ICONS.alert : ICONS.userCheck) + '<span>' + escapeHtml(message) + '</span>';
        toastEl.classList.toggle('pft-toast-error', isError);
        toastEl.classList.add('pft-toast-show');

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastEl.classList.remove('pft-toast-show');
            toastTimer = null;
        }, 2800);
    }

    function togglePopup() {
        isOpen = !isOpen;
        popup.classList.toggle('pft-visible', isOpen);
        if (triggerBtn) triggerBtn.classList.toggle('pft-open', isOpen);

        if (isOpen) {
            tracker.syncFromStores();
            tracker.fetchServerTimestamps().then(() => {
                if (isOpen) renderUI();
                injectFriendsListBadges();
            });
            renderUI();
            const searchInput = document.getElementById('pft-search-input');
            if (searchInput) searchInput.focus();
        }
    }

    function closePopup() {
        isOpen = false;
        popup.classList.remove('pft-visible');
        if (triggerBtn) triggerBtn.classList.remove('pft-open');
    }

    function renderUI() {
        const items = tracker.getPendingItems();

        let incoming = items.filter(i => Number(i.type) === REL_TYPES.PENDING_INCOMING || String(i.type) === '3' || i.type === 'incoming');
        let outgoing = items.filter(i => Number(i.type) === REL_TYPES.PENDING_OUTGOING || String(i.type) === '4' || i.type === 'outgoing');

        if (incoming.length === 0 && outgoing.length === 0 && items.length > 0) {
            incoming = items;
        }

        const inCountEl = document.getElementById('pft-incoming-count');
        const outCountEl = document.getElementById('pft-outgoing-count');
        if (inCountEl) inCountEl.textContent = incoming.length;
        if (outCountEl) outCountEl.textContent = outgoing.length;

        const totalPending = incoming.length + outgoing.length;
        const btnCountEl = document.getElementById('pft-btn-count');
        if (btnCountEl) {
            btnCountEl.textContent = totalPending;
            btnCountEl.style.display = totalPending > 0 ? 'block' : 'none';
        }

        const summaryEl = document.getElementById('pft-footer-summary');
        if (summaryEl) {
            summaryEl.textContent = `Total: ${totalPending} pending`;
        }

        const controlsBar = document.getElementById('pft-controls-bar');
        const contentList = document.getElementById('pft-content-list');

        if (currentTab === 'stats') {
            if (controlsBar) controlsBar.style.display = 'none';
            renderStats(contentList, incoming, outgoing);
            return;
        }

        if (controlsBar) controlsBar.style.display = 'flex';
        const targetList = currentTab === 'incoming' ? incoming : outgoing;
        renderList(contentList, targetList);
    }

    function renderList(container, items) {
        let filtered = items.filter(item => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return (
                (item.username && item.username.toLowerCase().includes(q)) ||
                (item.globalName && item.globalName.toLowerCase().includes(q)) ||
                (item.userId && item.userId.includes(q))
            );
        });

        // Apply duration threshold filtering
        if (currentSort === 'moreThan7') {
            filtered = filtered.filter(item => {
                const dur = tracker.getDurationForUser(item.userId);
                return dur && dur.days >= 7;
            });
        } else if (currentSort === 'moreThan30') {
            filtered = filtered.filter(item => {
                const dur = tracker.getDurationForUser(item.userId);
                return dur && dur.days >= 30;
            });
        }

        filtered.sort((a, b) => {
            const timeA = a.customDate || a.since || 0;
            const timeB = b.customDate || b.since || 0;

            if (currentSort === 'oldest' || currentSort === 'moreThan7' || currentSort === 'moreThan30') {
                return timeA - timeB;
            }
            if (currentSort === 'newest') {
                return timeB - timeA;
            }
            if (currentSort === 'name') {
                return (a.globalName || a.username || '').localeCompare(b.globalName || b.username || '');
            }
            return 0;
        });

        if (filtered.length === 0) {
            const isInc = currentTab === 'incoming';
            container.innerHTML = `
                <div class="pft-empty">
                    ${isInc ? ICONS.inbox : ICONS.send}
                    <div class="pft-empty-title">${searchQuery ? 'Tidak Ditemukan' : (isInc ? 'Tidak Ada Permintaan Masuk' : 'Tidak Ada Permintaan Terkirim')}</div>
                    <div class="pft-empty-sub">${searchQuery ? 'Coba kata kunci lain' : 'Klik tombol di bawah untuk menyinkronkan data langsung dari server Discord.'}</div>
                    <button class="pft-scan-btn" id="pft-manual-scan-btn">
                        ${ICONS.refresh} Sinkronkan Waktu Asli dari Server
                    </button>
                </div>
            `;

            const scanBtn = container.querySelector('#pft-manual-scan-btn');
            if (scanBtn) {
                scanBtn.addEventListener('click', async () => {
                    scanBtn.disabled = true;
                    showToast('Mengambil waktu asli dari server Discord...');
                    const res = await tracker.fetchServerTimestamps();
                    tracker.syncFromStores();
                    renderUI();
                    injectFriendsListBadges();
                    if (res.success) {
                        showToast(`Berhasil! ${res.count} waktu pending disinkronkan dari server.`);
                    } else {
                        showToast('Memindai daftar Discord...');
                    }
                });
            }
            return;
        }

        let html = '';
        for (const item of filtered) {
            const duration = tracker.getDurationForUser(item.userId) || {
                formatted: 'Sinkronisasi...',
                exactDate: '-',
                serverVerified: false,
                isPendingSync: true,
                days: 0
            };

            const days = duration.days || 0;
            let pillClass = '';
            if (duration.isPendingSync) {
                pillClass = 'pft-duration-warning';
            } else if (days >= 30) {
                pillClass = 'pft-duration-alert';
            } else if (days >= (CONFIG.alertThresholdDays || 7)) {
                pillClass = 'pft-duration-warning';
            } else {
                pillClass = (Number(item.type) === REL_TYPES.PENDING_OUTGOING) ? 'pft-duration-outgoing' : 'pft-duration-incoming';
            }

            const avatarUrl = item.avatar
                ? `https://cdn.discordapp.com/avatars/${item.userId}/${item.avatar}.png?size=80`
                : null;

            const initial = (item.globalName || item.username || '?').charAt(0).toUpperCase();

            html += `
                <div class="pft-user-card" data-userid="${escapeHtml(item.userId)}">
                    <div class="pft-user-avatar">
                        ${avatarUrl ? `<img src="${avatarUrl}" alt="${escapeHtml(item.username)}" onerror="this.style.display='none'" />` : initial}
                    </div>
                    <div class="pft-user-info">
                        <div class="pft-user-name-row">
                            <div class="pft-user-display-name" title="${escapeHtml(item.globalName || item.username)}">${escapeHtml(item.globalName || item.username)}</div>
                            <div class="pft-user-username">@${escapeHtml(item.username)}</div>
                        </div>
                        <div class="pft-user-meta">
                            <span class="pft-duration-pill ${pillClass}">
                                ${ICONS.clock} ${duration.formatted}
                            </span>
                            <span class="pft-date-text">📅 ${duration.exactDate}</span>
                            ${duration.serverVerified
                                ? '<span class="pft-verified-badge" title="Waktu terverifikasi langsung dari server Discord">⚡ Server Discord</span>'
                                : (duration.isCustom ? '<span class="pft-verified-badge" style="background:rgba(88,101,242,0.18); color:#8390fa;">✍️ Manual</span>' : '<span class="pft-unverified-badge" title="Klik tombol 🔄 di atas untuk mengambil waktu server">⏱️ Menunggu Server</span>')}
                        </div>
                    </div>
                    <div class="pft-card-actions">
                        <button class="pft-action-btn" data-action="edit-date" title="Atur / Koreksi Tanggal">${ICONS.clock}</button>
                        <button class="pft-action-btn" data-action="copy-id" title="Copy User ID">${ICONS.copy}</button>
                        <button class="pft-action-btn" data-action="copy-summary" title="Copy Ringkasan">${ICONS.external}</button>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

        container.querySelectorAll('.pft-user-card').forEach(card => {
            const userId = card.dataset.userid;
            const copyIdBtn = card.querySelector('[data-action="copy-id"]');
            const copySummaryBtn = card.querySelector('[data-action="copy-summary"]');
            const editDateBtn = card.querySelector('[data-action="edit-date"]');

            if (editDateBtn) {
                editDateBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const item = filtered.find(i => i.userId === userId);
                    const dur = tracker.getDurationForUser(userId);
                    const promptVal = prompt(
                        `Ubah/Koreksi waktu pending untuk @${item.username}:\n\nContoh input:\n- Ketik "30" untuk 30 hari lalu\n- Ketik "60" untuk 2 bulan lalu\n- Format tanggal: "YYYY-MM-DD" (misal: "2024-03-15")\n\nSaat ini tercatat: ${dur?.exactDate || '-'} (${dur?.formatted || '-'})`,
                        ''
                    );

                    if (!promptVal) return;

                    let newTimestamp = null;
                    if (/^\d+$/.test(promptVal.trim())) {
                        const daysAgo = parseInt(promptVal.trim(), 10);
                        newTimestamp = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
                    } else {
                        const parsed = Date.parse(promptVal.trim());
                        if (!isNaN(parsed)) {
                            newTimestamp = parsed;
                        }
                    }

                    if (newTimestamp && newTimestamp > 0) {
                        tracker.updateUserCustomDate(userId, newTimestamp);
                        renderUI();
                        injectFriendsListBadges();
                        showToast(`Tanggal pending @${item.username} berhasil diubah!`);
                    } else {
                        showToast('Format tanggal tidak valid', true);
                    }
                });
            }

            if (copyIdBtn) {
                copyIdBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(userId);
                    showToast('User ID disalin ke clipboard!');
                });
            }

            if (copySummaryBtn) {
                copySummaryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const item = filtered.find(i => i.userId === userId);
                    const dur = tracker.getDurationForUser(userId);
                    const text = `[${Number(item.type) === REL_TYPES.PENDING_INCOMING ? 'Permintaan Masuk' : 'Permintaan Keluar'}] ${item.globalName} (@${item.username}) - Pending selama ${dur?.formatted || '-'} (sejak ${dur?.exactDate || '-'})`;
                    navigator.clipboard.writeText(text);
                    showToast('Info ringkasan disalin!');
                });
            }
        });
    }

    function renderStats(container, incoming, outgoing) {
        const all = [...incoming, ...outgoing];
        let oldest = null;
        let newest = null;
        let totalMs = 0;
        let countLessThan7 = 0;
        let count7to30 = 0;
        let countMoreThan30 = 0;

        all.forEach(item => {
            const dur = tracker.getDurationForUser(item.userId);
            if (dur && !dur.isPendingSync) {
                totalMs += dur.elapsedMs;
                if (dur.days < 7) countLessThan7++;
                else if (dur.days < 30) count7to30++;
                else countMoreThan30++;
            }

            const t = item.customDate || item.since || 0;
            if (t > 0) {
                if (!oldest || t < (oldest.customDate || oldest.since || Infinity)) oldest = item;
                if (!newest || t > (newest.customDate || newest.since || 0)) newest = item;
            }
        });

        const verifiedCount = all.filter(i => i.since || i.customDate).length;
        const avgMs = verifiedCount > 0 ? (totalMs / verifiedCount) : 0;
        const avgFormatted = formatDuration(avgMs);

        const oldestDur = oldest ? tracker.getDurationForUser(oldest.userId) : null;
        const newestDur = newest ? tracker.getDurationForUser(newest.userId) : null;

        container.innerHTML = `
            <div class="pft-stats-panel">
                <div class="pft-stat-grid">
                    <div class="pft-stat-card">
                        <div class="pft-stat-label">Permintaan Masuk</div>
                        <div class="pft-stat-val" style="color:#23a55a">${incoming.length}</div>
                    </div>
                    <div class="pft-stat-card">
                        <div class="pft-stat-label">Permintaan Terkirim</div>
                        <div class="pft-stat-val" style="color:#8390fa">${outgoing.length}</div>
                    </div>
                </div>

                <div class="pft-stat-card" style="text-align:left; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div class="pft-stat-label">Rata-Rata Waktu Pending</div>
                        <div style="font-size:16px; font-weight:700; color:#f2f3f5; margin-top:2px;">
                            ${verifiedCount > 0 ? avgFormatted : 'Menunggu sinkronisasi...'}
                        </div>
                    </div>
                    <div style="text-align:right; font-size:11px; color:#949ba4;">
                        <div>&lt; 7 hari: <strong style="color:#23a55a">${countLessThan7}</strong></div>
                        <div>7 - 30 hari: <strong style="color:#f0b232">${count7to30}</strong></div>
                        <div>&gt; 30 hari: <strong style="color:#f23f43">${countMoreThan30}</strong></div>
                    </div>
                </div>

                ${oldest ? `
                    <div class="pft-stat-highlight">
                        <div style="font-weight:700; color:var(--pft-danger); margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                            ${ICONS.clock} Permintaan Paling Lama:
                        </div>
                        <div><strong>${escapeHtml(oldest.globalName)}</strong> (@${escapeHtml(oldest.username)})</div>
                        <div style="color:var(--pft-text-secondary); margin-top:2px;">
                            Sudah menunggu: <strong style="color:var(--pft-text-primary)">${oldestDur?.formatted || '-'}</strong>
                            (sejak ${oldestDur?.exactDate || '-'})
                            ${oldestDur?.serverVerified ? '⚡ Server Discord' : ''}
                        </div>
                    </div>
                ` : ''}

                ${newest ? `
                    <div class="pft-stat-highlight">
                        <div style="font-weight:700; color:var(--pft-accent); margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                            ${ICONS.userCheck} Permintaan Paling Baru:
                        </div>
                        <div><strong>${escapeHtml(newest.globalName)}</strong> (@${escapeHtml(newest.username)})</div>
                        <div style="color:var(--pft-text-secondary); margin-top:2px;">
                            Baru masuk: <strong style="color:var(--pft-text-primary)">${newestDur?.formatted || '-'}</strong>
                            (sejak ${newestDur?.exactDate || '-'})
                        </div>
                    </div>
                ` : ''}

                <div style="display:flex; gap:8px; margin-top:6px;">
                    <button class="pft-icon-btn" id="pft-sync-api-btn" style="flex:1; background:#5865f2; color:#fff; height:34px; font-size:12px; font-weight:600; gap:6px; border-radius:6px;">
                        ${ICONS.refresh} Ambil Waktu Asli dari Server
                    </button>
                    <button class="pft-icon-btn" id="pft-export-btn" style="flex:1; background:rgba(255,255,255,0.06); height:34px; font-size:12px; font-weight:600; gap:6px; color:var(--pft-text-primary)">
                        ${ICONS.copy} Ekspor JSON
                    </button>
                    <button class="pft-icon-btn" id="pft-clear-btn" style="background:var(--pft-danger-soft); color:var(--pft-danger); height:34px; padding:0 12px; font-size:12px; font-weight:600; gap:6px;">
                        ${ICONS.trash} Reset
                    </button>
                </div>
            </div>
        `;

        const syncApiBtn = document.getElementById('pft-sync-api-btn');
        if (syncApiBtn) {
            syncApiBtn.addEventListener('click', async () => {
                syncApiBtn.disabled = true;
                showToast('Menghubungkan ke server Discord...');
                const res = await tracker.fetchServerTimestamps();
                tracker.syncFromStores();
                renderUI();
                injectFriendsListBadges();
                if (res.success) {
                    showToast(`Berhasil! ${res.count} waktu pending disinkronkan dari server.`);
                } else {
                    showToast('Gagal sinkron server. Anda dapat mengedit tanggal via tombol jam ⏱️', true);
                }
            });
        }

        const exportBtn = document.getElementById('pft-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const data = tracker.getPendingItems().map(item => ({
                    ...item,
                    duration: tracker.getDurationForUser(item.userId)
                }));
                navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                showToast('Data pending berhasil diekspor ke clipboard!');
            });
        }

        const clearBtn = document.getElementById('pft-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Reset semua data tracker pending? Data akan dipindai ulang.')) {
                    tracker.clearAll();
                    renderUI();
                    showToast('Tracker direset');
                }
            });
        }
    }

    // ═══ EVENT LISTENERS & INITIALIZATION ═══
    function setupEventListeners() {
        if (triggerBtn) {
            triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePopup();
            });
        }

        if (popup) {
            popup.addEventListener('click', (e) => e.stopPropagation());
        }

        const closeBtn = document.getElementById('pft-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closePopup);

        const refreshBtn = document.getElementById('pft-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.classList.add('pft-spinning');
                showToast('Menyinkronkan waktu asli dari server...');
                const res = await tracker.fetchServerTimestamps();
                tracker.syncFromStores();
                renderUI();
                injectFriendsListBadges();
                setTimeout(() => {
                    refreshBtn.classList.remove('pft-spinning');
                    if (res.success) {
                        showToast(`Berhasil! Waktu pending asli disinkronkan dari server.`);
                    } else {
                        showToast('Silakan buka tab Friends/Pending di Discord untuk memicu sinkronisasi');
                    }
                }, 400);
            });
        }

        document.querySelectorAll('.pft-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.pft-tab').forEach(t => t.classList.remove('pft-active'));
                tab.classList.add('pft-active');
                currentTab = tab.dataset.tab;
                renderUI();
            });
        });

        const searchInput = document.getElementById('pft-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value;
                renderUI();
            });
        }

        const sortSelect = document.getElementById('pft-sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                currentSort = e.target.value;
                renderUI();
            });
        }

        // Hotkey listener
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) {
                closePopup();
                return;
            }

            const hotkeyStr = (CONFIG.hotkey || 'ctrl+shift+p').toLowerCase();
            const parts = hotkeyStr.split('+').map(p => p.trim());
            const needCtrl = parts.includes('ctrl') || parts.includes('control');
            const needShift = parts.includes('shift');
            const needAlt = parts.includes('alt');
            const key = parts.find(p => !['ctrl', 'control', 'shift', 'alt', 'cmd', 'meta'].includes(p));

            const isKeyMatch = key && (
                e.key.toLowerCase() === key.toLowerCase() ||
                e.code.toLowerCase() === ('key' + key).toLowerCase()
            );

            if (
                isKeyMatch &&
                e.ctrlKey === needCtrl &&
                e.shiftKey === needShift &&
                e.altKey === needAlt
            ) {
                e.preventDefault();
                togglePopup();
            }
        });
    }

    function initTracker() {
        if (!document.body) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initTracker, { once: true });
            } else {
                setTimeout(initTracker, 150);
            }
            return;
        }

        // Purge old corrupt cache on startup
        purgeStaleUnverifiedEntries();

        const ui = createUI();
        if (ui) {
            triggerBtn = ui.triggerBtn;
            popup = ui.popup;
            toast = ui.toast;
        }

        setupEventListeners();

        // Debounced mutation observer
        let debounceTimer = null;
        observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            for (const m of mutations) {
                if (m.target?.id === 'pft-root' || m.target?.classList?.contains('pft-injected-badge')) {
                    continue;
                }
                shouldCheck = true;
                break;
            }
            if (shouldCheck) {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    injectFriendsListBadges();
                }, 600);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initialize and synchronize with Discord
        const syncSequence = async () => {
            tryHookDispatcher();
            tracker.syncFromStores();
            injectFriendsListBadges();

            // Background fetch true server timestamps
            const res = await tracker.fetchServerTimestamps();
            if (res.success) {
                tracker.syncFromStores();
                if (isOpen) renderUI();
                injectFriendsListBadges();
            }
        };

        setTimeout(syncSequence, 1200);
        setTimeout(syncSequence, 3500);

        // Light periodic refresh (every 20s)
        const intervalSec = CONFIG.autoRefreshIntervalSec || 20;
        setInterval(() => {
            tracker.syncFromStores();
            if (isOpen) renderUI();
            injectFriendsListBadges();
        }, intervalSec * 1000);

        console.log('[PendingFriendTracker v1.4.0] Initialized with real server timestamp sync.');
    }

    initTracker();
})();
