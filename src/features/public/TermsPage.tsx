// Terms of Use. Keep them true to the app (the Privacy Policy lists the outside services in detail).
import { Link } from 'react-router-dom';
import { LegalPage, LegalSection } from './LegalPage';

const SECTIONS = [{ id: 'who', label: 'Who can use the app' }, { id: 'account', label: 'Your account' }, { id: 'data', label: 'Your data' }, { id: 'advice', label: 'Estimates, not financial advice' }, { id: 'use', label: 'Acceptable use' }, { id: 'third', label: 'Services from other providers' }, { id: 'free', label: 'A free service that may change' }, { id: 'end', label: 'Ending your use' }, { id: 'warranty', label: 'No warranty' }, { id: 'liability', label: 'Limit of liability' }, { id: 'ip', label: 'The app itself' }, { id: 'changes', label: 'Changes to these terms' }, { id: 'law', label: 'Governing law' }, { id: 'contact', label: 'Contact' }];

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="Effective 24 November 2026"
      intro={
        <>These terms are an agreement between you and Vincent Teo, an individual in Malaysia ("I", "me"), who runs ManaDuit (formerly VinExpenses; "the app"). By creating an account or using the app you agree to them. If you do not agree, please do not use the app.</>
      }
      summary={[
        <>The app is free and provided as it is, by one person, without a guarantee that it is always available or free of mistakes.</>,
        <>Its figures, including the deposit and loan calculators, are estimates and not financial advice.</>,
        <>Your records are yours. Keep your own copy of anything important, using the export.</>,
        <>Use it lawfully, and do not try to break it or reach other people's data.</>,
      ]}
      sections={SECTIONS}
      other={{ to: '/privacy', label: 'Privacy Policy' }}
    >
      <LegalSection id="who" title="1. Who can use the app">
        <p>You may use the app if you are 18 or older. If you are under 18, you may use it only with the permission of a parent or guardian, who accepts these terms on your behalf. The app is designed for personal finances in Malaysian Ringgit and is offered from Malaysia; if you use it elsewhere, you are responsible for following your local laws.</p>
      </LegalSection>
      <LegalSection id="account" title="2. Your account">
        <ul>
        <li>Give a real email address that you control, and keep your password to yourself.</li>
        <li>You are responsible for what happens under your account. Tell me promptly if you think someone else has used it.</li>
        <li>One person, one account. Do not create accounts by automated means.</li>
        <li>Choose a strong password. Sign-up and password resets use a 6-digit code sent to your email, which works once and expires after 5 minutes. You can ask for at most 3 codes a day and 10 a month; after that, contact the admin.</li>
        <li>After 5 wrong passwords on one device, sign-in is paused for 3 hours to protect the account. You can reset your password or contact the admin.</li>
        <li>Two-step verification with an authenticator app is optional. Keep your recovery codes safe: if you lose both your phone and your codes, an administrator may need to reset it after checking it is you.</li>
        </ul>
      </LegalSection>
      <LegalSection id="data" title="3. Your data">
        <p>You keep all rights to the records you enter. You allow me to store and process them only to provide the app to you, as described in the <Link to="/privacy">Privacy Policy</Link>. You are responsible for the accuracy of what you enter, and for having the right to upload any receipt or document you scan.</p>
      </LegalSection>
      <LegalSection id="advice" title="4. Estimates, not financial advice">
        <ul>
        <li>The app is a record-keeping and planning tool. Nothing in it is financial, investment, tax, legal or accounting advice.</li>
        <li>The fixed deposit and loan calculators use simplified, fixed-rate formulas. A bank's or lender's actual figures can differ because of fees, rounding, day-count rules, rate changes and its own terms. Always rely on the documents your bank or lender gives you.</li>
        <li>Receipt reading, category suggestions and the list of places near you can be wrong. Check every entry before you save it.</li>
        <li>Reminders are a convenience. They can be late or fail to arrive, so do not depend on them alone for a payment or a maturity date.</li>
        <li>The app never moves money and has no connection to your bank.</li>
        </ul>
      </LegalSection>
      <LegalSection id="use" title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul>
        <li>use the app for anything unlawful, or to store content you have no right to store;</li>
        <li>try to access another person's account or data, or test or bypass the app's security without my written permission;</li>
        <li>overload the service, scrape it, or use automated tools against it beyond normal personal use;</li>
        <li>copy, resell or present the app as your own service.</li>
        </ul>
        <p>Fair-use limits apply, for example a daily number of receipt scans and a maximum number of saved deposits and loans per account.</p>
      </LegalSection>
      <LegalSection id="third" title="6. Services from other providers">
        <p>Some features depend on other providers, such as Google sign-in, Telegram, receipt text recognition and the map services that list places near you. Those features are optional, the providers' own terms apply to them, and I am not responsible for their availability or conduct.</p>
      </LegalSection>
      <LegalSection id="free" title="7. A free service that may change">
        <p>The app is free of charge. I may add, change or remove features, set limits, or stop offering the app. If the app is to be closed, I will try to give at least 30 days' notice in the app or by email so that you can export your data. If paid features are ever introduced, they will be clearly marked and you will not be charged without agreeing first.</p>
      </LegalSection>
      <LegalSection id="end" title="8. Ending your use">
        <ul>
        <li>You can stop at any time and delete your account from inside the app.</li>
        <li>I may suspend or close an account that breaks these terms, puts the service or other users at risk, or has been unused for a long time. Where it is reasonable, I will warn you first and give you time to export your data.</li>
        <li>Administrators can disable or block an account, and can unblock or re-enable it. They cannot see your expenses or reports.</li>
        </ul>
      </LegalSection>
      <LegalSection id="warranty" title="9. No warranty">
        <p>The app is provided "as is" and "as available". To the fullest extent the law allows, I give no warranty that it will be uninterrupted, secure, free of errors, or fit for a particular purpose, and no warranty about the accuracy of any calculation, suggestion or reminder. Data can be lost through faults outside anyone's control, so please export a copy of anything you cannot afford to lose.</p>
      </LegalSection>
      <LegalSection id="liability" title="10. Limit of liability">
        <p>To the fullest extent the law allows, I am not liable for any indirect or consequential loss, or for loss of money, profit, data or opportunity, that arises from using or being unable to use the app, including decisions made using its figures or a reminder that did not arrive. Because the app is free, my total liability to you for any claim is limited to RM 100. Nothing in these terms removes rights that the law does not allow to be removed, including under Malaysia's consumer protection laws.</p>
      </LegalSection>
      <LegalSection id="ip" title="11. The app itself">
        <p>The app's design, text and code belong to me or are used under licence from their authors. You receive a personal, non-transferable permission to use the app for your own finances. This does not give you rights to the name "ManaDuit" or its logo.</p>
      </LegalSection>
      <LegalSection id="changes" title="12. Changes to these terms">
        <p>If these terms change in a way that matters, the new date will be shown at the top and a notice will be shown in the app or sent by email before the change takes effect. Continuing to use the app after that means you accept the new terms.</p>
      </LegalSection>
      <LegalSection id="law" title="13. Governing law">
        <p>These terms are governed by the laws of Malaysia, and the courts of Malaysia have jurisdiction over any dispute. If one part of these terms is found to be unenforceable, the rest still applies.</p>
      </LegalSection>
      <LegalSection id="contact" title="14. Contact">
        <address>
        Vincent Teo<br />
        Email: <a href="mailto:teovincentkq1611@gmail.com">teovincentkq1611@gmail.com</a>
        </address>
      </LegalSection>
    </LegalPage>
  );
}
