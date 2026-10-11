# Live Bridge

Debug renderer Discord dari terminal injector: lihat log Discord, jalankan kode di dalam Discord, dan
reload renderer tanpa menutup aplikasi.

- **Dari Discord ke terminal:** semua `console.log/info/warn/error/debug`, error tak tertangkap
  (`window.onerror`), dan unhandled rejection.
- **Dari terminal ke Discord:** `eval` kode arbitrer di renderer, dan `reload` (setara Ctrl+R — `dom-ready`
  menyusul, jadi **semua plugin-scripts dimuat ulang** dengan isi terbaru).

## Kenapa HTTP long-poll, bukan WebSocket

Discord memasang CSP yang memblokir `ws://localhost` dari halaman `https`, tapi **mengizinkan
`http://localhost`**. Jadi renderer yang menarik perintah (`POST /poll`, ditahan sampai 20 detik),
bukan menerima koneksi. Pola yang sama dipakai [discord-mcp-bridge](https://github.com/fagnersales/discord-mcp-bridge).

```
terminal  ──POST /command──▶  server plugin (127.0.0.1:8788)  ──ditunggu poll──▶  renderer Discord
terminal  ◀──hasil eval────   server plugin                   ◀──POST /result──  renderer Discord
terminal  ◀──log Discord────  server plugin                   ◀──logs ikut poll─  renderer Discord
```

## Pakai

1. Aktifkan plugin (lihat README utama) dan jalankan injector — **proses ini harus tetap hidup**,
   karena server bridge berjalan di dalamnya:

   ```bash
   node index.js
   ```

2. Buka Discord. Script ter-deploy otomatis ke `plugin-scripts/live-bridge.js` dan mulai polling.
   Di console Discord akan muncul `[LiveBridge] terhubung ke http://localhost:8788`.

3. Kendalikan dari terminal lain:

   ```bash
   node plugins/live-bridge/cli.mjs status
   node plugins/live-bridge/cli.mjs logs --follow
   node plugins/live-bridge/cli.mjs eval "document.title"
   node plugins/live-bridge/cli.mjs eval "return [...document.querySelectorAll('[class*=\"-username\"]')].slice(0,5).map(e => e.textContent)"
   node plugins/live-bridge/cli.mjs reload
   node plugins/live-bridge/cli.mjs            # mode interaktif
   ```

   Alur kerja yang jadi jauh lebih cepat: ubah `plugins/<nama>/inject.js` → `node index.js` (deploy ulang)
   → `cli.mjs reload` → script baru langsung jalan tanpa restart Discord.

Server bridge sengaja di-`unref()`, jadi perintah sekali-jalan (`node index.js plugins --list`,
`node index.js status`, …) tetap keluar sendiri seperti biasa; server hanya hidup selama proses
injector hidup.

## Perintah CLI

| Perintah | Fungsi |
|---|---|
| `status` | keadaan bridge + apakah renderer terhubung |
| `eval <kode>` | jalankan kode di renderer, tampilkan hasilnya |
| `reload` | reload renderer (plugin-scripts dimuat ulang) |
| `logs [--follow]` | tampilkan log Discord; `--follow` untuk mengalir terus |
| `help` / `quit` | bantuan / keluar dari mode interaktif |

Opsi: `--port <n>`, `--token <t>`, `--url <http://host:port>`, `--limit <n>`, `--follow`.
Default port & token dibaca dari `manifest.json` (dan `config.json` kalau ada).

## Konfigurasi

| Key | Default | Keterangan |
|---|---|---|
| `enabled` | `true` | `false` = server tidak dijalankan dan script dihapus dari `plugin-scripts/` |
| `port` | `8788` | port server; kalau terpakai, otomatis pindah ke port berikutnya |
| `token` | `dsh-live-bridge` | shared secret lokal; renderer dengan token salah langsung berhenti |
| `pollHoldMs` | `20000` | lama poll ditahan server sebelum menjawab "tidak ada perintah" |
| `mirrorRendererLog` | `true` | teruskan log Discord ke terminal injector |
| `commandTimeoutMs` | `30000` | batas tunggu hasil `eval` |

## ⚠️ Keamanan

Selama plugin ini hidup, **siapa pun yang punya token bisa menjalankan JS di Discord-mu** (lewat HTTP
localhost). Karena itu:

- jangan pakai token default kalau komputermu dipakai bersama;
- matikan plugin (`enabled: false`, lalu jalankan injector sekali agar script terhapus dari
  `plugin-scripts/`) kalau tidak sedang dipakai;
- server hanya listen di `127.0.0.1`, tidak terekspos ke jaringan.

## Troubleshooting

| Gejala | Sebab / solusi |
|---|---|
| `cli.mjs` bilang tidak bisa menghubungi bridge | Proses `node index.js` belum jalan (server hidup di dalamnya) atau port berbeda — cek `status` / `--port` |
| `renderer belum terhubung` | Discord belum jalan, atau `plugin-scripts/live-bridge.js` belum ter-deploy; jalankan injector sekali lagi lalu `reload` Discord |
| `[LiveBridge] ditolak server (bad token)` | Token di `manifest.json` berbeda dengan yang dipakai renderer; samakan lalu jalankan injector + reload Discord |
| Log Discord tidak muncul | `mirrorRendererLog: false`, atau log dikirim saat poll berikutnya (maks ~20 detik) |
| `eval` timeout | Server sibuk, atau kode menggantung; coba `--limit` lebih kecil / kode yang tidak menunggu lama |

## Catatan lisensi

Konsep transport (HTTP long-poll karena CSP memblokir `ws://localhost`) mengikuti
[discord-mcp-bridge](https://github.com/fagnersales/discord-mcp-bridge) (GPL-3.0). Implementasi di sini
ditulis ulang untuk injector ini.
