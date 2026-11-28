// The Install page: how to put ManaDuit on a home screen (it is a web app, so there is no store and no download file),
// with a one-tap button where the browser offers one, and an honest note on what works without internet.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { askToInstall, guessPlatform, useCanInstall, useInstalled, type Platform } from '@/app/install';
import { PublicLayout, usePageMeta } from './PublicLayout';
import { Reveal } from './motion';
import styles from './InstallPage.module.css';

const Glyph = ({ children }: { children: ReactNode }) => (
  <span className={styles.glyph} aria-hidden="true">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  </span>
);
const Dots = () => (
  <Glyph>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" />
  </Glyph>
);
const Share = () => (
  <Glyph>
    <path d="M12 15V3" />
    <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </Glyph>
);
const AddHome = () => (
  <Glyph>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Glyph>
);
const Monitor = () => (
  <Glyph>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Glyph>
);
const Download = () => (
  <Glyph>
    <path d="M12 4v11" />
    <path d="m7.5 11 4.5 4.5 4.5-4.5" />
    <path d="M5 20h14" />
  </Glyph>
);

interface Step {
  icon: ReactNode;
  title: string;
  text: string;
}

const STEPS: Record<Platform, { label: string; browser: string; steps: Step[] }> = {
  android: {
    label: 'Android',
    browser: 'Use Chrome (Samsung Internet and Edge work too).',
    steps: [
      { icon: <Dots />, title: 'Open the menu', text: 'In Chrome, tap the three dots at the top right of the screen.' },
      { icon: <Download />, title: 'Tap "Install app"', text: 'Some phones say "Add to Home screen". Pick whichever one you see.' },
      { icon: <AddHome />, title: 'Confirm with "Install"', text: 'ManaDuit now sits on your home screen with its own icon, like any other app.' },
    ],
  },
  iphone: {
    label: 'iPhone and iPad',
    browser: 'Use Safari. Other browsers on iPhone cannot add it to the home screen.',
    steps: [
      { icon: <Share />, title: 'Tap the Share button', text: 'It is the square with an arrow, at the bottom of Safari (top right on iPad).' },
      { icon: <AddHome />, title: 'Choose "Add to Home Screen"', text: 'Scroll down in the sheet if you do not see it straight away.' },
      { icon: <Download />, title: 'Tap "Add"', text: 'The ManaDuit icon appears on your home screen. Open it from there.' },
    ],
  },
  computer: {
    label: 'Computer',
    browser: 'Use Chrome or Edge. Safari on Mac can use File, then "Add to Dock".',
    steps: [
      { icon: <Monitor />, title: 'Look at the address bar', text: 'On the right side of the address bar you will see a small install icon (a screen with a down arrow).' },
      { icon: <Download />, title: 'Click it, then "Install"', text: 'If you do not see the icon, open the three-dot menu and choose "Install ManaDuit".' },
      { icon: <AddHome />, title: 'Open it like any program', text: 'ManaDuit gets its own window, with no address bar, and a shortcut on your desktop or taskbar.' },
    ],
  },
};

const ORDER: Platform[] = ['android', 'iphone', 'computer'];

const OFFLINE = [
  { title: 'Opens with no signal', text: 'The app itself is saved on your device, so it opens in a lift, on a flight or on a weak connection.' },
  { title: 'Saves what you type', text: 'Add an expense or income while offline. It is kept on your device and sent automatically when the connection returns.' },
  { title: 'Tells you when you are offline', text: 'A banner shows when the connection drops, so a failed save is never a mystery.' },
];

