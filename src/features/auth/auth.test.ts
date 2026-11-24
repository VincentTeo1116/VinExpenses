// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digitsOnly, formatCountdown } from './rules';
import { deviceId, forgetDeviceChoices, setRemember, shouldSignOutOnStart } from './device';
import { replyText, isCodeLimit } from './replyText';
import { translate } from '@/lib/i18n';
import { signInSchema, registerSchema, resetSchema, contactSchema, mfaRecoverySchema } from './schemas';

const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('en', key, values);

describe('small helpers', () => {
  it('keeps only up to six digits, so a pasted "123 456" works', () => {
    expect(digitsOnly('12ab34cd56')).toBe('123456');
    expect(digitsOnly('123 456 789')).toBe('123456');
    expect(digitsOnly('')).toBe('');
  });

  it('formats a countdown as m:ss, or h:mm:ss over an hour', () => {
    expect(formatCountdown(300_000)).toBe('5:00');
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(3 * 3600_000)).toBe('3:00:00');
    expect(formatCountdown(3600_000 + 61_000)).toBe('1:01:01');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('device id and remember me (AU-06)', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('makes one random id, keeps it, and replaces a damaged one', () => {
    const first = deviceId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(deviceId()).toBe(first);
    localStorage.setItem('et_device', 'bad id!');
    expect(deviceId()).not.toBe('bad id!');
    expect(deviceId()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('still gives an id when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const id = deviceId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(deviceId()).toBe(id);
  });

  it('remembered for 30 days: not signed out on start, even in a new browser session', () => {
    const now = Date.UTC(2026, 0, 1);
    setRemember(true, now);
    sessionStorage.clear();
    expect(shouldSignOutOnStart(now + 29 * 86_400_000)).toBe(false);
    expect(shouldSignOutOnStart(now + 31 * 86_400_000)).toBe(true);
  });

  it('not remembered: kept only while the browser session lasts', () => {
    setRemember(false, 1000);
    expect(shouldSignOutOnStart(2000)).toBe(false); // same browser session
    sessionStorage.clear();
    expect(shouldSignOutOnStart(2000)).toBe(true); // browser was closed
  });

  it('nothing saved (an older sign-in) or a damaged value leaves the person signed in', () => {
    expect(shouldSignOutOnStart()).toBe(false);
    localStorage.setItem('et_remember_until', 'not-a-number');
    expect(shouldSignOutOnStart()).toBe(false);
  });

  it('forgetting clears the choice', () => {
    setRemember(true);
    forgetDeviceChoices();
    expect(localStorage.getItem('et_remember_until')).toBeNull();
  });
});

describe('reply wording', () => {
  it('turns every known answer into the chosen language, and never shows the server English when it can translate', () => {
    for (const code of ['invalid', 'exists', 'code_limit_day', 'code_limit_month', 'slow_down', 'bad_code', 'weak_password', 'same_password', 'captcha', 'disabled', 'offline', 'timeout', 'server']) {
      const english = replyText({ ok: false, code, message: 'SERVER ENGLISH' }, t);
      const malay = replyText({ ok: false, code, message: 'SERVER ENGLISH' }, (k, v) => translate('ms', k, v));
      const chinese = replyText({ ok: false, code, message: 'SERVER ENGLISH' }, (k, v) => translate('zh', k, v));
      expect(english, code).not.toBe('SERVER ENGLISH');
      expect(malay, code).not.toBe(english);
      expect(chinese, code).not.toBe(english);
    }
  });

  it('uses the server text only for an unknown code, and a generic line when there is none', () => {
    expect(replyText({ ok: false, code: 'something_new', message: 'Custom' }, t)).toBe('Custom');
    expect(replyText({ ok: false }, t)).toBe(t('reply.generic'));
  });

  it('a wrong recovery code has its own wording', () => {
    expect(replyText({ ok: false, code: 'invalid' }, t, 'recovery')).toBe(t('reply.badRecovery'));
  });

  it('knows a code limit when it sees one', () => {
    expect(isCodeLimit({ ok: false, code: 'code_limit_day' })).toBe(true);
    expect(isCodeLimit({ ok: false, code: 'code_limit_month' })).toBe(true);
    expect(isCodeLimit({ ok: false, code: 'invalid' })).toBe(false);
  });
});

describe('form schemas', () => {
  it('sign-in needs an email and a password, and says which is missing', () => {
    const result = signInSchema(t).safeParse({ email: '', password: '', remember: true });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('Enter your email.');
    expect(messages).toContain('Enter your password.');
    expect(signInSchema(t).safeParse({ email: ' A@B.CO ', password: 'x', remember: false }).success).toBe(true);
  });

  it('register refuses a weak password and a mismatch, each on its own field', () => {
    const base = { name: 'Dina', email: 'd@x.co', password: 'Str0ng!Passw0rd', confirm: 'Str0ng!Passw0rd' };
    expect(registerSchema(t).safeParse(base).success).toBe(true);
    const weak = registerSchema(t).safeParse({ ...base, password: 'weak', confirm: 'weak' });
    expect(weak.error?.issues.some((i) => i.path[0] === 'password')).toBe(true);
    const mismatch = registerSchema(t).safeParse({ ...base, confirm: 'Other!Passw0rd1' });
    expect(mismatch.error?.issues.find((i) => i.path[0] === 'confirm')?.message).toBe('The two passwords do not match.');
    expect(registerSchema(t).safeParse({ ...base, name: '<b>' }).error?.issues[0]?.message).toBe('Use 2 to 40 characters, without < or >.');
  });

  it('reset needs a 6-digit code and a strong password', () => {
    expect(resetSchema(t).safeParse({ code: '123456', password: 'Str0ng!Passw0rd', confirm: 'Str0ng!Passw0rd' }).success).toBe(true);
    expect(resetSchema(t).safeParse({ code: '12345', password: 'Str0ng!Passw0rd', confirm: 'Str0ng!Passw0rd' }).success).toBe(false);
  });

  it('recovery code accepts any case and a missing dash', () => {
    expect(mfaRecoverySchema(t).safeParse({ code: 'abcdefghjk', password: 'x' }).success).toBe(true);
    expect(mfaRecoverySchema(t).safeParse({ code: 'abc', password: 'x' }).success).toBe(false);
  });

  it('contact: signed-in people are not asked for an email; message length is limited both ways', () => {
    const ok = { email: '', topic: 'bug', message: 'Something broke today' };
    expect(contactSchema(t, true).safeParse(ok).success).toBe(true);
    expect(contactSchema(t, false).safeParse(ok).success).toBe(false);
    expect(contactSchema(t, true).safeParse({ ...ok, topic: 'hack' }).success).toBe(false);
    expect(contactSchema(t, true).safeParse({ ...ok, message: 'hey' }).success).toBe(false);
    expect(contactSchema(t, true).safeParse({ ...ok, message: 'x'.repeat(2001) }).success).toBe(false);
  });
});
