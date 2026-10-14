import type { Order, OrderItem, PaymentAttempt, Subscription } from '@prisma/client';
import {
  ItemType,
  OrderDto,
  OrderKind,
  OrderStatus,
  PaymentResultSource,
  PaymentRow,
  PaymentStatus,
  maskMobile,
} from '@andishkadeh/shared';

export type OrderWithItems = Order & {
  items: OrderItem[];
  customer: { mobile: string };
  subscription?: Subscription | null;
};

export function toOrderDto(o: OrderWithItems): OrderDto {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    localId: o.localId,
    kind: o.kind as OrderKind,
    status: o.status as OrderStatus,
    mobileMasked: maskMobile(o.customer.mobile),
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    total: o.total,
    offline: o.offline,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    items: [...o.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        itemType: i.itemType as ItemType,
        itemId: i.itemId,
        code: i.codeSnapshot,
        title: i.titleSnapshot,
        unit: i.unitSnapshot,
        categoryTitle: i.categoryTitleSnapshot,
        unitPrice: i.unitPriceSnapshot,
        quantity: i.quantity,
        unitDiscount: i.unitDiscountSnapshot,
        discountTitle: i.discountTitleSnapshot,
        lineTotal: i.lineTotal,
      })),
    subscription: o.subscription
      ? {
          id: o.subscription.id,
          planTitle: o.subscription.planTitle,
          startsAt: o.subscription.startsAt.toISOString(),
          expiresAt: o.subscription.expiresAt.toISOString(),
          extended: o.subscription.extended,
        }
      : null,
  };
}

export function toPaymentRow(
  p: PaymentAttempt & { order: { orderNumber: string; deviceId: string } },
  reconciledBy: string | null = null,
): PaymentRow {
  return {
    id: p.id,
    orderId: p.orderId,
    orderNumber: p.order.orderNumber,
    deviceId: p.order.deviceId,
    amount: p.amount,
    status: p.status as PaymentStatus,
    terminalRef: p.terminalRef,
    rrn: p.rrn,
    source: (p.resultSource as PaymentResultSource | null) ?? null,
    message: p.resultMessage,
    initiatedAt: p.initiatedAt.toISOString(),
    resolvedAt: p.resolvedAt?.toISOString() ?? null,
    reconcileReason: p.reconcileReason,
    reconciledBy,
  };
}
