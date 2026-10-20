// === SUPABASE CONFIG ===
// Values come from .env via build-config.js, which generates config.js (window.APP_CONFIG).
const APP_CONFIG = window.APP_CONFIG || {};
const SUPABASE_URL = APP_CONFIG.SUPABASE_URL;
const SUPABASE_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY;
const configMissing = !SUPABASE_URL || !SUPABASE_ANON_KEY;

// Stamped with the commit id by the deploy workflow (see .github/workflows/deploy.yml)
const APP_BUILD = '__BUILD__';
const BUILD_PLACEHOLDER = '__BUILD' + '__'; // split so the stamping step can't rewrite it

const cameFromEmailConfirmation = window.location.hash.includes('type=signup');
let recoveryMode = window.location.hash.includes('type=recovery'); // opened from a reset-password email
const hashError = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error_description');
const supabaseClient = (window.supabase && !configMissing) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Explains why the backend isn't available (missing config vs. library failed to load)
function backendUnavailable() {
    return configMissing
        ? { title: 'App not configured', message: 'config.js is missing. Create a .env file (see .env.example) and run "node build-config.js", then reload.' }
        : { title: 'Can\'t reach the server', message: 'The sign-in library failed to load. Check your internet connection and reload.' };
}

// === CONFIG ===
const DEFAULT_CATEGORIES = [
    { key: 'beverages', label: 'Beverages', icon: 'fa-mug-hot', color: '#4f46e5' },
    { key: 'travel', label: 'Travel', icon: 'fa-plane', color: '#06b6d4' },
    { key: 'entertain', label: 'Entertain', icon: 'fa-film', color: '#f59e0b' },
    { key: 'work', label: 'Work', icon: 'fa-briefcase', color: '#10b981' },
    { key: 'food', label: 'Food', icon: 'fa-utensils', color: '#ef4444' },
    { key: 'shopping', label: 'Shopping', icon: 'fa-bag-shopping', color: '#8b5cf6' },
    { key: 'utilities', label: 'Utilities', icon: 'fa-bolt', color: '#0ea5e9' },
    { key: 'car', label: 'Car', icon: 'fa-car', color: '#f97316' },
    { key: 'health', label: 'Health', icon: 'fa-heart-pulse', color: '#ec4899' },
    { key: 'other', label: 'Other', icon: 'fa-ellipsis', color: '#6b7280' }
];
const DEFAULT_PAYMENTS = [
    { key: 'bank', label: 'Bank', icon: 'fa-building-columns', color: '#4f46e5' },
    { key: 'card', label: 'Card', icon: 'fa-credit-card', color: '#4f46e5' },
    { key: 'ewallet', label: 'E-Wallet', icon: 'fa-mobile-screen', color: '#4f46e5' }
];
const INCOME_SOURCES = [
    { key: 'Salary', label: 'Salary', icon: 'fa-sack-dollar', color: '#4f46e5' },
    { key: 'Freelance', label: 'Freelance', icon: 'fa-laptop-code', color: '#4f46e5' },
    { key: 'Bonus', label: 'Bonus', icon: 'fa-gift', color: '#4f46e5' },
    { key: 'Investment', label: 'Investment', icon: 'fa-chart-line', color: '#4f46e5' }
];
let CATEGORIES = DEFAULT_CATEGORIES.map(item => ({ ...item, active: true }));
let PAYMENTS = DEFAULT_PAYMENTS.map(item => ({ ...item, active: true }));
let catByKey = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
let payByKey = Object.fromEntries(PAYMENTS.map(p => [p.key, p]));
const activeTaxonomy = items => items.filter(item => item.active !== false);
const safeIcon = value => /^fa-[a-z0-9-]+$/.test(value || '') ? value : 'fa-tag';
const safeColor = value => /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : 'var(--primary)';
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// === STATE ===
let currentUser = null;
let expenses = [];
let incomes = [];
let lastRegisteredEmail = null;
let isLoading = false;
let expCategoryValue = CATEGORIES[0].key;
let expPaymentValue = PAYMENTS[0].key;
let editing = null; // { type, id }
let visibleHistoryTransactions = [];
let recurring = [];
let recurringLoadError = false;
let recurringIncomes = [];
let recurringIncomeLoadError = false;
let taxonomyLoadError = false;
let dateFormat = 'dmy_short';
let budgets = [];            // { id, category ('all' = overall), amount }
let budgetsLoadError = false;
let recCategoryValue = 'utilities';
let recPaymentValue = 'bank';
let recFreqValue = 'monthly';
let editingRecurringId = null;
let monthlyReportPreference = null;

let selectedDate = new Date();
selectedDate.setDate(1);
selectedDate.setHours(0, 0, 0, 0);

// === DOM REFS ===
const $ = id => document.getElementById(id);

const authTitle = $('authTitle');
const authSub = $('authSub');
const emailInput = $('emailInput');
const passInput = $('passInput');
const userInput = $('userInput');
const confirmPass = $('confirmPass');
const emailInput2 = $('emailInput2');
const passInput2 = $('passInput2');
const authActionBtn = $('authActionBtn');
const googleBtn = $('googleBtn');
const logoutBtn = $('logoutBtn');
const resendRow = $('resendRow');
const resendBtn = $('resendBtn');
const loginTab = $('loginTab');
const registerTab = $('registerTab');
const loginFields = $('loginFields');
const registerFields = $('registerFields');
const passStrength = $('passStrength');

const setupUsername = $('setupUsername');
const setupPassword = $('setupPassword');
const setupConfirmPassword = $('setupConfirmPassword');
const setupCompleteBtn = $('setupCompleteBtn');

const userNameDisplay = $('userNameDisplay');
const totalCard = $('totalCard');
const totalSpent = $('totalSpent');
const totalIncomeDisplay = $('totalIncome');
const totalBalance = $('totalBalance');
const balancePill = $('balancePill');
const categoryGrid = $('categoryGrid');
const heroLabel = $('heroLabel');
const spendDelta = $('spendDelta');
const heroBar = $('heroBar');
const heroBarWrap = $('heroBarWrap');
const heroBarCaption = $('heroBarCaption');
const donutTotal = $('donutTotal');

const addSheet = $('addSheet');
const accountSheet = $('accountSheet');
const recentList = $('recentList');
const selectedMonthDisplay = $('selectedMonthDisplay');
const monthPicker = $('monthPicker');
const monthPickerBtn = $('monthPickerBtn');
const prevMonthBtn = $('prevMonthBtn');
const nextMonthBtn = $('nextMonthBtn');
const todayMonthBtn = $('todayMonthBtn');
const viewAllBtn = $('viewAllBtn');

const expAmount = $('expAmount');
const expDate = $('expDate');
const expNote = $('expNote');
const expMerchant = $('expMerchant');
const expNoteLabel = $('expNoteLabel');
const saveExpenseBtn = $('saveExpenseBtn');
const receiptFileInput = $('receiptFileInput');
const scanReceiptBtn = $('scanReceiptBtn');
const receiptScanStatus = $('receiptScanStatus');
const nearbyPlaceBtn = $('nearbyPlaceBtn');
const nearbyPlaceStatus = $('nearbyPlaceStatus');
const editMerchant = $('editMerchant');
const incomeAmount = $('incomeAmount');
const incomeSource = $('incomeSource');
const incomeDate = $('incomeDate');
const saveIncomeBtn = $('saveIncomeBtn');

const historyList = $('historyList');
const historySummary = $('historySummary');
const historyTypeFilter = $('historyTypeFilter');
const historyCategoryFilter = $('historyCategoryFilter');
const historyMonthFilter = $('historyMonthFilter');
const historySearch = $('historySearch');
const historyResetBtn = $('historyResetBtn');

const editModal = $('editModal');
const editTitle = $('editTitle');
const editAmount = $('editAmount');
const editDate = $('editDate');
const editCategory = $('editCategory');
const editPayment = $('editPayment');
const editSource = $('editSource');
const editNote = $('editNote');
const editExpenseFields = $('editExpenseFields');
const editIncomeFields = $('editIncomeFields');
const editSaveBtn = $('editSaveBtn');
const editCancelBtn = $('editCancelBtn');

// === HELPERS ===
const pad = n => String(n).padStart(2, '0');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

function formatMoney(n) {
    return 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMonthDisplay(date) {
    return date.toLocaleString('en-MY', { month: 'long', year: 'numeric' });
}

function formatMonthValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function toInputDate(value) {
    const d = value ? new Date(value) : new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateDisplay(value, { includeYear = true } = {}) {
    const dateString = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toInputDate(value);
    const [year, month, day] = dateString.split('-').map(Number);
    if (dateFormat === 'ymd') return dateString;
    if (dateFormat === 'dmy') return `${pad(day)}/${pad(month)}/${year}`;
    const options = { day: 'numeric', month: 'short' };
    if (includeYear) options.year = 'numeric';
    return new Date(year, month - 1, day).toLocaleDateString('en-MY', options);
}

// Combine a yyyy-mm-dd input value with the time-of-day of `base`, so
// same-day entries keep a sensible order.
function dateInputToISO(value, base = new Date()) {
    if (!value) return new Date().toISOString();
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(base);
    dt.setFullYear(y, m - 1, d);
    return dt.toISOString();
}

function isSameMonth(dateStr, ref = selectedDate) {
    const d = new Date(dateStr);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function sumAmount(list) {
    return list.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
}

function getTotalSpent() { return sumAmount(expenses.filter(e => isSameMonth(e.created_at))); }
function getTotalIncome() { return sumAmount(incomes.filter(i => isSameMonth(i.created_at))); }
function getCategoryTotal(cat) {
    return sumAmount(expenses.filter(e => e.category === cat && isSameMonth(e.created_at)));
}

function byDateDesc(a, b) { return new Date(b.created_at) - new Date(a.created_at); }

// === MODAL ===
const modalOverlay = $('appModal');
const modalIconWrap = $('modalIcon');
const modalTitleEl = $('modalTitle');
const modalMessageEl = $('modalMessage');
const modalWarning = $('modalWarning');
const modalWarningText = $('modalWarningText');
const modalConfirmBtn = $('modalConfirmBtn');
const modalCancelBtn = $('modalCancelBtn');

const MODAL_ICONS = {
    success: { icon: 'fa-circle-check', cls: 'success-icon' },
    error: { icon: 'fa-circle-xmark', cls: 'error-icon' },
    warning: { icon: 'fa-triangle-exclamation', cls: 'warning-icon' },
    info: { icon: 'fa-circle-info', cls: 'info-icon' },
    question: { icon: 'fa-circle-question', cls: 'question-icon' }
};

let dismissModal = null;

function syncBodyScroll() {
    // Lock page scroll while any dialog or sheet is open
    document.body.style.overflow = document.querySelector('.modal-overlay-full.active, .report-view.active') ? 'hidden' : '';
}

function closeModal() {
    modalOverlay.classList.remove('active');
    modalConfirmBtn.onclick = null;
    modalCancelBtn.onclick = null;
    modalOverlay.onclick = null;
    dismissModal = null;
    syncBodyScroll();
}

function showModal({ type = 'info', title = '', message = '', warningText = '', confirmText = 'OK', cancelText = null, danger = false, onConfirm = null, onCancel = null }) {
    const meta = MODAL_ICONS[type] || MODAL_ICONS.info;
    modalIconWrap.className = `modal-icon ${meta.cls}`;
    modalIconWrap.innerHTML = `<i class="fas ${meta.icon}"></i>`;
    modalTitleEl.textContent = title;
    modalMessageEl.textContent = message;

    if (warningText) {
        modalWarningText.textContent = warningText;
        modalWarning.classList.remove('hidden');
    } else {
        modalWarning.classList.add('hidden');
    }

    modalConfirmBtn.textContent = confirmText;
    modalConfirmBtn.className = `modal-btn ${danger ? 'modal-danger' : 'modal-confirm'}`;

    if (cancelText) {
        modalCancelBtn.textContent = cancelText;
        modalCancelBtn.classList.remove('hidden');
    } else {
        modalCancelBtn.classList.add('hidden');
    }

    const cancel = () => { closeModal(); if (onCancel) onCancel(); };
    modalConfirmBtn.onclick = () => { closeModal(); if (onConfirm) onConfirm(); };
    modalCancelBtn.onclick = cancel;
    modalOverlay.onclick = (e) => { if (e.target === modalOverlay) cancel(); };
    dismissModal = cancelText ? cancel : () => { closeModal(); if (onConfirm) onConfirm(); };

    modalOverlay.classList.add('active');
    syncBodyScroll();
    modalConfirmBtn.focus();
}

// === TOAST ===
// opts: { actionLabel, onAction, duration } — an action (e.g. "Undo") keeps the toast up longer
function showToast(type, message, opts = {}) {
    const host = $('toastHost');
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span></span>`;
    el.querySelector('span').textContent = message;

    const dismiss = () => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    };
    if (opts.actionLabel && opts.onAction) {
        el.classList.add('has-action');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = opts.actionLabel;
        btn.addEventListener('click', () => { dismiss(); opts.onAction(); });
        el.appendChild(btn);
    }
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(dismiss, opts.duration || (opts.actionLabel ? 6000 : 2600));
}

// Escape closes whichever dialog is open (the top-most one first)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (dismissModal) dismissModal();
        else if ($('reportView').classList.contains('active')) closeReportView();
        else if ($('taxonomySheet').classList.contains('active')) closeTaxonomyManager();
        else if (editModal.classList.contains('active')) closeEditModal();
        else if (addSheet.classList.contains('active')) closeAddSheet();
        else if (accountSheet.classList.contains('active')) closeAccountSheet();
        else if ($('budgetSheet').classList.contains('active')) closeBudgetSheet();
        else if ($('resetSheet').classList.contains('active')) closeResetSheet();
        return;
    }
    // "N" opens the quick-add sheet from anywhere (desktop shortcut)
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (e.key.toLowerCase() === 'n' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey
        && currentUser && !document.querySelector('.modal-overlay-full.active, .report-view.active')) {
        e.preventDefault();
        openAddSheet('expense');
    }
});

// === BUSY STATE ===
function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
        button.dataset.originalLabel = button.innerHTML;
        button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${busyLabel}`;
        button.disabled = true;
    } else {
        button.innerHTML = button.dataset.originalLabel || button.innerHTML;
        button.disabled = false;
    }
}

// === ANIMATED NUMBERS ===
function animateAmount(el, target) {
    const from = parseFloat(el.dataset.value || 0);
    el.dataset.value = target;
    cancelAnimationFrame(el._raf);
    clearTimeout(el._timer);
    if (prefersReducedMotion || from === target) {
        el.textContent = formatMoney(target);
        return;
    }
    const start = performance.now();
    const duration = 600;
    const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = formatMoney(from + (target - from) * eased);
        if (t < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
    // rAF is paused in background tabs; make sure the final value always lands
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        cancelAnimationFrame(el._raf);
        el.textContent = formatMoney(target);
    }, duration + 50);
}

// === NAVIGATION ===
const SCREEN_BY_NAV = {
    dashboard: 'dashboardScreen',
    recurring: 'recurringScreen',
    history: 'historyScreen'
};

// Sidebar and tab bar share the .nav-item class, so one call keeps both in sync
function setActiveNav(screen) {
    document.querySelectorAll('.nav-item').forEach(b => {
        const on = b.dataset.screen === screen;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
    });
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = $(screenId);
    if (target) target.classList.add('active');

    // The sidebar / tab bar are hidden on the sign-in and setup screens
    const isAuthLike = screenId === 'authScreen' || screenId === 'setupScreen' || screenId === 'resetPasswordScreen';
    document.body.classList.toggle('is-auth', isAuthLike);

    if (screenId === 'dashboardScreen') updateDashboard();
    if (screenId === 'historyScreen') renderHistory();
    if (screenId === 'recurringScreen') renderRecurring();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

function navigate(nav) {
    setActiveNav(nav);
    showScreen(SCREEN_BY_NAV[nav]);
}

// One delegated handler for everything marked data-screen: the sidebar, the tab bar, and in-page
// controls such as History's "Add transaction" and the dashboard's "Recurring →" link. (It used to
// be bound to .nav-item only, which left those in-page controls silently dead.)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-screen]');
    if (!btn) return;
    const dest = btn.dataset.screen;
    if (dest === 'add') openAddSheet('expense');
    else if (dest === 'account') openAccountSheet();
    else if (SCREEN_BY_NAV[dest]) navigate(dest);
});

// === SHEETS (add transaction, account) ===
let addMode = 'expense';

function setAddMode(mode) {
    addMode = mode === 'income' ? 'income' : 'expense';
    const isExpense = addMode === 'expense';
    $('addTabExpense').classList.toggle('active', isExpense);
    $('addTabIncome').classList.toggle('active', !isExpense);
    $('addTabExpense').setAttribute('aria-selected', String(isExpense));
    $('addTabIncome').setAttribute('aria-selected', String(!isExpense));
    $('expensePane').classList.toggle('hidden', !isExpense);
    $('incomePane').classList.toggle('hidden', isExpense);
}

function openAddSheet(mode = 'expense') {
    if (!currentUser) return;
    if (!expDate.value) expDate.value = toInputDate();
    if (!incomeDate.value) incomeDate.value = toInputDate();
    setAddMode(mode);
    addSheet.classList.add('active');
    syncBodyScroll();
    // Amount first: the keyboard is ready as soon as the sheet opens
    setTimeout(() => (addMode === 'expense' ? expAmount : incomeAmount).focus(), 60);
}

function closeAddSheet() {
    addSheet.classList.remove('active');
    syncBodyScroll();
}

function openAccountSheet() {
    if (!currentUser) return;
    renderBuildInfo();
    accountSheet.classList.add('active');
    loadMonthlyReportPreference();
    loadDisplayPreferences();
    syncBodyScroll();
}

function setDisplayPreferenceStatus(message, error = false) {
    $('displayPreferencesStatus').textContent = message;
    $('displayPreferencesStatus').classList.toggle('error', error);
}

function refreshDateDisplays() {
    if (!currentUser) return;
    updateDashboard();
    if ($('historyScreen').classList.contains('active')) renderHistory();
    if ($('recurringScreen').classList.contains('active')) renderRecurring();
}

