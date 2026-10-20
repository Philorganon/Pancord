/**
 * Fake Nitro Emojis & Stickers — renderer-side inject script (v1.4.0).
 *
 * Mengizinkan penggunaan emoji dan stiker dari server mana pun tanpa Nitro:
 * 1. Menghilangkan filter abu-abu & gembok pada emoji dan stiker.
 * 2. Mencegah modal "Get Nitro" di event pointerdown/mousedown/click.
 * 3. Ekstraksi ID stiker langsung dari atribut data-id / src (menangani child img).
 * 4. Pengiriman pesan stiker INSTAN langsung via Discord MessageActions atau Slate Native.
 * 5. Menutup picker otomatis setelah stiker dikirim agar persis seperti stiker asli.
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[FakeNitro]';
    const VERSION = '1.4.0';
    const STYLE_ID = 'fake-nitro-emojis-styles';

    const DEFAULT_CONFIG = {
        enabled: true,
        emojiSize: 48,
        stickerSize: 160,
        animated: true,
        unlockPicker: true,
        unlockStickers: true,
        sendAsLink: true,
        sendStickerDirectly: true,
        quality: 'lossless'
    };

    const config = Object.assign({}, DEFAULT_CONFIG, window.__FAKE_NITRO_EMOJIS_CONFIG__ || {});

    // Jika sudah terpasang, stop versi lama lalu jalankan yang baru
    if (window.__fakeNitroEmojis && typeof window.__fakeNitroEmojis.stop === 'function') {
        try { window.__fakeNitroEmojis.stop(); } catch (e) { /* ignored */ }
    }

    const log = (...args) => console.log(LOG_PREFIX, ...args);

    const state = {
        styleEl: null,
        interceptHandlers: [],
        lastActionTime: 0,
        messageActions: null,
        channelStore: null
    };

    // ─── Webpack Module Helper ──────────────────────────────────────────

    function collectWebpackModules() {
        const modules = [];
        if (typeof window.webpackChunkdiscord_app === 'undefined') return modules;
        try {
            window.webpackChunkdiscord_app.push([
                ['fn_' + Math.random().toString(36).slice(2, 8)],
                {},
                (req) => {
                    for (const id in req.c) {
                        if (req.c[id] && req.c[id].exports) {
                            modules.push(req.c[id].exports);
                        }
                    }
                }
            ]);
        } catch (e) { /* ignored */ }
        finally {
            try { window.webpackChunkdiscord_app.pop(); } catch (e) { /* ignored */ }
        }
        return modules;
    }

    function getDiscordChatAPI() {
        if (state.messageActions && state.channelStore) {
            return { messageActions: state.messageActions, channelStore: state.channelStore };
        }

        const modules = collectWebpackModules();
        for (const m of modules) {
            if (!m) continue;
            const targets = [m, m.default, m.Z, m.ZP].filter(Boolean);
            for (const t of targets) {
                // Modul MessageActions resmi Discord selalu memiliki sendMessage DAN editMessage / deleteMessage
                if (!state.messageActions && typeof t.sendMessage === 'function' && (typeof t.editMessage === 'function' || typeof t.deleteMessage === 'function')) {
                    state.messageActions = t;
                }
                // Modul SelectedChannelStore resmi Discord selalu memiliki getChannelId DAN getVoiceChannelId
                if (!state.channelStore && typeof t.getChannelId === 'function' && typeof t.getVoiceChannelId === 'function') {
                    state.channelStore = t;
                }
            }
            if (state.messageActions && state.channelStore) break;
        }
        return { messageActions: state.messageActions, channelStore: state.channelStore };
    }

    // ─── CSS Injection ──────────────────────────────────────────────────

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const css = `
            /* Fake Nitro Emojis & Stickers - Unlock Filter & Visibility */
            [class*="categorySectionNitroLocked_"] {
                opacity: 1 !important;
            }

            /* Un-grayscale locked emojis */
            img[class*="lockedEmoji_"],
            [class*="categorySectionNitroLocked_"] img[class*="image_"],
            [class*="categorySectionNitroLocked_"] button[class*="emojiItem_"] {
                filter: none !important;
                opacity: 1 !important;
                cursor: pointer !important;
                pointer-events: auto !important;
            }

            /* Un-grayscale locked stickers */
            [class*="stickerUnsendable_"],
            [class*="stickerNode_"][class*="unsendable_"],
            [class*="stickerItem_"][class*="unsendable_"],
            [class*="categorySectionNitroLocked_"] [class*="sticker_"],
            [class*="categorySectionNitroLocked_"] [class*="stickerNode_"],
            [class*="categorySectionNitroLocked_"] [class*="stickerItem_"],
            [class*="sticker_c6367b"] [class*="stickerUnsendable_"],
            [class*="stickerNode_c6367b"] {
                filter: none !important;
                opacity: 1 !important;
                cursor: pointer !important;
                pointer-events: auto !important;
            }

            /* Sembunyikan efek gembok atau overlay abu-abu */
            [class*="categorySectionNitroLocked_"] [class*="nitroIcon_"],
            [class*="categorySectionNitroLocked_"] svg[class*="lock_"],
            [class*="emojiLockIcon_"],
            [class*="lockedEmoji_"]::after,
            [class*="stickerUnsendable_"] [class*="lockIcon_"],
            [class*="stickerUnsendable_"] svg[class*="lock_"],
            [class*="stickerLockIcon_"],
            [class*="stickerUnsendable_"]::after {
                display: none !important;
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = css;
        (document.head || document.documentElement).appendChild(styleEl);
        state.styleEl = styleEl;
    }

    // ─── Slate Editor & Input Helpers ───────────────────────────────────

    function getComposerElement() {
        return (
            document.querySelector('[role="textbox"][data-slate-editor="true"]') ||
            document.querySelector('[class*="slateTextArea"]') ||
            document.querySelector('[contenteditable="true"][role="textbox"]') ||
            document.querySelector('[class*="channelTextArea"] [role="textbox"]') ||
            document.querySelector('[role="textbox"]') ||
            document.querySelector('[contenteditable="true"]')
        );
    }

    function getSendButton() {
        const buttons = document.querySelectorAll(
            '[class*="channelTextArea"] button, [class*="form"] button, form button'
        );
        for (const btn of buttons) {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            // JANGAN PERNAH klik tombol Gift / Hadiah Nitro!
            if (label.includes('gift') || label.includes('hadiah') || label.includes('nitro')) continue;
            if (btn.type === 'submit') return btn;
            if (label === 'send message' || label === 'kirim pesan') return btn;
        }
        return null;
    }

    function findSlateEditor(element) {
        try {
            const fiberKey = Object.keys(element).find((k) =>
                k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
            );
            if (!fiberKey) return null;

            let fiber = element[fiberKey];
            let maxDepth = 40;

            while (fiber && maxDepth-- > 0) {
                const props = fiber.memoizedProps;
                if (props) {
                    if (props.editor && typeof props.editor.insertText === 'function') return props.editor;
                    if (props.node && typeof props.node.insertText === 'function') return props.node;
                }
                const pending = fiber.pendingProps;
                if (pending && pending.editor && typeof pending.editor.insertText === 'function') {
                    return pending.editor;
                }
                if (fiber.stateNode && fiber.stateNode !== element) {
                    const sn = fiber.stateNode;
                    if (sn.editor && typeof sn.editor.insertText === 'function') return sn.editor;
                    if (sn.state && sn.state.editor && typeof sn.state.editor.insertText === 'function') return sn.state.editor;
                }
                fiber = fiber.return;
            }
        } catch (e) {
            log('Slate finder error:', e);
        }
        return null;
    }

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

        const form = editorEl.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
            try { form.requestSubmit(); } catch (e) { /* ignored */ }
        }
    }

    function closePicker() {
        setTimeout(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true
            }));
        }, 60);
    }

    function sendStickerMessage(stickerUrl) {
        log('Mengirim stiker:', stickerUrl);

        // 1. Coba lewat Discord Webpack API (MessageActions)
        const { messageActions, channelStore } = getDiscordChatAPI();
        const channelId = channelStore?.getChannelId() ||
            window.location.pathname.split('/').filter(Boolean).pop();

        if (messageActions && channelId && /^\d+$/.test(channelId)) {
            try {
                messageActions.sendMessage(channelId, {
                    content: stickerUrl,
                    invalidEmojis: [],
                    validNonShortcutEmojis: []
                });
                log('Stiker berhasil terkirim via Webpack sendMessage!');
                closePicker();
                return true;
            } catch (e) {
                log('Webpack sendMessage gagal, mencoba DOM fallback:', e);
            }
        }

        // 2. Fallback: Sisipkan ke Slate Editor & tekan Enter / tombol Kirim yang aman
        const editor = getComposerElement();
        if (editor) {
            insertTextToChat(stickerUrl, false);

            setTimeout(() => {
                const sendBtn = getSendButton();
                if (sendBtn) {
                    sendBtn.click();
                    log('Tombol kirim aman diklik');
                } else {
                    pressEnterOnEditor(editor);
                    log('Enter ditekan pada editor');
                }
                closePicker();
            }, 100);

            return true;
        }

        return false;
    }

    function insertTextToChat(text, shouldPressEnter = false) {
        const editorEl = getComposerElement();
        if (!editorEl) {
            log('Composer element tidak ditemukan');
            return false;
        }

        editorEl.focus();

        const slate = findSlateEditor(editorEl);
        let inserted = false;

        if (slate) {
            try {
                if (typeof slate.insertText === 'function') {
                    slate.insertText(text + ' ');
                    if (typeof slate.onChange === 'function') slate.onChange();
                    inserted = true;
                    log('Teks disisipkan via Slate API');
                }
            } catch (e) {
                log('Slate insert error:', e);
            }
        }

        if (!inserted) {
            try {
                const dt = new DataTransfer();
                dt.setData('text/plain', text + ' ');
                editorEl.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: text + ' ',
                    dataTransfer: dt,
                    composed: true
                }));
                inserted = true;
                log('Teks disisipkan via InputEvent');
            } catch (e) { /* fallback */ }
        }

        if (!inserted) {
            try {
                document.execCommand('insertText', false, text + ' ');
                inserted = true;
                log('Teks disisipkan via execCommand');
            } catch (e) { /* fallback */ }
        }

        if (inserted && shouldPressEnter) {
            setTimeout(() => {
                pressEnterOnEditor(editorEl);
                log('Enter ditekan untuk mengirim pesan');
            }, 80);
        }

        return inserted;
    }

    // ─── Intercept Click & Mousedown pada Picker (Emoji & Sticker) ──────

    function handlePickerInteraction(e) {
        if (!config.enabled) return;

        const target = e.target;
        if (!target) return;

        // ══════════════ 1. STICKER INTERCEPTION ══════════════
        const stickerBtn = target.closest(
            '[class*="sticker_"], [class*="stickerNode_"], [class*="stickerItem_"], [data-type="sticker"], [role="gridcell"][id^="sticker-picker-grid-"]'
        );

        if (stickerBtn) {
            // Cek apakah sticker ini unsendable / terkunci
            const isUnsendable = Boolean(
                target.closest('[class*="stickerUnsendable_"], [class*="unsendable_"]') ||
                stickerBtn.querySelector('[class*="stickerUnsendable_"], [class*="unsendable_"]') ||
                stickerBtn.className.includes('Unsendable') ||
                stickerBtn.className.includes('unsendable') ||
                stickerBtn.closest('[class*="categorySectionNitroLocked_"]')
            );

            if (isUnsendable) {
                // BLOKIR MODAL NITRO SEKETIKA di semua fase event (pointerdown, mousedown, mouseup, click)
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                // Eksekusi pengiriman hanya satu kali per klik (debounce 350ms)
                const now = Date.now();
                if (now - state.lastActionTime < 350) return;
                state.lastActionTime = now;

                // Ambil ID stiker dari button, img, atau atribut data-id
                const img = stickerBtn.querySelector('img') || (target.tagName === 'IMG' ? target : null);
                let stickerId = stickerBtn.getAttribute('data-id') || (img && img.getAttribute('data-id'));

                if (!stickerId && img && img.src) {
                    const match = img.src.match(/\/stickers\/(\d+)/);
                    if (match) stickerId = match[1];
                }

                if (!stickerId) {
                    const outerSticker = target.closest('[data-id]');
                    if (outerSticker) stickerId = outerSticker.getAttribute('data-id');
                }

                if (stickerId) {
                    const formatType = Number(stickerBtn.getAttribute('data-format-type')) ||
                        (img && img.getAttribute('data-format-type')) || 1;
                    const isGif = formatType === 4 || (img && img.src && img.src.includes('.gif'));
                    const ext = isGif ? 'gif' : 'png';
                    const stickerUrl = `https://media.discordapp.net/stickers/${stickerId}.${ext}?size=${config.stickerSize || 160}`;

                    log('Sticker Nitro terkunci diklik -> Kirim langsung:', stickerUrl);
                    sendStickerMessage(stickerUrl);
                } else {
                    log('Sticker ID tidak ditemukan pada:', stickerBtn);
                }
                return;
            }
        }

        // ══════════════ 2. EMOJI INTERCEPTION ══════════════
        const emojiBtn = target.closest(
            'button[class*="emojiItem_"], [data-type="emoji"], li[id^="emoji-picker-grid-"] button'
        );

        if (emojiBtn) {
            const isLockedCategory = Boolean(emojiBtn.closest('[class*="categorySectionNitroLocked_"]'));
            const lockedImg = emojiBtn.querySelector('img[class*="lockedEmoji_"]') ||
                (target.tagName === 'IMG' && target.className.includes('lockedEmoji'));

            const isLocked = isLockedCategory || Boolean(lockedImg);

            if (isLocked) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const now = Date.now();
                if (now - state.lastActionTime < 350) return;
                state.lastActionTime = now;

                const img = emojiBtn.querySelector('img') || (target.tagName === 'IMG' ? target : null);
                let emojiId = emojiBtn.getAttribute('data-id');

                if (!emojiId && img && img.src) {
                    const match = img.src.match(/\/emojis\/(\d+)/);
                    if (match) emojiId = match[1];
                }

                if (emojiId) {
                    const isGif = (img && img.src && img.src.includes('.gif')) ||
                        (img && img.alt && img.alt.startsWith('<a:'));
                    const ext = isGif ? 'gif' : 'webp';
                    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=${config.emojiSize || 48}&quality=${config.quality || 'lossless'}`;

                    log('Emoji terkunci diklik -> Sisipkan:', emojiUrl);
                    insertTextToChat(emojiUrl, false);
                }
            }
        }
    }

    // ─── Intercept Keyboard Input (Mengonversi kode emoji) ──────────────

    function handleChatKeydown(e) {
        if (!config.enabled) return;
        if (e.key !== 'Enter' || e.shiftKey) return;

        const input = getComposerElement();
        if (!input || !input.textContent) return;

        const text = input.textContent;
        const customEmojiRegex = /<(a?):([a-zA-Z0-9_~]+):(\d+)>/g;

        if (customEmojiRegex.test(text)) {
            const replaced = text.replace(customEmojiRegex, (full, animated, name, id) => {
                const ext = animated ? 'gif' : 'webp';
                return `https://cdn.discordapp.com/emojis/${id}.${ext}?size=${config.emojiSize || 48}&quality=${config.quality || 'lossless'}`;
            });

            if (replaced !== text) {
                e.preventDefault();
                insertTextToChat(replaced, false);
            }
        }
    }

    // ─── Init & Start ───────────────────────────────────────────────────

    function start() {
        if (!config.enabled) return;

        if (config.unlockPicker) {
            injectStyles();
        }

        setTimeout(getDiscordChatAPI, 1000);

        // Tangkap event pointerdown, mousedown, mouseup, dan click dengan capture: true
        const events = ['pointerdown', 'mousedown', 'mouseup', 'click'];
        for (const ev of events) {
            document.addEventListener(ev, handlePickerInteraction, true);
            state.interceptHandlers.push({ event: ev, handler: handlePickerInteraction });
        }

        document.addEventListener('keydown', handleChatKeydown, true);
        state.interceptHandlers.push({ event: 'keydown', handler: handleChatKeydown });

        log(`Fake Nitro Emojis & Stickers v${VERSION} aktif.`);
    }

    function stop() {
        if (state.styleEl) {
            state.styleEl.remove();
            state.styleEl = null;
        }

        for (const item of state.interceptHandlers) {
            try {
                document.removeEventListener(item.event, item.handler, true);
            } catch (e) { /* ignored */ }
        }
        state.interceptHandlers = [];

        log('Fake Nitro Emojis & Stickers dinonaktifkan.');
    }

    window.__fakeNitroEmojis = {
        version: VERSION,
        config,
        start,
        stop,
        sendStickerMessage,
        insertTextToChat
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
