#!/usr/bin/env node
// Copies the shared app code into supabase/functions, because functions can't import from outside it.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pairs = [
    ['smart-entry.js', 'supabase/functions/_shared/smart-entry.js'],
    ['receipt-parser.js', 'supabase/functions/_shared/receipt-parser.js'],
    ['finance-calc.js', 'supabase/functions/_shared/finance-calc.js'],
];

for (const [from, to] of pairs) {
    fs.copyFileSync(path.join(root, 'legacy', from), path.join(root, to));
    console.log(`${from} -> ${to}`);
}