async function loadDisplayPreferences() {
    $('dateFormatSelect').value = dateFormat;
    if (!supabaseClient || !navigator.onLine) return;
    const { data, error } = await supabaseClient.from('user_preferences')
        .select('date_format').eq('user_id', currentUser.id).maybeSingle();
    if (error) {
        setDisplayPreferenceStatus('Run migration-user-preferences.sql in Supabase to save date preferences.', true);
        return;
    }
    const savedFormat = data?.date_format || 'dmy_short';
    const changed = dateFormat !== savedFormat;
    dateFormat = savedFormat;
    $('dateFormatSelect').value = dateFormat;
    setDisplayPreferenceStatus('Amounts are always shown in MYR (RM).');
    if (changed) refreshDateDisplays();
}

$('saveDisplayPreferencesBtn').addEventListener('click', async () => {
    if (!currentUser || !supabaseClient) return showToast('error', 'Sign in to save display preferences.');
    const selected = $('dateFormatSelect').value;
    if (!['dmy_short', 'dmy', 'ymd'].includes(selected)) return setDisplayPreferenceStatus('Choose one of the available date formats.', true);
    const { error } = await supabaseClient.from('user_preferences').upsert({
        user_id: currentUser.id, date_format: selected, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) {
        console.error('Could not save display preferences:', error);
        return setDisplayPreferenceStatus('Could not save. Run migration-user-preferences.sql and try again.', true);
    }
    dateFormat = selected;
    refreshDateDisplays();
    setDisplayPreferenceStatus('Date format saved. Amounts remain in MYR (RM).');
    showToast('success', 'Display preferences saved');
});

function setReportPreferenceStatus(message, isError = false) {
    const status = $('reportEmailStatus');
    status.textContent = message;
    status.classList.toggle('error', isError);
}

async function loadMonthlyReportPreference() {
    const emailInput = $('monthlyReportEmail');
    const enabledInput = $('monthlyReportEnabled');
    emailInput.value = monthlyReportPreference?.recipient_email || currentUser?.email || '';
    enabledInput.checked = !!monthlyReportPreference?.enabled;
    setReportPreferenceStatus(enabledInput.checked ? 'Monthly reports are enabled.' : 'Reports are off until you turn them on.');
    if (!supabaseClient || !navigator.onLine) return;
    const { data, error } = await supabaseClient.from('monthly_report_preferences')
        .select('recipient_email, enabled, sent_for_month').eq('user_id', currentUser.id).maybeSingle();
    if (error) {
        setReportPreferenceStatus('Run supabase-schema.sql in Supabase to enable email reports.', true);
        return;
    }
    monthlyReportPreference = data || { recipient_email: currentUser.email || '', enabled: false, sent_for_month: null };
    emailInput.value = monthlyReportPreference.recipient_email || currentUser.email || '';
    enabledInput.checked = !!monthlyReportPreference.enabled;
    setReportPreferenceStatus(enabledInput.checked ? 'Monthly reports are enabled.' : 'Reports are off until you turn them on.');
}

$('saveReportEmailBtn').addEventListener('click', async () => {
    if (!currentUser || !supabaseClient) return showToast('error', 'Sign in to save this preference.');
    const email = $('monthlyReportEmail').value.trim();
    const enabled = $('monthlyReportEnabled').checked;
    if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setReportPreferenceStatus('Enter a valid email address before enabling reports.', true);
        $('monthlyReportEmail').focus();
        return;
    }
    const button = $('saveReportEmailBtn');
    setBusy(button, true, 'Saving...');
    const preference = { user_id: currentUser.id, recipient_email: email || currentUser.email || '', enabled };
    const { data, error } = await supabaseClient.from('monthly_report_preferences')
        .upsert(preference, { onConflict: 'user_id' }).select('recipient_email, enabled, sent_for_month').single();
    setBusy(button, false);
    if (error) {
        console.error('Could not save monthly report preference:', error);
        setReportPreferenceStatus('Could not save. Run supabase-schema.sql and try again.', true);
        return;
    }
    monthlyReportPreference = data;
    setReportPreferenceStatus(data.enabled ? `Reports will be sent to ${data.recipient_email} on the first day of each month.` : 'Monthly report emails are turned off.');
    showToast('success', 'Monthly report preference saved');
});

function closeAccountSheet() {
    accountSheet.classList.remove('active');
    syncBodyScroll();
}

let taxonomyKind = 'category';
let taxonomyEditingKey = null;
function taxonomyItems() { return taxonomyKind === 'category' ? CATEGORIES : PAYMENTS; }
function taxonomyStatus(message, error = false) {
    $('taxonomyStatus').textContent = message;
    $('taxonomyStatus').classList.toggle('error', error);
}
function renderTaxonomyManager() {
    const categoryMode = taxonomyKind === 'category';
    $('taxonomyCategoryTab').classList.toggle('active', categoryMode);
    $('taxonomyCategoryTab').setAttribute('aria-selected', String(categoryMode));
    $('taxonomyPaymentTab').classList.toggle('active', !categoryMode);
    $('taxonomyPaymentTab').setAttribute('aria-selected', String(!categoryMode));
    $('taxonomyNameInput').placeholder = categoryMode ? 'New category name' : 'New payment method';
    $('taxonomyNameInput').setAttribute('aria-label', categoryMode ? 'Category name' : 'Payment method name');
    $('taxonomySaveBtn').textContent = taxonomyEditingKey ? 'Save name' : 'Add';
    $('taxonomyList').innerHTML = taxonomyItems().map(item => `
        <div class="taxonomy-row ${item.active ? '' : 'inactive'}" data-key="${escapeHtml(item.key)}">
            <span class="taxonomy-row-icon" style="--chip-color:${safeColor(item.color)}"><i class="fas ${safeIcon(item.icon)}" aria-hidden="true"></i></span>
            <span class="taxonomy-row-name"><b>${escapeHtml(item.label)}</b><small>${item.is_builtin ? 'Built-in' : 'Custom'}${item.active ? '' : ' · Inactive'}</small></span>
            <button type="button" class="icon-btn" data-tax-action="edit" aria-label="Rename ${escapeHtml(item.label)}" title="Rename"><i class="fas fa-pen" aria-hidden="true"></i></button>
            <button type="button" class="icon-btn" data-tax-action="toggle" aria-label="${item.active ? 'Deactivate' : 'Reactivate'} ${escapeHtml(item.label)}" title="${item.active ? 'Deactivate' : 'Reactivate'}"><i class="fas ${item.active ? 'fa-eye-slash' : 'fa-rotate-left'}" aria-hidden="true"></i></button>
        </div>`).join('') || '<div class="history-empty small">No options yet.</div>';
}
function openTaxonomyManager() {
    taxonomyEditingKey = null;
    $('taxonomyNameInput').value = '';
    $('taxonomySheet').classList.add('active');
    taxonomyStatus(taxonomyLoadError ? 'Run migration-custom-categories-payments.sql in Supabase to manage these options.' : 'Changes apply to your account. Inactive options remain visible on past records.', taxonomyLoadError);
    renderTaxonomyManager();
    syncBodyScroll();
    $('taxonomyNameInput').focus();
}
function closeTaxonomyManager() {
    $('taxonomySheet').classList.remove('active');
    taxonomyEditingKey = null;
    syncBodyScroll();
}
$('manageTaxonomyBtn').addEventListener('click', openTaxonomyManager);
$('taxonomyCloseBtn').addEventListener('click', closeTaxonomyManager);
$('taxonomySheet').addEventListener('click', event => { if (event.target === $('taxonomySheet')) closeTaxonomyManager(); });
$('taxonomyCategoryTab').addEventListener('click', () => { taxonomyKind = 'category'; taxonomyEditingKey = null; $('taxonomyNameInput').value = ''; renderTaxonomyManager(); });
$('taxonomyPaymentTab').addEventListener('click', () => { taxonomyKind = 'payment'; taxonomyEditingKey = null; $('taxonomyNameInput').value = ''; renderTaxonomyManager(); });
$('taxonomySaveBtn').addEventListener('click', async () => {
    if (!currentUser || taxonomyLoadError) return taxonomyStatus('Set up the custom categories/payment migration first.', true);
    const name = $('taxonomyNameInput').value.trim();
    if (!name) { taxonomyStatus('Enter a name first.', true); $('taxonomyNameInput').focus(); return; }
    const duplicate = taxonomyItems().some(item => item.key !== taxonomyEditingKey && item.label.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) { taxonomyStatus('An option with that name already exists.', true); return; }
    const items = taxonomyItems();
    const editing = items.find(item => item.key === taxonomyEditingKey);
    const table = taxonomyKind === 'category' ? 'user_categories' : 'user_payment_methods';
    const keyColumn = taxonomyKind === 'category' ? 'category_key' : 'payment_key';
    const itemKey = editing?.key || `${taxonomyKind === 'category' ? 'cat' : 'pay'}_${uuid()}`;
    const payload = {
        user_id: currentUser.id,
        [keyColumn]: itemKey,
        label: name,
        icon: editing?.icon || (taxonomyKind === 'category' ? 'fa-tag' : 'fa-wallet'),
        color: editing?.color || (taxonomyKind === 'category' ? '#6b7280' : '#4f46e5'),
        active: editing?.active ?? true,
        is_builtin: editing?.is_builtin ?? false,
        sort_order: editing?.sort_order ?? items.length + 10
    };
    setBusy($('taxonomySaveBtn'), true, 'Saving...');
    try {
        const { error } = await supabaseClient.from(table).upsert(payload, { onConflict: `user_id,${keyColumn}` });
        if (error) throw error;
    } catch (error) {
        console.error('Taxonomy save failed:', error);
        taxonomyStatus('Could not save this option. Check your database migration and connection.', true);
        return;
    } finally {
        setBusy($('taxonomySaveBtn'), false);
    }
    taxonomyEditingKey = null;
    $('taxonomyNameInput').value = '';
    await loadUserTaxonomy();
    renderTaxonomyManager();
    updateDashboard();
    if ($('historyScreen').classList.contains('active')) renderHistory();
    if ($('recurringScreen').classList.contains('active')) renderRecurring();
    taxonomyStatus(editing ? 'Name updated. Past transactions keep their link to this option.' : 'Option added.');
});
$('taxonomyNameInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('taxonomySaveBtn').click(); });
$('taxonomyList').addEventListener('click', async event => {
    const button = event.target.closest('[data-tax-action]');
    const row = event.target.closest('.taxonomy-row');
    if (!button || !row || taxonomyLoadError) return;
    const item = taxonomyItems().find(option => option.key === row.dataset.key);
    if (!item) return;
    if (button.dataset.taxAction === 'edit') {
        taxonomyEditingKey = item.key;
        $('taxonomyNameInput').value = item.label;
        renderTaxonomyManager();
        $('taxonomyNameInput').focus();
        return;
    }
    if (item.active && activeTaxonomy(taxonomyItems()).length <= 1) return taxonomyStatus('Keep at least one active option.', true);
    const table = taxonomyKind === 'category' ? 'user_categories' : 'user_payment_methods';
    const keyColumn = taxonomyKind === 'category' ? 'category_key' : 'payment_key';
    const { error } = await supabaseClient.from(table).update({ active: !item.active }).eq('user_id', currentUser.id).eq(keyColumn, item.key);
    if (error) { taxonomyStatus('Could not update this option. Please try again.', true); return; }
    await loadUserTaxonomy();
    renderTaxonomyManager();
    renderExpenseChips();
    renderRecurringChips();
    updateDashboard();
    taxonomyStatus(item.active ? 'Option deactivated. Past transactions are unchanged.' : 'Option reactivated.');
});

$('addTabExpense').addEventListener('click', () => { setAddMode('expense'); expAmount.focus(); });
$('addTabIncome').addEventListener('click', () => { setAddMode('income'); incomeAmount.focus(); });
$('addSheetClose').addEventListener('click', closeAddSheet);
$('accountSheetClose').addEventListener('click', closeAccountSheet);
addSheet.addEventListener('click', (e) => { if (e.target === addSheet) closeAddSheet(); });
accountSheet.addEventListener('click', (e) => { if (e.target === accountSheet) closeAccountSheet(); });

// === DASHBOARD ===
// Ranked list of this month's spending (biggest first) — doubles as the donut's legend.
// Categories with a budget also show progress towards their limit (amber at 80%, red when over).
function renderCategoryGrid() {
    const rows = CATEGORIES
        .map(c => ({ ...c, total: getCategoryTotal(c.key), budget: budgetFor(c.key) }))
        .filter(c => c.total > 0 || c.budget > 0)
        .sort((a, b) => (b.total - a.total) || (b.budget - a.budget));
    const grand = rows.reduce((s, r) => s + r.total, 0);

    if (!rows.length) {
        categoryGrid.innerHTML = `
            <div class="cat-empty">
                <i class="fas fa-seedling"></i>
                <div>No spending recorded for ${escapeHtml(formatMonthDisplay(selectedDate))} yet.</div>
                <button type="button" class="btn btn-outline btn-small" data-action="add"><i class="fas fa-plus"></i> Add an expense</button>
            </div>`;
        return;
    }

    categoryGrid.innerHTML = rows.map(c => {
        let barPct, note, state = '';
        if (c.budget > 0) {
            const used = c.total / c.budget;
            state = used >= 1 ? 'over' : used >= 0.8 ? 'warn' : '';
            barPct = Math.min(100, used * 100);
            note = used >= 1
                ? `Over by ${formatMoney(c.total - c.budget)}`
                : `${(used * 100).toFixed(0)}% of ${formatMoney(c.budget)}`;
        } else {
            barPct = grand > 0 ? (c.total / grand) * 100 : 0;
            note = `${barPct.toFixed(0)}%`;
        }
        return `
            <button type="button" class="cat-row ${state}" data-cat="${escapeHtml(c.key)}" style="--cat-color:${safeColor(c.color)}">
                <span class="cat-ico"><i class="fas ${safeIcon(c.icon)}" aria-hidden="true"></i></span>
                <span class="cat-main">
                    <span class="cat-name">${escapeHtml(c.label)}</span>
                    <span class="cat-bar${c.budget > 0 ? ' budgeted' : ''}"><span style="width:${barPct.toFixed(1)}%"></span></span>
                </span>
                <span class="cat-amt"><b>${formatMoney(c.total)}</b><small class="${state}">${note}</small></span>
            </button>`;
    }).join('');
}

// "Today", "Yesterday", or "12 Oct" — easier to scan than a full date on every row
function friendlyDate(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const diff = Math.round((today - that) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return formatDateDisplay(iso, { includeYear: d.getFullYear() !== today.getFullYear() });
}

// withActions: edit/delete buttons (desktop hover). showDate: false inside date-grouped lists.
function transactionRowHtml(t, withActions, showDate = true) {
    const isIncome = t.type === 'income';
    const cat = catByKey[t.category];
    const icon = isIncome ? 'fa-arrow-trend-up' : (cat ? cat.icon : 'fa-receipt');
    const baseTitle = isIncome ? (t.source || 'Salary') : (cat ? cat.label : t.category);
    // For expenses, a note (e.g. what "Other" was) is shown next to the category
    const title = !isIncome && t.merchant ? t.merchant : (!isIncome && t.note ? `${baseTitle} — ${t.note}` : baseTitle);
    const pay = payByKey[t.payment];
    const parts = isIncome ? ['Income'] : [cat ? cat.label : t.category, pay ? pay.label : 'N/A'];
    if (!isIncome && t.note) parts.push(t.note);
    if (showDate) parts.push(friendlyDate(t.created_at));
    const color = !isIncome && cat ? `style="--cat-color:${safeColor(cat.color)}"` : '';
    const rowHtml = `
        <div class="history-item${t._pending ? ' pending' : ''}" data-id="${escapeHtml(t.id)}" data-type="${t.type}"${withActions ? '' : ` tabindex="0" role="button" aria-label="Edit ${escapeHtml(title)}"`}>
            <div class="h-icon ${isIncome ? 'income' : 'expense'}" ${color}><i class="fas ${safeIcon(icon)}" aria-hidden="true"></i></div>
            <div class="h-left">
                <div class="h-title">${escapeHtml(title)}${t._pending ? '<span class="pending-badge" title="Waiting to sync"><i class="fas fa-cloud-arrow-up"></i> Not synced</span>' : ''}</div>
                <div class="h-detail">${escapeHtml(parts.join(' · '))}</div>
            </div>
            <div class="h-right">
                <div class="h-amount ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '−'} ${formatMoney(t.amount)}</div>
            </div>
            ${withActions ? `
            <div class="h-actions">
                <button type="button" class="icon-btn" data-action="edit" title="Edit" aria-label="Edit"><i class="fas fa-pen"></i></button>
                <button type="button" class="icon-btn danger" data-action="delete" title="Delete" aria-label="Delete"><i class="fas fa-trash-can"></i></button>
            </div>` : ''}
        </div>`;
    if (!withActions) return rowHtml;
    // History rows sit in a swipe container: right = duplicate, left = delete
    return `
        <div class="swipe-row">
            <div class="swipe-bg dup"><button type="button" class="swipe-action" data-swipe-action="duplicate" aria-label="Duplicate transaction"><i class="fas fa-copy"></i><span>Duplicate</span></button></div>
            <div class="swipe-bg del"><button type="button" class="swipe-action" data-swipe-action="delete" aria-label="Delete transaction"><span>Delete</span><i class="fas fa-trash-can"></i></button></div>
            ${rowHtml}
        </div>`;
}

function allTransactions() {
    return [
        ...expenses.map(e => ({ ...e, type: 'expense' })),
        ...incomes.map(i => ({ ...i, type: 'income' }))
    ].sort(byDateDesc);
}

function renderRecent() {
    const recent = allTransactions().slice(0, 5);
    recentList.innerHTML = recent.length
        ? recent.map(t => transactionRowHtml(t, false)).join('')
        : '<div class="history-empty small">Nothing here yet — tap <b>+</b> to add your first transaction.</div>';
    renderMerchantSuggestions();
    renderExpenseTemplates();
}

function startOfLocalDay(date) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
}

function renderSpendingPatterns() {
    const now = new Date();
    const today = startOfLocalDay(now);
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(currentWeekStart.getDate() - 6);
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const weekExpenses = expenses.filter(e => new Date(e.created_at) >= currentWeekStart && new Date(e.created_at) < new Date(today.getTime() + 86_400_000));
    const previousWeekExpenses = expenses.filter(e => new Date(e.created_at) >= previousWeekStart && new Date(e.created_at) < currentWeekStart);
    const weekTotal = sumAmount(weekExpenses);
    const previousTotal = sumAmount(previousWeekExpenses);
    const difference = weekTotal - previousTotal;
    let weeklyCopy = `You spent ${formatMoney(weekTotal)} in the last 7 days`;
    if (previousTotal > 0) {
        const percent = Math.round(Math.abs(difference / previousTotal) * 100);
        weeklyCopy += difference > 0 ? `, up ${percent}% from the week before.` : difference < 0 ? `, down ${percent}% from the week before.` : ', the same as the week before.';
    } else weeklyCopy += previousWeekExpenses.length ? ' (no spend in the previous week).' : '.';
    if (weekExpenses.length) {
        const categoryTotals = CATEGORIES.map(c => ({ label: c.label, total: sumAmount(weekExpenses.filter(e => e.category === c.key)) })).sort((a, b) => b.total - a.total);
        if (categoryTotals[0]?.total) weeklyCopy += ` ${categoryTotals[0].label} was the biggest category.`;
    }
    $('weeklySummary').textContent = weeklyCopy;

    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 120);
    const byMerchant = new Map();
    expenses.filter(e => e.merchant && new Date(e.created_at) >= cutoff).forEach(e => {
        const key = e.merchant.trim().toLocaleLowerCase();
        if (!key) return;
        if (!byMerchant.has(key)) byMerchant.set(key, { name: e.merchant.trim(), records: [] });
        byMerchant.get(key).records.push(e);
    });
    const activeRecurring = new Set(recurring.filter(r => r.active).map(r => r.name.trim().toLocaleLowerCase()));
    const candidates = [...byMerchant.values()].map(group => {
        const rows = group.records.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const amounts = rows.map(r => Number(r.amount));
        const averageAmount = amounts.reduce((sum, amount) => sum + amount, 0) / Math.max(1, amounts.length);
        const amountSpread = averageAmount ? (Math.max(...amounts) - Math.min(...amounts)) / averageAmount : 1;
        const gaps = rows.slice(1).map((r, i) => (new Date(r.created_at) - new Date(rows[i].created_at)) / 86_400_000);
        const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
        const frequency = averageGap >= 5 && averageGap <= 10 ? 'weekly' : averageGap >= 22 && averageGap <= 38 ? 'monthly' : '';
        if (rows.length < 3 || !frequency || amountSpread > 0.35 || activeRecurring.has(group.name.toLocaleLowerCase())) return null;
        return { ...group, averageAmount, frequency, count: rows.length };
    }).filter(Boolean).sort((a, b) => b.count - a.count).slice(0, 3);
    $('repeatSuggestions').innerHTML = candidates.length
        ? `<div class="repeat-heading"><i class="fas fa-repeat"></i> Possible recurring spend</div>${candidates.map(item => `<div class="repeat-row"><span><b>${escapeHtml(item.name)}</b><small>${item.count} similar charges, roughly ${item.frequency}</small></span><strong>${formatMoney(item.averageAmount)}</strong></div>`).join('')}`
        : '<p class="patterns-empty">As your history grows, repeat merchants will appear here for a quick check.</p>';
}

