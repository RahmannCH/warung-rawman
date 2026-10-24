# RULES.md - Kasir Warung Pintar

## 1. Struktur Folder & Stack
* **Stack**: HTML5, CSS3, JavaScript ES6 Modules murni (Vanilla). Dilarang menambah runtime library atau build tool eksternal.
```text
warung-rawman/
├── index.html          # Satu file shell utama aplikasi (SPA)
├── manifest.json       # PWA manifest (mode standalone)
├── sw.js               # Service Worker caching offline
├── RULES.md            # Aturan baku teknis tim engineering
├── package.json        # Runner tes otomasi ("type": "module")
├── css/
│   └── style.css       # Token warna, layout 360px-desktop, CSS print 58mm
├── js/
│   ├── app.js          # Controller interaksi UI & state
│   ├── db.js           # Layer penyimpanan IndexedDB lokal
│   ├── audio.js        # Sintesis Web Audio API (SFX)
│   └── receipt.js      # Formatter struk 58mm & tautan WhatsApp
└── tests/
    └── test-check.js   # Verifikasi otomatis 8 assertion (Node.js assert)
```

## 2. Konvensi Penamaan (Naming Conventions)
* **Berkas & Direktori**: Huruf kecil pemisah tanda hubung (`kebab-case`), contoh: `style.css`, `test-check.js`.
* **Variabel & Fungsi JS**: Huruf kecil camel (`camelCase`), contoh: `saveTransaction`, `calculateChange`.
* **Konstanta & Enum**: Huruf kapital pemisah garis bawah (`UPPER_SNAKE_CASE`), contoh: `DB_NAME`, `DB_VERSION`.
* **Kelas & ID CSS**: Huruf kecil pemisah tanda hubung (`kebab-case`), contoh: `.item-card`, `#modal-checkout`.
* **Data Store & Field IndexedDB**: Huruf kecil garis bawah (`snake_case`), contoh: `harga_beli`, `idempotency_key`.

## 3. Simpan Offline & Idempotensi
* **100% Offline-First**: Tidak ada operasi kasir yang boleh gagal karena jaringan offline.
* **Format Idempotensi**: Setiap transaksi wajib disematkan `idempotency_key` dengan format `idmp-tx-[timestamp]-[string_acak]`.
* **Penolakan Duplikasi**: Transaksi dengan `idempotency_key` yang telah ada di IndexedDB wajib diabaikan (idempoten) dan mengembalikan status duplikat tanpa mengurangi stok dua kali.
* **Potong Stok Atomik**: Pemotongan stok barang diproses dalam transaksi baca-tulis (`readwrite`) IndexedDB yang sama dengan penyimpanan data transaksi.
* **PIN Tanpa Plaintext**: PIN kasir hanya disimpan sebagai `pin_hash` (SHA-256). Field `pin_kasir` plaintext dimigrasi otomatis lalu dihapus. Salah 5 kali → kunci input 60 detik.
* **Storage Persisten**: Aplikasi memanggil `navigator.storage.persist()` saat init agar IndexedDB tidak dievict browser. Kegagalan kuota wajib menampilkan pesan "Penyimpanan HP penuh" plus jalan ke menu cadangan.

## 4. Aksesibilitas & Ergonomi (Target RAM 2GB & Layar HP)
* **Kontras Teks**: Rasio kontras teks wajib minimal `4.5:1` (WCAG AA). Latar terang `#ffffff` atau `#f8fafc` dengan teks gelap `#0f172a`.
* **Target Sentuh**: Tombol aksi utama minimal `48px x 48px`, tombol sekunder minimal `44px x 44px`.
* **Navigasi Keyboard**:
  * `Tab` / `Shift+Tab`: Indikator fokus aktif terlihat jelas dengan cincin `3px solid var(--primary)`.
  * `Escape`: Menutup modal aktif seketika.
  * `Enter`: Memicu konfirmasi bayar atau simpan form aktif.
* **Umpan Balik Biner <= 2 Detik**: Setiap aksi kasir menghasilkan respon toast sukses/gagal dalam tempo < 2 detik.
* **Batas Memori Gambar**: Foto kamera HP wajib dikompresi via Canvas sebelum simpan ke IndexedDB (maksimal 240x240px, JPEG quality 0.7, < 30KB).
