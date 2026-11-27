// The words of the calculator pages (fixed deposit, loan, bill) in English, Malay and Chinese. Plain data and functions with no React, CSS or "@/" imports,
// because the build also reads this file to write the same text into each page's HTML. Every number in the examples comes from the app's own maths.
import { calcFd, calcLoan } from '../finance/finance.ts';
import { calcBill } from './bill.ts';
import { pathFor, type CalculatorSlug, type GuideSlug, type PageLang } from './registry.ts';

export interface GuideSection {
  id: string;
  heading: string;
  paragraphs: string[];
}
export interface GuideTable {
  caption: string;
  head: string[];
  rows: string[][];
  note: string;
}
export interface Guide {
  slug: CalculatorSlug;
  lang: PageLang;
  path: string;
  title: string;
  description: string;
  heading: string;
  answer: string;
  sections: GuideSection[];
  table: GuideTable;
  related: GuideSlug[];
  cta: { title: string; text: string };
  disclaimer: string;
}

/** 1234.5 -> "RM 1,234.50" (written here so this file needs no helper from the app). */
export function rm(value: number): string {
  const [whole, cents] = value.toFixed(2).split('.') as [string, string];
  return `RM ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

const START = '2026-01-01'; // the examples start on a fixed day so the page never changes between builds

function fd(amount: number, rate: number, months: number) {
  const r = calcFd({ amount, rate, tenureValue: months, tenureUnit: 'months', startDate: START, maturityDate: '', payout: 'maturity', taxRate: 0, dayBasis: 365 });
  return r.ok ? { interest: r.grossInterest, days: r.days } : { interest: 0, days: 0 };
}
function loan(amount: number, rate: number, years: number, method: 'reducing' | 'flat') {
  const r = calcLoan({ amount, rate, termValue: years, termUnit: 'years', method, firstPaymentDate: '2030-01-15', fees: 0 });
  return r.ok ? r : null;
}
const bill = (food: number) => calcBill({ itemsCents: Math.round(food * 100), servicePercent: 10, sstPercent: 6 });

const FD_RATE = 3.5;
const FD_AMOUNTS = [5000, 10000, 50000];
const FD_MONTHS = [3, 6, 12];
const LOAN_RATE = 4.2;
const LOAN_AMOUNTS = [100000, 300000, 500000];
const LOAN_YEARS = [5, 10, 25];
const BILL_FOODS = [21, 50, 100, 200];

const year = fd(10000, FD_RATE, 12);
const quarter = fd(10000, FD_RATE, 3);
const flat = loan(100000, 4, 5, 'flat');
const reducing = loan(100000, 4, 5, 'reducing');
const payment25 = loan(300000, LOAN_RATE, 25, 'reducing')?.instalment ?? 0;
const sample = bill(21);
const sampleTotal = sample.totalCents / 100;
const sampleBefore = sample.beforeRoundingCents / 100;

const fdRows = (): string[][] => FD_AMOUNTS.map((a) => [rm(a), ...FD_MONTHS.map((m) => rm(fd(a, FD_RATE, m).interest))]);
const loanRows = (): string[][] => LOAN_AMOUNTS.map((a) => [rm(a), ...LOAN_YEARS.map((y) => rm(loan(a, LOAN_RATE, y, 'reducing')?.instalment ?? 0))]);
const billRows = (): string[][] =>
  BILL_FOODS.map((f) => {
    const b = bill(f);
    return [rm(f), rm(b.serviceCents / 100), rm(b.sstCents / 100), rm(b.totalCents / 100)];
  });
type Draft = Omit<Guide, 'lang' | 'path'>;
const makers: Record<PageLang, () => Draft[]> = {
  en: () => [
      {
        slug: 'fd-calculator',
        title: 'Fixed Deposit Calculator Malaysia: Interest and Maturity | ManaDuit',
        description: 'Free fixed deposit (FD) calculator for Malaysia. Enter the amount, rate and tenure to see your interest and the total at maturity. Nothing is saved or sent.',
        heading: 'Fixed deposit calculator for Malaysia',
        answer: `A fixed deposit earns simple interest: amount × rate × days ÷ 365. ${rm(10000)} at ${FD_RATE}% a year for 12 months earns ${rm(year.interest)}, so you get back ${rm(10000 + year.interest)}. Type your own figures below.`,
        sections: [
          { id: 'how', heading: 'How fixed deposit interest is worked out', paragraphs: ['Most Malaysian fixed deposits pay simple interest, not compound interest. The bank multiplies the amount you place by the yearly rate, then by the number of days the money stays, and divides by 365. Some banks divide by 360, so check which one your bank uses.', `Example: ${rm(10000)} at ${FD_RATE}% a year for 3 months (${quarter.days} days) earns ${rm(10000)} × ${FD_RATE}% × ${quarter.days} ÷ 365 = ${rm(quarter.interest)}. For 12 months (${year.days} days) the same deposit earns ${rm(year.interest)}.`, 'The calculator rounds each amount to the sen, the way a statement does, so the figures add up exactly.'] },
          { id: 'payout', heading: 'Interest at maturity, monthly, quarterly or yearly', paragraphs: ['You can choose when the interest is paid. Paid at maturity, you receive it with your money on the last day. Paid monthly, quarterly or yearly, you receive a part of it on each date and the rest on the last day.', 'The total interest is the same either way, because the interest is simple. What changes is when the money reaches your account. The calculator lists each payment date when you choose a regular payout.'] },
          { id: 'tax', heading: 'Tax on fixed deposit interest', paragraphs: ["PwC Malaysia's tax booklet lists interest or profit that a resident individual earns from deposits in licensed institutions as exempt from income tax. Companies and people who live abroad can be treated differently, and rules change. Check with the Inland Revenue Board (LHDN) or your bank before relying on it.", 'The calculator assumes no tax.'] },
          { id: 'islamic', heading: 'Islamic term deposits', paragraphs: ['An Islamic term deposit pays a profit rate instead of an interest rate. The profit rate your bank quotes is usually an expected rate, so the calculator gives an estimate, and your bank’s final figure can differ.'] },
        ],
        table: { caption: `Interest earned at ${FD_RATE}% a year, paid at maturity`, head: ['Amount', ...FD_MONTHS.map((m) => `${m} months`)], rows: fdRows(), note: 'Deposits placed on 1 January 2026, 365-day year, no tax. Your own rate and dates will give different figures.' },
        related: ['loan-calculator', 'bill-calculator', 'is-fd-interest-taxable'],
        cta: { title: 'Keep track of your deposits', text: 'Save each fixed deposit in ManaDuit and get a reminder before it matures. It is free, and there are no ads.' },
        disclaimer: 'An estimate, not financial advice. Your bank’s own figures are the final ones.',
      },
      {
        slug: 'loan-calculator',
        title: 'Loan Calculator Malaysia: Monthly Payment and Interest | ManaDuit',
        description: 'Free loan calculator for Malaysia. See your monthly payment, total interest and total repaid for a home, car or personal loan. Nothing is saved or sent.',
        heading: 'Loan calculator for Malaysia',
        answer: `On a reducing-balance loan, a ${rm(300000)} loan at ${LOAN_RATE}% for 25 years costs ${rm(payment25)} a month. Change the figures below to try your own loan.`,
        sections: [
          { id: 'how', heading: 'How the monthly payment is worked out', paragraphs: ['Most home and car loans in Malaysia charge interest on the balance you still owe, which is called a reducing balance. Each month you pay a fixed amount. Early on, most of it is interest. Later, most of it pays off what you borrowed.', 'The payment follows a standard formula that uses the amount borrowed, the monthly interest rate (the yearly rate divided by 12) and the number of monthly payments. The calculator rounds to the sen.'] },
          { id: 'flat', heading: 'Flat rate and reducing balance are different', paragraphs: ['A flat rate charges interest on the full amount for the whole loan, even though you keep paying part of it back. That makes a flat rate cost more than the same number quoted as a reducing-balance rate.', flat && reducing ? `Example: ${rm(100000)} over 5 years at 4%. As a flat rate you pay ${rm(flat.instalment)} a month and ${rm(flat.totalInterest)} in interest. As a reducing-balance rate you pay ${rm(reducing.instalment)} a month and ${rm(reducing.totalInterest)} in interest. The calculator has a switch for both.` : 'The calculator has a switch for both.', 'News reports say hire purchase (car loans) moved from flat rates to reducing balance with a quoted effective rate from 1 June 2026, so ask your bank which kind of rate any offer uses.', 'Before you compare two offers, check which kind of rate each one quotes.'] },
          { id: 'fees', heading: 'What the monthly payment leaves out', paragraphs: ['The payment shown here covers the amount borrowed and its interest only. Legal fees, stamp duty, insurance and processing fees come on top, and they differ from bank to bank. Ask your bank for the total cost before you sign.'] },
        ],
        table: { caption: `Monthly payment at ${LOAN_RATE}% a year, reducing balance`, head: ['Loan amount', ...LOAN_YEARS.map((y) => `${y} years`)], rows: loanRows(), note: 'Fees, stamp duty and insurance are not included. Your own rate and term will give different figures.' },
        related: ['fd-calculator', 'flat-rate-vs-reducing-balance', 'bill-calculator'],
        cta: { title: 'See every payment, and never miss one', text: 'Save your loan in ManaDuit to see the full repayment plan and get a reminder before each payment is due. It is free, and there are no ads.' },
        disclaimer: 'An estimate for a reducing-balance or flat-rate loan. Not financial advice; your bank’s figures can differ.',
      },
      {
        slug: 'bill-calculator',
        title: 'Bill Calculator Malaysia: Service Charge, SST and Rounding | ManaDuit',
        description: 'Free restaurant bill calculator for Malaysia. Add 10% service charge and 6% SST, round to the nearest 5 sen and split the bill between friends.',
        heading: 'Bill calculator for Malaysia',
        answer: `A ${rm(21)} meal with 10% service charge and 6% SST comes to ${rm(sampleBefore)}, which rounds to ${rm(sampleTotal)}. Type your own bill below.`,
        sections: [
          { id: 'how', heading: 'How the bill is built', paragraphs: ['Start with the food and drink total. Add the service charge, usually 10% of that total. Add SST, which is 6% for food and drink.', "Royal Malaysian Customs' guide for the food trade says the tax is calculated on the price without the service charge, so that is how this calculator works by default. Some bills add SST on top of the service charge as well, so there is a tick box for that.", 'Last comes the rounding. Bank Negara and the Ministry of Domestic Trade set a 5-sen rounding on the bill total: endings of 1 or 2 sen go down, 3 or 4 go up, 6 or 7 go down and 8 or 9 go up.'] },
          { id: 'defaults', heading: 'Not every shop charges both', paragraphs: ['The calculator starts with the usual restaurant rates, 10% service charge and 6% SST. Hawker stalls and small shops are often not registered for SST, and some places add no service charge, so change a percentage, or type 0, to match your bill.', 'A menu price marked ++ means service charge and tax are added on top. A price marked nett already includes them.'] },
          { id: 'split', heading: 'Splitting the bill', paragraphs: ['Type the number of people and the total is shared equally. The shares always add up to the exact total, so if it does not divide evenly, one or two people pay one sen more.'] },
        ],
        table: { caption: 'Examples with 10% service charge and 6% SST', head: ['Food and drink', 'Service charge', 'SST', 'You pay'], rows: billRows(), note: 'SST on the price without the service charge, total rounded to the nearest 5 sen.' },
        related: ['sst-vs-service-charge', 'how-to-read-a-malaysian-receipt', 'loan-calculator'],
        cta: { title: 'Scan the receipt instead', text: 'ManaDuit reads the total, shop and date from a photo of a receipt, so you do not have to type them. It is free, and there are no ads.' },
        disclaimer: 'An estimate. Your bill and the shop’s own figures are the final ones.',
      },
  ],
  ms: () => [
    {
      slug: 'fd-calculator',
      title: 'Kalkulator Deposit Tetap Malaysia: Faedah dan Nilai Matang | ManaDuit',
      description: 'Kalkulator deposit tetap (FD) percuma untuk Malaysia. Masukkan jumlah, kadar dan tempoh untuk lihat faedah dan jumlah semasa matang.',
      heading: 'Kalkulator deposit tetap untuk Malaysia',
      answer: `Deposit tetap memberi faedah mudah: jumlah × kadar × hari ÷ 365. ${rm(10000)} pada kadar ${FD_RATE}% setahun selama 12 bulan menghasilkan ${rm(year.interest)}, jadi anda terima semula ${rm(10000 + year.interest)}. Taip angka anda sendiri di bawah.`,
      sections: [
        { id: 'how', heading: 'Cara faedah deposit tetap dikira', paragraphs: ['Kebanyakan deposit tetap di Malaysia memberi faedah mudah, bukan faedah kompaun. Bank darabkan jumlah deposit dengan kadar tahunan, kemudian dengan bilangan hari wang itu disimpan, dan bahagi dengan 365. Ada bank yang bahagi dengan 360, jadi semak yang mana satu digunakan bank anda.', `Contoh: ${rm(10000)} pada kadar ${FD_RATE}% setahun selama 3 bulan (${quarter.days} hari) menghasilkan ${rm(10000)} × ${FD_RATE}% × ${quarter.days} ÷ 365 = ${rm(quarter.interest)}. Untuk 12 bulan (${year.days} hari), deposit yang sama menghasilkan ${rm(year.interest)}.`, 'Kalkulator ini membundarkan setiap jumlah kepada sen, seperti penyata bank, jadi angkanya tepat jumlahnya.'] },
        { id: 'payout', heading: 'Faedah dibayar semasa matang, bulanan, suku tahunan atau tahunan', paragraphs: ['Anda boleh pilih bila faedah dibayar. Jika dibayar semasa matang, anda terima bersama wang anda pada hari terakhir. Jika dibayar setiap bulan, suku tahun atau tahun, anda terima sebahagiannya pada setiap tarikh dan baki pada hari terakhir.', 'Jumlah faedah sama sahaja sama ada cara mana pun, kerana faedahnya mudah. Yang berubah ialah bila wang itu masuk ke akaun anda. Kalkulator menyenaraikan setiap tarikh bayaran bila anda pilih bayaran berkala.'] },
        { id: 'tax', heading: 'Cukai ke atas faedah deposit tetap', paragraphs: ['Buku Cukai Malaysia PwC menyenaraikan faedah atau keuntungan yang diterima individu pemastautin daripada deposit di institusi berlesen sebagai dikecualikan daripada cukai pendapatan. Syarikat dan orang yang tinggal di luar negara mungkin dilayan berbeza, dan peraturan berubah. Semak dengan LHDN atau bank anda sebelum bergantung padanya.', 'Kalkulator ini menganggap tiada cukai.'] },
        { id: 'islamic', heading: 'Deposit berjangka Islam', paragraphs: ['Deposit berjangka Islam membayar kadar keuntungan, bukan kadar faedah. Kadar keuntungan yang bank sebut biasanya kadar jangkaan, jadi kalkulator ini memberi anggaran, dan angka akhir bank anda mungkin berbeza.'] },
      ],
      table: { caption: `Faedah diperoleh pada kadar ${FD_RATE}% setahun, dibayar semasa matang`, head: ['Jumlah', ...FD_MONTHS.map((m) => `${m} bulan`)], rows: fdRows(), note: 'Deposit diletakkan pada 1 Januari 2026, tahun 365 hari, tanpa cukai. Kadar dan tarikh anda sendiri akan memberi angka berbeza.' },
      related: ['loan-calculator', 'bill-calculator', 'is-fd-interest-taxable'],
      cta: { title: 'Jejak deposit anda', text: 'Simpan setiap deposit tetap dalam ManaDuit dan dapatkan peringatan sebelum ia matang. Percuma, dan tiada iklan.' },
      disclaimer: 'Anggaran, bukan nasihat kewangan. Angka daripada bank anda sendiri yang menjadi muktamad.',
    },
    {
      slug: 'loan-calculator',
      title: 'Kalkulator Pinjaman Malaysia: Bayaran Bulanan dan Faedah | ManaDuit',
      description: 'Kalkulator pinjaman percuma untuk Malaysia. Lihat bayaran bulanan, jumlah faedah dan jumlah dibayar balik untuk pinjaman rumah, kereta atau peribadi.',
      heading: 'Kalkulator pinjaman untuk Malaysia',
      answer: `Pada pinjaman baki berkurangan, pinjaman ${rm(300000)} pada ${LOAN_RATE}% selama 25 tahun menelan belanja ${rm(payment25)} sebulan. Ubah angka di bawah untuk cuba pinjaman anda sendiri.`,
      sections: [
        { id: 'how', heading: 'Cara bayaran bulanan dikira', paragraphs: ['Kebanyakan pinjaman rumah dan kereta di Malaysia mengenakan faedah atas baki yang masih anda hutang, dipanggil baki berkurangan. Setiap bulan anda bayar jumlah tetap. Pada awalnya, kebanyakannya ialah faedah. Kemudian, kebanyakannya melunaskan apa yang anda pinjam.', 'Bayaran itu mengikut formula piawai yang menggunakan jumlah pinjaman, kadar faedah bulanan (kadar tahunan dibahagi 12) dan bilangan bayaran bulanan. Kalkulator ini membundarkan kepada sen.'] },
        { id: 'flat', heading: 'Kadar rata dan baki berkurangan tidak sama', paragraphs: ['Kadar rata mengenakan faedah atas jumlah penuh untuk seluruh tempoh pinjaman, walaupun anda terus membayar balik sebahagiannya. Itu menjadikan kadar rata lebih mahal daripada nombor yang sama disebut sebagai kadar baki berkurangan.', flat && reducing ? `Contoh: ${rm(100000)} selama 5 tahun pada 4%. Sebagai kadar rata, anda bayar ${rm(flat.instalment)} sebulan dan ${rm(flat.totalInterest)} faedah. Sebagai kadar baki berkurangan, anda bayar ${rm(reducing.instalment)} sebulan dan ${rm(reducing.totalInterest)} faedah. Kalkulator ini ada suis untuk kedua-duanya.` : 'Kalkulator ini ada suis untuk kedua-duanya.', 'Laporan berita menyatakan sewa beli (pinjaman kereta) beralih daripada kadar rata kepada baki berkurangan dengan kadar efektif mulai 1 Jun 2026, jadi tanya bank anda kadar jenis apa yang digunakan dalam sebarang tawaran.', 'Sebelum bandingkan dua tawaran, semak jenis kadar yang dinyatakan setiap satu.'] },
        { id: 'fees', heading: 'Apa yang tidak termasuk dalam bayaran bulanan', paragraphs: ['Bayaran yang ditunjukkan di sini hanya merangkumi jumlah pinjaman dan faedahnya. Yuran guaman, duti setem, insurans dan yuran pemprosesan ditambah di atas itu, dan berbeza dari bank ke bank. Tanya bank anda jumlah kos keseluruhan sebelum anda tandatangan.'] },
      ],
      table: { caption: `Bayaran bulanan pada ${LOAN_RATE}% setahun, baki berkurangan`, head: ['Jumlah pinjaman', ...LOAN_YEARS.map((y) => `${y} tahun`)], rows: loanRows(), note: 'Yuran, duti setem dan insurans tidak termasuk. Kadar dan tempoh anda sendiri akan memberi angka berbeza.' },
      related: ['fd-calculator', 'flat-rate-vs-reducing-balance', 'bill-calculator'],
      cta: { title: 'Lihat setiap bayaran, dan jangan terlepas satu pun', text: 'Simpan pinjaman anda dalam ManaDuit untuk lihat jadual bayaran penuh dan dapat peringatan sebelum setiap bayaran perlu dibuat. Percuma, dan tiada iklan.' },
      disclaimer: 'Anggaran untuk pinjaman baki berkurangan atau kadar rata. Bukan nasihat kewangan; angka bank anda boleh berbeza.',
    },
    {
      slug: 'bill-calculator',
      title: 'Kalkulator Bil Malaysia: Caj Perkhidmatan, SST dan Penggenapan | ManaDuit',
      description: 'Kalkulator bil restoran percuma untuk Malaysia. Tambah caj perkhidmatan 10% dan SST 6%, genapkan ke 5 sen terdekat dan bahagikan bil antara kawan.',
      heading: 'Kalkulator bil untuk Malaysia',
      answer: `Hidangan ${rm(21)} dengan caj perkhidmatan 10% dan SST 6% menjadi ${rm(sampleBefore)}, yang digenapkan kepada ${rm(sampleTotal)}. Taip bil anda sendiri di bawah.`,
      sections: [
        { id: 'how', heading: 'Cara bil dibina', paragraphs: ['Mulakan dengan jumlah makanan dan minuman. Tambah caj perkhidmatan, biasanya 10% daripada jumlah itu. Tambah SST, iaitu 6% untuk makanan dan minuman.', 'Panduan Jabatan Kastam Diraja Malaysia untuk industri makanan menyatakan cukai dikira atas harga tanpa caj perkhidmatan, jadi itulah cara kalkulator ini berfungsi secara lalai. Ada bil yang menambah SST atas caj perkhidmatan juga, jadi ada kotak semak untuk itu.', 'Akhir sekali penggenapan. Bank Negara dan Kementerian Perdagangan Dalam Negeri menetapkan penggenapan 5 sen pada jumlah bil: akhiran 1 atau 2 sen ke bawah, 3 atau 4 ke atas, 6 atau 7 ke bawah dan 8 atau 9 ke atas.'] },
        { id: 'defaults', heading: 'Bukan semua kedai kenakan kedua-duanya', paragraphs: ['Kalkulator bermula dengan kadar restoran biasa, caj perkhidmatan 10% dan SST 6%. Gerai dan kedai kecil selalunya tidak berdaftar SST, dan ada tempat yang tidak tambah caj perkhidmatan, jadi tukar peratusan, atau taip 0, supaya sama dengan bil anda.', 'Harga menu bertanda ++ bermaksud caj perkhidmatan dan cukai ditambah di atasnya. Harga bertanda nett sudah termasuk kedua-duanya.'] },
        { id: 'split', heading: 'Bahagi bil', paragraphs: ['Taip bilangan orang dan jumlahnya dikongsi sama rata. Bahagian sentiasa menjadi jumlah tepat, jadi jika tidak boleh dibahagi sama rata, seorang atau dua orang bayar lebih satu sen.'] },
      ],
      table: { caption: 'Contoh dengan caj perkhidmatan 10% dan SST 6%', head: ['Makanan dan minuman', 'Caj perkhidmatan', 'SST', 'Anda bayar'], rows: billRows(), note: 'SST atas harga tanpa caj perkhidmatan, jumlah digenapkan ke 5 sen terdekat.' },
      related: ['sst-vs-service-charge', 'how-to-read-a-malaysian-receipt', 'loan-calculator'],
      cta: { title: 'Imbas resit sahaja', text: 'ManaDuit membaca jumlah, kedai dan tarikh daripada gambar resit, jadi anda tak perlu menaipnya. Percuma, dan tiada iklan.' },
      disclaimer: 'Anggaran. Bil dan angka kedai anda sendiri yang menjadi muktamad.',
    },
  ],
  zh: () => [
    {
      slug: 'fd-calculator',
      title: '马来西亚定期存款计算器：利息与到期金额 | ManaDuit',
      description: '免费的马来西亚定期存款（定存）计算器。输入金额、利率和存期，就能看到利息和到期金额。不会保存也不会发送任何数据。',
      heading: '马来西亚定期存款计算器',
      answer: `定期存款付的是单利：金额 × 利率 × 天数 ÷ 365。${rm(10000)}，年利率 ${FD_RATE}%，存 12 个月，利息是 ${rm(year.interest)}，到期拿回 ${rm(10000 + year.interest)}。在下面输入你自己的数字。`,
      sections: [
        { id: 'how', heading: '定期存款的利息怎么算', paragraphs: ['马来西亚大部分定期存款付的是单利，不是复利。银行把你存的金额乘以年利率，再乘以存放的天数，最后除以 365。有些银行除以 360，所以要查清楚你的银行用哪一个。', `例子：${rm(10000)}，年利率 ${FD_RATE}%，存 3 个月（${quarter.days} 天），利息是 ${rm(10000)} × ${FD_RATE}% × ${quarter.days} ÷ 365 = ${rm(quarter.interest)}。存 12 个月（${year.days} 天），同样的存款赚 ${rm(year.interest)}。`, '计算器会像银行月结单那样，把每个金额算到仙，所以数字加起来一定对得上。'] },
        { id: 'payout', heading: '利息到期一次过，还是每月、每季、每年领', paragraphs: ['你可以选择利息什么时候发。到期一次过的话，最后一天连本金一起拿。每月、每季或每年领的话，每个日期拿一部分，剩下的最后一天拿。', '不管哪一种，总利息都一样，因为用的是单利。不同的只是钱什么时候进你的户口。选择定期发放的话，计算器会列出每一个发放日期。'] },
        { id: 'tax', heading: '定存利息的税', paragraphs: ['普华永道（PwC）马来西亚税务手册把「居民个人从持牌金融机构的存款所得到的利息或盈利」列为免缴所得税。公司和住在国外的人可能适用不同的规定，而且规定会改变，所以在依赖这个说法之前，请先向内陆税收局（LHDN）或你的银行确认。', '计算器假设不用缴税。'] },
        { id: 'islamic', heading: '伊斯兰定期存款', paragraphs: ['伊斯兰定期存款付的是盈利率，不是利率。银行说的盈利率通常是预期的，所以计算器给的是估算，银行最后的数字可能不一样。'] },
      ],
      table: { caption: `年利率 ${FD_RATE}%，到期一次过的利息`, head: ['金额', ...FD_MONTHS.map((m) => `${m} 个月`)], rows: fdRows(), note: '存款日期为 2026 年 1 月 1 日，一年按 365 天，不扣税。你自己的利率和日期会得到不同的数字。' },
      related: ['loan-calculator', 'bill-calculator', 'is-fd-interest-taxable'],
      cta: { title: '追踪你的定存', text: '把每一笔定存记在 ManaDuit，到期前收到提醒。免费，没有广告。' },
      disclaimer: '只是估算，不是理财建议。以银行自己的数字为准。',
    },
    {
      slug: 'loan-calculator',
      title: '马来西亚贷款计算器：每月还款与利息 | ManaDuit',
      description: '免费的马来西亚贷款计算器。算出房贷、车贷或个人贷款的每月还款、总利息和总还款额。不会保存也不会发送任何数据。',
      heading: '马来西亚贷款计算器',
      answer: `递减余额的话，${rm(300000)}、年利率 ${LOAN_RATE}%、25 年的贷款，每月要还 ${rm(payment25)}。改下面的数字，试试你自己的贷款。`,
      sections: [
        { id: 'how', heading: '每月还款怎么算', paragraphs: ['马来西亚大部分房贷和车贷，是按你还欠的余额来收利息，叫递减余额。你每个月还固定的金额。刚开始，大部分是利息；后来，大部分是在还你借的本金。', '还款额用的是标准公式，用到借款额、月利率（年利率除以 12）和还款的月数。计算器会算到仙。'] },
        { id: 'flat', heading: '固定利率和递减余额利率不一样', paragraphs: ['固定利率是用全部本金来算整个贷款期的利息，即使你一直在还一部分本金。所以同一个数字，当作固定利率比当作递减余额利率贵。', flat && reducing ? `例子：${rm(100000)}，5 年，4%。按固定利率，你每月还 ${rm(flat.instalment)}，利息 ${rm(flat.totalInterest)}。按递减余额利率，你每月还 ${rm(reducing.instalment)}，利息 ${rm(reducing.totalInterest)}。计算器可以在这两种之间切换。` : '计算器可以在这两种之间切换。', '新闻报道说，租购（汽车贷款）从 2026 年 6 月 1 日起，已从固定利率改为递减余额并列明有效利率，所以拿到任何方案，都要问银行用的是哪一种利率。', '比较两个方案之前，先弄清楚每个方案报的是哪一种利率。'] },
        { id: 'fees', heading: '每月还款没有包括的费用', paragraphs: ['这里的还款只包括借款本金和它的利息。律师费、印花税、保险和手续费都另外加，而且每间银行不一样。签字之前，先问银行总共要付多少。'] },
      ],
      table: { caption: `年利率 ${LOAN_RATE}%，递减余额的每月还款`, head: ['贷款金额', ...LOAN_YEARS.map((y) => `${y} 年`)], rows: loanRows(), note: '不包括手续费、印花税和保险。你自己的利率和年期会得到不同的数字。' },
      related: ['fd-calculator', 'flat-rate-vs-reducing-balance', 'bill-calculator'],
      cta: { title: '看到每一期还款，不再漏掉', text: '把贷款记在 ManaDuit，就能看到完整还款计划，并在每期还款前收到提醒。免费，没有广告。' },
      disclaimer: '这是递减余额或固定利率贷款的估算，不是理财建议；银行的数字可能不同。',
    },
    {
      slug: 'bill-calculator',
      title: '马来西亚账单计算器：服务费、SST 与凑整 | ManaDuit',
      description: '免费的马来西亚餐厅账单计算器。加上 10% 服务费和 6% SST，凑整到最接近的 5 仙，还能和朋友平分账单。',
      heading: '马来西亚账单计算器',
      answer: `一顿 ${rm(21)} 的饭，加 10% 服务费和 6% SST 是 ${rm(sampleBefore)}，凑整后是 ${rm(sampleTotal)}。在下面输入你自己的账单。`,
      sections: [
        { id: 'how', heading: '账单是怎么组成的', paragraphs: ['先从饮食合计开始，加上服务费（通常是这个合计的 10%），再加 SST（餐饮是 6%）。', '皇家关税局的餐饮业指南说，税是按不含服务费的价格来算，所以这个计算器默认就是这样算。有些账单会在服务费上面再加 SST，所以另外设了一个勾选框。', '最后是凑整。国家银行和国内贸易及消费人事务部规定账单合计要按 5 仙凑整：尾数 1 或 2 仙往下，3 或 4 仙往上，6 或 7 仙往下，8 或 9 仙往上。'] },
        { id: 'defaults', heading: '不是每间店都两样都收', paragraphs: ['计算器一开始填的是餐厅常见的税率：服务费 10%，SST 6%。小贩摊位和小店通常没有注册 SST，有些地方也不收服务费，所以请按你的账单修改百分比，或者填 0。', '菜单价钱写「++」，表示服务费和税另外加。写「nett」的价钱，已经包括这两样。'] },
        { id: 'split', heading: '平分账单', paragraphs: ['输入人数，合计就会平均分摊。每个人的份额加起来永远等于确切的合计，所以除不尽的时候，会有一两个人多付 1 仙。'] },
      ],
      table: { caption: '10% 服务费和 6% SST 的例子', head: ['饮食', '服务费', 'SST', '你要付'], rows: billRows(), note: 'SST 按不含服务费的价格计算，合计凑整到最接近的 5 仙。' },
      related: ['sst-vs-service-charge', 'how-to-read-a-malaysian-receipt', 'loan-calculator'],
      cta: { title: '直接扫描收据', text: 'ManaDuit 可以从收据照片读出总额、商家和日期，你不用自己打字。免费，没有广告。' },
      disclaimer: '只是估算。以账单和店家自己的数字为准。',
    },
  ],
};

const cache: Partial<Record<PageLang, Guide[]>> = {};

export function guidesFor(lang: PageLang): Guide[] {
  cache[lang] ??= makers[lang]().map((g) => ({ ...g, lang, path: pathFor(lang, g.slug) }) as Guide);
  return cache[lang] as Guide[];
}

export const guideFor = (lang: PageLang, slug: string): Guide | undefined => guidesFor(lang).find((g) => g.slug === slug);
