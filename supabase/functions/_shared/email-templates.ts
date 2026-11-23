// The email bodies. One layout for all of them: tables and inline styles only, no images or scripts, and user text is escaped.

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

export function ringgit(amount: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const BRAND = "#4f46e5";
const INK = "#0f172a";
const MUTED = "#5b6785";
const LINE = "#e4e7f0";
const SOFT = "#f5f6fa";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface LayoutParts {
  /** The short line some inboxes show next to the subject. Plain text. */
  preheader: string;
  /** Small label above the title, for example "Monthly report". Plain text. */
  eyebrow: string;
  /** Plain text. */
  title: string;
  /** Already-safe HTML for the body. */
  body: string;
  /** A single main button. `href` must already be safe to place in an attribute. */
  button?: { label: string; href: string };
  /** Already-safe HTML shown small under the button, typically the link written out. */
  afterButton?: string;
  /** Already-safe HTML for the small print at the bottom. */
  footer: string;
}

/** The shared look of every VinExpenses email. All arguments must already be escaped where they hold user data. */
export function emailLayout(parts: LayoutParts): string {
  const button = parts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px"><tr><td align="center" bgcolor="${BRAND}" style="border-radius:12px"><a href="${parts.button.href}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${escapeHtml(parts.button.label)}</a></td></tr></table>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(parts.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${SOFT};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${SOFT};font-size:1px;line-height:1px">${escapeHtml(parts.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SOFT}" style="background:${SOFT}"><tr><td align="center" style="padding:28px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">` +
    `<tr><td style="padding:0 8px 16px;font-family:${FONT};font-size:19px;font-weight:800;letter-spacing:-0.02em;color:${INK}"><span style="display:inline-block;width:12px;height:12px;border-radius:4px;background:${BRAND};margin-right:8px"></span>VinExpenses</td></tr>` +
    `<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${LINE};border-radius:18px;padding:32px 28px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK}">` +
    `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND}">${escapeHtml(parts.eyebrow)}</p>` +
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;letter-spacing:-0.02em;color:${INK}">${escapeHtml(parts.title)}</h1>` +
    parts.body + button + (parts.afterButton ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${MUTED}">${parts.afterButton}</p>` : "") +
    `</td></tr>` +
    `<tr><td style="padding:18px 8px 0;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${MUTED}">${parts.footer}</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

const paragraph = (html: string) => `<p style="margin:0 0 14px">${html}</p>`;

/** Only https links are ever placed in an email. */
function safeLink(url: string): string {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) throw new Error("Refusing to put a non-https link in an email.");
  return escapeHtml(url);
}

export function confirmEmail(confirmUrl: string, address: string): Rendered {
  const link = safeLink(confirmUrl);
  return {
    subject: "Confirm your VinExpenses report email",
    html: emailLayout({
      preheader: "One tap to start receiving your monthly spending report.",
      eyebrow: "Monthly report",
      title: "Confirm this email address",
      body: paragraph(`Someone (hopefully you) asked to receive VinExpenses monthly spending reports at <strong>${escapeHtml(address)}</strong>.`) +
        paragraph("Press the button to confirm. The link works for 48 hours."),
      button: { label: "Confirm email address", href: link },
      afterButton: `Button not working? Copy this link into your browser:<br><span style="word-break:break-all;color:${BRAND}">${link}</span>`,
      footer: "If you did not ask for this, ignore this email: nothing will be sent to you and nothing was changed.",
    }),
    text: `Confirm this email address\n\nSomeone (hopefully you) asked to receive VinExpenses monthly spending reports at ${address}.\n\nOpen this link to confirm (valid for 48 hours):\n${confirmUrl}\n\nIf you did not ask for this, ignore this email: nothing will be sent to you.`,
  };
}

export interface ReportData {
  label: string; // "October 2026"
  incomeTotal: number;
  expenseTotal: number;
  expenseCount: number;
  incomeCount: number;
  categories: { name: string; amount: number }[];
  unsubscribeUrl: string;
  /** Where the website lives (https). When given, the email ends with an "Open VinExpenses" button. */
  appUrl?: string;
}

export function reportEmail(data: ReportData): Rendered {
  const link = safeLink(data.unsubscribeUrl);
  const net = data.incomeTotal - data.expenseTotal;
  // Totals as rows, not side-by-side boxes: three large amounts next to each other do not fit a phone screen
  const total = (label: string, value: string, colour: string, last = false) =>
    `<tr><td style="padding:12px 16px;font-size:14px;color:${MUTED};${last ? "" : `border-bottom:1px solid ${LINE}`}">${label}</td><td align="right" style="padding:12px 16px;font-size:18px;font-weight:800;color:${colour};white-space:nowrap;${last ? "" : `border-bottom:1px solid ${LINE}`}">${escapeHtml(value)}</td></tr>`;

  // Each category: name and amount, then a bar showing its share of the month's spending
  const few = data.categories.length <= 9; // a single leftover is shown by name rather than as "1 more"
  const top = few ? data.categories : data.categories.slice(0, 8);
  const rest = few ? [] : data.categories.slice(8);
  const restTotal = rest.reduce((sum, c) => sum + c.amount, 0);
  const rows = (rest.length ? [...top, { name: `${rest.length} more categor${rest.length === 1 ? "y" : "ies"}`, amount: restTotal }] : top)
    .map((c) => {
      const share = data.expenseTotal > 0 ? Math.max(0, Math.min(100, Math.round((c.amount / data.expenseTotal) * 100))) : 0;
      const bar = Math.max(2, share);
      return `<tr><td style="padding:12px 0 4px;font-size:15px">${escapeHtml(c.name)}</td><td align="right" style="padding:12px 0 4px;font-size:15px;font-weight:700;white-space:nowrap">${escapeHtml(ringgit(c.amount))} <span style="font-weight:400;color:${MUTED};font-size:13px">· ${share}%</span></td></tr>` +
        `<tr><td colspan="2" style="padding:0 0 10px;border-bottom:1px solid ${LINE}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SOFT};border-radius:99px"><tr><td width="${bar}%" height="6" bgcolor="${BRAND}" style="background:${BRAND};border-radius:99px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`;
    })
    .join("");

  const summary = net >= 0
    ? `You kept <strong>${escapeHtml(ringgit(net))}</strong> of what came in.`
    : `You spent <strong>${escapeHtml(ringgit(-net))}</strong> more than came in.`;
  const body =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SOFT}" style="background:${SOFT};border-radius:14px">` +
    total("Income", ringgit(data.incomeTotal), "#059669") + total("Expenses", ringgit(data.expenseTotal), INK) + total("Net", ringgit(net), net >= 0 ? "#059669" : "#dc2626", true) +
    `</table>` +
    `<p style="margin:16px 0 0;font-size:15px">${summary} <span style="color:${MUTED}">${data.expenseCount} expense${data.expenseCount === 1 ? "" : "s"} · ${data.incomeCount} income record${data.incomeCount === 1 ? "" : "s"}.</span></p>` +
    `<h2 style="margin:26px 0 2px;font-size:16px;color:${INK}">Spending by category</h2>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows || `<tr><td style="padding:12px 0;color:${MUTED}">No expenses recorded this month.</td></tr>`}</table>`;

  const app = data.appUrl ? safeLink(data.appUrl) : "";
  return {
    subject: `Your VinExpenses report for ${data.label}`,
    html: emailLayout({
      preheader: `Income ${ringgit(data.incomeTotal)}, expenses ${ringgit(data.expenseTotal)}, net ${ringgit(net)}.`,
      eyebrow: "Monthly report",
      title: data.label,
      body,
      button: app ? { label: "Open VinExpenses", href: app } : undefined,
      footer: `You receive this because you turned on monthly reports in your VinExpenses account and confirmed this address. <a href="${link}" style="color:${MUTED}">Unsubscribe</a>.`,
    }),
    text: [
      `VinExpenses report for ${data.label}`,
      "",
      `Income:   ${ringgit(data.incomeTotal)} (${data.incomeCount} records)`,
      `Expenses: ${ringgit(data.expenseTotal)} (${data.expenseCount} records)`,
      `Net:      ${ringgit(net)}`,
      "",
      "Spending by category:",
      ...(data.categories.length ? data.categories.map((c) => `  ${c.name}: ${ringgit(c.amount)}`) : ["  No expenses recorded this month."]),
      "",
      ...(data.appUrl ? [`Open VinExpenses: ${data.appUrl}`, ""] : []),
      `Unsubscribe: ${data.unsubscribeUrl}`,
    ].join("\n"),
  };
}

