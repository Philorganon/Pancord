# Edit History

Mencatat **versi lama setiap pesan yang diedit**, menandainya dengan badge kecil, dan menampilkan panel
riwayat berisi semua versi + tombol salin.

Semua data lokal (localStorage Discord), tidak ada yang dikirim ke mana pun dan tidak ada request API.

## Mengapa ini bisa tahu isi sebelum diedit

Discord memproses `MESSAGE_UPDATE` lewat FluxDispatcher. Plugin ini menimpa
`FluxDispatcher.dispatch` dan membaca isi lama dari `MessageStore` **sebelum** store sempat
memperbarui dirinya, lalu membandingkannya dengan isi baru di aksi tersebut:

```
MESSAGE_UPDATE masuk
   └─ plugin membaca MessageStore.getMessage(...)   → isi LAMA
   └─ plugin membaca action.message.content         → isi BARU
   └─ beda? simpan versi lama, update baseline
   └─ baru diteruskan ke store Discord (perilaku asli tidak diubah)
```

Baseline tambahan diambil dari `MESSAGE_CREATE` dan `LOAD_MESSAGES_SUCCESS`, jadi pesan yang baru
dimuat pun sudah punya pembanding. Kalau `dispatch` tidak bisa ditimpa (Discord mengubah strukturnya),
plugin otomatis pindah ke mode `subscribe` — lihat `window.__editHistory.status().usingFallback`.

## Cara membuka riwayat

Badge sengaja dibuat sebagai pseudo-element CSS + atribut `data-eh-versions` pada elemen pesan,
**bukan** node baru di dalam pohon React — supaya tidak mengganggu rendering/virtualisasi Discord.

| Aksi | Hasil |
|---|---|
| `Alt` + klik pada pesan berbadge | panel riwayat pesan itu |
| `Ctrl + Shift + E` | panel untuk pesan terakhir yang tercatat diedit |
| `Esc` | tutup panel |
| Arahkan kursor ke pesan berbadge | tooltip "Diedit N× — Alt+klik untuk riwayat" |

## Konfigurasi

| Key | Default | Keterangan |
|---|---|---|
| `enabled` | `true` | `false` = script dihapus dari `plugin-scripts/` |
| `persist` | `true` | simpan riwayat ke localStorage, bertahan setelah reload |
| `maxVersions` | `10` | versi lama maksimum per pesan |
| `maxMessages` | `500` | jumlah pesan yang dilacak (yang tertua dibuang lebih dulu) |
| `maxContentChars` | `2000` | potong isi versi yang sangat panjang |
| `showBadge` | `true` | tampilkan badge jumlah edit di pesan |
| `hotkeyShowLast` | `ctrl+shift+e` | hotkey panel untuk edit terakhir |
| `logEdits` | `false` | log tiap edit yang tertangkap ke console |
| `panelMaxHeightPx` | `420` | tinggi maksimum panel |
| `saveDebounceMs` | `1500` | jeda sebelum menyimpan ke localStorage |
| `guardIntervalMs` | `3000` | jeda percobaan ulang kalau FluxDispatcher belum ketemu saat start |

Simpan sebagai `plugins/edit-history/config.json`, lalu jalankan injector lagi agar config ter-deploy.

## Kontrol manual

```js
window.__editHistory.status();          // dipatch? fallback? berapa pesan/versi tercatat?
window.__editHistory.history('ID_PESAN'); // daftar versi: [{ at, content }, ...]
window.__editHistory.openPanel('ID_PESAN');
window.__editHistory.saveNow();          // paksa simpan ke localStorage
window.__editHistory.clearAll();         // hapus semua riwayat + badge + data tersimpan
window.__editHistory.stop();             // lepas patch dispatch, observer, listener, badge
```

## Batasan (jujur)

- Riwayat hanya tercatat **selama plugin aktif**, kecuali yang sudah tersimpan di localStorage dari sesi
  sebelumnya. Edit yang terjadi saat Discord mati tidak bisa direkonstruksi — Discord memang tidak
  menyimpannya.
- Data per-komputer/per-akun (localStorage), tidak tersinkron ke device lain.
- Edit yang hanya mengubah embed/lampiran (tanpa perubahan teks) tidak dianggap edit teks.
- Versi lama dipotong pada `maxContentChars`, dan yang tertua dibuang saat melewati `maxVersions`.

## Troubleshooting

| Gejala | Sebab / solusi |
|---|---|
| Badge tidak muncul | Cek `window.__editHistory.status()`: `listFound` harus `true`. Kalau `false`, Discord belum render daftar pesan — buka sebuah channel |
| `hasMessageStore: false` | Struktur modul internal Discord berubah → predikat di `resolveModules()` perlu disesuaikan |
| `patchedDispatch: false, usingFallback: true` | `dispatch` tidak bisa ditimpa; plugin tetap jalan lewat `subscribe`, tapi pesan lama tanpa baseline tidak bisa dicatat |
| Panel kosong / pesan "belum ada riwayat" | Pesan itu memang belum pernah diedit, atau edit terjadi sebelum plugin aktif |
| Riwayat hilang setelah bersih-bersih browser | localStorage Discord dibersihkan — itu memang tempat penyimpanannya |
| Keluar peringatan kuota localStorage | Riwayat lama otomatis dibuang sebagian; kecilkan `maxMessages`/`maxVersions` |
