// Default images of the subcategories (assets/seed-media/subcategories/<code>.jpg): one neon line
// illustration per subgroup, in its domain's colour, matching its title, centred so that a square
// crop (thumbnails) and the kiosk row (chevron on the left) both keep it whole. Drawn as SVG and
// rendered with Chromium (Playwright from the e2e package). Every image can be replaced in the panel.
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
  red: { c: '#ff284c', l: '#ff9aab' },
  purple: { c: '#a34bff', l: '#d4a8ff' },
  cyan: { c: '#00d6d1', l: '#8ff5f1' },
};

// ---------------------------------------------------------------- drawing helpers (320×320 box)
const S = (d, w = 7) => `<path d="${d}" class="s" stroke-width="${w}"/>`; // neon stroke
const L = (d, w = 4) => `<path d="${d}" class="l" stroke-width="${w}"/>`; // light stroke
const F = (d, o = 0.22) => `<path d="${d}" class="f" fill-opacity="${o}"/>`; // tinted fill
const C = (cx, cy, r, w = 7) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="s" stroke-width="${w}"/>`;
const CL = (cx, cy, r, w = 4) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="l" stroke-width="${w}"/>`;
const CF = (cx, cy, r, o = 0.22) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="f" fill-opacity="${o}"/>`;
const DOT = (cx, cy, r = 6) => `<circle cx="${cx}" cy="${cy}" r="${r}" class="dot"/>`;
const R = (x, y, w, h, rx = 12, sw = 7) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="s" stroke-width="${sw}"/>`;
const RF = (x, y, w, h, rx = 12, o = 0.18) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="f" fill-opacity="${o}"/>`;
const RL = (x, y, w, h, rx = 10, sw = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="l" stroke-width="${sw}"/>`;
const G = (t, body) => `<g transform="${t}">${body}</g>`;
const lines = (x, y, widths, gap = 22, w = 5) => widths.map((len, i) => L(`M${x} ${y + i * gap}h${len}`, w)).join('');
const check = (x, y, s = 1, w = 6) => S(`M${x} ${y}l${10 * s} ${10 * s}l${20 * s} -${22 * s}`, w);

/** Head in profile facing right, about 170×190 at scale 1. */
const HEAD =
  'M70 200V165C38 152 26 116 28 86C31 42 68 14 110 14C152 14 180 44 180 84V96C180 104 184 110 190 118L197 128C199 132 197 135 192 135H181V150C181 160 175 165 165 165H140V200';
/** Bust (head and shoulders) centred on x, head centre at y. */
const bust = (x, y, s = 1) =>
  C(x, y, 16 * s, 6) + S(`M${x - 30 * s} ${y + 62 * s}C${x - 30 * s} ${y + 34 * s} ${x - 18 * s} ${y + 24 * s} ${x} ${y + 24 * s}C${x + 18 * s} ${y + 24 * s} ${x + 30 * s} ${y + 34 * s} ${x + 30 * s} ${y + 62 * s}`, 6);
/** Brain seen from the side, about 200×150 at scale 1. */
const BRAIN =
  'M100 22C84 6 54 10 48 34C24 34 10 56 20 78C4 92 8 120 32 126C34 150 62 160 82 146C92 160 116 160 126 146C146 160 176 150 176 126C198 120 202 92 186 78C196 56 182 34 158 34C152 10 120 6 100 22Z';
const BRAIN_FOLDS = 'M100 22V146M48 34C62 44 64 62 52 74M20 78C36 82 46 94 44 108M158 34C144 44 142 62 154 74M186 78C170 82 160 94 162 108M70 96C82 88 96 92 100 104M130 96C118 88 104 92 100 104';
/** Sine-like wave from x0 to x1 around y. */
const wave = (x0, x1, y, amp, period) => {
  let d = `M${x0} ${y}`;
  for (let x = x0; x < x1; x += period / 2) {
    const up = ((x - x0) / (period / 2)) % 2 === 0 ? -1 : 1;
    d += `Q${x + period / 4} ${y + up * amp * 2} ${Math.min(x + period / 2, x1)} ${y}`;
  }
  return d;
};
const ecg = (x0, y, s = 1) => `M${x0} ${y}h${40 * s}l${10 * s} -${22 * s}l${14 * s} ${52 * s}l${14 * s} -${66 * s}l${12 * s} ${36 * s}h${40 * s}`;
const sparkle = (x, y, r = 10) => S(`M${x} ${y - r}V${y + r}M${x - r} ${y}H${x + r}`, 4);

