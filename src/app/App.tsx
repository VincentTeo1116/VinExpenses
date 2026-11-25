import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@/lib/i18n';
import { ToastProvider } from '@/components/Toast';
import { envResult } from '@/lib/env';
import { AuthProvider } from './AuthProvider';
import { ProtectedRoute } from './ProtectedRoute';
import { ErrorBoundary } from './ErrorBoundary';
import { NotFound } from '@/pages/NotFound';
import { ConfigError } from '@/pages/ConfigError';
import { DESKTOP, useMediaQuery } from '@/lib/useMediaQuery';

// Each screen is its own file that is downloaded only when it is opened (PERF-01).
import { ARRIVED_FROM_SIGN_IN } from './arrival';
const AppFrame = lazy(() => import('@/layouts/AppFrame').then((m) => ({ default: m.AppFrame })));
const AuthPage = lazy(() => import('@/features/auth/AuthPage').then((m) => ({ default: m.AuthPage })));
const SetupPage = lazy(() => import('@/features/auth/SetupPage').then((m) => ({ default: m.SetupPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const HistoryPage = lazy(() => import('@/features/history/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const PlanPage = lazy(() => import('@/features/plan/PlanPage').then((m) => ({ default: m.PlanPage })));
const ReportPage = lazy(() => import('@/features/report/ReportPage').then((m) => ({ default: m.ReportPage })));
const WelcomePage = lazy(() => import('@/features/public/WelcomePage').then((m) => ({ default: m.WelcomePage })));
const PrivacyPage = lazy(() => import('@/features/public/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('@/features/public/TermsPage').then((m) => ({ default: m.TermsPage })));
const AdminPage = lazy(() => import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const AccountPage = lazy(() => import('@/features/account/AccountPage').then((m) => ({ default: m.AccountPage })));

/** Still carrying the code right now? (After it has been used the front page is the front page again.) */
const fromSignIn = () => /[?&#](code|access_token|error_description)=/.test(`${window.location.search}${window.location.hash}`);

/** Account: a page of its own on a computer; on a phone or tablet a pop-up over the Home screen. */
function AccountRoute() {
  const desktop = useMediaQuery(DESKTOP);
  if (desktop) return <AccountPage />;
  return (
    <>
      <DashboardPage quiet />
      <AccountPage />
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      {/* the public pages; the old .html addresses (in emails, the Google consent screen, Telegram) still work */}
      {/* back from Google on the front page: carry the one-time code on to the sign-in screen, which finishes and opens the app */}
      <Route path="/" element={ARRIVED_FROM_SIGN_IN && fromSignIn() ? <Navigate to={{ pathname: '/auth', search: window.location.search, hash: window.location.hash }} replace /> : <WelcomePage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/welcome.html" element={<Navigate to="/" replace />} />
      <Route path="/privacy.html" element={<Navigate to="/privacy" replace />} />
      <Route path="/terms.html" element={<Navigate to="/terms" replace />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/setup" element={<SetupPage />} />
      <Route path="/app" element={<ProtectedRoute />}>
        <Route element={<AppFrame />}>
          <Route index element={<DashboardPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route
            path="account"
            element={<AccountRoute />}
          />
          <Route path="admin" element={<AdminPage />} />
          <Route path="report" element={<ReportPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ErrorBoundary>
          {envResult.ok ? (
            <AuthProvider>
              <BrowserRouter>
                <Suspense fallback={null}>
                  <AppRoutes />
                </Suspense>
              </BrowserRouter>
            </AuthProvider>
          ) : (
            <ConfigError />
          )}
        </ErrorBoundary>
      </ToastProvider>
    </I18nProvider>
  );
}

