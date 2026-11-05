'use strict';
// Shared set-up for the Telegram bot tests: environment, fake Supabase, a recording Telegram, and small helpers.
const { fakeSupabase } = require('./fakes.js');

const SECRET = 'telegram-webhook-secret-0123456789';
const ENV = {
    SUPABASE_URL: 'https://abcdefghij.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ALLOWED_ORIGINS: 'https://me.github.io',
    TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_BOT_USERNAME: 'VinExpenses_bot',
    MONTHLY_REPORT_CRON_SECRET: 'cron-secret-with-24-or-more-chars',
};
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-05T04:00:00Z'); // 12:00 on Thursday 5 Nov 2026 in Kuala Lumpur
const CHAT_A = 1001;
const CHAT_B = 2002;

function setup(extraEnv = {}) {
    const env = { ...ENV, ...extraEnv };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    globalThis.Deno = { env: { get: (name) => env[name] } };
    const db = fakeSupabase();
    db.addUser('tok-a', A, 'a@gmail.com');
    db.addUser('tok-b', B, 'b@gmail.com');
    // Extra stand-ins (OCR.space, simulated missing columns) can be added by wrapping db.fetch.
    const hooks = { ocr: null, breakWhen: [] };
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input instanceof URL || typeof input === 'string' ? String(input) : input.url);
        if (url.hostname === 'api.ocr.space') {
            if (!hooks.ocr) throw new Error('unexpected OCR call');
            return hooks.ocr(url, init);
        }
        const method = (init.method || 'GET').toUpperCase();
        for (const rule of hooks.breakWhen) {
            if (rule(method, url, init)) return new Response(JSON.stringify({ message: 'column does not exist' }), { status: 400 });
        }
        return db.fetch(input, init);
    };
    // A recording Telegram that behaves like the real one: messages get ids, edits keep them, buttons can be toasts.
    const tg = { sent: [], edited: [], answered: [], reactions: [], actions: [], removed: [], file: null, checkedResult: 'ok', noIds: false, throwOn: new Set() };
    let seq = 0;
    let nextId = 900;
    const maybeThrow = (name) => { if (tg.throwOn.has(name)) throw new Error(`${name} failed`); };
    tg.client = {
        send: async (chatId, html, options) => {
            maybeThrow('send');
            const id = tg.noIds ? null : ++nextId;
            tg.sent.push({ seq: ++seq, chatId, html, buttons: options?.buttons, keyboard: options?.keyboard, id });
            return id;
        },
        edit: async (chatId, messageId, html, options) => {
            maybeThrow('edit');
            tg.edited.push({ seq: ++seq, chatId, messageId, html, buttons: options?.buttons });
        },
        answer: async (id, text) => { tg.answered.push({ id, text }); },
        react: async (chatId, messageId, emoji) => { maybeThrow('react'); tg.reactions.push({ chatId, messageId, emoji }); },
        action: async (chatId) => { maybeThrow('action'); tg.actions.push(chatId); },
        sendChecked: async (chatId, html, options) => { tg.sent.push({ seq: ++seq, chatId, html, buttons: options?.buttons, checked: true }); return tg.checkedResult; },
        sendPhoto: async (chatId, png, caption, options) => {
            maybeThrow('sendPhoto');
            if (tg.photoFails) return null;
            const id = tg.noIds ? null : ++nextId;
            tg.sent.push({ seq: ++seq, chatId, html: caption, buttons: options?.buttons, photo: true, png, id });
            return id ?? 0;
        },
        sendPhotoChecked: async (chatId, png, caption, options) => {
            maybeThrow('sendPhoto');
            tg.sent.push({ seq: ++seq, chatId, html: caption, buttons: options?.buttons, photo: true, png, checked: true });
            return tg.checkedPhotoResult || tg.checkedResult;
        },
        editPhoto: async (chatId, messageId, png, caption, options) => {
            maybeThrow('editPhoto');
            if (tg.editPhotoFails) return false;
            tg.edited.push({ seq: ++seq, chatId, messageId, html: caption, buttons: options?.buttons, photo: true, png });
            return true;
        },
        remove: async (chatId, messageId) => { maybeThrow('remove'); tg.removed.push({ chatId, messageId }); },
        fileBytes: async () => (tg.file ? tg.file : { error: 'failed' }),
    };
    // The newest thing the person can see: a new message or an edited one.
    tg.last = () => [...tg.sent, ...tg.edited].sort((a, b) => a.seq - b.seq).at(-1);
    tg.lastSent = () => tg.sent[tg.sent.length - 1];
    tg.lastEdit = () => tg.edited[tg.edited.length - 1];
    tg.toasts = () => tg.answered.map((a) => a.text).filter(Boolean);
    return { db, tg, env, hooks };
}

let counter = 5000;
const message = (chatId, text, extra = {}) => ({ update_id: ++counter, message: { message_id: 7, chat: { id: chatId, type: 'private' }, text, ...extra } });
const photoMessage = (chatId, sizes = [{ file_id: 'small', file_size: 20000 }, { file_id: 'big', file_size: 300000 }]) =>
    ({ update_id: ++counter, message: { message_id: 8, chat: { id: chatId, type: 'private' }, photo: sizes } });
const callback = (chatId, data, messageId = 55) => ({ update_id: ++counter, callback_query: { id: `cb${counter}`, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } } });

const botModule = () => import('../../supabase/functions/telegram-bot/handler.ts');
const linkModule = () => import('../../supabase/functions/telegram-link/handler.ts');

async function deliver(tg, update, { now = NOW } = {}) {
    const { handle } = await botModule();
    return handle(new Request('https://abcdefghij.supabase.co/functions/v1/telegram-bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
        body: JSON.stringify(update),
    }), now, tg.client);
}

/** Links a chat to an account the real way: the app creates a code, the chat sends it. */
async function link(db, tg, token, chatId, from) {
    const { handle } = await linkModule();
    const res = await handle(new Request('https://x/functions/v1/telegram-link', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'https://me.github.io', 'content-type': 'application/json' }, body: '{"action":"create"}',
    }));
    const { code } = await res.json();
    await deliver(tg, message(chatId, `/start ${code}`, from ? { from } : {}));
    return code;
}

function seedChoices(db, userId) {
    db.user_categories.push(
        { user_id: userId, category_key: 'food', label: 'Food', active: true, sort_order: 1 },
        { user_id: userId, category_key: 'shopping', label: 'Shopping', active: true, sort_order: 2 },
        { user_id: userId, category_key: 'other', label: 'Other', active: true, sort_order: 3 },
        { user_id: userId, category_key: 'old', label: 'Retired', active: false, sort_order: 4 },
    );
    db.user_payment_methods.push(
        { user_id: userId, payment_key: 'bank', label: 'Bank', active: true, sort_order: 1 },
        { user_id: userId, payment_key: 'ewallet', label: 'E-Wallet', active: true, sort_order: 2 },
        { user_id: userId, payment_key: 'card', label: 'Card', active: true, sort_order: 3 },
    );
}

module.exports = { SECRET, ENV, A, B, NOW, CHAT_A, CHAT_B, setup, message, photoMessage, callback, deliver, link, seedChoices, botModule };
