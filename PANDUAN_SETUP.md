# 📁🤖 Panduan Setup & Instalasi - Terra Telegram Drive

Selamat! Dokumen ini adalah panduan lengkap untuk melakukan instalasi dan konfigurasi **Terra Telegram Drive**. Sistem ini dirancang untuk menggabungkan penyimpanan tak terbatas dari Telegram dengan sistem manajemen file terstruktur (folder & tags) menggunakan database MariaDB/MySQL dan dashboard Web Portal premium.

Sistem ini menggunakan **dua bot Telegram**:
1. **Main Bot (Bot Utama)**: Digunakan untuk mengunggah file secara langsung di chat, menautkan akun pengguna, dan mengontrol data.
2. **Share Bot (Bot Pembagi)**: Digunakan khusus untuk mengunduh/membagikan file ke pengguna umum menggunakan tautan unduhan otomatis (deep-linking).

---

## 📋 Persyaratan Sistem (Prerequisites)

Sebelum memulai, pastikan server atau komputer Anda sudah terpasang:
1. **Node.js** (Versi 20 atau lebih baru)
2. **MariaDB** atau **MySQL Server**
3. Dua buah token Bot Telegram dari **@BotFather**

---

## 🛠️ Langkah-Langkah Setup

### Langkah 1: Pembuatan Bot Telegram

Anda perlu membuat dua bot melalui bot resmi Telegram [@BotFather](https://t.me/BotFather):

1. **Membuat Bot Utama (Main Bot)**:
   - Hubungi [@BotFather](https://t.me/BotFather) di Telegram dan ketik `/newbot`.
   - Berikan nama bot (misal: `My Personal Drive Bot`) dan username bot (misal: `mypersonaldrive_bot`).
   - Simpan token HTTP API yang diberikan (Token A).
   - Matikan "Group Privacy" jika ingin bot bisa menerima file di dalam grup: `/setprivacy` -> Pilih bot Anda -> `Disable`.

2. **Membuat Bot Pembagi (Share Bot)**:
   - Ketik lagi `/newbot` di [@BotFather](https://t.me/BotFather).
   - Berikan nama bot (misal: `My Drive Share Bot`) dan username bot (misal: `mydriveshare_bot`).
   - Simpan token HTTP API yang diberikan (Token B).

---

### Langkah 2: Konfigurasi File Lingkungan (`.env`)

1. Duplikat file `.env.example` yang ada di direktori utama proyek menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
2. Buka file `.env` menggunakan teks editor dan sesuaikan konfigurasinya:
   ```env
   PORT=8038
   HOST=0.0.0.0
   NODE_ENV=production

   # Konfigurasi Database MySQL/MariaDB
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=username_database_anda
   DB_PASSWORD=password_database_anda
   DB_NAME=telegram_drive

   # Token Bot Telegram
   TELEGRAM_BOT_TOKEN=TOKEN_BOT_UTAMA_ANDA (Token A)
   TELEGRAM_SHARE_BOT_TOKEN=TOKEN_BOT_PEMBAGI_ANDA (Token B)

   # Keamanan Session (Gunakan string acak dan panjang)
   SESSION_SECRET=buat_random_string_panjang_di_sini_123456

   # Password Default Akun Admin Pertama Kali
   ADMIN_PASSWORD=password_admin_baru_anda
   ```

---

### Langkah 3: Setup Database

Aplikasi ini memiliki fitur **Auto-Migration**. Anda **tidak perlu mengimpor file SQL secara manual**. 
Saat server dijalankan pertama kali, aplikasi akan otomatis:
1. Membuat database jika belum ada (sesuai nama di `DB_NAME`).
2. Menjalankan skema tabel dari file `schema.sql`.
3. Membuat pengguna administrator default dengan username `admin` dan password sesuai nilai `ADMIN_PASSWORD` pada file `.env`.

---

### Langkah 4: Instalasi Dependency & Menjalankan Aplikasi

1. Buka terminal di direktori proyek dan instal semua modul yang dibutuhkan:
   ```bash
   npm install
   ```

2. **Menjalankan dalam Mode Pengembangan (Development)**:
   Untuk menjalankan dengan fitur auto-reload saat ada kode yang berubah:
   ```bash
   npm run dev
   ```

3. **Menjalankan dalam Mode Produksi (Production)**:
   Untuk performa optimal di server produksi:
   ```bash
   npm start
   ```

---

## 🚀 Deployment Menggunakan PM2 (Rekomendasi Server Produksi)

Agar aplikasi tetap berjalan di latar belakang (background) dan otomatis menyala kembali jika server restart, sangat disarankan menggunakan **PM2**:

1. Instal PM2 secara global:
   ```bash
   npm install pm2 -g
   ```

2. Jalankan aplikasi menggunakan PM2:
   ```bash
   pm2 start src/index.js --name "telegram-drive" --update-env
   ```

3. Simpan konfigurasi PM2 agar otomatis berjalan saat booting server:
   ```bash
   pm2 save
   pm2 startup
   ```
   *(Salin dan jalankan perintah keluaran dari `pm2 startup` di terminal Anda)*.

---

## 📱 Panduan Penggunaan & Alur Kerja

1. **Login Pertama Kali**:
   - Buka browser Anda dan akses `http://IP_Server_Anda:8038`.
   - Masuk menggunakan username: `admin` dan password: *(sesuai ADMIN_PASSWORD di file `.env`)*.

2. **Menghubungkan Akun Telegram**:
   - Setelah masuk ke Web Portal, klik tombol **"Link Telegram"** di dashboard.
   - Klik tautan yang muncul untuk diarahkan ke **Bot Utama (Main Bot)** di Telegram.
   - Klik tombol **"Start"** di bot Telegram tersebut. Akun web Anda dan Telegram kini telah terhubung!

3. **Mengunggah File**:
   - **Lewat Web**: Cukup drag-and-drop file ke halaman web portal.
   - **Lewat Telegram**: Kirim file, foto, audio, video, atau dokumen langsung ke **Bot Utama**. Anda juga bisa meneruskan (forward) file dari channel/grup lain ke bot untuk disimpan otomatis.

4. **Membagikan File (Share)**:
   - Pada Web Portal, klik ikon informasi/metadata (ℹ️) pada file yang ingin dibagikan.
   - Salin **Share Link** yang tersedia (tautan mengarah ke **Bot Pembagi/Share Bot**).
   - Bagikan tautan tersebut. Saat pengguna lain membukanya di Telegram dan menekan **"Start"**, Bot Pembagi akan langsung mengirimkan file tersebut sebagai dokumen secara instan tanpa membebani memori server lokal Anda!
