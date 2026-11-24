/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { buildCsp, headersFile, TELEGRAM_ORIGINS } from './scripts/headers.mts';
import { cleanSiteUrl, robotsTxt, seoTags, sitemapXml } from './scripts/seo.mts';

/** In production the policy is also written into the page, so hosts that cannot send headers are still protected. */
function cspPlugin(supabaseUrl: string, turnstile: boolean): Plugin {
  return {
    name: 'vinexpenses-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<!-- CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="${buildCsp(supabaseUrl, turnstile, true)}" />`,
        ),
    },
  };
}

/** robots.txt, sitemap.xml and the social-preview tags. Set VITE_SITE_URL to the public address to get absolute links in them. */
function seoPlugin(siteUrl: string): Plugin {
  return {
    name: 'vinexpenses-seo',
    apply: 'build',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<!-- SEO -->', seoTags(siteUrl)) },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(siteUrl) });
      if (siteUrl) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(siteUrl, new Date().toISOString().slice(0, 10)) });
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const turnstile = Boolean(env.VITE_TURNSTILE_SITE_KEY);
  return {
    plugins: [
      react(),
      cspPlugin(env.VITE_SUPABASE_URL ?? '', turnstile),
      seoPlugin(cleanSiteUrl(env.VITE_SITE_URL)),
      headersPlugin(buildCsp(env.VITE_SUPABASE_URL ?? '', turnstile), buildCsp(env.VITE_SUPABASE_URL ?? '', false, false, TELEGRAM_ORIGINS)),
      VitePWA({
        // The page registers the worker itself (no inline script), see src/app/pwa.ts
        injectRegister: false,
        registerType: 'prompt',
        manifest: {
          name: 'VinExpenses',
          short_name: 'VinExpenses',
          description: 'A simple, private expense tracker.',
          start_url: '/app/',
          scope: '/',
          display: 'standalone',
          background_color: '#f5f6fa',
          theme_color: '#4f46e5',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Only the app shell is cached. Calls to Supabase and the functions are never stored.
          globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
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
    },
  };
});
