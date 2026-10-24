// ponytail: Web Bluetooth + ESC/POS covers XPrinter-class BLE printers directly; upgrade to WebUSB/Serial transport if warungs use USB-cable printers.

import { wrapLine, RECEIPT_LINE_WIDTH, DIVIDER_HEAVY, DIVIDER_LIGHT } from './receipt.js';

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

// Layanan BLE umum pada printer thermal murah (XPrinter, Goojprt, dll).
const PRINTER_SERVICES = [
  0x18f0,
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455'
];

const WRITABLE_CHARACTERISTICS = [
  0x2af1,
  '00002af1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3'
];

export function isBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function';
}

// Printer thermal hanya paham ASCII/Latin-1; karakter di luar itu jadi sampah.
export function toEscPosAscii(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '');
}

export function buildEscPosLines(transaction, warungInfo = {}) {
  const namaWarung = toEscPosAscii((warungInfo.nama_warung || 'WARUNG RAWMAN').toUpperCase());
  const alamat = toEscPosAscii(warungInfo.alamat || '');
  const footer = toEscPosAscii(warungInfo.footer_struk || 'Terima kasih');
  const waktu = new Date(transaction.waktu || Date.now());
  const tanggal = toEscPosAscii(
    waktu.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
  );

  const lines = [];
  lines.push({ text: namaWarung, align: 'center', bold: true, size: 'double' });
  if (alamat) alamat.split(/\s{2,}/).forEach((l) => wrapLine(l).forEach((w) => lines.push({ text: w, align: 'center' })));
  lines.push({ text: DIVIDER_HEAVY, align: 'left' });
  lines.push({ text: `No  : #${String(transaction.id).slice(-6)}`, align: 'left' });
  lines.push({ text: `Tgl : ${tanggal}`, align: 'left' });
  lines.push({ text: `Ksr : ${toEscPosAscii(transaction.kasir_nama || 'Kasir').slice(0, 20)}`, align: 'left' });
  lines.push({ text: DIVIDER_LIGHT, align: 'left' });

  for (const item of transaction.items || []) {
    for (const nameLine of wrapLine(toEscPosAscii(item.nama))) {
      lines.push({ text: nameLine, align: 'left', bold: true });
    }
    const subtotal = Number(item.harga || 0) * Number(item.qty || 0);
    const left = `${item.qty} x ${Number(item.harga || 0).toLocaleString('id-ID')}`;
    lines.push({ text: left, align: 'left' });
    lines.push({ text: `      ${subtotal.toLocaleString('id-ID')}`, align: 'right' });
  }

  lines.push({ text: DIVIDER_LIGHT, align: 'left' });
  lines.push({ text: `TOTAL   : ${Number(transaction.total || 0).toLocaleString('id-ID')}`, align: 'left', bold: true });
  lines.push({ text: `BAYAR   : ${Number(transaction.bayar || 0).toLocaleString('id-ID')}`, align: 'left' });
  lines.push({ text: `KEMBALI : ${Number(transaction.kembali || 0).toLocaleString('id-ID')}`, align: 'left' });
  lines.push({ text: DIVIDER_HEAVY, align: 'left' });
  wrapLine(footer).forEach((l) => lines.push({ text: l, align: 'center' }));
  lines.push({ text: 'Kasir Warung Pintar', align: 'center' });

  return lines;
}

export function buildEscPosBytes(transaction, warungInfo = {}) {
  const bytes = [ESC, 0x40]; // ESC @ inisialisasi printer

  const alignCode = (align) => [ESC, 0x61, align === 'center' ? 1 : align === 'right' ? 2 : 0];
  const boldCode = (on) => [ESC, 0x45, on ? 1 : 0];
  const sizeCode = (double) => [GS, 0x21, double ? 0x11 : 0x00];

  bytes.push(...sizeCode(false), ...boldCode(false), ...alignCode('left'));

  for (const line of buildEscPosLines(transaction, warungInfo)) {
    bytes.push(...alignCode(line.align));
    bytes.push(...sizeCode(line.size === 'double'));
    bytes.push(...boldCode(!!line.bold));
    for (const char of line.text.slice(0, RECEIPT_LINE_WIDTH * 2)) {
      bytes.push(char.charCodeAt(0));
    }
    bytes.push(LF);
  }

  bytes.push(LF, LF, GS, 0x56, 0x42, 0x00); // potong kertas (feed + cut)
  return new Uint8Array(bytes);
}

let deviceRef = null;
let characteristicRef = null;

export function getConnectedPrinterName() {
  return deviceRef && deviceRef.gatt && deviceRef.gatt.connected ? deviceRef.name || 'Printer Bluetooth' : '';
}

async function findWritableCharacteristic(server) {
  for (const serviceId of PRINTER_SERVICES) {
    let service;
    try {
      service = await server.getPrimaryService(serviceId);
    } catch {
      continue;
    }
    for (const charId of WRITABLE_CHARACTERISTICS) {
      try {
        const characteristic = await service.getCharacteristic(charId);
        if (characteristic) return characteristic;
      } catch {
        // lanjut ke kandidat berikutnya
      }
    }
    try {
      const chars = await service.getCharacteristics();
      const writable = chars.find((c) => c.properties && (c.properties.write || c.properties.writeWithoutResponse));
      if (writable) return writable;
    } catch {
      // abaikan, coba layanan berikutnya
    }
  }
  return null;
}

export async function connectPrinter() {
  if (!isBluetoothSupported()) {
    throw new Error('Browser ini belum mendukung Bluetooth. Pakai Chrome di Android, atau cetak lewat dialog 58mm.');
  }

  deviceRef = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES
  });

  const server = await deviceRef.gatt.connect();
  characteristicRef = await findWritableCharacteristic(server);

  if (!characteristicRef) {
    deviceRef.gatt.disconnect();
    deviceRef = null;
    throw new Error('Printer terhubung tetapi kanal tulis tidak ditemukan. Coba printer thermal lain.');
  }

  return getConnectedPrinterName();
}

export function disconnectPrinter() {
  try {
    if (deviceRef && deviceRef.gatt && deviceRef.gatt.connected) deviceRef.gatt.disconnect();
  } catch {
    // diabaikan
  }
  deviceRef = null;
  characteristicRef = null;
}

// BLE mengirim per paket kecil; chunk 120 byte aman untuk printer kelas warung.
export async function writeBytes(bytes, chunkSize = 120, delayMs = 20) {
  if (!characteristicRef) throw new Error('Printer belum terhubung.');
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    if (typeof characteristicRef.writeValueWithoutResponse === 'function') {
      await characteristicRef.writeValueWithoutResponse(chunk);
    } else {
      await characteristicRef.writeValue(chunk);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return bytes.length;
}

export async function printViaBluetooth(transaction, warungInfo = {}) {
  if (!characteristicRef) throw new Error('Printer belum terhubung.');
  const bytes = buildEscPosBytes(transaction, warungInfo);
  await writeBytes(bytes);
  return bytes.length;
}
