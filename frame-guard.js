// Clickjacking guard: the page stays hidden unless it is the top window, because GitHub Pages can't send the header for this.
(function () {
    if (window.top === window.self) {
        document.documentElement.setAttribute('data-top', '1');
        return;
    }
    try { window.top.location = window.self.location.href; } catch (_) { /* cross-origin: the page simply stays hidden */ }
})();
