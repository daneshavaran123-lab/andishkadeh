/**
 * Red and blue smoke drifting on the start screen (K01): blue from the left, red from the right, curling
 * into each other in the middle, in three depths that move at different speeds. With the default hero
 * photo it goes behind the wrestler (a matte cut from that photo says where he is), in front of the
 * graphics behind him, and over his feet where the photo fades into the floor.
 *
 * One fragment shader (noise warped by noise), drawn at a third of the screen's resolution and stretched
 * (smoke is soft anyway), at most 30 times a second. It needs a real GPU: where WebGL is missing, would
 * run in software, or cannot keep up, the start screen stays as it was.
 */

/** sha256 of the seeded hero photo (assets/seed-media/hero.jpg) that assets/img/hero-matte.png is cut from. */
export const HERO_MATTE_CHECKSUM = '8f53a2694bc9a4b5e59446e25493195420a0c7d8f6fc6c25a876bc31cddfd94a';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SmokeMatte {
  /** Grey image the size of the photo (any scale): white where the wrestler is. */
  src: string;
  /** The element showing the photo (background-size: cover, background-position: center top). */
  hero: HTMLElement;
  image: { width: number; height: number };
  /** The photo fades out from this fraction of its element's height down to its bottom (its CSS mask). */
  fadeFrom: number;
}

/** Where a `background-size: cover; background-position: center top` image lands in its box. */
export function coverRect(box: Box, image: { width: number; height: number }): Box {
  const k = Math.max(box.w / image.width, box.h / image.height);
  const w = image.width * k;
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h: image.height * k };
}

const FRAME_MS = 1000 / 30;
const WARMUP_MS = 1500;
const WINDOW_MS = 2000;
const MIN_FPS = 18;

/**
 * When to draw: at most 30 times a second. Drawing slower than MIN_FPS over a stretch of two seconds
 * (the GPU cannot keep up) first lowers the resolution, then gives up. The first moments and the time
 * after a pause (hidden page, screen coming back) are not counted.
 */
export class FramePacer {
  private last = Number.NEGATIVE_INFINITY;
  private since = 0;
  private frames = 0;

  /** `level`: 0 at full resolution, 1 already lowered. */
  constructor(
    private readonly start: number,
    private level = 0,
  ) {}

  tick(now: number): 'skip' | 'draw' | 'lower' | 'stop' {
    if (now - this.last < FRAME_MS - 4) return 'skip';
    const gap = now - this.last;
    this.last = now;
    if (gap > 1000 || now - this.start < WARMUP_MS) {
      this.since = now;
      this.frames = 0;
      return 'draw';
    }
    this.frames++;
    if (now - this.since < WINDOW_MS) return 'draw';
    const fps = (this.frames * 1000) / (now - this.since);
    this.since = now;
    this.frames = 0;
    if (fps >= MIN_FPS) return 'draw';
    return ++this.level === 1 ? 'lower' : 'stop';
  }
}

