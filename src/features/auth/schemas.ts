// The form rules, one place. They give the messages shown under each field (in the chosen language).
import '@/lib/zodSetup';
import { z } from 'zod';
import type { MessageKey } from '@/lib/i18n';
import { cleanEmail, cleanName, cleanRecoveryCode, isCode, passwordOk } from './rules';

export type T = (key: MessageKey, values?: Record<string, string | number>) => string;

const email = (t: T) =>
  z
    .string()
    .trim()
    .min(1, t('v.emailRequired'))
    .refine((value) => Boolean(cleanEmail(value)), t('v.emailInvalid'));

const name = (t: T) =>
  z
    .string()
    .trim()
    .min(1, t('v.nameRequired'))
    .refine((value) => Boolean(cleanName(value)), t('v.nameInvalid'));

const newPassword = (t: T) => z.string().min(1, t('v.passwordRequired')).refine(passwordOk, t('v.passwordWeak'));
const anyPassword = (t: T) => z.string().min(1, t('v.passwordRequired'));
const confirm = (t: T) => z.string().min(1, t('v.confirmRequired'));
const sixDigits = (t: T, key: MessageKey = 'v.codeInvalid') => z.string().trim().refine(isCode, t(key));

export const signInSchema = (t: T) => z.object({ email: email(t), password: anyPassword(t), remember: z.boolean() });

export const registerSchema = (t: T) =>
  z
    .object({ name: name(t), email: email(t), password: newPassword(t), confirm: confirm(t) })
    .refine((data) => data.password === data.confirm, { path: ['confirm'], message: t('v.confirmMismatch') });

export const verifySchema = (t: T) => z.object({ code: sixDigits(t) });
export const forgotSchema = (t: T) => z.object({ email: email(t) });

export const resetSchema = (t: T) =>
  z
    .object({ code: sixDigits(t), password: newPassword(t), confirm: confirm(t) })
    .refine((data) => data.password === data.confirm, { path: ['confirm'], message: t('v.confirmMismatch') });

export const mfaCodeSchema = (t: T) => z.object({ code: sixDigits(t, 'v.appCodeInvalid') });

export const mfaRecoverySchema = (t: T) =>
  z.object({
    code: z.string().refine((value) => Boolean(cleanRecoveryCode(value)), t('v.recoveryInvalid')),
    password: anyPassword(t),
  });

export const setupSchema = (t: T) =>
  z
    .object({ name: name(t), password: newPassword(t), confirm: confirm(t) })
    .refine((data) => data.password === data.confirm, { path: ['confirm'], message: t('v.confirmMismatch') });

export const changePasswordSchema = (t: T) =>
  z
    .object({ current: anyPassword(t), password: newPassword(t), confirm: confirm(t) })
    .refine((data) => data.password === data.confirm, { path: ['confirm'], message: t('v.confirmMismatch') });

export const disableMfaSchema = (t: T) => z.object({ password: anyPassword(t) });

export const TOPICS = ['locked_out', 'code_limit', 'report', 'bug', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

export const contactSchema = (t: T, signedIn: boolean) =>
  z.object({
    email: signedIn ? z.string() : email(t),
    topic: z.string().refine((value) => (TOPICS as readonly string[]).includes(value), t('v.topicRequired')),
    message: z
      .string()
      .trim()
      .min(5, t('v.messageShort'))
      .max(2000, t('v.messageLong')),
  });
