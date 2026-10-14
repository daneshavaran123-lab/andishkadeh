/**
 * Jalali (Solar Hijri) calendar conversion and timezone-aware day boundaries.
 * The conversion follows the well known jalaali algorithm (Borkowski breaks table).
 * Day boundaries are computed in the centre's timezone (default Asia/Tehran).
 */
import { toPersianDigits } from './format';

export const DEFAULT_TIMEZONE = 'Asia/Tehran';

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456,
  3178,
];

function div(a: number, b: number): number {
  return ~~(a / b);
}
function mod(a: number, b: number): number {
  return a - ~~(a / b) * b;
}

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError(`Invalid Jalali year ${jy}`);
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export function toJalali(gy: number, gm: number, gd: number): JalaliDate {
  return d2j(g2d(gy, gm, gd));
}

export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd));
}

export function isLeapJalaliYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date, timeZone = DEFAULT_TIMEZONE): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `timeZone` from UTC at the given instant, in minutes (Tehran: +210). */
export function tzOffsetMinutes(date: Date, timeZone = DEFAULT_TIMEZONE): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant of local midnight for the given Gregorian local date. */
export function zonedMidnight(year: number, month: number, day: number, timeZone = DEFAULT_TIMEZONE): Date {
  const naive = Date.UTC(year, month - 1, day);
  const off1 = tzOffsetMinutes(new Date(naive), timeZone);
  const guess = naive - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(naive - off2 * 60000);
}

export function startOfLocalDay(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = localParts(date, timeZone);
  return zonedMidnight(p.year, p.month, p.day, timeZone);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

/** Calendar-aware: adds days in local time so the result is again local midnight when input is. */
export function addLocalDays(date: Date, days: number, timeZone = DEFAULT_TIMEZONE): Date {
  const p = localParts(date, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), timeZone);
}

/** Gregorian local date key "YYYY-MM-DD" used for grouping by day. */
export function localDateKey(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function dateKeyToJalali(key: string): JalaliDate {
  const [y, m, d] = key.split('-').map(Number);
  return toJalali(y, m, d);
}

export function jalaliToDateKey(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

/** Start (inclusive) and end (exclusive) instants of a local day given as "YYYY-MM-DD". */
export function localDayRange(key: string, timeZone = DEFAULT_TIMEZONE): { from: Date; to: Date } {
  const [y, m, d] = key.split('-').map(Number);
  const from = zonedMidnight(y, m, d, timeZone);
  return { from, to: addLocalDays(from, 1, timeZone) };
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function jalaliOf(date: Date | string, timeZone = DEFAULT_TIMEZONE): JalaliDate & LocalParts {
  const d = typeof date === 'string' ? new Date(date) : date;
  const p = localParts(d, timeZone);
  return { ...p, ...toJalali(p.year, p.month, p.day) };
}

/** "۱۴۰۵/۰۷/۲۲" */
export function formatJalaliDate(date: Date | string, timeZone = DEFAULT_TIMEZONE, persianDigits = true): string {
  const j = jalaliOf(date, timeZone);
  const s = `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
  return persianDigits ? toPersianDigits(s) : s;
}

/** "۱۴۰۵/۰۷/۲۲ – ۱۴:۰۵" */
export function formatJalaliDateTime(
  date: Date | string,
  timeZone = DEFAULT_TIMEZONE,
  persianDigits = true,
): string {
  const j = jalaliOf(date, timeZone);
  const s = `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)} – ${pad2(j.hour)}:${pad2(j.minute)}`;
  return persianDigits ? toPersianDigits(s) : s;
}

/** "۲۲ مهر ۱۴۰۵" */
export function formatJalaliLong(date: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  const j = jalaliOf(date, timeZone);
  return `${toPersianDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toPersianDigits(j.jy)}`;
}

/** "۲۲ مهر" — short label for chart axes. */
export function formatJalaliDayMonth(dateKey: string): string {
  const j = dateKeyToJalali(dateKey);
  return `${toPersianDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`;
}
