/**
 * QR membership token format (browser-safe part).
 * The token is random and carries no personal data (PRD §9, §18): "AKQ1." + 32 base64url chars.
 * Only its SHA-256 hash is stored on the server and in the kiosk cache.
 */
export const QR_TOKEN_PREFIX = 'AKQ1.';
export const QR_TOKEN_REGEX = /^AKQ1\.[A-Za-z0-9_-]{32}$/;

/** Scanners in keyboard-wedge (HID) mode often append CR/LF or surrounding whitespace. */
export function cleanScannedPayload(raw: string): string {
  return raw.replace(/[\r\n\t]/g, '').trim();
}

export function isQrTokenFormat(token: string): boolean {
  return QR_TOKEN_REGEX.test(token);
}
