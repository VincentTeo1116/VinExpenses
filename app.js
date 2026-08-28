// ================================================================
// SMART EXPENSE TRACKER — app.js
// Real Supabase Auth: password login + email-link verification
// (click the link in your inbox — no code to type), Google OAuth,
// and Postgres-backed data. All user-facing notices use the
// reusable modal (showModal) instead of alert().
// ================================================================

// ---------- SUPABASE CONFIG ----------
const SUPABASE_URL = 'https://koptwssojqjsqtkkmtuk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcHR3c3NvanFqc3F0a2ttdHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDU5OTEsImV4cCI6MjEwMzIyMTk5MX0.3zEjfNVw1qsDA96Ru1EBnW2l_T_c0bm-8A9O9SZnJkk';

// Capture BEFORE the Supabase client parses/clears the URL hash, so
// we can tell an email-confirmation redirect apart from a normal
// OAuth login redirect.
const cameFromEmailConfirmation = window.location.hash.includes('type=signup');

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- STATE ----------
let currentUser = null;
let isLoginMode = true;
let lastRegisteredEmail = null;
let expenses = [];
let incomes = [];

const categories = ['beverages', 'travel', 'entertain', 'work', 'food', 'shopping'];

// ---------- DOM REFS ----------
const $ = id => document.getElementById(id);
const authScreen = $('authScreen');

const authTitle = $('authTitle');
const authSub = $('authSub');
const emailInput = $('emailInput');
const passInput = $('passInput');
const userInput = $('userInput');
const confirmPass = $('confirmPass');
const registerExtra = $('registerExtra');
const registerExtra2 = $('registerExtra2');
const toggleAuthBtn = $('toggleAuthBtn');
const toggleText = $('toggleText');
const authActionBtn = $('authActionBtn');
const googleBtn = $('googleBtn');
const logoutBtn = $('logoutBtn');
const resendRow = $('resendRow');
const resendBtn = $('resendBtn');

const userNameDisplay = $('userNameDisplay');
const totalSpent = $('totalSpent');
const totalIncomeDisplay = $('totalIncome');
const currentMonthDisplay = $('currentMonth');

const expAmount = $('expAmount');
const expCategory = $('expCategory');
const expPayment = $('expPayment');
const saveExpenseBtn = $('saveExpenseBtn');

const incomeAmount = $('incomeAmount');
const incomeSource = $('incomeSource');
const saveIncomeBtn = $('saveIncomeBtn');

// ---------- REUSABLE MODAL ----------
// showModal({ type, title, message, confirmText, cancelText, danger, onConfirm, onCancel })
// type: 'success' | 'error' | 'warning' | 'info' | 'question'
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

function showModal({
    type = 'info',
    title = '',
    message = '',
    warningText = '',
    confirmText = 'OK',
    cancelText = null,
    danger = false,
    onConfirm = null,
    onCancel = null
}) {
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

    const cleanup = () => {
        modalOverlay.classList.remove('active');
        modalConfirmBtn.onclick = null;
        modalCancelBtn.onclick = null;
        modalOverlay.onclick = null;
    };

    modalConfirmBtn.onclick = () => {
        cleanup();
        if (onConfirm) onConfirm();
    };
    modalCancelBtn.onclick = () => {
        cleanup();
        if (onCancel) onCancel();
    };
    modalOverlay.onclick = (e) => {
        if (e.target === modalOverlay) {
            cleanup();
            if (onCancel) onCancel();
        }
    };

    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ---------- HELPERS ----------
function isSameMonth(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function getTotalSpent() {
    return expenses.filter(e => isSameMonth(e.created_at))
        .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
}

function getTotalIncome() {
    return incomes.filter(i => isSameMonth(i.created_at))
        .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
}

function getCategoryTotal(cat) {
    return expenses
        .filter(e => e.category === cat && isSameMonth(e.created_at))
        .reduce((s, e) => s + parseFloat(e.amount || 0), 0);
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    if (screenId === 'dashboardScreen') updateDashboard();
}

function setActiveNav(screen) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`[data-screen="${screen}"]`).forEach(b => b.classList.add('active'));
}

