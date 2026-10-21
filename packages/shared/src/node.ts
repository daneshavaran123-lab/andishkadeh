/**
 * Node-only helpers (server and Electron main process). Not importable from browser bundles.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ACTIVATION_CODE_LENGTH } from './activation';
import { QR_TOKEN_PREFIX, cleanScannedPayload } from './qr';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 24 random bytes → 32 base64url characters (192 bits of entropy). */
export function generateQrToken(): string {
  return QR_TOKEN_PREFIX + randomBytes(24).toString('base64url');
}

export function hashQrToken(token: string): string {
  return sha256Hex(cleanScannedPayload(token));
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function randomApiKey(): string {
  return randomBytes(32).toString('base64url');
}

/** A one-time kiosk activation code: 8 random digits (activation.ts). */
export function generateActivationCode(): string {
  return Array.from({ length: ACTIVATION_CODE_LENGTH }, () => randomInt(10)).join('');
}

export * from './qr';
