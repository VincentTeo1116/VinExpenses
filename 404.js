// Page-not-found helper: goes back to the page the visitor came from, or to the welcome page when there is none.
(function () {
    var SECONDS = 8;
    var home = document.getElementById('nfHome');
    var backBtn = document.getElementById('nfBack');
    var note = document.getElementById('nfCount');
    if (!home || !backBtn || !note) return;

    // A "previous page" counts only when it is on this same website, so nobody is sent somewhere unexpected
    var cameFromHere = false;
    try { cameFromHere = !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch (_) { cameFromHere = false; }

    function leave() {
        if (cameFromHere) history.back();
        else location.replace(home.href);
    }

    backBtn.textContent = cameFromHere ? 'Go back' : 'Go to the welcome page';
    home.hidden = !cameFromHere; // with no previous page the main button already goes to the welcome page
    backBtn.addEventListener('click', leave);

    var left = SECONDS;
    var timer = null;
    function tick() {
        note.textContent = 'Taking you ' + (cameFromHere ? 'back' : 'to the welcome page') + ' in ' + left + (left === 1 ? ' second.' : ' seconds.') + ' ';
        var stay = document.createElement('button');
        stay.type = 'button';
        stay.className = 'nf-stay';
        stay.textContent = 'Stay here';
        stay.addEventListener('click', function () { clearInterval(timer); note.textContent = ''; });
        note.appendChild(stay);
    }
    tick();
    timer = setInterval(function () {
        left -= 1;
        if (left <= 0) { clearInterval(timer); leave(); return; }
        tick();
    }, 1000);
})();
