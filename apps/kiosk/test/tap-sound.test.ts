/**
 * The tap click: its sound, and starting the audio the way phones allow it (from the finger lifting,
 * not touching down).
 */
import { describe, expect, it } from 'vitest';
import { clickSamples, TapSound } from '../src/renderer/tap-sound';

/** Just enough of an AudioContext: starts asleep, records what it plays (by buffer length). */
class FakeAudio {
  state: AudioContextState = 'suspended';
  sampleRate = 48000;
  destination = {};
  played: number[] = [];
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  createBufferSource() {
    const played = this.played;
    return {
      buffer: null as { length: number } | null,
      connect: (n: unknown) => n,
      start() {
        if (this.buffer!.length > 1) played.push(this.buffer!.length);
      },
    };
  }
  createGain() {
    return { gain: { value: 1 }, connect: (n: unknown) => n };
  }
}

function setup() {
  const audio = new FakeAudio();
  let clock = 0;
  const sound = new TapSound(
    () => audio as unknown as AudioContext,
    () => clock,
  );
  return { audio, sound, later: (ms: number) => (clock += ms) };
}

const TAP = 48000 * 0.03;
const DENIED = 48000 * 0.08;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('tap sound', () => {
  it('a finger tap waits for the finger to lift to start the audio, then clicks once', async () => {
    const { audio, sound } = setup();
    sound.tap('tap', false);
    await settle();
    expect(audio.played).toEqual([]);
    sound.unlock();
    await settle();
    expect(audio.played).toEqual([TAP]);
    sound.unlock(); // the click event after the lift
    await settle();
    expect(audio.played).toEqual([TAP]);
  });

  it('once the audio runs, every tap clicks on touch-down', async () => {
    const { audio, sound } = setup();
    sound.unlock();
    await settle();
    sound.tap('tap', false);
    sound.tap('denied', false);
    expect(audio.played).toEqual([TAP, DENIED]);
  });

  it('a mouse press is a gesture by itself: it clicks without waiting for the release', async () => {
    const { audio, sound } = setup();
    sound.tap('tap', true);
    await settle();
    expect(audio.played).toEqual([TAP]);
  });

  it('a tap long past is not played late', async () => {
    const { audio, sound, later } = setup();
    sound.tap('tap', false);
    later(2000);
    sound.unlock();
    await settle();
    expect(audio.played).toEqual([]);
  });

  it('the click is a short tick: loud at once, gone within a few milliseconds', () => {
    const s = clickSamples('tap', 48000);
    expect(s.length).toBe(TAP);
    expect(Math.max(...s.map(Math.abs))).toBeCloseTo(1, 5);
    const energy = (from: number, to: number) => s.slice(from, to).reduce((a, v) => a + v * v, 0);
    expect(energy(0, 48 * 8) / energy(0, s.length)).toBeGreaterThan(0.97);
    expect(clickSamples('tap', 48000)).toEqual(s);
  });
});
