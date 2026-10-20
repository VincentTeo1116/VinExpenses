/* smart-entry.js
 *
 * Helpers that make adding an expense faster and safer. No dependencies, no network:
 * it runs in the browser (window.SmartEntry) and in Node (require), like receipt-parser.js.
 *
 *  - suggestCategory():  where does this expense belong? Learns from YOUR history first, then a built-in
 *                        list of Malaysian merchants, then keywords, then your own custom category names.
 *                        Always returns a reason, so the app can say why it suggested something.
 *  - findDuplicate():    "you already saved this one" (same amount, same day, same merchant).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SmartEntry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------- merchant names ----------
    // "99 SPEEDMART KL 1234" and "99 Speedmart" should count as the same place.
    const NOISE_WORDS = /\b(?:sdn|bhd|berhad|enterprise|trading|resources|plt|ltd|co|inc|corp|the|branch|outlet|kl|pj|jb)\b/g;

    function normalizeMerchant(name) {
        let s = String(name == null ? '' : name).toLowerCase();
        s = s.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');       // [Non-Halal], (Whole Cakes)
        s = s.split(/\s+-\s+|\s+@\s+/)[0];                                   // branch after " - "
        s = s.replace(/[^a-z0-9一-鿿& ]+/g, ' ').replace(NOISE_WORDS, ' ');
        const tokens = s.split(/\s+/).filter(Boolean);
        while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) tokens.pop();   // store / branch numbers
        return tokens.slice(0, 3).join(' ');
    }

    const isPrefix = (shorter, longer) => longer === shorter || longer.startsWith(shorter + ' ');

    // ---------- learning from the user's own history ----------
    // expenses: [{ merchant, category, created_at }]  ->  Map(normalizedMerchant -> { counts, total, label })
    function buildMerchantMemory(expenses) {
        const memory = new Map();
        (expenses || []).forEach(e => {
            if (!e || !e.merchant || !e.category) return;
            const key = normalizeMerchant(e.merchant);
            if (!key) return;
            let entry = memory.get(key);
            if (!entry) { entry = { counts: {}, total: 0, label: String(e.merchant).trim() }; memory.set(key, entry); }
            entry.counts[e.category] = (entry.counts[e.category] || 0) + 1;
            entry.total++;
        });
        return memory;
    }

    function lookupMemory(memory, merchant) {
        if (!memory || !merchant) return null;
        const key = normalizeMerchant(merchant);
        if (!key) return null;
        // "Kopitiam ABC Mid Valley" and "Kopitiam ABC" are the same place: pool every name where one is the
        // start of the other, so the habit is counted across all of them
        const related = [];
        for (const [k, entry] of memory) {
            if (k === key || (k.length >= 4 && key.length >= 4 && (isPrefix(k, key) || isPrefix(key, k)))) related.push([k, entry]);
        }
        if (!related.length) return null;
        if (related.length === 1) return { entry: related[0][1], key: related[0][0] };
        const pooled = { counts: {}, total: 0, label: '' };
        let biggest = -1;
        related.forEach(([, entry]) => {
            Object.entries(entry.counts).forEach(([cat, n]) => { pooled.counts[cat] = (pooled.counts[cat] || 0) + n; });
            pooled.total += entry.total;
            if (entry.total > biggest) { biggest = entry.total; pooled.label = entry.label; }
        });
        return { entry: pooled, key };
    }

    // ---------- built-in knowledge: Malaysian merchants ----------
    // [category, confidence, pattern]. "high" = a specific brand; "medium" = a generic word.
    const KNOWN = [
        // fuel and car
        ['car', 'high', /\b(?:petronas|petron|shell|caltex|bhp|setel|esso|touch\s*n\s*go\s*rfid)\b/],
        ['car', 'medium', /\b(?:petrol|workshop|tyre|tire|car\s*wash|auto\s*service|service\s*cent(?:re|er)|jpj|puspakom|insurance\s*motor)\b/],
        // getting around
        ['travel', 'high', /\b(?:grab\s*(?:car|ride|bike|taxi|express)|justgrab|airasia|malaysia\s*airlines|\bmas\b|batik\s*air|firefly|scoot|agoda|booking\.com|traveloka|klia|ktm|rapid\s*kl|myrapid|mrt|lrt|ets|redbus|easybook|mybus)\b/],
        ['travel', 'medium', /\b(?:hotel|resort|airline|flight|toll|plus\s*highway|parking|taxi|e-?hailing|airbnb|homestay)\b/],
        // meals
        ['food', 'high', /\b(?:mcdonald'?s?|kfc|burger\s*king|pizza\s*hut|domino'?s?|subway|sushi\s*king|sushi\s*zanmai|nando'?s?|secret\s*recipe|old\s*town|pappa\s*rich|dim\s*sum|marrybrown|texas\s*chicken|a&w|wendy'?s?|jollibee|mamak|nasi\s*kandar|foodpanda|grab\s*food|grabfood|shopeefood|kopitiam|food\s*court|hawker|warung|medan\s*selera)\b/],
        ['food', 'medium', /\b(?:restaurant|restoran|bistro|kitchen|bakery|patisserie|noodle|rice|chicken|steak|seafood|laksa|satay|cake|dessert|catering|canteen|cafeteria|dapur|kedai\s*makan)\b/],
        // drinks
        ['beverages', 'high', /\b(?:starbucks|zus\s*coffee|tealive|chatime|gigi\s*coffee|the\s*coffee\s*bean|coffee\s*bean|dd\s*coffee|kenanga\s*coffee|oldtown\s*white|tiger\s*sugar|the\s*alley|xing\s*fu\s*tang|each\s*a\s*cup|koi\s*the|bobabar|dakasi|sharetea|machi\s*machi|ya\s*kun)\b/],
        ['beverages', 'medium', /\b(?:coffee|cafe|café|bubble\s*tea|boba|teh|juice|smoothie|espresso|kopi)\b/],
        // groceries and shopping
        ['shopping', 'high', /\b(?:99\s*speed\s*mart|99\s*speedmart|mydin|giant|lotus'?s?|tesco|aeon|jaya\s*grocer|village\s*grocer|kk\s*(?:super\s*)?mart|7-?\s*eleven|family\s*mart|econsave|nsk|the\s*store|ikea|mr\.?\s*diy|daiso|uniqlo|h&m|zara|shopee|lazada|zalora|courts|harvey\s*norman|popular\s*book|kinokuniya|watsons|guardian|sephora|miniso|decathlon|ace\s*hardware|sports\s*direct)\b/],
        ['shopping', 'medium', /\b(?:supermarket|hypermarket|mini\s*market|minimarket|grocer(?:y|ies)?|mall|department\s*store|boutique|kedai\s*runcit|pasar\s*(?:raya|malam)?|wholesale)\b/],
        // bills
        ['utilities', 'high', /\b(?:tnb|tenaga\s*nasional|syabas|air\s*selangor|indah\s*water|iwk|sab\s*(?:sarawak)?|unifi|\btm\b|telekom|maxis|celcom|digi|u\s*mobile|umobile|yes\s*4g|time\s*dotcom|time\s*internet|astro|gas\s*malaysia|pengurusan\s*air)\b/],
        ['utilities', 'medium', /\b(?:electric(?:ity)?|water\s*bill|internet|broadband|utilities|utility|prepaid|postpaid|reload|top\s*up|sewerage|assessment|quit\s*rent|cukai\s*(?:tanah|pintu))\b/],
        // health
        ['health', 'high', /\b(?:caring\s*pharmacy|big\s*pharmacy|farmasi|klinik|poliklinik|columbia\s*asia|pantai\s*hospital|sunway\s*medical|gleneagles|prince\s*court|kpj|dr\.?\s)\b/],
        ['health', 'medium', /\b(?:clinic|hospital|pharmacy|medical|dental|dentist|optical|optometrist|physio(?:therapy)?|chiropractic|gym|fitness|yoga|vitamin|supplement|spa|massage)\b/],
        // fun
        ['entertain', 'high', /\b(?:tgv|gsc|mbo|netflix|spotify|disney\s*\+?|youtube\s*premium|apple\s*(?:music|tv|one)|steam|playstation|nintendo|xbox|viu|iflix|hbo|tickets?\s*(?:master|2u)|sunway\s*lagoon|genting\s*skyworlds)\b/],
        ['entertain', 'medium', /\b(?:cinema|movie|concert|karaoke|arcade|bowling|theme\s*park|ticket|game|subscription)\b/],
        // work (courier, stationery, office)
        ['work', 'high', /\b(?:poslaju|pos\s*malaysia|j&t|dhl|fedex|ups|gdex|ninja\s*van|city-?link|lalamove|kerry\s*express|flash\s*express|skynet|staples|officemate|popular\s*stationery)\b/],
        ['work', 'medium', /\b(?:courier|freight|forwarding|logistics?|waybill|shipping\s*(?:fee|charge)|stationery|printing|print\s*shop|photostat|office|coworking|meeting\s*room|domain|hosting|software|saas)\b/]
    ];

    const BUILTIN_KEYS = ['food', 'beverages', 'travel', 'entertain', 'work', 'shopping', 'utilities', 'car', 'health', 'other'];

    // Words that, together, say "this is a restaurant bill"
    const RESTAURANT_CLUES = [
        /\bservice\s*charge\b/,
        /\btable\s*#?\s*\d*\b/,
        /\b(?:dine[- ]?in|take\s*-?\s*away|takeaway|cover\s*charge)\b/,
        /\b(?:starters?|mains?|desserts?|a\s*la\s*carte|set\s*(?:lunch|dinner|meal))\b/,
        /\b(?:lunch|dinner|breakfast|brunch)\b/,
        /\b(?:soup|pasta|steak|fries|burger|noodles?|nasi|mee|beverages?|drinks?)\b/
    ];

    // Grab and similar templates carry their own category
    function fromHint(hint) {
        return hint && hint.category ? { key: hint.category, confidence: 'high', source: 'receipt', reason: 'This receipt is a Grab food order' } : null;
    }

    function categoryLabel(categories, key) {
        const c = (categories || []).find(x => x.key === key);
        return c ? c.label : key;
    }

    const isUsable = (categories, key) => !!(categories || []).some(c => c.key === key && c.active !== false);

    /**
     * suggestCategory({ merchant, text, memory, categories, hint })
     *   categories: the user's current categories [{ key, label, active }]
     *   returns { key, label, confidence: 'high'|'medium'|'low', source, reason } or null
     */
    function suggestCategory({ merchant = '', text = '', memory = null, categories = [], hint = null } = {}) {
        const result = (key, confidence, source, reason) => isUsable(categories, key)
            ? { key, label: categoryLabel(categories, key), confidence, source, reason }
            : null;

        // 1. Your own habits beat everything: you filed this place before
        const found = lookupMemory(memory, merchant);
        if (found) {
            const { entry } = found;
            const [topKey, topCount] = Object.entries(entry.counts).sort((a, b) => b[1] - a[1])[0];
            if (topCount / entry.total >= 0.6) {
                const label = categoryLabel(categories, topKey);
                const shown = String(merchant).trim() || entry.label; // quote the name the user typed, not another branch's
                const reason = entry.total === 1
                    ? `Last time you logged "${shown}" as ${label}`
                    : `You've logged "${shown}" as ${label} ${topCount} of ${entry.total} times`;
                const r = result(topKey, entry.total >= 3 ? 'high' : 'medium', 'history', reason);
                if (r) return r;
            }
        }

        // 2. The receipt itself says what it is (Grab food, Grab ride...)
        const hinted = fromHint(hint);
        if (hinted) {
            const r = result(hinted.key, hinted.confidence, hinted.source, hint.reason || hinted.reason);
            if (r) return r;
        }

        // 3. Built-in Malaysian merchants and keywords: the merchant name first, then the rest of the text
        const name = String(merchant).toLowerCase();
        const body = String(text).toLowerCase().slice(0, 4000);
        for (const [key, confidence, pattern] of KNOWN) {
            const m = name.match(pattern);
            if (m) { const r = result(key, confidence, 'known', `"${m[0].trim()}" is usually ${categoryLabel(categories, key)}`); if (r) return r; }
        }
        for (const [key, confidence, pattern] of KNOWN) {
            if (confidence !== 'high') continue;                       // loose words in a long receipt are too noisy
            const m = body.match(pattern);
            if (m) { const r = result(key, 'medium', 'known', `The receipt mentions "${m[0].trim()}"`); if (r) return r; }
        }
        for (const [key, confidence, pattern] of KNOWN) {
            if (confidence !== 'medium') continue;
            const m = name.match(pattern);
            if (m) { const r = result(key, 'low', 'known', `"${m[0].trim()}" suggests ${categoryLabel(categories, key)}`); if (r) return r; }
        }

        // 3b. The receipt reads like a restaurant bill even though the merchant is unknown
        //     (needs two different clues, so one stray word such as "table" is not enough)
        const clues = RESTAURANT_CLUES.filter(re => re.test(body)).length;
        if (clues >= 2) {
            const r = result('food', 'medium', 'known', 'The receipt looks like a restaurant bill (service charge, table, menu items)');
            if (r) return r;
        }

        // 4. The user's OWN categories, by name ("Pets", "Kids", "Gifts"...). Built-in names are left out on
        //    purpose: "Thank you for shopping with us" must not file everything under Shopping. Only the
        //    merchant name and the top of the receipt are searched, never the closing boilerplate.
        const haystack = `${name} ${body.slice(0, 200)}`;
        for (const c of categories) {
            if (c.active === false || c.key === 'other' || c.is_builtin === true || BUILTIN_KEYS.includes(c.key)) continue;
            const label = String(c.label || '').toLowerCase().trim();
            if (label.length < 4) continue;
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp('\\b' + escaped + '\\b').test(haystack)) {
                return { key: c.key, label: c.label, confidence: 'medium', source: 'name', reason: `Matches your "${c.label}" category` };
            }
        }
        return null;
    }

    // ---------- duplicates ----------
    const localDate = value => {
        const d = new Date(value);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const dayNumber = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

    /**
     * findDuplicate(expenses, { amount, date: 'YYYY-MM-DD', merchant, category }, { excludeId })
     * Same amount, within a day, and the same merchant (or the same category when no merchant is given).
     */
    function findDuplicate(expenses, candidate, options) {
        const exclude = options && options.excludeId;
        const cents = Math.round(Number(candidate.amount) * 100);
        const when = dayNumber(candidate.date);
        const key = normalizeMerchant(candidate.merchant);
        return (expenses || []).find(e => {
            if (!e || e.id === exclude || e._pending === 'deleted') return false;
            if (Math.round(Number(e.amount) * 100) !== cents) return false;
            if (Math.abs(dayNumber(localDate(e.created_at)) - when) > 1) return false;
            const other = normalizeMerchant(e.merchant);
            if (key && other) return isPrefix(key, other) || isPrefix(other, key);
            return e.category === candidate.category;
        }) || null;
    }

    return { normalizeMerchant, buildMerchantMemory, lookupMemory, suggestCategory, findDuplicate, KNOWN };
});
