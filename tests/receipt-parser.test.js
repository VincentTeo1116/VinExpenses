// Run with:  node --test tests/
// No dependencies. Fixtures in tests/fixtures are real receipt layouts with names, e-mail addresses,
// phone numbers and addresses replaced (the amounts, labels and structure are the real ones).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseReceiptText, pdfItemsToText, findAmountsInLine, scoreLabel, parseDate, toLines } = require('../receipt-parser.js');

const NOW = new Date(2026, 9, 20); // fixed "today", so date checks never depend on when the tests run
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const parse = text => parseReceiptText(text, { now: NOW });

// ---------------------------------------------------------------------------
// Real receipts (anonymised): what the app must read correctly
// ---------------------------------------------------------------------------
const REAL = [
    // file,                           amount,  merchant,                                       date,         template
    ['grab-food-1.txt',               111.55, 'Segambut Yong Tau Foo',                         '2026-08-25', 'grab-food'],
    ['grab-food-2-truncated.txt',     125.40, 'Sarawak Cuisine Lin Li Xiang',                  '2026-08-25', 'grab-food'],
    ['grab-food-3.txt',                74.80, 'Sarawak Cuisine Lin Li Xiang',                  '2026-08-25', 'grab-food'],
    ['grabfood-cake.txt',             122.70, 'Inside Scoop (Whole Cakes)',                    '2026-09-08', 'grab-food'],
    ['courier-stand.txt',              14.00, 'Foshan Zhongma Freight Forwarding Co., Ltd',    '2026-09-07', 'generic'],
    ['courier-flags.txt',             221.00, 'Foshan Zhongma Freight Forwarding Co., Ltd',    '2026-08-23', 'generic'],
    ['invoice-patisserie.txt',        151.30, 'Lacher Patisserie',                             '2026-08-26', 'generic'],
    ['pos-restaurant-ocr.txt',        171.68, 'Tucker & Co.',                                  '2026-08-27', 'generic']
];

for (const [file, amount, merchant, date, template] of REAL) {
    test(`real receipt: ${file}`, () => {
        const r = parse(fixture(file));
        assert.equal(r.amount, amount, `amount (candidates: ${JSON.stringify(r.amountCandidates)})`);
        assert.equal(r.amountConfidence, 'high', 'a clear total should be reported with high confidence');
        assert.equal(r.merchant, merchant);
        assert.equal(r.date, date);
        assert.equal(r.template, template);
        assert.equal(r.currency, 'MYR');
    });
}

test('real receipt: the courier invoice\'s RM fee wins over the RMB goods value and the USD conversion', () => {
    const r = parse(fixture('courier-flags.txt'));
    assert.equal(r.amount, 221.00);
    const labels = r.amountCandidates.map(c => `${c.currency}:${c.amount}`);
    assert.ok(!labels.includes('CNY:700') || r.amountCandidates[0].amount === 221.00, 'RMB 700 must not outrank RM 221');
});

test('real receipt: Grab food orders are suggested as Food, and the restaurant (not "Outlook") is the merchant', () => {
    const r = parse(fixture('grab-food-1.txt'));
    assert.equal(r.hints.category, 'food');
    assert.notEqual(r.merchant, 'Outlook');
});

