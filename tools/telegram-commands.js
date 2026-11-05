// The "/" command menu of the bot, in each language Telegram can show it in.
// Telegram picks the list that matches the person's app language and falls back to `default` (English).
// Rules from Telegram: command names are lower-case letters, digits and "_" (1-32); descriptions are 3-256 characters.

const COMMANDS = {
    default: [
        ['add', 'Add an expense'],
        ['today', "Today's spending"],
        ['week', 'This week, day by day'],
        ['month', 'This month at a glance'],
        ['top', 'Top categories and places'],
        ['recent', 'Edit or delete a recent expense'],
        ['undo', 'Remove the last expense added here'],
        ['settings', 'Language, weekly summary, disconnect'],
        ['menu', 'Show the bottom menu'],
        ['help', 'How to add an expense'],
        ['cancel', 'Cancel what I asked you to type'],
    ],
    ms: [
        ['add', 'Tambah perbelanjaan'],
        ['today', 'Perbelanjaan hari ini'],
        ['week', 'Minggu ini, hari demi hari'],
        ['month', 'Ringkasan bulan ini'],
        ['top', 'Kategori dan tempat teratas'],
        ['recent', 'Ubah atau padam perbelanjaan terkini'],
        ['undo', 'Buang perbelanjaan terakhir di sini'],
        ['settings', 'Bahasa, ringkasan mingguan, putus sambungan'],
        ['menu', 'Tunjuk menu di bawah'],
        ['help', 'Cara menambah perbelanjaan'],
        ['cancel', 'Batalkan apa yang diminta'],
    ],
    zh: [
        ['add', '记一笔支出'],
        ['today', '今天的支出'],
        ['week', '本周每天的支出'],
        ['month', '本月概览'],
        ['top', '支出最多的分类和商家'],
        ['recent', '修改或删除最近的支出'],
        ['undo', '撤销在这里记的上一笔'],
        ['settings', '语言、每周摘要、断开连接'],
        ['menu', '显示底部菜单'],
        ['help', '如何记账'],
        ['cancel', '取消刚才的输入请求'],
    ],
};

module.exports = { COMMANDS };
