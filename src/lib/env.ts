// NFR SEC-02 / REL-01: configuration is checked once, at start. Only public values are ever read here.
// Plain checks (no validation library) so this tiny file does not pull a large library into the first download.

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  turnstileSiteKey: string | undefined;
}

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; problems: string[] };

function checkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'VITE_SUPABASE_URL: The Supabase address is missing.';
  try {
    const url = new URL(value);
    const safe = url.protocol === 'https:' || (url.protocol === 'http:' && isLocal(url.hostname));
    return safe ? null : 'VITE_SUPABASE_URL: The Supabase address must use https (http is only allowed on this computer).';
  } catch {
    return 'VITE_SUPABASE_URL: That is not a valid address.';
  }
}

/** Checks raw values. A pure function, so it can be tested without a browser. */
export function readEnv(raw: Record<string, unknown>): EnvResult {
  const problems: string[] = [];
  const urlProblem = checkUrl(raw.VITE_SUPABASE_URL);
  if (urlProblem) problems.push(urlProblem);

  const key = raw.VITE_SUPABASE_ANON_KEY;
  if (typeof key !== 'string' || key.length < 20) problems.push('VITE_SUPABASE_ANON_KEY: The public Supabase key is missing or too short.');

  const site = raw.VITE_TURNSTILE_SITE_KEY;
  const hasSite = typeof site === 'string' && site !== '';
  if (hasSite && !/^[0-9A-Za-z_-]{10,}$/.test(site)) problems.push('VITE_TURNSTILE_SITE_KEY: That does not look like a Turnstile site key.');

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    env: { supabaseUrl: (raw.VITE_SUPABASE_URL as string).replace(/\/+$/, ''), supabaseAnonKey: key as string, turnstileSiteKey: hasSite ? (site as string) : undefined },
  };
}

export const envResult: EnvResult = readEnv(import.meta.env as Record<string, unknown>);
