// Every address the single-page app answers to. The static host serves index.html only for these (public/_redirects);
// anything else is a real 404. A test keeps the two lists identical.
export const APP_PATHS = ['/welcome', '/welcome.html', '/privacy', '/privacy.html', '/terms', '/terms.html', '/app', '/app/history', '/app/plan', '/app/account', '/app/admin', '/app/report', '/auth', '/auth/setup'] as const;
