// ================================================================
// SMART EXPENSE TRACKER — app.js
// Enhanced with tab-based login/register, month selector, and Google setup
// ================================================================

// ---------- SUPABASE CONFIG ----------
const SUPABASE_URL = 'https://koptwssojqjsqtkkmtuk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcHR3c3NvanFqc3F0a2ttdHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDU5OTEsImV4cCI6MjEwMzIyMTk5MX0.3zEjfNVw1qsDA96Ru1EBnW2l_T_c0bm-8A9O9SZnJkk';

const cameFromEmailConfirmation = window.location.hash.includes('type=signup');
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- STATE ----------
let currentUser = null;
let isLoginMode = true;
let lastRegisteredEmail = null;
let expenses = [];
let incomes = [];

let selectedDate = new Date();
selectedDate.setHours(0, 0, 0, 0);

const categories = ['beverages', 'travel', 'entertain', 'work', 'food', 'shopping'];

// ---------- DOM REFS ----------
const $ = id => document.getElementById(id);
const authScreen = $('authScreen');
const setupScreen = $('setupScreen');
const dashboardScreen = $('dashboardScreen');

const authTitle = $('authTitle');
const authSub = $('authSub');
const emailInput = $('emailInput');
const passInput = $('passInput');
const userInput = $('userInput');
const confirmPass = $('confirmPass');
const toggleAuthBtn = $('toggleAuthBtn');
const toggleText = $('toggleText');
const authActionBtn = $('authActionBtn');
const googleBtn = $('googleBtn');
const logoutBtn = $('logoutBtn');
const resendRow = $('resendRow');
const resendBtn = $('resendBtn');

const loginTab = $('loginTab');
const registerTab = $('registerTab');
const loginFields = $('loginFields');
const registerFields = $('registerFields');
const emailInput2 = $('emailInput2');
const passInput2 = $('passInput2');

const topNav = document.querySelector('.top-nav');

// Setup screen elements
const setupUsername = $('setupUsername');
const setupPassword = $('setupPassword');
const setupConfirmPassword = $('setupConfirmPassword');
const setupCompleteBtn = $('setupCompleteBtn');

const userNameDisplay = $('userNameDisplay');
const totalSpent = $('totalSpent');
const totalIncomeDisplay = $('totalIncome');
const selectedMonthDisplay = $('selectedMonthDisplay');
const monthPicker = $('monthPicker');
const monthPickerBtn = $('monthPickerBtn');
const prevMonthBtn = $('prevMonthBtn');
const nextMonthBtn = $('nextMonthBtn');
const todayMonthBtn = $('todayMonthBtn');

const expAmount = $('expAmount');
const expCategory = $('expCategory');
const expPayment = $('expPayment');
const saveExpenseBtn = $('saveExpenseBtn');

const incomeAmount = $('incomeAmount');
const incomeSource = $('incomeSource');
const saveIncomeBtn = $('saveIncomeBtn');

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
function isSameMonth(dateStr, refDate) {
    const d = new Date(dateStr);
    const ref = refDate || selectedDate;
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
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

function formatMonthDisplay(date) {
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function formatMonthValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    if (screenId === 'dashboardScreen') updateDashboard();

    // Toggle navigation visibility
    if (screenId === 'authScreen' || screenId === 'setupScreen') {
        topNav.classList.add('hidden-nav');
    } else {
        topNav.classList.remove('hidden-nav');
    }
}

function setActiveNav(screen) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`[data-screen="${screen}"]`).forEach(b => b.classList.add('active'));
}

function updateDashboard() {
    if (!currentUser) return;

    selectedMonthDisplay.textContent = formatMonthDisplay(selectedDate);
    monthPicker.value = formatMonthValue(selectedDate);

    totalSpent.textContent = `RM ${getTotalSpent().toFixed(2)}`;
    totalIncomeDisplay.textContent = getTotalIncome().toFixed(2);

    categories.forEach(cat => {
        const el = $(`cat-${cat}`);
        if (el) el.textContent = `RM ${getCategoryTotal(cat).toFixed(2)}`;
    });

    const meta = currentUser.user_metadata || {};
    userNameDisplay.textContent = meta.username || currentUser.email?.split('@')[0] || 'User';
}

