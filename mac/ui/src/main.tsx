import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './desktop.css';
import App from './App.tsx';

// Inside the desktop app the sidebar is see-through, so the window's vibrancy shows.
if (navigator.userAgent.includes('Electron')) document.documentElement.classList.add('electron');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
