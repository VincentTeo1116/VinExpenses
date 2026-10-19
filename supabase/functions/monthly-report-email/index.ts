const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

function monthInKualaLumpur(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function ringgit(amount: number) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(amount);
}

async function supabaseRest(path: string, serviceKey: string, init: RequestInit = {}) {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl) throw new Error("Missing Supabase URL");
  return fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to run monthly reports." }, 405);

  const cronSecret = Deno.env.get("MONTHLY_REPORT_CRON_SECRET");
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { year, month, day } = monthInKualaLumpur();
  if (day !== "01") return jsonResponse({ message: "Reports only run on the first day in Kuala Lumpur." });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  if (!serviceKey || !resendKey || !fromEmail) {
    return jsonResponse({ error: "Monthly report email is missing server configuration." }, 500);
  }

  const reportMonthDate = new Date(Date.UTC(Number(year), Number(month) - 2, 1));
  const reportMonth = `${reportMonthDate.getUTCFullYear()}-${String(reportMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthStartUtc = new Date(Date.UTC(reportMonthDate.getUTCFullYear(), reportMonthDate.getUTCMonth(), 1) - 8 * 60 * 60 * 1000);
  const nextMonthStartUtc = new Date(Date.UTC(reportMonthDate.getUTCFullYear(), reportMonthDate.getUTCMonth() + 1, 1) - 8 * 60 * 60 * 1000);
  const start = monthStartUtc.toISOString();
  const end = nextMonthStartUtc.toISOString();

  try {
    const preferenceResponse = await supabaseRest(
      `monthly_report_preferences?select=user_id,recipient_email,sent_for_month&enabled=eq.true`,
      serviceKey,
    );
    if (!preferenceResponse.ok) return jsonResponse({ error: "Could not load report preferences." }, 502);
    const preferences = await preferenceResponse.json();
    let sent = 0;
    let skipped = 0;
    const failures: string[] = [];

    for (const preference of preferences) {
      if (preference.sent_for_month === `${reportMonth}-01`) { skipped++; continue; }
      const userId = String(preference.user_id);
      try {
        const [expenseResponse, incomeResponse] = await Promise.all([
          supabaseRest(`expenses?select=amount,category,created_at&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}`, serviceKey),
          supabaseRest(`incomes?select=amount,created_at&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}`, serviceKey),
        ]);
        if (!expenseResponse.ok || !incomeResponse.ok) throw new Error("Could not load transaction totals");
        const [expenses, incomes] = await Promise.all([expenseResponse.json(), incomeResponse.json()]);
        const expenseTotal = expenses.reduce((sum: number, row: { amount: string | number }) => sum + Number(row.amount), 0);
        const incomeTotal = incomes.reduce((sum: number, row: { amount: string | number }) => sum + Number(row.amount), 0);
        const byCategory = new Map<string, number>();
        for (const expense of expenses) byCategory.set(expense.category, (byCategory.get(expense.category) || 0) + Number(expense.amount));
        const categoryRows = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
          .map(([category, amount]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #e8eaf0">${escapeHtml(category)}</td><td style="padding:9px 0;border-bottom:1px solid #e8eaf0;text-align:right">${escapeHtml(ringgit(amount))}</td></tr>`).join("");
        const label = reportMonthDate.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
        const html = `<!doctype html><html><body style="margin:0;background:#f5f6fb;font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:28px auto;padding:28px;background:#fff;border-radius:18px"><p style="margin:0 0 8px;color:#5652d9;font-weight:bold">VINEXPENSES MONTHLY REPORT</p><h1 style="margin:0 0 22px;font-size:24px">${escapeHtml(label)}</h1><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:14px;background:#f5f6fb;border-radius:10px"><div style="font-size:12px;color:#667085">Income</div><strong style="font-size:20px">${escapeHtml(ringgit(incomeTotal))}</strong></td><td style="width:10px"></td><td style="padding:14px;background:#f5f6fb;border-radius:10px"><div style="font-size:12px;color:#667085">Expenses</div><strong style="font-size:20px">${escapeHtml(ringgit(expenseTotal))}</strong></td></tr></table><p style="margin:18px 0 22px;padding:14px;background:#f5f6fb;border-radius:10px">Net for the month: <strong>${escapeHtml(ringgit(incomeTotal - expenseTotal))}</strong><br><span style="color:#667085;font-size:13px">${expenses.length} expenses · ${incomes.length} income records</span></p><h2 style="font-size:16px">Spending by category</h2><table style="width:100%;border-collapse:collapse">${categoryRows || '<tr><td style="padding:9px 0;color:#667085">No expenses recorded this month.</td></tr>'}</table><p style="margin-top:24px;color:#667085;font-size:12px">You’re receiving this because monthly report emails are enabled in your VinExpenses account. Change your preference in the Account menu.</p></div></body></html>`;

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `monthly-report-${userId}-${reportMonth}` },
          body: JSON.stringify({ from: fromEmail, to: [preference.recipient_email], subject: `Your VinExpenses report for ${label}`, html }),
        });
        if (!emailResponse.ok) throw new Error(`Email provider returned ${emailResponse.status}`);

        const updateResponse = await supabaseRest(
          `monthly_report_preferences?user_id=eq.${encodeURIComponent(userId)}`,
          serviceKey,
          { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sent_for_month: `${reportMonth}-01`, updated_at: new Date().toISOString() }) },
        );
        if (!updateResponse.ok) throw new Error("Email sent but report history could not be updated");
        sent++;
      } catch (error) {
        console.error("Monthly report failed for user", userId, error);
        failures.push(userId);
      }
    }
    return jsonResponse({ reportMonth, sent, skipped, failed: failures.length });
  } catch (error) {
    console.error("Monthly report job failed", error);
    return jsonResponse({ error: "Monthly report job failed." }, 500);
  }
});
