/**
 * Digit normalisation and Persian number/money formatting.
 * Money is always an integer number of Toman (no floating point amounts anywhere).
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Converts Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII digits. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) {
      out += String(p);
      continue;
    }
    const a = ARABIC_DIGITS.indexOf(ch);
    out += a >= 0 ? String(a) : ch;
  }
  return out;
}

/** Converts ASCII digits to Persian digits for display. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Integer guard for money values. Throws on floats, NaN or negative amounts. */
export function assertMoney(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer Toman value, got ${value}`);
  }
  return value;
}

/** 1200000 → "۱٬۲۰۰٬۰۰۰" */
export function formatNumberFa(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(value)).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return sign + toPersianDigits(grouped);
}

/** 1200000 → "۱٬۲۰۰٬۰۰۰ تومان" */
export function formatToman(value: number, withUnit = true): string {
  return withUnit ? `${formatNumberFa(value)} تومان` : formatNumberFa(value);
}

/** Latin grouping for receipts / CSV: 1200000 → "1,200,000" */
export function formatNumberLatin(value: number): string {
  return Math.trunc(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
