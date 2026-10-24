// ponytail: Native HTML print and WhatsApp URL scheme cover 58mm thermal output; upgrade to Web Bluetooth ESC/POS raw printer driver if direct USB/BLE connection required.

// 58mm thermal pada font 11px Courier New menampung tepat 32 karakter per baris.
export const RECEIPT_LINE_WIDTH = 32;
export const DIVIDER_HEAVY = '='.repeat(RECEIPT_LINE_WIDTH);
export const DIVIDER_LIGHT = '-'.repeat(RECEIPT_LINE_WIDTH);

export function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(amount || 0);
}

export function formatNumber(amount) {
  return new Intl.NumberFormat('id-ID').format(amount || 0);
}

// Pecah teks panjang jadi beberapa baris tanpa memotong kata bila masih muat.
export function wrapLine(text, width = RECEIPT_LINE_WIDTH) {
  const clean = String(text || '').trim();
  if (!clean) return [''];
  if (width <= 0) return [clean];

  const lines = [];
  let current = '';

  for (const word of clean.split(/\s+/)) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export function generateReceiptHTML(transaction, warungInfo = {}) {
  const namaWarung = (warungInfo.nama_warung || 'WARUNG RAWMAN').toUpperCase();
  const alamat = warungInfo.alamat || 'Jl. Rawamangun Raya No. 12';
  const footer = warungInfo.footer_struk || 'Terima kasih atas kunjungan Anda!';
  const dateFormatted = new Date(transaction.waktu).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const itemsHtml = transaction.items
    .map((item) => {
      const subtotal = item.harga * item.qty;
      const nameLines = wrapLine(item.nama)
        .map((line) => `<div class="receipt-item-name-line">${escapeHtml(line)}</div>`)
        .join('');
      return `
      <div class="receipt-item">
        ${nameLines}
        <div class="receipt-item-detail">
          <span>${item.qty} x ${formatNumber(item.harga)}</span>
          <span>${formatNumber(subtotal)}</span>
        </div>
      </div>`;
    })
    .join('');

  return `
    <div class="thermal-receipt">
      <div class="receipt-header">
        <div class="receipt-title">${escapeHtml(namaWarung)}</div>
        <div class="receipt-subtitle">${escapeHtml(alamat)}</div>
        <div class="receipt-divider">${DIVIDER_HEAVY}</div>
        <div class="receipt-meta">
          <div>No: #${transaction.id.slice(-6)}</div>
          <div>Tgl: ${dateFormatted}</div>
          <div>Kasir: ${escapeHtml(transaction.kasir_nama || 'Kasir')}</div>
        </div>
        <div class="receipt-divider">${DIVIDER_LIGHT}</div>
      </div>

      <div class="receipt-body">
        ${itemsHtml}
      </div>

      <div class="receipt-summary">
        <div class="receipt-divider">${DIVIDER_LIGHT}</div>
        <div class="receipt-row bold">
          <span>TOTAL</span>
          <span>${formatRupiah(transaction.total)}</span>
        </div>
        <div class="receipt-row">
          <span>BAYAR (TUNAI)</span>
          <span>${formatRupiah(transaction.bayar)}</span>
        </div>
        <div class="receipt-row">
          <span>KEMBALI</span>
          <span>${formatRupiah(transaction.kembali)}</span>
        </div>
        <div class="receipt-divider">${DIVIDER_HEAVY}</div>
      </div>

      <div class="receipt-footer">
        <div>${wrapLine(footer).map((line) => escapeHtml(line)).join('<br/>')}</div>
        <div class="receipt-powered">Kasir Warung Pintar</div>
      </div>
    </div>
  `;
}

export function generateWhatsAppMessage(transaction, warungInfo = {}) {
  const namaWarung = warungInfo.nama_warung || 'WARUNG RAWMAN';
  const alamat = warungInfo.alamat || 'Jl. Rawamangun Raya';
  const footer = warungInfo.footer_struk || 'Terima kasih atas kunjungan Anda!';
  const dateFormatted = new Date(transaction.waktu).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  let msg = `*${namaWarung.toUpperCase()}*\n`;
  if (alamat) msg += `${alamat}\n`;
  msg += `${DIVIDER_LIGHT}\n`;
  msg += `No: #${transaction.id.slice(-6)}\n`;
  msg += `Tgl: ${dateFormatted}\n`;
  msg += `${DIVIDER_LIGHT}\n`;

  for (const item of transaction.items) {
    const subtotal = item.harga * item.qty;
    msg += `${wrapLine(item.nama).join('\n')}\n  ${item.qty} x Rp ${formatNumber(item.harga)} = Rp ${formatNumber(subtotal)}\n`;
  }

  msg += `${DIVIDER_LIGHT}\n`;
  msg += `*TOTAL   : ${formatRupiah(transaction.total)}*\n`;
  msg += `Bayar   : ${formatRupiah(transaction.bayar)}\n`;
  msg += `Kembali : ${formatRupiah(transaction.kembali)}\n`;
  msg += `${DIVIDER_LIGHT}\n`;
  msg += `${footer}\n`;

  return msg;
}

export function getWhatsAppUrl(phone, message) {
  let cleanPhone = (phone || '').replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.slice(1);
  }
  const encodedMsg = encodeURIComponent(message);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedMsg}`;
  }
  return `https://wa.me/?text=${encodedMsg}`;
}

