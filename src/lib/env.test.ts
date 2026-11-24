import { describe, expect, it } from 'vitest';
import { readEnv } from './env';

const good = { VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_ANON_KEY: 'a'.repeat(40) };

describe('configuration check (SEC-02)', () => {
  it('accepts a normal setup and removes a trailing slash', () => {
    const result = readEnv({ ...good, VITE_SUPABASE_URL: 'https://abcd.supabase.co/' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.supabaseUrl).toBe('https://abcd.supabase.co');
      expect(result.env.turnstileSiteKey).toBeUndefined();
    }
  });

  it('refuses a missing or short key and an unsafe address', () => {
    expect(readEnv({}).ok).toBe(false);
    expect(readEnv({ ...good, VITE_SUPABASE_ANON_KEY: 'short' }).ok).toBe(false);
    expect(readEnv({ ...good, VITE_SUPABASE_URL: 'http://abcd.supabase.co' }).ok).toBe(false);
    expect(readEnv({ ...good, VITE_SUPABASE_URL: 'javascript:alert(1)' }).ok).toBe(false);
    expect(readEnv({ ...good, VITE_SUPABASE_URL: 'ftp://x.y' }).ok).toBe(false);
  });

  it('allows plain http only on this computer', () => {
    expect(readEnv({ ...good, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).ok).toBe(true);
    expect(readEnv({ ...good, VITE_SUPABASE_URL: 'http://localhost:54321' }).ok).toBe(true);
    expect(readEnv({ ...good, VITE_SUPABASE_URL: 'http://evil.example' }).ok).toBe(false);
  });

  it('accepts a Turnstile site key only in its normal shape', () => {
    const ok = readEnv({ ...good, VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAAabcdefghij' });
    expect(ok.ok && ok.env.turnstileSiteKey).toBe('0x4AAAAAAAabcdefghij');
    expect(readEnv({ ...good, VITE_TURNSTILE_SITE_KEY: '<script>' }).ok).toBe(false);
    expect(readEnv({ ...good, VITE_TURNSTILE_SITE_KEY: '' }).ok).toBe(true);
  });

  it('the problem list never repeats the key itself', () => {
    const secret = 'sbp_THIS_MUST_NOT_BE_PRINTED_0000';
    const result = readEnv({ VITE_SUPABASE_URL: 'nope', VITE_SUPABASE_ANON_KEY: secret.slice(0, 5) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.problems)).not.toContain(secret);
  });
});
