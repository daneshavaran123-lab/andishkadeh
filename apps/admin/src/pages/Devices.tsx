import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMMAND_STATUS_LABEL,
  COMMAND_TYPE_LABEL,
  HARDWARE_STATE_LABEL,
  WEB_KIOSK_SETUP_STORAGE_KEY,
  toPersianDigits,
  type DeviceCommandRow,
  type DeviceRow,
  type HardwareStatus,
  type KioskInstallerInfo,
  type SystemInfo,
} from '@andishkadeh/shared';
import { api, errorMessage } from '../api';
import { AdminOnly } from '../auth';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, Empty, ErrorBox, Field, JDateTime, Loading, Modal, PageHead, relativeAge, useAction, useToast, type Tone } from '../components/ui';
import { DeviceHealthBadge } from './Dashboard';

const HW_TONE: Record<HardwareStatus['state'], Tone> = { OK: 'success', WARNING: 'warning', ERROR: 'danger', UNKNOWN: 'neutral' };
const HW_NAME = { pos: 'کارتخوان', printer: 'چاپگر', scanner: 'اسکنر QR' } as const;

/** Copies a value (server address, device id, key) with one tap. */
export function CopyButton({ value, label = 'کپی' }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(
          () => toast.push('کپی شد'),
          () => toast.push('کپی نشد؛ متن را انتخاب و کپی کنید', true),
        )
      }
    >
      <Icon name="copy" />
      {label}
    </button>
  );
}

/** Address kiosks connect to: the server's public address, or the one this page was opened with. */
export const useServerUrl = () => {
  const system = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/admin/system'), staleTime: Infinity });
  return system.data?.publicBaseUrl || location.origin;
};

/** Windows installer of this release, offered only once it can be downloaded. */
export function InstallerButton({ info }: { info: KioskInstallerInfo | undefined }) {
  if (!info) return null;
  if (info.available === false) {
    return (
      <span className="badge" title="نصب‌کننده این نسخه هنوز منتشر نشده است" data-testid="kiosk-installer-missing">
        نصب‌کننده نسخه {toPersianDigits(info.version)} هنوز منتشر نشده
      </span>
    );
  }
  return (
    <a className="btn" href={info.url} title="نصب‌کننده برنامه کیوسک برای ویندوز، هم‌نسخه با این سرور" data-testid="kiosk-installer">
      <Icon name="download" />
      برنامه کیوسک ویندوز {toPersianDigits(info.version)}
    </a>
  );
}

export const useInstallerInfo = () =>
  useQuery({ queryKey: ['installer'], queryFn: () => api.get<KioskInstallerInfo>('/admin/system/installer'), staleTime: 60_000 }).data;

/**
 * The key of a new device (or a new key) is shown once, with everything needed to connect a kiosk:
 * the Windows app's setup screen takes the three values; the web app at `/` of this server can be
 * activated in this browser directly (same origin, so the activation is shared with it).
 */
