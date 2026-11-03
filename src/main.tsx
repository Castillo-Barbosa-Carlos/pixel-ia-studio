import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/tokens.css';
import './styles/global.css';
import './styles/layout.css';
import './styles/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el elemento #root.');
createRoot(container).render(<App />);