function renderBudgetForecast(spent, isCurrent) {
    const forecast = $('budgetForecast');
    if (!isCurrent || !budgets.length) {
        forecast.textContent = '';
        forecast.classList.add('hidden');
        return;
    }
    const today = new Date();
    const elapsed = Math.max(1, today.getDate());
    const days = daysInMonth(selectedDate.getFullYear(), selectedDate.getMonth() + 1);
    if (elapsed < 4) {
        forecast.classList.add('hidden');
        return;
    }
    const monthRows = expenses.filter(e => isSameMonth(e.created_at));
    const candidates = budgets.map(budget => {
        const amount = budget.category === 'all' ? spent : sumAmount(monthRows.filter(e => e.category === budget.category));
        const projected = amount / elapsed * days;
        return { budget, amount, projected };
    }).filter(item => item.amount < item.budget.amount && item.projected > item.budget.amount * 1.08)
        .sort((a, b) => (b.projected / b.budget.amount) - (a.projected / a.budget.amount));
    const concern = candidates[0];
    if (!concern) {
        forecast.textContent = '';
        forecast.classList.add('hidden');
        return;
    }
    const name = concern.budget.category === 'all' ? 'Overall spending' : `${catByKey[concern.budget.category]?.label || concern.budget.category} spending`;
    forecast.innerHTML = `<i class="fas fa-circle-exclamation"></i><span>At this pace, ${escapeHtml(name.toLowerCase())} may reach <b>${formatMoney(concern.projected)}</b> this month, above your ${formatMoney(concern.budget.amount)} budget.</span>`;
    forecast.classList.remove('hidden');
}

function renderMerchantSuggestions() {
    const names = [...new Set(expenses.map(e => (e.merchant || '').trim()).filter(Boolean))].slice(0, 30);
    $('merchantSuggestions').innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
}

function renderExpenseTemplates() {
    const counts = new Map();
    expenses.forEach(expense => {
        const merchant = (expense.merchant || '').trim();
        if (!merchant) return;
        const key = merchant.toLocaleLowerCase();
        const item = counts.get(key) || { merchant, count: 0, latest: expense };
        item.count++;
        if (new Date(expense.created_at) > new Date(item.latest.created_at)) item.latest = expense;
        counts.set(key, item);
    });
    const templates = [...counts.values()].filter(item => item.count >= 2).slice(0, 4);
    const container = $('expenseTemplates');
    container.classList.toggle('hidden', !templates.length);
    container.innerHTML = templates.length
        ? `<span class="template-label">Frequent</span>${templates.map((item, index) => `<button type="button" class="template-chip" data-template-index="${index}">${escapeHtml(item.merchant)} <small>${formatMoney(item.latest.amount)}</small></button>`).join('')}`
        : '';
    container._templates = templates;
}

function setReceiptStatus(message, error = false) {
    receiptScanStatus.textContent = message;
    receiptScanStatus.classList.toggle('error', error);
    receiptScanStatus.classList.remove('hidden');
}

function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the selected image.'));
        reader.readAsDataURL(blob);
    });
}

async function compressReceiptImage(file) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
    const maxBytes = 900_000;
    if (file.size <= maxBytes) return await readAsDataUrl(file);

    const objectUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Could not open this image. Try another photo.'));
            img.src = objectUrl;
        });
        let scale = Math.min(1, 2000 / image.width, 2000 / image.height);
        for (let attempt = 0; attempt < 8; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) throw new Error('Image compression is unavailable in this browser.');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const quality = [0.86, 0.76, 0.66, 0.56][Math.min(attempt, 3)];
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
            if (blob && blob.size <= maxBytes) return await readAsDataUrl(blob);
            scale *= 0.82;
        }
        throw new Error('This image is too large to scan. Try a smaller photo.');
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function parseReceiptDate(text) {
    let match = text.match(/\b(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})\b/);
    let year, month, day;
    if (match) [, year, month, day] = match;
    else {
        match = text.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
        if (!match) return '';
        [, day, month, year] = match; // Malaysia receipts commonly use day/month/year.
    }
    year = Number(year);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    month = Number(month);
    day = Number(day);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && year >= 2000 && year <= new Date().getFullYear() + 1
        ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        : '';
}

function parseReceiptAmount(line) {
    const matches = [...line.matchAll(/(?:RM\s*)?\b(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\b/gi)];
    if (!matches.length) return 0;
    return Number(matches[matches.length - 1][1].replace(/,/g, '')) || 0;
}

function suggestExpenseCategory(text) {
    const value = text.toLowerCase();
    const hints = [
        ['food', /restaurant|mcdonald|kfc|burger|pizza|foodpanda|grabfood|bakery|food court|warung|mamak/],
        ['beverages', /starbucks|coffee|tealive|kopitiam|bubble tea|cafe|espresso/],
        ['travel', /grab ride|taxi|airasia|airline|flight|hotel|parking|toll|rapid kl|myrapid/],
        ['shopping', /supermarket|grocer|mall|shopee|lazada|watsons|guardian|uniqlo/],
        ['utilities', /electric|water bill|unifi|maxis|celcom|digi|utilities|internet bill/],
        ['car', /petrol|shell|petronas|caltex|budi|workshop|service centre/],
        ['health', /clinic|pharmacy|hospital|medical|dental/],
        ['entertain', /cinema|movie|netflix|spotify|steam|ticket/]
    ];
    return hints.find(([, pattern]) => pattern.test(value))?.[0] || '';
}

function parseReceiptText(text) {
    const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const merchant = lines.slice(0, 10).find(line => {
        const value = line.toLowerCase();
        return line.length >= 2 && line.length <= 70 && /[a-z]/i.test(line) && !/^\d+$/.test(line)
            && !/receipt|invoice|tax invoice|cashier|customer|tel\b|phone|date\b|time\b|table\b|gst|sst|reg\.?\s*no|thank you/i.test(value);
    }) || '';
    const totalCandidates = lines.map(line => {
        const lower = line.toLowerCase();
        const strong = /grand\s*total|total\s*(?:due|payable)|amount\s*due|net\s*total|balance\s*due/.test(lower);
        const plain = /\btotal\b/.test(lower) && !/sub\s*total|tax\s*total|total\s*tax|cash|change/.test(lower);
        return { line, score: strong ? 2 : plain ? 1 : 0, amount: parseReceiptAmount(line) };
    }).filter(item => item.score && item.amount > 0).sort((a, b) => b.score - a.score);
    return {
        merchant,
        amount: totalCandidates[0]?.amount || 0,
        date: parseReceiptDate(text),
        category: suggestExpenseCategory(`${merchant} ${text}`)
    };
}

async function scanReceipt(file) {
    if (!currentUser || !supabaseClient) throw new Error('Sign in before scanning a receipt.');
    setBusy(scanReceiptBtn, true, 'Reading…');
    try {
        setReceiptStatus('Preparing image…');
        const imageData = await compressReceiptImage(file);
        setReceiptStatus('Reading receipt text…');
        const { data, error } = await supabaseClient.functions.invoke('receipt-ocr', { body: { imageData } });
        if (error) throw new Error(data?.error || 'Receipt scan is unavailable. Check the OCR setup and try again.');
        if (data?.error) throw new Error(data.error);

        const fields = parseReceiptText(data.text || '');
        if (fields.merchant) expMerchant.value = fields.merchant.slice(0, 80);
        if (fields.amount) expAmount.value = fields.amount.toFixed(2);
        if (fields.date) expDate.value = fields.date;
        if (fields.category) {
            expCategoryValue = fields.category;
            renderExpenseChips();
        }
        const detected = [fields.merchant && 'merchant', fields.amount && 'total', fields.date && 'date'].filter(Boolean);
        if (!detected.length) throw new Error('Text was read, but I could not identify the merchant, total, or date. Please enter them manually.');
        const categoryNote = fields.category ? ` Category suggestion: ${catByKey[fields.category].label}.` : '';
        setReceiptStatus(`Draft filled: ${detected.join(', ')}.${categoryNote} Please review before saving.`);
    } catch (error) {
        setReceiptStatus(error.message || 'Receipt scanning failed. Please enter it manually.', true);
    } finally {
        setBusy(scanReceiptBtn, false);
        receiptFileInput.value = '';
    }
}

scanReceiptBtn.addEventListener('click', () => receiptFileInput.click());
receiptFileInput.addEventListener('change', () => {
    const file = receiptFileInput.files?.[0];
    if (file) scanReceipt(file);
});

let nearbyLookupInFlight = false;
let nearbyLastRequestAt = 0;
const nearbyPlaceCache = new Map();
nearbyPlaceBtn.addEventListener('click', () => {
    if (nearbyLookupInFlight) return;
    if (!navigator.geolocation) {
        nearbyPlaceStatus.textContent = 'This browser does not provide location. Enter the merchant manually.';
        return;
    }
    nearbyLookupInFlight = true;
    nearbyPlaceBtn.disabled = true;
    nearbyPlaceStatus.textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition(async position => {
        try {
            nearbyPlaceStatus.textContent = 'Looking for a nearby mapped place…';
            const { latitude, longitude } = position.coords;
            const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
            const cachedName = nearbyPlaceCache.get(cacheKey);
            if (cachedName) {
                expMerchant.value = cachedName;
                nearbyPlaceStatus.textContent = `Suggested “${cachedName}” from a recent nearby lookup. Edit it if needed.`;
                nearbyPlaceStatus.classList.remove('error');
                return;
            }
            const wait = 1100 - (Date.now() - nearbyLastRequestAt);
            if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
            nearbyLastRequestAt = Date.now();
            const { data, error } = await supabaseClient.functions.invoke('nearby-place', { body: { latitude, longitude } });
            if (error) throw new Error(data?.error || 'Nearby lookup is temporarily unavailable. Enter the merchant manually.');
            if (data?.error) throw new Error(data.error);
            const placeName = data?.name || '';
            if (!placeName) throw new Error('No mapped place found nearby. Enter the merchant manually.');
            nearbyPlaceCache.set(cacheKey, placeName);
            expMerchant.value = placeName.slice(0, 80);
            nearbyPlaceStatus.textContent = `Suggested “${placeName}” from your current location. Edit it if needed.`;
            nearbyPlaceStatus.classList.remove('error');
        } catch (error) {
            nearbyPlaceStatus.textContent = error.message || 'Nearby lookup failed. Enter the merchant manually.';
            nearbyPlaceStatus.classList.add('error');
        } finally {
            nearbyLookupInFlight = false;
            nearbyPlaceBtn.disabled = false;
        }
    }, error => {
        nearbyLookupInFlight = false;
        nearbyPlaceBtn.disabled = false;
        nearbyPlaceStatus.classList.add('error');
        nearbyPlaceStatus.textContent = error.code === 1
            ? 'Location permission was declined. Enter the merchant or choose a previous one.'
            : 'Could not get your location. Enter the merchant manually.';
    }, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 });
});

$('expenseTemplates').addEventListener('click', (event) => {
    const button = event.target.closest('[data-template-index]');
    if (!button) return;
    const template = $('expenseTemplates')._templates?.[Number(button.dataset.templateIndex)];
    if (!template) return;
    expMerchant.value = template.merchant;
    expAmount.value = parseFloat(template.latest.amount).toFixed(2);
    expCategoryValue = template.latest.category;
    expPaymentValue = template.latest.payment;
    renderExpenseChips();
    showToast('info', `${template.merchant} details filled in — review before saving`);
});

// Spending-vs-last-month chip, "% of income used" bar, and the three insight tiles
function renderHeroAndInsights(spent, income) {
    const monthName = selectedDate.toLocaleString('en-MY', { month: 'long' });
    heroLabel.textContent = `Spent in ${monthName}`;
    $('dashSubtitle').textContent = `Here's ${formatMonthDisplay(selectedDate)} at a glance`;

    // vs the previous month
    const prev = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
    const prevSpent = sumAmount(expenses.filter(e => isSameMonth(e.created_at, prev)));
    if (prevSpent > 0) {
        const change = ((spent - prevSpent) / prevSpent) * 100;
        const up = change > 0.5, down = change < -0.5;
        spendDelta.className = `delta ${up ? 'up' : down ? 'down' : ''}`;
        spendDelta.innerHTML = `<i class="fas ${up ? 'fa-arrow-up' : down ? 'fa-arrow-down' : 'fa-equals'}"></i> ${Math.abs(change).toFixed(0)}% vs ${prev.toLocaleString('en-MY', { month: 'short' })}`;
    } else {
        spendDelta.className = 'delta hidden';
    }

    // progress bar: the overall budget if there is one, otherwise how much of the income is spent
    const now = new Date();
    const isCurrent = now.getFullYear() === selectedDate.getFullYear() && now.getMonth() === selectedDate.getMonth();
    const isFuture = selectedDate > now;
    const overall = budgetFor('all');
    heroBarWrap.classList.remove('warn');
    if (overall > 0) {
        const used = (spent / overall) * 100;
        heroBar.style.width = `${Math.min(100, used)}%`;
        heroBarWrap.classList.toggle('over', used > 100);
        heroBarWrap.classList.toggle('warn', used >= 80 && used <= 100);
        heroBarCaption.textContent = used > 100
            ? `Over your ${formatMoney(overall)} budget by ${formatMoney(spent - overall)}`
            : `${formatMoney(overall - spent)} left of your ${formatMoney(overall)} budget`;
    } else if (income > 0) {
        const used = (spent / income) * 100;
        heroBar.style.width = `${Math.min(100, used)}%`;
        heroBarWrap.classList.toggle('over', used > 100);
        heroBarCaption.textContent = used > 100
            ? `Spent ${(used - 100).toFixed(0)}% more than you earned`
            : `${used.toFixed(0)}% of your income used`;
    } else {
        heroBar.style.width = '0%';
        heroBarWrap.classList.remove('over');
        heroBarCaption.textContent = spent > 0 ? 'Add this month\'s income to see how much you\'ve used' : '';
    }
    renderSafeToSpend(spent, overall, isCurrent, isFuture);
    renderBudgetForecast(spent, isCurrent);

    // insights
    const monthExpenses = expenses.filter(e => isSameMonth(e.created_at));
    const days = isCurrent ? now.getDate() : daysInMonth(selectedDate.getFullYear(), selectedDate.getMonth() + 1);
    $('insightDaily').textContent = formatMoney(isFuture ? 0 : spent / Math.max(1, days));
    $('insightDailySub').textContent = isCurrent ? `over ${days} day${days === 1 ? '' : 's'} so far` : `over ${days} days`;

    const topCat = CATEGORIES.map(c => ({ ...c, total: getCategoryTotal(c.key) })).sort((a, b) => b.total - a.total)[0];
    const topIcon = $('insightTopIcon');
    if (topCat && topCat.total > 0) {
        $('insightTop').textContent = topCat.label;
        $('insightTopSub').textContent = `${formatMoney(topCat.total)} · ${((topCat.total / spent) * 100).toFixed(0)}% of spending`;
        topIcon.innerHTML = `<i class="fas ${topCat.icon}"></i>`;
        topIcon.style.color = topCat.color;
        topIcon.style.background = `color-mix(in srgb, ${topCat.color} 14%, var(--surface))`;
    } else {
        $('insightTop').textContent = '—';
        $('insightTopSub').textContent = 'No spending yet';
        topIcon.innerHTML = '<i class="fas fa-trophy"></i>';
        topIcon.style.color = topIcon.style.background = '';
    }

    const biggest = monthExpenses.slice().sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))[0];
    if (biggest) {
        $('insightMax').textContent = formatMoney(biggest.amount);
        const label = (catByKey[biggest.category]?.label || biggest.category) + (biggest.note ? ` — ${biggest.note}` : '');
        $('insightMaxSub').textContent = `${label} · ${friendlyDate(biggest.created_at)}`;
    } else {
        $('insightMax').textContent = '—';
        $('insightMaxSub').textContent = 'No spending yet';
    }
}

