// The page behind the links in our emails. The secret token lives in the part of the address after "#", which
// browsers never send to any server and never include in the Referer header. It is removed from the address bar as
// soon as it has been read. Nothing happens until the person presses the button, so mail scanners that open every
// link cannot confirm or unsubscribe anyone by accident.
(function () {
    'use strict';
    var title = document.getElementById('title');
    var message = document.getElementById('message');
    var button = document.getElementById('go');
    var card = document.querySelector('.card');

    var params = new URLSearchParams(location.hash.replace(/^#/, ''));
    var action = params.get('a');
    var token = params.get('t') || '';
    if (location.hash) history.replaceState(null, '', location.pathname);

    function finish(ok, heading, text) {
        card.className = 'card ' + (ok ? 'ok' : 'bad');
        title.textContent = heading;
        message.textContent = text;
        button.hidden = true;
    }

    var cfg = window.APP_CONFIG || {};
    var base = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cfg.SUPABASE_URL || '') ? cfg.SUPABASE_URL : '';
    var valid = (action === 'confirm' || action === 'unsub') && /^[A-Za-z0-9_.-]{10,700}$/.test(token);

    if (!base || !valid) {
        finish(false, 'Link not valid', 'This link is incomplete or has expired. Please request a new one from the app.');
        return;
    }

    var texts = action === 'confirm'
        ? { head: 'Confirm your email', body: 'Press the button to confirm that VinExpenses may send your monthly report to this address.', btn: 'Confirm email address' }
        : { head: 'Unsubscribe', body: 'Press the button to stop VinExpenses monthly reports to this address.', btn: 'Unsubscribe' };
    title.textContent = texts.head;
    message.textContent = texts.body;
    button.textContent = texts.btn;
    button.hidden = false;

    button.addEventListener('click', function () {
        button.disabled = true;
        button.textContent = 'Please wait…';
        fetch(base + '/functions/v1/email-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            referrerPolicy: 'no-referrer',
            body: JSON.stringify({ action: action, token: token })
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                if (response.ok && data.ok) finish(true, action === 'confirm' ? 'Email confirmed' : 'Unsubscribed', data.message || 'Done.');
                else finish(false, 'Could not complete', data.message || 'Something went wrong. Please try again later.');
            });
        }).catch(function () {
            button.disabled = false;
            button.textContent = texts.btn;
            message.textContent = 'Could not reach the server. Check your connection and press the button again.';
        });
    });
})();
