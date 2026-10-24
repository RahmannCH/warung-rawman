// ponytail: Vanilla controller without reactive framework runs under 20ms on 2GB RAM; upgrade to tiny signal state if screen count grows beyond 6.

import * as db from './db.js';
import * as audio from './audio.js';
import * as receipt from './receipt.js';
import * as sync from './sync.js';
import * as pin from './pin.js';
import * as printer from './printer.js';

// State aplikasi
const state = {
  currentTab: 'kasir',
  items: [],
  cart: [],
  settings: {},
  activeTransactionForReceipt: null,
  activeItemPhoto: null,
  lastReceiptId: '',
  pinUnlocked: false,
  pendingNavTab: null,
  isSyncing: false,
  activeCategory: 'all',
  isOnline: navigator.onLine
};

// Inisialisasi
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await db.openDB();
    await db.seedInitialData();
    await db.migratePinToHash();
    await requestPersistentStorage();
    await loadSettings();
    await loadCatalog();
    initEventListeners();
    initServiceWorker();
    initClock();
    updateConnectionStatus();
    await refreshPendingBadge();
    if (state.isOnline && state.settings.sync_endpoint) runSync({ silent: true });
  } catch (err) {
    showToast('Gagal memuat sistem: ' + err.message, 'error');
  }
});

// Minta storage persisten agar IndexedDB tidak dievict browser saat HP kehabisan ruang.
async function requestPersistentStorage() {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return;
    if (typeof navigator.storage.persisted === 'function' && (await navigator.storage.persisted())) {
      state.storagePersisted = true;
      return;
    }
    state.storagePersisted = await navigator.storage.persist();
  } catch {
    state.storagePersisted = false;
  }
}

// Jam Realtime Header
function initClock() {
  const clock = document.getElementById('header-clock');
  if (!clock) return;
  const update = () => {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };
  update();
  setInterval(update, 10000);
}

// Service Worker
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// Koneksi Status
function updateConnectionStatus() {
  const badge = document.getElementById('connection-status');
  const text = document.getElementById('connection-text');
  state.isOnline = navigator.onLine;

  if (state.isOnline) {
    badge.className = 'status-badge status-online';
    text.textContent = 'Online';
  } else {
    badge.className = 'status-badge status-offline';
    text.textContent = 'Offline (Tersimpan Lokal)';
  }
}

window.addEventListener('online', () => {
  updateConnectionStatus();
  showToast('Koneksi internet terhubung kembali', 'success');
  runSync({ silent: true });
});

window.addEventListener('offline', () => {
  updateConnectionStatus();
  showToast('Mode offline aktif. Semua transaksi tetap tersimpan lokal', 'success');
});

// Ikon audio: SVG aktif/bisu tanpa bergantung font emoji perangkat
function renderSoundIcon(enabled) {
  const onIcon = document.getElementById('sound-on-icon');
  const offIcon = document.getElementById('sound-off-icon');
  if (onIcon) onIcon.style.display = enabled ? 'block' : 'none';
  if (offIcon) offIcon.style.display = enabled ? 'none' : 'block';
}

// Muat Pengaturan
async function loadSettings() {
  state.settings = {
    nama_warung: await db.getSetting('nama_warung', 'Warung Rawman'),
    alamat: await db.getSetting('alamat', 'Jl. Rawamangun Raya No. 12'),
    no_wa: await db.getSetting('no_wa', '081234567890'),
    footer_struk: await db.getSetting('footer_struk', 'Terima kasih telah berbelanja di Warung Rawman!'),
    pin_hash: await db.getSetting('pin_hash', ''),
    pin_attempts: await db.getSetting('pin_attempts', 0),
    pin_locked_until: await db.getSetting('pin_locked_until', 0),
    suara_aktif: await db.getSetting('suara_aktif', true),
    sync_endpoint: await db.getSetting('sync_endpoint', '')
  };
  state.lastReceiptId = await db.getSetting('last_receipt_id', '');

  document.getElementById('header-warung-name').textContent = state.settings.nama_warung;
  document.getElementById('setting-nama').value = state.settings.nama_warung;
  document.getElementById('setting-alamat').value = state.settings.alamat;
  document.getElementById('setting-wa').value = state.settings.no_wa;
  document.getElementById('setting-footer').value = state.settings.footer_struk;
  // Hash PIN tidak pernah ditampilkan kembali ke layar.
  document.getElementById('setting-pin').value = '';
  document.getElementById('setting-sync-endpoint').value = state.settings.sync_endpoint;

  audio.setSoundEnabled(state.settings.suara_aktif);
  renderSoundIcon(state.settings.suara_aktif);
}

// ==== Antrean Sinkronisasi (M1) ====
async function refreshPendingBadge() {
  const pending = await db.getTransactionsByStatus('antre');
  const badge = document.getElementById('btn-sync-pending');
  const count = document.getElementById('sync-pending-count');
  const statusText = document.getElementById('sync-status-text');
  const syncBtn = document.getElementById('btn-sync-now');

  count.textContent = pending.length;
  badge.style.display = pending.length > 0 ? 'inline-flex' : 'none';

  if (statusText) {
    if (!state.settings.sync_endpoint) {
      statusText.textContent = 'Mode lokal murni: transaksi disimpan di HP dan tidak dikirim ke server. Isi URL Sinkronisasi untuk mengaktifkan antrean.';
    } else if (pending.length === 0) {
      statusText.textContent = 'Semua transaksi sudah tersinkron ke server koperasi.';
    } else {
      const lastError = pending.find((tx) => tx.sync_error);
      statusText.textContent = lastError
        ? `${pending.length} transaksi menunggu. Kendala terakhir: ${lastError.sync_error}`
        : `${pending.length} transaksi menunggu dikirim saat online.`;
    }
  }

  if (syncBtn) {
    syncBtn.disabled = !state.settings.sync_endpoint || pending.length === 0 || state.isSyncing;
  }

  return pending.length;
}

