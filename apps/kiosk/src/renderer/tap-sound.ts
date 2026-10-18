/**
 * The tap click: a short, crisp tick in the manner of the iPhone keyboard click, synthesised with Web
 * Audio (no file to load, so it also works offline), and a lower, softer one for a tap on something
 * unavailable.
 *
 * Browsers only let a page start sound from a completed gesture, and on a phone that is the finger
 * lifting (pointerup / touchend), not touching down. So `unlock()` runs on every lift, key press or
 * click and wakes the audio: a tap made while it was still asleep clicks as soon as it is awake (the
 * very first tap, a moment late), every later tap clicks on touch-down. As on the iPhone itself, the
 * phone's silent switch mutes these clicks.
 */
export type TapKind = 'tap' | 'denied';

/** Damped resonances [Hz, decay in s, level], the noise burst that starts the sound, its length and level. */
const VOICES: Record<TapKind, { modes: [number, number, number][]; noise: number; length: number; gain: number }> = {
  tap: { modes: [[1850, 0.0022, 1], [3300, 0.0014, 0.55], [950, 0.0032, 0.35]], noise: 0.5, length: 0.03, gain: 0.55 },
  denied: { modes: [[480, 0.012, 1], [960, 0.005, 0.25]], noise: 0.12, length: 0.08, gain: 0.35 },
};

/** How long a tap made while the audio was asleep may still click once it wakes (ms). */
const LATE_TAP_MS = 800;

/** The samples of a click (peak 1), the same every time. */
export function clickSamples(kind: TapKind, rate: number): Float32Array {
  const { modes, noise, length } = VOICES[kind];
  const out = new Float32Array(Math.round(rate * length));
  let seed = 1;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    seed = (seed * 16807) % 2147483647;
    let v = noise * (seed / 1073741823.5 - 1) * Math.exp(-t / 0.0008);
    for (const [f, decay, level] of modes) v += level * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / decay);
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  return out.map((v) => v / peak);
}

export class TapSound {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<TapKind, AudioBuffer>();
  private pending: { kind: TapKind; at: number } | null = null;

  constructor(
    private readonly create: () => AudioContext | null,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** A tap landed (touch-down). `gesture`: the press itself lets sound start (a mouse button, not a finger). */
  tap(kind: TapKind, gesture: boolean) {
    if (this.ctx?.state === 'running') return this.play(kind);
    this.pending = { kind, at: this.now() };
    if (gesture) this.unlock();
  }

  /** A completed gesture: start or wake the audio, then play the tap that was waiting for it. */
  unlock() {
    try {
      this.ctx ??= this.create();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state === 'running') return this.flush();
      // a silent sound started inside the gesture: older iOS needs it to really let the audio run
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start();
      ctx.resume().then(
        () => this.flush(),
        () => undefined,
      );
    } catch {
      // no audio output: taps stay silent
    }
  }

  private flush() {
    const p = this.pending;
    this.pending = null;
    if (p && this.now() - p.at < LATE_TAP_MS) this.play(p.kind);
  }

  private play(kind: TapKind) {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      let buffer = this.buffers.get(kind);
      if (!buffer) {
        const samples = clickSamples(kind, ctx.sampleRate);
        buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        buffer.getChannelData(0).set(samples);
        this.buffers.set(kind, buffer);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = VOICES[kind].gain;
      src.connect(gain).connect(ctx.destination);
      src.start();
    } catch {
      // no audio output: taps stay silent
    }
  }
}
