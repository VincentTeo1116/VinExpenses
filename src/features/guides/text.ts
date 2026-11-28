// The words around the public pages (header, footer, consent bar, calculator labels) in English, Malay and Chinese. Pure data, also used by the build.
import type { PageLang } from './registry.ts';

export interface CalcText {
  fd: { title: string; amount: string; rate: string; tenure: string; unit: string; days: string; months: string; years: string; quickAmounts: string; quickTenures: string; monthsOf: (n: number) => string; paid: string; maturity: string; monthly: string; quarterly: string; yearly: string; result: string; yours: string; interest: string; earned: string; matures: string; worked: string; payments: (n: number) => string; date: string; first24: string; hint: string; share: (n: number) => string };
  loan: { title: string; amount: string; rate: string; years: string; quickAmounts: string; quickTerms: string; yearsOf: (n: number) => string; rateIs: string; reducing: string; flat: string; result: string; borrowed: string; interest: string; totalInterest: string; totalRepaid: string; worked: string; working: (months: number, pay: string, method: string) => string; hint: string; share: (n: number) => string };
  bill: { title: string; food: string; service: string; sst: string; people: string; sstOnService: string; round: string; note: string; result: string; items: string; serviceRow: string; sstRow: string; before: string; rounding: string; each: string; eachExtra: (n: number, amount: string) => string; worked: string; hint: string };
}

export interface UiText {
  locale: string;
  skip: string;
  openApp: string;
  crumbHome: string;
  guide: string;
  calculator: string;
  free: string;
  madeBy: string;
  writtenBy: string;
  designedBy: string;
  portfolioHint: string;
  moreCalculators: string;
  moreGuides: string;
  languages: string;
  checked: (date: string) => string;
  articleCta: { title: string; text: string };
  site: string;
  footer: { aria: string; tagline: string; note: string; brand: string; formerly: string; calculators: string; guides: string; legal: string; about: string; install: string; contact: string; privacy: string; terms: string };
  names: Record<string, string>;
  consent: { aria: string; text: string; details: string; yes: string; no: string };
  calc: CalcText;
}

