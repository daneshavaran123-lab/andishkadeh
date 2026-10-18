import { useMemo, useState } from 'react';
import { formatNumberFa, toPersianDigits, type CategoryDto } from '@andishkadeh/shared';
import { CATEGORY_ICON, Icon } from '../components/Icon';
import { BuyAtKioskNotice, CartBar, Modal, Notice, Price, Screen, SearchKeyboard, Stepper } from '../components/ui';
import { indexServices, mediaUrl, mediaWidth, servicePrice, useApp, useSession, type ServiceRef } from '../store';

function categoryById(id?: string): CategoryDto | undefined {
  return useApp.getState().bootstrap?.categories.find((c) => c.id === id);
}

function openCategory(c: CategoryDto) {
  const { go } = useSession.getState();
  if (!c.salesEnabled) return go('monitoring', { categoryId: c.id });
  const subs = c.subcategories.filter((s) => s.services.length > 0);
  if (subs.length === 1) return go('services', { categoryId: c.id, subId: subs[0].id });
  return go('subcategories', { categoryId: c.id });
}

/** K03 — choose a domain (four themed cards, reference image 2). */
export function Categories() {
  const bootstrap = useApp((s) => s.bootstrap);
  const cats = bootstrap?.categories ?? [];
  return (
    <Screen title="انتخاب حوزه" subtitle="می‌توانید از چند حوزه خدمت انتخاب کنید و یکجا پرداخت کنید" footer={<CartBar />}>
      <div className="cat-grid">
        {cats.map((c, i) => {
          const img = mediaUrl(c.mediaId);
          const count = c.subcategories.reduce((s, x) => s + x.services.length, 0);
          return (
            <button
              key={c.id}
              className="card cat-card enter"
              data-theme={c.theme}
              style={{ ['--i' as string]: i }}
              onClick={() => openCategory(c)}
              data-testid={`category-${c.code}`}
            >
              <div
                className="media"
                style={{
                  backgroundImage: img ? `url("${img}")` : `radial-gradient(circle at 70% 30%, color-mix(in srgb, var(--theme) 45%, transparent), transparent 70%)`,
                }}
              >
                <span className="icon-ring">
                  <Icon name={CATEGORY_ICON[c.theme] ?? 'run'} />
                </span>
              </div>
              <div className="content">
                <h2>{c.title}</h2>
                <p>{c.subtitle}</p>
                <div className="row">
                  {c.salesEnabled ? (
                    <span className="badge">{toPersianDigits(count)} خدمت</span>
                  ) : (
                    <span className="badge">در اشتراک کامل</span>
                  )}
                  <span className="chevron-circle">
                    <Icon name="chevron" />
                  </span>
                </div>
                <span className="accent-bar" />
              </div>
            </button>
          );
        })}
      </div>
      {cats.length === 0 && (
        <div className="empty">
          <Icon name="alert" />
          در حال حاضر حوزه‌ای برای فروش فعال نیست.
        </div>
      )}
    </Screen>
  );
}

/** K04 / K07 / K08 — subgroups of a domain. */
export function Subcategories({ categoryId }: { categoryId?: string }) {
  const c = categoryById(categoryId);
  const go = useSession((s) => s.go);
  if (!c) return <Missing />;
  const subs = c.subcategories.filter((s) => s.services.length > 0);
  return (
    <Screen title={c.title} subtitle={c.subtitle} theme={c.theme} footer={<CartBar />}>
      {c.theme === 'purple' && (
        <div style={{ marginBottom: 32 }}>
          <Notice tone="blue" icon="shield">
            خدمات این حوزه با هدف ارزیابی و ارتقای عملکرد ورزشی ارائه می‌شود و جایگزین تشخیص یا درمان پزشکی نیست.
          </Notice>
        </div>
      )}
      <div className="stack">
        {subs.map((s, i) => {
          const art = mediaUrl(s.mediaId);
          return (
            <button
              key={s.id}
              className={`card list-row enter${art ? ' has-art' : ''}`}
              style={{ ['--i' as string]: i }}
              onClick={() => go('services', { categoryId: c.id, subId: s.id })}
              data-testid={`sub-${s.code}`}
            >
              <span className="num">{toPersianDigits(i + 1)}</span>
              <span className="grow">
                <h3>{s.title}</h3>
                <p>{toPersianDigits(s.services.length)} خدمت{s.description ? ` — ${s.description}` : ''}</p>
              </span>
              {art ? (
                <span className="row-art" style={{ backgroundImage: `url("${art}")` }}>
                  <span className="chevron-circle">
                    <Icon name="chevron" />
                  </span>
                </span>
              ) : (
                <span className="chevron-circle">
                  <Icon name="chevron" />
                </span>
              )}
            </button>
          );
        })}
        {subs.length === 0 && (
          <div className="empty">
            <Icon name="alert" />
            در این حوزه فعلاً خدمت فعالی وجود ندارد.
          </div>
        )}
      </div>
    </Screen>
  );
}

