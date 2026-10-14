import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KioskContent, MediaRow } from '@andishkadeh/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { ReadOnlyNote } from '../components/Layout';
import { Icon } from '../components/Icon';
import { Card, ErrorBox, Field, Loading, PageHead, useToast } from '../components/ui';
import { KioskPreview, MediaPicker } from './Media';

function ListEditor({ value, onChange, disabled, placeholder }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <textarea
      className="textarea"
      value={value.join('\n')}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.split('\n').map((x) => x.trimStart()))}
      onBlur={(e) => onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
    />
  );
}

/** A13 — start screen text, hero image and kiosk texts (no reservation content anywhere). */
export function Content() {
  const q = useQuery({ queryKey: ['content'], queryFn: () => api.get<KioskContent>('/admin/content') });
  const media = useQuery({ queryKey: ['media'], queryFn: () => api.get<MediaRow[]>('/admin/media') });
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [c, setC] = useState<KioskContent | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setC(q.data);
  }, [q.data]);
  if (q.isLoading || !c) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const ro = !isAdmin;
  const heroUrl = media.data?.find((m) => m.id === c.welcome.heroMediaId)?.url ?? null;
  const set = <S extends keyof KioskContent>(section: S, patch: Partial<KioskContent[S]>) => setC({ ...c, [section]: { ...c[section], ...patch } });

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/admin/content', c);
      toast.push('محتوا ذخیره و برای کیوسک منتشر شد');
      qc.invalidateQueries({ queryKey: ['content'] });
    } catch (e) {
      toast.push(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="محتوای کیوسک"
        subtitle="متن‌ها و تصویر صفحه شروع، منوی اصلی و معرفی اشتراک"
        actions={
          isAdmin && (
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="check" />}
              ذخیره و انتشار
            </button>
          )
        }
      />
      <ReadOnlyNote />
      <div className="grid grid-2-1">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="صفحه شروع (K01)">
            <div className="form-grid">
              <Field label="عنوان">
                <input className="input" value={c.welcome.title} disabled={ro} onChange={(e) => set('welcome', { title: e.target.value })} />
              </Field>
              <Field label="متن دکمه">
                <input className="input" value={c.welcome.ctaLabel} disabled={ro} onChange={(e) => set('welcome', { ctaLabel: e.target.value })} />
              </Field>
              <Field label="زیرعنوان" className="full">
                <input className="input" value={c.welcome.subtitle} disabled={ro} onChange={(e) => set('welcome', { subtitle: e.target.value })} />
              </Field>
              <Field label="تصویر اصلی (عمودی، فوتورئال، بدون نوشته)" className="full">
                <MediaPicker value={c.welcome.heroMediaId} disabled={ro} onChange={(heroMediaId) => set('welcome', { heroMediaId })} />
              </Field>
            </div>
          </Card>
          <Card title="منوی اصلی (K02)">
            <div className="form-grid">
              <Field label="عنوان صفحه" className="full">
                <input className="input" value={c.home.title} disabled={ro} onChange={(e) => set('home', { title: e.target.value })} />
              </Field>
              <Field label="کارت خرید خدمات">
                <input className="input" value={c.home.servicesTitle} disabled={ro} onChange={(e) => set('home', { servicesTitle: e.target.value })} />
              </Field>
              <Field label="توضیح">
                <input className="input" value={c.home.servicesSubtitle} disabled={ro} onChange={(e) => set('home', { servicesSubtitle: e.target.value })} />
              </Field>
              <Field label="کارت خرید اشتراک">
                <input className="input" value={c.home.subscriptionTitle} disabled={ro} onChange={(e) => set('home', { subscriptionTitle: e.target.value })} />
              </Field>
              <Field label="توضیح">
                <input className="input" value={c.home.subscriptionSubtitle} disabled={ro} onChange={(e) => set('home', { subscriptionSubtitle: e.target.value })} />
              </Field>
              <Field label="کارت ورود اعضا">
                <input className="input" value={c.home.memberTitle} disabled={ro} onChange={(e) => set('home', { memberTitle: e.target.value })} />
              </Field>
              <Field label="توضیح">
                <input className="input" value={c.home.memberSubtitle} disabled={ro} onChange={(e) => set('home', { memberSubtitle: e.target.value })} />
              </Field>
              <Field label="تصویر کارت خرید خدمات" help="فوتورئال، بدون نوشته؛ در سمت چپ کارت نمایش داده می‌شود">
                <MediaPicker value={c.home.servicesMediaId} disabled={ro} onChange={(servicesMediaId) => set('home', { servicesMediaId })} />
              </Field>
              <Field label="تصویر کارت خرید اشتراک">
                <MediaPicker value={c.home.subscriptionMediaId} disabled={ro} onChange={(subscriptionMediaId) => set('home', { subscriptionMediaId })} />
              </Field>
              <Field label="تصویر کارت ورود اعضا">
                <MediaPicker value={c.home.memberMediaId} disabled={ro} onChange={(memberMediaId) => set('home', { memberMediaId })} />
              </Field>
            </div>
          </Card>
          <Card title="معرفی اشتراک (K11)">
            <div className="form-grid">
              <Field label="عنوان">
                <input className="input" value={c.subscriptionIntro.title} disabled={ro} onChange={(e) => set('subscriptionIntro', { title: e.target.value })} />
              </Field>
              <Field label="زیرعنوان">
                <input className="input" value={c.subscriptionIntro.subtitle} disabled={ro} onChange={(e) => set('subscriptionIntro', { subtitle: e.target.value })} />
              </Field>
              <Field label="مزایا" className="full" help="هر مزیت در یک خط (حداکثر ۸)">
                <ListEditor value={c.subscriptionIntro.benefits} disabled={ro} onChange={(benefits) => set('subscriptionIntro', { benefits: benefits.slice(0, 8) })} />
              </Field>
            </div>
          </Card>
          <Card title="معرفی مانیتورینگ (K08M)">
            <div className="form-grid">
              <Field label="عنوان" className="full">
                <input className="input" value={c.monitoringIntro.title} disabled={ro} onChange={(e) => set('monitoringIntro', { title: e.target.value })} />
              </Field>
              <Field label="متن معرفی" className="full">
                <textarea className="textarea" value={c.monitoringIntro.body} disabled={ro} onChange={(e) => set('monitoringIntro', { body: e.target.value })} />
              </Field>
              <Field label="ماژول‌ها" className="full" help="هر ماژول در یک خط؛ عناوین M-01 تا M-10 پس از تأیید مرکز وارد شوند">
                <ListEditor value={c.monitoringIntro.modules} disabled={ro} onChange={(modules) => set('monitoringIntro', { modules: modules.slice(0, 12) })} />
              </Field>
            </div>
          </Card>
        </div>
        <Card title="پیش‌نمایش">
          <KioskPreview url={heroUrl} />
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            تا زمانی که کیوسک تصویر جدید را کامل دانلود و تأیید نکند، تصویر قبلی نمایش داده می‌شود؛ بنابراین قطع شبکه باعث صفحه خالی نمی‌شود.
          </p>
        </Card>
      </div>
    </>
  );
}
