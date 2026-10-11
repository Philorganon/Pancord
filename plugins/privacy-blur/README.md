# Privacy Blur

Mode aman untuk share screen, live streaming, atau screenshot: satu hotkey untuk memblur semua hal
yang sensitif, satu hotkey lagi untuk menyembunyikan panel Discord.

- `Ctrl + Shift + B` → **Blur**: avatar, username, isi pesan, gambar, nama channel
- `Ctrl + Shift + U` → **Clean UI**: sidebar guild, sidebar channel, daftar member, panel user, toolbar
- Indikator kecil di kanan bawah (bisa diklik) menampilkan status aktif; otomatis ikut disembunyikan
  saat Clean UI menyala supaya tidak ikut ter-screenshot

Semuanya **lokal dan murni CSS/DOM**: tidak ada request ke API Discord, tidak ada data keluar dari
komputermu.

## Cara kerja

`inject.js` menyuntik satu `<style id="privacy-blur-styles">` ke `<head>` dan menyalakan class di
`<body>`:

| Class di body | Efek |
|---|---|
| `pb-blur` | semua aturan `filter: blur(Npx)` aktif |
| `pb-reveal` | elemen yang di-hover kembali tajam (kalau `revealOnHover: true`) |
| `pb-clean` | semua aturan `display: none` untuk panel aktif |

Selector memakai pencocokan substring (`[class*="-username"]`) karena Discord memberi hash pada nama
class (mis. `c19a557985eb7793-username`) — konvensi yang sama dipakai [src/css/base.css](../../src/css/base.css).
Kalau Discord mengganti nama class setelah update, cukup sesuaikan daftar grup di
[inject.js](inject.js) (`BLUR_GROUPS` / `CLEAN_GROUPS`).

## Konfigurasi

| Key | Default | Keterangan |
|---|---|---|
| `enabled` | `true` | `false` = script dihapus dari `plugin-scripts/` |
| `hotkeyBlur` | `ctrl+shift+b` | hotkey toggle blur |
| `hotkeyCleanUi` | `ctrl+shift+u` | hotkey toggle Clean UI |
| `blurPx` | `8` | kekuatan blur |
| `revealOnHover` | `true` | arahkan kursor ke elemen buram → kembali tajam sementara |
| `showIndicator` | `true` | tampilkan pill indikator di kanan bawah |
| `hideIndicatorInCleanUi` | `true` | sembunyikan indikator saat Clean UI aktif (biar bersih di screenshot) |
| `persist` | `true` | ingat status terakhir di localStorage, bertahan setelah reload |
| `blurOnStart` | `false` | nyalakan blur sejak Discord start (kalau belum ada status tersimpan) |
| `cleanUiOnStart` | `false` | idem untuk Clean UI |
| `guardIntervalMs` | `5000` | jeda pengecekan ulang; style/indikator dipasang lagi kalau Discord menghapusnya |
| `blur.*` | semua `true` | `avatars`, `usernames`, `text`, `images`, `channels` |
| `cleanUi.*` | semua `true` | `guilds`, `sidebar`, `members`, `panels`, `toolbar` |

Contoh: hanya blur nama & avatar, jangan sembunyikan toolbar saat Clean UI:

```json
{
  "blurPx": 12,
  "blur": { "text": false, "images": false, "channels": false },
  "cleanUi": { "toolbar": false }
}
```

Simpan sebagai `plugins/privacy-blur/config.json`, lalu jalankan injector lagi agar config ter-deploy.

## Kontrol manual

```js
window.__privacyBlur.toggleBlur();
window.__privacyBlur.toggleCleanUi();
window.__privacyBlur.setBlur(true);
window.__privacyBlur.status();                     // grup mana yang aktif, gaya ter-inject atau tidak
window.__privacyBlur.setConfig({ blurPx: 16 });    // berlaku langsung tanpa reload
window.__privacyBlur.stop();                       // lepas semua (hotkey, style, indikator)
```

## Troubleshooting

| Gejala | Sebab / solusi |
|---|---|
| Ada elemen yang tetap jelas | Nama class-nya berubah / belum tercakup — tambahkan selector ke grup yang sesuai di `BLUR_GROUPS` |
| Hotkey tidak jalan | Fokus sedang di kolom ketik (memang sengaja diabaikan), atau hotkey bentrok dengan aplikasi lain — ganti `hotkeyBlur` |
| Indikator hilang | `showIndicator: false`, atau sedang Clean UI; cek `window.__privacyBlur.status()` |
| Blur tidak kembali saat hover | `revealOnHover: false` |
| Ingin bersih total sebelum screenshot | Nyalakan Clean UI — indikator otomatis ikut disembunyikan |
