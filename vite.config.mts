/// <reference types="vitest/config" />
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { buildCsp, headersFile, TELEGRAM_ORIGINS } from './scripts/headers.mts';
import { cleanSiteUrl, robotsTxt, seoTags, sitemapXml } from './scripts/seo.mts';
import { guidePages } from './scripts/guide-pages.mts';
import { ALL_SLUGS } from './src/features/guides/registry';
import { APP_PATHS } from './src/app/paths';

/**
 * supabase-js builds a realtime client and a file-storage client for every project, used or not, which put about 85 KB of code
 * (roughly 20 KB compressed) into every first download. This app uses neither, so the production build swaps both libraries for
 * tiny stand-ins (src/lib/stubs) that fail loudly if anything ever calls them. Development and tests use the real libraries.
 * src/test/slim-supabase.test.ts checks the stand-ins against what the installed supabase-js really calls.
 */
function slimSupabasePlugin(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const stubs: Record<string, string> = {
    '@supabase/realtime-js': resolve(here, 'src/lib/stubs/realtime.ts'),
    '@supabase/storage-js': resolve(here, 'src/lib/stubs/storage.ts'),
  };
  return {
    name: 'vinexpenses-slim-supabase',
    apply: 'build',
    enforce: 'pre',
    resolveId: (source) => stubs[source] ?? null,
  };
}

/** In production the policy is also written into the page, so hosts that cannot send headers are still protected. */
function cspPlugin(supabaseUrl: string, turnstile: boolean, analytics: boolean): Plugin {
  return {
    name: 'vinexpenses-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<!-- CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="${buildCsp(supabaseUrl, turnstile, true, [], true, analytics)}" />`,
        ),
    },
  };
}

/** robots.txt, sitemap.xml and the social-preview tags. Set VITE_SITE_URL to the public address to get absolute links in them. */
function seoPlugin(siteUrl: string): Plugin {
  return {
    name: 'vinexpenses-seo',
    apply: 'build',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<!-- SEO -->', seoTags(siteUrl, existsSync(resolve('public/share/en/welcome.jpg')) ? '/share/en/welcome.jpg' : undefined)) },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(siteUrl) });
      if (siteUrl) {
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(siteUrl, new Date().toISOString().slice(0, 10)) });
      }
    },
  };
}

/** A real copy of the page for every app address, so hosts without rewrite rules (Cloudflare Workers assets) still answer them. */
function appPagesPlugin(siteUrl: string): Plugin {
  return {
    name: 'vinexpenses-app-pages',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir ?? 'dist';
      const shell = readFileSync(join(dir, 'index.html'));
      for (const path of new Set(APP_PATHS.map((p) => `${p.replace(/\.html$/, '')}.html`.slice(1)))) {
        const file = join(dir, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, shell);
      }
      // privacy and terms are listed in the sitemap, so their own HTML must name their own address as canonical (the home page copy says "/")
      if (siteUrl) {
        for (const slug of ['privacy', 'terms']) {
          const own = shell
            .toString('utf8')
            .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${siteUrl}/${slug}" />`)
            .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${siteUrl}/${slug}" />`);
          writeFileSync(join(dir, `${slug}.html`), own);
        }
      }
      // the public guides, in every language, get their own title, address, language tags, share image and readable text in the HTML itself
      const shareImage = (lang: string, slug: string) => (existsSync(resolve('public/share', lang, `${slug}.jpg`)) ? `/share/${lang}/${slug}.jpg` : undefined);
      for (const page of guidePages(shell.toString('utf8'), siteUrl, resolve('src/content/articles'), shareImage)) {
        mkdirSync(dirname(join(dir, page.file)), { recursive: true });
        writeFileSync(join(dir, page.file), page.html);
      }
    },
  };
}

function headersPlugin(csp: string, miniCsp: string): Plugin {
  return {
    name: 'vinexpenses-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(csp, miniCsp) });
    },
  };
}

