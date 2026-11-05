#!/usr/bin/env node
// Edge functions can only import files inside supabase/functions, so the app's category-guessing code
// (smart-entry.js) is copied there. A test fails if the two copies differ; run this to bring them back in line:
//
//   node tools/sync-shared.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pairs = [['smart-entry.js', 'supabase/functions/_shared/smart-entry.js']];

for (const [from, to] of pairs) {
    fs.copyFileSync(path.join(root, from), path.join(root, to));
    console.log(`${from} -> ${to}`);
}
