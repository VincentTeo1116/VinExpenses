// PF-01: the service worker caches only the app shell. It is registered from code (not an inline script), only in production,
// and only after the page has finished loading, so it never competes with the first screen for the network.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const start = () => {
    import('virtual:pwa-register')
      .then(({ registerSW }) => registerSW({ immediate: true }))
      .catch(() => {
        /* the app works without the worker; it just will not work offline */
      });
  };
  const later = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(start, { timeout: 5000 }) : setTimeout(start, 2000));
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}
