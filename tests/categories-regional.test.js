// Run with:  node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const SE = require('../legacy/smart-entry.js');

const CATEGORIES = [
    ['food', 'Food'], ['beverages', 'Beverages'], ['travel', 'Travel'], ['entertain', 'Entertain'], ['work', 'Work'],
    ['shopping', 'Shopping'], ['utilities', 'Utilities'], ['car', 'Car'], ['health', 'Health'], ['other', 'Other']
].map(([key, label]) => ({ key, label, active: true }));
const suggest = (merchant, extra) => SE.suggestCategory({ merchant, categories: CATEGORIES, ...extra });

const SAMPLES = {
    food: ['AYAM GEPUK PAK GEMBUS', 'KRISPY KREME', 'DELIVEROO SG', 'GOFOOD JAKARTA', 'LINEMAN BKK', 'Din Tai Fung', 'Bak Kut Teh Klang'],
    beverages: ['LUCKIN COFFEE', 'KOPI KENANGAN', 'GONG CHA', 'Tim Hortons', 'MIXUE'],
    travel: ['GOJEK', 'COMFORTDELGRO', 'SINGAPORE AIRLINES', 'LION AIR', 'KLOOK', 'TIKET.COM', 'EZ-LINK', 'KTMB'],
    car: ['PERTAMINA', 'GENTARI', 'CHARGEV', 'MICHELIN', 'ROAD TAX'],
    shopping: ['FAIRPRICE', 'SHENG SIONG', 'DON DON DONKI', 'TOKOPEDIA', 'AMAZON.SG', 'TEMU', 'SHEIN', 'PADINI', 'ALFAMART'],
    utilities: ['SINGTEL', 'STARHUB', 'TELKOMSEL', 'INDIHOME', 'YOODO', 'SESCO', 'TRUE MOVE'],
    health: ['UNITY PHARMACY', 'RAFFLES HOSPITAL', 'SAMITIVEJ', 'PRUDENTIAL', 'ANYTIME FITNESS', 'PURE YOGA'],
    entertain: ['GOLDEN SCREEN', 'GOOGLE PLAY', 'APP STORE', 'ROBLOX', 'MOBILE LEGENDS', 'IQIYI', 'CODASHOP'],
    work: ['NINJAVAN', 'SINGPOST', 'GITHUB', 'GODADDY', 'CLOUDFLARE', 'JOBSTREET', 'MICROSOFT 365']
};

for (const [key, names] of Object.entries(SAMPLES)) {
    for (const name of names) {
        test(`regional brands: ${name} is ${key}`, () => {
            const r = suggest(name);
            assert.ok(r, `no suggestion for ${name}`);
            assert.equal(r.key, key);
        });
    }
}

test('regional brands: bank-statement forms with * and codes still match', () => {
    assert.equal(suggest('GRAB*FOOD 1234 KL').key, 'food');
    assert.equal(suggest('GOOGLE*PLAY').key, 'entertain');
});

test('regional brands: the user\'s own history still wins over the built-in list', () => {
    const memory = SE.buildMerchantMemory([1, 2, 3].map(() => ({ merchant: 'Temu', category: 'other', created_at: new Date().toISOString() })));
    const r = suggest('TEMU', { memory });
    assert.equal(r.key, 'other');
});

test('regional brands: ordinary receipt wording is not mistaken for a brand', () => {
    const text = 'Thank you for shopping. Subtotal 12.00 Total 12.00 Cash 20.00 Change 8.00 Max 2 per customer. Zoom in. Switch lane.';
    const r = suggest('', { text });
    assert.ok(!r || r.confidence !== 'high', 'plain receipt words should not give a confident category');
});