function updateDashboard() {
    if (!currentUser) return;

    totalSpent.textContent = `RM ${getTotalSpent().toFixed(2)}`;
    totalIncomeDisplay.textContent = getTotalIncome().toFixed(2);

    categories.forEach(cat => {
        const el = $(`cat-${cat}`);
        if (el) el.textContent = `RM ${getCategoryTotal(cat).toFixed(2)}`;
    });

    const meta = currentUser.user_metadata || {};
    userNameDisplay.textContent = meta.username || currentUser.email?.split('@')[0] || 'User';

    const now = new Date();
    currentMonthDisplay.textContent = now.toLocaleString('default', { month: 'long', year: 'numeric' });
}

// ---------- CHART MANAGEMENT ----------
let pieChartInstance = null;
let barChartInstance = null;

function getCategoryColors() {
    return ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];
}

function getMonthlyTotals() {
    const now = new Date();
    const months = [];
    const expensesData = [];
    const incomesData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString('default', { month: 'short' });
        months.push(label);
        const monthExp = expenses
            .filter(e => {
                const ed = new Date(e.created_at);
                return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
            })
            .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const monthInc = incomes
            .filter(i => {
                const id = new Date(i.created_at);
                return id.getFullYear() === d.getFullYear() && id.getMonth() === d.getMonth();
            })
            .reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
        expensesData.push(monthExp);
        incomesData.push(monthInc);
    }
    return { months, expensesData, incomesData };
}

function renderCharts() {
    const pieCtx = document.getElementById('pieChart')?.getContext('2d');
    const barCtx = document.getElementById('barChart')?.getContext('2d');
    if (!pieCtx || !barCtx) return;

    // Destroy previous instances
    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }

    // ---- Pie chart: category spending this month ----
    const categoryTotals = categories.map(cat => getCategoryTotal(cat));
    const hasData = categoryTotals.some(v => v > 0);
    const pieData = hasData ? categoryTotals : [1];
    const pieLabels = hasData ? categories.map(c => c.charAt(0).toUpperCase() + c.slice(1)) : ['No data'];

    pieChartInstance = new Chart(pieCtx, {
        type: 'pie',
        data: {
            labels: pieLabels,
            datasets: [{
                data: pieData,
                backgroundColor: hasData ? getCategoryColors() : ['#d1d5db'],
                borderWidth: 2,
                borderColor: 'white'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx) => `RM ${ctx.parsed.toFixed(2)}` } }
            }
        }
    });

    // ---- Bar chart: last 6 months expenses vs income ----
    const { months, expensesData, incomesData } = getMonthlyTotals();
    const hasBarData = expensesData.some(v => v > 0) || incomesData.some(v => v > 0);
    const barExp = hasBarData ? expensesData : [0];
    const barInc = hasBarData ? incomesData : [0];

    barChartInstance = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                {
                    label: 'Expenses',
                    data: barExp,
                    backgroundColor: 'rgba(79, 70, 229, 0.7)',
                    borderColor: '#4f46e5',
                    borderWidth: 2,
                    borderRadius: 6,
                },
                {
                    label: 'Income',
                    data: barInc,
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10b981',
                    borderWidth: 2,
                    borderRadius: 6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx) => `RM ${ctx.parsed.y.toFixed(2)}` } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (val) => 'RM ' + val } }
            }
        }
    });
}

// Override updateDashboard to also update charts
const originalUpdateDashboard = updateDashboard;
updateDashboard = function() {
    originalUpdateDashboard();
    renderCharts();
};
// Also call renderCharts when data is fetched
// We'll modify fetchAllData to call renderCharts after update
const originalFetch = fetchAllData;
fetchAllData = async function() {
    await originalFetch();
    renderCharts();
};
// Ensure charts are rendered on login
// onLoginSuccess already calls fetchAllData which will trigger renderCharts.

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

// ---------- SUPABASE DATA ----------
async function fetchAllData() {
    try {
        const [{ data: expData, error: expErr }, { data: incData, error: incErr }] = await Promise.all([
            supabaseClient.from('expenses').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('incomes').select('*').order('created_at', { ascending: false })
        ]);

        if (expErr) console.error('Error fetching expenses:', expErr);
        if (incErr) console.error('Error fetching incomes:', incErr);

        expenses = expData || [];
        incomes = incData || [];
        updateDashboard();
    } catch (err) {
        console.error('Fetch data error:', err);
    }
}

