# ⏱️ Pending Friend Tracker Plugin

Plugin untuk melacak dan menampilkan **berapa lama seseorang telah berada di daftar pending add friend** (baik permintaan pertemanan masuk maupun terkirim) di Discord.

---

## ✨ Fitur Utama

1. **🏷️ Injeksi Badge Durasi Otomatis di Discord List**:
   - Di tab **Friends (Teman) ➔ Pending (Menunggu)**, plugin akan menyisipkan badge waktu (misal: `⏱️ 3 hari lalu`, `⏱️ 2 minggu lalu`) langsung di sebelah nama user.
   - Arahkan kursor (hover) pada badge untuk melihat tanggal dan jam tepatnya permintaan tersebut dicatat.
   - Peringatan warna merah berkedip halus jika permintaan sudah lebih dari 7 hari (dapat diubah di konfigurasi).

2. **🪟 Interactive Floating Hub & Popup**:
   - Tekan shortcut hotkey <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> atau klik tombol jam di pojok kanan bawah Discord untuk membuka panel tracker.
   - **Tab Permintaan Masuk (Incoming)**: Melihat siapa saja yang mengirim permintaan pertemanan ke Anda dan sudah berapa lama mereka menunggu konfirmasi Anda.
   - **Tab Permintaan Terkirim (Outgoing)**: Melihat siapa saja yang Anda kirimkan permintaan pertemanan dan sudah berapa lama belum di-accept oleh mereka.
   - **Tab Statistik & Analisis**: Menampilkan ringkasan total permintaan pending, permintaan paling lama (oldest), dan permintaan paling baru.

3. **🔍 Pencarian & Pengurutan Cepat**:
   - Cari berdasarkan Display Name, Username (@handle), atau User ID.
   - Urutkan berdasarkan: **Paling Lama (Oldest)**, **Paling Baru (Newest)**, atau **Nama (A-Z)**.

4. **📋 Quick Actions**:
   - Salin User ID dengan 1 klik.
   - Salin ringkasan durasi pending ke clipboard.
   - Ekspor seluruh daftar pending ke format JSON.

5. **💾 Dukungan untuk Pending Lama & Baru**:
   - **Pending Lama (dari Discord Store)**: Plugin otomatis membaca field `since` dan `created_at` dari Discord Relationship Store. Jika Discord masih menyimpan timestamp saat request tersebut dibuat (walau sudah berbulan-bulan lalu), plugin akan langsung menampilkan durasi aslinya (misal: `3 bulan lalu`, `1 tahun lalu`).
   - **Koreksi / Atur Tanggal Manual (Tombol ⏱️)**: Jika Discord tidak memberikan tanggal lampau untuk user tertentu, Anda bisa klik tombol ⏱️ pada card user di popup untuk memasukkan estimasi tanggal atau jumlah hari lalu (contoh: ketik `30` untuk 30 hari lalu, atau `2024-05-20`).
   - **Persistent Local Tracking**: Setiap request yang terdeteksi disimpan permanen di `localStorage` Discord, sehingga hitungan hari tidak akan ter-reset saat Discord di-restart.

---

## ⚙️ Konfigurasi (`manifest.json` / `config.json`)

| Opsi | Tipe | Default | Deskripsi |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` | Mengaktifkan/menonaktifkan plugin |
| `hotkey` | `string` | `"ctrl+shift+p"` | Shortcut keyboard untuk membuka popup |
| `showBadgeInFriendsList` | `boolean` | `true` | Tampilkan badge durasi di list Pending Friends Discord |
| `showFloatingButton` | `boolean` | `true` | Tampilkan tombol mengambang di pojok kanan bawah |
| `alertThresholdDays` | `number` | `7` | Beri penanda khusus jika pending lebih dari X hari |
| `autoRefreshIntervalSec` | `number` | `15` | Interval refresh data dalam detik |

---

## 🚀 Cara Menggunakan

1. Pastikan Discord sudah di-inject dengan menjalankan:
   ```bash
   npm start
   # atau
   npm run install-themes
   ```
2. Buka Discord Anda.
3. Buka menu **Friends** ➔ Tab **Pending** (Menunggu) untuk melihat badge durasi di samping setiap user.
4. Tekan <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> kapan saja untuk membuka panel lengkap Pending Friend Tracker.
