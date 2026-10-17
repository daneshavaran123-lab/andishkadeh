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
    ['a plain http public address', { PUBLIC_BASE_URL: 'http://localhost:3000' }, 'PUBLIC_BASE_URL'],
  ])('refuses %s', (_label, override, field) => {
    expect(() => load({ ...production, ...override })).toThrow(new RegExp(`Refusing to start in production: .*${field}`));
  });

  it('development keeps accepting local values', () => {
    expect(() => load({ ...production, NODE_ENV: 'development', PUBLIC_BASE_URL: 'http://localhost:3000' })).not.toThrow();
  });
});