async function addExpense(amount, category, payment) {
    const { data, error } = await supabaseClient
        .from('expenses')
        .insert([{ user_id: currentUser.id, amount, category, payment }])
        .select();
    if (error) throw error;
    if (data && data.length > 0) expenses.unshift(data[0]);
}

async function addIncome(amount, source) {
    const { data, error } = await supabaseClient
        .from('incomes')
        .insert([{ user_id: currentUser.id, amount, source }])
        .select();
    if (error) throw error;
    if (data && data.length > 0) incomes.unshift(data[0]);
}

// ---------- NAVIGATION ----------
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const screen = btn.dataset.screen;
        if (screen === 'dashboard') showScreen('dashboardScreen');
        else if (screen === 'expense') showScreen('expenseScreen');
        else if (screen === 'income') showScreen('incomeScreen');
        setActiveNav(screen);
    });
});

// ---------- PASSWORD VISIBILITY TOGGLE ----------
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

// ---------- AUTH MODE TOGGLE ----------
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    resendRow.classList.add('hidden');

    if (isLoginMode) {
        authTitle.textContent = 'Welcome back 👋';
        authSub.textContent = 'Sign in to keep tracking your spending';
        authActionBtn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Sign In';
        toggleText.textContent = "Don't have an account?";
        toggleAuthBtn.textContent = 'Register';
        registerExtra.classList.add('hidden');
        registerExtra2.classList.add('hidden');
    } else {
        authTitle.textContent = 'Create account ✨';
        authSub.textContent = 'Register with your email — we\'ll send a verification link';
        authActionBtn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
        toggleText.textContent = 'Already have an account?';
        toggleAuthBtn.textContent = 'Login';
        registerExtra.classList.remove('hidden');
        registerExtra2.classList.remove('hidden');
    }
}
toggleAuthBtn.addEventListener('click', toggleAuthMode);

function switchToLoginAfterVerification() {
    isLoginMode = true;
    resendRow.classList.add('hidden');
    authTitle.textContent = 'Welcome back 👋';
    authSub.textContent = 'Sign in to keep tracking your spending';
    authActionBtn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Sign In';
    toggleText.textContent = "Don't have an account?";
    toggleAuthBtn.textContent = 'Register';
    registerExtra.classList.add('hidden');
    registerExtra2.classList.add('hidden');
    passInput.value = '';
}

// ---------- AUTH ACTION (login / register) ----------
authActionBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passInput.value.trim();

    if (!email || !email.includes('@')) {
        return showModal({ type: 'warning', title: 'Check your email', message: 'Please enter a valid email address.' });
    }
    if (!password) {
        return showModal({ type: 'warning', title: 'Password required', message: 'Please enter your password.' });
    }

    // ---------- LOGIN ----------
    if (isLoginMode) {
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

    // ---------- REGISTER ----------
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
                data: { username },
                emailRedirectTo: window.location.origin + window.location.pathname
            }
        });

        if (error) throw error;

        // Supabase returns an empty identities array when the email
        // already belongs to a confirmed account.
        if (data?.user?.identities?.length === 0) {
            showModal({
                type: 'warning',
                title: 'Account already exists',
                message: `${email} is already registered. Please sign in instead.`,
                confirmText: 'Go to Login',
                onConfirm: () => { toggleAuthMode(); emailInput.focus(); }
            });
            return;
        }

        // If email confirmation is disabled in the Supabase project,
        // signUp already returns an active session — just log them in.
        if (data.session) {
            await onLoginSuccess(data.user);
            return;
        }

        lastRegisteredEmail = email;
        resendRow.classList.remove('hidden');
        showModal({
            type: 'success',
            title: 'Verify your email',
            message: `We've sent a verification link to ${email}. Open your inbox and click the link — you'll be brought back here to log in.`,
            confirmText: 'Got it',
            onConfirm: () => {
                switchToLoginAfterVerification();
                emailInput.value = email;
                passInput.value = '';
                userInput.value = '';
                confirmPass.value = '';
            }
        });
    } catch (err) {
        console.error('Signup error:', err);
        showModal({ type: 'error', title: 'Couldn\'t create account', message: err.message || 'Please try again.' });
    } finally {
        setBusy(authActionBtn, false);
    }
});

