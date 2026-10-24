# Paket lengkap: Kasir Warung Pintar
_Disusun via PRD Studio_

---

Bagian ini adalah PRD utuh.

# PRD: Kasir Warung Pintar
_Jenis: Aplikasi web | Industri: Retail & F&B | Platform: Web responsif, Android | Disusun: 2026-10-19 via PRD Studio. Skor kesiapan 100 (Siap susun)._

## 1. Ringkasan eksekutif
Kasir Warung Pintar adalah aplikasi web untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit..
Masalah: Pemilik warung mencatat transaksi di buku tulis, struk sering hilang dan rekap harian memakan 1 jam tiap malam.
Alasan sekarang: Ada 20 warung mitra yang menunggu versi digital bulan depan untuk laporan ke koperasi.

## 2. Persona dan problem statement
Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit. butuh catat transaksi offline dan sinkron saat online karena Pemilik warung mencatat transaksi di buku tulis, struk sering hilang dan rekap harian memakan 1 jam tiap malam..
Peran: Pemilik, Kasir, Pelanggan (terima struk via WhatsApp).

## 3. Tujuan dan metrik sukses
- Waktu catat transaksi di bawah 30 detik
- Rekap harian otomatis tanpa hitung manual
- Struk terkirim 100 persen (cetak atau WhatsApp)

## 4. Scope MoSCoW
**Must (v1 wajib):**
M1 Catat transaksi offline dan sinkron saat online
M2 Cetak struk thermal 58mm
M3 Rekap harian otomatis
M4 Kelola stok sederhana

**Should (kalau sempat):**
S1 Grafik mingguan
S2 Export Excel
S3 PIN terpisah untuk kasir

**Won't (tegas di luar v1):**
- Tidak ada pembayaran online di v1
- Tidak ada multi cabang
- Tidak ada loyalty poin

## 5. User stories dan kriteria terima
US-1 Sebagai Ibu pemilik warung 35-50 tahun saya bisa catat transaksi offline dan sinkron saat online sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.

US-2 Sebagai Ibu pemilik warung 35-50 tahun saya bisa cetak struk thermal 58mm sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.

US-3 Sebagai Ibu pemilik warung 35-50 tahun saya bisa rekap harian otomatis sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.

US-4 Sebagai Ibu pemilik warung 35-50 tahun saya bisa kelola stok sederhana sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.

## 6. Alur dan sistematika interface
Alur utama: 1 Buka layar Kasir, 2 ketuk barang atau ketik harga, 3 terima uang, 4 cetak atau kirim struk, 5 stok berkurang otomatis
Jalur gagal: Listrik atau internet mati: transaksi tetap tersimpan lokal dengan status antre, lalu sinkron otomatis dan tandai ganda jika duplikat.
Navigasi: Kasir, Stok, Laporan, Pengaturan. Setiap layar punya 3 state: kosong (panduan isi pertama), memuat (indikator), gagal (sebab dan tombol ulangi).

## 7. Layout dan UI per area
Gaya: Bersih profesional terang. Pola layout: Satu layar kasir fokus.
Aturan: satu titik fokus per layar, target sentuh minimal 44px, fokus keyboard terlihat, tanpa tombol mati.
Visual: Tombol besar minimal 48px, ikon keranjang dan printer yang jelas, foto barang dari kamera HP, tanpa ilustrasi stok.

## 8. Audio dan media
Kebutuhan: Bunyi klik kasir (SFX).
Aturan: suara hanya umpan balik aksi (klik, sukses, gagal), ada tombol bisu, tanpa autoplay.

## 9. Kebutuhan non fungsional
Buka di RAM 2GB di bawah 3 detik, 100 persen transaksi offline tersimpan, PIN 4 digit untuk kasir, kontras teks minimal 4.5:1.
Tambahan baku: kontras teks 4.5:1, keyboard penuh (Tab, Enter, Escape), responsif 360px sampai desktop tanpa scroll horizontal.

## 10. Model data (awal)
- Kasir (id, nama, pin_hash, aktif)
- Item (id, nama, barcode, harga, stok)
- Transaksi (id, waktu, kasir_id, total, status: tersimpan/antre/terkirim)
- TransaksiItem (transaksi_id, item_id, jumlah, harga_satuan)
Relasi: Kasir 1-N Transaksi, Transaksi N-M Item lewat TransaksiItem. Tulis offline masuk antrean dengan idempotency_key.

