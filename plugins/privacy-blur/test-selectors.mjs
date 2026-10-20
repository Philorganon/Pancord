/**
 * Uji regresi privacy-blur: cocokkan selector yang dihasilkan ke nama class Discord ASLI
 * (sampel diambil dari DOM Discord app-1.0.9261 milik pengguna).
 *
 * Jalankan: node plugins/privacy-blur/test-selectors.mjs
 * Berguna setiap kali Discord mengubah pola nama class-nya.
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

// ─── DOM mini ───────────────────────────────────────────────────────────────
function createClassList(el) {
    const read = () => String(el.className || '').split(/\s+/).filter(Boolean);
    return { add() {}, remove() {}, contains: (n) => read().includes(n), toggle: () => false };
}
function createElement(tag) {
    const el = {
        tagName: String(tag).toUpperCase(), children: [], attributes: {}, listeners: {},
        parentNode: null, id: '', className: '', textContent: '', style: {},
        appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
        removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
        setAttribute(n, v) { el.attributes[n] = String(v); },
        getAttribute(n) { return Object.prototype.hasOwnProperty.call(el.attributes, n) ? el.attributes[n] : null; },
        removeAttribute(n) { delete el.attributes[n]; },
        addEventListener() {}, removeEventListener() {},
        querySelectorAll() { return []; }
    };
    el.classList = createClassList(el);
    return el;
}
function createDocument(styleSink) {
    const html = createElement('html');
    const head = createElement('head');
    const body = createElement('body');
    html.appendChild(head); html.appendChild(body);

    const create = (tag) => {
        const el = createElement(tag);
        if (tag === 'style') {
            Object.defineProperty(el, 'textContent', {
                get: () => styleSink.css || '',
                set: (value) => { styleSink.css = value; },
                configurable: true
            });
        }
        return el;
    };

    return {
        documentElement: html, head, body, createElement: create,
        getElementById: () => null, querySelector: () => null,
        addEventListener() {}, removeEventListener() {}
    };
}

// ─── Jalankan plugin, ambil CSS ─────────────────────────────────────────────
function runHarness(config) {
    const styleSink = {};
    const doc = createDocument(styleSink);
    const fakeConsole = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
    const window = {
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        addEventListener() {}, removeEventListener() {}
    };
    const sandbox = { window, document: doc, console: fakeConsole, setInterval, clearInterval, setTimeout, clearTimeout };

    vm.createContext(sandbox);
    vm.runInContext(`window.__PRIVACY_BLUR_CONFIG__ = ${JSON.stringify(config)};`, sandbox);
    vm.runInContext(SOURCE, sandbox, { filename: 'inject.js' });

    const css = styleSink.css || '';
    const extract = (prefix) => {
        const found = [];
        const re = new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{`, 'g');
        for (const match of css.matchAll(re)) {
            for (const part of match[0].replace(/\{$/, '').split(',')) {
                const trimmed = part.trim();
                if (trimmed.startsWith(prefix)) found.push(trimmed.slice(prefix.length).trim());
            }
        }
        return found;
    };

    const result = {
        css,
        blur: extract('body.pb-blur'),
        clean: extract('body.pb-clean'),
        stop: () => { try { vm.runInContext('window.__privacyBlur.stop()', sandbox); } catch { /* diabaikan */ } }
    };
    return result;
}

