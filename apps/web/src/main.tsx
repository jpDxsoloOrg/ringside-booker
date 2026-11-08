// Global styles, once, in this order: tokens, breakpoints, then the reset and base styles.
// Components never import these; they use CSS Modules and the semantic tokens.
import '@/styles/tokens.css';
import '@/styles/breakpoints.css';
import '@/styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter, routerProviderFutureFlags } from '@/app/router';
import { applyTheme } from '@/styles/theme';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error(
    'Ringside Booker could not start: index.html has no <div id="root"> element to render into.',
  );
}

// Follow the OS theme until the settings screen applies a saved choice.
applyTheme('system');

const router = createAppRouter();

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} future={routerProviderFutureFlags} />
  </StrictMode>,
);
