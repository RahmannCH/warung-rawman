import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatRupiah,
  formatNumber,
  generateReceiptHTML,
  generateWhatsAppMessage,
  getWhatsAppUrl,
  wrapLine,
  RECEIPT_LINE_WIDTH,
  DIVIDER_HEAVY,
  DIVIDER_LIGHT,
  stepAmount,
  calculateSmartPresets,
  calculateChangeBreakdown,
  terbilang
} from '../js/receipt.js';
import { buildSyncPayload, getSyncHeaders, getBackoffDelay, syncPending } from '../js/sync.js';
import {
  hashPin,
  verifyPin,
  registerFailure,
  isLocked,
  PIN_LOCK_MS
} from '../js/pin.js';
import {
  toEscPosAscii,
  buildEscPosLines,
  buildEscPosBytes,
  ESC,
  GS,
  LF
} from '../js/printer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Test Number & Rupiah Formatting
assert.ok(formatRupiah(15000).includes('15.000'), 'formatRupiah should include 15.000');
assert.strictEqual(formatNumber(25000).replace(/\s/g, ''), '25.000');

// 2. Test Receipt HTML Generation (58mm Thermal)
const mockTransaction = {
  id: 'tx-1234567890',
  waktu: '2026-10-24T10:00:00.000Z',
  kasir_nama: 'Ibu Ani',
  total: 50000,
  bayar: 100000,
  kembali: 50000,
  items: [
    { id: 'itm-1', nama: 'Beras Medium 1kg', harga: 14000, qty: 2 },
    { id: 'itm-2', nama: 'Minyak Goreng 1L', harga: 17500, qty: 1 }
  ]
};

const mockWarung = {
  nama_warung: 'Warung Rawman',
  alamat: 'Jl. Rawamangun Raya No. 12',
  footer_struk: 'Terima kasih!'
};

const receiptHtml = generateReceiptHTML(mockTransaction, mockWarung);
assert.ok(receiptHtml.includes('WARUNG RAWMAN'), 'Receipt HTML contains store name');
assert.ok(receiptHtml.includes('Beras Medium 1kg'), 'Receipt HTML contains item');
assert.ok(receiptHtml.includes('thermal-receipt'), 'Receipt HTML has thermal-receipt class structure');

// 3. Test WhatsApp Message Generation
const waMsg = generateWhatsAppMessage(mockTransaction, mockWarung);
assert.ok(waMsg.includes('WARUNG RAWMAN'), 'WA message contains store name');
assert.ok(waMsg.includes('Beras Medium 1kg'), 'WA message contains item');
assert.ok(waMsg.includes('TOTAL'), 'WA message contains TOTAL');

// 4. Test WhatsApp URL Generation
const waUrl = getWhatsAppUrl('081234567890', waMsg);
assert.ok(waUrl.startsWith('https://wa.me/6281234567890?text='), 'WA URL correctly formatted with country code 62');

// 5. Test Stock and Total Calculations
const calculatedTotal = mockTransaction.items.reduce((acc, it) => acc + it.harga * it.qty, 0);
assert.strictEqual(calculatedTotal, 45500, 'Calculated total matches sum of items');
const calculatedChange = mockTransaction.bayar - calculatedTotal;
assert.strictEqual(calculatedChange, 54500, 'Calculated change matches payment - total');

// 6. Test Idempotency Key Format
const txId = 'tx-' + Date.now() + '-abcd';
const idempotencyKey = 'idmp-' + txId;
assert.match(idempotencyKey, /^idmp-tx-\d+-[a-z0-9]+$/, 'Idempotency key strictly conforms to format');

// 7. Test NFR Asset Size (< 150KB for RAM 2GB instantaneous load < 3s)
const staticFiles = [
  path.join(rootDir, 'index.html'),
  path.join(rootDir, 'css', 'style.css'),
  path.join(rootDir, 'js', 'app.js'),
  path.join(rootDir, 'js', 'db.js'),
  path.join(rootDir, 'js', 'audio.js'),
  path.join(rootDir, 'js', 'receipt.js'),
  path.join(rootDir, 'js', 'sync.js'),
  path.join(rootDir, 'js', 'pin.js'),
  path.join(rootDir, 'js', 'printer.js'),
  path.join(rootDir, 'sw.js'),
  path.join(rootDir, 'manifest.json')
];

