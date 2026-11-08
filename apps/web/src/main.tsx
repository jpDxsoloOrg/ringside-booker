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
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createAppRouter, routerProviderFutureFlags } from '@/app/router';
import { applySettingsToDocument } from '@/app/settings/SettingsEffects';
import { initializeSettings } from '@/app/settings/settingsStore';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error(
    'Ringside Booker could not start: index.html has no <div id="root"> element to render into.',
  );
}

// Read the viewer's settings from localStorage synchronously and put the theme, UI scale and motion
// preference on <html> before the first render, so the first paint already has them and nothing
// flashes or jumps. SettingsEffects keeps them applied from here on.
applySettingsToDocument(initializeSettings());

const router = createAppRouter();

createRoot(rootElement).render(
  <StrictMode>
    {/* The engine runs in a Web Worker, started on first use. If it dies, the provider shows the
        "simulation stopped" screen in place of the routes. */}
    <EngineProvider>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>
  </StrictMode>,
);