/** K08M — monitoring: informational; covered by the full subscription in the base version. */
export function Monitoring({ categoryId }: { categoryId?: string }) {
  const c = categoryById(categoryId);
  const intro = useApp((s) => s.bootstrap?.content.monitoringIntro);
  const status = useApp((s) => s.status);
  const { go, set } = useSession();
  const img = mediaUrl(c?.mediaId);
  return (
    <Screen
      title={intro?.title ?? c?.title ?? 'مرکز مانیتورینگ'}
      subtitle={c?.subtitle}
      theme={c?.theme ?? 'cyan'}
      footer={
        <button
          className="btn btn-theme btn-block"
          disabled={!status?.subscriptionSalesAvailable && !status?.browseOnly}
          onClick={() => {
            set({ flow: 'SUBSCRIPTION' as never });
            go('subscriptionIntro');
          }}
        >
          <Icon name="crown" />
          آشنایی با اشتراک کامل
        </button>
      }
    >
      {img && <div className="detail-hero" style={{ backgroundImage: `url("${img}")` }} />}
      <p className="prose">{intro?.body ?? c?.description}</p>
      {!!intro?.modules.length && (
        <ul className="check-list">
          {intro.modules.map((m) => (
            <li key={m}>
              <Icon name="pulse" />
              {m}
            </li>
          ))}
        </ul>
      )}
      <Notice tone="blue" icon="crown">
        ماژول‌های مانیتورینگ در نسخه فعلی به‌صورت جداگانه فروخته نمی‌شوند و در اشتراک کامل پوشش داده می‌شوند.
      </Notice>
    </Screen>
  );
}

function ServiceRow({ refx, index }: { refx: ServiceRef; index: number }) {
  const bootstrap = useApp((s) => s.bootstrap)!;
  const browseOnly = useApp((s) => !!s.status?.browseOnly);
  const { cart, addToCart, go, showToast } = useSession();
  const inCart = cart.some((c) => c.serviceId === refx.service.id);
  const p = servicePrice(bootstrap, refx);
  const thumb = mediaUrl(refx.service.mediaId) ?? mediaUrl(refx.sub.mediaId) ?? mediaUrl(refx.category.mediaId);
  return (
    <div className={`card svc-card enter${inCart ? ' in-cart' : ''}`} data-theme={refx.category.theme} style={{ ['--i' as string]: Math.min(index, 8) }} data-testid={`svc-${refx.service.code}`}>
      <button
        style={{ display: 'flex', alignItems: 'center', gap: 24, flex: 1, minWidth: 0, textAlign: 'start' }}
        onClick={() => go('serviceDetail', { serviceId: refx.service.id })}
      >
        <span className="thumb" style={{ backgroundImage: thumb ? `url("${thumb}")` : undefined }} />
        <span className="info">
          <span className="meta">
            <span className="code-chip">{refx.service.code}</span>
            <span>{refx.sub.title}</span>
          </span>
          <h3>{refx.service.title}</h3>
          {p.discountTitle && <span className="badge" style={{ alignSelf: 'flex-start', ['--theme' as string]: 'var(--green)' }}>{p.discountTitle}</span>}
        </span>
        <Price final={p.finalPrice} was={p.unitPrice} unit={refx.service.unit} />
      </button>
      {!browseOnly && (
        <button
          className={`add-btn${inCart ? ' added' : ''}`}
          aria-label={inCart ? 'در سبد است — مشاهده سبد' : 'افزودن به سبد'}
          data-testid={`add-${refx.service.code}`}
          onClick={() => {
            if (inCart) return go('cart');
            addToCart(refx.service.id);
            showToast('به سبد خرید اضافه شد');
          }}
        >
          <Icon name={inCart ? 'check' : 'plus'} />
        </button>
      )}
    </div>
  );
}

/** K05 — services of a subgroup, with search across all sellable services. */
export function Services({ categoryId, subId }: { categoryId?: string; subId?: string }) {
  const bootstrap = useApp((s) => s.bootstrap);
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState(false);
  const c = categoryById(categoryId);
  const sub = c?.subcategories.find((s) => s.id === subId);
  const all = useMemo(() => [...indexServices(bootstrap).values()].filter((r) => r.category.salesEnabled), [bootstrap]);
  if (!c || !sub || !bootstrap) return <Missing />;

  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter((r) => r.service.title.toLowerCase().includes(q) || r.service.code.toLowerCase().includes(q))
    : all.filter((r) => r.sub.id === sub.id);

  return (
    <Screen title={sub.title} subtitle={c.title} theme={c.theme} footer={<CartBar />}>
      <button className="search" onClick={() => setTyping(true)} data-testid="search">
        <Icon name="search" />
        {query ? <span className="value">{query}</span> : <span>جست‌وجوی نام یا کد خدمت…</span>}
        {query && (
          <span
            role="button"
            style={{ marginInlineStart: 'auto' }}
            onClick={(e) => {
              e.stopPropagation();
              setQuery('');
            }}
          >
            <Icon name="close" />
          </span>
        )}
      </button>
      {q && <h2 className="section-title">نتایج جست‌وجو در همه خدمات ({toPersianDigits(list.length)})</h2>}
      <div className="stack">
        {list.map((r, i) => (
          <ServiceRow key={r.service.id} refx={r} index={i} />
        ))}
      </div>
      {list.length === 0 && (
        <div className="empty">
          <Icon name="search" />
          {q ? 'خدمتی با این عبارت پیدا نشد.' : 'در این گروه فعلاً خدمت فعالی وجود ندارد.'}
        </div>
      )}
      {typing && (
        <Modal onClose={() => setTyping(false)}>
          <h2>جست‌وجوی خدمت</h2>
          <div className="search" style={{ marginBottom: 24 }}>
            <Icon name="search" />
            <span className="value">{query || ' '}</span>
          </div>
          <SearchKeyboard value={query} onChange={setQuery} onDone={() => setTyping(false)} />
        </Modal>
      )}
    </Screen>
  );
}

