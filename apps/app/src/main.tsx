import { createRoot } from 'react-dom/client';
import '../../../packages/design-system/dist/tokens.css';
import './styles/base.css';
import './styles/directions.css';
import './styles/app.css';
import './styles/apple.css';
import { App } from './App.tsx';
import { native, mobileApp } from './platform.ts';

// In the app the page is the app: no pinch zoom, no zoom when a field gets focus, no rubber band
// around the whole window (lists still bounce inside), and taps without the double-tap delay.
if (native) document.documentElement.classList.add('is-app');
if (mobileApp) document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');

createRoot(document.getElementById('root')!).render(<App />);

// Installed web app (iPhone/Android "Føj til hjemmeskærm"): offline start and self-update.
if (import.meta.env.PROD && !native && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'));
}
