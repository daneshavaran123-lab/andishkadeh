import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ORDER_KIND_LABEL,
  OrderKind,
  formatJalaliDate,
  formatNumberFa,
  formatToman,
  localDayRange,
  type AdminDiscount,
  type AdminPlan,
  type ReportBucket,
  type ReportResponse,
} from '@andishkadeh/shared';
import { api, errorMessage, qs } from '../api';
import { BarList, DailyColumns } from '../components/charts';
import { Icon } from '../components/Icon';
import { Alert, Card, DateRangeFilter, ErrorBox, Field, Loading, PageHead, presetRange, useAction, useToast, type RangePreset } from '../components/ui';
import { useCategories } from './Catalog';

function BucketTable({ rows, label }: { rows: ReportBucket[]; label: string }) {
  if (!rows.length) return <div className="empty">داده‌ای در این بازه نیست</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{label}</th>
            <th className="n">تعداد</th>
            <th className="n">تخفیف</th>
            <th className="n">فروش قطعی</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.title}</td>
              <td className="n">{formatNumberFa(r.count)}</td>
              <td className="n">{r.discount ? formatToman(r.discount) : '—'}</td>
              <td className="n">{formatToman(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A14 — final sales (PAID) vs unknown payments, kept separate; filters and CSV/XLSX export. */
export function Reports() {
  const [sp] = useSearchParams();
  const toast = useToast();
  const action = useAction();
  const initialFrom = sp.get('from');
  const initialTo = sp.get('to');
  const [range, setRange] = useState<{ preset: RangePreset; from: string; to: string }>(
    initialFrom && initialTo ? { preset: initialFrom === initialTo ? 'today' : 'custom', from: initialFrom, to: initialTo } : { preset: '30d', ...presetRange('30d') },
  );
  const [f, setF] = useState({ kind: '', categoryId: '', planId: '', discountId: '' });
  const cats = useCategories();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<AdminPlan[]>('/admin/plans') });
  const discounts = useQuery({ queryKey: ['discounts'], queryFn: () => api.get<AdminDiscount[]>('/admin/discounts') });
  const query = qs({ from: range.from, to: range.to, kind: f.kind, categoryId: f.categoryId, planId: f.planId, discountId: f.discountId });
  const q = useQuery({ queryKey: ['report', query], queryFn: () => api.get<ReportResponse>(`/admin/reports/sales${query}`) });
  const s = q.data?.summary;

  const exportFile = async (format: 'csv' | 'xlsx') => {
    try {
      await api.download(`/admin/reports/sales/export${query}&format=${format}`, `sales.${format}`);
    } catch (e) {
      toast.push(errorMessage(e), true);
    }
  };

  return (
    <>
      <PageHead
        title="گزارش‌ها"
        subtitle={`${formatJalaliDate(localDayRange(range.from).from)} تا ${formatJalaliDate(localDayRange(range.to).from)} — فروش قطعی فقط پرداخت‌های تأییدشده`}
        actions={
          <>
            <button className="btn" onClick={action(() => exportFile('csv'))} data-testid="export-csv">
              <Icon name="download" />
              خروجی CSV
            </button>
            <button className="btn" onClick={action(() => exportFile('xlsx'))} data-testid="export-xlsx">
              <Icon name="download" />
              خروجی Excel
            </button>
          </>
        }
      />
      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
        <Field label="نوع فروش">
          <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} style={{ width: 140 }}>
            <option value="">همه</option>
            {Object.values(OrderKind).map((k) => (
              <option key={k} value={k}>
                {ORDER_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="حوزه">
          <select className="select" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} style={{ width: 180 }}>
            <option value="">همه</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="پلن">
          <select className="select" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })} style={{ width: 150 }}>
            <option value="">همه</option>
            {plans.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="تخفیف">
          <select className="select" value={f.discountId} onChange={(e) => setF({ ...f, discountId: e.target.value })} style={{ width: 160 }}>
            <option value="">همه</option>
            {discounts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error || !q.data || !s ? (
        <ErrorBox error={q.error} retry={() => void q.refetch()} />
      ) : (
        <div className={q.isFetching ? 'refetching' : ''}>
          <div className="grid grid-4" style={{ marginBottom: 18 }}>
            <div className="card stat" data-testid="report-paid">
              <span className="label">فروش قطعی</span>
              <div className="value">
                {formatNumberFa(s.paidTotal)}
                <small>تومان</small>
              </div>
              <div className="foot">
                خدمات {formatToman(s.servicesTotal)} · اشتراک {formatToman(s.subscriptionsTotal)}
              </div>
            </div>
            <div className="card stat">
              <span className="label">سفارش‌های پرداخت‌شده</span>
              <div className="value">{formatNumberFa(s.paidCount)}</div>
              <div className="foot">ناموفق در بازه: {formatNumberFa(s.failedCount)}</div>
            </div>
            <div className="card stat">
              <span className="label">تخفیف اعمال‌شده</span>
              <div className="value">
                {formatNumberFa(s.discountTotal)}
                <small>تومان</small>
              </div>
            </div>
            <Link to="/payments?status=UNKNOWN" className="card stat" data-testid="report-unknown">
              <span className="label">پرداخت نامشخص (جدا از فروش قطعی)</span>
              <div className="value">
                {formatNumberFa(s.unknownTotal)}
                <small>تومان</small>
              </div>
              <div className="foot">{formatNumberFa(s.unknownCount)} سفارش نیازمند تعیین تکلیف</div>
            </Link>
          </div>
          {s.unknownCount > 0 && (
            <div style={{ marginBottom: 18 }}>
              <Alert tone="warning">مبالغ نامشخص تا تعیین تکلیف (استعلام یا تطبیق) در فروش قطعی محاسبه نمی‌شوند.</Alert>
            </div>
          )}
          <div className="grid grid-2-1" style={{ marginBottom: 18 }}>
            <Card title="روند روزانه فروش قطعی">
              <DailyColumns data={q.data.byDay} />
            </Card>
            <Card title="به تفکیک حوزه">
              <BarList rows={q.data.byCategory} />
            </Card>
          </div>
          <div className="grid grid-2">
            <Card title="به تفکیک خدمت" bodyClass="">
              <BucketTable rows={q.data.byService} label="خدمت" />
            </Card>
            <div className="grid" style={{ alignContent: 'start' }}>
              <Card title="به تفکیک پلن اشتراک" bodyClass="">
                <BucketTable rows={q.data.byPlan} label="پلن" />
              </Card>
              <Card title="به تفکیک تخفیف" bodyClass="">
                <BucketTable rows={q.data.byDiscount} label="تخفیف" />
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