const FAQ = [
  { q: 'Is this a real app?', a: 'Yes. It opens full screen with its own icon, and it behaves like an app. It is installed from the browser instead of a store, so there is no file to download, no store account, and nothing that can be blocked as an unknown app.' },
  { q: 'Is it safe?', a: 'It is the same ManaDuit you use in the browser, served from manaduit.com. Installing it does not give it extra access to your phone: no contacts, no messages. The camera is used only when you choose to scan a receipt, and your location only if you tap the map pin.' },
  { q: 'Does it update by itself?', a: 'Yes. Whenever you open it online, it fetches the latest version. You will see a short prompt to refresh when a new one is ready.' },
  { q: 'Will I still see my data offline?', a: 'Your records are kept in your account online, so figures load when you are connected. What works offline is opening the app and recording new expenses and income, which are sent later.' },
  { q: 'How do I remove it?', a: 'Press and hold the icon and choose Uninstall or Remove, like any app. Your account and records stay safe online.' },
];

export function InstallPage() {
  usePageMeta('Install ManaDuit · add it to your home screen', 'How to install ManaDuit on Android, iPhone or a computer in a few taps, with no store and no download file. It opens fast and records expenses even offline.');
  const [platform, setPlatform] = useState<Platform>(() => guessPlatform());
  const canInstall = useCanInstall();
  const installed = useInstalled();
  const [done, setDone] = useState(false);
  const current = STEPS[platform];

  const install = async () => {
    const ok = await askToInstall();
    if (ok) setDone(true);
  };

  return (
    <PublicLayout>
      <section className={styles.hero}>
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>Free · No store · No download file</span>
          <h1 className={styles.h1}>Install ManaDuit on your phone</h1>
          <p className={styles.lead}>ManaDuit is a web app, so you add it straight from your browser in a few taps. It gets its own icon, opens full screen, and keeps working when the signal drops.</p>
          {installed || done ? (
            <p className={styles.ok} role="status" data-testid="install-done">
              ✓ ManaDuit is installed on this device. <Link to="/app">Open the app</Link>
            </p>
          ) : (
            <div className={styles.actions}>
              {canInstall ? (
                <button type="button" className={styles.primary} onClick={install} data-testid="install-button">
                  Install ManaDuit now
                </button>
              ) : null}
              <Link className={canInstall ? styles.outline : styles.primary} to="/app">
                Open in the browser
              </Link>
            </div>
          )}
          {!installed && !done && !canInstall ? <p className={styles.note}>Follow the three steps below for your device. They take about 20 seconds.</p> : null}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="how">
        <div className={styles.wrap}>
          <Reveal>
            <h2 id="how" className={styles.h2}>
              Three taps, pick your device
            </h2>
            <div className={styles.switch} role="group" aria-label="Choose your device">
              {ORDER.map((key) => (
                <button key={key} type="button" aria-pressed={platform === key} className={`${styles.pill} ${platform === key ? styles.on : ''}`} onClick={() => setPlatform(key)}>
                  {STEPS[key].label}
                </button>
              ))}
            </div>
            <p className={styles.browser} data-testid="install-browser">
              {current.browser}
            </p>
            <ol className={styles.steps} data-testid="install-steps">
              {current.steps.map((step, index) => (
                <li key={step.title} className={styles.step}>
                  <span className={styles.num} aria-hidden="true">
                    {index + 1}
                  </span>
                  {step.icon}
                  <div>
                    <h3 className={styles.h3}>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      <section className={`${styles.section} ${styles.band}`} aria-labelledby="offline">
        <div className={styles.wrap}>
          <Reveal>
            <h2 id="offline" className={styles.h2}>
              What works without internet
            </h2>
            <p className={styles.sub}>Once installed, ManaDuit does not need a perfect connection to be useful.</p>
            <ul className={styles.cards}>
              {OFFLINE.map((item) => (
                <li key={item.title} className={styles.card}>
                  <h3 className={styles.h3}>{item.title}</h3>
                  <p>{item.text}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="faq">
        <div className={styles.wrap}>
          <Reveal>
            <h2 id="faq" className={styles.h2}>
              Questions
            </h2>
            <div className={styles.faq}>
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
            <p className={styles.note}>
              Prefer not to install? ManaDuit works the same in any browser at <Link to="/">manaduit.com</Link>.
            </p>
          </Reveal>
        </div>
      </section>
    </PublicLayout>
  );
}
