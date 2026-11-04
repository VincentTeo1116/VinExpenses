// The email bodies. Every value that comes from a person or the database goes through escapeHtml before it is placed
// in HTML, and links are only ever built from addresses we generated ourselves.

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

const shell = (inner: string, footer: string) =>
  `<!doctype html><html><body style="margin:0;background:#f5f6fb;font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:28px auto;padding:28px;background:#fff;border-radius:18px">${inner}<p style="margin-top:24px;color:#667085;font-size:12px">${footer}</p></div></body></html>`;

/** Only https links are ever placed in an email. */
function safeLink(url: string): string {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) throw new Error("Refusing to put a non-https link in an email.");
  return escapeHtml(url);
}

export function confirmEmail(confirmUrl: string, address: string): Rendered {
  const link = safeLink(confirmUrl);
  return {
    subject: "Confirm your VinExpenses report email",
    html: shell(
      `<p style="margin:0 0 8px;color:#5652d9;font-weight:bold">VINEXPENSES</p><h1 style="margin:0 0 16px;font-size:22px">Confirm this email address</h1><p>Someone (hopefully you) asked to receive VinExpenses monthly spending reports at <strong>${escapeHtml(address)}</strong>.</p><p>Press the button to confirm. The link works for 48 hours.</p><p style="margin:24px 0"><a href="${link}" style="background:#5652d9;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Confirm email address</a></p>`,
      "If you did not ask for this, ignore this email: nothing will be sent to you and nothing was changed.",
    ),
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
}

export function reportEmail(data: ReportData): Rendered {
  const rows = data.categories
    .map((c) => `<tr><td style="padding:9px 0;border-bottom:1px solid #e8eaf0">${escapeHtml(c.name)}</td><td style="padding:9px 0;border-bottom:1px solid #e8eaf0;text-align:right">${escapeHtml(ringgit(c.amount))}</td></tr>`)
    .join("");
  const link = safeLink(data.unsubscribeUrl);
  const net = data.incomeTotal - data.expenseTotal;
  return {
    subject: `Your VinExpenses report for ${data.label}`,
    html: shell(
      `<p style="margin:0 0 8px;color:#5652d9;font-weight:bold">VINEXPENSES MONTHLY REPORT</p><h1 style="margin:0 0 22px;font-size:24px">${escapeHtml(data.label)}</h1><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:14px;background:#f5f6fb;border-radius:10px"><div style="font-size:12px;color:#667085">Income</div><strong style="font-size:20px">${escapeHtml(ringgit(data.incomeTotal))}</strong></td><td style="width:10px"></td><td style="padding:14px;background:#f5f6fb;border-radius:10px"><div style="font-size:12px;color:#667085">Expenses</div><strong style="font-size:20px">${escapeHtml(ringgit(data.expenseTotal))}</strong></td></tr></table><p style="margin:18px 0 22px;padding:14px;background:#f5f6fb;border-radius:10px">Net for the month: <strong>${escapeHtml(ringgit(net))}</strong><br><span style="color:#667085;font-size:13px">${data.expenseCount} expenses · ${data.incomeCount} income records</span></p><h2 style="font-size:16px">Spending by category</h2><table style="width:100%;border-collapse:collapse">${rows || '<tr><td style="padding:9px 0;color:#667085">No expenses recorded this month.</td></tr>'}</table>`,
      `You receive this because you turned on monthly reports in your VinExpenses account and confirmed this address. <a href="${link}" style="color:#667085">Unsubscribe</a>.`,
    ),
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
      `Unsubscribe: ${data.unsubscribeUrl}`,
    ].join("\n"),
  };
}

export function adminTestEmail(whenIso: string, checks: Record<string, boolean>): Rendered {
  const items = Object.entries(checks);
  return {
    subject: "VinExpenses email service test",
    html: shell(
      `<p style="margin:0 0 8px;color:#5652d9;font-weight:bold">VINEXPENSES ADMIN</p><h1 style="margin:0 0 16px;font-size:22px">The email service works ✔</h1><p>This test message was sent through Gmail SMTP at <strong>${escapeHtml(whenIso)}</strong>.</p><ul>${items.map(([name, ok]) => `<li>${escapeHtml(name)}: ${ok ? "OK" : "needs attention"}</li>`).join("")}</ul>`,
      "Only the administrator can trigger this message, and it is only ever sent to the administrator's own address.",
    ),
    text: `The VinExpenses email service works.\nSent through Gmail SMTP at ${whenIso}.\n\n${items.map(([name, ok]) => `${name}: ${ok ? "OK" : "needs attention"}`).join("\n")}`,
  };
}
