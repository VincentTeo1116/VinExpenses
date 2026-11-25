// SEC-01, SEC-02, SEC-04: rules that must stay true for the source and for the headers the build writes.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildCsp, headersFile } from '../../scripts/headers.mts';

const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const sourceFiles = walk(join(root, 'src')).filter((file) => /\.(ts|tsx|css)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file));
const text = (file: string) => readFileSync(file, 'utf8');

describe('source code rules (SEC-04)', () => {
  it('has files to check', () => expect(sourceFiles.length).toBeGreaterThan(20));

  it('never builds HTML or code from text', () => {
    for (const file of sourceFiles.filter((f) => /\.(ts|tsx)$/.test(f))) {
      const code = text(file);
      const where = relative(root, file);
      expect(code, where).not.toMatch(/dangerouslySetInnerHTML/);
      expect(code, where).not.toMatch(/\.(innerHTML|outerHTML)\s*=/);
      expect(code, where).not.toMatch(/insertAdjacentHTML|document\.write/);
      expect(code, where).not.toMatch(/\beval\s*\(|new Function\s*\(/);
      expect(code, where).not.toMatch(/javascript:/i);
    }
  });

  it('has no inline style attributes (the policy would block them)', () => {
    for (const file of sourceFiles.filter((f) => f.endsWith('.tsx'))) expect(text(file), relative(root, file)).not.toMatch(/\sstyle=\{/);
  });

  it('never mentions a private key, token or service-role name', () => {
    for (const file of sourceFiles) {
      expect(text(file), relative(root, file)).not.toMatch(/service_role|SERVICE_ROLE|sbp_[A-Za-z0-9]{10,}|SMTP_PASS|TURNSTILE_SECRET|BOT_TOKEN/);
    }
  });

  it('keeps the session only in Supabase storage: no token is written by the app', () => {
    for (const file of sourceFiles.filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(text(file), relative(root, file)).not.toMatch(/localStorage\.setItem\([^)]*(token|password|secret|code)/i);
    }
  });
});

describe('Google Analytics in the policy (AN-01)', () => {
  const base = buildCsp('https://abcd.supabase.co', true);
  const withGa = buildCsp('https://abcd.supabase.co', true, false, [], true, true);

  it('is absent from the normal policy, so the signed-in app never allows it', () => {
    expect(base).not.toMatch(/google|gtag/i);
    expect(headersFile(base)).not.toMatch(/googletagmanager|google-analytics/);
  });

  it('is added to scripts, connections and images only when asked, and nothing else loosens', () => {
    expect(withGa).toContain("script-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com");
    expect(withGa).toMatch(/connect-src [^;]*https:\/\/\*\.google-analytics\.com/);
    expect(withGa).toMatch(/img-src 'self' data: blob: https:\/\/www\.googletagmanager\.com/);
    expect(withGa).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(withGa).toContain("default-src 'none'");
  });

  it('the headers give it to the four public pages only, and the stricter rule stays everywhere else', () => {
    const file = headersFile(base, '', withGa);
    const [everywhere, rest] = file.split(/^\/miniapp\/\*/m);
    expect(everywhere).toContain(`Content-Security-Policy: ${base}`);
    for (const page of ['/', '/index', '/index/', '/index.html', '/welcome', '/privacy', '/terms']) {
      expect(everywhere).toMatch(new RegExp(`^${page}\\n  ! Content-Security-Policy\\n  Content-Security-Policy: .*googletagmanager`, 'm'));
    }
    for (const page of ['/app', '/auth']) expect(everywhere).not.toMatch(new RegExp(`^${page}\\n  ! Content-Security-Policy`, 'm'));
    expect(rest ?? '').not.toMatch(/googletagmanager/);
  });
});

describe('Content-Security-Policy (SEC-01)', () => {
  const csp = buildCsp('https://abcd.supabase.co', false);
  const directive = (name: string) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);

  it('blocks everything by default and allows only this site for scripts and styles', () => {
    expect(directive('default-src')).toEqual(["'none'"]);
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(directive('style-src')).toEqual(["'self'"]);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|\*(?!\.)/);
  });

  it('the policy written into the page leaves out frame-ancestors (browsers ignore it there); the headers keep it', () => {
    expect(buildCsp('https://abcd.supabase.co', false, true)).not.toContain('frame-ancestors');
    expect(buildCsp('https://abcd.supabase.co', false)).toContain("frame-ancestors 'none'");
    expect(headersFile(buildCsp('https://abcd.supabase.co', false))).toContain("frame-ancestors 'none'");
  });

  it('talks only to this site and the one Supabase project (no wildcard)', () => {
    expect(directive('connect-src')).toEqual(["'self'", 'https://abcd.supabase.co']);
  });

  it('the website (not the Mini App) may also ask the two map services for places near the person, and nothing else', () => {
    const withMaps = (value: string) => (new RegExp('connect-src ([^;]+)').exec(value)?.[1] ?? '').split(' ');
    expect(withMaps(buildCsp('https://abcd.supabase.co', false, false, [], true))).toEqual(["'self'", 'https://abcd.supabase.co', 'https://photon.komoot.io', 'https://overpass-api.de']);
    expect(buildCsp('https://abcd.supabase.co', false, false, ['https://web.telegram.org'])).not.toMatch(/photon|overpass/);
  });

  it('cannot be framed, has no plugins, and no base or form targets', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'none'"]);
    expect(directive('form-action')).toEqual(["'none'"]);
    expect(directive('frame-src')).toEqual(["'none'"]);
  });

  it('adds Turnstile only when it is switched on, for scripts and frames only', () => {
    const on = buildCsp('https://abcd.supabase.co', true);
    expect(on).toContain('script-src \'self\' https://challenges.cloudflare.com');
    expect(on).toContain('frame-src https://challenges.cloudflare.com');
    expect(csp).not.toContain('cloudflare');
  });

  it('an invalid Supabase address is dropped instead of being written into the policy', () => {
    expect(buildCsp('javascript:alert(1)', false)).toContain("connect-src 'self'");
    expect(buildCsp('javascript:alert(1)', false)).not.toContain('javascript');
    expect(buildCsp('', false)).toContain("connect-src 'self'");
  });
});

