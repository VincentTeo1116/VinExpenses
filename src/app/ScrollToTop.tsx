// A new public page opens at its top, whatever the page before was scrolled to. Back and forward, links to a #section and the signed-in app are left alone.
import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    if (type === 'POP' || hash || /^\/(app|auth)(\/|$)/.test(pathname)) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, hash, type]);
  return null;
}
