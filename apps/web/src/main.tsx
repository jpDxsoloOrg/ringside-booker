// Self-hosted fonts (see docs/design/visual-identity.md): Barlow Condensed for display, Inter for
// body text. Only these weights ship; the files are bundled, so no font CDN is ever contacted.
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
// Global styles, once, in this order: tokens, breakpoints, then the reset and base styles.
// Components never import these; they use CSS Modules and the semantic tokens.
import '@/styles/tokens.css';
import '@/styles/breakpoints.css';
import '@/styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter, routerProviderFutureFlags } from '@/app/router';
import { applyTheme, DEFAULT_THEME } from '@/styles/theme';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error(
    'Ringside Booker could not start: index.html has no <div id="root"> element to render into.',
  );
}

// Dark is the only shipped theme (D-11); the settings screen can apply a saved choice later.
applyTheme(DEFAULT_THEME);

const router = createAppRouter();

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} future={routerProviderFutureFlags} />
  </StrictMode>,
);
