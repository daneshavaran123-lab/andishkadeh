/**
 * Changes of screen with the soft transition (store.ts → transition): the change applies inside the
 * View Transition, after the old screen was captured, so what changes with it travels along; a toast
 * shown right after the change stays; ending a session drops its late results at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionGuard, useSession } from '../src/renderer/store';

/** Just enough of `document` for View Transitions: the update runs when the test says so. */
function fakeDocument() {
  const pending: Array<() => void> = [];
  const doc = {
    documentElement: { dataset: {} as Record<string, string | undefined> },
    startViewTransition(update: () => void) {
      pending.push(update);
      return { finished: new Promise<void>(() => undefined) };
    },
  };
  return { doc, run: () => pending.splice(0).forEach((u) => u()) };
}

const top = () => useSession.getState().stack.at(-1)!.id;
let view: ReturnType<typeof fakeDocument>;

beforeEach(() => {
  vi.useFakeTimers();
  view = fakeDocument();
  vi.stubGlobal('document', view.doc);
  useSession.setState({ stack: [{ id: 'welcome' }], cart: [], mobile: '', toast: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('change of screen', () => {
  it('applies inside the transition, forward or back, with the data that changes with it', () => {
    const s = useSession.getState();
    s.go('home');
    expect(top()).toBe('welcome'); // the old screen is still being captured
    expect(view.doc.documentElement.dataset.nav).toBe('forward');
    view.run();
    expect(top()).toBe('home');

    s.go('categories');
    view.run();
    s.backTo('home', { mobile: '09121234567' });
    expect(useSession.getState().mobile).toBe('');
    expect(view.doc.documentElement.dataset.nav).toBe('back');
    view.run();
    expect(top()).toBe('home');
    expect(useSession.getState().mobile).toBe('09121234567');
  });

  it('only cross-fades to and from payment and result screens', () => {
    useSession.getState().go('paying');
    expect(view.doc.documentElement.dataset.nav).toBe('fade');
  });

  it('keeps a toast shown right after the change and clears the one that was showing', () => {
    const s = useSession.getState();
    s.showToast('earlier');
    s.go('categories');
    s.showToast('for the next screen');
    view.run();
    expect(useSession.getState().toast).toBe('for the next screen');

    s.go('cart');
    view.run();
    expect(useSession.getState().toast).toBeNull();
  });

  it('ending a session drops its late results at once and clears it with the screen', () => {
    const s = useSession.getState();
    s.go('home');
    view.run();
    s.addToCart('svc-1');
    const guard = sessionGuard();
    s.reset();
    expect(guard.alive()).toBe(false);
    view.run();
    expect(top()).toBe('welcome');
    expect(useSession.getState().cart).toEqual([]);
  });

  it('applies at once where View Transitions are not available', () => {
    vi.unstubAllGlobals();
    useSession.getState().go('home');
    expect(top()).toBe('home');
  });
});
