import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter, routerProviderFutureFlags } from '@/app/router';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error(
    'Ringside Booker could not start: index.html has no <div id="root"> element to render into.',
  );
}

const router = createAppRouter();

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} future={routerProviderFutureFlags} />
  </StrictMode>,
);
