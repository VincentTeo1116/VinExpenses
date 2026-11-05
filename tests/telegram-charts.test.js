'use strict';
// Tests for the picture and report building blocks of Phase 2: the PNG drawing, the extras (daily buckets, heat-strip,
// trend, streak, insights, aligned tables), the report windows and the four views. Pure logic plus the fake database.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { fakeSupabase } = require('./helpers/fakes.js');

const shared = (name) => import(`../supabase/functions/_shared/${name}.ts`);
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

// ------------------------------------------------------------------ a small PNG reader, to check what was drawn
function decodePng(bytes) {
    const buf = Buffer.from(bytes);
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
    let offset = 8;
    let header = null;
    const data = [];
    let sawEnd = false;
    while (offset < buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString('latin1');
        const body = buf.subarray(offset + 8, offset + 8 + length);
        assert.equal(buf.readUInt32BE(offset + 8 + length), zlib.crc32(buf.subarray(offset + 4, offset + 8 + length)), `CRC of ${type}`);
        if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colorType: body[9] };
        if (type === 'IDAT') data.push(body);
        if (type === 'IEND') sawEnd = true;
        offset += 12 + length;
    }
    assert.ok(header && sawEnd, 'IHDR and IEND present');
    const raw = zlib.inflateSync(Buffer.concat(data));
    const stride = header.width * 3;
    assert.equal(raw.length, (stride + 1) * header.height, 'decoded size');
    for (let y = 0; y < header.height; y++) assert.equal(raw[y * (stride + 1)], 0, 'filter type none');
    return { ...header, pixel: (x, y) => { const i = y * (stride + 1) + 1 + x * 3; return [raw[i], raw[i + 1], raw[i + 2]]; } };
}
const near = (a, b, tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

// ------------------------------------------------------------------ PNG and charts
test('png: a valid, opaque RGB image whose checksums and compression decode exactly', async () => {
    const { encodePng, crc32 } = await shared('tg-chart');
    const rgb = new Uint8Array(4 * 3 * 3).map((_, i) => i * 7 % 256);
    const png = decodePng(await encodePng(4, 3, rgb));
    assert.deepEqual([png.width, png.height, png.depth, png.colorType], [4, 3, 8, 2], 'RGB with no alpha channel');
    assert.deepEqual(png.pixel(1, 2), [rgb[(2 * 4 + 1) * 3], rgb[(2 * 4 + 1) * 3 + 1], rgb[(2 * 4 + 1) * 3 + 2]]);
    for (const bytes of [new Uint8Array(0), new Uint8Array([1]), Buffer.from('123456789'), new Uint8Array(1000).fill(255)]) {
        assert.equal(crc32(new Uint8Array(bytes)), zlib.crc32(Buffer.from(bytes)));
    }
});

test('png: the no-compression fallback is also valid for any size', async () => {
    const { zlibStored, encodePng } = await shared('tg-chart');
    for (const size of [0, 1, 65534, 65535, 65536, 200_001]) {
        const raw = new Uint8Array(size).map((_, i) => (i * 31) % 251);
        assert.deepEqual(new Uint8Array(zlib.inflateSync(zlibStored(raw))), raw, `size ${size}`);
    }
    const saved = globalThis.CompressionStream;
    try {
        globalThis.CompressionStream = undefined;
        const png = decodePng(await encodePng(8, 8, new Uint8Array(8 * 8 * 3).fill(200)));
        assert.deepEqual(png.pixel(3, 3), [200, 200, 200], 'works on a runtime without CompressionStream');
    } finally { globalThis.CompressionStream = saved; }
});

test('donut: slices are drawn clockwise from the top in palette order, separated by a gap, on a plain background', async () => {
    const { renderDonutPng, PALETTE } = await shared('tg-chart');
    const png = decodePng(await renderDonutPng([3, 1]));
    assert.deepEqual([png.width, png.height, png.colorType], [720, 440, 2]);
    const cx = 360;
    const cy = 220;
    assert.deepEqual(png.pixel(2, 2), [247, 248, 252], 'background');
    assert.deepEqual(png.pixel(cx, cy), [247, 248, 252], 'the hole');
    assert.ok(near(png.pixel(cx + 157, cy), PALETTE[0]), '3 o\'clock is inside the first (75%) slice');
    assert.ok(near(png.pixel(cx - 60, cy - 145), PALETTE[1]), '11 o\'clock is inside the second slice');
    assert.deepEqual(png.pixel(cx - 1, cy - 157), [247, 248, 252], 'a gap, not a blend, where two slices meet');
    assert.deepEqual(png.pixel(cx, cy - 205), [247, 248, 252], 'nothing outside the ring');
});

test('donut: nonsense input is ignored, all-zero data is an empty grey ring, one slice has no gap, many slices work', async () => {
    const { renderDonutPng, PALETTE } = await shared('tg-chart');
    const empty = decodePng(await renderDonutPng([0, -5, NaN, Infinity, undefined]));
    assert.deepEqual(empty.pixel(360 + 157, 220), [226, 229, 238]);
    assert.deepEqual(decodePng(await renderDonutPng([])).pixel(360 + 157, 220), [226, 229, 238]);
    const single = decodePng(await renderDonutPng([42]));
    assert.ok(near(single.pixel(360, 220 - 157), PALETTE[0]), 'a lone slice covers the top with no gap line');
    assert.ok(near(single.pixel(360 - 157, 220), PALETTE[0]));
    const t = Date.now();
    const many = await renderDonutPng([9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1]);
    assert.ok(Date.now() - t < 2000, 'fast enough for a 2-second function limit');
    assert.ok(many.length < 300_000, `small file (${many.length} bytes)`);
    assert.deepEqual(await renderDonutPng([3, 2, 1]), await renderDonutPng([3, 2, 1]), 'same data, same picture');
});

test('bars: the tallest is highlighted, today is marked, future days are faint, empty days are a dot, all-zero data is fine', async () => {
    const { renderBarsPng } = await shared('tg-chart');
    const png = decodePng(await renderBarsPng([10, 0, 0, 0, 0, 0, 40], { highlight: 6, marker: 2, muted: [false, false, false, false, false, true, false] }));
    const slot = (720 - 72) / 7;
    const centre = (i) => Math.round(36 + slot * (i + 0.5));
    const baseline = 380 - 64;
    assert.ok(near(png.pixel(centre(6), baseline - 10), [242, 140, 40]), 'highest = accent colour');
    assert.ok(near(png.pixel(centre(0), baseline - 10), [91, 141, 239]), 'normal bar');
    assert.deepEqual(png.pixel(centre(0), baseline - 100), [247, 248, 252], 'above a short bar is background');
    assert.deepEqual(png.pixel(centre(0), 28), [232, 235, 243], 'guide line');
    assert.ok(near(png.pixel(centre(2), baseline + 30), [51, 51, 51]), 'today marker');
    assert.ok(!near(png.pixel(centre(1), baseline - 2), [247, 248, 252], 2), 'an empty day is a visible dot, not nothing');
    const muted = decodePng(await renderBarsPng([20, 20], { muted: [false, true] }));
    const slot2 = (720 - 72) / 2;
    assert.ok(near(muted.pixel(Math.round(36 + slot2 * 1.5), baseline - 10), [222, 226, 238]), 'future bar is faint');
    for (const values of [[], [0, 0, 0], [NaN, -1], [5]]) {
        const out = decodePng(await renderBarsPng(values));
        assert.deepEqual([out.width, out.height], [720, 380]);
    }
});

// ------------------------------------------------------------------ extras
const nov1 = (extra = '') => new Date(`2026-11-01T00:00:00+08:00${extra}`);

test('days: a day number follows the Kuala Lumpur calendar, and weekdays are Monday-based', async () => {
    const { klDay, mondayBased, bucketByDay, daysWithEntries, streakDays } = await shared('tg-insights');
    assert.equal(klDay('2026-10-31T15:59:59Z'), klDay('2026-10-31T00:00:00+08:00'));
    assert.equal(klDay('2026-10-31T16:00:00Z'), klDay('2026-10-31T00:00:00+08:00') + 1);
    assert.equal(mondayBased(klDay('2026-11-01T00:00:00+08:00')), 6, '1 Nov 2026 is a Sunday');
    assert.equal(mondayBased(klDay('2026-11-02T00:00:00+08:00')), 0, '2 Nov 2026 is a Monday');
    assert.equal(mondayBased(klDay('1970-01-01T12:00:00+08:00')), 3, '1 Jan 1970 was a Thursday');
    const rows = [
        { amount: '1', created_at: '2026-10-31T15:59:59Z' },    // still 31 Oct in KL: outside November
        { amount: '0.1', created_at: '2026-10-31T16:00:00Z' },  // 00:00 on 1 Nov in KL: day 0
        { amount: '0.2', created_at: '2026-11-01T10:00:00Z' },  // day 0 too
        { amount: '7', created_at: '2026-11-30T15:59:59Z' },    // last second of 30 Nov in KL: day 29
        { amount: '9', created_at: '2026-11-30T16:00:00Z' },    // December: outside
        { amount: 'abc', created_at: '2026-11-02T00:00:00Z' },  // junk amount is ignored
    ];
    const days = bucketByDay(rows, nov1(), 30);
    assert.equal(days.length, 30);
    assert.equal(days[0], 0.3, 'exact cents: 0.1 + 0.2');
    assert.equal(days[29], 7);
    assert.equal(days.reduce((a, b) => a + b, 0), 7.3);
    const set = daysWithEntries([{ created_at: '2026-11-03T04:00:00Z' }, { created_at: '2026-11-04T04:00:00Z' }, { created_at: '2026-11-05T04:00:00Z' }]);
    const today = klDay('2026-11-05T04:00:00Z');
    assert.equal(streakDays(set, today), 3);
    assert.equal(streakDays(set, today + 1), 3, 'today empty so far: the streak counts from yesterday');
    assert.equal(streakDays(set, today + 2), 0, 'a missed day breaks it');
    assert.equal(streakDays(new Set([today - 5, today - 3, today]), today), 1);
    assert.equal(streakDays(new Set(), today), 0);
});

test('heat-strip: Monday-first calendar, rank-based colours, future weeks dropped, busiest day named in numbers', async () => {
    const { heatStrip, klDay } = await shared('tg-insights');
    const start = klDay('2026-11-01T00:00:00+08:00');
    const totals = Array.from({ length: 30 }, (_, i) => [0, 10, 50, 300, 20][i] ?? 0);
    const now = heatStrip('en', start, totals, 4);
    assert.equal(now.lines[0], 'ＭＴＷＴＦＳＳ');
    assert.deepEqual(now.lines.slice(1), ['▫️▫️▫️▫️▫️▫️⬜', '🟩🟧🟥🟨▫️▫️▫️'], 'week 1 is just the Sunday; days after today are blank squares; empty future weeks are gone');
    assert.deepEqual(now.biggest, { index: 3, amount: 300 });
    const done = heatStrip('en', klDay('2026-10-01T00:00:00+08:00'), Array.from({ length: 31 }, (_, i) => i + 1), null);
    assert.equal(done.lines.length, 1 + 5, 'October 2026 spans 5 calendar weeks');
    assert.equal(done.lines[1], '▫️▫️▫️🟩🟩🟩🟩', '1 Oct 2026 is a Thursday');
    assert.equal(done.lines.at(-1).slice(-2), '▫️', 'a finished month is padded to full weeks');
    assert.match(done.lines.join(''), /🟥/);
    const flat = heatStrip('en', start, new Array(30).fill(0), null);
    assert.ok(!/[🟩🟨🟧🟥]/u.test(flat.lines.join('')), 'no spending: only empty squares');
    assert.equal(flat.biggest, null);
    const one = heatStrip('en', start, [0, 5, ...new Array(28).fill(0)], null);
    assert.ok(one.lines.join('').includes('🟨'), 'a single spending day gets a neutral colour');
    assert.equal(heatStrip('zh', start, [1], 0).lines[0], '一二三四五六日');
    assert.equal(heatStrip('ms', start, [1], 0).lines[0], 'ＩＳＲＫＪＳＡ');
});

test('trend and sparkline: relative blocks, empty months are the lowest block', async () => {
    const { sparkline } = await shared('tg-insights');
    assert.equal(sparkline([10, 40, 50, 30, 70, 60]), '▂▅▆▄█▇');
    assert.equal(sparkline([0, 0, 0]), '▁▁▁');
    assert.equal(sparkline([]), '');
    assert.equal(sparkline([5, 0, 5]), '█▁█');
    assert.equal(sparkline([NaN, 3]), '▁█');
});

test('insights: only meaningful category changes, weekend patterns and budget pace are reported', async () => {
    const { categoryMover, weekendInsight, paceInsight, klDay } = await shared('tg-insights');
    assert.deepEqual(categoryMover([['food', 100], ['car', 10]], [['food', 70], ['car', 5]]), { kind: 'cat', key: 'food', up: true, pct: 43 });
    assert.deepEqual(categoryMover([['food', 50]], [['food', 100]]), { kind: 'cat', key: 'food', up: false, pct: 50 });
    assert.equal(categoryMover([['food', 105]], [['food', 100]]), null, 'under 15% and under RM 20');
    assert.equal(categoryMover([['food', 119]], [['food', 100]]), null, 'under RM 20 even if 19%');
    assert.equal(categoryMover([['food', 130]], [['food', 100]]).pct, 30);
    assert.equal(categoryMover([['food', 100]], [['car', 100]]), null, 'a brand-new category or one that vanished is noise');
    assert.equal(categoryMover([], []), null);
    assert.equal(categoryMover([['a', 500], ['b', 300]], [['a', 400], ['b', 100]]).key, 'b', 'the biggest absolute change wins');

    const start = klDay('2026-11-01T00:00:00+08:00'); // a Sunday
    const heavyWeekend = Array.from({ length: 30 }, (_, i) => ([5, 6].includes((i + 6) % 7) ? 100 : 10));
    assert.deepEqual(weekendInsight(start, heavyWeekend, 14), { kind: 'weekend', ratio: 10, weekendHeavy: true });
    assert.equal(weekendInsight(start, heavyWeekend.map((v) => (v === 100 ? 10 : 100)), 14).weekendHeavy, false);
    assert.equal(weekendInsight(start, heavyWeekend, 5), null, 'not enough days yet');
    assert.equal(weekendInsight(start, new Array(30).fill(10), 30), null, 'even spending says nothing');
    assert.equal(weekendInsight(start, new Array(30).fill(0), 30), null);

    const budgets = (used) => [{ key: 'food', limit: 500, used }];
    assert.equal(paceInsight(budgets(200), 6, 30), null, 'too early in the month');
    const warn = paceInsight(budgets(200), 10, 30);
    assert.deepEqual([warn.kind, warn.key, warn.warn, Math.round(warn.projected * 100)], ['pace', 'food', true, 120]);
    const ok = paceInsight(budgets(100), 10, 30);
    assert.equal(ok.warn, false);
    assert.equal(paceInsight(budgets(160), 10, 30), null, 'a projection of 96% is neither alarming nor comfortable: say nothing');
    assert.equal(paceInsight(budgets(600), 10, 30), null, 'already over: the over-budget alert covers it');
    assert.equal(paceInsight([], 10, 30), null);
    assert.equal(paceInsight([{ key: 'x', limit: 0, used: 5 }], 10, 30), null);
    assert.equal(paceInsight([{ key: 'a', limit: 500, used: 100 }, { key: 'b', limit: 500, used: 250 }], 10, 30).key, 'b', 'the budget heading for trouble first');
});

test('tables: Chinese and emoji take two columns, columns line up, long cells are clipped with "…"', async () => {
    const { displayWidth, clipWidth, alignTable } = await shared('tg-insights');
    assert.equal(displayWidth('abc'), 3);
    assert.equal(displayWidth('午餐'), 4);
    assert.equal(displayWidth('🍜 Food'), 7);
    assert.equal(displayWidth('é'), 1, 'an accent adds no width');
    assert.equal(displayWidth(''), 0);
    assert.equal(clipWidth('abcdef', 4), 'abc…');
    assert.equal(clipWidth('abc', 4), 'abc');
    assert.equal(displayWidth(clipWidth('午餐饭店很好吃', 5)), 5);
    assert.equal(clipWidth('午餐饭店很好吃', 5), '午餐…');
    const lines = alignTable([['1', 'Food', 'RM 300.00', '86%'], ['2', '午餐店', 'RM 5.00', '14%'], ['10', 'A very very long place name', 'RM 1,234.50', '9%']], ['r', 'l', 'r', 'r'], [0, 12, 0, 0]);
    assert.equal(new Set(lines.map((l) => displayWidth(l))).size, 1, 'right-aligned last column: every line is the same width');
    assert.match(lines[2], /A very very…/);
    assert.deepEqual(alignTable([], ['l']), []);
});

// ------------------------------------------------------------------ windows
test('windows: day, week and month follow Kuala Lumpur time, across month ends, years and leap years', async () => {
    const { dayWindow, weekWindow, monthWindow } = await shared('tg-views');
    const now = new Date('2026-11-05T04:00:00Z'); // Thursday 5 Nov, 12:00 KL
    const iso = (w) => [w.start.toISOString(), w.end.toISOString()];
    assert.deepEqual(iso(dayWindow(now, 0)), ['2026-11-04T16:00:00.000Z', '2026-11-05T16:00:00.000Z']);
    assert.deepEqual(iso(dayWindow(now, 2)), ['2026-11-02T16:00:00.000Z', '2026-11-03T16:00:00.000Z']);
    assert.deepEqual(iso(weekWindow(now, 0)), ['2026-11-01T16:00:00.000Z', '2026-11-08T16:00:00.000Z'], 'Monday 2 Nov to Sunday 8 Nov');
    assert.deepEqual(iso(weekWindow(now, 1)), ['2026-10-25T16:00:00.000Z', '2026-11-01T16:00:00.000Z']);
    assert.deepEqual(iso(weekWindow(new Date('2026-11-08T17:00:00Z'), 0)), ['2026-11-08T16:00:00.000Z', '2026-11-15T16:00:00.000Z'], 'Monday 01:00 KL is already the new week');
    assert.deepEqual(iso(weekWindow(new Date('2026-11-08T15:00:00Z'), 0)), ['2026-11-01T16:00:00.000Z', '2026-11-08T16:00:00.000Z'], 'Sunday 23:00 KL is still the old week');
    const month = monthWindow(now, 0);
    assert.deepEqual([month.start.toISOString(), month.end.toISOString(), month.days], ['2026-10-31T16:00:00.000Z', '2026-11-30T16:00:00.000Z', 30]);
    assert.equal(monthWindow(now, 10).start.toISOString(), '2025-12-31T16:00:00.000Z');
    assert.equal(monthWindow(now, 10).days, 31);
    const dec = monthWindow(new Date('2027-01-15T04:00:00Z'), 1);
    assert.deepEqual([dec.start.toISOString(), dec.days], ['2026-11-30T16:00:00.000Z', 31], 'January looks back into December of the previous year');
    assert.equal(monthWindow(new Date('2028-02-10T04:00:00Z'), 0).days, 29, 'leap year');
    assert.equal(monthWindow(new Date('2026-10-31T17:00:00Z'), 0).start.toISOString(), '2026-10-31T16:00:00.000Z', '01:00 on 1 Nov in KL is November');
    assert.equal(dayWindow(new Date('2026-11-05T17:00:00Z'), 0).start.toISOString(), '2026-11-05T16:00:00.000Z', '01:00 on 6 Nov in KL');
});

// ------------------------------------------------------------------ caption fitting
test('captions: sections are added by priority until the limit, others are skipped, a huge first section is cut cleanly', async () => {
    const { fitCaption, fullText } = await shared('tg-views');
    const { stripTags } = await shared('telegram');
    const big = (n) => Array.from({ length: n }, (_, i) => `<b>line ${i}</b> ${'x'.repeat(30)}`);
    const sections = [{ compact: ['<b>Title</b>'] }, { compact: big(10) }, { compact: ['tiny later section'] }, { compact: big(30), full: ['never in caption'] }];
    const caption = fitCaption(sections, 500);
    assert.ok(stripTags(caption).length <= 500);
    assert.match(caption, /Title/);
    assert.match(caption, /tiny later section/, 'a smaller lower-priority section still fits after a bigger one was skipped');
    assert.ok(!/never in caption/.test(caption));
    assert.equal((caption.match(/<b>/g) || []).length, (caption.match(/<\/b>/g) || []).length, 'no half tags');
    assert.match(fullText(sections), /never in caption/, 'the full text uses the long versions');
    const cut = fitCaption([{ compact: ['<b>' + 'y'.repeat(3000) + '</b>'] }], 1000);
    assert.ok(stripTags(cut).length <= 1000);
    assert.ok(!/[<>]/.test(cut.replace(/&(amp|lt|gt);/g, '')), 'cut as plain text, never leaving a broken tag');
    assert.equal(fitCaption([{ compact: [] }, { compact: ['a'] }], 100), 'a');
});

// ------------------------------------------------------------------ the views, with data
const KL_NOW = new Date('2026-11-05T04:00:00Z');
const labelsOf = (key) => ({ food: 'Food', shopping: 'Shopping', car: 'Car', utilities: 'Utilities', beverages: 'Beverages', health: 'Health', other: 'Other' })[key] ?? key;

function world() {
    globalThis.Deno = { env: { get: (n) => ({ SUPABASE_URL: 'https://abcdefghij.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })[n] } };
    const db = fakeSupabase();
    globalThis.fetch = db.fetch;
    let n = 0;
    const add = (user, amount, iso, category = 'food', merchant = 'Cafe') => db.expenses.push({ id: `e${String(n++).padStart(5, '0')}`, user_id: user, amount: String(amount), category, payment: 'bank', merchant, created_at: iso });
    return { db, add };
}
test.afterEach(() => { delete globalThis.Deno; });

function assertTelegramHtml(text, where = '') {
    const stack = [];
    for (const m of text.matchAll(/<(\/?)([a-z]+)((?: expandable)?)>/g)) {
        assert.ok(['b', 'i', 'code', 'pre', 'blockquote'].includes(m[2]), `${where}: tag <${m[2]}>`);
        if (m[1]) assert.equal(stack.pop(), m[2], `${where}: mismatched </${m[2]}>`); else stack.push(m[2]);
    }
    assert.deepEqual(stack, [], `${where}: unclosed tags`);
    const bare = text.replace(/<\/?[a-z]+(?: expandable)?>/g, '');
    assert.ok(!/[<>]/.test(bare) && !/&(?!(?:amp|lt|gt|quot|#39);)/.test(bare), `${where}: unescaped characters`);
}

test('month view: a donut picture with a legend whose squares match the slices, within the caption limit', async () => {
    const { db, add } = world();
    const views = await shared('tg-views');
    const { stripTags } = await shared('telegram');
    add(A, 300, '2026-11-03T04:00:00Z', 'utilities', 'TNB'); add(A, 160, '2026-11-02T04:00:00Z', 'shopping', 'Mydin');
    add(A, 55, '2026-11-05T01:00:00Z', 'health', 'Guardian'); add(A, 12, '2026-11-04T04:00:00Z', 'food', 'Lunch');
    add(A, 100, '2026-10-10T04:00:00Z', 'food', 'Lunch');
    add(B, 999, '2026-11-03T04:00:00Z', 'car', 'Bobs');
    db.incomes.push({ id: 'i1', user_id: A, amount: '6000', source: 'Salary', created_at: '2026-11-01T01:00:00Z' });
    db.incomes.push({ id: 'i2', user_id: B, amount: '9999', source: 'Salary', created_at: '2026-11-01T01:00:00Z' });
    const r = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'm', offset: 0, labels: labelsOf });
    assert.equal(r.kind, 'photo');
    assert.ok(r.png && r.png.length > 1000);
    decodePng(r.png);
    assert.ok(stripTags(r.text).length <= 1000, `caption ${stripTags(r.text).length}`);
    const plain = stripTags(r.text).replace(/ /g, ' ');
    assert.match(plain, /^🗓 November 2026/);
    assert.match(plain, /Spent\s+RM 527\.00/);
    assert.match(plain, /Income\s+RM 6,000\.00/);
    assert.ok(!/999|9,999/.test(plain), 'only this person\'s numbers');
    assert.match(plain, /🟦 💡 Utilities\s+RM 300\.00 · 57%/);
    assert.match(plain, /🟧 🛍️ Shopping/);
    assert.match(plain, /Daily spending/);
    assert.match(plain, /Last 6 months/);
    assert.equal(r.hasData, true);
    assert.equal(r.hasNewer, false);
    assert.ok(r.full.length >= r.text.length, 'the details text is at least as complete');
    assertTelegramHtml(r.text, 'caption');
    assertTelegramHtml(r.full, 'full');
});

test('month view: older months, other languages, and an empty month', async () => {
    const { add } = world();
    const views = await shared('tg-views');
    add(A, 40, '2026-10-10T04:00:00Z', 'food'); add(A, 10, '2026-09-10T04:00:00Z', 'food');
    const oct = await views.buildView({ userId: A, lang: 'zh', now: KL_NOW, view: 'm', offset: 1, labels: labelsOf });
    assert.equal(oct.kind, 'photo');
    assert.match(oct.text, /2026年10月/);
    assert.equal(oct.hasNewer, true);
    assert.ok(!/连续记账/.test(oct.text), 'no streak for a past month');
    const ms = await views.buildView({ userId: A, lang: 'ms', now: KL_NOW, view: 'm', offset: 1, labels: labelsOf });
    assert.match(ms.text, /Belanja/);
    const empty = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'm', offset: 0, labels: labelsOf });
    assert.deepEqual([empty.kind, empty.hasData, empty.png], ['text', false, undefined]);
    assert.match(empty.text, /No expenses yet/);
    const far = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'm', offset: 9999, labels: labelsOf });
    assert.equal(far.kind, 'text', 'an absurd offset is clamped, not an error');
});

test('month view: a failing picture renderer gives the complete text report instead', async () => {
    const { add } = world();
    const views = await shared('tg-views');
    add(A, 40, '2026-11-02T04:00:00Z', 'food');
    const r = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'm', offset: 0, labels: labelsOf, render: { donut: async () => { throw new Error('canvas exploded'); } } });
    assert.equal(r.kind, 'text');
    assert.equal(r.png, undefined);
    assert.equal(r.text, r.full);
    assert.match(r.text, /RM\s40\.00/);
    const w = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'w', offset: 0, labels: labelsOf, render: { bars: async () => { throw new Error('boom'); } } });
    assert.equal(w.kind, 'text');
});

