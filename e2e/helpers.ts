import { expect, type Page } from '@playwright/test';

export const WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const;
export const HEIGHTS: Record<number, number> = { 320: 640, 375: 740, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 };

const BACKEND = 'http://127.0.0.1:54321';
let counter = 0;

export interface TestUser {
  email: string;
  id: string;
  /** The session as supabase-js stores it, for opening the same person on a second device. */
  session: string;
}

/**
 * Signs the page in as a brand-new person on the local stand-in for Supabase: the person is created, signs in through the real
 * sign-in function, and the session is placed where supabase-js keeps it. Their records are then really loaded from the stand-in.
 * (supabase-js keeps its session under sb-<first part of the host>-auth-token.)
 */
export async function signInAs(page: Page, options: { name?: string; factor?: boolean } = {}): Promise<TestUser> {
  counter += 1;
  const email = `tester.${Date.now().toString(36)}${counter}${Math.floor(Math.random() * 1e5)}@example.com`;
  const seeded = (await (await page.request.post(`${BACKEND}/__test/seed`, { data: { email, name: options.name ?? 'Tester', factor: options.factor } })).json()) as { id: string };
  const reply = (await (await page.request.post(`${BACKEND}/functions/v1/auth-gate`, { headers: { origin: 'http://127.0.0.1:4173' }, data: { action: 'signin', email, password: 'Str0ng!Passw0rd', device: `d${String(counter).padStart(19, '0')}` } })).json()) as { session: Record<string, unknown> };
  const stored = JSON.stringify({ ...reply.session, expires_at: Math.floor(Date.now() / 1000) + 3000, token_type: 'bearer', expires_in: 3000 });
  await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', value), stored);
  return { email, id: seeded.id, session: stored };
}

/** Puts records straight into the stand-in's database for a person (as if they had been saved earlier). */
export async function seedRows(page: Page, email: string, table: string, rows: Record<string, unknown>[]): Promise<void> {
  await page.request.post(`${BACKEND}/__test/insert`, { data: { email, table, rows } });
}

export async function dbRows(page: Page, email: string, table: string): Promise<Record<string, unknown>[]> {
  return (await (await page.request.get(`${BACKEND}/__test/rows?email=${encodeURIComponent(email)}&table=${table}`)).json()) as Record<string, unknown>[];
}

/** A date this many days from today, as noon-local ISO (the way records are stored). */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export function ymdDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Collects anything the browser reports as a security-policy violation or a console error. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${event.violatedDirective} ${event.blockedURI}`];
    });
  });
  return problems;
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

/** Opens the Account pop-up (it sits on top of Home) and, when a section name is given, that section's own pop-up on top of it. */
export async function openAccount(page: Page, section?: string): Promise<void> {
  await page.goto('/app/account');
  const account = accountView(page);
  await expect(account).toBeVisible();
  if (section) await openSection(page, section);
}

/** Sections that open as their own pop-up on top of Account; every other section is part of the Account pop-up itself. */
const POPUP_SECTIONS: Record<string, string> = { 'Change password': 'password', 'Delete my account': 'delete' };

/** From the open Account pop-up: goes to one of its sections (opening it when it is one of the pop-up ones). */
export async function openSection(page: Page, section: string): Promise<void> {
  const account = accountView(page);
  const opener = POPUP_SECTIONS[section];
  if (opener) {
    await account.locator(`[data-section="${opener}"]`).click();
    await expect(page.getByRole('dialog', { name: section, exact: true })).toBeVisible();
    return;
  }
  await account.getByRole('heading', { name: section, exact: true }).scrollIntoViewIfNeeded();
  await expect(account.getByRole('heading', { name: section, exact: true })).toBeVisible();
}

/** Account: a pop-up on phones and tablets, a page (a region named "Account") on a computer. */
export function accountView(page: Page) {
  return page.getByRole('dialog', { name: 'Account', exact: true }).or(page.getByRole('region', { name: 'Account', exact: true }));
}

/** Leaves Account: closes the pop-up, or on a computer goes back Home. */
export async function leaveAccount(page: Page): Promise<void> {
  const popup = page.getByRole('dialog', { name: 'Account', exact: true });
  if (await popup.count()) await popup.getByRole('button', { name: 'Close' }).click();
  else await page.getByRole('link', { name: 'Home' }).first().click();
}
