// REL-01 / SEC-03: every call to an Edge Function has a timeout, a limited retry for safe calls, and a human error.
// The browser never decides anything about security; it only asks, and shows what the server answers.
import type { ZodType } from 'zod';

export type ApiErrorCode = 'offline' | 'timeout' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'bad_request' | 'server' | 'invalid_reply' | 'not_configured';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Extra fields the server sent with a refusal, such as the end time of a sign-in pause. */
  readonly details: Record<string, unknown>;
  constructor(code: ApiErrorCode, message: string, status = 0, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface CallOptions<T> {
  baseUrl: string;
  anonKey: string;
  accessToken?: string | undefined;
  timeoutMs?: number;
  /** Only calls that are safe to repeat may retry. A sign-in or a payment must not. */
  retries?: number;
  schema?: ZodType<T>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function statusToCode(status: number): ApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'server';
}

export async function callFunction<T = unknown>(name: string, body: unknown, options: CallOptions<T>): Promise<T> {
  if (!/^[a-z0-9-]{2,40}$/.test(name)) throw new ApiError('bad_request', 'That is not a valid service name.');
  const { baseUrl, anonKey, accessToken, timeoutMs = 15000, retries = 0, schema, signal } = options;
  const doFetch = options.fetchImpl ?? fetch;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('offline', 'You appear to be offline.');

  let lastError: ApiError = new ApiError('server', 'Something went wrong.');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await doFetch(`${baseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${accessToken ?? anonKey}` },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
        const message = typeof record.message === 'string' ? record.message : typeof record.error === 'string' ? record.error : 'Something went wrong. Please try again.';
        lastError = new ApiError(statusToCode(response.status), message, response.status, record);
        // 5xx and rate limits may be temporary; other refusals will not change on a retry
        if (response.status < 500 || attempt === retries) throw lastError;
      } else {
        if (schema) {
          const parsed = schema.safeParse(payload);
          if (!parsed.success) throw new ApiError('invalid_reply', 'The server answered in a way the app did not expect.', response.status);
          return parsed.data;
        }
        return payload as T;
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error === lastError && attempt < retries && error.code === 'server') {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      lastError = aborted && !signal?.aborted ? new ApiError('timeout', 'The server took too long to answer.') : new ApiError('offline', 'The app could not reach the server.');
      if (signal?.aborted || attempt === retries) throw lastError;
      await sleep(250 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError;
}
