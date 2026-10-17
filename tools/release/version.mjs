// One version for the whole product: every package.json and the top CHANGELOG entry.
//   node tools/release/version.mjs            check that they agree and print the version
//   node tools/release/version.mjs set 1.3.0  write the version into every package.json
//   node tools/release/version.mjs notes      print the CHANGELOG entry of the current version
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGES = ['package.json', 'packages/shared/package.json', 'apps/server/package.json', 'apps/admin/package.json', 'apps/kiosk/package.json', 'e2e/package.json'];
const VERSION_FIELD = /("version":\s*")([^"]*)(")/;
const read = (file) => readFileSync(join(root, file), 'utf8');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function changelogEntry() {
  const text = read('CHANGELOG.md');
  const m = text.match(/^## (\d+\.\d+\.\d+)\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!m) fail('CHANGELOG.md: no "## X.Y.Z" entry found');
  return { version: m[1], heading: m[0].split('\n')[0].slice(3), body: m[2].trim() };
}

const [command, arg] = process.argv.slice(2);

if (command === 'set') {
  if (!/^\d+\.\d+\.\d+$/.test(arg ?? '')) fail('usage: node tools/release/version.mjs set X.Y.Z');
  for (const file of PACKAGES) {
    const text = read(file);
    if (!VERSION_FIELD.test(text)) fail(`${file}: no "version" field`);
    writeFileSync(join(root, file), text.replace(VERSION_FIELD, `$1${arg}$3`));
  }
  console.log(`version ${arg} written to ${PACKAGES.length} package.json files; add "## ${arg}" to CHANGELOG.md`);
} else if (command === 'notes') {
  console.log(changelogEntry().body);
} else if (command === undefined) {
  const versions = PACKAGES.map((file) => [file, read(file).match(VERSION_FIELD)?.[2]]);
  const { version } = changelogEntry();
  const wrong = versions.filter(([, v]) => v !== version);
  if (wrong.length) fail(`CHANGELOG.md is at ${version}, but: ${wrong.map(([f, v]) => `${f} ${v ?? '(none)'}`).join(', ')}`);
  console.log(version);
} else {
  fail(`unknown command: ${command}`);
}
