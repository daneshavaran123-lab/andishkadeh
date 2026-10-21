/** What the technician enters on the setup screen (web app, Android app, Windows first run). */
export interface SetupValues {
  serverUrl: string;
  deviceId: string;
  deviceKey: string;
  payment: 'mock' | 'none';
  /** browser | mock in the web app; windows | mock on Windows. */
  printer: string;
  /** Windows: name of the receipt printer. */
  printerName?: string;
  scanner: 'keyboard' | 'mock';
  devControls: boolean;
}

export type SetupCheck = { ok: true } | { ok: false; reason: 'auth' | 'network' | 'server'; message: string };

/** Checks address and credentials against the server before saving. */
export async function verifySetup(s: Pick<SetupValues, 'serverUrl' | 'deviceId' | 'deviceKey'>): Promise<SetupCheck> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${s.serverUrl.replace(/\/+$/, '')}/api/v1/kiosk/bootstrap`, {
      headers: { Authorization: `Device ${s.deviceId}:${s.deviceKey}` },
      signal: ctrl.signal,
    });
    if (res.ok) {
      // A captive portal or proxy page also answers 200: only our server returns the bootstrap JSON.
      const body = (await res.json().catch(() => null)) as { catalogRevision?: unknown } | null;
      if (body && typeof body.catalogRevision === 'number') return { ok: true };
      return { ok: false, reason: 'server', message: 'این آدرس به سرور اندیشکده نمی‌رسد' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth', message: 'شناسه یا کلید دستگاه پذیرفته نشد' };
    return { ok: false, reason: 'server', message: `پاسخ نامعتبر از سرور (${res.status})` };
  } catch {
    return { ok: false, reason: 'network', message: 'سرور در دسترس نیست؛ آدرس و اتصال شبکه را بررسی کنید' };
  } finally {
    clearTimeout(timer);
  }
}

export type ActivationResult =
  | { ok: true; deviceId: string; deviceName: string; deviceKey: string }
  | { ok: false; reason: 'code' | 'limit' | 'network' | 'server'; message: string };

/**
 * Exchanges a one-time activation code from the panel for this kiosk's id and key (the key is
 * replaced on the server, so the code works once).
 */
export async function activateDevice(serverUrl: string, code: string): Promise<ActivationResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/kiosk/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as { deviceId?: unknown; deviceName?: unknown; deviceKey?: unknown; error?: { message?: string } } | null;
    if (res.ok && typeof body?.deviceId === 'string' && typeof body.deviceKey === 'string') {
      return { ok: true, deviceId: body.deviceId, deviceName: typeof body.deviceName === 'string' ? body.deviceName : body.deviceId, deviceKey: body.deviceKey };
    }
    if (res.status === 400) return { ok: false, reason: 'code', message: body?.error?.message ?? 'کد فعال‌سازی پذیرفته نشد؛ از پنل کد تازه بگیرید' };
    if (res.status === 429) return { ok: false, reason: 'limit', message: body?.error?.message ?? 'تعداد تلاش‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید' };
    if (res.ok || res.status === 404) return { ok: false, reason: 'server', message: 'این آدرس به سرور اندیشکده نمی‌رسد (یا نسخه سرور برای کد فعال‌سازی قدیمی است)' };
    return { ok: false, reason: 'server', message: `پاسخ نامعتبر از سرور (${res.status})` };
  } catch {
    return { ok: false, reason: 'network', message: 'سرور در دسترس نیست؛ آدرس سرور و اتصال شبکه را بررسی کنید' };
  } finally {
    clearTimeout(timer);
  }
}
