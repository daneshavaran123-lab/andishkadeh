import { newId } from '@andishkadeh/shared';
import type { KioskConfig } from './config';

/** The server answered with a structured error (4xx/5xx). Never retried blindly for writes. */
export class ApiResponseError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The server could not be reached (offline, DNS, timeout). Safe to fall back to offline mode. */
export class NetworkError extends Error {}

export class ApiClient {
  /** Test hook: simulate a network cut without touching the real network. */
  forcedOffline = false;

  constructor(
    private readonly cfg: KioskConfig,
    private readonly onConnectivity: (online: boolean) => void,
  ) {}

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = this.cfg.requestTimeoutMs): Promise<T> {
    if (this.forcedOffline) {
      this.onConnectivity(false);
      throw new NetworkError('network disabled (simulated)');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.cfg.serverUrl.replace(/\/$/, '')}/api/v1${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          Authorization: `Device ${this.cfg.deviceId}:${this.cfg.deviceKey}`,
          'Content-Type': 'application/json',
          'X-Request-Id': newId(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      this.onConnectivity(false);
      throw new NetworkError((e as Error).message);
    } finally {
      clearTimeout(timer);
    }
    this.onConnectivity(true);
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      // 5xx and auth problems are treated like "server not usable right now".
      if (res.status >= 500) this.onConnectivity(false);
      throw new ApiResponseError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? res.statusText, err?.details);
    }
    return json as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown, timeoutMs?: number) {
    return this.request<T>('POST', path, body, timeoutMs);
  }

  async download(url: string, timeoutMs = 30_000): Promise<Uint8Array> {
    if (this.forcedOffline) throw new NetworkError('network disabled (simulated)');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new ApiResponseError(res.status, 'DOWNLOAD_FAILED', `download failed ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof ApiResponseError) throw e;
      throw new NetworkError((e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}