// ---------------------------------------------------------------------------
// The layouts that failed with the old parser (13 cases, 3 passed before)
// ---------------------------------------------------------------------------
const LAYOUTS = [
    ['simple: TOTAL on one line',                      12.50, 'KOPITIAM ABC\n12/10/2026\nNasi lemak 8.00\nTeh ais 4.50\nTOTAL 12.50\nCASH 20.00\nCHANGE 7.50'],
    ['RM12.50 with no space',                          12.50, 'MYDIN MART\nMilo 1kg\nTOTAL RM12.50\nTHANK YOU'],
    ['label and amount on separate lines',             18.90, '99 SPEEDMART\nSnacks 18.90\nTOTAL\n18.90\nCASH\n20.00'],
    ['Malay: JUMLAH',                                  23.40, 'RESTORAN SYED\nJUMLAH 23.40\nTUNAI 30.00\nBAKI 6.60'],
    ['SST receipt: "Total Sales (Excl.)" first',       10.80, 'CAFE X\nTotal Sales (Excl. SST) 10.00\nService Tax 6% 0.80\nTOTAL (Incl. SST) 10.80\nCASH 20.00'],
    ['Total Discount line before the real total',      27.00, 'WATSONS\nItem A 30.00\nTotal Discount 3.00\nTOTAL 27.00'],
    ['petrol slip: "Amount" not "Total"',              50.00, 'PETRONAS SERI KEMBANGAN\nPump 3 RON95\nAmount RM 50.00\nPaid Card'],
    ['e-wallet: "Payment Amount"',                      8.90, "Touch 'n Go eWallet\nPayment Successful\nPayment Amount RM 8.90\nMerchant: TEALIVE"],
    ['whole ringgit: TOTAL RM 12',                     12.00, 'BUS TICKET\nTOTAL RM 12\nTHANK YOU'],
    ['OCR read the decimal as a comma: 12,50',         12.50, 'KEDAI RUNCIT\nTOTAL 12,50\nCASH 20,00'],
    ['OCR split the digits: TOTAL 1 2.50',             12.50, 'STARBUCKS\nLatte 12.50\nTOTAL 1 2.50'],
    ['thousands separator: Grand Total 1,234.50',    1234.50, 'AEON\nGrand Total : 1,234.50\nVISA 1,234.50'],
    ['rounding, cash and change after the total',      10.85, 'SUBWAY\nSubtotal 10.82\nRounding 0.03\nTOTAL 10.85\nCASH 50.00\nCHANGE 39.15'],
    ['full-width colon (Chinese receipts)',            38.00, '某某餐厅\nTotal： RM 38.00\nCash： RM 50.00'],
    ['negative discount in brackets',                  45.00, 'SHOP\nItem 50.00\nVoucher (5.00)\nTOTAL 45.00'],
    ['amount with RM written as "R M"',                19.90, 'WARUNG\nTOTAL R M 19.90']
];

for (const [name, want, text] of LAYOUTS) {
    test(`layout: ${name}`, () => {
        const r = parse(text);
        assert.equal(r.amount, want, `got ${r.amount}; candidates ${JSON.stringify(r.amountCandidates)}`);
    });
}

// ---------------------------------------------------------------------------
// Honesty: when it can't tell, it must not pre-fill a wrong number
// ---------------------------------------------------------------------------
test('no total label at all: nothing is pre-filled, but the biggest amounts are offered as choices', () => {
    const r = parse('SOME SHOP\nItem A 12.00\nItem B 30.00\nItem C 8.50');
    assert.equal(r.amount, 0);
    assert.equal(r.amountConfidence, 'low');
    assert.ok(r.amountCandidates.length >= 2);
    assert.equal(r.amountCandidates[0].amount, 30);
});

test('a foreign-currency total is never silently accepted as ringgit', () => {
    const r = parse('GLOBAL STORE\nTOTAL USD 25.00');
    assert.equal(r.amount, 0);
    assert.ok(r.warnings.length > 0);
});

test('two conflicting totals leave the choice to the user', () => {
    const r = parse('PLACE\nTOTAL 10.00\nTOTAL 20.00');
    assert.notEqual(r.amountConfidence, 'high');
});

test('empty and junk input never throws', () => {
    for (const input of ['', '   \n\n', null, undefined, '!!!???', '1234567890\n2026\n13:45']) {
        const r = parse(input);
        assert.equal(r.amount, 0);
    }
});

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
test('amounts: only money-shaped numbers count (not dates, times, phone numbers, quantities, litres)', () => {
    const values = line => findAmountsInLine(line).map(a => a.value);
    assert.deepEqual(values('Printed On: 2026.08.27 13:43:51'), []);
    assert.deepEqual(values('Tel 60146809118  Qty 3  23.456 L  6.0%'), []);
    assert.deepEqual(values('TOTAL RM12.50'), [12.5]);
    assert.deepEqual(values('Latte 12.50 Cake 8.00'), [12.5, 8]);
    assert.deepEqual(values('RM 1,234.50'), [1234.5]);
    assert.deepEqual(values('- RM 5.00')[0], 5);
    assert.equal(findAmountsInLine('- RM 5.00')[0].negative, true);
});

test('amounts: "RM3 off delivery" is a deal description, not an amount', () => {
    assert.deepEqual(findAmountsInLine('RM3 off delivery'), []);
});

