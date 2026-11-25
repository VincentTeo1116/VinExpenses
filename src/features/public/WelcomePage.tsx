// PU-02: the welcome page. It uses the same design as the app, pictures of the real app (made-up sample data), and gentle motion.
import { Link } from 'react-router-dom';
import { PublicLayout, usePageMeta } from './PublicLayout';
import { Counter, Reveal } from './motion';
import { QuickCalc } from './QuickCalc';
import styles from './WelcomePage.module.css';

const ICONS: Record<string, string> = {
  scan: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 12h10',
  budget: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  repeat: 'M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  loan: 'M12 3v18M16 7.5C16 6 14.2 5 12 5S8 6 8 7.5 9.8 10 12 10s4 1.2 4 2.5S14.2 15 12 15s-4-1-4-2.5',
  report: 'M5 3h10l4 4v14H5zM14 3v5h5M8 13h8M8 17h5',
  telegram: 'M21 4 3 11l5 2 2 6 3-4 5 4zM8 13l9-6',
  language: 'M3 5h8M7 3v2M5 9c1.5 3 4 5 6 6M11 5c-.5 4-3 8-7 10M13 21l4-10 4 10M14.5 18h5',
  pin: 'M12 21s-7-5.7-7-11a7 7 0 1 1 14 0c0 5.3-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const FEATURES: { icon: keyof typeof ICONS; title: string; text: string }[] = [
  { icon: 'scan', title: 'Scan a receipt', text: 'Take a photo or choose a PDF. The total, merchant and date are filled in for you to check. PDF receipts with text are read on your own device and never uploaded.' },
  { icon: 'pin', title: 'Places near you', text: 'Tap the map pin and pick the shop you are at, instead of typing its name. Your position is used once and never kept.' },
  { icon: 'budget', title: 'Budgets that warn you early', text: 'Set a monthly limit overall or per category. See what is safe to spend today, and get a heads-up before you go over.' },
  { icon: 'repeat', title: 'Bills and income on autopilot', text: 'Rent, utilities, subscriptions and salary are added when they fall due, even the ones you missed while away.' },
  { icon: 'bank', title: 'Fixed deposits', text: 'See what you will receive, with a daily, monthly or yearly breakdown. Save it and get reminded before it matures.' },
  { icon: 'loan', title: 'Loans, honestly', text: 'Flat rate or reducing balance: the monthly payment, the total interest, the real yearly rate and every repayment.' },
  { icon: 'report', title: 'Reports you can keep', text: 'A monthly report compared with last month, printable or saved as PDF, plus a spreadsheet of everything whenever you want.' },
  { icon: 'telegram', title: 'Telegram and its Mini App', text: 'Chat "lunch 12.50" to the bot to add an expense, and open your dashboard inside Telegram.' },
  { icon: 'language', title: 'Your language', text: 'English, Bahasa Melayu and 中文, saved with your account. Light and dark mode follow your phone.' },
];

