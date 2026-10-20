/**
 * Sound Replacer — script sisi renderer.
 *
 * Mengganti suara bawaan Discord dengan file milikmu.
 *
 * Cara kerjanya: suara UI Discord diambil dari `/assets/<hash16>.mp3`
 * (mis. `/assets/00b48ea9fc787786.mp3` — terverifikasi lewat sniffer di klien asli).
 * Script ini menimpa tiga jalur pemutaran sekaligus:
 *   1. `HTMLMediaElement.prototype.src` (jalan yang dipakai Discord: `el.src = url`)
 *   2. konstruktor `window.Audio` (`new Audio(url)`)
 *   3. `Element.prototype.setAttribute('src', ...)`
 * Sumber suara pengganti adalah `blob:` URL dari base64 yang di-embed saat deploy.
 * `blob:` dipilih karena `data:` ditolak media element Discord
 * ("MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check").
 */
(function () {
    'use strict';

    const LOG_PREFIX = '[SoundReplacer]';
    const VERSION = '1.0.0';

    const DEFAULT_CONFIG = {
        enabled: true,
        file: 'messages.mp3',
        hashes: [],
        learn: false,
        verbose: true,
        audioBase64: null,
        mimeType: 'audio/mpeg'
    };

    const CONFIG = Object.assign({}, DEFAULT_CONFIG, window.__SOUND_REPLACER_CONFIG__ || {});

    if (window.__soundReplacer) {
        try { window.__soundReplacer.setConfig(window.__SOUND_REPLACER_CONFIG__ || {}); } catch (e) { /* diabaikan */ }
        return;
    }

    const log = (...args) => console.log(LOG_PREFIX, ...args);
    const dbg = (...args) => { if (CONFIG.verbose) console.log(LOG_PREFIX, ...args); };

    /** Suara bawaan Discord: /assets/<16 hex>.<ext> — relatif maupun absolut. */
    const ASSET_SOUND = /\/assets\/([0-9a-f]{16})\.(mp3|ogg|opus|m4a|wav|flac)(?:[?#]|$)/i;

    const state = {
        blobUrl: null,
        replaced: 0,
        seen: [],
        active: false,
        originals: {}
    };

    // ─── Pencocokan ─────────────────────────────────────────────────────────

    function soundHash(url) {
        if (typeof url !== 'string') return null;
        const match = ASSET_SOUND.exec(url);
        return match ? match[1].toLowerCase() : null;
    }

    function shouldReplace(url) {
        const hash = soundHash(url);
        if (!hash) return false;

        const wanted = Array.isArray(CONFIG.hashes) ? CONFIG.hashes : [];
        if (wanted.length > 0 && !wanted.includes(hash)) return false;

        return true;
    }

    function note(url, kind) {
        const hash = soundHash(url);
        const entry = {
            kind,
            url: String(url).slice(0, 200),
            hash,
            at: Date.now(),
            replaced: hash ? shouldReplace(url) : false
        };

        if (hash) {
            state.seen.push(entry);
            if (state.seen.length > 300) state.seen.shift();

            if (CONFIG.learn) {
                log(`terdeteksi [${kind}] hash=${hash} ${entry.replaced ? '→ DIGANTI' : '→ dibiarkan'}`);
            }
            if (entry.replaced) dbg(`ganti suara ${hash} via ${kind}`);
        }

        return entry;
    }

    // ─── Blob ───────────────────────────────────────────────────────────────

    function makeBlobUrl() {
        if (!CONFIG.audioBase64) return null;

        try {
            const binary = atob(CONFIG.audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const blob = new Blob([bytes], { type: CONFIG.mimeType || 'audio/mpeg' });
            return URL.createObjectURL(blob);
        } catch (err) {
            log('gagal membuat blob URL:', (err && err.message) || err);
            return null;
        }
    }

    // ─── Pemasangan hook ────────────────────────────────────────────────────

    function install() {
        if (state.active) return;

        // 1. HTMLMediaElement.prototype.src — jalur utama Discord
        const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        if (srcDescriptor && srcDescriptor.set) {
            state.originals.srcDescriptor = srcDescriptor;

            Object.defineProperty(HTMLMediaElement.prototype, 'src', {
                configurable: true,
                enumerable: srcDescriptor.enumerable,
                get: srcDescriptor.get,
                set(value) {
                    try {
                        if (state.blobUrl && shouldReplace(value)) {
                            note(value, 'media.src');
                            state.replaced += 1;
                            return srcDescriptor.set.call(this, state.blobUrl);
                        }
                        note(value, 'media.src');
                    } catch (e) { /* jangan pernah menggangu pemutaran */ }
                    return srcDescriptor.set.call(this, value);
                }
            });
        }

        // 2. new Audio(url)
        const OriginalAudio = window.Audio;
        if (typeof OriginalAudio === 'function') {
            state.originals.Audio = OriginalAudio;

            window.Audio = new Proxy(OriginalAudio, {
                construct(target, args) {
                    const first = args[0];
                    try {
                        if (state.blobUrl && shouldReplace(first)) {
                            note(first, 'new Audio');
                            state.replaced += 1;
                            return Reflect.construct(target, [state.blobUrl].concat(Array.prototype.slice.call(args, 1)));
                        }
                        if (typeof first === 'string') note(first, 'new Audio');
                    } catch (e) { /* diabaikan */ }
                    return Reflect.construct(target, args);
                }
            });
        }

        // 3. setAttribute('src', ...) — sebagian kode memakai jalur ini
        const originalSetAttribute = Element.prototype.setAttribute;
        state.originals.setAttribute = originalSetAttribute;

        Element.prototype.setAttribute = function (name, value) {
            try {
                if (String(name).toLowerCase() === 'src'
                    && typeof HTMLMediaElement !== 'undefined'
                    && this instanceof HTMLMediaElement
                    && state.blobUrl
                    && shouldReplace(value)) {
                    note(value, 'setAttribute');
                    state.replaced += 1;
                    return originalSetAttribute.call(this, name, state.blobUrl);
                }
            } catch (e) { /* diabaikan */ }
            return originalSetAttribute.call(this, name, value);
        };

        state.active = true;
    }

    function uninstall() {
        if (!state.active) return;

        try {
            if (state.originals.srcDescriptor) {
                Object.defineProperty(HTMLMediaElement.prototype, 'src', state.originals.srcDescriptor);
            }
            if (state.originals.Audio) window.Audio = state.originals.Audio;
            if (state.originals.setAttribute) Element.prototype.setAttribute = state.originals.setAttribute;
        } catch (e) {
            log('gagal melepas hook:', (e && e.message) || e);
        }

        state.active = false;
    }

    // ─── API publik ─────────────────────────────────────────────────────────

    window.__soundReplacer = {
        version: VERSION,
        config: CONFIG,

        status: () => ({
            version: VERSION,
            active: state.active,
            enabled: CONFIG.enabled !== false,
            file: CONFIG.file,
            mimeType: CONFIG.mimeType,
            hasAudio: !!CONFIG.audioBase64,
            scope: Array.isArray(CONFIG.hashes) && CONFIG.hashes.length > 0 ? CONFIG.hashes : 'semua suara bawaan',
            learn: !!CONFIG.learn,
            replaced: state.replaced,
            detected: state.seen.length,
            blobUrl: state.blobUrl
        }),

        /** Daftar suara bawaan yang pernah terdeteksi (termasuk hash-nya). */
        seen: () => state.seen.slice(-40),

        /** Hash unik yang pernah terdeteksi — pakai ini untuk mengisi config `hashes`. */
        hashes: () => Array.from(new Set(state.seen.map((e) => e.hash).filter(Boolean))),

        setConfig: (next) => {
            Object.assign(CONFIG, next || {});
            if (typeof next?.audioBase64 === 'string' && next.audioBase64 !== state.originals.audioBase64) {
                if (state.blobUrl) { try { URL.revokeObjectURL(state.blobUrl); } catch (e) { /* diabaikan */ } }
                state.blobUrl = makeBlobUrl();
            }
            return window.__soundReplacer.status();
        },

        stop: () => {
            uninstall();
            if (state.blobUrl) {
                try { URL.revokeObjectURL(state.blobUrl); } catch (e) { /* diabaikan */ }
                state.blobUrl = null;
            }
            log('dimatikan — suara Discord kembali normal');
        }
    };

    // ─── Inisialisasi ───────────────────────────────────────────────────────

    if (CONFIG.enabled === false) {
        log('dimatikan lewat config (enabled: false)');
        return;
    }

    state.blobUrl = makeBlobUrl();

    if (!state.blobUrl) {
        log('tidak ada file suara yang di-embed — plugin tidak aktif. Simpan file di sounds/ dan jalankan injector lagi.');
        return;
    }

    install();

    const sizeKb = Math.round((CONFIG.audioBase64.length * 3) / 4 / 1024);
    log(`v${VERSION} aktif — "${CONFIG.file}" (±${sizeKb} KB) akan menggantikan ${
        Array.isArray(CONFIG.hashes) && CONFIG.hashes.length > 0 ? `hash ${CONFIG.hashes.join(', ')}` : 'semua suara bawaan Discord'
    }`);
    log('Cek: window.__soundReplacer.status() — daftar hash: window.__soundReplacer.hashes()');
    if (CONFIG.learn) log('mode learn aktif: setiap suara bawaan yang diputar akan dicatat di console');
})();
