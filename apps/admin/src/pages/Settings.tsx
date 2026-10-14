import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DiscountPolicy, RenewalPolicy, type KioskSettings } from '@andishkadeh/shared';
import { ApiError, api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { ReadOnlyNote } from '../components/Layout';
import { Icon } from '../components/Icon';
import { Alert, Card, ErrorBox, Field, Loading, PageHead, Segmented, Switch, useToast } from '../components/ui';
import { MediaPicker } from './Media';

/** A16 — centre identity, receipt texts, timeouts and the policies marked "needs approval" in the PRD. */
export function Settings() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<KioskSettings>('/admin/settings') });
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [s, setS] = useState<KioskSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  if (q.isLoading || !s) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const ro = !isAdmin;
  const up = <K extends keyof KioskSettings>(k: K, v: KioskSettings[K]) => setS({ ...s, [k]: v });
  const num = (k: keyof KioskSettings, label: string, help?: string) => (
    <Field label={label} help={help} error={errors[k]}>
      <input className="input num" type="number" value={s[k] as number} disabled={ro} onChange={(e) => up(k, Number(e.target.value) as never)} />
    </Field>
  );

  const save = async () => {
    setErrors({});
    try {
      await api.put('/admin/settings', s);
      toast.push('تنظیمات ذخیره شد و در همگام‌سازی بعدی روی کیوسک اعمال می‌شود');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) setErrors(Object.fromEntries((e.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message])));
      toast.push(errorMessage(e), true);
    }
  };

  return (
    <>
      <PageHead
        title="تنظیمات"
        actions={
          isAdmin && (
            <button className="btn btn-primary" onClick={save} data-testid="save-settings">
              <Icon name="check" />
              ذخیره تنظیمات
            </button>
          )
        }
      />
      <ReadOnlyNote />
      <div className="grid grid-2">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="هویت مرکز و رسید">
            <div className="form-grid">
              <Field label="نام مرکز">
                <input className="input" value={s.centerName} disabled={ro} onChange={(e) => up('centerName', e.target.value)} />
              </Field>
              <Field label="زیرعنوان">
                <input className="input" value={s.centerSubtitle} disabled={ro} onChange={(e) => up('centerSubtitle', e.target.value)} />
              </Field>
              <Field label="لوگو" className="full">
                <MediaPicker value={s.logoMediaId} disabled={ro} onChange={(v) => up('logoMediaId', v)} />
              </Field>
              <Field label="سربرگ رسید" className="full">
                <input className="input" value={s.receiptHeader} disabled={ro} onChange={(e) => up('receiptHeader', e.target.value)} />
              </Field>
              <Field label="پاورقی رسید" className="full">
                <textarea className="textarea" value={s.receiptFooter} disabled={ro} onChange={(e) => up('receiptFooter', e.target.value)} />
              </Field>
              <Field label="متن راهنما/پشتیبانی کیوسک" className="full">
                <input className="input" value={s.supportText} disabled={ro} onChange={(e) => up('supportText', e.target.value)} />
              </Field>
            </div>
          </Card>
          <Card title="زمان‌بندی نشست و پرداخت">
            <div className="form-grid">
              {num('sessionTimeoutSec', 'خروج خودکار پس از عدم فعالیت (ثانیه)', '۳۰ تا ۹۰۰')}
              {num('timeoutWarningSec', 'هشدار پیش از خروج (ثانیه)')}
              {num('endScreenSec', 'نمایش صفحه پایان (ثانیه)')}
              {num('paymentTimeoutSec', 'مهلت پاسخ کارتخوان (ثانیه)', 'پس از آن وضعیت «نامشخص» ثبت و استعلام می‌شود')}
              {num('maxItemQuantity', 'حداکثر تعداد هر خدمت در سبد')}
            </div>
          </Card>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="سیاست‌های فروش" sub="مواردی که در سند نیازمند تأیید هستند؛ مقدار پیش‌فرض همان پیشنهاد سند است">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Field label="تخفیف‌های هم‌پوشان" help="در هر قلم فقط یک تخفیف اعمال می‌شود">
                <Segmented
                  value={s.discountPolicy}
                  onChange={(v) => !ro && up('discountPolicy', v)}
                  options={[
                    { value: DiscountPolicy.BEST, label: 'بیشترین تخفیف (پیشنهادی)' },
                    { value: DiscountPolicy.PRIORITY, label: 'بر اساس اولویت' },
                  ]}
                />
              </Field>
              <Field label="تمدید اشتراک فعال">
                <Segmented
                  value={s.renewalPolicy}
                  onChange={(v) => !ro && up('renewalPolicy', v)}
                  options={[
                    { value: RenewalPolicy.EXTEND_FROM_END, label: 'از پایان اعتبار فعلی (پیشنهادی)' },
                    { value: RenewalPolicy.START_NOW, label: 'از زمان پرداخت' },
                  ]}
                />
              </Field>
            </div>
          </Card>
          <Card title="حالت آفلاین (قطع ارتباط کیوسک با سرور)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Switch checked={s.offlineSalesEnabled} disabled={ro} onChange={(v) => up('offlineSalesEnabled', v)} label="فروش خدمات در حالت آفلاین (با تأیید کارتخوان و کد OFF)" />
              <Switch checked={s.offlineQrValidation} disabled={ro} onChange={(v) => up('offlineQrValidation', v)} label="بررسی اعتبار QR از اطلاعات ذخیره‌شده کیوسک" />
              <Switch checked={s.offlineSubscriptionSales} disabled={ro} onChange={(v) => up('offlineSubscriptionSales', v)} label="فروش اشتراک در حالت آفلاین" />
              {s.offlineSubscriptionSales && (
                <Alert tone="warning">سیاست فعال‌سازی اشتراک در قطعی هنوز در سند باز است: تاریخ‌های اعتبار پس از همگام‌سازی توسط سرور قطعی می‌شوند.</Alert>
              )}
              {num('offlineCatalogMaxAgeHours', 'حداکثر عمر کاتالوگ برای فروش آفلاین (ساعت)', 'پس از آن تا اتصال مجدد فروش متوقف می‌شود')}
              <Field label="منطقه زمانی">
                <input className="input ltr" value={s.timezone} disabled />
              </Field>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
