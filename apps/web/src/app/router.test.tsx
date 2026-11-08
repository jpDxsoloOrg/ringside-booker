import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  appRoutes,
  includeDevRoutes,
  routerFutureFlags,
  routerProviderFutureFlags,
} from './router';

function renderAt(path: string): void {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
}

describe('app router', () => {
  it('renders the placeholder home at /', async () => {
    renderAt('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ringside Booker' }),
    ).toBeInTheDocument();
    expect(screen.getByText(`Version ${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it('registers the dev gallery in test mode', async () => {
    expect(includeDevRoutes).toBe(true);

    renderAt('/dev/gallery');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Component gallery' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'ImageSlot' })).toBeInTheDocument();
  });
});
