import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');

// StrictMode double-invokes effects in development; the engine guards against
// a second boot, so the campus mounts exactly once either way.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