## 11. Endpoint dan aturan (awal)
- POST /transactions (idempotency-key wajib, total dihitung server)
- GET /stock?date=YYYY-MM-DD (rekap stok harian)
- POST /print/retry (cetak ulang struk terakhir)
- Aturan: harga tidak boleh berubah di klien, respons gagal menyertakan kode sebab.
Integrasi: Printer thermal XPrinter via USB atau Bluetooth; WhatsApp untuk kirim struk teks.

## 12. Risiko dan out of scope
Risiko: Printer putus di jam sibuk, HP kehabisan daya, stok ketik salah. Mitigasi: antrean cetak ulang, mode hemat baterai, konfirmasi stok setelah simpan.
Out of scope v1 sama dengan daftar Won't. Stack: HTML CSS JS vanilla.

---

# Roadmap

## Fase 1, Fondasi (minggu 1)
_Tanpa dependensi_
- [M] Struktur layar dasar (Satu layar kasir fokus) (Tanpa dependensi)
- [M] Model data lokal plus antrean offline (Tanpa dependensi)
- [S] Navigasi: Kasir, Stok, Laporan, Pengaturan (Tanpa dependensi)

## Fase 2, Inti (4 Must have)
_Butuh Fase 1 selesai_
- [L] Catat transaksi offline dan sinkron saat online (Butuh Fondasi selesai)
- [L] Cetak struk thermal 58mm (Butuh "Catat transaksi offline dan sink" selesai)
- [S] Rekap harian otomatis (Butuh "Catat transaksi offline dan sink" selesai)
- [S] Kelola stok sederhana (Butuh "Rekap harian otomatis" selesai)

## Fase 3, Pengalaman (Bersih profesional terang)
_Butuh Fase 2 selesai_
- [S] Visual: Tombol besar minimal 48px, ikon keranjang dan printer yang jelas, foto barang dari kamera HP, tanpa ilustrasi stok. (Butuh Fase 2 selesai)
- [XS] Audio: Bunyi klik kasir (SFX) (Butuh Fase 2 selesai)
- [M] State kosong, memuat, gagal di semua layar (Butuh Fase 2 selesai)

## Fase 3b, Integrasi (2 layanan)
_Butuh Fase 2 selesai_
- [L] Integrasi: Printer thermal XPrinter via USB atau Bluetooth (Butuh Fase 2 selesai)
- [L] Integrasi: WhatsApp untuk kirim struk teks (Butuh Fase 2 selesai)

## Fase 4, Rilis dan uji (HTML CSS JS vanilla)
_Butuh Fase 3b, Integrasi (2 layanan) selesai_
- [M] Uji offline dan perangkat: Printer thermal XPrinter via USB atau Bluetooth (Butuh Fase 3b, Integrasi (2 layanan) selesai)
- [S] Uji HP RAM kecil dan keyboard penuh (Butuh Fase 3b, Integrasi (2 layanan) selesai)
- [S] Kriteria rilis: Buka di RAM 2GB di bawah 3 detik, 100 persen transaksi offline tersimpan, PIN 4 digit untuk kasir, kontras teks minimal 4.5:1. (Butuh Fase 3b, Integrasi (2 layanan) selesai)

---

# Diagram Mermaid