async function runSync({ silent = false } = {}) {
  if (state.isSyncing) return;
  if (!state.settings.sync_endpoint) {
    if (!silent) showToast('Isi URL Sinkronisasi Koperasi di Pengaturan terlebih dahulu.', 'error');
    await refreshPendingBadge();
    return;
  }
  if (!navigator.onLine) {
    if (!silent) showToast('Masih offline. Antrean akan dikirim otomatis saat online.', 'error');
    await refreshPendingBadge();
    return;
  }

  state.isSyncing = true;
  await refreshPendingBadge();
  setScreenState('state-sync', 'loading', { message: 'Mengirim antrean transaksi...' });

  try {
    const result = await sync.syncPending({ endpoint: state.settings.sync_endpoint });

    if (result.total === 0) {
      setScreenState('state-sync', 'ready');
      if (!silent) showToast('Tidak ada transaksi menunggu.', 'success');
    } else if (result.failed === 0 && !result.reason) {
      setScreenState('state-sync', 'ready');
      audio.playSuccess();
      const dupText = result.duplicate > 0 ? ` (${result.duplicate} duplikat ditandai)` : '';
      showToast(`${result.synced + result.duplicate} transaksi tersinkron${dupText}`, 'success');
    } else {
      audio.playError();
      setScreenState('state-sync', 'error', {
        message: `Sinkronisasi gagal: ${result.reason || 'sebagian transaksi ditolak server'}`,
        onRetry: () => runSync()
      });
      showToast(
        `Sinkronisasi gagal: ${result.reason || 'sebagian transaksi ditolak'}`,
        'error',
        { label: 'Ulangi', onClick: () => runSync() }
      );
    }
  } catch (err) {
    audio.playError();
    setScreenState('state-sync', 'error', {
      message: `Sinkronisasi gagal: ${err.message}`,
      onRetry: () => runSync()
    });
    showToast('Sinkronisasi gagal: ' + err.message, 'error', { label: 'Ulangi', onClick: () => runSync() });
  } finally {
    state.isSyncing = false;
    await refreshPendingBadge();
    await renderLaporan();
  }
}

// State handler seragam: kosong / memuat / gagal untuk semua layar
function setScreenState(containerId, mode, options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (mode === 'ready') {
    el.style.display = 'none';
    el.className = 'state-box';
    el.innerHTML = '';
    return;
  }

  el.style.display = 'block';
  el.className = mode === 'loading' ? 'state-box is-loading' : mode === 'error' ? 'state-box is-error' : 'state-box';

  if (mode === 'loading') {
    el.innerHTML = `<div class="state-spinner" aria-hidden="true"></div><div class="state-msg">${escapeHtml(options.message || 'Memuat data...')}</div>`;
    return;
  }

  const icon = mode === 'error' ? '⚠️' : '📦';
  el.innerHTML = `
    <div class="state-icon" aria-hidden="true">${icon}</div>
    <div class="state-msg">${escapeHtml(options.message || 'Belum ada data.')}</div>
  `;

  if (mode === 'error' && typeof options.onRetry === 'function') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Ulangi';
    retry.addEventListener('click', options.onRetry);
    el.appendChild(retry);
  }
}

// Muat Katalog Barang
async function loadCatalog() {
  const loading = document.getElementById('catalog-loading');
  const empty = document.getElementById('catalog-empty');
  setScreenState('state-kasir', 'ready');
  loading.style.display = 'block';

  try {
    state.items = await db.getAllItems();
    renderCatalog();
    renderStokTable();
  } catch (err) {
    setScreenState('state-kasir', 'error', {
      message: `Gagal memuat barang: ${err.message}`,
      onRetry: () => loadCatalog()
    });
  } finally {
    loading.style.display = 'none';
  }
}

// Render Grid Katalog Kasir dengan Filter Kategori
function matchesCategory(item, cat) {
  if (cat === 'all') return true;
  if (cat === 'low') return (item.stok || 0) <= 5;
  const name = (item.nama || '').toLowerCase();
  if (cat === 'sembako') return /beras|minyak|gula|telur|terigu|garam/i.test(name);
  if (cat === 'minuman') return /kopi|teh|susu|es |air|jus|aqua/i.test(name);
  if (cat === 'makanan') return /mie|indomie|snack|kerupuk|roti|biskuit/i.test(name);
  if (cat === 'sabun') return /sabun|shampo|odol|deterjen|rinso|sunlight/i.test(name);
  return true;
}

function renderCatalog(filterText = '') {
  const container = document.getElementById('item-grid');
  const empty = document.getElementById('catalog-empty');

  const filtered = state.items.filter((item) => {
    const textMatch = item.nama.toLowerCase().includes(filterText.toLowerCase());
    const catMatch = matchesCategory(item, state.activeCategory);
    return textMatch && catMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = filtered
    .map((item) => {
      const isLow = item.stok <= 5;
      return `
      <div class="item-card ${isLow ? 'low-stock' : ''}" data-id="${item.id}" tabindex="0" role="button" aria-label="Tambah ${escapeHtml(item.nama)}">
        ${item.foto ? `<img class="item-card-img" src="${item.foto}" alt="${escapeHtml(item.nama)}" loading="lazy" />` : ''}
        <div class="item-card-title">${escapeHtml(item.nama)}</div>
        <div class="item-card-footer">
          <span class="item-card-price">${receipt.formatRupiah(item.harga)}</span>
          <span class="item-card-stock">${item.stok < 0 ? `<b style="color:var(--danger)">Minus ${Math.abs(item.stok)}</b>` : (item.stok === 0 ? '<b style="color:var(--danger)">Habis</b>' : `Sisa: ${item.stok}`)}</span>
        </div>
      </div>
    `;
    })
    .join('');

  // Pasang event click kartu
  container.querySelectorAll('.item-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      addToCartById(id);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        addToCartById(card.dataset.id);
      }
    });
  });
}

// Tambah Item ke Keranjang
function addToCartById(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;

  const existing = state.cart.find((c) => c.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      id: item.id,
      nama: item.nama,
      harga: item.harga,
      harga_beli: item.harga_beli || 0,
      qty: 1
    });
  }

  audio.playClick();
  renderCart();
}