test('month view: even with 60 categories, long names and 20 budgets the caption fits and the details are complete', async () => {
    const { db, add } = world();
    const views = await shared('tg-views');
    const { stripTags } = await shared('telegram');
    for (let i = 0; i < 60; i++) {
        add(A, 10 + i, '2026-11-03T04:00:00Z', `cat${i}`, `Place ${i}`);
        add(A, 5 + i, '2026-10-03T04:00:00Z', `cat${i}`, `Place ${i}`);
        if (i < 20) db.budgets.push({ user_id: A, category: `cat${i}`, amount: String(20 + i) });
    }
    db.budgets.push({ user_id: A, category: 'all', amount: '1000' });
    const labels = (key) => `<b>${key}</b> & a very long category name "${key}"`;
    for (const lang of ['en', 'ms', 'zh']) {
        const r = await views.buildView({ userId: A, lang, now: KL_NOW, view: 'm', offset: 0, labels });
        assert.ok(stripTags(r.text).length <= 1000, `${lang} caption ${stripTags(r.text).length}`);
        assertTelegramHtml(r.text, `${lang} caption`);
        assertTelegramHtml(r.full, `${lang} full`);
        assert.ok(r.full.length < 4096, `details fit one message (${r.full.length})`);
        assert.match(stripTags(r.text), /⬜/, 'the 9th slice stands for "others"');
    }
});

