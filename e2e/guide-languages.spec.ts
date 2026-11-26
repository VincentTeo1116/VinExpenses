// GD-03: the public guides in English, Malay and Chinese: each page is complete in the HTML itself, says its own language, links to its twins, and works on a phone.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ALL_SLUGS, ARTICLES, HTML_LANG, LANGS, LANG_NAME, pathFor } from '../src/features/guides/registry';

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

test('every guide, in every language, is a finished page in the HTML: language, title, one heading, its own address and its twins', async ({ request }) => {
  for (const lang of LANGS) {
    for (const slug of ALL_SLUGS) {
      const path = pathFor(lang, slug);
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-security-policy'], path).toContain("default-src 'none'");
      expect(response.headers()['x-robots-tag'], path).toBeUndefined();
      const html = await response.text();
      expect(html, path).toContain(`<html lang="${HTML_LANG[lang]}"`);
      expect(html.match(/<h1>/g)?.length, `${path} has one heading`).toBe(1);
      expect(html, path).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${path}"`));
      for (const code of LANGS) expect(html, `${path} names ${code}`).toContain(`hreflang="${HTML_LANG[code]}" href="http://127.0.0.1:4173${pathFor(code, slug)}"`);
      expect(html, `${path} names the default`).toContain(`hreflang="x-default" href="http://127.0.0.1:4173${pathFor('en', slug)}"`);
      expect(html, path).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[^<]/i);
      if (lang === 'zh') expect(html, path).toMatch(/<title>[^<]*[一-鿿]/);
    }
  }
});

test('the page the app draws starts with the same heading as the HTML (so search engines and people see one page)', async ({ page, request }) => {
  for (const lang of LANGS) {
    for (const slug of [ARTICLES[1], 'bill-calculator'] as const) {
      const path = pathFor(lang, slug);
      const html = await (await request.get(path)).text();
      const written = stripTags(/<h1>(.*?)<\/h1>/s.exec(html)?.[1] ?? '');
      await page.goto(path);
      await expect(page.locator('h1'), path).toHaveText(written);
      await expect(page.locator('html'), path).toHaveAttribute('lang', HTML_LANG[lang]);
    }
  }
});

test('the language links lead to the same page in the other languages', async ({ page }) => {
  await page.goto('/ms/sst-vs-service-charge');
  await page.getByRole('navigation', { name: 'Bahasa' }).getByRole('link', { name: LANG_NAME.zh }).click();
  await expect(page).toHaveURL(/\/zh\/sst-vs-service-charge$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.locator('h1')).toContainText('服务费');
  await page.getByRole('navigation', { name: '语言' }).getByRole('link', { name: LANG_NAME.en }).click();
  await expect(page).toHaveURL(/\/sst-vs-service-charge$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('navigation', { name: 'Language' }).getByText(LANG_NAME.en)).toHaveAttribute('aria-current', 'page');
});

test('the header, footer and calculator words follow the language of the page', async ({ page }) => {
  await page.goto('/ms/fd-calculator');
  await expect(page.getByLabel('Jumlah (RM)')).toBeVisible();
  const malay = page.getByRole('navigation', { name: 'Pautan bawah' });
  await expect(malay.getByRole('link', { name: 'Kalkulator pinjaman' })).toHaveAttribute('href', '/ms/loan-calculator');
  await expect(page.getByRole('link', { name: 'Buka aplikasi' }).first()).toHaveAttribute('href', '/app');
  await page.goto('/zh/loan-calculator');
  await expect(page.getByLabel('贷款金额（RM）')).toBeVisible();
  const chinese = page.getByRole('navigation', { name: '页脚' });
  await expect(chinese.getByRole('link', { name: '账单计算器' })).toHaveAttribute('href', '/zh/bill-calculator');
  await expect(chinese.getByRole('link', { name: '看懂收据' })).toHaveAttribute('href', '/zh/how-to-read-a-malaysian-receipt');
});

test('articles show their tables and link on to the calculators, in the same language', async ({ page }) => {
  await page.goto('/sst-vs-service-charge');
  await expect(page.getByRole('region', { name: /real bill/i }).getByRole('table')).toBeVisible();
  await expect(page.getByText('Last checked 26 November 2026')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'bill calculator' }).first().click();
  await expect(page).toHaveURL(/\/bill-calculator$/);
  await page.goto('/ms/sst-vs-service-charge');
  await page.getByRole('main').getByRole('link', { name: 'kalkulator bil' }).first().click();
  await expect(page).toHaveURL(/\/ms\/bill-calculator$/);
  await page.goto('/zh/flat-rate-vs-reducing-balance');
  await page.getByRole('main').getByRole('link', { name: '贷款计算器' }).first().click();
  await expect(page).toHaveURL(/\/zh\/loan-calculator$/);
});