// ---------- MONTH SELECTOR ----------
function setSelectedMonth(year, month) {
    selectedDate = new Date(year, month, 1);
    selectedDate.setHours(0, 0, 0, 0);
    updateDashboard();
    renderCharts();
}

function goToPrevMonth() {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth() - 1;
    setSelectedMonth(year, month);
}

function goToNextMonth() {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth() + 1;
    setSelectedMonth(year, month);
}

function goToTodayMonth() {
    const now = new Date();
    setSelectedMonth(now.getFullYear(), now.getMonth());
}

prevMonthBtn.addEventListener('click', goToPrevMonth);
nextMonthBtn.addEventListener('click', goToNextMonth);
todayMonthBtn.addEventListener('click', goToTodayMonth);

monthPickerBtn.addEventListener('click', () => {
    monthPicker.showPicker ? monthPicker.showPicker() : monthPicker.click();
});

monthPicker.addEventListener('change', (e) => {
    const [year, month] = e.target.value.split('-').map(Number);
    if (!isNaN(year) && !isNaN(month)) {
        setSelectedMonth(year, month - 1);
    }
});

// ---------- CHART MANAGEMENT ----------
let pieChartInstance = null;
let barChartInstance = null;

function getCategoryColors() {
    return ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];
}

function getMonthlyTotals() {
    const months = [];
    const expensesData = [];
    const incomesData = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - i, 1);
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

    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }

    // Pie chart
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

    // Bar chart
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

// Override updateDashboard to include charts
const originalUpdateDashboard = updateDashboard;
updateDashboard = function() {
    originalUpdateDashboard();
    renderCharts();
};

const originalFetch = fetchAllData;
fetchAllData = async function() {
    await originalFetch();
    renderCharts();
};

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
        else if (screen === 'history') showScreen('historyScreen');  // <-- ADD THIS
        setActiveNav(screen);
    });
});

// ---------- PASSWORD VISIBILITY ----------
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

// ---------- TAB SWITCHER ----------
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

// ---------- AUTH ACTION ----------
async function handleAuthAction(email, password, isLogin) {
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
                data: { username },
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
        resendRow.classList.remove('hidden');
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
            }
        });
    } catch (err) {
        console.error('Signup error:', err);
        showModal({ type: 'error', title: 'Couldn\'t create account', message: err.message || 'Please try again.' });
    } finally {
        setBusy(authActionBtn, false);
    }
}

authActionBtn.addEventListener('click', function(e) {
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
        // Update user metadata with username and set password
        const { data, error } = await supabaseClient.auth.updateUser({
            password: password,
            data: { username, setup_complete: true }
        });
        if (error) throw error;

        // Update currentUser with new metadata
        currentUser = data.user;

        // Now show dashboard
        showScreen('dashboardScreen');
        await fetchAllData(); // load data
        showModal({ type: 'success', title: 'Setup complete!', message: 'Your account is ready. Welcome aboard!' });
    } catch (err) {
        console.error('Setup error:', err);
        showModal({ type: 'error', title: 'Setup failed', message: err.message || 'Could not update your profile. Please try again.' });
    } finally {
        setBusy(setupCompleteBtn, false);
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
                topNav.classList.add('hidden-nav');
                showScreen('authScreen');
            }
        });
    });
}

// ---------- SESSION ----------
async function onLoginSuccess(user) {
    currentUser = user;

    // Check if user needs setup (Google user without username)
    const meta = user.user_metadata || {};
    if (!meta.username || !meta.setup_complete) {
        // Show setup screen
        showScreen('setupScreen');
        // Pre-fill email if available
        setupUsername.value = '';
        setupPassword.value = '';
        setupConfirmPassword.value = '';
        return;
    }

    // Existing user with full profile
    emailInput.value = '';
    passInput.value = '';
    userInput.value = '';
    confirmPass.value = '';
    emailInput2.value = '';
    passInput2.value = '';
    resendRow.classList.add('hidden');
    topNav.classList.remove('hidden-nav');
    await fetchAllData();
    showScreen('dashboardScreen');
}

