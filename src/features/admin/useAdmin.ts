// AC-08: is this person the administrator? Everyone else simply does not see the entry. The server checks again on every action.
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/app/AuthProvider';
import { useServer } from '@/features/account/useServer';

interface Status {
  admin?: boolean;
  checks?: Record<string, boolean>;
  justCreated?: boolean;
}

export function useAdminStatus(): { isAdmin: boolean; known: boolean; justCreated: boolean } {
  const { session } = useAuth();
  const server = useServer();
  const userId = session?.user?.id ?? '';
  const query = useQuery({ queryKey: ['admin-status', userId], enabled: Boolean(userId), retry: 0, staleTime: 10 * 60_000, queryFn: () => server<Status>('admin-email-test', { action: 'status' }) });
  return { isAdmin: query.data?.admin === true, known: query.isSuccess || query.isError, justCreated: query.data?.justCreated === true };
}
