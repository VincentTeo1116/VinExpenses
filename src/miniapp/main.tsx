// The Telegram Mini App entry: the same design tokens, components and language text as the web app, a different front door.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/lib/i18n';
import { MiniApp } from './MiniApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <I18nProvider>
        <ToastProvider>
          <MiniApp />
        </ToastProvider>
      </I18nProvider>
    </StrictMode>,
  );
}
