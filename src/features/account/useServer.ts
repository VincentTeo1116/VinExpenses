// Calls one of the app's server functions as the signed-in person. The server decides; the app only asks and shows the answer.
import { useCallback } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { ApiError, callFunction } from '@/lib/api';
import { envResult } from '@/lib/env';

export function useServer() {
  const { session } = useAuth();
  const token = session?.access_token;
  return useCallback(
    <T,>(name: string, body: unknown = {}, timeoutMs = 20_000): Promise<T> => {
      if (!envResult.ok) return Promise.reject(new ApiError('server', 'The app is not set up.'));
      return callFunction<T>(name, body, { baseUrl: envResult.env.supabaseUrl, anonKey: envResult.env.supabaseAnonKey, accessToken: token, timeoutMs });
    },
    [token],
  );
}