function updateDashboard() {
    if (!currentUser) return;

    selectedMonthDisplay.textContent = formatMonthDisplay(selectedDate);
    monthPicker.value = formatMonthValue(selectedDate);
    const now = new Date();
    const isSelectedCurrentMonth = now.getFullYear() === selectedDate.getFullYear() && now.getMonth() === selectedDate.getMonth();
    $('trendResetBtn').classList.toggle('hidden', isSelectedCurrentMonth);

    const spent = getTotalSpent();
    const income = getTotalIncome();
    const balance = income - spent;
    animateAmount(totalSpent, spent);
    animateAmount(totalIncomeDisplay, income);
    animateAmount(totalBalance, balance);
    balancePill.classList.toggle('negative', balance < 0);
    totalCard.classList.toggle('loading', isLoading);
    donutTotal.textContent = formatMoney(spent).replace(/\.00$/, '');

    renderHeroAndInsights(spent, income);
    renderCategoryGrid();
    renderRecent();
    renderUpcoming();
    renderSpendingPatterns();

    const meta = currentUser.user_metadata || {};
    const name = meta.username || meta.full_name || currentUser.email?.split('@')[0] || 'User';
    userNameDisplay.textContent = name;
    $('sideName').textContent = name;
    $('accountName').textContent = name;
    $('accountEmail').textContent = currentUser.email || '';
    const initial = (name.trim()[0] || 'U').toUpperCase();
    $('sideAvatar').textContent = initial;
    $('accountAvatar').textContent = initial;

    persistLocal();
    if ($('dashboardScreen').classList.contains('active')) renderCharts();
}

categoryGrid.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="add"]')) return openAddSheet('expense');
    const row = e.target.closest('.cat-row');
    if (row) openHistoryFiltered({ type: 'expense', category: row.dataset.cat, month: formatMonthValue(selectedDate) });
});
viewAllBtn.addEventListener('click', () => openHistoryFiltered({ month: formatMonthValue(selectedDate) }));

// === MONTH SELECTOR ===
function setSelectedMonth(year, month) {
    selectedDate = new Date(year, month, 1);
    selectedDate.setHours(0, 0, 0, 0);
    historyMonthFilter.value = formatMonthValue(selectedDate);
    updateDashboard();
    if ($('historyScreen').classList.contains('active')) renderHistory();
}

prevMonthBtn.addEventListener('click', () => setSelectedMonth(selectedDate.getFullYear(), selectedDate.getMonth() - 1));
nextMonthBtn.addEventListener('click', () => setSelectedMonth(selectedDate.getFullYear(), selectedDate.getMonth() + 1));
todayMonthBtn.addEventListener('click', () => {
    const now = new Date();
    setSelectedMonth(now.getFullYear(), now.getMonth());
});
$('trendResetBtn').addEventListener('click', () => {
    const now = new Date();
    setSelectedMonth(now.getFullYear(), now.getMonth());
});
monthPickerBtn.addEventListener('click', () => {
    if (monthPicker.showPicker) {
        try { monthPicker.showPicker(); return; } catch (_) { /* fall through */ }
    }
    monthPicker.focus();
    monthPicker.click();
});
monthPicker.addEventListener('change', (e) => {
    const [year, month] = e.target.value.split('-').map(Number);
    if (!isNaN(year) && !isNaN(month)) setSelectedMonth(year, month - 1);
});

// === CHARTS ===
let pieChartInstance = null;
let barChartInstance = null;
let barMonthDates = [];

function getMonthlyTotals() {
    const months = [];
    const expensesData = [];
    const incomesData = [];
    barMonthDates = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - i, 1);
        barMonthDates.push(d);
        months.push(d.toLocaleString('en-MY', { month: 'short' }));
        expensesData.push(sumAmount(expenses.filter(e => isSameMonth(e.created_at, d))));
        incomesData.push(sumAmount(incomes.filter(n => isSameMonth(n.created_at, d))));
    }
    return { months, expensesData, incomesData };
}

// Chart.js colours are set in JS, so they follow the system theme here
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

// Read a design token from CSS so the charts always match the current theme
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyChartTheme() {
    if (!window.Chart) return;
    Chart.defaults.color = cssVar('--muted') || '#5b6785';
    Chart.defaults.borderColor = cssVar('--border') || '#e4e7f0';
    Chart.defaults.font.family = "'Inter', sans-serif";
}

function onThemeChange() {
    applyChartTheme();
    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }
    if (currentUser && $('dashboardScreen').classList.contains('active')) renderCharts();
}
if (darkQuery.addEventListener) darkQuery.addEventListener('change', onThemeChange);
else if (darkQuery.addListener) darkQuery.addListener(onThemeChange); // older Safari
applyChartTheme();

function renderCharts() {
    if (!window.Chart) return;
    const pieCanvas = $('pieChart');
    const barCanvas = $('barChart');
    if (!pieCanvas || !barCanvas) return;

    // Doughnut: only categories with spending; the ranked list beside it is the legend
    const ranked = CATEGORIES
        .map(c => ({ ...c, total: getCategoryTotal(c.key) }))
        .filter(c => c.total > 0)
        .sort((a, b) => b.total - a.total);
    const hasData = ranked.length > 0;
    const surface = cssVar('--surface') || '#ffffff';
    const pieData = {
        labels: hasData ? ranked.map(c => c.label) : ['No data'],
        datasets: [{
            data: hasData ? ranked.map(c => c.total) : [1],
            backgroundColor: hasData ? ranked.map(c => safeColor(c.color)) : [cssVar('--surface-2') || '#e5e7eb'],
            borderWidth: 3,
            borderColor: surface,
            hoverOffset: 6
        }]
    };
    if (pieChartInstance) {
        pieChartInstance.data = pieData;
        pieChartInstance.pieKeys = ranked.map(c => c.key);
        pieChartInstance.options.plugins.tooltip.enabled = hasData; // no tooltip on the empty ring
        pieChartInstance.update();
    } else {
        pieChartInstance = new Chart(pieCanvas.getContext('2d'), {
            type: 'doughnut',
            data: pieData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: hasData, callbacks: { label: (ctx) => `${ctx.label}: ${formatMoney(ctx.parsed)}` } }
                },
                onHover: (evt, els) => { evt.native.target.style.cursor = els.length && pieChartInstance.pieKeys?.length ? 'pointer' : 'default'; },
                onClick: (evt, els) => {
                    if (!els.length) return;
                    const key = pieChartInstance.pieKeys && pieChartInstance.pieKeys[els[0].index];
                    if (key) openHistoryFiltered({ type: 'expense', category: key, month: formatMonthValue(selectedDate) });
                }
            }
        });
        pieChartInstance.pieKeys = ranked.map(c => c.key);
    }

    // Bars: expenses vs income for the last six months
    const { months, expensesData, incomesData } = getMonthlyTotals();
    const barData = {
        labels: months,
        datasets: [
            { label: 'Expenses', data: expensesData, backgroundColor: '#6366f1', borderRadius: 6, borderSkipped: false, maxBarThickness: 28 },
            { label: 'Income', data: incomesData, backgroundColor: '#10b981', borderRadius: 6, borderSkipped: false, maxBarThickness: 28 }
        ]
    };
    if (barChartInstance) {
        barChartInstance.data = barData;
        barChartInstance.update();
    } else {
        barChartInstance = new Chart(barCanvas.getContext('2d'), {
            type: 'bar',
            data: barData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, font: { size: 12 } } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } }
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false } },
                    y: { beginAtZero: true, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (val) => val >= 1000 ? (val / 1000) + 'k' : val } }
                },
                onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                onClick: (evt, els) => {
                    if (!els.length) return;
                    const d = barMonthDates[els[0].index];
                    if (d) setSelectedMonth(d.getFullYear(), d.getMonth());
                }
            }
        });
    }
}

// === SUPABASE DATA ===
// Records get a client-generated id, so a save that has to be retried (offline queue) is safe:
// if the first attempt actually reached the server, the retry is a harmless duplicate-key error.
const uuid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });

function isNetworkError(err) {
    if (!navigator.onLine) return true;
    const msg = String((err && (err.message || err.details)) || err || '');
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|offline/i.test(msg);
}

function requireOnline(what) {
    if (!navigator.onLine) throw new Error(`You're offline — ${what} needs a connection.`);
}

// --- Local copy of your data, so the app still opens (read-only-ish) without a connection ---
const cacheKey = () => `et_cache_${currentUser.id}`;
const queueKey = () => `et_queue_${currentUser.id}`;
let cacheTimer = null;
let servedFromCache = false;

function persistLocal() {
    if (!currentUser) return;
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => {
        try {
            localStorage.setItem(cacheKey(), JSON.stringify({ expenses, incomes, recurring, budgets }));
        } catch (_) { /* storage full or blocked: the app still works online */ }
    }, 300);
}

function loadLocal() {
    try {
        const raw = localStorage.getItem(cacheKey());
        if (!raw) return false;
        const c = JSON.parse(raw);
        expenses = c.expenses || [];
        incomes = c.incomes || [];
        recurring = c.recurring || [];
        budgets = c.budgets || [];
        return true;
    } catch (_) {
        return false;
    }
}

// --- Offline queue: new entries made without a connection wait here and sync later ---
let syncQueue = []; // [{ table: 'expenses' | 'incomes', row }]
let flushing = false;

function loadQueue() {
    try { syncQueue = JSON.parse(localStorage.getItem(queueKey()) || '[]'); } catch (_) { syncQueue = []; }
    renderNetBanner();
}

function saveQueue() {
    try { localStorage.setItem(queueKey(), JSON.stringify(syncQueue)); } catch (_) { /* ignore */ }
    renderNetBanner();
}

function enqueue(table, row) {
    syncQueue.push({ table, row });
    saveQueue();
}

// Show queued entries in the lists (marked "not synced") after a fresh load from the server
function mergePending() {
    syncQueue.forEach(op => {
        const list = op.table === 'incomes' ? incomes : expenses;
        if (!list.some(r => r.id === op.row.id)) list.push({ ...op.row, _pending: true });
    });
    expenses.sort(byDateDesc);
    incomes.sort(byDateDesc);
}

function renderNetBanner() {
    const banner = $('netBanner');
    if (!banner) return;
    const n = syncQueue.length;
    const offline = !navigator.onLine;
    if (!offline && !n) {
        banner.classList.add('hidden');
        return;
    }
    banner.classList.remove('hidden');
    banner.classList.toggle('online', !offline);
    const waiting = n ? ` ${n} change${n === 1 ? '' : 's'} waiting to sync.` : '';
    banner.innerHTML = offline
        ? `<i class="fas fa-wifi"></i><span>You're offline — showing your saved data. New entries will sync when you're back.${waiting}</span>`
        : `<i class="fas fa-rotate fa-spin"></i><span>Syncing ${n} change${n === 1 ? '' : 's'}…</span>`;
}

function resetTaxonomyDefaults() {
    CATEGORIES = DEFAULT_CATEGORIES.map(item => ({ ...item, active: true, is_builtin: true }));
    PAYMENTS = DEFAULT_PAYMENTS.map(item => ({ ...item, active: true, is_builtin: true }));
    catByKey = Object.fromEntries(CATEGORIES.map(item => [item.key, item]));
    payByKey = Object.fromEntries(PAYMENTS.map(item => [item.key, item]));
}

async function loadUserTaxonomy() {
    if (!currentUser || !supabaseClient) return;
    const [categoryResult, paymentResult] = await Promise.all([
        supabaseClient.from('user_categories').select('*').eq('user_id', currentUser.id).order('sort_order'),
        supabaseClient.from('user_payment_methods').select('*').eq('user_id', currentUser.id).order('sort_order')
    ]);
    if (categoryResult.error || paymentResult.error) {
        taxonomyLoadError = true;
        resetTaxonomyDefaults();
        console.warn('Custom categories/payment methods unavailable (run migration-custom-categories-payments.sql).');
        return;
    }
    taxonomyLoadError = false;
    let categoryRows = categoryResult.data || [];
    let paymentRows = paymentResult.data || [];
    const missingCategories = DEFAULT_CATEGORIES.filter(item => !categoryRows.some(row => row.category_key === item.key))
        .map((item, index) => ({ user_id: currentUser.id, category_key: item.key, label: item.label, icon: item.icon, color: item.color, active: true, is_builtin: true, sort_order: index }));
    const missingPayments = DEFAULT_PAYMENTS.filter(item => !paymentRows.some(row => row.payment_key === item.key))
        .map((item, index) => ({ user_id: currentUser.id, payment_key: item.key, label: item.label, icon: item.icon, color: item.color, active: true, is_builtin: true, sort_order: index }));
    if (missingCategories.length) {
        const { error } = await supabaseClient.from('user_categories').upsert(missingCategories, { onConflict: 'user_id,category_key' });
        if (!error) categoryRows = (await supabaseClient.from('user_categories').select('*').eq('user_id', currentUser.id).order('sort_order')).data || categoryRows;
    }
    if (missingPayments.length) {
        const { error } = await supabaseClient.from('user_payment_methods').upsert(missingPayments, { onConflict: 'user_id,payment_key' });
        if (!error) paymentRows = (await supabaseClient.from('user_payment_methods').select('*').eq('user_id', currentUser.id).order('sort_order')).data || paymentRows;
    }
    CATEGORIES = categoryRows.map(row => ({ key: row.category_key, label: row.label, icon: row.icon, color: row.color, active: row.active, is_builtin: row.is_builtin, sort_order: row.sort_order }));
    PAYMENTS = paymentRows.map(row => ({ key: row.payment_key, label: row.label, icon: row.icon, color: row.color, active: row.active, is_builtin: row.is_builtin, sort_order: row.sort_order }));
    catByKey = Object.fromEntries(CATEGORIES.map(item => [item.key, item]));
    payByKey = Object.fromEntries(PAYMENTS.map(item => [item.key, item]));
    if (!activeTaxonomy(CATEGORIES).some(item => item.key === expCategoryValue)) expCategoryValue = activeTaxonomy(CATEGORIES)[0]?.key || 'other';
    if (!activeTaxonomy(PAYMENTS).some(item => item.key === expPaymentValue)) expPaymentValue = activeTaxonomy(PAYMENTS)[0]?.key || 'bank';
    if (!activeTaxonomy(CATEGORIES).some(item => item.key === recCategoryValue)) recCategoryValue = activeTaxonomy(CATEGORIES)[0]?.key || 'other';
    if (!activeTaxonomy(PAYMENTS).some(item => item.key === recPaymentValue)) recPaymentValue = activeTaxonomy(PAYMENTS)[0]?.key || 'bank';
    renderExpenseChips();
    if (typeof renderRecurringChips === 'function') renderRecurringChips();
    if (typeof fillSelect === 'function') {
        fillSelect(historyCategoryFilter, CATEGORIES, 'All categories');
        fillSelect(editCategory, CATEGORIES);
        fillSelect(editPayment, PAYMENTS);
    }
}

async function flushQueue({ silent = false } = {}) {
    if (!currentUser || flushing || !navigator.onLine || !syncQueue.length) return;
    flushing = true;
    let synced = 0;
    try {
        while (syncQueue.length) {
            const op = syncQueue[0];
            const list = op.table === 'incomes' ? incomes : expenses;
            let result;
            try {
                result = await supabaseClient.from(op.table).insert([op.row]).select();
            } catch (err) {
                result = { error: err };
            }
            const { data, error } = result;
            if (error && isNetworkError(error)) break; // still offline: keep the rest for later

            const idx = list.findIndex(r => r.id === op.row.id);
            if (error && error.code !== '23505') {
                // The server refused it (not a connection problem): drop it and say so
                console.error('Sync rejected an entry:', error);
                if (idx >= 0) list.splice(idx, 1);
                showToast('error', `Couldn't sync an entry: ${error.message || 'rejected'}`);
            } else {
                // Saved now, or already saved by an earlier attempt (duplicate key)
                const saved = data && data[0] ? data[0] : { ...op.row };
                delete saved._pending;
                if (idx >= 0) list[idx] = saved;
                synced++;
            }
            syncQueue.shift();
            saveQueue();
        }
    } finally {
        flushing = false;
        renderNetBanner();
        expenses.sort(byDateDesc);
        incomes.sort(byDateDesc);
        updateDashboard();
        if ($('historyScreen').classList.contains('active')) renderHistory();
    }
    if (synced && !silent) showToast('success', `Synced ${synced} change${synced === 1 ? '' : 's'}`);
}

window.addEventListener('offline', renderNetBanner);
window.addEventListener('online', () => {
    renderNetBanner();
    if (!currentUser) return;
    // If we were showing saved data, reload from the server (this also flushes the queue)
    if (servedFromCache) fetchAllData();
    else flushQueue();
});

async function fetchAllData() {
    isLoading = true;
    $('dashboardScreen').setAttribute('aria-busy', 'true');
    historyList.setAttribute('aria-busy', 'true');
    loadQueue();
    updateDashboard();
    try {
        if (!navigator.onLine) throw new Error('offline');

        const [exp, inc, rec, recInc, bud] = await Promise.all([
            supabaseClient.from('expenses').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('incomes').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('recurring_expenses').select('*').order('next_due', { ascending: true }),
            supabaseClient.from('recurring_incomes').select('*').order('next_due', { ascending: true }),
            supabaseClient.from('budgets').select('*')
        ]);

        const loadErr = exp.error || inc.error;
        if (loadErr) {
            if (isNetworkError(loadErr)) throw loadErr;
            console.error('Error fetching data:', loadErr);
            showToast('error', 'Could not load all your data. Pull to refresh or try again.');
        }

        // Recurring and budgets are optional: if their tables aren't created yet, the rest still works
        recurringLoadError = !!rec.error;
        recurringIncomeLoadError = !!recInc.error;
        budgetsLoadError = !!bud.error;
        if (rec.error) console.warn('Recurring expenses unavailable (run supabase-schema.sql):', rec.error);
        if (recInc.error) console.warn('Recurring income unavailable (run supabase-schema.sql):', recInc.error);
        if (bud.error) console.warn('Budgets unavailable (run supabase-schema.sql):', bud.error);

        expenses = exp.data || [];
        incomes = inc.data || [];
        recurring = rec.data || [];
        recurringIncomes = recInc.data || [];
        budgets = bud.data || [];
        await loadUserTaxonomy();
        await loadDisplayPreferences();
        servedFromCache = false;

        mergePending();
        await flushQueue(); // tells you if offline entries were just synced
        await processRecurring();
    } catch (err) {
        if (isNetworkError(err)) {
            const had = loadLocal();
            servedFromCache = true;
            mergePending();
            showToast('info', had ? 'You\'re offline — showing your last saved data' : 'You\'re offline');
        } else {
            console.error('Fetch data error:', err);
            showToast('error', 'Something went wrong while loading your data.');
        }
    } finally {
        isLoading = false;
        $('dashboardScreen').setAttribute('aria-busy', 'false');
        historyList.setAttribute('aria-busy', 'false');
        updateDashboard();
        if ($('historyScreen').classList.contains('active')) renderHistory();
    }
}

