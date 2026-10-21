/**
 * UI state. `app` = data from the kiosk core (catalogue, status). `session` = one customer's
 * journey; it is wiped completely on finish, cancel or inactivity timeout (PRD §12, B-02).
 */
import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { create } from 'zustand';
import {
  ItemType,
  OrderKind,
  previewUnitPrice,
  priceItems,
  type Bootstrap,
  type CategoryDto,
  type PlanDto,
  type PricingItem,
  type ServiceDto,
  type SubcategoryDto,
  type ValidateAccessResponse,
} from '@andishkadeh/shared';
import type { AppState, KioskStatus, LocalOrderView, PaymentOutcomeView } from '../core/types';

export type ScreenId =
  | 'welcome'
  | 'home'
  | 'categories'
  | 'subcategories'
  | 'monitoring'
  | 'services'
  | 'serviceDetail'
  | 'cart'
  | 'subscriptionIntro'
  | 'plans'
  | 'planDetail'
  | 'mobile'
  | 'review'
  | 'paying'
  | 'paymentResult'
  | 'activation'
  | 'scan'
  | 'accessResult'
  | 'printing'
  | 'end';

export interface Route {
  id: ScreenId;
  params?: Record<string, string>;
}

/** Payment and result screens: no decorative motion (PRD F-02), so changes to and from them only cross-fade. */
export const CALM: ScreenId[] = ['mobile', 'review', 'paying', 'paymentResult', 'activation', 'printing', 'end', 'accessResult'];

let running: ViewTransition | null = null;

/**
 * Changes the screen with a soft transition (View Transitions API, styled in global.css): the old
 * screen fades away while the new one slides gently in, the other way round for "back", and a plain
 * cross-fade to or from a calm screen. The change is applied inside the transition, after the browser
 * has captured the old screen, so whatever must change with the screen is passed along with it.
 * Without the API (older WebViews) or with reduced motion it applies at once and the new screen
 * keeps its own short entrance.
 */
function transition(nav: 'forward' | 'back', from: ScreenId, to: ScreenId, apply: () => void): void {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (typeof document === 'undefined' || !('startViewTransition' in document) || reduced) return apply();
  const root = document.documentElement;
  root.dataset.nav = CALM.includes(from) || CALM.includes(to) ? 'fade' : nav;
  const t = document.startViewTransition(() => flushSync(apply));
  running = t;
  t.finished
    .finally(() => {
      if (running === t) delete root.dataset.nav;
    })
    .catch(() => undefined);
}

interface AppStore {
  ready: boolean;
  bootstrap: Bootstrap | null;
  status: KioskStatus | null;
  mediaBase: string;
  setState: (s: AppState) => void;
  setStatus: (s: KioskStatus) => void;
}

export const useApp = create<AppStore>((set) => ({
  ready: false,
  bootstrap: null,
  status: null,
  mediaBase: '',
  setState: (s) => set({ ready: true, bootstrap: s.bootstrap, status: s.status, mediaBase: s.mediaBase }),
  setStatus: (status) => set({ status }),
}));

type SessionPatch = Partial<Pick<SessionStore, 'flow' | 'planId' | 'mobile' | 'order' | 'payment' | 'access' | 'inquiredOnce'>>;

interface SessionStore {
  stack: Route[];
  flow: OrderKind | null;
  /** serviceId → quantity (insertion order kept). */
  cart: Array<{ serviceId: string; quantity: number }>;
  planId: string | null;
  mobile: string;
  order: LocalOrderView | null;
  payment: PaymentOutcomeView | null;
  access: ValidateAccessResponse | null;
  inquiredOnce: boolean;
  toast: string | null;
  /** `patch`: session data that changes together with the screen (applied in the same transition). */
  go: (id: ScreenId, params?: Record<string, string>, patch?: SessionPatch) => void;
  replace: (id: ScreenId, params?: Record<string, string>) => void;
  back: () => void;
  backTo: (id: ScreenId, patch?: SessionPatch) => void;
  reset: () => void;
  /** Bumped by every reset: async results that belong to an earlier session are dropped. */
  epoch: number;
  /** A no-timeout screen (paying, printing) shows an error, so the inactivity timeout applies again. */
  idleTimeoutAllowed: boolean;
  addToCart: (serviceId: string) => void;
  setQty: (serviceId: string, quantity: number) => void;
  removeFromCart: (serviceId: string) => void;
  removeMany: (ids: string[]) => void;
  set: (patch: SessionPatch) => void;
  showToast: (msg: string) => void;
}

