import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/openapi/openapi';
import { bootApp, useTestEnv } from './helpers';

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
