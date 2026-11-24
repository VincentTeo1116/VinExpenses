import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, callFunction } from './api';

const base = { baseUrl: 'https://x.supabase.co', anonKey: 'anon-key-12345678901234567890' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('callFunction (REL-01, SEC-03)', () => {
  it('posts JSON with the public key and the signed-in token, and sends no cookies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { ok: true }));
    await callFunction('auth-gate', { action: 'signin' }, { ...base, accessToken: 'tok', fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/functions/v1/auth-gate');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'signin' });
  });

  it('falls back to the public key when there is no session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, {}));
    await callFunction('feedback', {}, { ...base, fetchImpl });
    expect(((fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe(`Bearer ${base.anonKey}`);
  });

  it('refuses a service name that could change the address', async () => {
    const fetchImpl = vi.fn();
    for (const bad of ['../rest/v1/expenses', 'a/b', 'A', '', 'x?y=1']) await expect(callFunction(bad, {}, { ...base, fetchImpl })).rejects.toMatchObject({ code: 'bad_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps HTTP errors to codes and keeps the server message and extra fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(429, { message: 'Too many tries', until: '2026-01-01T00:00:00Z' }));
    const error = await callFunction('auth-gate', {}, { ...base, fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429, message: 'Too many tries' });
    expect((error as ApiError).details.until).toBe('2026-01-01T00:00:00Z');
    for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [400, 'bad_request'], [503, 'server']] as const) {
      const f = vi.fn().mockResolvedValue(reply(status, {}));
      await expect(callFunction('x1', {}, { ...base, fetchImpl: f })).rejects.toMatchObject({ code });
    }
  });

  it('does not retry a refusal (4xx), even when retries are allowed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(401, {}));
    await expect(callFunction('x1', {}, { ...base, retries: 3, fetchImpl })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a temporary server error up to the allowed number, then succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(503, {})).mockResolvedValueOnce(reply(200, { ok: 1 }));
    await expect(callFunction('x1', {}, { ...base, retries: 2, fetchImpl })).resolves.toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries and reports a server error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(500, {}));
    await expect(callFunction('x1', {}, { ...base, retries: 1, fetchImpl })).rejects.toMatchObject({ code: 'server' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('times out instead of hanging', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(callFunction('x1', {}, { ...base, timeoutMs: 20, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports a network failure as offline', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(callFunction('x1', {}, { ...base, fetchImpl })).rejects.toMatchObject({ code: 'offline' });
  });

  it('does not even try when the browser says it is offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchImpl = vi.fn();
    await expect(callFunction('x1', {}, { ...base, fetchImpl })).rejects.toMatchObject({ code: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('checks the reply against a schema, and a wrong shape is refused', async () => {
    const schema = z.object({ ok: z.literal(true) });
    await expect(callFunction('x1', {}, { ...base, schema, fetchImpl: vi.fn().mockResolvedValue(reply(200, { ok: true })) })).resolves.toEqual({ ok: true });
    await expect(callFunction('x1', {}, { ...base, schema, fetchImpl: vi.fn().mockResolvedValue(reply(200, { ok: 'yes' })) })).rejects.toMatchObject({ code: 'invalid_reply' });
  });

  it('survives a reply that is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 502 }));
    await expect(callFunction('x1', {}, { ...base, fetchImpl })).rejects.toMatchObject({ code: 'server' });
  });
});
