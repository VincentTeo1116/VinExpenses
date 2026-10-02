// === SUPABASE CONFIG ===
// Values come from .env via build-config.js, which generates config.js (window.APP_CONFIG).
const APP_CONFIG = window.APP_CONFIG || {};
const SUPABASE_URL = APP_CONFIG.SUPABASE_URL;
const SUPABASE_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY;
const configMissing = !SUPABASE_URL || !SUPABASE_ANON_KEY;

const cameFromEmailConfirmation = window.location.hash.includes('type=signup');
const hashError = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error_description');
const supabaseClient = (window.supabase && !configMissing) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Explains why the backend isn't available (missing config vs. library failed to load)
function backendUnavailable() {
    return configMissing
        ? { title: 'App not configured', message: 'config.js is missing. Create a .env file (see .env.example) and run "node build-config.js", then reload.' }
        : { title: 'Can\'t reach the server', message: 'The sign-in library failed to load. Check your internet connection and reload.' };
}

// === CONFIG ===
const CATEGORIES = [
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
const PAYMENTS = [
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
const catByKey = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
const payByKey = Object.fromEntries(PAYMENTS.map(p => [p.key, p]));
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
let recurring = [];
let recurringLoadError = false;
let recCategoryValue = 'utilities';
let recPaymentValue = 'bank';
let recFreqValue = 'monthly';
let editingRecurringId = null;

let selectedDate = new Date();
selectedDate.setDate(1);
selectedDate.setHours(0, 0, 0, 0);

// === DOM REFS ===
const $ = id => document.getElementById(id);
const topNav = document.querySelector('.top-nav');

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
const expNoteLabel = $('expNoteLabel');
const saveExpenseBtn = $('saveExpenseBtn');
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
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function formatMonthValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function toInputDate(value) {
    const d = value ? new Date(value) : new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    const anyOpen = modalOverlay.classList.contains('active') || editModal.classList.contains('active');
    document.body.style.overflow = anyOpen ? 'hidden' : '';
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
function showToast(type, message) {
    const host = $('toastHost');
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span></span>`;
    el.querySelector('span').textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, 2600);
}

// Escape closes whichever dialog is open
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (editModal.classList.contains('active')) closeEditModal();
    else if (dismissModal) dismissModal();
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
    expense: 'expenseScreen',
    income: 'incomeScreen',
    recurring: 'recurringScreen',
    history: 'historyScreen'
};

function setActiveNav(screen) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = $(screenId);
    if (target) target.classList.add('active');

    const isAuthLike = screenId === 'authScreen' || screenId === 'setupScreen';
    topNav.classList.toggle('hidden-nav', isAuthLike);

    if (screenId === 'dashboardScreen') updateDashboard();
    if (screenId === 'historyScreen') renderHistory();
    if (screenId === 'recurringScreen') renderRecurring();
    if (screenId === 'expenseScreen' && !expDate.value) expDate.value = toInputDate();
    if (screenId === 'incomeScreen' && !incomeDate.value) incomeDate.value = toInputDate();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

function navigate(nav) {
    setActiveNav(nav);
    showScreen(SCREEN_BY_NAV[nav]);
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.screen));
});

// === DASHBOARD ===
function renderCategoryGrid() {
    const totals = CATEGORIES.map(c => getCategoryTotal(c.key));
    const grand = totals.reduce((a, b) => a + b, 0);
    categoryGrid.innerHTML = CATEGORIES.map((c, i) => {
        const pct = grand > 0 ? (totals[i] / grand) * 100 : 0;
        return `
            <button type="button" class="category-item" data-cat="${c.key}" style="--cat-color:${c.color}">
                <i class="fas ${c.icon}"></i>
                <div class="info">
                    <div class="cat">${c.label}<span class="pct">${pct.toFixed(0)}%</span></div>
                    <div class="val">${formatMoney(totals[i])}</div>
                    <div class="bar"><span style="width:${pct}%"></span></div>
                </div>
            </button>`;
    }).join('');
}

function transactionRowHtml(t, withActions) {
    const isIncome = t.type === 'income';
    const cat = catByKey[t.category];
    const icon = isIncome ? 'fa-arrow-trend-up' : (cat ? cat.icon : 'fa-receipt');
    const baseTitle = isIncome ? (t.source || 'Salary') : (cat ? cat.label : t.category);
    // For expenses, a note (e.g. what "Other" was) is shown next to the category
    const title = !isIncome && t.note ? `${baseTitle} — ${t.note}` : baseTitle;
    const pay = payByKey[t.payment];
    const date = new Date(t.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
    const detail = isIncome ? `Income • ${date}` : `${pay ? pay.label : 'N/A'} • ${date}`;
    const color = !isIncome && cat ? `style="--cat-color:${cat.color}"` : '';
    return `
        <div class="history-item" data-id="${escapeHtml(t.id)}" data-type="${t.type}">
            <div class="h-icon ${isIncome ? 'income' : 'expense'}" ${color}><i class="fas ${icon}"></i></div>
            <div class="h-left">
                <div class="h-title">${escapeHtml(title)}</div>
                <div class="h-detail">${escapeHtml(detail)}</div>
            </div>
            <div class="h-right">
                <div class="h-amount ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '−'} ${formatMoney(t.amount)}</div>
                ${withActions ? `
                <div class="h-actions">
                    <button type="button" class="icon-btn" data-action="edit" title="Edit" aria-label="Edit"><i class="fas fa-pen"></i></button>
                    <button type="button" class="icon-btn danger" data-action="delete" title="Delete" aria-label="Delete"><i class="fas fa-trash-can"></i></button>
                </div>` : ''}
            </div>
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
        : '<div class="history-empty">Nothing here yet — add your first expense!</div>';
}

function updateDashboard() {
    if (!currentUser) return;

    selectedMonthDisplay.textContent = formatMonthDisplay(selectedDate);
    monthPicker.value = formatMonthValue(selectedDate);

    const spent = getTotalSpent();
    const income = getTotalIncome();
    const balance = income - spent;
    animateAmount(totalSpent, spent);
    animateAmount(totalIncomeDisplay, income);
    animateAmount(totalBalance, balance);
    balancePill.classList.toggle('negative', balance < 0);
    totalCard.classList.toggle('loading', isLoading);

    renderCategoryGrid();
    renderRecent();
    renderUpcoming();

    const meta = currentUser.user_metadata || {};
    userNameDisplay.textContent = meta.username || meta.full_name || currentUser.email?.split('@')[0] || 'User';

    if ($('dashboardScreen').classList.contains('active')) renderCharts();
}

categoryGrid.addEventListener('click', (e) => {
    const tile = e.target.closest('.category-item');
    if (tile) openHistoryFiltered({ type: 'expense', category: tile.dataset.cat, month: formatMonthValue(selectedDate) });
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
        months.push(d.toLocaleString('default', { month: 'short' }));
        expensesData.push(sumAmount(expenses.filter(e => isSameMonth(e.created_at, d))));
        incomesData.push(sumAmount(incomes.filter(n => isSameMonth(n.created_at, d))));
    }
    return { months, expensesData, incomesData };
}

// Chart.js colours are set in JS, so they follow the system theme here
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyChartTheme() {
    if (!window.Chart) return;
    Chart.defaults.color = darkQuery.matches ? '#94a3b8' : '#666';
    Chart.defaults.borderColor = darkQuery.matches ? 'rgba(148, 163, 184, 0.15)' : 'rgba(0, 0, 0, 0.1)';
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

    // Pie
    const totals = CATEGORIES.map(c => getCategoryTotal(c.key));
    const hasData = totals.some(v => v > 0);
    const pieData = {
        labels: hasData ? CATEGORIES.map(c => c.label) : ['No data'],
        datasets: [{
            data: hasData ? totals : [1],
            backgroundColor: hasData ? CATEGORIES.map(c => c.color) : ['#d1d5db'],
            borderWidth: 2,
            borderColor: darkQuery.matches ? '#1e293b' : 'white'
        }]
    };
    if (pieChartInstance) {
        pieChartInstance.data = pieData;
        pieChartInstance.update();
    } else {
        pieChartInstance = new Chart(pieCanvas.getContext('2d'), {
            type: 'pie',
            data: pieData,
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
                    tooltip: { callbacks: { label: (ctx) => ctx.label === 'No data' ? 'No data yet' : formatMoney(ctx.parsed) } }
                },
                onHover: (evt, els) => { evt.native.target.style.cursor = els.length && els[0].element ? 'pointer' : 'default'; },
                onClick: (evt, els) => {
                    if (!els.length) return;
                    const cat = CATEGORIES[els[0].index];
                    if (cat && pieChartInstance.data.labels[0] !== 'No data') {
                        openHistoryFiltered({ type: 'expense', category: cat.key, month: formatMonthValue(selectedDate) });
                    }
                }
            }
        });
    }

    // Bar
    const { months, expensesData, incomesData } = getMonthlyTotals();
    const barData = {
        labels: months,
        datasets: [
            { label: 'Expenses', data: expensesData, backgroundColor: 'rgba(79, 70, 229, 0.7)', borderColor: '#4f46e5', borderWidth: 2, borderRadius: 6 },
            { label: 'Income', data: incomesData, backgroundColor: 'rgba(16, 185, 129, 0.7)', borderColor: '#10b981', borderWidth: 2, borderRadius: 6 }
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
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } }
                },
                scales: { y: { beginAtZero: true, ticks: { callback: (val) => 'RM ' + val } } },
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
async function fetchAllData() {
    isLoading = true;
    updateDashboard();
    try {
        const [{ data: expData, error: expErr }, { data: incData, error: incErr }, { data: recData, error: recErr }] = await Promise.all([
            supabaseClient.from('expenses').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('incomes').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('recurring_expenses').select('*').order('next_due', { ascending: true })
        ]);

        // Recurring is optional: if its table isn't created yet, the rest of the app still works
        recurringLoadError = !!recErr;
        if (recErr) console.warn('Recurring expenses unavailable (run migration-add-recurring.sql):', recErr);
        recurring = recData || [];

        if (expErr) console.error('Error fetching expenses:', expErr);
        if (incErr) console.error('Error fetching incomes:', incErr);
        if (expErr || incErr) showToast('error', 'Could not load all your data. Pull to refresh or try again.');

        expenses = expData || [];
        incomes = incData || [];
        await processRecurring();
    } catch (err) {
        console.error('Fetch data error:', err);
        showToast('error', 'Network problem while loading your data.');
    } finally {
        isLoading = false;
        updateDashboard();
        if ($('historyScreen').classList.contains('active')) renderHistory();
    }
}

async function addExpense(amount, category, payment, createdAt, note) {
    const row = { user_id: currentUser.id, amount, category, payment, created_at: createdAt };
    if (note) row.note = note; // only sent when used, so a missing `note` column only matters for noted expenses
    const { data, error } = await supabaseClient
        .from('expenses')
        .insert([row])
        .select();
    if (error) throw error;
    if (data && data.length > 0) { expenses.push(data[0]); expenses.sort(byDateDesc); }
}

async function addIncome(amount, source, createdAt) {
    const { data, error } = await supabaseClient
        .from('incomes')
        .insert([{ user_id: currentUser.id, amount, source, created_at: createdAt }])
        .select();
    if (error) throw error;
    if (data && data.length > 0) { incomes.push(data[0]); incomes.sort(byDateDesc); }
}

async function updateRecord(type, id, fields) {
    const table = type === 'income' ? 'incomes' : 'expenses';
    const { data, error } = await supabaseClient.from(table).update(fields).eq('id', id).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('That entry could not be updated.');
    const list = type === 'income' ? incomes : expenses;
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx] = data[0];
    list.sort(byDateDesc);
}

