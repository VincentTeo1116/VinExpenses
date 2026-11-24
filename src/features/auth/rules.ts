// AU-04: the checks the form shows while someone types. The server checks every one of them again
// (supabase/functions/_shared/auth-rules.ts), and a test keeps this copy in step with that file.

export const LIMITS = { passwordMin: 10, passwordMax: 72, codeMinutes: 5, rememberDays: 30 } as const;

export type RuleKey = 'length' | 'upper' | 'lower' | 'digit' | 'symbol';
export interface PasswordRule {
  key: RuleKey;
  met: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  const value = String(password ?? '');
  return [
    { key: 'length', met: value.length >= LIMITS.passwordMin && value.length <= LIMITS.passwordMax },
    { key: 'upper', met: /[A-Z]/.test(value) },
    { key: 'lower', met: /[a-z]/.test(value) },
    { key: 'digit', met: /\d/.test(value) },
    { key: 'symbol', met: /[^A-Za-z0-9\s]/.test(value) },
  ];
}

export const passwordOk = (password: string): boolean => passwordRules(password).every((rule) => rule.met);

/** A tidy lower-case address, or "" when it is not an email address. */
export function cleanEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) ? email : '';
}

export function cleanName(value: unknown): string {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 40 && !/[<>]/.test(name) ? name : '';
}

/** Keeps only digits and at most six of them, so a pasted "123 456" still works. */
export const digitsOnly = (value: string, max = 6): string => String(value ?? '').replace(/\D/g, '').slice(0, max);
export const isCode = (value: string): boolean => /^\d{6}$/.test(value);

export function cleanRecoveryCode(value: unknown): string {
  const text = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return text.length === 10 ? `${text.slice(0, 5)}-${text.slice(5)}` : '';
}

/** "m:ss" for a countdown of up to an hour, "h:mm:ss" beyond. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
