// Regression: ISSUE-003 — date filters accepted impossible dates (rolled over silently) and range errors came back as 409
// Found by /qa on 2026-10-16
// Report: .gstack/qa-reports/run-20261016T172447Z/qa-report-localhost-2026-10-16.md
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, bootApp, login } from './helpers';

let app: INestApplication;
let token: string;

beforeAll(async () => {
  app = await bootApp();
  token = await login(app, 'admin', 'Admin@12345');
});

afterAll(() => app?.close());

describe('date filters', () => {
  it.each([
    ['/admin/reports/sales?from=2026-13-40&to=2026-10-01'],
    ['/admin/reports/sales?from=2026-02-30&to=2026-03-02'],
    ['/admin/orders?from=2026-02-30'],
    ['/admin/payments?to=2026-99-99'],
    ['/admin/dashboard?from=2026-04-31&to=2026-05-01'],
  ])('rejects an impossible calendar date: %s', async (url) => {
    const res = await admin(app, token).get(url);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('answers a reversed or too long report range with 400, not 409', async () => {
    for (const url of ['/admin/reports/sales?from=2026-10-20&to=2026-10-01', '/admin/reports/sales?from=2021-01-01&to=2026-10-01']) {
      const res = await admin(app, token).get(url);
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('still accepts real dates, including a leap day', async () => {
    expect((await admin(app, token).get('/admin/reports/sales?from=2024-02-29&to=2024-03-01')).status).toBe(200);
    expect((await admin(app, token).get('/admin/orders?from=2026-10-01&to=2026-10-16')).status).toBe(200);
  });
});
