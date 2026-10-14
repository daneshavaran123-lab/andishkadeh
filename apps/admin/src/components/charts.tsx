/**
 * Charts follow the dataviz method: one hue (validated #2a78d6 on white), bars ≤ 24px with a
 * 4px rounded data end, hairline grid, per-bar hover/focus tooltip, values also reachable in a
 * table view. Time runs in reading direction (RTL: oldest on the right).
 */
import { useEffect, useRef, useState } from 'react';
import { formatJalaliDayMonth, formatNumberFa, formatToman, toPersianDigits } from '@andishkadeh/shared';
import { Icon } from './Icon';

/** 12_500_000 → "۱۲٫۵ م" (million Toman), 800_000 → "۸۰۰ ه" (thousand). */
export function compactToman(v: number): string {
  if (v >= 1_000_000_000) return `${toPersianDigits(+(v / 1_000_000_000).toFixed(1))} میلیارد`;
  if (v >= 1_000_000) return `${toPersianDigits(+(v / 1_000_000).toFixed(1))} م`;
  if (v >= 1_000) return `${toPersianDigits(Math.round(v / 1_000))} ه`;
  return toPersianDigits(v);
}

function niceStep(max: number, ticks = 4): number {
  if (max <= 0) return 1;
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface DayPoint {
  date: string;
  total: number;
  count: number;
}

export function DailyColumns({ data, height = 240, countLabel = 'سفارش' }: { data: DayPoint[]; height?: number; countLabel?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pad = { top: 16, bottom: 28, left: 8, right: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.total), 0);
  const step = niceStep(max);
  const top = Math.max(step * Math.ceil(max / step), step);
  const band = innerW / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(4, band * 0.62));
  // RTL: index 0 (oldest) sits at the right edge.
  const xOf = (i: number) => pad.left + innerW - (i + 0.5) * band;
  const yOf = (v: number) => pad.top + innerH - (v / top) * innerH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 70)));

  if (table) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button className="btn btn-sm" onClick={() => setTable(false)}>
            <Icon name="chart" />
            نمایش نمودار
          </button>
        </div>
        <div className="table-wrap" style={{ maxHeight: height + 40, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>تاریخ</th>
                <th className="n">مبلغ</th>
                <th className="n">{countLabel}</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{formatJalaliDayMonth(d.date)}</td>
                  <td className="n">{formatToman(d.total)}</td>
                  <td className="n">{formatNumberFa(d.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const h = hover !== null ? data[hover] : null;
  return (
    <div className="chart" ref={ref}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setTable(true)} aria-label="نمایش جدول داده‌ها">
          <Icon name="table" />
          جدول
        </button>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label="نمودار ستونی فروش روزانه" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={pad.left + innerW} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
            <text x={width - 4} y={yOf(t) + 4} textAnchor="end" className="tick">
              {compactToman(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = xOf(i);
          const y = yOf(d.total);
          const hBar = pad.top + innerH - y;
          const r = Math.min(4, barW / 2, hBar);
          return (
            <g key={d.date}>
              {d.total > 0 && (
                <path
                  d={`M${x - barW / 2},${pad.top + innerH} V${y + r} Q${x - barW / 2},${y} ${x - barW / 2 + r},${y} H${x + barW / 2 - r} Q${x + barW / 2},${y} ${x + barW / 2},${y + r} V${pad.top + innerH} Z`}
                  fill="var(--series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={x} y={height - 8} textAnchor="middle" className="tick">
                  {formatJalaliDayMonth(d.date)}
                </text>
              )}
              {/* hit target: the whole band, larger than the mark */}
              <rect
                x={x - band / 2}
                y={pad.top}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${formatJalaliDayMonth(d.date)}: ${formatToman(d.total)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="chart-tip" style={{ left: xOf(hover), top: yOf(h.total) - 6 }}>
          <b>{formatToman(h.total)}</b>
          {formatJalaliDayMonth(h.date)} · {formatNumberFa(h.count)} {countLabel}
        </div>
      )}
    </div>
  );
}

/** Magnitude comparison of a few named buckets (sorted horizontal bars, value at the tip). */
export function BarList({ rows, empty = 'داده‌ای برای نمایش نیست' }: { rows: Array<{ key: string; title: string; total: number; extra?: string }>; empty?: string }) {
  const max = Math.max(...rows.map((r) => r.total), 0);
  const sum = rows.reduce((s, r) => s + r.total, 0);
  if (!rows.length || max === 0) return <div className="empty">{empty}</div>;
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div className="row" key={r.key} title={`${r.title}: ${formatToman(r.total)}`}>
          <span className="name">{r.title}</span>
          <span className="track">
            <span className="fill" style={{ display: 'block', width: `${Math.max(2, (r.total / max) * 100)}%` }} />
          </span>
          <span className="val">
            {compactToman(r.total)} <span className="muted" style={{ fontWeight: 500 }}>({toPersianDigits(Math.round((r.total / sum) * 100))}٪)</span>
          </span>
        </div>
      ))}
    </div>
  );
}