export function WelcomePage() {
  usePageMeta('VinExpenses: track spending, budgets, deposits and loans', 'VinExpenses is a free expense tracker for Malaysia: scan receipts, set budgets, plan fixed deposits and loans, and get reminders. No ads, no tracking.');
  return (
    <PublicLayout
      nav={
        <>
          <a href="#features">Features</a>
          <a href="#try">Try it</a>
          <a href="#privacy">Your data</a>
        </>
      }
    >
      <section className={styles.hero}>
        <div className={styles.blobs} aria-hidden="true">
          <span className={styles.blobA} />
          <span className={styles.blobB} />
        </div>
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroText}>
            <span className={styles.eyebrow}>Free · No ads · Made in Malaysia</span>
            <h1 className={styles.h1}>
              Know where your money goes, <span className={styles.shimmer}>in ringgit and sen.</span>
            </h1>
            <p className={styles.lead}>VinExpenses tracks your spending and income, reads your receipts, keeps your budgets honest, and reminds you before a fixed deposit matures or a loan payment is due.</p>
            <div className={styles.actions}>
              <Link className={styles.primary} to="/app">
                Open the app
              </Link>
              <a className={styles.outline} href="#features">
                See what it does
              </a>
            </div>
            <p className={styles.note}>Works in your browser on phone and computer. Add it to your home screen to use it like an app.</p>
          </div>
          <div className={styles.stage}>
            <picture>
              <source media="(prefers-color-scheme: dark)" srcSet="/landing/dashboard-dark.webp" />
              <img className={styles.shot} src="/landing/dashboard-light.webp" width={1280} height={800} alt="The VinExpenses home screen: this month's spending with a budget bar, income, balance and what is safe to spend today." fetchPriority="high" />
            </picture>
            <div className={`${styles.chip} ${styles.chip1}`} aria-hidden="true">
              <span className={styles.chipDot} /> Lunch <b>−RM 12.50</b>
            </div>
            <div className={`${styles.chip} ${styles.chip2}`} aria-hidden="true">
              Budget <b>52%</b> used
            </div>
            <div className={`${styles.chip} ${styles.chip3}`} aria-hidden="true">
              Deposit matures in <b>7 days</b>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.stats} aria-label="At a glance">
        <div className={styles.wrap}>
          <ul>
            <li>
              <strong>
                <Counter to={3} />
              </strong>
              <span>languages</span>
            </li>
            <li>
              <strong>
                <Counter to={0} />
              </strong>
              <span>ads or trackers</span>
            </li>
            <li>
              <strong>
                <Counter to={200} prefix="<" />
              </strong>
              <span>KB to open the app</span>
            </li>
            <li>
              <strong>
                <Counter to={100} suffix="%" />
              </strong>
              <span>export and delete, any time</span>
            </li>
          </ul>
        </div>
      </section>

      <section id="features" className={styles.section}>
        <div className={styles.wrap}>
          <Reveal>
            <h2 className={styles.h2}>Everything in one calm place</h2>
            <p className={styles.sub}>Built for everyday use: add an expense in a few seconds, and see the month at a glance.</p>
          </Reveal>
          <div className={styles.grid}>
            {FEATURES.map((item, index) => (
              <Reveal key={item.title} className={styles.card} delay={(((index % 4) + 1) as 1 | 2 | 3 | 4)}>
                <span className={styles.icon}>
                  <Icon name={item.icon} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="try" className={`${styles.section} ${styles.band}`}>
        <div className={`${styles.wrap} ${styles.split}`}>
          <Reveal className={styles.phoneWrap}>
            <img className={styles.phone} src="/landing/plan-phone.webp" width={780} height={1688} loading="lazy" alt="The loan calculator on a phone: a monthly payment of RM 1,347.36 with the total interest, total repaid and the real yearly rate." />
          </Reveal>
          <div>
            <Reveal>
              <h2 className={styles.h2}>Plan before you sign</h2>
              <p className={styles.sub}>Compare a bank&apos;s offer in seconds. Try the sliders: this is the same calculator that is in the app.</p>
            </Reveal>
            <Reveal delay={2}>
              <QuickCalc />
            </Reveal>
            <Reveal delay={3}>
              <ul className={styles.ticks}>
                <li>The answer updates as you type, with the numbers that matter first.</li>
                <li>A flat-rate loan shows its real yearly rate, so two offers can be compared fairly.</li>
                <li>Save a loan to see what is paid and what is left, and get a reminder 3 days before a payment.</li>
              </ul>
              <p className={styles.honest}>The calculators give estimates for a fixed rate. They are not financial advice, and your bank&apos;s figures can differ slightly.</p>
            </Reveal>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={`${styles.wrap} ${styles.split} ${styles.flip}`}>
          <div>
            <Reveal>
              <h2 className={styles.h2}>Works where you are</h2>
            </Reveal>
            <Reveal delay={1}>
              <ul className={styles.ticks}>
                <li>
                  <strong>Offline:</strong> add expenses without a connection; they are sent when you are back online.
                </li>
                <li>
                  <strong>Telegram:</strong> connect the bot to add an expense by chatting, and open your dashboard inside Telegram as a Mini App.
                </li>
                <li>
                  <strong>Phone, tablet and computer:</strong> one account, the same data on every device, in light or dark mode.
                </li>
                <li>
                  <strong>Malaysian receipts:</strong> the receipt reader understands English, Malay and Chinese totals.
                </li>
              </ul>
            </Reveal>
          </div>
          <Reveal delay={2} className={styles.duo}>
            <img className={styles.desk} src="/landing/plan-desktop.webp" width={1280} height={800} loading="lazy" alt="The Plan screen on a computer: a fixed deposit calculation with the amount received, the interest and a monthly breakdown." />
            <img className={styles.mini} src="/landing/miniapp-phone.webp" width={780} height={1688} loading="lazy" alt="The Telegram Mini App on a phone, showing the month's spending and where it went." />
          </Reveal>
        </div>
      </section>

      <section id="privacy" className={`${styles.section} ${styles.band}`}>
        <div className={styles.wrap}>
          <Reveal>
            <h2 className={styles.h2}>Your data stays yours</h2>
            <p className={styles.sub}>Money is personal. These are facts about how the app is built, not promises for later.</p>
          </Reveal>
          <div className={styles.grid4}>
            {[
              ['No ads, no tracking inside the app', 'There are no ads, and nothing inside the app is tracked. These public pages count visits with Google Analytics only if you say yes.'],
              ['Only you can see your records', 'Every record is tied to your account and protected by database rules, so one account cannot read another’s data.'],
              ['Take it with you', 'Export everything as a spreadsheet at any time, from Account in the app.'],
              ['Delete it for good', 'Delete your account from inside the app and your records are removed from the server.'],
            ].map(([title, text], index) => (
              <Reveal key={title} className={styles.card} delay={((index + 1) as 1 | 2 | 3 | 4)}>
                <span className={styles.shield} aria-hidden="true">
                  ✓
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </Reveal>
            ))}
          </div>
          <p className={styles.note}>
            The details, including the services that help run the app, are in the <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </section>

      <section className={styles.final}>
        <Reveal className={styles.wrap}>
          <h2 className={styles.h2}>Start with this month</h2>
          <p className={styles.sub}>It is free. Create an account with your email or Google, and add your first expense in under a minute.</p>
          <div className={`${styles.actions} ${styles.center}`}>
            <Link className={styles.primary} to="/app">
              Open the app
            </Link>
          </div>
          <p className={styles.note}>
            By creating an account you agree to the <Link to="/terms">Terms of Use</Link> and the <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </Reveal>
      </section>
    </PublicLayout>
  );
}
