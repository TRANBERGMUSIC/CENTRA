import { createRoot } from 'react-dom/client';
import '../../../packages/design-system/dist/tokens.css';
import './styles/base.css';
import './styles/directions.css';
import './styles/app.css';
import './styles/apple.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);

// Installed web app (iPhone/Android "Føj til hjemmeskærm"): offline start and self-update.
const isShell = '__TAURI_INTERNALS__' in window || (window as any).Capacitor?.isNativePlatform?.();
if (import.meta.env.PROD && !isShell && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'));
}