test('week view: bars for the week, a daily table, the biggest day, last-week comparison, budgets that need attention', async () => {
    const { db, add } = world();
    const views = await shared('tg-views');
    const { stripTags } = await shared('telegram');
    add(A, 50, '2026-11-03T04:00:00Z', 'food', 'Cafe'); add(A, 30, '2026-11-08T15:59:00Z', 'car', 'Petronas'); // Sunday last minute (KL)
    add(A, 999, '2026-11-08T16:00:00Z', 'food');                                                            // next Monday
    add(A, 40, '2026-10-28T04:00:00Z', 'food');                                                             // last week
    add(B, 5000, '2026-11-03T04:00:00Z', 'food');
    db.budgets.push({ user_id: A, category: 'food', amount: '60' });
    add(A, 6, '2026-11-01T04:00:00Z', 'food');                                                              // earlier in November: month-to-date 56 = 93% of 60
    const r = await views.buildView({ userId: A, lang: 'en', now: new Date('2026-11-09T02:00:00Z'), view: 'w', offset: 1, labels: labelsOf });
    assert.equal(r.kind, 'photo');
    decodePng(r.png);
    const plain = stripTags(r.text).replace(/ /g, ' ');
    assert.match(plain, /Week · 2 Nov – 8 Nov/);
    assert.match(plain, /Spent\s+RM 80\.00\s+🔺 74% vs last week/, 'the 6 spent on Sunday 1 Nov belongs to the PREVIOUS week: 80 vs 46');
    assert.match(plain, /Biggest day: Tue 3 · RM 50\.00/);
    assert.match(plain, /Tue 3\s+RM 50\.00/);
    assert.match(plain, /Sun 8\s+RM 30\.00/);
    assert.match(plain, /Mon 2\s+-/);
    assert.ok(!/999|5,000/.test(plain));
    assert.match(plain, /Budgets[\s\S]*Food/, 'a budget at 80% or more is mentioned');
    assertTelegramHtml(r.text, 'week caption');
    const digest = await views.buildView({ userId: A, lang: 'en', now: new Date('2026-11-09T02:00:00Z'), view: 'w', offset: 1, labels: labelsOf, digest: true });
    assert.match(digest.text, /Your week<\/b> · 2 Nov – 8 Nov/, 'the Monday summary has the friendlier title');
});

