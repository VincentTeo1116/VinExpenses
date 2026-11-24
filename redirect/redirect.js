// Sends anyone who opens the old GitHub Pages address to the same page on the new site (Cloudflare).
// Plain JavaScript with no inline code, like the rest of the site. The target is fixed when the page is built (tools/build-redirect.js),
// and only the part of the address after the old base is carried across, so this can never send anybody to another website.
(function (root) {
  'use strict';

  /**
   * Where the old address `pathname + search + hash` lives on the new site.
   * - the old app answered at the front address; the new app is at /app
   * - the old front page (welcome.html) is the new front page
   * - everything else keeps its name (privacy.html, terms.html, email-action.html, miniapp/ all exist on the new site)
   * `base` is the old site's folder, for example "/VinExpenses/" (or "/" on a custom domain).
   */
  function destination(target, base, pathname, search, hash) {
    var origin = String(target).replace(/\/+$/, '');
    var rest = String(pathname || '/');
    var folder = base || '/';
    if (folder !== '/' && (rest === folder.replace(/\/$/, '') || rest.indexOf(folder) === 0)) rest = rest.slice(folder.length - 1);
    // no leading slashes or backslashes: the result can only ever be a path on `origin`
    rest = rest.replace(/\\/g, '/').replace(/^\/+/, '');
    if (rest === '' || rest === 'index.html') rest = 'app';
    else if (rest === 'welcome.html') rest = '';
    return origin + '/' + rest + (search || '') + (hash || '');
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { destination: destination };

  if (typeof document !== 'undefined' && document.currentScript) {
    var script = document.currentScript;
    var target = script.getAttribute('data-target');
    // refuse anything that is not a plain https address (the build checks this too)
    if (target && /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(target)) {
      var here = root.location;
      here.replace(destination(target, script.getAttribute('data-base'), here.pathname, here.search, here.hash));
    }
  }
})(typeof window !== 'undefined' ? window : this);
