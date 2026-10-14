import { describe, expect, it } from 'vitest';
import { DiscountPolicy, DiscountTargetType, DiscountType, ItemType } from './enums';
import { PricingDiscount, PricingItem, priceItems, priceLine, unitDiscountAmount } from './pricing';

const now = new Date('2026-10-14T10:00:00Z');

const item = (over: Partial<PricingItem> = {}): PricingItem => ({
  itemType: ItemType.SERVICE,
  itemId: 'svc-p102',
  code: 'P-102',
  title: 'InBody',
  unit: 'نفر',
  unitPrice: 1_200_000,
  quantity: 1,
  categoryId: 'cat-p',
  subcategoryId: 'sub-p1',
  ...over,
});

const discount = (over: Partial<PricingDiscount> = {}): PricingDiscount => ({
  id: 'd1',
  title: 'تخفیف',
  type: DiscountType.PERCENT,
  value: 10,
  priority: 100,
  active: true,
  startsAt: null,
  endsAt: null,
  targets: [{ targetType: DiscountTargetType.SERVICE, targetId: 'svc-p102' }],
  ...over,
});

describe('unitDiscountAmount', () => {
  it('floors percentage discounts to whole Toman', () => {
    expect(unitDiscountAmount(discount({ value: 7 }), 1_234_567)).toBe(86_419);
  });
  it('never exceeds the unit price', () => {
    expect(unitDiscountAmount(discount({ type: DiscountType.FIXED, value: 5_000_000 }), 700_000)).toBe(700_000);
    expect(unitDiscountAmount(discount({ value: 150 }), 700_000)).toBe(700_000);
  });
});

describe('priceLine', () => {
  it('applies a service discount and multiplies by quantity', () => {
    const line = priceLine(item({ quantity: 2 }), [discount()], now);
    expect(line.unitDiscount).toBe(120_000);
    expect(line.lineSubtotal).toBe(2_400_000);
    expect(line.lineDiscount).toBe(240_000);
    expect(line.lineTotal).toBe(2_160_000);
    expect(line.discountId).toBe('d1');
  });

  it('matches category and subcategory targets', () => {
    const cat = discount({ id: 'c', targets: [{ targetType: DiscountTargetType.CATEGORY, targetId: 'cat-p' }] });
    const sub = discount({ id: 's', targets: [{ targetType: DiscountTargetType.SUBCATEGORY, targetId: 'sub-p1' }] });
    expect(priceLine(item(), [cat], now).discountId).toBe('c');
    expect(priceLine(item(), [sub], now).discountId).toBe('s');
    expect(priceLine(item({ categoryId: 'other', subcategoryId: 'x' }), [cat, sub], now).discountId).toBeNull();
  });

  it('does not apply plan discounts to services and vice versa', () => {
    const plan = discount({ targets: [{ targetType: DiscountTargetType.PLAN, targetId: 'svc-p102' }] });
    expect(priceLine(item(), [plan], now).discountId).toBeNull();
    const planItem = item({ itemType: ItemType.PLAN, itemId: 'plan-3', categoryId: null, subcategoryId: null });
    const planDiscount = discount({ targets: [{ targetType: DiscountTargetType.PLAN, targetId: 'plan-3' }] });
    expect(priceLine(planItem, [planDiscount], now).unitDiscount).toBe(120_000);
  });

  it('ignores inactive and out-of-window discounts', () => {
    expect(priceLine(item(), [discount({ active: false })], now).discountId).toBeNull();
    expect(priceLine(item(), [discount({ startsAt: '2026-10-15T00:00:00Z' })], now).discountId).toBeNull();
    expect(priceLine(item(), [discount({ endsAt: '2026-10-14T10:00:00Z' })], now).discountId).toBeNull();
    expect(priceLine(item(), [discount({ endsAt: '2026-10-14T10:00:01Z' })], now).discountId).toBe('d1');
  });

  it('BEST policy picks the largest discount', () => {
    const small = discount({ id: 'a', value: 5, priority: 1 });
    const big = discount({ id: 'b', type: DiscountType.FIXED, value: 300_000, priority: 50 });
    const line = priceLine(item(), [small, big], now, DiscountPolicy.BEST);
    expect(line.discountId).toBe('b');
    expect(line.lineTotal).toBe(900_000);
  });

  it('PRIORITY policy picks the lowest priority number', () => {
    const small = discount({ id: 'a', value: 5, priority: 1 });
    const big = discount({ id: 'b', type: DiscountType.FIXED, value: 300_000, priority: 50 });
    expect(priceLine(item(), [small, big], now, DiscountPolicy.PRIORITY).discountId).toBe('a');
  });

  it('rejects float prices and invalid quantities', () => {
    expect(() => priceLine(item({ unitPrice: 100.5 }), [], now)).toThrow();
    expect(() => priceLine(item({ quantity: 0 }), [], now)).toThrow();
  });
});

describe('priceItems', () => {
  it('sums a multi-domain cart (T01) and recomputes after removal (T02)', () => {
    const items = [
      item(),
      item({ itemId: 'n101', code: 'N-101', unitPrice: 1_000_000, categoryId: 'cat-n', subcategoryId: 'sub-n1' }),
      item({ itemId: 'ps101', code: 'PS-101', unitPrice: 1_000_000, categoryId: 'cat-ps', subcategoryId: 'sub-ps1' }),
    ];
    const cart = priceItems(items, [discount()], now);
    expect(cart.subtotal).toBe(3_200_000);
    expect(cart.discountTotal).toBe(120_000);
    expect(cart.total).toBe(3_080_000);
    const after = priceItems(items.slice(1), [discount()], now);
    expect(after.total).toBe(2_000_000);
  });
});
