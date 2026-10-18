import { afterEach, describe, expect, it } from 'vitest';
import { config, resetConfigCache } from '../src/config';

const saved = { ...process.env };
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:s3cret@db:5432/andishkadeh',
  JWT_SECRET: 'k'.repeat(40),
  PUBLIC_BASE_URL: 'https://andishkadeh.example.ir',
};

function load(env: Record<string, string>) {
  process.env = { ...saved, ...env };
  resetConfigCache();
  return config();
}

afterEach(() => {
  process.env = { ...saved };
  resetConfigCache();
});

describe('production settings', () => {
  it('starts with real values', () => {
    expect(load(production).NODE_ENV).toBe('production');
  });

  it.each([
    ['the example JWT secret', { JWT_SECRET: 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET' }, 'JWT_SECRET'],
    ['a short JWT secret', { JWT_SECRET: 'short-but-24-characters!' }, 'JWT_SECRET'],
    ['the example database password', { DATABASE_URL: 'postgresql://andishkadeh:CHANGE_ME@localhost:5432/andishkadeh' }, 'DATABASE_URL'],
    ['a plain http public address', { PUBLIC_BASE_URL: 'http://localhost:3001' }, 'PUBLIC_BASE_URL'],
  ])('refuses %s', (_label, override, field) => {
    expect(() => load({ ...production, ...override })).toThrow(new RegExp(`Refusing to start in production: .*${field}`));
  });

  it('development keeps accepting local values', () => {
    expect(() => load({ ...production, NODE_ENV: 'development', PUBLIC_BASE_URL: 'http://localhost:3001' })).not.toThrow();
  });
});

describe('browser origins (CORS)', () => {
  const dev = { DATABASE_URL: production.DATABASE_URL, JWT_SECRET: production.JWT_SECRET, CORS_ORIGINS: '' };

  it('development without CORS_ORIGINS allows the local dev UIs (admin, kiosk, kiosk web app)', () => {
    const origins = load({ ...dev, NODE_ENV: 'development' }).corsOrigins;
    expect(origins).toEqual(expect.arrayContaining(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5176']));
  });

  it('production without CORS_ORIGINS allows no other origin', () => {
    expect(load({ ...production, CORS_ORIGINS: '' }).corsOrigins).toEqual([]);
  });

  it('an explicit list is used as given', () => {
    expect(load({ ...dev, NODE_ENV: 'development', CORS_ORIGINS: 'https://localhost, https://a.ir' }).corsOrigins).toEqual(['https://localhost', 'https://a.ir']);
  });

  it('the server listens on 3001 by default (3000 is often taken on Windows)', () => {
    process.env = { ...saved, ...dev, NODE_ENV: 'development' };
    delete process.env.PORT;
    delete process.env.PUBLIC_BASE_URL;
    resetConfigCache();
    expect(config().PORT).toBe(3001);
    expect(config().PUBLIC_BASE_URL).toBe('http://localhost:3001');
  });
});
