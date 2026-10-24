import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(<App />);
