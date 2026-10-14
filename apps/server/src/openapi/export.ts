/** Writes docs/openapi.json from the zod contracts (pnpm --filter @andishkadeh/server openapi). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiDocument } from './openapi';

const out = resolve(__dirname, '../../../../docs/openapi.json');
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + '\n');
console.log(`OpenAPI written to ${out}`);
