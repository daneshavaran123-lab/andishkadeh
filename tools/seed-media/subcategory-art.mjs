// Default images of the subcategories (assets/seed-media/subcategories/<code>.jpg). The subgroups shown
// on the kiosk have photos taken from the visual design (cut from its screens, so not made here); this
// draws the others: one neon line illustration per subgroup, in its domain's colour, matching its
// title, centred so that a square crop (thumbnails) and the kiosk row (chevron on the left) both keep it
// whole. Drawn as SVG and rendered with Chromium (Playwright from the e2e package). Every image can be
// replaced in the panel.
//   node tools/seed-media/subcategory-art.mjs [CODE ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'assets/seed-media/subcategories');
const W = 720;
const H = 400;

const THEMES = {
  blue: { c: '#1689ff', l: '#8fc8ff' },
  cyan: { c: '#00d6d1', l: '#8ff5f1' },
};

// ---------------------------------------------------------------- drawing helpers (320×320 box)
const S = (d, w = 7) => `<path d="${d}" class="s" stroke-width="${w}"/>`; // neon stroke
const L = (d, w = 4) => `<path d="${d}" class="l" stroke-width="${w}"/>`; // light stroke
const F = (d, o = 0.22) => `<path d="${d}" class="f" fill-opacity="${o}"/>`; // tinted fill
const C = (cx, cy, r, w = 7) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="s" stroke-width="${w}"/>`;
const CF = (cx, cy, r, o = 0.22) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="f" fill-opacity="${o}"/>`;
const DOT = (cx, cy, r = 6) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="dot"/>`;
const R = (x, y, w, h, rx = 12, sw = 7) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="s" stroke-width="${sw}"/>`;
const RF = (x, y, w, h, rx = 12, o = 0.18) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="f" fill-opacity="${o}"/>`;
const RL = (x, y, w, h, rx = 10, sw = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="l" stroke-width="${sw}"/>`;

// ---------------------------------------------------------------- the illustrations
const ART = {
  // Performance (blue)
  'P-3': () => // anaerobic: draining battery and a lightning bolt
    R(40, 70, 96, 200, 18, 8) + S('M70 54H106', 10) +
    RF(56, 206, 64, 48, 8, 0.7) + RF(56, 150, 64, 48, 8, 0.35) + RL(56, 94, 64, 48, 8, 3) +
    F('M222 40L170 172H214L196 290L270 138H224L252 40Z', 0.3) + S('M222 40L170 172H214L196 290L270 138H224L252 40Z', 7) +
    L('M290 120H312M282 168H312M296 216H312', 6),
  'P-5': () => // explosive power: a jump off the ground, impact burst and arrows up
    C(160, 38, 18) + S('M160 58V126M160 78L120 44M160 78L200 44M160 126L134 150L148 184M160 126L188 148L178 182') +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const r = (a * Math.PI) / 180;
      const p = (d) => `${(163 + Math.cos(r) * d).toFixed(1)} ${(266 + Math.sin(r) * d * 0.55).toFixed(1)}`;
      return S(`M${p(22)}L${p(48)}`, 6);
    }).join('') + CF(163, 266, 14, 0.6) + C(163, 266, 14, 5) + L('M140 206H186M146 224H180', 5) +
    S('M60 230V110M44 128L60 108L76 128', 6) + S('M262 230V110M246 128L262 108L278 128', 6) + L('M40 250V230M282 250V230', 5),
  'P-6': () => // speed and agility: ladder, cones, stopwatch
    S('M60 300L124 120M260 300L196 120', 7) + L('M70 270H250M82 236H238M94 202H226M106 170H214M116 142H204', 5) +
    F('M20 300L40 250L60 300Z', 0.4) + S('M20 300L40 250L60 300Z', 5) + F('M262 300L282 250L302 300Z', 0.4) + S('M262 300L282 250L302 300Z', 5) +
    C(246, 70, 40) + S('M246 70V46M246 70L264 82', 6) + S('M236 20H256M282 36L292 26', 6) + L('M150 60H186M136 84H182M152 108H190', 5),
  'P-7': () => // balance and flexibility: arabesque on a beam, range-of-motion arc
    S('M24 292H296', 8) + L('M70 292V310M250 292V310', 5) +
    C(88, 112, 17) + S('M104 132L152 184L152 292M152 184L270 150M112 140L42 120M112 140L150 98') +
    `<path d="M276 176A126 126 0 0 0 152 58" class="l" stroke-width="5" stroke-dasharray="4 14"/>` +
    DOT(270, 150, 8) + DOT(42, 120, 7) + DOT(150, 98, 7) + S('M140 292H166', 9),

  // Monitoring (cyan)
  'M-0': () => // monitoring modules: dashboard with a gauge, bars and a heart line
    RF(20, 40, 280, 240, 20, 0.12) + R(20, 40, 280, 240, 20) +
    S('M60 160A50 50 0 0 1 160 160', 8) + L('M110 160L140 124', 6) + DOT(110, 160, 8) +
    RF(196, 120, 18, 40, 4, 0.6) + RF(224, 96, 18, 64, 4, 0.6) + RF(252, 76, 18, 84, 4, 0.6) + L('M188 168H278', 4) +
    L('M44 232H96L108 206L124 256L140 196L152 232H276', 5),
};

const DOMAIN = { P: 'blue', M: 'cyan' };
const themeOf = (code) => THEMES[DOMAIN[code.split('-')[0]]];

/** Deterministic scatter of small particles (same image every run). */
function particles(code, color) {
  let seed = [...code].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  return Array.from({ length: 26 }, () => {
    const x = 40 + rnd() * 600;
    const y = 20 + rnd() * 360;
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(0.8 + rnd() * 2.2).toFixed(1)}" fill="${color}" opacity="${(0.15 + rnd() * 0.45).toFixed(2)}"/>`;
  }).join('');
}

function svg(code) {
  const { c, l } = themeOf(code);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#081530"/><stop offset="1" stop-color="#040a17"/></linearGradient>
  <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${c}" stop-opacity=".42"/><stop offset=".6" stop-color="${c}" stop-opacity=".08"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".5" stop-color="${c}" stop-opacity=".16"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <style>
    .s{fill:none;stroke:${c};stroke-linecap:round;stroke-linejoin:round}
    .l{fill:none;stroke:${l};stroke-linecap:round;stroke-linejoin:round}
    .f{fill:${c};stroke:none}
    .dot{fill:${l}}
  </style>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<path d="M-40 400L260 -20H330L30 400Z" fill="url(#beam)"/><path d="M420 400L720 -20H760L460 400Z" fill="url(#beam)" opacity=".6"/>
<g opacity=".18" stroke="${l}" stroke-width="1">${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${40 + i * 40}H${W}"/>`).join('')}${Array.from({ length: 18 }, (_, i) => `<path d="M${40 + i * 40} 0V${H}"/>`).join('')}</g>
<ellipse cx="360" cy="200" rx="270" ry="200" fill="url(#halo)"/>
${particles(code, l)}
<g transform="translate(200 40)" filter="url(#glow)">${ART[code]()}</g>
</svg>`;
}

async function main() {
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ART);
  const require = createRequire(join(root, 'e2e/package.json'));
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  mkdirSync(out, { recursive: true });
  for (const code of codes) {
    if (!ART[code]) throw new Error(`no illustration for ${code}`);
    await page.setContent(`<html><body style="margin:0;background:#040a17">${svg(code)}</body></html>`);
    writeFileSync(join(out, `${code}.jpg`), await page.screenshot({ type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: W, height: H } }));
    console.log(`${code}.jpg`);
  }
  await browser.close();
}

await main();
