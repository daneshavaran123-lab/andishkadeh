import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Release version, from apps/server/package.json (both src/ and dist/ sit next to it). */
export const APP_VERSION = (JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

/** Windows kiosk installer of this release on GitHub (docs/release.md); KIOSK_INSTALLER_URL overrides it. */
export function kioskInstallerUrl(override: string): string {
  return override || `https://github.com/daneshavaran123-lab/andishkadeh/releases/download/v${APP_VERSION}/AndishkadehKiosk-Setup-${APP_VERSION}.exe`;
}