test.describe('the bill calculator', () => {
  test('starts with 10% service charge and 6% SST, and the RM21 meal comes to RM24.35 after the 5-sen rounding', async ({ page }) => {
    await page.goto('/bill-calculator');
    await expect(page.getByLabel('Service charge (%)')).toHaveValue('10');
    await expect(page.getByLabel('SST (%)')).toHaveValue('6');
    await expect(page.getByTestId('bill-total')).toHaveText('RM 24.35');
    await expect(page.getByTestId('bill-rounding')).toHaveText('− RM 0.01');
  });

  test('only a number pad is accepted: letters, signs and extra dots never get in, and phones show the number keypad', async ({ page }) => {
    await page.goto('/bill-calculator');
    const food = page.getByLabel('Food and drink total (RM)');
    await expect(food).toHaveAttribute('inputmode', 'decimal');
    await expect(page.getByLabel('Service charge (%)')).toHaveAttribute('inputmode', 'decimal');
    await expect(page.getByLabel('Number of people')).toHaveAttribute('inputmode', 'numeric');
    await food.fill('12abc.5.7-');
    await expect(food).toHaveValue('12.57');
    await page.getByLabel('Number of people').fill('3.5 pax');
    await expect(page.getByLabel('Number of people')).toHaveValue('35');
  });

  test('a shop that charges neither: type 0, and the total is just the food, rounded', async ({ page }) => {
    await page.goto('/bill-calculator');
    await page.getByLabel('Food and drink total (RM)').fill('21.03');
    await page.getByLabel('Service charge (%)').fill('0');
    await page.getByLabel('SST (%)').fill('0');
    await expect(page.getByTestId('bill-total')).toHaveText('RM 21.05');
    await expect(page.getByTestId('bill-rounding')).toHaveText('+ RM 0.02');
  });

  test('the boxes change the sum: SST on the service charge too, and rounding switched off', async ({ page }) => {
    await page.goto('/bill-calculator');
    await page.getByLabel('Charge SST on the service charge too (some bills do)').check();
    await expect(page.getByTestId('bill-total')).toHaveText('RM 24.50'); // RM24.49 rounds up
    await page.getByLabel('Round the total to the nearest 5 sen').uncheck();
    await expect(page.getByTestId('bill-total')).toHaveText('RM 24.49');
    await expect(page.getByTestId('bill-rounding')).toHaveCount(0);
  });

  test('splitting between people adds up exactly, and says who pays the extra sen', async ({ page }) => {
    await page.goto('/bill-calculator');
    await page.getByLabel('Number of people').fill('4');
    await expect(page.getByTestId('bill-each')).toContainText('RM 6.08');
    await expect(page.getByTestId('bill-each')).toContainText('3 of you pay RM 6.09');
    await page.getByLabel('Number of people').fill('5');
    await expect(page.getByTestId('bill-each')).toContainText('RM 4.87'); // 24.35 / 5 divides exactly
    await expect(page.getByTestId('bill-each')).not.toContainText('of you pay');
  });

  test('an empty bill shows a dash and a hint, not a zero', async ({ page }) => {
    await page.goto('/bill-calculator');
    await page.getByLabel('Food and drink total (RM)').fill('');
    await expect(page.getByTestId('bill-total')).toHaveText('–');
    await expect(page.getByText('Type the food and drink total from your bill.')).toBeVisible();
  });

  test('works in Malay and Chinese with the same answers', async ({ page }) => {
    await page.goto('/ms/bill-calculator');
    await expect(page.getByLabel('Jumlah makanan dan minuman (RM)')).toHaveValue('21');
    await expect(page.getByTestId('bill-total')).toHaveText('RM 24.35');
    await page.getByLabel('Bilangan orang').fill('4');
    await expect(page.getByTestId('bill-each')).toContainText('3 orang bayar RM 6.09');
    await page.goto('/zh/bill-calculator');
    await expect(page.getByLabel('饮食合计（RM）')).toHaveValue('21');
    await expect(page.getByTestId('bill-total')).toHaveText('RM 24.35');
    await page.getByLabel('人数').fill('4');
    await expect(page.getByTestId('bill-each')).toContainText('其中 3 人付 RM 6.09');
  });
});

test('the welcome page leads to all three calculators and the four guides', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('#calculators');
  await expect(section.getByRole('link', { name: /Bill calculator/ })).toHaveAttribute('href', '/bill-calculator');
  for (const slug of ARTICLES) await expect(section.locator(`a[href="/${slug}"]`)).toHaveCount(1);
});

test('the sitemap and robots.txt list every guide in every language', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const robots = await (await request.get('/robots.txt')).text();
  for (const lang of LANGS) {
    for (const slug of ALL_SLUGS) {
      expect(sitemap, pathFor(lang, slug)).toContain(`<loc>http://127.0.0.1:4173${pathFor(lang, slug)}</loc>`);
      expect(robots, pathFor(lang, slug)).toContain(`Allow: ${pathFor(lang, slug)}$`);
    }
  }
});

for (const lang of LANGS) {
  test(`every ${lang} guide passes the accessibility scan (light and dark) and fits a 320px phone`, async ({ browser }) => {
    test.setTimeout(240_000);
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 320, height: 640 } });
      const page = await context.newPage();
      for (const slug of ALL_SLUGS) {
        const path = pathFor(lang, slug);
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${path} sideways scroll`).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${path} ${scheme}`).toEqual([]);
      }
      await context.close();
    }
  });
}

/** Width and height of a JPEG, read from its header. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return { width: 0, height: 0 };
    const marker = bytes[at + 1] as number;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return { width: 0, height: 0 };
}

test('every page has its own 1200 x 630 share picture, in its own language, and the picture is light enough for a chat app', async ({ request }) => {
  for (const lang of LANGS) {
    for (const slug of ALL_SLUGS) {
      const html = await (await request.get(pathFor(lang, slug))).text();
      const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(image, `${lang} ${slug}`).toContain(`/share/${lang}/${slug}.jpg`);
      expect(html, `${lang} ${slug} twitter`).toContain(`<meta name="twitter:image" content="${image}"`);
      const picture = await request.get(image);
      expect(picture.status(), image).toBe(200);
      expect(picture.headers()['content-type'], image).toContain('image/jpeg');
      const bytes = await picture.body();
      expect(bytes.length, `${image} size`).toBeLessThan(150_000);
      expect(jpegSize(bytes), image).toEqual({ width: 1200, height: 630 });
    }
  }
  const welcome = await (await request.get('/')).text();
  expect(welcome).toContain('/share/en/welcome.jpg');
});
