// E2E kiosk core: fresh local store every run (test data only), simulated hardware, fast sync.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = resolve(root, 'e2e/.kiosk-data');
rmSync(dataDir, { recursive: true, force: true });
const env = {
  ...process.env,
  KIOSK_SERVER_URL: 'http://localhost:3200',
  KIOSK_DEVICE_KEY: 'test-device-key-0123456789',
  KIOSK_BRIDGE_PORT: '5285',
  KIOSK_BRIDGE_ORIGINS: 'http://localhost:5284',
  KIOSK_DATA_DIR: dataDir,
  KIOSK_PULL_SEC: '5',
  KIOSK_PUSH_SEC: '2',
  KIOSK_HEARTBEAT_SEC: '5',
  KIOSK_RECOVERY_SEC: '10',
  // Simulated scanner (dev controls can take it offline); keyboard-wedge input is still captured by the UI.
  KIOSK_SCANNER_ADAPTER: 'mock',
};
const child = spawn('npx', ['tsx', 'src/dev-bridge/server.ts'], { cwd: resolve(root, 'apps/kiosk'), env, stdio: 'inherit', shell: process.platform === 'win32' });
process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());
child.on('exit', (code) => process.exit(code ?? 0));
