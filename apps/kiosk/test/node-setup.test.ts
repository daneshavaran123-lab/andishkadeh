/** Windows first run: the setup screen's values become kiosk.config.json, which the normal start-up reads. */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isConfigured, loadConfig, writeSetupConfig } from '../src/platform/node';

const values = {
  serverUrl: 'https://andishkadeh.liara.run/',
  deviceId: ' KIOSK-02 ',
  deviceKey: 'device-key-0123456789',
  payment: 'none',
  printer: 'windows',
  printerName: 'XP-80C',
  scanner: 'keyboard',
  devControls: false,
};
const savedKey = process.env.KIOSK_DEVICE_KEY;

afterEach(() => {
  if (savedKey === undefined) delete process.env.KIOSK_DEVICE_KEY;
  else process.env.KIOSK_DEVICE_KEY = savedKey;
});

describe('Windows setup screen', () => {
  it('a new device is not configured until the setup screen saves', () => {
    delete process.env.KIOSK_DEVICE_KEY;
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-setup-'));
    expect(isConfigured(dir)).toBe(false);
    writeSetupConfig(dir, values);
    expect(isConfigured(dir)).toBe(true);
    expect(existsSync(join(dir, 'kiosk.config.json.part'))).toBe(false);
  });

  it('the saved file starts the kiosk with the entered server, identity and hardware', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-setup-'));
    writeSetupConfig(dir, values);
    const cfg = loadConfig(dir, { appVersion: '1.3.0' });
    expect(cfg).toMatchObject({
      serverUrl: 'https://andishkadeh.liara.run',
      deviceId: 'KIOSK-02',
      deviceKey: 'device-key-0123456789',
      adapters: { payment: 'none', printer: 'windows', printerName: 'XP-80C', scanner: 'keyboard' },
      kioskMode: true,
      devControls: false,
    });
    expect(JSON.parse(readFileSync(join(dir, 'kiosk.config.json'), 'utf8'))).not.toHaveProperty('dataDir');
  });

  it('refuses values the kiosk cannot run with', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-setup-'));
    expect(() => writeSetupConfig(dir, { ...values, serverUrl: 'not a url' })).toThrow();
    expect(() => writeSetupConfig(dir, { ...values, deviceKey: 'short' })).toThrow();
    expect(() => writeSetupConfig(dir, { ...values, printer: 'browser' })).toThrow();
    expect(isConfigured(dir)).toBe(false);
  });
});
