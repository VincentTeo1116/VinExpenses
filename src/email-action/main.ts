// PU-04: the page behind the links in our emails (confirm my address, unsubscribe). The token stays in the # part of the address,
// it is removed from the address bar at once, and nothing happens until the person presses the button. No app code runs here.
import './email-action.css';
import { envResult } from '@/lib/env';

type Lang = 'en' | 'ms' | 'zh';
const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    invalidTitle: 'Link not valid',
    invalidBody: 'This link is incomplete or has expired. Please request a new one from the app.',
    confirmTitle: 'Confirm your email',
    confirmBody: 'Press the button to confirm that ManaDuit may send your monthly report to this address.',
    confirmButton: 'Confirm email address',
    unsubTitle: 'Unsubscribe',
    unsubBody: 'Press the button to stop ManaDuit monthly reports to this address.',
    unsubButton: 'Unsubscribe',
    wait: 'Please wait…',
    okConfirm: 'Email confirmed',
    okUnsub: 'Unsubscribed',
    done: 'Done.',
    failTitle: 'Could not complete',
    failBody: 'Something went wrong. Please try again later.',
    offline: 'Could not reach the server. Check your connection and press the button again.',
  },
  ms: {
    invalidTitle: 'Pautan tidak sah',
    invalidBody: 'Pautan ini tidak lengkap atau telah tamat tempoh. Sila minta yang baharu daripada aplikasi.',
    confirmTitle: 'Sahkan emel anda',
    confirmBody: 'Tekan butang untuk mengesahkan bahawa ManaDuit boleh menghantar laporan bulanan anda ke alamat ini.',
    confirmButton: 'Sahkan alamat emel',
    unsubTitle: 'Berhenti melanggan',
    unsubBody: 'Tekan butang untuk menghentikan laporan bulanan ManaDuit ke alamat ini.',
    unsubButton: 'Berhenti melanggan',
    wait: 'Sila tunggu…',
    okConfirm: 'Emel disahkan',
    okUnsub: 'Telah berhenti melanggan',
    done: 'Selesai.',
    failTitle: 'Tidak dapat diselesaikan',
    failBody: 'Ada yang tidak kena. Sila cuba lagi nanti.',
    offline: 'Tidak dapat menghubungi pelayan. Semak sambungan anda dan tekan butang sekali lagi.',
  },
  zh: {
    invalidTitle: '链接无效',
    invalidBody: '此链接不完整或已过期，请在应用中重新获取。',
    confirmTitle: '确认您的邮箱',
    confirmBody: '点击按钮，确认 ManaDuit 可以把月度报告发送到这个地址。',
    confirmButton: '确认邮箱地址',
    unsubTitle: '取消订阅',
    unsubBody: '点击按钮，停止向这个地址发送 ManaDuit 月度报告。',
    unsubButton: '取消订阅',
    wait: '请稍候…',
    okConfirm: '邮箱已确认',
    okUnsub: '已取消订阅',
    done: '完成。',
    failTitle: '未能完成',
    failBody: '出了点问题，请稍后再试。',
    offline: '无法连接服务器。请检查网络后再点一次按钮。',
  },
};

function pickLang(): Lang {
  try {
    const saved = localStorage.getItem('ve_lang');
    if (saved === 'ms' || saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* storage blocked */
  }
  const browser = (navigator.language || 'en').toLowerCase();
  return browser.startsWith('ms') ? 'ms' : browser.startsWith('zh') ? 'zh' : 'en';
}

const lang = pickLang();
const t = (key: string): string => TEXT[lang][key] ?? TEXT.en[key] ?? key;
document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;

const title = document.getElementById('title') as HTMLElement;
const message = document.getElementById('message') as HTMLElement;
const button = document.getElementById('go') as HTMLButtonElement;
const card = document.querySelector('.card') as HTMLElement;

const params = new URLSearchParams(location.hash.replace(/^#/, ''));
const action = params.get('a');
const token = params.get('t') ?? '';
if (location.hash) history.replaceState(null, '', location.pathname); // the token must not stay in the address bar or the history

function finish(ok: boolean, heading: string, text: string) {
  card.className = `card ${ok ? 'ok' : 'bad'}`;
  title.textContent = heading;
  message.textContent = text;
  button.hidden = true;
}

const base = envResult.ok ? envResult.env.supabaseUrl : '';
const valid = (action === 'confirm' || action === 'unsub') && /^[A-Za-z0-9_.-]{10,700}$/.test(token);

if (!base || !valid) {
  finish(false, t('invalidTitle'), t('invalidBody'));
} else {
  const confirming = action === 'confirm';
  title.textContent = t(confirming ? 'confirmTitle' : 'unsubTitle');
  message.textContent = t(confirming ? 'confirmBody' : 'unsubBody');
  button.textContent = t(confirming ? 'confirmButton' : 'unsubButton');
  button.hidden = false;

  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = t('wait');
    fetch(`${base}/functions/v1/email-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      body: JSON.stringify({ action, token }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (response.ok && data.ok) finish(true, t(confirming ? 'okConfirm' : 'okUnsub'), data.message || t('done'));
        else finish(false, t('failTitle'), data.message || t('failBody'));
      })
      .catch(() => {
        button.disabled = false;
        button.textContent = t(confirming ? 'confirmButton' : 'unsubButton');
        message.textContent = t('offline');
      });
  });
}
