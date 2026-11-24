// === ADMIN DASHBOARD ===
// Manage accounts and help people. Only shown to administrators, and the server checks the role again on every action.
// It never loads anyone's expenses, income or reports: only account details, dates and counts.
window.Admin = (function () {
    'use strict';
    const el = (id) => document.getElementById(id);
    const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const hooks = { toast: () => {}, modal: () => {} };
    const state = { allowed: false, tab: 'users', search: '', status: '', page: 1, pages: 1, loaded: false, view: 'open', busy: false, timer: null, openMenu: null };
    let started = false;

    function fmtDate(value) {
        if (!value) return 'Never';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function ago(value) {
        if (!value) return 'No expenses yet';
        const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
        if (days <= 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 31) return `${days} days ago`;
        return fmtDate(value);
    }

    async function call(action, payload) {
        const client = window.supabaseClient;
        if (!client) return { ok: false, message: 'The app is not connected to its server.' };
        if (!navigator.onLine) return { ok: false, message: 'You appear to be offline.' };
        try {
            const { data, error } = await client.functions.invoke('admin', { body: Object.assign({ action }, payload) });
            if (error) {
                let body = null;
                try { body = await error.context.clone().json(); } catch (_) { /* none */ }
                return { ok: false, forbidden: error.context && error.context.status === 403, message: (body && (body.message || body.error)) || 'That could not be done. Please try again.' };
            }
            return data || { ok: false, message: 'That could not be done. Please try again.' };
        } catch (_) { return { ok: false, message: 'That could not be done. Please try again.' }; }
    }

    // Whether this person is an administrator. Never an error for everyone else: they simply don't see the menu.
    async function check() {
        const client = window.supabaseClient;
        state.allowed = false;
        if (client && navigator.onLine) {
            try {
                const { data } = await client.functions.invoke('admin-email-test', { body: { action: 'status' } });
                state.allowed = !!(data && data.admin);
            } catch (_) { state.allowed = false; }
        }
        el('adminNav').classList.toggle('hidden', !state.allowed);
        return state.allowed;
    }

    function notice(message, kind) {
        const box = el('adminNotice');
        box.textContent = message || '';
        box.classList.toggle('hidden', !message);
        box.classList.toggle('info', kind === 'good');
    }

    // ---- users ----
    const BADGE = { active: ['Active', 'active'], blocked: ['Sign-in blocked', 'overdue'], disabled: ['Disabled', 'unsaved'] };

    function actionsFor(u) {
        const items = [];
        items.push(['send_reset', 'Send password-reset code', 'fa-key']);
        if (u.status === 'blocked') items.push(['unblock', 'Unblock sign-in', 'fa-lock-open']);
        else if (!u.isYou) items.push(['block', 'Block sign-in', 'fa-ban']);
        if (u.codeLimited || u.codesThisMonth > 0) items.push(['clear_codes', 'Clear the code limit', 'fa-eraser']);
        if (u.authenticator) items.push(['reset_authenticator', 'Reset authenticator', 'fa-shield-halved']);
        items.push(['resend_report', 'Resend a monthly report', 'fa-paper-plane']);
        if (u.status === 'disabled') items.push(['enable', 'Enable account', 'fa-user-check']);
        else if (!u.isYou && !u.isAdmin) items.push(['disable', 'Disable account', 'fa-user-slash']);
        return items;
    }

    // The accounts on the current page, so the action sheet can list the right actions for one of them
    const shown = new Map();

    function userCard(u) {
        const [label, cls] = BADGE[u.status] || BADGE.active;
        shown.set(u.id, u);
        const lock = u.block ? (u.block.manual ? 'Blocked by an admin' : `Paused until ${new Date(u.block.until).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' })}`) : '';
        return `<article class="plan-item ad-user" data-id="${esc(u.id)}">
            <div class="plan-item-top">
                <div><div class="plan-item-title">${esc(u.name || u.email)}${u.isYou ? ' <span class="plan-badge active">You</span>' : u.isAdmin ? ' <span class="plan-badge active">Admin</span>' : ''}</div>
                <div class="plan-item-sub">${esc(u.email)}</div></div>
                <span class="plan-badge ${cls}">${label}</span>
            </div>
            <div class="plan-item-facts">
                <span>Last expense <b>${esc(ago(u.lastExpenseAt))}</b></span>
                <span>Joined <b>${esc(fmtDate(u.createdAt))}</b></span>
                <span>Telegram <b>${u.telegram ? 'linked' : 'no'}</b></span>
                <span>Authenticator <b>${u.authenticator ? 'on' : 'off'}</b></span>
                <span>Sign-in <b>${esc(u.provider === 'google' ? 'Google' : 'Email')}</b></span>
                ${u.codesThisMonth ? `<span>Codes this month <b>${u.codesThisMonth}</b>${u.codeLimited ? ' (limit reached)' : ''}</span>` : ''}
                ${lock ? `<span class="due-soon">${esc(lock)}</span>` : ''}
            </div>
            <div class="plan-item-actions">
                <button type="button" class="btn btn-outline btn-small ad-manage" data-ad-manage="${esc(u.id)}" aria-haspopup="dialog"><i class="fas fa-ellipsis" aria-hidden="true"></i> Manage</button>
            </div>
        </article>`;
    }

    async function loadUsers() {
        const box = el('adminUsers');
        if (!state.loaded) box.innerHTML = '<div class="history-empty small"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><div>Loading accounts…</div></div>';
        const reply = await call('list', { search: state.search, status: state.status, page: state.page });
        if (!reply.ok) {
            if (reply.forbidden) { state.allowed = false; el('adminNav').classList.add('hidden'); }
            box.innerHTML = `<div class="history-empty"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>${esc(reply.message)}<br><button type="button" class="link-btn" data-ad-retry>Try again</button></div></div>`;
            return;
        }
        state.loaded = true;
        state.pages = reply.pages;
        state.page = reply.page;
        const c = reply.counts;
        el('adminSummary').innerHTML = `<span><b>${c.all}</b> accounts</span><span><b>${c.blocked}</b> blocked</span><span><b>${c.disabled}</b> disabled</span>`;
        shown.clear();
        box.innerHTML = reply.users.length ? reply.users.map(userCard).join('')
            : `<div class="history-empty"><i class="fas fa-users" aria-hidden="true"></i><div>${state.search || state.status ? 'No accounts match.' : 'No accounts yet.'}</div></div>`;
        const pager = el('adminPager');
        pager.classList.toggle('single', reply.pages <= 1);
        el('adminPagerText').textContent = reply.pages <= 1 ? `${reply.total} account${reply.total === 1 ? '' : 's'}` : `Page ${reply.page} of ${reply.pages} · ${reply.total} accounts`;
        pager.querySelector('[data-page="prev"]').disabled = reply.page <= 1;
        pager.querySelector('[data-page="next"]').disabled = reply.page >= reply.pages;
    }

    const userById = (id) => { const card = el('adminUsers').querySelector(`[data-id="${CSS.escape(id)}"]`); return card ? { id, name: card.querySelector('.plan-item-title').childNodes[0].textContent.trim(), email: card.querySelector('.plan-item-sub').textContent.trim() } : { id, name: 'this person', email: '' }; };

    function lastMonths() {
        const out = [];
        const now = new Date();
        for (let i = 1; i <= 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' }) });
        }
        return out;
    }

    const CONFIRM = {
        send_reset: (u) => ({ title: 'Send a reset code?', message: `A 6-digit password-reset code will be emailed to ${u.email}. You will not see the code or the password.`, ok: 'Send code' }),
        block: (u) => ({ title: 'Block sign-in?', message: `${u.email} will not be able to sign in until you unblock them.`, ok: 'Block', danger: true }),
        unblock: (u) => ({ title: 'Unblock sign-in?', message: `${u.email} will be able to sign in again, and their wrong-password count starts again.`, ok: 'Unblock' }),
        clear_codes: (u) => ({ title: 'Clear the code limit?', message: `${u.email} will be able to ask for codes again this month.`, ok: 'Clear' }),
        reset_authenticator: (u) => ({ title: 'Reset the authenticator?', message: `Two-step verification will be turned off for ${u.email}. They can sign in with their password and set it up again. Only do this if you are sure it is them.`, ok: 'Reset', danger: true }),
        disable: (u) => ({ title: 'Disable this account?', message: `${u.email} will no longer be able to sign in. Their data stays, and you can enable the account again.`, ok: 'Disable', danger: true }),
        enable: (u) => ({ title: 'Enable this account?', message: `${u.email} will be able to sign in again.`, ok: 'Enable' })
    };

    function run(action, u, extra) {
        const label = el('adminUsers').querySelector(`[data-id="${CSS.escape(u.id)}"] .ad-manage`);
        if (state.busy) return;
        state.busy = true;
        if (label) { label.dataset.html = label.innerHTML; label.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Working…'; }
        call(action, Object.assign({ userId: u.id }, extra)).then(async (reply) => {
            state.busy = false;
            if (reply.ok) { hooks.toast('success', reply.message || 'Done'); await loadUsers(); }
            else { if (label && label.dataset.html) label.innerHTML = label.dataset.html; hooks.modal({ type: 'error', title: 'Not done', message: reply.message || 'That could not be done.' }); }
        });
    }

    function onUserAction(action, u) {
        if (action === 'resend_report') return chooseMonth(u);
        const plan = CONFIRM[action] && CONFIRM[action](u);
        if (!plan) return;
        hooks.modal({ type: plan.danger ? 'warning' : 'question', title: plan.title, message: plan.message, confirmText: plan.ok, cancelText: 'Cancel', danger: !!plan.danger, onConfirm: () => run(action, u) });
    }

    // A small picker built into the dialog area: the shared dialog has no input, so a sheet-like list is used
    function chooseMonth(u) {
        const months = lastMonths();
        const host = el('adminMonthPick');
        host.querySelector('.ad-pick-who').textContent = u.email;
        const select = el('adminMonthSelect');
        select.innerHTML = months.map((m) => `<option value="${m.value}">${esc(m.label)}</option>`).join('');
        host.classList.add('active');
        document.body.style.overflow = 'hidden';
        el('adminMonthSend').onclick = () => { host.classList.remove('active'); document.body.style.overflow = ''; run('resend_report', u, { month: select.value }); };
        select.focus();
    }
    // The list of things an admin can do to one account: a bottom sheet on phones, a small dialog on a desktop
    function openActions(u) {
        const host = el('adminActionSheet');
        host._user = u;
        host.querySelector('.ad-action-who').textContent = u.email;
        el('adminActionList').innerHTML = actionsFor(u).map(([action, text, icon]) => `<button type="button" class="ad-action ${action === 'disable' || action === 'block' || action === 'reset_authenticator' ? 'danger' : ''}" data-ad-action="${action}"><i class="fas ${icon}" aria-hidden="true"></i><span>${esc(text)}</span><i class="fas fa-chevron-right ad-chev" aria-hidden="true"></i></button>`).join('');
        host.classList.add('active');
        document.body.style.overflow = 'hidden';
        el('adminActionList').querySelector('button')?.focus();
    }
    function closeActions() { el('adminActionSheet').classList.remove('active'); el('adminActionSheet')._user = null; document.body.style.overflow = ''; }
    function closeMonthPick() { el('adminMonthPick').classList.remove('active'); document.body.style.overflow = ''; }

    // ---- feedback ----
    const TOPIC = { locked_out: 'Locked out', code_limit: 'Code limit', report: 'Report not received', bug: 'Something is broken', other: 'Other' };
    async function loadFeedback() {
        const box = el('adminFeedbackList');
        box.innerHTML = '<div class="history-empty small"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><div>Loading…</div></div>';
        const reply = await call('feedback_list', { status: state.view });
        if (!reply.ok) { box.innerHTML = `<div class="history-empty"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div>${esc(reply.message)}</div></div>`; return; }
        el('adminFeedbackCount').textContent = state.view === 'open' ? String(reply.items.length) : el('adminFeedbackCount').textContent;
        el('adminFeedbackCount').classList.toggle('hidden', state.view !== 'open' || reply.items.length === 0);
        box.innerHTML = reply.items.length ? reply.items.map((f) => `<article class="plan-item" data-fid="${f.id}">
            <div class="plan-item-top"><div><div class="plan-item-title">${esc(TOPIC[f.topic] || f.topic)}</div><div class="plan-item-sub"><a href="mailto:${esc(f.email)}">${esc(f.email)}</a> · ${esc(fmtDate(f.created_at))}</div></div></div>
            <p class="ad-message">${esc(f.message)}</p>
            <div class="plan-item-actions"><button type="button" class="btn btn-outline btn-small" data-fb-resolve="${f.status === 'open' ? 'true' : 'false'}"><i class="fas ${f.status === 'open' ? 'fa-check' : 'fa-rotate-left'}" aria-hidden="true"></i> ${f.status === 'open' ? 'Mark resolved' : 'Reopen'}</button></div>
        </article>`).join('') : `<div class="history-empty"><i class="fas fa-inbox" aria-hidden="true"></i><div>${state.view === 'open' ? 'No open messages. Nice.' : 'Nothing resolved yet.'}</div></div>`;
    }

    // ---- system ----
    async function loadSystem() {
        const health = el('adminHealth');
        health.innerHTML = '<li><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Checking…</li>';
        const [h, log] = await Promise.all([call('health'), call('log')]);
        health.innerHTML = h.ok ? Object.entries(h.checks).map(([name, ok]) => `<li class="${ok ? 'ok' : 'bad'}">${esc(name)}: ${ok ? 'OK' : 'needs attention'}</li>`).join('') : `<li class="bad">${esc(h.message)}</li>`;
        if (h.ok && h.openFeedback !== null) { el('adminFeedbackCount').textContent = String(h.openFeedback); el('adminFeedbackCount').classList.toggle('hidden', !h.openFeedback); }
        const NAMES = { disable_account: 'Disabled an account', enable_account: 'Enabled an account', block_signin: 'Blocked sign-in', unblock_signin: 'Unblocked sign-in', clear_code_limit: 'Cleared a code limit', send_password_reset: 'Sent a reset code', reset_authenticator: 'Reset an authenticator', resend_report: 'Resent a report', resolve_feedback: 'Resolved feedback', reopen_feedback: 'Reopened feedback' };
        el('adminLog').innerHTML = log.ok ? (log.items.length ? log.items.map((i) => `<div class="ad-log-row"><b>${esc(NAMES[i.action] || i.action)}</b><span>${esc(i.detail || '')}</span><time>${esc(new Date(i.created_at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</time></div>`).join('') : '<div class="history-empty small">Nothing yet.</div>')
            : `<div class="history-empty small">${esc(log.message)}</div>`;
    }

    // ---- tabs ----
    function setTab(name) {
        state.tab = ['users', 'feedback', 'system'].includes(name) ? name : 'users';
        ['users', 'feedback', 'system'].forEach((t) => {
            const on = t === state.tab;
            el('adminPane' + t[0].toUpperCase() + t.slice(1)).classList.toggle('hidden', !on);
            const tab = el('adminTab' + t[0].toUpperCase() + t.slice(1));
            tab.classList.toggle('active', on); tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
        });
        if (state.tab === 'users') loadUsers(); else if (state.tab === 'feedback') loadFeedback(); else loadSystem();
    }

    // Called each time the Admin screen opens
    function open() {
        if (!state.allowed) { notice('This area is for administrators only.'); return false; }
        notice('');
        setTab(state.tab);
        return true;
    }

    function init(h) {
        if (started) return;
        started = true;
        Object.assign(hooks, h || {});
        document.querySelector('[aria-label="Admin sections"]').addEventListener('click', (e) => { const t = e.target.closest('[data-admin-tab]'); if (t) setTab(t.dataset.adminTab); });
        el('adminSearch').addEventListener('input', () => { clearTimeout(state.timer); state.timer = setTimeout(() => { state.search = el('adminSearch').value.trim(); state.page = 1; loadUsers(); }, 300); });
        el('adminStatus').addEventListener('change', () => { state.status = el('adminStatus').value; state.page = 1; loadUsers(); });
        el('adminRefresh').addEventListener('click', loadUsers);
        el('adminPager').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (!b || b.disabled) return; state.page += b.dataset.page === 'next' ? 1 : -1; loadUsers(); });
        el('adminUsers').addEventListener('click', (e) => {
            if (e.target.closest('[data-ad-retry]')) return loadUsers();
            const m = e.target.closest('[data-ad-manage]');
            if (m && shown.has(m.dataset.adManage)) openActions(shown.get(m.dataset.adManage));
        });
        el('adminActionList').addEventListener('click', (e) => {
            const b = e.target.closest('[data-ad-action]');
            if (!b) return;
            const u = el('adminActionSheet')._user;
            closeActions();
            if (u) onUserAction(b.dataset.adAction, userById(u.id));
        });
        el('adminActionClose').addEventListener('click', closeActions);
        el('adminActionSheet').addEventListener('click', (e) => { if (e.target === el('adminActionSheet')) closeActions(); });
        el('adminFeedbackView').addEventListener('click', (e) => {
            const b = e.target.closest('[data-value]'); if (!b) return;
            state.view = b.dataset.value;
            el('adminFeedbackView').querySelectorAll('.choice').forEach((c) => { c.classList.toggle('active', c === b); c.setAttribute('aria-pressed', String(c === b)); });
            loadFeedback();
        });
        el('adminFeedbackList').addEventListener('click', async (e) => {
            const b = e.target.closest('[data-fb-resolve]'); if (!b) return;
            const id = Number(b.closest('[data-fid]').dataset.fid);
            b.disabled = true;
            const reply = await call('feedback_resolve', { id, resolved: b.dataset.fbResolve === 'true' });
            if (!reply.ok) { b.disabled = false; return hooks.toast('error', reply.message || 'That could not be updated.'); }
            loadFeedback();
        });
        el('adminHealthRefresh').addEventListener('click', loadSystem);
        el('adminMonthCancel').addEventListener('click', closeMonthPick);
        el('adminMonthPick').addEventListener('click', (e) => { if (e.target === el('adminMonthPick')) closeMonthPick(); });
    }

    function reset() {
        state.allowed = false; state.loaded = false; state.tab = 'users'; state.search = ''; state.status = ''; state.page = 1;
        el('adminNav').classList.add('hidden');
        el('adminSearch').value = ''; el('adminStatus').value = '';
        el('adminUsers').innerHTML = ''; el('adminFeedbackList').innerHTML = '';
        closeMonthPick();
    }

    return { init, check, open, reset, isAllowed: () => state.allowed, closeMonthPick };
})();
