// Turns a "scan details" file (saved from the app) into a test fixture.
//   npm run fixture -- path/to/scan-details.json my-receipt-name
// It writes tests/fixtures/<name>.txt with emails, phone numbers and long digit runs masked, and prints the
// values the form held when the file was saved. READ THE FIXTURE before committing: names and addresses
// are not masked automatically.
const fs = require('node:fs');
const path = require('node:path');

const [file, name] = process.argv.slice(2);
if (!file || !name || !/^[a-z0-9-]+$/i.test(name)) {
    console.error('Usage: npm run fixture -- <scan-details.json> <fixture-name>   (name: letters, digits, dashes)');
    process.exit(1);
}

const sample = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(sample.readings) || !sample.readings.length) {
    console.error('That file has no "readings".');
    process.exit(1);
}

const mask = (text) => String(text)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'person@example.com')
    .replace(/\+?\d[\d \t-]{8,}\d/g, (m) => /\d{4}-\d{2}-\d{2}/.test(m) ? m : '0123456789'); // phone / account numbers; keeps ISO dates

const out = path.join(__dirname, '..', 'tests', 'fixtures', `${name}.txt`);
if (fs.existsSync(out)) {
    console.error(`${out} already exists. Pick another name.`);
    process.exit(1);
}
fs.writeFileSync(out, mask(sample.readings[0]).trim() + '\n');

const f = sample.formNow || {};
console.log(`Wrote tests/fixtures/${name}.txt`);
console.log('Reader said :', JSON.stringify({ amount: sample.readerSaid?.amount, merchant: sample.readerSaid?.merchant, date: sample.readerSaid?.date }));
console.log('Correct was :', JSON.stringify({ amount: Number(f.amount), merchant: f.merchant, date: f.date }));
console.log('\nNext: open the fixture and replace any names/addresses, then add a case to tests/receipt-parser.test.js with the "Correct was" values.');
