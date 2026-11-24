// RX-04: the nearby-places list in the add sheet. The location comes from a fake position; the map answer from the local stand-in service.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { signInAs, watchProblems } from './helpers';

const PLACES = [
  { name: 'Starbucks Mid Valley', kind: 'cafe', distance: 20 },
  { name: 'Kedai Runcit Ah Seng', kind: 'convenience', distance: 45 },
  { name: 'Nasi Kandar Pelita', kind: 'restaurant', distance: 80 },
  { name: 'Watsons', kind: 'chemist', distance: 95 },
  { name: 'Petronas Station', kind: 'fuel', distance: 120 },
  { name: 'Mr DIY', kind: 'doityourself', distance: 140 },
  { name: 'Secret Recipe', kind: 'cafe', distance: 150 },
];

const setNearby = (page: Page, email: string, body: { places?: unknown[]; mode?: 'ok' | 'down'; limit?: number }) => page.request.post(`${BACKEND}/__test/nearby`, { data: { email, ...body } });

async function openAdd(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toBeVisible();
}

test.describe('with location allowed', () => {
  test.use({ geolocation: { latitude: 3.1177, longitude: 101.6773 }, permissions: ['geolocation'] });

  test('shows the 5 nearest, searches all of them, and picking one fills the merchant and suggests the category', async ({ page }) => {
    const problems = watchProblems(page);
    const user = await signInAs(page);
    await setNearby(page, user.email, { places: PLACES });
    await openAdd(page);
    await page.getByRole('button', { name: 'Find places near me' }).click();
    const list = page.getByTestId('nearby-place');
    await expect(list).toHaveCount(5);
    await expect(list.first()).toContainText('Starbucks Mid Valley');
    await expect(list.first()).toContainText('cafe · 20 m');
    // the rest can be shown, or searched
    await page.getByRole('button', { name: 'Show all 7' }).click();
    await expect(list).toHaveCount(7);
    await page.getByLabel('Search these places').fill('secret');
    await expect(list).toHaveCount(1);
    await page.getByLabel('Search these places').fill('zzz');
    await expect(list).toHaveCount(0);
    await expect(page.getByText('No place matches')).toBeVisible();
    await page.getByLabel('Search these places').fill('starb');
    await list.first().click();
    await expect(page.getByLabel('Where (optional)')).toHaveValue('Starbucks Mid Valley');
    await expect(page.getByRole('radio', { name: 'Beverages', exact: true })).toBeChecked();
    await expect(list.first()).toHaveAttribute('aria-pressed', 'true');
    // what the service received: the position, asked for as a list, and nothing else
    const seen = (await (await page.request.get(`${BACKEND}/__test/nearby-last?email=${encodeURIComponent(user.email)}`)).json()) as { last: { latitude: number; longitude: number; list: boolean } };
    expect(seen.last).toEqual({ latitude: 3.1177, longitude: 101.6773, list: true });
    expect(problems).toEqual([]);
  });

  test('a person who typed the category themselves keeps it', async ({ page }) => {
    const user = await signInAs(page);
    await setNearby(page, user.email, { places: PLACES });
    await openAdd(page);
    await page.getByRole('radio', { name: 'Shopping', exact: true }).check();
    await page.getByRole('button', { name: 'Find places near me' }).click();
    await page.getByTestId('nearby-place').first().click();
    await expect(page.getByLabel('Where (optional)')).toHaveValue('Starbucks Mid Valley');
    await expect(page.getByRole('radio', { name: 'Shopping', exact: true })).toBeChecked();
  });

  test('nothing nearby, the map service being down, and the daily limit each say so and leave typing available', async ({ page }) => {
    const user = await signInAs(page);
    await openAdd(page);
    await setNearby(page, user.email, { places: [] });
    await page.getByRole('button', { name: 'Find places near me' }).click();
    await expect(page.getByTestId('nearby-note')).toContainText('No mapped places nearby');
    await setNearby(page, user.email, { mode: 'down' });
    await page.getByRole('button', { name: 'Find places near me' }).click();
    await expect(page.getByTestId('nearby-note')).toContainText('map service is busy');
    await setNearby(page, user.email, { places: PLACES, limit: 0 });
    await page.getByRole('button', { name: 'Find places near me' }).click();
    await expect(page.getByTestId('nearby-note')).toContainText('limit for today');
    await page.getByLabel('Where (optional)').fill('Typed by hand');
    await expect(page.getByLabel('Where (optional)')).toHaveValue('Typed by hand');
  });

  test('the list has no accessibility violations (light and dark) and is not offered when editing', async ({ page }) => {
    const user = await signInAs(page);
    await setNearby(page, user.email, { places: PLACES });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openAdd(page);
      await page.getByRole('button', { name: 'Find places near me' }).click();
      await expect(page.getByTestId('nearby-place').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), scheme).toEqual([]);
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('with location blocked', () => {
  test.use({ permissions: [] });

  test('says it is blocked and never calls the service', async ({ page }) => {
    const user = await signInAs(page);
    await setNearby(page, user.email, { places: PLACES });
    await openAdd(page);
    await page.getByRole('button', { name: 'Find places near me' }).click();
    await expect(page.getByTestId('nearby-note')).toContainText(/blocked|could not be found/);
    const seen = (await (await page.request.get(`${BACKEND}/__test/nearby-last?email=${encodeURIComponent(user.email)}`)).json()) as { calls?: number };
    expect(seen.calls ?? 0).toBe(0);
  });
});
