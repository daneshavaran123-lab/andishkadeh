// The three parts of the site on one origin: customer web app at /, admin panel at /admin, kiosk
// management at /kiosk (the same panel build), with the API under /api/v1.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kioskInstallerInfo } from '../src/version';
import { bootApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());

function dist(prefix: string, title: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), `<!doctype html><title>${title}</title>`);
  writeFileSync(join(dir, 'assets', 'app-1234.js'), 'console.log(1)');
  return dir;
}

beforeAll(async () => {
  process.env.ADMIN_DIST_DIR = dist('admin-dist-', 'panel');
  const web = dist('web-dist-', 'web app');
  writeFileSync(join(web, 'sw.js'), '// sw');
  process.env.WEB_APP_DIST_DIR = web;
  app = await bootApp();
});

afterAll(async () => {
  await app?.close();
  delete process.env.ADMIN_DIST_DIR;
  delete process.env.WEB_APP_DIST_DIR;
});

describe('site routes', () => {
  it('/ and its client-side routes are the customer web app', async () => {
    for (const path of ['/', '/services', '/x/y']) {
      const res = await http().get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).toContain('<title>web app</title>');
      expect(res.headers['cache-control'], path).toBe('no-cache');
    }
  });

  it('web app assets are immutable, its service worker is revalidated, a missing file is 404', async () => {
    expect((await http().get('/assets/app-1234.js')).headers['cache-control']).toContain('immutable');
    expect((await http().get('/sw.js')).headers['cache-control']).toBe('no-cache');
    expect((await http().get('/assets/gone-5678.js')).status).toBe(404);
  });

  it('/admin is the admin panel', async () => {
    for (const path of ['/admin', '/admin/', '/admin/login', '/admin/dashboard']) {
      const res = await http().get(path).redirects(1); // /admin → /admin/
      expect(res.status, path).toBe(200);
      expect(res.text, path).toContain('<title>panel</title>');
    }
    expect((await http().get('/admin/assets/app-1234.js')).status).toBe(200);
    expect((await http().get('/admin/assets/gone-5678.js')).status).toBe(404);
  });

  it('/kiosk is kiosk management (the panel build), not the customer web app', async () => {
    for (const path of ['/kiosk', '/kiosk/', '/kiosk/login']) {
      const res = await http().get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).toContain('<title>panel</title>');
    }
  });

  it('the API keeps its own answers', async () => {
    expect((await http().get('/api/v1/health')).body.status).toBeDefined();
    const missing = await http().get('/api/v1/no-such-route');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBeDefined();
    expect((await http().post('/').send({})).status).toBe(404);
  });
});

describe('Windows installer availability', () => {
  const answer = (status: number) => (async () => new Response(status === 404 ? 'not found' : 'M', { status })) as unknown as typeof fetch;

  it('published (200/206), not published (404), unknown (network error)', async () => {
    expect((await kioskInstallerInfo('https://example.test/a.exe', answer(206))).available).toBe(true);
    expect((await kioskInstallerInfo('https://example.test/b.exe', answer(404))).available).toBe(false);
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const info = await kioskInstallerInfo('https://example.test/c.exe', down);
    expect(info).toMatchObject({ url: 'https://example.test/c.exe', available: null });
  });

  it('a definite answer is reused for the same address', async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response('M', { status: 206 });
    }) as unknown as typeof fetch;
    await kioskInstallerInfo('https://example.test/d.exe', counting);
    await kioskInstallerInfo('https://example.test/d.exe', counting);
    expect(calls).toBe(1);
  });
});