// Tambah Barang Manual / Lepasan
function addManualItem() {
  const namaInput = document.getElementById('manual-nama');
  const hargaInput = document.getElementById('manual-harga');

  const nama = namaInput.value.trim();
  const harga = parseInt(hargaInput.value, 10);

  if (!nama) {
    showToast('Masukkan nama barang manual', 'error');
    namaInput.focus();
    return;
  }
  if (isNaN(harga) || harga <= 0) {
    showToast('Masukkan harga yang valid', 'error');
    hargaInput.focus();
    return;
  }

  const existing = state.cart.find(
    (c) => c.nama.toLowerCase() === nama.toLowerCase() && c.harga === harga
  );
  if (existing) {
    existing.qty += 1;
  } else {
    const manualId = 'manual-' + Date.now();
    state.cart.push({
      id: manualId,
      nama: nama,
      harga: harga,
      harga_beli: Math.round(harga * 0.8),
      qty: 1
    });
  }

  namaInput.value = '';
  hargaInput.value = '';
  audio.playClick();
  renderCart();
  showToast(`Ditambahkan: ${nama}`, 'success');
}

// Render Keranjang Belanja
function renderCart() {
  const list = document.getElementById('cart-items');
  const totalDisplay = document.getElementById('cart-total');
  const payBtn = document.getElementById('btn-open-pay');

  if (state.cart.length === 0) {
    list.innerHTML = `<div class="cart-empty">Keranjang masih kosong.<br/>Ketuk barang untuk menambahkan.</div>`;
    totalDisplay.textContent = 'Rp 0';
    payBtn.disabled = true;
    return;
  }

  let total = 0;
  list.innerHTML = state.cart
    .map((item, index) => {
      const subtotal = item.harga * item.qty;
      total += subtotal;
      return `
      <div class="cart-row">
        <div class="cart-row-info">
          <div class="cart-row-name">${escapeHtml(item.nama)}</div>
          <div class="cart-row-price">${receipt.formatRupiah(item.harga)} x ${item.qty} = <b>${receipt.formatRupiah(subtotal)}</b></div>
        </div>
        <div class="cart-qty-controls">
          <button class="btn-qty btn-minus" data-index="${index}" aria-label="Kurangi">-</button>
          <span class="cart-qty-val">${item.qty}</span>
          <button class="btn-qty btn-plus" data-index="${index}" aria-label="Tambah">+</button>
        </div>
      </div>
    `;
    })
    .join('');

  totalDisplay.textContent = receipt.formatRupiah(total);
  payBtn.disabled = false;

  // Bind qty buttons
  list.querySelectorAll('.btn-minus').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (state.cart[idx]) {
        state.cart[idx].qty -= 1;
        if (state.cart[idx].qty <= 0) {
          state.cart.splice(idx, 1);
        }
        audio.playClick();
        renderCart();
      }
    });
  });

  list.querySelectorAll('.btn-plus').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (state.cart[idx]) {
        state.cart[idx].qty += 1;
        audio.playClick();
        renderCart();
      }
    });
  });
}

function getCartTotal() {
  return state.cart.reduce((sum, item) => sum + item.harga * item.qty, 0);
}

// Buka Modal Checkout
function openCheckoutModal() {
  if (state.cart.length === 0) return;
  const total = getCartTotal();
  document.getElementById('checkout-total-bill').textContent = receipt.formatRupiah(total);
  renderQuickCashPresets(total);
  const cashInput = document.getElementById('checkout-cash-input');
  cashInput.value = '';
  calculateChange();
  document.getElementById('modal-checkout').classList.remove('hidden');
  cashInput.focus();
}

function renderQuickCashPresets(total) {
  const grid = document.getElementById('quick-cash-grid');
  if (!grid) return;
  const presets = receipt.calculateSmartPresets(total);
  grid.innerHTML = presets
    .map((p) => {
      const isPas = p.isPas ? ' is-pas' : '';
      return `<button type="button" class="btn-cash${isPas}" data-amount="${p.amount}">${escapeHtml(p.label)}</button>`;
    })
    .join('');

  grid.querySelectorAll('.btn-cash').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.playClick();
      const cashInput = document.getElementById('checkout-cash-input');
      cashInput.value = btn.dataset.amount;
      calculateChange();
    });
  });
}

function closeCheckoutModal() {
  document.getElementById('modal-checkout').classList.add('hidden');
}

// Hitung Kembalian
function calculateChange() {
  const total = getCartTotal();
  const cashInput = document.getElementById('checkout-cash-input');
  const rawCash = cashInput.value.trim();
  const cash = parseInt(rawCash, 10) || 0;
  const changeEl = document.getElementById('checkout-change');
  const changeDisplay = document.querySelector('.change-display');
  const breakdownEl = document.getElementById('checkout-change-breakdown');
  const terbilangEl = document.getElementById('checkout-cash-terbilang');
  const finishBtns = [
    document.getElementById('btn-finish-print'),
    document.getElementById('btn-finish-wa'),
    document.getElementById('btn-finish-only')
  ];

  if (terbilangEl) {
    terbilangEl.textContent = rawCash && cash > 0 ? receipt.terbilang(cash) : '';
  }

  const diff = cash - total;

  if (!rawCash || cash === 0) {
    changeEl.textContent = 'Rp 0';
    if (changeDisplay) changeDisplay.className = 'change-display';
    if (breakdownEl) {
      breakdownEl.style.display = 'none';
      breakdownEl.innerHTML = '';
    }
    finishBtns.forEach((btn) => { if (btn) btn.disabled = true; });
    return;
  }

  if (diff >= 0) {
    changeEl.textContent = receipt.formatRupiah(diff);
    if (changeDisplay) changeDisplay.className = 'change-display';
    finishBtns.forEach((btn) => { if (btn) btn.disabled = false; });

    if (breakdownEl) {
      const breakdown = receipt.calculateChangeBreakdown(diff);
      if (breakdown.length > 0) {
        breakdownEl.innerHTML =
          '<span style="font-size:0.75rem; color:#15803d; width:100%; display:block; margin-bottom:4px; font-weight:700;">Rekomendasi pecahan kembalian:</span>' +
          breakdown
            .map((b) => `<span class="change-pill">${b.isCoin ? '🪙' : '💵'} ${b.qty}x ${receipt.formatNumber(b.denom)}</span>`)
            .join('');
        breakdownEl.style.display = 'flex';
      } else {
        breakdownEl.style.display = 'none';
        breakdownEl.innerHTML = '';
      }
    }
  } else {
    changeEl.textContent = `Kurang ${receipt.formatRupiah(Math.abs(diff))}`;
    if (changeDisplay) changeDisplay.className = 'change-display is-short';
    if (breakdownEl) {
      breakdownEl.style.display = 'none';
      breakdownEl.innerHTML = '';
    }
    finishBtns.forEach((btn) => { if (btn) btn.disabled = true; });
  }
}

