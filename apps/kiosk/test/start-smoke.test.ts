/**
 * The smoke on the start screen (smoke.ts): where the hero photo lands so the smoke goes behind the
 * wrestler, the matte belonging to the seeded photo, at most 30 frames a second, giving way on a device
 * that cannot keep up, and nothing at all without a GPU.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverRect, FramePacer, HERO_MATTE_CHECKSUM, startSmoke } from '../src/renderer/smoke';

/** Runs the pacer on frames `every` ms apart for `ms` and counts what it said. */
function run(pacer: FramePacer, from: number, ms: number, every: number) {
  const said = { skip: 0, draw: 0, lower: 0, stop: 0 };
  for (let i = 0; i < Math.round(ms / every); i++) said[pacer.tick(from + i * every)]++;
  return said;
}

describe('start screen smoke', () => {
  it('finds the hero photo where the start screen draws it (cover, centred, from the top)', () => {
    const r = coverRect({ x: 0, y: 0, w: 1080, h: 1380 }, { width: 864, height: 1085 });
    expect(r.h).toBe(1380);
    expect(r.w).toBeCloseTo(1098.9, 1);
    expect(r.x).toBeCloseTo(-9.45, 1);
    expect(r.y).toBe(0);
    // a wide photo is cut at the sides
    expect(coverRect({ x: 0, y: 0, w: 1080, h: 1380 }, { width: 2000, height: 1000 })).toEqual({ x: -840, y: 0, w: 2760, h: 1380 });
  });

  it('has the matte of the seeded hero photo, the same shape as the photo', () => {
    const photo = readFileSync(resolve(__dirname, '../../../assets/seed-media/hero.jpg'));
    // a new default photo needs a new matte (and this checksum), or the smoke would not fit the wrestler
    expect(createHash('sha256').update(photo).digest('hex')).toBe(HERO_MATTE_CHECKSUM);
    const png = readFileSync(resolve(__dirname, '../src/renderer/assets/img/hero-matte.png'));
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect(w / h).toBeCloseTo(864 / 1085, 2);
  });

  it('draws at most 30 times a second and keeps going on a device that keeps up', () => {
    const pacer = new FramePacer(0);
    expect(run(pacer, 0, 60_000, 1000 / 60)).toMatchObject({ draw: 1800, lower: 0, stop: 0 });
  });

  it('on a device that cannot keep up, lowers the resolution first, then gives up', () => {
    const pacer = new FramePacer(0);
    const first = run(pacer, 0, 4000, 100);
    expect(first.lower).toBe(1);
    expect(first.stop).toBe(0);
    expect(run(pacer, 4000, 3000, 100).stop).toBe(1);
    // the next start screen begins where this device left off: lowered, and gives up at once if still slow
    expect(run(new FramePacer(0, 1), 0, 4000, 100)).toMatchObject({ lower: 0, stop: 1 });
  });

  it('a pause (hidden page, screen coming back) does not count as slow', () => {
    const pacer = new FramePacer(0);
    run(pacer, 0, 3000, 1000 / 60);
    for (let i = 0; i < 20; i++) expect(pacer.tick(5000 + i * 5000)).toBe('draw');
    expect(run(pacer, 200_000, 10_000, 1000 / 60)).toMatchObject({ lower: 0, stop: 0 });
  });

  it('does not start without WebGL or with only a software renderer', () => {
    let asked: WebGLContextAttributes | undefined;
    const canvas = {
      getContext: (_kind: string, attrs: WebGLContextAttributes) => {
        asked = attrs;
        return null;
      },
    } as unknown as HTMLCanvasElement;
    expect(startSmoke(canvas, { matte: null })).toBeNull();
    expect(asked?.failIfMajorPerformanceCaveat).toBe(true);
  });
});
