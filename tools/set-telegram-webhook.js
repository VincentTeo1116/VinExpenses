#!/usr/bin/env node
// Tells Telegram where to send the bot's messages, and registers the command menu.
// Run it once after deploying the telegram-bot function (and again if you change the secret).
//
//   PowerShell:
//     $env:TELEGRAM_BOT_TOKEN = "123456:ABC..."          # from @BotFather
//     $env:TELEGRAM_WEBHOOK_SECRET = "<same value you stored as the Supabase secret>"
//     $env:SUPABASE_URL = "https://YOURREF.supabase.co"
//     node tools/set-telegram-webhook.js
//
// The token is only read from the environment (never from arguments, so it does not end up in shell history),
// and it is never printed.

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

function fail(message) { console.error('✖ ' + message); process.exit(1); }

if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) fail('TELEGRAM_BOT_TOKEN is missing or does not look like a BotFather token.');
if (!/^[A-Za-z0-9_-]{24,256}$/.test(secret)) fail('TELEGRAM_WEBHOOK_SECRET must be 24-256 characters of letters, digits, "_" or "-" (a hex string works).');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base)) fail('SUPABASE_URL must look like https://<project-ref>.supabase.co');

async function call(method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) fail(`${method} failed: ${body.description || response.status}`);
    return body.result;
}

(async () => {
    await call('setWebhook', {
        url: `${base}/functions/v1/telegram-bot`,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        max_connections: 20,
    });
    await call('setMyCommands', {
        commands: [
            { command: 'today', description: "Today's spending" },
            { command: 'month', description: 'This month at a glance' },
            { command: 'top', description: 'Top categories and places this month' },
            { command: 'recent', description: 'Edit or delete a recent expense' },
            { command: 'undo', description: 'Remove the last expense added here' },
            { command: 'language', description: 'English / Bahasa Melayu / \u4e2d\u6587' },
            { command: 'digest', description: 'Weekly summary on or off' },
            { command: 'help', description: 'How to add an expense' },
            { command: 'cancel', description: 'Cancel what I asked you to type' },
            { command: 'unlink', description: 'Disconnect this chat' },
        ],
    });
    const info = await call('getWebhookInfo', {});
    console.log('Webhook set:', info.url);
    console.log('Pending updates:', info.pending_update_count, info.last_error_message ? '| last error: ' + info.last_error_message : '');
})();
