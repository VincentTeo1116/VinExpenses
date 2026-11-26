// Every address the single-page app answers to. The build writes a copy of the page for each of them (appPagesPlugin in vite.config.mts),
// so the static host needs no rewrite rules; anything else is a real 404.
import { GUIDE_PATHS } from '../features/guides/registry';

export const APP_PATHS: readonly string[] = ['/welcome', '/welcome.html', '/privacy', '/privacy.html', '/terms', '/terms.html', '/app', '/app/history', '/app/plan', '/app/account', '/app/admin', '/app/report', '/auth', '/auth/setup', ...GUIDE_PATHS];
