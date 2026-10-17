/** Card terminal through a helper program (docs/payment-helper.md), against a fake helper. */
import { join } from 'node:path';
import { HardwareState, TerminalOutcome } from '@andishkadeh/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HelperPaymentAdapter } from '../src/platform/node/payment-helper';

const FAKE = join(__dirname, 'fixtures', 'fake-pos-helper.mjs');
const adapters: HelperPaymentAdapter[] = [];
const helper = (mode: string, timeouts = { statusMs: 3000, inquireMs: 3000, cancelMs: 3000 }) => {
  const a = new HelperPaymentAdapter(process.execPath, [FAKE, mode], timeouts);
  adapters.push(a);
  return a;
};
const sale = { amount: 1_250_000, orderRef: 'AK-000123', attemptId: '0b9f2c64-1111-4222-8333-944455556666' };
const live = () => new AbortController().signal;

afterEach(() => {
  for (const a of adapters.splice(0)) a.stop();
});

describe('card terminal helper', () => {
  it('reports the terminal status and approves a sale in rials', async () => {
    const pos = helper('approve');
    expect(await pos.status()).toMatchObject({ state: HardwareState.OK, detail: 'fake approve' });
    const r = await pos.initiate(sale, live());
    // The kiosk works in tomans; the terminal receives rials.
    expect(r).toEqual({ outcome: TerminalOutcome.PAID, terminalRef: 'T-0b9f2c64', rrn: '12500000', traceNo: '42', message: null });
    expect(await pos.inquire({ attemptId: sale.attemptId, terminalRef: r.terminalRef, amount: sale.amount })).toMatchObject({ outcome: TerminalOutcome.PAID });
    expect(pos.isMock).toBe(false);
  });

  it('passes a decline through as FAILED with the terminal message', async () => {
    expect(await helper('decline').initiate(sale, live())).toMatchObject({ outcome: TerminalOutcome.FAILED, message: 'موجودی کافی نیست' });
  });

  it('a helper that dies during a sale gives UNKNOWN (the card may have been charged), then starts again', async () => {
    const pos = helper('crash');
    expect(await pos.initiate(sale, live())).toMatchObject({ outcome: TerminalOutcome.UNKNOWN, message: 'برنامه کارتخوان متوقف شد' });
    expect(await pos.status()).toMatchObject({ state: HardwareState.OK });
  });

  it('a sale the terminal does not answer before the kiosk timeout is UNKNOWN', async () => {
    const pos = helper('hang');
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 300);
    expect(await pos.initiate(sale, ctrl.signal)).toMatchObject({ outcome: TerminalOutcome.UNKNOWN, message: 'مهلت پاسخ کارتخوان تمام شد' });
  });

  it('a busy terminal is not reported as broken while a sale is in progress', async () => {
    const pos = helper('hang');
    const ctrl = new AbortController();
    const pending = pos.initiate(sale, ctrl.signal);
    expect(await pos.status()).toMatchObject({ state: HardwareState.OK, detail: 'در حال تراکنش' });
    ctrl.abort();
    await pending;
  });

  it('an answer it cannot read is UNKNOWN, never PAID or FAILED', async () => {
    expect(await helper('garbage').initiate(sale, live())).toMatchObject({ outcome: TerminalOutcome.UNKNOWN, message: 'پاسخ نامعتبر از برنامه کارتخوان' });
  });

  it('a helper that cannot be started blocks the sale as FAILED (no card was presented) and shows an error', async () => {
    const pos = new HelperPaymentAdapter(join(__dirname, 'fixtures', 'no-such-helper.exe'));
    adapters.push(pos);
    expect(await pos.initiate(sale, live())).toMatchObject({ outcome: TerminalOutcome.FAILED, message: 'برنامه کارتخوان اجرا نشد' });
    expect(await pos.status()).toMatchObject({ state: HardwareState.ERROR, detail: 'برنامه کارتخوان اجرا نشد' });
    expect(await pos.inquire({ attemptId: sale.attemptId, terminalRef: null, amount: sale.amount })).toMatchObject({ outcome: TerminalOutcome.UNKNOWN });
  });

  it('forwards a cancel request', async () => {
    expect(await helper('approve').cancelIfSupported(sale.attemptId)).toBe(true);
  });
});
