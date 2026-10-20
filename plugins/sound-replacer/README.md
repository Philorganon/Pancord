# Sound Replacer

Mengganti suara bawaan Discord — notifikasi pesan, join/leave voice channel, mute/unmute, dan
sejenisnya — dengan file MP3 milikmu sendiri.

> Menu **10. Notification Sound** di CLI (`node index.js sound`) **tidak bisa bekerja** pada build
> Discord sekarang. Tiga sebabnya: (1) loader menyaring URL yang harus mengandung kata
> `notification`/`message`, padahal suara Discord bernama `/assets/<hash16>.mp3`; (2) semua URL preset
> bawaannya sudah mati (404); (3) file lokal dikirim sebagai `data:` URL, dan media element Discord
> menolaknya (`Media load rejected by URL safety check`). Plugin ini menggantikannya.

## Cara kerja

Suara UI Discord diambil dari `/assets/<hash16>.mp3` — mis. `/assets/00b48ea9fc787786.mp3`
(terverifikasi dengan sniffer langsung di klien). Plugin ini:

1. membaca file dari `sounds/` saat deploy, lalu meng-embed-nya sebagai base64;
2. di renderer, base64 itu diubah jadi **`blob:` URL** (bukan `data:` — sudah diuji: `data:` ditolak,
   `blob:` lolos);
3. menimpa tiga jalur pemutaran sekaligus supaya tidak ada yang bolong:
   - `HTMLMediaElement.prototype.src` ← jalur yang dipakai Discord (`el.src = url`)
   - konstruktor `window.Audio` (`new Audio(url)`)
   - `Element.prototype.setAttribute('src', ...)`

Suara pengguna **tidak** tersentuh: voice message (`cdn.discordapp.com/attachments/...`), soundboard
(`/soundboard-sounds/...`), dan MP3 dari domain lain dibiarkan apa adanya.

## Pakai

1. Taruh file suaramu di folder `sounds/` (mis. `sounds/messages.mp3`).
2. Set nama filenya di config plugin (lihat tabel di bawah) — defaultnya `messages.mp3`:
   `plugins/sound-replacer/config.json`
   ```json
   { "file": "messages.mp3" }
   ```
3. Pastikan plugin aktif di `config.json` utama:
   ```json
   "plugins": { "enabled": ["live-bridge", "privacy-blur", "sound-replacer"] }
   ```
4. Jalankan injector, lalu **`Ctrl+R`** di Discord (atau lewat live-bridge:
   `node plugins/live-bridge/cli.mjs reload`).

## Konfigurasi

| Key | Default | Keterangan |
|---|---|---|
| `enabled` | `true` | `false` = script dihapus dari `plugin-scripts/` |
| `file` | `messages.mp3` | nama file di folder `sounds/` (mp3, ogg, opus, wav, m4a, flac) |
| `hashes` | `[]` | **kosong = ganti semua suara bawaan Discord.** Isi dengan hash untuk membatasi, mis. `["00b48ea9fc787786"]` |
| `learn` | `false` | `true` = catat setiap suara bawaan yang diputar beserta hash-nya (untuk mencari hash tertentu) |
| `verbose` | `true` | log penggantian ke console Discord |

### Membatasi hanya ke suara notifikasi pesan

1. Set `"learn": true`, jalankan injector, `Ctrl+R`.
2. Picu suara yang kamu mau (minta seseorang kirim DM / mention).
3. Di console Discord: `window.__soundReplacer.hashes()` → salin hash yang muncul.
4. Set `"hashes": ["<hash itu>"]`, `"learn": false`, jalankan injector lagi + `Ctrl+R`.

## Verifikasi

```js
window.__soundReplacer.status()    // aktif? file apa? scope-nya apa? berapa kali diganti?
window.__soundReplacer.hashes()    // hash suara bawaan yang pernah terdeteksi
window.__soundReplacer.seen()      // 40 kejadian terakhir: jalur pemutaran + hash + diganti/tidak
window.__soundReplacer.stop()      // lepas semua hook (suara kembali normal tanpa reload)
```

Tes otomatis (memakai URL suara asli hasil sniffer):

```bash
node plugins/sound-replacer/test-matching.mjs
```

## Batasan (jujur)

- Defaultnya mengganti **semua** suara UI bawaan, bukan hanya notifikasi pesan. Pakai `hashes` kalau
  mau memilih.
- Hash suara Discord bisa berubah saat mereka memperbarui klien. Karena itu defaultnya `hashes: []`
  (mengganti berdasarkan pola, bukan hash) — pola `/assets/<16 hex>.<ext>` jauh lebih tahan update
  daripada hash tertentu.
- Plugin ini **tidak** mengubah suara yang diputar lewat Web Audio API (mis. beberapa efek voice),
  hanya yang lewat media element — yaitu jalur yang dipakai suara notifikasi.
- `node index.js sound` (menu 10) tetap ada tapi tidak akan berpengaruh; pakai plugin ini.
