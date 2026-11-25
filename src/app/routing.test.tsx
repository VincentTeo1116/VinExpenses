import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { I18nProvider } from '@/lib/i18n';
import { ToastProvider } from '@/components/Toast';
import { AuthProvider } from './AuthProvider';
import { AppRoutes } from './App';

function fakeClient(session: Session | null, failure = false): SupabaseClient {
  return {
    auth: {
      getSession: () => (failure ? Promise.reject(new Error('storage broken')) : Promise.resolve({ data: { session }, error: null })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  } as unknown as SupabaseClient;
}

const SESSION = { access_token: 't', user: { id: 'u1', email: 'a@b.c', user_metadata: { username: 'Tester' }, app_metadata: { provider: 'email' } } } as unknown as Session;

function renderAt(path: string, client: SupabaseClient) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

describe('routing and the signed-in frame', () => {
  it('sends a signed-out visitor from /app to the sign-in page', async () => {
    renderAt('/app/history', fakeClient(null));
    expect(await screen.findByRole('heading', { name: 'Welcome back' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
  });

  it('shows the app frame, navigation and the dashboard when signed in', async () => {
    renderAt('/app', fakeClient(SESSION));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hello,/ })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Main navigation' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('moves between screens and keeps the tab title in step', async () => {
    const user = userEvent.setup();
    renderAt('/app', fakeClient(SESSION));
    await screen.findByRole('heading', { level: 1, name: /^Hello,/ });
    await user.click(screen.getAllByRole('link', { name: 'Plan' })[0] as HTMLElement);
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Plan · VinExpenses'));
  });

  it('the + button opens the add sheet above the page, and Esc closes it', async () => {
    const user = userEvent.setup();
    renderAt('/app', fakeClient(SESSION));
    await screen.findByRole('heading', { level: 1, name: /^Hello,/ });
    await user.click(screen.getAllByRole('button', { name: 'Add a transaction' })[0] as HTMLElement);
    expect(await screen.findByRole('dialog', { name: 'Add a transaction' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switching language in Account changes the labels at once, and is remembered', async () => {
    const user = userEvent.setup();
    renderAt('/app/account', fakeClient(SESSION));
    await screen.findByRole('dialog', { name: 'Account' }); // Account is a pop-up over Home
    await user.selectOptions(screen.getByLabelText('Language'), 'ms');
    expect(await screen.findByRole('dialog', { name: 'Akaun' })).toBeInTheDocument();
    expect(localStorage.getItem('ve_lang')).toBe('ms');
    expect(document.documentElement.lang).toBe('ms');
  });

  it('an address that does not exist shows the 404 page with a way back to the app', async () => {
    renderAt('/nothing-here', fakeClient(null));
    expect(await screen.findByRole('heading', { name: 'We can’t find that page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the app' })).toBeInTheDocument();
  });

  it('a broken session store never traps the person on a spinner: they are treated as signed out', async () => {
    renderAt('/app', fakeClient(null, true));
    expect(await screen.findByRole('heading', { name: 'Welcome back' }, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('shows a loading state while the session is being checked', () => {
    const client = { auth: { getSession: () => new Promise(() => undefined), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) } } as unknown as SupabaseClient;
    renderAt('/app', client);
    expect(screen.getAllByRole('status').map((el) => el.textContent).join(' ')).toContain('Loading…');
  });
});
