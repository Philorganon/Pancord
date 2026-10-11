# Quest Completer

Plugin untuk Pancord: menjalankan skrip **"Complete Recent Discord Quest"** langsung
sebagai bagian dari injeksi, jadi tidak perlu lagi buka DevTools dan paste ke console setiap kali.

- Skrip asli: [`aamiaa/CompleteDiscordQuest.md`](https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb) (aamiaa, GPL-3.0)
- Versi plugin: port ke `inject.js` + guard anti dobel-inject, `start()`/`stop()` yang mengembalikan
  patch store, hotkey, config, dan mode dry-run.

> ## ⚠️ Risiko
> Otomasi quest **melanggar ToS Discord**. Penulis skrip aslinya menulis *"you WILL get flagged by doing so"*,
> dan sejak **26 Agustus 2026** Discord menangguhkan akses quest untuk akun yang ketahuan mengotomasi quest.
> Karena itu plugin ini **tidak** punya fitur anti-deteksi, dan `autoRun` defaultnya **mati** — quest hanya
> diproses saat kamu menekan hotkey start. Risiko ditanggung sendiri.

## Cara kerja

```
plugins/quest-completer/
├── manifest.json   metadata + default config (hooks: afterInject, onDiscordStart)
├── index.js        sisi Node: cari folder resources Discord, tulis inject.js ke plugin-scripts/
└── inject.js       skrip renderer: resolusi modul Discord + otomasi quest
```

1. Saat injeksi (`afterInject`) atau Discord start (`onDiscordStart`), `index.js` menulis
   `window.__QUEST_COMPLETER_CONFIG__ = {...}` + isi `inject.js` ke `<Discord>/resources/app/plugin-scripts/quest-completer.js`.
2. Loader di `src/injector.js` mengeksekusi semua file di `plugin-scripts/` pada setiap `dom-ready`.
3. `inject.js` memasang hotkey dan menunggu perintah. Modul Discord (`QuestsStore`, `api`, `FluxDispatcher`, …)
   baru diresolusi saat `start()`, jadi tidak masalah kalau Discord belum siap ketika script dimuat.

## Aktivasi

Plugin harus terdaftar di `config.json` agar dimuat saat injector jalan:

```json
"plugins": {
  "enabled": ["quick-send", "pending-friend-tracker", "quest-completer"]
}
```

Lalu:

```bash
node index.js plugins --list      # cek plugin terbaca
node index.js                     # jalankan injector, script ikut ter-deploy
```

Catatan: `node index.js plugins --enable quest-completer` hanya memuat plugin di proses itu, **tidak**
menulis ke `config.json`. Tambahkan manual ke daftar `plugins.enabled` seperti di atas.

## Pakai di Discord

Setelah Discord start (script sudah ter-deploy):

| Aksi | Cara |
|---|---|
| Mulai memproses quest | `Ctrl + Shift + Q` |
| Stop paksa (semua patch dikembalikan) | `Ctrl + Shift + X` |
| Cek status | `window.__questCompleter.status()` |
| Cek modul Discord yang ketemu | `window.__questCompleter.probe()` |
| Mulai / stop manual | `window.__questCompleter.start()` / `.stop()` |

Hotkey diabaikan saat kursor sedang di kolom ketik (chat, search, dsb).

Task yang didukung: `WATCH_VIDEO`, `WATCH_VIDEO_ON_MOBILE`, `PLAY_ON_DESKTOP`, `STREAM_ON_DESKTOP`, `PLAY_ACTIVITY`.
Quest `PLAY_ON_DESKTOP` dan `STREAM_ON_DESKTOP` hanya jalan di aplikasi desktop (bukan browser/Vesktop).
`STREAM_ON_DESKTOP` tetap butuh minimal 1 orang lain di VC, dan untuk task non-video kamu tetap harus
menerima quest-nya sendiri di tab Quests (accept & claim tidak diotomasi).

## Konfigurasi

Edit `config` di `plugins/quest-completer/manifest.json`, atau buat `plugins/quest-completer/config.json`
berisi key yang mau ditimpa (menang di atas manifest).

| Key | Default | Keterangan |
|---|---|---|
| `enabled` | `true` | `false` = script dihapus dari `plugin-scripts/` saat plugin dimuat |
| `autoRun` | `false` | `true` = otomatis mulai begitu modul Discord siap (setiap Discord start) |
| `hotkeyStart` | `ctrl+shift+q` | hotkey untuk mulai |
| `hotkeyStop` | `ctrl+shift+x` | hotkey untuk stop paksa |
| `videoSpeedSeconds` | `7` | besar lompatan timestamp tiap request `/video-progress` (sama seperti skrip asli). Bukan pengali kecepatan — durasi nyata tetap mendekati target quest, hanya jumlah request yang lebih sedikit |
| `playActivityHeartbeatMs` | `20000` | jeda antar heartbeat `PLAY_ACTIVITY` (skrip asli: 20 detik) |
| `onlyTasks` | `[]` | batasi jenis task, mis. `["WATCH_VIDEO"]`. Kosong = semua yang didukung |
| `dryRun` | `false` | `true` = tidak ada request API sungguhan, hanya log alur + resolusi modul. Quest `PLAY_ON_DESKTOP`/`STREAM_ON_DESKTOP` tidak akan pernah selesai di mode ini |
| `verbose` | `true` | log debug (quest yang dilewati, error cleanup) |

Kalau config diubah, jalankan ulang injector (`node index.js`) supaya script ter-deploy dengan nilai baru.

## Troubleshooting

| Gejala | Sebab / solusi |
|---|---|
| `modul inti tidak ditemukan: QuestsStore, api` | Discord mengubah struktur internal modulnya. Jalankan `window.__questCompleter.probe()` untuk lihat store mana yang masih ketemu |
| `webpackChunkdiscord_app belum siap` | Tekan hotkey start lagi beberapa detik kemudian, atau set `autoRun: true` |
| `You don't have any uncompleted quests!` | Tidak ada quest yang enrolled & belum selesai & belum kedaluwarsa |
| `taskData kosong` | Bentuk quest berubah; cek `quest.config.taskConfigV2` di console |
| Semua request HTTP gagal setelah buka DevTools | Bug lama Discord (bukan plugin): tunggu beberapa menit atau restart Discord |
| Quest tidak jalan setelah update Discord | Skrip asli memang sering butuh update mengikuti perubahan internal Discord — cek gist aslinya untuk versi terbaru, lalu sesuaikan predikat di `resolveStores()` |

## Uninstall

1. Hapus `"quest-completer"` dari `plugins.enabled` di `config.json`, atau set `enabled: false` di manifest.
2. Hapus folder `plugins/quest-completer`.
3. Hapus `<Discord>/resources/app/plugin-scripts/quest-completer.js` (atau `enabled: false` lalu muat plugin sekali).

## Lisensi & kredit

Skrip asli oleh **aamiaa**, lisensi **GPL-3.0** — karya turunan ini ikut GPL-3.0.
Jangan sebar ulang sebagai karya sendiri; pertahankan kredit di header `inject.js`.