export const DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

// Step uang naik/turun dengan pembulatan ke kelipatan step terdekat
export function stepAmount(currentVal, direction, step = 1000) {
  const val = Math.max(0, Math.floor(Number(currentVal) || 0));
  if (direction === 'up') {
    if (val % step !== 0) {
      return Math.ceil(val / step) * step;
    }
    return val + step;
  }
  if (direction === 'down') {
    if (val % step !== 0) {
      return Math.floor(val / step) * step;
    }
    return Math.max(0, val - step);
  }
  return val;
}

// Rekomendasi pecahan uang kembalian greedy (dari nominal terbesar ke koin)
export function calculateChangeBreakdown(changeAmount) {
  let rem = Math.max(0, Math.floor(Number(changeAmount) || 0));
  if (rem === 0) return [];

  const breakdown = [];
  for (const denom of DENOMINATIONS) {
    if (rem >= denom) {
      const count = Math.floor(rem / denom);
      rem %= denom;
      breakdown.push({
        denom,
        qty: count,
        isCoin: denom <= 1000,
        label: `${count}x ${formatRupiah(denom)}`
      });
    }
  }
  return breakdown;
}

// Saran pecahan cepat cerdas berdasarkan total belanja
export function calculateSmartPresets(total) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  if (t === 0) {
    return [
      { label: 'Uang Pas', amount: 0, isPas: true },
      { label: 'Rp 10.000', amount: 10000 },
      { label: 'Rp 20.000', amount: 20000 },
      { label: 'Rp 50.000', amount: 50000 },
      { label: 'Rp 100.000', amount: 100000 },
      { label: 'Rp 200.000', amount: 200000 }
    ];
  }

  const set = new Set();
  const presets = [];

  // 1. Uang Pas
  presets.push({ label: 'Uang Pas', amount: t, isPas: true });
  set.add(t);

  // 2. Pembulatan 5k terdekat
  const next5k = Math.ceil(t / 5000) * 5000;
  if (next5k > t && !set.has(next5k)) {
    presets.push({ label: formatRupiah(next5k), amount: next5k });
    set.add(next5k);
  }

  // 3. Pembulatan 10k terdekat
  const next10k = Math.ceil(t / 10000) * 10000;
  if (next10k > t && !set.has(next10k)) {
    presets.push({ label: formatRupiah(next10k), amount: next10k });
    set.add(next10k);
  }

  // 4. Lembaran uang kertas umum di atas total belanja
  const bills = [10000, 20000, 50000, 100000, 200000, 500000];
  for (const b of bills) {
    if (b > t && !set.has(b)) {
      presets.push({ label: formatRupiah(b), amount: b });
      set.add(b);
    }
    if (presets.length >= 6) break;
  }

  return presets.slice(0, 6);
}

// Konversi angka nominal ke kalimat terbilang rupiah
export function terbilang(n) {
  const num = Math.floor(Math.abs(Number(n) || 0));
  if (num === 0) return 'Nol rupiah';

  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

  function toWords(x) {
    if (x < 12) return satuan[x];
    if (x < 20) return `${toWords(x - 10)} belas`;
    if (x < 100) return `${toWords(Math.floor(x / 10))} puluh ${toWords(x % 10)}`.trim();
    if (x < 200) return `seratus ${toWords(x - 100)}`.trim();
    if (x < 1000) return `${toWords(Math.floor(x / 100))} ratus ${toWords(x % 100)}`.trim();
    if (x < 2000) return `seribu ${toWords(x - 1000)}`.trim();
    if (x < 1000000) return `${toWords(Math.floor(x / 1000))} ribu ${toWords(x % 1000)}`.trim();
    if (x < 1000000000) return `${toWords(Math.floor(x / 1000000))} juta ${toWords(x % 1000000)}`.trim();
    return `${toWords(Math.floor(x / 1000000000))} milyar ${toWords(x % 1000000000)}`.trim();
  }

  const raw = toWords(num);
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);
  return `${capitalized} rupiah`;
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