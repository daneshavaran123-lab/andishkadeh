/**
 * UI state. `app` = data from the kiosk core (catalogue, status). `session` = one customer's
 * journey; it is wiped completely on finish, cancel or inactivity timeout (PRD §12, B-02).
 */
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
  go: (id: ScreenId, params?: Record<string, string>) => void;
  replace: (id: ScreenId, params?: Record<string, string>) => void;
  back: () => void;
  backTo: (id: ScreenId) => void;
  reset: () => void;
  addToCart: (serviceId: string) => void;
  setQty: (serviceId: string, quantity: number) => void;
  removeFromCart: (serviceId: string) => void;
  removeMany: (ids: string[]) => void;
  set: (patch: Partial<Pick<SessionStore, 'flow' | 'planId' | 'mobile' | 'order' | 'payment' | 'access' | 'inquiredOnce'>>) => void;
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
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useSession = create<SessionStore>((set, get) => ({
  ...initial,
  go: (id, params) => set((s) => ({ stack: [...s.stack, { id, params }], toast: null })),
  replace: (id, params) => set((s) => ({ stack: [...s.stack.slice(0, -1), { id, params }], toast: null })),
  back: () => set((s) => ({ stack: s.stack.length > 1 ? s.stack.slice(0, -1) : s.stack, toast: null })),
  backTo: (id) =>
    set((s) => {
      const idx = s.stack.map((r) => r.id).lastIndexOf(id);
      return { stack: idx >= 0 ? s.stack.slice(0, idx + 1) : [...s.stack, { id }], toast: null };
    }),
  reset: () => {
    clearTimeout(toastTimer);
    set({ ...initial, stack: [{ id: 'welcome' }] });
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
}));

export const currentRoute = () => {
  const s = useSession.getState().stack;
  return s[s.length - 1];
};

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

export function mediaUrl(mediaId: string | null | undefined): string | null {
  const { bootstrap, mediaBase } = useApp.getState();
  if (!mediaId || !bootstrap) return null;
  const m = bootstrap.media.find((x) => x.id === mediaId);
  return m ? `${mediaBase}/${m.checksum}` : null;
}
