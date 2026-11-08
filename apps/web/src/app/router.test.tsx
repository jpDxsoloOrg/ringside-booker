import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { appRoutes, routerFutureFlags, routerProviderFutureFlags } from './router';

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

  it('links the placeholder home to the gallery', async () => {
    renderAt('/');

    expect(await screen.findByRole('link', { name: 'Gallery' })).toHaveAttribute(
      'href',
      '/dev/gallery',
    );
  });

  it('registers the component gallery in every build', async () => {
    renderAt('/dev/gallery#button');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Component gallery' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Button' })).toBeInTheDocument();
  });

  it('registers the bare page the phone frame loads', async () => {
    renderAt('/dev/gallery/frame?theme=light#badge');

    expect(await screen.findByRole('heading', { level: 1, name: 'Badge' })).toBeInTheDocument();
  });
});