// ---------------------------------------------------------------- the illustrations
const ART = {
  // Performance (blue)
  'P-1': () => // body composition: silhouette on a scale, composition ring, pulse
    F('M130 34m-22 0a22 22 0 1 0 44 0a22 22 0 1 0 -44 0M96 72H164L178 150L160 152L156 196L166 280H146L132 214L118 280H98L106 196L102 152L84 150Z', 0.2) +
    C(130, 34, 22) + S('M96 72H164L178 150M160 150L156 196L166 280M146 280L132 214L118 280M98 280L106 196L102 150M84 150L96 72') +
    S('M70 296H192', 8) +
    `<circle cx="248" cy="112" r="48" class="s" stroke-width="12" stroke-dasharray="120 200" transform="rotate(-90 248 112)"/>` +
    `<circle cx="248" cy="112" r="48" class="l" stroke-width="12" stroke-dasharray="90 230" stroke-dashoffset="-128" transform="rotate(-90 248 112)"/>` +
    `<circle cx="248" cy="112" r="48" class="s" stroke-width="12" stroke-opacity=".45" stroke-dasharray="80 240" stroke-dashoffset="-226" transform="rotate(-90 248 112)"/>` +
    L(ecg(196, 236, 0.85), 5),
  'P-2': () => // aerobic: heart with ECG, oxygen bubbles, track
    F('M150 268C80 220 40 180 40 128C40 90 68 64 102 64C124 64 140 76 150 94C160 76 176 64 198 64C232 64 260 90 260 128C260 180 220 220 150 268Z', 0.18) +
    S('M150 268C80 220 40 180 40 128C40 90 68 64 102 64C124 64 140 76 150 94C160 76 176 64 198 64C232 64 260 90 260 128C260 180 220 220 150 268Z', 8) +
    L('M20 160H96L110 128L128 196L146 104L162 170L174 160H300', 6) +
    CL(278, 70, 16) + CL(296, 34, 10) + CL(250, 30, 7),
  'P-3': () => // anaerobic: draining battery and a lightning bolt
    R(40, 70, 96, 200, 18, 8) + S('M70 54H106', 10) +
    RF(56, 206, 64, 48, 8, 0.7) + RF(56, 150, 64, 48, 8, 0.35) + RL(56, 94, 64, 48, 8, 3) +
    F('M222 40L170 172H214L196 290L270 138H224L252 40Z', 0.3) + S('M222 40L170 172H214L196 290L270 138H224L252 40Z', 7) +
    L('M290 120H312M282 168H312M296 216H312', 6),
  'P-4': () => // strength: barbell and a kettlebell
    S('M10 120H310', 9) +
    RF(42, 66, 26, 108, 8, 0.3) + R(42, 66, 26, 108, 8, 7) + R(74, 82, 18, 76, 6, 6) +
    RF(252, 66, 26, 108, 8, 0.3) + R(252, 66, 26, 108, 8, 7) + R(228, 82, 18, 76, 6, 6) +
    L('M100 106V134M220 106V134', 6) +
    F('M120 286H200C214 286 222 276 220 262L212 214C208 196 194 186 176 184H144C126 186 112 196 108 214L100 262C98 276 106 286 120 286Z', 0.25) +
    S('M120 286H200C214 286 222 276 220 262L212 214C208 196 194 186 176 184H144C126 186 112 196 108 214L100 262C98 276 106 286 120 286Z') +
    S('M136 186C130 160 140 150 160 150C180 150 190 160 184 186', 7),
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
  'P-8': () => // specialist report: chart document and magnifier
    RF(60, 30, 170, 250, 18, 0.14) + R(60, 30, 170, 250, 18) + lines(88, 66, [110, 76]) +
    RF(90, 184, 22, 60, 4, 0.6) + RF(124, 150, 22, 94, 4, 0.6) + RF(158, 124, 22, 120, 4, 0.6) + L('M84 252H206', 4) +
    CF(236, 222, 44, 0.12) + C(236, 222, 44, 8) + S('M268 254L304 290', 12),

  // Nutrition (red)
  'N-1': () => // nutrition assessment: plate and cutlery with a checklist
    CF(128, 168, 86, 0.14) + C(128, 168, 86) + CL(128, 168, 56) +
    S('M18 96V160M8 96V138C8 150 28 150 28 138V96', 6) + S('M18 160V262', 7) + S('M238 96C220 120 220 160 236 170V262', 7) +
    RF(248, 40, 66, 92, 10, 0.2) + R(248, 40, 66, 92, 10, 5) + check(258, 66, 0.7, 5) + check(258, 98, 0.7, 5),
  'N-2': () => // nutrition counselling: speech bubbles with an apple and a leaf
    F('M30 60H200C212 60 220 68 220 80V160C220 172 212 180 200 180H96L60 214V180H30C18 180 10 172 10 160V80C10 68 18 60 30 60Z', 0.16) +
    S('M30 60H200C212 60 220 68 220 80V160C220 172 212 180 200 180H96L60 214V180H30C18 180 10 172 10 160V80C10 68 18 60 30 60Z') +
    S('M115 104C100 92 76 98 76 124C76 150 96 166 115 160C134 166 154 150 154 124C154 98 130 92 115 104Z', 6) + L('M115 104C112 92 118 84 128 80', 5) +
    F('M150 190H290C302 190 310 198 310 210V262C310 274 302 282 290 282H270V306L244 282H150C138 282 130 274 130 262V210C130 198 138 190 150 190Z', 0.12) +
    S('M150 190H290C302 190 310 198 310 210V262C310 274 302 282 290 282H270V306L244 282H150C138 282 130 274 130 262V210C130 198 138 190 150 190Z', 6) +
    L('M186 254C186 226 210 210 246 214C248 248 222 262 186 254ZM186 254L226 226', 5),
  'N-3': () => // meal plan: calendar with meals
    RF(30, 54, 260, 236, 20, 0.12) + R(30, 54, 260, 236, 20) + S('M30 104H290', 7) + S('M90 34V72M230 34V72', 9) +
    L('M116 104V290M204 104V290M30 166H290M30 228H290', 3) +
    S('M72 124C64 118 52 120 52 134C52 148 62 156 72 152C82 156 92 148 92 134C92 120 80 118 72 124Z', 5) + L('M72 124C72 118 74 114 80 112', 4) +
    L('M138 152C138 132 154 122 178 124C180 146 162 156 138 152Z', 5) + check(236, 132, 0.9, 6) +
    S('M54 200C66 184 90 184 104 200C90 216 66 216 54 200ZM104 200L114 190V210Z', 5) +
    S('M160 180C152 192 146 200 146 208C146 216 152 220 160 220C168 220 174 216 174 208C174 200 168 192 160 180Z', 5) + DOT(246, 198, 9) + DOT(246, 260, 9) + check(140, 250, 0.9, 6),
  'N-4': () => // supplements: capsules, pills and a shaker
    G('rotate(-35 90 110)', RF(40, 86, 110, 48, 24, 0.25) + R(40, 86, 110, 48, 24) + S('M95 86V134', 6) + F('M95 86H126C139 86 150 97 150 110C150 123 139 134 126 134H95Z', 0.5)) +
    G('rotate(25 110 220)', RF(60, 198, 96, 42, 21, 0.2) + R(60, 198, 96, 42, 21, 6) + S('M108 198V240', 5)) +
    CF(46, 270, 18, 0.3) + C(46, 270, 18, 5) + L('M34 270H58', 4) + C(170, 296, 14, 5) +
    F('M222 104H286L280 300H228Z', 0.2) + S('M222 104H286L280 300H228Z') + R(214, 74, 80, 30, 8, 6) + S('M240 74V52H268V74', 6) + L('M232 180H276M234 220H274', 5),
  'N-5': () => // nutrition monitoring: rising chart, water drop and scale
    RF(20, 50, 220, 170, 16, 0.12) + R(20, 50, 220, 170, 16) + S('M106 220L96 262M154 220L164 262M76 266H184', 6) +
    L('M44 186L84 150L120 166L160 110L210 84', 6) + DOT(84, 150) + DOT(120, 166) + DOT(160, 110) + DOT(210, 84, 8) +
    F('M276 120C260 146 248 162 248 180C248 198 260 210 276 210C292 210 304 198 304 180C304 162 292 146 276 120Z', 0.3) +
    S('M276 120C260 146 248 162 248 180C248 198 260 210 276 210C292 210 304 198 304 180C304 162 292 146 276 120Z', 6) +
    R(226, 250, 84, 50, 10, 6) + L('M252 266H284', 5),
  'N-6': () => // nutrition profile: profile card and radar chart
    RF(16, 60, 150, 210, 16, 0.14) + R(16, 60, 150, 210, 16) + C(91, 116, 26, 6) + S('M54 182C58 162 72 150 91 150C110 150 124 162 128 182', 6) + lines(44, 210, [94, 70, 84], 20) +
    S('M244 92L298 123V185L244 216L190 185V123Z', 5) + L('M244 120L274 137V171L244 188L214 171V137Z', 3) + L('M244 92V216M190 123L298 185M298 123L190 185', 2) +
    F('M244 104L286 132L272 178L244 200L204 176L214 128Z', 0.4) + S('M244 104L286 132L272 178L244 200L204 176L214 128Z', 5),
  'N-7': () => // team and camp: tent and three athletes
    F('M160 40L20 230H300Z', 0.12) + S('M160 40L20 230H300Z', 7) + S('M160 40V230M120 230L160 150L200 230', 5) + S('M160 40V14L188 22L160 30', 5) +
    bust(76, 236, 0.9) + bust(160, 246, 1) + bust(244, 236, 0.9) + sparkle(270, 70, 9) + sparkle(46, 110, 7),
  'N-8': () => // nutrition report: pie chart document with a leaf
    RF(50, 30, 180, 260, 18, 0.14) + R(50, 30, 180, 260, 18) + lines(78, 64, [120, 90]) +
    CF(140, 176, 54, 0.15) + C(140, 176, 54, 6) + F('M140 176V122A54 54 0 0 1 192 190Z', 0.6) + S('M140 176V122M140 176L192 190', 5) + lines(78, 254, [104, 70], 20, 4) +
    F('M222 274C222 222 256 194 312 198C314 256 280 280 222 274Z', 0.3) + S('M222 274C222 222 256 194 312 198C314 256 280 280 222 274ZM222 274L284 220', 6),

  // Psychology (purple)
  'PS-1': () => // psychological assessment: head with a checklist inside
    F(HEAD, 0.14) + S(HEAD) + check(62, 66, 0.8, 5) + L('M98 72H150', 5) + check(62, 104, 0.8, 5) + L('M98 110H140', 5) + check(62, 142, 0.8, 5) + L('M98 148H128', 5) +
    CF(250, 210, 44, 0.12) + C(250, 210, 44, 7) + S('M282 242L310 272', 11),
  'PS-2': () => // counselling and intervention: two people facing, a heart between
    G('translate(-10 50) scale(.72)', F(HEAD, 0.14) + S(HEAD, 9)) +
    G('translate(330 50) scale(-.72 .72)', F(HEAD, 0.14) + S(HEAD, 9)) +
    F('M160 196C136 178 122 164 122 146C122 132 132 122 145 122C152 122 157 126 160 132C163 126 168 122 175 122C188 122 198 132 198 146C198 164 184 178 160 196Z', 0.45) +
    S('M160 196C136 178 122 164 122 146C122 132 132 122 145 122C152 122 157 126 160 132C163 126 168 122 175 122C188 122 198 132 198 146C198 164 184 178 160 196Z', 5) +
    L('M126 96C146 82 174 82 194 96M136 76C150 68 170 68 184 76', 4),
  'PS-3': () => // cognitive assessment and training: brain network with a target
    G('translate(30 40) scale(1.05)', F(BRAIN, 0.14) + S(BRAIN) + L(BRAIN_FOLDS, 4)) +
    DOT(80, 120) + DOT(150, 92) + DOT(214, 136) + DOT(132, 176) + L('M80 120L150 92L214 136L132 176Z', 3) +
    CF(266, 252, 40, 0.12) + C(266, 252, 40, 6) + CL(266, 252, 22, 4) + DOT(266, 252, 7),
  NE: () => // QEEG: electrode cap seen from above and brain waves
    F('M120 30C176 30 214 80 214 150C214 222 174 280 120 280C66 280 26 222 26 150C26 80 64 30 120 30Z', 0.12) +
    S('M120 30C176 30 214 80 214 150C214 222 174 280 120 280C66 280 26 222 26 150C26 80 64 30 120 30Z') + S('M104 32L120 8L136 32', 6) + S('M26 130C14 132 10 168 26 172M214 130C226 132 230 168 214 172', 6) +
    L('M120 30V280M26 150H214M60 70L180 230M180 70L60 230', 2) +
    [[120, 70], [80, 100], [160, 100], [64, 150], [120, 150], [176, 150], [80, 200], [160, 200], [120, 238]].map(([x, y]) => CF(x, y, 11, 0.9) + C(x, y, 11, 4)).join('') +
    L(wave(236, 316, 96, 10, 20), 4) + S(wave(236, 316, 150, 14, 26), 5) + L(wave(236, 316, 204, 8, 16), 4),
  NF: () => // neurofeedback: head linked to a screen showing brain waves
    G('translate(-4 70) scale(.6)', F(HEAD, 0.14) + S(HEAD, 11)) + G('translate(16 82) scale(.32)', L(BRAIN, 9)) +
    RF(150, 70, 160, 120, 14, 0.14) + R(150, 70, 160, 120, 14) + S('M214 190V214M188 216H240', 6) + S(wave(166, 294, 130, 14, 32), 5) +
    `<path d="M110 60C130 30 170 30 192 52" class="l" stroke-width="5" stroke-dasharray="2 12"/>` + S('M184 40L194 54L178 60', 5) +
    `<path d="M200 250C170 280 120 280 98 252" class="l" stroke-width="5" stroke-dasharray="2 12"/>` + S('M108 262L96 250L110 242', 5),
  BF: () => // biofeedback: heart rate variability and breathing rings
    F('M110 250C60 214 30 184 30 146C30 118 52 98 78 98C94 98 104 106 110 118C116 106 126 98 142 98C168 98 190 118 190 146C190 184 160 214 110 250Z', 0.2) +
    S('M110 250C60 214 30 184 30 146C30 118 52 98 78 98C94 98 104 106 110 118C116 106 126 98 142 98C168 98 190 118 190 146C190 184 160 214 110 250Z', 7) +
    L('M40 164H74L86 140L100 192L114 120L126 172L136 164H190', 5) +
    C(256, 112, 26, 6) + CL(256, 112, 44, 4) + `<circle cx="256" cy="112" r="62" class="l" stroke-width="3" stroke-dasharray="3 10"/>` +
    S(wave(200, 316, 270, 10, 38), 5),
  NS: () => // brain stimulation (tDCS): electrode pads and current over the head
    G('translate(-6 60) scale(.9)', F(HEAD, 0.12) + S(HEAD, 8)) +
    G('rotate(-24 70 92)', RF(46, 78, 50, 30, 8, 0.6) + R(46, 78, 50, 30, 8, 5)) + G('rotate(20 150 76)', RF(126, 62, 50, 30, 8, 0.6) + R(126, 62, 50, 30, 8, 5)) +
    `<path d="M80 72C96 30 140 26 156 54" class="l" stroke-width="5" stroke-dasharray="8 8"/>` +
    S('M60 46H76M68 38V54', 5) + S('M168 32H184', 5) +
    R(232, 150, 70, 110, 12, 6) + S('M256 140H278', 8) + RF(244, 210, 46, 36, 6, 0.6) + S('M270 168L258 194H276L264 222', 5),
  VR: () => // virtual reality: headset over a perspective grid
    L('M0 300L120 210M320 300L200 210M60 300L132 210M260 300L188 210M120 300L146 210M200 300L174 210M10 262H310M40 236H280', 2) +
    F('M50 92H270C288 92 300 104 300 122V176C300 194 288 206 270 206H210L188 182C176 170 144 170 132 182L110 206H50C32 206 20 194 20 176V122C20 104 32 92 50 92Z', 0.2) +
    S('M50 92H270C288 92 300 104 300 122V176C300 194 288 206 270 206H210L188 182C176 170 144 170 132 182L110 206H50C32 206 20 194 20 176V122C20 104 32 92 50 92Z') +
    CF(96, 146, 30, 0.5) + C(96, 146, 30, 5) + CF(224, 146, 30, 0.5) + C(224, 146, 30, 5) + S('M50 92C70 52 250 52 270 92', 6) + S('M20 140H6M300 140H314', 8) + sparkle(160, 36, 10),
  'PS-4': () => // team services: three people joined in a circle
    `<circle cx="160" cy="160" r="122" class="l" stroke-width="4" stroke-dasharray="6 12"/>` +
    bust(160, 60, 1) + bust(70, 196, 1) + bust(250, 196, 1) + L('M138 112L96 168M182 112L224 168M104 240H216', 4) +
    CF(160, 186, 24, 0.5) + C(160, 186, 24, 5) + check(148, 186, 0.6, 5),
  'PS-5': () => // complete packages: stacked layers crowned with a brain
    F('M160 210L300 250L160 290L20 250Z', 0.12) + S('M160 210L300 250L160 290L20 250Z', 6) +
    F('M160 170L300 210L160 250L20 210Z', 0.2) + S('M160 170L300 210L160 250L20 210Z', 6) +
    F('M160 130L300 170L160 210L20 170Z', 0.3) + S('M160 130L300 170L160 210L20 170Z', 6) +
    G('translate(98 26) scale(.62)', F(BRAIN, 0.3) + S(BRAIN, 10) + L(BRAIN_FOLDS, 6)) + sparkle(262, 60, 12) + sparkle(56, 92, 9),

  // Monitoring (cyan)
  'M-0': () => // monitoring modules: dashboard with a gauge, bars and a heart line
    RF(20, 40, 280, 240, 20, 0.12) + R(20, 40, 280, 240, 20) +
    S('M60 160A50 50 0 0 1 160 160', 8) + L('M110 160L140 124', 6) + DOT(110, 160, 8) +
    RF(196, 120, 18, 40, 4, 0.6) + RF(224, 96, 18, 64, 4, 0.6) + RF(252, 76, 18, 84, 4, 0.6) + L('M188 168H278', 4) +
    L('M44 232H96L108 206L124 256L140 196L152 232H276', 5),
};

const DOMAIN = { P: 'blue', N: 'red', PS: 'purple', NE: 'purple', NF: 'purple', BF: 'purple', NS: 'purple', VR: 'purple', M: 'cyan' };
const themeOf = (code) => THEMES[DOMAIN[code] ?? DOMAIN[code.split('-')[0]]];

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
