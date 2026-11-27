// Sends anyone who opens the OLD Cloudflare address (vinexpenses.<account>.workers.dev) to the same page on manaduit.com.
// Plain JavaScript with no inline code, like the rest of the site. It only acts on that one old host, so the new address, local testing and
// any preview address are never touched, and the destination is fixed below, so it can never send anybody to another website.
(function () {
  'use strict';

  var TARGET = 'https://manaduit.com';

  /** The new address for a page of the old one, or null when this is not the old host. `path` always starts with a single "/". */
  function destination(host, path, search, hash) {
    if (!/^vinexpenses\.[a-z0-9-]+\.workers\.dev$/i.test(String(host || ''))) return null;
    var rest = String(path || '/').replace(/\\/g, '/').replace(/^\/+/, '');
    return TARGET + '/' + rest + (search || '') + (hash || '');
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { destination: destination };

  if (typeof location !== 'undefined') {
    var to = destination(location.hostname, location.pathname, location.search, location.hash);
    if (to) location.replace(to);
  }
})();
