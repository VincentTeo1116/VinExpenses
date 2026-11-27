// Local only: scores the receipt reader on private receipts. Skipped unless ACCURACY_DIR points at a folder with truth.json and cache/<id>.json (never committed).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { SplitBill } from './types';
import { scoreBill, summarise, type Score, type Truth } from './accuracy';
import { placedWords } from './lastScan';
import { bestReading, readReceipt } from './read';
import { placedRows } from './rows';

const dir = process.env.ACCURACY_DIR;
type Pass = { text: string; words: { t: string; x: number; y: number; w: number; h: number }[] };

const STRATEGIES: Record<string, string[]> = {
  'normal (plain photo, default mode)': ['raw|3'],
  'plain photo, mode 6': ['raw|6'],
  'browser passes (prepared, 3 modes)': ['flat|6', 'flat|11', 'flat|4', 'crop|6', 'crop|11', 'crop|4'],
  'PaddleOCR models, plain photo': ['rapid|raw'],
  'PaddleOCR models, prepared photo': ['rapid|flat'],
  'PaddleOCR models, both': ['rapid|raw', 'rapid|flat'],
  'PaddleOCR (both) + Tesseract passes': ['rapid|raw', 'rapid|flat', 'flat|6', 'flat|11', 'crop|6', 'crop|11'],
  'every pass': ['raw|3', 'raw|4', 'raw|6', 'raw|11', 'flat|6', 'flat|11', 'flat|4', 'crop|6', 'crop|11', 'crop|4'],
};

describe.skipIf(!dir)('local accuracy on private receipts', () => {
  it('prints the accuracy of each strategy', () => {
    const truth = JSON.parse(readFileSync(join(dir as string, 'truth.json'), 'utf8')) as Record<string, Truth & { kind: string }>;
    const only = process.env.ACCURACY_ONLY?.split(',');
    const tags = Object.keys(truth).filter((t) => existsSync(join(dir as string, 'cache', `${t}.json`)) && (!only || only.includes(t)));
    const passes = (tag: string, keys: string[]) => {
      const cache = JSON.parse(readFileSync(join(dir as string, 'cache', `${tag}.json`), 'utf8')) as Record<string, Pass>;
      return keys.flatMap((k) => (cache[k] ? [{ text: cache[k].text, words: placedWords(cache[k].words) }] : []));
    };
    const lines: string[] = [];
    const run = (name: string, read: (tag: string) => Score) => {
      const scores = tags.map(read);
      const all = summarise(scores);
      const bills = summarise(scores.filter((_, i) => truth[tags[i] as string]?.kind === 'bill'));
      lines.push(`${name.padEnd(46)} all ${(all.accuracy * 100).toFixed(1).padStart(5)}%  bills ${(bills.accuracy * 100).toFixed(1).padStart(5)}%  perfect ${all.perfect}/${all.receipts}  | ${scores.map((s) => (s.accuracy * 100).toFixed(0).padStart(3)).join(' ')}`);
    };
    lines.push(`receipts: ${tags.join(' ')}`);
    for (const [name, keys] of Object.entries(STRATEGIES)) run(name, (tag) => scoreBill(bestReading(passes(tag, keys)).parsed.bill, truth[tag] as Truth));
    const keys = [...(STRATEGIES['every pass'] as string[]), 'rapid|raw', 'rapid|flat'];
    const detail: string[] = [];
    run('ORACLE: best single pass per receipt', (tag) => {
      const cache = JSON.parse(readFileSync(join(dir as string, 'cache', tag + '.json'), 'utf8')) as Record<string, Pass>;
      const each = keys.filter((k) => cache[k]).map((k) => ({ k, score: scoreBill(readReceipt((cache[k] as Pass).text, placedWords((cache[k] as Pass).words)).parsed.bill, truth[tag] as Truth) }));
      const best = each.reduce((b, n) => (n.score.accuracy > b.score.accuracy ? n : b));
      detail.push(tag + ' best ' + best.k + ' ' + (best.score.accuracy * 100).toFixed(0) + '% missed: ' + best.score.fields.filter((x) => !x.ok).map((x) => x.field + ' ' + x.expected).join(', ') + ' | extra ' + best.score.extra);
      return best.score;
    });
    lines.push('', ...detail);
    writeFileSync(join(dir as string, 'accuracy-report.txt'), lines.join('\n') + '\n');
  });
});

