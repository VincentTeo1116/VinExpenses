// Holds the signed-in session and what the person still has to do before the app opens:
//   needsMfa   - an authenticator is on and its code has not been given yet (AU-12)
//   needsSetup - a first-time Google sign-in must still choose a name and a password (AU-10)
// The browser only reflects what Supabase says; it never decides who may see data (that is the database's job).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { forgetDeviceChoices, shouldSignOutOnStart } from '@/features/auth/device';

export type AuthStatus = 'loading' | 'signedOut' | 'needsMfa' | 'needsSetup' | 'signedIn';

interface AuthValue {
  status: AuthStatus;
  session: Session | null;
  client: SupabaseClient | null;
  /** Puts a session received from the sign-in service into the library, and returns what the person must do next. */
  adopt: (session: { access_token: string; refresh_token: string }) => Promise<AuthStatus>;
  /** Re-reads the session and authenticator state (after turning the authenticator on or off, or saving the profile). */
  refresh: () => Promise<AuthStatus>;
  signOut: () => Promise<void>;
  /** True after the person chose to sign out: the next sign-in starts at Home, not at the page they left. */
  signedOutByChoice: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

async function statusFor(client: SupabaseClient, session: Session | null): Promise<AuthStatus> {
  if (!session) return 'signedOut';
  try {
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') return 'needsMfa';
  } catch {
    /* no authenticator information: treat as none, the database still enforces the rule */
  }
  const meta = (session.user?.user_metadata ?? {}) as Record<string, unknown>;
  return typeof meta.username === 'string' && meta.username.trim() ? 'signedIn' : 'needsSetup';
}

export function AuthProvider({ children, client: injected }: { children: ReactNode; client?: SupabaseClient | null }) {
  const client = injected === undefined ? getSupabase() : injected;
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(client ? 'loading' : 'signedOut');
  const [signedOutByChoice, setSignedOutByChoice] = useState(false);
  const version = useRef(0);

  const evaluate = useCallback(
    async (next: Session | null): Promise<AuthStatus> => {
      if (!client) return 'signedOut';
      const mine = ++version.current;
      const result = await statusFor(client, next);
      if (mine === version.current) {
        setSession(next);
        setStatus(result);
      }
      return result;
    },
    [client],
  );

  useEffect(() => {
    if (!client) return undefined;
    let cancelled = false;
    client.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        if (data.session && shouldSignOutOnStart()) {
          // "Remember me" was off (or the 30 days are over) and the browser was closed since
          await client.auth.signOut().catch(() => undefined);
          if (!cancelled) await evaluate(null);
          return;
        }
        if (!cancelled) await evaluate(data.session);
      })
      .catch(() => {
        // A broken session store must never trap the person on a spinner: treat it as signed out
        if (!cancelled) setStatus('signedOut');
      });
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        void evaluate(null);
        return;
      }
      // Never call the library from inside this callback: schedule the check after it returns
      setTimeout(() => void evaluate(next), 0);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [client, evaluate]);

  const adopt = useCallback<AuthValue['adopt']>(
    async (tokens) => {
      if (!client) return 'signedOut';
      setSignedOutByChoice(false);
      const { data, error } = await client.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
      if (error || !data.session) return 'signedOut';
      return evaluate(data.session);
    },
    [client, evaluate],
  );

  const refresh = useCallback<AuthValue['refresh']>(async () => {
    if (!client) return 'signedOut';
    const { data } = await client.auth.getSession();
    return evaluate(data.session);
  }, [client, evaluate]);

  const signOut = useCallback(async () => {
    if (client) await client.auth.signOut().catch(() => undefined);
    forgetDeviceChoices();
    setSignedOutByChoice(true);
    await evaluate(null);
  }, [client, evaluate]);

  const value = useMemo<AuthValue>(() => ({ status, session, client, adopt, refresh, signOut, signedOutByChoice }), [status, session, client, adopt, refresh, signOut, signedOutByChoice]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