const initial = {
  stack: [{ id: 'welcome' as ScreenId }],
  flow: null,
  cart: [],
  planId: null,
  mobile: '',
  order: null,
  payment: null,
  access: null,
  inquiredOnce: false,
  toast: null,
  idleTimeoutAllowed: false,
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useSession = create<SessionStore>((set, get) => {
  const top = () => get().stack[get().stack.length - 1].id;
  // A change of screen clears the toast that was showing when it was asked for, not one shown right
  // after it (the change itself may apply a frame later, inside the transition).
  const leftToast = (shown: string | null) => (get().toast === shown ? null : get().toast);
  return {
    ...initial,
    epoch: 0,
    go: (id, params, patch) => {
      const shown = get().toast;
      transition('forward', top(), id, () => set((s) => ({ ...patch, stack: [...s.stack, { id, params }], toast: leftToast(shown) })));
    },
    replace: (id, params) => {
      const shown = get().toast;
      transition('forward', top(), id, () => set((s) => ({ stack: [...s.stack.slice(0, -1), { id, params }], toast: leftToast(shown) })));
    },
    back: () => {
      const { stack, toast: shown } = get();
      if (stack.length < 2) return;
      transition('back', top(), stack[stack.length - 2].id, () =>
        set((s) => ({ stack: s.stack.length > 1 ? s.stack.slice(0, -1) : s.stack, toast: leftToast(shown) })),
      );
    },
    backTo: (id, patch) => {
      const shown = get().toast;
      transition('back', top(), id, () =>
        set((s) => {
          const idx = s.stack.map((r) => r.id).lastIndexOf(id);
          return { ...patch, stack: idx >= 0 ? s.stack.slice(0, idx + 1) : [...s.stack, { id }], toast: leftToast(shown) };
        }),
      );
    },
    reset: () => {
      clearTimeout(toastTimer);
      const shown = get().toast;
      // At once, not with the screen: from here on, late results of this session are dropped.
      set((s) => ({ epoch: s.epoch + 1 }));
      transition('back', top(), 'welcome', () => set({ ...initial, stack: [{ id: 'welcome' }], toast: leftToast(shown) }));
    },
    addToCart: (serviceId) =>
      set((s) => (s.cart.some((c) => c.serviceId === serviceId) ? s : { cart: [...s.cart, { serviceId, quantity: 1 }] })),
    setQty: (serviceId, quantity) =>
      set((s) => ({ cart: s.cart.map((c) => (c.serviceId === serviceId ? { ...c, quantity } : c)) })),
    removeFromCart: (serviceId) => set((s) => ({ cart: s.cart.filter((c) => c.serviceId !== serviceId) })),
    removeMany: (ids) => set((s) => ({ cart: s.cart.filter((c) => !ids.includes(c.serviceId)) })),
    set: (patch) => set(patch),
    showToast: (toast) => {
      clearTimeout(toastTimer);
      set({ toast });
      toastTimer = setTimeout(() => get().toast === toast && set({ toast: null }), 2200);
    },
  };
});

/** Captures the current session; `alive()` is false once it has ended (timeout, cancel, finish). */
export function sessionGuard() {
  const epoch = useSession.getState().epoch;
  return { alive: () => useSession.getState().epoch === epoch };
}

/** Lets the inactivity timeout run on a no-timeout screen while `allowed` (e.g. an error is shown). */
export function useAllowIdleTimeout(allowed: boolean) {
  useEffect(() => {
    if (!allowed) return;
    useSession.setState({ idleTimeoutAllowed: true });
    return () => useSession.setState({ idleTimeoutAllowed: false });
  }, [allowed]);
}

// ------------------------------------------------------------------ catalogue helpers

export interface ServiceRef {
  service: ServiceDto;
  sub: SubcategoryDto;
  category: CategoryDto;
}

export function indexServices(b: Bootstrap | null): Map<string, ServiceRef> {
  const map = new Map<string, ServiceRef>();
  for (const category of b?.categories ?? []) {
    for (const sub of category.subcategories) for (const service of sub.services) map.set(service.id, { service, sub, category });
  }
  return map;
}

export function toPricingItem(ref: ServiceRef, quantity = 1): PricingItem {
  return {
    itemType: ItemType.SERVICE,
    itemId: ref.service.id,
    code: ref.service.code,
    title: ref.service.title,
    unit: ref.service.unit,
    unitPrice: ref.service.price,
    quantity,
    categoryId: ref.category.id,
    categoryTitle: ref.category.title,
    subcategoryId: ref.sub.id,
  };
}

export function servicePrice(b: Bootstrap, ref: ServiceRef) {
  return previewUnitPrice(toPricingItem(ref), b.discounts, new Date(), b.settings.discountPolicy);
}

export function planPrice(b: Bootstrap, plan: PlanDto) {
  return previewUnitPrice(
    { itemType: ItemType.PLAN, itemId: plan.id, code: plan.code, title: plan.title, unit: 'اشتراک', unitPrice: plan.price },
    b.discounts,
    new Date(),
    b.settings.discountPolicy,
  );
}

/** Client-side cart preview; the authoritative lock happens on the server at the review step. */
export function cartPreview(b: Bootstrap | null, cart: SessionStore['cart']) {
  const idx = indexServices(b);
  const items = cart.flatMap((c) => {
    const ref = idx.get(c.serviceId);
    return ref ? [toPricingItem(ref, c.quantity)] : [];
  });
  const missing = cart.filter((c) => !idx.has(c.serviceId)).map((c) => c.serviceId);
  if (!b) return { lines: [], subtotal: 0, discountTotal: 0, total: 0, missing, count: 0 };
  const priced = priceItems(items, b.discounts, new Date(), b.settings.discountPolicy);
  return { ...priced, missing, count: cart.reduce((s, c) => s + c.quantity, 0) };
}

/** Width in pixels of a cached image (null when unknown), to avoid stretching small thumbnails. */
export function mediaWidth(mediaId: string | null | undefined): number | null {
  const { bootstrap } = useApp.getState();
  return bootstrap?.media.find((x) => x.id === mediaId)?.width ?? null;
}

/** Width / height of a cached image (null when unknown), so a row can take the photo's proportions. */
export function mediaRatio(mediaId: string | null | undefined): number | null {
  const m = useApp.getState().bootstrap?.media.find((x) => x.id === mediaId);
  return m?.width && m.height ? m.width / m.height : null;
}

/** Why a kiosk cannot sell right now: no catalogue yet, no server (and no offline sales), or no card reader. */
export type SalesBlock = 'catalog' | 'offline' | 'pos';

/**
 * What the customer may do now. Looking at services, prices and plans needs only the catalogue;
 * buying also needs sales (a card reader set up, and the server or offline sales). So a kiosk whose
 * card reader is not connected yet still shows everything, and only buying waits. The public web
 * app only looks.
 */
export function useShop() {
  const hasCatalog = useApp((s) => !!s.bootstrap);
  const hasPlans = useApp((s) => !!s.bootstrap?.plans.length);
  const browseOnly = useApp((s) => !!s.status?.browseOnly);
  const online = useApp((s) => !!s.status?.online);
  const salesAvailable = useApp((s) => !!s.status?.salesAvailable);
  const subscriptionSalesAvailable = useApp((s) => !!s.status?.subscriptionSalesAvailable);
  const canBuy = !browseOnly && salesAvailable;
  const blocked: SalesBlock | null = browseOnly || canBuy ? null : !hasCatalog ? 'catalog' : !online ? 'offline' : 'pos';
  return { hasCatalog, hasPlans, browseOnly, canBuy, canBuyPlans: !browseOnly && subscriptionSalesAvailable, blocked };
}

/** Web/Android target: cached images are object URLs held by the in-page core. */
let mediaResolver: ((checksum: string) => string | null) | null = null;
export function setMediaResolver(fn: (checksum: string) => string | null) {
  mediaResolver = fn;
}

export function mediaUrl(mediaId: string | null | undefined): string | null {
  const { bootstrap, mediaBase } = useApp.getState();
  if (!mediaId || !bootstrap) return null;
  const m = bootstrap.media.find((x) => x.id === mediaId);
  if (!m) return null;
  return mediaResolver ? mediaResolver(m.checksum) : `${mediaBase}/${m.checksum}`;
}
