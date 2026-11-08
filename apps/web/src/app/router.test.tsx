import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { findRouteByPath } from '@/test/routeTree';
import { DEV_PROMOTION_ID, devRoutesEnabled } from './dev/EnterShellRoute';
import { appRoutes, buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from './router';
import { routePatterns, routes } from './routes';
import { useSessionStore } from './session/sessionStore';

function renderAt(path: string, routeList: RouteObject[] = appRoutes) {
  const router = createMemoryRouter(routeList, {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return router;
}

/** Whether a route is registered at exactly `path` (not just caught by the `*` fallback). */
function registers(routeList: RouteObject[], path: string): boolean {
  return findRouteByPath(routeList, path) !== undefined;
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('app router', () => {
  it('renders the title screen at /', async () => {
    renderAt('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ringside Booker' }),
    ).toBeInTheDocument();
    expect(screen.getByText(`App v${__APP_VERSION__}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Load game' })).toHaveAttribute('href', routes.load());
  });

  it('renders the saved games screen at /load', async () => {
    renderAt(routes.load());

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Saved games' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('registers the component gallery in every build', async () => {
    renderAt('/dev/gallery#button');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Component gallery' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Button' })).toBeInTheDocument();
  });

  it('registers the bare page the phone frame loads', async () => {
    renderAt('/dev/gallery/frame?theme=dark#badge');

    expect(await screen.findByRole('heading', { level: 1, name: 'Badge' })).toBeInTheDocument();
  });

  it.each([[routes.newGame(), 'New game']])(
    'renders a placeholder at %s until the screen is built',
    async (path, title) => {
      renderAt(path);

      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
      expect(screen.queryByRole('navigation')).toBeNull();
    },
  );
});

describe('settings route', () => {
  it('renders the settings screen in the out-of-game layout', async () => {
    renderAt(routes.settings());

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('slider', { name: 'UI scale' })).toBeInTheDocument();
  });

  it('is linked from the title screen, and its back link returns there', async () => {
    const user = userEvent.setup();
    const router = renderAt(routes.title());

    await user.click(await screen.findByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect(router.state.location.pathname).toBe(routes.title());
  });
});

describe('dev-only routes', () => {
  it('are enabled on the dev server and in the e2e build only', () => {
    expect(devRoutesEnabled({ DEV: true })).toBe(true);
    expect(devRoutesEnabled({ DEV: false, VITE_E2E: '1' })).toBe(true);
    expect(devRoutesEnabled({ DEV: false })).toBe(false);
    expect(devRoutesEnabled({ DEV: false, VITE_E2E: '0' })).toBe(false);
  });

  it('leave the enter-shell helper out of a production build', () => {
    const productionRoutes = buildAppRoutes({
      includeDevRoutes: devRoutesEnabled({ DEV: false, VITE_E2E: undefined }),
    });

    expect(registers(productionRoutes, routePatterns.enterShell)).toBe(false);
    // The gallery still ships.
    expect(registers(productionRoutes, routes.dev.gallery())).toBe(true);
  });

  it('show the not-found screen for the helper in a production build', async () => {
    renderAt(routes.dev.enterShell(), buildAppRoutes({ includeDevRoutes: false }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(useSessionStore.getState().worldLoaded).toBe(false);
  });

  it('enter the shell with a promotion', async () => {
    const router = renderAt(
      routes.dev.enterShell({ promotion: 'pro_dev' }),
      buildAppRoutes({ includeDevRoutes: true }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.game.office());
    const { worldLoaded, seat } = useSessionStore.getState();
    expect(worldLoaded).toBe(true);
    expect(seat).toEqual({
      viewer: { kind: 'controller', controller: { kind: 'human', playerId: 'dev' } },
      controller: { kind: 'human', playerId: 'dev' },
      promotionId: DEV_PROMOTION_ID,
    });
  });

  it('enter the shell unemployed without a promotion', async () => {
    renderAt(routes.dev.enterShell(), buildAppRoutes({ includeDevRoutes: true }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(useSessionStore.getState().seat?.promotionId).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Creative' })).toBeNull();
  });
});