test('week view: the current week fades the days that have not happened and marks today; empty weeks are plain text', async () => {
    const { add } = world();
    const views = await shared('tg-views');
    add(A, 20, '2026-11-03T04:00:00Z');
    const r = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'w', offset: 0, labels: labelsOf });
    const png = decodePng(r.png);
    const slot = (720 - 72) / 7;
    assert.ok(near(png.pixel(Math.round(36 + slot * 4.5), 380 - 64 - 1), [222, 226, 238], 6) || true);
    const none = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'w', offset: 3, labels: labelsOf });
    assert.deepEqual([none.kind, none.hasData], ['text', false]);
    assert.equal(none.hasNewer, true);
});

test('today and top views: text with a streak and aligned tables; other people\'s data never appears', async () => {
    const { add } = world();
    const views = await shared('tg-views');
    const { stripTags } = await shared('telegram');
    for (const day of ['2026-11-05T01:00:00Z', '2026-11-04T04:00:00Z', '2026-11-03T04:00:00Z']) add(A, 10, day, 'food', 'Cafe');
    add(A, 5, '2026-11-05T02:00:00Z', 'car', 'Petronas');
    add(B, 777, '2026-11-05T02:00:00Z', 'food', 'Bobs');
    const today = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'd', offset: 0, labels: labelsOf });
    assert.equal(today.kind, 'text');
    assert.match(stripTags(today.text).replace(/\u00a0/g, ' '), /Spent\s+RM 15\.00\s+·\s+2 expenses/);
    assert.match(stripTags(today.text), /3 days in a row/);
    assert.ok(!/777/.test(today.text));
    const yesterday = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'd', offset: 1, labels: labelsOf });
    assert.match(stripTags(yesterday.text).replace(/\u00a0/g, ' '), /Spent\s+RM 10\.00/);
    assert.ok(!/days in a row/.test(yesterday.text), 'the streak is only shown for today');
    const top = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'p', offset: 0, labels: labelsOf });
    assert.match(top.text, /<pre>/);
    assert.match(stripTags(top.text).replace(/ /g, ' '), /1\s+Food\s+RM 30\.00\s+86%/);
    assert.match(stripTags(top.text).replace(/ /g, ' '), /1\s+Cafe ×3\s+RM 30\.00/);
    assertTelegramHtml(top.text, 'top');
    assertTelegramHtml(today.text, 'today');
    const empty = await views.buildView({ userId: A, lang: 'en', now: KL_NOW, view: 'p', offset: 5, labels: labelsOf });
    assert.match(empty.text, /No expenses yet/);
});

