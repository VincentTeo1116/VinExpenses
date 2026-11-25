/* Turns receipt text (from OCR or a PDF) into a draft expense: merchant, amount, date and how sure it is. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ReceiptParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Text helpers Section
    function normalizeText(text) {
        // Normalise look-alike characters first, or keywords and dates won't match.
        return String(text == null ? '' : text).normalize('NFKC')
            .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) // full-width -> ASCII (: , 0-9 ...)
            .replace(/　/g, ' ')
            .replace(/[   ]/g, ' ')
            .replace(/[−–—]/g, '-')
            .replace(/\r/g, '');
    }

    function toLines(text) {
        return normalizeText(text).split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
    }

    const hasLetters = s => /[A-Za-z一-鿿]{2,}/.test(s);

    // Amounts Section
    const CURRENCY_ALIASES = { RM: 'MYR', 'R.M': 'MYR', 'R.M.': 'MYR', MYR: 'MYR', RMB: 'CNY', CNY: 'CNY', USD: 'USD', 'US$': 'USD', SGD: 'SGD', 'S$': 'SGD', THB: 'THB', IDR: 'IDR', EUR: 'EUR', GBP: 'GBP', JPY: 'JPY', AUD: 'AUD', HKD: 'HKD', $: 'USD' };

    // prefix, optional leading minus, optional currency, optional minus, number
    const AMOUNT_RE = /(^|[^A-Za-z0-9.,])(-\s*)?(?:(R\.?M\.?|MYR|RMB|CNY|USD|US\$|SGD|S\$|THB|IDR|EUR|GBP|JPY|AUD|HKD|\$)\s*[:.]?\s*)?(-\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![A-Za-z0-9])/gi;

    function parseNumber(raw) {
        if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) return Number(raw.replace(/,/g, ''));
        if (/^\d+,\d{2}$/.test(raw)) return Number(raw.replace(',', '.')); // OCR often reads "12.50" as "12,50"
        if (/^\d+(\.\d{1,2})?$/.test(raw)) return Number(raw);
        return NaN;
    }

    function currencyOf(code) {
        if (!code) return null;
        return CURRENCY_ALIASES[code.toUpperCase().replace(/\s/g, '')] || code.toUpperCase();
    }

    // Finds amounts on one line. A bare number needs two decimals, so quantities and years are ignored.
    function findAmountsInLine(line) {
        const out = [];
        AMOUNT_RE.lastIndex = 0;
        let m;
        while ((m = AMOUNT_RE.exec(line))) {
            const raw = m[5];
            const start = m.index + m[1].length;
            const end = m.index + m[0].length;
            const after = line.slice(end);
            if (/^[./-]\d/.test(after)) continue;                   // part of a date such as 2026.08.27
            if (/^\s*(?:off|discount|voucher|promo|cashback|rebate|free)\b/i.test(after)) continue;   // "RM3 off delivery" describes a deal
            const currency = currencyOf(m[3]);
            const value = parseNumber(raw);
            if (!isFinite(value)) continue;
            const twoDecimals = /[.,]\d{2}$/.test(raw);
            if (!currency && !twoDecimals) continue;
            const negative = !!(m[2] || m[4]) || /\(\s*$/.test(line.slice(0, start)) && /^\s*\)/.test(after);
            out.push({ value, currency, negative, index: start, end, raw: line.slice(start, end).trim() });
        }
        return out;
    }

    // Label scoring: the best "this is the total" rule wins, and every "not the total" rule counts against.
    const POSITIVE_RULES = [
        [/grand\s*total|jumlah\s*besar|jumlah\s*keseluruhan|总金额|合计|总计|总额|總計/, 13],
        [/total\s*\(?\s*(?:incl|inclusive|payable|due|paid|amount|bayar)|amount\s*(?:due|payable|paid|charged)|net\s*(?:total|payable|amount|payment)|balance\s*due|total\s*bayar|jumlah\s*bayaran|anda\s*bayar|you\s*(?:pay|paid)|paid\s*by\s*customer|payment\s*amount|total\s*charge|应付|实付|实收/, 12],
        [/\btotal\b/, 9],
        [/\bjumlah\b/, 9],
        [/\bamount\b/, 6],
        [/\bpaid\b|\bpayment\b|\bbayar\b/, 4]
    ];
    const NEGATIVE_RULES = [
        [/sub\s*-?\s*total|jumlah\s*kecil|小计/, -9],
        [/\b(?:exc|excl|excluding|before)\b|ex\.?\s*(?:tax|sst|gst)|exclusive/, -10],
        [/discount|\bdisc\b|diskaun|saving|promo|voucher|rebate|coupon|\boff\b|cashback|coins?\b|points?\b|优惠|折扣/, -11],
        [/\bcash\b|tunai|\bchange\b|\bbaki\b|tender|received|\bvisa\b|master\s*card|\bcard\b|debit|credit\b|e-?wallet/, -6],
        [/\bqty\b|quantity|\bitems?\b|\bpcs\b|\bunits?\b|数量|件数/, -9],
        [/total\s*value|goods\s*value|declared|总价值|货值/, -10],
        [/rounding|round\s*adj|pembundaran/, -11],
        [/delivery|shipping|freight|\bfees?\b|\bcharges?\b|service\s*tax|\bsst\b|\bgst\b|\btax\b|\bvat\b|\btips?\b|运费/, -6],
        [/deposit|outstanding|previous|\bbf\b/, -6],
        [/syarikat\s*bayar|company\s*pays|paid\s*by\s*company/, -12]
    ];
    const FOREIGN_PENALTY = -14;

    function scoreLabel(label) {
        const l = String(label || '').toLowerCase();
        if (!l) return 0;
        let positive = 0;
        for (const [re, weight] of POSITIVE_RULES) if (re.test(l)) { positive = Math.max(positive, weight); }
        let negative = 0;
        for (const [re, weight] of NEGATIVE_RULES) if (re.test(l)) negative += weight;
        // "TOTAL (INCL. TAX)" mentions tax but is the amount you pay: undo the tax/fee penalty
        if (positive && /incl(?:uding|usive|uded|\.)?\s*(?:of\s*)?(?:tax|sst|gst)|tax\s*\(?(?:incl|included)|(?:with|plus)\s*(?:service\s*)?(?:tax|sst|gst|vat)/.test(l)) negative = Math.max(negative, negative + 6);
        return positive + Math.min(0, negative);
    }

    // An amount's label is the text before it, or the nearest line above with words and no amount.
    function labelFor(lines, lineAmounts, i, amount) {
        const same = lines[i].slice(0, amount.index).replace(/[:|=.\-\s]+$/, '').trim();
        if (hasLetters(same)) return same;
        for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
            if (lineAmounts[k].length) continue;
            if (hasLetters(lines[k])) return lines[k].replace(/[:|=.\-\s]+$/, '').trim();
        }
        return '';
    }

    const BASE_RE = /total\s*sales|net\s*sales|sub\s*-?\s*total|jumlah\s*kecil|小计|^\s*sales\b/;
    const EXTRA_RE = /service\s*(?:charge|tax)|\bsst\b|\bgst\b|\btax\b|\bvat\b|delivery|shipping|freight|\bfees?\b|\bcharges?\b|\btips?\b|rounding/;
    const INFO_ONLY_RE = /incl(?:uding|usive|uded|\.)?|included|\bof\s+which\b/;

    // subtotal + tax/fees - discounts, to confirm a candidate total
    function arithmeticTargets(tokens) {
        const bases = tokens.filter(t => !t.negative && BASE_RE.test(t.label.toLowerCase()) && !t.converted);
        const targets = [];
        bases.forEach(base => {
            let sum = base.value;
            tokens.forEach(t => {
                if (t === base || t.converted || t.value === 0) return;
                const label = t.label.toLowerCase();
                if (t.negative || /discount|promo|voucher|rebate|coupon|\boff\b|cashback|diskaun/.test(label)) { sum -= t.value; return; }
                if (EXTRA_RE.test(label) && !INFO_ONLY_RE.test(label) && !BASE_RE.test(label)) sum += t.value;
            });
            targets.push(Math.round(sum * 100));
        });
        return targets;
    }

    function pickTotal(lines) {
        const lineAmounts = lines.map(findAmountsInLine);
        const tokens = [];
        lineAmounts.forEach((amounts, i) => {
            amounts.forEach(amount => {
                const converted = /^\s*[=≈~]/.test(lines[i].slice(0, amount.index + 1)) || /^[=≈~]/.test(lines[i]); // "= RMB 371.28" is a conversion of the line above
                tokens.push({
                    ...amount,
                    line: i,
                    converted,
                    label: labelFor(lines, lineAmounts, i, amount)
                });
            });
        });

        const usable = tokens.filter(t => t.value > 0 && !t.negative && !t.converted);
        if (!usable.length) {
            // An e-wallet payment screen shows what you paid as "-RM 163.92" (money out). With nothing else to go on, and words that say it is a
            // payment, that amount is the answer.
            const paid = tokens.filter(t => t.value > 0 && t.negative && !t.converted && (!t.currency || t.currency === 'MYR'));
            if (paid.length && /\b(?:payment|paid|transaction|purchase|debit|bayaran|pembayaran|successful(?:ly)?)\b/i.test(lines.join('\n'))) {
                const top = [...paid].sort((a, b) => b.value - a.value)[0];
                return { amount: top.value, confidence: 'medium', currency: 'MYR', evidence: lines[top.line], candidates: [{ amount: top.value, label: 'Payment', score: 9, currency: 'MYR', verified: false }] };
            }
            return { amount: 0, confidence: 'none', candidates: [], currency: null };
        }

        const arithmetic = arithmeticTargets(tokens);
        const groups = new Map();
        usable.forEach(t => {
            const cents = Math.round(t.value * 100);
            const foreign = t.currency && t.currency !== 'MYR';
            const raw = scoreLabel(t.label);
            const score = raw + (foreign ? FOREIGN_PENALTY : 0);
            let g = groups.get(cents + ':' + (t.currency || ''));
            if (!g) {
                g = { value: cents / 100, cents, currency: t.currency || null, score: -99, raw: -99, best: null, agreeing: 0, labels: [], bare: false };
                groups.set(cents + ':' + (t.currency || ''), g);
            }
            if (/^\$/.test(t.raw)) g.bare = true;
            if (raw > g.raw) g.raw = raw;                       // label score before the foreign-currency penalty
            if (score > g.score) { g.score = score; g.best = t; }
            if (score >= 9) g.agreeing++;
            if (t.label) g.labels.push(t.label);
        });

        const ranked = [...groups.values()].map(g => {
            let score = g.score;
            if (g.agreeing > 1) score += Math.min(6, (g.agreeing - 1) * 3);      // several "total" labels agree
            const verified = g.score >= 0 && arithmetic.includes(g.cents);
            if (verified) score += 5;                                              // subtotal + tax + fees - discounts matches
            return { ...g, score, verified };
        }).sort((a, b) => b.score - a.score || b.value - a.value);

        const best = ranked[0];
        const second = ranked[1];
        const margin = best.score - (second ? second.score : -20);
        const foreign = best.currency && best.currency !== 'MYR';

        let confidence = 'low';
        if (!foreign && best.score >= 9 && (margin >= 6 || best.verified || best.agreeing >= 2)) confidence = 'high';
        else if (!foreign && best.score >= 6 && margin >= 3) confidence = 'medium';

        const candidates = ranked
            .filter(g => g.score > -8 || g === best)
            .slice(0, 4)
            .map(g => ({ amount: g.value, label: g.best && g.best.label ? g.best.label.slice(0, 40) : '', score: g.score, currency: g.currency, verified: g.verified }));

        // No label pointed at anything: offer the biggest plausible amounts, but don't auto-fill
        if (best.score <= 0) {
            const biggest = [...groups.values()].filter(g => !g.currency || g.currency === 'MYR').sort((a, b) => b.value - a.value).slice(0, 4);
            const result = {
                amount: 0,
                confidence: 'low',
                currency: 'MYR',
                candidates: biggest.map(g => ({ amount: g.value, label: g.best && g.best.label ? g.best.label.slice(0, 40) : '', score: g.score, currency: g.currency, verified: false }))
            };
            // The only clear "total" is in another currency (USD, RMB...): say so instead of staying silent
            const foreignTotal = [...groups.values()].filter(g => g.currency && g.currency !== 'MYR').sort((a, b) => b.raw - a.raw)[0];
            if (foreignTotal && foreignTotal.raw >= 6) {
                // a bare "$" could be US, Singapore or Hong Kong dollars: it is reported, but never converted without asking
                result.foreignTotal = { amount: foreignTotal.value, currency: foreignTotal.currency, ambiguous: foreignTotal.bare };
                result.candidates.unshift({ amount: foreignTotal.value, label: foreignTotal.best && foreignTotal.best.label ? foreignTotal.best.label.slice(0, 40) : '', score: foreignTotal.raw, currency: foreignTotal.currency, verified: false });
            }
            return result;
        }
        return { amount: best.value, confidence, currency: best.currency || 'MYR', candidates, evidence: best.best ? lines[best.best.line] : '' };
    }

    // Dates Section
    const MONTHS = {
        jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2, mar: 3, march: 3, mac: 3, apr: 4, april: 4,
        may: 5, mei: 5, jun: 6, june: 6, jul: 7, july: 7, julai: 7, aug: 8, august: 8, ogos: 8, sep: 9, sept: 9, september: 9,
        oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, dis: 12, disember: 12
    };
    const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

    function validDate(y, m, d, now) {
        const date = new Date(y, m - 1, d);
        if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
        const latest = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
        if (y < 2000 || date > latest) return null;
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    function fullYear(y) { return y < 100 ? 2000 + y : y; }

    function findDatesInLine(line, now) {
        const found = [];
        const push = (iso, index) => { if (iso) found.push({ iso, index }); };
        let m;
        const cn = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g;
        while ((m = cn.exec(line))) push(validDate(+m[1], +m[2], +m[3], now), m.index);
        const iso = /(?:^|[^\d])(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/g;
        while ((m = iso.exec(line))) push(validDate(+m[1], +m[2], +m[3], now), m.index);
        const dmy = /(?:^|[^\d])(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)/g;
        while ((m = dmy.exec(line))) {
            let day = +m[1], month = +m[2];
            if (month > 12 && day <= 12) [day, month] = [month, day];       // mm/dd/yyyy
            push(validDate(fullYear(+m[3]), month, day, now), m.index);
        }
        const dMonY = new RegExp('(?:^|[^\\d])(\\d{1,2})(?:st|nd|rd|th)?[\\s.-]*(' + MONTH_NAMES + ')\\.?,?[\\s.-]*(\\d{4}|\\d{2})(?!\\d)', 'gi');
        while ((m = dMonY.exec(line))) push(validDate(fullYear(+m[3]), MONTHS[m[2].toLowerCase()], +m[1], now), m.index);
        const monDY = new RegExp('\\b(' + MONTH_NAMES + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)', 'gi');
        while ((m = monDY.exec(line))) push(validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2], now), m.index);
        return found;
    }

    function parseDate(lines, now) {
        now = now || new Date();
        let best = null;
        lines.forEach((line, i) => {
            const context = (lines[i - 1] || '') + ' ' + line;
            const hits = findDatesInLine(line, now);
            hits.forEach(hit => {
                let weight = 0;
                const near = line.slice(Math.max(0, hit.index - 30), hit.index + 1).toLowerCase() + ' ' + (lines[i - 1] || '').toLowerCase();
                if (/pick-?up|order\s*time|transaction|invoice\s*date|date\s*of\s*(?:issue|invoice)|printed\s*on|tarikh|日期/.test(near)) weight += 3;
                else if (/\bdate\b|\btime\b/.test(near)) weight += 2;
                // "Invoice" or "Receipt" on its own line, then the date: that is the document's date (not, say, the date an email was forwarded)
                if (/^(?:tax\s*)?(?:invoice|receipt)\s*:?$/i.test((lines[i - 1] || '').trim())) weight = Math.max(weight, 3);
                if (/\bdue\b|expir|valid\s*until|birth|到期/.test(context.toLowerCase())) weight -= 3;
                if (!best || weight > best.weight) best = { iso: hit.iso, weight };
            });
        });
        return best ? best.iso : '';
    }

    // Merchant Section
    const LEGAL_SUFFIX = /\b(?:sdn\.?\s*bhd\.?|berhad|bhd\.?|co\.?,?\s*ltd\.?|ltd\.?|llp|plt|enterprise|trading|& co\.?|and co\.?|restaurant|restoran|cafe|café|bakery|patisserie|mart|supermarket|pharmacy|clinic|kopitiam|bistro|kitchen)\b/i;
    const NOT_A_NAME = /receipt|invoice|tax\s*invoice|commercial|cashier|customer|\btel\b|phone|\bdate\b|\btime\b|table\s*#?|\bgst\b|\bsst\b|reg\.?\s*no|registered|thank\s*you|computer[- ]generated|no\s*signature|^from\b|^to\b|^outlook|^your\b|^hope\b|^issued|^booking|^description|^address|^shipping|^payment|^waybill|^international|^page\b|^www\.|@|\bhttps?:|\.(?:com|my|net|org)\b/i;
    const ADDRESS_LIKE = /\b(?:jalan|jln|lorong|lebuh|persiaran|taman|bandar|seksyen|section|floor|level|lot\s*\d|no\.?\s*\d|kuala\s*lumpur|selangor|petaling|malaysia|postal|\d{5})\b/i;

    function cleanName(name) {
        return String(name || '')
            .replace(/\[[^\]]*\]/g, ' ')
            .replace(/^(?:company|merchant|store|outlet|restaurant|sold\s*by|seller|vendor)\s*:\s*/i, '')
            .replace(/[\s,;:|-]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
    }

    function detectTemplate(text) {
        if (/your grab e-?receipt|\bgrab\.com\b|grabfood|grabmart|\bgrabcar\b|justgrab|grabbike|grabtaxi/i.test(text)) {
            if (/vehicle\s*type\s*:?\s*\n?\s*grabmart/i.test(text)) return { id: 'grab-mart', category: 'shopping' };
            if (/vehicle\s*type\s*:?\s*\n?\s*grabfood|grabfood/i.test(text)) return { id: 'grab-food', category: 'food' };
            return { id: 'grab-ride', category: 'travel' };
        }
        return { id: 'generic', category: '' };
    }

    function grabMerchant(lines, template) {
        const start = lines.findIndex(l => /^order location\s*:?$/i.test(l));
        if (template.id === 'grab-ride') return 'Grab';
        if (start < 0) return '';
        const parts = [];
        for (let k = start + 1; k < Math.min(lines.length, start + 4); k++) {
            if (/^(delivery location|profile|issued to|booking|receipt summary)/i.test(lines[k])) break;
            parts.push(lines[k]);
        }
        const joined = parts.join(' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
        return cleanName(joined.split(/\s+-\s+/)[0]);
    }

    function genericMerchant(lines, text) {
        const domains = [...text.matchAll(/(?:www\.)?([a-z0-9][a-z0-9-]{2,})\.(?:com|my|co|net|org)\b/gi)].map(m => m[1].toLowerCase());
        const candidates = [];
        lines.slice(0, 14).forEach((raw, i) => {
            let line = raw.replace(/^(?:company|merchant|store|outlet|restaurant|sold\s*by|seller|vendor)\s*:\s*/i, '').trim();
            if (line.length < 2 || line.length > 60) return;
            if (!/[A-Za-z]/.test(line)) return;                       // Chinese-only lines: prefer the English one
            if (NOT_A_NAME.test(line) || ADDRESS_LIKE.test(line)) return;
            if (/^[\d\s.,:/#-]+$/.test(line)) return;
            if (findAmountsInLine(line).length) return;
            const words = line.split(/\s+/);
            if (words.length > 7 || /[.!?]$/.test(line) && words.length > 3) return;   // sentences are not names
            let score = 0;
            if (LEGAL_SUFFIX.test(line) || /&\s*co\b/i.test(line)) score += 3;
            if (/^[A-Z][\w&'.,()é-]*(?:\s+[A-Z&][\w&'.,()é-]*)*$/.test(line) || line === line.toUpperCase()) score += 2;
            score += Math.max(0, 3 - Math.floor(i / 2));              // closer to the top is likelier
            const key = line.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (domains.some(d => key.startsWith(d.slice(0, 5)) || d.startsWith(key.slice(0, 5)))) score += 3;   // brand matches the web address
            if (/\bsdn\s*bhd\b/i.test(line) && i > 3) score -= 1;
            candidates.push({ line, score });
        });
        candidates.sort((a, b) => b.score - a.score);
        return candidates.length && candidates[0].score >= 3 ? cleanName(candidates[0].line) : '';
    }

    // Public API Section

    // ---- extras: a tidy merchant name, the payment method, and the line the total came from ----
    /** "THE CONTS SDN BHD (1521322-V)" -> "The Conts Sdn Bhd"; "99 SPEEDMART KB 12" -> "99 Speedmart". Names that are not all capitals are left alone. */
    const SHORT_WORDS = new Set(['the', 'and', 'sdn', 'bhd', 'co', 'ltd', 'llp', 'plt']);
    function tidyMerchant(name) {
      let s = String(name || '')
        .replace(/\s*\(\s*\d{4,}\s*-?\s*[A-Za-z]?\s*\)/g, '') // company registration number
        .replace(/\s*-\s*(?:branch|outlet|cawangan)\b.*$/i, '')
        .replace(/\s+(?:branch|outlet|cawangan|store|kedai)\s*#?\d+$/i, '')
        .replace(/\s+#\d+$/, '')
        .replace(/\s+[A-Z]{1,3}\s?\d{1,3}$/, '') // a store code such as "KB 12"
        .replace(/\s+/g, ' ')
        .trim();
      const capitals = s !== '' && !/[a-z]/.test(s) && /[A-Z]{4}/.test(s);
      if (capitals) {
        s = s.replace(/(\S{3,}) \d{1,3}$/, '$1'); // a bare branch number after a long capitalised name ("99 SPEEDMART 12")
        s = s
          .split(' ')
          .map((word) => {
            const letters = word.replace(/[^A-Za-z]/g, '');
            if (letters.length <= 3 && !SHORT_WORDS.has(letters.toLowerCase())) return word; // KFC, TSL, F&B stay as they are
            return word.charAt(0) + word.slice(1).toLowerCase();
          })
          .join(' ');
      }
      return s.slice(0, 80);
    }

    const PAYMENT_FAMILIES = [
      ['ewallet', /touch\s*['`]?\s*n\s*['`]?\s*go|\btng\b|grab\s*pay|\bboost\b|shopee\s*pay|\bbigpay\b|e-?wallet|duitnow\s*qr|alipay|wechat\s*pay|\bsetel\b|paylater/i],
      ['card', /\bvisa\b|master\s*card|\bamex\b|american\s*express|credit\s*card|debit\s*card|card\s*payment/i],
      ['bank', /\bfpx\b|online\s*banking|bank\s*transfer|\bibg\b|duitnow\s*transfer|\bgiro\b/i],
    ];
    /** The payment method the receipt names (e-wallet, card or bank), only when it names exactly one kind. */
    function paymentHint(text) {
      const found = PAYMENT_FAMILIES.filter(([, re]) => re.test(text)).map(([key]) => key);
      return found.length === 1 ? { payment: found[0] } : {};
    }

    function parseReceiptText(text, options) {
        options = options || {};
        const lines = toLines(text);
        const normalized = lines.join('\n');
        const template = detectTemplate(normalized);
        const total = pickTotal(lines.map(repairSplitDigits));
        const merchant = template.id.startsWith('grab') ? grabMerchant(lines, template) : genericMerchant(lines, normalized);
        const warnings = [];
        if (total.currency && total.currency !== 'MYR' && total.amount) warnings.push(`The amount looks like ${total.currency}, not RM. Check it.`);
        if (total.foreignTotal) warnings.push(`This receipt is in ${total.foreignTotal.currency} (${total.foreignTotal.amount.toFixed(2)}), not RM. Enter the ringgit amount you actually paid.`);
        const filled = total.confidence === 'high' || total.confidence === 'medium';
        const dateFound = parseDate(lines, options.now);
        const alnum = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const merchantKey = alnum(merchant).slice(0, 10);
        const merchantEvidence = merchantKey.length >= 3 ? (lines.slice(0, 20).find(line => alnum(line).includes(merchantKey)) || '') : '';
        const dateEvidence = dateFound ? (lines.find(line => findDatesInLine(line, options.now || new Date()).some(hit => hit.iso === dateFound)) || '') : '';
        const otherCurrencies = [...new Set(lines.flatMap(line => findAmountsInLine(line)).map(a => a.currency).filter(c => !!c && c !== 'MYR'))];
        return {
            otherCurrencies,
            ...(total.foreignTotal ? { foreignTotal: { amount: total.foreignTotal.amount, currency: total.foreignTotal.currency, ambiguous: Boolean(total.foreignTotal.ambiguous) } } : {}),
            merchant: tidyMerchant(merchant),
            amount: filled ? total.amount : 0,
            amountEvidence: filled ? (total.evidence || '').slice(0, 80) : '',
            bestGuess: total.amount || (total.candidates[0] ? total.candidates[0].amount : 0),
            amountConfidence: total.confidence,
            amountCandidates: total.candidates,
            currency: total.currency,
            date: dateFound,
            merchantEvidence,
            dateEvidence,
            template: template.id,
            hints: Object.assign({}, template.category ? { category: template.category } : {}, paymentHint(normalized)),
            warnings
        };
    }

    // "TOTAL 1 2.50" (OCR split the digits): rejoin when a total-like label is followed by "d dd.dd"
    function repairSplitDigits(line) {
        if (!/total|jumlah|amount|bayar/i.test(line)) return line;
        return line.replace(/(\D)(\d) (\d{1,2}[.,]\d{2})\s*$/, '$1$2$3');
    }

    // A PDF can be read in its own order or as visual rows; neither suits every document, so both are tried.
    function pdfContentOrderToText(items) {
        let text = '';
        let prev = null;
        (items || []).forEach(item => {
            if (!item || typeof item.str !== 'string') return;
            // pdf.js ends a line with an empty item, so empty items must still break the line.
            if (!item.str) {
                if (item.hasEOL && text && !/\n$/.test(text)) text += '\n';
                return;
            }
            if (prev && !/\n$/.test(text) && !/\s$/.test(text) && !/^\s/.test(item.str)) {
                const sameRow = Math.abs((item.y || 0) - (prev.y || 0)) < Math.max(2, (prev.height || 8) * 0.5);
                const gap = (item.x || 0) - ((prev.x || 0) + (prev.width || 0));
                if (!sameRow || gap > 1.2) text += ' ';
            }
            text += item.str;
            if (item.hasEOL && !/\n$/.test(text)) text += '\n';
            prev = item;
        });
        return text;
    }

    const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, none: 0 };

    // Parse several readings of the same receipt and keep the best. Earlier readings win ties.
    function parseBest(texts, options) {
        const list = (Array.isArray(texts) ? texts : [texts]).filter(t => typeof t === 'string' && t.trim());
        let best = null;
        list.forEach((text, index) => {
            const parsed = parseReceiptText(text, options);
            const score = (CONFIDENCE_RANK[parsed.amountConfidence] || 0) * 100 + (parsed.merchant ? 10 : 0) + (parsed.date ? 5 : 0) + (parsed.amount ? 5 : 0);
            if (!best || score > best.score) best = { parsed, score, text, index };
        });
        if (!best) return { ...parseReceiptText('', options), text: '', readingIndex: -1 };
        return { ...best.parsed, text: best.text, readingIndex: best.index };
    }

    // Rebuild visual lines from positions, so a label and its amount end up together.
    function pdfItemsToText(items) {
        const usable = (items || []).filter(it => it && typeof it.str === 'string' && it.str.trim());
        usable.sort((a, b) => (b.y - a.y) || (a.x - b.x));
        const rows = [];
        usable.forEach(item => {
            const tolerance = Math.max(2, (item.height || 8) * 0.45);
            const row = rows.find(r => Math.abs(r.y - item.y) <= tolerance);
            if (row) row.items.push(item);
            else rows.push({ y: item.y, items: [item] });
        });
        rows.sort((a, b) => b.y - a.y);
        return rows.map(row => {
            row.items.sort((a, b) => a.x - b.x);
            let line = '';
            let cursor = null;
            row.items.forEach(item => {
                if (cursor !== null) {
                    const gap = item.x - cursor;
                    line += gap > 14 ? '    ' : gap > 1.2 ? ' ' : '';
                }
                line += item.str;
                cursor = item.x + (item.width || item.str.length * 4);
            });
            return line.trim();
        }).filter(Boolean).join('\n');
    }

    return { parseReceiptText, parseBest, pdfItemsToText, pdfContentOrderToText, findAmountsInLine, scoreLabel, parseDate, toLines, normalizeText };
});
