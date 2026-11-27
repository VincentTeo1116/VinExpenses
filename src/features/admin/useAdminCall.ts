// One call to the admin function. A refusal comes back as words, never as an exception to the screen.
import { useCallback } from 'react';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useServer } from '@/features/account/useServer';

export type AdminReply<T> = T & { ok: boolean; message?: string; forbidden?: boolean };

export function useAdminCall() {
  const server = useServer();
  const { t } = useI18n();
  return useCallback(
    async <T extends object>(action: string, payload: Record<string, unknown> = {}): Promise<AdminReply<T>> => {
      try {
        return (await server<T>('admin', { action, ...payload })) as AdminReply<T>;
      } catch (error) {
        return { ok: false, forbidden: error instanceof ApiError && error.code === 'forbidden', message: error instanceof ApiError ? error.message : t('admin.failed') } as unknown as AdminReply<T>;
      }
    },
    [server, t],
  );
}
