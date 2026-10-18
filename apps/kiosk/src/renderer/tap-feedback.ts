/**
 * Touch feedback on every tap: a short click sound (synthesised with Web Audio, no file to load, so
 * it also works offline) and a ring spreading from the finger in the colour of the card or button.
 * A tap on something unavailable (disabled) gives a lower, softer sound and no ring. The sound
 * follows the panel setting `tapSound`; the ring is left out when the system asks for reduced motion.
 */
import { useEffect, type RefObject } from 'react';
import { useApp } from './store';

const TAPPABLE = 'button, a[href], [role="button"], label, select';

let audio: AudioContext | null = null;

function play(kind: 'tap' | 'denied') {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    if (kind === 'tap') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(720, t + 0.05);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.exponentialRampToValueAtTime(170, t + 0.09);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    }
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {
    // no audio output: taps stay silent
  }
}

function ring(stage: HTMLElement, scale: number, target: Element, e: PointerEvent) {
  const box = stage.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'tap-ring';
  el.style.left = `${(e.clientX - box.left) / scale}px`;
  el.style.top = `${(e.clientY - box.top) / scale}px`;
  const theme = getComputedStyle(target).getPropertyValue('--theme').trim();
  if (theme) el.style.setProperty('--ring', theme);
  el.addEventListener('animationend', () => el.remove());
  stage.appendChild(el);
}

/** Wires the feedback to the kiosk stage (scaled 1080×1920 canvas). */
export function useTapFeedback(stage: RefObject<HTMLElement | null>, scale: number) {
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !stage.current) return;
      const target = (e.target as Element | null)?.closest(TAPPABLE);
      if (!target || !stage.current.contains(target)) return;
      const denied = target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true';
      if (useApp.getState().bootstrap?.settings.tapSound ?? true) play(denied ? 'denied' : 'tap');
      if (!denied && !reduced?.matches) ring(stage.current, scale, target, e);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [stage, scale]);
}
