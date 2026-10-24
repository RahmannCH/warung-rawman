// ponytail: sync engine is a thin idempotent push loop over the local queue; upgrade to background sync worker / server cursor pull when koperasi API exposes GET /stock today.

import * as db from './db.js';

const TIMEOUT_MS = 10000;
const MAX_BACKOFF_MS = 30000;

export function buildSyncPayload(tx) {
  return {
    id: tx.id,
    waktu: tx.waktu,
    kasir_nama: tx.kasir_nama,
    total: tx.total,
    bayar: tx.bayar,
    kembali: tx.kembali,
    items: (tx.items || []).map((it) => ({
      item_id: it.id,
      nama: it.nama,
      jumlah: it.qty,
      harga_satuan: it.harga
    }))
  };
}

export function getBackoffDelay(attempt) {
  const safe = Math.max(0, Math.min(attempt, 10));
  return Math.min(1000 * Math.pow(2, safe), MAX_BACKOFF_MS);
}

export function getSyncHeaders(tx) {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': tx.idempotency_key
  };
}

function isDuplicateResponse(status, body) {
  if (status === 409) return true;
  return !!(body && (body.duplicate === true || body.status === 'duplicate'));
}

function reasonFrom(status, body) {
  if (body && (body.code || body.message)) {
    return `${status}: ${body.code || body.message}`;
  }
  return `Server menolak (HTTP ${status})`;
}

export async function syncPending({ endpoint, fetcher = null, onProgress = null } = {}) {
  const summary = { total: 0, synced: 0, duplicate: 0, failed: 0, reason: null };

  if (!endpoint) {
    summary.reason = 'Endpoint sinkronisasi belum diatur di Pengaturan.';
    return summary;
  }

  const pending = await db.getTransactionsByStatus('antre');
  summary.total = pending.length;
  if (pending.length === 0) return summary;

  const doFetch = fetcher || (typeof fetch === 'function' ? fetch.bind(window) : null);
  if (!doFetch) {
    summary.reason = 'Browser tidak mendukung jaringan.';
    return summary;
  }

  for (const tx of pending) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    let body = null;

    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: getSyncHeaders(tx),
        body: JSON.stringify(buildSyncPayload(tx)),
        signal: controller.signal
      });
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } catch (err) {
      summary.reason = err.name === 'AbortError' ? 'Koneksi terlalu lambat, sinkronisasi dihentikan.' : 'Tidak ada koneksi ke server.';
      return summary;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      await db.updateTransactionStatus(tx.id, 'tersimpan', { sinkron_pada: new Date().toISOString() });
      summary.synced += 1;
    } else if (isDuplicateResponse(response.status, body)) {
      await db.updateTransactionStatus(tx.id, 'tersimpan', {
        sinkron_pada: new Date().toISOString(),
        sinkron_duplikat: true
      });
      summary.duplicate += 1;
    } else {
      await db.updateTransactionStatus(tx.id, 'antre', { sync_error: reasonFrom(response.status, body) });
      summary.failed += 1;
      summary.reason = reasonFrom(response.status, body);
    }

    if (onProgress) onProgress(summary, tx);
  }

  return summary;
}

export async function retryPending({ maxAttempt = 0, delay = getBackoffDelay, sleeper = (ms) => new Promise((r) => setTimeout(r, ms)), syncFn = syncPending } = {}) {
  let attempt = 0;
  let last = await syncFn();

  while (last.total > 0 && last.synced + last.duplicate < last.total && attempt < maxAttempt) {
    await sleeper(delay(attempt));
    attempt += 1;
    last = await syncFn();
  }

  return { ...last, attempts: attempt };
}
