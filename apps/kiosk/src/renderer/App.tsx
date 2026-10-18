import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toPersianDigits } from '@andishkadeh/shared';
import { invoke, onEvent, platform } from './bridge';
import { Icon } from './components/Icon';
import { Modal, Toast } from './components/ui';
import { AccessResultScreen, Scan } from './screens/Access';
import { Cart } from './screens/Cart';
import { Categories, Monitoring, ServiceDetail, Services, Subcategories } from './screens/Catalog';
import { End, Mobile, PaymentResult, Paying, Printing, Review } from './screens/Checkout';
import { Home, Welcome } from './screens/Start';
import { Activation, PlanDetail, Plans, SubscriptionIntro } from './screens/Subscription';
import { useApp, useSession, type ScreenId } from './store';
import { useTapFeedback } from './tap-feedback';

/** Screens where the inactivity timeout must never interrupt the customer. */
const NO_TIMEOUT: ScreenId[] = ['welcome', 'paying', 'printing', 'end'];
/** Screens where "cancel purchase" is not offered (payment in flight or already settled). */
const NO_CANCEL: ScreenId[] = ['paying', 'paymentResult', 'activation', 'printing', 'end'];
const CALM: ScreenId[] = ['mobile', 'review', 'paying', 'paymentResult', 'activation', 'printing', 'end', 'accessResult'];

function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1080, window.innerHeight / 1920));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return scale;
}

function Router() {
  const route = useSession((s) => s.stack[s.stack.length - 1]);
  const p = route.params ?? {};
  switch (route.id) {
    case 'welcome':
      return <Welcome />;
    case 'home':
      return <Home />;
    case 'categories':
      return <Categories />;
    case 'subcategories':
      return <Subcategories categoryId={p.categoryId} />;
    case 'monitoring':
      return <Monitoring categoryId={p.categoryId} />;
    case 'services':
      return <Services categoryId={p.categoryId} subId={p.subId} />;
    case 'serviceDetail':
      return <ServiceDetail serviceId={p.serviceId} />;
    case 'cart':
      return <Cart />;
    case 'subscriptionIntro':
      return <SubscriptionIntro />;
    case 'plans':
      return <Plans />;
    case 'planDetail':
      return <PlanDetail planId={p.planId} />;
    case 'mobile':
      return <Mobile />;
    case 'review':
      return <Review />;
    case 'paying':
      return <Paying />;
    case 'paymentResult':
      return <PaymentResult />;
    case 'activation':
      return <Activation />;
    case 'scan':
      return <Scan />;
    case 'accessResult':
      return <AccessResultScreen />;
    case 'printing':
      return <Printing />;
    case 'end':
      return <End reason={p.reason} />;
  }
}

let ending: Promise<void> | null = null;

/** Clears the session safely: an unpaid locked order is cancelled; settled/unknown payments stay recorded. */
function endSession(): Promise<void> {
  // The timeout ticks every 500 ms and the cancel button can race it: end each session once.
  return (ending ??= (async () => {
    const { order, payment, reset } = useSession.getState();
    if (order && !payment && order.status === 'LOCKED') {
      await invoke('order:cancel', { localOrderId: order.localOrderId }).catch(() => undefined);
    }
    await invoke('session:end').catch(() => undefined);
    reset();
  })().finally(() => {
    ending = null;
  }));
}

/** K24 — short help and cancel confirmation. */
function HelpModal({ onClose }: { onClose: () => void }) {
  const routeId = useSession((s) => s.stack[s.stack.length - 1].id);
  const support = useApp((s) => s.bootstrap?.settings.supportText);
  const canCancel = !NO_CANCEL.includes(routeId) && routeId !== 'welcome';
  return (
    <Modal onClose={onClose}>
      <h2>راهنما</h2>
      <ol style={{ fontSize: 26, lineHeight: 2, color: 'var(--muted)', paddingInlineStart: 36, margin: '0 0 24px' }}>
        <li>حوزه و خدمت مورد نظر را انتخاب و به سبد اضافه کنید؛ می‌توانید از چند حوزه انتخاب کنید.</li>
        <li>شماره موبایل خود را وارد کنید و مبلغ نهایی را بررسی کنید.</li>
        <li>با کارت بانکی روی کارتخوان پرداخت کنید و رسید را بردارید.</li>
        <li>اعضای دارای اشتراک می‌توانند اعتبار خود را با اسکن QR بررسی کنند.</li>
      </ol>
      {support && <p>{support}</p>}
      <div className="footer-row" style={{ marginTop: 32 }}>
        {canCancel && (
          <button
            className="btn btn-ghost"
            style={{ borderColor: 'rgba(255,40,76,.5)', color: '#ff8a9c' }}
            onClick={() => {
              onClose();
              void endSession();
            }}
            data-testid="cancel-purchase"
          >
            <Icon name="x" />
            انصراف و خروج
          </button>
        )}
        <button className="btn btn-primary" onClick={onClose} data-testid="help-close">
          ادامه
        </button>
      </div>
    </Modal>
  );
}

