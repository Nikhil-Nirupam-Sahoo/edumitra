import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('EduMitra: #root container missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// cache-bust 1791508874
