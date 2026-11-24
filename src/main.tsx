import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { App } from '@/app/App';
import { registerServiceWorker } from '@/app/pwa';

// SEC: clickjacking guard. The headers already forbid framing; this covers hosts that cannot send them.
// A page inside another site shows nothing but a short notice and never renders the app.
function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true; // reading window.top can throw across origins, which also means "framed"
  }
}

const container = document.getElementById('root');
if (container) {
  if (framed()) {
    container.textContent = 'For your safety, VinExpenses does not open inside another website.';
    try {
      if (window.top) window.top.location.href = window.self.location.href;
    } catch {
      /* cross-origin: the notice stays */
    }
  } else {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    registerServiceWorker();
  }
}
