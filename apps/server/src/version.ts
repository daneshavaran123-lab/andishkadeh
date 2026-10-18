import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KioskInstallerInfo } from '@andishkadeh/shared';

/** Release version, from apps/server/package.json (both src/ and dist/ sit next to it). */
export const APP_VERSION = (JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

/** Windows kiosk installer of this release on GitHub (docs/release.md); KIOSK_INSTALLER_URL overrides it. */
export function kioskInstallerUrl(override: string): string {
  return override || `https://github.com/daneshavaran123-lab/andishkadeh/releases/download/v${APP_VERSION}/AndishkadehKiosk-Setup-${APP_VERSION}.exe`;
}

let checked: { at: number; info: KioskInstallerInfo } | null = null;

/**
 * Whether the installer can be downloaded, so the kiosk management page does not offer a broken
 * link before the release is published. A definite answer is kept for 10 minutes, "unknown" for 1.
 */
export async function kioskInstallerInfo(override: string, fetchImpl: typeof fetch = fetch): Promise<KioskInstallerInfo> {
  const url = kioskInstallerUrl(override);
  if (checked && checked.info.url === url && Date.now() - checked.at < (checked.info.available === null ? 60_000 : 600_000)) return checked.info;
  let available: boolean | null;
  try {
    // One byte is enough: release downloads redirect to a CDN whose signed URLs answer GET only.
    const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(5000) });
    await res.body?.cancel();
    available = res.ok ? true : res.status === 404 ? false : null;
  } catch {
    available = null;
  }
  checked = { at: Date.now(), info: { version: APP_VERSION, url, available } };
  return checked.info;
}
