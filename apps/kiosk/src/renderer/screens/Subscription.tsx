import { OrderKind, RenewalPolicy, formatJalaliLong, formatNumberFa, formatToman, toPersianDigits } from '@andishkadeh/shared';
import { CATEGORY_ICON, Icon } from '../components/Icon';
import { BuyAtKioskNotice, NoSalesNotice, Notice, Price, QrCode, Screen } from '../components/ui';
import { mediaUrl, planPrice, useApp, useSession, useShop } from '../store';
import { Missing } from './Catalog';

/** K11 — full subscription intro (texts from admin content). No reservation features. */
export function SubscriptionIntro() {
  const bootstrap = useApp((s) => s.bootstrap);
  const { hasPlans, browseOnly, canBuy, canBuyPlans, blocked } = useShop();
  const go = useSession((s) => s.go);
  const intro = bootstrap?.content.subscriptionIntro;
  const covered = bootstrap?.categories.filter((c) => c.subscriptionCovered) ?? [];
  return (
    <Screen
      title={intro?.title ?? 'اشتراک کامل'}
      subtitle={intro?.subtitle}
      theme="red"
      footer={
        <button
          className="btn btn-accent btn-block"
          disabled={!hasPlans}
          onClick={() => go('plans')}
          data-testid="choose-plan"
        >
          {canBuyPlans ? 'انتخاب پلن اشتراک' : 'مشاهده پلن‌های اشتراک'}
          <Icon name="chevron" />
        </button>
      }
    >
      <div className="card" data-theme="red" style={{ padding: 48, marginBottom: 32 }}>
        <span className="icon-ring" style={{ marginBottom: 24 }}>
          <Icon name="crown" />
        </span>
        <ul className="check-list" style={{ marginBottom: 0 }}>
          {(intro?.benefits ?? []).map((b) => (
            <li key={b}>
              <Icon name="check" />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <h2 className="section-title">حوزه‌های تحت پوشش</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {covered.map((c) => (
          <span key={c.id} className="badge" data-theme={c.theme} style={{ fontSize: 24, padding: '12px 24px' }}>
            {c.title}
          </span>
        ))}
      </div>
      {browseOnly ? (
        <div style={{ marginTop: 32 }}>
          <BuyAtKioskNotice />
        </div>
      ) : blocked ? (
        <div style={{ marginTop: 32 }}>
          <NoSalesNotice reason={blocked} />
        </div>
      ) : (
        canBuy &&
        !canBuyPlans && (
          <div style={{ marginTop: 32 }}>
            <Notice tone="amber" icon="wifiOff">
              خرید اشتراک در حال حاضر امکان‌پذیر نیست؛ لطفاً کمی بعد دوباره تلاش کنید یا به پذیرش مراجعه کنید.
            </Notice>
          </div>
        )
      )}
    </Screen>
  );
}

/** Colours of the plan cards in their order, like the visual design: blue, red, steel, purple. */
const PLAN_COLORS = ['var(--blue)', 'var(--red)', '#6f8fc8', 'var(--purple)'];

/**
 * K12 — plans (1/3/6/12 months) as photo cards: the plan's photo behind its number of months and
 * title, the domains the subscription covers, and the price row. Inactive plans never reach the kiosk.
 */
export function Plans() {
  const bootstrap = useApp((s) => s.bootstrap);
  const { go, set } = useSession();
  if (!bootstrap) return <Missing />;
  const covered = bootstrap.categories.filter((c) => c.subscriptionCovered);
  return (
    <Screen title="پلن‌های اشتراک" subtitle="مدت اعتبار مورد نظر را انتخاب کنید" theme="red">
      <div className="plan-grid">
        {bootstrap.plans.map((plan, i) => {
          const p = planPrice(bootstrap, plan);
          const photo = mediaUrl(plan.mediaId);
          return (
            <button
              key={plan.id}
              className={`card plan-card enter${photo ? ' has-photo' : ''}`}
              style={{ ['--i' as string]: i, ['--theme' as string]: PLAN_COLORS[i % PLAN_COLORS.length] }}
              onClick={() => {
                set({ planId: plan.id, flow: OrderKind.SUBSCRIPTION });
                go('planDetail', { planId: plan.id });
              }}
              data-testid={`plan-${plan.durationMonths}`}
            >
              {photo && <span className="plan-photo" style={{ backgroundImage: `url("${photo}")` }} />}
              <span className="plan-head">
                {plan.badge && (
                  <span className="plan-badge">
                    <Icon name="crown" />
                    {plan.badge}
                  </span>
                )}
                <span className="months">
                  {toPersianDigits(plan.durationMonths)}
                  <small>ماه</small>
                </span>
                <span className="plan-title">{plan.title}</span>
                <span className="plan-rule" />
              </span>
              {covered.length > 0 && (
                <span className="plan-features">
                  <small>دسترسی کامل به</small>
                  {covered.map((c) => (
                    <span key={c.id}>
                      <Icon name={CATEGORY_ICON[c.theme]} />
                      {c.title.replace(/^مرکز\s+/, '')}
                    </span>
                  ))}
                </span>
              )}
              <span className="plan-price">
                <span className="chevron-circle">
                  <Icon name="chevron" />
                </span>
                <span className="plan-amount">
                  <span className="pp">
                    {p.finalPrice < p.unitPrice && <s>{formatNumberFa(p.unitPrice)}</s>}
                    {formatToman(p.finalPrice)}
                  </span>
                  <span className="per">معادل ماهانه {formatToman(Math.round(p.finalPrice / plan.durationMonths))}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {bootstrap.plans.length === 0 && (
        <div className="empty">
          <Icon name="alert" />
          در حال حاضر پلن فعالی وجود ندارد.
        </div>
      )}
    </Screen>
  );
}

/** K12D — plan detail and final price. */
export function PlanDetail({ planId }: { planId?: string }) {
  const bootstrap = useApp((s) => s.bootstrap);
  const { browseOnly, canBuyPlans, blocked } = useShop();
  const go = useSession((s) => s.go);
  const plan = bootstrap?.plans.find((p) => p.id === planId);
  if (!bootstrap || !plan) return <Missing />;
  const p = planPrice(bootstrap, plan);
  const covered = bootstrap.categories.filter((c) => c.subscriptionCovered);
  return (
    <Screen
      title={plan.title}
      subtitle="جزئیات پلن"
      theme="red"
      footer={
        browseOnly ? (
          <BuyAtKioskNotice />
        ) : !canBuyPlans ? (
          blocked ? (
            <NoSalesNotice reason={blocked} />
          ) : (
            <Notice tone="amber" icon="wifiOff">
              خرید اشتراک در حال حاضر امکان‌پذیر نیست؛ لطفاً کمی بعد دوباره تلاش کنید یا به پذیرش مراجعه کنید.
            </Notice>
          )
        ) : (
          <button className="btn btn-accent btn-block" onClick={() => go('mobile')} data-testid="plan-continue">
            ادامه — {formatToman(p.finalPrice)}
            <Icon name="chevron" />
          </button>
        )
      }
    >
      <div className="panel">
        <div className="kv">
          <span className="k">مدت اعتبار</span>
          <span className="v">
            {toPersianDigits(plan.durationMonths)} ماه ({toPersianDigits(plan.durationDays)} روز)
          </span>
        </div>
        <div className="kv">
          <span className="k">پوشش</span>
          <span className="v">{covered.map((c) => c.title).join('، ')}</span>
        </div>
        {p.discountTitle && (
          <div className="kv discount">
            <span className="k">تخفیف ({p.discountTitle})</span>
            <span className="v">− {formatToman(p.unitPrice - p.finalPrice)}</span>
          </div>
        )}
        <div className="kv total">
          <span className="k">مبلغ نهایی</span>
          <Price final={p.finalPrice} was={p.unitPrice} />
        </div>
      </div>
      {plan.description && <p className="prose" style={{ marginTop: 32 }}>{plan.description}</p>}
      {bootstrap.settings.renewalPolicy === RenewalPolicy.EXTEND_FROM_END && (
        <Notice tone="blue" icon="clock">
          اگر اشتراک فعال دارید، پس از ثبت شماره موبایل نمایش داده می‌شود و اعتبار جدید از پایان اشتراک فعلی شروع خواهد شد.
        </Notice>
      )}
    </Screen>
  );
}

/** K18 — subscription activated: validity and membership QR (only after a confirmed payment). */
export function Activation() {
  const { payment, go, replace } = useSession();
  const tz = useApp((s) => s.bootstrap?.settings.timezone);
  const order = payment?.order;
  if (!order || order.status !== 'PAID' || !order.subscription) return <Missing />;
  const sub = order.subscription;
  return (
    <Screen
      title={order.syncPending ? 'خرید اشتراک ثبت شد' : 'اشتراک شما فعال شد'}
      subtitle={sub.planTitle}
      onBack={null}
      actions={false}
      calm
      footer={
        <div className="footer-row">
          <button className="btn btn-ghost" onClick={() => replace('end')} data-testid="finish" style={{ flex: '0 0 260px' }}>
            پایان
          </button>
          <button className="btn btn-success" onClick={() => go('printing')} data-testid="print">
            <Icon name="printer" />
            چاپ رسید و کارت عضویت
          </button>
        </div>
      }
    >
      <div className="result" style={{ paddingTop: 0 }}>
        {order.qrToken ? <QrCode value={order.qrToken} /> : <Notice tone="amber">کد QR در دسترس نیست؛ لطفاً به پذیرش مراجعه کنید.</Notice>}
        <div className="panel" style={{ width: '100%' }}>
          <div className="kv">
            <span className="k">شروع اعتبار</span>
            <span className="v">{formatJalaliLong(sub.startsAt, tz)}</span>
          </div>
          <div className="kv">
            <span className="k">پایان اعتبار</span>
            <span className="v" data-testid="expires">{formatJalaliLong(sub.expiresAt, tz)}</span>
          </div>
          <div className="kv">
            <span className="k">شماره سفارش</span>
            <span className="v ltr">{order.orderNumber}</span>
          </div>
        </div>
        {sub.extended && <Notice tone="blue" icon="clock">این اشتراک پس از پایان اشتراک فعلی شما شروع می‌شود و تا آن زمان اشتراک قبلی معتبر است.</Notice>}
        {order.syncPending && (
          <Notice tone="amber" icon="wifiOff">
            پرداخت توسط کارتخوان تأیید شده و کارت عضویت صادر شد. تاریخ‌ها پس از همگام‌سازی با مرکز قطعی می‌شوند.
          </Notice>
        )}
        <Notice tone="green" icon="qr">
          این کد کارت عضویت شماست. رسید چاپی را نگه دارید یا از کد عکس بگیرید؛ برای بررسی اعتبار در کیوسک استفاده می‌شود.
        </Notice>
      </div>
    </Screen>
  );
}
