# JagoTrack — Smart Personal Finance & Wealth Tracker

Aplikasi pencatat keuangan pribadi berbasis satu file HTML (PWA): transaksi, multi-rekening, anggaran,
tabungan/wishlist, portofolio investasi, transaksi rutin, dan asisten AI (JagoAI).
Data tersimpan di browser (mode lokal) dan dapat disinkronkan lintas HP lewat Google Sheets (opsional).

## Struktur file

| File | Fungsi |
|---|---|
| `index.html` | Seluruh aplikasi (UI + logika) |
| `manifest.json`, `icon-192.png`, `icon-512.png` | Agar bisa di-"Install" sebagai aplikasi (PWA) |
| `sw.js` | Service worker (cache offline). Naikkan `CACHE_VERSION` setiap `index.html` diubah |
| `Kode.gs` | Backend Google Apps Script (login, OTP email, sync, proxy AI). **Tidak dijalankan di GitHub** |
| `.nojekyll` | Mencegah GitHub Pages memproses file lewat Jekyll |

## Deploy ke GitHub Pages

1. Buat repository baru di GitHub, lalu upload semua file di folder ini (termasuk `.nojekyll`).
2. Buka **Settings → Pages → Build and deployment**.
3. Source: **Deploy from a branch**, Branch: `main`, folder `/ (root)` → **Save**.
4. Tunggu 1–2 menit. Aplikasi tersedia di `https://<username>.github.io/<nama-repo>/`.

Tanpa backend, aplikasi langsung berjalan dalam **Mode Lokal** (data hanya di browser perangkat tersebut).

## Mengaktifkan sinkronisasi, OTP email, dan AI (opsional)

1. Buat Google Sheet baru → **Extensions → Apps Script**.
2. Tempel isi `Kode.gs` (atau salin lewat menu di dalam aplikasi), simpan.
3. Isi `OPENROUTER_API_KEY` di Apps Script bila ingin JagoAI aktif di semua HP.
4. **Deploy → New deployment → Web app** · Execute as: **Me** · Who has access: **Anyone**.
5. Salin URL `/exec`, tempel di menu pengaturan server di aplikasi, atau isi `DEFAULT_GAS_URL` di `index.html`.
6. Setiap `Kode.gs` diubah: **Deploy → Manage deployments → Edit → New version**.

## Keamanan — baca sebelum membagikan ke orang lain

- **Jangan commit API key** (OpenRouter/Gemini) ke repository. Simpan di Apps Script atau input di aplikasi.
- Repository publik berarti `index.html` bisa dibaca siapa pun. URL Web App aman dibagikan, kuncinya tidak.
- Kata sandi di-hash di browser (SHA-256) sebelum dikirim. Ini lebih baik daripada teks biasa, tetapi bukan
  pengganti sistem autentikasi penuh. Gunakan kata sandi unik dan jangan dipakai ulang dari akun lain.
- Data keuangan di Google Sheet milik Anda sendiri; pemilik Sheet dapat melihat semua data pengguna.
- Lakukan **Ekspor Backup** berkala (data lokal hilang bila cache browser dihapus).

## Pengembangan

Tidak perlu build. Buka `index.html` lewat server lokal (mis. `python -m http.server`) agar PWA/service worker aktif.
Nama model AI diatur di konstanta `GEMINI_MODEL`, `OPENROUTER_TEXT_MODEL`, `OPENROUTER_VISION_MODEL`
di awal script `index.html`.
