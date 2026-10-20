# Split View (Pancord Plugin)

Plugin untuk membagi layar chat Discord menjadi dua kolom berdampingan (*side-by-side*) untuk multitasking multi-channel atau DM.

## Fitur Utama

- **Dual Chat Side-by-Side**: Buka dua channel atau DM sekaligus tanpa bolak-balik klik server.
- **Header Toolbar Button**: Tombol ikon split langsung di toolbar atas Discord di sebelah icon Search/Pinned messages.
- **Keyboard Shortcut**: Tekan `Ctrl + \` untuk membuka/menutup split panel secara instan.
- **Embedded Webview**: Menampilkan antarmuka Discord sekunder lengkap yang terintegrasi secara mulus.

## Konfigurasi (`manifest.json`)

```json
{
  "enabled": true,
  "hotkey": "ctrl+\\",
  "defaultSplitRatio": 50,
  "showToolbarButton": true,
  "saveLastChannel": true
}
```

## Penggunaan

1. Klik tombol **Split View** di toolbar atas kanan chat Discord atau tekan **Ctrl + \\**.
2. Masukkan URL channel tujuan pada bar input di bagian atas panel split.
3. Anda kini dapat memantau dan mengirim pesan di kedua channel secara bersamaan!
