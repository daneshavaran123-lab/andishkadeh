/**
 * Receipt layout for 80 mm thermal printers. HTML (RTL, Vazirmatn) is printed through the
 * Windows driver so Persian shaping is correct; a plain-text version is kept for logs.
 * Contains no card data and only the masked mobile number (PRD §18).
 */
import QRCode from 'qrcode';
import {
  ORDER_KIND_LABEL,
  formatJalaliDate,
  formatJalaliDateTime,
  formatNumberFa,
  formatToman,
  type ReceiptData,
} from '@andishkadeh/shared';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function receiptHtml(r: ReceiptData, fontUrl?: string): Promise<string> {
  const qr = r.subscription?.qrToken
    ? await QRCode.toString(r.subscription.qrToken, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220 })
    : '';
  const rows = r.lines
    .map(
      (l) => `<tr><td class="t"><div>${esc(l.title)}</div><div class="c" dir="ltr">${esc(l.code)} × ${l.quantity}</div></td>
      <td class="n">${formatNumberFa(l.lineTotal)}${l.unitDiscount ? `<div class="d">تخفیف ${formatNumberFa(l.unitDiscount * l.quantity)}</div>` : ''}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
${fontUrl ? `@font-face{font-family:Vazirmatn;src:url('${fontUrl}') format('woff2');font-weight:100 900;}` : ''}
@page{size:80mm auto;margin:3mm}
body{font-family:Vazirmatn,Tahoma,sans-serif;width:72mm;margin:0;color:#000;font-size:12px}
h1{font-size:16px;text-align:center;margin:0 0 2px}
.sub{text-align:center;font-size:11px;margin-bottom:6px}
.meta{display:flex;justify-content:space-between;font-size:11px;margin:2px 0}
.ltr{direction:ltr;unicode-bidi:embed}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
table{width:100%;border-collapse:collapse}
td{vertical-align:top;padding:3px 0}
.t{width:70%}.n{text-align:left;white-space:nowrap}
.c{font-size:10px;color:#333}.d{font-size:10px}
.tot{font-weight:700;font-size:15px}
.qr{text-align:center;margin-top:6px}.qr svg{width:44mm;height:44mm}
.foot{font-size:10px;text-align:center;margin-top:6px}
.badge{border:1px solid #000;padding:1px 4px;font-size:10px}
</style></head><body>
<h1>${esc(r.centerName)}</h1>
<div class="sub">${esc(r.header)}${r.reprint ? ' — <span class="badge">چاپ مجدد</span>' : ''}</div>
<div class="meta"><span>شماره سفارش</span><span class="ltr">${esc(r.orderNumber)}</span></div>
<div class="meta"><span>تاریخ</span><span>${formatJalaliDateTime(r.paidAt ?? r.createdAt, r.timezone)}</span></div>
<div class="meta"><span>نوع</span><span>${ORDER_KIND_LABEL[r.kind]}</span></div>
<div class="meta"><span>موبایل</span><span class="ltr">${esc(r.mobileMasked)}</span></div>
${r.offline ? '<div class="meta"><span class="badge">ثبت آفلاین — در انتظار همگام‌سازی</span></div>' : ''}
<hr><table>${rows}</table><hr>
<div class="meta"><span>جمع</span><span>${formatToman(r.subtotal)}</span></div>
${r.discountTotal ? `<div class="meta"><span>تخفیف</span><span>${formatToman(r.discountTotal)}</span></div>` : ''}
<div class="meta tot"><span>مبلغ پرداخت‌شده</span><span>${formatToman(r.total)}</span></div>
${r.payment.terminalRef ? `<div class="meta"><span>مرجع کارتخوان</span><span class="ltr">${esc(r.payment.terminalRef)}</span></div>` : ''}
${r.payment.rrn ? `<div class="meta"><span>شماره پیگیری بانک</span><span class="ltr">${esc(r.payment.rrn)}</span></div>` : ''}
${
  r.subscription
    ? `<hr><div class="meta"><span>اشتراک</span><span>${esc(r.subscription.planTitle)}</span></div>
<div class="meta"><span>شروع</span><span>${formatJalaliDate(r.subscription.startsAt, r.timezone)}</span></div>
<div class="meta"><span>پایان اعتبار</span><span>${formatJalaliDate(r.subscription.expiresAt, r.timezone)}</span></div>
${qr ? `<div class="qr">${qr}<div>کارت عضویت — این کد را نزد خود نگه دارید</div></div>` : '<div class="foot">QR در چاپ مجدد درج نمی‌شود؛ برای صدور مجدد به پذیرش مراجعه کنید.</div>'}`
    : ''
}
<div class="foot">${esc(r.footer)}</div>
</body></html>`;
}

/** 48-column plain text (Font A on 80 mm) used for logs and the mock printer. */
export function receiptText(r: ReceiptData): string {
  const W = 48;
  const line = '-'.repeat(W);
  const out = [r.centerName, r.header + (r.reprint ? ' (چاپ مجدد)' : ''), line];
  out.push(`سفارش: ${r.orderNumber}`, `تاریخ: ${formatJalaliDateTime(r.paidAt ?? r.createdAt, r.timezone)}`, `موبایل: ${r.mobileMasked}`);
  if (r.offline) out.push('ثبت آفلاین - در انتظار همگام‌سازی');
  out.push(line);
  for (const l of r.lines) out.push(`${l.code} × ${l.quantity}  ${l.title}`, `    ${formatToman(l.lineTotal)}`);
  out.push(line, `جمع: ${formatToman(r.subtotal)}`);
  if (r.discountTotal) out.push(`تخفیف: ${formatToman(r.discountTotal)}`);
  out.push(`پرداخت‌شده: ${formatToman(r.total)}`);
  if (r.payment.terminalRef) out.push(`مرجع کارتخوان: ${r.payment.terminalRef}`);
  if (r.subscription) {
    out.push(line, `اشتراک: ${r.subscription.planTitle}`, `اعتبار تا: ${formatJalaliDate(r.subscription.expiresAt, r.timezone)}`);
    if (r.subscription.qrToken) out.push('[QR عضویت چاپ شد]');
  }
  out.push(line, r.footer);
  return out.join('\n') + '\n';
}
