import { describe, expect, it } from 'vitest';
import { activationLink, formatActivationCode, normalizeActivationCode, parseActivationInput } from './activation';
import { generateActivationCode } from './node';

describe('kiosk activation code', () => {
  it('is 8 random digits, shown in two groups', () => {
    const codes = new Set(Array.from({ length: 200 }, generateActivationCode));
    for (const c of codes) expect(c).toMatch(/^\d{8}$/);
    expect(codes.size).toBeGreaterThan(195);
    expect(formatActivationCode('12345678')).toBe('1234 5678');
  });

  it('accepts what a technician types: spaces, dashes, Persian or Arabic digits; nothing else', () => {
    expect(normalizeActivationCode('1234 5678')).toBe('12345678');
    expect(normalizeActivationCode('۱۲۳۴-۵۶۷۸')).toBe('12345678');
    expect(normalizeActivationCode('١٢٣٤٥٦٧٨')).toBe('12345678');
    expect(normalizeActivationCode('1234567')).toBeNull();
    expect(normalizeActivationCode('123456789')).toBeNull();
    expect(normalizeActivationCode('1234567a')).toBeNull();
  });

  it('the link carries the server: pasted, read by a camera, or typed by a scanner on a Persian keyboard', () => {
    const link = activationLink('https://andishkadeh.liara.run/', '12345678');
    expect(link).toBe('https://andishkadeh.liara.run/?activate=12345678');
    expect(parseActivationInput(link)).toEqual({ code: '12345678', serverUrl: 'https://andishkadeh.liara.run' });
    expect(parseActivationInput(`${link}\r\n`)).toEqual({ code: '12345678', serverUrl: 'https://andishkadeh.liara.run' });
    expect(parseActivationInput('http://192.168.1.10:3001/?activate=8765 4321')).toEqual({ code: '87654321', serverUrl: 'http://192.168.1.10:3001' });
    // the same keys with the Persian layout active: letters arrive in Persian, digits as Persian digits
    expect(parseActivationInput('اففحس://شدیهسانشیثا.مهشقش.قعد/؟شزفهرشفث=۱۲۳۴۵۶۷۸')).toEqual({
      code: '12345678',
      serverUrl: 'https://andishkadeh.liara.run',
    });
    expect(parseActivationInput('12345678')).toEqual({ code: '12345678', serverUrl: null });
    expect(parseActivationInput('https://andishkadeh.liara.run/')).toBeNull();
    expect(parseActivationInput('ftp://x/?activate=12345678')).toBeNull();
    expect(parseActivationInput('hello')).toBeNull();
  });
});
