// PixiJS v8 compiles its shader and uniform-sync code with `new Function()`,
// which the packaged app's Content Security Policy blocks. This side-effect
// import swaps in the non-eval polyfills so the strict CSP can stay exactly as
// it is. It must run before any renderer is constructed.
//
// This only bites in the bundled desktop app — the Vite dev server serves no
// CSP, so the campus starts fine under `npm run dev` either way.
import 'pixi.js/unsafe-eval';

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
