/* Helpers that make adding an expense faster: category suggestions, merchant memory and duplicate checks. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SmartEntry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Merchant names: "99 SPEEDMART KL 1234" and "99 Speedmart" are the same place.
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

    // Learn from the user's own history: which category each merchant usually gets.
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
        // Pool names where one starts with the other, so branches count as one place.
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

    // One tidy form for matching: lower case, accents removed (café = cafe), curly quotes straight, "h & m" = "h&m", "GRAB*FOOD" = "grab food".
    const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
    const CURLY = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x60, 0xb4) + ']', 'g');
    function fold(value) {
        return String(value == null ? '' : value).normalize('NFKD').replace(MARKS, '').toLowerCase().replace(CURLY, "'").replace(/\s*&\s*/g, '&').replace(/[*_]+/g, ' ');
    }
    // A note this short is the person's own words (not a receipt), so ordinary words in it count too.
    const SHORT_NOTE = 120;

    // Built-in Malaysian merchants: [category, confidence, pattern].
    const KNOWN = [
        // fuel and car
        ['car', 'high', /\b(?:petronas|petron|shell|caltex|bhp|setel|esso|touch\s*n\s*go\s*rfid)\b/],
        ['car', 'medium', /\b(?:petrol|workshop|tyre|tire|car\s*wash|auto\s*service|service\s*cent(?:re|er)|jpj|puspakom|insurance\s*motor)\b/],
        // getting around
        ['travel', 'high', /\b(?:grab\s*(?:car|ride|bike|taxi|express)|justgrab|airasia|malaysia\s*airlines|\bmas\b|batik\s*air|firefly|scoot|agoda|booking\.com|traveloka|klia|ktm|rapid\s*kl|myrapid|mrt|lrt|ets|redbus|easybook|mybus)\b/],
        ['travel', 'medium', /\b(?:hotel|resort|airline|flight|toll|plus\s*highway|parking|taxi|e-?hailing|airbnb|homestay)\b/],
        // meals
        ['food', 'high', /\b(?:bak\s*kut\s*teh|mcdonald'?s?|kfc|burger\s*king|pizza\s*hut|domino'?s?|subway|sushi\s*king|sushi\s*zanmai|nando'?s?|secret\s*recipe|old\s*town|pappa\s*rich|dim\s*sum|marrybrown|texas\s*chicken|a&w|wendy'?s?|jollibee|mamak|nasi\s*kandar|foodpanda|grab\s*food|grabfood|shopeefood|kopitiam|food\s*court|hawker|warung|medan\s*selera)\b/],
        ['food', 'medium', /\b(?:lunch|dinner|breakfast|brunch|supper|makan|snacks?|mamak|warung|hawker|food\s*court|nasi|mee|roti|restaurant|restoran|bistro|kitchen|bakery|patisserie|noodle|rice|chicken|steak|seafood|laksa|satay|cake|dessert|catering|canteen|cafeteria|dapur|kedai\s*makan)\b/],
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
        ['work', 'medium', /\b(?:courier|freight|forwarding|logistics?|waybill|shipping\s*(?:fee|charge)|stationery|printing|print\s*shop|photostat|office|coworking|meeting\s*room|domain|hosting|software|saas)\b/],

        // More Malaysia, Singapore, Indonesia, Thailand, Brunei and international brands seen on statements
        ['food', 'high', /\b(?:ayam\s*gepuk|ayamas|kenny\s*rogers|din\s*tai\s*fung|ichiban\s*sushi|sushi\s*tei|genki\s*sushi|tokyo\s*town|ramen\s*nagi|char\s*kuey\s*teow|roti\s*canai|kimly|toast\s*box|killiney|yoshinoya|four\s*fingers|mos\s*burger|ippudo|sakae\s*sushi|swensen'?s|llaollao|baskin\s*robbins|dunkin'?|krispy\s*kreme|shake\s*shack|five\s*guys|carl'?s\s*jr|taco\s*bell|papa\s*john'?s|wingstop|oishi|deliveroo|food\s*panda|gofood|go-?food|shopee\s*food|lineman|robinhood\s*food|gojek\s*food|beam\s*delivery|dahmakan)\b/],
        ['beverages', 'high', /\b(?:luckin\s*coffee|kopi\s*kenangan|janji\s*jiwa|fore\s*coffee|tom\s*n\s*toms|pacific\s*coffee|costa\s*coffee|tim\s*hortons|gong\s*cha|liho|playmade|heytea|mixue|boost\s*juice|chatramue|cha\s*tra\s*mue|cafe\s*amazon|nescafe|dutch\s*lady)\b/],
        ['travel', 'high', /\b(?:gojek|maxim\s*(?:ride|taxi)|comfort\s*delgro|comfortdelgro|singapore\s*airlines|jetstar|vietjet|citilink|lion\s*air|garuda|thai\s*airways|nok\s*air|thai\s*lion|cebu\s*pacific|royal\s*brunei|emirates|qatar\s*airways|cathay|etihad|klook|trip\.com|expedia|hotels\.com|tiket\.com|pegipegi|skyscanner|kkday|oyo|ez-?link|simplygo|transitlink|smrt|sbs\s*transit|ktmb|rapid\s*penang|tada\s*ride)\b/],
        ['car', 'high', /\b(?:pertamina|bp\s*(?:petrol|fuel)|bangchak|sinopec|primax|bhpetrol|shell\s*recharge|chargev|gentari|jomcharge|evcb|supercharger|motul|castrol|michelin|bridgestone|goodyear|hankook|yokohama|autobacs|carsome|carro|road\s*tax|roadtax|e-?saman|saman\s*jpj)\b/],
        ['shopping', 'high', /\b(?:fairprice|cold\s*storage|sheng\s*siong|don\s*don\s*donki|donki|isetan|takashimaya|robinsons|best\s*denki|challenger|tokopedia|bukalapak|blibli|amazon\.(?:com|sg|my)|aliexpress|temu|shein|taobao|tmall|jd\.com|ebay|carousell|mudah|lelong|fashion\s*valet|vincci|padini|brands\s*outlet|nike|adidas|puma|new\s*balance|skechers|charles\s*&\s*keith|cotton\s*on|muji|makro|alfamart|indomaret|hypermart|transmart|carrefour|home\s*pro|homepro|index\s*living|mph\s*bookstore|bookxcess|big\s*bad\s*wolf|apple\s*store|senheng|all\s*it\s*hypermarket)\b/],
        ['utilities', 'high', /\b(?:sp\s*group|sp\s*services|singtel|starhub|circles\.?life|myrepublic|viewqwest|redone|tune\s*talk|friendi|hotlink|xox\s*mobile|buzzme|speakout|yoodo|boost\s*mobile|indihome|telkomsel|xl\s*axiata|indosat|smartfren|true\s*move|true\s*online|dtac|3bb|metropolitan\s*electricity|provincial\s*electricity|sesb|sesco|sarawak\s*energy|ranhill|jompay|touch\s*n\s*go\s*reload|boost\s*reload|tmnet)\b/],
        ['health', 'high', /\b(?:unity\s*pharmacy|health\s*lane|alpro|raffles\s*(?:hospital|medical)|parkway\s*(?:hospital|shenton)|polyclinic|bumrungrad|samitivej|bangkok\s*hospital|siloam|mitra\s*keluarga|healthway|qualitas|pathlab|bio-?ex|innoquest|klinik\s*(?:kesihatan|desa)|prudential|great\s*eastern|allianz|etiqa|takaful|manulife|zurich|tune\s*protect|msig|generali|fwd\s*(?:takaful|insurance)|ntuc\s*income|anytime\s*fitness|celebrity\s*fitness|fitness\s*first|true\s*fitness|snap\s*fitness|jetts|pure\s*yoga)\b/],
        ['entertain', 'high', /\b(?:golden\s*screen|mmcineplexes|shaw\s*theatres|golden\s*village|cathay\s*cineplexes|major\s*cineplex|sf\s*cinema|ticketmaster|bookmyshow|eventbrite|disneyland|universal\s*studios|legoland|zoo\s*negara|kidzania|resorts\s*world|astro\s*(?:go|njoi)|iqiyi|wetv|prime\s*video|amazon\s*prime|crunchyroll|bilibili|twitch|roblox|garena|mobile\s*legends|moonton|riot\s*games|valorant|epic\s*games|ubisoft|google\s*play|app\s*store|itunes|razer\s*gold|unipin|codashop|steam\s*wallet|audible|webtoon|joox|deezer|youtube\s*music|patreon)\b/],
        ['work', 'high', /\b(?:pgeon|citylink|nationwide\s*express|abx\s*express|jnt\s*express|ninjavan|shopee\s*express|lazada\s*express|sf\s*express|kerry\s*thailand|thailand\s*post|singpost|sing\s*post|pos\s*indonesia|sicepat|anteraja|aramex|gogox|gogovan|deliveree|microsoft\s*365|office\s*365|google\s*workspace|gsuite|dropbox|github|gitlab|digitalocean|amazon\s*web\s*services|google\s*cloud|cloudflare|namecheap|godaddy|hostinger|vercel|netlify|heroku|openai|anthropic|chatgpt|jetbrains|atlassian|mailchimp|quickbooks|autocount|sql\s*account|wework|regus|servcorp|jobstreet|linkedin|lhdn|e-?filing|company\s*secretar(?:y|ial))\b/],
        ['shopping', 'high', /\b(?:hla|parkson|metrojaya|jusco|sogo|fahrenheit\s*88|marks\s*&\s*spencer|m&s|bershka|pull\s*&\s*bear|stradivarius|massimo\s*dutti|g2000|giordano|bonia|hush\s*puppies|crocs|levi'?s?|lacoste|tommy\s*hilfiger|calvin\s*klein|the\s*north\s*face|timberland|under\s*armour|converse|reebok|asics|mizuno|bata|owndays|mothercare|toys\s*r\s*us|sasa|beautyfeel|naturepedia|hero\s*market|lulu|speedmart|99\s*mart|mynews|aeon\s*big|tf\s*value\s*mart|pacific\s*hypermarket|mr\.?\s*dollar|eco-?shop|h\s*&\s*m)\b/],
        ['food', 'high', /\b(?:zapfan|zaffran|zafran|zaaffran|nasi\s*lemak|ayam\s*penyet|penyet|kampung\s*boy|pelita|village\s*park|mcd|chicken\s*rice|steamboat|hot\s*pot|hotpot|tomyam|tom\s*yam|bbq|yakiniku|gyu-?kaku|sukiya|sushi\s*mentai|tgi\s*fridays?|chili'?s|outback|madam\s*kwan'?s?|nasi\s*ayam|pan\s*mee|wantan\s*mee|kuey\s*teow|curry\s*mee|yong\s*tau\s*foo|banana\s*leaf|kedai\s*kopi|gerai|bufet|buffet|inside\s*scoop|haagen[- ]?dazs|cold\s*stone|ben\s*&\s*jerry'?s?)\b/],
        ['beverages', 'high', /\b(?:teh\s*tarik|chagee|caffe\s*bene|san\s*francisco\s*coffee|bask\s*robbins?)\b/],
        ['food', 'medium', /\b(?:ayam|penyet|tomyam|steamboat|bbq|grill|pizza|burger|sushi|ramen|buffet|bufet|gerai|deli|eatery|diner|food\s*stall|bar\s*&\s*grill)\b/],
        ['shopping', 'medium', /\b(?:fashion|apparel|clothing|clothes|garment|footwear|shoes?|handbags?|mini\s*mart|bookstore|book\s*store|florist|gifts?|toys?|furniture|electronics?|gadgets?|outlet)\b/]
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

    /* Suggests a category with a reason, or null when unsure. */
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
        const name = fold(merchant);
        const body = fold(text).slice(0, 4000);
        const shortNote = body.length <= SHORT_NOTE;
        for (const [key, confidence, pattern] of KNOWN) {
            const m = name.match(pattern);
            if (m) { const r = result(key, confidence, 'known', `"${m[0].trim()}" is usually ${categoryLabel(categories, key)}`); if (r) return r; }
        }
        for (const [key, confidence, pattern] of KNOWN) {
          if (confidence !== 'high') continue; // loose words in a long receipt are too noisy
          const m = body.match(pattern);
          if (m) { const r = result(key, 'medium', 'known', `${shortNote ? 'Your note mentions' : 'The receipt mentions'} "${m[0].trim()}"`); if (r) return r; }
        }
        if (shortNote) {
          for (const [key, confidence, pattern] of KNOWN) {
            if (confidence !== 'medium') continue;
            const m = body.match(pattern);
            if (m) { const r = result(key, 'medium', 'known', `Your note mentions "${m[0].trim()}"`); if (r) return r; }
          }
        }
        for (const [key, confidence, pattern] of KNOWN) {
            if (confidence !== 'medium') continue;
            const m = name.match(pattern);
            if (m) { const r = result(key, 'low', 'known', `"${m[0].trim()}" suggests ${categoryLabel(categories, key)}`); if (r) return r; }
        }

        // 3b. Looks like a restaurant bill (needs two clues, so one stray word is not enough).
        const clues = RESTAURANT_CLUES.filter(re => re.test(body)).length;
        if (clues >= 2) {
            const r = result('food', 'medium', 'known', 'The receipt looks like a restaurant bill (service charge, table, menu items)');
            if (r) return r;
        }

        // 4. The user's own category names. Built-in names are skipped so receipt small print can't mislead.
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

    // Duplicates Section
    const localDate = value => {
        const d = new Date(value);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const dayNumber = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

    /* A duplicate is the same amount within a day at the same merchant (or category if no merchant). */
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

    // Month Insights Section: used by the monthly report
    const cents = (v) => Math.round((Number(v) || 0) * 100);

    // transactions: [{ type: 'expense' | 'income', amount, merchant, category }]
    function summarizeMonth(transactions) {
        let income = 0, expenses = 0, expenseCount = 0;
        const merchants = new Map();
        const categories = new Map();
        for (const t of transactions || []) {
            if (!t || t._pending === 'deleted') continue;
            if (t.type === 'income') { income += cents(t.amount); continue; }
            expenses += cents(t.amount);
            expenseCount++;
            categories.set(t.category, (categories.get(t.category) || 0) + cents(t.amount));
            const key = normalizeMerchant(t.merchant);
            if (!key) continue;
            const m = merchants.get(key) || { name: String(t.merchant).trim(), total: 0, count: 0 };
            m.total += cents(t.amount);
            m.count++;
            if (String(t.merchant).trim().length < m.name.length) m.name = String(t.merchant).trim(); // show the plain name, not a branch
            merchants.set(key, m);
        }
        const topMerchants = [...merchants.values()]
            .sort((a, b) => b.total - a.total || b.count - a.count)
            .slice(0, 5)
            .map(m => ({ name: m.name, total: m.total / 100, count: m.count }));
        const byCategory = [...categories.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([key, total]) => ({ key, total: total / 100, share: expenses ? total / expenses : 0 }));
        return { income: income / 100, expenses: expenses / 100, net: (income - expenses) / 100, expenseCount, topMerchants, byCategory };
    }

    // Compares two summarizeMonth() results. pct is null when last month was zero.
    function compareMonths(current, previous) {
        const hasPrevious = !!previous && (previous.expenses > 0 || previous.income > 0);
        const diff = (a, b) => ({ delta: Math.round((a - b) * 100) / 100, pct: b > 0 ? (a - b) / b : null });
        const out = { hasPrevious, expenses: null, income: null, net: null, categoryChanges: [] };
        if (!hasPrevious) return out;
        out.expenses = diff(current.expenses, previous.expenses);
        out.income = diff(current.income, previous.income);
        out.net = { delta: Math.round((current.net - previous.net) * 100) / 100, pct: null };
        const before = new Map(previous.byCategory.map(c => [c.key, c.total]));
        const now = new Map(current.byCategory.map(c => [c.key, c.total]));
        const keys = new Set([...before.keys(), ...now.keys()]);
        out.categoryChanges = [...keys]
            .map(key => ({ key, delta: Math.round(((now.get(key) || 0) - (before.get(key) || 0)) * 100) / 100, now: now.get(key) || 0, before: before.get(key) || 0 }))
            .filter(c => Math.abs(c.delta) >= 0.01)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 3);
        return out;
    }

    return { normalizeMerchant, buildMerchantMemory, lookupMemory, suggestCategory, findDuplicate, summarizeMonth, compareMonths, KNOWN };
});
