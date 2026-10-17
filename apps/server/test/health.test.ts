import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/openapi/openapi';
import { admin, bootApp, login, useTestEnv } from './helpers';

let app: INestApplication;
const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };

beforeAll(async () => {
  useTestEnv();
  app = await bootApp();
});

afterAll(() => app?.close());

describe('release version', () => {
  it('health reports the version of this release, however the server was started', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', version });
  });

  it('the API document carries the same version', () => {
    expect(buildOpenApiDocument().info.version).toBe(version);
  });
});

describe('kiosk installer link (A15)', () => {
  it('points the panel at the Windows installer of the same release', async () => {
    const token = await login(app, 'operator', 'Operator@12345');
    const res = await admin(app, token).get('/admin/system');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version,
      kioskInstallerUrl: `https://github.com/daneshavaran123-lab/andishkadeh/releases/download/v${version}/AndishkadehKiosk-Setup-${version}.exe`,
    });
  });

  it('is only for signed-in staff', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/admin/system')).status).toBe(401);
  });
});
