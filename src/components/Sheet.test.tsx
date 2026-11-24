import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/lib/i18n';
import { Sheet } from './Sheet';

function Stack() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <div id="root">
      <button onClick={() => setFirst(true)}>open first</button>
      <Sheet open={first} onClose={() => setFirst(false)} title="Account">
        <button onClick={() => setSecond(true)}>open second</button>
        <input aria-label="name" />
      </Sheet>
      <Sheet open={second} onClose={() => setSecond(false)} title="Authenticator">
        <input aria-label="code" data-autofocus />
        <button>confirm</button>
      </Sheet>
    </div>
  );
}

const renderStack = () => render(<I18nProvider><Stack /></I18nProvider>);

describe('Sheet (PF-03)', () => {
  it('opens as a dialog with a title, moves focus inside, and returns focus when closed', async () => {
    const user = userEvent.setup();
    renderStack();
    const opener = screen.getByText('open first');
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Account' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('a second sheet opens ABOVE the first one and is the only one that can be used', async () => {
    const user = userEvent.setup();
    renderStack();
    await user.click(screen.getByText('open first'));
    await user.click(screen.getByText('open second'));
    const first = screen.getByRole('dialog', { name: 'Account', hidden: true });
    const second = screen.getByRole('dialog', { name: 'Authenticator' });
    // later in the page = on top, because both use the same layer
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.parentElement).toHaveAttribute('inert');
    expect(second.parentElement).not.toHaveAttribute('inert');
    expect(second.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveAttribute('aria-label', 'code');
  });

  it('Esc closes only the top sheet; the one below becomes usable again and gets focus back', async () => {
    const user = userEvent.setup();
    renderStack();
    await user.click(screen.getByText('open first'));
    await user.click(screen.getByText('open second'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Authenticator' })).toBeNull();
    const first = screen.getByRole('dialog', { name: 'Account' });
    expect(first.parentElement).not.toHaveAttribute('inert');
    expect(screen.getByText('open second')).toHaveFocus();
  });

  it('keeps Tab inside the dialog, wrapping in both directions', async () => {
    const user = userEvent.setup();
    renderStack();
    await user.click(screen.getByText('open first'));
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const input = screen.getByLabelText('name');
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `tab ${i}`).toBe(true);
    }
    for (let i = 0; i < 8; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement), `shift-tab ${i}`).toBe(true);
    }
    expect([close, input, screen.getByText('open second')]).toContain(document.activeElement ?? close);
  });

  it('makes the page behind inert and locks scrolling while any sheet is open, and undoes it after', async () => {
    const user = userEvent.setup();
    renderStack();
    const root = document.getElementById('root');
    // the test renders into a container, so create the real root element the app uses
    expect(root).not.toBeNull();
    await user.click(screen.getByText('open first'));
    expect(document.body).toHaveClass('scroll-locked');
    expect(root).toHaveAttribute('inert');
    await user.keyboard('{Escape}');
    expect(document.body).not.toHaveClass('scroll-locked');
    expect(root).not.toHaveAttribute('inert');
  });

  it('a tap outside closes a normal sheet, but not one that must be answered', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <Sheet open onClose={onClose} title="Normal">x</Sheet>
      </I18nProvider>,
    );
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement;
    await user.pointer({ keys: '[MouseLeft]', target: overlay });
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    rerender(
      <I18nProvider>
        <Sheet open onClose={onClose} title="Must answer" dismissible={false}>x</Sheet>
      </I18nProvider>,
    );
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('dialog').parentElement as HTMLElement });
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('does not render anything while closed', () => {
    render(<I18nProvider><Sheet open={false} onClose={() => undefined} title="Hidden">x</Sheet></I18nProvider>);
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});
