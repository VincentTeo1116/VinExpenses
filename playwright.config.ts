import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 0,
  timeout: 60_000, // the long walk-throughs visit many screens
  expect: { timeout: 10_000 }, // several suites run side by side, so a screen may take a moment to draw
  reporter: [['list']],
  outputDir: 'test-results',
  // Reduced motion keeps measurements steady (no element is mid-animation) and also proves the setting is respected
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'off', screenshot: 'off', reducedMotion: 'reduce' },
  // The test build (npm run build:e2e) is served like Cloudflare Pages would serve it: _redirects, _headers and a real 404
  webServer: [
    { command: `node scripts/serve-dist.mjs dist-e2e ${PORT}`, url: `http://127.0.0.1:${PORT}/app`, reuseExistingServer: false, timeout: 60_000 },
    // a local stand-in for Supabase (Auth, auth-gate, feedback); see scripts/fake-backend.mjs
    { command: 'node scripts/fake-backend.mjs 54321', url: 'http://127.0.0.1:54321/__test/health', reuseExistingServer: false, timeout: 30_000 },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
