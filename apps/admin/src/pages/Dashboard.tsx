import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  HARDWARE_STATE_LABEL,
  PAYMENT_STATUS_LABEL,
  formatJalaliLong,
  formatNumberFa,
  formatToman,
  toPersianDigits,
  type DashboardResponse,
  type DeviceRow,
  type PaymentStatus,
} from '@andishkadeh/shared';
import { api } from '../api';
import { BarList, DailyColumns } from '../components/charts';
import { Icon, type IconName } from '../components/Icon';
import { Badge, Card, Code, ErrorBox, JDateTime, Loading, PageHead, relativeAge, type Tone } from '../components/ui';

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  INITIATED: 'info',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  UNKNOWN: 'warning',
};

export function DeviceHealthBadge({ d }: { d: DeviceRow }) {
  if (!d.active) return <Badge>غیرفعال</Badge>;
  if (!d.online) return <Badge tone="danger" icon="wifiOff">قطع ارتباط</Badge>;
  const hw = d.hardware ? Object.values(d.hardware) : [];
  if (hw.some((h) => h.state === 'ERROR')) return <Badge tone="danger">خطای تجهیزات</Badge>;
  return <Badge tone="success">آنلاین</Badge>;
}

function Stat({ to, icon, label, value, unit, foot, testid }: { to: string; icon: IconName; label: string; value: string; unit?: string; foot?: string; testid?: string }) {
  return (
    <Link to={to} className="card stat" data-testid={testid}>
      <span className="label">
        <Icon name={icon} />
        {label}
      </span>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </Link>
  );
}

/** A02 — KPIs, 30-day final sales, domain share, latest transactions, operational alerts. */
export function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardResponse>('/admin/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  const d = q.data;
  const a = d.alerts;
  const month = d.salesSeries.reduce((s, x) => s + x.total, 0);
  const alerts: Array<{ to: string; icon: IconName; label: string; n: number; tone: Tone }> = [
    { to: '/payments?status=UNKNOWN', icon: 'clock', label: 'پرداخت‌های نامشخص نیازمند استعلام/تطبیق', n: a.unknownPayments, tone: 'warning' },
    { to: '/orders?conflict=true', icon: 'alert', label: 'مغایرت‌های مالی نیازمند بررسی', n: a.conflicts, tone: 'danger' },
    { to: '/sync', icon: 'sync', label: 'رویدادهای همگام‌سازی در صف کیوسک', n: a.syncPending, tone: 'info' },
    { to: '/sync?status=REJECTED', icon: 'sync', label: 'رویدادهای همگام‌سازی ردشده', n: a.syncRejected, tone: 'danger' },
    { to: '/devices', icon: 'monitor', label: 'کیوسک بدون ارتباط', n: a.staleDevices, tone: 'danger' },
    { to: '/devices', icon: 'alert', label: 'خطای کارتخوان، چاپگر یا اسکنر', n: a.hardwareErrors, tone: 'danger' },
    { to: '/orders?status=PAID', icon: 'printer', label: 'رسیدهای چاپ‌نشده (۷ روز اخیر)', n: a.printFailures, tone: 'warning' },
  ];
  const active = alerts.filter((x) => x.n > 0);

  return (
    <div className={q.isFetching ? 'refetching' : ''}>
      <PageHead title="داشبورد" subtitle={`امروز ${formatJalaliLong(new Date())} — فروش قطعی فقط شامل پرداخت‌های تأییدشده است`} />
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat to={`/reports?from=${d.today}&to=${d.today}`} icon="chart" label="فروش قطعی امروز" value={formatNumberFa(d.kpis.todaySales)} unit="تومان" foot="پس از تخفیف، بدون پرداخت‌های نامشخص" testid="kpi-sales" />
        <Stat to="/orders?status=PAID" icon="cart" label="سفارش‌های پرداخت‌شده امروز" value={formatNumberFa(d.kpis.todayPaidOrders)} unit="سفارش" testid="kpi-orders" />
        <Stat to="/subscriptions?state=active" icon="qr" label="اشتراک‌های فعال" value={formatNumberFa(d.kpis.activeSubscriptions)} unit="اشتراک" testid="kpi-subs" />
        <Stat
          to="/devices"
          icon="monitor"
          label="سلامت کیوسک"
          value={`${toPersianDigits(d.kpis.devicesOnline)} از ${toPersianDigits(d.kpis.devicesTotal)}`}
          unit="آنلاین"
          foot={d.devices[0] ? `آخرین ارتباط: ${relativeAge(d.devices[0].lastSeenAt)}` : undefined}
          testid="kpi-devices"
        />
      </div>

      <div className="grid grid-2-1" style={{ marginBottom: 18 }}>
        <Card title="فروش قطعی ۳۰ روز اخیر" sub={`جمع: ${formatToman(month)}`}>
          <DailyColumns data={d.salesSeries.map((x) => ({ date: x.date, total: x.total, count: x.orders }))} />
        </Card>
        <Card title="سهم حوزه‌ها" sub="فروش قطعی ۳۰ روز اخیر">
          <BarList rows={d.categoryShare.map((c) => ({ key: c.title, title: c.title, total: c.total }))} empty="هنوز فروشی ثبت نشده است" />
        </Card>
      </div>

      <div className="grid grid-2-1">
        <Card title="آخرین تراکنش‌ها" actions={<Link to="/payments">همه تراکنش‌ها</Link>} bodyClass="table-wrap">
          {d.recentPayments.length === 0 ? (
            <div className="empty">هنوز تراکنشی ثبت نشده است</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>سفارش</th>
                  <th>زمان</th>
                  <th>وضعیت</th>
                  <th className="n">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {d.recentPayments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/orders/${p.orderId}`}>
                        <Code>{p.orderNumber}</Code>
                      </Link>
                    </td>
                    <td>
                      <JDateTime v={p.initiatedAt} />
                    </td>
                    <td>
                      <Badge tone={PAYMENT_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                    </td>
                    <td className="n">{formatToman(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="هشدارها" bodyClass="alerts-list">
            {active.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <Icon name="check" />
                موردی نیازمند اقدام نیست
              </div>
            ) : (
              active.map((x) => (
                <Link key={x.label} to={x.to} data-testid="alert-row">
                  <Badge tone={x.tone} icon={x.icon}>
                    {' '}
                  </Badge>
                  {x.label}
                  <span className="n">{toPersianDigits(x.n)}</span>
                </Link>
              ))
            )}
          </Card>
          <Card title="وضعیت تجهیزات" actions={<Link to="/devices">جزئیات</Link>}>
            {d.devices.length === 0 && <div className="muted">دستگاهی ثبت نشده است</div>}
            {d.devices.map((dev) => (
              <div key={dev.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b>{dev.name}</b>
                  <Code>{dev.id}</Code>
                  <span style={{ marginInlineStart: 'auto' }}>
                    <DeviceHealthBadge d={dev} />
                  </span>
                </div>
                {dev.hardware && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(['pos', 'printer', 'scanner'] as const).map((k) => {
                      const h = dev.hardware![k];
                      const tone: Tone = h.state === 'OK' ? 'success' : h.state === 'ERROR' ? 'danger' : h.state === 'WARNING' ? 'warning' : 'neutral';
                      return (
                        <Badge key={k} tone={tone}>
                          {k === 'pos' ? 'کارتخوان' : k === 'printer' ? 'چاپگر' : 'اسکنر'}: {HARDWARE_STATE_LABEL[h.state]}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
