#!/usr/bin/env node
// Builds the sign-in email templates; run with "apply" to upload them to Supabase (see README).

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'supabase', 'templates');
const mode = process.argv[2] || 'build';

function fail(message) { console.error('✖ ' + message); process.exit(1); }

async function load() {
    const mod = await import('../supabase/functions/_shared/email-templates.ts');
    return mod.authTemplates();
}

async function build() {
    const templates = await load();
    fs.mkdirSync(outDir, { recursive: true });
    for (const t of templates) fs.writeFileSync(path.join(outDir, t.file), t.html + '\n');
    console.log(`Wrote ${templates.length} templates to supabase/templates/`);
    return templates;
}

async function apply() {
    const token = process.env.SUPABASE_ACCESS_TOKEN || '';
    if (!/^sbp_[A-Za-z0-9_]{20,}$/.test(token)) fail('SUPABASE_ACCESS_TOKEN is missing or does not look like a Supabase access token (it starts with "sbp_").');
    let ref = process.env.SUPABASE_PROJECT_REF || '';
    if (!ref) { try { ref = fs.readFileSync(path.join(root, 'supabase', '.temp', 'project-ref'), 'utf8').trim(); } catch (_) { /* asked for below */ } }
    if (!/^[a-z]{20}$/.test(ref)) fail('Set SUPABASE_PROJECT_REF to your 20-letter project reference (the part before .supabase.co).');

    const templates = await build();
    const settings = {};
    for (const t of templates) {
        settings[`mailer_subjects_${t.key}`] = t.subject;
        settings[`mailer_templates_${t.key}_content`] = t.html;
    }

    const user = process.env.SMTP_USER || '';
    const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
    if (user || pass) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) fail('SMTP_USER must be the Gmail address that sends the emails.');
        if (pass.length < 16) fail('SMTP_PASS must be the 16-letter Gmail app password (not your normal Gmail password).');
        Object.assign(settings, {
            smtp_host: 'smtp.gmail.com', smtp_port: '465', smtp_user: user, smtp_pass: pass,
            smtp_admin_email: user, smtp_sender_name: 'VinExpenses',
        });
    }

    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    });
    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 400);
        fail(`Supabase refused the update (status ${response.status}). ${detail}`);
    }
    console.log(`✔ ${templates.length} email templates and subjects updated on project ${ref}.`);
    console.log(user ? '✔ Sign-in emails are now sent through Gmail SMTP as "VinExpenses".'
        : 'ℹ SMTP was not changed. Set SMTP_USER and SMTP_PASS and run "apply" again to send these emails through Gmail.');
    console.log('Test it: sign up in the app with an address that is not a member of your Supabase team.');
}

(mode === 'apply' ? apply() : mode === 'build' ? build() : Promise.reject(new Error('Use "build" (default) or "apply".')))
    .catch((error) => fail(error && error.message ? error.message : 'Something went wrong.'));
