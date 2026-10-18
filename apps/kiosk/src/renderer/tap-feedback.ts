/**
 * Touch feedback on every tap: a short click sound like the iPhone keyboard click (tap-sound.ts) and a
 * ring spreading from the finger in the colour of the card or button. A tap on something unavailable
 * (disabled) gives a lower, softer sound and no ring. The sound follows the panel setting `tapSound`;
 * the ring is left out when the system asks for reduced motion.
 */
import { useEffect, type RefObject } from 'react';
import { useApp } from './store';
import { TapSound } from './tap-sound';

const TAPPABLE = 'button, a[href], [role="button"], label, select';

const sound = new TapSound(() => {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctx ? new Ctx() : null;
});

const soundOn = () => useApp.getState().bootstrap?.settings.tapSound ?? true;

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
      if (soundOn()) sound.tap(denied ? 'denied' : 'tap', e.pointerType === 'mouse');
      if (!denied && !reduced?.matches) ring(stage.current, scale, target, e);
    };
    // the gestures that let a page start sound (the finger lifting, a key, a click)
    const onGesture = () => {
      if (soundOn()) sound.unlock();
    };
    const gestures = ['pointerup', 'touchend', 'keydown', 'click'] as const;
    window.addEventListener('pointerdown', onDown, true);
    for (const g of gestures) window.addEventListener(g, onGesture, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      for (const g of gestures) window.removeEventListener(g, onGesture, { capture: true });
    };
  }, [stage, scale]);
}