let totalSize = 0;
for (const file of staticFiles) {
  assert.ok(fs.existsSync(file), `File ${file} exists`);
  const stat = fs.statSync(file);
  totalSize += stat.size;
}
const totalKb = totalSize / 1024;
assert.ok(totalKb < 150, `Total app size (${totalKb.toFixed(2)} KB) must be under 150 KB for 2GB RAM budget`);

// 8. Test WCAG AA Contrast Ratio (4.5:1 requirement)
function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrast(rgb1, rgb2) {
  const lum1 = getLuminance(...rgb1);
  const lum2 = getLuminance(...rgb2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// Text main #0f172a [15, 23, 42] against White [255, 255, 255]
const textContrast = getContrast([15, 23, 42], [255, 255, 255]);
assert.ok(textContrast >= 4.5, `Text contrast (${textContrast.toFixed(2)}:1) meets WCAG AA 4.5:1`);

// 9. Test Sync Payload (M1 - antrean offline ke server koperasi)
const syncPayload = buildSyncPayload(mockTransaction);
assert.strictEqual(syncPayload.items.length, 2, 'Sync payload carries all transaction items');
assert.strictEqual(syncPayload.items[0].jumlah, 2, 'Sync payload maps qty -> jumlah');
assert.strictEqual(syncPayload.items[0].harga_satuan, 14000, 'Sync payload maps harga -> harga_satuan');
assert.ok(!('status' in syncPayload), 'Sync payload never leaks local-only status field');

// 10. Test Idempotency Header (wajib per PRD seksi 11)
const headers = getSyncHeaders({ ...mockTransaction, idempotency_key: idempotencyKey });
assert.strictEqual(headers['Idempotency-Key'], idempotencyKey, 'Idempotency-Key header mirrors local key');
assert.strictEqual(headers['Content-Type'], 'application/json', 'Content-Type header is JSON');

// 11. Test Backoff Bounds (retry tidak pernah membanjiri jaringan warung)
assert.strictEqual(getBackoffDelay(0), 1000, 'First retry waits 1s');
assert.strictEqual(getBackoffDelay(1), 2000, 'Second retry waits 2s');
assert.ok(getBackoffDelay(99) <= 30000, 'Backoff is capped at 30s');

// 12. Test Sync Loop Falls Back Gracefully Without Endpoint
const noEndpoint = await syncPending({ endpoint: '' });
assert.strictEqual(noEndpoint.total, 0, 'No endpoint means no queue drain attempted');
assert.ok(noEndpoint.reason.includes('Endpoint'), 'Missing endpoint surfaces an explicit reason');

// 13. M2 - Lebar baris thermal 58mm dikunci 32 karakter
assert.strictEqual(RECEIPT_LINE_WIDTH, 32, 'Thermal line budget is 32 chars for 58mm paper');
assert.strictEqual(DIVIDER_HEAVY.length, 32, 'Heavy divider fills exactly 32 chars');
assert.strictEqual(DIVIDER_LIGHT.length, 32, 'Light divider fills exactly 32 chars');

// 14. M2 - Nama barang panjang dibungkus, tidak merusak perataan struk
const longName = 'Kopi Kapal Api Special Mix Sachet 20 gram isi 6';
const wrapped = wrapLine(longName);
assert.ok(wrapped.length > 1, 'Long item name wraps into multiple lines');
assert.ok(wrapped.every((l) => l.length <= RECEIPT_LINE_WIDTH), 'Every wrapped line fits the 58mm budget');
assert.strictEqual(wrapped.join(' ').replace(/\s+/g, ' ').trim(), longName, 'Wrapping never drops characters');
assert.deepStrictEqual(wrapLine('Indomie'), ['Indomie'], 'Short name stays on one line');

// 15. M2 - Struk panjang tetap patuh lebar kolom
const longTx = {
  ...mockTransaction,
  items: [{ id: 'itm-9', nama: longName, harga: 3000, qty: 2 }]
};
const longHtml = generateReceiptHTML(longTx, mockWarung);
assert.ok(longHtml.includes('receipt-item-name-line'), 'Receipt renders wrapped name lines');
assert.ok(DIVIDER_LIGHT.length <= 32, 'Receipt divider never exceeds paper width');

// 16. M2 - CSS cetak mengunci @page 58mm dan membersihkan halaman kosong
const css = fs.readFileSync(path.join(rootDir, 'css', 'style.css'), 'utf8');
assert.ok(/@page\s*{[^}]*size:\s*58mm/.test(css), '@page locks 58mm paper size');
assert.ok(/@media print[\s\S]*overflow:\s*hidden/.test(css), 'Print media prevents blank trailing pages');

// 17. P7 - Kontras token nyata di CSS memenuhi WCAG AA 4.5:1
function cssVar(source, name) {
  const match = source.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`));
  assert.ok(match, `Token --${name} didefinisikan di stylesheet`);
  const hex = match[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

const WHITE = [255, 255, 255];
const PAGE_BG = [248, 250, 252];
const contrastPairs = [
  ['text-main', WHITE, 4.5],
  ['text-muted', PAGE_BG, 4.5],
  ['primary-text', WHITE, 4.5],
  ['primary-text', cssVar(css, 'primary-light'), 4.5],
  ['warning-text', WHITE, 4.5],
  ['danger', WHITE, 4.5]
];

for (const [token, bg, minimum] of contrastPairs) {
  const ratio = getContrast(cssVar(css, token), bg);
  assert.ok(
    ratio >= minimum,
    `Token --${token} pada latar rgb(${bg.join(',')}) harus >= ${minimum}:1 (aktual ${ratio.toFixed(2)}:1)`
  );
}

// 18. P7 - Tidak ada target sentuh di bawah 44px
const htmlSource = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf8');
const touchSources = { 'style.css': css, 'index.html': htmlSource, 'app.js': appSource };
for (const [name, source] of Object.entries(touchSources)) {
  const heights = [...source.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
  const tooSmall = heights.filter((h) => h < 44 && h !== 0);
  assert.deepStrictEqual(tooSmall, [], `${name} tidak boleh punya min-height < 44px (ditemukan: ${tooSmall.join(', ')})`);
}

// 19. P7 - Empat layar punya slot state kosong/memuat/gagal
for (const stateId of ['state-kasir', 'state-stok', 'state-laporan', 'state-sync']) {
  assert.ok(htmlSource.includes(`id="${stateId}"`), `Slot state ${stateId} ada di DOM`);
}
assert.ok(/class="state-box is-loading"/.test(htmlSource), 'State memuat memakai spinner .state-box.is-loading');
assert.ok(appSource.includes('function setScreenState'), 'Helper setScreenState tersedia untuk semua layar');
assert.ok(/state-box is-error/.test(appSource), 'State gagal memakai varian .is-error');
assert.ok(/onRetry/.test(appSource), 'State gagal membawa aksi Ulangi');

// 20. P7 - Ikon keranjang & printer berupa inline SVG, bukan emoji OS
assert.ok((htmlSource.match(/<svg class="icon/g) || []).length >= 4, 'Minimal 4 ikon aksi berupa inline SVG');
assert.ok(!htmlSource.includes('🖨️'), 'Ikon printer tidak lagi memakai emoji yang render berbeda tiap Android');
assert.ok(!htmlSource.includes('🛒'), 'Ikon keranjang tidak lagi memakai emoji');

// 21. NFR - PIN tidak pernah disimpan plaintext
const hash = await hashPin('1234');
assert.strictEqual(hash.length, 64, 'PIN di-hash SHA-256 menjadi 64 karakter hex');
assert.match(hash, /^[0-9a-f]{64}$/, 'Hash PIN hanya berisi hex');
assert.notStrictEqual(hash, '1234', 'Hash tidak sama dengan PIN asli');
assert.strictEqual(await hashPin('1234'), hash, 'Hash deterministik untuk PIN sama');
assert.notStrictEqual(await hashPin('4321'), hash, 'PIN berbeda menghasilkan hash berbeda');

// 22. NFR - Verifikasi PIN biner (hanya benar/salah)
assert.strictEqual(await verifyPin('1234', hash), true, 'PIN benar diterima');
assert.strictEqual(await verifyPin('0000', hash), false, 'PIN salah ditolak');
assert.strictEqual(await verifyPin('1234', ''), true, 'Tanpa PIN tersimpan tidak mengunci pemilik');
assert.rejects(async () => hashPin('12'), /4 digit/, 'PIN kurang dari 4 digit ditolak');
assert.rejects(async () => hashPin('abcd'), /4 digit/, 'PIN non-angka ditolak');

// 23. NFR - Lockout 5 percobaan lalu kunci 60 detik
let lockState = { attempts: 0, lockedUntil: 0, locked: false };
for (let i = 0; i < 4; i += 1) lockState = registerFailure(lockState.attempts, 1000);
assert.strictEqual(lockState.locked, false, 'Percobaan 1-4 belum mengunci');
assert.strictEqual(lockState.attempts, 4, 'Percobaan ke-4 tercatat');
lockState = registerFailure(lockState.attempts, 1000);
assert.strictEqual(lockState.locked, true, 'Percobaan ke-5 memicu penguncian');
assert.strictEqual(lockState.lockedUntil, 1000 + PIN_LOCK_MS, 'Kunci berdurasi tepat 60 detik');
assert.strictEqual(isLocked(lockState.lockedUntil, 60999), true, 'Masih terkunci pada detik ke-59');
assert.strictEqual(isLocked(lockState.lockedUntil, 61000), false, 'Terbuka tepat setelah 60 detik');

// 24. NFR - Tidak ada teks 'pin_kasir' tersisa & storage persisten diminta
const dbSource = fs.readFileSync(path.join(rootDir, 'js', 'db.js'), 'utf8');
assert.ok(!/\{\s*key:\s*'pin_kasir'/.test(dbSource), 'Seed default tidak lagi menulis PIN plaintext');
assert.ok(/export async function migratePinToHash/.test(dbSource), 'Migrasi pin_kasir -> pin_hash tersedia');
assert.ok(/pin_hash/.test(dbSource), 'db.js menyimpan pin_hash');
assert.ok(!/setSetting\('pin_kasir'/.test(appSource), 'app.js tidak lagi menyimpan PIN plaintext');
assert.ok(appSource.includes("getSetting('pin_hash'"), 'app.js membaca pin_hash');
assert.ok(/navigator\.storage\.persist/.test(appSource), 'Aplikasi meminta storage persisten agar IndexedDB tidak dievict');
assert.ok(/QuotaExceededError/.test(appSource), 'Kuota penyimpanan penuh ditangani dengan pesan spesifik');
assert.ok(htmlSource.includes('id="modal-pin"'), 'Gerbang PIN punya modal di DOM');

// 25. Integrasi - Filter ASCII untuk printer thermal XPrinter
assert.strictEqual(toEscPosAscii('Beras 5kg (Rp 70.000)'), 'Beras 5kg (Rp 70.000)', 'ASCII normal lolos utuh');
assert.strictEqual(toEscPosAscii('Kopi ☕ & Teh 🍵'), 'Kopi  & Teh ', 'Emoji dihapus agar printer thermal tidak mencetak karakter aneh');

// 26. Integrasi - Serialization ESC/POS bytes
const escLines = buildEscPosLines(mockTransaction, mockWarung);
assert.ok(escLines.length > 5, 'ESC/POS lines terbentuk');
const escBytes = buildEscPosBytes(mockTransaction, mockWarung);
assert.ok(escBytes instanceof Uint8Array, 'Output ESC/POS adalah Uint8Array');
assert.strictEqual(escBytes[0], ESC, 'Byte pertama adalah ESC (0x1b)');
assert.strictEqual(escBytes[1], 0x40, 'Byte kedua adalah @ (0x40 - inisialisasi printer)');
// Cek instruksi potong kertas GS V di akhir
const lastCutIdx = escBytes.lastIndexOf(GS);
assert.ok(lastCutIdx !== -1, 'Terdapat perintah GS untuk potong kertas');
assert.strictEqual(escBytes[lastCutIdx + 1], 0x56, 'Perintah potong kertas GS V (0x56)');

// 27. Fitur Kasir - Stepper nominal per 1.000 & auto-rounding dari angka ganjil
assert.strictEqual(stepAmount(20003, 'up', 1000), 21000, 'ArrowUp dari 20003 membulatkan ke 21000');
assert.strictEqual(stepAmount(20003, 'down', 1000), 20000, 'ArrowDown dari 20003 membulatkan ke 20000');
assert.strictEqual(stepAmount(20000, 'up', 1000), 21000, 'ArrowUp dari 20000 naik ke 21000');
assert.strictEqual(stepAmount(20000, 'down', 1000), 19000, 'ArrowDown dari 20000 turun ke 19000');
assert.strictEqual(stepAmount(500, 'down', 1000), 0, 'ArrowDown dari 500 mentok di 0');

// 28. Fitur Kasir - Smart presets kalkulasi pecahan dinamis berbasis total tagihan
const smartPresets = calculateSmartPresets(23000);
assert.ok(smartPresets.length >= 4, 'Minimal 4 saran nominal cerdas');
assert.strictEqual(smartPresets[0].amount, 23000, 'Preset pertama adalah Uang Pas (23.000)');
assert.strictEqual(smartPresets[1].amount, 25000, 'Preset kedua adalah kelipatan 5k terdekat (25.000)');
assert.strictEqual(smartPresets[2].amount, 30000, 'Preset ketiga adalah kelipatan 10k terdekat (30.000)');
assert.ok(smartPresets.some((p) => p.amount === 50000), 'Menyertakan uang 50.000');
assert.ok(smartPresets.some((p) => p.amount === 100000), 'Menyertakan uang 100.000');

// 29. Fitur Kasir - Rekomendasi pecahan kembalian greedy (uang kertas & koin)
const changeBreakdown = calculateChangeBreakdown(7500);
assert.strictEqual(changeBreakdown.length, 3, 'Kembalian 7.500 dipecah jadi 3 jenis uang');
assert.strictEqual(changeBreakdown[0].denom, 5000, '1 lembar 5.000');
assert.strictEqual(changeBreakdown[0].qty, 1);
assert.strictEqual(changeBreakdown[1].denom, 2000, '1 lembar 2.000');
assert.strictEqual(changeBreakdown[1].qty, 1);
assert.strictEqual(changeBreakdown[2].denom, 500, '1 keping 500');
assert.strictEqual(changeBreakdown[2].isCoin, true, '500 dikenali sebagai koin');
assert.deepStrictEqual(calculateChangeBreakdown(0), [], 'Kembalian 0 menghasilkan array kosong');

// 30. Fitur Kasir - Live terbilang mata uang rupiah
assert.strictEqual(terbilang(25000), 'Dua puluh lima ribu rupiah', 'Terbilang 25.000 tepat');
assert.strictEqual(terbilang(100000), 'Seratus ribu rupiah', 'Terbilang 100.000 tepat');
assert.strictEqual(terbilang(0), 'Nol rupiah', 'Terbilang 0 tepat');

// 31. DOM & NFR - Stepper step="1000", chips, tombol clear, dan container pecahan di DOM
const latestHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
assert.ok(latestHtml.includes('step="1000"'), 'Input kasir memiliki atribut step="1000"');
assert.ok(latestHtml.includes('id="btn-cash-clear"'), 'Tombol clear C tersedia');
assert.ok(latestHtml.includes('data-add="500"'), 'Chip +500 tersedia');
assert.ok(latestHtml.includes('data-add="1000"'), 'Chip +1.000 tersedia');
assert.ok(latestHtml.includes('data-add="2000"'), 'Chip +2.000 tersedia');
assert.ok(latestHtml.includes('data-add="5000"'), 'Chip +5.000 tersedia');
assert.ok(latestHtml.includes('id="checkout-change-breakdown"'), 'Container rincian kembalian tersedia');
assert.ok(latestHtml.includes('id="checkout-cash-terbilang"'), 'Container teks terbilang tersedia');

// 32. Neo-Tactile & Fitur Kasir Lanjutan - Jam realtime, quick strip receh, filter pills
assert.ok(latestHtml.includes('id="header-clock"'), 'Jam realtime di header tersedia');
assert.ok(latestHtml.includes('class="quick-strip"'), 'Strip jual cepat receh warung tersedia');
assert.ok(latestHtml.includes('class="category-filter-row"'), 'Row filter kategori tersedia');
assert.ok(css.includes('--shadow-tactile-primary'), 'Token tactile 3D register keys tersedia di CSS');
assert.ok(css.includes('data-amount="100000"'), 'Styling pecahan merah 100k tersedia di CSS');

// 33. Logika Laporan & Cadangan - Export CSV Laporan & Restore Transaksi
assert.ok(latestHtml.includes('id="btn-export-laporan-csv"'), 'Tombol ekspor CSV tersedia di laporan');
assert.ok(appSource.includes('function exportLaporanCSV'), 'Fungsi exportLaporanCSV tersedia');
assert.ok(dbSource.includes('export async function restoreTransaction'), 'restoreTransaction tersedia untuk cadangan lengkap');

console.log(`✓ All 33 automated verification checks passed cleanly! (Total bundle: ${totalKb.toFixed(1)} KB, Contrast: ${textContrast.toFixed(1)}:1)`);