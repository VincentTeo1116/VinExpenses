import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/lib/i18n';
import { Button } from './Button';
import { ToastProvider, useToast } from './Toast';
import { OfflineBanner } from './OfflineBanner';
import { ErrorBoundary } from '@/app/ErrorBoundary';

describe('Button', () => {
  it('is a real button, blocks double clicks while loading, and says it is busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} loading>Save</Button>);
    const busy = screen.getByRole('button', { name: 'Save' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('never submits a form by accident', () => {
    render(<Button>Plain</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});

function Shout({ message }: { message: string }) {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.show('success', message)}>ok</button>
      <button onClick={() => toast.show('error', message)}>bad</button>
    </>
  );
}

describe('Toast', () => {
  it('shows text only, never HTML, and puts errors in an assertive region', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Shout message="<img src=x onerror=alert(1)>" /></ToastProvider>);
    await user.click(screen.getByText('ok'));
    expect(screen.getByRole('status')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
    await user.click(screen.getByText('bad'));
    expect(screen.getByRole('alert')).toHaveTextContent('<img');
  });

  it('shows at most three at once and removes each after a few seconds', async () => {
    vi.useFakeTimers();
    render(<ToastProvider><Shout message="hello" /></ToastProvider>);
    for (let i = 0; i < 5; i += 1) act(() => screen.getByText('ok').click());
    expect(screen.getAllByText('hello')).toHaveLength(3);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('hello')).toBeNull();
    vi.useRealTimers();
  });
});

describe('OfflineBanner', () => {
  it('appears when the browser goes offline and disappears when it returns', () => {
    render(<I18nProvider><OfflineBanner /></I18nProvider>);
    expect(screen.queryByRole('status')).toBeNull();
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    spy.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('secret internal detail');
  return <p>fine</p>;
}

describe('ErrorBoundary (PF-04)', () => {
  it('shows a calm message without technical details, and recovers when the screen changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(<ErrorBoundary resetKey="a"><Boom explode /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret internal detail');
    rerender(<ErrorBoundary resetKey="b"><Boom explode={false} /></ErrorBoundary>);
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('the Try again button re-renders the screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    let explode = true;
    function Later() { return <Boom explode={explode} />; }
    render(<ErrorBoundary><Later /></ErrorBoundary>);
    explode = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});
