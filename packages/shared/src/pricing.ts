/**
 * Pricing engine — the single implementation used by the kiosk (preview / offline lock)
 * and by the server (authoritative lock). All values are integer Toman.
 *
 * Rules (PRD §12):
 *  - a discount may target a service, a subcategory, a category or a plan;
 *  - discounts are evaluated per unit price, never making a price negative;
 *  - overlapping discounts are resolved by the configured policy (default BEST = largest wins);
 *  - only one discount applies per line.
 */
import { DiscountPolicy, DiscountTargetType, DiscountType, ItemType } from './enums';
import { assertMoney } from './format';

export interface PricingDiscount {
  id: string;
  title: string;
  type: DiscountType;
  /** PERCENT: 1..100, FIXED: Toman per unit. */
  value: number;
  /** Lower number = higher priority (used by the PRIORITY policy). */
  priority: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  targets: Array<{ targetType: DiscountTargetType; targetId: string }>;
}

export interface PricingItem {
  itemType: ItemType;
  itemId: string;
  code: string;
  title: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  categoryId?: string | null;
  categoryTitle?: string | null;
  subcategoryId?: string | null;
}

export interface PricedLine extends PricingItem {
  discountId: string | null;
  discountTitle: string | null;
  unitDiscount: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTotal: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
}

export function isDiscountLive(d: PricingDiscount, now: Date): boolean {
  if (!d.active) return false;
  const t = now.getTime();
  if (d.startsAt && new Date(d.startsAt).getTime() > t) return false;
  if (d.endsAt && new Date(d.endsAt).getTime() <= t) return false;
  return true;
}

export function discountTargetsItem(d: PricingDiscount, item: PricingItem): boolean {
  return d.targets.some((t) => {
    switch (t.targetType) {
      case DiscountTargetType.SERVICE:
        return item.itemType === ItemType.SERVICE && t.targetId === item.itemId;
      case DiscountTargetType.SUBCATEGORY:
        return item.itemType === ItemType.SERVICE && !!item.subcategoryId && t.targetId === item.subcategoryId;
      case DiscountTargetType.CATEGORY:
        return item.itemType === ItemType.SERVICE && !!item.categoryId && t.targetId === item.categoryId;
      case DiscountTargetType.PLAN:
        return item.itemType === ItemType.PLAN && t.targetId === item.itemId;
      default:
        return false;
    }
  });
}

/** Discount amount for one unit; clamped to [0, unitPrice]. */
export function unitDiscountAmount(d: PricingDiscount, unitPrice: number): number {
  let amount: number;
  if (d.type === DiscountType.PERCENT) {
    const pct = Math.min(Math.max(Math.trunc(d.value), 0), 100);
    amount = Math.floor((unitPrice * pct) / 100);
  } else {
    amount = Math.max(Math.trunc(d.value), 0);
  }
  return Math.min(amount, unitPrice);
}

export function pickDiscount(
  candidates: PricingDiscount[],
  unitPrice: number,
  policy: DiscountPolicy,
): { discount: PricingDiscount; amount: number } | null {
  let best: { discount: PricingDiscount; amount: number } | null = null;
  for (const d of candidates) {
    const amount = unitDiscountAmount(d, unitPrice);
    if (amount <= 0) continue;
    if (!best) {
      best = { discount: d, amount };
      continue;
    }
    if (policy === DiscountPolicy.PRIORITY) {
      if (
        d.priority < best.discount.priority ||
        (d.priority === best.discount.priority && amount > best.amount)
      ) {
        best = { discount: d, amount };
      }
    } else if (amount > best.amount || (amount === best.amount && d.id < best.discount.id)) {
      // BEST; deterministic tie-break by id so kiosk and server always agree.
      best = { discount: d, amount };
    }
  }
  return best;
}

export function priceLine(
  item: PricingItem,
  discounts: PricingDiscount[],
  now: Date,
  policy: DiscountPolicy = DiscountPolicy.BEST,
): PricedLine {
  assertMoney(item.unitPrice, `unitPrice of ${item.code}`);
  if (!Number.isInteger(item.quantity) || item.quantity < 1) {
    throw new RangeError(`quantity of ${item.code} must be a positive integer`);
  }
  const candidates = discounts.filter((d) => isDiscountLive(d, now) && discountTargetsItem(d, item));
  const picked = pickDiscount(candidates, item.unitPrice, policy);
  const unitDiscount = picked?.amount ?? 0;
  const lineSubtotal = item.unitPrice * item.quantity;
  const lineDiscount = unitDiscount * item.quantity;
  return {
    ...item,
    discountId: picked?.discount.id ?? null,
    discountTitle: picked?.discount.title ?? null,
    unitDiscount,
    lineSubtotal,
    lineDiscount,
    lineTotal: lineSubtotal - lineDiscount,
  };
}

export function priceItems(
  items: PricingItem[],
  discounts: PricingDiscount[],
  now: Date,
  policy: DiscountPolicy = DiscountPolicy.BEST,
): PricedCart {
  const lines = items.map((i) => priceLine(i, discounts, now, policy));
  const subtotal = lines.reduce((s, l) => s + l.lineSubtotal, 0);
  const discountTotal = lines.reduce((s, l) => s + l.lineDiscount, 0);
  return { lines, subtotal, discountTotal, total: subtotal - discountTotal };
}

/** Final unit price of a single item (used for catalogue cards: strike-through + final price). */
export function previewUnitPrice(
  item: Omit<PricingItem, 'quantity'>,
  discounts: PricingDiscount[],
  now: Date,
  policy: DiscountPolicy = DiscountPolicy.BEST,
): { unitPrice: number; finalPrice: number; discountTitle: string | null } {
  const line = priceLine({ ...item, quantity: 1 }, discounts, now, policy);
  return { unitPrice: line.unitPrice, finalPrice: line.lineTotal, discountTitle: line.discountTitle };
}
