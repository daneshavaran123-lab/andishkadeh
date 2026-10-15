import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  formatJalaliDate,
  formatJalaliLong,
  isLeapJalaliYear,
  jalaliMonthLength,
  localDateKey,
  localDayRange,
  startOfLocalDay,
  toGregorian,
  toJalali,
  tzOffsetMinutes,
} from './dates';
import { formatToman, normalizeDigits, toPersianDigits } from './format';
import { maskMobile, normalizeMobile } from './mobile';
import { computePeriod, evaluateAccess, CoverageEntry } from './subscription';
import { AccessResult, RenewalPolicy, SubscriptionStatus } from './enums';
import { cleanScannedPayload, isQrTokenFormat } from './qr';
import { generateQrToken, hashQrToken } from './node';

describe('digits and money', () => {
  it('normalises Persian and Arabic digits', () => {
    expect(normalizeDigits('۰۹۱۲۳٤٥٦۷۸۹')).toBe('09123456789');
  });
  it('formats Toman with Persian digits and separators', () => {
    expect(formatToman(1_200_000)).toBe('۱٬۲۰۰٬۰۰۰ تومان');
    expect(toPersianDigits(2026)).toBe('۲۰۲۶');
  });
});

describe('mobile', () => {
  it.each([
    ['09121234567', '09121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷', '09121234567'],
    ['+989121234567', '09121234567'],
    ['00989121234567', '09121234567'],
    ['9121234567', '09121234567'],
    ['0912 123 4567', '09121234567'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });
  it.each(['0912123456', '08121234567', '091212345678', 'abc', ''])('rejects %s', (input) => {
    expect(normalizeMobile(input)).toBeNull();
  });
  it('masks the middle digits', () => {
    expect(maskMobile('09121234567')).toBe('0912***4567');
  });
});

describe('jalali calendar', () => {
  it('converts the PRD date 14 Oct 2026 → 22 Mehr 1405', () => {
    expect(toJalali(2026, 10, 14)).toEqual({ jy: 1405, jm: 7, jd: 22 });
    expect(toGregorian(1405, 7, 22)).toEqual({ gy: 2026, gm: 10, gd: 14 });
  });
  it('handles Nowruz and leap years', () => {
    expect(toJalali(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 });
    expect(isLeapJalaliYear(1403)).toBe(true);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });
  it('round-trips and agrees with Intl persian calendar for every day of 2024-2027', () => {
    const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2028, 0, 1); t += 86400000) {
      const d = new Date(t);
      const j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
      expect([j.jy, j.jm, j.jd]).toEqual([parseInt(parts.year, 10), Number(parts.month), Number(parts.day)]);
      const g = toGregorian(j.jy, j.jm, j.jd);
      expect([g.gy, g.gm, g.gd]).toEqual([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]);
    }
  });
  it('formats in Tehran local time', () => {
    // 22:00 UTC on 14 Oct is already 15 Oct (01:30) in Tehran.
    expect(formatJalaliDate('2026-10-14T22:00:00Z')).toBe('۱۴۰۵/۰۷/۲۳');
    expect(formatJalaliLong('2026-10-14T10:00:00Z')).toBe('۲۲ مهر ۱۴۰۵');
  });
});

describe('timezone day boundaries', () => {
  it('uses +03:30 for Tehran', () => {
    expect(tzOffsetMinutes(new Date('2026-10-14T10:00:00Z'), 'Asia/Tehran')).toBe(210);
  });
  it('computes local midnight and day ranges', () => {
    const start = startOfLocalDay(new Date('2026-10-14T22:00:00Z'), 'Asia/Tehran');
    expect(start.toISOString()).toBe('2026-10-14T20:30:00.000Z');
    expect(localDateKey(new Date('2026-10-14T22:00:00Z'), 'Asia/Tehran')).toBe('2026-10-15');
    const r = localDayRange('2026-10-15', 'Asia/Tehran');
    expect(r.from.toISOString()).toBe('2026-10-14T20:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-15T20:30:00.000Z');
    expect(addLocalDays(r.from, 30, 'Asia/Tehran').toISOString()).toBe('2026-11-13T20:30:00.000Z');
  });
});

