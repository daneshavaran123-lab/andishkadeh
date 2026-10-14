import { normalizeDigits } from './format';

/** Iranian mobile numbers in canonical form: 09 followed by 9 digits. */
export const MOBILE_REGEX = /^09\d{9}$/;

/**
 * Normalises user input into canonical 09xxxxxxxxx form.
 * Accepts Persian/Arabic digits, spaces, dashes, +98 / 0098 / 98 prefixes and a missing leading zero.
 * Returns null when the input can not be a valid mobile number.
 */
export function normalizeMobile(input: string): string | null {
  let digits = normalizeDigits(input).replace(/[\s\-()]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('0098')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('98') && digits.length === 12) digits = '0' + digits.slice(2);
  else if (digits.startsWith('9') && digits.length === 10) digits = '0' + digits;
  return MOBILE_REGEX.test(digits) ? digits : null;
}

export function isValidMobile(input: string): boolean {
  return normalizeMobile(input) !== null;
}

/** 09121234567 → "0912***4567" (used on screens, receipts and admin lists). */
export function maskMobile(mobile: string): string {
  const m = normalizeMobile(mobile) ?? mobile;
  if (m.length < 8) return '***';
  return `${m.slice(0, 4)}***${m.slice(-4)}`;
}

/** Only the last four digits, for the most privacy sensitive screens (QR validation). */
export function mobileTail(mobile: string): string {
  const m = normalizeMobile(mobile) ?? mobile;
  return m.slice(-4);
}