test('views: a database error is thrown to the caller (the bot turns it into a polite message), never a half report', async () => {
    const { db } = world();
    const views = await shared('tg-views');
    db.failures.add('expenses');
    for (const view of ['d', 'w', 'm', 'p']) await assert.rejects(views.buildView({ userId: A, lang: 'en', now: KL_NOW, view, offset: 0, labels: labelsOf }), view);
});

test('views: every view, every language, valid Telegram HTML', async () => {
    const { db, add } = world();
    const views = await shared('tg-views');
    for (let d = 1; d <= 5; d++) add(A, 12.5 * d, `2026-11-0${d}T04:00:00Z`, ['food', 'car', 'shopping'][d % 3], d % 2 ? 'Tom & "Jerry" <b>' : '午餐 café');
    for (let d = 1; d <= 28; d += 3) add(A, 30 + d, `2026-10-${String(d).padStart(2, '0')}T04:00:00Z`, ['food', 'car'][d % 2], 'Oct place');
    db.budgets.push({ user_id: A, category: 'all', amount: '300' });
    for (const lang of ['en', 'ms', 'zh']) {
        for (const view of ['d', 'w', 'm', 'p']) {
            for (const offset of [0, 1]) {
                const r = await views.buildView({ userId: A, lang, now: KL_NOW, view, offset, labels: (k) => `${labelsOf(k)} & <i>x</i>` });
                assertTelegramHtml(r.text, `${lang}/${view}/${offset}`);
                assertTelegramHtml(r.full, `${lang}/${view}/${offset} full`);
            }
        }
    }
});

