// AN-01: analytics is off unless an ID is set, asks first, never loads before a Yes, respects "do not track", and keeps ad features off.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function mount(id: string | undefined, path = '/privacy') {
  vi.resetModules();
  if (id === undefined) vi.stubEnv('VITE_GA_ID', '');
  else vi.stubEnv('VITE_GA_ID', id);
  const { AnalyticsConsent } = await import('./AnalyticsConsent');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AnalyticsConsent />
    </MemoryRouter>,
  );
}
const gaScripts = () => document.head.querySelectorAll('script[src*="googletagmanager"]');

describe('analytics consent', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.querySelectorAll('script[src*="googletagmanager"]').forEach((el) => el.remove());
    delete (window as unknown as { dataLayer?: unknown }).dataLayer;
    delete (window as unknown as { gtag?: unknown }).gtag;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  });

  it('shows nothing and loads nothing when no measurement ID is set', async () => {
    await mount(undefined);
    expect(screen.queryByTestId('analytics-consent')).toBeNull();
    expect(gaScripts()).toHaveLength(0);
  });

  it('ignores an ID that does not look like one', async () => {
    await mount('not-an-id');
    expect(screen.queryByTestId('analytics-consent')).toBeNull();
    expect(gaScripts()).toHaveLength(0);
  });

  it('asks first and loads nothing until the answer is yes', async () => {
    await mount('G-ABCDEF1234');
    expect(screen.getByTestId('analytics-consent')).toBeInTheDocument();
    expect(gaScripts()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, that is fine' }));
    expect(screen.queryByTestId('analytics-consent')).toBeNull();
    const scripts = gaScripts();
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234');
    expect(localStorage.getItem('ve_analytics')).toBe('yes');
    // ad features are off, the page view is sent by hand, and the visit to this page is counted once
    const queue = (window as unknown as { dataLayer: IArguments[] }).dataLayer.map((entry) => Array.from(entry));
    const config = queue.find((entry) => entry[0] === 'config') as unknown[];
    expect(config[1]).toBe('G-ABCDEF1234');
    expect(config[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    expect(queue.filter((entry) => entry[0] === 'event' && entry[1] === 'page_view')).toHaveLength(1);
  });

  it('No thanks loads nothing, is remembered, and is not asked again', async () => {
    const first = await mount('G-ABCDEF1234');
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(gaScripts()).toHaveLength(0);
    expect(localStorage.getItem('ve_analytics')).toBe('no');
    first.unmount();
    await mount('G-ABCDEF1234');
    expect(screen.queryByTestId('analytics-consent')).toBeNull();
    expect(gaScripts()).toHaveLength(0);
  });

  it('a remembered Yes loads it straight away, without asking', async () => {
    localStorage.setItem('ve_analytics', 'yes');
    await mount('G-ABCDEF1234');
    expect(screen.queryByTestId('analytics-consent')).toBeNull();
    expect(gaScripts()).toHaveLength(1);
  });

  it('the browser do-not-track signal means no question and no loading, even after an earlier yes', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    localStorage.setItem('ve_analytics', 'yes');
    await mount('G-ABCDEF1234');
    expect(screen.queryByTestId('analytics-consent')).toBeNull();
    expect(gaScripts()).toHaveLength(0);
  });
});