Butuh renderer Mermaid (editor, VS Code, atau https://mermaid.live).

## Use case: aktor dan scope

````mermaid
flowchart LR
  U0(("Pemilik"))
  U1(("Kasir"))
  U2(("Pelanggan terima struk via WhatsApp"))
  SYS["Kasir Warung Pintar"]
  SYS --- F0["Catat transaksi offline dan sinkron saat o"]
  SYS --- F1["Cetak struk thermal 58mm"]
  SYS --- F2["Rekap harian otomatis"]
  SYS --- F3["Kelola stok sederhana"]
  U0 --- SYS
  U1 --- SYS
  U2 --- SYS
````

## ERD awal

````mermaid
erDiagram
  KASIR ||--o{ TRANSAKSI : membuat
  TRANSAKSI ||--o{ TRANSAKSI_ITEM : berisi
  ITEM ||--o{ TRANSAKSI_ITEM : dipesan
  KASIR {
    string id
    string nama
  }
  TRANSAKSI {
    string id
    string status
  }
  ITEM {
    string id
    int stok
  }
````

## Flowchart utama dan jalur gagal

````mermaid
flowchart TD
  A["Mulai: Kasir"] --> B["Catat transaksi offline dan sinkron saat o"]
  B --> C{Berhasil?}
  C -- Ya --> D["Stok"]
  C -- Tidak --> E["Gagal: Listrik atau internet mati: transaksi teta"]
  E --> B
````

---

# Prompt chain P0-P9

Salin berurutan. Gerbang berantai: P5 butuh P4, P6 butuh P5, P7 butuh P6, P8 butuh P7, P9 butuh P8.

## P0 Buka sesi dan tanam konteks

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Baca PRD berikut sampai paham, jangan coding dulu.

PRD:
\# PRD: Kasir Warung Pintar
_Jenis: Aplikasi web | Industri: Retail & F&B | Platform: Web responsif, Android | Disusun: 2026-10-19 via PRD Studio. Skor kesiapan 100 (Siap susun)._
\## 1. Ringkasan eksekutif
Kasir Warung Pintar adalah aplikasi web untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit..
Masalah: Pemilik warung mencatat transaksi di buku tulis, struk sering hilang dan rekap harian memakan 1 jam tiap malam.
Alasan sekarang: Ada 20 warung mitra yang menunggu versi digital bulan depan untuk laporan ke koperasi.
\## 2. Persona dan problem statement
Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit. butuh catat transaksi offline dan sinkron saat online karena Pemilik warung mencatat transaksi di buku tulis, struk sering hilang dan rekap harian memakan 1 jam tiap malam..
Peran: Pemilik, Kasir, Pelanggan (terima struk via WhatsApp).
\## 3. Tujuan dan metrik sukses
- Waktu catat transaksi di bawah 30 detik
- Rekap harian otomatis tanpa hitung manual
- Struk terkirim 100 persen (cetak atau WhatsApp)
\## 4. Scope MoSCoW
**Must (v1 wajib):**
M1 Catat transaksi offline dan sinkron saat online
M2 Cetak struk thermal 58mm
M3 Rekap harian otomatis
M4 Kelola stok sederhana

**Should (kalau sempat):**
S1 Grafik mingguan
S2 Export Excel
S3 PIN terpisah untuk kasir

**Won't (tegas di luar v1):**
- Tidak ada pembayaran online di v1
- Tidak ada multi cabang
- Tidak ada loyalty poin
\## 5. User stories dan kriteria terima
US-1 Sebagai Ibu pemilik warung 35-50 tahun saya bisa catat transaksi offline dan sinkron saat online sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.

US-2 Sebagai Ibu pemilik warung 35-50 tahun saya bisa cetak struk thermal 58mm sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.

US-3 Sebagai Ibu pemilik warung 35-50 tahun saya bisa rekap harian otomatis sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.

US-4 Sebagai Ibu pemilik warung 35-50 tahun saya bisa kelola stok sederhana sehingga target harian tercapai.
  Kriteria biner: berhasil menampilkan konfirmasi dalam 2 detik, gagal menampilkan sebab plus tombol ulangi, status tersimpan dan bisa diverifikasi ulang.
\## 6. Alur dan sistematika interface
Alur utama: 1 Buka layar Kasir, 2 ketuk barang atau ketik harga, 3 terima uang, 4 cetak atau kirim struk, 5 stok berkurang otomatis
Jalur gagal: Listrik atau internet mati: transaksi tetap tersimpan lokal dengan status antre, lalu sinkron otomatis dan tandai ganda jika duplikat.
Navigasi: Kasir, Stok, Laporan, Pengaturan. Setiap layar punya 3 state: kosong (panduan isi pertama), memuat (indikator), gagal (sebab dan tombol ulangi).
\## 7. Layout dan UI per area
Gaya: Bersih profesional terang. Pola layout: Satu layar kasir fokus.
Aturan: satu titik fokus per layar, target sentuh minimal 44px, fokus keyboard terlihat, tanpa tombol mati.
Visual: Tombol besar minimal 48px, ikon keranjang dan printer yang jelas, foto barang dari kamera HP, tanpa ilustrasi stok.
\## 8. Audio dan media
Kebutuhan: Bunyi klik kasir (SFX).
Aturan: suara hanya umpan balik aksi (klik, sukses, gagal), ada tombol bisu, tanpa autoplay.
\## 9. Kebutuhan non fungsional
Buka di RAM 2GB di bawah 3 detik, 100 persen transaksi offline tersimpan, PIN 4 digit untuk kasir, kontras teks minimal 4.5:1.
Tambahan baku: kontras teks 4.5:1, keyboard penuh (Tab, Enter, Escape), responsif 360px sampai desktop tanpa scroll horizontal.
\## 10. Model data (awal)
- Kasir (id, nama, pin_hash, aktif)
- Item (id, nama, barcode, harga, stok)
- Transaksi (id, waktu, kasir_id, total, status: tersimpan/a

Balas dengan ringkasan 5 bullet dan 3 pertanyaan paling penting sebelum coding.

---

## P1 Verifikasi PRD dan tutup celah

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Periksa PRD di atas. Cari: asumsi tanpa dasar, kriteria tidak biner, alur gagal hilang, scope merembet. Keluarkan tabel GAP | DAMPAK | PERBAIKAN, lalu tulis ulang bagian yang cacat saja.

---

## P2 Ekstrak fitur MoSCoW

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Ubah PRD jadi fitur F1..Fn Must, Should, Won't. Tiap Must punya acceptance biner (angka, state, pesan error).

---

## P3 Tetapkan rules coding

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Tulis RULES.md singkat: struktur folder, konvensi nama, simpan offline plus idempotency, aksesibilitas (kontras 4.5:1, keyboard Tab/Escape, target 44px). Stack: HTML CSS JS vanilla. Rules ini mengikat semua langkah berikut.

---

## P4 Pecah jadi task berurutan

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Pecah Must jadi task T1..Tn berurutan dengan dependensi. Format: ID | JUDUL | FILE YANG DISENTUH | VERIFIKASI (perintah build/test plus exit 0). Estimasi XS-L.

---

## P5 Kerjakan fondasi (Fase 1) (gerbang: P4)

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Kerjakan hanya task fondasi: struktur layar Satu layar kasir fokus, navigasi Kasir, Stok, Laporan, Pengaturan, model lokal. Satu task per respons. Akhiri dengan perintah verifikasi dan file yang diubah.

---

## P6 Kerjakan fitur inti satu per satu (gerbang: P5)

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Kerjakan satu Must sesuai urutan P4. Jangan lompat. Untuk tiap fitur tunjukkan kode, cara uji manual 3 langkah, dan bukti kriteria biner terpenuhi.

---

## P7 Poles pengalaman visual dan audio (gerbang: P6)

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Terapkan gaya Bersih profesional terang dan audio Bunyi klik kasir (SFX). Visual: Tombol besar minimal 48px, ikon keranjang dan printer yang jelas, foto barang dari kamera HP, tanpa ilustrasi stok.. Pastikan empty, loading, error state ada di tiap layar. Jangan ubah logika inti.

---

## P8 Uji NFR dan integrasi (gerbang: P7)

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Uji: Buka di RAM 2GB di bawah 3 detik, 100 persen transaksi offline tersimpan, PIN 4 digit untuk kasir, kontras teks minimal 4.5:1.. Integrasi: Printer thermal XPrinter via USB atau Bluetooth
WhatsApp untuk kirim struk teks. Buat daftar cek PASS/FAIL per item dengan bukti perintah atau langkah.

---

## P9 Review akhir sampai 100 persen (gerbang: P8)

Kamu adalah senior engineer dan PM. Jawab ringkas dan biner untuk tim engineering lokal dalam format Markdown. Konteks produk: "Kasir Warung Pintar" (Aplikasi web) untuk Ibu pemilik warung 35-50 tahun, pakai HP Android RAM 2GB, tidak terbiasa menu rumit.. Platform: Web responsif, Android. Must: Catat transaksi offline dan sinkron saat online; Cetak struk thermal 58mm; Rekap harian otomatis; Kelola stok sederhana. Wont: Tidak ada pembayaran online di v1; Tidak ada multi cabang; Tidak ada loyalty poin. Review segar seolah bukan penulis kode. Cek melawan PRD, RULES, keamanan, aksesibilitas. Jika semua lolos tulis SHIP_CHECK_OK plus ringkasan rilis. Jika gagal, tulis perbaikan bernomor, jangan coding ulang otomatis.

---
