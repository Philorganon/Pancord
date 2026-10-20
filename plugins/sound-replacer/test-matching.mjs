/**
 * Uji regresi sound-replacer: pakai URL suara NYATA yang tertangkap dari klien Discord
 * (app-1.0.9261) lewat sniffer, jadi pola pencocokannya benar-benar terverifikasi.
 *
 * Jalankan: node plugins/sound-replacer/test-matching.mjs
 */
import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';

const SOURCE = fs.readFileSync(fileURLToPath(new URL('./inject.js', import.meta.url)), 'utf8');

const failures = [];
function check(label, condition, extra = '') {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
    if (!condition) failures.push(label);
}

// WAV kecil (0.1s senyap) supaya blob benar-benar bisa dibuat.
function tinyWavBase64() {
    const rate = 8000;
    const len = Math.floor(rate * 0.1);
    const bytes = new Uint8Array(44 + len);
    const dv = new DataView(bytes.buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(i + o, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + len, true); w(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    w(36, 'data'); dv.setUint32(40, len, true);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return Buffer.from(bin, 'binary').toString('base64');
}

// ─── DOM mini: cukup untuk src/Audio/setAttribute ───────────────────────────
class FakeElement {
    constructor() { this.attributes = {}; }
    setAttribute(name, value) { this.attributes[String(name).toLowerCase()] = String(value); }
    getAttribute(name) { return this.attributes[String(name).toLowerCase()] ?? null; }
}
class FakeMediaElement extends FakeElement {}
Object.defineProperty(FakeMediaElement.prototype, 'src', {
    configurable: true,
    get() { return this._src || ''; },
    set(value) { this._src = String(value); }
});
class FakeAudio extends FakeMediaElement {
    constructor(src) {
        super();
        if (src !== undefined) this.src = src;
    }
}

function runHarness(config) {
    const sandbox = {
        window: { Audio: FakeAudio },
        HTMLMediaElement: FakeMediaElement,
        Element: FakeElement,
        Blob,
        URL,
        atob,
        console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
        performance: { now: () => Date.now() }
    };

    vm.createContext(sandbox);
    vm.runInContext(`window.__SOUND_REPLACER_CONFIG__ = ${JSON.stringify(config)};`, sandbox);
    vm.runInContext(SOURCE, sandbox, { filename: 'inject.js' });

    return {
        sandbox,
        api: () => sandbox.window.__soundReplacer,
        newMedia: () => new FakeMediaElement(),
        newAudio: (src) => new FakeAudio(src),
        blobUrl: () => sandbox.window.__soundReplacer.status().blobUrl
    };
}

const baseConfig = {
    enabled: true,
    file: 'unit-test.wav',
    hashes: [],
    learn: false,
    verbose: false,
    audioBase64: tinyWavBase64(),
    mimeType: 'audio/wav'
};

// URL suara asli hasil sniffer di klien pengguna
const REAL_RELATIVE = '/assets/00b48ea9fc787786.mp3';
const REAL_ABSOLUTE = 'https://discord.com/assets/00b48ea9fc787786.mp3';
const OTHER_SOUND = '/assets/16d261c6a0cb8080.mp3';
const VOICE_MESSAGE = 'https://cdn.discordapp.com/attachments/123/456/voice-message.ogg';

// ── 1. Scope "semua suara bawaan" ──────────────────────────────────────────
{
    const h = runHarness(baseConfig);
    const blob = h.blobUrl();
    check('blob URL dibuat', typeof blob === 'string' && blob.startsWith('blob:'), String(blob));
    check('status melaporkan aktif', h.api().status().active === true);

    const media = h.newMedia();
    media.src = REAL_RELATIVE;
    check('src relatif /assets/<hash>.mp3 diganti', media.src === blob, media.src);
    check('penghitung replaced naik', h.api().status().replaced >= 1, String(h.api().status().replaced));

    const media2 = h.newMedia();
    media2.src = REAL_ABSOLUTE;
    check('src absolut discord.com/assets diganti', media2.src === blob, media2.src);

    const audio = h.newAudio(OTHER_SOUND);
    check('new Audio(<suara bawaan>) diganti', audio.src === blob, audio.src);

    const media3 = h.newMedia();
    media3.setAttribute('src', '/assets/d5e69d2c2aac0a27.mp3');
    check('setAttribute("src", ...) diganti', media3.getAttribute('src') === blob, String(media3.getAttribute('src')));

    const media4 = h.newMedia();
    media4.src = VOICE_MESSAGE;
    check('pesan suara pengguna TIDAK diganti', media4.src === VOICE_MESSAGE, media4.src);

    const media5 = h.newMedia();
    media5.src = 'https://cdn.discordapp.com/soundboard-sounds/123456';
    check('soundboard TIDAK diganti', media5.src === 'https://cdn.discordapp.com/soundboard-sounds/123456', media5.src);

    const media6 = h.newMedia();
    media6.src = 'https://example.com/music/song.mp3';
    check('mp3 non-Discord TIDAK diganti', media6.src === 'https://example.com/music/song.mp3', media6.src);

    check('hash yang terdeteksi terkumpul', h.api().hashes().length >= 3, JSON.stringify(h.api().hashes()));
    h.api().stop();
}

// ── 2. Scope hash tertentu saja ────────────────────────────────────────────
{
    const h = runHarness({ ...baseConfig, hashes: ['00b48ea9fc787786'] });
    const blob = h.blobUrl();

    const target = h.newMedia();
    target.src = REAL_RELATIVE;
    check('hash terdaftar diganti', target.src === blob, target.src);

    const other = h.newMedia();
    other.src = OTHER_SOUND;
    check('hash lain dibiarkan', other.src === OTHER_SOUND, other.src);
    h.api().stop();
}

// ── 3. Mode learn mencatat hash ────────────────────────────────────────────
{
    const h = runHarness({ ...baseConfig, learn: true });
    const media = h.newMedia();
    media.src = OTHER_SOUND;
    const seen = h.api().seen();
    check('mode learn mencatat suara yang terdeteksi',
        seen.length >= 1 && seen[seen.length - 1].hash === '16d261c6a0cb8080',
        JSON.stringify(seen.slice(-2)));
    check('entri mencatat jenis jalur pemutaran', seen[seen.length - 1].kind === 'media.src');
    h.api().stop();
}

// ── 4. stop() mengembalikan perilaku normal ────────────────────────────────
{
    const h = runHarness(baseConfig);
    const before = h.newMedia();
    before.src = REAL_RELATIVE;
    check('sebelum stop: diganti', before.src.startsWith('blob:'), before.src);

    h.api().stop();
    check('setelah stop: status nonaktif', h.api().status().active === false);

    const after = h.newMedia();
    after.src = REAL_RELATIVE;
    check('setelah stop: src asli dipakai', after.src === REAL_RELATIVE, after.src);

    const afterAudio = h.newAudio(REAL_RELATIVE);
    check('setelah stop: konstruktor Audio dipulihkan', afterAudio.src === REAL_RELATIVE, afterAudio.src);
    check('setelah stop: setAttribute dipulihkan', (() => {
        const m = h.newMedia();
        m.setAttribute('src', REAL_RELATIVE);
        return m.getAttribute('src') === REAL_RELATIVE;
    })());
}

// ── 5. enabled:false tidak menyentuh apa pun ───────────────────────────────
{
    const h = runHarness({ ...baseConfig, enabled: false });
    check('enabled:false → tidak aktif', h.api().status().active === false);
    const media = h.newMedia();
    media.src = REAL_RELATIVE;
    check('enabled:false → src dibiarkan', media.src === REAL_RELATIVE, media.src);
}

// ── 6. Tanpa audio yang di-embed ───────────────────────────────────────────
{
    const h = runHarness({ ...baseConfig, audioBase64: null });
    check('tanpa base64 → tidak aktif', h.api().status().active === false);
    check('tanpa base64 → hasAudio false', h.api().status().hasAudio === false);
}

console.log(failures.length === 0 ? '\nSEMUA TES LULUS' : `\n${failures.length} TES GAGAL: ${failures.join(' | ')}`);
process.exit(failures.length === 0 ? 0 : 1);