// Simpan Transaksi (M1, M2, M3)
async function processTransaction(actionType = 'print') {
  const total = getCartTotal();
  const cashInput = document.getElementById('checkout-cash-input');
  const cash = parseInt(cashInput.value, 10) || 0;

  if (cash < total) {
    audio.playError();
    showToast('Uang pembayaran masih kurang dari total belanja!', 'error');
    cashInput.focus();
    return;
  }

  const change = cash - total;
  const txId = 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
  const idempotencyKey = 'idmp-' + txId;

  const needsSync = !!state.settings.sync_endpoint;
  const transactionData = {
    id: txId,
    waktu: new Date().toISOString(),
    kasir_nama: 'Kasir',
    total: total,
    bayar: cash,
    kembali: change,
    items: JSON.parse(JSON.stringify(state.cart)),
    status: needsSync ? 'antre' : 'tersimpan',
    idempotency_key: idempotencyKey
  };

  try {
    const result = await db.saveTransaction(transactionData);
    audio.playSuccess();
    showToast(needsSync ? 'Transaksi tersimpan lokal (antre sinkron)' : 'Transaksi berhasil disimpan!', 'success');

    // Bersihkan kasir
    state.cart = [];
    renderCart();
    closeCheckoutModal();
    await loadCatalog(); // Segarkan stok terkini
    await refreshPendingBadge();

    // Aksi lanjutan
    if (actionType === 'print') {
      executeThermalPrint(result.transaction);
    } else if (actionType === 'wa') {
      openReceiptModal(result.transaction, true);
    }

    if (needsSync && state.isOnline) runSync({ silent: true });
  } catch (err) {
    audio.playError();
    const isQuota = err && (err.name === 'QuotaExceededError' || /quota|penuh/i.test(err.message || ''));
    if (isQuota) {
      showToast('Penyimpanan HP penuh. Unduh cadangan lalu hapus data lama.', 'error', {
        label: 'Ke Pengaturan',
        onClick: () => {
          if (state.pinUnlocked) activateTab('pengaturan');
          else {
            state.pendingNavTab = 'pengaturan';
            openPinModal();
          }
        }
      });
      return;
    }
    showToast('Gagal menyimpan transaksi: ' + err.message, 'error', { label: 'Ulangi', onClick: () => processTransaction(actionType) });
  }
}

// Eksekusi Cetak 58mm (M2)
let printGuardTimer = null;

function clearPrintArea() {
  const printArea = document.getElementById('print-area');
  if (printArea) printArea.innerHTML = '';
}

async function executeThermalPrint(transaction) {
  const printArea = document.getElementById('print-area');
  try {
    await db.setSetting('last_receipt_id', transaction.id);
    state.lastReceiptId = transaction.id;

    // Jalur 1: printer thermal BLE (XPrinter) bila sudah terhubung
    if (printer.getConnectedPrinterName()) {
      try {
        await printer.printViaBluetooth(transaction, state.settings);
        audio.playSuccess();
        showToast('Struk terkirim ke printer Bluetooth.', 'success');
        updatePrinterStatus();
        return;
      } catch (btErr) {
        showToast(`Printer Bluetooth gagal (${btErr.message}). Beralih ke dialog cetak 58mm.`, 'error');
      }
    }

    // Jalur 2: dialog cetak browser dengan @page 58mm
    printArea.innerHTML = receipt.generateReceiptHTML(transaction, state.settings);

    if (typeof window.print !== 'function') {
      throw new Error('Perangkat ini tidak mendukung dialog cetak.');
    }

    window.print();

    // Deteksi dialog cetak yang tidak pernah tampil (diblokir/kiosk/printer mati).
    clearTimeout(printGuardTimer);
    printGuardTimer = setTimeout(() => {
      if (document.getElementById('print-area').innerHTML !== '') {
        showPrintFailure('Dialog cetak tidak muncul. Periksa printer dan izin cetak browser.', transaction);
      }
    }, 4000);
  } catch (err) {
    showPrintFailure(err.message, transaction);
  }
}

function updatePrinterStatus() {
  const statusEl = document.getElementById('printer-status');
  const connectBtn = document.getElementById('btn-connect-printer');
  const testBtn = document.getElementById('btn-test-printer');
  const disconnectBtn = document.getElementById('btn-disconnect-printer');
  if (!statusEl) return;

  const name = printer.getConnectedPrinterName();
  if (name) {
    statusEl.textContent = `Terhubung ke ${name}. Struk akan dicetak langsung tanpa dialog browser.`;
    statusEl.style.color = 'var(--success)';
    connectBtn.textContent = 'Ganti Printer';
    testBtn.disabled = false;
    disconnectBtn.disabled = false;
  } else if (!printer.isBluetoothSupported()) {
    statusEl.textContent = 'Browser ini tanpa dukungan Bluetooth. Cetak memakai dialog 58mm (bisa via RawBT).';
    statusEl.style.color = 'var(--text-muted)';
    testBtn.disabled = true;
    disconnectBtn.disabled = true;
  } else {
    statusEl.textContent = 'Belum terhubung. Cetak akan memakai dialog browser (58mm).';
    statusEl.style.color = 'var(--text-muted)';
    connectBtn.textContent = 'Hubungkan Printer Bluetooth';
    testBtn.disabled = true;
    disconnectBtn.disabled = true;
  }
}

async function connectPrinterFlow() {
  try {
    const name = await printer.connectPrinter();
    await db.setSetting('printer_name', name);
    audio.playSuccess();
    showToast(`Printer terhubung: ${name}`, 'success');
  } catch (err) {
    audio.playError();
    showToast(`Gagal menghubungkan printer: ${err.message}`, 'error', {
      label: 'Coba Lagi',
      onClick: () => connectPrinterFlow()
    });
  } finally {
    updatePrinterStatus();
  }
}

function showPrintFailure(reason, transaction) {
  clearTimeout(printGuardTimer);
  audio.playError();
  showToast(`Cetak gagal: ${reason}`, 'error', {
    label: 'Cetak Ulang',
    onClick: () => (transaction ? executeThermalPrint(transaction) : printLastReceipt())
  });
}

