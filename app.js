// ================================================================
// SMART EXPENSE TRACKER — app.js
// Supabase auth + per-user expenses/incomes, dashboard, history
// ================================================================

// ---------- SUPABASE CONFIG ----------
const SUPABASE_URL = 'https://koptwssojqjsqtkkmtuk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcHR3c3NvanFqc3F0a2ttdHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDU5OTEsImV4cCI6MjEwMzIyMTk5MX0.3zEjfNVw1qsDA96Ru1EBnW2l_T_c0bm-8A9O9SZnJkk';

const cameFromEmailConfirmation = window.location.hash.includes('type=signup');
const hashError = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error_description');
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ---------- CONFIG ----------
const CATEGORIES = [
    { key: 'beverages', label: 'Beverages', icon: 'fa-mug-hot', color: '#4f46e5' },
    { key: 'travel', label: 'Travel', icon: 'fa-plane', color: '#06b6d4' },
    { key: 'entertain', label: 'Entertain', icon: 'fa-film', color: '#f59e0b' },
    { key: 'work', label: 'Work', icon: 'fa-briefcase', color: '#10b981' },
    { key: 'food', label: 'Food', icon: 'fa-utensils', color: '#ef4444' },
    { key: 'shopping', label: 'Shopping', icon: 'fa-bag-shopping', color: '#8b5cf6' }
];
const PAYMENTS = [
    { key: 'bank', label: 'Bank', icon: 'fa-building-columns' },
    { key: 'card', label: 'Card', icon: 'fa-credit-card' },
    { key: 'ewallet', label: 'E-Wallet', icon: 'fa-mobile-screen' }
];
const INCOME_SOURCES = [
    { key: 'Salary', label: 'Salary', icon: 'fa-sack-dollar' },
    { key: 'Freelance', label: 'Freelance', icon: 'fa-laptop-code' },
    { key: 'Bonus', label: 'Bonus', icon: 'fa-gift' },
    { key: 'Investment', label: 'Investment', icon: 'fa-chart-line' }
];
const catByKey = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
const payByKey = Object.fromEntries(PAYMENTS.map(p => [p.key, p]));
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- STATE ----------
let currentUser = null;
let expenses = [];
let incomes = [];
let lastRegisteredEmail = null;
let isLoading = false;
let expCategoryValue = CATEGORIES[0].key;
let expPaymentValue = PAYMENTS[0].key;
let editing = null; // { type, id }

let selectedDate = new Date();
selectedDate.setDate(1);
selectedDate.setHours(0, 0, 0, 0);

// ---------- DOM REFS ----------
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
const editExpenseFields = $('editExpenseFields');
const editIncomeFields = $('editIncomeFields');
const editSaveBtn = $('editSaveBtn');
const editCancelBtn = $('editCancelBtn');

// ---------- HELPERS ----------
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

// ---------- MODAL ----------
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

// ---------- TOAST ----------
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

// ---------- BUSY STATE ----------
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

// ---------- ANIMATED NUMBERS ----------
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

// ---------- NAVIGATION ----------
const SCREEN_BY_NAV = {
    dashboard: 'dashboardScreen',
    expense: 'expenseScreen',
    income: 'incomeScreen',
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

// ---------- DASHBOARD ----------
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
    const title = isIncome ? (t.source || 'Salary') : (cat ? cat.label : t.category);
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

    const meta = currentUser.user_metadata || {};
    userNameDisplay.textContent = meta.username || meta.full_name || currentUser.email?.split('@')[0] || 'User';

    if ($('dashboardScreen').classList.contains('active')) renderCharts();
}

categoryGrid.addEventListener('click', (e) => {
    const tile = e.target.closest('.category-item');
    if (tile) openHistoryFiltered({ type: 'expense', category: tile.dataset.cat, month: formatMonthValue(selectedDate) });
});
viewAllBtn.addEventListener('click', () => openHistoryFiltered({ month: formatMonthValue(selectedDate) }));

// ---------- MONTH SELECTOR ----------
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

// ---------- CHARTS ----------
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
            borderColor: 'white'
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

// ---------- SUPABASE DATA ----------
async function fetchAllData() {
    isLoading = true;
    updateDashboard();
    try {
        const [{ data: expData, error: expErr }, { data: incData, error: incErr }] = await Promise.all([
            supabaseClient.from('expenses').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('incomes').select('*').order('created_at', { ascending: false })
        ]);

        if (expErr) console.error('Error fetching expenses:', expErr);
        if (incErr) console.error('Error fetching incomes:', incErr);
        if (expErr || incErr) showToast('error', 'Could not load all your data. Pull to refresh or try again.');

        expenses = expData || [];
        incomes = incData || [];
    } catch (err) {
        console.error('Fetch data error:', err);
        showToast('error', 'Network problem while loading your data.');
    } finally {
        isLoading = false;
        updateDashboard();
        if ($('historyScreen').classList.contains('active')) renderHistory();
    }
}

async function addExpense(amount, category, payment, createdAt) {
    const { data, error } = await supabaseClient
        .from('expenses')
        .insert([{ user_id: currentUser.id, amount, category, payment, created_at: createdAt }])
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

// ---------- CHIP SELECTORS ----------
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

// ---------- PASSWORD VISIBILITY & STRENGTH ----------
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

// ---------- AUTH TABS ----------
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

// ---------- AUTH ACTION ----------
async function handleAuthAction(email, password, isLogin) {
    if (!supabaseClient) {
        return showModal({ type: 'error', title: 'Can\'t reach the server', message: 'The sign-in library failed to load. Check your internet connection and reload.' });
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

// ---------- RESEND ----------
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

// ---------- GOOGLE LOGIN ----------
googleBtn.addEventListener('click', async () => {
    if (!supabaseClient) {
        return showModal({ type: 'error', title: 'Can\'t reach the server', message: 'The sign-in library failed to load. Check your internet connection and reload.' });
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

// ---------- SETUP COMPLETE (for new Google users) ----------
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

// ---------- LOGOUT ----------
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
    emailInput.value = '';
    passInput.value = '';
    switchAuthTab('login');
    showScreen('authScreen');
}

// ---------- SESSION ----------
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

// ---------- EXPENSE ----------
saveExpenseBtn.addEventListener('click', async () => {
    if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });

    const amount = parseFloat(expAmount.value);
    if (isNaN(amount) || amount <= 0) {
        expAmount.focus();
        return showModal({ type: 'warning', title: 'Invalid amount', message: 'Please enter a valid amount greater than 0.' });
    }
    const createdAt = dateInputToISO(expDate.value);

    setBusy(saveExpenseBtn, true, 'Saving...');
    try {
        await addExpense(amount, expCategoryValue, expPaymentValue, createdAt);
        expAmount.value = '';
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

// ---------- INCOME ----------
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

// ---------- HISTORY ----------
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
                : `${catByKey[t.category]?.label || t.category} ${payByKey[t.payment]?.label || t.payment} expense`;
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

// ---------- EDIT MODAL ----------
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
    const { type, id, createdAt } = editing;
    const fields = { amount, created_at: dateInputToISO(editDate.value, new Date(createdAt)) };
    if (type === 'income') fields.source = editSource.value.trim() || 'Salary';
    else { fields.category = editCategory.value; fields.payment = editPayment.value; }

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

// ---------- INIT ----------
(async function init() {
    selectedMonthDisplay.textContent = formatMonthDisplay(selectedDate);
    monthPicker.value = formatMonthValue(selectedDate);

    if (!supabaseClient) {
        showModal({ type: 'error', title: 'Can\'t reach the server', message: 'Some required libraries failed to load. Check your internet connection and reload the page.' });
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

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
