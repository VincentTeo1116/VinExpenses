// A typed client for the auth-gate function (AU-01 … AU-12). The function answers HTTP 200 with { ok: false, code, … } for
// ordinary refusals, so a wrong password is a normal reply and not an exception. Anything unexpected becomes
// { ok: false, code: 'server' | 'offline' | 'timeout' } so screens only ever handle one shape.
import '@/lib/zodSetup';
import { z } from 'zod';
import { ApiError, callFunction } from '@/lib/api';
import { envResult } from '@/lib/env';
import { deviceId } from './device';

const sessionSchema = z.object({
  access_token: z.string().min(10),
  refresh_token: z.string().min(1),
  user: z.object({ id: z.string().optional(), email: z.string().optional() }).passthrough().optional(),
});
export type GateSession = z.infer<typeof sessionSchema>;

const replySchema = z
  .object({
    ok: z.boolean(),
    code: z.string().optional(),
    message: z.string().optional(),
    step: z.string().optional(),
    minutes: z.number().optional(),
    until: z.string().nullable().optional(),
    manual: z.boolean().optional(),
    retryAt: z.string().optional(),
    codes: z.array(z.string()).optional(),
    authenticatorOff: z.boolean().optional(),
    session: sessionSchema.optional(),
  })
  .passthrough();
export type GateReply = z.infer<typeof replySchema>;

export type GateAction = 'signup' | 'signup_resend' | 'signup_verify' | 'signin' | 'recover' | 'reset' | 'mfa_recover' | 'recovery_codes';

const failure = (code: string, message: string): GateReply => ({ ok: false, code, message });

export async function gate(action: GateAction, payload: Record<string, unknown> = {}, accessToken?: string): Promise<GateReply> {
  if (!envResult.ok) return failure('server', 'not configured');
  try {
    return await callFunction('auth-gate', { action, device: deviceId(), ...payload }, {
      baseUrl: envResult.env.supabaseUrl,
      anonKey: envResult.env.supabaseAnonKey,
      accessToken,
      schema: replySchema,
      timeoutMs: 20_000,
      retries: 0, // a sign-in or a code request must never be repeated by the app on its own
    });
  } catch (error) {
    if (error instanceof ApiError) {
      // The function sends { error } with a 4xx/5xx for things like a missing Origin or a service outage
      if (error.code === 'offline') return failure('offline', error.message);
      if (error.code === 'timeout') return failure('timeout', error.message);
      return failure('server', error.message);
    }
    return failure('server', 'Something went wrong.');
  }
}