describe('security headers file', () => {
  const file = headersFile(buildCsp('https://abcd.supabase.co', false));
  it('sends the full set to every page', () => {
    for (const header of ['Content-Security-Policy', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security', 'Cross-Origin-Opener-Policy: same-origin']) {
      expect(file).toContain(header);
    }
  });
  it('caches built assets for a year but never the page or the service worker', () => {
    expect(file).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    expect(file).toMatch(/\/index\.html\n\s+Cache-Control: no-cache/);
    expect(file).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache/);
  });
});

describe('static host routing (PU-03)', () => {
  it('has no rewrite rules: on Cloudflare a rewrite to /index.html becomes a redirect to / (a refresh on /app landed on the home page)', () => {
    // The app addresses are real files made by the build (see appPagesPlugin in vite.config.mts), so the host needs no _redirects.
    expect(existsSync(join(root, 'public/_redirects'))).toBe(false);
  });

  it('the build writes one page for each app address, and the host answers anything else with the real 404', async () => {
    const { APP_PATHS } = await import('../app/paths');
    const config = readFileSync(join(root, 'vite.config.mts'), 'utf8');
    expect(config).toContain("APP_PATHS.map((p) => `${p.replace(/\\.html$/, '')}.html`");
    expect(config).not.toMatch(/_redirects/);
    expect(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')).toMatch(/"not_found_handling":\s*"404-page"/);
    expect(APP_PATHS).toContain('/app/history'); // a deep address is one of the pages the build writes
  });
});

describe('public pages (PU-02)', () => {
  const sources = ['WelcomePage.tsx', 'PrivacyPage.tsx', 'TermsPage.tsx', 'LegalPage.tsx', 'PublicLayout.tsx', 'QuickCalc.tsx', 'motion.tsx'];
  it('draw their text through React only: no raw HTML, no forms, no inline styles, no outside addresses', () => {
    for (const file of sources) {
      const code = readFileSync(join(root, 'src/features/public', file), 'utf8');
      expect(code, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|<form|<iframe|style=\{/);
      expect(code, file).not.toMatch(/(src|href)=["'](https?:)?\/\//i);
    }
  });
  it('the static 404 page has no inline code and no outside requests', () => {
    const html = readFileSync(join(root, 'public/404.html'), 'utf8');
    expect(html).not.toMatch(/\son[a-z]+\s*=|\sstyle=|<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/i);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="(https?:)?\/\//i);
  });
  it('the privacy policy names the host that really serves the site, and no feature that was not rebuilt', () => {
    const text = readFileSync(join(root, 'src/features/public/PrivacyPage.tsx'), 'utf8');
    // Cloudflare serves the app; the previous GitHub Pages address only sends visitors on to it (and so sees their IP address)
    expect(text).toContain('Cloudflare (website hosting)');
    expect(text).toContain('GitHub Pages (the app&apos;s previous address)');
    // the policy names the map service the Nearby lookup uses, and still must not name features that do not exist
    expect(text).toMatch(/OpenStreetMap/);
    expect(text).toMatch(/Find places near me/);
    expect(text).not.toMatch(/Gemini/);
  });
});