/**
 * The on-device receipt reader (Tesseract, English only) is served from this site's own /ocr folder, never from another host. Its files are
 * copied from node_modules when the site is built (and served from there while developing). They are large, so they are NOT part of the offline
 * cache: they are downloaded only when someone's photo cannot be read online (see src/features/receipts/localOcr.ts).
 */
const OCR_FILES: [string, string][] = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // the core that tesseract.js itself depends on (it picks the best of these three for the phone)
  ['tesseract.js/node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js/node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
function ocrAssetsPlugin(): Plugin {
  const source = (name: string) => resolve('node_modules', name);
  return {
    name: 'vinexpenses-local-ocr',
    configureServer(server) {
      server.middlewares.use('/ocr', (request, response, next) => {
        const file = OCR_FILES.find(([, served]) => request.url?.split('?')[0] === `/${served}`);
        if (!file || !existsSync(source(file[0]))) return next();
        response.setHeader('Content-Type', file[1].endsWith('.gz') ? 'application/gzip' : 'text/javascript');
        response.end(readFileSync(source(file[0])));
      });
    },
    generateBundle() {
      for (const [from, to] of OCR_FILES) {
        if (existsSync(source(from))) this.emitFile({ type: 'asset', fileName: `ocr/${to}`, source: readFileSync(source(from)) });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const turnstile = Boolean(env.VITE_TURNSTILE_SITE_KEY);
  // Google Analytics only when a measurement ID is given at build time (the tests and local builds leave it out)
  const analytics = /^G-[A-Z0-9]{6,14}$/.test(env.VITE_GA_ID ?? '');
  return {
    plugins: [
      react(),
      slimSupabasePlugin(),
      cspPlugin(env.VITE_SUPABASE_URL ?? '', turnstile, analytics),
      seoPlugin(cleanSiteUrl(env.VITE_SITE_URL)),
      appPagesPlugin(cleanSiteUrl(env.VITE_SITE_URL)),
      ocrAssetsPlugin(),
      headersPlugin(buildCsp(env.VITE_SUPABASE_URL ?? '', turnstile, false, [], true, analytics), buildCsp(env.VITE_SUPABASE_URL ?? '', false, false, TELEGRAM_ORIGINS)),
      VitePWA({
        // The page registers the worker itself (no inline script), see src/app/pwa.ts
        injectRegister: false,
        registerType: 'prompt',
        manifest: {
          name: 'ManaDuit',
          short_name: 'ManaDuit',
          description: 'A simple, private expense tracker.',
          start_url: '/app/',
          scope: '/',
          display: 'standalone',
          background_color: '#f5f6fa',
          theme_color: '#4f46e5',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Only the app shell is cached. Calls to Supabase and the functions are never stored.
          globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
          // the on-device reader is several MB: fetched only when needed, never pre-cached; the public guide pages are read online, not from the app's offline copy
          globIgnores: ['ocr/**', 'ms/**', 'zh/**', ...ALL_SLUGS.map((slug) => `${slug}.html`)],
          navigateFallback: '/index.html',
          navigateFallbackAllowlist: [/^\/app(\/|$)/, /^\/auth(\/|$)/],
          cleanupOutdatedCaches: true,
          runtimeCaching: [],
        },
      }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      target: 'es2022',
      sourcemap: false,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 220,
      // the app, the small page behind the links in our emails, and the Telegram Mini App
      rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), 'email-action': fileURLToPath(new URL('./email-action.html', import.meta.url)), 'miniapp/index': fileURLToPath(new URL('./miniapp/index.html', import.meta.url)) } },
    },
    server: { host: '127.0.0.1', port: 5173 },
    preview: { host: '127.0.0.1', port: 4173 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
      // the screens download their code on first use; on a busy machine (or CI) that can take longer than the 5-second default
      testTimeout: 20_000,
    },
  };
});
