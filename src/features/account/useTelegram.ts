// Whether Telegram is connected (null while not known). Shared by the Account card, the report card and the Home nudge,
// kept apart from the cards so the Home screen does not download their form code.
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/app/AuthProvider';
import { useServer } from './useServer';

export interface TelegramStatus {
  linked: boolean;
  remindersBlocked?: boolean;
}

/** Whether Telegram is connected (null while not known). Shared by the Account card, the report card and the Home nudge. */
export function useTelegramStatus(): { status: TelegramStatus | null; failed: boolean; refetch: () => Promise<unknown> } {
  const { session } = useAuth();
  const server = useServer();
  const userId = session?.user?.id ?? '';
  const query = useQuery({ queryKey: ['telegram', userId], enabled: Boolean(userId), retry: 0, queryFn: () => server<TelegramStatus>('telegram-link', { action: 'status' }) });
  return { status: query.data ?? null, failed: query.isError, refetch: query.refetch };
}