// Create an expense/income. Works offline: the entry shows up at once, marked "not synced",
// and is sent when the connection returns. Resolves to { queued }.
async function createRecord(type, fields) {
    const table = type === 'income' ? 'incomes' : 'expenses';
    const list = type === 'income' ? incomes : expenses;
    const row = { id: uuid(), user_id: currentUser.id, created_at: new Date().toISOString(), ...fields };

    list.push({ ...row, _pending: true });
    list.sort(byDateDesc);
    const drop = () => {
        const i = list.findIndex(r => r.id === row.id);
        if (i >= 0) list.splice(i, 1);
    };

    if (navigator.onLine) {
        try {
            const { data, error } = await supabaseClient.from(table).insert([row]).select();
            if (error) throw error;
            const i = list.findIndex(r => r.id === row.id);
            if (i >= 0) list[i] = (data && data[0]) ? data[0] : { ...row };
            list.sort(byDateDesc);
            return { queued: false, id: row.id };
        } catch (err) {
            if (!isNetworkError(err)) { drop(); throw err; }
            // connection dropped mid-save: fall through and queue it
        }
    }
    enqueue(table, row);
    return { queued: true, id: row.id };
}

function addExpense(amount, category, payment, createdAt, note, merchant = '') {
    const fields = { amount, category, payment, created_at: createdAt };
    if (merchant) fields.merchant = merchant;
    if (note) fields.note = note; // only sent when used, so a missing `note` column only matters for noted expenses
    return createRecord('expense', fields);
}

function addIncome(amount, source, createdAt) {
    return createRecord('income', { amount, source, created_at: createdAt });
}

async function updateRecord(type, id, fields) {
    const table = type === 'income' ? 'incomes' : 'expenses';
    const list = type === 'income' ? incomes : expenses;
    const idx = list.findIndex(r => r.id === id);

    if (idx >= 0 && list[idx]._pending) {
        // Not on the server yet: edit the local copy and the queued copy
        list[idx] = { ...list[idx], ...fields };
        list.sort(byDateDesc);
        const op = syncQueue.find(o => o.row.id === id);
        if (op) { op.row = { ...op.row, ...fields }; saveQueue(); }
        return;
    }

    requireOnline('Editing an entry');
    const { data, error } = await supabaseClient.from(table).update(fields).eq('id', id).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('That entry could not be updated.');
    const i = list.findIndex(r => r.id === id);
    if (i >= 0) list[i] = data[0];
    list.sort(byDateDesc);
}

async function deleteRecord(type, id) {
    const table = type === 'income' ? 'incomes' : 'expenses';
    const list = type === 'income' ? incomes : expenses;
    const rec = list.find(r => r.id === id);

    if (rec && rec._pending) {
        // Never reached the server: just forget it
        syncQueue = syncQueue.filter(o => o.row.id !== id);
        saveQueue();
    } else {
        requireOnline('Deleting an entry');
        const { data, error } = await supabaseClient.from(table).delete().eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('That entry could not be deleted.');
    }
    if (type === 'income') incomes = incomes.filter(r => r.id !== id);
    else expenses = expenses.filter(r => r.id !== id);
}

// === CHIP SELECTORS ===
function renderChips(container, items, selectedKey) {
    container.innerHTML = items.map(i => `
        <button type="button" class="chip ${i.key === selectedKey ? 'active' : ''}" data-key="${escapeHtml(i.key)}"
                style="--chip-color:${safeColor(i.color)}" aria-pressed="${i.key === selectedKey}">
            <i class="fas ${safeIcon(i.icon)}" aria-hidden="true"></i><span>${escapeHtml(i.label)}</span>
        </button>`).join('');
}

function bindChips(container, onSelect) {
    container.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        onSelect(chip.dataset.key);
    });
}

function renderExpenseChips() {
    renderChips($('expCategoryChips'), activeTaxonomy(CATEGORIES), expCategoryValue);
    renderChips($('expPaymentChips'), activeTaxonomy(PAYMENTS), expPaymentValue);
    const isOther = expCategoryValue === 'other';
    expNoteLabel.textContent = isOther ? 'Please specify (required)' : 'Note (optional)';
    expNote.placeholder = isOther ? 'What was this expense for?' : 'e.g. Lunch with team';
}
bindChips($('expCategoryChips'), (key) => { expCategoryValue = key; renderExpenseChips(); });
bindChips($('expPaymentChips'), (key) => { expPaymentValue = key; renderExpenseChips(); });

function syncIncomeChips() {
    renderChips($('incomeSourceChips'), INCOME_SOURCES, incomeSource.value.trim());
}
bindChips($('incomeSourceChips'), (key) => { incomeSource.value = key; syncIncomeChips(); });
incomeSource.addEventListener('input', syncIncomeChips);

renderExpenseChips();
syncIncomeChips();
expDate.value = toInputDate();
incomeDate.value = toInputDate();

// === PASSWORD VISIBILITY & STRENGTH ===
document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = $(btn.dataset.target);
        const icon = btn.querySelector('i');
        if (target.type === 'password') {
            target.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            target.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });
});

passInput2.addEventListener('input', () => {
    const v = passInput2.value;
    let score = 0;
    if (v.length >= 6) score++;
    if (v.length >= 10) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    if (!v) score = 0;
    passStrength.dataset.score = score;
});

// === AUTH TABS ===
let isLoginMode = true;

function switchAuthTab(tab) {
    const isLogin = tab === 'login';

    loginTab.classList.toggle('active', isLogin);
    registerTab.classList.toggle('active', !isLogin);
    loginFields.classList.toggle('collapsed', !isLogin);
    registerFields.classList.toggle('collapsed', isLogin);

    if (isLogin) {
        authTitle.textContent = 'Welcome back 👋';
        authSub.textContent = 'Sign in to keep tracking your spending';
        authActionBtn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Sign In';
        if (emailInput2.value) emailInput.value = emailInput2.value;
        if (passInput2.value) passInput.value = passInput2.value;
    } else {
        authTitle.textContent = 'Create account ✨';
        authSub.textContent = 'Register with your email — we\'ll send a verification link';
        authActionBtn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
        if (emailInput.value) emailInput2.value = emailInput.value;
        if (passInput.value) passInput2.value = passInput.value;
    }

    isLoginMode = isLogin;
    resendRow.classList.add('hidden');
}

loginTab.addEventListener('click', () => switchAuthTab('login'));
registerTab.addEventListener('click', () => switchAuthTab('register'));

// Enter submits the active form
[emailInput, passInput, userInput, emailInput2, passInput2, confirmPass].forEach(el => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') authActionBtn.click(); });
});
[setupUsername, setupPassword, setupConfirmPassword].forEach(el => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') setupCompleteBtn.click(); });
});

// === AUTH ACTION ===
async function handleAuthAction(email, password, isLogin) {
    if (!supabaseClient) {
        return showModal({ type: 'error', ...backendUnavailable() });
    }
    if (!email || !email.includes('@')) {
        return showModal({ type: 'warning', title: 'Check your email', message: 'Please enter a valid email address.' });
    }
    if (!password) {
        return showModal({ type: 'warning', title: 'Password required', message: 'Please enter your password.' });
    }

    if (isLogin) {
        setBusy(authActionBtn, true, 'Signing in...');
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await onLoginSuccess(data.user);
        } catch (err) {
            console.error('Login error:', err);
            const notConfirmed = /confirm/i.test(err.message || '');
            showModal({
                type: 'error',
                title: notConfirmed ? 'Email not verified yet' : 'Sign in failed',
                message: notConfirmed
                    ? 'Please click the verification link we emailed you before signing in.'
                    : (err.message || 'Invalid email or password.')
            });
            if (notConfirmed) {
                lastRegisteredEmail = email;
                resendRow.classList.remove('hidden');
            }
        } finally {
            setBusy(authActionBtn, false);
        }
        return;
    }

    // REGISTER
    const username = userInput.value.trim();
    const confirm = confirmPass.value.trim();

    if (!username) {
        return showModal({ type: 'warning', title: 'Username required', message: 'Please choose a username.' });
    }
    if (password.length < 6) {
        return showModal({ type: 'warning', title: 'Weak password', message: 'Password must be at least 6 characters.' });
    }
    if (password !== confirm) {
        return showModal({ type: 'warning', title: 'Passwords don\'t match', message: 'Please make sure both password fields match.' });
    }

    setBusy(authActionBtn, true, 'Creating account...');
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                // setup_complete marks the profile as finished, so email users skip the Setup screen
                data: { username, setup_complete: true },
                emailRedirectTo: window.location.origin + window.location.pathname
            }
        });

        if (error) throw error;

        if (data?.user?.identities?.length === 0) {
            showModal({
                type: 'warning',
                title: 'Account already exists',
                message: `${email} is already registered. Please sign in instead.`,
                confirmText: 'Go to Login',
                onConfirm: () => { switchAuthTab('login'); }
            });
            return;
        }

        if (data.session) {
            await onLoginSuccess(data.user);
            return;
        }

        lastRegisteredEmail = email;
        showModal({
            type: 'success',
            title: 'Verify your email',
            message: `We've sent a verification link to ${email}. Open your inbox and click the link — you'll be brought back here to log in.`,
            confirmText: 'Got it',
            onConfirm: () => {
                switchAuthTab('login');
                emailInput.value = email;
                passInput.value = '';
                userInput.value = '';
                confirmPass.value = '';
                emailInput2.value = '';
                passInput2.value = '';
                passStrength.dataset.score = 0;
                resendRow.classList.remove('hidden'); // switchAuthTab hides it, so show it after
            }
        });
    } catch (err) {
        console.error('Signup error:', err);
        showModal({ type: 'error', title: 'Couldn\'t create account', message: err.message || 'Please try again.' });
    } finally {
        setBusy(authActionBtn, false);
    }
}

authActionBtn.addEventListener('click', () => {
    const isLogin = loginTab.classList.contains('active');
    const email = isLogin ? emailInput.value.trim() : emailInput2.value.trim();
    const password = isLogin ? passInput.value.trim() : passInput2.value.trim();
    handleAuthAction(email, password, isLogin);
});

// === RESEND ===
resendBtn.addEventListener('click', async () => {
    const email = lastRegisteredEmail || emailInput.value.trim();
    if (!email) {
        return showModal({ type: 'warning', title: 'Enter your email', message: 'Type your email above first, then tap Resend.' });
    }
    setBusy(resendBtn, true, 'Sending...');
    try {
        const { error } = await supabaseClient.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
        showModal({ type: 'success', title: 'Email sent', message: `A new verification link is on its way to ${email}.` });
    } catch (err) {
        console.error('Resend error:', err);
        showModal({ type: 'error', title: 'Couldn\'t resend', message: err.message || 'Please try again in a moment.' });
    } finally {
        setBusy(resendBtn, false);
    }
});

// === GOOGLE LOGIN ===
googleBtn.addEventListener('click', async () => {
    if (!supabaseClient) {
        return showModal({ type: 'error', ...backendUnavailable() });
    }
    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
    } catch (err) {
        console.error('Google login error:', err);
        if (/provider is not enabled/i.test(err.message || '')) {
            showModal({ type: 'error', title: 'Google sign-in unavailable', message: 'Google login isn\'t enabled yet for this app. Please use email & password.' });
        } else {
            showModal({ type: 'error', title: 'Google sign-in failed', message: err.message || 'Please try again.' });
        }
    }
});

// === SETUP COMPLETE (for new Google users) ===
setupCompleteBtn.addEventListener('click', async () => {
    const username = setupUsername.value.trim();
    const password = setupPassword.value.trim();
    const confirm = setupConfirmPassword.value.trim();

    if (!username) {
        return showModal({ type: 'warning', title: 'Username required', message: 'Please choose a username.' });
    }
    if (password.length < 6) {
        return showModal({ type: 'warning', title: 'Weak password', message: 'Password must be at least 6 characters.' });
    }
    if (password !== confirm) {
        return showModal({ type: 'warning', title: 'Passwords don\'t match', message: 'Please make sure both password fields match.' });
    }

    setBusy(setupCompleteBtn, true, 'Saving...');
    try {
        const { data, error } = await supabaseClient.auth.updateUser({
            password,
            data: { username, setup_complete: true }
        });
        if (error) throw error;

        currentUser = data.user;
        enterApp();
        await fetchAllData();
        showModal({ type: 'success', title: 'Setup complete!', message: 'Your account is ready. Welcome aboard!' });
    } catch (err) {
        console.error('Setup error:', err);
        showModal({ type: 'error', title: 'Setup failed', message: err.message || 'Could not update your profile. Please try again.' });
    } finally {
        setBusy(setupCompleteBtn, false);
    }
});

// === LOGOUT ===
logoutBtn.addEventListener('click', () => {
    showModal({
        type: 'question',
        title: 'Log out?',
        message: syncQueue.length
            ? `${syncQueue.length} change${syncQueue.length === 1 ? ' hasn\'t' : 's haven\'t'} synced yet. ${syncQueue.length === 1 ? 'It\'s' : 'They\'re'} kept on this device and will sync the next time you log in.`
            : 'You can always sign back in with your email and password.',
        confirmText: 'Log out',
        cancelText: 'Stay',
        danger: true,
        onConfirm: async () => {
            try { localStorage.removeItem(cacheKey()); } catch (_) { /* ignore */ } // don't leave your data on a shared device
            await supabaseClient.auth.signOut();
            resetSession();
        }
    });
});

function resetSession() {
    currentUser = null;
    expenses = [];
    incomes = [];
    recurring = [];
    recurringIncomes = [];
    budgets = [];
    monthlyReportPreference = null;
    dateFormat = 'dmy_short';
    resetTaxonomyDefaults();
    syncQueue = [];
    cancelRecurringEdit();
    closeTaxonomyManager();
    closeAddSheet();
    closeAccountSheet();
    closeBudgetSheet();
    emailInput.value = '';
    passInput.value = '';
    switchAuthTab('login');
    showScreen('authScreen');
}

// === SESSION ===
function enterApp() {
    setActiveNav('dashboard');
    showScreen('dashboardScreen');
}

async function onLoginSuccess(user) {
    if (currentUser?.id !== user.id) {
        monthlyReportPreference = null;
        dateFormat = 'dmy_short';
    }
    currentUser = user;

    // Users who signed up with email always have a username. Anyone without one
    // (a brand-new Google account) finishes their profile first.
    const meta = user.user_metadata || {};
    if (!meta.username) {
        setupUsername.value = '';
        setupPassword.value = '';
        setupConfirmPassword.value = '';
        showScreen('setupScreen');
        return;
    }

    [emailInput, passInput, userInput, confirmPass, emailInput2, passInput2].forEach(el => { el.value = ''; });
    resendRow.classList.add('hidden');
    enterApp();
    await fetchAllData();
}

if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        // Don't await Supabase calls directly inside this callback (can deadlock the client)
        setTimeout(async () => {
            if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && recoveryMode && session?.user)) {
                recoveryMode = true;
                $('newPassword').value = '';
                $('newPasswordConfirm').value = '';
                showScreen('resetPasswordScreen');
                return;
            }
            if (event === 'SIGNED_IN' && session?.user) {
                if (cameFromEmailConfirmation) {
                    await supabaseClient.auth.signOut();
                    history.replaceState(null, '', window.location.pathname);
                    switchAuthTab('login');
                    emailInput.value = session.user.email || '';
                    showModal({
                        type: 'success',
                        title: 'Email verified! ✅',
                        message: 'Your account is active. Please log in with your password to continue.'
                    });
                    return;
                }
                if (!currentUser) await onLoginSuccess(session.user);
            } else if (event === 'SIGNED_OUT') {
                if (currentUser) resetSession();
                else showScreen('authScreen');
            }
        }, 0);
    });
}

// === EXPENSE ===
saveExpenseBtn.addEventListener('click', async () => {
    if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });

    const amount = parseFloat(expAmount.value);
    if (isNaN(amount) || amount <= 0) {
        expAmount.focus();
        return showModal({ type: 'warning', title: 'Invalid amount', message: 'Please enter a valid amount greater than 0.' });
    }
    const note = expNote.value.trim();
    const merchant = expMerchant.value.trim();
    if (expCategoryValue === 'other' && !note) {
        expNote.focus();
        return showModal({ type: 'warning', title: 'Please specify', message: 'Tell us what this "Other" expense was for.' });
    }
    const createdAt = dateInputToISO(expDate.value);

    setBusy(saveExpenseBtn, true, 'Saving...');
    try {
        const { queued } = await addExpense(amount, expCategoryValue, expPaymentValue, createdAt, note, merchant);
        expAmount.value = '';
        expNote.value = '';
        expMerchant.value = '';
        expDate.value = toInputDate();
        const saved = new Date(createdAt);
        setSelectedMonth(saved.getFullYear(), saved.getMonth());
        closeAddSheet();
        showToast(queued ? 'info' : 'success', queued
            ? `Saved offline — ${formatMoney(amount)} will sync when you're back online`
            : `Expense of ${formatMoney(amount)} saved`);
        checkBudgetAlerts(expCategoryValue, amount, createdAt);
    } catch (err) {
        console.error('Save expense error:', err);
        showModal({ type: 'error', title: 'Couldn\'t save expense', message: err.message || 'Please try again.' });
    } finally {
        setBusy(saveExpenseBtn, false);
    }
});
expAmount.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveExpenseBtn.click(); });