// ---------- RESEND VERIFICATION EMAIL ----------
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
    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + window.location.pathname }
        });
        if (error) {
            if (/provider is not enabled/i.test(error.message)) {
                showModal({ type: 'error', title: 'Google sign-in unavailable', message: 'Google login isn\'t enabled yet for this app. Please use email & password.' });
            } else {
                throw error;
            }
        }
    } catch (err) {
        console.error('Google login error:', err);
        showModal({ type: 'error', title: 'Google sign-in failed', message: err.message || 'Please try again.' });
    }
});

// ---------- LOGOUT ----------
if (logoutBtn) {
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
                currentUser = null;
                expenses = [];
                incomes = [];
                emailInput.value = '';
                passInput.value = '';
                showScreen('authScreen');
            }
        });
    });
}

// ---------- SESSION HANDLING ----------
async function onLoginSuccess(user) {
    currentUser = user;
    emailInput.value = '';
    passInput.value = '';
    userInput.value = '';
    confirmPass.value = '';
    resendRow.classList.add('hidden');
    await fetchAllData();
    showScreen('dashboardScreen');
}

supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
        if (cameFromEmailConfirmation) {
            // They just clicked the link in their email. Per the
            // product's flow, we don't auto-drop them into the
            // dashboard — sign the implicit session out and land
            // them on the login screen instead.
            await supabaseClient.auth.signOut();
            history.replaceState(null, '', window.location.pathname);
            switchToLoginAfterVerification();
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
        currentUser = null;
        showScreen('authScreen');
    }
});

// ---------- EXPENSE ----------
saveExpenseBtn.addEventListener('click', async () => {
    if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });

    const amount = parseFloat(expAmount.value);
    if (isNaN(amount) || amount <= 0) {
        return showModal({ type: 'warning', title: 'Invalid amount', message: 'Please enter a valid amount greater than 0.' });
    }

    setBusy(saveExpenseBtn, true, 'Saving...');
    try {
        await addExpense(amount, expCategory.value, expPayment.value);
        expAmount.value = '';
        updateDashboard();
        showScreen('dashboardScreen');
        setActiveNav('dashboard');
        showModal({ type: 'success', title: 'Expense saved', message: 'Your expense has been recorded.' });
    } catch (err) {
        console.error('Save expense error:', err);
        showModal({ type: 'error', title: 'Couldn\'t save expense', message: err.message || 'Please try again.' });
    } finally {
        setBusy(saveExpenseBtn, false);
    }
});

// ---------- INCOME ----------
saveIncomeBtn.addEventListener('click', async () => {
    if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });

    const amount = parseFloat(incomeAmount.value);
    if (isNaN(amount) || amount <= 0) {
        return showModal({ type: 'warning', title: 'Invalid amount', message: 'Please enter a valid income amount.' });
    }
    const source = incomeSource.value.trim() || 'Salary';

    setBusy(saveIncomeBtn, true, 'Saving...');
    try {
        await addIncome(amount, source);
        incomeAmount.value = '';
        incomeSource.value = '';
        updateDashboard();
        showScreen('dashboardScreen');
        setActiveNav('dashboard');
        showModal({ type: 'success', title: 'Income saved', message: 'Your income has been recorded.' });
    } catch (err) {
        console.error('Save income error:', err);
        showModal({ type: 'error', title: 'Couldn\'t save income', message: err.message || 'Please try again.' });
    } finally {
        setBusy(saveIncomeBtn, false);
    }
});

// ---------- INIT ----------
(async function init() {
    const now = new Date();
    currentMonthDisplay.textContent = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    // If we came from an email confirmation link, onAuthStateChange
    // above will handle showing the "verified" modal + login screen,
    // so skip the normal getSession auto-login here.
    if (cameFromEmailConfirmation) return;

    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (session?.user) await onLoginSuccess(session.user);
    } catch (err) {
        console.error('Init error:', err);
    }
})();

// ---------- PWA: register service worker ----------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