export function adminTestEmail(whenIso: string, checks: Record<string, boolean>): Rendered {
  const items = Object.entries(checks);
  return {
    subject: "VinExpenses email service test",
    html: emailLayout({
      preheader: "A test message from your own email service.",
      eyebrow: "Administrator",
      title: "The email service works",
      body: paragraph(`This test message was sent through Gmail SMTP at <strong>${escapeHtml(whenIso)}</strong>.`) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items.map(([name, ok]) =>
          `<tr><td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:15px">${escapeHtml(name)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:14px;font-weight:700;color:${ok ? "#059669" : "#dc2626"}">${ok ? "OK" : "Needs attention"}</td></tr>`).join("")}</table>`,
      footer: "Only the administrator can trigger this message, and it is only ever sent to the administrator's own address.",
    }),
    text: `The VinExpenses email service works.\nSent through Gmail SMTP at ${whenIso}.\n\n${items.map(([name, ok]) => `${name}: ${ok ? "OK" : "needs attention"}`).join("\n")}`,
  };
}

// Sign-in emails, sent by Supabase Auth. tools/auth-emails.js writes and uploads them.
export interface AuthTemplate {
  /** Supabase's name for the template (used in its settings). */
  key: "confirmation" | "recovery" | "magic_link" | "email_change" | "invite" | "reauthentication";
  file: string;
  subject: string;
  html: string;
}

const URL_PLACEHOLDER = "{{ .ConfirmationURL }}";
const writtenOut = `Button not working? Copy this link into your browser:<br><span style="word-break:break-all;color:${BRAND}">${URL_PLACEHOLDER}</span>`;
const codeBlock = `<p style="margin:6px 0 14px;padding:16px;background:${SOFT};border-radius:12px;text-align:center;font-size:30px;font-weight:800;letter-spacing:0.3em;color:${INK}">{{ .Token }}</p>`;
const notYou = (what: string) => `If you did not ${what}, you can ignore this email: nothing was changed. Never share this email with anyone.`;

export function authTemplates(): AuthTemplate[] {
  return [
    {
      key: "confirmation", file: "confirm-signup.html", subject: "Your VinExpenses verification code",
      html: emailLayout({
        preheader: "Your 6-digit code to finish creating your VinExpenses account.",
        eyebrow: "Welcome", title: "Verify your email address",
        body: paragraph("Thanks for signing up for VinExpenses. Enter this code in the app to confirm that <strong>{{ .Email }}</strong> is yours:") +
          codeBlock + paragraph("The code works once and expires in 5 minutes."),
        footer: notYou("create a VinExpenses account"),
      }),
    },
    {
      key: "recovery", file: "reset-password.html", subject: "Your VinExpenses password-reset code",
      html: emailLayout({
        preheader: "Your 6-digit code to choose a new VinExpenses password.",
        eyebrow: "Account security", title: "Reset your password",
        body: paragraph("We received a request to reset the password for <strong>{{ .Email }}</strong>. Enter this code in the app:") +
          codeBlock + paragraph("The code works once and expires in 5 minutes."),
        footer: notYou("ask to reset your password") + " Your current password still works.",
      }),
    },
    {
      key: "magic_link", file: "magic-link.html", subject: "Your VinExpenses sign-in link",
      html: emailLayout({
        preheader: "Sign in to VinExpenses with one tap.",
        eyebrow: "Sign in", title: "Sign in to VinExpenses",
        body: paragraph("Press the button to sign in as <strong>{{ .Email }}</strong>. The link can be used once and expires soon."),
        button: { label: "Sign in", href: URL_PLACEHOLDER }, afterButton: writtenOut,
        footer: notYou("ask to sign in"),
      }),
    },
    {
      key: "email_change", file: "change-email.html", subject: "Confirm your new VinExpenses email address",
      html: emailLayout({
        preheader: "Confirm the new email address for your VinExpenses account.",
        eyebrow: "Account security", title: "Confirm your new email address",
        body: paragraph("You asked to change your VinExpenses email from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>.") +
          paragraph("Press the button to confirm the change."),
        button: { label: "Confirm new email", href: URL_PLACEHOLDER }, afterButton: writtenOut,
        footer: notYou("ask to change your email address") + " If this was not you, change your password now.",
      }),
    },
    {
      key: "invite", file: "invite.html", subject: "You have been invited to VinExpenses",
      html: emailLayout({
        preheader: "Accept your invitation to VinExpenses.",
        eyebrow: "Invitation", title: "You have been invited",
        body: paragraph("You have been invited to create a VinExpenses account, a free tracker for spending, budgets, fixed deposits and loans."),
        button: { label: "Accept the invitation", href: URL_PLACEHOLDER }, afterButton: writtenOut,
        footer: "If you were not expecting this invitation, you can ignore this email.",
      }),
    },
    {
      key: "reauthentication", file: "reauthentication.html", subject: "Your VinExpenses confirmation code",
      html: emailLayout({
        preheader: "Your confirmation code for VinExpenses.",
        eyebrow: "Account security", title: "Confirm it is you",
        body: paragraph("Enter this code in VinExpenses to continue:") +
          `<p style="margin:6px 0 14px;padding:16px;background:${SOFT};border-radius:12px;text-align:center;font-size:30px;font-weight:800;letter-spacing:0.3em;color:${INK}">{{ .Token }}</p>` +
          paragraph("The code expires soon."),
        footer: notYou("ask for this code") + " If this was not you, change your password now.",
      }),
    },
  ];
}
