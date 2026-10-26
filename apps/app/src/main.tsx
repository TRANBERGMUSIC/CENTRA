import { createRoot } from 'react-dom/client';
import '../../../packages/design-system/dist/tokens.css';
import './styles/base.css';
import './styles/directions.css';
import './styles/app.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
