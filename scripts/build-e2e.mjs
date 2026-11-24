// Builds the app for the end-to-end tests with fake, local-only settings. No real project or key is ever used in tests.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const vite = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

const result = spawnSync(process.execPath, [vite, 'build', '--outDir', 'dist-e2e', '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'e2e-anon-key-for-tests-only-0000000', VITE_SITE_URL: 'http://127.0.0.1:4173' },
});
process.exit(result.status ?? 1);
