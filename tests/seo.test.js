// Search engines may list the welcome, privacy and terms pages and must not list the app. Checks the generators and the built files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'seo.mts')).href);
const dist = path.join(__dirname, '..', 'dist-e2e');
const built = fs.existsSync(path.join(dist, 'index.html'));

test('only a plain web address is accepted as the site address', async () => {
    const { cleanSiteUrl } = await load();
    assert.equal(cleanSiteUrl('https://vin.pages.dev/'), 'https://vin.pages.dev');
    assert.equal(cleanSiteUrl('https://vin.pages.dev/some/path?x=1'), 'https://vin.pages.dev');
    for (const bad of ['', undefined, 'javascript:alert(1)', 'not a url', 'ftp://x.com']) assert.equal(cleanSiteUrl(bad), '', String(bad));
});

test('robots.txt allows the public pages, keeps the private ones out, and names the sitemap only when the address is known', async () => {
    const { robotsTxt } = await load();
    const withSite = robotsTxt('https://vin.pages.dev');
    for (const line of ['Allow: /$', 'Allow: /privacy$', 'Allow: /terms$', 'Disallow: /app/', 'Disallow: /auth', 'Disallow: /miniapp/', 'Disallow: /email-action.html', 'Sitemap: https://vin.pages.dev/sitemap.xml']) assert.ok(withSite.includes(line), line);
    assert.ok(!robotsTxt('').includes('Sitemap:'));
});

test('the sitemap lists exactly the public pages', async () => {
    const { sitemapXml } = await load();
    const xml = sitemapXml('https://vin.pages.dev', '2026-11-24');
    assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]), ['https://vin.pages.dev/', 'https://vin.pages.dev/privacy', 'https://vin.pages.dev/terms']);
    assert.ok(!/\/app|\/auth/.test(xml));
});

test('social tags are escaped, and absolute links appear only with a known address', async () => {
    const { seoTags } = await load();
    assert.ok(!/og:image/.test(seoTags('')));
    assert.match(seoTags('https://vin.pages.dev'), /og:image" content="https:\/\/vin\.pages\.dev\/landing\/dashboard-light\.webp"/);
});

const opts = { skip: built ? false : 'no build found (run npm run build:e2e)' };

test('the built page shell does not say "noindex" (the app is kept out by a header instead), and carries the social tags', opts, () => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    assert.ok(!/name="robots"/i.test(html), 'a noindex tag in the shell would stop the welcome page being listed');
    assert.match(html, /property="og:title"/);
    assert.match(html, /rel="canonical"/);
});

test('the headers file keeps the app, sign-in, Mini App and email page out of search results, and not the public pages', opts, () => {
    const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
    for (const pattern of ['/app', '/app/*', '/auth', '/auth/*', '/email-action.html', '/miniapp/*']) {
        const block = headers.split(/\n(?=\/)/).find((b) => b.split('\n')[0].trim() === pattern);
        assert.ok(block && /X-Robots-Tag: noindex/.test(block), `${pattern} has no noindex header`);
    }
    for (const pattern of ['/privacy', '/terms', '/']) assert.ok(!headers.split(/\n(?=\/)/).some((b) => b.split('\n')[0].trim() === pattern && /noindex/.test(b)), `${pattern} must stay listable`);
});

test('the built robots.txt and sitemap exist', opts, () => {
    assert.match(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8'), /Disallow: \/app\//);
    assert.match(fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8'), /<loc>http:\/\/127\.0\.0\.1:4173\/privacy<\/loc>/);
});

test('every app address also exists as a real copy of the page, so hosts without rewrite rules (Workers assets) answer them', opts, () => {
    const index = fs.readFileSync(path.join(dist, 'index.html'));
    const paths = ['app', 'app/history', 'app/plan', 'app/account', 'app/admin', 'app/report', 'auth', 'auth/setup', 'welcome', 'privacy', 'terms'];
    for (const p of paths) assert.ok(fs.readFileSync(path.join(dist, `${p}.html`)).equals(index), `${p}.html`);
    assert.ok(!fs.existsSync(path.join(dist, 'nothing-here.html')));
    assert.ok(fs.existsSync(path.join(dist, '404.html')));
});