test('labels: totals score high, subtotals/discounts/tax/cash score low', () => {
    assert.ok(scoreLabel('Grand Total') > scoreLabel('TOTAL'));
    assert.ok(scoreLabel('TOTAL (INCL. TAX)') >= 12, 'tax mentioned inside a total label must not be penalised');
    for (const bad of ['Subtotal', 'Total Sales (Exc. Tax)', 'Total Discount', 'CASH', 'CHANGE', 'Service Charge (10%)', 'Rounding', 'Delivery fee', 'Syarikat bayar']) {
        assert.ok(scoreLabel(bad) < 5, `${bad} scored ${scoreLabel(bad)}`);
    }
    assert.ok(scoreLabel('Anda bayar') >= 12);
    assert.ok(scoreLabel('JUMLAH') >= 9);
    assert.ok(scoreLabel('总计') >= 12);
});

test('dates: every format seen on Malaysian receipts', () => {
    const d = text => parseDate(toLines(text), NOW);
    assert.equal(d('Pick-up time: 25 Aug 26 10:28 +0800'), '2026-08-25');
    assert.equal(d('Date: 26-08-2026'), '2026-08-26');
    assert.equal(d('Printed On: 2026.08.27 13:43:51'), '2026-08-27');
    assert.equal(d('2026年09月07日'), '2026-09-07');
    assert.equal(d('12/10/26 14:00'), '2026-10-12');
    assert.equal(d('Tarikh: 3 Oktober 2026'), '2026-10-03');
    assert.equal(d('August 5, 2026'), '2026-08-05');
    assert.equal(d('25/12/2026'), '', 'a date in the future is not a purchase date');
    assert.equal(d('31/02/2026'), '', 'impossible dates are rejected');
    assert.equal(d('invoice 12345'), '');
});

test('dates: the order/pick-up time beats the e-mail header time', () => {
    const text = 'Date Mon 2026-09-01 08:00\nPick-up time: 25 Aug 26 10:28 +0800';
    assert.equal(parseDate(toLines(text), NOW), '2026-08-25');
});

test('dates: a due date is not the purchase date', () => {
    assert.equal(parseDate(toLines('Invoice date 01/09/2026\nDue date 30/09/2026'), NOW), '2026-09-01');
});

test('PDF text fragments are rebuilt into visual lines, so a label and its amount end up together', () => {
    const items = [
        { str: 'TOTAL', x: 40, y: 700, width: 30, height: 10 },
        { str: 'RM 111.55', x: 300, y: 700.4, width: 50, height: 10 },     // same row, far right
        { str: 'Subtotal', x: 40, y: 680, width: 40, height: 10 },
        { str: 'RM 116.55', x: 300, y: 680, width: 50, height: 10 },
        { str: 'Thank you', x: 40, y: 600, width: 45, height: 10 }
    ];
    const text = pdfItemsToText(items);
    assert.equal(text.split('\n').length, 3);
    assert.match(text.split('\n')[0], /^TOTAL\s+RM 111\.55$/);
    assert.equal(parse(text + '\nAnda bayar RM 111.55').amount, 111.55);
});

test('PDF text: fragments that touch are joined without a gap, wide gaps become column spaces', () => {
    const text = pdfItemsToText([
        { str: 'RM', x: 100, y: 500, width: 14, height: 10 },
        { str: '12.50', x: 114.5, y: 500, width: 26, height: 10 },
        { str: 'x', x: 300, y: 500, width: 5, height: 10 }
    ]);
    assert.equal(text, 'RM12.50    x');
    assert.equal(pdfItemsToText([]), '');
    assert.equal(pdfItemsToText(null), '');
});

// ---------------------------------------------------------------------------
// Found by running the real PDFs through a real browser
// ---------------------------------------------------------------------------
const { parseBest, pdfContentOrderToText } = require('../receipt-parser.js');
const parseBestNow = texts => parseBest(texts, { now: NOW });

