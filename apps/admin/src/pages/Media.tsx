import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumberFa, toPersianDigits, type MediaRow } from '@andishkadeh/shared';
import { api, errorMessage } from '../api';
import { AdminOnly, useAuth } from '../auth';
import { ReadOnlyNote } from '../components/Layout';
import { Icon } from '../components/Icon';
import { Alert, Card, Empty, ErrorBox, JDate, Loading, Modal, PageHead, useAction, useToast } from '../components/ui';

const kb = (n: number) => `${formatNumberFa(Math.round(n / 1024))} KB`;

function useMedia() {
  return useQuery({ queryKey: ['media'], queryFn: () => api.get<MediaRow[]>('/admin/media') });
}

function UploadButton({ onUploaded }: { onUploaded?: (m: MediaRow) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const action = useAction();
  const qc = useQueryClient();
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        data-testid="media-file"
        onChange={action(async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 8 * 1024 * 1024) return toast.push('حداکثر حجم تصویر ۸ مگابایت است', true);
          setBusy(true);
          try {
            const fd = new FormData();
            fd.append('file', file);
            const m = await api.post<MediaRow>('/admin/media', fd);
            await qc.invalidateQueries({ queryKey: ['media'] });
            toast.push('تصویر بارگذاری شد');
            onUploaded?.(m);
          } catch (err) {
            toast.push(errorMessage(err), true);
          } finally {
            setBusy(false);
          }
        })}
      />
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" /> : <Icon name="upload" />}
        بارگذاری تصویر
      </button>
    </>
  );
}

/** Preview on the 1080×1920 kiosk canvas (scaled ¼): as the start-screen hero and as a domain card. */
export function KioskPreview({ url }: { url: string | null }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div className="kiosk-frame">
          {url && <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 345, backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center top', WebkitMaskImage: 'linear-gradient(#000 62%, transparent)' }} />}
          <div style={{ position: 'absolute', bottom: 70, left: 0, right: 0, textAlign: 'center', fontWeight: 900, fontSize: 18 }}>صفحه شروع</div>
          <div style={{ position: 'absolute', bottom: 28, left: 55, right: 55, height: 34, borderRadius: 99, border: '2px solid #a34bff', textAlign: 'center', lineHeight: '30px', fontWeight: 800 }}>شروع</div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6, textAlign: 'center' }}>
          تصویر صفحه شروع (۱۰۸۰×۱۹۲۰)
        </div>
      </div>
      <div>
        <div className="kiosk-frame" style={{ padding: 12 }}>
          <div style={{ borderRadius: 10, border: '1px solid rgba(22,137,255,.5)', overflow: 'hidden', width: 118 }}>
            <div style={{ height: 95, backgroundImage: url ? `url("${url}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            <div style={{ padding: 8, fontSize: 11, fontWeight: 800 }}>کارت حوزه</div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6, textAlign: 'center' }}>
          برش کارت حوزه/خدمت
        </div>
      </div>
    </div>
  );
}

/** A05 — media library with validation (type sniffed server-side, max 8 MB) and kiosk preview. */
export function MediaLibrary() {
  const q = useMedia();
  const qc = useQueryClient();
  const toast = useToast();
  const action = useAction();
  const { isAdmin } = useAuth();
  const [preview, setPreview] = useState<MediaRow | null>(null);
  return (
    <>
      <PageHead
        title="کتابخانه رسانه"
        subtitle="تصاویر JPEG/PNG/WebP تا ۸ مگابایت؛ کیوسک تا دانلود و تأیید کامل نسخه جدید، تصویر قبلی را نمایش می‌دهد"
        actions={
          <AdminOnly>
            <UploadButton />
          </AdminOnly>
        }
      />
      <ReadOnlyNote />
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <Empty icon="image">هنوز تصویری بارگذاری نشده است</Empty>
        ) : (
          <div className="media-grid">
            {q.data.map((m) => (
              <button key={m.id} className="media-tile" onClick={() => setPreview(m)}>
                <img src={m.url} alt={m.originalName} loading="lazy" />
                <div className="meta">
                  <div style={{ color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.originalName}</div>
                  {m.width && m.height ? `${toPersianDigits(m.width)}×${toPersianDigits(m.height)} · ` : ''}
                  {kb(m.size)} · {m.usage ? `${toPersianDigits(m.usage)} استفاده` : 'بدون استفاده'}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {preview && (
        <Modal
          wide
          title={preview.originalName}
          onClose={() => setPreview(null)}
          footer={
            isAdmin && (
              <button
                className="btn btn-danger"
                disabled={preview.usage > 0}
                title={preview.usage > 0 ? 'تصویر در حال استفاده قابل حذف نیست' : undefined}
                onClick={action(async () => {
                  try {
                    await api.del(`/admin/media/${preview.id}`);
                    toast.push('تصویر حذف شد');
                    setPreview(null);
                    void qc.invalidateQueries({ queryKey: ['media'] });
                  } catch (e) {
                    toast.push(errorMessage(e), true);
                  }
                })}
              >
                <Icon name="trash" />
                حذف
              </button>
            )
          }
        >
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <KioskPreview url={preview.url} />
            <dl className="kv-list" style={{ alignContent: 'start' }}>
              <dt>ابعاد</dt>
              <dd className="num">{preview.width ? `${toPersianDigits(preview.width)}×${toPersianDigits(preview.height ?? 0)}` : '—'}</dd>
              <dt>حجم</dt>
              <dd>{kb(preview.size)}</dd>
              <dt>نوع</dt>
              <dd className="ltr">{preview.mime}</dd>
              <dt>بارگذاری</dt>
              <dd>
                <JDate v={preview.createdAt} />
              </dd>
              <dt>استفاده</dt>
              <dd>{toPersianDigits(preview.usage)} مورد</dd>
            </dl>
          </div>
          {preview.width && preview.height && preview.width > preview.height && (
            <div style={{ marginTop: 14 }}>
              <Alert tone="info">این تصویر افقی است؛ برای صفحه شروع عمودی، تصویر عمودی با کیفیت بالا (حداقل ۱۰۸۰ پیکسل عرض) نتیجه بهتری دارد.</Alert>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/** Field control: pick an image from the library or upload a new one. */
export function MediaPicker({ value, onChange, disabled }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const q = useMedia();
  const [open, setOpen] = useState(false);
  const current = q.data?.find((m) => m.id === value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {current ? <img className="thumb" src={current.url} alt="" style={{ width: 64, height: 64 }} /> : <div className="thumb" style={{ width: 64, height: 64 }} />}
      {!disabled && (
        <>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            <Icon name="image" />
            {value ? 'تغییر تصویر' : 'انتخاب تصویر'}
          </button>
          {value && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
              حذف
            </button>
          )}
        </>
      )}
      {open && (
        <Modal wide title="انتخاب تصویر" onClose={() => setOpen(false)} footer={<UploadButton onUploaded={(m) => (onChange(m.id), setOpen(false))} />}>
          {q.isLoading ? (
            <Loading />
          ) : (
            <div className="media-grid">
              {q.data?.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`media-tile${m.id === value ? ' selected' : ''}`}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <img src={m.url} alt={m.originalName} loading="lazy" />
                  <div className="meta">{m.originalName}</div>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
