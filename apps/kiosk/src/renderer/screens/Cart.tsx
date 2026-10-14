import { useEffect } from 'react';
import { formatToman, toPersianDigits } from '@andishkadeh/shared';
import { Icon } from '../components/Icon';
import { Notice, Screen, Stepper } from '../components/ui';
import { cartPreview, indexServices, useApp, useSession } from '../store';

/** K09 — multi-service cart (services from different domains, one payment). */
export function Cart() {
  const bootstrap = useApp((s) => s.bootstrap);
  const { cart, setQty, removeFromCart, removeMany, backTo, go, set, showToast } = useSession();
  const idx = indexServices(bootstrap);
  const p = cartPreview(bootstrap, cart);
  const max = bootstrap?.settings.maxItemQuantity ?? 5;

  // Items that disappeared from the catalogue (deactivated/price removed) leave the cart.
  useEffect(() => {
    if (p.missing.length) {
      removeMany(p.missing);
      showToast('برخی خدمات دیگر در دسترس نیستند و از سبد حذف شدند');
    }
  }, [p.missing.join(',')]);

  return (
    <Screen
      title="سبد خرید"
      subtitle={cart.length ? `${toPersianDigits(p.count)} خدمت انتخاب شده` : undefined}
      footer={
        <div className="stack" style={{ gap: 20 }}>
          <div className="footer-row">
            <button className="btn btn-ghost" onClick={() => backTo('categories')} data-testid="add-more">
              <Icon name="plus" />
              افزودن خدمت دیگر
            </button>
            <button
              className="btn btn-primary"
              disabled={cart.length === 0}
              onClick={() => {
                set({ flow: 'SERVICES' as never });
                go('mobile');
              }}
              data-testid="checkout"
            >
              ادامه و ثبت موبایل
              <Icon name="chevron" />
            </button>
          </div>
        </div>
      }
    >
      {cart.length === 0 ? (
        <div className="empty">
          <Icon name="cart" />
          سبد خرید شما خالی است.
          <button className="btn btn-ghost" onClick={() => backTo('categories')}>
            انتخاب خدمت
          </button>
        </div>
      ) : (
        <>
          <div className="stack">
            {cart.map((c, i) => {
              const ref = idx.get(c.serviceId);
              const line = p.lines.find((l) => l.itemId === c.serviceId);
              if (!ref || !line) return null;
              return (
                <div key={c.serviceId} className="card cart-item enter" data-theme={ref.category.theme} style={{ ['--i' as string]: i }} data-testid={`cart-${ref.service.code}`}>
                  <div className="info">
                    <h3>{ref.service.title}</h3>
                    <div className="sub">
                      <span className="code-chip">{ref.service.code}</span> · {ref.category.title} · {formatToman(line.unitPrice - line.unitDiscount)} / {ref.service.unit}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 28, fontWeight: 800 }} data-testid={`line-${ref.service.code}`}>{formatToman(line.lineTotal)}</div>
                  </div>
                  <Stepper value={c.quantity} max={max} onChange={(v) => setQty(c.serviceId, v)} />
                  <button className="remove-btn" onClick={() => removeFromCart(c.serviceId)} aria-label="حذف از سبد" data-testid={`remove-${ref.service.code}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="panel" style={{ marginTop: 32 }}>
            <div className="kv">
              <span className="k">جمع</span>
              <span className="v">{formatToman(p.subtotal)}</span>
            </div>
            {p.discountTotal > 0 && (
              <div className="kv discount">
                <span className="k">تخفیف</span>
                <span className="v">− {formatToman(p.discountTotal)}</span>
              </div>
            )}
            <div className="kv total">
              <span className="k">مبلغ قابل پرداخت</span>
              <span className="v" data-testid="cart-total">
                {formatToman(p.total)}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 24 }}>
            <Notice tone="blue" icon="shield">
              مبلغ نهایی در مرحله تأیید با قیمت‌های روز مرکز قفل می‌شود و پس از آن تغییر نمی‌کند.
            </Notice>
          </div>
        </>
      )}
    </Screen>
  );
}
