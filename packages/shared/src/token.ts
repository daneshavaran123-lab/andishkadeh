/**
 * Hashing and token helpers that run unchanged in Node, browsers and Android WebViews
 * (the kiosk core runs in all three). Same output as the Node-only helpers in ./node.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { QR_TOKEN_PREFIX, cleanScannedPayload } from './qr';

/** sha256 of a UTF-8 string or raw bytes, lowercase hex. */
export function sha256HexOf(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cryptographically random bytes from the platform's Web Crypto. */
export function randomBytesOf(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** 24 random bytes → `AKQ1.` + 32 base64url characters (192 bits), as generateQrToken in ./node. */
export function newQrToken(): string {
  return QR_TOKEN_PREFIX + base64Url(randomBytesOf(24));
}

/** sha256 of the cleaned token, as hashQrToken in ./node (only this hash ever leaves the kiosk). */
export function qrTokenHash(token: string): string {
  return sha256HexOf(cleanScannedPayload(token));
}

/**
 * RFC 4122 v4 id. Uses crypto.randomUUID where available; browsers expose it only on HTTPS,
 * so a web kiosk opened over plain HTTP on the local network falls back to getRandomValues.
 */
export function newId(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = randomBytesOf(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
