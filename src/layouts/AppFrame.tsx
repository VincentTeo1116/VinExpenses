// The signed-in frame together with the data cache. Loaded only after sign-in, so the sign-in page does not download it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './AppShell';
import { MoneyProvider } from '@/features/money/MoneyContext';
import { registerEnglish } from '@/lib/i18n';
import { enDash } from '@/lib/i18n/enDash';

// English text for the signed-in screens arrives with them (the sign-in page does not need it)
registerEnglish(enDash);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

export function AppFrame() {
  return (
    <QueryClientProvider client={queryClient}>
      <MoneyProvider>
        <AppShell />
      </MoneyProvider>
    </QueryClientProvider>
  );
}
