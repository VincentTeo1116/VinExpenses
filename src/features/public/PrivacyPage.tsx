/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- tables that scroll sideways must be reachable by keyboard */
// Privacy Policy. Keep it true to the app: a test (tests/security.test.js) fails if the code reaches an outside service the policy does not name.
import { LegalPage, LegalSection } from './LegalPage';

const SECTIONS = [{ id: 'collect', label: 'What is collected' }, { id: 'use', label: 'How your data is used' }, { id: 'device', label: 'What is stored on your device' }, { id: 'share', label: 'Who else receives your data' }, { id: 'keep', label: 'How long it is kept' }, { id: 'security', label: 'How it is protected' }, { id: 'rights', label: 'Your rights and choices' }, { id: 'children', label: 'Children' }, { id: 'changes', label: 'Changes to this policy' }, { id: 'contact', label: 'Contact' }];

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="Effective 24 November 2026"
      intro={
        <>VinExpenses ("the app") is a free personal expense tracker run by Vincent Teo, an individual in Malaysia ("I", "me"). This policy explains what personal data the app handles, why, who else receives it, and what you can do about it. It is written to follow Malaysia's Personal Data Protection Act 2010 (PDPA).</>
      }
      summary={[
        <>The app stores what you type into it (your account email and your money records) so it can show them back to you. Nothing else is collected about you.</>,
        <>There are no ads and nothing inside the app is tracked. If you say yes, the public pages (this one, the terms, the welcome page, and the calculator and guide pages in English, Malay and Chinese) count visits with Google Analytics. Your data is not sold or used for marketing.</>,
        <>A few outside services help run the app. Each receives only what its job needs, listed in section 4.</>,
        <>You can export everything, and you can delete your account and its records from inside the app.</>,
        <>An administrator can manage accounts (for example reset a password or unblock sign-in) but can never see your expenses, income or reports.</>,
      ]}
      sections={SECTIONS}
      other={{ to: '/terms', label: 'Terms of Use' }}
    >
      <LegalSection id="collect" title="1. What is collected">
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scroll sideways on a small screen)"><table>
        <thead><tr><th scope="col">Data</th><th scope="col">Where it comes from</th><th scope="col">Needed?</th></tr></thead>
        <tbody>
        <tr><td>Email address, display name, password (stored only as a protected hash by the sign-in service). If you use Google sign-in: your Google email and name.</td><td>You, when you create an account</td><td>Yes, to have an account</td></tr>
        <tr><td>Your records: expenses, income, merchants, notes, categories, payment methods, budgets, recurring items, fixed deposits, loans and reminder settings.</td><td>You, when you use the app</td><td>Yes, this is the service</td></tr>
        <tr><td>Receipt photos or scanned PDFs you choose to scan.</td><td>You</td><td>Optional</td></tr>
        <tr><td>Your approximate position (latitude and longitude), only when you tap the map pin in the “Where” field (“Find places near me”) and allow your browser to share it.</td><td>Your device</td><td>Optional</td></tr>
        <tr><td>Your Telegram chat ID and language, if you connect the Telegram bot; messages and photos you send to the bot.</td><td>You and Telegram</td><td>Optional</td></tr>
        <tr><td>An email address for the monthly report, if you turn it on, and whether the last report was sent.</td><td>You</td><td>Optional</td></tr>
        <tr><td>Security records: when 6-digit codes were requested for your email, wrong-password counts per device (a random device number kept in your browser), a lockout time when sign-in is paused, and, if you turn on two-step verification, the authenticator registration and the hashes of your recovery codes.</td><td>Generated when you sign up or sign in</td><td>Yes, to protect your account</td></tr>
        <tr><td>Messages you send through the contact form: your email, the topic and your message.</td><td>You</td><td>Optional</td></tr>
        <tr><td>Technical data: your IP address and browser details reach the hosting and database providers when your device connects, as with any website. Counters of how many receipt scans your account used each day.</td><td>Your device</td><td>Yes, to deliver and protect the service</td></tr>
        </tbody>
        </table></div>
        <p>The app does not ask for, and you should not enter, bank login details, card numbers or identity card numbers. Financial records can be sensitive: enter only what you are comfortable storing.</p>
      </LegalSection>
      <LegalSection id="use" title="2. How your data is used">
        <ul>
        <li>To run your account and show your records, totals, charts, reports and reminders.</li>
        <li>To read a receipt you scan and suggest its total, merchant, date and category.</li>
        <li>To send messages you asked for: account verification and password reset emails, the monthly report, and Telegram replies and reminders.</li>
        <li>To keep the service safe: limits on 6-digit codes (3 a day, 10 a month), a 3-hour pause after repeated wrong passwords, limits on scans and messages, and investigating misuse.</li>
        <li>To help you: an administrator can see your email, name, sign-up date, whether your account is active, blocked or disabled, whether Telegram and an authenticator are on, and the date of your latest expense (a date only). Administrators can reset a password by emailing you a code, unblock or disable an account, reset an authenticator, resend your monthly report to you, and read contact-form messages. Every administrator action is recorded in a log that cannot be edited. Administrators cannot see your expenses, income, deposits, loans or reports, and cannot see or set your password.</li>
        </ul>
        <p>Your data is not used for advertising, profiling, or training artificial intelligence models by me, and it is not sold. I process it because you asked for the service by creating an account (your consent), and you can withdraw that consent by deleting your account.</p>
      </LegalSection>
      <LegalSection id="device" title="3. What is stored on your device">
        <p>The app does not use advertising cookies. It keeps the following in your browser's storage so that it works. If you say yes to analytics on the public pages, Google Analytics also sets its own cookies (named _ga) there; nothing of this is used inside the app:</p>
        <ul>
        <li>your sign-in session, so you stay logged in;</li>
        <li>the app's own files, so it opens without a connection, and any entries you added while offline that are waiting to be sent;</li>
        <li>small preferences such as the language, the colour theme, whether to remember you, whether you asked not to be reminded about Telegram, and a random device number used to count wrong passwords.</li>
        </ul>
        <p>Signing out removes your session from that device. Entries still waiting to be sent stay on the device, so nothing is lost, until they are sent or you delete your account. PDF receipts that contain text are read on your device and are not uploaded.</p>
      </LegalSection>
      <LegalSection id="share" title="4. Who else receives your data">
        <p>The link to my portfolio (vincent16.vercel.app) in the footer is only a link: nothing from the app is sent to it, and your browser is told not to pass this site's address on. That website will see your IP address if you open it.</p>
        <p>These providers process data on my behalf or at your request. Some of them operate outside Malaysia, so your data may be transferred to and stored in other countries.</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scroll sideways on a small screen)"><table>
        <thead><tr><th scope="col">Provider</th><th scope="col">What it receives</th><th scope="col">When</th></tr></thead>
        <tbody>
        <tr><td>Supabase (database, sign-in, server functions)</td><td>Your account and all your records</td><td>Always</td></tr>
        <tr><td>Cloudflare (website hosting)</td><td>Technical data only (IP address, browser details)</td><td>When you open the site</td></tr>
        <tr><td>GitHub Pages (the app&apos;s previous address)</td><td>Technical data only (IP address, browser details)</td><td>Only if you open the previous address, which sends you on to the app</td></tr>
        <tr><td>Google (sign-in)</td><td>That you are signing in to this app</td><td>Only if you choose Google sign-in</td></tr>
        <tr><td>OCR.space (text recognition)</td><td>The receipt image you scan. It is not stored by the app.</td><td>Only when you scan a photo or a scanned PDF</td></tr>
        <tr><td>Telegram</td><td>The messages, photos, summaries and reminders exchanged with the bot. If you open the Telegram Mini App, Telegram also tells the app who you are (your Telegram name and number), signed so it cannot be faked.</td><td>Only if you connect Telegram</td></tr>
        <tr><td>OpenStreetMap map services (Overpass, and Photon by Komoot, which serve OpenStreetMap data)</td><td>Your position, sent straight from your device to these services (and, if they cannot be reached from your device, through the app&apos;s server) so the list of places near you can be shown. The services also see your IP address, as any website would. The app does not keep your position.</td><td>Only when you tap the map pin (“Find places near me”)</td></tr>
        <tr><td>Tesseract (text recognition inside your browser, hosted on this website)</td><td>Nothing leaves your device: the photo is read locally, and the reader&apos;s own files come from this website</td><td>Only when the online reader is busy, unavailable or you are offline</td></tr>
        <tr><td>Google Analytics (visit counts on the public pages)</td><td>Which public page was opened, roughly where from (country or city), the type of device and browser, and how you reached the page. It is never used inside the app and never receives your records. Advertising features are switched off.</td><td>Only on the public pages (welcome, calculators, guides, privacy and terms), and only if you click yes. It is not loaded if your browser sends a do-not-track signal. To change your mind, clear this site's data in your browser.</td></tr>
        <tr><td>Frankfurter (exchange rates from the European Central Bank)</td><td>Only a currency code and a date, sent by the app&apos;s server, never your name, account or amounts</td><td>When a receipt is in a foreign currency and you scan it</td></tr>
        <tr><td>Google Gmail (sending email)</td><td>The recipient address and the email's content, such as a 6-digit code or your monthly summary</td><td>When an email is sent to you</td></tr>
        <tr><td>Cloudflare Turnstile (security check)</td><td>Your browser's technical details, so it can tell you are not a robot</td><td>On sign-up, sign-in, password reset and the contact form, when the check is switched on</td></tr>
        </tbody>
        </table></div>
        <p>Each provider handles data under its own privacy policy. I may also disclose data if the law requires it. Your data is not shared with anyone else.</p>
      </LegalSection>
      <LegalSection id="keep" title="5. How long it is kept">
        <ul>
        <li>Your account and records are kept until you delete them or delete your account.</li>
        <li>Deleting your account in the app (Account → Delete my account) removes your account and the records linked to it from the server. Copies may remain in the provider's backups for a limited time before they are overwritten.</li>
        <li>Receipt images are not stored after they are read. Daily usage counters are kept only to enforce limits.</li>
        <li>An account that has been unused for a long time may be deleted after a notice is sent to its email address.</li>
        <li>Code and lockout records are kept for a few days to a month, then removed. Contact-form messages are kept until resolved and then removed after a reasonable time.</li>
        </ul>
      </LegalSection>
      <LegalSection id="security" title="6. How it is protected">
        <ul>
        <li>Connections are encrypted (HTTPS).</li>
        <li>Database rules restrict every record to the account that owns it.</li>
        <li>Sign-in uses 6-digit codes that work once and expire after 5 minutes, strong-password rules, and a pause after repeated wrong passwords. You can add an authenticator app as a second step.</li>
        <li>The app loads its code from this site only, and server keys are never sent to your browser.</li>
        </ul>
        <p>No online service can promise perfect security. Use a strong, unique password, keep your device locked, and tell me at once if you think your account has been accessed by someone else. If a breach affects your data, I will inform you without undue delay.</p>
      </LegalSection>
      <LegalSection id="rights" title="7. Your rights and choices">
        <ul>
        <li><strong>See and correct:</strong> everything you entered is visible and editable in the app.</li>
        <li><strong>Take a copy:</strong> Account → Your data → Export everything (CSV).</li>
        <li><strong>Delete:</strong> delete single records, or delete your account in the app.</li>
        <li><strong>Limit:</strong> the optional features (receipt scanning, places near you, Telegram, monthly email) are off until you use or enable them, and can be switched off again.</li>
        <li><strong>Ask or complain:</strong> write to the address below. I will answer within 21 days. You may also contact Malaysia's Personal Data Protection Commissioner.</li>
        </ul>
      </LegalSection>
      <LegalSection id="children" title="8. Children">
        <p>The app is intended for people aged 18 or older. If you are under 18, use it only with the permission of a parent or guardian, who agrees to this policy on your behalf. If you believe a child has created an account without permission, write to me and it will be removed.</p>
      </LegalSection>
      <LegalSection id="changes" title="9. Changes to this policy">
        <p>If this policy changes in a way that matters, the new date will be shown at the top and a notice will be shown in the app or sent by email before the change takes effect.</p>
      </LegalSection>
      <LegalSection id="contact" title="10. Contact">
        <address>
        Vincent Teo (data user under the PDPA)<br />
        Email: <a href="mailto:teovincentkq1611@gmail.com">teovincentkq1611@gmail.com</a>
        </address>
      </LegalSection>
    </LegalPage>
  );
}
