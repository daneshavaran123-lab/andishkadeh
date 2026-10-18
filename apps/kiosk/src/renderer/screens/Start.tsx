import { OrderKind } from '@andishkadeh/shared';
import { AdminGear } from '../components/AdminAccess';
import { Icon } from '../components/Icon';
import { BuyAtKioskNotice, Notice, Screen } from '../components/ui';
import matFloor from '../assets/img/mat-floor.jpg';
import { mediaUrl, useApp, useSession } from '../store';

/** K01 — welcome. No inactivity timeout on this screen (PRD K01). */
export function Welcome() {
  const bootstrap = useApp((s) => s.bootstrap);
  const status = useApp((s) => s.status);
  const go = useSession((s) => s.go);
  const content = bootstrap?.content.welcome;
  const hero = mediaUrl(content?.heroMediaId);
  const logo = mediaUrl(bootstrap?.settings.logoMediaId);

  return (
    <div className="screen" style={{ alignItems: 'center' }}>
      <AdminGear />
      <div
        style={{
          position: 'absolute',
          inset: '0 0 auto 0',
          height: 1380,
          backgroundImage: hero ? `url("${hero}")` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          WebkitMaskImage: 'linear-gradient(180deg, #000 62%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, #000 62%, transparent 100%)',
        }}
        aria-hidden
      />
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: 20, marginTop: 64 }}>
        {logo && <img src={logo} alt="" style={{ height: 96 }} />}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '0 64px' }}>
        <h1 style={{ margin: 0, fontSize: 72, fontWeight: 900, textShadow: '0 6px 30px rgba(0,0,0,.6)' }}>
          {content?.title ?? 'اندیشکده کشتی ایران'}
        </h1>
        <p style={{ margin: '16px 0 0', fontSize: 30, color: 'var(--muted)' }}>{content?.subtitle}</p>
      </div>
      <div style={{ position: 'relative', zIndex: 2, marginTop: 72, marginBottom: 56 }}>
        <button className="cta-start" onClick={() => go('home')} data-testid="start">
          {content?.ctaLabel ?? 'شروع'}
          <span className="arrow">
            <Icon name="chevron" />
          </span>
        </button>
      </div>
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 96, fontSize: 22, color: 'var(--muted)' }}>
        <span
          style={{ width: 14, height: 14, borderRadius: 7, background: status?.online ? 'var(--green)' : 'var(--amber)', boxShadow: `0 0 12px ${status?.online ? 'var(--green)' : 'var(--amber)'}` }}
        />
        {status?.online ? 'متصل به مرکز' : 'بدون اتصال به مرکز'}
        {!bootstrap && ' — در حال دریافت اطلاعات…'}
      </div>
    </div>
  );
}

/** K02 — main menu: services / full subscription / member QR. */
export function Home() {
  const bootstrap = useApp((s) => s.bootstrap);
  const status = useApp((s) => s.status);
  const { go, set, reset } = useSession();
  const c = bootstrap?.content.home;
  const browseOnly = !!status?.browseOnly;
  const salesOk = !!status?.salesAvailable;
  const subOk = !!status?.subscriptionSalesAvailable;
  // Public web app: services and plans can be looked at; buying happens at the center's kiosks.
  const servicesOpen = salesOk || (browseOnly && !!bootstrap);
  const plansOpen = subOk || (browseOnly && !!bootstrap?.plans.length);

  const cards = [
    {
      key: 'services',
      art: mediaUrl(c?.servicesMediaId),
      theme: 'blue',
      icon: 'cart' as const,
      title: c?.servicesTitle ?? 'خرید خدمات',
      subtitle: c?.servicesSubtitle,
      enabled: servicesOpen,
      onClick: () => {
        set({ flow: OrderKind.SERVICES });
        go('categories');
      },
    },
    {
      key: 'subscription',
      art: mediaUrl(c?.subscriptionMediaId),
      theme: 'red',
      icon: 'crown' as const,
      title: c?.subscriptionTitle ?? 'خرید اشتراک کامل',
      subtitle: c?.subscriptionSubtitle,
      enabled: plansOpen,
      onClick: () => {
        set({ flow: OrderKind.SUBSCRIPTION });
        go('subscriptionIntro');
      },
    },
    {
      key: 'member',
      art: mediaUrl(c?.memberMediaId),
      theme: 'cyan',
      icon: 'qr' as const,
      title: c?.memberTitle ?? 'ورود اعضا با QR',
      subtitle: c?.memberSubtitle,
      enabled: true,
      onClick: () => go('scan'),
    },
  ].filter((card) => !browseOnly || card.key !== 'member');

  return (
    <Screen title={c?.title ?? 'چه کاری می‌خواهید انجام دهید؟'} subtitle={bootstrap?.settings.centerName} onBack={reset}>
      <div className="stack" style={{ gap: 40 }}>
        {cards.map((card, i) => (
          <button
            key={card.key}
            className={`card home-card enter${card.art ? ' has-art' : ''}`}
            data-theme={card.theme}
            style={{ ['--i' as string]: i, opacity: card.enabled ? 1 : 0.45 }}
            onClick={card.enabled ? card.onClick : undefined}
            aria-disabled={!card.enabled}
            data-testid={`home-${card.key}`}
          >
            <span className="icon-ring" style={{ width: 160, height: 160 }}>
              <Icon name={card.icon} style={{ width: 80, height: 80 }} />
            </span>
            <span className="grow">
              <h2>{card.title}</h2>
              <p>{card.subtitle}</p>
            </span>
            {card.art ? (
              <span className="home-art" style={{ backgroundImage: `url("${card.art}")` }}>
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
        ))}
        {browseOnly && bootstrap && <BuyAtKioskNotice />}
        {!salesOk && (!browseOnly || !bootstrap) && (
          <Notice tone="amber" icon="wifiOff">
            {!bootstrap
              ? 'اطلاعات خدمات هنوز دریافت نشده است. لطفاً چند لحظه بعد دوباره تلاش کنید.'
              : 'فروش در حال حاضر امکان‌پذیر نیست (عدم اتصال به مرکز یا در دسترس نبودن کارتخوان). بررسی اعتبار اعضا همچنان فعال است.'}
          </Notice>
        )}
        {salesOk && !subOk && !browseOnly && (
          <Notice tone="amber" icon="wifiOff">
            خرید اشتراک در زمان قطع ارتباط با مرکز امکان‌پذیر نیست؛ خرید خدمات و بررسی اعتبار اعضا فعال است.
          </Notice>
        )}
      </div>
      <div className="home-floor" style={{ backgroundImage: `url("${matFloor}")` }} aria-hidden />
    </Screen>
  );
}