function KeyOnce({ apiKey, deviceId, onClose }: { apiKey: string; deviceId: string; onClose: () => void }) {
  const serverUrl = useServerUrl();
  const [payment, setPayment] = useState<'mock' | 'none'>('mock');
  const [activated, setActivated] = useState(false);
  const activateHere = () => {
    try {
      const current = JSON.parse(localStorage.getItem(WEB_KIOSK_SETUP_STORAGE_KEY) ?? 'null') as { deviceId?: string } | null;
      if (
        current?.deviceId &&
        current.deviceId !== deviceId &&
        !window.confirm(
          `این مرورگر هم‌اکنون کیوسک ${current.deviceId} است. فروش‌ها و رویدادهای ارسال‌نشده آن دستگاه باید پیش از جایگزینی ارسال شده باشند (صف همگام‌سازی آن در این صفحه صفر باشد). جایگزین شود؟`,
        )
      )
        return;
      localStorage.setItem(
        WEB_KIOSK_SETUP_STORAGE_KEY,
        JSON.stringify({ serverUrl: location.origin, deviceId, deviceKey: apiKey, payment, printer: 'browser', scanner: 'keyboard', devControls: false }),
      );
      setActivated(true);
    } catch {
      window.alert('ذخیره در این مرورگر ممکن نشد (حالت خصوصی یا تنظیمات مرورگر).');
    }
  };
  return (
    <Modal title="اتصال کیوسک" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>ذخیره کردم</button>}>
      <Alert tone="warning">کلید فقط همین یک بار نمایش داده می‌شود و روی سرور ذخیره نمی‌شود. پیش از بستن، کیوسک را متصل کنید یا کلید را جای امنی بنویسید.</Alert>
      <dl className="kv-list" style={{ marginTop: 14 }} data-testid="device-connection">
        <dt>آدرس سرور</dt>
        <dd>
          <code className="ltr">{serverUrl}</code> <CopyButton value={serverUrl} />
        </dd>
        <dt>شناسه دستگاه</dt>
        <dd>
          <code className="ltr">{deviceId}</code> <CopyButton value={deviceId} />
        </dd>
        <dt>کلید</dt>
        <dd>
          <code className="ltr" style={{ wordBreak: 'break-all', userSelect: 'all' }} data-testid="device-key">
            {apiKey}
          </code>{' '}
          <CopyButton value={apiKey} />
        </dd>
      </dl>
      <h3 style={{ fontSize: 15, margin: '18px 0 6px' }}>کیوسک ویندوز</h3>
      <p className="muted" style={{ margin: 0, lineHeight: 1.9 }}>
        در صفحه «راه‌اندازی کیوسک» برنامه ویندوز (اجرای اول) همین آدرس سرور، شناسه و کلید را وارد کنید و چاپگر رسید را انتخاب کنید.
      </p>
      <h3 style={{ fontSize: 15, margin: '18px 0 6px' }}>وب‌اپ روی همین مرورگر</h3>
      {activated ? (
        <Alert tone="success">
          این مرورگر به‌عنوان کیوسک {deviceId} فعال شد.{' '}
          <a href="/" data-testid="open-web-app">
            باز کردن وب‌اپ
          </a>
        </Alert>
      ) : (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 'auto' }} value={payment} onChange={(e) => setPayment(e.target.value as 'mock' | 'none')} aria-label="کارتخوان">
            <option value="mock">کارتخوان: شبیه‌ساز (نمایش و آموزش، با نوار «حالت آزمایشی»)</option>
            <option value="none">کارتخوان: متصل نشده (فروش متوقف)</option>
          </select>
          <button className="btn" onClick={activateHere} data-testid="activate-browser">
            فعال‌سازی همین مرورگر
          </button>
        </div>
      )}
    </Modal>
  );
}