// ─── Matcher (mendukung flag "i" dan bentuk turunan) ───────────────────────
// Contoh selector yang harus dikenali:
//   [class*="avatar" i]
//   [class*="messageContent" i] img
function parseSelector(selector) {
    const m = /^\[class\*=(.?)([^"\]]+)\1(\s+i)?\](?:\s+([a-z]+))?$/i.exec(String(selector).trim());
    if (!m) return null;
    return { needle: m[2], insensitive: !!m[3], tag: m[4] ? m[4].toLowerCase() : null };
}

function matchesAny(selectors, tagName, classList) {
    for (const selector of selectors) {
        const parsed = parseSelector(selector);
        if (!parsed) continue;
        if (parsed.tag && String(tagName).toLowerCase() !== parsed.tag) continue;

        const needle = parsed.insensitive ? parsed.needle.toLowerCase() : parsed.needle;
        const hit = classList.some((c) => (parsed.insensitive ? c.toLowerCase() : c).includes(needle));
        if (hit) return selector;
    }
    return null;
}
const cls = (str) => str.split(/\s+/).filter(Boolean);

// ─── Sampel NYATA dari DOM Discord pengguna ────────────────────────────────
const samples = [
    { what: 'isi pesan', tag: 'div', classes: cls('markup__75297 messageContent_c19a55'), expect: true },
    { what: 'isi pesan yang dibalas', tag: 'div', classes: cls('repliedTextContent_c19a55 markup__75297 messageContent_c19a55'), expect: true },
    { what: 'username', tag: 'span', classes: cls('username_c19a55 dnsFont__89a31 pixelify__89a31 usernameColorOnName_c19a55'), expect: true },
    { what: 'wadah username', tag: 'span', classes: cls('headerText_c19a55'), expect: true },
    { what: 'avatar', tag: 'img', classes: cls('avatar_c19a55 clickable_c19a55'), expect: true },
    { what: 'dekorasi avatar', tag: 'img', classes: cls('avatarDecoration_c19a55'), expect: true },
    { what: 'avatar di balasan (kapital beda)', tag: 'img', classes: cls('replyAvatar_c19a55 clickable_c19a55'), expect: true },
    { what: 'kartu gambar', tag: 'div', classes: cls('imageWrapper imageWrapper_af017a imageZoom_af017a'), expect: true },
    { what: 'isi gambar', tag: 'div', classes: cls('imageContent__0f481 itemContentContainer_f4758a'), expect: true },
    { what: 'gambar sticker', tag: 'img', classes: cls('pngImage__31fc2 stickerAsset__31fc2'), expect: true },
    { what: 'wadah sticker', tag: 'div', classes: cls('assetWrapper__31fc2'), expect: true },
    { what: 'sticker lottie', tag: 'canvas', classes: cls('lottieCanvas__31fc2 stickerAsset__31fc2'), expect: true },
    { what: 'ikon server di sidebar', tag: 'div', classes: cls('listItemWrapper__91816'), expect: true },
    { what: 'ikon server di dalam folder', tag: 'div', classes: cls('icon_f34534 folderPreviewGuildIcon__48112 iconSizeMini_f34534 iconInactive_f34534'), expect: true },
    { what: 'nama server (tooltip)', tag: 'span', classes: cls('guildNameText_b1f768 guildNameTextLimitedSize_b1f768'), expect: true },
    { what: 'ikon folder server', tag: 'div', classes: cls('folderIcon__48112'), expect: true },
    { what: 'scrollbar sidebar server (jangan)', tag: 'div', classes: cls('scroller_ef3116 scrollbarGutterStable_d125d2 scrollerBase_d125d2'), expect: false },
    { what: 'badge notifikasi (ikut ter-blur lewat wrapper, jangan dobel)', tag: 'div', classes: cls('numberBadge__463b7 base__463b7 baseShapeRound__463b7'), expect: false },
    { what: 'daftar pesan (jangan)', tag: 'ol', classes: cls('scrollerInner__36d07'), expect: false },
    { what: 'timestamp (jangan)', tag: 'span', classes: cls('timestamp_c19a55 timestampInline_c19a55'), expect: false },
    { what: 'wadah sticker besar (jangan; anaknya yang di-blur)', tag: 'div', classes: cls('stickerContainer_abd7a8'), expect: false }
];

// ── Jalankan 1: config default (rows mati) ─────────────────────────────────
console.log('-- config default --');
const def = runHarness({ persist: false, guardIntervalMs: 100000 });
check('CSS ter-generate', def.css.length > 100, `${def.css.length} byte`);
check('selector memakai flag "i"', def.blur.every((s) => s.includes(' i]')), def.blur[0] || '(kosong)');

for (const sample of samples) {
    const hit = matchesAny(def.blur, sample.tag, sample.classes);
    if (sample.expect) check(`ter-blur: ${sample.what}`, !!hit, hit ? `(oleh ${hit})` : '<tidak ada>');
    else check(`tidak ter-blur: ${sample.what}`, !hit, hit ? `(kena ${hit})` : '');
}

const rowSample = { tag: 'li', classes: cls('messageListItem__5126c') };
check('grup rows mati secara default', matchesAny(def.blur, rowSample.tag, rowSample.classes) === null);

// ── Bukti bug lama ─────────────────────────────────────────────────────────
console.log('\n-- bukti bug lama --');
check('selector gaya lama gagal pada class berpemisah underscore',
    matchesAny(['[class*="-username"]', '[class*="-messageContent"]'], 'span', cls('username_c19a55 messageContent_c19a55')) === null);
def.stop();

// ── Jalankan 2: rows dinyalakan ───────────────────────────────────────────
console.log('\n-- blur.rows: true --');
const rows = runHarness({ persist: false, guardIntervalMs: 100000, blur: { rows: true } });
const rowHit = matchesAny(rows.blur, rowSample.tag, rowSample.classes);
check('blur.rows menyalakan blur seluruh baris pesan', !!rowHit, rowHit ? `(oleh ${rowHit})` : '<tidak ada>');
check('clean UI lengkap', ['guilds', 'sidebar', 'members', 'panels', 'toolbar'].every((k) => rows.clean.some((s) => s.includes(k))));
check('clean UI tanpa pemisah hyphen', !rows.clean.some((s) => s.includes('[class*="-')));

console.log(`\nselectors: blur=${rows.blur.length} clean=${rows.clean.length}`);
console.log(failures.length === 0 ? 'SEMUA TES LULUS' : `${failures.length} TES GAGAL: ${failures.join(' | ')}`);
rows.stop();
process.exit(failures.length === 0 ? 0 : 1);