supabaseClient.auth.onAuthStateChange(async (event, session) => {
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

// ---------- HISTORY ----------
const historyScreen = document.getElementById('historyScreen');
const historyList = document.getElementById('historyList');
const historyTypeFilter = document.getElementById('historyTypeFilter');
const historyMonthFilter = document.getElementById('historyMonthFilter');
const historyRefreshBtn = document.getElementById('historyRefreshBtn');

// Set default month filter to current month
function setDefaultHistoryMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    historyMonthFilter.value = `${year}-${month}`;
}
setDefaultHistoryMonth();

function renderHistory() {
    if (!currentUser) return;

    const type = historyTypeFilter.value;
    const month = historyMonthFilter.value;
    let filtered = [];

    // Combine expenses and incomes
    const allExpenses = expenses.map(e => ({ ...e, type: 'expense', label: 'Expense' }));
    const allIncomes = incomes.map(i => ({ ...i, type: 'income', label: 'Income' }));
    let combined = [...allExpenses, ...allIncomes];

    // Filter by type
    if (type === 'expense') {
        combined = combined.filter(t => t.type === 'expense');
    } else if (type === 'income') {
        combined = combined.filter(t => t.type === 'income');
    }

    // Filter by month (if month selected)
    if (month) {
        const [year, mon] = month.split('-').map(Number);
        combined = combined.filter(t => {
            const d = new Date(t.created_at);
            return d.getFullYear() === year && d.getMonth() === mon - 1;
        });
    }

    // Sort by date descending
    combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (combined.length === 0) {
        historyList.innerHTML = `<div class="history-empty">No transactions found for this filter.</div>`;
        return;
    }

    let html = '';
    combined.forEach(t => {
        const date = new Date(t.created_at).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
        const amount = parseFloat(t.amount).toFixed(2);
        const isIncome = t.type === 'income';
        const icon = isIncome ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
        const detail = isIncome ? `Source: ${t.source || 'Salary'}` : `Category: ${t.category} • ${t.payment || 'N/A'}`;
        html += `
            <div class="history-item">
                <div class="h-left">
                    <div class="h-type ${isIncome ? 'income' : 'expense'}">
                        <i class="fas ${icon}"></i> ${isIncome ? 'Income' : 'Expense'}
                    </div>
                    <div class="h-detail">${detail} • ${date}</div>
                </div>
                <div class="h-amount ${isIncome ? 'income' : 'expense'}">
                    ${isIncome ? '+' : '-'} RM ${amount}
                </div>
            </div>
        `;
    });
    historyList.innerHTML = html;
}

// History filter events
historyTypeFilter.addEventListener('change', renderHistory);
historyMonthFilter.addEventListener('change', renderHistory);
historyRefreshBtn.addEventListener('click', renderHistory);

// Override fetchAllData to re-render history if visible
const originalFetchHistory = fetchAllData;
fetchAllData = async function() {
    await originalFetchHistory();
    if (document.getElementById('historyScreen').classList.contains('active')) {
        renderHistory();
    }
};

// Also update navigation to show history
const originalShowScreen = showScreen;
showScreen = function(screenId) {
    originalShowScreen(screenId);
    if (screenId === 'historyScreen') {
        renderHistory();
    }
};

// ---------- INIT ----------
(async function init() {
    const now = new Date();
    selectedDate = new Date(now.getFullYear(), now.getMonth(), 1);
    selectedDate.setHours(0, 0, 0, 0);
    selectedMonthDisplay.textContent = formatMonthDisplay(selectedDate);
    monthPicker.value = formatMonthValue(selectedDate);

    if (cameFromEmailConfirmation) return;

    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (session?.user) {
            await onLoginSuccess(session.user);
        } else {
            topNav.classList.add('hidden-nav');
        }
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