// The words for every answer the sign-in service can give, in the chosen language.
// The server's own English text is only a last resort, so Malay and Chinese readers never see a mixed screen.
import type { MessageKey } from '@/lib/i18n';
import type { GateReply } from './gate';

type T = (key: MessageKey, values?: Record<string, string | number>) => string;

const BY_CODE: Record<string, MessageKey> = {
  invalid: 'reply.invalid',
  exists: 'reply.exists',
  code_limit_day: 'reply.codeLimitDay',
  code_limit_month: 'reply.codeLimitMonth',
  slow_down: 'reply.slowDown',
  bad_code: 'reply.badCode',
  weak_password: 'reply.weak',
  same_password: 'reply.same',
  captcha: 'reply.captcha',
  disabled: 'reply.disabled',
  offline: 'reply.offline',
  timeout: 'error.timeout',
  server: 'reply.generic',
  failed: 'reply.generic',
  bad_email: 'v.emailInvalid',
  bad_name: 'v.nameInvalid',
  unconfirmed: 'verify.unverified',
};

export function replyText(reply: GateReply, t: T, context: 'signin' | 'recovery' = 'signin'): string {
  if (reply.code === 'invalid' && context === 'recovery') return t('reply.badRecovery');
  const key = reply.code ? BY_CODE[reply.code] : undefined;
  if (key) return t(key);
  return reply.message ?? t('reply.generic');
}

export const isCodeLimit = (reply: GateReply): boolean => reply.code === 'code_limit_day' || reply.code === 'code_limit_month';