async function printLastReceipt() {
  const lastId = state.lastReceiptId || (await db.getSetting('last_receipt_id', ''));
  if (!lastId) {
    showToast('Belum ada struk yang bisa dicetak ulang.', 'error');
    return;
  }
  const all = await db.getAllTransactions();
  const last = all.find((tx) => tx.id === lastId) || all[0];
  if (!last) {
    showToast('Struk terakhir tidak ditemukan di penyimpanan.', 'error');
    return;
  }
  await executeThermalPrint(last);
}

// Kirim WhatsApp dengan fallback bila popup diblokir
function sendReceiptViaWhatsApp(transaction, phone = '') {
  const msg = receipt.generateWhatsAppMessage(transaction, state.settings);
  const url = receipt.getWhatsAppUrl(phone, msg);
  const win = window.open(url, '_blank');

  if (!win) {
    showToast('WhatsApp diblokir browser. Ketuk tombol untuk membuka ulang.', 'error', {
      label: 'Buka WhatsApp Ulang',
      onClick: () => sendReceiptViaWhatsApp(transaction, phone)
    });
  }
}

// Modal Lihat / Kirim Struk Ulang
function openReceiptModal(transaction, directWA = false) {
  state.activeTransactionForReceipt = transaction;
  const container = document.getElementById('receipt-preview-container');
  container.innerHTML = receipt.generateReceiptHTML(transaction, state.settings);
  document.getElementById('modal-receipt-view').classList.remove('hidden');

  if (directWA) {
    sendReceiptViaWhatsApp(transaction);
  }
}

// Kelola Stok (M4)
function renderStokTable(filter = '') {
  try {
    renderStokTableInner(filter);
    setScreenState('state-stok', 'ready');
  } catch (err) {
    setScreenState('state-stok', 'error', {
      message: `Gagal memuat stok: ${err.message}`,
      onRetry: () => renderStokTable(filter)
    });
  }
}

function renderStokTableInner(filter = '') {
  const tbody = document.getElementById('stok-table-body');
  const filtered = state.items.filter((item) => item.nama.toLowerCase().includes(filter.toLowerCase()));

  if (state.items.length === 0) {
    tbody.innerHTML = '';
    setScreenState('state-stok', 'empty', {
      message: 'Belum ada barang. Ketuk "+ Tambah Barang" untuk mencatat dagangan pertama Anda.'
    });
    return;
  }

  setScreenState('state-stok', 'ready');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted)">Tidak ada barang yang cocok dengan pencarian "${escapeHtml(filter)}".</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      const isLow = item.stok <= 5;
      return `
      <tr>
        <td>
          <b>${escapeHtml(item.nama)}</b>
          ${item.stok < 0 ? '<span style="color:var(--danger); font-size:0.78rem; margin-left:4px; font-weight:bold;">(Minus)</span>' : (isLow ? '<span style="color:var(--warning-text); font-size:0.78rem; margin-left:4px; font-weight:600;">(Menipis)</span>' : '')}
        </td>
        <td>${receipt.formatRupiah(item.harga_beli || 0)}</td>
        <td><b>${receipt.formatRupiah(item.harga)}</b></td>
        <td><b style="${item.stok < 0 ? 'color:var(--danger);' : ''}">${item.stok}</b></td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-edit-item btn-table" data-id="${item.id}">Edit</button>
          <button class="btn btn-danger btn-del-item btn-table" data-id="${item.id}">Hapus</button>
        </td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('.btn-edit-item').forEach((btn) => {
    btn.addEventListener('click', () => openItemModal(btn.dataset.id));
  });

  tbody.querySelectorAll('.btn-del-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = state.items.find((i) => i.id === btn.dataset.id);
      if (confirm(`Hapus barang "${item?.nama}"?`)) {
        await db.deleteItem(btn.dataset.id);
        state.cart = state.cart.filter((c) => c.id !== btn.dataset.id);
        renderCart();
        showToast('Barang berhasil dihapus', 'success');
        await loadCatalog();
      }
    });
  });
}

function compressImage(file, maxDimension = 240, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openItemModal(itemId = null) {
  const modal = document.getElementById('modal-item');
  const title = document.getElementById('modal-item-title');
  const form = document.getElementById('form-item');
  const previewBox = document.getElementById('item-foto-preview');
  const previewImg = document.getElementById('item-foto-preview-img');
  const fotoInput = document.getElementById('item-form-foto');
  form.reset();
  fotoInput.value = '';

  if (itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;
    title.textContent = 'Edit Barang';
    document.getElementById('item-form-id').value = item.id;
    document.getElementById('item-form-nama').value = item.nama;
    document.getElementById('item-form-beli').value = item.harga_beli || 0;
    document.getElementById('item-form-jual').value = item.harga;
    document.getElementById('item-form-stok').value = item.stok;
    if (item.foto) {
      state.activeItemPhoto = item.foto;
      previewImg.src = item.foto;
      previewBox.style.display = 'block';
    } else {
      state.activeItemPhoto = null;
      previewBox.style.display = 'none';
    }
  } else {
    title.textContent = 'Tambah Barang Baru';
    document.getElementById('item-form-id').value = '';
    state.activeItemPhoto = null;
    previewBox.style.display = 'none';
  }

  modal.classList.remove('hidden');
  document.getElementById('item-form-nama').focus();
}

function closeItemModal() {
  document.getElementById('modal-item').classList.add('hidden');
  state.activeItemPhoto = null;
}

// Rekap Harian (M3)
async function renderLaporan() {
  const dateInput = document.getElementById('laporan-date');
  const selectedDate = dateInput.value || new Date().toISOString().split('T')[0];
  dateInput.value = selectedDate;

  setScreenState('state-laporan', 'loading', { message: 'Menghitung rekap harian...' });

  try {
    const isEmpty = await renderLaporanInner(selectedDate);
    if (!isEmpty) setScreenState('state-laporan', 'ready');
  } catch (err) {
    setScreenState('state-laporan', 'error', {
      message: `Gagal menghitung rekap: ${err.message}`,
      onRetry: () => renderLaporan()
    });
  }
}

async function renderLaporanInner(selectedDate) {
  const transactions = await db.getTransactionsByDate(selectedDate);
  state.currentLaporanTransactions = transactions;

  let totalOmset = 0;
  let totalHpp = 0;

  for (const tx of transactions) {
    totalOmset += tx.total || 0;
    for (const it of tx.items) {
      const beli = it.harga_beli || 0;
      totalHpp += beli * it.qty;
    }
  }

  const labaKotor = totalOmset - totalHpp;

  document.getElementById('stat-omset').textContent = receipt.formatRupiah(totalOmset);
  document.getElementById('stat-transaksi').textContent = `${transactions.length} struk`;
  document.getElementById('stat-laba').textContent = receipt.formatRupiah(Math.max(0, labaKotor));

  const tbody = document.getElementById('laporan-table-body');
  if (transactions.length === 0) {
    tbody.innerHTML = '';
    setScreenState('state-laporan', 'empty', {
      message: `Belum ada transaksi pada tanggal ${selectedDate}. Rekap akan muncul otomatis setelah transaksi pertama tersimpan.`
    });
    return true;
  }

  tbody.innerHTML = transactions
    .map((tx) => {
      const time = new Date(tx.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const summaryItems = tx.items.map((i) => `${i.qty}x ${escapeHtml(i.nama)}`).join(', ');
      const statusBadge = tx.status === 'antre'
        ? '<span class="status-badge status-pending" style="font-size:0.68rem; padding:2px 6px;">antre</span>'
        : '<span class="status-badge status-online" style="font-size:0.68rem; padding:2px 6px;">tersimpan</span>';
      return `
      <tr>
        <td><b>${time}</b></td>
        <td>#${tx.id.slice(-6)}<br/>${statusBadge}</td>
        <td style="max-width:240px; font-size:0.85rem;">${summaryItems}</td>
        <td><b>${receipt.formatRupiah(tx.total)}</b></td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-reprint btn-table" data-id="${tx.id}">Struk</button>
        </td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('.btn-reprint').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tx = transactions.find((t) => t.id === btn.dataset.id);
      if (tx) openReceiptModal(tx);
    });
  });

  return false;
}

