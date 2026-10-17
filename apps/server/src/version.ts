import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Release version, from apps/server/package.json (both src/ and dist/ sit next to it). */
export const APP_VERSION = (JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
