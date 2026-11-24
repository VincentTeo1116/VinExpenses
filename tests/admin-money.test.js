// AD-06: the admin area can never read anyone's money. A test fails if the admin screen or the admin server function mention a
// money table, or if the admin screen talks to the database at all (it may only ask the server function, which checks the role).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const MONEY = /\b(expenses|incomes|budgets|recurring_expenses|recurring_incomes|fixed_deposits|loans|monthly_report_preferences|user_categories|user_payment_methods)\b/;

test('the admin screen never names a money table and never queries the database directly', () => {
    const dir = path.join(root, 'src', 'features', 'admin');
    for (const file of fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))) {
        const text = read(path.join('src', 'features', 'admin', file));
        const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!MONEY.test(code), `${file} mentions a money table`);
        assert.ok(!/\.from\(\s*['"`]/.test(code), `${file} queries the database directly instead of asking the admin function`);
    }
});

test('the admin server function never selects money tables or amounts', () => {
    for (const file of ['supabase/functions/admin/handler.ts', 'supabase/functions/admin/index.ts']) {
        const code = read(file).replace(/\/\/.*$/gm, '');
        // the only table with "expense" in it that the function may touch is the stats helper, which returns a date only
        assert.ok(!/rest\(["'`](expenses|incomes|budgets|recurring_|fixed_deposits|loans)/.test(code), `${file} reads a money table`);
        assert.ok(!/select=[^"'`]*amount/.test(code), `${file} selects an amount`);
    }
});

test('the server checks the administrator role on every action, before doing anything', () => {
    const code = read('supabase/functions/admin/handler.ts');
    const door = code.slice(code.indexOf('export async function handle'));
    assert.ok(door.indexOf('isAdmin(auth.userId)') > 0, 'the role is checked');
    assert.ok(door.indexOf('isAdmin(auth.userId)') < door.indexOf('switch (body.action)'), 'the role is checked before any action runs');
    assert.ok(/403/.test(door), 'a non-admin gets a 403');
});
