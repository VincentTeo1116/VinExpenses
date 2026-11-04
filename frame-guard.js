// Clickjacking guard. GitHub Pages cannot send the X-Frame-Options / frame-ancestors headers, and the
// <meta> form of the Content-Security-Policy ignores frame-ancestors, so the page defends itself:
//   - style.css keeps the page hidden (`html:not([data-top]) body { display: none }`) ...
//   - ... until this script confirms the page is the top-level window.
// If the page is inside someone else's frame it stays blank and tries to break out. If this script is blocked
// or fails, the page stays blank too: it fails closed. A host that sends real security headers makes this
// redundant but harmless.
(function () {
    if (window.top === window.self) {
        document.documentElement.setAttribute('data-top', '1');
        return;
    }
    try { window.top.location = window.self.location.href; } catch (_) { /* cross-origin: the page simply stays hidden */ }
})();