// === INCOME ===
saveIncomeBtn.addEventListener('click', async () => {
    if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });

    const amount = parseFloat(incomeAmount.value);
    if (isNaN(amount) || amount <= 0) {
        incomeAmount.focus();
        return showModal({ type: 'warning', title: 'Invalid amount', message: 'Please enter a valid income amount.' });
    }
    const source = incomeSource.value.trim() || 'Salary';
    const createdAt = dateInputToISO(incomeDate.value);

    setBusy(saveIncomeBtn, true, 'Saving...');
    try {
        const { queued } = await addIncome(amount, source, createdAt);
        incomeAmount.value = '';
        incomeSource.value = '';
        incomeDate.value = toInputDate();
        syncIncomeChips();
        const saved = new Date(createdAt);
        setSelectedMonth(saved.getFullYear(), saved.getMonth());
        closeAddSheet();
        showToast(queued ? 'info' : 'success', queued
            ? `Saved offline — ${formatMoney(amount)} will sync when you're back online`
            : `Income of ${formatMoney(amount)} saved`);
    } catch (err) {
        console.error('Save income error:', err);
        showModal({ type: 'error', title: 'Couldn\'t save income', message: err.message || 'Please try again.' });
    } finally {
        setBusy(saveIncomeBtn, false);
    }
});
incomeAmount.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveIncomeBtn.click(); });

// === HISTORY ===
function fillSelect(select, items, allLabel) {
    select.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
        items.map(i => `<option value="${escapeHtml(i.key)}">${escapeHtml(i.label)}${i.active === false ? ' (inactive)' : ''}</option>`).join('');
}
fillSelect(historyCategoryFilter, CATEGORIES, 'All categories');
fillSelect(editCategory, CATEGORIES);
fillSelect(editPayment, PAYMENTS);
historyMonthFilter.value = formatMonthValue(selectedDate);

function openHistoryFiltered({ type = 'all', category = '', month = '' } = {}) {
    historyTypeFilter.value = type;
    historyCategoryFilter.value = category;
    historyMonthFilter.value = month;
    historySearch.value = '';
    navigate('history');
}

function renderHistory() {
    if (!currentUser) return;
    historyList.setAttribute('aria-busy', String(isLoading));

    const type = historyTypeFilter.value;
    const category = historyCategoryFilter.value;
    const month = historyMonthFilter.value;
    const query = historySearch.value.trim().toLowerCase();

    // A category only makes sense for expenses
    historyCategoryFilter.disabled = type === 'income';

    let list = allTransactions();
    const overviewMonth = historyMonthFilter.value || formatMonthValue(selectedDate);
    const [overviewYear, overviewMon] = overviewMonth.split('-').map(Number);
    const monthTransactions = allTransactions().filter(t => {
        const d = new Date(t.created_at);
        return d.getFullYear() === overviewYear && d.getMonth() === overviewMon - 1;
    });
    const monthIncome = sumAmount(monthTransactions.filter(t => t.type === 'income'));
    const monthExpense = sumAmount(monthTransactions.filter(t => t.type === 'expense'));
    document.querySelector('.history-overview-label').textContent = `Spent in ${new Date(overviewYear, overviewMon - 1, 1).toLocaleDateString('en-MY', { month: 'long' })}`;
    $('historyMonthSpend').textContent = formatMoney(monthExpense);
    $('historyMonthIncome').textContent = formatMoney(monthIncome);
    $('historyMonthExpense').textContent = formatMoney(monthExpense);
    $('historyMonthMeta').textContent = `${monthTransactions.length} transaction${monthTransactions.length === 1 ? '' : 's'} · ${new Date(overviewYear, overviewMon - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })}`;
    if (type !== 'all') list = list.filter(t => t.type === type);
    if (category && type !== 'income') list = list.filter(t => t.type === 'expense' && t.category === category);
    if (month) {
        const [year, mon] = month.split('-').map(Number);
        list = list.filter(t => {
            const d = new Date(t.created_at);
            return d.getFullYear() === year && d.getMonth() === mon - 1;
        });
    }
    if (query) {
        list = list.filter(t => {
            const hay = t.type === 'income'
                ? `${t.source} income`
                : `${t.merchant || ''} ${catByKey[t.category]?.label || t.category} ${t.note || ''} ${payByKey[t.payment]?.label || t.payment} expense`;
            return hay.toLowerCase().includes(query);
        });
    }

    visibleHistoryTransactions = list.slice();

    const inc = sumAmount(list.filter(t => t.type === 'income'));
    const exp = sumAmount(list.filter(t => t.type === 'expense'));
    historySummary.innerHTML = list.length
        ? `<span><b>${list.length}</b> transaction${list.length === 1 ? '' : 's'}</span>
           <span class="income">+ ${formatMoney(inc)}</span>
           <span class="expense">− ${formatMoney(exp)}</span>`
        : '';

    if (!list.length) {
        historyList.innerHTML = isLoading
            ? '<div class="history-empty" role="status"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><div>Loading your transactions…</div></div>'
            : '<div class="history-empty"><i class="fas fa-inbox" aria-hidden="true"></i><div>No transactions found for this filter.</div></div>';
        return;
    }

    // Group by calendar day (the list is already newest-first)
    const groups = [];
    list.forEach(t => {
        const key = toInputDate(t.created_at);
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.items.push(t);
        else groups.push({ key, label: friendlyDate(t.created_at), items: [t] });
    });
    historyList.innerHTML = groups.map(g => {
        const spent = sumAmount(g.items.filter(t => t.type === 'expense'));
        return `
            <div class="day-head">
                <span class="day-name">${escapeHtml(g.label)}</span>
                <span class="day-total">${spent > 0 ? `Spent ${formatMoney(spent)}` : ''}</span>
            </div>
            <div class="day-group">${g.items.map(t => transactionRowHtml(t, true, false)).join('')}</div>`;
    }).join('');
}

[historyTypeFilter, historyCategoryFilter, historyMonthFilter].forEach(el => el.addEventListener('change', renderHistory));
historySearch.addEventListener('input', renderHistory);
historyResetBtn.addEventListener('click', () => {
    historyTypeFilter.value = 'all';
    historyCategoryFilter.value = '';
    historyMonthFilter.value = formatMonthValue(selectedDate);
    historySearch.value = '';
    renderHistory();
});

function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('historyCsvBtn').addEventListener('click', () => {
    const rows = [['Date', 'Type', 'Merchant', 'Category', 'Payment', 'Income source', 'Note', 'Amount (RM)']];
    visibleHistoryTransactions.forEach(t => rows.push([
        toInputDate(t.created_at),
        t.type,
        t.merchant || '',
        t.type === 'expense' ? (catByKey[t.category]?.label || t.category) : '',
        t.type === 'expense' ? (payByKey[t.payment]?.label || t.payment) : '',
        t.type === 'income' ? (t.source || 'Salary') : '',
        t.note || '',
        Number(t.amount).toFixed(2)
    ]));
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const month = historyMonthFilter.value || formatMonthValue(selectedDate);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `vinexpenses-${month}-transactions.csv`);
    showToast('success', `${visibleHistoryTransactions.length} transaction${visibleHistoryTransactions.length === 1 ? '' : 's'} exported`);
});

// === MONTHLY REPORT (in-app view) ===
// Shown inside the app, not in a new window. An installed iPhone app has no tab bar and no browser
// back button, so a separate window would be a dead end. Back, Esc and the browser/edge-swipe back
// gesture all return to History.
const reportView = $('reportView');
let reportDocTitle = '';

function buildReportHtml(year, monthNumber, transactions) {
    const expensesTotal = sumAmount(transactions.filter(t => t.type === 'expense'));
    const incomeTotal = sumAmount(transactions.filter(t => t.type === 'income'));
    const monthLabel = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
    const rows = transactions.map(t => {
        const who = t.merchant || (t.type === 'income' ? t.source || 'Salary' : catByKey[t.category]?.label || t.category);
        return `<tr><td>${escapeHtml(toInputDate(t.created_at))}</td><td>${escapeHtml(t.type)}</td><td>${escapeHtml(who)}</td>` +
            `<td>${escapeHtml(t.type === 'expense' ? catByKey[t.category]?.label || t.category : '')}</td><td>${escapeHtml(t.note || '')}</td>` +
            `<td class="amount">${escapeHtml(formatMoney(t.amount))}</td></tr>`;
    }).join('');
    return `
        <header><h1>Monthly expense report</h1><p class="report-sub">${escapeHtml(monthLabel)} · VinExpenses</p></header>
        <div class="report-totals">
            <div><span>Income</span><b>${escapeHtml(formatMoney(incomeTotal))}</b></div>
            <div><span>Expenses</span><b>${escapeHtml(formatMoney(expensesTotal))}</b></div>
            <div><span>Net</span><b>${escapeHtml(formatMoney(incomeTotal - expensesTotal))}</b></div>
            <div><span>Transactions</span><b>${transactions.length}</b></div>
        </div>
        <div class="report-table-wrap"><table class="report-table">
            <thead><tr><th>Date</th><th>Type</th><th>Merchant / Source</th><th>Category</th><th>Note</th><th class="amount">Amount</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6">No transactions for this month.</td></tr>'}</tbody>
        </table></div>`;
}

function openReportView() {
    const month = historyMonthFilter.value || formatMonthValue(selectedDate);
    const [year, monthNumber] = month.split('-').map(Number);
    const transactions = allTransactions().filter(t => {
        const date = new Date(t.created_at);
        return date.getFullYear() === year && date.getMonth() === monthNumber - 1;
    });
    reportDocTitle = `VinExpenses-${month}-report`; // becomes the default file name when saving as PDF
    $('reportDoc').innerHTML = buildReportHtml(year, monthNumber, transactions);
    $('reportViewTitle').textContent = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
    reportView.classList.add('active');
    reportView.querySelector('.report-scroll').scrollTop = 0;
    syncBodyScroll();
    // One history entry, so the phone's back gesture / the browser Back button closes the report
    history.pushState({ view: 'report' }, '');
    $('reportBackBtn').focus();
}

function hideReportView() {
    reportView.classList.remove('active');
    syncBodyScroll();
}

// Back button / Esc: go back in history if we pushed an entry, otherwise just hide
function closeReportView() {
    if (history.state && history.state.view === 'report') history.back();
    else hideReportView();
}

window.addEventListener('popstate', () => {
    if (reportView.classList.contains('active')) hideReportView();
});

$('historyReportBtn').addEventListener('click', openReportView);
$('reportBackBtn').addEventListener('click', closeReportView);
$('reportPrintBtn').addEventListener('click', () => {
    if (typeof window.print !== 'function') return showToast('error', 'Printing isn\'t available in this browser.');
    const previousTitle = document.title;
    document.title = reportDocTitle;
    window.addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
    window.print();
});

historyList.addEventListener('click', (e) => {
    const swipeAction = e.target.closest('[data-swipe-action]');
    if (swipeAction) {
        const item = swipeAction.closest('.swipe-row').querySelector('.history-item');
        const { id, type } = item.dataset;
        closeOpenSwipe();
        if (swipeAction.dataset.swipeAction === 'delete') deleteWithUndo(type, id);
        else duplicateRecord(type, id);
        return;
    }
    if (Date.now() < suppressClickUntil) return;
    const btn = e.target.closest('[data-action]');
    const row = e.target.closest('.history-item');
    if (!row) return;
    const { id, type } = row.dataset;
    if (btn && btn.dataset.action === 'delete') deleteWithUndo(type, id);
    else openEditModal(type, id); // clicking the row or the pen opens the editor
});

recentList.addEventListener('click', (e) => {
    const row = e.target.closest('.history-item');
    if (row) openEditModal(row.dataset.type, row.dataset.id);
});

// Rows are focusable: Enter / Space opens the editor for keyboard users
[historyList, recentList].forEach(list => list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.history-item');
    if (row && e.target === row) {
        e.preventDefault();
        openEditModal(row.dataset.type, row.dataset.id);
    }
}));

function refreshAfterChange() {
    updateDashboard();
    if ($('historyScreen').classList.contains('active')) renderHistory();
}

// Deletes straight away and offers Undo (faster and safer than a "are you sure?" dialog)
async function deleteWithUndo(type, id) {
    const list = type === 'income' ? incomes : expenses;
    const rec = list.find(r => r.id === id);
    if (!rec) return;
    const snapshot = { ...rec };

    try {
        await deleteRecord(type, id);
    } catch (err) {
        console.error('Delete error:', err);
        showToast('error', err.message || 'Couldn\'t delete that entry');
        renderHistory();
        return;
    }
    refreshAfterChange();

    showToast('success', `${type === 'income' ? 'Income' : 'Expense'} of ${formatMoney(snapshot.amount)} deleted`, {
        actionLabel: 'Undo',
        onAction: async () => {
            try {
                const { user_id, _pending, ...fields } = snapshot; // same id and date, so it reappears exactly where it was
                await createRecord(type, fields);
                refreshAfterChange();
                showToast('success', 'Restored');
            } catch (err) {
                console.error('Undo error:', err);
                showModal({ type: 'error', title: 'Couldn\'t restore', message: err.message || 'Please try again.' });
            }
        }
    });
}

async function duplicateRecord(type, id) {
    const list = type === 'income' ? incomes : expenses;
    const rec = list.find(r => r.id === id);
    if (!rec) return;
    const { id: _id, user_id, created_at, _pending, ...fields } = rec;

    try {
        const { id: newId, queued } = await createRecord(type, { ...fields, created_at: new Date().toISOString() });
        refreshAfterChange();
        showToast(queued ? 'info' : 'success', queued ? 'Duplicated — will sync when you\'re online' : 'Duplicated as today\'s entry', {
            actionLabel: 'Undo',
            onAction: async () => {
                try { await deleteRecord(type, newId); refreshAfterChange(); }
                catch (err) { showToast('error', err.message || 'Couldn\'t undo'); }
            }
        });
    } catch (err) {
        console.error('Duplicate error:', err);
        showModal({ type: 'error', title: 'Couldn\'t duplicate', message: err.message || 'Please try again.' });
    }
}

// === SWIPE ACTIONS (touch): swipe left to delete, swipe right to duplicate ===
const swipe = { item: null, pid: null, startX: 0, startY: 0, dx: 0, active: false };
let suppressClickUntil = 0;

function swipeReset() {
    swipe.item = null;
    swipe.active = false;
    swipe.dx = 0;
}

function swipeBackgrounds(item) {
    const row = item.parentElement;
    return { dup: row.querySelector('.swipe-bg.dup'), del: row.querySelector('.swipe-bg.del') };
}

function closeOpenSwipe(except = null) {
    historyList.querySelectorAll('.swipe-row.is-open .history-item').forEach(item => {
        if (item === except) return;
        item.classList.add('settling');
        item.style.transform = '';
        item.parentElement.classList.remove('is-open');
        const bg = swipeBackgrounds(item);
        bg.dup.style.opacity = 0;
        bg.del.style.opacity = 0;
    });
}

historyList.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // desktop has hover buttons
    const item = e.target.closest('.swipe-row .history-item');
    if (!item || e.target.closest('button')) return;
    closeOpenSwipe(item);
    swipe.item = item;
    swipe.pid = e.pointerId;
    swipe.startX = e.clientX;
    swipe.startY = e.clientY;
    swipe.dx = 0;
    swipe.active = false;
});

historyList.addEventListener('pointermove', (e) => {
    if (!swipe.item || e.pointerId !== swipe.pid) return;
    const dx = e.clientX - swipe.startX;
    const dy = e.clientY - swipe.startY;

    if (!swipe.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return swipeReset(); // it's a scroll
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        swipe.active = true;
        swipe.item.classList.remove('settling');
        try { swipe.item.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    }

    swipe.dx = dx;
    swipe.item.style.transform = `translateX(${dx}px)`;
    const bg = swipeBackgrounds(swipe.item);
    bg.dup.style.opacity = dx > 0 ? Math.min(1, dx / 70) : 0;
    bg.del.style.opacity = dx < 0 ? Math.min(1, -dx / 70) : 0;
});

function endSwipe(e) {
    const item = swipe.item;
    if (!item || e.pointerId !== swipe.pid) return;
    const wasActive = swipe.active;
    const dx = swipe.dx;
    swipeReset();
    if (!wasActive) return;

    suppressClickUntil = Date.now() + 350; // the finger lifting must not also "tap" the row
    const width = item.offsetWidth;
    const threshold = Math.min(130, width * 0.35);
    const bg = swipeBackgrounds(item);
    const { id, type } = item.dataset;
    item.classList.add('settling');

    if (e.type !== 'pointercancel' && Math.abs(dx) >= threshold) {
        if (dx < 0) {
            item.style.transform = `translateX(${-width}px)`; // fly off, then delete
            setTimeout(() => deleteWithUndo(type, id), 180);
        } else {
            item.style.transform = '';
            bg.dup.style.opacity = 0;
            duplicateRecord(type, id);
        }
    } else {
        const revealWidth = Math.min(104, width * 0.28);
        if (Math.abs(dx) > 42) {
            const reveal = dx > 0 ? revealWidth : -revealWidth;
            item.style.transform = `translateX(${reveal}px)`;
            item.parentElement.classList.add('is-open');
            bg.dup.style.opacity = dx > 0 ? 1 : 0;
            bg.del.style.opacity = dx < 0 ? 1 : 0;
        } else {
            item.style.transform = '';
            item.parentElement.classList.remove('is-open');
            setTimeout(() => { bg.dup.style.opacity = 0; bg.del.style.opacity = 0; }, 220);
        }
    }
}
historyList.addEventListener('pointerup', endSwipe);
historyList.addEventListener('pointercancel', endSwipe);

// === EDIT MODAL ===
function openEditModal(type, id) {
    const rec = (type === 'income' ? incomes : expenses).find(r => r.id === id);
    if (!rec) return;
    editing = { type, id, createdAt: rec.created_at };

    editTitle.textContent = type === 'income' ? 'Edit income' : 'Edit expense';
    editAmount.value = parseFloat(rec.amount);
    editDate.value = toInputDate(rec.created_at);
    editExpenseFields.classList.toggle('hidden', type === 'income');
    editIncomeFields.classList.toggle('hidden', type !== 'income');
    if (type === 'income') {
        editSource.value = rec.source || '';
    } else {
        editCategory.value = rec.category;
        editPayment.value = rec.payment;
        editNote.value = rec.note || '';
        editMerchant.value = rec.merchant || '';
        editing.hadNote = !!rec.note;
    }

    editModal.classList.add('active');
    syncBodyScroll();
    editAmount.focus();
}

function closeEditModal() {
    editModal.classList.remove('active');
    editing = null;
    syncBodyScroll();
}

editCancelBtn.addEventListener('click', closeEditModal);
$('editDeleteBtn').addEventListener('click', () => {
    if (!editing) return;
    const { type, id } = editing;
    closeEditModal();
    deleteWithUndo(type, id);
});
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
[editAmount, editDate, editSource].forEach(el => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') editSaveBtn.click(); });
});