describe('subscriptions', () => {
  const entry = (over: Partial<CoverageEntry>): CoverageEntry => ({
    subscriptionId: 's1',
    customerKey: 'c1',
    startsAt: '2026-10-01T00:00:00Z',
    expiresAt: '2026-10-31T00:00:00Z',
    status: SubscriptionStatus.ACTIVE,
    planTitle: '۱ ماهه',
    ...over,
  });

  it('starts now when there is no coverage', () => {
    const paidAt = new Date('2026-10-14T10:00:00Z');
    const p = computePeriod(paidAt, 30, [], RenewalPolicy.EXTEND_FROM_END);
    expect(p.startsAt).toEqual(paidAt);
    expect(p.expiresAt.toISOString()).toBe('2026-11-13T10:00:00.000Z');
    expect(p.extended).toBe(false);
  });

  it('extends from the end of current coverage', () => {
    const p = computePeriod(new Date('2026-10-14T10:00:00Z'), 90, [entry({})], RenewalPolicy.EXTEND_FROM_END);
    expect(p.startsAt.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(p.extended).toBe(true);
    const now = computePeriod(new Date('2026-10-14T10:00:00Z'), 90, [entry({})], RenewalPolicy.START_NOW);
    expect(now.extended).toBe(false);
  });

  it('evaluates active / expired / revoked / invalid / chained renewals (T08)', () => {
    const now = new Date('2026-10-14T10:00:00Z');
    expect(evaluateAccess(undefined, [], now).result).toBe(AccessResult.INVALID);
    const active = entry({});
    expect(evaluateAccess(active, [active], now)).toMatchObject({ result: AccessResult.ACTIVE, valid: true });
    const expired = entry({ expiresAt: '2026-10-10T00:00:00Z' });
    expect(evaluateAccess(expired, [expired], now)).toMatchObject({
      result: AccessResult.EXPIRED,
      expiresAt: '2026-10-10T00:00:00.000Z',
    });
    const revoked = entry({ status: SubscriptionStatus.CANCELLED });
    expect(evaluateAccess(revoked, [revoked], now).result).toBe(AccessResult.REVOKED);

    const renewal = entry({ subscriptionId: 's2', startsAt: '2026-10-31T00:00:00Z', expiresAt: '2027-01-29T00:00:00Z' });
    // Scanning the renewal's QR while the first period is still running → active until end of chain.
    expect(evaluateAccess(renewal, [active, renewal], now)).toMatchObject({
      result: AccessResult.ACTIVE,
      expiresAt: '2027-01-29T00:00:00.000Z',
    });
    // Renewal alone after the first period was cancelled → not started yet.
    expect(evaluateAccess(renewal, [renewal], now).result).toBe(AccessResult.NOT_STARTED);
  });
});

describe('qr tokens', () => {
  it('generates random tokens in the expected format', () => {
    const a = generateQrToken();
    const b = generateQrToken();
    expect(isQrTokenFormat(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashQrToken(a)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('ignores scanner line endings', () => {
    const t = generateQrToken();
    expect(cleanScannedPayload(`${t}\r\n`)).toBe(t);
    expect(hashQrToken(` ${t}\n`)).toBe(hashQrToken(t));
  });
});

describe('universal token helpers', async () => {
  const { generateQrToken, hashQrToken, sha256Hex } = await import('./node');
  const { newQrToken, qrTokenHash, sha256HexOf, newId } = await import('./token');
  it('matches the Node implementations byte for byte', () => {
    const t = generateQrToken();
    expect(qrTokenHash(t)).toBe(hashQrToken(t));
    expect(qrTokenHash(`  ${t}\n`)).toBe(hashQrToken(t));
    expect(sha256HexOf('اندیشکده')).toBe(sha256Hex('اندیشکده'));
  });
  it('creates tokens of the same shape and v4 ids', () => {
    expect(newQrToken()).toMatch(/^AKQ1\.[A-Za-z0-9_-]{32}$/);
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