async function deleteRecord(type, id) {
    const table = type === 'income' ? 'incomes' : 'expenses';
    const { data, error } = await supabaseClient.from(table).delete().eq('id', id).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('That entry could not be deleted.');
    if (type === 'income') incomes = incomes.filter(r => r.id !== id);
    else expenses = expenses.filter(r => r.id !== id);
}

// === CHIP SELECTORS ===
function renderChips(container, items, selectedKey) {
    container.innerHTML = items.map(i => `
        <button type="button" class="chip ${i.key === selectedKey ? 'active' : ''}" data-key="${escapeHtml(i.key)}"
                style="--chip-color:${i.color || 'var(--primary)'}" aria-pressed="${i.key === selectedKey}">
            <i class="fas ${i.icon}"></i><span>${i.label}</span>
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
    renderChips($('expCategoryChips'), CATEGORIES, expCategoryValue);
    renderChips($('expPaymentChips'), PAYMENTS, expPaymentValue);
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
        message: 'You can always sign back in with your email and password.',
        confirmText: 'Log out',
        cancelText: 'Stay',
        danger: true,
        onConfirm: async () => {
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
    cancelRecurringEdit();
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
    if (expCategoryValue === 'other' && !note) {
        expNote.focus();
        return showModal({ type: 'warning', title: 'Please specify', message: 'Tell us what this "Other" expense was for.' });
    }
    const createdAt = dateInputToISO(expDate.value);

    setBusy(saveExpenseBtn, true, 'Saving...');
    try {
        await addExpense(amount, expCategoryValue, expPaymentValue, createdAt, note);
        expAmount.value = '';
        expNote.value = '';
        expDate.value = toInputDate();
        const saved = new Date(createdAt);
        setSelectedMonth(saved.getFullYear(), saved.getMonth());
        navigate('dashboard');
        showToast('success', `Expense of ${formatMoney(amount)} saved`);
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
        await addIncome(amount, source, createdAt);
        incomeAmount.value = '';
        incomeSource.value = '';
        incomeDate.value = toInputDate();
        syncIncomeChips();
        const saved = new Date(createdAt);
        setSelectedMonth(saved.getFullYear(), saved.getMonth());
        navigate('dashboard');
        showToast('success', `Income of ${formatMoney(amount)} saved`);
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
        items.map(i => `<option value="${i.key}">${i.label}</option>`).join('');
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

    const type = historyTypeFilter.value;
    const category = historyCategoryFilter.value;
    const month = historyMonthFilter.value;
    const query = historySearch.value.trim().toLowerCase();

    // A category only makes sense for expenses
    historyCategoryFilter.disabled = type === 'income';

    let list = allTransactions();
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
                : `${catByKey[t.category]?.label || t.category} ${t.note || ''} ${payByKey[t.payment]?.label || t.payment} expense`;
            return hay.toLowerCase().includes(query);
        });
    }

    const inc = sumAmount(list.filter(t => t.type === 'income'));
    const exp = sumAmount(list.filter(t => t.type === 'expense'));
    historySummary.innerHTML = list.length
        ? `<span><b>${list.length}</b> transaction${list.length === 1 ? '' : 's'}</span>
           <span class="income">+ ${formatMoney(inc)}</span>
           <span class="expense">− ${formatMoney(exp)}</span>`
        : '';

    historyList.innerHTML = list.length
        ? list.map(t => transactionRowHtml(t, true)).join('')
        : '<div class="history-empty"><i class="fas fa-inbox"></i><div>No transactions found for this filter.</div></div>';
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

historyList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    const row = e.target.closest('.history-item');
    if (!row) return;
    const { id, type } = row.dataset;
    if (btn && btn.dataset.action === 'delete') confirmDelete(type, id);
    else openEditModal(type, id); // clicking the row or the pen opens the editor
});

recentList.addEventListener('click', (e) => {
    const row = e.target.closest('.history-item');
    if (row) openEditModal(row.dataset.type, row.dataset.id);
});

function confirmDelete(type, id) {
    const rec = (type === 'income' ? incomes : expenses).find(r => r.id === id);
    if (!rec) return;
    showModal({
        type: 'warning',
        title: 'Delete this entry?',
        message: `${type === 'income' ? 'Income' : 'Expense'} of ${formatMoney(rec.amount)} will be removed permanently.`,
        confirmText: 'Delete',
        cancelText: 'Keep it',
        danger: true,
        onConfirm: async () => {
            try {
                await deleteRecord(type, id);
                updateDashboard();
                renderHistory();
                showToast('success', 'Entry deleted');
            } catch (err) {
                console.error('Delete error:', err);
                showModal({ type: 'error', title: 'Couldn\'t delete', message: err.message || 'Please try again.' });
            }
        }
    });
}

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
    const { y, m, d } = parseYMD(dateStr);
    return new Date(y, m - 1, d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
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

// Adds an expense for every due date up to today. Returns how many expenses were added.
async function processRecurring({ silent = false } = {}) {
    if (!currentUser || recurringLoadError || recurringBusy) return 0;
    const today = toInputDate();
    const dueItems = recurring.filter(r => r.active && r.next_due <= today);
    if (!dueItems.length) return 0;

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

    if (added) {
        expenses.sort(byDateDesc);
        recurring.sort((a, b) => a.next_due.localeCompare(b.next_due));
        updateDashboard();
        if ($('historyScreen').classList.contains('active')) renderHistory();
        if ($('recurringScreen').classList.contains('active')) renderRecurring();
        if (!silent) showToast('info', `${added} recurring expense${added === 1 ? '' : 's'} added`);
    }
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

// ---- Form ----
function renderRecurringChips() {
    renderChips($('recCategoryChips'), CATEGORIES, recCategoryValue);
    renderChips($('recPaymentChips'), PAYMENTS, recPaymentValue);
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
    recName.value = '';
    recAmount.value = '';
    recDate.value = toInputDate();
    recCategoryValue = 'utilities';
    recPaymentValue = 'bank';
    recFreqValue = 'monthly';
    recurringFormTitle.textContent = 'Add recurring expense';
    recDateLabel.textContent = 'First due date';
    saveRecurringBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save recurring';
    cancelRecurringBtn.classList.add('hidden');
    renderRecurringChips();
}

function startRecurringEdit(id) {
    const r = recurring.find(x => x.id === id);
    if (!r) return;
    editingRecurringId = id;
    recName.value = r.name;
    recAmount.value = parseFloat(r.amount);
    recDate.value = r.next_due;
    recCategoryValue = r.category;
    recPaymentValue = r.payment;
    recFreqValue = r.frequency;
    recurringFormTitle.textContent = 'Edit recurring expense';
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
    const amount = parseFloat(recAmount.value);
    const date = recDate.value;
    if (!name) {
        recName.focus();
        return showModal({ type: 'warning', title: 'Name required', message: 'What is this recurring expense? e.g. Electricity or Netflix.' });
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
        const fields = { name, amount, category: recCategoryValue, payment: recPaymentValue, frequency: recFreqValue, next_due: date };
        if (editingRecurringId) {
            const old = recurring.find(r => r.id === editingRecurringId);
            if (!old || old.next_due !== date) fields.start_date = date; // new date re-anchors the schedule
            await updateRecurringRecord(editingRecurringId, fields);
        } else {
            const { data, error } = await supabaseClient.from('recurring_expenses')
                .insert([{ ...fields, start_date: date, user_id: currentUser.id }]).select();
            if (error) throw error;
            if (data && data.length) recurring.push(data[0]);
            recurring.sort((a, b) => a.next_due.localeCompare(b.next_due));
        }
        const wasEditing = !!editingRecurringId;
        cancelRecurringEdit();
        // A date of today (or earlier) is posted right away
        const added = await processRecurring({ silent: true });
        renderRecurring();
        updateDashboard();
        showToast('success', (wasEditing ? 'Recurring updated' : 'Recurring saved') + (added ? ` — ${added} added to expenses` : ''));
    } catch (err) {
        console.error('Save recurring error:', err);
        showModal({
            type: 'error',
            title: 'Couldn\'t save recurring expense',
            message: recurringLoadError
                ? 'The recurring table isn\'t set up yet. Run migration-add-recurring.sql in Supabase, then reload.'
                : (err.message || 'Please try again.')
        });
    } finally {
        setBusy(saveRecurringBtn, false);
    }
});
cancelRecurringBtn.addEventListener('click', cancelRecurringEdit);
[recName, recAmount].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveRecurringBtn.click(); }));

// ---- List ----
function renderRecurring() {
    const active = recurring.filter(r => r.active);
    const monthly = active.reduce((s, r) => s + monthlyEquivalent(r), 0);

    if (recurringLoadError) {
        recurringSummary.innerHTML = '<div class="recurring-warn"><i class="fas fa-triangle-exclamation"></i> Recurring expenses aren\'t set up in your database yet. Run <b>migration-add-recurring.sql</b> in the Supabase SQL Editor, then reload.</div>';
    } else if (recurring.length) {
        recurringSummary.innerHTML = `<span><b>${active.length}</b> active</span>
            <span>≈ <b>${formatMoney(monthly)}</b> / month</span>
            <span>≈ <b>${formatMoney(monthly * 12)}</b> / year</span>`;
    } else {
        recurringSummary.innerHTML = '';
    }

    if (!recurring.length) {
        recurringList.innerHTML = '<div class="history-empty"><i class="fas fa-repeat"></i><div>No recurring expenses yet.<br>Add your utilities and subscriptions and they\'ll post themselves.</div></div>';
        return;
    }

    recurringList.innerHTML = recurring.map(r => {
        const cat = catByKey[r.category];
        const color = cat ? `style="--cat-color:${cat.color}"` : '';
        const when = r.active ? `Next: ${formatDueLabel(r.next_due)} · ${dueLabel(r.next_due)}` : 'Paused';
        return `
        <div class="history-item recurring-item ${r.active ? '' : 'paused'}" data-id="${escapeHtml(r.id)}">
            <div class="h-icon expense" ${color}><i class="fas ${cat ? cat.icon : 'fa-repeat'}"></i></div>
            <div class="h-left">
                <div class="h-title">${escapeHtml(r.name)}</div>
                <div class="h-detail">${FREQ_LABEL[r.frequency] || r.frequency} · ${escapeHtml(when)}</div>
            </div>
            <div class="h-right">
                <div class="h-amount expense">${formatMoney(r.amount)}</div>
                <div class="h-actions">
                    <button type="button" class="icon-btn" data-action="toggle" title="${r.active ? 'Pause' : 'Resume'}" aria-label="${r.active ? 'Pause' : 'Resume'}"><i class="fas ${r.active ? 'fa-pause' : 'fa-play'}"></i></button>
                    <button type="button" class="icon-btn" data-action="edit" title="Edit" aria-label="Edit"><i class="fas fa-pen"></i></button>
                    <button type="button" class="icon-btn danger" data-action="delete" title="Delete" aria-label="Delete"><i class="fas fa-trash-can"></i></button>
                </div>
            </div>
        </div>`;
    }).join('');
}

recurringList.addEventListener('click', async (e) => {
    const row = e.target.closest('.recurring-item');
    if (!row) return;
    const id = row.dataset.id;
    const r = recurring.find(x => x.id === id);
    if (!r) return;
    const action = e.target.closest('[data-action]')?.dataset.action || 'edit';

    if (action === 'edit') return startRecurringEdit(id);

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
            await updateRecurringRecord(id, fields);
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
            message: `"${r.name}" will stop posting automatically. Expenses it already added are kept.`,
            confirmText: 'Delete',
            cancelText: 'Keep it',
            danger: true,
            onConfirm: async () => {
                try {
                    const { data, error } = await supabaseClient.from('recurring_expenses').delete().eq('id', id).select();
                    if (error) throw error;
                    if (!data || !data.length) throw new Error('That item could not be deleted.');
                    recurring = recurring.filter(x => x.id !== id);
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
    const next = recurring.filter(r => r.active).sort((a, b) => a.next_due.localeCompare(b.next_due)).slice(0, 3);
    if (!next.length) {
        upcomingList.innerHTML = '<div class="history-empty small">No recurring bills yet — add your utilities and subscriptions.</div>';
        return;
    }
    upcomingList.innerHTML = next.map(r => {
        const cat = catByKey[r.category];
        const soon = daysUntil(r.next_due) <= 3;
        return `
        <div class="history-item" data-id="${escapeHtml(r.id)}">
            <div class="h-icon expense" ${cat ? `style="--cat-color:${cat.color}"` : ''}><i class="fas ${cat ? cat.icon : 'fa-repeat'}"></i></div>
            <div class="h-left">
                <div class="h-title">${escapeHtml(r.name)}</div>
                <div class="h-detail"><span class="${soon ? 'due-soon' : ''}">${dueLabel(r.next_due)}</span> · ${formatDueLabel(r.next_due)}</div>
            </div>
            <div class="h-right"><div class="h-amount expense">${formatMoney(r.amount)}</div></div>
        </div>`;
    }).join('');
}
$('manageRecurringBtn').addEventListener('click', () => navigate('recurring'));
upcomingList.addEventListener('click', (e) => {
    const row = e.target.closest('.history-item');
    if (!row) return navigate('recurring');
    navigate('recurring');
    startRecurringEdit(row.dataset.id);
});

// Catch bills that fell due while the app sat in the background (e.g. an installed PWA left open overnight)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser) processRecurring();
});

cancelRecurringEdit(); // sets the form defaults and renders the chips

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

    if (cameFromEmailConfirmation) return; // handled by the auth listener

    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (session?.user && !currentUser) await onLoginSuccess(session.user);
    } catch (err) {
        console.error('Init error:', err);
    }
})();

// === PWA ===
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