editSaveBtn.addEventListener('click', async () => {
    if (!editing) return;
    const amount = parseFloat(editAmount.value);
    if (isNaN(amount) || amount <= 0) {
        editAmount.focus();
        return showModal({ type: 'warning', title: 'Invalid amount', message: 'Please enter a valid amount greater than 0.' });
    }
    const { type, id, createdAt, hadNote } = editing;
    const fields = { amount, created_at: dateInputToISO(editDate.value, new Date(createdAt)) };
    if (type === 'income') {
        fields.source = editSource.value.trim() || 'Salary';
    } else {
        const note = editNote.value.trim();
        if (editCategory.value === 'other' && !note) {
            editNote.focus();
            return showModal({ type: 'warning', title: 'Please specify', message: 'Tell us what this "Other" expense was for.' });
        }
        fields.category = editCategory.value;
        fields.payment = editPayment.value;
        fields.merchant = editMerchant.value.trim() || null;
        if (note || hadNote) fields.note = note || null;
    }

    setBusy(editSaveBtn, true, 'Saving...');
    try {
        await updateRecord(type, id, fields);
        closeEditModal();
        updateDashboard();
        if ($('historyScreen').classList.contains('active')) renderHistory();
        showToast('success', 'Changes saved');
    } catch (err) {
        console.error('Update error:', err);
        showModal({ type: 'error', title: 'Couldn\'t save changes', message: err.message || 'Please try again.' });
    } finally {
        setBusy(editSaveBtn, false);
    }
});

// === RECURRING EXPENSES ===
// Bills/subscriptions that repeat. When one falls due, an ordinary expense is added
// automatically (and any dates missed while the app was closed are back-filled).
const FREQUENCIES = [
    { key: 'monthly', label: 'Monthly', icon: 'fa-calendar-days', color: '#4f46e5' },
    { key: 'weekly', label: 'Weekly', icon: 'fa-calendar-week', color: '#4f46e5' },
    { key: 'yearly', label: 'Yearly', icon: 'fa-calendar', color: '#4f46e5' }
];
const FREQ_LABEL = { monthly: 'Monthly', weekly: 'Weekly', yearly: 'Yearly' };
const RECURRING_PRESETS = [
    { name: 'Electricity', category: 'utilities', icon: 'fa-bolt' },
    { name: 'Water', category: 'utilities', icon: 'fa-droplet' },
    { name: 'Internet', category: 'utilities', icon: 'fa-wifi' },
    { name: 'Apple subscription', category: 'entertain', icon: 'fa-cloud' },
    { name: 'Netflix', category: 'entertain', icon: 'fa-film' },
    { name: 'Spotify', category: 'entertain', icon: 'fa-music' },
    { name: 'Rent', category: 'other', icon: 'fa-house' },
    { name: 'Insurance', category: 'other', icon: 'fa-umbrella' },
    { name: 'Car loan', category: 'car', icon: 'fa-car' },
    { name: 'Gym', category: 'health', icon: 'fa-dumbbell' }
];

const recName = $('recName');
const recAmount = $('recAmount');
const recDate = $('recDate');
const recDateLabel = $('recDateLabel');
const saveRecurringBtn = $('saveRecurringBtn');
const cancelRecurringBtn = $('cancelRecurringBtn');
const recurringList = $('recurringList');
const recurringSummary = $('recurringSummary');
const recurringFormTitle = $('recurringFormTitle');
const upcomingList = $('upcomingList');
let recurringType = 'expense';

function setRecurringType(type) {
    recurringType = type;
    const isExpense = type === 'expense';
    $('recTypeExpense').classList.toggle('active', isExpense);
    $('recTypeExpense').setAttribute('aria-pressed', String(isExpense));
    $('recTypeIncome').classList.toggle('active', !isExpense);
    $('recTypeIncome').setAttribute('aria-pressed', String(!isExpense));
    $('recExpenseFields').classList.toggle('hidden', !isExpense);
    $('recPresetGroup').classList.toggle('hidden', !isExpense);
    $('recNameLabel').textContent = isExpense ? 'Name' : 'Income source';
    recName.placeholder = isExpense ? 'e.g. Electricity, Netflix' : 'e.g. Salary, Freelance';
    recName.parentElement.querySelector('i').className = `fas ${isExpense ? 'fa-tag' : 'fa-sack-dollar'}`;
    renderRecurringChips();
}
$('recTypeExpense').addEventListener('click', () => setRecurringType('expense'));
$('recTypeIncome').addEventListener('click', () => setRecurringType('income'));

// Dates are handled as plain "YYYY-MM-DD" strings (no timezone maths), so they compare with < and >.
function parseYMD(s) {
    const [y, m, d] = s.split('-').map(Number);
    return { y, m, d };
}
function fmtYMD(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

function advanceDue(dueStr, freq, anchorDay) {
    let { y, m, d } = parseYMD(dueStr);
    if (freq === 'weekly') {
        const dt = new Date(y, m - 1, d + 7);
        return fmtYMD(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
    if (freq === 'yearly') {
        y += 1;
        return fmtYMD(y, m, Math.min(anchorDay, daysInMonth(y, m)));
    }
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return fmtYMD(y, m, Math.min(anchorDay, daysInMonth(y, m))); // e.g. the 31st becomes 28/30 in short months
}

function formatDueLabel(dateStr) {
    return formatDateDisplay(dateStr);
}

function daysUntil(dateStr) {
    const a = parseYMD(dateStr);
    const t = parseYMD(toInputDate());
    return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(t.y, t.m - 1, t.d)) / 86400000);
}

function dueLabel(dateStr) {
    const n = daysUntil(dateStr);
    if (n <= 0) return 'Due today';
    if (n === 1) return 'Tomorrow';
    return `In ${n} days`;
}

function monthlyEquivalent(r) {
    const amt = parseFloat(r.amount || 0);
    if (r.frequency === 'weekly') return amt * 52 / 12;
    if (r.frequency === 'yearly') return amt / 12;
    return amt;
}

function dueNoonISO(dateStr) {
    const { y, m, d } = parseYMD(dateStr);
    return new Date(y, m - 1, d, 12).toISOString();
}

let recurringBusy = false;
let recurringIncomeBusy = false;

// Posts due expense and income schedules into the normal transaction history.
async function processRecurring({ silent = false } = {}) {
    if (!currentUser || recurringBusy) return 0;
    const today = toInputDate();
    const dueItems = recurringLoadError ? [] : recurring.filter(r => r.active && r.next_due <= today);

    recurringBusy = true;
    let added = 0;
    try {
        for (const r of dueItems) {
            const anchor = parseYMD(r.start_date).d;
            const dues = [];
            let next = r.next_due;
            while (next <= today && dues.length < 36) {
                dues.push(next);
                next = advanceDue(next, r.frequency, anchor);
            }

            // Claim these dates first. If another device already did, nothing matches and we skip,
            // which prevents the same bill being added twice.
            const claim = await supabaseClient.from('recurring_expenses')
                .update({ next_due: next }).eq('id', r.id).eq('next_due', r.next_due).select();
            if (claim.error || !claim.data || !claim.data.length) continue;

            const rows = dues.map(d => ({
                user_id: currentUser.id,
                amount: r.amount,
                category: r.category,
                payment: r.payment,
                merchant: r.name,
                note: r.name,
                created_at: dueNoonISO(d)
            }));
            const ins = await supabaseClient.from('expenses').insert(rows).select();
            if (ins.error) {
                console.error('Recurring insert failed, rolling back:', ins.error);
                await supabaseClient.from('recurring_expenses').update({ next_due: r.next_due }).eq('id', r.id);
                continue;
            }
            r.next_due = next;
            expenses.push(...(ins.data || []));
            added += (ins.data || []).length;
        }
    } catch (err) {
        console.error('Recurring processing error:', err);
    } finally {
        recurringBusy = false;
    }

    const incomeAdded = await processRecurringIncome();
    if (added) {
        expenses.sort(byDateDesc);
        recurring.sort((a, b) => a.next_due.localeCompare(b.next_due));
    }
    if (incomeAdded) incomes.sort(byDateDesc);
    if (added || incomeAdded) {
        updateDashboard();
        if ($('historyScreen').classList.contains('active')) renderHistory();
        if ($('recurringScreen').classList.contains('active')) renderRecurring();
        if (!silent) showToast('info', `${added + incomeAdded} recurring entr${added + incomeAdded === 1 ? 'y' : 'ies'} added`);
    }
    return added + incomeAdded;
}

async function processRecurringIncome() {
    if (!currentUser || recurringIncomeLoadError || recurringIncomeBusy) return 0;
    const today = toInputDate();
    const dueItems = recurringIncomes.filter(item => item.active && item.next_due <= today);
    if (!dueItems.length) return 0;
    recurringIncomeBusy = true;
    let added = 0;
    try {
        for (const item of dueItems) {
            const anchor = parseYMD(item.start_date).d;
            const dueDates = [];
            let next = item.next_due;
            while (next <= today && dueDates.length < 36) {
                dueDates.push(next);
                next = advanceDue(next, item.frequency, anchor);
            }
            const claim = await supabaseClient.from('recurring_incomes')
                .update({ next_due: next }).eq('id', item.id).eq('next_due', item.next_due).select();
            if (claim.error || !claim.data?.length) continue;
            const rows = dueDates.map(date => ({
                user_id: currentUser.id,
                amount: item.amount,
                source: item.source,
                created_at: dueNoonISO(date)
            }));
            const inserted = await supabaseClient.from('incomes').insert(rows).select();
            if (inserted.error) {
                console.error('Recurring income insert failed, rolling back:', inserted.error);
                await supabaseClient.from('recurring_incomes').update({ next_due: item.next_due }).eq('id', item.id);
                continue;
            }
            item.next_due = next;
            incomes.push(...(inserted.data || []));
            added += inserted.data?.length || 0;
        }
    } catch (error) {
        console.error('Recurring income processing error:', error);
    } finally {
        recurringIncomeBusy = false;
    }
    if (added) recurringIncomes.sort((a, b) => a.next_due.localeCompare(b.next_due));
    return added;
}

async function updateRecurringRecord(id, fields) {
    const { data, error } = await supabaseClient.from('recurring_expenses').update(fields).eq('id', id).select();
    if (error) throw error;
    if (!data || !data.length) throw new Error('That item could not be updated.');
    const idx = recurring.findIndex(r => r.id === id);
    if (idx >= 0) recurring[idx] = data[0];
    recurring.sort((a, b) => a.next_due.localeCompare(b.next_due));
}

async function updateRecurringIncomeRecord(id, fields) {
    const { data, error } = await supabaseClient.from('recurring_incomes').update(fields).eq('id', id).select();
    if (error) throw error;
    if (!data || !data.length) throw new Error('That recurring income could not be updated.');
    const idx = recurringIncomes.findIndex(item => item.id === id);
    if (idx >= 0) recurringIncomes[idx] = data[0];
    recurringIncomes.sort((a, b) => a.next_due.localeCompare(b.next_due));
}

// ---- Form ----
function renderRecurringChips() {
    renderChips($('recCategoryChips'), activeTaxonomy(CATEGORIES), recCategoryValue);
    renderChips($('recPaymentChips'), activeTaxonomy(PAYMENTS), recPaymentValue);
    renderChips($('recFreqChips'), FREQUENCIES, recFreqValue);
    renderChips($('recPresetChips'), RECURRING_PRESETS.map((p, i) => ({
        key: String(i), label: p.name, icon: p.icon, color: (catByKey[p.category] || {}).color
    })), null);
}
bindChips($('recCategoryChips'), (key) => { recCategoryValue = key; renderRecurringChips(); });
bindChips($('recPaymentChips'), (key) => { recPaymentValue = key; renderRecurringChips(); });
bindChips($('recFreqChips'), (key) => { recFreqValue = key; renderRecurringChips(); });
bindChips($('recPresetChips'), (key) => {
    const p = RECURRING_PRESETS[Number(key)];
    if (!p) return;
    recName.value = p.name;
    recCategoryValue = p.category;
    renderRecurringChips();
    recAmount.focus();
});

function cancelRecurringEdit() {
    editingRecurringId = null;
    $('recTypeExpense').disabled = false;
    $('recTypeIncome').disabled = false;
    setRecurringType('expense');
    recName.value = '';
    recAmount.value = '';
    recDate.value = toInputDate();
    recCategoryValue = activeTaxonomy(CATEGORIES).some(item => item.key === 'utilities') ? 'utilities' : (activeTaxonomy(CATEGORIES)[0]?.key || 'other');
    recPaymentValue = activeTaxonomy(PAYMENTS).some(item => item.key === 'bank') ? 'bank' : (activeTaxonomy(PAYMENTS)[0]?.key || 'card');
    recFreqValue = 'monthly';
    recurringFormTitle.textContent = 'Add recurring expense';
    recDateLabel.textContent = 'First due date';
    saveRecurringBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save recurring';
    cancelRecurringBtn.classList.add('hidden');
    renderRecurringChips();
}

function startRecurringEdit(id, kind = 'expense') {
    const list = kind === 'income' ? recurringIncomes : recurring;
    const r = list.find(x => x.id === id);
    if (!r) return;
    editingRecurringId = id;
    $('recTypeExpense').disabled = true;
    $('recTypeIncome').disabled = true;
    setRecurringType(kind);
    recName.value = kind === 'income' ? r.source : r.name;
    recAmount.value = parseFloat(r.amount);
    recDate.value = r.next_due;
    if (kind === 'expense') {
        recCategoryValue = r.category;
        recPaymentValue = r.payment;
    }
    recFreqValue = r.frequency;
    recurringFormTitle.textContent = kind === 'income' ? 'Edit recurring income' : 'Edit recurring expense';
    recDateLabel.textContent = 'Next due date';
    saveRecurringBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Update recurring';
    cancelRecurringBtn.classList.remove('hidden');
    renderRecurringChips();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    recName.focus();
}

saveRecurringBtn.addEventListener('click', async () => {
    if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });

    const name = recName.value.trim();
    const kind = recurringType;
    const amount = parseFloat(recAmount.value);
    const date = recDate.value;
    if (!name) {
        recName.focus();
        return showModal({ type: 'warning', title: 'Name required', message: kind === 'income' ? 'Enter the income source, such as Salary.' : 'Name this recurring expense, such as Electricity or Netflix.' });
    }
    if (isNaN(amount) || amount <= 0) {
        recAmount.focus();
        return showModal({ type: 'warning', title: 'Invalid amount', message: 'Please enter a valid amount greater than 0.' });
    }
    if (!date) {
        return showModal({ type: 'warning', title: 'Date required', message: 'Please choose the first due date.' });
    }

    setBusy(saveRecurringBtn, true, 'Saving...');
    try {
        const fields = kind === 'income'
            ? { source: name, amount, frequency: recFreqValue, next_due: date }
            : { name, amount, category: recCategoryValue, payment: recPaymentValue, frequency: recFreqValue, next_due: date };
        if (editingRecurringId) {
            const old = (kind === 'income' ? recurringIncomes : recurring).find(r => r.id === editingRecurringId);
            if (!old || old.next_due !== date) fields.start_date = date; // new date re-anchors the schedule
            if (kind === 'income') await updateRecurringIncomeRecord(editingRecurringId, fields);
            else await updateRecurringRecord(editingRecurringId, fields);
        } else {
            const { data, error } = await supabaseClient.from(kind === 'income' ? 'recurring_incomes' : 'recurring_expenses')
                .insert([{ ...fields, start_date: date, user_id: currentUser.id }]).select();
            if (error) throw error;
            if (data && data.length) (kind === 'income' ? recurringIncomes : recurring).push(data[0]);
            (kind === 'income' ? recurringIncomes : recurring).sort((a, b) => a.next_due.localeCompare(b.next_due));
        }
        const wasEditing = !!editingRecurringId;
        cancelRecurringEdit();
        // A date of today (or earlier) is posted right away
        const added = await processRecurring({ silent: true });
        renderRecurring();
        updateDashboard();
        showToast('success', (wasEditing ? 'Recurring updated' : 'Recurring saved') + (added ? ': ' + added + ' transaction(s) posted' : ''));
    } catch (err) {
        console.error('Save recurring error:', err);
        showModal({
            type: 'error',
            title: `Couldn't save recurring ${kind}`,
            message: kind === 'income' && recurringIncomeLoadError
                ? 'Run supabase-schema.sql in Supabase, then reload.'
                : (recurringLoadError && kind === 'expense'
                    ? 'Run supabase-schema.sql in Supabase, then reload.'
                    : (err.message || 'Please try again.'))
        });
    } finally {
        setBusy(saveRecurringBtn, false);
    }
});
cancelRecurringBtn.addEventListener('click', cancelRecurringEdit);
[recName, recAmount].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRecurringBtn.click(); }));