describe.skipIf(!dir || !process.env.ACCURACY_ROWS)('local: rows of the best pass for chosen receipts', () => {
  it('writes rows-<id>.txt', () => {
    const truth = JSON.parse(readFileSync(join(dir as string, 'truth.json'), 'utf8')) as Record<string, Truth>;
    for (const tag of (process.env.ACCURACY_ROWS as string).split(',')) {
      const cache = JSON.parse(readFileSync(join(dir as string, 'cache', tag + '.json'), 'utf8')) as Record<string, Pass>;
      const each = Object.keys(cache).filter((k) => !process.env.ACCURACY_PREFIX || k.startsWith(process.env.ACCURACY_PREFIX)).map((k) => ({ k, r: readReceipt((cache[k] as Pass).text, placedWords((cache[k] as Pass).words)) })).map((x) => ({ ...x, s: scoreBill(x.r.parsed.bill, truth[tag] as Truth) }));
      const best = each.reduce((b, n) => (n.s.accuracy > b.s.accuracy ? n : b));
      const pass = cache[best.k] as Pass;
      const rows = placedRows(placedWords(pass.words)).map((r) => r.text);
      const b = best.r.parsed.bill;
      const missed = best.s.fields.filter((x) => !x.ok).map((x) => x.field + ' ' + x.expected).join(', ');
      const out = [`missed: ${missed} | extra ${best.s.extra}`, `pass ${best.k} from ${best.r.from} status ${best.r.audit.status} accuracy ${best.s.accuracy.toFixed(2)}`, '--- rows (positions)', ...rows, '--- text lines', ...pass.text.split('\n'), '--- parsed', ...b.lines.map((l) => `line qty ${l.qty} gross ${l.grossCents} disc ${l.discountCents} | ${l.raw ?? l.name}`), `subtotal ${b.subtotalCents} service ${b.serviceCents} sst ${b.sstCents} rounding ${b.roundingCents} total ${b.totalCents} billDisc ${b.billDiscountCents}`, '--- ignored', ...best.r.parsed.ignored.map((i) => `${i.why}: ${i.row}`)];
      writeFileSync(join(dir as string, 'rows-' + tag + '.txt'), out.join('\n') + '\n');
    }
  });
});

describe.skipIf(!dir || !existsSync(join(dir ?? '', 'ai')))('local: AI reader answers (from ai/<model>/<id>.json)', () => {
  it('scores each model and appends to the report', () => {
    const base = join(dir as string, 'ai');
    const truth = JSON.parse(readFileSync(join(dir as string, 'truth.json'), 'utf8')) as Record<string, Truth & { kind: string }>;
    const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Math.round(parseFloat(v) * 100) : null);
    const out: string[] = ['', 'AI readers (Workers AI), same scoring:'];
    for (const model of readdirSync(base)) {
      const scores: Score[] = [];
      let failed = 0;
      const tags = Object.keys(truth).filter((t) => existsSync(join(base, model, `${t}.json`)));
      for (const tag of tags) {
        const answer = JSON.parse(readFileSync(join(base, model, `${tag}.json`), 'utf8')) as { parsed?: Record<string, unknown> };
        const p = answer.parsed;
        if (!p) failed += 1;
        const items = Array.isArray(p?.items) ? (p?.items as { amount?: unknown }[]) : [];
        const bill: SplitBill = {
          lines: items.flatMap((it, i) => {
            const c = cents(it.amount);
            return c == null ? [] : [{ id: 'a' + i, qty: 1, name: 'x', unitCents: null, grossCents: c, discountCents: 0, discountPercent: null, taxable: true }];
          }),
          billDiscountCents: 0,
          subtotalCents: cents(p?.subtotal),
          servicePercent: null,
          serviceCents: cents(p?.service_charge),
          sstPercent: null,
          sstCents: cents(p?.tax),
          roundingCents: cents(p?.rounding),
          totalCents: cents(p?.total),
        };
        scores.push(scoreBill(bill, truth[tag] as Truth));
      }
      const all = summarise(scores);
      const bills = summarise(scores.filter((_, i) => truth[tags[i] as string]?.kind === 'bill'));
      out.push(`${model.padEnd(52)} all ${(all.accuracy * 100).toFixed(1).padStart(5)}%  bills ${(bills.accuracy * 100).toFixed(1).padStart(5)}%  perfect ${all.perfect}/${all.receipts}  unanswered ${failed}  | ${scores.map((s) => (s.accuracy * 100).toFixed(0).padStart(3)).join(' ')}`);
    }
    writeFileSync(join(dir as string, 'ai-report.txt'), out.join('\n') + '\n');
  });
});
