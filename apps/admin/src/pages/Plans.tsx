import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatToman, toPersianDigits, type AdminPlan, type PlanUpsert } from '@andishkadeh/shared';
import { api, errorMessage } from '../api';
import { AdminOnly, useAuth } from '../auth';
import { ReadOnlyNote } from '../components/Layout';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Code, ErrorBox, Field, Loading, Modal, PageHead, Switch, useAction, useToast } from '../components/ui';
import { MoneyInput } from './Catalog';
import { MediaPicker } from './Media';

function PlanDialog({ initial, onClose }: { initial: AdminPlan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const action = useAction();
  const [f, setF] = useState<PlanUpsert>(
    initial
      ? {
          code: initial.code,
          title: initial.title,
          description: initial.description,
          durationDays: initial.durationDays,
          durationMonths: initial.durationMonths,
          price: initial.price,
          badge: initial.badge,
          mediaId: initial.mediaId,
          active: initial.active,
          sortOrder: initial.sortOrder,
        }
      : { code: '', title: '', description: '', durationDays: 30, durationMonths: 1, price: 0, badge: null, mediaId: null, active: true, sortOrder: 9 },
  );
  const save = async () => {
    try {
      if (initial) await api.patch(`/admin/plans/${initial.id}`, f);
      else await api.post('/admin/plans', f);
      toast.push('پلن ذخیره و منتشر شد');
      void qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };
  return (
    <Modal
      title={initial ? `ویرایش ${initial.title}` : 'افزودن پلن'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button className="btn btn-primary" onClick={action(save)} data-testid="save-plan">
            ذخیره و انتشار
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="کد">
          <input className="input ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="عنوان">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="مدت (ماه)">
          <input className="input num" type="number" min={1} value={f.durationMonths} onChange={(e) => setF({ ...f, durationMonths: Number(e.target.value) })} />
        </Field>
        <Field label="مدت اعتبار (روز)" help="مبنای محاسبه تاریخ پایان">
          <input className="input num" type="number" min={1} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: Number(e.target.value) })} />
        </Field>
        <Field label="قیمت (تومان)">
          <MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v ?? 0 })} />
        </Field>
        <Field label="برچسب ویژه" help="مثلاً «پرطرفدار» (اختیاری)">
          <input className="input" value={f.badge ?? ''} onChange={(e) => setF({ ...f, badge: e.target.value || null })} />
        </Field>
        <Field label="توضیح" className="full">
          <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="عکس کارت پلن (در صفحه پلن‌های کیوسک)" className="full">
          <MediaPicker value={f.mediaId} onChange={(mediaId) => setF({ ...f, mediaId })} />
        </Field>
        <div className="full">
          <Switch checked={f.active} onChange={(active) => setF({ ...f, active })} label="فعال (نمایش در کیوسک)" />
        </div>
        {initial && initial.subscriptionCount > 0 && <Alert tone="info">تغییر قیمت یا مدت روی {toPersianDigits(initial.subscriptionCount)} اشتراک قبلی اثری ندارد.</Alert>}
      </div>
    </Modal>
  );
}

/** A08 — subscription plans (1/3/6/12 months): duration, price, badge, card photo, activation. */
export function Plans() {
  const q = useQuery({ queryKey: ['plans'], queryFn: () => api.get<AdminPlan[]>('/admin/plans') });
  const { isAdmin } = useAuth();
  const [edit, setEdit] = useState<AdminPlan | null | 'new'>(null);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  return (
    <>
      <PageHead
        title="پلن‌های اشتراک"
        subtitle="پلن غیرفعال در کیوسک نمایش داده نمی‌شود؛ اشتراک‌های تاریخی قرارداد خود را حفظ می‌کنند"
        actions={
          <AdminOnly>
            <button className="btn btn-primary" onClick={() => setEdit('new')}>
              <Icon name="plus" />
              افزودن پلن
            </button>
          </AdminOnly>
        }
      />
      <ReadOnlyNote />
      <div className="grid grid-4">
        {q.data.map((p) => (
          <Card key={p.id} title={p.title} sub={<Code>{p.code}</Code>} actions={!p.active ? <Badge>غیرفعال</Badge> : p.badge ? <Badge tone="info" icon={null}>{p.badge}</Badge> : null}>
            {p.mediaUrl && <img className="plan-photo" src={p.mediaUrl} alt="" />}
            <div style={{ fontSize: 26, fontWeight: 800 }}>{formatToman(p.price)}</div>
            <div className="muted" style={{ margin: '6px 0 12px' }}>
              {toPersianDigits(p.durationMonths)} ماه ({toPersianDigits(p.durationDays)} روز) · معادل ماهانه {formatToman(Math.round(p.price / p.durationMonths))}
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>{toPersianDigits(p.subscriptionCount)} اشتراک فروخته‌شده</div>
            {isAdmin && (
              <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setEdit(p)} data-testid={`edit-plan-${p.code}`}>
                <Icon name="edit" />
                ویرایش
              </button>
            )}
          </Card>
        ))}
      </div>
      {edit && <PlanDialog initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
