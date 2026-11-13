import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/theme.css';
import App from './App.tsx';

// iOS ignores user-scalable=no in some cases; stop pinch-zoom directly.
// Scrolling is untouched: only the pinch gesture is cancelled.
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, e => e.preventDefault(), { passive: false });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
