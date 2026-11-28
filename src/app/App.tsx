import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '@/lib/i18n';
import { ToastProvider } from '@/components/Toast';
import { envResult } from '@/lib/env';
import { AuthProvider } from './AuthProvider';
import { ProtectedRoute } from './ProtectedRoute';
import { ErrorBoundary } from './ErrorBoundary';
import { NotFound } from '@/pages/NotFound';
import { ScrollToTop } from './ScrollToTop';
import { ALL_SLUGS, LANGS, pathFor } from '@/features/guides/registry';
import { ConfigError } from '@/pages/ConfigError';
import { DESKTOP, useMediaQuery } from '@/lib/useMediaQuery';

// Each screen is its own file that is downloaded only when it is opened (PERF-01).
import { ARRIVED_FROM_SIGN_IN } from './arrival';
const AppFrame = lazy(() => import('@/layouts/AppFrame').then((m) => ({ default: m.AppFrame })));
const AuthPage = lazy(() => import('@/features/auth/AuthPage').then((m) => ({ default: m.AuthPage })));
const SetupPage = lazy(() => import('@/features/auth/SetupPage').then((m) => ({ default: m.SetupPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const HistoryPage = lazy(() => import('@/features/history/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const SplitPage = lazy(() => import('@/features/split/SplitPage').then((m) => ({ default: m.SplitPage })));
const PlanPage = lazy(() => import('@/features/plan/PlanPage').then((m) => ({ default: m.PlanPage })));
const ReportPage = lazy(() => import('@/features/report/ReportPage').then((m) => ({ default: m.ReportPage })));
const WelcomePage = lazy(() => import('@/features/public/WelcomePage').then((m) => ({ default: m.WelcomePage })));
const GuideRoute = lazy(() => import('@/features/guides/GuideRoute').then((m) => ({ default: m.GuideRoute })));
const PrivacyPage = lazy(() => import('@/features/public/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const InstallPage = lazy(() => import('@/features/public/InstallPage').then((m) => ({ default: m.InstallPage })));
const TermsPage = lazy(() => import('@/features/public/TermsPage').then((m) => ({ default: m.TermsPage })));
const AdminPage = lazy(() => import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const AccountPage = lazy(() => import('@/features/account/AccountPage').then((m) => ({ default: m.AccountPage })));

/** Still carrying the code right now? (After it has been used the front page is the front page again.) */
const fromSignIn = () => /[?&#](code|access_token|error_description)=/.test(`${window.location.search}${window.location.hash}`);

/** Account: a page of its own on a computer; on a phone or tablet a pop-up over the Home screen. */
/** Home and Account share one element, so opening or closing the Account pop-up never rebuilds Home. On a computer Account is its own page. */
function HomeRoute() {
  const desktop = useMediaQuery(DESKTOP);
  const onAccount = /\/account\/?$/.test(useLocation().pathname);
  if (desktop) return onAccount ? <AccountPage /> : <DashboardPage />;
  return (
    <>
      <DashboardPage quiet={onAccount} />
      {onAccount ? <AccountPage /> : null}
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
      {/* the public guides: calculators and articles, in English at the root and in Malay and Chinese under /ms and /zh */}
      {LANGS.flatMap((lang) => ALL_SLUGS.map((slug) => <Route key={pathFor(lang, slug)} path={pathFor(lang, slug)} element={<GuideRoute lang={lang} slug={slug} />} />))}
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/install" element={<InstallPage />} />
      <Route path="/welcome.html" element={<Navigate to="/welcome" replace />} />
      <Route path="/privacy.html" element={<Navigate to="/privacy" replace />} />
      <Route path="/terms.html" element={<Navigate to="/terms" replace />} />
      <Route path="/install.html" element={<Navigate to="/install" replace />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/auth/setup" element={<SetupPage />} />
      <Route path="/app" element={<ProtectedRoute />}>
        <Route element={<AppFrame />}>
          <Route index element={<HomeRoute />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="split" element={<SplitPage />} />
          <Route
            path="account"
            element={<HomeRoute />}
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
                <ScrollToTop />
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

