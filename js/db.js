// ponytail: IndexedDB native wrapper covers local offline storage; upgrade to SQLite/WASM or remote sync worker if transaction count exceeds 100k records.

import { hashPin } from './pin.js';

const DB_NAME = 'WarungRawmanDB';
const DB_VERSION = 1;

let dbInstance = null;

export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('items')) {
        const itemStore = db.createObjectStore('items', { keyPath: 'id' });
        itemStore.createIndex('nama', 'nama', { unique: false });
        itemStore.createIndex('barcode', 'barcode', { unique: false });
      }

      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('waktu', 'waktu', { unique: false });
        txStore.createIndex('idempotency_key', 'idempotency_key', { unique: true });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

export async function seedInitialData() {
  const items = await getAllItems();
  if (items.length > 0) return;

  const defaultItems = [
    { id: 'itm-1', nama: 'Beras Medium 1kg', barcode: '', harga: 14000, harga_beli: 12500, stok: 50 },
    { id: 'itm-2', nama: 'Minyak Goreng 1L', barcode: '', harga: 17500, harga_beli: 15500, stok: 30 },
    { id: 'itm-3', nama: 'Telur Ayam 1kg', barcode: '', harga: 28000, harga_beli: 25000, stok: 20 },
    { id: 'itm-4', nama: 'Gula Pasir 1kg', barcode: '', harga: 17000, harga_beli: 15000, stok: 40 },
    { id: 'itm-5', nama: 'Indomie Goreng', barcode: '', harga: 3500, harga_beli: 3000, stok: 120 },
    { id: 'itm-6', nama: 'Kopi Kapal Api Sachet', barcode: '', harga: 2000, harga_beli: 1500, stok: 80 },
    { id: 'itm-7', nama: 'Teh Celup Kotak', barcode: '', harga: 6000, harga_beli: 5000, stok: 25 },
    { id: 'itm-8', nama: 'Sabun Cuci Piring', barcode: '', harga: 4000, harga_beli: 3200, stok: 35 }
  ];

  for (const item of defaultItems) {
    await saveItem(item);
  }

  const defaultSettings = [
    { key: 'nama_warung', value: 'Warung Rawman' },
    { key: 'alamat', value: 'Jl. Rawamangun Raya No. 12' },
    { key: 'no_wa', value: '081234567890' },
    { key: 'footer_struk', value: 'Terima kasih telah berbelanja di Warung Rawman!' },
    { key: 'pin_hash', value: await hashPin('1234') },
    { key: 'pin_attempts', value: 0 },
    { key: 'pin_locked_until', value: 0 },
    { key: 'suara_aktif', value: true }
  ];

  for (const s of defaultSettings) {
    await setSetting(s.key, s.value);
  }
}

// Migrasi PIN plaintext lama (pin_kasir) ke pin_hash sekali jalan.
export async function migratePinToHash() {
  const legacy = await getSetting('pin_kasir', null);
  if (!legacy) return { migrated: false };

  const already = await getSetting('pin_hash', '');
  if (!already) {
    let hash = '';
    try {
      hash = await hashPin(String(legacy));
    } catch {
      hash = await hashPin('1234');
    }
    await setSetting('pin_hash', hash);
  }
  await deleteSetting('pin_kasir');
  return { migrated: true };
}

export async function getAllItems() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readonly');
    const store = tx.objectStore('items');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getItemById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readonly');
    const store = tx.objectStore('items');
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveItem(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    const store = tx.objectStore('items');
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteItem(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    const store = tx.objectStore('items');
    const request = store.delete(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTransaction(transaction) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['transactions', 'items'], 'readwrite');
    const txStore = tx.objectStore('transactions');
    const itemStore = tx.objectStore('items');

    const idmpIndex = txStore.index('idempotency_key');
    const checkReq = idmpIndex.get(transaction.idempotency_key);

    checkReq.onsuccess = () => {
      if (checkReq.result) {
        resolve({ duplicate: true, transaction: checkReq.result });
        return;
      }

      // Kurangi stok masing-masing item
      for (const item of transaction.items) {
        if (!item.id || item.id.startsWith('manual-')) continue;
        const getItemReq = itemStore.get(item.id);
        getItemReq.onsuccess = () => {
          const currentItem = getItemReq.result;
          if (currentItem) {
            currentItem.stok = (currentItem.stok || 0) - item.qty;
            itemStore.put(currentItem);
          }
        };
      }

      const saveReq = txStore.add(transaction);
      saveReq.onsuccess = () => resolve({ duplicate: false, transaction });
      saveReq.onerror = () => reject(saveReq.error);
    };

    checkReq.onerror = () => reject(checkReq.error);
  });
}

export async function restoreTransaction(transaction) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    const request = store.put(transaction);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllTransactions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readonly');
    const store = tx.objectStore('transactions');
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result || [];
      results.sort((a, b) => new Date(b.waktu) - new Date(a.waktu));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getTransactionsByDate(dateStr) {
  const all = await getAllTransactions();
  return all.filter((tx) => {
    const txDate = tx.waktu ? tx.waktu.split('T')[0] : '';
    return txDate === dateStr;
  });
}

export async function getTransactionsByStatus(status) {
  const all = await getAllTransactions();
  return all.filter((tx) => tx.status === status);
}

export async function updateTransactionStatus(id, status, patch = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error('Transaksi tidak ditemukan'));
        return;
      }
      const updated = { ...existing, ...patch, status };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getSetting(key, defaultValue = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result !== undefined && request.result.value !== undefined) {
        resolve(request.result.value);
      } else {
        resolve(defaultValue);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function setSetting(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const request = store.put({ key, value });
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSetting(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const request = store.delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}