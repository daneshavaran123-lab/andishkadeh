import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { testDatabaseUrl } from './global-setup';

export const DEVICE = 'Device KIOSK-01:test-device-key-0123456789';

export function useTestEnv() {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.MEDIA_DIR = './storage/test-media';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-0123456789abcdefghij';
  process.env.LOGIN_MAX_ATTEMPTS = '5';
}

export async function bootApp(): Promise<INestApplication> {
  useTestEnv();
  const { resetConfigCache } = await import('../src/config');
  resetConfigCache();
  const { createApp } = await import('../src/app.factory');
  return createApp({ logger: false });
}

export async function login(app: INestApplication, username: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/v1/admin/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export function kiosk(app: INestApplication) {
  const agent = () => request(app.getHttpServer());
  return {
    get: (url: string) => agent().get(`/api/v1${url}`).set('Authorization', DEVICE),
    post: (url: string, body?: unknown) => agent().post(`/api/v1${url}`).set('Authorization', DEVICE).send(body as object),
  };
}

export function admin(app: INestApplication, token: string) {
  const agent = () => request(app.getHttpServer());
  return {
    get: (url: string) => agent().get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: unknown) => agent().post(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body as object),
    patch: (url: string, body?: unknown) => agent().patch(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body as object),
    put: (url: string, body?: unknown) => agent().put(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body as object),
    del: (url: string) => agent().delete(`/api/v1${url}`).set('Authorization', `Bearer ${token}`),
  };
}

export const uuid = () => randomUUID();

/** Random valid mobile so repeated runs never collide with earlier data. */
export const randomMobile = () => `0912${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
export const suffix = () => Math.random().toString(36).slice(2, 8);
