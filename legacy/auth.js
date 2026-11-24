// === SIGN-IN SCREENS ===
// Sign up with an emailed code, sign in, forgot password, the authenticator (optional), the 3-hour pause after wrong passwords,
// and the contact form. Loaded before app.js, which starts it with Auth.init() and hands it the signed-in user.
// Every check that matters is done again on the server (auth-gate function); the live messages here are only a help.
window.Auth = (function () {
    'use strict';
    const el = (id) => document.getElementById(id);
    const cfg = () => window.APP_CONFIG || {};

    // ---- the rules (same as supabase/functions/_shared/auth-rules.ts) ----
    const RULES = [
        { key: 'length', label: 'At least 10 characters', test: (v) => v.length >= 10 && v.length <= 72 },
        { key: 'upper', label: 'An upper-case letter', test: (v) => /[A-Z]/.test(v) },
        { key: 'lower', label: 'A lower-case letter', test: (v) => /[a-z]/.test(v) },
        { key: 'digit', label: 'A number', test: (v) => /\d/.test(v) },
        { key: 'symbol', label: 'A symbol (for example ! ? # @)', test: (v) => /[^A-Za-z0-9\s]/.test(v) }
    ];
    const passwordOk = (value) => RULES.every((r) => r.test(value));
    const emailOk = (value) => value.length <= 254 && /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
    const nameOk = (value) => value.length >= 2 && value.length <= 40 && !/[<>]/.test(value);
    const cleanCode = (value) => String(value || '').replace(/\D/g, '').slice(0, 6);

    function setError(id, message) {
        const box = el(id);
        if (box) box.textContent = message || '';
        const input = el(id.replace(/Error$/, ''));
        if (input) {
            const wrap = input.closest('.input-icon-wrap') || input;
            wrap.classList.toggle('invalid', !!message);
            if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
        }
    }

    // A live checklist under a password field: each rule turns green as it is met
    function renderRules(listId, value, touched) {
        const list = el(listId);
        if (!list) return;
        if (!list.children.length) list.innerHTML = RULES.map((r) => `<li data-rule="${r.key}"><i class="fas fa-circle" aria-hidden="true"></i><span>${r.label}</span></li>`).join('');
        RULES.forEach((r) => {
            const item = list.querySelector(`[data-rule="${r.key}"]`);
            const met = r.test(value);
            item.classList.toggle('met', met);
            item.classList.toggle('bad', !met && touched && value.length > 0);
            item.querySelector('i').className = `fas ${met ? 'fa-circle-check' : 'fa-circle'}`;
            item.querySelector('span').setAttribute('data-state', met ? 'met' : 'not met');
        });
    }

    // ---- a stable id for this browser (never leaves the browser except to the sign-in function) ----
    function deviceId() {
        try {
            let id = localStorage.getItem('et_device');
            if (!/^[A-Za-z0-9_-]{16,64}$/.test(id || '')) {
                const bytes = crypto.getRandomValues(new Uint8Array(18));
                id = 'd' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
                localStorage.setItem('et_device', id);
            }
            return id;
        } catch (_) {
            return 'unknown-device-' + (window.__tmpDevice || (window.__tmpDevice = String(Math.random()).slice(2, 12)));
        }
    }

    // ---- "Remember me for 30 days" ----
    const REMEMBER_KEY = 'et_remember_until';
    const REMEMBER_DAYS = 30;
    function setRemember(on) {
        try {
            if (on) localStorage.setItem(REMEMBER_KEY, String(Date.now() + REMEMBER_DAYS * 86400000));
            else localStorage.setItem(REMEMBER_KEY, '0');
            sessionStorage.setItem('et_tab_alive', '1');
        } catch (_) { /* storage blocked: the session simply lasts as the browser allows */ }
    }
    // true when this device was not asked to remember the person, or the 30 days are over
    function shouldSignOutOnStart() {
        try {
            const until = Number(localStorage.getItem(REMEMBER_KEY));
            if (!Number.isFinite(until) || localStorage.getItem(REMEMBER_KEY) === null) return false; // signed in before this feature: leave it
            if (until > Date.now()) return false;
            return !sessionStorage.getItem('et_tab_alive'); // not remembered: only while this browser session lasts
        } catch (_) { return false; }
    }

    // ---- the security check (Cloudflare Turnstile), only when a site key is configured ----
    const captcha = { loading: null, widgets: {}, tokens: {} };
    const captchaOn = () => /^[0-9A-Za-z_-]{10,}$/.test(String(cfg().TURNSTILE_SITE_KEY || ''));
    function loadCaptcha() {
        if (!captchaOn()) return Promise.resolve(false);
        if (window.turnstile) return Promise.resolve(true);
        if (!captcha.loading) {
            captcha.loading = new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                script.async = true;
                script.onload = () => resolve(!!window.turnstile);
                script.onerror = () => resolve(false);
                document.head.appendChild(script);
                setTimeout(() => resolve(!!window.turnstile), 12000);
            }).then((ok) => { if (!ok) captcha.loading = null; return ok; });
        }
        return captcha.loading;
    }
    async function showCaptcha(boxId) {
        const box = el(boxId);
        if (!box || !captchaOn()) return;
        const ok = await loadCaptcha();
        if (!ok) {
            box.innerHTML = '<p class="field-error" role="alert">The security check could not load. Check your connection and <button type="button" class="link-btn" data-captcha-retry>try again</button>.</p>';
            return;
        }
        if (captcha.widgets[boxId] !== undefined) { try { window.turnstile.reset(captcha.widgets[boxId]); } catch (_) { /* ignore */ } captcha.tokens[boxId] = ''; return; }
        box.innerHTML = '';
        captcha.widgets[boxId] = window.turnstile.render(box, {
            sitekey: cfg().TURNSTILE_SITE_KEY, theme: 'auto', size: 'flexible',
            callback: (token) => { captcha.tokens[boxId] = token; },
            'expired-callback': () => { captcha.tokens[boxId] = ''; },
            'error-callback': () => { captcha.tokens[boxId] = ''; }
        });
    }
    const captchaToken = (boxId) => (captchaOn() ? captcha.tokens[boxId] || '' : undefined);
    function resetCaptcha(boxId) {
        captcha.tokens[boxId] = '';
        if (captcha.widgets[boxId] !== undefined && window.turnstile) { try { window.turnstile.reset(captcha.widgets[boxId]); } catch (_) { /* ignore */ } }
    }
    document.addEventListener('click', (event) => {
        if (!event.target.closest('[data-captcha-retry]')) return;
        captcha.loading = null;
        ['auCaptchaSignIn', 'auCaptchaRegister', 'auCaptchaForgot', 'auCaptchaVerify', 'feedbackCaptcha'].forEach((id) => { if (el(id) && el(id).offsetParent) showCaptcha(id); });
    });

    // ---- talking to the auth-gate function ----
    async function gate(action, payload) {
        const client = window.supabaseClient || null;
        if (!client) return { ok: false, code: 'offline', message: 'The app is not connected to its server.' };
        if (!navigator.onLine) return { ok: false, code: 'offline', message: 'You appear to be offline. Please check your connection.' };
        try {
            const { data, error } = await client.functions.invoke('auth-gate', { body: Object.assign({ action, device: deviceId() }, payload) });
            if (error) {
                let body = null;
                try { body = await error.context.clone().json(); } catch (_) { /* no body */ }
                if (body && body.message) return body;
                return { ok: false, code: 'server', message: (body && body.error) || 'Something went wrong. Please try again in a moment.' };
            }
            return data || { ok: false, code: 'server', message: 'Something went wrong. Please try again in a moment.' };
        } catch (err) {
            return { ok: false, code: 'server', message: 'Something went wrong. Please try again in a moment.' };
        }
    }

    // ---- steps ----
    const STEPS = ['auStart', 'auVerify', 'auForgot', 'auReset', 'auMfa', 'auBlocked'];
    let current = 'auStart';
    let mode = 'login';
    let ctx = { email: '', codeUntil: 0, password: '', recoveryMode: false };
    let timers = { code: null, block: null };
    let busyCount = 0;

    function show(step) {
        current = step;
        STEPS.forEach((id) => el(id).classList.toggle('hidden', id !== step));
        el('authBox').dataset.step = step;
        clearInterval(timers.code); clearInterval(timers.block);
        const first = el(step).querySelector('input:not([type=checkbox]):not(.hidden), button.btn-primary');
        if (first && step !== 'auStart') setTimeout(() => first.focus({ preventScroll: true }), 60);
        if (step === 'auVerify') { showCaptcha('auCaptchaVerify'); startCodeTimer('auVerifyTimer', 'auVerifyResend'); }
        if (step === 'auReset') startCodeTimer('auResetTimer', null);
        if (step === 'auForgot') showCaptcha('auCaptchaForgot');
    }
    function startFresh(tab) {
        notice('');
        setMode(tab || 'login');
        show('auStart');
    }

    function notice(message, kind) {
        const box = el('auNotice');
        box.textContent = message || '';
        box.classList.toggle('hidden', !message);
        box.classList.toggle('good', kind === 'good');
        box.classList.toggle('bad', kind === 'bad');
    }

    function setMode(next) {
        mode = next === 'register' ? 'register' : 'login';
        const login = mode === 'login';
        el('loginTab').classList.toggle('active', login);
        el('registerTab').classList.toggle('active', !login);
        el('loginTab').setAttribute('aria-selected', String(login));
        el('registerTab').setAttribute('aria-selected', String(!login));
        el('auSignInForm').classList.toggle('hidden', !login);
        el('auRegisterForm').classList.toggle('hidden', login);
        el('authTitle').textContent = login ? 'Welcome back' : 'Create your account';
        el('authSub').textContent = login ? 'Sign in to keep tracking your spending' : 'It takes a minute. We will email you a code to confirm your address.';
        if (login) { if (el('emailInput2').value && !el('emailInput').value) el('emailInput').value = el('emailInput2').value; showCaptcha('auCaptchaSignIn'); }
        else { if (el('emailInput').value && !el('emailInput2').value) el('emailInput2').value = el('emailInput').value; showCaptcha('auCaptchaRegister'); }
        ['emailInputError', 'passInputError', 'userInputError', 'emailInput2Error', 'confirmPassError'].forEach((id) => setError(id, ''));
    }

    function busy(button, on, label) {
        if (!button) return;
        if (on) { button.dataset.label = button.innerHTML; button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${label}`; button.disabled = true; busyCount++; }
        else { if (button.dataset.label) button.innerHTML = button.dataset.label; button.disabled = false; busyCount = Math.max(0, busyCount - 1); }
    }

    // Counts down the 5 minutes a code lasts, and the moment it has expired says so
    function startCodeTimer(textId, resendId) {
        const text = el(textId);
        const tick = () => {
            const left = Math.max(0, ctx.codeUntil - Date.now());
            if (!ctx.codeUntil) { text.textContent = ''; return; }
            if (left <= 0) {
                text.textContent = 'This code has expired. Ask for a new one.';
                text.classList.add('error');
                clearInterval(timers.code);
                return;
            }
            text.classList.remove('error');
            const m = Math.floor(left / 60000), s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
            text.textContent = `The code works for ${m}:${s} more.`;
        };
        tick();
        timers.code = setInterval(tick, 1000);
        if (resendId) el(resendId).disabled = false;
    }
    const codeSent = (minutes) => { ctx.codeUntil = Date.now() + (minutes || 5) * 60000; };

    // "Blocked" and "limit" replies carry a time; show it as a countdown
    function showBlocked(reply) {
        const manual = !!reply.manual;
        el('auBlockedText').textContent = manual
            ? 'Sign-in for this account has been paused by the admin. Please contact the admin and we will help.'
            : 'There were too many wrong passwords. For your safety, sign-in is paused for 3 hours. You can reset your password now, or contact the admin.';
        const timer = el('auBlockedTimer');
        const until = reply.until ? Date.parse(reply.until) : 0;
        el('auBlockedReset').classList.toggle('hidden', manual);
        show('auBlocked');
        if (!until) { timer.textContent = ''; return; }
        const tick = () => {
            const left = until - Date.now();
            if (left <= 0) { timer.textContent = 'You can try again now.'; clearInterval(timers.block); return; }
            const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
            timer.textContent = `You can try again in ${h}:${String(m).padStart(2, '0')}:${s}`;
        };
        tick();
        timers.block = setInterval(tick, 1000);
    }

    // The messages for every reply the function can send. One place, so wording stays consistent.
    function handleProblem(reply, where) {
        if (!reply) return notice('Something went wrong. Please try again.', 'bad');
        if (reply.code === 'blocked') return showBlocked(reply);
        if (reply.code === 'code_limit_day' || reply.code === 'code_limit_month') {
            notice(reply.message, 'bad');
            const link = document.createElement('button');
            link.type = 'button'; link.className = 'link-btn'; link.dataset.openFeedback = 'code_limit'; link.textContent = 'Contact the admin';
            el('auNotice').append(' ', link);
            return;
        }
        if (reply.code === 'captcha') { resetCaptcha(where); return notice(reply.message, 'bad'); }
        notice(reply.message || 'Something went wrong. Please try again.', 'bad');
    }

    // ---- session ----
    // Puts a session from the server into the Supabase library. Resolves to the user, or null.
    let adopting = false;
    async function adopt(reply) {
        if (!reply || !reply.session) return null;
        adopting = true;
        setTimeout(() => { adopting = false; }, 2500); // long enough for the library's own "signed in" event to pass
        const { data, error } = await window.supabaseClient.auth.setSession({ access_token: reply.session.access_token, refresh_token: reply.session.refresh_token });
        if (error || !data || !data.user) { adopting = false; return null; }
        return data.user;
    }

    // After the password (or code) step: ask for the authenticator code when the account has one
    async function afterSignIn(user) {
        try {
            const { data } = await window.supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
            if (data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') return openMfaStep(user);
        } catch (_) { /* no authenticator information: treat as none */ }
        return finish(user);
    }
    function finish(user) {
        ['emailInput', 'passInput', 'userInput', 'confirmPass', 'emailInput2', 'passInput2', 'auVerifyCode', 'auResetCode', 'auResetPass', 'auResetConfirm', 'auMfaCode', 'auMfaRecovery', 'auMfaRecoveryPass'].forEach((id) => { if (el(id)) el(id).value = ''; });
        ctx = { email: '', codeUntil: 0, password: '', recoveryMode: false };
        startFresh('login');
        return hooks.signedIn(user);
    }

    // ---- sign in ----
    async function signIn(event) {
        event.preventDefault();
        notice('');
        const email = el('emailInput').value.trim().toLowerCase();
        const password = el('passInput').value;
        let bad = false;
        if (!email) { setError('emailInputError', 'Enter your email.'); bad = true; } else if (!emailOk(email)) { setError('emailInputError', 'That does not look like an email address.'); bad = true; } else setError('emailInputError', '');
        if (!password) { setError('passInputError', 'Enter your password.'); bad = true; } else setError('passInputError', '');
        if (bad) return (el('emailInputError').textContent ? el('emailInput') : el('passInput')).focus();
        if (captchaOn() && !captchaToken('auCaptchaSignIn')) return notice('Please complete the security check first.', 'bad');

        const button = el('auSignInBtn');
        busy(button, true, 'Signing in…');
        try {
            const reply = await gate('signin', { email, password, captcha: captchaToken('auCaptchaSignIn') });
            resetCaptcha('auCaptchaSignIn');
            if (!reply.ok) {
                if (reply.code === 'unconfirmed') {
                    ctx.email = email;
                    codeSent(0);
                    show('auVerify');
                    el('auVerifyEmail').textContent = email;
                    el('auVerifyError').textContent = 'This email is not verified yet. Ask for a new code below.';
                    return;
                }
                if (reply.code === 'invalid') setError('passInputError', 'Wrong email or password.');
                return handleProblem(reply, 'auCaptchaSignIn');
            }
            setRemember(el('auRemember').checked);
            ctx.password = password;
            const user = await adopt(reply);
            if (!user) return notice('Signed in, but the session could not be opened. Please try again.', 'bad');
            await afterSignIn(user);
        } finally {
            busy(button, false);
        }
    }

    // ---- register ----
    function validateRegister(touchedAll) {
        const name = el('userInput').value.trim();
        const email = el('emailInput2').value.trim().toLowerCase();
        const pass = el('passInput2').value;
        const confirm = el('confirmPass').value;
        const touched = touchedAll || {};
        const errors = {};
        if (touched.name || touchedAll) errors.userInputError = !name ? 'Enter a name.' : !nameOk(name) ? 'Use 2 to 40 characters, without < or >.' : '';
        if (touched.email || touchedAll) errors.emailInput2Error = !email ? 'Enter your email.' : !emailOk(email) ? 'That does not look like an email address.' : '';
        if (touched.confirm || touchedAll) errors.confirmPassError = !confirm ? 'Type the password again.' : confirm !== pass ? 'The two passwords do not match.' : '';
        Object.entries(errors).forEach(([id, message]) => setError(id, message));
        renderRules('passInput2Rules', pass, !!(touched.pass || touchedAll));
        return !!name && nameOk(name) && emailOk(email) && passwordOk(pass) && confirm === pass;
    }
    const touchedRegister = {};

    async function register(event) {
        event.preventDefault();
        notice('');
        const ok = validateRegister(true);
        if (!ok) {
            const firstBad = ['userInput', 'emailInput2', 'passInput2', 'confirmPass'].find((id) => (el(id + 'Error') && el(id + 'Error').textContent) || (id === 'passInput2' && !passwordOk(el('passInput2').value)));
            if (firstBad) el(firstBad).focus();
            return;
        }
        if (captchaOn() && !captchaToken('auCaptchaRegister')) return notice('Please complete the security check first.', 'bad');
        const email = el('emailInput2').value.trim().toLowerCase();
        const button = el('auRegisterBtn');
        busy(button, true, 'Creating account…');
        try {
            const reply = await gate('signup', { email, name: el('userInput').value.trim(), password: el('passInput2').value, captcha: captchaToken('auCaptchaRegister') });
            resetCaptcha('auCaptchaRegister');
            if (!reply.ok) {
                if (reply.code === 'exists') {
                    setMode('login');
                    el('emailInput').value = email;
                    notice('This email already has an account. Please sign in below.', 'bad');
                    return el('passInput').focus();
                }
                if (reply.code === 'weak_password') return validateRegister(true);
                return handleProblem(reply, 'auCaptchaRegister');
            }
            ctx.email = email;
            ctx.password = el('passInput2').value;
            if (reply.step === 'done' && reply.session) {                      // email confirmation is switched off in the project
                setRemember(true);
                const user = await adopt(reply);
                if (user) return finish(user);
            }
            codeSent(reply.minutes);
            el('auVerifyEmail').textContent = email;
            el('auVerifyCode').value = '';
            el('auVerifyError').textContent = '';
            show('auVerify');
        } finally {
            busy(button, false);
        }
    }

    async function verify(event) {
        event.preventDefault();
        const code = cleanCode(el('auVerifyCode').value);
        if (code.length !== 6) { setError('auVerifyError', 'Enter the 6 digits from the email.'); return el('auVerifyCode').focus(); }
        setError('auVerifyError', '');
        const button = el('auVerifyBtn');
        busy(button, true, 'Checking…');
        try {
            const reply = await gate('signup_verify', { email: ctx.email, code });
            if (!reply.ok) {
                el('auVerifyError').textContent = reply.message || 'That code is not right.';
                if (reply.code === 'bad_code') { el('auVerifyCode').select(); }
                return;
            }
            setRemember(true);
            const user = await adopt(reply);
            if (!user) return setError('auVerifyError', 'Your email is verified, but sign-in failed. Please sign in with your password.');
            hooks.afterRegister(user);
            await afterSignIn(user);
        } finally {
            busy(button, false);
        }
    }

    async function resendVerify() {
        const button = el('auVerifyResend');
        if (captchaOn() && !captchaToken('auCaptchaVerify')) { setError('auVerifyError', 'Please complete the security check first.'); return; }
        busy(button, true, 'Sending…');
        try {
            const reply = await gate('signup_resend', { email: ctx.email, captcha: captchaToken('auCaptchaVerify') });
            resetCaptcha('auCaptchaVerify');
            if (!reply.ok) return setError('auVerifyError', reply.message || 'The code could not be sent.');
            setError('auVerifyError', '');
            codeSent(reply.minutes);
            startCodeTimer('auVerifyTimer', 'auVerifyResend');
            hooks.toast('success', 'A new code is on its way');
        } finally {
            busy(button, false);
        }
    }

    // ---- forgot password ----
    async function forgot(event) {
        event.preventDefault();
        const email = el('auForgotEmail').value.trim().toLowerCase();
        if (!email) { setError('auForgotError', 'Enter the email you signed up with.'); return el('auForgotEmail').focus(); }
        if (!emailOk(email)) { setError('auForgotError', 'That does not look like an email address.'); return el('auForgotEmail').focus(); }
        setError('auForgotError', '');
        if (captchaOn() && !captchaToken('auCaptchaForgot')) return setError('auForgotError', 'Please complete the security check first.');
        const button = el('auForgotBtn');
        busy(button, true, 'Sending…');
        try {
            const reply = await gate('recover', { email, captcha: captchaToken('auCaptchaForgot') });
            resetCaptcha('auCaptchaForgot');
            if (!reply.ok) return setError('auForgotError', reply.message || 'The code could not be sent.');
            ctx.email = email;
            codeSent(reply.minutes);
            openReset(email);
        } finally {
            busy(button, false);
        }
    }
    function openReset(email) {
        ctx.email = email;
        el('auResetEmail').textContent = email;
        ['auResetCode', 'auResetPass', 'auResetConfirm'].forEach((id) => { el(id).value = ''; });
        ['auResetCodeError', 'auResetConfirmError'].forEach((id) => setError(id, ''));
        renderRules('auResetPassRules', '', false);
        show('auReset');
    }

    async function reset(event) {
        event.preventDefault();
        const code = cleanCode(el('auResetCode').value);
        const pass = el('auResetPass').value;
        const confirm = el('auResetConfirm').value;
        let bad = false;
        if (code.length !== 6) { setError('auResetCodeError', 'Enter the 6 digits from the email.'); bad = true; } else setError('auResetCodeError', '');
        renderRules('auResetPassRules', pass, true);
        if (!passwordOk(pass)) bad = true;
        if (confirm !== pass) { setError('auResetConfirmError', 'The two passwords do not match.'); bad = true; } else setError('auResetConfirmError', '');
        if (bad) return;
        const button = el('auResetBtn');
        busy(button, true, 'Updating…');
        try {
            const reply = await gate('reset', { email: ctx.email, code, password: pass });
            if (!reply.ok) {
                if (reply.code === 'weak_password' || reply.code === 'same_password') { notice(''); return setError('auResetConfirmError', reply.message); }
                return setError('auResetCodeError', reply.message || 'That code is not right.');
            }
            ctx.codeUntil = 0;
            startFresh('login');
            el('emailInput').value = ctx.email;
            notice('Your password was changed and you were signed out everywhere. Sign in with your new password.', 'good');
            el('passInput').focus();
        } finally {
            busy(button, false);
        }
    }

    // ---- authenticator at sign-in ----
    let mfaUser = null;
    let mfaRecovery = false;
    function openMfaStep(user) {
        mfaUser = user;
        mfaRecovery = false;
        el('auMfaCodeGroup').classList.remove('hidden');
        el('auMfaRecoveryGroup').classList.add('hidden');
        el('auMfaSwitch').textContent = 'I lost my phone: use a recovery code';
        el('auMfaSub').textContent = 'Open your authenticator app and enter the 6-digit code for VinExpenses.';
        el('auMfaError').textContent = '';
        el('auMfaCode').value = '';
        show('auMfa');
    }
    async function mfaSubmit(event) {
        event.preventDefault();
        const button = el('auMfaBtn');
        const error = el('auMfaError');
        error.textContent = '';
        if (mfaRecovery) {
            const code = el('auMfaRecovery').value.trim();
            const password = el('auMfaRecoveryPass').value || ctx.password;
            if (!code) { error.textContent = 'Enter a recovery code.'; return el('auMfaRecovery').focus(); }
            if (!password) { error.textContent = 'Enter your password.'; return el('auMfaRecoveryPass').focus(); }
            busy(button, true, 'Checking…');
            try {
                const email = (mfaUser && mfaUser.email) || ctx.email;
                const reply = await gate('mfa_recover', { email, password, code });
                if (!reply.ok) { if (reply.code === 'blocked') return showBlocked(reply); error.textContent = reply.message || 'That recovery code is not right.'; return; }
                const user = await adopt(reply);
                if (!user) { error.textContent = 'The authenticator was turned off. Please sign in again.'; return; }
                hooks.toast('success', 'Two-step verification was turned off. You can set it up again in Account.');
                return finish(user);
            } finally { busy(button, false); }
        }
        const code = cleanCode(el('auMfaCode').value);
        if (code.length !== 6) { error.textContent = 'Enter the 6 digits from your authenticator app.'; return el('auMfaCode').focus(); }
        busy(button, true, 'Checking…');
        try {
            const client = window.supabaseClient;
            const { data: factors, error: listError } = await client.auth.mfa.listFactors();
            const factor = factors && factors.totp && factors.totp.find((f) => f.status === 'verified');
            if (listError || !factor) { error.textContent = 'No authenticator was found for this account.'; return; }
            const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: factor.id });
            if (challengeError) { error.textContent = 'Could not start the check. Please try again.'; return; }
            const { error: verifyError } = await client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
            if (verifyError) { error.textContent = 'That code is not right. Codes change every 30 seconds, so wait for a new one.'; el('auMfaCode').select(); return; }
            const { data } = await client.auth.getUser();
            await finish(data.user || mfaUser);
        } finally { busy(button, false); }
    }
    function mfaSwitch() {
        mfaRecovery = !mfaRecovery;
        el('auMfaCodeGroup').classList.toggle('hidden', mfaRecovery);
        el('auMfaRecoveryGroup').classList.toggle('hidden', !mfaRecovery);
        el('auMfaSwitch').textContent = mfaRecovery ? 'Use my authenticator app instead' : 'I lost my phone: use a recovery code';
        el('auMfaSub').textContent = mfaRecovery ? 'Enter one of the recovery codes you saved, and your password. Using a code turns two-step verification off.' : 'Open your authenticator app and enter the 6-digit code for VinExpenses.';
        el('auMfaError').textContent = '';
        setTimeout(() => (mfaRecovery ? el('auMfaRecovery') : el('auMfaCode')).focus(), 30);
    }

    // =====================================================================
    // AUTHENTICATOR SETUP (Account, or after Google sign-in)
    // =====================================================================
    const mfa = { factorId: '', challengeId: '', onDone: null, codes: [], fresh: false };
    const sheet = () => el('mfaSheet');

    async function mfaStatus() {
        const client = window.supabaseClient;
        if (!client) return { enabled: false, known: false };
        try {
            const { data, error } = await client.auth.mfa.listFactors();
            if (error) return { enabled: false, known: false };
            const factor = (data.totp || []).find((f) => f.status === 'verified');
            return { enabled: !!factor, known: true, factorId: factor ? factor.id : '' };
        } catch (_) { return { enabled: false, known: false }; }
    }

    async function openMfaSetup(onDone) {
        mfa.onDone = onDone || null;
        el('mfaStepScan').classList.remove('hidden');
        el('mfaStepCodes').classList.add('hidden');
        el('mfaError').textContent = '';
        el('mfaCode').value = '';
        el('mfaQrBox').innerHTML = '<span class="mfa-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Preparing…</span>';
        el('mfaSecret').textContent = '';
        sheet().classList.add('active');
        hooks.syncScroll();
        const client = window.supabaseClient;
        try {
            // an unfinished setup from an earlier try is cleared first, so there is never a pile of half-made factors
            const { data: list } = await client.auth.mfa.listFactors();
            for (const f of (list && list.all) || []) if (f.status === 'unverified') await client.auth.mfa.unenroll({ factorId: f.id });
            const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'VinExpenses', issuer: 'VinExpenses' });
            if (error || !data) throw error || new Error('enroll failed');
            mfa.factorId = data.id;
            const qr = String(data.totp.qr_code || '');
            // The picture is an image, so nothing in it can run. Only an SVG data address is accepted.
            if (/^data:image\/svg\+xml/.test(qr)) { const img = document.createElement('img'); img.src = qr; img.alt = 'QR code to scan with your authenticator app'; img.width = 200; img.height = 200; el('mfaQrBox').replaceChildren(img); }
            else el('mfaQrBox').textContent = 'The picture could not be shown. Use the setup key below.';
            el('mfaSecret').textContent = String(data.totp.secret || '').replace(/(.{4})/g, '$1 ').trim();
            setTimeout(() => el('mfaCode').focus(), 80);
        } catch (err) {
            const message = /enroll|disabled|not enabled/i.test(String((err && err.message) || ''))
                ? 'Authenticator setup is not switched on for this project yet. In Supabase: Authentication, Multi-Factor, enable TOTP.'
                : 'Could not start the setup. Please try again.';
            el('mfaQrBox').textContent = '';
            el('mfaError').textContent = message;
        }
    }
    function closeMfaSetup() {
        sheet().classList.remove('active');
        hooks.syncScroll();
        const done = mfa.onDone; mfa.onDone = null;
        if (done) done(mfa.fresh);
        mfa.fresh = false;
    }

    async function mfaConfirm() {
        const code = cleanCode(el('mfaCode').value);
        if (code.length !== 6) { el('mfaError').textContent = 'Enter the 6 digits from your authenticator app.'; return el('mfaCode').focus(); }
        el('mfaError').textContent = '';
        const button = el('mfaConfirmBtn');
        busy(button, true, 'Checking…');
        try {
            const client = window.supabaseClient;
            const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: mfa.factorId });
            if (challengeError) { el('mfaError').textContent = 'Could not start the check. Please try again.'; return; }
            const { error } = await client.auth.mfa.verify({ factorId: mfa.factorId, challengeId: challenge.id, code });
            if (error) { el('mfaError').textContent = 'That code is not right. Codes change every 30 seconds, so wait for a new one.'; el('mfaCode').select(); return; }
            mfa.fresh = true;
            await showRecoveryCodes(true);
        } finally { busy(button, false); }
    }

    async function showRecoveryCodes(firstTime) {
        const reply = await recoveryCodes();
        el('mfaStepScan').classList.add('hidden');
        el('mfaStepCodes').classList.remove('hidden');
        el('mfaSaved').checked = false;
        el('mfaDone').disabled = true;
        if (!reply.ok) {
            mfa.codes = [];
            el('mfaCodes').innerHTML = '<li class="bad">The recovery codes could not be made just now. Two-step verification is on. Make new codes later in Account.</li>';
            el('mfaDone').disabled = false;
            return;
        }
        mfa.codes = reply.codes;
        el('mfaCodes').innerHTML = reply.codes.map((c) => `<li><code>${c}</code></li>`).join('');
        if (!firstTime) el('mfaSheetTitle').textContent = 'New recovery codes';
    }
    async function recoveryCodes() {
        const client = window.supabaseClient;
        try {
            const { data: session } = await client.auth.getSession();
            const { data, error } = await client.functions.invoke('auth-gate', { body: { action: 'recovery_codes', device: deviceId() }, headers: { Authorization: `Bearer ${session.session.access_token}` } });
            if (error) { let b = null; try { b = await error.context.clone().json(); } catch (_) { /* none */ } return { ok: false, message: (b && (b.message || b.error)) || 'failed' }; }
            return data;
        } catch (_) { return { ok: false, message: 'failed' }; }
    }

    // Shows the "new recovery codes" step on its own (Account -> Make new recovery codes)
    async function openRecoveryCodesSheet() {
        el('mfaSheetTitle').textContent = 'New recovery codes';
        el('mfaStepScan').classList.add('hidden');
        el('mfaStepCodes').classList.remove('hidden');
        el('mfaCodes').innerHTML = '<li><i class="fas fa-spinner fa-spin" aria-hidden="true"></i></li>';
        el('mfaDone').disabled = true;
        sheet().classList.add('active');
        hooks.syncScroll();
        await showRecoveryCodes(false);
    }

    // Checks the person's own password again (used before turning the authenticator off). It goes through the same
    // lockout as signing in, so it can't be used to guess passwords.
    async function confirmPassword(email, password) {
        if (!password) return { ok: false, message: 'Enter your password.' };
        const reply = await gate('signin', { email, password });
        if (reply.ok) return { ok: true };
        return { ok: false, message: reply.code === 'blocked' ? reply.message : reply.code === 'invalid' ? 'That password is not right.' : (reply.message || 'Could not check the password.') };
    }

    async function disableMfa() {
        const client = window.supabaseClient;
        const state = await mfaStatus();
        if (!state.enabled) return { ok: true };
        const { error } = await client.auth.mfa.unenroll({ factorId: state.factorId });
        return error ? { ok: false, message: 'Could not turn it off. You may need to sign in again first.' } : { ok: true };
    }

    // =====================================================================
    // CONTACT FORM
    // =====================================================================
    let feedbackReturn = null;
    function openFeedback(topic, signedInEmail) {
        feedbackReturn = document.activeElement;
        const group = el('feedbackEmailGroup');
        group.classList.toggle('hidden', !!signedInEmail);
        if (signedInEmail) el('feedbackEmail').value = signedInEmail;
        else if (!el('feedbackEmail').value) el('feedbackEmail').value = (el('emailInput').value || el('auForgotEmail').value || '').trim();
        el('feedbackTopic').value = ['locked_out', 'code_limit', 'report', 'bug', 'other'].includes(topic) ? topic : '';
        ['feedbackEmailError', 'feedbackTopicError', 'feedbackMessageError', 'feedbackCaptchaError'].forEach((id) => setError(id, ''));
        el('feedbackForm').classList.remove('hidden');
        el('feedbackDone').classList.add('hidden');
        el('feedbackSheet').classList.add('active');
        hooks.syncScroll();
        showCaptcha('feedbackCaptcha');
        setTimeout(() => (signedInEmail || el('feedbackEmail').value ? el('feedbackTopic') : el('feedbackEmail')).focus(), 80);
    }
    function closeFeedback() {
        el('feedbackSheet').classList.remove('active');
        hooks.syncScroll();
        if (feedbackReturn && feedbackReturn.focus && document.contains(feedbackReturn)) feedbackReturn.focus();
    }
    async function sendFeedback(event) {
        event.preventDefault();
        const signedIn = el('feedbackEmailGroup').classList.contains('hidden');
        const email = el('feedbackEmail').value.trim().toLowerCase();
        const topic = el('feedbackTopic').value;
        const message = el('feedbackMessage').value.trim();
        let first = null;
        const flag = (id, text, field) => { setError(id, text); if (text && !first) first = field; };
        flag('feedbackEmailError', signedIn ? '' : !email ? 'Enter the email we can reply to.' : !emailOk(email) ? 'That does not look like an email address.' : '', 'feedbackEmail');
        flag('feedbackTopicError', topic ? '' : 'Choose what this is about.', 'feedbackTopic');
        flag('feedbackMessageError', message.length < 5 ? 'Please tell us a little more (at least 5 characters).' : '', 'feedbackMessage');
        if (captchaOn() && !captchaToken('feedbackCaptcha')) flag('feedbackCaptchaError', 'Please complete the security check.', null);
        else setError('feedbackCaptchaError', '');
        if (first) return el(first).focus();
        if (!navigator.onLine) return setError('feedbackMessageError', 'You appear to be offline. Please check your connection.');
        const button = el('feedbackSend');
        busy(button, true, 'Sending…');
        try {
            const { data, error } = await window.supabaseClient.functions.invoke('feedback', { body: { email: signedIn ? undefined : email, topic, message, captcha: captchaToken('feedbackCaptcha') } });
            resetCaptcha('feedbackCaptcha');
            let reply = data;
            if (error) { try { reply = await error.context.clone().json(); } catch (_) { reply = null; } }
            if (!reply || !reply.ok) {
                const text = (reply && reply.message) || 'The message could not be sent. Please email the admin directly.';
                const field = reply && reply.field;
                if (field === 'email') return setError('feedbackEmailError', text);
                if (field === 'topic') return setError('feedbackTopicError', text);
                if (field === 'captcha') return setError('feedbackCaptchaError', text);
                return setError('feedbackMessageError', text);
            }
            el('feedbackMessage').value = '';
            el('feedbackCount').textContent = '0 / 2000';
            el('feedbackForm').classList.add('hidden');
            el('feedbackDone').classList.remove('hidden');
            el('feedbackDoneText').textContent = reply.message;
            el('feedbackDoneBtn').focus();
        } finally {
            busy(button, false);
        }
    }

    // ---- wiring ----
    const hooks = {
        signedIn: async () => {}, afterRegister: () => {}, toast: () => {}, syncScroll: () => {},
        // true when a sign-in is waiting for the authenticator step (the page must not open the app yet)
        pendingMfa: () => current === 'auMfa'
    };
    let started = false;
    function init(h) {
        if (started) return;
        started = true;
        Object.assign(hooks, h || {});

        el('loginTab').addEventListener('click', () => { notice(''); setMode('login'); });
        el('registerTab').addEventListener('click', () => { notice(''); setMode('register'); renderRules('passInput2Rules', el('passInput2').value, false); });
        el('auSignInForm').addEventListener('submit', signIn);
        el('auRegisterForm').addEventListener('submit', register);
        el('auVerify').addEventListener('submit', verify);
        el('auVerifyResend').addEventListener('click', resendVerify);
        el('auForgot').addEventListener('submit', forgot);
        el('auReset').addEventListener('submit', reset);
        el('auMfa').addEventListener('submit', mfaSubmit);
        el('auMfaSwitch').addEventListener('click', mfaSwitch);
        el('auMfaCancel').addEventListener('click', async () => { await window.supabaseClient.auth.signOut(); mfaUser = null; startFresh('login'); hooks.signedOut && hooks.signedOut(); });
        el('forgotBtn').addEventListener('click', () => { el('auForgotEmail').value = el('emailInput').value.trim(); setError('auForgotError', ''); show('auForgot'); });
        el('auHaveCode').addEventListener('click', () => {
            const email = el('auForgotEmail').value.trim().toLowerCase();
            if (!emailOk(email)) { setError('auForgotError', 'Enter your email first, then press "I already have a code".'); return el('auForgotEmail').focus(); }
            setError('auForgotError', '');
            openReset(email);
        });
        el('auBlockedReset').addEventListener('click', () => { el('auForgotEmail').value = el('emailInput').value.trim(); show('auForgot'); });
        document.querySelectorAll('[data-au-back]').forEach((b) => b.addEventListener('click', () => { ctx.codeUntil = 0; startFresh('login'); }));

        // live checks while typing; an error appears once the person has left the field
        const live = (id, key) => { el(id).addEventListener('blur', () => { touchedRegister[key] = true; validateRegister(touchedRegister); }); el(id).addEventListener('input', () => { if (touchedRegister[key]) validateRegister(touchedRegister); }); };
        live('userInput', 'name'); live('emailInput2', 'email'); live('confirmPass', 'confirm');
        el('passInput2').addEventListener('input', () => { touchedRegister.pass = true; renderRules('passInput2Rules', el('passInput2').value, true); if (el('confirmPass').value) { touchedRegister.confirm = true; validateRegister(touchedRegister); } });
        el('auResetPass').addEventListener('input', () => renderRules('auResetPassRules', el('auResetPass').value, true));
        el('auResetConfirm').addEventListener('input', () => setError('auResetConfirmError', el('auResetConfirm').value && el('auResetConfirm').value !== el('auResetPass').value ? 'The two passwords do not match.' : ''));
        el('emailInput').addEventListener('blur', () => { const v = el('emailInput').value.trim(); setError('emailInputError', v && !emailOk(v) ? 'That does not look like an email address.' : ''); });
        ['auVerifyCode', 'auResetCode', 'auMfaCode', 'mfaCode'].forEach((id) => el(id).addEventListener('input', () => { el(id).value = cleanCode(el(id).value); }));
        el('auMfaRecovery').addEventListener('input', () => { el('auMfaRecovery').value = el('auMfaRecovery').value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });

        // password visibility
        document.querySelectorAll('.toggle-visibility').forEach((btn) => btn.addEventListener('click', () => {
            const target = el(btn.dataset.target);
            const icon = btn.querySelector('i');
            const show = target.type === 'password';
            target.type = show ? 'text' : 'password';
            icon.className = `fas ${show ? 'fa-eye-slash' : 'fa-eye'}`;
        }));

        // authenticator setup + contact form
        el('mfaConfirmBtn').addEventListener('click', mfaConfirm);
        el('mfaCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mfaConfirm(); } });
        el('mfaSheetClose').addEventListener('click', closeMfaSetup);
        el('mfaDone').addEventListener('click', closeMfaSetup);
        el('mfaSheet').addEventListener('click', (e) => { if (e.target === el('mfaSheet') && el('mfaStepCodes').classList.contains('hidden')) closeMfaSetup(); });
        el('mfaSaved').addEventListener('change', () => { el('mfaDone').disabled = !el('mfaSaved').checked && mfa.codes.length > 0; });
        el('mfaCopySecret').addEventListener('click', () => copy(el('mfaSecret').textContent.replace(/\s/g, ''), 'Setup key copied'));
        el('mfaCopyCodes').addEventListener('click', () => copy(mfa.codes.join('\n'), 'Recovery codes copied'));
        el('mfaDownloadCodes').addEventListener('click', () => hooks.download(new Blob([`VinExpenses recovery codes\nEach works once. Keep this file private.\n\n${mfa.codes.join('\n')}\n`], { type: 'text/plain' }), 'vinexpenses-recovery-codes.txt'));
        el('feedbackClose').addEventListener('click', closeFeedback);
        el('feedbackDoneBtn').addEventListener('click', closeFeedback);
        el('feedbackSheet').addEventListener('click', (e) => { if (e.target === el('feedbackSheet')) closeFeedback(); });
        el('feedbackForm').addEventListener('submit', sendFeedback);
        el('feedbackMessage').addEventListener('input', () => { el('feedbackCount').textContent = `${el('feedbackMessage').value.length} / 2000`; });
        document.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-open-feedback]');
            if (trigger) openFeedback(trigger.dataset.openFeedback, hooks.signedInEmail ? hooks.signedInEmail() : '');
        });

        setMode('login');
        renderRules('passInput2Rules', '', false);
    }

    function copy(text, done) {
        const fallback = () => { hooks.toast('info', 'Select and copy it by hand: your browser blocked copying.'); };
        try { navigator.clipboard.writeText(text).then(() => hooks.toast('success', done), fallback); } catch (_) { fallback(); }
    }

    // ---- the Google first-time screen ----
    function initSetup(h) {
        const form = el('setupForm');
        if (form.dataset.bound) return;
        form.dataset.bound = '1';
        const touched = {};
        const check = (all) => {
            const name = el('setupUsername').value.trim(), pass = el('setupPassword').value, confirm = el('setupConfirmPassword').value;
            setError('setupUsernameError', touched.name || all ? (!name ? 'Enter a name.' : !nameOk(name) ? 'Use 2 to 40 characters, without < or >.' : '') : '');
            setError('setupConfirmError', touched.confirm || all ? (!confirm ? 'Type the password again.' : confirm !== pass ? 'The two passwords do not match.' : '') : '');
            renderRules('setupPasswordRules', pass, !!(touched.pass || all));
            return nameOk(name) && passwordOk(pass) && confirm === pass;
        };
        el('setupUsername').addEventListener('blur', () => { touched.name = true; check(); });
        el('setupPassword').addEventListener('input', () => { touched.pass = true; check(); });
        el('setupConfirmPassword').addEventListener('input', () => { touched.confirm = true; check(); });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!check(true)) return (el('setupUsernameError').textContent ? el('setupUsername') : el('setupPassword')).focus();
            const button = el('setupCompleteBtn');
            busy(button, true, 'Saving…');
            try {
                const result = await h.saveProfile(el('setupUsername').value.trim(), el('setupPassword').value);
                if (!result.ok) return setError('setupConfirmError', result.message);
                form.classList.add('hidden');
                el('setupMfaOffer').classList.remove('hidden');
            } finally { busy(button, false); }
        });
        el('setupMfaStart').addEventListener('click', () => openMfaSetup(() => h.finished()));
        el('setupMfaSkip').addEventListener('click', () => h.finished());
        el('setupSignOut').addEventListener('click', () => h.signOut());
        renderRules('setupPasswordRules', '', false);
    }
    function resetSetup() {
        const form = el('setupForm');
        form.classList.remove('hidden');
        el('setupMfaOffer').classList.add('hidden');
        ['setupUsername', 'setupPassword', 'setupConfirmPassword'].forEach((id) => { el(id).value = ''; });
        ['setupUsernameError', 'setupConfirmError'].forEach((id) => setError(id, ''));
        renderRules('setupPasswordRules', '', false);
    }

    return {
        init, initSetup, resetSetup, startFresh, show, notice, showBlocked, adopt,
        shouldSignOutOnStart, setRemember, deviceId,
        mfaStatus, openMfaSetup, closeMfaSetup, openRecoveryCodesSheet, disableMfa, openFeedback, closeFeedback,
        continueSignIn: (user) => afterSignIn(user), isAdopting: () => adopting, confirmPassword,
        checkPassword: (v) => ({ ok: passwordOk(v), rules: RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(v) })) }),
        isOpen: () => current,
        pendingMfa: () => current === 'auMfa'
    };
})();
