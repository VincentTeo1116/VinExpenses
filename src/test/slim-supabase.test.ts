// The production build swaps the realtime and file-storage libraries inside supabase-js for tiny stand-ins (slimSupabasePlugin in
// vite.config.mts). These tests read the INSTALLED supabase-js and fail if it starts using something the stand-ins do not have,
// so a library upgrade cannot quietly break sign-in or the token refresh.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as realtime from '@/lib/stubs/realtime';
import * as storage from '@/lib/stubs/storage';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'node_modules/@supabase/supabase-js/dist/index.mjs'), 'utf8');
const importedFrom = (pkg: string): string[] => {
  const found = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*"${pkg}"`).exec(source)?.[1] ?? '';
  return found.split(',').map((name) => name.trim().split(/\s+as\s+/)[0] ?? '').filter(Boolean);
};

describe('the stand-ins for the unused supabase-js libraries', () => {
  it('supabase-js only takes RealtimeClient from the realtime library, and the stand-in has it', () => {
    expect(importedFrom('@supabase/realtime-js')).toEqual(['RealtimeClient']);
    expect(typeof realtime.RealtimeClient).toBe('function');
  });

  it('every method supabase-js calls on its realtime client exists on the stand-in', () => {
    const used = new Set([...source.matchAll(/this\.realtime\.(\w+)\(/g)].map((match) => match[1] as string));
    expect(used.size).toBeGreaterThan(0);
    const client = new realtime.RealtimeClient();
    for (const method of used) expect(typeof (client as unknown as Record<string, unknown>)[method], `RealtimeClient.${method}`).toBe('function');
  });

  it('the token and the cleanup calls supabase-js makes on its own are harmless', async () => {
    const client = new realtime.RealtimeClient();
    expect(() => client.setAuth()).not.toThrow();
    expect(client.getChannels()).toEqual([]);
    await expect(client.removeAllChannels()).resolves.toEqual([]);
    expect(() => client.channel()).toThrow(/not included/); // using realtime fails loudly instead of doing nothing
  });

  it('supabase-js only takes StorageApiError and StorageClient from the storage library, and the stand-in has both', () => {
    expect(importedFrom('@supabase/storage-js').sort()).toEqual(['StorageApiError', 'StorageClient']);
    expect(typeof storage.StorageClient).toBe('function');
    expect(new storage.StorageApiError('x')).toBeInstanceOf(Error);
    expect(() => new storage.StorageClient().from()).toThrow(/not included/);
  });

  it('nothing in the app uses realtime channels or file storage', () => {
    const files = ['src/lib/supabase.ts', 'src/lib/api.ts', 'src/features/money/data.ts', 'src/app/AuthProvider.tsx', 'src/features/account/useServer.ts'];
    for (const file of files) expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/\.channel\(|\.storage\b|removeChannel|\.realtime\b/);
  });
});