/** K06 — service detail. Re-adding an item already in the cart is prevented. */
export function ServiceDetail({ serviceId }: { serviceId?: string }) {
  const bootstrap = useApp((s) => s.bootstrap);
  const browseOnly = useApp((s) => !!s.status?.browseOnly);
  const { cart, addToCart, setQty, go, showToast } = useSession();
  const ref = serviceId ? indexServices(bootstrap).get(serviceId) : undefined;
  if (!ref || !bootstrap) return <Missing />;
  const p = servicePrice(bootstrap, ref);
  const line = cart.find((c) => c.serviceId === ref.service.id);
  // A small service thumbnail is shown as a tile on the domain photo instead of being stretched.
  const ownImg = mediaUrl(ref.service.mediaId);
  const ownIsLarge = (mediaWidth(ref.service.mediaId) ?? 0) >= 600;
  const img = (ownIsLarge ? ownImg : null) ?? mediaUrl(ref.category.mediaId) ?? ownImg;
  const tile = ownImg && !ownIsLarge && img !== ownImg ? ownImg : null;
  const max = bootstrap.settings.maxItemQuantity;

  return (
    <Screen
      title="جزئیات خدمت"
      subtitle={`${ref.category.title} / ${ref.sub.title}`}
      theme={ref.category.theme}
      footer={
        browseOnly ? (
          <BuyAtKioskNotice />
        ) : line ? (
          <div className="footer-row">
            <Stepper value={line.quantity} max={max} onChange={(v) => setQty(ref.service.id, v)} />
            <button className="btn btn-primary" onClick={() => go('cart')} data-testid="go-cart">
              <Icon name="cart" />
              مشاهده سبد خرید
            </button>
          </div>
        ) : (
          <button
            className="btn btn-theme btn-block"
            data-testid="detail-add"
            onClick={() => {
              addToCart(ref.service.id);
              showToast('به سبد خرید اضافه شد');
            }}
          >
            <Icon name="plus" />
            افزودن به سبد — {formatNumberFa(p.finalPrice)} تومان
          </button>
        )
      }
    >
      <div
        className="detail-hero"
        style={{ backgroundImage: img ? `url("${img}")` : `radial-gradient(circle at 70% 30%, color-mix(in srgb, var(--theme) 40%, transparent), transparent 70%)` }}
      >
        {tile && <span className="detail-tile" style={{ backgroundImage: `url("${tile}")` }} />}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
        <span className="code-chip">{ref.service.code}</span>
        {line && <span className="badge" style={{ ['--theme' as string]: 'var(--green)' }}>در سبد خرید شماست</span>}
      </div>
      <h2 className="detail-title">{ref.service.title}</h2>
      {ref.service.description && <p className="prose">{ref.service.description}</p>}
      {ref.service.includes.length > 0 && (
        <>
          <h3 className="section-title">موارد شامل</h3>
          <ul className="check-list">
            {ref.service.includes.map((x) => (
              <li key={x}>
                <Icon name="check" />
                {x}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="panel">
        <div className="kv">
          <span className="k">واحد</span>
          <span className="v">{ref.service.unit}</span>
        </div>
        {p.discountTitle && (
          <div className="kv discount">
            <span className="k">تخفیف ({p.discountTitle})</span>
            <span className="v">{formatNumberFa(p.unitPrice - p.finalPrice)} تومان</span>
          </div>
        )}
        <div className="kv total">
          <span className="k">مبلغ</span>
          <Price final={p.finalPrice} was={p.unitPrice} />
        </div>
      </div>
    </Screen>
  );
}

export function Missing() {
  const reset = useSession((s) => s.reset);
  return (
    <Screen title="مورد یافت نشد" onBack={reset}>
      <div className="empty">
        <Icon name="alert" />
        این مورد دیگر در دسترس نیست (ممکن است کاتالوگ به‌روزرسانی شده باشد).
        <button className="btn btn-ghost" onClick={reset}>
          بازگشت به صفحه اصلی
        </button>
      </div>
    </Screen>
  );
}
