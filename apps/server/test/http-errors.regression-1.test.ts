// Regression: ISSUE-001 — errors raised by Express middleware (static files, JSON body parser) were answered as 500 / INTERNAL
// Found by /qa on 2026-10-16
// Report: .gstack/qa-reports/run-20261016T172447Z/qa-report-localhost-2026-10-16.md
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, useTestEnv } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  useTestEnv();
  const webDist = mkdtempSync(join(tmpdir(), 'web-dist-'));
  mkdirSync(join(webDist, 'assets'));
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>web app</title>');
  writeFileSync(join(webDist, 'assets', 'app-1234.js'), 'console.log(1)');
  process.env.WEB_APP_DIST_DIR = webDist;
  app = await bootApp();
});

afterAll(() => app?.close());

describe('errors from static files and the body parser keep their status', () => {
  it('a missing media file is 404, not a server error', async () => {
    const res = await http().get(`/api/v1/media/files/${'0'.repeat(64)}.jpg`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('dotfiles and path tricks under media are refused with 4xx', async () => {
    for (const path of ['/api/v1/media/files/.env', '/api/v1/media/files/..%2f..%2fpackage.json']) {
      const res = await http().get(path);
      expect([403, 404], path).toContain(res.status);
    }
  });

  it('a missing web app file is 404 (an old service worker may still ask for it)', async () => {
    expect((await http().get('/assets/app-1234.js')).status).toBe(200);
    const res = await http().get('/assets/gone-5678.js');
    expect(res.status).toBe(404);
  });

  it('malformed JSON is a validation error with a Persian message, not the parser text', async () => {
    const res = await http().post('/api/v1/admin/auth/login').set('Content-Type', 'application/json').send('{"username":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.message).not.toMatch(/Unexpected|JSON input/);
  });

  it('a body over the 2 MB limit is 413', async () => {
    const res = await http()
      .post('/api/v1/admin/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ username: 'a'.repeat(3 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