function Commands({ device }: { device: DeviceRow }) {
  const q = useQuery({ queryKey: ['commands', device.id], queryFn: () => api.get<DeviceCommandRow[]>(`/admin/devices/${device.id}/commands`), refetchInterval: 10_000 });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Empty>فرمانی ارسال نشده است</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>فرمان</th>
            <th>وضعیت</th>
            <th>ارسال</th>
            <th>انجام</th>
            <th>توسط</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((c) => (
            <tr key={c.id}>
              <td>{COMMAND_TYPE_LABEL[c.type]}</td>
              <td>
                <Badge tone={c.status === 'DONE' ? 'success' : c.status === 'FAILED' ? 'danger' : 'info'}>{COMMAND_STATUS_LABEL[c.status]}</Badge>
              </td>
              <td>
                <JDateTime v={c.createdAt} />
              </td>
              <td>
                <JDateTime v={c.completedAt} />
              </td>
              <td className="muted">{c.createdBy ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A15 — kiosk heartbeat, card reader / printer / scanner state, version, outbox. Also the device
 * list of the kiosk management page (/kiosk), which shows the installer in its own card.
 */
export function Devices({ embedded = false }: { embedded?: boolean }) {
  const q = useQuery({ queryKey: ['devices'], queryFn: () => api.get<DeviceRow[]>('/admin/devices'), refetchInterval: 15_000 });
  const installer = useInstallerInfo();
  const qc = useQueryClient();
  const toast = useToast();
  const action = useAction();
  const [create, setCreate] = useState(false);
  const [newId, setNewId] = useState('KIOSK-02');
  const [newName, setNewName] = useState('');
  const [key, setKey] = useState<{ apiKey: string; deviceId: string } | null>(null);
  const [history, setHistory] = useState<DeviceRow | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['devices'] });
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.push(ok);
      refresh();
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  return (
    <>
      <PageHead
        title={embedded ? 'کیوسک‌ها' : 'کیوسک و تجهیزات'}
        subtitle="وضعیت «نامشخص» یعنی SDK واقعی آن تجهیز متصل نیست یا وضعیت را گزارش نمی‌کند"
        actions={
          <>
            {!embedded && <InstallerButton info={installer} />}
            <AdminOnly>
              <button className="btn btn-primary" onClick={() => setCreate(true)}>
                <Icon name="plus" />
                ثبت کیوسک جدید
              </button>
            </AdminOnly>
          </>
        }
      />
      {q.data.length === 0 && <Empty icon="monitor">کیوسکی ثبت نشده است</Empty>}
      <div className="grid grid-2">
        {q.data.map((d) => (
          <Card
            key={d.id}
            title={
              <>
                {d.name} <Code>{d.id}</Code>
              </>
            }
            sub={`آخرین ارتباط: ${relativeAge(d.lastSeenAt)} · نسخه ${d.appVersion ?? '—'} · کاتالوگ r${toPersianDigits(d.catalogRevision ?? 0)}`}
            actions={<DeviceHealthBadge d={d} />}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
              {(['pos', 'printer', 'scanner'] as const).map((k) => {
                const h = d.hardware?.[k];
                return (
                  <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                    <div className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
                      {HW_NAME[k]}
                    </div>
                    <div style={{ margin: '6px 0' }}>{h ? <Badge tone={HW_TONE[h.state]}>{HARDWARE_STATE_LABEL[h.state]}</Badge> : <Badge>بدون گزارش</Badge>}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {h?.detail ?? ''}
                      {h?.adapter?.startsWith('mock') && (
                        <div style={{ color: 'var(--warning)', fontWeight: 700 }}>شبیه‌سازی‌شده — اتصال واقعی نیست</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <dl className="kv-list">
              <dt>صف همگام‌سازی</dt>
              <dd>
                {toPersianDigits(d.outbox?.pending ?? 0)} در انتظار · {toPersianDigits(d.outbox?.failed ?? 0)} ناموفق
                {d.outbox?.oldestPendingAt && <span className="muted"> (قدیمی‌ترین: {relativeAge(d.outbox.oldestPendingAt)})</span>}
              </dd>
              <dt>پرداخت تعیین‌تکلیف‌نشده</dt>
              <dd>{d.unresolvedPayments ? <Badge tone="warning">{toPersianDigits(d.unresolvedPayments)} مورد</Badge> : '۰'}</dd>
              <dt>آخرین همگام‌سازی</dt>
              <dd>{relativeAge(d.lastSyncAt)}</dd>
            </dl>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => setHistory(d)}>
                <Icon name="history" />
                سوابق فرمان‌ها
              </button>
              <AdminOnly>
                <button className="btn btn-sm" onClick={action(() => act(() => api.post(`/admin/devices/${d.id}/sync-now`), 'فرمان همگام‌سازی ارسال شد'))}>
                  <Icon name="sync" />
                  همگام‌سازی فوری
                </button>
                <button
                  className="btn btn-sm"
                  onClick={action(async () => {
                    if (!window.confirm('کلید فعلی باطل می‌شود و کیوسک تا وارد کردن کلید جدید قطع می‌شود. ادامه می‌دهید؟')) return;
                    try {
                      const r = await api.post<{ apiKey: string }>(`/admin/devices/${d.id}/rotate-key`);
                      setKey({ apiKey: r.apiKey, deviceId: d.id });
                    } catch (e) {
                      toast.push(errorMessage(e), true);
                    }
                  })}
                >
                  <Icon name="key" />
                  کلید جدید
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={action(async () => {
                    const name = window.prompt(`نام تازه برای ${d.id} (شناسه دستگاه تغییر نمی‌کند)`, d.name)?.trim();
                    if (name && name !== d.name) await act(() => api.patch(`/admin/devices/${d.id}`, { name }), 'نام دستگاه تغییر کرد');
                  })}
                >
                  <Icon name="edit" />
                  تغییر نام
                </button>
                <button className="btn btn-sm btn-ghost" onClick={action(() => act(() => api.patch(`/admin/devices/${d.id}`, { active: !d.active }), d.active ? 'دستگاه غیرفعال شد' : 'دستگاه فعال شد'))}>
                  {d.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                </button>
              </AdminOnly>
            </div>
          </Card>
        ))}
      </div>
      {create && (
        <Modal
          title="ثبت کیوسک جدید"
          onClose={() => setCreate(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreate(false)}>
                انصراف
              </button>
              <button
                className="btn btn-primary"
                onClick={action(async () => {
                  try {
                    const r = await api.post<{ apiKey: string; device: DeviceRow }>('/admin/devices', { id: newId.trim().toUpperCase(), name: newName.trim() });
                    setCreate(false);
                    setKey({ apiKey: r.apiKey, deviceId: r.device.id });
                    refresh();
                  } catch (e) {
                    toast.push(errorMessage(e), true);
                  }
                })}
              >
                ثبت و دریافت کلید
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="شناسه" help="حروف بزرگ لاتین، عدد و خط تیره">
              <input className="input ltr" value={newId} onChange={(e) => setNewId(e.target.value)} />
            </Field>
            <Field label="نام">
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="مثلاً کیوسک طبقه دوم" />
            </Field>
          </div>
        </Modal>
      )}
      {key && <KeyOnce {...key} onClose={() => setKey(null)} />}
      {history && (
        <Modal wide title={`سوابق فرمان‌های ${history.name}`} onClose={() => setHistory(null)}>
          <Commands device={history} />
        </Modal>
      )}
    </>
  );
}
