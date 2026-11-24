import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { resetSheets } from '@/components/sheetStack';
import { loadLang } from '@/lib/i18n';

// screens are loaded in pieces, so a slow machine may need a little longer than one second to draw them
configure({ asyncUtilTimeout: 5000 });

// Malay and Chinese are fetched on demand in the app; tests that use them need them ready
await loadLang('ms');
await loadLang('zh');

// jsdom has no matchMedia or inert reflection; small stand-ins keep component tests honest
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  resetSheets();
  if (typeof document !== 'undefined') document.body.className = '';
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