const en: UiText = {
  locale: 'en-GB',
  skip: 'Skip to content',
  openApp: 'Open the app',
  crumbHome: 'ManaDuit',
  guide: 'Guide',
  calculator: 'Calculator',
  free: 'Free · No sign-up · Nothing is saved',
  madeBy: 'Made by',
  writtenBy: 'Written by',
  designedBy: 'Designed and built by',
  portfolioHint: '(opens the portfolio in a new tab)',
  moreCalculators: 'More calculators',
  moreGuides: 'More guides',
  languages: 'Language',
  checked: (date) => `Last checked ${date}`,
  articleCta: { title: 'Try ManaDuit', text: 'A free expense tracker for Malaysia. Scan receipts, set budgets and keep track of your deposits and loans. No ads.' },
  site: 'Site',
  footer: { aria: 'Footer', tagline: 'A free expense tracker for Malaysia. No ads, and your records stay private.', note: 'Calculators give estimates, not financial advice.', brand: 'ManaDuit', formerly: 'formerly VinExpenses', calculators: 'Calculators', guides: 'Guides', legal: 'Legal', about: 'About', install: 'Install the app', contact: 'Contact', privacy: 'Privacy Policy', terms: 'Terms of Use' },
  names: { 'fd-calculator': 'FD calculator', 'loan-calculator': 'Loan calculator', 'bill-calculator': 'Bill calculator', 'flat-rate-vs-reducing-balance': 'Flat vs reducing balance', 'sst-vs-service-charge': 'SST vs service charge', 'is-fd-interest-taxable': 'Is FD interest taxable?', 'how-to-read-a-malaysian-receipt': 'Reading a receipt' },
  consent: { aria: 'Analytics choice', text: 'May I count visits to these public pages with Google Analytics? It is never used inside the app, and there are no ads.', details: 'Details', yes: 'Yes, that is fine', no: 'No thanks' },
  calc: {
    fd: { title: 'Your deposit', amount: 'Amount (RM)', rate: 'Interest rate a year (%)', tenure: 'Tenure', unit: 'Tenure unit', days: 'days', months: 'months', years: 'years', quickAmounts: 'Quick amounts', quickTenures: 'Quick tenures', monthsOf: (n) => `${n} months`, paid: 'Interest is paid', maturity: 'at maturity', monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year', result: 'You would get back at maturity', yours: 'Your money', interest: 'Interest', earned: 'Interest earned', matures: 'Matures on', worked: 'How this was worked out', payments: (n) => `${n} payments`, date: 'Date', first24: 'The first 24 payments are shown.', hint: 'Enter an amount, a rate and a tenure to see the result.', share: (n) => `Of the total, ${n}% is interest` },
    loan: { title: 'Your loan', amount: 'Loan amount (RM)', rate: 'Interest rate a year (%)', years: 'Years to repay', quickAmounts: 'Quick amounts', quickTerms: 'Quick terms', yearsOf: (n) => `${n} years`, rateIs: 'The rate is', reducing: 'reducing balance', flat: 'flat', result: 'You would pay each month', borrowed: 'Borrowed', interest: 'Interest', totalInterest: 'Total interest', totalRepaid: 'Total repaid', worked: 'How this was worked out', working: (months, pay, method) => `${months} monthly payments of about ${pay} (${method})`, hint: 'Enter an amount, a rate and the years to see the result.', share: (n) => `Of everything you repay, ${n}% is interest` },
    bill: { title: 'Your bill', food: 'Food and drink total (RM)', service: 'Service charge (%)', sst: 'SST (%)', people: 'Number of people', sstOnService: 'Charge SST on the service charge too (some bills do)', round: 'Round the total to the nearest 5 sen', note: 'Usual restaurant rates are filled in: 10% service charge and 6% SST. Change them, or type 0 if the shop does not charge them.', result: 'You pay', items: 'Food and drink', serviceRow: 'Service charge', sstRow: 'SST', before: 'Total before rounding', rounding: 'Rounding', each: 'Each person pays', eachExtra: (n, amount) => `${n} of you pay ${amount}`, worked: 'How this was worked out', hint: 'Type the food and drink total from your bill.' },
  },
};

const ms: UiText = {
  locale: 'ms-MY',
  skip: 'Langkau ke kandungan',
  openApp: 'Buka aplikasi',
  crumbHome: 'ManaDuit',
  guide: 'Panduan',
  calculator: 'Kalkulator',
  free: 'Percuma · Tanpa daftar · Tiada apa disimpan',
  madeBy: 'Dibuat oleh',
  writtenBy: 'Ditulis oleh',
  designedBy: 'Direka dan dibina oleh',
  portfolioHint: '(membuka portfolio dalam tab baharu)',
  moreCalculators: 'Kalkulator lain',
  moreGuides: 'Panduan lain',
  languages: 'Bahasa',
  checked: (date) => `Disemak kali terakhir ${date}`,
  articleCta: { title: 'Cuba ManaDuit', text: 'Penjejak perbelanjaan percuma untuk Malaysia. Imbas resit, tetapkan bajet dan jejak deposit serta pinjaman anda. Tiada iklan.' },
  site: 'Laman',
  footer: { aria: 'Pautan bawah', tagline: 'Penjejak perbelanjaan percuma untuk Malaysia. Tiada iklan, dan rekod anda kekal peribadi.', note: 'Kalkulator memberi anggaran, bukan nasihat kewangan.', brand: 'ManaDuit', formerly: 'sebelum ini VinExpenses', calculators: 'Kalkulator', guides: 'Panduan', legal: 'Perundangan', about: 'Tentang', install: 'Pasang aplikasi', contact: 'Hubungi', privacy: 'Dasar Privasi', terms: 'Terma Penggunaan' },
  names: { 'fd-calculator': 'Kalkulator FD', 'loan-calculator': 'Kalkulator pinjaman', 'bill-calculator': 'Kalkulator bil', 'flat-rate-vs-reducing-balance': 'Kadar rata vs baki berkurangan', 'sst-vs-service-charge': 'SST vs caj perkhidmatan', 'is-fd-interest-taxable': 'Faedah FD dan cukai', 'how-to-read-a-malaysian-receipt': 'Baca resit' },
  consent: { aria: 'Pilihan analitik', text: 'Boleh saya kira lawatan ke halaman awam ini dengan Google Analytics? Ia tidak pernah digunakan dalam aplikasi, dan tiada iklan.', details: 'Butiran', yes: 'Ya, boleh', no: 'Tidak, terima kasih' },
  calc: {
    fd: { title: 'Deposit anda', amount: 'Jumlah (RM)', rate: 'Kadar faedah setahun (%)', tenure: 'Tempoh', unit: 'Unit tempoh', days: 'hari', months: 'bulan', years: 'tahun', quickAmounts: 'Jumlah pantas', quickTenures: 'Tempoh pantas', monthsOf: (n) => `${n} bulan`, paid: 'Faedah dibayar', maturity: 'semasa matang', monthly: 'setiap bulan', quarterly: 'setiap 3 bulan', yearly: 'setiap tahun', result: 'Anda akan terima semasa matang', yours: 'Wang anda', interest: 'Faedah', earned: 'Faedah diperoleh', matures: 'Matang pada', worked: 'Cara ia dikira', payments: (n) => `${n} bayaran`, date: 'Tarikh', first24: '24 bayaran pertama ditunjukkan.', hint: 'Masukkan jumlah, kadar dan tempoh untuk lihat hasilnya.', share: (n) => `Daripada jumlah keseluruhan, ${n}% ialah faedah` },
    loan: { title: 'Pinjaman anda', amount: 'Jumlah pinjaman (RM)', rate: 'Kadar faedah setahun (%)', years: 'Tahun untuk bayar balik', quickAmounts: 'Jumlah pantas', quickTerms: 'Tempoh pantas', yearsOf: (n) => `${n} tahun`, rateIs: 'Kadarnya ialah', reducing: 'baki berkurangan', flat: 'rata', result: 'Anda akan bayar setiap bulan', borrowed: 'Dipinjam', interest: 'Faedah', totalInterest: 'Jumlah faedah', totalRepaid: 'Jumlah dibayar balik', worked: 'Cara ia dikira', working: (months, pay, method) => `${months} bayaran bulanan lebih kurang ${pay} (${method})`, hint: 'Masukkan jumlah, kadar dan tahun untuk lihat hasilnya.', share: (n) => `Daripada semua yang anda bayar balik, ${n}% ialah faedah` },
    bill: { title: 'Bil anda', food: 'Jumlah makanan dan minuman (RM)', service: 'Caj perkhidmatan (%)', sst: 'SST (%)', people: 'Bilangan orang', sstOnService: 'Kenakan SST atas caj perkhidmatan juga (ada bil yang buat begitu)', round: 'Genapkan jumlah ke 5 sen terdekat', note: 'Kadar biasa restoran sudah diisi: caj perkhidmatan 10% dan SST 6%. Tukar, atau taip 0 kalau kedai tidak mengenakannya.', result: 'Anda bayar', items: 'Makanan dan minuman', serviceRow: 'Caj perkhidmatan', sstRow: 'SST', before: 'Jumlah sebelum penggenapan', rounding: 'Penggenapan', each: 'Setiap orang bayar', eachExtra: (n, amount) => `${n} orang bayar ${amount}`, worked: 'Cara ia dikira', hint: 'Taip jumlah makanan dan minuman daripada bil anda.' },
  },
};

const zh: UiText = {
  locale: 'zh-CN',
  skip: '跳到正文',
  openApp: '打开应用',
  crumbHome: 'ManaDuit',
  guide: '指南',
  calculator: '计算器',
  free: '免费 · 免注册 · 不保存任何数据',
  madeBy: '制作：',
  writtenBy: '作者：',
  designedBy: '设计与开发：',
  portfolioHint: '（在新分页打开作品集）',
  moreCalculators: '更多计算器',
  moreGuides: '更多指南',
  languages: '语言',
  checked: (date) => `最后核对：${date}`,
  articleCta: { title: '试试 ManaDuit', text: '马来西亚专用的免费记账工具。扫描收据、设预算，追踪你的定存和贷款。没有广告。' },
  site: '网站',
  footer: { aria: '页脚', tagline: '马来西亚专用的免费记账工具。没有广告，你的记录保持私密。', note: '计算器只提供估算，不是理财建议。', brand: 'ManaDuit', formerly: '前称 VinExpenses', calculators: '计算器', guides: '指南', legal: '法律条款', about: '关于', install: '安装应用', contact: '联系', privacy: '隐私政策', terms: '使用条款' },
  names: { 'fd-calculator': '定存计算器', 'loan-calculator': '贷款计算器', 'bill-calculator': '账单计算器', 'flat-rate-vs-reducing-balance': '固定利率 vs 递减余额', 'sst-vs-service-charge': 'SST vs 服务费', 'is-fd-interest-taxable': '定存利息要缴税吗', 'how-to-read-a-malaysian-receipt': '看懂收据' },
  consent: { aria: '分析选项', text: '我可以用 Google Analytics 统计这些公开页面的访问次数吗？应用内部从不使用它，也没有广告。', details: '详情', yes: '好的，可以', no: '不用了，谢谢' },
  calc: {
    fd: { title: '你的存款', amount: '金额（RM）', rate: '年利率（%）', tenure: '存期', unit: '存期单位', days: '天', months: '个月', years: '年', quickAmounts: '快速选金额', quickTenures: '快速选存期', monthsOf: (n) => `${n} 个月`, paid: '利息发放方式', maturity: '到期一次过', monthly: '每月', quarterly: '每 3 个月', yearly: '每年', result: '到期时你会拿回', yours: '你的本金', interest: '利息', earned: '赚到的利息', matures: '到期日', worked: '怎么算出来的', payments: (n) => `${n} 次发放`, date: '日期', first24: '只显示前 24 次。', hint: '输入金额、利率和存期，就能看到结果。', share: (n) => `总额中有 ${n}% 是利息` },
    loan: { title: '你的贷款', amount: '贷款金额（RM）', rate: '年利率（%）', years: '还款年数', quickAmounts: '快速选金额', quickTerms: '快速选年数', yearsOf: (n) => `${n} 年`, rateIs: '利率类型', reducing: '递减余额', flat: '固定利率', result: '你每月要还', borrowed: '借款本金', interest: '利息', totalInterest: '总利息', totalRepaid: '总还款额', worked: '怎么算出来的', working: (months, pay, method) => `共 ${months} 期，每月约 ${pay}（${method}）`, hint: '输入金额、利率和年数，就能看到结果。', share: (n) => `你所还的钱中，有 ${n}% 是利息` },
    bill: { title: '你的账单', food: '饮食合计（RM）', service: '服务费（%）', sst: 'SST（%）', people: '人数', sstOnService: '连服务费也加收 SST（有些账单是这样算）', round: '合计凑整到最接近的 5 仙', note: '已填上餐厅常见的税率：服务费 10%，SST 6%。可以修改，如果店家不收就填 0。', result: '你要付', items: '饮食', serviceRow: '服务费', sstRow: 'SST', before: '凑整前合计', rounding: '凑整', each: '每人付', eachExtra: (n, amount) => `其中 ${n} 人付 ${amount}`, worked: '怎么算出来的', hint: '输入账单上的饮食合计。' },
  },
};

export const UI: Record<PageLang, UiText> = { en, ms, zh };
