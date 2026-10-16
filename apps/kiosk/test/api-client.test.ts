/**
 * Responses that do not come from our server (proxy error pages, captive portals) must read as
 * "server unreachable", never as a business rejection or a crash.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiResponseError, NetworkError } from '../src/core/api-client';
import type { KioskConfig } from '../src/core/config';

const cfg = { serverUrl: 'http://server.test', deviceId: 'KIOSK-01', deviceKey: 'k', requestTimeoutMs: 1000 } as KioskConfig;

function respond(status: number, body: string, contentType = 'text/html') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': contentType } })));
}

describe('ApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats an HTML 502 from a proxy as a server outage', async () => {
    respond(502, '<html><body>Bad Gateway</body></html>');
    const online: boolean[] = [];
    const api = new ApiClient(cfg, (o) => online.push(o));
    const err = await api.get('/device/bootstrap').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiResponseError);
    expect((err as ApiResponseError).status).toBe(502);
    expect(online).toEqual([false]);
  });

  it('treats a non-JSON 200 or 4xx (captive portal) as a network problem', async () => {
    const online: boolean[] = [];
    const api = new ApiClient(cfg, (o) => online.push(o));
    respond(200, '<html>Wi-Fi login</html>');
    await expect(api.get('/device/bootstrap')).rejects.toBeInstanceOf(NetworkError);
    respond(403, 'Forbidden by proxy', 'text/plain');
    await expect(api.post('/access/validate', {})).rejects.toBeInstanceOf(NetworkError);
    expect(online).toEqual([false, false]);
  });

  it('passes structured server errors through and reports the server reachable', async () => {
    respond(409, JSON.stringify({ error: { code: 'CONFLICT', message: 'قبلاً پرداخت شده', details: { a: 1 } } }), 'application/json');
    const online: boolean[] = [];
    const api = new ApiClient(cfg, (o) => online.push(o));
    const err = (await api.post('/payments/initiate', {}).catch((e: unknown) => e)) as ApiResponseError;
    expect(err).toBeInstanceOf(ApiResponseError);
    expect([err.status, err.code, err.message, err.details]).toEqual([409, 'CONFLICT', 'قبلاً پرداخت شده', { a: 1 }]);
    expect(online).toEqual([true]);
  });

  it('times out a body that stalls after the headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"partial":'));
            init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );
    const api = new ApiClient({ ...cfg, requestTimeoutMs: 50 }, () => undefined);
    await expect(api.get('/device/bootstrap')).rejects.toBeInstanceOf(NetworkError);
  });
});