test('PDF readers return look-alike characters (Kangxi radicals); they must still match dates and keywords', () => {
    // pdf.js gave U+2F49 for the month character and U+2F47 for the day character
    assert.equal(parseDate(toLines('2026\u5e7409\u2F4907\u2F47'), NOW), '2026-09-07');
    assert.equal(parseDate(toLines('2026\u5e7409\u670807\u65e5'), NOW), '2026-09-07');
    assert.ok(scoreLabel(toLines('\u603b\u8ba1\uff1a')[0]) >= 12, 'full-width colon after a Chinese total label');
    assert.equal(parse('SHOP\n\u2F42\u2F42 TOTAL RM 9.00').amount, 9);
});

test('content-order text: lines break where the PDF says, touching fragments join, gaps get a space', () => {
    const text = pdfContentOrderToText([
        { str: 'TOTAL', x: 40, y: 700, width: 30, height: 10, hasEOL: true },
        { str: 'RM', x: 40, y: 680, width: 14, height: 10 },
        { str: '12.50', x: 54.5, y: 680, width: 26, height: 10, hasEOL: true },     // touches "RM": no space
        { str: 'Paid', x: 40, y: 660, width: 24, height: 10 },
        { str: 'by card', x: 90, y: 660, width: 40, height: 10, hasEOL: true },      // gap: needs a space
        { str: '', x: 0, y: 0, width: 0, height: 0, hasEOL: true }
    ]);
    assert.equal(text, 'TOTAL\nRM12.50\nPaid by card\n');
    assert.equal(pdfContentOrderToText(null), '');
});

test('parseBest keeps the reading the parser trusts more (visual-row reading put the amount above its label)', () => {
    const goodContentOrder = 'Foshan Freight Co., Ltd\nTOTAL VALUE: RMB 100.00\n\u603b\u8ba1\uff1a\nRM 14.00\n= RMB 23.52';
    const brokenRows = 'Foshan Freight Co., Ltd\nTOTAL VALUE: RMB 100.00\nRM 14.00\n\u603b\u8ba1\uff1a\n= RMB 23.52';
    const best = parseBestNow([goodContentOrder, brokenRows]);
    assert.equal(best.amount, 14);
    assert.equal(best.readingIndex, 0);
    const flipped = parseBestNow([brokenRows, goodContentOrder]);
    assert.equal(flipped.amount, 14, 'order of the readings must not matter when one is clearly better');
});

test('parseBest: on a tie the first (content-order) reading wins, so merged columns cannot spoil the merchant', () => {
    const contentOrder = 'Your Grab E-Receipt\nVehicle type:\nGrabFood\nOrder location:\nSarawak Cuisine Lin Li Xiang - SS22\nTOTAL\nRM 125.40';
    const mergedColumns = 'Your Grab E-Receipt\nVehicle type:    GrabFood\nOrder location:    1x K03 Kolo Mee Zheng\nTOTAL    RM 125.40';
    const best = parseBestNow([contentOrder, mergedColumns]);
    assert.equal(best.readingIndex, 0);
    assert.equal(best.merchant, 'Sarawak Cuisine Lin Li Xiang');
});

test('parseBest: empty or missing readings never throw', () => {
    for (const input of [[], [''], [null, undefined], '', null]) {
        const r = parseBestNow(input);
        assert.equal(r.amount, 0);
        assert.equal(r.readingIndex, -1);
    }
});

test('content-order text: pdf.js ends a line with a separate EMPTY item (this is what the real files do)', () => {
    // Shape taken from the real Grab PDF: tiny fragments, whitespace items, and {str:"", hasEOL:true} markers
    const frag = (str, x, y, hasEOL) => ({ str, x, y, width: str.length * 5, height: 10, hasEOL: !!hasEOL });
    const text = pdfContentOrderToText([
        frag('TOT', 53, 700), frag('AL', 68, 700), frag('', 83, 700, true),
        frag('R', 53, 680), frag('M', 58, 680), frag(' ', 63, 680), frag('125', 66, 680), frag('.40', 81, 680), frag('', 96, 680, true),
        frag('', 96, 680, true),                                                 // a second marker must not add a blank line
        frag('Payment Method:', 53, 660), frag('', 140, 660, true)
    ]);
    assert.equal(text, 'TOTAL\nRM 125.40\nPayment Method:\n');
    assert.equal(parse(text).amount, 125.40);
    assert.equal(pdfContentOrderToText([{ str: '', hasEOL: true }]), '', 'a marker with nothing before it adds nothing');
});