// ---- List ----
function renderRecurring() {
    const activeExpenses = recurring.filter(item => item.active);
    const activeIncomes = recurringIncomes.filter(item => item.active);
    const expenseMonthly = activeExpenses.reduce((sum, item) => sum + monthlyEquivalent(item), 0);
    const incomeMonthly = activeIncomes.reduce((sum, item) => sum + monthlyEquivalent(item), 0);
    const allItems = [
        ...recurring.map(item => ({ ...item, kind: 'expense', title: item.name })),
        ...recurringIncomes.map(item => ({ ...item, kind: 'income', title: item.source }))
    ].sort((a, b) => a.next_due.localeCompare(b.next_due));
    const active = [...activeExpenses, ...activeIncomes];
    const monthly = expenseMonthly + incomeMonthly;

    if (recurringLoadError) {
        recurringSummary.innerHTML = '<div class="recurring-warn"><i class="fas fa-triangle-exclamation"></i> Recurring expenses aren\'t set up in your database yet. Run <b>supabase-schema.sql</b> in the Supabase SQL Editor, then reload.</div>';
    } else if (recurring.length || recurringIncomes.length) {
        recurringSummary.innerHTML = `<span><b>${active.length}</b> active</span>
            <span>≈ <b>${formatMoney(monthly)}</b> / month</span>
            <span>≈ <b>${formatMoney(monthly * 12)}</b> / year</span>`;
    } else {
        recurringSummary.innerHTML = '';
    }
    if (recurringIncomeLoadError) {
        recurringSummary.insertAdjacentHTML('afterbegin', '<div class="recurring-warn"><i class="fas fa-circle-info" aria-hidden="true"></i> Run supabase-schema.sql to enable recurring income.</div>');
    }

    if (!allItems.length) {
        recurringList.innerHTML = '<div class="history-empty"><i class="fas fa-repeat" aria-hidden="true"></i><div>No recurring items yet.<br>Add a regular bill or income above.</div></div>';
        return;
    }

    recurringList.innerHTML = allItems.map(item => {
        const isIncome = item.kind === 'income';
        const category = isIncome ? null : catByKey[item.category];
        const itemTitle = item.title || 'Recurring item';
        const color = category ? `style="--cat-color:${safeColor(category.color)}"` : '';
        const when = item.active ? `Next: ${formatDueLabel(item.next_due)} · ${dueLabel(item.next_due)}` : 'Paused';
        return `<div class="history-item recurring-item ${item.active ? '' : 'paused'}" data-id="${escapeHtml(item.id)}" data-kind="${item.kind}">
            <div class="h-icon ${item.kind}" ${color}><i class="fas ${isIncome ? 'fa-arrow-trend-up' : safeIcon(category?.icon || 'fa-repeat')}" aria-hidden="true"></i></div>
            <div class="h-left"><div class="h-title">${escapeHtml(itemTitle)}</div><div class="h-detail">${isIncome ? 'Income' : escapeHtml(category?.label || item.category)} · ${FREQ_LABEL[item.frequency] || item.frequency} · ${escapeHtml(when)}</div></div>
            <div class="h-right"><div class="h-amount ${item.kind}">${isIncome ? '+' : '−'} ${formatMoney(item.amount)}</div></div>
            <div class="h-actions">
                <button type="button" class="icon-btn" data-action="toggle" aria-label="${item.active ? 'Pause' : 'Resume'} ${escapeHtml(itemTitle)}"><i class="fas ${item.active ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i></button>
                <button type="button" class="icon-btn" data-action="edit" aria-label="Edit ${escapeHtml(itemTitle)}"><i class="fas fa-pen" aria-hidden="true"></i></button>
                <button type="button" class="icon-btn danger" data-action="delete" aria-label="Delete ${escapeHtml(itemTitle)}"><i class="fas fa-trash-can" aria-hidden="true"></i></button>
            </div>
        </div>`;
    }).join('');
}

recurringList.addEventListener('click', async (e) => {
    const row = e.target.closest('.recurring-item');
    if (!row) return;
    const id = row.dataset.id;
    const kind = row.dataset.kind || 'expense';
    const list = kind === 'income' ? recurringIncomes : recurring;
    const r = list.find(x => x.id === id);
    if (!r) return;
    const action = e.target.closest('[data-action]')?.dataset.action || 'edit';

    if (action === 'edit') return startRecurringEdit(id, kind);

    if (action === 'toggle') {
        try {
            const fields = { active: !r.active };
            if (!r.active) {
                // Resuming: skip the dates missed while paused instead of back-filling them
                let due = r.next_due;
                const anchor = parseYMD(r.start_date).d;
                const today = toInputDate();
                let guard = 0;
                while (due < today && guard++ < 1000) due = advanceDue(due, r.frequency, anchor);
                fields.next_due = due;
            }
            if (kind === 'income') await updateRecurringIncomeRecord(id, fields);
            else await updateRecurringRecord(id, fields);
            renderRecurring();
            updateDashboard();
            await processRecurring();
            showToast('success', fields.active ? 'Resumed' : 'Paused');
        } catch (err) {
            console.error('Toggle recurring error:', err);
            showModal({ type: 'error', title: 'Couldn\'t update', message: err.message || 'Please try again.' });
        }
        return;
    }

    if (action === 'delete') {
        showModal({
            type: 'warning',
            title: 'Delete recurring item?',
            message: `"${kind === 'income' ? r.source : r.name}" will stop posting automatically. Transactions it already added are kept.`,
            confirmText: 'Delete',
            cancelText: 'Keep it',
            danger: true,
            onConfirm: async () => {
                try {
                    const { data, error } = await supabaseClient.from(kind === 'income' ? 'recurring_incomes' : 'recurring_expenses').delete().eq('id', id).select();
                    if (error) throw error;
                    if (!data || !data.length) throw new Error('That item could not be deleted.');
                    if (kind === 'income') recurringIncomes = recurringIncomes.filter(x => x.id !== id);
                    else recurring = recurring.filter(x => x.id !== id);
                    if (editingRecurringId === id) cancelRecurringEdit();
                    renderRecurring();
                    updateDashboard();
                    showToast('success', 'Recurring item deleted');
                } catch (err) {
                    console.error('Delete recurring error:', err);
                    showModal({ type: 'error', title: 'Couldn\'t delete', message: err.message || 'Please try again.' });
                }
            }
        });
    }
});

// ---- Dashboard "Upcoming" card ----
function renderUpcoming() {
    const next = [
        ...recurring.filter(item => item.active).map(item => ({ ...item, kind: 'expense', title: item.name })),
        ...recurringIncomes.filter(item => item.active).map(item => ({ ...item, kind: 'income', title: item.source }))
    ].sort((a, b) => a.next_due.localeCompare(b.next_due)).slice(0, 3);
    if (!next.length) {
        upcomingList.innerHTML = '<div class="history-empty small">No recurring bills yet — add your utilities and subscriptions.</div>';
        return;
    }
    upcomingList.innerHTML = next.map(item => {
        const isIncome = item.kind === 'income';
        const category = isIncome ? null : catByKey[item.category];
        const soon = daysUntil(item.next_due) <= 3;
        return `<div class="history-item" data-id="${escapeHtml(item.id)}" data-kind="${item.kind}">
            <div class="h-icon ${item.kind}" ${category ? `style="--cat-color:${safeColor(category.color)}"` : ''}><i class="fas ${isIncome ? 'fa-arrow-trend-up' : safeIcon(category?.icon || 'fa-repeat')}" aria-hidden="true"></i></div>
            <div class="h-left"><div class="h-title">${escapeHtml(item.title)}</div><div class="h-detail"><span class="${soon ? 'due-soon' : ''}">${dueLabel(item.next_due)}</span> · ${formatDueLabel(item.next_due)}</div></div>
            <div class="h-right"><div class="h-amount ${item.kind}">${isIncome ? '+' : '−'} ${formatMoney(item.amount)}</div></div>
        </div>`;
    }).join('');
}
$('manageRecurringBtn').addEventListener('click', () => navigate('recurring'));
upcomingList.addEventListener('click', (e) => {
    const row = e.target.closest('.history-item');
    if (!row) return navigate('recurring');
    navigate('recurring');
    startRecurringEdit(row.dataset.id, row.dataset.kind || 'expense');
});

// Catch bills that fell due while the app sat in the background (e.g. an installed PWA left open overnight)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser) processRecurring();
});

cancelRecurringEdit(); // sets the form defaults and renders the chips

// === BUDGETS ===
// Monthly limits per category plus an overall limit (stored under the category key 'all').
const budgetSheet = $('budgetSheet');
const budgetFields = $('budgetFields');
const saveBudgetsBtn = $('saveBudgetsBtn');

function budgetFor(key) {
    const b = budgets.find(x => x.category === key);
    return b ? parseFloat(b.amount) : 0;
}

function spendIn(ref, cat) {
    return sumAmount(expenses.filter(e => isSameMonth(e.created_at, ref) && (!cat || e.category === cat)));
}

// What you can still spend per day without breaking the overall budget (current month only)
function renderSafeToSpend(spent, overall, isCurrent, isFuture) {
    const el = $('safeToSpend');
    if (!overall) {
        el.innerHTML = '<button type="button" class="hero-cta" data-action="budget"><i class="fas fa-bullseye"></i> Set a monthly budget to see what\'s safe to spend each day</button>';
        return;
    }
    if (!isCurrent || isFuture) { el.innerHTML = ''; return; }

    const now = new Date();
    const daysLeft = daysInMonth(now.getFullYear(), now.getMonth() + 1) - now.getDate() + 1; // today counts
    const remaining = overall - spent;
    el.innerHTML = remaining > 0
        ? `<div class="safe-card">
               <div><div class="safe-label">Safe to spend today</div><div class="safe-value">${formatMoney(remaining / daysLeft)}</div></div>
               <div class="safe-sub">${formatMoney(remaining)} left for ${daysLeft} day${daysLeft === 1 ? '' : 's'}</div>
           </div>`
        : `<div class="safe-card bad">
               <div><div class="safe-label">Budget used up</div><div class="safe-value">${formatMoney(spent - overall)} over</div></div>
               <div class="safe-sub">Hold off on extras until next month</div>
           </div>`;
}

$('safeToSpend').addEventListener('click', (e) => { if (e.target.closest('[data-action="budget"]')) openBudgetSheet(); });
$('budgetBtn').addEventListener('click', openBudgetSheet);

function renderBudgetFields() {
    const budgetCategories = CATEGORIES.filter(category => category.active !== false || budgetFor(category.key) > 0);
    const rows = [{ key: 'all', label: 'Overall budget', icon: 'fa-bullseye', color: 'var(--primary)' }, ...budgetCategories];
    budgetFields.innerHTML = rows.map(c => `
        <label class="budget-row${c.key === 'all' ? ' overall' : ''}" style="--cat-color:${safeColor(c.color)}">
            <span class="cat-ico"><i class="fas ${safeIcon(c.icon)}" aria-hidden="true"></i></span>
            <span class="budget-name">${escapeHtml(c.label)}${c.active === false ? ' (inactive)' : ''}</span>
            <span class="budget-input"><span>RM</span>
                <input type="number" data-cat="${escapeHtml(c.key)}" min="0" step="1" inputmode="decimal" placeholder="No limit" value="${budgetFor(c.key) || ''}" aria-label="${escapeHtml(c.label)} budget in RM" />
            </span>
        </label>`).join('');
}

function openBudgetSheet() {
    if (!currentUser) return;
    renderBudgetFields();
    $('budgetWarn').classList.toggle('hidden', !budgetsLoadError);
    budgetSheet.classList.add('active');
    syncBodyScroll();
}

function closeBudgetSheet() {
    budgetSheet.classList.remove('active');
    syncBodyScroll();
}

$('budgetSheetClose').addEventListener('click', closeBudgetSheet);
budgetSheet.addEventListener('click', (e) => { if (e.target === budgetSheet) closeBudgetSheet(); });
budgetFields.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBudgetsBtn.click(); });

saveBudgetsBtn.addEventListener('click', async () => {
    const upserts = [];
    const removeIds = [];
    budgetFields.querySelectorAll('input').forEach(inp => {
        const key = inp.dataset.cat;
        const val = parseFloat(inp.value);
        const existing = budgets.find(b => b.category === key);
        if (!isNaN(val) && val > 0) {
            if (!existing || parseFloat(existing.amount) !== val) upserts.push({ user_id: currentUser.id, category: key, amount: val });
        } else if (existing) {
            removeIds.push(existing.id);
        }
    });
    if (!upserts.length && !removeIds.length) {
        closeBudgetSheet();
        return showToast('info', 'No changes to save');
    }

    setBusy(saveBudgetsBtn, true, 'Saving...');
    try {
        requireOnline('Saving budgets');
        if (upserts.length) {
            const { data, error } = await supabaseClient.from('budgets').upsert(upserts, { onConflict: 'user_id,category' }).select();
            if (error) throw error;
            (data || []).forEach(row => {
                const i = budgets.findIndex(b => b.category === row.category);
                if (i >= 0) budgets[i] = row; else budgets.push(row);
            });
        }
        if (removeIds.length) {
            const { error } = await supabaseClient.from('budgets').delete().in('id', removeIds);
            if (error) throw error;
            budgets = budgets.filter(b => !removeIds.includes(b.id));
        }
        closeBudgetSheet();
        updateDashboard();
        showToast('success', 'Budgets saved');
    } catch (err) {
        console.error('Save budgets error:', err);
        showModal({
            type: 'error',
            title: 'Couldn\'t save budgets',
            message: budgetsLoadError
                ? 'The budgets table isn\'t set up yet. Run supabase-schema.sql in Supabase, then reload.'
                : (err.message || 'Please try again.')
        });
    } finally {
        setBusy(saveBudgetsBtn, false);
    }
});

// After saving an expense: warn when it pushes a category (or the overall budget) past 80% / 100%
function checkBudgetAlerts(category, amount, createdAt) {
    const ref = new Date(createdAt);
    [{ key: category, name: `your ${(catByKey[category] || {}).label || category} budget` },
     { key: 'all', name: 'your overall monthly budget' }].forEach(c => {
        const limit = budgetFor(c.key);
        if (!limit) return;
        const after = spendIn(ref, c.key === 'all' ? null : c.key);
        const before = after - amount;
        if (before < limit && after >= limit) {
            showToast('error', `You've gone over ${c.name}`, { duration: 4500 });
        } else if (before < limit * 0.8 && after >= limit * 0.8) {
            showToast('info', `You've used ${Math.round((after / limit) * 100)}% of ${c.name}`, { duration: 4500 });
        }
    });
}

// === FORGOT PASSWORD ===
const resetSheet = $('resetSheet');
const resetEmail = $('resetEmail');
const resetSendBtn = $('resetSendBtn');

function openResetSheet() {
    resetEmail.value = emailInput.value.trim();
    resetSheet.classList.add('active');
    syncBodyScroll();
    setTimeout(() => resetEmail.focus(), 60);
}

function closeResetSheet() {
    resetSheet.classList.remove('active');
    syncBodyScroll();
}

$('forgotBtn').addEventListener('click', openResetSheet);
$('resetSheetClose').addEventListener('click', closeResetSheet);
resetSheet.addEventListener('click', (e) => { if (e.target === resetSheet) closeResetSheet(); });
resetEmail.addEventListener('keydown', (e) => { if (e.key === 'Enter') resetSendBtn.click(); });

resetSendBtn.addEventListener('click', async () => {
    if (!supabaseClient) return showModal({ type: 'error', ...backendUnavailable() });
    const email = resetEmail.value.trim();
    if (!email || !email.includes('@')) {
        resetEmail.focus();
        return showModal({ type: 'warning', title: 'Check your email', message: 'Please enter the email you signed up with.' });
    }
    setBusy(resetSendBtn, true, 'Sending...');
    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
        closeResetSheet();
        // Same message whether or not the address has an account, so this can't be used to probe for accounts
        showModal({
            type: 'success',
            title: 'Check your inbox',
            message: `If an account exists for ${email}, a link to reset your password is on its way. It may take a minute — check your spam folder too.`
        });
    } catch (err) {
        console.error('Reset password error:', err);
        showModal({
            type: 'error',
            title: 'Couldn\'t send the link',
            message: /rate|too many|seconds/i.test(err.message || '')
                ? 'Too many requests. Please wait a minute and try again.'
                : (isNetworkError(err) ? 'You appear to be offline. Please check your connection.' : (err.message || 'Please try again.'))
        });
    } finally {
        setBusy(resetSendBtn, false);
    }
});

// The page the emailed link opens: choose a new password
$('newPasswordBtn').addEventListener('click', async () => {
    const pw = $('newPassword').value.trim();
    const confirm = $('newPasswordConfirm').value.trim();
    if (pw.length < 6) {
        return showModal({ type: 'warning', title: 'Weak password', message: 'Password must be at least 6 characters.' });
    }
    if (pw !== confirm) {
        return showModal({ type: 'warning', title: 'Passwords don\'t match', message: 'Please make sure both password fields match.' });
    }
    setBusy($('newPasswordBtn'), true, 'Updating...');
    try {
        const { data, error } = await supabaseClient.auth.updateUser({ password: pw });
        if (error) throw error;
        recoveryMode = false;
        history.replaceState(null, '', window.location.pathname);
        showToast('success', 'Password updated — you\'re signed in');
        await onLoginSuccess(data.user);
    } catch (err) {
        console.error('Update password error:', err);
        showModal({ type: 'error', title: 'Couldn\'t update password', message: err.message || 'The link may have expired. Request a new one from the sign-in page.' });
    } finally {
        setBusy($('newPasswordBtn'), false);
    }
});
$('newPasswordCancel').addEventListener('click', async () => {
    recoveryMode = false;
    history.replaceState(null, '', window.location.pathname);
    await supabaseClient.auth.signOut();
    currentUser = null;
    switchAuthTab('login');
    showScreen('authScreen');
});
[$('newPassword'), $('newPasswordConfirm')].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('newPasswordBtn').click(); }));

// === INIT ===
(async function init() {
    selectedMonthDisplay.textContent = formatMonthDisplay(selectedDate);
    monthPicker.value = formatMonthValue(selectedDate);

    if (!supabaseClient) {
        showModal({ type: 'error', ...backendUnavailable() });
        return;
    }

    if (hashError) {
        history.replaceState(null, '', window.location.pathname);
        showModal({ type: 'error', title: 'Link problem', message: hashError.replace(/\+/g, ' ') + ' Try signing in, or resend the verification email.' });
    }

    if (cameFromEmailConfirmation || recoveryMode) return; // handled by the auth listener

    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (session?.user && !currentUser) await onLoginSuccess(session.user);
    } catch (err) {
        console.error('Init error:', err);
    }
})();

// === PWA ===
// An installed iPhone app is suspended and resumed rather than reloaded, so it can sit on an old
// version for days. Look for a new version every time the app comes back to the foreground, and
// offer a one-tap reload once a new service worker has taken over.
if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller; // false on the very first visit: nothing to refresh
    let updatePrompted = false;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then((reg) => {
            const check = () => reg.update().catch(() => {});
            document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
            setInterval(check, 30 * 60 * 1000);
        }).catch(() => {});
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || updatePrompted) return;
        updatePrompted = true;
        showToast('info', 'A new version is ready', { actionLabel: 'Reload', onAction: () => location.reload(), duration: 20000 });
    });
}

// Shows which build the JS and the stylesheet are from. If they differ, the phone is running a mix of old and new files.
function renderBuildInfo() {
    const el = $('buildInfo');
    if (!el) return;
    const label = (v) => (!v || v === BUILD_PLACEHOLDER) ? 'dev' : v;
    const css = label((getComputedStyle(document.documentElement).getPropertyValue('--build') || '').replace(/["'\s]/g, ''));
    const app = label(APP_BUILD);
    el.textContent = app === css
        ? `Version ${app}`
        : `App ${app} · Styles ${css} — close and reopen the app to finish updating`;
}