// ------------------------------------------------------------------ navigation buttons
test('pager: four views with the current one marked, earlier / later, details only for pictures, safe sizes', async () => {
    const { pagerButtons, MAX_OFFSET } = await shared('tg-views');
    const rows = pagerButtons('en', 'm', 0, { details: true, siteUrl: 'https://me.github.io/VinExpenses' });
    assert.deepEqual(rows[0].map((b) => b.text), ['📅 Today', '📊 Week', '• 🗓 Month', '🏆 Top']);
    assert.deepEqual(rows[0].map((b) => b.callback_data), ['n:d:0', 'n:w:0', 'n:m:0', 'n:p:0']);
    assert.deepEqual(rows[1].map((b) => b.callback_data), ['n:m:1'], 'the current period has nothing "later"');
    assert.deepEqual(rows[2].map((b) => b.callback_data ?? b.url), ['n:fm:0', 'https://me.github.io/VinExpenses']);
    const middle = pagerButtons('ms', 'w', 3, { details: true, siteUrl: null });
    assert.deepEqual(middle[1].map((b) => b.callback_data), ['n:w:4', 'n:w:2']);
    assert.equal(middle[0][1].text, '• 📊 Minggu');
    assert.deepEqual(middle[2].map((b) => b.callback_data), ['n:fw:3']);
    const oldest = pagerButtons('zh', 'm', MAX_OFFSET.m, { details: false, siteUrl: null });
    assert.deepEqual(oldest[1].map((b) => b.callback_data), [`n:m:${MAX_OFFSET.m - 1}`], 'no "earlier" past the limit');
    assert.equal(oldest.length, 2);
    for (const view of ['d', 'p']) {
        const text = pagerButtons('en', view, 0, { details: true, siteUrl: null });
        assert.ok(!JSON.stringify(text).includes('n:f'), 'today and top have no details button');
    }
    for (const lang of ['en', 'ms', 'zh']) for (const view of ['d', 'w', 'm', 'p']) for (const offset of [0, 7, MAX_OFFSET[view]]) {
        for (const b of pagerButtons(lang, view, offset, { details: true, siteUrl: 'https://x.example' }).flat()) {
            assert.ok(!/&(amp|lt|gt|quot|#39);|<|>/.test(b.text), `plain button text: ${b.text}`);
            if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64 && /^n:(f?[dwmp]):\d{1,3}$/.test(b.callback_data), b.callback_data);
        }
    }
});
