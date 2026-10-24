// ponytail: SHA-256 PIN gate stops shoulder-surfing and plaintext leakage; upgrade to PBKDF2+per-device salt only if PIN reuse across warungs ever becomes a threat.

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 60 * 1000;

export async function hashPin(pin) {
  const raw = String(pin ?? '');
  if (raw.length !== 4 || !/^\d{4}$/.test(raw)) {
    throw new Error('PIN harus 4 digit angka.');
  }
  const bytes = new TextEncoder().encode(`warung-pintar:${raw}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPin(pin, storedHash) {
  if (!storedHash) return true; // belum pernah diatur: jangan mengunci pemilik
  if (!/^\d{4}$/.test(String(pin ?? ''))) return false;
  const candidate = await hashPin(pin);
  if (candidate.length !== storedHash.length) return false;
  // Perbandingan waktu-konstan sederhana, cukup untuk PIN 4 digit lokal.
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function isLocked(lockedUntil, now = Date.now()) {
  return Number(lockedUntil || 0) > now;
}

export function registerFailure(attempts, now = Date.now()) {
  const next = Number(attempts || 0) + 1;
  if (next >= PIN_MAX_ATTEMPTS) {
    return { attempts: 0, lockedUntil: now + PIN_LOCK_MS, locked: true };
  }
  return { attempts: next, lockedUntil: 0, locked: false };
}

export function remainingLockSeconds(lockedUntil, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(lockedUntil || 0) - now) / 1000));
}
