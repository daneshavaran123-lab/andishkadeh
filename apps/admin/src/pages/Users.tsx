import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminRole, ROLE_LABEL, type AdminUserDto, type CreateUserRequest } from '@andishkadeh/shared';
import { api, errorMessage, tokenStore } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, ErrorBox, Field, JDateTime, Loading, Modal, PageHead, useToast } from '../components/ui';

const PERMISSIONS: Array<[string, boolean, string]> = [
  ['مشاهده داشبورد', true, 'بله'],
  ['افزودن و ویرایش خدمات', true, 'خیر'],
  ['تغییر قیمت و تخفیف', true, 'خیر'],
  ['مشاهده سفارش و پرداخت', true, 'بله'],
  ['چاپ مجدد رسید و استعلام پرداخت', true, 'بله'],
  ['تطبیق دستی پرداخت نامشخص', true, 'خیر'],
  ['تمدید، ابطال و صدور مجدد QR اشتراک', true, 'خیر'],
  ['تلاش مجدد همگام‌سازی', true, 'فقط مشاهده'],
  ['کاربران، تنظیمات و سوابق تغییرات', true, 'خیر'],
  ['گزارش فروش', true, 'بله'],
];

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Modal
      title="تغییر رمز عبور"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button
            className="btn btn-primary"
            disabled={next.length < 8 || !current}
            onClick={async () => {
              try {
                const r = await api.post<{ token: string }>('/admin/auth/change-password', { currentPassword: current, newPassword: next });
                tokenStore.set(r.token);
                toast.push('رمز عبور تغییر کرد؛ سایر نشست‌ها باطل شدند');
                onClose();
              } catch (e) {
                setErr(errorMessage(e));
              }
            }}
          >
            تغییر رمز
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="رمز فعلی">
          <input className="input ltr" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="رمز جدید" help="حداقل ۸ نویسه">
          <input className="input ltr" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}

function UserDialog({ initial, onClose }: { initial: AdminUserDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<CreateUserRequest>({ username: initial?.username ?? '', displayName: initial?.displayName ?? '', password: '', role: initial?.role ?? AdminRole.OPERATOR });
  const save = async () => {
    try {
      if (initial) {
        await api.patch(`/admin/users/${initial.id}`, { displayName: f.displayName, role: f.role, ...(f.password ? { password: f.password } : {}) });
      } else {
        await api.post('/admin/users', f);
      }
      toast.push('کاربر ذخیره شد');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };
  return (
    <Modal
      title={initial ? `ویرایش ${initial.displayName}` : 'کاربر جدید'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" onClick={save}>
            ذخیره
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="نام کاربری" help="حروف کوچک لاتین، عدد و . _ -">
          <input className="input ltr" value={f.username} disabled={!!initial} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label="نام نمایشی">
          <input className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
        </Field>
        <Field label="نقش">
          <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as AdminRole })}>
            <option value={AdminRole.OPERATOR}>{ROLE_LABEL.OPERATOR}</option>
            <option value={AdminRole.ADMIN}>{ROLE_LABEL.ADMIN}</option>
          </select>
        </Field>
        <Field label={initial ? 'رمز جدید (اختیاری)' : 'رمز عبور'} help="حداقل ۸ نویسه">
          <input className="input ltr" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}

/** A17 — users & roles (ADMIN only; enforced by the API). */
export function Users() {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<AdminUserDto[]>('/admin/users') });
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [edit, setEdit] = useState<AdminUserDto | null | 'new'>(null);
  const patch = async (u: AdminUserDto, body: Record<string, unknown>, ok: string) => {
    try {
      await api.patch(`/admin/users/${u.id}`, body);
      toast.push(ok);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  return (
    <>
      <PageHead
        title="کاربران و نقش‌ها"
        actions={
          <button className="btn btn-primary" onClick={() => setEdit('new')}>
            <Icon name="plus" />
            کاربر جدید
          </button>
        }
      />
      <div className="grid grid-2-1">
        <Card bodyClass="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>نام</th>
                <th>نام کاربری</th>
                <th>نقش</th>
                <th>وضعیت</th>
                <th>آخرین ورود</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>
                    <span className="ltr">{u.username}</span>
                  </td>
                  <td>
                    <Badge tone={u.role === 'ADMIN' ? 'info' : 'neutral'} icon={null}>
                      {ROLE_LABEL[u.role]}
                    </Badge>
                  </td>
                  <td>{!u.active ? <Badge>غیرفعال</Badge> : u.lockedUntil ? <Badge tone="danger" icon="lock">قفل موقت</Badge> : <Badge tone="success">فعال</Badge>}</td>
                  <td>
                    <JDateTime v={u.lastLoginAt} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {u.lockedUntil && (
                        <button className="btn btn-sm" onClick={() => patch(u, { unlock: true }, 'قفل حساب برداشته شد')}>
                          رفع قفل
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => setEdit(u)}>
                        ویرایش
                      </button>
                      {u.id !== user?.id && (
                        <button className="btn btn-sm btn-ghost" onClick={() => patch(u, { active: !u.active }, u.active ? 'کاربر غیرفعال شد' : 'کاربر فعال شد')}>
                          {u.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="ماتریس دسترسی" sub="کنترل در API اعمال می‌شود، نه فقط در رابط" bodyClass="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>عملیات</th>
                <th>مدیر اصلی</th>
                <th>اپراتور</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(([op, , operator]) => (
                <tr key={op}>
                  <td style={{ fontSize: 12.5 }}>{op}</td>
                  <td>
                    <Badge tone="success">بله</Badge>
                  </td>
                  <td>
                    <Badge tone={operator === 'بله' ? 'success' : operator === 'خیر' ? 'danger' : 'warning'} icon={operator === 'خیر' ? 'x' : undefined}>
                      {operator}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      {edit && <UserDialog initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