function exportLaporanCSV() {
  const dateInput = document.getElementById('laporan-date');
  const selectedDate = dateInput.value || new Date().toISOString().split('T')[0];
  const transactions = state.currentLaporanTransactions || [];
  if (transactions.length === 0) {
    audio.playError();
    showToast('Tidak ada transaksi pada tanggal ini untuk diekspor', 'error');
    return;
  }
  const headers = ['Waktu', 'No Struk', 'Kasir', 'Rincian Barang', 'Total', 'Bayar', 'Kembali', 'Status'];
  const rows = transactions.map((tx) => [
    `"${tx.waktu}"`,
    `"#${String(tx.id).slice(-6)}"`,
    `"${tx.kasir_nama || 'Kasir'}"`,
    `"${(tx.items || []).map((i) => `${i.qty}x ${i.nama}`).join('; ')}"`,
    tx.total,
    tx.bayar,
    tx.kembali,
    `"${tx.status}"`
  ]);
  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `laporan-warung-${selectedDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  audio.playSuccess();
  showToast('Laporan CSV berhasil diunduh!', 'success');
}

// ==== Gerbang PIN Kasir (S3 / NFR) ====
const PIN_PROTECTED_TABS = ['pengaturan'];

function activateTab(tab) {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));

  const targetScreen = document.getElementById(`screen-${tab}`);
  if (targetScreen) targetScreen.classList.add('active');
  state.currentTab = tab;

  if (tab === 'laporan') renderLaporan();
  if (tab === 'stok') renderStokTable();
  if (tab === 'pengaturan') {
    refreshPendingBadge();
    updatePrinterStatus();
  }
}

function openPinModal() {
  const modal = document.getElementById('modal-pin');
  const input = document.getElementById('pin-input');
  const error = document.getElementById('pin-error');
  const submit = document.getElementById('btn-pin-submit');
  const lockedUntil = Number(state.settings.pin_locked_until || 0);

  if (pin.isLocked(lockedUntil)) {
    const wait = pin.remainingLockSeconds(lockedUntil);
    error.textContent = `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.`;
    error.style.display = 'block';
    input.disabled = true;
    submit.disabled = true;
    setTimeout(() => {
      state.settings.pin_locked_until = 0;
      db.setSetting('pin_locked_until', 0);
      input.disabled = false;
      submit.disabled = false;
      error.style.display = 'none';
      input.focus();
    }, Math.max(1000, wait * 1000));
  } else {
    error.style.display = 'none';
    input.disabled = false;
    submit.disabled = false;
  }

  input.value = '';
  modal.classList.remove('hidden');
  if (!input.disabled) input.focus();
}

function closePinModal() {
  document.getElementById('modal-pin').classList.add('hidden');
  state.pendingNavTab = null;
  // Kembalikan sorotan navigasi ke tab yang benar-benar aktif
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === state.currentTab);
  });
}

async function submitPin() {
  const input = document.getElementById('pin-input');
  const error = document.getElementById('pin-error');
  const value = input.value.trim();

  if (!/^\d{4}$/.test(value)) {
    error.textContent = 'PIN harus 4 digit angka.';
    error.style.display = 'block';
    input.value = '';
    input.focus();
    return;
  }

  const ok = await pin.verifyPin(value, state.settings.pin_hash);
  if (ok) {
    state.pinUnlocked = true;
    state.settings.pin_attempts = 0;
    state.settings.pin_locked_until = 0;
    await db.setSetting('pin_attempts', 0);
    await db.setSetting('pin_locked_until', 0);
    const target = state.pendingNavTab || 'pengaturan';
    state.pendingNavTab = null;
    document.getElementById('modal-pin').classList.add('hidden');
    activateTab(target);
    audio.playSuccess();
    return;
  }

  const next = pin.registerFailure(state.settings.pin_attempts);
  state.settings.pin_attempts = next.attempts;
  state.settings.pin_locked_until = next.lockedUntil;
  await db.setSetting('pin_attempts', next.attempts);
  await db.setSetting('pin_locked_until', next.lockedUntil);

  audio.playError();
  input.value = '';

  if (next.locked) {
    openPinModal();
  } else {
    const left = pin.PIN_MAX_ATTEMPTS - next.attempts;
    error.textContent = `PIN salah. Sisa ${left} percobaan sebelum terkunci 60 detik.`;
    error.style.display = 'block';
    input.focus();
  }
}

// Inisialisasi Seluruh Event Listener
function initEventListeners() {
  // Tab Navigation (Pengaturan dilindungi PIN)
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      audio.playClick();

      if (PIN_PROTECTED_TABS.includes(tab) && !state.pinUnlocked && state.settings.pin_hash) {
        state.pendingNavTab = tab;
        openPinModal();
        return;
      }

      activateTab(tab);
    });
  });

  // Sound toggle
  document.getElementById('btn-toggle-sound').addEventListener('click', async () => {
    const current = audio.isSoundEnabled();
    const next = !current;
    audio.setSoundEnabled(next);
    await db.setSetting('suara_aktif', next);
    renderSoundIcon(next);
    showToast(next ? 'Bunyi diaktifkan' : 'Bunyi dibisukan', 'success');
  });

  // Pencarian Kasir
  const searchKasir = document.getElementById('kasir-search');
  searchKasir.addEventListener('input', (e) => {
    renderCatalog(e.target.value);
  });
  document.getElementById('btn-clear-search').addEventListener('click', () => {
    searchKasir.value = '';
    renderCatalog('');
  });

  // Input Manual Kasir
  document.getElementById('btn-add-manual').addEventListener('click', addManualItem);
  document.getElementById('manual-harga').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addManualItem();
  });

  // Filter Kategori Kasir
  document.querySelectorAll('.cat-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      audio.playClick();
      document.querySelectorAll('.cat-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeCategory = pill.dataset.cat || 'all';
      renderCatalog(searchKasir.value);
    });
  });

  // Jual Cepat Receh
  document.querySelectorAll('.btn-quick-strip').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.playClick();
      const nama = btn.dataset.nama;
      const harga = parseInt(btn.dataset.harga, 10) || 0;
      const existing = state.cart.find((c) => c.nama === nama && c.harga === harga);
      if (existing) {
        existing.qty += 1;
      } else {
        const quickId = 'quick-' + nama.toLowerCase().replace(/[^a-z0-9]/g, '-');
        state.cart.push({
          id: quickId,
          nama: nama,
          harga: harga,
          harga_beli: Math.round(harga * 0.75),
          qty: 1
        });
      }
      renderCart();
      showToast(`+ ${nama}`, 'success');
    });
  });

  // Keranjang
  document.getElementById('btn-clear-cart').addEventListener('click', () => {
    if (state.cart.length === 0) return;
    if (confirm('Kosongkan semua barang di keranjang?')) {
      state.cart = [];
      renderCart();
      audio.playClick();
    }
  });

  document.getElementById('btn-open-pay').addEventListener('click', () => {
    audio.playClick();
    openCheckoutModal();
  });

  document.getElementById('btn-close-checkout').addEventListener('click', closeCheckoutModal);

  // Input Pembayaran Tunai & Stepper Panah (+- 1.000)
  const cashInput = document.getElementById('checkout-cash-input');
  cashInput.addEventListener('input', calculateChange);
  cashInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const current = parseInt(cashInput.value, 10) || 0;
      cashInput.value = receipt.stepAmount(current, 'up', 1000);
      calculateChange();
      audio.playClick();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const current = parseInt(cashInput.value, 10) || 0;
      cashInput.value = receipt.stepAmount(current, 'down', 1000);
      calculateChange();
      audio.playClick();
    }
  });

  // Tombol C (Kosongkan Input)
  const cashClearBtn = document.getElementById('btn-cash-clear');
  if (cashClearBtn) {
    cashClearBtn.addEventListener('click', () => {
      audio.playClick();
      cashInput.value = '';
      calculateChange();
      cashInput.focus();
    });
  }

  // Chip Tambah Uang Akumulatif (+500, +1.000, +2.000, dst)
  document.querySelectorAll('.btn-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      audio.playClick();
      const add = parseInt(chip.dataset.add, 10) || 0;
      const current = parseInt(cashInput.value, 10) || 0;
      cashInput.value = current + add;
      calculateChange();
    });
  });

  document.querySelectorAll('.btn-cash').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.playClick();
      const val = btn.dataset.amount;
      if (val === 'pas') {
        cashInput.value = getCartTotal();
      } else {
        cashInput.value = val;
      }
      calculateChange();
    });
  });

  // Tombol Selesai Pembayaran
  document.getElementById('btn-finish-print').addEventListener('click', () => processTransaction('print'));
  document.getElementById('btn-finish-wa').addEventListener('click', () => processTransaction('wa'));
  document.getElementById('btn-finish-only').addEventListener('click', () => processTransaction('only'));

  // Form Tambah/Edit Item
  document.getElementById('btn-add-item-modal').addEventListener('click', () => openItemModal());
  document.getElementById('btn-close-item-modal').addEventListener('click', closeItemModal);
  document.getElementById('btn-cancel-item').addEventListener('click', closeItemModal);

  document.getElementById('item-form-foto').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressedBase64 = await compressImage(file, 240, 0.7);
        state.activeItemPhoto = compressedBase64;
        const previewBox = document.getElementById('item-foto-preview');
        const previewImg = document.getElementById('item-foto-preview-img');
        previewImg.src = compressedBase64;
        previewBox.style.display = 'block';
      } catch (err) {
        showToast('Gagal memproses gambar: ' + err.message, 'error');
      }
    }
  });

  document.getElementById('btn-remove-foto').addEventListener('click', () => {
    state.activeItemPhoto = null;
    document.getElementById('item-form-foto').value = '';
    document.getElementById('item-foto-preview').style.display = 'none';
  });

  document.getElementById('form-item').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('item-form-id').value || 'itm-' + Date.now();
    const nama = document.getElementById('item-form-nama').value.trim();
    const harga_beli = parseInt(document.getElementById('item-form-beli').value, 10) || 0;
    const harga = parseInt(document.getElementById('item-form-jual').value, 10) || 0;
    const stok = parseInt(document.getElementById('item-form-stok').value, 10) || 0;
    const foto = state.activeItemPhoto || null;

    if (!nama) {
      audio.playError();
      showToast('Nama barang wajib diisi', 'error');
      document.getElementById('item-form-nama').focus();
      return;
    }
    if (harga <= 0) {
      audio.playError();
      showToast('Harga jual harus lebih dari 0', 'error');
      document.getElementById('item-form-jual').focus();
      return;
    }

    await db.saveItem({ id, nama, harga, harga_beli, stok, foto });
    closeItemModal();
    audio.playSuccess();
    showToast('Barang berhasil disimpan', 'success');
    await loadCatalog();
  });

  // Cetak Ulang Struk Terakhir (M2)
  document.getElementById('btn-print-last').addEventListener('click', () => {
    audio.playClick();
    printLastReceipt();
  });

  // Bersihkan area cetak agar RAM 2GB tidak menyimpan DOM struk basi
  window.addEventListener('afterprint', () => {
    clearTimeout(printGuardTimer);
    clearPrintArea();
  });

  // Global Keyboard Navigation (Tab, Enter, Escape)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCheckoutModal();
      closeItemModal();
      document.getElementById('modal-receipt-view').classList.add('hidden');
      if (document.getElementById('modal-pin').classList.contains('hidden') === false) {
        closePinModal();
      }
    }
    if (e.key === 'Enter') {
      const checkoutModal = document.getElementById('modal-checkout');
      if (!checkoutModal.classList.contains('hidden')) {
        const cashInput = document.getElementById('checkout-cash-input');
        if (document.activeElement === cashInput) {
          e.preventDefault();
          processTransaction('print');
        }
      }
    }
  });

  // Pencarian Stok
  document.getElementById('stok-search').addEventListener('input', (e) => {
    renderStokTable(e.target.value);
  });

  // Filter Tanggal Laporan & Export CSV
  document.getElementById('laporan-date').addEventListener('change', renderLaporan);
  document.getElementById('btn-export-laporan-csv').addEventListener('click', exportLaporanCSV);

  // Modal Cetak & WA Struk
  document.getElementById('btn-close-receipt-view').addEventListener('click', () => {
    document.getElementById('modal-receipt-view').classList.add('hidden');
  });

  document.getElementById('btn-print-again').addEventListener('click', () => {
    if (state.activeTransactionForReceipt) {
      executeThermalPrint(state.activeTransactionForReceipt);
    }
  });

  document.getElementById('btn-send-wa-again').addEventListener('click', () => {
    if (!state.activeTransactionForReceipt) return;
    const phone = document.getElementById('receipt-customer-phone').value;
    sendReceiptViaWhatsApp(state.activeTransactionForReceipt, phone);
  });

  // Form Pengaturan
  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = document.getElementById('setting-nama').value.trim();
    const alamat = document.getElementById('setting-alamat').value.trim();
    const wa = document.getElementById('setting-wa').value.trim();
    const footer = document.getElementById('setting-footer').value.trim();
    const newPin = document.getElementById('setting-pin').value.trim();
    const syncEndpoint = document.getElementById('setting-sync-endpoint').value.trim();

    if (newPin && !/^\d{4}$/.test(newPin)) {
      audio.playError();
      showToast('PIN harus tepat 4 digit angka.', 'error');
      document.getElementById('setting-pin').focus();
      return;
    }

    await db.setSetting('nama_warung', nama);
    await db.setSetting('alamat', alamat);
    await db.setSetting('no_wa', wa);
    await db.setSetting('footer_struk', footer);
    await db.setSetting('sync_endpoint', syncEndpoint);

    // Simpan hanya hash; PIN plaintext tidak pernah menyentuh disk.
    if (newPin) {
      await db.setSetting('pin_hash', await pin.hashPin(newPin));
      await db.setSetting('pin_attempts', 0);
      await db.setSetting('pin_locked_until', 0);
    }

    await loadSettings();
    await refreshPendingBadge();
    audio.playSuccess();
    showToast(newPin ? 'Pengaturan & PIN tersimpan!' : 'Pengaturan warung tersimpan!', 'success');
  });

  // Gerbang PIN
  document.getElementById('btn-pin-submit').addEventListener('click', submitPin);
  document.getElementById('btn-close-pin').addEventListener('click', closePinModal);
  document.getElementById('pin-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitPin();
    }
  });

  // Antrean Sinkronisasi Manual
  document.getElementById('btn-sync-now').addEventListener('click', () => runSync());
  document.getElementById('btn-sync-pending').addEventListener('click', () => {
    document.querySelector('.nav-item[data-tab="pengaturan"]').click();
    runSync();
  });

  // Kontrol Printer Thermal Bluetooth
  document.getElementById('btn-connect-printer').addEventListener('click', connectPrinterFlow);
  document.getElementById('btn-disconnect-printer').addEventListener('click', () => {
    printer.disconnectPrinter();
    updatePrinterStatus();
    showToast('Printer Bluetooth diputuskan', 'success');
  });
  document.getElementById('btn-test-printer').addEventListener('click', async () => {
    const mockTx = {
      id: 'test-print',
      waktu: new Date().toISOString(),
      kasir_nama: 'Kasir',
      total: 10000,
      bayar: 10000,
      kembali: 0,
      items: [{ id: 'test', nama: 'Tes Cetak Printer Warung', harga: 10000, qty: 1 }]
    };
    try {
      await printer.printViaBluetooth(mockTx, state.settings);
      audio.playSuccess();
      showToast('Tes cetak terkirim ke printer Bluetooth!', 'success');
    } catch (err) {
      audio.playError();
      showToast('Gagal cetak uji: ' + err.message, 'error');
    }
  });

  // Export Cadangan
  document.getElementById('btn-export-backup').addEventListener('click', async () => {
    const backupData = {
      version: 1,
      timestamp: new Date().toISOString(),
      items: await db.getAllItems(),
      transactions: await db.getAllTransactions(),
      settings: state.settings
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-warung-rawman-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Cadangan data berhasil diunduh', 'success');
  });

  // Import Cadangan
  document.getElementById('input-import-backup').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.items && Array.isArray(data.items)) {
          for (const item of data.items) await db.saveItem(item);
        }
        if (data.transactions && Array.isArray(data.transactions)) {
          for (const tx of data.transactions) await db.restoreTransaction(tx);
        }
        if (data.settings && typeof data.settings === 'object') {
          for (const [key, value] of Object.entries(data.settings)) {
            await db.setSetting(key, value);
          }
        }
        showToast('Data berhasil dipulihkan lengkap!', 'success');
        await loadCatalog();
        await loadSettings();
        await renderLaporan();
      } catch (err) {
        showToast('Berkas cadangan tidak valid: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  });
}

// Toast helper (mendukung tombol ulangi sesuai kriteria biner)
function showToast(message, type = 'success', action = null) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  if (action && action.label && action.onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      toast.remove();
      action.onClick();
    });
    toast.appendChild(btn);
  }

  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, action ? 6000 : 2200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}