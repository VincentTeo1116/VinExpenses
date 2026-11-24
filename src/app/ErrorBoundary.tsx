// PF-04: a crash in one screen shows a calm message and a way out, never a blank page. No details are shown to the user.
import { Component, type ReactNode } from 'react';
import { translate, LANG_STORAGE_KEY, isLang, type Lang } from '@/lib/i18n';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';

interface Props {
  children: ReactNode;
  /** Changing this value (for example the route) clears an error, so moving to another screen recovers. */
  resetKey?: string;
}
interface State {
  failed: boolean;
}

function currentLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override componentDidCatch(error: Error) {
    // Nothing is sent anywhere: errors can contain personal data. The browser console keeps the detail for the developer.
    if (import.meta.env.DEV) console.error(error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    const lang = currentLang();
    return (
      <EmptyState
        icon="alert"
        title={translate(lang, 'error.title')}
        action={
          <Button onClick={() => this.setState({ failed: false })}>{translate(lang, 'common.retry')}</Button>
        }
      >
        {translate(lang, 'error.body')}
      </EmptyState>
    );
  }
}
