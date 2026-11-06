/* miniapp/i18n.js
 *
 * Every word the Mini App shows, in English, Bahasa Melayu and Chinese. A missing translation falls back to English,
 * so a new string can never show as blank. Values inserted with {name} are plain text: the screens escape them
 * (MiniFormat.escapeHtml) when they build HTML.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MiniI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var en = {
        app_title: 'VinExpenses',
        tab_overview: 'Overview', tab_days: 'Days', tab_budgets: 'Budgets', tab_trend: 'Trend', tab_history: 'History',
        nav_label: 'Main navigation', prev_month: 'Previous month', next_month: 'Next month', loading: 'Loading…',
        spent: 'Spent', income: 'Income', net: 'Net', saved: 'Saved', vs_last: 'vs last month', streak: '{n}-day streak',
        where_it_went: 'Where it went', others: 'Others', categories_count: '{n} categories',
        expense_count_one: '{n} expense', expense_count_many: '{n} expenses',
        no_data: 'No expenses this month yet', no_data_hint: 'Add one with the + button, or just send a message to the bot.',
        add_expense: 'Add expense', edit_expense: 'Edit expense', amount: 'Amount', merchant: 'Merchant', merchant_placeholder: 'e.g. Lunch at the kopitiam',
        category: 'Category', payment: 'Payment', date: 'Date', note: 'Note', save: 'Save', cancel: 'Cancel', delete: 'Delete',
        delete_confirm: 'Tap again to delete', saved_toast: 'Saved ✓', deleted_toast: 'Deleted ✓',
        search: 'Search expenses', all_categories: 'All', today: 'Today', yesterday: 'Yesterday', total: 'Total', load_more: 'Load more',
        busiest: 'Busiest day', average_day: 'Average a day', active_days: 'Days with spending', daily_spending: 'Daily spending', heat_legend: 'Less → More',
        budgets_title: 'Budgets', budget_overall: 'Overall', budget_left: '{amount} left', budget_over: '{amount} over',
        no_budgets: 'No budgets yet', no_budgets_hint: 'Set a budget on the VinExpenses website and it appears here with a progress bar.',
        trend_title: 'Last 6 months', average_month: 'Average a month', highest_month: 'Highest month',
        ins_cat_up: '{cat} is up {pct} vs last month', ins_cat_down: '{cat} is down {pct} vs last month',
        ins_weekend_heavy: 'Weekend days cost {x}× your weekdays', ins_weekday_heavy: 'Weekdays cost {x}× your weekends',
        ins_pace_warn: 'At this pace {name} reaches {pct} of its budget', ins_pace_ok: 'On track: {used} of your {name} budget by day {day}',
        chart_donut: 'Spending by category', chart_days: 'Spending per day', chart_trend: 'Spending per month',
        err_open_telegram: 'Open this from the Telegram bot', err_open_telegram_hint: 'This page works inside Telegram. Open the bot and tap Dashboard.',
        err_expired: 'Session expired', err_expired_hint: 'Close this window and open the dashboard again from the bot.',
        err_not_linked: 'Connect your account first', err_not_linked_hint: 'In VinExpenses go to Account → Telegram → Connect Telegram, then open the dashboard again.',
        err_generic: 'Something went wrong', err_network: 'No connection', err_limit: 'Too many requests today. Try again tomorrow.',
        retry: 'Try again', close: 'Close', open_website: 'Open the VinExpenses website', try_preview: 'Try the preview', preview_banner: 'Preview with sample data',
        v_amount: 'Enter an amount from RM 0.01 to RM 1,000,000', v_category: 'Choose a category', v_payment: 'Choose a payment method',
        v_date: 'Choose a valid date, not in the future', v_server: 'Could not save. Please check the details.',
        ranked: 'Tap a category to see its expenses',
    };
    var ms = {
        app_title: 'VinExpenses',
        tab_overview: 'Ringkasan', tab_days: 'Harian', tab_budgets: 'Bajet', tab_trend: 'Aliran', tab_history: 'Sejarah',
        nav_label: 'Navigasi utama', prev_month: 'Bulan sebelumnya', next_month: 'Bulan seterusnya', loading: 'Memuatkan…',
        spent: 'Belanja', income: 'Pendapatan', net: 'Bersih', saved: 'Simpanan', vs_last: 'berbanding bulan lepas', streak: '{n} hari berturut-turut',
        where_it_went: 'Ke mana wang pergi', others: 'Lain-lain', categories_count: '{n} kategori',
        expense_count_one: '{n} perbelanjaan', expense_count_many: '{n} perbelanjaan',
        no_data: 'Belum ada perbelanjaan bulan ini', no_data_hint: 'Tambah dengan butang +, atau hantar mesej kepada bot.',
        add_expense: 'Tambah perbelanjaan', edit_expense: 'Ubah perbelanjaan', amount: 'Jumlah', merchant: 'Peniaga', merchant_placeholder: 'cth. Makan tengah hari di kopitiam',
        category: 'Kategori', payment: 'Bayaran', date: 'Tarikh', note: 'Nota', save: 'Simpan', cancel: 'Batal', delete: 'Padam',
        delete_confirm: 'Tekan lagi untuk padam', saved_toast: 'Disimpan ✓', deleted_toast: 'Dipadam ✓',
        search: 'Cari perbelanjaan', all_categories: 'Semua', today: 'Hari ini', yesterday: 'Semalam', total: 'Jumlah', load_more: 'Muat lagi',
        busiest: 'Hari paling sibuk', average_day: 'Purata sehari', active_days: 'Hari berbelanja', daily_spending: 'Perbelanjaan harian', heat_legend: 'Kurang → Lebih',
        budgets_title: 'Bajet', budget_overall: 'Keseluruhan', budget_left: '{amount} berbaki', budget_over: '{amount} melebihi',
        no_budgets: 'Belum ada bajet', no_budgets_hint: 'Tetapkan bajet di laman web VinExpenses dan ia akan dipaparkan di sini dengan bar kemajuan.',
        trend_title: '6 bulan lepas', average_month: 'Purata sebulan', highest_month: 'Bulan tertinggi',
        ins_cat_up: '{cat} naik {pct} berbanding bulan lepas', ins_cat_down: '{cat} turun {pct} berbanding bulan lepas',
        ins_weekend_heavy: 'Hujung minggu {x}× lebih mahal daripada hari bekerja', ins_weekday_heavy: 'Hari bekerja {x}× lebih mahal daripada hujung minggu',
        ins_pace_warn: 'Dengan kadar ini {name} akan mencecah {pct} daripada bajetnya', ins_pace_ok: 'Mengikut landasan: {used} bajet {name} digunakan setakat hari ke-{day}',
        chart_donut: 'Perbelanjaan mengikut kategori', chart_days: 'Perbelanjaan setiap hari', chart_trend: 'Perbelanjaan setiap bulan',
        err_open_telegram: 'Buka ini daripada bot Telegram', err_open_telegram_hint: 'Halaman ini berfungsi di dalam Telegram. Buka bot dan tekan Papan pemuka.',
        err_expired: 'Sesi tamat', err_expired_hint: 'Tutup tetingkap ini dan buka semula papan pemuka daripada bot.',
        err_not_linked: 'Sambungkan akaun anda dahulu', err_not_linked_hint: 'Dalam VinExpenses pergi ke Akaun → Telegram → Connect Telegram, kemudian buka semula papan pemuka.',
        err_generic: 'Berlaku masalah', err_network: 'Tiada sambungan', err_limit: 'Terlalu banyak permintaan hari ini. Cuba lagi esok.',
        retry: 'Cuba lagi', close: 'Tutup', open_website: 'Buka laman web VinExpenses', try_preview: 'Cuba pratonton', preview_banner: 'Pratonton dengan data contoh',
        v_amount: 'Masukkan jumlah dari RM 0.01 hingga RM 1,000,000', v_category: 'Pilih kategori', v_payment: 'Pilih kaedah bayaran',
        v_date: 'Pilih tarikh yang sah, bukan pada masa hadapan', v_server: 'Tidak dapat menyimpan. Sila semak butiran.',
        ranked: 'Tekan kategori untuk melihat perbelanjaannya',
    };
    var zh = {
        app_title: 'VinExpenses',
        tab_overview: '概览', tab_days: '每日', tab_budgets: '预算', tab_trend: '趋势', tab_history: '记录',
        nav_label: '主导航', prev_month: '上个月', next_month: '下个月', loading: '加载中…',
        spent: '支出', income: '收入', net: '结余', saved: '储蓄率', vs_last: '对比上月', streak: '连续 {n} 天',
        where_it_went: '钱花在哪里', others: '其他', categories_count: '{n} 个分类',
        expense_count_one: '{n} 笔支出', expense_count_many: '{n} 笔支出',
        no_data: '本月还没有支出', no_data_hint: '点 + 按钮添加，或直接给机器人发消息。',
        add_expense: '记一笔支出', edit_expense: '编辑支出', amount: '金额', merchant: '商家', merchant_placeholder: '例如：咖啡店午餐',
        category: '分类', payment: '付款方式', date: '日期', note: '备注', save: '保存', cancel: '取消', delete: '删除',
        delete_confirm: '再点一次确认删除', saved_toast: '已保存 ✓', deleted_toast: '已删除 ✓',
        search: '搜索支出', all_categories: '全部', today: '今天', yesterday: '昨天', total: '合计', load_more: '加载更多',
        busiest: '花得最多的一天', average_day: '日均', active_days: '有支出的天数', daily_spending: '每日支出', heat_legend: '少 → 多',
        budgets_title: '预算', budget_overall: '总预算', budget_left: '剩余 {amount}', budget_over: '超出 {amount}',
        no_budgets: '还没有预算', no_budgets_hint: '在 VinExpenses 网站设置预算后，会连同进度条显示在这里。',
        trend_title: '最近 6 个月', average_month: '月均', highest_month: '最高的月份',
        ins_cat_up: '{cat}比上个月增加 {pct}', ins_cat_down: '{cat}比上个月减少 {pct}',
        ins_weekend_heavy: '周末的花费是工作日的 {x}×', ins_weekday_heavy: '工作日的花费是周末的 {x}×',
        ins_pace_warn: '照这个速度，{name}将达到预算的 {pct}', ins_pace_ok: '进度良好：到第 {day} 天，{name}预算已用 {used}',
        chart_donut: '按分类的支出', chart_days: '每天的支出', chart_trend: '每月的支出',
        err_open_telegram: '请从 Telegram 机器人打开', err_open_telegram_hint: '此页面需在 Telegram 内使用。请打开机器人并点击“控制台”。',
        err_expired: '会话已过期', err_expired_hint: '请关闭此窗口，然后从机器人重新打开控制台。',
        err_not_linked: '请先连接账户', err_not_linked_hint: '在 VinExpenses 中进入 账户 → Telegram → Connect Telegram，然后重新打开控制台。',
        err_generic: '出了点问题', err_network: '没有网络连接', err_limit: '今天的请求次数过多，请明天再试。',
        retry: '重试', close: '关闭', open_website: '打开 VinExpenses 网站', try_preview: '试用预览', preview_banner: '使用示例数据预览',
        v_amount: '请输入 RM 0.01 到 RM 1,000,000 之间的金额', v_category: '请选择分类', v_payment: '请选择付款方式',
        v_date: '请选择有效日期，不能是未来', v_server: '无法保存，请检查内容。',
        ranked: '点一个分类查看其支出',
    };

    var DICTS = { en: en, ms: ms, zh: zh };
    var LANGS = ['en', 'ms', 'zh'];

    function asLang(value) {
        var text = String(value || '').toLowerCase();
        if (text.indexOf('zh') === 0) return 'zh';
        if (text === 'ms' || text.indexOf('ms-') === 0 || text === 'id') return 'ms';
        return 'en';
    }

    /** Looks up a sentence and fills in {values}. Unknown key -> English -> the key itself (never throws). */
    function t(lang, key, vars) {
        var template = (DICTS[lang] && DICTS[lang][key]) || en[key] || key;
        return String(template).replace(/\{(\w+)\}/g, function (_m, name) {
            return vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '';
        });
    }

    return { t: t, asLang: asLang, LANGS: LANGS, DICTS: DICTS, keys: function () { return Object.keys(en); } };
});