function TimeoutModal({ seconds, onStay }: { seconds: number; onStay: () => void }) {
  return (
    <Modal>
      <h2>هنوز اینجا هستید؟</h2>
      <p>به دلیل عدم استفاده، اطلاعات این نشست تا چند لحظه دیگر پاک می‌شود و کیوسک به صفحه شروع برمی‌گردد.</p>
      <div className="countdown" data-testid="timeout-countdown">{toPersianDigits(seconds)}</div>
      <button className="btn btn-primary btn-block" onClick={onStay} data-testid="timeout-stay">
        ادامه می‌دهم
      </button>
    </Modal>
  );
}

function useInactivity() {
  const routeId = useSession((s) => s.stack[s.stack.length - 1].id);
  const settings = useApp((s) => s.bootstrap?.settings);
  const allowed = useSession((s) => s.idleTimeoutAllowed);
  const browseOnly = useApp((s) => !!s.status?.browseOnly);
  const [warning, setWarning] = useState<number | null>(null);
  const last = useRef(Date.now());

  useEffect(() => {
    // Only record activity here: closing the warning on pointerdown would let the same tap
    // fall through to whatever lies under the modal. The interval below closes it instead.
    const touch = () => {
      last.current = Date.now();
    };
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('keydown', touch, true);
    return () => {
      window.removeEventListener('pointerdown', touch, true);
      window.removeEventListener('keydown', touch, true);
    };
  }, []);

  useEffect(() => {
    // The full timeout starts again on every screen change, and when an error makes it apply.
    last.current = Date.now();
    setWarning(null);
  }, [routeId, allowed]);

  useEffect(() => {
    // The public web app runs on the customer's own phone or computer: nothing to clear for the next person.
    if (browseOnly) return;
    if (NO_TIMEOUT.includes(routeId) && !allowed) return;
    const timeout = (settings?.sessionTimeoutSec ?? 90) * 1000;
    const warnFor = (settings?.timeoutWarningSec ?? 15) * 1000;
    const t = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= timeout) {
        setWarning(null);
        void endSession();
      } else if (idle >= timeout - warnFor) {
        setWarning(Math.ceil((timeout - idle) / 1000));
      } else {
        setWarning(null);
      }
    }, 500);
    return () => clearInterval(t);
  }, [routeId, allowed, browseOnly, settings?.sessionTimeoutSec, settings?.timeoutWarningSec]);

  return { warning, stay: () => ((last.current = Date.now()), setWarning(null)) };
}

export function App() {
  const scale = useStageScale();
  const stage = useRef<HTMLDivElement>(null);
  useTapFeedback(stage, scale);
  const { setState, setStatus } = useApp();
  const ready = useApp((s) => s.ready);
  const status = useApp((s) => s.status);
  const routeId = useSession((s) => s.stack[s.stack.length - 1].id);
  const [help, setHelp] = useState(false);
  const { warning, stay } = useInactivity();

  useEffect(() => {
    if (platform === 'electron') document.body.classList.add('touch-only');
    let alive = true;
    const load = (): void => {
      invoke('app:getState')
        .then((s) => alive && setState(s))
        .catch(() => alive && setTimeout(load, 2000));
    };
    load();
    const offStatus = onEvent('status', setStatus);
    const offCatalog = onEvent('catalog', setState);
    // Windows app: the admin panel window opened from the gear was closed; the core syncs at once.
    const offAdmin = onEvent('admin', ({ open, message }) => {
      if (open) return;
      const s = useSession.getState();
      s.reset();
      s.showToast(message ?? 'خروج از پنل مدیریت؛ تغییرات روی کیوسک اعمال می‌شود');
    });
    const onHelp = () => setHelp(true);
    window.addEventListener('kiosk:help', onHelp);
    return () => {
      alive = false;
      offStatus();
      offCatalog();
      offAdmin();
      window.removeEventListener('kiosk:help', onHelp);
    };
  }, [setState, setStatus]);

  return (
    <div ref={stage} className={`stage${CALM.includes(routeId) ? ' calm' : ''}`} style={{ transform: `scale(${scale})`, left: (window.innerWidth - 1080 * scale) / 2 }}>
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {status && !status.online && routeId !== 'welcome' && (
          <div className="banner offline" data-testid="offline-banner">
            <Icon name="wifiOff" />
            ارتباط با مرکز برقرار نیست —{' '}
            {status.browseOnly ? 'آخرین اطلاعات دریافت‌شده نمایش داده می‌شود' : status.salesAvailable ? 'فروش در حالت آفلاین ادامه دارد' : 'فروش موقتاً متوقف است'}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>{ready ? <Router /> : <Booting />}</div>
        {status?.mockHardware && (
          <div className="banner test" data-testid="test-banner">
            <Icon name="alert" />
            حالت آزمایشی: کارتخوان/چاپگر/اسکنر شبیه‌سازی‌شده — اتصال واقعی برقرار نیست
          </div>
        )}
      </div>
      <Toast />
      {help && <HelpModal onClose={() => setHelp(false)} />}
      {warning !== null && !help && <TimeoutModal seconds={warning} onStay={stay} />}
    </div>
  );
}

function Booting() {
  return (
    <div className="screen" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  );
}