const VERT = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uGain;
uniform sampler2D uMatte;
uniform float uHasMatte;
uniform vec4 uImg;   // where the photo is drawn: left, top, width, height in screen pixels
uniform vec2 uHost;  // screen size in pixels
uniform vec2 uFade;  // the photo fades out between these two heights (pixels from the top)

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash(i), f), dot(hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
// smoke density 0..1: noise warped by noise, so it curls instead of just sliding
float smoke(vec2 p, float t, float seed) {
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.11) + seed), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.07, 0.0) + seed));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.13), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.09));
  float f = fbm(p + 2.6 * r);
  float d = 0.5 + f * 1.35 + 0.4 * (length(q) - 0.3);
  return smoothstep(0.48, 1.0, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;  // 0..1, y up
  vec2 p = vec2((uv.x - 0.5) * uRes.x / uRes.y, uv.y - 0.5);
  float t = uTime;
  vec3 blue = vec3(0.16, 0.45, 1.0);
  vec3 red = vec3(1.5, 0.18, 0.34);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  // three depths: far ones larger, slower and dimmer, near ones finer, quicker and brighter
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float scale = 1.25 + fl * 0.85;
    float speed = 0.32 + fl * 0.22;
    vec2 drift = vec2(0.08 * sin(t * 0.05 + fl * 2.1), -t * 0.025 * (1.0 + fl * 0.6));
    // blue from the left, red from the right; where they meet the border sways and frays
    float px = p.x / (0.5 * uRes.x / uRes.y);
    float sway = 0.28 * sin(t * 0.19 + fl * 1.7) + 0.16 * sin(t * 0.11 + p.y * 2.3 + fl);
    float fray = 0.9 * fbm(p * 1.4 + vec2(t * 0.04, -t * 0.03) + fl * 3.1);
    float x = px + sway + fray;
    float dB = smoke(p * scale + drift, t * speed, fl * 11.0) * smoothstep(0.6, -0.5, x);
    float dR = smoke(p * scale * 1.07 + vec2(-drift.x, drift.y) + vec2(3.1, 0.7), t * speed * 1.08, fl * 7.0 + 4.0) * smoothstep(-0.6, 0.5, x);
    float w = mix(0.5, 1.0, fl / 2.0);
    col += (blue * dB + red * dR) * w;
    alpha += (dB + dR) * w;
  }
  // heavier low down (floor smoke under the title) and at the sides
  float low = smoothstep(0.75, 0.05, uv.y);
  float sides = smoothstep(0.12, 0.5, abs(uv.x - 0.5));
  // without a matte: lighter over the middle, where a face usually is
  float face = 1.0 - 0.55 * smoothstep(0.22, 0.0, length(vec2((uv.x - 0.5) * 1.3, uv.y - 0.68)));
  // with one: none where the wrestler is, as far as the photo itself shows, and a little more around him
  vec2 s = vec2(uv.x, 1.0 - uv.y) * uHost;
  vec2 m = (s - uImg.xy) / uImg.zw;
  float inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
  float shown = clamp((uFade.y - s.y) / (uFade.y - uFade.x), 0.0, 1.0);
  float behind = 1.0 - texture2D(uMatte, m).r * inside * shown;
  float body = smoothstep(0.42, 0.62, uv.y) * smoothstep(0.92, 0.72, uv.y) * uHasMatte;
  float k = (0.28 + 0.75 * low + 0.45 * sides + 0.35 * body) * mix(face, behind, uHasMatte) * uGain;
  // mostly light added, little darkening
  gl_FragColor = vec4(min(col * k * 0.72, vec3(1.0)), clamp(alpha * k * 0.13, 0.0, 0.6));
}`;

/** The smoke's clock starts over every half hour (fading out and in), so the numbers stay small. */
const PERIOD_S = 1800;
const FADE_S = 2.5;
const SCALES = [1 / 3, 1 / 5];
/** What this device managed so far (an index into SCALES; past its end: gave up), kept until a reload. */
let reached = 0;

/**
 * Starts the smoke on a canvas covering the screen. Returns how to stop it, or null when it cannot run
 * here (no WebGL, or only a software renderer).
 */
export function startSmoke(canvas: HTMLCanvasElement, { matte }: { matte: SmokeMatte | null }): (() => void) | null {
  if (reached >= SCALES.length) return null;
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const host = { w: canvas.clientWidth, h: canvas.clientHeight };
  gl.uniform2f(u('uHost'), host.w, host.h);
  // no matte (yet): the matte terms stay finite and drop out
  gl.uniform1f(u('uHasMatte'), 0);
  gl.uniform4f(u('uImg'), 0, 0, 1, 1);
  gl.uniform2f(u('uFade'), 0, 1);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  for (const [p, v] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ])
    gl.texParameteri(gl.TEXTURE_2D, p, v);

  const size = (scale: number) => {
    canvas.width = Math.max(64, Math.round(host.w * scale));
    canvas.height = Math.max(64, Math.round(host.h * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u('uRes'), canvas.width, canvas.height);
  };
  size(SCALES[reached]);

  let raf = 0;
  let stopped = false;
  let t0 = 0;
  let pacer: FramePacer | null = null;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!pacer) {
      t0 = now;
      pacer = new FramePacer(now, reached);
    }
    const step = pacer.tick(now);
    if (step === 'skip') return;
    if (step === 'stop') {
      // cannot keep up: let the last frame fade away, and do not try again on this device
      reached = SCALES.length;
      cancelAnimationFrame(raf);
      canvas.style.opacity = '0';
      return;
    }
    if (step === 'lower') {
      reached = 1;
      size(SCALES[1]);
    }
    const t = ((now - t0) / 1000) % PERIOD_S;
    gl.uniform1f(u('uTime'), t);
    gl.uniform1f(u('uGain'), Math.min(1, t / FADE_S, (PERIOD_S - t) / FADE_S));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const begin = () => {
    if (!stopped) raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.removeEventListener('webglcontextlost', stop);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  canvas.addEventListener('webglcontextlost', stop);

  if (!matte) {
    begin();
    return stop;
  }
  // the smoke starts once the matte is in, so it never shows over the wrestler
  const img = new Image();
  img.onload = () => {
    if (stopped) return;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
    const el = matte.hero;
    const box = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    const r = coverRect(box, matte.image);
    gl.uniform4f(u('uImg'), r.x, r.y, r.w, r.h);
    gl.uniform2f(u('uFade'), box.y + box.h * matte.fadeFrom, box.y + box.h);
    gl.uniform1f(u('uHasMatte'), 1);
    begin();
  };
  img.onerror = begin;
  img.src = matte.src;
  return stop;
}
